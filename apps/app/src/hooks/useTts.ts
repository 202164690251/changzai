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
  /** 当前播放音量包络 0–1，用于 Live2D 口型 */
  getLevel: () => number;
  test: () => Promise<boolean>;
}

export function useTts(settings: VoiceSettings, onError?: (message: string) => void): TtsApi {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const [speaking, setSpeaking] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const closeAudio = useCallback(() => {
    analyserRef.current = null;
    if (audioContextRef.current) {
      void audioContextRef.current.close().catch(() => undefined);
      audioContextRef.current = null;
    }
  }, []);

  const stop = useCallback(() => {
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.src = "";
    }
    audioRef.current = null;
    closeAudio();
    setSpeaking(false);
  }, [closeAudio]);

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
        try {
          const context = new AudioContext();
          const analyser = context.createAnalyser();
          analyser.fftSize = 256;
          const source = context.createMediaElementSource(audio);
          source.connect(analyser);
          analyser.connect(context.destination);
          audioContextRef.current = context;
          analyserRef.current = analyser;
        } catch {
          // WebAudio 不可用时仍用普通 Audio 播放，口型回退正弦
        }
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

  const getLevel = useCallback((): number => {
    const analyser = analyserRef.current;
    if (!analyser) return 0;
    const data = new Uint8Array(analyser.fftSize);
    analyser.getByteTimeDomainData(data);
    let sum = 0;
    for (const value of data) {
      const centered = (value - 128) / 128;
      sum += centered * centered;
    }
    const rms = Math.sqrt(sum / data.length);
    return Math.min(1, rms * 3.2);
  }, []);

  const test = useCallback(() => speak("你来啦，我刚还在想你。"), [speak]);

  useEffect(() => () => stop(), [stop]);

  return { speaking, generating, error, synthesize, speak, stop, getLevel, test };
}
