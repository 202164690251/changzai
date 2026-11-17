import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  applyStimulus,
  assessAndDecide,
  buildComposedMessages,
  canRecall,
  classifyStimulus,
  decideReply,
  decayEmotion,
  determineScene,
  detectOpenLoops,
  filterAiFlavor,
  qualityIssues,
  softenWeirdText,
  guardUserMessage,
  planArc,
  recallLast,
  recordRecall,
  retrieveMemories,
  splitSegments,
  DEFAULT_RECALL_BUDGET,
  type EmotionState,
  type MemoryCandidate,
  type PersonaProfile,
  type RelationshipProfile,
} from "@changzai/core";
import { DEMO_VOICE_SECONDS, demoImageDataUrl, demoVoiceDataUrl } from "../lib/demoMedia.ts";
import { formatTimeDivider } from "../lib/time.ts";
import { api, isTauri, type ImportedMediaFile, type LlmConfig } from "../lib/tauri.ts";

export type ChatSender = "her" | "me";

export interface TextMessage {
  id: string;
  from: ChatSender | "system";
  kind: "text";
  text: string;
  ts: number;
}

export interface ImageMessage {
  id: string;
  from: ChatSender;
  kind: "image";
  dataUrl: string;
  name?: string;
  ts: number;
}

export interface VoiceMessage {
  id: string;
  from: ChatSender;
  kind: "voice";
  dataUrl: string;
  durationSec: number;
  ts: number;
}

export type ChatMsg = TextMessage | ImageMessage | VoiceMessage;

/** 演示对话的起止时间：2023-05-20 14:03（本地时区）。 */
const DEMO_START = new Date(2023, 4, 20, 14, 3, 0).getTime();

const DEMO_REPLIES = ["嗯", "我在", "刚看到", "怎么了", "好"];

function at(offsetMinutes: number, offsetSeconds = 0): number {
  return DEMO_START + offsetMinutes * 60_000 + offsetSeconds * 1_000;
}

function seedMessages(): ChatMsg[] {
  return [
    { id: "seed-1", from: "me", kind: "text", text: "在干嘛", ts: at(0) },
    { id: "seed-2", from: "her", kind: "text", text: "刚洗完澡", ts: at(0, 40) },
    { id: "seed-3", from: "her", kind: "image", dataUrl: demoImageDataUrl(), name: "那天的窗户", ts: at(1, 10) },
    { id: "seed-4", from: "her", kind: "text", text: "你呢", ts: at(1, 50) },
    { id: "seed-5", from: "me", kind: "text", text: "没事 就是有点想你了", ts: at(2, 30) },
    { id: "seed-6", from: "her", kind: "text", text: "嗯", ts: at(3, 5) },
    {
      id: "seed-7",
      from: "her",
      kind: "voice",
      dataUrl: demoVoiceDataUrl(),
      durationSec: DEMO_VOICE_SECONDS,
      ts: at(3, 30),
    },
    { id: "seed-8", from: "her", kind: "text", text: "早点睡吧", ts: at(4) },
  ];
}

export function messagePreview(message: ChatMsg | undefined): string {
  if (!message) return "还没有开始";
  if (message.kind === "text") return message.text;
  if (message.kind === "image") return "[图片]";
  return "[语音]";
}

export function lastMessageOf(messages: ChatMsg[]): ChatMsg | undefined {
  return messages.length > 0 ? messages[messages.length - 1] : undefined;
}

export interface ChatOptions {
  persona: PersonaProfile | null;
  llm: LlmConfig | null;
  herName: string;
  meName: string;
  /** Step 4：当前情绪状态（由 useEmotion 持久化） */
  emotion: EmotionState;
  onEmotion: (state: EmotionState) => void;
  dbReady?: boolean;
  /** 当前会话 id；消息 payload 里也会带 convId */
  conversationId?: string;
  relationship?: RelationshipProfile | null;
  styleCalibration?: string;
  moodNote?: string;
  /** 无法回复 / 配置缺失时的提示 */
  onNotice?: (text: string) => void;
}

export interface ChatApi {
  messages: ChatMsg[];
  typing: boolean;
  unread: number;
  sendText: (text: string) => void;
  sendImage: (dataUrl: string, name?: string) => void;
  appendImported: (files: ImportedMediaFile[]) => void;
  appendProactive: (text: string) => void;
  resetToGreeting: (text: string) => Promise<void>;
  recallLastMessage: () => boolean;
  deleteMessage: (id: string) => void;
  clear: () => void;
  markRead: () => void;
}

function llmUsable(llm: LlmConfig | null): boolean {
  if (!llm) return false;
  return llm.apiKey.trim().length > 0 || /localhost|127\.0\.0\.1/.test(llm.baseUrl);
}

/**
 * 一对一聊天。
 * - 已生成人格卡 + 配置模型：走 Rust 流式 LLM，逐字追加她的回复；
 * - 都没有：保留 Step 1 的演示回复（方便首次体验）；
 * - 只有人格卡没有模型：提示去设置里配置，不伪造回复。
 */
export function useChat(options: ChatOptions): ChatApi {
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [typing, setTyping] = useState(false);
  const [unread, setUnread] = useState(2);
  const counter = useRef(0);
  const replyTimer = useRef<number | null>(null);
  const recallTimestamps = useRef<number[]>([]);
  const loadedRef = useRef(false);
  const loadedConversationRef = useRef<string | null>(null);
  const conversationId = options.conversationId ?? "default";
  const conversationStateKey = `conversation.state.${conversationId}`;
  const conversationRef = useRef<{ summary: string; topic: string; turns: number }>({
    summary: "",
    topic: "",
    turns: 0,
  });

  const nextId = useCallback((): string => {
    counter.current += 1;
    return `msg-${Date.now().toString(36)}-${counter.current}`;
  }, []);

  const clearReplyTimer = useCallback((): void => {
    if (replyTimer.current !== null) {
      window.clearTimeout(replyTimer.current);
      replyTimer.current = null;
    }
  }, []);

  useEffect(
    () => () => {
      if (replyTimer.current !== null) window.clearTimeout(replyTimer.current);
    },
    [],
  );

  const persistMessage = useCallback((message: ChatMsg): void => {
    if (!isTauri()) return;
    void api.chatAppend(message.id, message.ts, JSON.stringify({ ...message, convId: conversationId })).catch(() => undefined);
  }, [conversationId]);

  const deletePersisted = useCallback((id: string): void => {
    if (!isTauri()) return;
    void api.chatDelete(id).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!isTauri() || !options.conversationId || options.dbReady === false) return;
    let alive = true;
    void (async () => {
      try {
        const [rows, conversationRaw] = await Promise.all([
          api.chatLoad(2000),
          api.settingGet(conversationStateKey),
        ]);
        if (!alive) return;
        setMessages([]);
        if (conversationRaw) {
          try {
            const parsed = JSON.parse(conversationRaw) as { summary?: string; topic?: string; turns?: number };
            conversationRef.current = {
              summary: typeof parsed.summary === "string" ? parsed.summary : "",
              topic: typeof parsed.topic === "string" ? parsed.topic : "",
              turns: typeof parsed.turns === "number" ? parsed.turns : 0,
            };
          } catch {
            /* 忽略损坏摘要 */
          }
        }
        const loaded: ChatMsg[] = [];
        for (const row of rows) {
          try {
            const parsed = JSON.parse(row.payload) as ChatMsg & { convId?: string };
            if (
              parsed &&
              typeof parsed.id === "string" &&
              typeof parsed.ts === "number" &&
              (parsed.convId ?? "default") === conversationId
            ) {
              loaded.push(parsed);
            }
          } catch {
            /* 跳过损坏的一行 */
          }
        }
        setMessages(loaded);
        setUnread(0);
        counter.current = loaded.length;
        loadedRef.current = true;
      } catch {
        /* 旧库没有 chat_message 时保留空会话 */
      }
    })();
    return () => {
      alive = false;
    };
  }, [conversationId, options.conversationId, options.dbReady]);

  // 用最近 8 条生成短摘要：控制上下文长度，同时让重启后的 ta 知道之前在聊什么
  useEffect(() => {
    const textMessages = messages.filter((message) => message.kind === "text");
    if (textMessages.length < 2) return;
    const recent = textMessages.slice(-8).map((message) => {
      const text = message.kind === "text" ? message.text : "";
      return `${message.from === "her" ? "ta" : "我"}：${text.slice(0, 80)}`;
    });
    const lastUser = [...textMessages].reverse().find((message) => message.from === "me");
    const next = {
      summary: recent.join("；").slice(0, 600),
      topic: lastUser && lastUser.kind === "text" ? lastUser.text.slice(0, 40) : conversationRef.current.topic,
      turns: textMessages.filter((message) => message.from === "me").length,
    };
    conversationRef.current = next;
    if (isTauri()) {
      void api.settingSet(conversationStateKey, JSON.stringify(next)).catch(() => undefined);
    }
  }, [conversationStateKey, messages.length]);

  const scheduleReply = useCallback((): void => {
    clearReplyTimer();
    setTyping(true);
    replyTimer.current = window.setTimeout(() => {
      replyTimer.current = null;
      setTyping(false);
      const index = Math.floor(Math.random() * DEMO_REPLIES.length);
      const reply = DEMO_REPLIES[index] ?? "嗯";
      setMessages((previous) => [
        ...previous,
        { id: nextId(), from: "her", kind: "text", text: reply, ts: Date.now() },
      ]);
    }, 2200);
  }, [clearReplyTimer, nextId]);

  const streamReply = useCallback(
    (userText: string, history: ChatMsg[]): void => {
      const persona = options.persona;
      const llm = options.llm;
      if (!persona || !llm) return;
      clearReplyTimer();
      setTyping(true);

      const now = Date.now();
      const decayed = decayEmotion(options.emotion, now);
      const runtimeHistory = history
        .filter(
          (message): message is TextMessage =>
            message.kind === "text" && message.from !== "system",
        )
        .map((message) => ({
          from: message.from === "her" ? ("her" as const) : ("me" as const),
          text: message.text,
          ts: message.ts,
        }));
      const governorMessages = [...runtimeHistory, { from: "me" as const, text: userText, ts: now }];
      const governor = assessAndDecide(governorMessages, now);
      if (governor.exitText) options.onNotice?.(governor.exitText);

      const arc = planArc(determineScene(userText, new Date(now).getHours()), userText);
      const guard = guardUserMessage(userText);
      const intensity = Math.min(1, Math.max(0.2, userText.length / 40));
      const nextEmotion = applyStimulus(decayed, classifyStimulus(userText), intensity, now);
      options.onEmotion(nextEmotion);

      const decision = decideReply({ text: userText, emotion: nextEmotion, now });
      if (!decision.reply) {
        setTyping(false);
        return;
      }

      const replyId = nextId();
      let started = false;
      const finalize = (full: string): void => {
        const candidate = filterAiFlavor(full).text;
        const softened = softenWeirdText(candidate);
        const filtered = qualityIssues(softened).length > 0 ? "" : softened;
        const segments = splitSegments(filtered);
        if (segments.length === 0) return;
        const first = segments[0]!;
        if (!started) {
          started = true;
          const reply: ChatMsg = { id: replyId, from: "her", kind: "text", text: first, ts: Date.now() };
          setMessages((previous) => [...previous, reply]);
          persistMessage(reply);
        } else {
          setMessages((previous) =>
            previous.map((message) =>
              message.id === replyId && message.kind === "text" ? { ...message, text: first } : message,
            ),
          );
          persistMessage({ id: replyId, from: "her", kind: "text", text: first, ts: Date.now() });
        }
        segments.slice(1).forEach((segment, index) => {
          window.setTimeout(() => {
            const message: ChatMsg = {
              id: `${replyId}-s${index + 1}`,
              from: "her",
              kind: "text",
              text: segment,
              ts: Date.now(),
            };
            setMessages((previous) => [...previous, message]);
            persistMessage(message);
          }, 350 * (index + 1));
        });
      };
      void (async () => {
        let memories: ReturnType<typeof retrieveMemories> = [];
        const conversation = conversationRef.current;
        const memoryQuery = [conversation.topic, userText].filter(Boolean).join(" ");
        try {
          const hits = await api.memorySearch(memoryQuery, 20);
          const candidates: MemoryCandidate[] = hits.map((hit) => ({
            id: hit.id,
            text: hit.text,
            ts: hit.ts,
            importance: hit.importance,
            valence: hit.valence,
          }));
          memories = retrieveMemories(candidates, memoryQuery, nextEmotion, { topK: 5, now });
        } catch {
          /* 记忆不可用时退化为无记忆 */
        }
        const runtime = buildComposedMessages({
          persona,
          emotion: nextEmotion,
          arc,
          governor,
          guard,
          memories,
          openLoops: detectOpenLoops(governorMessages.slice(-50), now),
          summary: conversation.summary || persona.summary,
          history: runtimeHistory,
          userText,
          relationship: options.relationship ?? undefined,
          styleCalibration: options.styleCalibration,
          moodNote: options.moodNote,
          topic: conversation.topic || userText,
          profile: { name: options.herName, selfName: options.meName },
        });

        await new Promise((resolve) => window.setTimeout(resolve, decision.delayMs));
        await api
          .llmChatStream(
            runtime.messages.map((message) => ({ role: message.role, content: message.content })),
            (event) => {
              if (event.kind === "delta" && event.text.length > 0) {
                setTyping(false);
                if (!started) {
                  started = true;
                  setMessages((previous) => [
                    ...previous,
                    { id: replyId, from: "her", kind: "text", text: event.text, ts: Date.now() },
                  ]);
                } else {
                  setMessages((previous) =>
                    previous.map((message) =>
                      message.id === replyId && message.kind === "text"
                        ? { ...message, text: message.text + event.text }
                        : message,
                    ),
                  );
                }
              } else if (event.kind === "error") {
                setTyping(false);
                options.onNotice?.(event.text);
              } else if (event.kind === "done") {
                setTyping(false);
                finalize(event.text);
              }
            },
          )
          .catch((error: unknown) => {
            setTyping(false);
            options.onNotice?.(error instanceof Error ? error.message : String(error));
          });
      })();
    },
    [clearReplyTimer, nextId, options, persistMessage],
  );

  const sendText = useCallback(
    (text: string) => {
      if (typing) return;
      const value = text.trim();
      if (value.length === 0) return;
      const history = messages;
      const userMessage: ChatMsg = { id: nextId(), from: "me", kind: "text", text: value, ts: Date.now() };
      setMessages((previous) => [...previous, userMessage]);
      persistMessage(userMessage);
      setUnread(0);
      const persona = options.persona;
      const personaReady =
        persona !== null &&
        (persona.origin === "preset" || persona.origin === "custom" || persona.source.her_messages > 0);
      if (personaReady) {
        if (llmUsable(options.llm)) {
          streamReply(value, history);
        } else {
          options.onNotice?.("已生成人格卡；请先在「设置 → 模型」里填写 API Key 和模型名");
        }
        return;
      }
      scheduleReply();
    },
    [messages, nextId, options, persistMessage, scheduleReply, streamReply, typing],
  );

  const sendImage = useCallback(
    (dataUrl: string, name?: string) => {
      const message: ChatMsg = { id: nextId(), from: "me", kind: "image", dataUrl, name, ts: Date.now() };
      setMessages((previous) => [...previous, message]);
      persistMessage(message);
      setUnread(0);
    },
    [nextId, persistMessage],
  );

  const appendProactive = useCallback(
    (text: string) => {
      const value = text.trim();
      if (!value) return;
      const message: ChatMsg = { id: nextId(), from: "her", kind: "text", text: value, ts: Date.now() };
      setMessages((previous) => [...previous, message]);
      persistMessage(message);
      setUnread((previous) => previous + 1);
    },
    [nextId, persistMessage],
  );

  const recallLastMessage = useCallback((): boolean => {    const now = Date.now();
    const check = canRecall({ timestamps: recallTimestamps.current }, now, DEFAULT_RECALL_BUDGET);
    if (!check.ok) {
      options.onNotice?.(check.reason);
      return false;
    }
    const result = recallLast(messages as unknown as Array<{ id: string; from: "her" | "me" | "system"; kind: string; text?: string; ts: number }>, now);
    if (!result.recalled) {
      options.onNotice?.("现在没有可撤回的消息");
      return false;
    }
    recallTimestamps.current = recordRecall({ timestamps: recallTimestamps.current }, now).timestamps;
    if (isTauri()) {
      void api
        .settingSet("recall.timestamps", JSON.stringify(recallTimestamps.current))
        .catch(() => undefined);
    }
    if (result.recalled) deletePersisted(result.recalled.id);
    const nextMessages = result.systemNotice
      ? [...result.messages, result.systemNotice]
      : result.messages;
    setMessages(nextMessages as unknown as ChatMsg[]);
    if (result.systemNotice) persistMessage(result.systemNotice as unknown as ChatMsg);
    options.onNotice?.("已撤回一条消息");
    return true;
  }, [deletePersisted, messages, options, persistMessage]);

  const deleteMessage = useCallback((id: string) => {
    setMessages((previous) => previous.filter((message) => message.id !== id));
    deletePersisted(id);
  }, [deletePersisted]);

  const appendImported = useCallback(
    (files: ImportedMediaFile[]) => {
      if (files.length === 0) return;
      clearReplyTimer();
      setTyping(false);
      const now = Date.now();
      const stamp: ChatMsg = {
        id: nextId(),
        from: "system",
        kind: "text",
        text: formatTimeDivider(now),
        ts: now,
      };
      const imported = files.map<ChatMsg>((file, index) =>
        file.kind === "image"
          ? {
              id: nextId(),
              from: "her",
              kind: "image",
              dataUrl: file.dataUrl,
              name: file.name,
              ts: now + index + 1,
            }
          : {
              id: nextId(),
              from: "her",
              kind: "voice",
              dataUrl: file.dataUrl,
              durationSec: 0,
              ts: now + index + 1,
            },
      );
      setMessages((previous) => [...previous, stamp, ...imported]);
      persistMessage(stamp);
      imported.forEach(persistMessage);
    },
    [clearReplyTimer, nextId, persistMessage],
  );

  const resetToGreeting = useCallback(
    async (text: string): Promise<void> => {
      clearReplyTimer();
      setTyping(false);
      if (isTauri()) await api.chatClear().catch(() => undefined);
      const message: ChatMsg = { id: nextId(), from: "her", kind: "text", text, ts: Date.now() };
      conversationRef.current = { summary: "", topic: "", turns: 0 };
      if (isTauri()) {
        await api
          .settingSet(conversationStateKey, JSON.stringify({ summary: "", topic: "", turns: 0 }))
          .catch(() => undefined);
      }
      setMessages([message]);
      setUnread(1);
      persistMessage(message);
    },
    [clearReplyTimer, nextId, persistMessage],
  );

  const clear = useCallback(() => {
    clearReplyTimer();
    setTyping(false);
    setMessages([]);
    conversationRef.current = { summary: "", topic: "", turns: 0 };
    if (isTauri()) {
      void api.chatClear().catch(() => undefined);
      void api.settingSet(conversationStateKey, JSON.stringify({ summary: "", topic: "", turns: 0 })).catch(() => undefined);
    }
  }, [clearReplyTimer]);

  const markRead = useCallback(() => setUnread(0), []);

  return useMemo(
    () => ({
      messages,
      typing,
      unread,
      sendText,
      sendImage,
      appendImported,
      appendProactive,
      resetToGreeting,
      recallLastMessage,
      deleteMessage,
      clear,
      markRead,
    }),
    [
      messages,
      typing,
      unread,
      sendText,
      sendImage,
      appendImported,
      appendProactive,
      resetToGreeting,
      recallLastMessage,
      deleteMessage,
      clear,
      markRead,
    ],
  );
}
