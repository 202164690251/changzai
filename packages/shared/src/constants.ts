// 常在 · 常量

export const APP = {
  codeName: "changzai",
  displayName: "常在",
  englishName: "Still Here",
  version: "0.1.0",
  identifier: "com.changzai.stillhere",
  schemaVersion: 1,
} as const;

/** 24 个情绪标签（02 §5.2） */
export const EMOTION_LABELS = [
  "喜", "怒", "哀", "惧", "厌", "惊", "委屈", "撒娇", "敷衍", "冷淡", "试探", "吃醋",
  "愧疚", "心疼", "怀念", "调侃", "认真", "疲惫", "兴奋", "焦虑", "失望", "释然", "暧昧", "平静",
] as const;
export type EmotionLabel = (typeof EMOTION_LABELS)[number];

/** 数据量档位（02 §4.4） */
export const FIDELITY_THRESHOLDS = {
  low: 45,
  medium: 70,
} as const;

/** 行为信号常量（02 §4.2） */
export const INGEST = {
  burstGapSeconds: 90,
  latencyCapSeconds: 86400,
  minNightHour: 23,
  maxNightHourExclusive: 2,
} as const;

/** AI 标识文案（不可关闭） */
export const AI_BADGE = {
  label: "AI",
  ariaLabel: "AI 生成内容",
  tooltip: "这是 AI 模拟生成的内容，不是真人",
} as const;
