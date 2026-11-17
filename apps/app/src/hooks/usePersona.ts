// Step 3 · 人格卡：读取/生成/重建
import { useCallback, useEffect, useState } from "react";
import {
  buildPersonaProfile,
  type PersonaProfile,
  type PersonaSourceMessage,
} from "@changzai/core";
import { api, isTauri, type ImportMessageRow } from "../lib/tauri.ts";

export interface PersonaApi {
  profile: PersonaProfile | null;
  ready: boolean;
  busy: boolean;
  message: string | null;
  /** 导入完成后，用本次解析出的消息生成并保存 */
  buildFromImport: (messages: PersonaSourceMessage[]) => Promise<void>;
  /** 从数据库已有消息重建（设置页手动触发） */
  rebuildFromDb: () => Promise<void>;
  /** 审阅：保存编辑后的事实列表 */
  updateFacts: (facts: PersonaProfile["facts"]) => Promise<void>;
  historyCount: number;
  rollback: () => Promise<void>;
}

function isPersonaProfile(value: unknown): value is PersonaProfile {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return record.version === 1 && typeof record.summary === "string" && typeof record.style === "object";
}

function rowToSource(row: ImportMessageRow): PersonaSourceMessage {
  return {
    ts: row.ts,
    sender: row.sender as PersonaSourceMessage["sender"],
    type: row.type as PersonaSourceMessage["type"],
    content: row.content,
    is_holdout: row.isHoldout === 1 ? 1 : 0,
    conv_id: row.convId,
  };
}

export function usePersona(): PersonaApi {
  const [profile, setProfile] = useState<PersonaProfile | null>(null);
  const [ready, setReady] = useState(!isTauri());
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [history, setHistory] = useState<PersonaProfile[]>([]);

  useEffect(() => {
    if (!isTauri()) return;
    let alive = true;
    void (async () => {
      try {
        const raw = await api.personaLoad();
        if (alive && isPersonaProfile(raw)) setProfile(raw);
        const historyRaw = await api.settingGet("persona.history");
        if (alive && historyRaw !== null) {
          const parsed: unknown = JSON.parse(historyRaw);
          if (Array.isArray(parsed)) {
            setHistory(parsed.filter(isPersonaProfile).slice(-10));
          }
        }
      } catch {
        /* 没有/损坏时保持 null */
      } finally {
        if (alive) setReady(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const persist = useCallback(async (next: PersonaProfile): Promise<void> => {
    if (profile !== null) {
      const previousHistory = [...history, profile].slice(-10);
      setHistory(previousHistory);
      if (isTauri()) {
        void api.settingSet("persona.history", JSON.stringify(previousHistory)).catch(() => undefined);
      }
    }
    setProfile(next);
    try {
      await api.personaSave(next);
      setMessage(null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "人格卡保存失败");
    }
  }, [history, profile]);

  const buildFromImport = useCallback(
    async (messages: PersonaSourceMessage[]): Promise<void> => {
      if (messages.length === 0) return;
      setBusy(true);
      try {
        const next = buildPersonaProfile(messages, { now: Date.now() });
        await persist(next);
      } finally {
        setBusy(false);
      }
    },
    [persist],
  );

  const rebuildFromDb = useCallback(async (): Promise<void> => {
    if (!isTauri()) return;
    setBusy(true);
    setMessage("正在读取消息并重建人格卡…");
    try {
      const rows = await api.messagesLoad(50_000);
      if (rows.length === 0) {
        setMessage("数据库里还没有消息，请先导入聊天记录");
        return;
      }
      const next = buildPersonaProfile(rows.map(rowToSource), { now: Date.now() });
      await persist(next);
      setMessage(`人格卡已重建：${next.source.her_messages} 条 ta 的消息`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "重建失败");
    } finally {
      setBusy(false);
    }
  }, [persist]);

  const updateFacts = useCallback(
    async (facts: PersonaProfile["facts"]): Promise<void> => {
      if (profile === null) return;
      await persist({ ...profile, facts, built_at: Date.now() });
      setMessage("人格卡事实已保存；下一轮生效。");
    },
    [persist, profile],
  );

  const rollback = useCallback(async (): Promise<void> => {
    const previous = history[history.length - 1];
    if (!previous) {
      setMessage("没有可回滚的历史版本");
      return;
    }
    setHistory(history.slice(0, -1));
    setProfile(previous);
    try {
      await api.personaSave(previous);
      if (isTauri()) {
        void api.settingSet("persona.history", JSON.stringify(history.slice(0, -1))).catch(() => undefined);
      }
      setMessage("已回滚到上一版人格卡");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "回滚失败");
    }
  }, [history]);

  return { profile, ready, busy, message, buildFromImport, rebuildFromDb, updateFacts, historyCount: history.length, rollback };
}
