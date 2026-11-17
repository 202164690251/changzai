// Step 2 · 微信网页导出 data.js 适配器单测（合成数据，无隐私）
import test from "node:test";
import assert from "node:assert/strict";

import { ChatDataJsAdapter, extractChatDataJson } from "../src/ingest/adapters/chatdata-js.ts";
import { importSources, createDefaultRegistry } from "../src/ingest/pipeline.ts";

const SAMPLE = `window.CHAT_DATA = [
  {"time":"2024-03-02T21:14:08+08:00","senderName":"ta","isSelf":false,"type":1,"content":"今天下班有点晚"},
  {"time":"2024-03-02T21:15:20+08:00","senderName":"我","isSelf":true,"type":1,"content":"又加班？"},
  {"time":"2024-03-02T21:16:02+08:00","senderName":"ta","isSelf":false,"type":34,"content":"","contents":{"voiceText":"刚到家，懒得做饭"}},
  {"time":"2024-03-02T21:17:35+08:00","senderName":"ta","isSelf":false,"type":3,"content":"","contents":{"md5":"x"}},
  {"time":"2024-03-02T21:18:00+08:00","senderName":"我","isSelf":true,"type":49,"content":"好的","contents":{"refer":{"content":"周末去哪"}}},
  {"time":"2024-03-02T21:19:00+08:00","senderName":"系统消息","isSelf":false,"type":10000,"content":"以上是打招呼的消息"}
];`;

test("chatdata_js：提取与嗅探", () => {
  assert.ok(extractChatDataJson(SAMPLE)?.startsWith("["));
  const adapter = new ChatDataJsAdapter();
  assert.ok(adapter.sniff({ fileName: "data.js", text: SAMPLE }) > 0.9);
  assert.equal(createDefaultRegistry().detect({ fileName: "data.js", text: SAMPLE })[0]?.adapter.name, "chatdata_js");
});

test("chatdata_js：文本、语音转写、引用、系统消息", () => {
  const parsed = new ChatDataJsAdapter().parse({ fileName: "data.js", text: SAMPLE });
  assert.equal(parsed.length, 6);
  assert.equal(parsed[0]?.content, "今天下班有点晚");
  assert.equal(parsed[0]?.sender, "her");
  assert.equal(parsed[1]?.sender, "me");
  assert.equal(parsed[2]?.type, "text");
  assert.equal(parsed[2]?.content, "刚到家，懒得做饭");
  assert.equal(parsed[3]?.type, "image");
  assert.equal(parsed[4]?.content, "好的");
  assert.equal(parsed[5]?.sender, "system");
});

test("chatdata_js：导入流水线后语音转写进入人格可用文本", () => {
  const result = importSources([{ name: "data.js", text: SAMPLE }], { now: 1_700_000_000_000, holdoutTarget: 1 });
  assert.ok(result.messages.length >= 5);
  const herText = result.messages.filter((message) => message.sender === "her" && message.type === "text");
  assert.ok(herText.some((message) => message.content.includes("懒得做饭")));
  assert.ok(herText.some((message) => message.content.includes("今天下班有点晚")));
  assert.ok(result.adapters[0]?.adapterName === "chatdata_js");
});
