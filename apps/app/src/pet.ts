import { invoke } from "@tauri-apps/api/core";
import { buildRecordedVoice } from "./lib/voiceRecorder.ts";
import "./pet.css";

interface PetState {
  id?: string;
  name?: string;
  avatar?: string | null;
  text?: string;
  ts?: number;
  typing?: boolean;
  talking?: boolean;
  mood?: string;
  reminder?: boolean;
  lastFrom?: string;
}

const root = document.getElementById("pet-root") as HTMLElement;
const stage = document.getElementById("pet-stage") as HTMLElement;
const image = document.getElementById("pet-image") as HTMLImageElement;
const fallback = document.getElementById("pet-fallback") as HTMLElement;
const nameEl = document.getElementById("pet-name") as HTMLElement;
const statusEl = document.getElementById("pet-status") as HTMLElement;
const bubble = document.getElementById("pet-bubble") as HTMLElement;
const menu = document.getElementById("pet-menu") as HTMLElement;
const form = document.getElementById("pet-chat") as HTMLFormElement;
const input = document.getElementById("pet-input") as HTMLInputElement;
const mic = document.getElementById("pet-mic") as HTMLButtonElement;
const quick = document.getElementById("pet-quick") as HTMLElement;
const panel = document.getElementById("pet-chat-panel") as HTMLElement;
const live2dHost = document.getElementById("pet-live2d") as HTMLElement;
const actionsPanel = document.getElementById("pet-actions") as HTMLElement | null;
const actionList = document.getElementById("pet-action-list") as HTMLElement | null;
const actionsClose = document.getElementById("pet-actions-close") as HTMLButtonElement | null;

if (!root || !stage || !image || !fallback || !nameEl || !statusEl || !bubble || !menu || !form || !input || !mic || !quick || !panel || !live2dHost) {
  throw new Error("PET_DOM_MISSING");
}

const LINES = ["在呢", "怎么啦？", "我在这儿", "嗯？", "想我啦？", "来啦来啦"];
const LIVE2D_CANVAS = 480;
let lastTs = 0;
let bubbleTimer: number | null = null;
let menuOpen = false;
let chatOpen = false;
let stageSize = 240;
let resizing = false;
let resizeStartX = 0;
let resizeStartY = 0;
let resizeStartSize = 240;
let layoutTimer = 0;
let live2dHandle: {
  destroy: () => void;
  resize: () => void;
  tap: () => void;
  motions: string[];
  expressions: number;
  expressionNames: string[];
  playMotion: (group: string) => void;
  playExpression: (index: number) => void;
  setTalking: (talking: boolean) => void;
  setMouthLevel: (level: number) => void;
  hitTest: (x: number, y: number) => string[];
  focus: (x: number, y: number) => void;
} | null = null;
let live2dId: string | null = null;
let live2dChecked: string | null = null;
let live2dLoading = false;
let autoLive2D = true;
let lastLive2DState: PetState = {};

type BehaviorState = "idle" | "talking" | "thinking" | "dragging" | "sleeping" | "happy" | "annoyed";
let behaviorState: BehaviorState = "idle";
let behaviorUntil = 0;
let lastMood = "";
let lastReminder = false;
let sleepOverrideUntil = 0;
let sleepEnabled = true;
let activityLevel: "quiet" | "normal" | "lively" = "normal";
let lastAutoAt = 0;
let lastPokeAt = 0;
let pokeCount = 0;

async function syncLive2D(state: PetState): Promise<void> {
  const id = state.id;
  if (!id || id === live2dChecked || live2dLoading) return;
  live2dLoading = true;
  live2dHandle?.destroy();
  live2dHandle = null;
  live2dHost.hidden = true;
  try {
    const module = await import("./lib/live2d.ts");
    const handle = await Promise.race([
      module.mountLive2D(live2dHost, id, LIVE2D_CANVAS),
      new Promise<null>((resolve) => window.setTimeout(() => resolve(null), 15000)),
    ]);
    live2dChecked = id;
    live2dId = handle ? id : null;
    if (handle) {
      live2dHandle = handle;
      live2dHost.hidden = false;
      image.hidden = true;
        fallback.hidden = true;
      stage.classList.add("has-live2d");
    } else {
      stage.classList.remove("has-live2d");
      live2dHost.hidden = true;
      showStatic(readState());
    }
  } catch {
    live2dChecked = id;
    live2dId = null;
    live2dHost.hidden = true;
    stage.classList.remove("has-live2d");
    showStatic(readState());
  } finally {
    live2dLoading = false;
  }
}
let pointerDown = false;
let dragStarted = false;
let suppressClick = false;
let downX = 0;
let downY = 0;
let recording = false;
let recorder: MediaRecorder | null = null;
let stream: MediaStream | null = null;
let chunks: Blob[] = [];
let startedAt = 0;

function readState(): PetState {
  try {
    return JSON.parse(localStorage.getItem("pet.state") ?? "{}") as PetState;
  } catch {
    return {};
  }
}

function showBubble(text: string): void {
  const value = text.trim();
  if (!value) return;
  bubble.textContent = value.length > 90 ? `${value.slice(0, 90)}…` : value;
  bubble.hidden = false;
  if (bubbleTimer !== null) window.clearTimeout(bubbleTimer);
  bubbleTimer = window.setTimeout(() => {
    bubble.hidden = true;
    bubbleTimer = null;
  }, 5000);
}

function hideMenu(): void {
  menu.hidden = true;
  menuOpen = false;
}

function updateStatus(state: PetState): void {
  let text = state.typing ? "在想…" : state.lastFrom === "her" ? "刚回完" : "在线";
  if (behaviorState === "talking") text = "在说话";
  else if (behaviorState === "dragging") text = "被拎起来了";
  else if (behaviorState === "sleeping") text = "睡着了";
  else if (behaviorState === "happy") text = "开心";
  else if (behaviorState === "annoyed") text = "别戳啦";
  const span = statusEl.querySelector("span");
  if (span) span.textContent = text;
  statusEl.classList.toggle("is-thinking", Boolean(state.typing) || behaviorState === "thinking");
  document.body.dataset.petState = behaviorState;
}

function setBehavior(next: BehaviorState, durationMs = 0, bubbleText = ""): void {
  if (behaviorState === "dragging" && next !== "dragging") return;
  if (behaviorState === "talking" && next === "happy") return;
  behaviorState = next;
  behaviorUntil = durationMs > 0 ? Date.now() + durationMs : 0;
  if (next === "talking") live2dHandle?.setTalking(true);
  else live2dHandle?.setTalking(false);
  updateStatus(readState());
  if (bubbleText) showBubble(bubbleText);
}

function isNight(): boolean {
  const hour = new Date().getHours();
  return hour >= 23 || hour < 7;
}

function canSleep(): boolean {
  return sleepEnabled && isNight() && Date.now() > sleepOverrideUntil;
}

function onHeadPat(): void {
  if (behaviorState === "sleeping") {
    sleepOverrideUntil = Date.now() + 2 * 60 * 60 * 1000;
    setBehavior("happy", 4500);
    showBubble("唔…醒啦");
    live2dHandle?.tap();
    return;
  }
  setBehavior("happy", 4500);
  stage.classList.remove("is-patting");
  void stage.offsetWidth;
  stage.classList.add("is-patting");
  live2dHandle?.tap();
  showBubble(LINES[Math.floor(Math.random() * LINES.length)] ?? "在呢");
}

function onPoke(): void {
  const now = Date.now();
  pokeCount = now - lastPokeAt < 3500 ? pokeCount + 1 : 1;
  lastPokeAt = now;
  if (pokeCount >= 3) {
    pokeCount = 0;
    setBehavior("annoyed", 4000);
    showBubble("别戳啦，再戳要生气了");
  } else {
    showBubble("嗯？");
  }
}

function onFeed(): void {
  setBehavior("happy", 6000);
  live2dHandle?.tap();
  showBubble("好吃！再来一口");
}

function wakeUp(): void {
  sleepOverrideUntil = Date.now() + 2 * 60 * 60 * 1000;
  setBehavior("happy", 4500);
  showBubble("唔…醒啦");
}

function applyMood(mood: string | undefined): void {
  if (!mood || mood === lastMood) return;
  lastMood = mood;
  if (behaviorState !== "idle" && behaviorState !== "thinking") return;
  if (mood === "sunny") setBehavior("happy", 4500);
  else if (mood === "stormy") setBehavior("annoyed", 4000);
  if (live2dHandle && live2dHandle.expressions > 0) {
    live2dHandle.playExpression(mood === "stormy" ? 1 : 0);
  }
}

function applyReminder(reminder: boolean | undefined): void {
  const next = Boolean(reminder);
  if (next && !lastReminder) {
    showBubble("该起来喝口水啦，别一直坐着");
    live2dHandle?.tap();
  }
  lastReminder = next;
}

function syncLayout(persist = true): void {
  void invoke("pet_set_layout", { size: stageSize, chatOpen, persist }).catch(() => undefined);
}

function scheduleLayout(): void {
  if (layoutTimer !== 0) return;
  layoutTimer = window.setTimeout(() => {
    layoutTimer = 0;
    syncLayout(false);
  }, 60);
}

function applyStageSize(next: number, persist = true): void {
  const maxStage = Math.max(180, Math.min(480, window.screen.availWidth - 80, window.screen.availHeight - 230));
  stageSize = Math.max(140, Math.min(maxStage, Math.round(next)));
  document.documentElement.style.setProperty("--pet-size", `${stageSize}px`);
  live2dHandle?.resize();
  if (persist) syncLayout();
}

function setChatOpen(next: boolean): void {
  chatOpen = next;
  panel.hidden = !next;
  syncLayout();
  if (next) window.setTimeout(() => input.focus(), 60);
}

function showStatic(state: PetState): void {
  if (live2dId !== null) {
    image.hidden = true;
    fallback.hidden = true;
    return;
  }
  if (state.avatar) {
    image.hidden = false;
    fallback.hidden = true;
  } else {
    image.hidden = true;
    fallback.hidden = false;
  }
}

function applyState(): void {
  const state = readState();
  lastLive2DState = state;
  const name = state.name?.trim() || "ta";
  nameEl.textContent = name;
  fallback.textContent = name.slice(0, 1);
  applyMood(state.mood);
  applyReminder(state.reminder);
  if (state.talking) {
    if (behaviorState !== "talking") setBehavior("talking");
  } else if (behaviorState === "talking") {
    setBehavior(canSleep() ? "sleeping" : "idle");
  } else if (behaviorState === "idle" && state.typing) {
    setBehavior("thinking");
  } else if (behaviorState === "thinking" && !state.typing) {
    setBehavior("idle");
  }
  if (canSleep() && behaviorState === "idle" && !state.talking) {
    setBehavior("sleeping");
  }
  if (!canSleep() && behaviorState === "sleeping") setBehavior("idle");
  if (behaviorUntil > 0 && Date.now() > behaviorUntil) {
    setBehavior(canSleep() ? "sleeping" : "idle");
  }
  updateStatus(state);
  live2dHandle?.setTalking(Boolean(state.talking));
  if (state.avatar) {
    image.src = state.avatar;
  }
  showStatic(state);
  void syncLive2D(state);
  if (state.text && (state.ts ?? 0) > lastTs) {
    lastTs = state.ts ?? Date.now();
    showBubble(state.text);
  }
}

function applyMenuLabels(): void {
  const autoButton = menu.querySelector<HTMLButtonElement>('[data-action="auto"]');
  if (autoButton) autoButton.textContent = `自动动效：${autoLive2D ? "开" : "关"}`;
  live2dHandle?.resize();
}

async function sendText(text: string): Promise<void> {
  const value = text.trim();
  if (!value) return;
  try {
    await invoke("pet_send_text", { text: value });
    input.value = "";
    showBubble("发出去啦，等 ta 回你");
  } catch (error) {
    showBubble(typeof error === "string" ? error : "没发出去，再试一次");
  }
}

function startRecording(): void {
  void (async () => {
    try {
      const media = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : "audio/webm";
      const next = new MediaRecorder(media, { mimeType: mime });
      stream = media;
      recorder = next;
      chunks = [];
      recording = true;
      mic.classList.add("is-recording");
      startedAt = Date.now();
      next.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.push(event.data);
      };
      next.onstop = () => {
        const duration = Math.max(1, Math.round((Date.now() - startedAt) / 1000));
        media.getTracks().forEach((track) => track.stop());
        stream = null;
        recording = false;
        mic.classList.remove("is-recording");
        const blob = new Blob(chunks, { type: mime });
        chunks = [];
        void buildRecordedVoice(blob, duration)
          .then(async (voice) => {
            const result = await invoke<{ text: string }>("stt_transcribe", {
              request: { audioBase64: voice.wavBase64 },
            });
            const text = result.text?.trim();
            if (text) await sendText(text);
            else showBubble("没听清，再说一次？");
          })
          .catch(() => showBubble("没听清，再说一次？"));
      };
      next.start();
    } catch {
      showBubble("麦克风没有打开");
    }
  })();
}

mic.addEventListener("click", () => {
  if (recording) {
    recorder?.stop();
  } else {
    startRecording();
  }
});

form.addEventListener("submit", (event) => {
  event.preventDefault();
  void sendText(input.value);
});

quick.addEventListener("click", (event) => {
  const target = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-quick]");
  if (!target) return;
  void sendText(target.dataset.quick ?? "");
});

stage.addEventListener("mousedown", (event) => {
  if (event.button !== 0) return;
  if ((event.target as HTMLElement).closest(".pet-resize")) return;
  hideMenu();
  pointerDown = true;
  dragStarted = false;
  suppressClick = false;
  downX = event.screenX;
  downY = event.screenY;
});

stage.addEventListener("mousemove", (event) => {
  if (!live2dHandle) return;
  const rect = stage.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return;
  live2dHandle.focus(
    ((event.clientX - rect.left) / rect.width) * LIVE2D_CANVAS,
    ((event.clientY - rect.top) / rect.height) * LIVE2D_CANVAS,
  );
});

window.addEventListener("mousemove", (event) => {
  if (resizing || !pointerDown || dragStarted) return;
  if (Math.hypot(event.screenX - downX, event.screenY - downY) < 5) return;
  dragStarted = true;
  suppressClick = true;
  setBehavior("dragging");
  void invoke("pet_start_drag").catch(() => undefined);
});

window.addEventListener("mouseup", () => {
  if (menuOpen || resizing) return;
  pointerDown = false;
  if (behaviorState === "dragging") {
    setBehavior(canSleep() ? "sleeping" : "idle");
  }
  void invoke("pet_save_position").catch(() => undefined);
});

function clickZone(event: MouseEvent): "head" | "body" {
  const rect = stage.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return "body";
  const x = ((event.clientX - rect.left) / rect.width) * LIVE2D_CANVAS;
  const y = ((event.clientY - rect.top) / rect.height) * LIVE2D_CANVAS;
  if (live2dHandle) {
    const hits = live2dHandle.hitTest(x, y);
    if (hits.some((hit: string) => /head|face/i.test(hit))) return "head";
    if (hits.length > 0) return "body";
  }
  return y < LIVE2D_CANVAS * 0.35 ? "head" : "body";
}

stage.addEventListener("click", (event) => {
  if (menuOpen) return;
  if (suppressClick) {
    suppressClick = false;
    return;
  }
  if (behaviorState === "sleeping") {
    wakeUp();
    return;
  }
  const zone = clickZone(event);
  if (zone === "head") {
    onHeadPat();
    return;
  }
  onPoke();
  setChatOpen(!chatOpen);
});

stage.addEventListener("dblclick", () => {
  hideMenu();
  void invoke("pet_open_main").catch(() => undefined);
});

window.addEventListener("contextmenu", (event) => {
  event.preventDefault();
  menu.hidden = false;
  menuOpen = true;
  const width = menu.offsetWidth;
  const height = menu.offsetHeight;
  const x = Math.min(event.clientX, window.innerWidth - width - 6);
  const y = Math.min(event.clientY, window.innerHeight - height - 6);
  menu.style.left = `${Math.max(4, x)}px`;
  menu.style.top = `${Math.max(4, y)}px`;
});

function openActionPanel(): void {
  hideMenu();
  if (!actionsPanel || !actionList) {
    showBubble("动作面板不可用");
    return;
  }
  if (!live2dHandle) {
    showBubble("当前没有 Live2D 模型");
    return;
  }
  actionList.replaceChildren();
  const addButton = (label: string, onClick: () => void): void => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.addEventListener("click", () => {
      onClick();
      if (actionsPanel) actionsPanel.hidden = true;
    });
    actionList.appendChild(button);
  };
  if (live2dHandle.motions.length > 0) {
    const title = document.createElement("p");
    title.className = "pet-action-title";
    title.textContent = "动作";
    actionList.appendChild(title);
    for (const group of live2dHandle.motions) {
      addButton(group, () => live2dHandle?.playMotion(group));
    }
  }
  if (live2dHandle.expressions > 0) {
    const title = document.createElement("p");
    title.className = "pet-action-title";
    title.textContent = "表情";
    actionList.appendChild(title);
    for (let index = 0; index < live2dHandle.expressions; index += 1) {
      addButton(live2dHandle.expressionNames[index] ?? `表情 ${index + 1}`, () => live2dHandle?.playExpression(index));
    }
  }
  if (actionList.childElementCount === 0) {
    actionList.textContent = "这个模型没有可选动作或表情";
  }
  actionsPanel.hidden = false;
}

actionsClose?.addEventListener("click", () => {
  if (actionsPanel) actionsPanel.hidden = true;
});

function randomMotion(): void {
  if (!live2dHandle || live2dHandle.motions.length === 0) {
    showBubble("这个模型没有可用动作");
    return;
  }
  const groups = live2dHandle.motions;
  const group = groups[Math.floor(Math.random() * groups.length)] ?? groups[0];
  if (group) live2dHandle.playMotion(group);
  showBubble(`动作：${group ?? "默认"}`);
}

function randomExpression(): void {
  if (!live2dHandle || live2dHandle.expressions === 0) {
    showBubble("这个模型没有表情");
    return;
  }
  const index = Math.floor(Math.random() * live2dHandle.expressions);
  live2dHandle.playExpression(index);
  showBubble(live2dHandle.expressionNames[index] ?? "换了个表情");
}

function toggleAuto(): void {
  autoLive2D = !autoLive2D;
  try {
    localStorage.setItem("pet.live2d.auto", autoLive2D ? "1" : "0");
  } catch {
    /* 忽略 */
  }
  showBubble(autoLive2D ? "自动动效已开启" : "自动动效已暂停");
}

menu.addEventListener("click", (event) => {
  const target = (event.target as HTMLElement).closest<HTMLButtonElement>("button");
  const action = target?.dataset.action;
  hideMenu();
  if (action === "chat") void invoke("pet_open_main");
  else if (action === "auto") toggleAuto();
  else if (action === "actions") openActionPanel();
  else if (action === "motion") randomMotion();
  else if (action === "expression") randomExpression();
  else if (action === "pat") {
    stage.classList.add("is-patting");
    showBubble("嘿嘿，摸头会害羞的");
  } else if (action === "feed") showBubble("好吃！再来一口");
  else if (action === "hide") void invoke("pet_hide");
  else if (action === "close") void invoke("pet_close");
});

window.addEventListener("storage", (event) => {
  if (event.key === "pet.live2d.auto") {
    autoLive2D = localStorage.getItem("pet.live2d.auto") !== "0";
    applyMenuLabels();
  }
  if (event.key === "pet.activity") {
    const saved = localStorage.getItem("pet.activity");
    activityLevel = saved === "quiet" || saved === "lively" ? saved : "normal";
  }
  if (event.key === "pet.sleep") {
    sleepEnabled = localStorage.getItem("pet.sleep") !== "0";
    if (!sleepEnabled && behaviorState === "sleeping") setBehavior("idle");
  }
  if (event.key === "pet.state") applyState();
  if (event.key === "pet.live2d.rev") {
    live2dHandle?.destroy();
    live2dHandle = null;
    live2dId = null;
    live2dChecked = null;
    live2dHost.hidden = true;
    stage.classList.remove("has-live2d");
    applyState();
  }
});

try {
  const savedAuto = localStorage.getItem("pet.live2d.auto");
  if (savedAuto !== null) autoLive2D = savedAuto === "1";
  const savedActivity = localStorage.getItem("pet.activity");
  if (savedActivity === "quiet" || savedActivity === "normal" || savedActivity === "lively") {
    activityLevel = savedActivity;
  }
  const savedSleep = localStorage.getItem("pet.sleep");
  if (savedSleep !== null) sleepEnabled = savedSleep === "1";
} catch {
  /* 忽略 */
}

window.setInterval(applyState, 1200);

// 音量包络 → Live2D 口型（主窗口每 80ms 写入 pet.voice.level）
window.setInterval(() => {
  if (!live2dHandle || !lastLive2DState.talking) return;
  try {
    const level = Number(localStorage.getItem("pet.voice.level") ?? "0");
    live2dHandle.setMouthLevel(Number.isFinite(level) ? level : 0);
  } catch {
    /* 忽略 */
  }
}, 80);

window.setInterval(() => {
  if (!live2dHandle || !autoLive2D) return;
  if (lastLive2DState.talking || behaviorState !== "idle") return;
  const interval = activityLevel === "quiet" ? 22000 : activityLevel === "lively" ? 7000 : 12000;
  if (Date.now() - lastAutoAt < interval) return;
  lastAutoAt = Date.now();
  const groups = live2dHandle.motions;
  if (groups.length === 0) return;
  const idle = groups.find((group) => /idle/i.test(group)) ?? groups[0];
  const playful = groups.find((group) => /tap/i.test(group));
  const group = playful && Math.random() < 0.22 ? playful : idle;
  if (group) live2dHandle.playMotion(group);
  if (live2dHandle.expressions > 0 && Math.random() < 0.3) {
    const facial = live2dHandle.expressionNames
      .map((name, index) => ({ name, index }))
      .filter(({ name }) => !/体型|衣服|鞋|眼镜|尾巴|裙子|钢盆|胸口|前倾|加载/i.test(name));
    const pool = facial.length > 0 ? facial : live2dHandle.expressionNames.map((name, index) => ({ name, index }));
    const picked = pool[Math.floor(Math.random() * pool.length)];
    if (picked) live2dHandle.playExpression(picked.index);
  }
}, 1000);

window.addEventListener("blur", hideMenu);

void invoke<{ size: number; chatOpen: boolean }>("pet_get_layout")
  .then((layout) => {
    stageSize = Number.isFinite(layout.size) ? layout.size : 240;
    applyStageSize(stageSize, false);
    if (layout.chatOpen) {
      chatOpen = true;
      panel.hidden = false;
    }
    syncLayout(false);
  })
  .catch(() => applyStageSize(stageSize, false));

// 右下角拖拽调整桌宠大小；下方名称/状态/聊天宽度保持固定
const resizeHandle = document.getElementById("pet-resize") as HTMLElement;
resizeHandle.addEventListener("pointerdown", (event) => {
  if (event.button !== 0) return;
  event.preventDefault();
  event.stopPropagation();
  resizing = true;
  suppressClick = true;
  resizeStartX = event.screenX;
  resizeStartY = event.screenY;
  resizeStartSize = stageSize;
  resizeHandle.setPointerCapture(event.pointerId);
  document.body.classList.add("is-resizing");
});

window.addEventListener("pointermove", (event) => {
  if (!resizing) return;
  const delta = (event.screenX - resizeStartX + event.screenY - resizeStartY) / 2;
  applyStageSize(resizeStartSize + delta, false);
  scheduleLayout();
});

window.addEventListener("pointerup", () => {
  if (!resizing) return;
  resizing = false;
  document.body.classList.remove("is-resizing");
  syncLayout();
});

applyState();
