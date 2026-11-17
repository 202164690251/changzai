// 常在 · Step 3 人格卡与 prompt 单测
import test from "node:test";
import assert from "node:assert/strict";

import { normalizeMessage } from "../src/ingest/schema.ts";
import {
  BOUNDARIES,
  buildPersonaProfile,
  emptyPersona,
} from "../src/persona/build.ts";
import {
  buildChatMessages,
  buildSystemPrompt,
  personaHeadline,
} from "../src/persona/prompt.ts";
import type { PersonaSourceMessage } from "../src/persona/types.ts";

function msg(
  ts: number,
  sender: "her" | "me",
  content: string,
  isHoldout = false,
): PersonaSourceMessage {
  return normalizeMessage(
    {
      ts,
      sender,
      sender_name: sender === "her" ? "ta" : "我",
      type: "text",
      content,
    },
    { convId: "conv_default", isHoldout: isHoldout ? 1 : 0 },
  );
}

const DAY = 86_400_000;
const BASE = new Date(2024, 2, 2, 21, 14, 0).getTime();

const MESSAGES: PersonaSourceMessage[] = [
  msg(BASE, "me", "今天下班有点晚？"),
  msg(BASE + 60_000, "her", "嗯 刚到家"),
  msg(BASE + 120_000, "me", "吃饭了吗"),
  msg(BASE + 180_000, "her", "还没 懒得做"),
  msg(BASE + 240_000, "me", "那我给你点个外卖"),
  msg(BASE + 300_000, "her", "不要 太晚了"),
  msg(BASE + 360_000, "me", "好吧"),
  msg(BASE + 420_000, "her", "你也早点睡"),
  msg(BASE + DAY, "me", "今天干嘛了"),
  msg(BASE + DAY + 60_000, "her", "在家躺着 看剧"),
  msg(BASE + DAY + 120_000, "me", "什么剧"),
  msg(BASE + DAY + 180_000, "her", "忘了 反正很无聊"),
  msg(BASE + DAY + 240_000, "me", "哈哈"),
  msg(BASE + DAY + 300_000, "her", "我喜欢下雨天"),
  msg(BASE + 2 * DAY, "me", "在吗"),
  msg(BASE + 2 * DAY + 60_000, "her", "在 刚醒"),
  msg(BASE + 2 * DAY + 120_000, "me", "睡到现在"),
  msg(BASE + 2 * DAY + 180_000, "her", "嗯 周末嘛"),
  msg(BASE + 3 * DAY, "me", "今天降温"),
  msg(BASE + 3 * DAY + 60_000, "her", "知道了 你也是"),
  // holdout 消息不能进入人格卡
  msg(BASE + 4 * DAY, "me", "隐藏测试"),
  msg(BASE + 4 * DAY + 60_000, "her", "HOLDOUT_SECRET_SHOULD_NOT_LEAK", true),
];

test("buildPersonaProfile：统计风格、语气词、事实", () => {
  const persona = buildPersonaProfile(MESSAGES, { now: 1_700_000_000_000 });
  assert.equal(persona.version, 1);
  assert.equal(persona.source.her_messages, 10); // holdout 被排除
  assert.ok(persona.style.avg_len > 0 && persona.style.avg_len <= 10);
  assert.ok(persona.style.short_ratio > 0.5);
  assert.ok(persona.style.particles.some((item) => item.text === "嗯"));
  assert.ok(persona.facts.some((fact) => fact.kind === "喜欢" && fact.text.includes("下雨天")));
  assert.ok(persona.samples.length > 0);
  assert.ok(persona.summary.includes("ta"));
  assert.deepEqual(persona.boundaries, BOUNDARIES);
});

test("buildPersonaProfile：holdout 不进入 summary/samples/facts", () => {
  const persona = buildPersonaProfile(MESSAGES, { now: 1 });
  const serialized = JSON.stringify(persona);
  assert.ok(!serialized.includes("HOLDOUT_SECRET_SHOULD_NOT_LEAK"));
});

test("buildPersonaProfile：includeHoldout 可选（评测/调试用）", () => {
  const persona = buildPersonaProfile(MESSAGES, { includeHoldout: true });
  assert.equal(persona.source.her_messages, 11);
});

test("buildPersonaProfile：空数据返回空人格卡", () => {
  const persona = emptyPersona(123);
  assert.equal(persona.source.her_messages, 0);
  assert.equal(persona.style.avg_len, 0);
  assert.ok(persona.summary.includes("还没有"));
  assert.equal(buildPersonaProfile([], { now: 1 }).source.her_messages, 0);
});

test("buildSystemPrompt：包含边界、风格、事实和名字", () => {
  const persona = buildPersonaProfile(MESSAGES, { now: 1 });
  const prompt = buildSystemPrompt(persona, { name: "ta", selfName: "我" });
  assert.ok(prompt.includes("不是真人"));
  assert.ok(prompt.includes("不冒充真人"));
  assert.ok(prompt.includes("降雨") === false);
  assert.ok(prompt.includes("下雨天"));
  assert.ok(prompt.includes("ta"));
  assert.ok(prompt.includes("微信聊天"));
  assert.ok(prompt.length > 200);
});

test("buildChatMessages：system + 历史角色映射 + 当前输入", () => {
  const persona = buildPersonaProfile(MESSAGES, { now: 1 });
  const history = [
    { from: "me" as const, text: "在吗" },
    { from: "her" as const, text: "在" },
    { from: "system" as const, text: "时间分隔" },
  ];
  const messages = buildChatMessages(persona, history, "今天好累");
  assert.equal(messages[0]?.role, "system");
  assert.ok(messages[0]?.content.includes("不冒充真人"));
  assert.deepEqual(
    messages.slice(1).map((message) => message.role),
    ["user", "assistant", "user"],
  );
  assert.equal(messages[messages.length - 1]?.content, "今天好累");
});

test("buildChatMessages：超长历史按预算裁剪，system 保留", () => {
  const persona = buildPersonaProfile(MESSAGES, { now: 1 });
  const history = Array.from({ length: 30 }, (_, index) => ({
    from: index % 2 === 0 ? ("me" as const) : ("her" as const),
    text: "这是一段比较长的历史消息".repeat(20),
  }));
  const messages = buildChatMessages(persona, history, "在吗", { maxChars: 2_000 });
  assert.equal(messages[0]?.role, "system");
  assert.ok(messages.length < 31);
  assert.equal(messages[messages.length - 1]?.content, "在吗");
});

test("personaHeadline：给设置页的摘要", () => {
  const persona = buildPersonaProfile(MESSAGES, { now: 1 });
  const text = personaHeadline(persona);
  assert.ok(text.includes("ta 的消息"));
  assert.ok(text.includes("条事实"));
  assert.ok(personaHeadline(emptyPersona()).includes("尚未生成"));
});
