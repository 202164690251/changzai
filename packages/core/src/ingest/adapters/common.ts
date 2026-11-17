// 常在 · 导入适配器公共工具（WeChatMsg / 留痕 / QQ 等格式共用）
import type { MessageType, RawMessage } from "@changzai/shared";
import { isTimestampedLine } from "./plaintext.ts";

/** 行首时间戳（支持 2023-05-20 14:03:22 / 2023/5/20 / 带方括号） */
export const TS_PREFIX_RE =
  /^\s*\[?(\d{4}[-/年]\d{1,2}[-/月]\d{1,2}日?(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?)\]?\s+/;

/** 把各种微信消息类型码映射成产品内部类型 */
export function mapWechatType(input: unknown): MessageType {
  const text = typeof input === "number" ? String(input) : String(input ?? "").toLowerCase();
  switch (text) {
    case "1":
    case "text":
    case "txt":
      return "text";
    case "3":
    case "image":
    case "img":
      return "image";
    case "34":
    case "voice":
    case "audio":
      return "voice";
    case "43":
    case "video":
      return "video";
    case "47":
    case "emoji":
    case "sticker":
      return "emoji";
    case "49":
    case "quote":
    case "app":
    case "file":
      return "file";
    case "10000":
    case "10002":
    case "system":
    case "revoke":
      return "system";
    case "redpacket":
      return "redpacket";
    case "call":
      return "call";
    default:
      return "text";
  }
}

/** 发送人字段归一化：返回 "me" / "her"（无法判断时给了默认值） */
export function senderFromName(name: string): "me" | "her" {
  const value = name.trim();
  if (/^(我|自己|me|self)$/i.test(value)) return "me";
  return "her";
}

export function senderFromFlag(flag: unknown): "me" | "her" | null {
  if (typeof flag === "boolean") return flag ? "me" : "her";
  if (typeof flag === "number") return flag === 1 ? "me" : "her";
  const text = String(flag ?? "").trim().toLowerCase();
  if (["1", "true", "yes", "是", "self", "me"].includes(text)) return "me";
  if (["0", "false", "no", "否", "other", "her"].includes(text)) return "her";
  return null;
}

/**
 * 解析「时间 + 发送人（可选 QQ/微信号）」这一类文本行，返回剩余内容。
 * 兼容：
 *   2023-05-20 14:03:22 小林
 *   [2023-05-20 14:03] 小林(123456)
 *   2023/5/20 14:03 小林: 在干嘛
 */
export function parseHeaderLine(line: string): { ts: string; senderName: string; rest: string } | null {
  const m = line.match(
    /^\s*\[?(\d{4}[-/年]\d{1,2}[-/月]\d{1,2}日?(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?)\]?\s+(.{1,32}?)(?:\s*[:：]\s*|\s*$)(.*)$/,
  );
  if (!m) return null;
  const [, ts = "", rawName = "", rest = ""] = m;
  const senderName = rawName.replace(/\(\d{5,12}\)$/, "").trim();
  if (!senderName) return null;
  return { ts: ts.trim(), senderName, rest: rest.trim() };
}

/** 逐行扫「多行格式」：头部行之后、下一条头部行之前的行作为消息正文 */
export function parseMultilineText(
  text: string,
  options: { convIdPrefix?: string } = {},
): RawMessage[] {
  const lines = text.split(/\r?\n/);
  const out: RawMessage[] = [];
  let current: RawMessage | null = null;
  let currentLines: string[] = [];
  const flush = (): void => {
    if (!current) return;
    current.content = currentLines.join("\n").trim();
    if (current.content.length > 0 || current.type !== "text") out.push(current);
    current = null;
    currentLines = [];
  };
  for (const line of lines) {
    const header = parseHeaderLine(line);
    if (header) {
      flush();
      const sender = senderFromName(header.senderName);
      current = {
        ts: header.ts,
        sender,
        sender_name: header.senderName,
        type: "text",
        content: "",
        conv_id: options.convIdPrefix,
      };
      if (header.rest.length > 0) currentLines.push(header.rest);
    } else if (current) {
      currentLines.push(line);
    }
  }
  flush();
  return out;
}

/** 统计文本中可识别的时间戳行比例，用于 sniff */
export function timestampLineRatio(text: string): number {
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length === 0) return 0;
  const matched = lines.filter((line) => isTimestampedLine(line) || TS_PREFIX_RE.test(line)).length;
  return matched / lines.length;
}
