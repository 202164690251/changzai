// Step 4 · 记忆检索与四层装配（纯 TS，v0）
//
// L0 最近对话 / L1 摘要 + 未闭合话题 / L2 top5 相关记忆 / L3 关系状态
// 检索：中文 2-gram + 词重叠 + 时间衰减 + 重要性 + 情绪一致加权。
// 说明：SQLite 已有 memory/memory_fts 表；本模块是纯函数，Rust 侧返回候选后在这里重排。

import type { EmotionState } from "../emotion/state.ts";

export interface MemoryCandidate {
  id: string;
  text: string;
  ts: number;
  importance?: number;
  valence?: number | null;
}

export interface ScoredMemory extends MemoryCandidate {
  score: number;
  reasons: string[];
}

export interface OpenLoop {
  id: string;
  content: string;
  created_ts: number;
  last_ts: number;
  status: "open" | "resolved" | "expired";
}

const STOP_WORDS = new Set([
  "这个",
  "那个",
  "什么",
  "怎么",
  "就是",
  "然后",
  "还是",
  "可以",
  "我们",
  "你们",
  "他们",
  "一个",
  "没有",
  "不是",
]);

/** 中文按 2-gram，英文/数字按词；返回去重 token */
export function queryTokens(text: string): string[] {
  const cleaned = text.toLowerCase().replace(/[\s，。！？、,.!?~～…「」“”"'':：;；]/g, "");
  const tokens = new Set<string>();
  for (const word of text.toLowerCase().match(/[a-z0-9]{2,}/g) ?? []) {
    if (!STOP_WORDS.has(word)) tokens.add(word);
  }
  const chars = Array.from(cleaned);
  for (let i = 0; i + 1 < chars.length; i += 1) {
    const gram = `${chars[i]}${chars[i + 1]}`;
    if (!STOP_WORDS.has(gram)) tokens.add(gram);
  }
  return [...tokens];
}

function overlap(tokens: string[], text: string): number {
  if (tokens.length === 0) return 0;
  const lower = text.toLowerCase();
  let hit = 0;
  for (const token of tokens) {
    if (lower.includes(token)) hit += 1;
  }
  return hit / tokens.length;
}

export interface RetrieveOptions {
  topK?: number;
  now?: number;
  /** 记忆半衰期（天） */
  halfLifeDays?: number;
}

export function retrieveMemories(
  candidates: MemoryCandidate[],
  query: string,
  state: EmotionState,
  options: RetrieveOptions = {},
): ScoredMemory[] {
  const topK = options.topK ?? 5;
  const now = options.now ?? Date.now();
  const halfLifeDays = options.halfLifeDays ?? 14;
  const tokens = queryTokens(query);
  const scored: ScoredMemory[] = candidates.map((candidate) => {
    const relevance = overlap(tokens, candidate.text);
    const ageDays = Math.max(0, (now - candidate.ts) / 86_400_000);
    const recency = Math.pow(0.5, ageDays / halfLifeDays);
    const importance = Math.min(1, Math.max(0, candidate.importance ?? 0.5));
    const valence = candidate.valence ?? 0;
    const congruence = 1 - Math.abs(valence - state.valence) / 2;
    const score = relevance * 0.62 + recency * 0.18 + importance * 0.12 + congruence * 0.08;
    const reasons: string[] = [];
    if (relevance > 0) reasons.push(`相关 ${(relevance * 100).toFixed(0)}%`);
    if (recency > 0.5) reasons.push("较近");
    if (importance >= 0.8) reasons.push("重要");
    return { ...candidate, score, reasons };
  });
  return scored
    .filter((memory) => memory.score > 0.12 || tokens.length === 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}

/** 从聊天记录里找「没有闭环」的话题：提问、约定、下次、回头等 */
export function detectOpenLoops(
  messages: Array<{ from: "her" | "me" | "system"; text: string; ts: number }>,
  now = Date.now(),
): OpenLoop[] {
  const loops: OpenLoop[] = [];
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    if (!message || message.from !== "me") continue;
    const text = message.text.trim();
    if (text.length < 4 || text.length > 60) continue;
    const isLoop = /[?？]|吗|什么时候|要不要|能不能|下次|回头|改天|再说|等你|记得/.test(text);
    if (!isLoop) continue;
    const tokens = queryTokens(text).slice(0, 6);
    let resolved = false;
    for (let next = index + 1; next < Math.min(messages.length, index + 5); next += 1) {
      const reply = messages[next];
      if (!reply || reply.from === "me") continue;
      if (overlap(tokens, reply.text) > 0.3) {
        resolved = true;
        break;
      }
    }
    if (resolved) continue;
    loops.push({
      id: `loop_${message.ts}_${index}`,
      content: text,
      created_ts: message.ts,
      last_ts: message.ts,
      status: now - message.ts > 7 * 86_400_000 ? "expired" : "open",
    });
  }
  return loops.slice(-8);
}

export function expireLoops(loops: OpenLoop[], now = Date.now()): OpenLoop[] {
  return loops.map((loop) =>
    loop.status === "open" && now - loop.created_ts > 7 * 86_400_000
      ? { ...loop, status: "expired" }
      : loop,
  );
}

export interface MemoryLayers {
  l0_recent: string;
  l1_summary: string;
  l2_memories: string;
  l3_relationship: string;
}

export interface AssembleOptions {
  recent: Array<{ from: "her" | "me"; text: string; ts?: number }>;
  summary?: string;
  openLoops?: OpenLoop[];
  memories: ScoredMemory[];
  state: EmotionState;
  maxChars?: number;
}

export interface MemoryContext {
  text: string;
  layers: MemoryLayers;
  estimatedTokens: number;
  dropped: number;
}

/** 四层记忆装配；默认预算 3000 字符（中文约等于 1 token/字） */
export function assembleMemoryContext(options: AssembleOptions): MemoryContext {
  const maxChars = options.maxChars ?? 3000;
  let dropped = 0;

  const l0All = options.recent
    .slice(-10)
    .map((message) => `${message.from === "her" ? "ta" : "我"}：${message.text}`)
    .join("\n");
  let l0 = l0All;
  if (l0.length > maxChars * 0.35) {
    l0 = l0.slice(-Math.floor(maxChars * 0.35));
    dropped += 1;
  }

  const loops = (options.openLoops ?? []).filter((loop) => loop.status === "open");
  const l1Lines = [
    options.summary ? `关系摘要：${options.summary}` : "",
    loops.length > 0 ? `还没聊完：${loops.slice(0, 3).map((loop) => loop.content).join("；")}` : "",
  ].filter((line) => line.length > 0);
  const l1 = l1Lines.join("\n");

  const l2Lines = options.memories
    .slice(0, 5)
    .map((memory) => `- ${memory.text}`)
    .filter((line) => line.length > 0);
  let l2 = l2Lines.join("\n");
  while (l2.length > maxChars * 0.4 && l2Lines.length > 1) {
    l2Lines.pop();
    dropped += 1;
    l2 = l2Lines.join("\n");
  }

  const l3 = `关系状态：亲近度 ${options.state.closeness.toFixed(2)}，紧张度 ${options.state.tension.toFixed(
    2,
  )}，天气 ${options.state.weather}。`;

  let text = [
    l1 ? `【L1 摘要/未闭合】\n${l1}` : "",
    l2 ? `【L2 相关记忆】\n${l2}` : "",
    l3 ? `【L3 关系状态】\n${l3}` : "",
    l0 ? `【L0 最近对话】\n${l0}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  // 总预算兜底：从 L0 开始丢，保留关系与 top 记忆
  while (text.length > maxChars && l0.length > 40) {
    l0 = l0.slice(40);
    dropped += 1;
    text = [l1 ? `【L1 摘要/未闭合】\n${l1}` : "", l2 ? `【L2 相关记忆】\n${l2}` : "", l3 ? `【L3 关系状态】\n${l3}` : "", l0 ? `【L0 最近对话】\n${l0}` : ""]
      .filter(Boolean)
      .join("\n\n");
  }

  return {
    text,
    layers: { l0_recent: l0, l1_summary: l1, l2_memories: l2, l3_relationship: l3 },
    estimatedTokens: Math.ceil(text.length * 0.9),
    dropped,
  };
}
