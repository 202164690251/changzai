// Step 4 · 情绪状态读取/持久化（SQLCipher setting 表）
import { useCallback, useEffect, useState } from "react";
import { DEFAULT_EMOTION, type EmotionState } from "@changzai/core";
import { api, isTauri } from "../lib/tauri.ts";

const SETTING_KEY = "emotion.state";

function isEmotionState(value: unknown): value is EmotionState {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.valence === "number" &&
    typeof record.arousal === "number" &&
    typeof record.closeness === "number" &&
    typeof record.defensiveness === "number" &&
    typeof record.updated_at === "number"
  );
}

export interface EmotionApi {
  state: EmotionState;
  ready: boolean;
  update: (state: EmotionState) => void;
}

export function useEmotion(): EmotionApi {
  const [state, setState] = useState<EmotionState>(DEFAULT_EMOTION);
  const [ready, setReady] = useState(!isTauri());

  useEffect(() => {
    if (!isTauri()) return;
    let alive = true;
    void (async () => {
      try {
        const raw = await api.settingGet(SETTING_KEY);
        if (!alive || raw === null) return;
        const parsed: unknown = JSON.parse(raw);
        if (isEmotionState(parsed)) setState({ ...DEFAULT_EMOTION, ...parsed });
      } catch {
        /* 无状态时用默认值 */
      } finally {
        if (alive) setReady(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const update = useCallback((next: EmotionState) => {
    setState(next);
    if (isTauri()) {
      void api.settingSet(SETTING_KEY, JSON.stringify(next)).catch(() => undefined);
    }
  }, []);

  return { state, ready, update };
}
