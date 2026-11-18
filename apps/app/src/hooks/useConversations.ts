// 多会话：每个聊天有独立人格/关系/标题；消息按 payload.convId 归档
import { useCallback, useEffect, useRef, useState } from "react";
import type { EmotionState, MoodOverride, PersonaProfile, ProactiveState, RelationshipProfile, StyleFeedback } from "@changzai/core";
import type { LlmConfig } from "../lib/tauri.ts";
import { api, isTauri } from "../lib/tauri.ts";

const STORE_KEY = "conversations.v1";
const ACTIVE_KEY = "conversations.active";

export type TtsProvider = "windows" | "openai";

export interface VoiceSettings {
  enabled: boolean;
  autoSpeak: boolean;
  /** ta 用语音气泡回复的概率 0–100 */
  voiceReplyChance: number;
  provider: TtsProvider;
  voice: string;
  rate: number;
  baseUrl: string;
  apiKey: string;
  model: string;
}

export const DEFAULT_VOICE_SETTINGS: VoiceSettings = {
  enabled: false,
  autoSpeak: false,
  voiceReplyChance: 30,
  provider: "windows",
  voice: "",
  rate: 0,
  baseUrl: "https://api.openai.com/v1",
  apiKey: "",
  model: "tts-1",
};

export interface ConversationSettings {
  llm: LlmConfig;
  proactive: ProactiveState;
  emotion: EmotionState;
  emotionOverride: MoodOverride | null;
  styleReviewEnabled: boolean;
  styleFeedback: StyleFeedback[];
  /** V2.1：每个聊天独立的 TTS 设置；旧记录可为空 */
  voice?: VoiceSettings;
}

export interface ConversationRecord {
  id: string;
  title: string;
  herName: string;
  herAvatar: string | null;
  /** 桌宠专用图片；空则使用 herAvatar */
  petImage?: string | null;
  persona: PersonaProfile;
  relationship: RelationshipProfile;
  /** 每个聊天独立：模型/主动消息/情绪/风格校准 */
  settings?: ConversationSettings;
  greeting: string;
  lastPreview?: string;
  lastMessageAt?: number;
  createdAt: number;
  updatedAt: number;
}

export function isConversationRecord(value: unknown): value is ConversationRecord {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.id === "string" &&
    typeof record.title === "string" &&
    typeof record.herName === "string" &&
    typeof record.persona === "object" &&
    record.persona !== null &&
    typeof record.relationship === "object" &&
    record.relationship !== null
  );
}

function persist(items: ConversationRecord[]): void {
  if (!isTauri()) return;
  void api.settingSet(STORE_KEY, JSON.stringify(items)).catch(() => undefined);
}

function persistActive(id: string | null): void {
  if (!isTauri()) return;
  void api.settingSet(ACTIVE_KEY, id ?? "").catch(() => undefined);
}

export interface ConversationsApi {
  items: ConversationRecord[];
  activeId: string | null;
  active: ConversationRecord | null;
  ready: boolean;
  upsert: (record: ConversationRecord) => void;
  update: (id: string, patch: Partial<ConversationRecord>) => void;
  remove: (id: string) => void;
  setActive: (id: string | null) => void;
}

export function useConversations(dbReady: boolean): ConversationsApi {
  const [items, setItems] = useState<ConversationRecord[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [ready, setReady] = useState(!isTauri());
  const writeTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!isTauri() || !dbReady) return;
    let alive = true;
    void (async () => {
      try {
        const [raw, activeRaw] = await Promise.all([api.settingGet(STORE_KEY), api.settingGet(ACTIVE_KEY)]);
        if (!alive) return;
        const parsed: unknown = raw ? JSON.parse(raw) : [];
        const list = Array.isArray(parsed) ? parsed.filter(isConversationRecord) : [];
        setItems(list);
        const wanted = activeRaw && list.some((item) => item.id === activeRaw) ? activeRaw : list[0]?.id ?? null;
        setActiveId(wanted);
      } catch {
        /* 首次没有会话 */
      } finally {
        if (alive) setReady(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, [dbReady]);

  const upsert = useCallback((record: ConversationRecord) => {
    setItems((previous) => {
      const exists = previous.some((item) => item.id === record.id);
      const next = exists ? previous.map((item) => (item.id === record.id ? record : item)) : [...previous, record];
      persist(next);
      return next;
    });
  }, []);

  const schedulePersist = useCallback((next: ConversationRecord[]) => {
    if (!isTauri()) return;
    if (writeTimerRef.current !== null) window.clearTimeout(writeTimerRef.current);
    writeTimerRef.current = window.setTimeout(() => {
      writeTimerRef.current = null;
      persist(next);
    }, 300);
  }, []);

  const update = useCallback((id: string, patch: Partial<ConversationRecord>) => {
    setItems((previous) => {
      const next = previous.map((item) =>
        item.id === id ? { ...item, ...patch, updatedAt: Date.now() } : item,
      );
      schedulePersist(next);
      return next;
    });
  }, [schedulePersist]);

  const remove = useCallback((id: string) => {
    setItems((previous) => {
      const next = previous.filter((item) => item.id !== id);
      persist(next);
      return next;
    });
    setActiveId((current) => (current === id ? null : current));
  }, []);

  const select = useCallback((id: string | null) => {
    setActiveId(id);
    persistActive(id);
  }, []);

  // activeId 变化时持久化，避免刷新后回到第一个会话
  useEffect(() => {
    if (ready) persistActive(activeId);
  }, [activeId, ready]);

  const active = items.find((item) => item.id === activeId) ?? null;
  useEffect(() => () => {
    if (writeTimerRef.current !== null) window.clearTimeout(writeTimerRef.current);
  }, []);

  return { items, activeId, active, ready, upsert, update, remove, setActive: select };
}
