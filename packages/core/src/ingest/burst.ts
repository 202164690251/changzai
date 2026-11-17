// 常在 · 行为信号补全：burst（连发）与 latency（响应延迟）
// 依据 02 §4.2：同一发送者相邻间隔 <90s 记为一次连发；latency = 本条 ts - 上一条"对方"消息 ts，上限 86400s。

import type { NormalizedMessage } from "@changzai/shared";
import { INGEST } from "@changzai/shared";
import { sortMessages } from "./schema.ts";

/** 计算 burst_index / burst_size（返回新数组，不修改入参） */
export function computeBursts(
  messages: NormalizedMessage[],
  gapSeconds: number = INGEST.burstGapSeconds,
): NormalizedMessage[] {
  const sorted = sortMessages(messages).map((m) => ({ ...m }));
  const gapMs = gapSeconds * 1000;
  let start = -1;

  const flush = (endExclusive: number): void => {
    if (start < 0) return;
    const size = endExclusive - start;
    for (let i = start; i < endExclusive; i++) {
      const item = sorted[i];
      if (!item) continue;
      item.burst_index = i - start + 1;
      item.burst_size = size;
    }
    start = -1;
  };

  for (let i = 0; i < sorted.length; i++) {
    const cur = sorted[i];
    if (!cur) continue;
    if (start < 0) {
      start = i;
      continue;
    }
    const prev = sorted[i - 1];
    if (!prev) continue;
    const sameSender = prev.sender === cur.sender;
    const close = cur.ts - prev.ts <= gapMs;
    const eligible = cur.sender !== "system" && prev.sender !== "system";
    if (sameSender && close && eligible) {
      continue; // 继续当前 burst
    }
    flush(i);
    start = i;
  }
  flush(sorted.length);
  return sorted;
}

/** 计算 latency_s（对"上一条对方消息"的响应延迟） */
export function computeLatency(
  messages: NormalizedMessage[],
  capSeconds: number = INGEST.latencyCapSeconds,
): NormalizedMessage[] {
  const sorted = sortMessages(messages).map((m) => ({ ...m }));
  let lastMe: NormalizedMessage | null = null;
  let lastHer: NormalizedMessage | null = null;
  for (const m of sorted) {
    if (m.sender === "her") {
      m.latency_s = lastMe ? clampSeconds((m.ts - lastMe.ts) / 1000, capSeconds) : null;
      lastHer = m;
    } else if (m.sender === "me") {
      m.latency_s = lastHer ? clampSeconds((m.ts - lastHer.ts) / 1000, capSeconds) : null;
      lastMe = m;
    } else {
      m.latency_s = null;
    }
  }
  return sorted;
}

function clampSeconds(value: number, cap: number): number {
  if (!Number.isFinite(value)) return cap;
  return Math.max(0, Math.min(cap, Math.round(value)));
}

/** 一次补全 burst + latency（Step 2 导入流水线调用） */
export function fillBehaviorSignals(messages: NormalizedMessage[]): NormalizedMessage[] {
  return computeLatency(computeBursts(messages));
}
