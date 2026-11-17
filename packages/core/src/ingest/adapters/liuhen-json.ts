// 常在 · 留痕 / 其它工具导出的 JSON 适配器
// 兼容：顶层数组、{messages:[...]}、{data:[...]}、{chatRecords:[...]}
import type { RawMessage } from "@changzai/shared";
import type { AdapterSource, IngestAdapter } from "./base.ts";
import { mapWechatType, senderFromFlag, senderFromName } from "./common.ts";

type JsonRecord = Record<string, unknown>;

function pick(record: JsonRecord, keys: string[]): unknown {
  for (const key of keys) {
    if (key in record && record[key] !== undefined && record[key] !== null) return record[key];
  }
  return undefined;
}

function normalizeTimestamp(value: unknown): string | number {
  if (typeof value === "number" || typeof value === "string") return value;
  return "";
}

function findArray(payload: unknown): JsonRecord[] | null {
  if (Array.isArray(payload)) return payload.filter((item) => typeof item === "object" && item !== null) as JsonRecord[];
  if (typeof payload !== "object" || payload === null) return null;
  const record = payload as JsonRecord;
  for (const key of ["messages", "data", "chatRecords", "list", "records", "items"]) {
    const value = record[key];
    if (Array.isArray(value)) return findArray(value);
  }
  return null;
}

export class LiuhenJsonAdapter implements IngestAdapter {
  readonly name = "liuhen_json";
  readonly description = "留痕 / 其它工具导出的 JSON 消息数组";

  sniff(source: AdapterSource): number {
    const text = (source.text ?? "").trim();
    if (!text) return 0;
    const name = (source.fileName ?? "").toLowerCase();
    let score = 0;
    if (name.endsWith(".json")) score += 0.55;
    if (/^[\[{]/.test(text)) score += 0.2;
    if (/"(messages|chatRecords|StrContent|CreateTime|IsSender)"/i.test(text)) score += 0.2;
    return Math.min(0.95, score);
  }

  parse(source: AdapterSource): RawMessage[] {
    let payload: unknown;
    try {
      payload = JSON.parse(source.text ?? "");
    } catch {
      return [];
    }
    const records = findArray(payload);
    if (!records) return [];
    return records.map((record) => {
      const senderNameRaw = pick(record, ["sender_name", "senderName", "sender", "nickname", "talker", "from"]);
      const senderName = typeof senderNameRaw === "string" ? senderNameRaw : "";
      const flagRaw = pick(record, ["IsSender", "is_sender", "isSender", "IsSend", "isSend", "is_send", "self", "isSelf"]);
      const flagged = senderFromFlag(flagRaw);
      const sender = flagged ?? senderFromName(senderName);
      const contentRaw = pick(record, ["content", "StrContent", "text", "message", "msg"]);
      const typeRaw = pick(record, ["type", "Type", "msgType", "msg_type"]);
      return {
        ts: normalizeTimestamp(pick(record, ["ts", "time", "timestamp", "CreateTime", "create_time", "StrTime"])),
        sender,
        sender_name: senderName || (sender === "me" ? "我" : "她"),
        type: mapWechatType(typeRaw),
        content: typeof contentRaw === "string" ? contentRaw : String(contentRaw ?? ""),
        conv_id: source.fileName,
      };
    });
  }
}
