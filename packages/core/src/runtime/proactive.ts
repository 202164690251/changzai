// Step 5 · 主动消息（T38，PC v0）
//
// 欲望 × 机会 → 是否发、何时发；预算（日 3 / 周 12 / 免打扰 / 连续未回降频）。
// 真正的托盘定时器由 Rust/宿主负责；本模块只做纯逻辑决策。

export interface ProactiveState {
  enabled: boolean;
  /** 免打扰开始/结束小时（支持跨午夜，如 23 → 8） */
  dndStart: number;
  dndEnd: number;
  dailyLimit: number;
  weeklyLimit: number;
  sentToday: number;
  sentWeek: number;
  lastSentAt: number;
  lastUserAt: number;
  consecutiveNoReply: number;
}

export interface ProactivePlan {
  shouldSend: boolean;
  reason: string;
  desire: number;
  opportunity: number;
  score: number;
}

export const DEFAULT_PROACTIVE_STATE: ProactiveState = {
  enabled: false,
  dndStart: 23,
  dndEnd: 8,
  dailyLimit: 3,
  weeklyLimit: 12,
  sentToday: 0,
  sentWeek: 0,
  lastSentAt: 0,
  lastUserAt: 0,
  consecutiveNoReply: 0,
};

export function inDnd(hour: number, start: number, end: number): boolean {
  if (start === end) return false;
  if (start < end) return hour >= start && hour < end;
  return hour >= start || hour < end;
}

function dayStart(now: number): number {
  const date = new Date(now);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/** 把跨天的计数归零（调用方在 plan 前执行） */
export function normalizeProactiveState(state: ProactiveState, now: number): ProactiveState {
  const day = dayStart(now);
  const sentToday = state.lastSentAt >= day ? state.sentToday : 0;
  const weekStart = day - 6 * 86_400_000;
  const sentWeek = state.lastSentAt >= weekStart ? state.sentWeek : 0;
  return { ...state, sentToday, sentWeek };
}

export interface PlanOptions {
  /** 最小空闲分钟数，默认 45 */
  minIdleMinutes?: number;
  /** 允许发送的时段（小时） */
  activeStart?: number;
  activeEnd?: number;
}

export function planProactive(
  input: ProactiveState,
  now = Date.now(),
  options: PlanOptions = {},
): ProactivePlan {
  const state = normalizeProactiveState(input, now);
  const idleMinutes = state.lastUserAt > 0 ? (now - state.lastUserAt) / 60_000 : 999;
  const hour = new Date(now).getHours();
  const minIdle = options.minIdleMinutes ?? 45;
  const activeStart = options.activeStart ?? 9;
  const activeEnd = options.activeEnd ?? 23;

  const desire = Math.min(1, idleMinutes / 360);
  const evening = hour >= 19 && hour <= 22;
  const opportunity = inDnd(hour, state.dndStart, state.dndEnd)
    ? 0
    : evening
      ? 1
      : hour >= activeStart && hour < activeEnd
        ? 0.6
        : 0.2;
  const score = desire * 0.65 + opportunity * 0.35;

  if (!state.enabled) return { shouldSend: false, reason: "主动消息未开启", desire, opportunity, score };
  if (inDnd(hour, state.dndStart, state.dndEnd)) {
    return { shouldSend: false, reason: "免打扰时段", desire, opportunity, score };
  }
  if (state.sentToday >= state.dailyLimit) {
    return { shouldSend: false, reason: "今天主动额度已用完", desire, opportunity, score };
  }
  if (state.sentWeek >= state.weeklyLimit) {
    return { shouldSend: false, reason: "本周主动额度已用完", desire, opportunity, score };
  }
  if (idleMinutes < minIdle) {
    return { shouldSend: false, reason: `刚聊过，再等等（${Math.round(idleMinutes)} 分钟）`, desire, opportunity, score };
  }
  if (state.consecutiveNoReply >= 2 && score < 0.75) {
    return { shouldSend: false, reason: "对方连续没回，先降频", desire, opportunity, score };
  }
  if (score < 0.45) {
    return { shouldSend: false, reason: "现在没什么可说的", desire, opportunity, score };
  }
  return {
    shouldSend: true,
    reason: evening ? "晚上有空，想问问你在干嘛" : "有一阵没说话了",
    desire,
    opportunity,
    score,
  };
}

export function recordProactiveSent(state: ProactiveState, now: number): ProactiveState {
  const normalized = normalizeProactiveState(state, now);
  return {
    ...normalized,
    sentToday: normalized.sentToday + 1,
    sentWeek: normalized.sentWeek + 1,
    lastSentAt: now,
  };
}

export function recordUserReply(state: ProactiveState, now: number): ProactiveState {
  return normalizeProactiveState(
    {
      ...state,
      lastUserAt: now,
      consecutiveNoReply: 0,
    },
    now,
  );
}
