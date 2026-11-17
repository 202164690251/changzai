// Step 6 · 启动 PIN（v0：UI 锁 + Argon2id 校验；不改变 DB 密钥）
import { useCallback, useEffect, useState } from "react";
import { api, isTauri } from "../lib/tauri.ts";

export interface PinApi {
  ready: boolean;
  enabled: boolean;
  locked: boolean;
  error: string | null;
  unlock: (pin: string) => Promise<boolean>;
  setPin: (pin: string) => Promise<boolean>;
  disable: (pin: string) => Promise<boolean>;
  lock: () => void;
}

export function usePin(): PinApi {
  const [ready, setReady] = useState(!isTauri());
  const [enabled, setEnabled] = useState(false);
  const [locked, setLocked] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isTauri()) return;
    let alive = true;
    void (async () => {
      try {
        const has = await api.pinEnabled();
        if (alive) {
          setEnabled(has);
          setLocked(has);
        }
      } catch {
        /* 无 PIN */
      } finally {
        if (alive) setReady(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const unlock = useCallback(async (pin: string) => {
    try {
      const ok = await api.pinVerify(pin);
      if (ok) {
        setLocked(false);
        setError(null);
      } else {
        setError("PIN 不对");
      }
      return ok;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return false;
    }
  }, []);

  const setPin = useCallback(async (pin: string) => {
    try {
      const ok = await api.pinSet(pin);
      if (ok) {
        setEnabled(true);
        setLocked(false);
        setError(null);
      }
      return ok;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return false;
    }
  }, []);

  const disable = useCallback(async (pin: string) => {
    try {
      const ok = await api.pinDisable(pin);
      if (ok) {
        setEnabled(false);
        setLocked(false);
        setError(null);
      } else {
        setError("PIN 不对");
      }
      return ok;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return false;
    }
  }, []);

  return { ready, enabled, locked, error, unlock, setPin, disable, lock: () => setLocked(true) };
}
