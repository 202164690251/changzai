// 常在 · WeChatMsg（留痕/MemoTrace 同类）导出的 txt 适配器
// 兼容两种形态：
//   2023-05-20 14:03:22 小林
//   在干嘛
// 以及：
//   2023-05-20 14:03:22 小林: 在干嘛
import type { RawMessage } from "@veyrimi/shared";
import type { AdapterSource, IngestAdapter } from "./base.ts";
import { parseMultilineText, parseHeaderLine, timestampLineRatio } from "./common.ts";

export class WechatmsgTxtAdapter implements IngestAdapter {
  readonly name = "wechatmsg_txt";
  readonly description = "WeChatMsg / 留痕导出的 txt（时间 + 发送人 + 正文）";

  sniff(source: AdapterSource): number {
    const text = source.text ?? "";
    if (!text.trim()) return 0;
    const ratio = timestampLineRatio(text);
    const name = (source.fileName ?? "").toLowerCase();
    const looksLikeCsv =
      /\.csv$/i.test(name) || ((text.split(/\r?\n/)[0]?.split(",").length ?? 0) > 2);
    if (looksLikeCsv) return 0;
    if (ratio < 0.5) {
      // 文件名明确时仍给低置信度，让用户能手动选
      return /\.txt$/i.test(name) && /wechat|微信|聊天/.test(name) ? 0.35 : 0;
    }
    let score = 0.55 + ratio * 0.35;
    if (/wechat|微信|聊天|msg/i.test(name)) score += 0.08;
    // 单行「时间 昵称: 内容」更接近粘贴格式，让 plaintext 适配器优先，避免抢嗅探
    const nonEmptyLines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
    const sameLineWithColon = nonEmptyLines.filter((line) => {
      const header = parseHeaderLine(line);
      return header !== null && header.rest.length > 0;
    }).length;
    if (nonEmptyLines.length > 0 && sameLineWithColon / nonEmptyLines.length > 0.8) {
      score *= 0.85;
    }
    // 昵称后带 QQ 号的文本交给 qq_txt 适配器（避免抢嗅探）
    if (/\(\d{5,12}\)/.test(text) || /^qq/i.test(name)) score *= 0.45;
    return Math.min(0.95, score);
  }

  parse(source: AdapterSource): RawMessage[] {
    return parseMultilineText(source.text ?? "", { convIdPrefix: source.fileName });
  }
}
