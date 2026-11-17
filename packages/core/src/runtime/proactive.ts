// Step 5/6 · 主动消息：三档欲望 + 可关闭免打扰 + 秒级频率
//
// 设计目标：用户不需要理解“欲望 × 机会”的公式；选一个档位，或者全部自定义。
// dailyLimit / weeklyLimit = 0 表示无上限；minIdleSeconds / checkIntervalSeconds 均为秒。

export type ProactiveDesire = "low" | "medium" | "high" | "custom";

export interface ProactiveState {
  enabled: boolean;
  desireLevel: ProactiveDesire;
  desireFactor: number;
  dndEnabled: boolean;
  dndStart: number;
  dndEnd: number;
  /** 0 = 无上限 */
  dailyLimit: number;
  /** 0 = 无上限 */
  weeklyLimit: number;
  minIdleSeconds: number;
  checkIntervalSeconds: number;
  triggerThreshold: number;
  noReplyLimit: number;
  /** 手动暂停到某个时间戳；0 = 未暂停 */
  pausedUntil: number;
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

export interface ProactivePreset {
  id: Exclude<ProactiveDesire, "custom">;
  label: string;
  description: string;
  desireFactor: number;
  dailyLimit: number;
  weeklyLimit: number;
  minIdleSeconds: number;
  checkIntervalSeconds: number;
  dndEnabled: boolean;
  dndStart: number;
  dndEnd: number;
  triggerThreshold: number;
  noReplyLimit: number;
}

export const PROACTIVE_PRESETS: Record<Exclude<ProactiveDesire, "custom">, ProactivePreset> = {
  low: {
    id: "low",
    label: "克制",
    description: "偶尔想起你；每天最多 2 条，夜里不打扰",
    desireFactor: 0.7,
    dailyLimit: 2,
    weeklyLimit: 8,
    minIdleSeconds: 120,
    checkIntervalSeconds: 30,
    dndEnabled: true,
    dndStart: 23,
    dndEnd: 8,
    triggerThreshold: 0.6,
    noReplyLimit: 1,
  },
  medium: {
    id: "medium",
    label: "日常",
    description: "默认；每天最多 8 条，像一个会想起你的人",
    desireFactor: 1,
    dailyLimit: 8,
    weeklyLimit: 48,
    minIdleSeconds: 30,
    checkIntervalSeconds: 15,
    dndEnabled: true,
    dndStart: 23,
    dndEnd: 8,
    triggerThreshold: 0.35,
    noReplyLimit: 2,
  },
  high: {
    id: "high",
    label: "黏人",
    description: "更频繁；每天最多 16 条，尽量像真人随手发消息",
    desireFactor: 1.35,
    dailyLimit: 16,
    weeklyLimit: 120,
    minIdleSeconds: 10,
    checkIntervalSeconds: 8,
    dndEnabled: true,
    dndStart: 1,
    dndEnd: 7,
    triggerThreshold: 0.2,
    noReplyLimit: 3,
  },
};

function stripPreset(preset: ProactivePreset): Omit<
  ProactiveState,
  "enabled" | "desireLevel" | "sentToday" | "sentWeek" | "lastSentAt" | "lastUserAt" | "consecutiveNoReply" | "pausedUntil"
> {
  const { id: _id, label: _label, description: _description, ...values } = preset;
  return values;
}

export const DEFAULT_PROACTIVE_STATE: ProactiveState = {
  enabled: false,
  desireLevel: "medium",
  ...stripPreset(PROACTIVE_PRESETS.medium),
  pausedUntil: 0,
  sentToday: 0,
  sentWeek: 0,
  lastSentAt: 0,
  lastUserAt: 0,
  consecutiveNoReply: 0,
};

export function applyProactivePreset(state: ProactiveState, level: ProactiveDesire): ProactiveState {
  if (level === "custom") return { ...state, desireLevel: "custom" };
  return {
    ...state,
    desireLevel: level,
    ...stripPreset(PROACTIVE_PRESETS[level]),
  };
}

export function inDnd(hour: number, start: number, end: number): boolean {
  if (start === end) return false;
  if (start < end) return hour >= start && hour < end;
  return hour >= start || hour < end;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
}

function dayStart(now: number): number {
  const date = new Date(now);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

export function normalizeProactiveState(state: ProactiveState, now: number): ProactiveState {
  const day = dayStart(now);
  const sentToday = state.lastSentAt >= day ? state.sentToday : 0;
  const weekStart = day - 6 * 86_400_000;
  const sentWeek = state.lastSentAt >= weekStart ? state.sentWeek : 0;
  return {
    ...state,
    sentToday,
    sentWeek,
    dailyLimit: Math.round(clamp(state.dailyLimit, 0, 200)),
    weeklyLimit: Math.round(clamp(state.weeklyLimit, 0, 2000)),
    minIdleSeconds: Math.round(clamp(state.minIdleSeconds, 1, 86_400)),
    checkIntervalSeconds: Math.round(clamp(state.checkIntervalSeconds, 3, 3600)),
    triggerThreshold: clamp(state.triggerThreshold, 0.02, 0.95),
    desireFactor: clamp(state.desireFactor, 0.1, 2),
    dndStart: Math.round(clamp(state.dndStart, 0, 23)),
    dndEnd: Math.round(clamp(state.dndEnd, 0, 23)),
    noReplyLimit: Math.round(clamp(state.noReplyLimit, 1, 20)),
    pausedUntil: Math.max(0, state.pausedUntil || 0),
  };
}

export interface PlanOptions {
  minIdleSeconds?: number;
}

export function planProactive(
  input: ProactiveState,
  now = Date.now(),
  options: PlanOptions = {},
): ProactivePlan {
  const state = normalizeProactiveState(input, now);
  const idleSeconds = state.lastUserAt > 0 ? (now - state.lastUserAt) / 1000 : 999_999;
  const hour = new Date(now).getHours();
  const minIdle = options.minIdleSeconds ?? state.minIdleSeconds;

  const desire = Math.min(1, idleSeconds / Math.max(1, minIdle * 3)) * state.desireFactor;
  const evening = hour >= 19 && hour <= 22;
  const opportunity = state.dndEnabled && inDnd(hour, state.dndStart, state.dndEnd) ? 0 : evening ? 1 : 0.55;
  const score = Math.min(1, desire * 0.65 + opportunity * 0.35);

  if (!state.enabled) return { shouldSend: false, reason: "主动消息未开启", desire, opportunity, score };
  if (state.pausedUntil > now) {
    return { shouldSend: false, reason: `已暂停到 ${new Date(state.pausedUntil).toLocaleString()}`, desire, opportunity, score };
  }
  if (state.dndEnabled && inDnd(hour, state.dndStart, state.dndEnd)) {
    return { shouldSend: false, reason: "免打扰时段", desire, opportunity, score };
  }
  if (state.dailyLimit > 0 && state.sentToday >= state.dailyLimit) {
    return { shouldSend: false, reason: "今天主动额度已用完", desire, opportunity, score };
  }
  if (state.weeklyLimit > 0 && state.sentWeek >= state.weeklyLimit) {
    return { shouldSend: false, reason: "本周主动额度已用完", desire, opportunity, score };
  }
  if (idleSeconds < minIdle) {
    return { shouldSend: false, reason: `刚聊过，再等 ${Math.max(1, Math.round(minIdle - idleSeconds))} 秒`, desire, opportunity, score };
  }
  if (state.consecutiveNoReply >= state.noReplyLimit) {
    return { shouldSend: false, reason: "对方连续没回，先停一停", desire, opportunity, score };
  }
  if (score < state.triggerThreshold) {
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
    { ...state, lastUserAt: now, consecutiveNoReply: 0 },
    now,
  );
}

export function recordProactiveIgnored(state: ProactiveState): ProactiveState {
  return { ...state, consecutiveNoReply: state.consecutiveNoReply + 1 };
}
