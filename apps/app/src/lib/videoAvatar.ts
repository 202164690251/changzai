// V2.4 虚拟形象视频：Provider 端口 + 本地 Live2D/图片实现。
// 当前只做“虚拟形象视频”，不采集摄像头、不录像、不保存视频。
import { api } from "./tauri.ts";
import { mountLive2D, type Live2DHandle } from "./live2d.ts";
import type { VoiceSettings } from "../hooks/useConversations.ts";

export interface VideoAvatarConfig {
  name: string;
  avatar: string | null;
  conversationId: string | null;
  fallbackConversationId?: string | null;
  petImage?: string | null;
  canvasSize?: number;
}

export interface VideoAvatarElements {
  host: HTMLElement;
  image: HTMLImageElement;
  fallback: HTMLElement;
}

export interface VideoAvatarSession {
  readonly kind: "live2d" | "image";
  warning?: string;
  speak(text: string, voice: VoiceSettings): Promise<void>;
  setMuted(muted: boolean): void;
  stopAudio(): void;
  destroy(): void;
}

export interface VideoAvatarProvider {
  readonly kind: "live2d" | "image" | "vrm";
  start(config: VideoAvatarConfig, elements: VideoAvatarElements): Promise<VideoAvatarSession>;
}

/** 本地虚拟形象：优先当前聊天的 Live2D，失败则回退头像/名字首字。 */
export class LocalVideoAvatarProvider implements VideoAvatarProvider {
  readonly kind = "live2d" as const;

  async start(config: VideoAvatarConfig, elements: VideoAvatarElements): Promise<VideoAvatarSession> {
    let live2d: Live2DHandle | null = null;
    let loadError: string | null = null;
    const ids = [...new Set([config.conversationId, config.fallbackConversationId].filter(Boolean))] as string[];
    for (const id of ids) {
      try {
        live2d = await mountLive2D(elements.host, id, config.canvasSize ?? 420);
        if (live2d) break;
      } catch (error) {
        loadError = error instanceof Error ? error.message : String(error);
      }
    }
    if (live2d) {
      elements.host.hidden = false;
      elements.image.hidden = true;
      elements.fallback.hidden = true;
    } else {
      elements.host.hidden = true;
      const fallbackImage = config.petImage || config.avatar;
      if (fallbackImage) {
        elements.image.src = fallbackImage;
        elements.image.hidden = false;
        elements.fallback.hidden = true;
      } else {
        elements.image.hidden = true;
        elements.fallback.textContent = config.name.slice(0, 1) || "ta";
        elements.fallback.hidden = false;
      }
    }

    let audio: HTMLAudioElement | null = null;
    let context: AudioContext | null = null;
    let analyser: AnalyserNode | null = null;
    let timer: number | null = null;

    const stopMouth = (): void => {
      if (timer !== null) {
        window.clearInterval(timer);
        timer = null;
      }
      live2d?.setTalking(false);
      live2d?.setMouthLevel(0);
    };

    const session: VideoAvatarSession = {
      kind: live2d ? "live2d" : "image",
      warning: live2d
        ? undefined
        : loadError
          ? `Live2D 加载失败，已回退图片：${loadError}`
          : "当前聊天没有可用的 Live2D 模型，已回退图片",
      async speak(text: string, voice: VoiceSettings): Promise<void> {
        session.stopAudio();
        const result = await api.ttsSpeak({
          text,
          provider: voice.provider,
          voice: voice.voice,
          rate: voice.rate,
          baseUrl: voice.baseUrl,
          apiKey: voice.apiKey,
          model: voice.model,
        });
        const next = new Audio(`data:${result.mime};base64,${result.audioBase64}`);
        audio = next;
        try {
          context = new AudioContext();
          analyser = context.createAnalyser();
          analyser.fftSize = 256;
          const source = context.createMediaElementSource(next);
          source.connect(analyser);
          analyser.connect(context.destination);
        } catch {
          context = null;
          analyser = null;
        }
        live2d?.setTalking(true);
        timer = window.setInterval(() => {
          if (!analyser || !live2d) return;
          const data = new Uint8Array(analyser.fftSize);
          analyser.getByteTimeDomainData(data);
          let sum = 0;
          for (const value of data) {
            const centered = (value - 128) / 128;
            sum += centered * centered;
          }
          live2d.setMouthLevel(Math.min(1, Math.sqrt(sum / data.length) * 3.2));
        }, 80);
        next.addEventListener("ended", stopMouth);
        next.addEventListener("pause", stopMouth);
        await next.play();
      },
      setMuted(muted: boolean): void {
        if (audio) audio.muted = muted;
        if (muted) stopMouth();
        else if (live2d && audio && !audio.paused) live2d.setTalking(true);
      },
      stopAudio(): void {
        if (audio) {
          audio.pause();
          audio.src = "";
          audio = null;
        }
        stopMouth();
        if (context) {
          void context.close().catch(() => undefined);
          context = null;
        }
        analyser = null;
      },
      destroy(): void {
        this.stopAudio();
        live2d?.destroy();
        live2d = null;
      },
    };
    return session;
  }
}
