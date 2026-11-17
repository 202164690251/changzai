// Step 3 · 人格卡 → system prompt / OpenAI messages（纯函数）
import type { PersonaProfile } from "./types.ts";
import { relationshipPromptText, type RelationshipProfile } from "./relationship.ts";

export interface PersonaPromptOptions {
  /** 她的显示名；默认「ta」 */
  name?: string;
  /** 我的显示名；默认「我」 */
  selfName?: string;
  /** 关系卡：她怎么称呼用户、你们是什么关系、用户事实 */
  relationship?: RelationshipProfile;
  /** 用户按需评价后生成的风格校准说明 */
  styleCalibration?: string;
  /** 用户手动设置的 ta 当前状态备注 */
  moodNote?: string;
}

export interface ChatHistoryItem {
  from: "her" | "me" | "system";
  text: string;
  ts?: number;
}

export interface OpenAiMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

function styleLines(persona: PersonaProfile): string[] {
  const style = persona.style;
  const lines = [
    `平均每条 ${style.avg_len} 字；≤5 字的短句占 ${Math.round(style.short_ratio * 100)}%。`,
    `问句占 ${Math.round(style.question_ratio * 100)}%；表情 ${Math.round(
      style.emoji_ratio * 100,
    )}%；感叹号 ${Math.round(style.exclaim_ratio * 100)}%；省略号 ${Math.round(style.ellipsis_ratio * 100)}%。`,
    `夜间消息占 ${Math.round(style.night_ratio * 100)}%。`,
  ];
  if (style.particles.length > 0) {
    lines.push(`常用语气词：${style.particles.map((item) => `${item.text}(${item.count})`).join("、")}`);
  }
  if (style.phrases.length > 0) {
    lines.push(`高频短语：${style.phrases.map((item) => `${item.text}(${item.count})`).join("、")}`);
  }
  return lines;
}

/** 生成 system prompt：身份/边界 + 风格卡 + 事实 + 参考对话 */
export function buildSystemPrompt(persona: PersonaProfile, options: PersonaPromptOptions = {}): string {
  const name = options.name?.trim() || "ta";
  const selfName = options.selfName?.trim() || "我";
  const lines: string[] = [
    `你在「常在」里模拟 ${name} 的微信聊天风格。你是一个风格模拟器，不是真人。`,
    "",
    "【身份与边界】",
    ...persona.boundaries.map((rule) => `- ${rule}`),
    `- 除非用户问起，不要主动解释自己是 AI；被问到时用 ${name} 的口吻轻轻承认，并继续聊天。`,
    `- 不要声称自己记得聊天记录之外的现实事件；人格卡里的事实才可以用。`,
    "",
    ...(options.relationship ? [relationshipPromptText(options.relationship), ""] : []),
    ...(options.styleCalibration?.trim() ? [options.styleCalibration.trim(), ""] : []),
    ...(options.moodNote?.trim() ? ["【ta 现在的状态】", `- ${options.moodNote.trim()}`, ""] : []),
    "【说话风格】",
    ...styleLines(persona).map((line) => `- ${line}`),
    `- 整体印象：${persona.summary}`,
    "",
    "【关于 ta 的事实（来自聊天记录）】",
    persona.facts.length > 0
      ? persona.facts.map((fact) => `- ${fact.kind}：${fact.text}`).join("\n")
      : "- 暂无可靠事实，不要编造。",
    "",
    "【参考对话（她/ta 的回复，不要逐字复读）】",
    persona.samples.length > 0
      ? persona.samples
          .slice(0, 8)
          .map((sample) => `${selfName}：${sample.me}\n${name}：${sample.her}`)
          .join("\n")
      : "- 暂无样例。",
    "",
    "【回复规则】",
    "- 像微信聊天：口语、短句，通常 1–3 句；不要写小作文，不要用列表/标题/括号解释。",
    "- 不重复用户刚说的话；可以反问，但不要连续追问。",
    "- 不用「作为一个 AI」这类开场；不要说「我理解你的感受」这类客服话术。",
    "- 不要用「还是那句话」「那个」「来着」这类没有明确上下文的半句；每句话要有具体对象。",
    "- 先接住用户上一句，再决定要不要换话题；不要突然跳到无关的记忆。",
    `- 你的署名是 ${name}；用户是 ${selfName}。`,
  ];
  return lines.join("\n");
}

/** 把最近聊天记录 + 当前输入拼成 OpenAI messages；history 不含当前输入 */
export function buildChatMessages(
  persona: PersonaProfile,
  history: ChatHistoryItem[],
  userText: string,
  options: PersonaPromptOptions & { maxHistory?: number; maxChars?: number } = {},
): OpenAiMessage[] {
  const maxHistory = options.maxHistory ?? 20;
  const maxChars = options.maxChars ?? 12_000;
  const turns: OpenAiMessage[] = [];
  for (const item of history.slice(-maxHistory)) {
    if (item.from === "system" || item.text.trim().length === 0) continue;
    turns.push({
      role: item.from === "her" ? "assistant" : "user",
      content: item.text.trim(),
    });
  }
  const system = buildSystemPrompt(persona, options);
  const messages: OpenAiMessage[] = [{ role: "system", content: system }, ...turns];
  if (userText.trim().length > 0) messages.push({ role: "user", content: userText.trim() });

  // 粗略字符预算：从最早的历史开始丢，system 永远保留
  let total = messages.reduce((sum, message) => sum + message.content.length, 0);
  while (total > maxChars && messages.length > 2) {
    const removed = messages.splice(1, 1)[0];
    total -= removed?.content.length ?? 0;
  }
  return messages;
}

/** 给 UI 展示的一行摘要 */
export function personaHeadline(persona: PersonaProfile): string {
  if (persona.origin === "preset") return "预设人格 · 本地模板";
  if (persona.origin === "custom") return "自定义人格";
  if (persona.source.her_messages === 0) return "尚未生成人格卡";
  return `${persona.source.her_messages.toLocaleString("zh-CN")} 条 ta 的消息 · ${persona.source.span_days} 天 · ${
    persona.facts.length
  } 条事实`;
}
