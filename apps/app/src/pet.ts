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
  lastFrom?: string;
}

const root = document.getElementById("pet-root") as HTMLElement;
const stage = document.getElementById("pet-stage") as HTMLElement;
const image = document.getElementById("pet-image") as HTMLImageElement;
const head = document.getElementById("pet-head") as HTMLImageElement;
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

if (!root || !stage || !image || !head || !fallback || !nameEl || !statusEl || !bubble || !menu || !form || !input || !mic || !quick || !panel || !live2dHost) {
  throw new Error("PET_DOM_MISSING");
}

const LINES = ["在呢", "怎么啦？", "我在这儿", "嗯？", "想我啦？", "来啦来啦"];
let lastTs = 0;
let bubbleTimer: number | null = null;
let menuOpen = false;
let mini = false;
let chatOpen = false;
let live2dHandle: {
  destroy: () => void;
  resize: () => void;
  tap: () => void;
  motions: string[];
  expressions: number;
  playMotion: (group: string) => void;
  playExpression: (index: number) => void;
  setTalking: (talking: boolean) => void;
  focus: (x: number, y: number) => void;
} | null = null;
let live2dId: string | null = null;
let live2dChecked: string | null = null;
let live2dLoading = false;
let autoLive2D = true;
let lastLive2DState: PetState = {};

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
      module.mountLive2D(live2dHost, id),
      new Promise<null>((resolve) => window.setTimeout(() => resolve(null), 15000)),
    ]);
    live2dChecked = id;
    live2dId = handle ? id : null;
    if (handle) {
      live2dHandle = handle;
      live2dHost.hidden = false;
      image.hidden = true;
      head.hidden = true;
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
  const text = state.typing ? "在想…" : state.lastFrom === "her" ? "刚回完" : "在线";
  const span = statusEl.querySelector("span");
  if (span) span.textContent = text;
  statusEl.classList.toggle("is-thinking", Boolean(state.typing));
}

function setChatOpen(next: boolean): void {
  if (mini) return;
  chatOpen = next;
  panel.hidden = !next;
  void invoke("pet_set_chat_open", { open: next }).catch(() => undefined);
  if (next) window.setTimeout(() => input.focus(), 60);
}

function showStatic(state: PetState): void {
  if (live2dId !== null) {
    image.hidden = true;
    head.hidden = true;
    fallback.hidden = true;
    return;
  }
  if (state.avatar) {
    image.hidden = false;
    head.hidden = false;
    fallback.hidden = true;
  } else {
    image.hidden = true;
    head.hidden = true;
    fallback.hidden = false;
  }
}

function applyState(): void {
  const state = readState();
  lastLive2DState = state;
  const name = state.name?.trim() || "ta";
  nameEl.textContent = name;
  fallback.textContent = name.slice(0, 1);
  updateStatus(state);
  if (state.avatar) {
    image.src = state.avatar;
    head.src = state.avatar;
  }
  showStatic(state);
  void syncLive2D(state);
  if (state.text && (state.ts ?? 0) > lastTs) {
    lastTs = state.ts ?? Date.now();
    showBubble(state.text);
  }
}

function applyMiniClass(): void {
  document.body.classList.toggle("is-mini", mini);
  const button = menu.querySelector<HTMLButtonElement>('[data-action="mini"]');
  if (button) button.textContent = mini ? "完整模式" : "Mini 模式";
  panel.hidden = mini || !chatOpen;
  const autoButton = menu.querySelector<HTMLButtonElement>('[data-action="auto"]');
  if (autoButton) autoButton.textContent = `自动动效：${autoLive2D ? "开" : "关"}`;
  live2dHandle?.resize();
}

async function toggleMini(): Promise<void> {
  mini = !mini;
  chatOpen = false;
  panel.hidden = true;
  try {
    await invoke("pet_set_mini", { mini });
  } catch {
    /* 窗口大小失败时只切样式 */
  }
  applyMiniClass();
  showBubble(mini ? "缩小啦" : "我回来啦");
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
    ((event.clientX - rect.left) / rect.width) * 200,
    ((event.clientY - rect.top) / rect.height) * 200,
  );
});

window.addEventListener("mousemove", (event) => {
  if (!pointerDown || dragStarted) return;
  if (Math.hypot(event.screenX - downX, event.screenY - downY) < 5) return;
  dragStarted = true;
  suppressClick = true;
  void invoke("pet_start_drag").catch(() => undefined);
});

window.addEventListener("mouseup", () => {
  if (menuOpen) return;
  pointerDown = false;
  void invoke("pet_save_position").catch(() => undefined);
});

stage.addEventListener("click", () => {
  if (menuOpen) return;
  live2dHandle?.tap();
  if (suppressClick) {
    suppressClick = false;
    return;
  }
  if (mini) {
    stage.classList.remove("is-patting");
    void stage.offsetWidth;
    stage.classList.add("is-patting");
    showBubble(LINES[Math.floor(Math.random() * LINES.length)] ?? "在呢");
    return;
  }
  setChatOpen(!chatOpen);
  if (!chatOpen) {
    stage.classList.remove("is-patting");
    void stage.offsetWidth;
    stage.classList.add("is-patting");
    showBubble(LINES[Math.floor(Math.random() * LINES.length)] ?? "在呢");
  }
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
  live2dHandle.playExpression(Math.floor(Math.random() * live2dHandle.expressions));
  showBubble("换了个表情");
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
  else if (action === "motion") randomMotion();
  else if (action === "expression") randomExpression();
  else if (action === "pat") {
    stage.classList.add("is-patting");
    showBubble("嘿嘿，摸头会害羞的");
  } else if (action === "feed") showBubble("好吃！再来一口");
  else if (action === "mini") void toggleMini();
  else if (action === "hide") void invoke("pet_hide");
  else if (action === "close") void invoke("pet_close");
});

window.addEventListener("storage", (event) => {
  if (event.key === "pet.state") try {
  const savedAuto = localStorage.getItem("pet.live2d.auto");
  if (savedAuto !== null) autoLive2D = savedAuto === "1";
} catch {
  /* 忽略 */
}

window.setInterval(() => {
  if (!live2dHandle || !autoLive2D || lastLive2DState.talking) return;
  const groups = live2dHandle.motions;
  if (groups.length === 0) return;
  const idle = groups.find((group) => /idle/i.test(group)) ?? groups[0];
  if (idle) live2dHandle.playMotion(idle);
  if (live2dHandle.expressions > 0 && Math.random() < 0.3) {
    live2dHandle.playExpression(Math.floor(Math.random() * live2dHandle.expressions));
  }
}, 12000);

applyState();
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
window.setInterval(applyState, 1200);
window.addEventListener("blur", hideMenu);

void invoke<boolean>("pet_get_mini")
  .then((value) => {
    mini = value;
    applyMiniClass();
  })
  .catch(() => undefined);

applyState();
