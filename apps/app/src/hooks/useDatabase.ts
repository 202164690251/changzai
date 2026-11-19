// Step 2：数据库初始化与状态（SQLCipher + DDL 由 core 提供唯一事实源）
import { useCallback, useEffect, useState } from "react";
import { DDL_V2 } from "@veyrimi/core";
import { api, isTauri, type DbStats } from "../lib/tauri.ts";

export interface DatabaseApi {
  ready: boolean;
  error: string | null;
  stats: DbStats | null;
  refresh: () => Promise<void>;
}

export function useDatabase(): DatabaseApi {
  const [ready, setReady] = useState<boolean>(!isTauri());
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<DbStats | null>(null);

  useEffect(() => {
    if (!isTauri()) return;
    let cancelled = false;
    void (async () => {
      try {
        const init = await api.dbInit(DDL_V2);
        if (cancelled) return;
        if (!init.ok) {
          setError(init.error ?? "数据库初始化失败");
          return;
        }
        setReady(true);
        const next = await api.dbStats();
        if (!cancelled) setStats(next);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const refresh = useCallback(async () => {
    if (!isTauri()) return;
    try {
      setStats(await api.dbStats());
    } catch {
      /* 状态刷新失败不影响主流程 */
    }
  }, []);

  return { ready, error, stats, refresh };
}
