// 常在 · Step 5 模型预设 / AI 味 / Decide / 撤回 / 主动消息 单测
import test from "node:test";
import assert from "node:assert/strict";

import {
  LLM_PROVIDERS,
  findProvider,
  providerForBaseUrl,
  resolveModels,
  filterAiFlavor,
  splitSentences,
  breakLongSentence,
  COMPOSE_HARD_RULES,
  decideReply,
  splitSegments,
  canRecall,
  recordRecall,
  recallLast,
  purgeRecalled,
  shouldSheRecall,
  DEFAULT_RECALL_BUDGET,
  DEFAULT_PROACTIVE_STATE,
  inDnd,
  normalizeProactiveState,
  planProactive,
  applyProactivePreset,
  recordProactiveSent,
  recordUserReply,
  buildComposedMessages,
  buildPersonaProfile,
  DEFAULT_EMOTION,
  planArc,
  governorDecision,
  assessVulnerability,
  guardUserMessage,
  retrieveMemories,
  type RecallState,
} from "../src/index.ts";
import { normalizeMessage } from "../src/ingest/schema.ts";

const BASE = new Date(2024, 2, 2, 21, 0, 0).getTime();

test("presets：至少 7 家 + 自定义，URL 与模型非空", () => {
  assert.ok(LLM_PROVIDERS.length >= 7);
  assert.equal(findProvider("deepseek").id, "deepseek");
  assert.equal(providerForBaseUrl("https://api.deepseek.com/v1").id, "deepseek");
  assert.equal(providerForBaseUrl("https://unknown.example.com/v1").id, "custom");
  const resolved = resolveModels({ providerId: "deepseek", baseUrl: "https://api.deepseek.com/v1", model: "" });
  assert.ok(resolved.model.length > 0);
  assert.ok(resolved.fastModel.length > 0);
});

test("filter：客服腔/列表/破折号/长句被清理，口语保留", () => {
  const clean = filterAiFlavor("刚到家 你呢");
  assert.equal(clean.changed, false);
  assert.equal(clean.text, "刚到家 你呢");

  const ugly = filterAiFlavor(
    "作为一个AI，我理解你的感受。首先，你可以先深呼吸；其次，早点休息——希望可以帮到你！",
  );
  assert.ok(ugly.changed);
  assert.ok(!ugly.text.includes("作为一个AI"));
  assert.ok(!ugly.text.includes("首先"));
  assert.ok(!ugly.text.includes("—"));
  assert.ok(ugly.flags.includes("客服开场"));
  assert.ok(ugly.flags.includes("说教连接词"));

  const long = "这是一段非常非常长的句子，" + "用来测试长句拆短逻辑，".repeat(4) + "应该被折断。";
  assert.ok(breakLongSentence(long, 20).length > 1);
  assert.ok(splitSentences("在吗。在。").length === 2);
  assert.ok(COMPOSE_HARD_RULES.includes("微信聊天"));
});

test("decide：回复/不回/延迟/分段可复现", () => {
  const emotion = { ...DEFAULT_EMOTION, closeness: 0.9, defensiveness: 0.1 };
  const first = decideReply({ text: "在吗", emotion, now: BASE });
  const second = decideReply({ text: "在吗", emotion, now: BASE });
  assert.deepEqual(first, second);
  assert.ok(first.probability >= 0.15 && first.probability <= 0.97);
  assert.ok(first.delayMs >= 500 && first.delayMs <= 6000);

  const segments = splitSegments("刚到家。今天有点累，先躺一会儿。你呢？");
  assert.ok(segments.length >= 1 && segments.length <= 3);
  assert.ok(segments.every((segment) => segment.length > 0));

  // 连续轰炸 + busy 时更容易已读不回
  let noReply = 0;
  for (let i = 0; i < 20; i += 1) {
    const result = decideReply({
      text: `第 ${i} 条`,
      emotion: { ...DEFAULT_EMOTION, closeness: 0.1, defensiveness: 0.8 },
      busy: true,
      minutesSinceLastUser: 0.2,
      now: BASE + i * 60_000,
    });
    if (!result.reply) noReply += 1;
  }
  assert.ok(noReply > 0);
});

test("recall：限流、撤回最后一条她的消息、清理残留", () => {
  let state: RecallState = { timestamps: [] };
  assert.equal(canRecall(state, BASE).ok, true);
  state = recordRecall(state, BASE);
  assert.equal(canRecall(state, BASE + 1000).ok, false); // 冷却
  assert.equal(canRecall(state, BASE + 60_000).ok, true);
  assert.equal(DEFAULT_RECALL_BUDGET.maxInRecent, 3);

  const messages = [
    { id: "m1", from: "me" as const, kind: "text", text: "在吗", ts: BASE },
    { id: "m2", from: "her" as const, kind: "text", text: "在", ts: BASE + 1 },
    { id: "m3", from: "her" as const, kind: "text", text: "刚到家", ts: BASE + 2 },
  ];
  const result = recallLast(messages, BASE + 3);
  assert.equal(result.recalled?.id, "m3");
  assert.equal(result.messages.length, 2);
  assert.equal(result.systemNotice?.text, "对方撤回了一条消息");
  const purged = purgeRecalled(messages, { id: "m2", text: "在" });
  assert.equal(purged.length, 2);
  assert.equal(typeof shouldSheRecall("在", BASE), "boolean");
});

test("proactive：免打扰/预算/空闲/连续未回降频", () => {
  assert.equal(inDnd(23, 23, 8), true);
  assert.equal(inDnd(7, 23, 8), true);
  assert.equal(inDnd(12, 23, 8), false);

  const state = { ...DEFAULT_PROACTIVE_STATE, enabled: true, lastUserAt: BASE - 120 * 60_000 };
  const plan = planProactive(state, BASE);
  assert.equal(plan.shouldSend, true);
  assert.ok(plan.score >= 0.45);

  const dnd = planProactive({ ...state, dndStart: 21, dndEnd: 23 }, BASE);
  assert.equal(dnd.shouldSend, false);
  assert.equal(dnd.reason, "免打扰时段");

  const exhausted = planProactive({ ...state, dailyLimit: 3, sentToday: 3, lastSentAt: BASE }, BASE);
  assert.equal(exhausted.shouldSend, false);

  const quiet = planProactive({ ...state, lastUserAt: BASE - 5_000 }, BASE);
  assert.equal(quiet.shouldSend, false);
  assert.ok(quiet.reason.includes("刚聊过"));

  const noReply = planProactive(
    { ...state, consecutiveNoReply: 2, lastUserAt: BASE - 120 * 60_000, dndEnabled: false },
    BASE,
  );
  assert.equal(noReply.shouldSend, false);

  const next = recordProactiveSent(state, BASE);
  assert.equal(next.sentToday, 1);
  const reply = recordUserReply(state, BASE + 1000);
  assert.equal(reply.consecutiveNoReply, 0);
  assert.equal(normalizeProactiveState({ ...state, sentToday: 3, lastSentAt: BASE - 2 * 86_400_000 }, BASE).sentToday, 0);
});

test("proactive：三档欲望与自定义参数可调", () => {
  const low = applyProactivePreset(DEFAULT_PROACTIVE_STATE, "low");
  assert.equal(low.dailyLimit, 2);
  assert.equal(low.minIdleSeconds, 120);
  assert.equal(low.desireLevel, "low");
  const high = applyProactivePreset(low, "high");
  assert.equal(high.dailyLimit, 16);
  assert.ok(high.triggerThreshold < low.triggerThreshold);
  const custom = applyProactivePreset(high, "custom");
  assert.equal(custom.dailyLimit, high.dailyLimit);
  assert.equal(custom.desireLevel, "custom");
});

test("compose：叠加硬规则且保留 Step4 状态/记忆", () => {
  const messages = [
    normalizeMessage(
      { ts: BASE, sender: "her", sender_name: "ta", type: "text", content: "刚到家" },
      { convId: "c" },
    ),
    normalizeMessage(
      { ts: BASE + 60_000, sender: "me", sender_name: "我", type: "text", content: "吃饭了吗" },
      { convId: "c" },
    ),
  ];
  const persona = buildPersonaProfile(messages, { now: BASE });
  const emotion = { ...DEFAULT_EMOTION, closeness: 0.7 };
  const runtime = buildComposedMessages({
    persona,
    emotion,
    arc: planArc("daily"),
    governor: governorDecision(assessVulnerability([{ from: "me", text: "累", ts: BASE }], BASE)),
    guard: guardUserMessage("你明明喜欢下雨天"),
    memories: retrieveMemories([{ id: "m", text: "ta 喜欢下雨天", ts: BASE, importance: 0.9 }], "下雨天", emotion),
    openLoops: [],
    history: [{ from: "me", text: "在吗" }, { from: "her", text: "在" }],
    userText: "在干嘛",
    profile: { name: "ta", selfName: "我" },
  });
  const system = runtime.messages[0]?.content ?? "";
  assert.ok(system.includes("硬规则"));
  assert.ok(system.includes("当前状态"));
  assert.ok(system.includes("记忆"));
});
