// 常在 · 常量

export const APP = {
  codeName: "changzai",
  displayName: "常在",
  englishName: "Still Here",
  version: "0.1.0",
  identifier: "com.changzai.stillhere",
  schemaVersion: 2,
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

/** 媒体导入限制（与 Rust media.rs 保持一致） */
export const MEDIA = {
  maxFilesPerImport: 20,
  maxBytesPerFile: 32 * 1024 * 1024,
  imageExts: ["png", "jpg", "jpeg", "gif", "webp", "bmp"],
  voiceExts: ["mp3", "wav", "m4a", "aac", "ogg", "opus", "amr", "silk"],
} as const;

/** 资料默认值（与 UI 默认 demo 一致） */
export const DEFAULT_PROFILES = {
  her: { name: "ta", avatar: null },
  me: { name: "我", avatar: null },
} as const;

/** AI 披露文案（按产品要求：不做每条气泡角标，放在使用说明/关于页） */
export const AI_DISCLOSURE = {
  short: "这里的消息由 AI 模拟生成，不是真人。",
  long:
    "「常在」会用你导入的聊天记录模拟对方说话，所有消息都由 AI 生成，不是真人发送，也不代表对方本人。" +
    "产品不做对外发送、不上传云端。如果最近情绪不好，请优先联系身边的人或专业帮助。",
} as const;
