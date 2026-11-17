// 常在 · 归一化消息（02 §3.1）
// 刻意保持纯函数：不读文件、不联网、不依赖当前时间。

import type {
  IngestIssue,
  MessageType,
  NormalizedMessage,
  RawMessage,
  Sender,
} from "@changzai/shared";

const SENDER_MAP: Record<string, Sender> = {
  her: "her",
  ta: "her",
  she: "her",
  "她": "her",
  "对方": "her",
  me: "me",
  i: "me",
  "我": "me",
  "自己": "me",
  system: "system",
  "系统": "system",
  "微信团队": "system",
};

const TYPE_MAP: Record<string, MessageType> = {
  text: "text",
  txt: "text",
  image: "image",
  img: "image",
  "图片": "image",
  voice: "voice",
  audio: "voice",
  "语音": "voice",
  video: "video",
  "视频": "video",
  emoji: "emoji",
  sticker: "emoji",
  "表情": "emoji",
  quote: "quote",
  "引用": "quote",
  file: "file",
  "文件": "file",
  redpacket: "redpacket",
  "红包": "redpacket",
  call: "call",
  "通话": "call",
  system: "system",
  "系统消息": "system",
};

export function normalizeSender(input: unknown): Sender {
  if (typeof input !== "string") return "her";
  return SENDER_MAP[input.trim().toLowerCase()] ?? SENDER_MAP[input.trim()] ?? "her";
}

export function normalizeType(input: unknown): MessageType {
  if (typeof input !== "string") return "text";
  return TYPE_MAP[input.trim().toLowerCase()] ?? TYPE_MAP[input.trim()] ?? "text";
}

/** 32-bit FNV-1a：给缺失 msg_id 的消息生成稳定 ID（不依赖 Node crypto） */
export function fnv1a(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

export function parseTimestamp(input: unknown): number | null {
  if (typeof input === "number" && Number.isFinite(input)) {
    // 兼容秒级时间戳
    return input < 1e12 ? Math.round(input * 1000) : Math.round(input);
  }
  if (typeof input === "string") {
    const s = input.trim();
    if (/^\d{10}$/.test(s)) return Number(s) * 1000;
    if (/^\d{13}$/.test(s)) return Number(s);
    // 2023-05-20 14:03:22 / 2023/05/20 14:03 / 2023年5月20日 14:03
    const m = s.match(
      /^(\d{4})[-/年](\d{1,2})[-/月](\d{1,2})日?(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/,
    );
    if (m) {
      const [, y, mo, d, hh = "0", mi = "0", ss = "0"] = m;
      return new Date(
        Number(y),
        Number(mo) - 1,
        Number(d),
        Number(hh),
        Number(mi),
        Number(ss),
      ).getTime();
    }
    const parsed = Date.parse(s);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}

export function makeMsgId(convId: string, ts: number, sender: Sender, content: string): string {
  return `m_${fnv1a(`${convId}|${ts}|${sender}|${content}`)}`;
}

export interface NormalizeContext {
  convId: string;
  /** 留出评测集标记：1 时永远不进入蒸馏/检索 */
  isHoldout?: 0 | 1;
  fallbackTs?: number;
}

export function normalizeMessage(raw: RawMessage, ctx: NormalizeContext): NormalizedMessage {
  const sender = normalizeSender(raw.sender);
  const ts = parseTimestamp(raw.ts) ?? ctx.fallbackTs ?? 0;
  const content = typeof raw.content === "string" ? raw.content : String(raw.content ?? "");
  const convId = raw.conv_id ?? ctx.convId;
  const msgId = raw.msg_id ?? makeMsgId(convId, ts, sender, content);
  const senderName =
    raw.sender_name ?? (sender === "her" ? "她" : sender === "me" ? "我" : "系统");
  const burstIndex = Number.isFinite(raw.burst_index) ? Number(raw.burst_index) : 1;
  const burstSize = Number.isFinite(raw.burst_size) ? Number(raw.burst_size) : burstIndex;
  return {
    msg_id: msgId,
    conv_id: convId,
    ts,
    sender,
    sender_name: senderName,
    type: normalizeType(raw.type),
    content,
    media_path: raw.media_path ?? null,
    media_duration: raw.media_duration ?? null,
    reply_to: raw.reply_to ?? null,
    latency_s: raw.latency_s ?? null,
    burst_index: burstIndex,
    burst_size: burstSize,
    raw_type: Number(raw.raw_type ?? 0) || 0,
    is_holdout: ctx.isHoldout ?? 0,
  };
}

export function validateMessage(m: NormalizedMessage): IngestIssue[] {
  const issues: IngestIssue[] = [];
  if (!Number.isFinite(m.ts) || m.ts <= 0) issues.push({ code: "BAD_TS", message: `时间戳无效: ${m.ts}` });
  if (!m.conv_id) issues.push({ code: "BAD_CONV", message: "conv_id 为空" });
  if (!m.msg_id) issues.push({ code: "BAD_ID", message: "msg_id 为空" });
  if (!Number.isInteger(m.burst_index) || m.burst_index < 1)
    issues.push({ code: "BAD_BURST_INDEX", message: `burst_index 无效: ${m.burst_index}` });
  if (!Number.isInteger(m.burst_size) || m.burst_size < m.burst_index)
    issues.push({ code: "BAD_BURST_SIZE", message: `burst_size 无效: ${m.burst_size}` });
  if (typeof m.content !== "string") issues.push({ code: "BAD_CONTENT", message: "content 不是字符串" });
  return issues;
}

export function dedupeKey(m: Pick<NormalizedMessage, "conv_id" | "ts" | "sender" | "content">): string {
  return `${m.conv_id}|${m.ts}|${m.sender}|${m.content}`;
}

export function dedupeMessages(messages: NormalizedMessage[]): {
  messages: NormalizedMessage[];
  duplicates: number;
} {
  const seen = new Set<string>();
  const out: NormalizedMessage[] = [];
  let duplicates = 0;
  for (const m of messages) {
    const key = dedupeKey(m);
    if (seen.has(key)) {
      duplicates++;
      continue;
    }
    seen.add(key);
    out.push(m);
  }
  return { messages: out, duplicates };
}

export function sortMessages(messages: NormalizedMessage[]): NormalizedMessage[] {
  return [...messages].sort((a, b) => a.ts - b.ts || a.msg_id.localeCompare(b.msg_id));
}
