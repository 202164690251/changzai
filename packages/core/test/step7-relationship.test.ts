// Step 7 · 关系卡 / 状态 / 风格校准
import test from "node:test";
import assert from "node:assert/strict";
import {
  deriveRelationshipProfile,
  relationshipPromptText,
  moodPresetState,
  MOOD_PRESETS,
  styleCalibrationText,
  buildSystemPrompt,
  DEFAULT_PROACTIVE_STATE,
  planProactive,
  type RelationshipSourceMessage,
} from "../src/index.ts";
import { buildPersonaProfile } from "../src/persona/build.ts";
import { normalizeMessage } from "../src/ingest/schema.ts";

const BASE = 1_700_000_000_000;

function messages(): RelationshipSourceMessage[] {
  return [
    { ts: BASE, sender: "her" as const, type: "text" as const, content: "宝宝 今天想我了吗", is_holdout: 0 },
    { ts: BASE + 1, sender: "me" as const, type: "text" as const, content: "想了 我今天加班", is_holdout: 0 },
    { ts: BASE + 2, sender: "her" as const, type: "text" as const, content: "老公辛苦了 早点休息", is_holdout: 0 },
    { ts: BASE + 3, sender: "me" as const, type: "text" as const, content: "我喜欢吃辣", is_holdout: 0 },
  ];
}

test("关系卡：从记录推断情侣/称呼/用户事实", () => {
  const profile = deriveRelationshipProfile(messages(), { meName: "CC", herName: "ta", now: BASE });
  assert.equal(profile.type, "情侣");
  assert.equal(profile.userName, "CC");
  assert.ok(profile.herNicknameForUser === "宝宝" || profile.herNicknameForUser === "老公");
  assert.ok(profile.userFacts.some((fact) => fact.includes("吃辣")));
  assert.ok(relationshipPromptText(profile).includes("情侣"));
});

test("关系卡：进入 system prompt", () => {
  const profile = deriveRelationshipProfile(messages(), { meName: "CC", herName: "ta", now: BASE });
  const persona = buildPersonaProfile(
    messages().map((row) =>
      normalizeMessage({ ...row, sender_name: row.sender === "her" ? "ta" : "CC" }, { convId: "c" }),
    ),
    { now: BASE },
  );
  const prompt = buildSystemPrompt(persona, { name: "ta", selfName: "CC", relationship: profile });
  assert.ok(prompt.includes("【你和用户的关系】"));
  assert.ok(prompt.includes("情侣"));
});

test("状态：默认心情标签可生成覆盖状态", () => {
  const preset = MOOD_PRESETS.find((item) => item.id === "tired");
  assert.ok(preset);
  const state = moodPresetState(preset!);
  assert.ok(state.arousal < 0.3);
  assert.equal(typeof state.updated_at, "number");
});

test("风格校准：标签和改写进入提示", () => {
  const text = styleCalibrationText([
    { id: "1", messageId: "m", text: "太长的话", rating: 2, tags: ["太长", "太客气"], correctedText: "短一点", createdAt: BASE },
  ]);
  assert.ok(text.includes("太长"));
  assert.ok(text.includes("短一点"));
});

test("主动消息：0 上限表示不限制 + 秒级空闲", () => {
  const state = {
    ...DEFAULT_PROACTIVE_STATE,
    enabled: true,
    dndEnabled: false,
    dailyLimit: 0,
    weeklyLimit: 0,
    sentToday: 999,
    sentWeek: 999,
    lastUserAt: BASE - 5_000,
    minIdleSeconds: 3,
    triggerThreshold: 0.1,
    desireFactor: 2,
  };
  const plan = planProactive(state, BASE);
  assert.equal(plan.shouldSend, true);
});
