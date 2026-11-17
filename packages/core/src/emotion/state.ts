// Step 4 · 四轴情绪状态机（纯 TS）
//
// 四轴：valence(-1..1) / arousal(0..1) / closeness(0..1) / defensiveness(0..1)
// 派生：weather（晴/多云/雨/暴雨）+ tension（0..1）
// 纪律：
// - 惯性衰减半衰期 180min；
// - 单轮变化硬限：|Δv|≤0.35、|Δa|≤0.4、|Δc|≤0.30、|Δd|≤0.30；
// - 任何输入都不能把状态打到越界值。

export type Weather = "sunny" | "cloudy" | "rainy" | "stormy";

export interface EmotionState {
  valence: number;
  arousal: number;
  closeness: number;
  defensiveness: number;
  weather: Weather;
  tension: number;
  updated_at: number;
}

export type StimulusKind =
  | "affection"
  | "rejection"
  | "conflict"
  | "nostalgia"
  | "vulnerability"
  | "humor"
  | "question"
  | "neutral";

export const EMOTION_LIMITS = {
  valence: 1,
  arousal: 1,
  closeness: 1,
  defensiveness: 1,
  tension: 1,
} as const;

export const MAX_DELTA = {
  valence: 0.35,
  arousal: 0.4,
  closeness: 0.3,
  defensiveness: 0.3,
} as const;

export const DEFAULT_EMOTION: EmotionState = {
  valence: 0.1,
  arousal: 0.3,
  closeness: 0.5,
  defensiveness: 0.2,
  weather: "cloudy",
  tension: 0.2,
  updated_at: 0,
};

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
}

export function weatherOf(valence: number, tension: number): Weather {
  if (tension >= 0.65 || valence <= -0.55) return "stormy";
  if (valence <= -0.15 || tension >= 0.45) return "rainy";
  if (valence >= 0.45 && tension < 0.3) return "sunny";
  return "cloudy";
}

export function tensionOf(defensiveness: number, arousal: number): number {
  return clamp(defensiveness * 0.6 + arousal * 0.4, 0, 1);
}

function normalize(state: Omit<EmotionState, "weather" | "tension">): EmotionState {
  const valence = clamp(state.valence, -1, 1);
  const arousal = clamp(state.arousal, 0, 1);
  const closeness = clamp(state.closeness, 0, 1);
  const defensiveness = clamp(state.defensiveness, 0, 1);
  return {
    valence,
    arousal,
    closeness,
    defensiveness,
    weather: weatherOf(valence, tensionOf(defensiveness, arousal)),
    tension: tensionOf(defensiveness, arousal),
    updated_at: state.updated_at,
  };
}

/** 向默认状态回落；halfLifeMin 默认 180min。 */
export function decayEmotion(
  state: EmotionState,
  now: number,
  halfLifeMin = 180,
): EmotionState {
  const elapsedMin = Math.max(0, (now - state.updated_at) / 60_000);
  if (state.updated_at <= 0 || elapsedMin < 1) {
    return { ...state, updated_at: now };
  }
  const factor = Math.pow(0.5, elapsedMin / halfLifeMin);
  const target = DEFAULT_EMOTION;
  return normalize({
    valence: target.valence + (state.valence - target.valence) * factor,
    arousal: target.arousal + (state.arousal - target.arousal) * factor,
    closeness: target.closeness + (state.closeness - target.closeness) * factor,
    defensiveness: target.defensiveness + (state.defensiveness - target.defensiveness) * factor,
    updated_at: now,
  });
}

/** 把从 prev 到 next 的四个轴变化限制在硬限内。 */
export function clampTransition(prev: EmotionState, next: EmotionState): EmotionState {
  const delta = (key: keyof typeof MAX_DELTA): number => {
    const limit = MAX_DELTA[key];
    return clamp(next[key] - prev[key], -limit, limit);
  };
  return normalize({
    valence: prev.valence + delta("valence"),
    arousal: prev.arousal + delta("arousal"),
    closeness: prev.closeness + delta("closeness"),
    defensiveness: prev.defensiveness + delta("defensiveness"),
    updated_at: next.updated_at,
  });
}

const BASE_STIMULUS: Record<StimulusKind, { v: number; a: number; c: number; d: number }> = {
  affection: { v: 0.16, a: 0.08, c: 0.12, d: -0.1 },
  rejection: { v: -0.22, a: 0.12, c: -0.14, d: 0.2 },
  conflict: { v: -0.18, a: 0.22, c: -0.06, d: 0.22 },
  nostalgia: { v: 0.1, a: -0.04, c: 0.08, d: -0.06 },
  vulnerability: { v: -0.08, a: 0.06, c: 0.14, d: -0.12 },
  humor: { v: 0.12, a: 0.1, c: 0.05, d: -0.05 },
  question: { v: 0.02, a: 0.04, c: 0.02, d: 0 },
  neutral: { v: 0, a: 0, c: 0, d: 0 },
};

/**
 * 刺激 → 情绪变化。intensity 0..1。
 * 转移矩阵按「当前状态 × 刺激」做简单调制：防御高时亲密刺激效果减半；亲密度高时冲突更伤。
 */
export function applyStimulus(
  prev: EmotionState,
  kind: StimulusKind,
  intensity = 0.6,
  now = Date.now(),
): EmotionState {
  const base = BASE_STIMULUS[kind];
  const strength = clamp(intensity, 0, 1);
  const defensivenessFactor = kind === "affection" || kind === "vulnerability" ? 1 - prev.defensiveness * 0.5 : 1;
  const closenessFactor = kind === "conflict" || kind === "rejection" ? 0.6 + prev.closeness * 0.8 : 1;
  const k = strength * defensivenessFactor * closenessFactor;
  const next = normalize({
    valence: prev.valence + base.v * k,
    arousal: prev.arousal + base.a * k,
    closeness: prev.closeness + base.c * k,
    defensiveness: prev.defensiveness + base.d * k,
    updated_at: now,
  });
  return clampTransition(prev, next);
}

const AFFECTION_WORDS = /想你|喜欢你|爱你|抱抱|亲亲|宝贝|乖|好想你|想见你/;
const REJECTION_WORDS = /滚|别烦|不想理|分手|讨厌你|别联系|拉黑/;
const CONFLICT_WORDS = /你什么意思|凭什么|吵架|生气|无语|过分|你怎么这样|烦不烦/;
const NOSTALGIA_WORDS = /记得|以前|那年|曾经|回忆|那时候|从前|当时/;
const VULNERABILITY_WORDS = /累|难受|难过|哭|孤独|害怕|压力|崩溃|不开心|委屈|焦虑/;
const HUMOR_WORDS = /哈哈|笑死|逗|梗|乐死|太搞笑了|绷不住/;

/** 规则版刺激分类（Step 4 v0；后续可接 LLM 标注） */
export function classifyStimulus(text: string): StimulusKind {
  const value = text.trim();
  if (!value) return "neutral";
  if (REJECTION_WORDS.test(value)) return "rejection";
  if (CONFLICT_WORDS.test(value)) return "conflict";
  if (AFFECTION_WORDS.test(value)) return "affection";
  if (VULNERABILITY_WORDS.test(value)) return "vulnerability";
  if (NOSTALGIA_WORDS.test(value)) return "nostalgia";
  if (HUMOR_WORDS.test(value)) return "humor";
  if (/[?？]|吗|呢|什么|为什么|怎么/.test(value)) return "question";
  return "neutral";
}

/** 给 UI/调试用的可读标签 */
export function weatherLabel(weather: Weather): string {
  return { sunny: "晴", cloudy: "多云", rainy: "雨", stormy: "暴雨" }[weather];
}

/** 生成一句内部状态描述，注入 system prompt */
export function describeEmotion(state: EmotionState): string {
  const v = state.valence >= 0.3 ? "偏开心" : state.valence <= -0.3 ? "低落" : "平静";
  const c = state.closeness >= 0.7 ? "亲近" : state.closeness <= 0.3 ? "疏离" : "一般";
  const d = state.defensiveness >= 0.6 ? "戒备" : "放松";
  return `当前情绪：${v}、${c}、${d}（valence=${state.valence.toFixed(2)}，weather=${weatherLabel(
    state.weather,
  )}，tension=${state.tension.toFixed(2)}）。`;
}
