import "./call.css";
import { api } from "./lib/tauri.ts";
import { LocalVideoAvatarProvider, type VideoAvatarSession } from "./lib/videoAvatar.ts";
import type { VoiceSettings } from "./hooks/useConversations.ts";

interface CallState {
  version?: number;
  name?: string;
  avatar?: string | null;
  petImage?: string | null;
  conversationId?: string | null;
  fallbackConversationId?: string | null;
  text?: string;
  voice?: VoiceSettings;
}

const DEFAULT_VOICE: VoiceSettings = {
  enabled: false,
  autoSpeak: false,
  voiceReplyChance: 30,
  provider: "windows",
  voice: "",
  rate: 0,
  baseUrl: "https://api.openai.com/v1",
  apiKey: "",
  model: "tts-1",
};

const root = document.getElementById("call-root") as HTMLElement;
const nameEl = document.getElementById("call-name") as HTMLElement;
const acceptName = document.getElementById("call-accept-name") as HTMLElement;
const host = document.getElementById("call-avatar") as HTMLElement;
const image = document.getElementById("call-image") as HTMLImageElement;
const fallback = document.getElementById("call-fallback") as HTMLElement;
const subtitle = document.getElementById("call-subtitle") as HTMLElement;
const accept = document.getElementById("call-accept") as HTMLElement;
const acceptButton = document.getElementById("call-accept-btn") as HTMLButtonElement;
const muteButton = document.getElementById("call-mute") as HTMLButtonElement;
const hangupButton = document.getElementById("call-hangup") as HTMLButtonElement;
const statusEl = document.getElementById("call-status") as HTMLElement;
const errorEl = document.getElementById("call-error") as HTMLElement;

function readCallState(): CallState {
  try {
    return JSON.parse(localStorage.getItem("call.state") ?? "{}") as CallState;
  } catch {
    return {};
  }
}

function showError(message: string): void {
  errorEl.textContent = message;
  errorEl.hidden = false;
}

let session: VideoAvatarSession | null = null;
let muted = false;
let accepted = false;

async function main(): Promise<void> {
  const state = readCallState();
  const name = state.name?.trim() || "ta";
  const text = state.text?.trim() || "你来啦，我刚还在想你。";
  const voice: VoiceSettings = { ...DEFAULT_VOICE, ...(state.voice ?? {}) };
  // OpenAI TTS 没填 Key 时回退 Windows 系统语音，保证视频通话至少能出声。
  if (voice.provider === "openai" && !voice.apiKey.trim()) {
    voice.provider = "windows";
    voice.voice = "";
    voice.model = "";
  }
  nameEl.textContent = name;
  acceptName.textContent = name;
  subtitle.textContent = text;
  subtitle.classList.add("is-visible");

  const provider = new LocalVideoAvatarProvider();
  try {
    session = await provider.start(
      {
        name,
        avatar: state.avatar ?? null,
        conversationId: state.conversationId ?? null,
        fallbackConversationId: state.fallbackConversationId ?? null,
        petImage: state.petImage ?? null,
        canvasSize: 420,
      },
      { host, image, fallback },
    );
    statusEl.textContent =
      session.kind === "live2d"
        ? "Live2D 已就绪 · 等待接通"
        : `头像已就绪 · 等待接通${session.warning ? `（${session.warning}）` : ""}`;
    if (session.warning) showError(session.warning);
  } catch (error) {
    showError(`形象加载失败：${error instanceof Error ? error.message : String(error)}`);
    fallback.textContent = name.slice(0, 1) || "ta";
    fallback.hidden = false;
    statusEl.textContent = "形象回退 · 等待接通";
  }

  acceptButton.addEventListener("click", () => {
    if (accepted) return;
    accepted = true;
    accept.hidden = true;
    statusEl.textContent = "正在接通…";
    void (async () => {
      if (!session) {
        showError("没有可用的虚拟形象，但仍可以挂断回聊天。");
        return;
      }
      try {
        await session.speak(text, voice);
        statusEl.textContent = "通话中 · 本地形象，不录像";
      } catch (error) {
        showError(`语音接通失败：${error instanceof Error ? error.message : String(error)}。可以继续看形象，或挂断回聊天。`);
        statusEl.textContent = "语音失败 · 仍可挂断";
      }
    })();
  });

  muteButton.addEventListener("click", () => {
    muted = !muted;
    session?.setMuted(muted);
    muteButton.textContent = muted ? "取消静音" : "静音";
    muteButton.classList.toggle("is-muted", muted);
  });

  hangupButton.addEventListener("click", () => {
    hangupButton.disabled = true;
    session?.stopAudio();
    void api
      .videoCallClose()
      .catch(() => undefined)
      .finally(() => window.close());
  });
}

window.addEventListener("beforeunload", () => {
  session?.destroy();
  session = null;
});

if (root) {
  void main();
}
