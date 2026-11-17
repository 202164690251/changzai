// 对话质量：奇怪半句的识别与软化
import test from "node:test";
import assert from "node:assert/strict";
import { qualityIssues, softenWeirdText } from "../src/runtime/quality.ts";

test("quality：识别无指代半句和缺本体比喻", () => {
  assert.ok(qualityIssues("还是那句话来着。").length > 0);
  assert.ok(qualityIssues("那个，我今天去了图书馆").length > 0);
  assert.ok(qualityIssues("刚到就想充电似的").length > 0);
  assert.equal(qualityIssues("我今天去了图书馆").length, 0);
  assert.equal(qualityIssues("我刚看来着").length, 0);
});

test("quality：软化为可读短句", () => {
  assert.equal(softenWeirdText("还是那句话来着。").trim(), "");
  assert.equal(softenWeirdText("那个，我今天去了图书馆").trim(), "我今天去了图书馆");
  assert.equal(softenWeirdText("刚到就想充电似的").trim(), "刚到就想充电的感觉");
  assert.equal(softenWeirdText("嗯嗯，我在").trim(), "嗯嗯，我在");
});
