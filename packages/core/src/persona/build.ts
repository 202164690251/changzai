// Step 3 · 从真实聊天记录构建人格卡（纯 TS，不读文件、不联网）
//
// 纪律：
// - 只使用 sender === "her" 且 type === "text" 的消息；
// - 默认排除 holdout（is_holdout = 1），避免评测集泄漏进 prompt；
// - 输出是「风格卡 + 事实 + 样例」，不是对真人的心理断言；
// - 事实只从她自己的话里抽，交给用户审阅，不编造。

import type {
  PersonaBuildOptions,
  PersonaEpisode,
  PersonaFact,
  PersonaProfile,
  PersonaSample,
  PersonaSourceMessage,
  PersonaStyle,
} from "./types.ts";

const PARTICLES = ["嗯", "啊", "哦", "呀", "吧", "呢", "啦", "嘛", "哈", "诶", "唉", "噢", "好", "行", "对", "是"];

const EMOJI_RE = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/u;

const FACT_PATTERNS: Array<{ kind: string; regex: RegExp }> = [
  { kind: "喜欢", regex: /我(?:很|最|特别)?喜欢(.{1,24}?)(?:[，。！？\n]|$)/ },
  { kind: "不喜欢", regex: /我(?:很|最|特别)?(?:不喜欢|讨厌)(.{1,24}?)(?:[，。！？\n]|$)/ },
  { kind: "在做", regex: /我(?:在|正在)(.{1,24}?)(?:[，。！？\n]|$)/ },
  { kind: "住在", regex: /我(?:住在|家在|在)(.{1,16}?)(?:[，。！？\n]|$)/ },
  { kind: "工作", regex: /我(?:是|做)(.{1,24}?)(?:[，。！？\n]|$)/ },
  { kind: "养了", regex: /我养了(.{1,20}?)(?:[，。！？\n]|$)/ },
  { kind: "害怕", regex: /我(?:有点|很|特别)?怕(.{1,20}?)(?:[，。！？\n]|$)/ },
];

function isUsable(message: PersonaSourceMessage, includeHoldout: boolean): boolean {
  return (
    message.sender === "her" &&
    message.type === "text" &&
    message.content.trim().length > 0 &&
    (includeHoldout || message.is_holdout !== 1)
  );
}

function charLength(text: string): number {
  return Array.from(text.replace(/\s/g, "")).length;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function ratio(part: number, total: number): number {
  return total === 0 ? 0 : round(part / total);
}

function topEntries(map: Map<string, number>, limit: number): Array<{ text: string; count: number }> {
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([text, count]) => ({ text, count }));
}

function ngrams(text: string): string[] {
  const cleaned = text.replace(/[\s，。！？、,.!?~～…「」“”"'':：;；]/g, "");
  const chars = Array.from(cleaned);
  const out: string[] = [];
  for (let n = 2; n <= 4; n += 1) {
    for (let i = 0; i + n <= chars.length; i += 1) {
      const gram = chars.slice(i, i + n).join("");
      if (!/^\d+$/.test(gram)) out.push(gram);
    }
  }
  return out;
}

function styleOf(her: PersonaSourceMessage[]): PersonaStyle {
  const lengths = her.map((message) => charLength(message.content));
  const total = her.length;
  const particles = new Map<string, number>();
  const phrases = new Map<string, number>();
  let questions = 0;
  let emojis = 0;
  let exclaims = 0;
  let ellipsis = 0;
  let night = 0;

  for (const message of her) {
    const text = message.content;
    if (/[?？]|吗|呢/.test(text)) questions += 1;
    if (EMOJI_RE.test(text)) emojis += 1;
    if (/[!！]/.test(text)) exclaims += 1;
    if (/…|\.\.\./.test(text)) ellipsis += 1;
    const hour = new Date(message.ts).getHours();
    if (hour >= 23 || hour < 2) night += 1;
    for (const particle of PARTICLES) {
      const count = text.split(particle).length - 1;
      if (count > 0) particles.set(particle, (particles.get(particle) ?? 0) + count);
    }
    for (const gram of ngrams(text)) {
      phrases.set(gram, (phrases.get(gram) ?? 0) + 1);
    }
  }

  return {
    avg_len: total === 0 ? 0 : round(lengths.reduce((a, b) => a + b, 0) / total),
    short_ratio: ratio(lengths.filter((len) => len <= 5).length, total),
    question_ratio: ratio(questions, total),
    emoji_ratio: ratio(emojis, total),
    exclaim_ratio: ratio(exclaims, total),
    ellipsis_ratio: ratio(ellipsis, total),
    night_ratio: ratio(night, total),
    particles: topEntries(particles, 8),
    phrases: topEntries(
      new Map([...phrases.entries()].filter(([, count]) => count >= 2)),
      10,
    ),
  };
}

function factsOf(her: PersonaSourceMessage[], max: number): PersonaFact[] {
  const found = new Map<string, PersonaFact>();
  for (const message of her) {
    for (const { kind, regex } of FACT_PATTERNS) {
      const match = message.content.match(regex);
      const value = match?.[1]?.trim();
      if (!value || value.length < 2) continue;
      const key = `${kind}:${value}`;
      if (!found.has(key)) found.set(key, { kind, text: value });
      if (found.size >= max) return [...found.values()];
    }
  }
  return [...found.values()];
}

function samplesOf(messages: PersonaSourceMessage[], max: number, includeHoldout: boolean): PersonaSample[] {
  const candidates: PersonaSample[] = [];
  for (let index = 1; index < messages.length; index += 1) {
    const her = messages[index];
    const me = messages[index - 1];
    if (!her || !me) continue;
    if (!isUsable(her, includeHoldout) || me.sender !== "me" || me.type !== "text") continue;
    const herText = her.content.trim();
    const meText = me.content.trim();
    if (herText.length < 2 || herText.length > 80 || meText.length === 0) continue;
    if (her.ts - me.ts > 30 * 60_000) continue;
    candidates.push({ ts: her.ts, me: meText.slice(0, 80), her: herText.slice(0, 120) });
  }
  if (candidates.length <= max) return candidates;
  const step = candidates.length / max;
  return Array.from({ length: max }, (_, index) => candidates[Math.floor(index * step)]).filter(
    (sample): sample is PersonaSample => sample !== undefined,
  );
}

function episodesOf(her: PersonaSourceMessage[], max: number): PersonaEpisode[] {
  const byDay = new Map<string, PersonaSourceMessage[]>();
  for (const message of her) {
    const date = new Date(message.ts);
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
      date.getDate(),
    ).padStart(2, "0")}`;
    const list = byDay.get(key) ?? [];
    list.push(message);
    byDay.set(key, list);
  }
  return [...byDay.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, max)
    .map(([date, list]) => ({
      date,
      count: list.length,
      lines: list
        .slice(0, 3)
        .map((message) => message.content.trim().slice(0, 60))
        .filter((line) => line.length > 0),
    }));
}

function summaryOf(style: PersonaStyle, facts: PersonaFact[]): string {
  if (style.avg_len === 0) return "还没有足够的 ta 的文字消息，先积累一点聊天记录再生成人格卡。";
  const lengthLabel =
    style.avg_len <= 6 ? "很短" : style.avg_len <= 12 ? "偏短" : style.avg_len <= 24 ? "适中" : "偏长";
  const particles = style.particles.slice(0, 3).map((item) => `「${item.text}」`).join("");
  const phrases = style.phrases.slice(0, 3).map((item) => `「${item.text}」`).join("");
  const parts = [`ta 说话${lengthLabel}，平均 ${style.avg_len} 字`];
  if (particles) parts.push(`常用语气词 ${particles}`);
  if (phrases) parts.push(`高频短语 ${phrases}`);
  if (style.question_ratio >= 0.2) parts.push("经常用问句");
  if (style.night_ratio >= 0.25) parts.push("夜里更活跃");
  if (facts.length > 0) parts.push(`记录里提到 ${facts.length} 条关于 ta 的事实`);
  return `${parts.join("；")}。`;
}

/** 空人格卡：导入前/数据不足时使用，prompt 会走「先聊聊」的兜底 */
export function emptyPersona(now = Date.now()): PersonaProfile {
  return {
    version: 1,
    built_at: now,
    source: { messages: 0, her_messages: 0, span_days: 0 },
    style: {
      avg_len: 0,
      short_ratio: 0,
      question_ratio: 0,
      emoji_ratio: 0,
      exclaim_ratio: 0,
      ellipsis_ratio: 0,
      night_ratio: 0,
      particles: [],
      phrases: [],
    },
    samples: [],
    episodes: [],
    facts: [],
    summary: "还没有足够的 ta 的文字消息，先积累一点聊天记录再生成人格卡。",
    boundaries: BOUNDARIES,
  };
}

export const BOUNDARIES = [
  "不冒充真人：如果用户认真问「你是不是真人」，要坦白这是 AI 模拟，不能声称自己是对方本人。",
  "不编造事实：只使用人格卡里的事实；不知道的事就说不知道，不要补细节。",
  "不输出操控话术：不制造愧疚、不鼓励依赖、不阻止用户联系现实里的人。",
  "涉及自伤/危机：明确建议联系身边的人或专业帮助，不要用角色扮演淡化风险。",
];

export function buildPersonaProfile(
  messages: PersonaSourceMessage[],
  options: PersonaBuildOptions = {},
): PersonaProfile {
  const includeHoldout = options.includeHoldout === true;
  const usable = messages.filter((message) => isUsable(message, includeHoldout));
  if (usable.length === 0) return emptyPersona(options.now ?? Date.now());

  const style = styleOf(usable);
  const facts = factsOf(usable, options.maxFacts ?? 12);
  const timestamps = usable.map((message) => message.ts).sort((a, b) => a - b);
  const first = timestamps[0] ?? 0;
  const last = timestamps[timestamps.length - 1] ?? 0;
  return {
    version: 1,
    built_at: options.now ?? Date.now(),
    source: {
      messages: messages.length,
      her_messages: usable.length,
      span_days: last > first ? Math.max(1, Math.round((last - first) / 86_400_000)) : 0,
    },
    style,
    samples: samplesOf(messages, options.maxSamples ?? 10, includeHoldout),
    episodes: episodesOf(usable, options.maxEpisodes ?? 5),
    facts,
    summary: summaryOf(style, facts),
    boundaries: BOUNDARIES,
  };
}
