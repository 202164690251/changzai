// V2.1 TTS 播放：调用 Rust 合成音频，前端用 Audio 播放；不改聊天记录
import { useCallback, useEffect, useRef, useState } from "react";
import { api, isTauri } from "../lib/tauri.ts";
import type { VoiceSettings } from "./useConversations.ts";

export interface TtsApi {
  speaking: boolean;
  generating: boolean;
  error: string | null;
  speak: (text: string) => Promise<boolean>;
  stop: () => void;
  test: () => Promise<boolean>;
}

export function useTts(settings: VoiceSettings, onError?: (message: string) => void): TtsApi {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [speaking, setSpeaking] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const stop = useCallback(() => {
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.src = "";
    }
    audioRef.current = null;
    setSpeaking(false);
  }, []);

  const speak = useCallback(
    async (text: string): Promise<boolean> => {
      const value = text.trim();
      if (!value) return false;
      if (!isTauri()) {
        const message = "TTS 只在桌面版可用";
        setError(message);
        onError?.(message);
        return false;
      }
      stop();
      setGenerating(true);
      setError(null);
      try {
        const result = await api.ttsSpeak({
          text: value,
          provider: settings.provider,
          voice: settings.voice,
          rate: settings.rate,
          baseUrl: settings.baseUrl,
          apiKey: settings.apiKey,
          model: settings.model,
        });
        const audio = new Audio(`data:${result.mime};base64,${result.audioBase64}`);
        audioRef.current = audio;
        audio.addEventListener("ended", () => setSpeaking(false));
        audio.addEventListener("pause", () => setSpeaking(false));
        audio.addEventListener("error", () => setSpeaking(false));
        await audio.play();
        setSpeaking(true);
        return true;
      } catch (caught) {
        const message = caught instanceof Error ? caught.message : String(caught);
        setError(message);
        onError?.(`朗读失败：${message}`);
        setSpeaking(false);
        return false;
      } finally {
        setGenerating(false);
      }
    },
    [onError, settings, stop],
  );

  const test = useCallback(
    () => speak("你来啦，我刚还在想你。"),
    [speak],
  );

  useEffect(() => () => stop(), [stop]);

  return { speaking, generating, error, speak, stop, test };
}
