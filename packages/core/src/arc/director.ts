// Step 4 · Arc Director：四类场次 + 温度预算 + 3 轮递台阶
import { classifyStimulus } from "../emotion/state.ts";

export type SceneType = "daily" | "late_night" | "memory" | "reconcile";

export interface ArcPlan {
  scene: SceneType;
  /** 本轮表达温度（0..1）：越高越外放，越低越克制 */
  temperature: number;
  /** 这个场次最多持续几轮，超过就强制转向 */
  maxTurns: number;
  /** 本场次注入预算（字符量） */
  budgetTokens: number;
  note: string;
  /** reconcile 场次的递台阶剩余轮数 */
  stepDownRemaining: number;
}

const SCENE_DEFAULT: Record<SceneType, Omit<ArcPlan, "scene">> = {
  daily: { temperature: 0.55, maxTurns: 12, budgetTokens: 2600, note: "日常：短句、接话、不要用力过猛", stepDownRemaining: 0 },
  late_night: { temperature: 0.35, maxTurns: 8, budgetTokens: 2400, note: "深夜：更慢、更轻、少追问，允许一点沉默", stepDownRemaining: 0 },
  memory: { temperature: 0.6, maxTurns: 6, budgetTokens: 2800, note: "回忆：具体细节、少量画面感，不煽情", stepDownRemaining: 0 },
  reconcile: { temperature: 0.45, maxTurns: 6, budgetTokens: 2600, note: "和解：3 轮内递台阶，不翻旧账、不逼道歉", stepDownRemaining: 3 },
};

export function determineScene(userText: string, hour = new Date().getHours()): SceneType {
  const stimulus = classifyStimulus(userText);
  if (stimulus === "conflict" || stimulus === "rejection") return "reconcile";
  if (stimulus === "nostalgia") return "memory";
  if (hour >= 23 || hour < 3) return "late_night";
  return "daily";
}

export function planArc(scene: SceneType, userText = ""): ArcPlan {
  const base = SCENE_DEFAULT[scene];
  const intensity = Math.min(1, Math.max(0, userText.length / 60));
  return {
    scene,
    temperature: Math.min(0.9, base.temperature + intensity * 0.1),
    maxTurns: base.maxTurns,
    budgetTokens: base.budgetTokens,
    note: base.note,
    stepDownRemaining: base.stepDownRemaining,
  };
}

/** 轮次推进：超过 maxTurns 强制回日常；reconcile 每轮减一，到 0 也必须给出口 */
export function advanceArc(plan: ArcPlan, turnIndex: number): ArcPlan {
  if (turnIndex > plan.maxTurns) {
    return planArc("daily");
  }
  if (plan.scene === "reconcile" && plan.stepDownRemaining > 0) {
    return { ...plan, stepDownRemaining: plan.stepDownRemaining - 1 };
  }
  return plan;
}

export function describeArc(plan: ArcPlan): string {
  return `当前场次：${plan.scene}；表达温度 ${plan.temperature.toFixed(2)}；${plan.note}。`;
}
