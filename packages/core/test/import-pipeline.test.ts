// 常在 · Step 2 导入流水线单测
import test from "node:test";
import assert from "node:assert/strict";

import {
  adapterCatalog,
  applyHoldoutSplit,
  createDefaultRegistry,
  importSources,
  type ImportSource,
} from "../src/ingest/pipeline.ts";
import { parseCsvRows, WechatmsgCsvAdapter } from "../src/ingest/adapters/wechatmsg-csv.ts";
import { WechatmsgTxtAdapter } from "../src/ingest/adapters/wechatmsg-txt.ts";
import { LiuhenJsonAdapter } from "../src/ingest/adapters/liuhen-json.ts";
import { QqTxtAdapter } from "../src/ingest/adapters/qq-txt.ts";
import { normalizeMessage } from "../src/ingest/schema.ts";

const WECHAT_TXT = `2023-05-20 14:03:22 小林
刚洗完澡
你呢
2023-05-20 14:04:10 我
在干嘛
2023-05-20 14:05:00 小林: 早点睡吧
2023-05-20 14:06:00 我: 好
`;

const WECHAT_CSV = `时间,发送人,内容,类型
2023-05-20 14:03:22,小林,刚洗完澡,1
2023-05-20 14:04:10,我,在干嘛,1
2023-05-20 14:05:00,小林,早点睡吧,1
2023-05-20 14:07:00,小林,图片,3
`;

const LIUHEN_JSON = JSON.stringify({
  messages: [
    { CreateTime: "2023-05-20 14:03:22", IsSender: 0, StrContent: "刚洗完澡", Type: 1 },
    { CreateTime: "2023-05-20 14:04:10", IsSender: 1, StrContent: "在干嘛", Type: 1 },
    { CreateTime: "2023-05-20 14:05:00", IsSender: 0, StrContent: "早点睡吧", Type: 1 },
  ],
});

const QQ_TXT = `2023-05-20 14:03:22 小林(123456)
刚洗完澡
2023-05-20 14:04:10 我(654321)
在干嘛
2023-05-20 14:05:00 小林(123456)
早点睡吧
`;

const PLAINTEXT = `2023-05-20 14:03:22 小林: 刚洗完澡
2023-05-20 14:04:10 我：在干嘛
2023-05-20 14:05:00 小林: 早点睡吧
`;

test("parseCsvRows：引号、逗号、双引号转义", () => {
  const rows = parseCsvRows('a,b,c\n"x,1","he said ""hi""",3\n');
  assert.deepEqual(rows, [
    ["a", "b", "c"],
    ["x,1", 'he said "hi"', "3"],
  ]);
});

test("WechatmsgTxtAdapter：多行格式解析", () => {
  const adapter = new WechatmsgTxtAdapter();
  assert.ok(adapter.sniff({ fileName: "wechat.txt", text: WECHAT_TXT }) > 0.7);
  const parsed = adapter.parse({ fileName: "wechat.txt", text: WECHAT_TXT });
  assert.equal(parsed.length, 4);
  assert.equal(parsed[0]?.content, "刚洗完澡\n你呢");
  assert.equal(parsed[0]?.sender, "her");
  assert.equal(parsed[1]?.sender, "me");
  assert.equal(parsed[2]?.content, "早点睡吧");
});

test("WechatmsgCsvAdapter：表头识别与发送人/类型映射", () => {
  const adapter = new WechatmsgCsvAdapter();
  assert.ok(adapter.sniff({ fileName: "wechat.csv", text: WECHAT_CSV }) > 0.7);
  const parsed = adapter.parse({ fileName: "wechat.csv", text: WECHAT_CSV });
  assert.equal(parsed.length, 4);
  assert.equal(parsed[0]?.sender, "her");
  assert.equal(parsed[1]?.sender, "me");
  assert.equal(parsed[3]?.type, "image");
  assert.equal(parsed[3]?.content, "图片");
});

test("LiuhenJsonAdapter：messages 数组 + IsSender", () => {
  const adapter = new LiuhenJsonAdapter();
  assert.ok(adapter.sniff({ fileName: "liuhen.json", text: LIUHEN_JSON }) > 0.7);
  const parsed = adapter.parse({ fileName: "liuhen.json", text: LIUHEN_JSON });
  assert.equal(parsed.length, 3);
  assert.equal(parsed[0]?.sender, "her");
  assert.equal(parsed[1]?.sender, "me");
  assert.equal(parsed[0]?.ts, "2023-05-20 14:03:22");
});

test("QqTxtAdapter：QQ 号括号与多行正文", () => {
  const adapter = new QqTxtAdapter();
  assert.ok(adapter.sniff({ fileName: "qq.txt", text: QQ_TXT }) > 0.6);
  const parsed = adapter.parse({ fileName: "qq.txt", text: QQ_TXT });
  assert.equal(parsed.length, 3);
  assert.equal(parsed[0]?.sender_name, "小林");
  assert.equal(parsed[1]?.sender, "me");
});

test("AdapterRegistry：按文件名/内容嗅探到正确适配器", () => {
  const registry = createDefaultRegistry();
  const cases: Array<[string, string, string]> = [
    ["wechat.txt", WECHAT_TXT, "wechatmsg_txt"],
    ["wechat.csv", WECHAT_CSV, "wechatmsg_csv"],
    ["liuhen.json", LIUHEN_JSON, "liuhen_json"],
    ["qq.txt", QQ_TXT, "qq_txt"],
    ["paste.txt", PLAINTEXT, "plaintext_paste"],
  ];
  for (const [name, text, expected] of cases) {
    const detected = registry.detect({ fileName: name, text })[0];
    assert.equal(detected?.adapter.name, expected, `${name} should use ${expected}`);
  }
});

test("importSources：多文件合并、去重、行为信号、报告", () => {
  const sources: ImportSource[] = [
    { name: "wechat.txt", text: WECHAT_TXT },
    { name: "liuhen.json", text: LIUHEN_JSON },
  ];
  const result = importSources(sources, { now: 1_700_000_000_000, holdoutTarget: 3 });
  assert.ok(result.messages.length > 0);
  // 两个文件内容有重复（同样 3 条），去重后应只剩一份
  assert.equal(result.messages.length, 5);
  assert.equal(result.report.total_msgs + result.report.meta.holdout_count, 5);
  assert.ok(result.warnings.some((w) => w.includes("去重")));
  assert.ok(result.messages.every((m) => m.conv_id === "conv_default"));
  assert.ok(result.messages.some((m) => m.latency_s !== null));
  assert.equal(result.holdoutCount, result.report.meta.holdout_count);
  assert.ok(result.adapters.length === 2);
});

test("applyHoldoutSplit：只标她的文字消息，且同 seed 结果稳定", () => {
  const messages = Array.from({ length: 400 }, (_, index) =>
    normalizeMessage(
      {
        ts: 1684598400000 + index * 60_000,
        sender: index % 2 === 0 ? "her" : "me",
        content: `第 ${index} 条`,
        type: "text",
      },
      { convId: "conv_default" },
    ),
  );
  const first = applyHoldoutSplit(messages, 50, 7);
  const second = applyHoldoutSplit(messages, 50, 7);
  assert.equal(first.holdoutCount, 20); // 200 条她的消息 × 5% = 10 → 下限 20
  assert.deepEqual(
    first.messages.map((m) => m.is_holdout),
    second.messages.map((m) => m.is_holdout),
  );
  assert.ok(first.messages.filter((m) => m.is_holdout === 1).every((m) => m.sender === "her"));
});

test("adapterCatalog：默认注册 6 个适配器", () => {
  const catalog = adapterCatalog();
  assert.equal(catalog.length, 6);
  assert.ok(catalog.some((item) => item.name === "wechatmsg_txt"));
  assert.ok(catalog.some((item) => item.name === "chatdata_js"));
  assert.ok(catalog.some((item) => item.name === "plaintext_paste"));
});

test("importSources：无有效数据时返回空报告与 warning", () => {
  const result = importSources([{ name: "empty.txt", text: "   " }], { now: 1 });
  assert.equal(result.messages.length, 0);
  assert.ok(result.warnings.length > 0);
  assert.equal(result.report.total_msgs, 0);
});
