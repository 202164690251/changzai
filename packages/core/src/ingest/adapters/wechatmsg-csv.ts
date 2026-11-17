// 常在 · WeChatMsg 导出的 csv 适配器
// 兼容中英文表头：时间/发送人/内容/类型、CreateTime/IsSender/StrContent/Type 等。
import type { RawMessage } from "@changzai/shared";
import type { AdapterSource, IngestAdapter } from "./base.ts";
import { mapWechatType, senderFromFlag, senderFromName } from "./common.ts";

const TIME_ALIASES = ["时间", "createtime", "create_time", "strtime", "timestamp", "ts", "time", "msgtime"];
const CONTENT_ALIASES = ["内容", "strcontent", "content", "msg", "message", "text"];
const SENDER_ALIASES = ["发送人", "昵称", "sender", "sendername", "name", "talker", "strsender", "from"];
const IS_SENDER_ALIASES = ["issender", "is_sender", "issend", "is_send", "self", "是否发送"];
const TYPE_ALIASES = ["类型", "type", "msgtype", "strtype"];

/** 极小 CSV 解析器：支持引号、逗号、换行、双引号转义 */
export function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field.trim());
      field = "";
    } else if (ch === "\n") {
      row.push(field.trim());
      if (row.some((cell) => cell.length > 0)) rows.push(row);
      row = [];
      field = "";
    } else if (ch !== "\r") {
      field += ch;
    }
  }
  row.push(field.trim());
  if (row.some((cell) => cell.length > 0)) rows.push(row);
  return rows;
}

function findColumn(headers: string[], aliases: string[]): number {
  const normalized = headers.map((h) => h.trim().toLowerCase());
  for (const alias of aliases) {
    const idx = normalized.indexOf(alias);
    if (idx >= 0) return idx;
  }
  return -1;
}

export class WechatmsgCsvAdapter implements IngestAdapter {
  readonly name = "wechatmsg_csv";
  readonly description = "WeChatMsg / 留痕导出的 csv（时间、发送人、内容、类型）";

  sniff(source: AdapterSource): number {
    const text = source.text ?? "";
    if (!text.trim()) return 0;
    const name = (source.fileName ?? "").toLowerCase();
    const firstLine = text.split(/\r?\n/).find((line) => line.trim().length > 0) ?? "";
    const commaCount = (firstLine.match(/,/g) ?? []).length;
    let score = 0;
    if (name.endsWith(".csv")) score += 0.55;
    if (commaCount >= 3) score += 0.2;
    const headers = firstLine.split(",").map((h) => h.trim().toLowerCase());
    if (TIME_ALIASES.some((a) => headers.includes(a))) score += 0.15;
    if (CONTENT_ALIASES.some((a) => headers.includes(a))) score += 0.1;
    return Math.min(0.95, score);
  }

  parse(source: AdapterSource): RawMessage[] {
    const rows = parseCsvRows(source.text ?? "");
    if (rows.length < 2) return [];
    const headers = rows[0] ?? [];
    const timeIdx = findColumn(headers, TIME_ALIASES);
    const contentIdx = findColumn(headers, CONTENT_ALIASES);
    const senderIdx = findColumn(headers, SENDER_ALIASES);
    const isSenderIdx = findColumn(headers, IS_SENDER_ALIASES);
    const typeIdx = findColumn(headers, TYPE_ALIASES);
    if (timeIdx < 0 || contentIdx < 0) return [];

    return rows.slice(1).map((row) => {
      const senderName = senderIdx >= 0 ? (row[senderIdx] ?? "") : "";
      const flagged = isSenderIdx >= 0 ? senderFromFlag(row[isSenderIdx]) : null;
      const sender = flagged ?? senderFromName(senderName);
      return {
        ts: row[timeIdx] ?? "",
        sender,
        sender_name: senderName || (sender === "me" ? "我" : "她"),
        type: mapWechatType(typeIdx >= 0 ? row[typeIdx] : "1"),
        content: row[contentIdx] ?? "",
        conv_id: source.fileName,
      };
    });
  }
}
