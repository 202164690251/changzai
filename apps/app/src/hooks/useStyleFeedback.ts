// 风格校准：默认关闭；只有用户主动评价时才记录，并进入下一轮 prompt
import { useCallback, useEffect, useMemo, useState } from "react";
import { styleCalibrationText, type StyleFeedback } from "@changzai/core";
import { api, isTauri } from "../lib/tauri.ts";

const ENABLED_KEY = "style.review.enabled";
const FEEDBACK_KEY = "style.feedback";

function parseFeedback(raw: string | null): StyleFeedback[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is StyleFeedback => {
      if (typeof item !== "object" || item === null) return false;
      const record = item as Record<string, unknown>;
      return typeof record.id === "string" && typeof record.text === "string" && typeof record.rating === "number";
    });
  } catch {
    return [];
  }
}

export interface StyleFeedbackApi {
  enabled: boolean;
  feedback: StyleFeedback[];
  calibration: string;
  setEnabled: (enabled: boolean) => void;
  add: (input: { messageId: string; text: string; rating: number; tags: string[]; correctedText?: string }) => void;
  clear: () => void;
}

export function useStyleFeedback(): StyleFeedbackApi {
  const [enabled, setEnabledState] = useState(false);
  const [feedback, setFeedback] = useState<StyleFeedback[]>([]);

  useEffect(() => {
    if (!isTauri()) return;
    let alive = true;
    void (async () => {
      try {
        const [enabledRaw, feedbackRaw] = await Promise.all([
          api.settingGet(ENABLED_KEY),
          api.settingGet(FEEDBACK_KEY),
        ]);
        if (!alive) return;
        setEnabledState(enabledRaw === "1");
        setFeedback(parseFeedback(feedbackRaw).slice(-200));
      } catch {
        /* 默认关闭 */
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const persist = useCallback((next: StyleFeedback[]) => {
    setFeedback(next);
    if (isTauri()) {
      void api.settingSet(FEEDBACK_KEY, JSON.stringify(next.slice(-200))).catch(() => undefined);
    }
  }, []);

  const setEnabled = useCallback((value: boolean) => {
    setEnabledState(value);
    if (isTauri()) {
      void api.settingSet(ENABLED_KEY, value ? "1" : "0").catch(() => undefined);
    }
  }, []);

  const add = useCallback(
    (input: { messageId: string; text: string; rating: number; tags: string[]; correctedText?: string }) => {
      const item: StyleFeedback = {
        id: `fb-${Date.now().toString(36)}`,
        messageId: input.messageId,
        text: input.text,
        rating: input.rating,
        tags: input.tags,
        correctedText: input.correctedText?.trim() || undefined,
        createdAt: Date.now(),
      };
      persist([...feedback, item]);
    },
    [feedback, persist],
  );

  const clear = useCallback(() => persist([]), [persist]);

  const calibration = useMemo(() => styleCalibrationText(feedback), [feedback]);

  return { enabled, feedback, calibration, setEnabled, add, clear };
}
