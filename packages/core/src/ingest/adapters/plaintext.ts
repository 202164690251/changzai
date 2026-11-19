// 常在 · 明文/粘贴适配器（Step 1 最小实现，覆盖 plaintext_paste）
// 支持行格式：
//   2023-05-20 14:03:22 小林: 在干嘛
//   [2023/05/20 14:03] 我：刚洗完澡
//   2023年5月20日 14:03 小林：嗯
// 连续的非时间行会追加到上一条消息内容里。

import type { RawMessage } from "@veyrimi/shared";
import type { AdapterSource, IngestAdapter } from "./base.ts";

const LINE_RE =
  /^\s*\[?(\d{4}[-/年]\d{1,2}[-/月]\d{1,2}日?(?:[ T]\d{1,2}:\d{2}(?::\d{2})?)?)\]?\s+(.{1,24}?)\s*[:：]\s?(.*)$/;

function normalizeDateText(raw: string): string {
  return raw.replace(/年/g, "-").replace(/月/g, "-").replace(/日/g, " ");
}

export function isTimestampedLine(line: string): boolean {
  return LINE_RE.test(line);
}

export class PlaintextPasteAdapter implements IngestAdapter {
  readonly name = "plaintext_paste";
  readonly description = "粘贴或纯文本：每行「时间 发送人: 内容」";

  sniff(source: AdapterSource): number {
    const text = source.text ?? "";
    if (!text.trim()) return 0;
    const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
    if (lines.length === 0) return 0;
    const matched = lines.filter(isTimestampedLine).length;
    const ratio = matched / lines.length;
    if (matched === 0) return 0;
    return Math.min(0.95, 0.3 + ratio * 0.6);
  }

  parse(source: AdapterSource): RawMessage[] {
    const text = source.text ?? "";
    const out: RawMessage[] = [];
    let current: RawMessage | null = null;
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(LINE_RE);
      if (m) {
        const [, dateText, name, content] = m;
        current = {
          ts: normalizeDateText(dateText ?? ""),
          sender_name: (name ?? "").trim(),
          sender: /^(我|me)$/i.test((name ?? "").trim()) ? "me" : "her",
          type: "text",
          content: content ?? "",
        };
        out.push(current);
      } else if (current) {
        current.content = `${current.content ?? ""}\n${line}`.trim();
      }
    }
    return out;
  }
}
