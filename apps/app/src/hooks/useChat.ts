import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { buildChatMessages, type PersonaProfile } from "@changzai/core";
import { DEMO_VOICE_SECONDS, demoImageDataUrl, demoVoiceDataUrl } from "../lib/demoMedia.ts";
import { formatTimeDivider } from "../lib/time.ts";
import { api, type ImportedMediaFile, type LlmConfig } from "../lib/tauri.ts";

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
  const [messages, setMessages] = useState<ChatMsg[]>(seedMessages);
  const [typing, setTyping] = useState(false);
  const [unread, setUnread] = useState(2);
  const counter = useRef(0);
  const replyTimer = useRef<number | null>(null);

  const nextId = useCallback((): string => {
    counter.current += 1;
    return `msg-${counter.current}`;
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
      const payload = buildChatMessages(
        persona,
        history
          .filter((message): message is TextMessage => message.kind === "text" && message.id.startsWith("msg-") && message.from !== "system")
          .map((message) => ({ from: message.from === "her" ? "her" : "me", text: message.text })),
        userText,
        { name: options.herName, selfName: options.meName },
      );
      const replyId = nextId();
      let started = false;
      void api
        .llmChatStream(
          payload.map((message) => ({ role: message.role, content: message.content })),
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
              if (!started) options.onNotice?.("模型没有返回内容，请检查模型名或额度");
            }
          },
        )
        .catch((error: unknown) => {
          setTyping(false);
          options.onNotice?.(error instanceof Error ? error.message : String(error));
        });
    },
    [clearReplyTimer, nextId, options],
  );

  const sendText = useCallback(
    (text: string) => {
      if (typing) return;
      const value = text.trim();
      if (value.length === 0) return;
      const history = messages;
      setMessages((previous) => [
        ...previous,
        { id: nextId(), from: "me", kind: "text", text: value, ts: Date.now() },
      ]);
      setUnread(0);
      if (options.persona && options.persona.source.her_messages > 0) {
        if (llmUsable(options.llm)) {
          streamReply(value, history);
        } else {
          options.onNotice?.("已生成人格卡；请先在「设置 → 模型」里填写 API Key 和模型名");
        }
        return;
      }
      scheduleReply();
    },
    [messages, nextId, options, scheduleReply, streamReply, typing],
  );

  const sendImage = useCallback(
    (dataUrl: string, name?: string) => {
      setMessages((previous) => [
        ...previous,
        { id: nextId(), from: "me", kind: "image", dataUrl, name, ts: Date.now() },
      ]);
      setUnread(0);
    },
    [nextId],
  );

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
    },
    [clearReplyTimer, nextId],
  );

  const clear = useCallback(() => {
    clearReplyTimer();
    setTyping(false);
    setMessages([]);
  }, [clearReplyTimer]);

  const markRead = useCallback(() => setUnread(0), []);

  return useMemo(
    () => ({ messages, typing, unread, sendText, sendImage, appendImported, clear, markRead }),
    [messages, typing, unread, sendText, sendImage, appendImported, clear, markRead],
  );
}
