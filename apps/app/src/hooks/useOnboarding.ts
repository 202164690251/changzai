// Step 6 · 首次引导完成状态（本机 setting）
import { useCallback, useEffect, useState } from "react";
import { api, isTauri } from "../lib/tauri.ts";

const SETTING_KEY = "onboarding.done";

export interface OnboardingApi {
  ready: boolean;
  done: boolean;
  complete: () => void;
  reset: () => void;
}

export function useOnboarding(): OnboardingApi {
  const [ready, setReady] = useState(!isTauri());
  const [done, setDone] = useState(!isTauri());

  useEffect(() => {
    if (!isTauri()) return;
    let alive = true;
    void (async () => {
      try {
        const raw = await api.settingGet(SETTING_KEY);
        if (alive) setDone(raw === "1");
      } catch {
        /* 没有则视为未完成 */
      } finally {
        if (alive) setReady(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const write = useCallback((value: boolean) => {
    setDone(value);
    if (isTauri()) {
      void api.settingSet(SETTING_KEY, value ? "1" : "0").catch(() => undefined);
    }
  }, []);

  return { ready, done, complete: () => write(true), reset: () => write(false) };
}
