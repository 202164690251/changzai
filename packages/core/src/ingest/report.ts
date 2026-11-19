// 常在 · 数据体检报告（02 §4.4）
// 纯函数：输入归一化消息，输出报告；不读文件、不联网。

import type {
  FidelityLevel,
  HealthReport,
  NormalizedMessage,
} from "@veyrimi/shared";
import { FIDELITY_THRESHOLDS, INGEST } from "@veyrimi/shared";
import { sortMessages } from "./schema.ts";

export interface HealthReportOptions {
  /** 冲突/甜蜜 episode 数（Step 3 才有；Step 1 报告传 0 并注明） */
  conflictEpisodes?: number;
  sweetEpisodes?: number;
  now?: number;
}

function isNight(ts: number): boolean {
  const h = new Date(ts).getHours();
  return h >= INGEST.minNightHour || h < INGEST.maxNightHourExclusive;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    const a = sorted[mid - 1] ?? 0;
    const b = sorted[mid] ?? 0;
    return Math.round(((a + b) / 2) * 10) / 10;
  }
  return sorted[mid] ?? 0;
}

/** 02 §4.4 的启发式公式（0–100） */
export function fidelityScore(input: {
  herMessages: number;
  spanDays: number;
  nightRatio: number;
  conflictEpisodes: number;
  hasVoice: boolean;
}): number {
  const { herMessages, spanDays, nightRatio, conflictEpisodes, hasVoice } = input;
  const score =
    40 * Math.min(herMessages / 8000, 1) +
    20 * Math.min(spanDays / 730, 1) +
    15 * Math.min(nightRatio / 0.3, 1) +
    15 * Math.min(conflictEpisodes / 20, 1) +
    10 * (hasVoice ? 1 : 0);
  return Math.max(0, Math.min(100, Math.round(score)));
}

export function fidelityLevel(score: number): FidelityLevel {
  if (score < FIDELITY_THRESHOLDS.low) return "low";
  if (score <= FIDELITY_THRESHOLDS.medium) return "medium";
  return "high";
}

/** 找出超过 30 天的记录空洞（粗粒度，后续可按月聚合） */
export function findGaps(messages: NormalizedMessage[], minGapDays = 30): string[] {
  const sorted = sortMessages(messages);
  const gaps: string[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const cur = sorted[i];
    if (!prev || !cur) continue;
    const days = (cur.ts - prev.ts) / 86_400_000;
    if (days >= minGapDays) {
      gaps.push(`${formatMonth(prev.ts)} 至 ${formatMonth(cur.ts)} 无记录（${Math.round(days)} 天）`);
    }
  }
  return gaps;
}

function formatMonth(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function buildHealthReport(
  allMessages: NormalizedMessage[],
  options: HealthReportOptions = {},
): HealthReport {
  const holdout = allMessages.filter((m) => m.is_holdout === 1);
  const messages = sortMessages(allMessages.filter((m) => m.is_holdout === 0));
  const her = messages.filter((m) => m.sender === "her");
  const herText = her.filter((m) => m.type === "text");
  const total = messages.length;
  const first = messages[0];
  const last = messages[messages.length - 1];
  const spanDays = first && last ? Math.max(1, Math.round((last.ts - first.ts) / 86_400_000)) : 0;
  const nightRatio = her.length === 0 ? 0 : her.filter((m) => isNight(m.ts)).length / her.length;
  const avgLen =
    herText.length === 0
      ? 0
      : Math.round((herText.reduce((sum, m) => sum + m.content.length, 0) / herText.length) * 10) / 10;
  const burstP50 = median(her.map((m) => m.burst_size));
  const hasVoice = her.some((m) => m.type === "voice" || m.media_path?.match(/\.(mp3|wav|silk|amr)$/i));
  const hasImage = her.some((m) => m.type === "image" || m.media_path?.match(/\.(jpg|jpeg|png|gif|webp)$/i));
  const conflictEpisodes = options.conflictEpisodes ?? 0;
  const sweetEpisodes = options.sweetEpisodes ?? 0;
  const score = fidelityScore({
    herMessages: her.length,
    spanDays,
    nightRatio,
    conflictEpisodes,
    hasVoice: Boolean(hasVoice),
  });
  const level = fidelityLevel(score);
  const missing = findGaps(messages);

  let advice = "数据量偏少，建议进入轻度模式：只启用风格卡与检索，不启用冲突能力。";
  if (level === "medium") {
    advice = "数据可支撑标准模式。若想更像，补充深夜对话与争吵片段（最能体现真实反应）。";
  } else if (level === "high") {
    advice = "数据可支撑高保真模式。建议补充分手前后 30 天的记录，情绪弧线会更完整。";
  }
  if (!hasVoice) advice += " 缺语音样本：语音克隆（V2）将不可用，但不影响 MVP。";

  return {
    total_msgs: total,
    her_msgs: her.length,
    span_days: spanDays,
    night_ratio: Math.round(nightRatio * 1000) / 1000,
    avg_len: avgLen,
    burst_p50: burstP50,
    conflict_episodes: conflictEpisodes,
    sweet_episodes: sweetEpisodes,
    has_voice: Boolean(hasVoice),
    has_image: Boolean(hasImage),
    fidelity_estimate: score,
    fidelity_level: level,
    missing,
    advice,
    meta: {
      algorithm: "fidelity_v1",
      built_at: options.now ?? Date.now(),
      holdout_count: holdout.length,
    },
  };
}
