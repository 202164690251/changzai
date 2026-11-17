// Step 3 · 人格卡数据结构（纯类型，可被 core / UI 共用）
import type { NormalizedMessage } from "@changzai/shared";

export interface PersonaStyle {
  /** 平均每条消息字数（去空白） */
  avg_len: number;
  /** ≤5 字的比例 */
  short_ratio: number;
  question_ratio: number;
  emoji_ratio: number;
  exclaim_ratio: number;
  ellipsis_ratio: number;
  night_ratio: number;
  /** 语气词频次（嗯/啊/哦…） */
  particles: Array<{ text: string; count: number }>;
  /** 高频短语（2–4 字） */
  phrases: Array<{ text: string; count: number }>;
}

export interface PersonaSample {
  ts: number;
  me: string;
  her: string;
}

export interface PersonaEpisode {
  date: string;
  count: number;
  lines: string[];
}

export interface PersonaFact {
  kind: string;
  text: string;
}

export type PersonaOrigin = "distilled" | "preset" | "custom";

export interface PersonaProfile {
  version: 1;
  /** 创建来源；旧数据缺省按 distilled 处理 */
  origin?: PersonaOrigin;
  preset_id?: string;
  custom_prompt?: string;
  built_at: number;
  source: {
    messages: number;
    her_messages: number;
    span_days: number;
  };
  style: PersonaStyle;
  samples: PersonaSample[];
  episodes: PersonaEpisode[];
  facts: PersonaFact[];
  summary: string;
  /** 固定安全边界，运行时必须拼进 system prompt */
  boundaries: string[];
}

export interface PersonaBuildOptions {
  now?: number;
  maxSamples?: number;
  maxFacts?: number;
  maxEpisodes?: number;
  /** 用于测试/复现；默认排除 holdout */
  includeHoldout?: boolean;
}

export type PersonaSourceMessage = Pick<
  NormalizedMessage,
  "ts" | "sender" | "type" | "content" | "is_holdout" | "conv_id"
>;
