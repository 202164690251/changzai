// Step 4 · 本地漏斗埋点（T45）
// 只写本机 SQLCipher setting；不上传；可查看、可清空。
import { useCallback, useEffect, useState } from "react";
import { api, isTauri } from "../lib/tauri.ts";

export interface AnalyticsEvent {
  kind: string;
  ts: number;
}

const SETTING_KEY = "analytics.events";
const MAX_EVENTS = 2000;

export interface AnalyticsApi {
  events: AnalyticsEvent[];
  total: number;
  counts: Record<string, number>;
  log: (kind: string) => void;
  clear: () => void;
}

export function useAnalytics(): AnalyticsApi {
  const [events, setEvents] = useState<AnalyticsEvent[]>([]);

  useEffect(() => {
    if (!isTauri()) return;
    let alive = true;
    void (async () => {
      try {
        const raw = await api.settingGet(SETTING_KEY);
        if (!alive || raw === null) return;
        const parsed: unknown = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          setEvents(
            parsed
              .filter((item): item is AnalyticsEvent => {
                const record = item as Partial<AnalyticsEvent>;
                return typeof record.kind === "string" && typeof record.ts === "number";
              })
              .slice(-MAX_EVENTS),
          );
        }
      } catch {
        /* 无统计时从空开始 */
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const persist = useCallback((next: AnalyticsEvent[]) => {
    if (isTauri()) {
      void api.settingSet(SETTING_KEY, JSON.stringify(next)).catch(() => undefined);
    }
  }, []);

  const log = useCallback(
    (kind: string) => {
      setEvents((previous) => {
        const next = [...previous, { kind, ts: Date.now() }].slice(-MAX_EVENTS);
        persist(next);
        return next;
      });
    },
    [persist],
  );

  const clear = useCallback(() => {
    setEvents([]);
    persist([]);
  }, [persist]);

  const counts: Record<string, number> = {};
  for (const event of events) counts[event.kind] = (counts[event.kind] ?? 0) + 1;

  return { events, total: events.length, counts, log, clear };
}
