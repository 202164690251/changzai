// V2.1 TTS：合成音频；可只返回音频（语音气泡）或直接播放（朗读）
import { useCallback, useEffect, useRef, useState } from "react";
import { api, isTauri } from "../lib/tauri.ts";
import type { VoiceSettings } from "./useConversations.ts";

export interface SynthesizedVoice {
  dataUrl: string;
  durationSec: number;
}

export interface TtsApi {
  speaking: boolean;
  generating: boolean;
  error: string | null;
  synthesize: (text: string) => Promise<SynthesizedVoice | null>;
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

  const synthesize = useCallback(
    async (text: string): Promise<SynthesizedVoice | null> => {
      const value = text.trim();
      if (!value) return null;
      if (!isTauri()) {
        const message = "TTS 只在桌面版可用";
        setError(message);
        onError?.(message);
        return null;
      }
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
        return {
          dataUrl: `data:${result.mime};base64,${result.audioBase64}`,
          // 真实时长由 VoiceBubble 的音频元数据修正；这里只给一个近似值
          durationSec: Math.max(1, Math.round(value.length / 5)),
        };
      } catch (caught) {
        const message = caught instanceof Error ? caught.message : String(caught);
        setError(message);
        onError?.(`语音合成失败：${message}`);
        return null;
      } finally {
        setGenerating(false);
      }
    },
    [onError, settings],
  );

  const speak = useCallback(
    async (text: string): Promise<boolean> => {
      stop();
      const voice = await synthesize(text);
      if (!voice) return false;
      try {
        const audio = new Audio(voice.dataUrl);
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
        onError?.(`播放失败：${message}`);
        setSpeaking(false);
        return false;
      }
    },
    [onError, stop, synthesize],
  );

  const test = useCallback(() => speak("你来啦，我刚还在想你。"), [speak]);

  useEffect(() => () => stop(), [stop]);

  return { speaking, generating, error, synthesize, speak, stop, test };
}
