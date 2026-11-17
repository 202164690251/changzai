// 关系卡：启动时从聊天记录本地总结一次；之后由用户编辑
import { useCallback, useEffect, useRef, useState } from "react";
import { deriveRelationshipProfile, type RelationshipProfile, type RelationshipSourceMessage } from "@changzai/core";
import { api, isTauri, type ImportMessageRow } from "../lib/tauri.ts";

const SETTING_KEY = "relationship.profile";

function isRelationshipProfile(value: unknown): value is RelationshipProfile {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return record.version === 1 && typeof record.summary === "string" && typeof record.type === "string";
}

function rowToSource(row: ImportMessageRow): RelationshipSourceMessage {
  return {
    ts: row.ts,
    sender: row.sender as RelationshipSourceMessage["sender"],
    type: row.type as RelationshipSourceMessage["type"],
    content: row.content,
    is_holdout: row.isHoldout === 1 ? 1 : 0,
  };
}

export interface RelationshipApi {
  profile: RelationshipProfile | null;
  ready: boolean;
  busy: boolean;
  message: string | null;
  save: (profile: RelationshipProfile) => Promise<void>;
  rebuild: () => Promise<void>;
  replace: (profile: RelationshipProfile) => void;
}

export function useRelationship(herName: string, meName: string, dbReady = true): RelationshipApi {
  const [profile, setProfile] = useState<RelationshipProfile | null>(null);
  const [ready, setReady] = useState(!isTauri());
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const attempted = useRef(false);

  useEffect(() => {
    if (!isTauri()) return;
    let alive = true;
    void (async () => {
      try {
        const raw = await api.settingGet(SETTING_KEY);
        if (alive && raw) {
          const parsed: unknown = JSON.parse(raw);
          if (isRelationshipProfile(parsed)) setProfile(parsed);
        }
      } catch {
        /* 没有关系卡时等待重新生成 */
      } finally {
        if (alive) setReady(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const replace = useCallback((next: RelationshipProfile) => {
    setProfile(next);
    if (isTauri()) void api.settingSet(SETTING_KEY, JSON.stringify(next)).catch(() => undefined);
  }, []);

  const save = useCallback(async (next: RelationshipProfile): Promise<void> => {
    setProfile(next);
    try {
      await api.settingSet(SETTING_KEY, JSON.stringify(next));
      setMessage("关系卡已保存，下一轮对话生效。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "关系卡保存失败");
    }
  }, []);

  const rebuild = useCallback(async (): Promise<void> => {
    if (!isTauri()) return;
    setBusy(true);
    setMessage("正在从聊天记录整理关系与称呼…");
    try {
      const rows = await api.messagesLoad(50_000);
      if (rows.length === 0) {
        setMessage("还没有导入聊天记录，无法生成关系卡。");
        return;
      }
      const next = deriveRelationshipProfile(rows.map(rowToSource), {
        herName,
        meName,
        now: Date.now(),
      });
      await save(next);
      setMessage(`关系卡已生成：${next.type}；她叫你「${next.herNicknameForUser}」。可继续手动修改。`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "关系卡生成失败");
    } finally {
      setBusy(false);
    }
  }, [herName, meName, save]);

  // 首次：没有关系卡时自动从库里总结一次，不额外调用模型
  useEffect(() => {
    if (!dbReady || !ready || profile !== null || busy || attempted.current) return;
    attempted.current = true;
    void rebuild();
  }, [busy, dbReady, profile, ready, rebuild]);

  return { profile, ready, busy, message, save, rebuild, replace };
}
