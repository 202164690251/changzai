// Cubism 4 模型渲染。模型文件从 IndexedDB 取出，重写成 blob URL 后交给 pixi-live2d-display。
import * as PIXI from "pixi.js";
import type { Live2DModel as Live2DModelClass } from "pixi-live2d-display/cubism4";
import { loadLive2D } from "./live2dStore.ts";

// pixi-live2d-display 需要从 window.PIXI.Ticker 驱动模型更新；
// 必须在动态 import 插件之前挂上去，否则模型只会渲染第一帧。
(window as unknown as { PIXI: typeof PIXI }).PIXI = PIXI;

export interface Live2DHandle {
  destroy: () => void;
  resize: () => void;
  tap: () => void;
  motions: string[];
  expressions: number;
  expressionNames: string[];
  playMotion: (group: string) => void;
  playExpression: (index: number) => void;
  resetExpression: () => void;
  setTalking: (talking: boolean) => void;
  setMouthLevel: (level: number) => void;
  hitTest: (x: number, y: number) => string[];
  focus: (x: number, y: number) => void;
}

const CANVAS_SIZE = 200;

function resolvePath(basePath: string, reference: string): string {
  if (!reference) return reference;
  const base = basePath.split("/").slice(0, -1);
  const parts = reference.split("/");
  for (const part of parts) {
    if (part === "." || part === "") continue;
    if (part === "..") base.pop();
    else base.push(part);
  }
  return base.join("/");
}


interface VtubeHotkey {
  Action?: string;
  Name?: string;
  File?: string;
}

interface VtubeSettings {
  FileReferences?: {
    IdleAnimation?: string;
    IdleAnimationWhenTrackingLost?: string;
  };
  Hotkeys?: VtubeHotkey[];
}

function findFile(files: Record<string, Blob>, candidates: string[]): string | null {
  for (const candidate of candidates) {
    const normalized = candidate.replace(/^\.\//, "");
    if (files[normalized]) return normalized;
  }
  return null;
}

/**
 * VTube Studio 模型常把动作/表情放在 Animation、Exp3 目录，只在 .vtube.json
 * 的 Hotkeys 里引用，model3.json 本身没有 Motions/Expressions。
 * 这里把它们补进 model3，通用 Live2D 运行时才能播放。
 */
async function augmentVtubeModel(
  raw: Record<string, unknown>,
  modelPath: string,
  files: Record<string, Blob>,
): Promise<void> {
  const vtubePath = Object.keys(files).find((path) => path.toLowerCase().endsWith(".vtube.json"));
  if (!vtubePath) return;
  let vtube: VtubeSettings;
  try {
    vtube = JSON.parse(await files[vtubePath]!.text()) as VtubeSettings;
  } catch {
    return;
  }
  const modelDir = modelPath.split("/").slice(0, -1);
  const vtubeDir = vtubePath.split("/").slice(0, -1);
  const resolve = (base: string[], reference: string): string => {
    const parts = [...base, ...reference.split("/")];
    const output: string[] = [];
    for (const part of parts) {
      if (part === "." || part === "") continue;
      if (part === "..") output.pop();
      else output.push(part);
    }
    return output.join("/");
  };
  const candidatesFor = (reference: string, subdir?: string): string[] => {
    const list = [resolve(vtubeDir, reference), resolve(modelDir, reference)];
    if (subdir) {
      list.push(resolve(vtubeDir, `${subdir}/${reference}`), resolve(modelDir, `${subdir}/${reference}`));
    }
    return list;
  };
  const fileRefs = (raw.FileReferences ??= {}) as Record<string, unknown>;
  const motions = (fileRefs.Motions ??= {}) as Record<string, unknown[]>;
  const expressions = (fileRefs.Expressions ??= []) as Array<Record<string, unknown>>;
  const addedMotions = new Set<string>();
  const addMotion = (group: string, path: string): void => {
    if (addedMotions.has(path)) return;
    addedMotions.add(path);
    motions[group] = [...(motions[group] ?? []), { File: path, FadeInTime: 0.2, FadeOutTime: 0.2 }];
  };

  const idleRef = vtube.FileReferences?.IdleAnimation;
  if (idleRef) {
    const idle = findFile(files, candidatesFor(idleRef, "Animation"));
    if (idle) addMotion("Idle", idle);
  }
  if (!motions.Idle) {
    const fallbackIdle = findFile(files, [
      resolve(modelDir, "IDLE.motion3.json"),
      resolve(modelDir, "Animation/IDLE.motion3.json"),
    ]);
    if (fallbackIdle) addMotion("Idle", fallbackIdle);
  }

  let index = 0;
  for (const hotkey of vtube.Hotkeys ?? []) {
    if (!hotkey.File) continue;
    if (hotkey.Action === "TriggerAnimation") {
      const path = findFile(files, candidatesFor(hotkey.File, "Animation"));
      if (!path) continue;
      index += 1;
      addMotion(`动作${index}`, path);
    } else if (hotkey.Action === "ToggleExpression") {
      const path = findFile(files, candidatesFor(hotkey.File, "Exp3"));
      if (!path) continue;
      if (!expressions.some((item) => item.File === path)) {
        expressions.push({ Name: hotkey.Name || `表情${expressions.length + 1}`, File: path });
      }
    }
  }

  // VTube 模型常用 JawOpen 做口型；补一个 LipSync 组给通用运行时识别。
  const groups = (raw.Groups ??= []) as Array<{ Name?: string; Ids?: string[] }>;
  const lipSync = groups.find((group) => group.Name === "LipSync");
  if (lipSync && (!lipSync.Ids || lipSync.Ids.length === 0)) {
    lipSync.Ids = ["JawOpen"];
  }
}

function rewriteModel(
  raw: Record<string, unknown>,
  modelPath: string,
  urls: Record<string, string>,
): Record<string, unknown> {
  raw.url = modelPath;
  const fileRefs = raw.FileReferences as Record<string, unknown> | undefined;
  if (!fileRefs) return raw;
  const urlOf = (value: unknown): unknown => {
    if (typeof value !== "string") return value;
    return urls[resolvePath(modelPath, value)] ?? value;
  };
  fileRefs.Moc = urlOf(fileRefs.Moc);
  fileRefs.Physics = urlOf(fileRefs.Physics);
  fileRefs.Pose = urlOf(fileRefs.Pose);
  fileRefs.DisplayInfo = urlOf(fileRefs.DisplayInfo);
  fileRefs.UserData = urlOf(fileRefs.UserData);
  if (Array.isArray(fileRefs.Textures)) fileRefs.Textures = fileRefs.Textures.map(urlOf);
  if (Array.isArray(fileRefs.Expressions)) {
    fileRefs.Expressions = fileRefs.Expressions.map((item) => {
      if (item && typeof item === "object") {
        const expression = item as Record<string, unknown>;
        return { ...expression, File: urlOf(expression.File) };
      }
      return item;
    });
  }
  if (fileRefs.Motions && typeof fileRefs.Motions === "object") {
    const groups = fileRefs.Motions as Record<string, unknown>;
    fileRefs.Motions = Object.fromEntries(
      Object.entries(groups).map(([name, list]) => [
        name,
        Array.isArray(list)
          ? list.map((item) => {
              if (item && typeof item === "object") {
                const motion = item as Record<string, unknown>;
                return { ...motion, File: urlOf(motion.File), Sound: urlOf(motion.Sound) };
              }
              return item;
            })
          : list,
      ]),
    );
  }
  return raw;
}

export async function mountLive2D(
  host: HTMLElement,
  conversationId: string,
  canvasSize = CANVAS_SIZE,
): Promise<Live2DHandle | null> {
  const stored = await loadLive2D(conversationId);
  if (!stored) return null;

  const urls: Record<string, string> = {};
  for (const [path, blob] of Object.entries(stored.files)) {
    urls[path] = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
      reader.onerror = () => reject(reader.error ?? new Error("模型文件读取失败"));
      reader.readAsDataURL(blob);
    });
  }
  const raw = JSON.parse(await stored.files[stored.modelPath]!.text()) as Record<string, unknown>;
  await augmentVtubeModel(raw, stored.modelPath, stored.files);
  const modelJson = rewriteModel(raw, stored.modelPath, urls);

  const app = new PIXI.Application({
    width: canvasSize,
    height: canvasSize,
    backgroundAlpha: 0,
    antialias: true,
    autoDensity: true,
    resolution: Math.min(2, window.devicePixelRatio || 1),
  });
  const canvas = app.view as HTMLCanvasElement;
  canvas.className = "live2d-canvas";
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  canvas.style.pointerEvents = "none";
  host.replaceChildren(canvas);

  let model: Live2DModelClass | null = null;
  const fit = (): void => {
    if (!model) return;
    // 用模型原始画布尺寸计算，不能用已缩放后的 model.width，否则 resize 会越缩越大
    const width = model.internalModel.originalWidth || model.internalModel.width || model.width || 1;
    const height = model.internalModel.originalHeight || model.internalModel.height || model.height || 1;
    const scale = Math.min(canvasSize / width, canvasSize / height) * 0.96;
    model.scale.set(scale);
    model.anchor.set(0.5, 0.5);
    model.position.set(canvasSize / 2, canvasSize / 2);
  };

  try {
    const { Live2DModel } = await import("pixi-live2d-display/cubism4");
    Live2DModel.registerTicker(PIXI.Ticker);
    model = await Live2DModel.from(
      modelJson as unknown as Parameters<typeof Live2DModel.from>[0],
      { autoInteract: false },
    );
    app.stage.addChild(model);
    fit();
  } catch (error) {
    app.destroy(true);
    throw error;
  }

  const play = (group: string): void => {
    if (!model) return;
    try {
      const result = model.motion(group);
      if (result && typeof result.catch === "function") result.catch(() => undefined);
    } catch {
      /* 模型没有这个动作组时保持静止 */
    }
  };

  const settings = model?.internalModel.settings as unknown as {
    motions?: Record<string, unknown>;
    expressions?: unknown[];
    groups?: Array<{ Name?: string; Ids?: string[] }>;
  };
  const motions = Object.keys(settings?.motions ?? {});
  const expressionItems = (settings?.expressions ?? []) as Array<{ Name?: string }>;
  const expressions = expressionItems.length;
  const expressionNames = expressionItems.map((item, index) => item.Name || `表情${index + 1}`);
  let talking = false;
  let mouthLevel = 0;
  let mouthTimer: number | null = null;
  const lipSyncIds = settings?.groups?.find((group) => group.Name === "LipSync")?.Ids ?? [];
  const mouthIds = lipSyncIds.length > 0 ? lipSyncIds : ["ParamMouthOpenY", "JawOpen"];

  const setTalking = (next: boolean): void => {
    talking = next;
    if (mouthTimer === null) {
      mouthTimer = window.setInterval(() => {
        if (!model) return;
        try {
          const value = talking
            ? mouthLevel > 0.02
              ? Math.min(0.75, mouthLevel)
              : 0.05 + Math.abs(Math.sin(Date.now() / 95)) * 0.55
            : 0;
          const core = model.internalModel.coreModel as unknown as {
            setParameterValueById: (id: string, value: number) => void;
          };
          for (const id of mouthIds) {
            try {
              core.setParameterValueById(id, value);
            } catch {
              /* 模型没有这个口型参数时尝试下一个 */
            }
          }
        } catch {
          /* 模型没有口型参数 */
        }
      }, 80);
    }
    if (!next) {
      try {
        const core = model?.internalModel.coreModel as unknown as {
          setParameterValueById: (id: string, value: number) => void;
        };
        for (const id of mouthIds) {
          try {
            core?.setParameterValueById(id, 0);
          } catch {
            /* 忽略 */
          }
        }
      } catch {
        /* 忽略 */
      }
    }
  };

  const playExpression = (index: number): void => {
    if (!model || expressions === 0) return;
    try {
      const result = model.expression(index % expressions);
      if (result && typeof result.catch === "function") result.catch(() => undefined);
    } catch {
      /* 忽略 */
    }
  };

  const resetExpression = (): void => {
    try {
      const manager = model?.internalModel.motionManager.expressionManager as
        | { resetExpression?: () => void }
        | null
        | undefined;
      manager?.resetExpression?.();
    } catch {
      /* 忽略 */
    }
  };

  // 有 Idle 组的模型自动进入待机；没有就保持第一帧
  play("Idle");

  return {
    motions,
    expressions,
    expressionNames,
    resize: fit,
    tap: () => {
      play("Tap");
    },
    playMotion: play,
    playExpression,
    resetExpression,
    setTalking,
    setMouthLevel: (level: number) => {
      mouthLevel = Math.max(0, Math.min(1, level));
    },
    hitTest: (x: number, y: number) => {
      try {
        return model?.hitTest(x, y) ?? [];
      } catch {
        return [];
      }
    },
    focus: (x: number, y: number) => {
      try {
        model?.focus(x, y);
      } catch {
        /* 忽略 */
      }
    },
    destroy: () => {
      if (mouthTimer !== null) window.clearInterval(mouthTimer);
      model?.destroy();
      app.destroy(true);
    },
  };
}
