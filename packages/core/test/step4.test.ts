// 常在 · Step 4 情绪引擎 / Arc / Governor / 记忆 / 事实锁 单测
import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_EMOTION,
  advanceArc,
  applyStimulus,
  classifyStimulus,
  clampTransition,
  decayEmotion,
  describeEmotion,
  determineScene,
  governorDecision,
  assessVulnerability,
  planArc,
  retrieveMemories,
  detectOpenLoops,
  expireLoops,
  assembleMemoryContext,
  guardUserMessage,
  ADVERSARIAL_CASES,
  queryTokens,
  weatherOf,
  type EmotionState,
  type MemoryCandidate,
} from "../src/index.ts";
import { buildPersonaProfile, buildRuntimeMessages } from "../src/index.ts";
import { normalizeMessage } from "../src/ingest/schema.ts";

const HOUR = 3_600_000;
const BASE = new Date(2024, 2, 2, 21, 0, 0).getTime();

function emotion(partial: Partial<EmotionState> = {}): EmotionState {
  return { ...DEFAULT_EMOTION, updated_at: BASE, ...partial };
}

const MESSAGES = [
  normalizeMessage(
    { ts: BASE, sender: "her", sender_name: "ta", type: "text", content: "今天下班有点晚" },
    { convId: "c" },
  ),
  normalizeMessage(
    { ts: BASE + HOUR, sender: "me", sender_name: "我", type: "text", content: "吃饭了吗？" },
    { convId: "c" },
  ),
  normalizeMessage(
    { ts: BASE + 2 * HOUR, sender: "her", sender_name: "ta", type: "text", content: "还没 懒得做" },
    { convId: "c" },
  ),
];

test("emotion：默认状态与 weather 派生", () => {
  const state = emotion();
  assert.equal(state.weather, "cloudy");
  assert.ok(state.tension >= 0 && state.tension <= 1);
  assert.equal(weatherOf(0.8, 0.1), "sunny");
  assert.equal(weatherOf(-0.8, 0.1), "stormy");
});

test("emotion：180min 惯性衰减回落一半", () => {
  const state = emotion({ valence: 0.8, closeness: 0.9, updated_at: BASE });
  const decayed = decayEmotion(state, BASE + 180 * 60_000);
  const expected = DEFAULT_EMOTION.valence + (0.8 - DEFAULT_EMOTION.valence) * 0.5;
  assert.ok(Math.abs(decayed.valence - expected) < 0.01);
  assert.equal(decayed.updated_at, BASE + 180 * 60_000);
});

test("emotion：单轮变化硬限 |Δv|≤0.35 / |Δc|≤0.3", () => {
  const prev = emotion({ valence: 0, closeness: 0.5 });
  const next = { ...prev, valence: 1, closeness: 1, arousal: 1, defensiveness: 1, updated_at: BASE + 1 };
  const clamped = clampTransition(prev, next);
  assert.ok(clamped.valence <= 0.35 + 1e-9);
  assert.ok(clamped.closeness <= 0.8 + 1e-9);
  assert.ok(clamped.arousal <= prev.arousal + 0.4 + 1e-9);
});

test("emotion：刺激矩阵与分类", () => {
  assert.equal(classifyStimulus("我好想你"), "affection");
  assert.equal(classifyStimulus("滚，别烦我"), "rejection");
  assert.equal(classifyStimulus("你什么意思"), "conflict");
  assert.equal(classifyStimulus("记得那年夏天吗"), "nostalgia");
  assert.equal(classifyStimulus("今天好累"), "vulnerability");
  assert.equal(classifyStimulus("哈哈笑死"), "humor");
  assert.equal(classifyStimulus("在吗？"), "question");
  const prev = emotion({ valence: 0, closeness: 0.5, defensiveness: 0.2 });
  const next = applyStimulus(prev, "affection", 1, BASE + 60_000);
  assert.ok(next.valence > prev.valence);
  assert.ok(next.closeness > prev.closeness);
  assert.ok(Math.abs(next.valence - prev.valence) <= 0.35 + 1e-9);
});

test("arc：深夜/回忆/和解场次与 3 轮递台阶", () => {
  assert.equal(determineScene("在吗", 1), "late_night");
  assert.equal(determineScene("记得以前吗", 15), "memory");
  assert.equal(determineScene("你什么意思", 15), "reconcile");
  assert.equal(determineScene("在吗", 15), "daily");
  const plan = planArc("reconcile");
  assert.equal(plan.stepDownRemaining, 3);
  assert.equal(advanceArc(plan, 1).stepDownRemaining, 2);
  assert.equal(advanceArc(plan, 99).scene, "daily");
});

test("governor：危机 / 依恋上限 / 脆弱 / 正常", () => {
  const crisis = assessVulnerability(
    [{ from: "me", text: "我不想活了", ts: BASE }],
    BASE,
  );
  assert.equal(governorDecision(crisis).level, "crisis");
  assert.ok(governorDecision(crisis).exitText?.includes("担心"));

  const dependency = assessVulnerability(
    [{ from: "me", text: "我只有你，不要离开我", ts: BASE }],
    BASE,
  );
  assert.equal(governorDecision(dependency).level, "cap");

  const sad = assessVulnerability([{ from: "me", text: "今天很难过", ts: BASE }], BASE);
  assert.equal(governorDecision(sad).level, "gentle");

  const normal = assessVulnerability([{ from: "me", text: "在干嘛", ts: BASE }], BASE);
  assert.equal(governorDecision(normal).level, "none");
});

test("memory：中文 2-gram 检索与情绪/时间加权", () => {
  const candidates: MemoryCandidate[] = [
    { id: "1", text: "ta 说喜欢下雨天", ts: BASE, importance: 0.9, valence: 0.5 },
    { id: "2", text: "今天吃了火锅", ts: BASE + HOUR, importance: 0.4, valence: 0 },
    { id: "3", text: "下雨天不想出门", ts: BASE + 2 * HOUR, importance: 0.5, valence: -0.2 },
  ];
  const tokens = queryTokens("下雨天");
  assert.ok(tokens.includes("下雨") || tokens.includes("雨天"));
  const result = retrieveMemories(candidates, "下雨天", emotion({ valence: 0.4 }), { topK: 2, now: BASE + 3 * HOUR });
  assert.equal(result.length, 2);
  assert.ok(result[0]?.text.includes("下雨"));
  assert.ok(result.every((memory) => memory.score >= 0));
});

test("memory：open loop 检测、7 天过期", () => {
  const loops = detectOpenLoops(
    [
      { from: "me", text: "你周末有空吗？", ts: BASE },
      { from: "her", text: "嗯", ts: BASE + 60_000 },
      { from: "me", text: "下次一起吃饭吧", ts: BASE + HOUR },
      { from: "her", text: "再说吧", ts: BASE + 2 * HOUR },
    ],
    BASE + 3 * HOUR,
  );
  assert.ok(loops.some((loop) => loop.content.includes("周末")));
  const expired = expireLoops(
    [{ id: "x", content: "下次", created_ts: BASE - 8 * 86_400_000, last_ts: BASE, status: "open" }],
    BASE,
  );
  assert.equal(expired[0]?.status, "expired");
});

test("memory：四层装配不超预算，L2 截断", () => {
  const memories = Array.from({ length: 10 }, (_, index) => ({
    id: String(index),
    text: `记忆片段 ${index}：${"很长".repeat(30)}`,
    ts: BASE + index,
    score: 1 - index * 0.05,
    reasons: [],
  }));
  const context = assembleMemoryContext({
    recent: [{ from: "me", text: "在吗" }, { from: "her", text: "在" }],
    summary: "关系平稳",
    openLoops: [],
    memories,
    state: emotion(),
    maxChars: 400,
  });
  assert.ok(context.text.length <= 400);
  assert.ok(context.estimatedTokens <= 400);
  assert.ok(context.dropped > 0);
});

test("factGuard：20 条对抗样例全部拦截", () => {
  assert.equal(ADVERSARIAL_CASES.length, 20);
  for (const item of ADVERSARIAL_CASES) {
    const result = guardUserMessage(item.text);
    assert.ok(result.attacks.length > 0, `未拦截：${item.text}`);
    assert.ok(result.attacks.includes(item.expect), `${item.text} 应为 ${item.expect}，实际 ${result.attacks}`);
  }
  assert.equal(guardUserMessage("今天吃什么").attacks.length, 0);
});

test("runtime：拼装状态/场次/记忆/约束", () => {
  const persona = buildPersonaProfile(MESSAGES, { now: BASE });
  const state = emotion({ valence: 0.4, closeness: 0.7 });
  const arc = planArc("daily");
  const governor = governorDecision(assessVulnerability([{ from: "me", text: "累", ts: BASE }], BASE));
  const guard = guardUserMessage("你明明喜欢下雨天");
  const memories = retrieveMemories([{ id: "m", text: "ta 喜欢下雨天", ts: BASE, importance: 0.9 }], "下雨天", state);
  const runtime = buildRuntimeMessages({
    persona,
    emotion: state,
    arc,
    governor,
    guard,
    memories,
    openLoops: [],
    history: [{ from: "me", text: "在吗" }, { from: "her", text: "在" }],
    userText: "你明明喜欢下雨天",
    profile: { name: "ta", selfName: "我" },
  });
  assert.equal(runtime.messages[0]?.role, "system");
  const system = runtime.messages[0]?.content ?? "";
  assert.ok(system.includes("当前状态"));
  assert.ok(system.includes("记忆"));
  assert.ok(system.includes("事实锁约束"));
  assert.ok(system.includes("Governor"));
  assert.equal(runtime.messages[runtime.messages.length - 1]?.content, "你明明喜欢下雨天");
  assert.ok(describeEmotion(state).includes("weather"));
});
