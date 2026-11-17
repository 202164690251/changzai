// Step 4/6 · 情绪状态读取/持久化 + 用户手动状态覆盖
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  DEFAULT_EMOTION,
  isMoodOverrideActive,
  type EmotionState,
  type MoodOverride,
} from "@changzai/core";
import { api, isTauri } from "../lib/tauri.ts";

const SETTING_KEY = "emotion.state";
const OVERRIDE_KEY = "emotion.override";

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

function isOverride(value: unknown): value is MoodOverride {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return isEmotionState(record.state) && typeof record.note === "string";
}

export interface EmotionApi {
  /** 自动计算的状态 */
  state: EmotionState;
  /** 用户手动覆盖生效时的状态；否则等于 state */
  effective: EmotionState;
  override: MoodOverride | null;
  moodNote: string;
  ready: boolean;
  update: (state: EmotionState) => void;
  setOverride: (state: EmotionState, note: string, until: number | null) => void;
  clearOverride: () => void;
  replace: (state: EmotionState, override: MoodOverride | null) => void;
}

export function useEmotion(): EmotionApi {
  const [state, setState] = useState<EmotionState>(DEFAULT_EMOTION);
  const [override, setOverrideState] = useState<MoodOverride | null>(null);
  const [ready, setReady] = useState(!isTauri());
  const [clock, setClock] = useState(0);

  useEffect(() => {
    if (!isTauri()) return;
    let alive = true;
    void (async () => {
      try {
        const [raw, overrideRaw] = await Promise.all([
          api.settingGet(SETTING_KEY),
          api.settingGet(OVERRIDE_KEY),
        ]);
        if (!alive) return;
        if (raw !== null) {
          const parsed: unknown = JSON.parse(raw);
          if (isEmotionState(parsed)) setState({ ...DEFAULT_EMOTION, ...parsed });
        }
        if (overrideRaw !== null) {
          const parsed: unknown = JSON.parse(overrideRaw);
          if (isOverride(parsed)) setOverrideState(parsed);
        }
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

  const replace = useCallback((next: EmotionState, nextOverride: MoodOverride | null) => {
    setState(next);
    setOverrideState(nextOverride);
    if (isTauri()) {
      void api.settingSet(SETTING_KEY, JSON.stringify(next)).catch(() => undefined);
      void api.settingSet(OVERRIDE_KEY, JSON.stringify(nextOverride)).catch(() => undefined);
    }
  }, []);

  const setOverride = useCallback((next: EmotionState, note: string, until: number | null) => {
    const value: MoodOverride = { state: next, note, until, updatedAt: Date.now() };
    setOverrideState(value);
    if (isTauri()) {
      void api.settingSet(OVERRIDE_KEY, JSON.stringify(value)).catch(() => undefined);
    }
  }, []);

  const clearOverride = useCallback(() => {
    setOverrideState(null);
    if (isTauri()) {
      void api.settingSet(OVERRIDE_KEY, JSON.stringify(null)).catch(() => undefined);
    }
  }, []);

  const activeOverride = useMemo(
    () => (isMoodOverrideActive(override) ? override : null),
    [override],
  );

  return {
    state,
    effective: activeOverride?.state ?? state,
    override: activeOverride,
    moodNote: activeOverride?.note?.trim() ?? "",
    ready,
    update,
    setOverride,
    clearOverride,
    replace,
  };
}
