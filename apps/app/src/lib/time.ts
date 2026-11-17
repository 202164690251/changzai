// 常在 · 时间展示（会话列表 / 时间分隔 / 语音时长）

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_LABELS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"] as const;

function pad(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

function daysBetween(then: number, now: number): number {
  return Math.round((startOfDay(new Date(now)) - startOfDay(new Date(then))) / DAY_MS);
}

export function formatClock(ts: number): string {
  const date = new Date(ts);
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** 会话列表右上角：今天显示时间，昨天显示「昨天」，更早显示日期。 */
export function formatConversationTime(ts: number, now: number = Date.now()): string {
  const date = new Date(ts);
  const diff = daysBetween(ts, now);
  if (diff <= 0) return formatClock(ts);
  if (diff === 1) return "昨天";
  if (diff < 7) return WEEK_LABELS[date.getDay()] ?? "";
  if (date.getFullYear() === new Date(now).getFullYear()) {
    return `${date.getMonth() + 1}月${date.getDate()}日`;
  }
  return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}`;
}

/** 消息列表里的居中时间分隔。 */
export function formatTimeDivider(ts: number, now: number = Date.now()): string {
  const date = new Date(ts);
  const diff = daysBetween(ts, now);
  if (diff <= 0) return formatClock(ts);
  if (diff === 1) return `昨天 ${formatClock(ts)}`;
  if (date.getFullYear() === new Date(now).getFullYear()) {
    return `${date.getMonth() + 1}月${date.getDate()}日 ${formatClock(ts)}`;
  }
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日 ${formatClock(ts)}`;
}

/** 语音时长，微信用双引号秒数：3″ */
export function formatDuration(seconds: number): string {
  const value = Math.max(1, Math.round(seconds));
  return `${value}″`;
}
