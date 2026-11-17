// Step 5/6 · 主动消息（T38）：用户可调参数 + 三档欲望
//
// 欲望 × 机会 → 是否发；所有预算/免打扰/空闲/检查频率都可配置。
// 真正的托盘定时器由宿主负责；本模块只做纯逻辑决策。

export type ProactiveDesire = "low" | "medium" | "high" | "custom";

export interface ProactiveState {
  enabled: boolean;
  /** 三档欲望 + 自定义 */
  desireLevel: ProactiveDesire;
  /** 欲望系数：高欲望更容易达到阈值 */
  desireFactor: number;
  /** 免打扰开始/结束小时（支持跨午夜，如 23 → 8；start=end 表示关闭） */
  dndStart: number;
  dndEnd: number;
  /** 允许主动发送的时段（小时） */
  activeStart: number;
  activeEnd: number;
  dailyLimit: number;
  weeklyLimit: number;
  /** 距离用户最后一条消息至少多少分钟 */
  minIdleMinutes: number;
  /** 前端检查间隔（分钟） */
  checkIntervalMinutes: number;
  /** 触发阈值 0..1；越低越容易主动 */
  triggerThreshold: number;
  /** 连续多少次主动没得到回复就停 */
  noReplyLimit: number;
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
  minIdleMinutes: number;
  checkIntervalMinutes: number;
  dndStart: number;
  dndEnd: number;
  activeStart: number;
  activeEnd: number;
  triggerThreshold: number;
  noReplyLimit: number;
}

export const PROACTIVE_PRESETS: Record<Exclude<ProactiveDesire, "custom">, ProactivePreset> = {
  low: {
    id: "low",
    label: "克制",
    description: "偶尔想起你；每天最多 1 条，夜里不打扰",
    desireFactor: 0.6,
    dailyLimit: 1,
    weeklyLimit: 4,
    minIdleMinutes: 180,
    checkIntervalMinutes: 5,
    dndStart: 22,
    dndEnd: 9,
    activeStart: 10,
    activeEnd: 22,
    triggerThreshold: 0.62,
    noReplyLimit: 1,
  },
  medium: {
    id: "medium",
    label: "适中",
    description: "默认；每天最多 3 条，晚上更活跃",
    desireFactor: 1,
    dailyLimit: 3,
    weeklyLimit: 12,
    minIdleMinutes: 45,
    checkIntervalMinutes: 2,
    dndStart: 23,
    dndEnd: 8,
    activeStart: 9,
    activeEnd: 23,
    triggerThreshold: 0.45,
    noReplyLimit: 2,
  },
  high: {
    id: "high",
    label: "黏人",
    description: "更频繁；每天最多 6 条，但仍有免打扰",
    desireFactor: 1.4,
    dailyLimit: 6,
    weeklyLimit: 24,
    minIdleMinutes: 25,
    checkIntervalMinutes: 1,
    dndStart: 0,
    dndEnd: 7,
    activeStart: 8,
    activeEnd: 24,
    triggerThreshold: 0.32,
    noReplyLimit: 3,
  },
};

export const DEFAULT_PROACTIVE_STATE: ProactiveState = {
  enabled: false,
  desireLevel: "medium",
  ...stripPreset(PROACTIVE_PRESETS.medium),
  sentToday: 0,
  sentWeek: 0,
  lastSentAt: 0,
  lastUserAt: 0,
  consecutiveNoReply: 0,
};

function stripPreset(preset: ProactivePreset): Omit<
  ProactiveState,
  "enabled" | "desireLevel" | "sentToday" | "sentWeek" | "lastSentAt" | "lastUserAt" | "consecutiveNoReply"
> {
  const { id: _id, label: _label, description: _description, ...values } = preset;
  return values;
}

/** 选三档之一时，把可调参数替换成该档默认值；选「自定义」保留当前值 */
export function applyProactivePreset(state: ProactiveState, level: ProactiveDesire): ProactiveState {
  if (level === "custom") return { ...state, desireLevel: "custom" };
  const preset = PROACTIVE_PRESETS[level];
  return {
    ...state,
    desireLevel: level,
    ...stripPreset(preset),
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

/** 把跨天/跨周的计数归零，并夹紧用户可调参数 */
export function normalizeProactiveState(state: ProactiveState, now: number): ProactiveState {
  const day = dayStart(now);
  const sentToday = state.lastSentAt >= day ? state.sentToday : 0;
  const weekStart = day - 6 * 86_400_000;
  const sentWeek = state.lastSentAt >= weekStart ? state.sentWeek : 0;
  return {
    ...state,
    sentToday,
    sentWeek,
    dailyLimit: Math.round(clamp(state.dailyLimit, 0, 24)),
    weeklyLimit: Math.round(clamp(state.weeklyLimit, 0, 100)),
    minIdleMinutes: Math.round(clamp(state.minIdleMinutes, 5, 720)),
    checkIntervalMinutes: Math.round(clamp(state.checkIntervalMinutes, 1, 120)),
    triggerThreshold: clamp(state.triggerThreshold, 0.05, 0.95),
    noReplyLimit: Math.round(clamp(state.noReplyLimit, 1, 10)),
    desireFactor: clamp(state.desireFactor, 0.1, 2),
    dndStart: Math.round(clamp(state.dndStart, 0, 23)),
    dndEnd: Math.round(clamp(state.dndEnd, 0, 23)),
    activeStart: Math.round(clamp(state.activeStart, 0, 23)),
    activeEnd: Math.round(clamp(state.activeEnd, 1, 24)),
  };
}

export interface PlanOptions {
  /** 覆盖状态里的最小空闲分钟数（测试/临时） */
  minIdleMinutes?: number;
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
  const minIdle = options.minIdleMinutes ?? state.minIdleMinutes;
  const activeStart = options.activeStart ?? state.activeStart;
  const activeEnd = options.activeEnd ?? state.activeEnd;

  const desire = Math.min(1, idleMinutes / Math.max(1, minIdle * 3)) * state.desireFactor;
  const evening = hour >= 19 && hour <= 22;
  const opportunity = inDnd(hour, state.dndStart, state.dndEnd)
    ? 0
    : !(hour >= activeStart && hour < activeEnd)
      ? 0.1
      : evening
        ? 1
        : 0.6;
  const score = Math.min(1, desire * 0.65 + opportunity * 0.35);

  if (!state.enabled) return { shouldSend: false, reason: "主动消息未开启", desire, opportunity, score };
  if (inDnd(hour, state.dndStart, state.dndEnd)) {
    return { shouldSend: false, reason: "免打扰时段", desire, opportunity, score };
  }
  if (!(hour >= activeStart && hour < activeEnd)) {
    return { shouldSend: false, reason: "不在活跃时段", desire, opportunity, score };
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
    {
      ...state,
      lastUserAt: now,
      consecutiveNoReply: 0,
    },
    now,
  );
}

/** 用户已读但未回：用于降频 */
export function recordProactiveIgnored(state: ProactiveState): ProactiveState {
  return { ...state, consecutiveNoReply: state.consecutiveNoReply + 1 };
}
