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

if (!root || !stage || !image || !fallback || !nameEl || !statusEl || !bubble || !menu || !form || !input || !mic || !quick || !panel || !live2dHost) {
  throw new Error("PET_DOM_MISSING");
}

const LINES = ["在呢", "怎么啦？", "我在这儿", "嗯？", "想我啦？", "来啦来啦"];
let lastTs = 0;
let bubbleTimer: number | null = null;
let menuOpen = false;
let mini = false;
let chatOpen = false;
let live2dHandle: { destroy: () => void; resize: () => void } | null = null;
let live2dId: string | null = null;
let live2dChecked: string | null = null;
let live2dLoading = false;

async function syncLive2D(state: PetState): Promise<void> {
  const id = state.id;
  if (!id || id === live2dChecked || live2dLoading) return;
  live2dLoading = true;
  live2dHandle?.destroy();
  live2dHandle = null;
  live2dHost.hidden = true;
  try {
    const module = await import("./lib/live2d.ts");
    const handle = await module.mountLive2D(live2dHost, id);
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
    }
  } catch {
    live2dChecked = id;
    live2dId = null;
    live2dHost.hidden = true;
    stage.classList.remove("has-live2d");
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

function applyState(): void {
  const state = readState();
  const name = state.name?.trim() || "ta";
  nameEl.textContent = name;
  fallback.textContent = name.slice(0, 1);
  updateStatus(state);
  if (state.avatar) {
    image.src = state.avatar;
    image.hidden = live2dId !== null;
    fallback.hidden = true;
  } else {
    image.hidden = true;
    fallback.hidden = live2dId !== null;
  }
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

menu.addEventListener("click", (event) => {
  const target = (event.target as HTMLElement).closest<HTMLButtonElement>("button");
  const action = target?.dataset.action;
  hideMenu();
  if (action === "chat") void invoke("pet_open_main");
  else if (action === "pat") {
    stage.classList.add("is-patting");
    showBubble("嘿嘿，摸头会害羞的");
  } else if (action === "feed") showBubble("好吃！再来一口");
  else if (action === "mini") void toggleMini();
  else if (action === "hide") void invoke("pet_hide");
  else if (action === "close") void invoke("pet_close");
});

window.addEventListener("storage", (event) => {
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
window.setInterval(applyState, 1200);
window.addEventListener("blur", hideMenu);

void invoke<boolean>("pet_get_mini")
  .then((value) => {
    mini = value;
    applyMiniClass();
  })
  .catch(() => undefined);

applyState();
