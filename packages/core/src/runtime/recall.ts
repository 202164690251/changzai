// Step 5 · 撤回（T31）
// 撤回不是删 UI，而是：消掉上下文、系统提示、限流、可选重发。

export interface RecallBudget {
  maxInRecent: number;
  maxPerDay: number;
  cooldownMs: number;
}

export const DEFAULT_RECALL_BUDGET: RecallBudget = {
  maxInRecent: 3,
  maxPerDay: 10,
  cooldownMs: 3000,
};

export interface RecallState {
  timestamps: number[];
}

export interface RecallCheck {
  ok: boolean;
  reason: string;
}

export function canRecall(
  state: RecallState,
  now: number,
  budget: RecallBudget = DEFAULT_RECALL_BUDGET,
): RecallCheck {
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  const daily = state.timestamps.filter((ts) => ts >= todayStart.getTime()).length;
  if (daily >= budget.maxPerDay) return { ok: false, reason: "今天撤回次数用完了" };
  const last = state.timestamps[state.timestamps.length - 1] ?? 0;
  if (now - last < budget.cooldownMs) return { ok: false, reason: "刚撤回完，等一下再试" };
  const recent = state.timestamps.filter((ts) => now - ts < 60 * 60_000).length;
  if (recent >= budget.maxInRecent) return { ok: false, reason: "这一小时内撤回太多了" };
  return { ok: true, reason: "" };
}

export function recordRecall(state: RecallState, now: number): RecallState {
  return { timestamps: [...state.timestamps, now].slice(-50) };
}

export interface RecallableMessage {
  id: string;
  from: "her" | "me" | "system";
  kind: string;
  text?: string;
  ts: number;
}

export interface RecallResult<T extends RecallableMessage> {
  messages: T[];
  recalled: T | null;
  systemNotice: RecallableMessage | null;
}

/** 撤回最后一条她的文字/图片/语音消息，并插入系统提示 */
export function recallLast<T extends RecallableMessage>(messages: T[], now = Date.now()): RecallResult<T> {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message || message.from !== "her") continue;
    const next = messages.filter((_, position) => position !== index);
    const notice: RecallableMessage = {
      id: `recall_${now}`,
      from: "system",
      kind: "text",
      text: "对方撤回了一条消息",
      ts: now,
    };
    return { messages: next, recalled: message, systemNotice: notice };
  }
  return { messages, recalled: null, systemNotice: null };
}

/** 撤回后彻底从上下文/记忆候选里剔除（按 id 与文本双保险） */
export function purgeRecalled<T extends RecallableMessage>(
  messages: T[],
  recalled: Pick<RecallableMessage, "id" | "text">,
): T[] {
  return messages.filter((message) => message.id !== recalled.id && (!recalled.text || message.text !== recalled.text));
}

/** 是否触发她的 3% 主动撤回（确定性 hash，可按会话时间变化） */
export function shouldSheRecall(text: string, now = Date.now()): boolean {
  let hash = 2166136261;
  const seed = `${text}|${Math.floor(now / 600_000)}`;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return ((hash >>> 0) % 100) < 3;
}
