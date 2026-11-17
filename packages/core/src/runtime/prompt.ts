// Step 4 · 对话运行时 prompt（人格卡 + 情绪 + Arc + Governor + 四层记忆 + 事实锁）
import type { PersonaProfile } from "../persona/types.ts";
import { buildSystemPrompt, type ChatHistoryItem, type OpenAiMessage, type PersonaPromptOptions } from "../persona/prompt.ts";
import { describeEmotion, type EmotionState } from "../emotion/state.ts";
import { describeArc, type ArcPlan } from "../arc/director.ts";
import type { GovernorDecision } from "../governor/comfort.ts";
import type { GuardResult } from "../safety/factGuard.ts";
import { assembleMemoryContext, type OpenLoop, type ScoredMemory } from "../memory/index.ts";

export interface RuntimePromptOptions {
  persona: PersonaProfile;
  emotion: EmotionState;
  arc: ArcPlan;
  governor: GovernorDecision;
  guard: GuardResult;
  memories: ScoredMemory[];
  openLoops: OpenLoop[];
  summary?: string;
  profile?: PersonaPromptOptions;
  /** 最近对话（不含当前输入） */
  history: ChatHistoryItem[];
  userText: string;
  maxMemoryChars?: number;
}

export interface RuntimePromptResult {
  messages: OpenAiMessage[];
  memoryTokens: number;
  memoryDropped: number;
  systemPrompt: string;
}

/** 在人格卡 prompt 后追加状态/场次/记忆/安全约束 */
export function buildRuntimeMessages(options: RuntimePromptOptions): RuntimePromptResult {
  const base = buildSystemPrompt(options.persona, options.profile);
  const memory = assembleMemoryContext({
    recent: options.history
      .filter((item) => item.from !== "system" && item.text.trim().length > 0)
      .slice(-10)
      .map((item) => ({ from: item.from === "her" ? "her" : "me", text: item.text })),
    summary: options.summary,
    openLoops: options.openLoops,
    memories: options.memories,
    state: options.emotion,
    maxChars: options.maxMemoryChars ?? 2200,
  });

  const sections = [
    base,
    "",
    "【当前状态】",
    `- ${describeEmotion(options.emotion)}`,
    `- ${describeArc(options.arc)}`,
  ];
  if (options.governor.promptNote) {
    sections.push("", "【安全 Governor】", `- ${options.governor.promptNote}`);
  }
  if (options.guard.note) {
    sections.push("", "【事实锁约束】", `- ${options.guard.note}`);
  }
  sections.push("", "【记忆（按相关度排序，不要逐字复述）】", memory.text || "（暂无）");
  if (options.arc.scene === "reconcile") {
    sections.push("", `【和解场次】还剩 ${options.arc.stepDownRemaining} 轮递台阶；不要翻旧账。`);
  }

  const systemPrompt = sections.join("\n");
  const historyMessages: OpenAiMessage[] = options.history
    .filter((item) => item.from !== "system" && item.text.trim().length > 0)
    .slice(-20)
    .map((item) => ({
      role: item.from === "her" ? "assistant" : "user",
      content: item.text.trim(),
    }));

  return {
    messages: [
      { role: "system", content: systemPrompt },
      ...historyMessages,
      { role: "user", content: options.userText.trim() },
    ],
    memoryTokens: memory.estimatedTokens,
    memoryDropped: memory.dropped,
    systemPrompt,
  };
}
