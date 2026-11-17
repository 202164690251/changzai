// Step 5 · AI 味过滤器（T21）
// 目标：不改变意思，只删掉客服腔、列表腔、过度排比、破折号、套话。

export interface FilterResult {
  text: string;
  changed: boolean;
  flags: string[];
}

const PHRASE_REPLACEMENTS: Array<{ pattern: RegExp; replace: string; flag: string }> = [
  { pattern: /作为一个(?:AI|人工智能|语言模型)[，,。]?/g, replace: "", flag: "客服开场" },
  { pattern: /我(?:很)?理解你(?:的)?感受[，,。]?/g, replace: "嗯，", flag: "共情套话" },
  { pattern: /希望(?:能)?帮到你[。]?/g, replace: "", flag: "客服收尾" },
  { pattern: /首先[，,]?/g, replace: "", flag: "说教连接词" },
  { pattern: /其次[，,]?/g, replace: "", flag: "说教连接词" },
  { pattern: /总之[，,]?/g, replace: "", flag: "说教连接词" },
  { pattern: /综上所述[，,]?/g, replace: "", flag: "说教连接词" },
  { pattern: /总而言之[，,]?/g, replace: "", flag: "说教连接词" },
  { pattern: /--|—/g, replace: "，", flag: "破折号" },
  { pattern: /；/g, replace: "。", flag: "分号" },
  { pattern: /\*\*/g, replace: "", flag: "Markdown" },
  { pattern: /^#{1,6}\s+/gm, replace: "", flag: "Markdown" },
];

/** 按句切分，保留标点 */
export function splitSentences(text: string): string[] {
  return text
    .replace(/([。！？!?；;])/g, "$1\n")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/** 把过长的中文句子在逗号处折断，最多 maxLen 字 */
export function breakLongSentence(sentence: string, maxLen = 42): string[] {
  if (sentence.length <= maxLen) return [sentence];
  const parts = sentence.split(/(?<=[，,、])/);
  const out: string[] = [];
  let current = "";
  for (const part of parts) {
    if ((current + part).length > maxLen && current.length > 0) {
      out.push(current.trim());
      current = part;
    } else {
      current += part;
    }
  }
  if (current.trim().length > 0) out.push(current.trim());
  return out;
}

export function filterAiFlavor(input: string): FilterResult {
  let text = input.trim();
  const flags: string[] = [];
  if (!text) return { text: "", changed: false, flags };

  for (const rule of PHRASE_REPLACEMENTS) {
    if (rule.pattern.test(text)) {
      flags.push(rule.flag);
      text = text.replace(rule.pattern, rule.replace);
    }
  }

  // 列表/编号 → 拆成普通句子
  if (/^\s*(?:\d+[.、)]|[-*•])\s+/m.test(text)) {
    flags.push("列表腔");
    text = text
      .replace(/^\s*(?:\d+[.、)]|[-*•])\s+/gm, "")
      .replace(/\n+/g, "；");
  }

  // 句长/排比/emoji/感叹号
  const sentences = splitSentences(text);
  const broken = sentences.flatMap((sentence) => breakLongSentence(sentence));
  if (broken.length > sentences.length) flags.push("长句拆短");
  if (/(.)\1{2,}/.test(text)) flags.push("重复字符");
  const emojiCount = Array.from(text).filter((char) => /[\u{1F300}-\u{1FAFF}\u2600-\u27BF]/u.test(char)).length;
  if (emojiCount > 2) flags.push("emoji过多");
  if ((text.match(/[!！]/g) ?? []).length > 2) flags.push("感叹号过多");

  text = broken
    .join("")
    .replace(/[ \t]+/g, " ")
    .replace(/，{2,}/g, "，")
    .replace(/。{2,}/g, "。")
    .replace(/^[，。；]+/, "")
    .trim();

  return { text, changed: text !== input.trim(), flags: [...new Set(flags)] };
}

/** 硬规则文本，拼进 system prompt */
export const COMPOSE_HARD_RULES = [
  "像微信聊天：短句、口语，一次 1–3 句；不要写小作文。",
  "不要列表/标题/编号；不要 Markdown；不要破折号堆叠。",
  "不要说「作为一个 AI」「我理解你的感受」「希望能帮到你」。",
  "不要连续排比、不要总结陈词、不要用「首先/其次/总之」。",
  "emoji 最多 2 个；感叹号最多 2 个；不要客服腔。",
].join("\n");
