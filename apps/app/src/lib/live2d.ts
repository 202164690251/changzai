// Cubism 4 模型渲染。模型文件从 IndexedDB 取出，重写成 blob URL 后交给 pixi-live2d-display。
import * as PIXI from "pixi.js";
import { Live2DModel } from "pixi-live2d-display/cubism4";
import { loadLive2D } from "./live2dStore.ts";

export interface Live2DHandle {
  destroy: () => void;
  resize: () => void;
  tap: () => void;
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

export async function mountLive2D(host: HTMLElement, conversationId: string): Promise<Live2DHandle | null> {
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
  const modelJson = rewriteModel(raw, stored.modelPath, urls);

  const app = new PIXI.Application({
    width: CANVAS_SIZE,
    height: CANVAS_SIZE,
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

  let model: Live2DModel | null = null;
  const fit = (): void => {
    if (!model) return;
    const width = model.width || 1;
    const height = model.height || 1;
    const scale = Math.min(CANVAS_SIZE / width, CANVAS_SIZE / height) * 0.96;
    model.scale.set(scale);
    model.anchor.set(0.5, 0.5);
    model.position.set(CANVAS_SIZE / 2, CANVAS_SIZE / 2);
  };

  try {
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

  // 有 Idle 组的模型自动进入待机；没有就保持第一帧
  play("Idle");

  return {
    resize: fit,
    tap: () => {
      play("Tap");
    },
    destroy: () => {
      model?.destroy();
      app.destroy(true);
    },
  };
}
