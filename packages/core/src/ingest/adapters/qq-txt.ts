// 常在 · QQ 导出的 txt 适配器
// 兼容：
//   2023-05-20 14:03:22 小林(123456)
//   在干嘛
//   [2023-05-20 14:03:22] 小林
//   2023-05-20 14:03:22 小林: 在干嘛
import type { RawMessage } from "@veyrimi/shared";
import type { AdapterSource, IngestAdapter } from "./base.ts";
import { parseMultilineText, timestampLineRatio } from "./common.ts";

export class QqTxtAdapter implements IngestAdapter {
  readonly name = "qq_txt";
  readonly description = "QQ 导出的 txt（时间 + 昵称/QQ + 正文）";

  sniff(source: AdapterSource): number {
    const text = source.text ?? "";
    if (!text.trim()) return 0;
    const name = (source.fileName ?? "").toLowerCase();
    const ratio = timestampLineRatio(text);
    const qqHint = /\(\d{5,12}\)|[\[【]\d{4}[-/]\d{1,2}[-/]\d{1,2}/.test(text);
    if (!qqHint && !/qq/i.test(name)) return 0;
    return Math.min(
      0.95,
      0.32 + ratio * 0.45 + (/\.txt$/i.test(name) ? 0.1 : 0) + (/^qq/i.test(name) ? 0.12 : 0),
    );
  }

  parse(source: AdapterSource): RawMessage[] {
    return parseMultilineText(source.text ?? "", { convIdPrefix: source.fileName });
  }
}
