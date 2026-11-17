// Step 5 · Decide：是否回、延迟、分段（T22 + Emit）
//
// 纯函数、可复现：用内容 hash 代替随机数，便于单测。
// 目标不是"每条必回"，而是像真人：有时秒回，有时慢，有时已读不回。

import type { EmotionState } from "../emotion/state.ts";

export interface DecideInput {
  text: string;
  emotion: EmotionState;
  /** 当前是否忙（用户可配/默认 false） */
  busy?: boolean;
  now?: number;
  /** 距上一条用户消息的分钟数（用于连续轰炸降频） */
  minutesSinceLastUser?: number;
}

export interface DecideResult {
  reply: boolean;
  readNoReply: boolean;
  delayMs: number;
  segments: string[];
  probability: number;
  reason: string;
}

function hashText(text: string): number {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4294967295;
}

/** 按标点切成 1–3 条短消息 */
export function splitSegments(text: string, maxChars = 20, maxSegments = 3): string[] {
  const cleaned = text.trim();
  if (!cleaned) return [];
  const parts = cleaned
    .replace(/([。！？!?])/g, "$1\n")
    .split("\n")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  const merged: string[] = [];
  for (const part of parts) {
    const last = merged[merged.length - 1];
    if (last && (last + part).length <= maxChars) {
      merged[merged.length - 1] = last + part;
    } else {
      merged.push(part);
    }
  }
  const out: string[] = [];
  for (const part of merged) {
    if (part.length <= maxChars) {
      out.push(part);
      continue;
    }
    for (let start = 0; start < part.length; start += maxChars) {
      out.push(part.slice(start, start + maxChars));
    }
  }
  return out.slice(0, maxSegments);
}

export function decideReply(input: DecideInput): DecideResult {
  const now = input.now ?? Date.now();
  const text = input.text.trim();
  const random = hashText(`${text}|${Math.floor(now / 60_000)}`);

  let probability = 0.72 + input.emotion.closeness * 0.18 - input.emotion.defensiveness * 0.28;
  if (/[?？]|吗|什么|怎么|为什么/.test(text)) probability += 0.12;
  if (text.length <= 3) probability -= 0.08;
  if (input.busy) probability -= 0.25;
  if ((input.minutesSinceLastUser ?? 99) < 1) probability -= 0.12;
  probability = Math.min(0.97, Math.max(0.15, probability));

  const reply = random < probability;
  const baseDelay = 900 + Math.round(hashText(text) * 1800);
  const moodFactor = 1 + Math.max(0, 0.5 - input.emotion.valence) * 0.9;
  const busyFactor = input.busy ? 1.8 : 1;
  const delayMs = Math.round(Math.min(6000, Math.max(500, baseDelay * moodFactor * busyFactor)));

  return {
    reply,
    readNoReply: !reply,
    delayMs,
    segments: reply ? splitSegments(text) : [],
    probability,
    reason: reply
      ? `回复概率 ${(probability * 100).toFixed(0)}%，延迟 ${delayMs}ms`
      : `已读不回（回复概率仅 ${(probability * 100).toFixed(0)}%）`,
  };
}

/** 拟人延迟等待（可被 UI 取消） */
export function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("aborted", "AbortError"));
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new DOMException("aborted", "AbortError"));
      },
      { once: true },
    );
  });
}
