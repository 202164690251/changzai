// 常在 · 微信网页导出（window.CHAT_DATA = [...]）适配器
//
// 这是第三方导出工具生成的 data.js：
// - 文件本身是 JavaScript 赋值，不是纯 JSON；本适配器只做字符串截取 + JSON.parse，不 eval；
// - type=1 的 content 是文本；
// - type=34 的语音转写在 contents.voiceText，会展开成文本消息参与人格卡；
// - type=49 的引用消息优先用 content（回复文字），为空时用 contents.refer.content；
// - 图片/视频/表情/通话保留原类型，不参与人格卡。

import type { RawMessage } from "@changzai/shared";
import type { AdapterSource, IngestAdapter } from "./base.ts";
import { mapWechatType, senderFromFlag, senderFromName } from "./common.ts";

type JsRecord = Record<string, unknown>;

function asRecord(value: unknown): JsRecord | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as JsRecord) : null;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** 只截取 `CHAT_DATA = [ ... ];` 的数组片段，绝不执行 JS */
export function extractChatDataJson(text: string): string | null {
  const marker = text.indexOf("CHAT_DATA");
  if (marker < 0) return null;
  const equals = text.indexOf("=", marker);
  if (equals < 0) return null;
  const start = text.indexOf("[", equals);
  if (start < 0) return null;
  const end = text.lastIndexOf("]");
  if (end <= start) return null;
  return text.slice(start, end + 1);
}

function toRawMessage(record: JsRecord): RawMessage | null {
  const rawType = Number(record.type ?? 0);
  const senderName = asString(record.senderName) || asString(record.talkerName);
  const selfFlag = senderFromFlag(record.isSelf);
  const isSystem =
    rawType === 10000 ||
    rawType === 10002 ||
    senderName === "系统消息" ||
    (!senderName && selfFlag === null);

  let type = mapWechatType(rawType);
  let content = asString(record.content);
  const contents = asRecord(record.contents);

  if (rawType === 34) {
    const transcript = asString(contents?.voiceText).trim();
    if (transcript.length > 0) {
      type = "text";
      content = transcript;
    }
  } else if (rawType === 49) {
    const refer = asRecord(contents?.refer);
    content = content.trim() || asString(refer?.content).trim();
    type = content.length > 0 ? "text" : "quote";
  } else if (rawType === 50) {
    type = "call";
    content = asString(contents?.text) || content;
  } else if (rawType === 48) {
    type = "file";
    content = asString(contents?.label) || asString(contents?.cityname) || content;
  } else if (rawType === 42) {
    type = "file";
  }

  const sender = isSystem
    ? "system"
    : (selfFlag ?? senderFromName(senderName));

  return {
    ts: asString(record.time),
    sender,
    sender_name: senderName || (sender === "me" ? "我" : sender === "system" ? "系统" : "ta"),
    type,
    content,
    raw_type: rawType,
  };
}

export class ChatDataJsAdapter implements IngestAdapter {
  readonly name = "chatdata_js";
  readonly description = "微信网页导出 data.js（含语音转写）";

  sniff(source: AdapterSource): number {
    const text = source.text ?? "";
    if (!text.trim()) return 0;
    if (!/CHAT_DATA\s*=/.test(text)) return 0;
    if (!/isSelf/.test(text) || !/voiceText|senderName/.test(text)) return 0;
    let score = 0.86;
    if ((source.fileName ?? "").toLowerCase().endsWith(".js")) score += 0.08;
    if (text.includes("window.CHAT_DATA")) score += 0.03;
    return Math.min(0.99, score);
  }

  parse(source: AdapterSource): RawMessage[] {
    const json = extractChatDataJson(source.text ?? "");
    if (!json) return [];
    let payload: unknown;
    try {
      payload = JSON.parse(json);
    } catch {
      return [];
    }
    if (!Array.isArray(payload)) return [];
    const out: RawMessage[] = [];
    for (const item of payload) {
      const record = asRecord(item);
      if (!record) continue;
      const message = toRawMessage(record);
      if (message) out.push(message);
    }
    return out;
  }
}
