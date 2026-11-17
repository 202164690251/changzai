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

  useEffect(() => {
    if (!isTauri()) return;
    let alive = true;
    void (async () => {
      try {
        const raw = await api.personaLoad();
        if (alive && isPersonaProfile(raw)) setProfile(raw);
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
    setProfile(next);
    try {
      await api.personaSave(next);
      setMessage(null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "人格卡保存失败");
    }
  }, []);

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

  return { profile, ready, busy, message, buildFromImport, rebuildFromDb };
}
