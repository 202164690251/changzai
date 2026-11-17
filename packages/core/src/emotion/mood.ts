// 常在 · ta 的状态：默认心情标签 + 用户手动覆盖
import { DEFAULT_EMOTION, type EmotionState } from "./state.ts";

export interface MoodPreset {
  id: string;
  label: string;
  description: string;
  patch: Partial<EmotionState>;
}

export interface MoodOverride {
  state: EmotionState;
  note: string;
  /** null = 直到用户改回；数字 = 到期时间戳 */
  until: number | null;
  updatedAt: number;
}

export const MOOD_PRESETS: MoodPreset[] = [
  { id: "happy", label: "开心", description: "心情好，话多一点", patch: { valence: 0.7, arousal: 0.6, closeness: 0.7, defensiveness: 0.1, weather: "sunny", tension: 0.1 } },
  { id: "calm", label: "平静", description: "正常、松弛", patch: { valence: 0.2, arousal: 0.3, closeness: 0.6, defensiveness: 0.2, weather: "cloudy", tension: 0.15 } },
  { id: "low", label: "低落", description: "不太想说话", patch: { valence: -0.6, arousal: 0.2, closeness: 0.5, defensiveness: 0.3, weather: "rainy", tension: 0.3 } },
  { id: "annoyed", label: "烦躁", description: "容易不耐烦", patch: { valence: -0.3, arousal: 0.7, closeness: 0.4, defensiveness: 0.6, weather: "stormy", tension: 0.55 } },
  { id: "tired", label: "疲惫", description: "回得短、慢", patch: { valence: -0.2, arousal: 0.15, closeness: 0.55, defensiveness: 0.25, weather: "cloudy", tension: 0.2 } },
  { id: "shy", label: "害羞", description: "亲近但有点别扭", patch: { valence: 0.4, arousal: 0.5, closeness: 0.8, defensiveness: 0.2, weather: "sunny", tension: 0.1 } },
  { id: "busy", label: "忙碌", description: "在忙，回复短", patch: { valence: 0.1, arousal: 0.4, closeness: 0.5, defensiveness: 0.2, weather: "cloudy", tension: 0.2 } },
  { id: "sick", label: "生病", description: "没精神，需要被关心", patch: { valence: -0.4, arousal: 0.1, closeness: 0.6, defensiveness: 0.2, weather: "rainy", tension: 0.2 } },
];

export function moodPresetState(preset: MoodPreset): EmotionState {
  return { ...DEFAULT_EMOTION, ...preset.patch, updated_at: Date.now() };
}

export function isMoodOverrideActive(override: MoodOverride | null, now = Date.now()): boolean {
  if (!override) return false;
  return override.until === null || override.until > now;
}
