// 常在 · core 单测（无需安装依赖：Node 24 原生运行 TypeScript）
// 运行：node --test packages/core/test/*.test.ts

import test from "node:test";
import assert from "node:assert/strict";

import type { NormalizedMessage } from "@veyrimi/shared";
import {
  normalizeMessage,
  validateMessage,
  dedupeMessages,
  normalizeSender,
  parseTimestamp,
  makeMsgId,
} from "../src/ingest/schema.ts";
import { computeBursts, computeLatency, fillBehaviorSignals } from "../src/ingest/burst.ts";
import { buildHealthReport, fidelityScore, fidelityLevel, findGaps } from "../src/ingest/report.ts";
import { PlaintextPasteAdapter } from "../src/ingest/adapters/plaintext.ts";
import { AdapterRegistry } from "../src/ingest/adapters/base.ts";
import { DDL_V2, SCHEMA_VERSION } from "../src/db/ddl.ts";

const T = (iso: string): number => new Date(iso).getTime();

function her(ts: number, content: string, extra: Partial<NormalizedMessage> = {}): NormalizedMessage {
  return normalizeMessage(
    { ts, sender: "her", type: "text", content },
    { convId: "c1" },
  ) as NormalizedMessage;
}
function me(ts: number, content: string): NormalizedMessage {
  return normalizeMessage({ ts, sender: "me", type: "text", content }, { convId: "c1" }) as NormalizedMessage;
}
function withBurst(m: NormalizedMessage, burstSize: number): NormalizedMessage {
  return { ...m, burst_size: burstSize };
}

test("normalizeMessage：中文日期/发送人/稳定 ID", () => {
  const m = normalizeMessage(
    { ts: "2023年5月20日 14:03:22", sender: "她", sender_name: "小林", content: "在干嘛" },
    { convId: "conv_001" },
  );
  assert.equal(m.sender, "her");
  assert.equal(m.sender_name, "小林");
  assert.equal(m.type, "text");
  assert.equal(new Date(m.ts).getHours(), 14);
  assert.equal(validateMessage(m).length, 0);
  const again = normalizeMessage(
    { ts: "2023年5月20日 14:03:22", sender: "她", sender_name: "小林", content: "在干嘛" },
    { convId: "conv_001" },
  );
  assert.equal(m.msg_id, again.msg_id);
  assert.equal(m.msg_id, makeMsgId("conv_001", m.ts, "her", "在干嘛"));
});

test("parseTimestamp / normalizeSender 边界", () => {
  assert.equal(parseTimestamp("1684598400"), 1684598400000);
  assert.equal(parseTimestamp(1684598400), 1684598400000);
  assert.equal(normalizeSender("我"), "me");
  assert.equal(normalizeSender("系统"), "system");
  assert.equal(normalizeSender("unknown"), "her");
  assert.equal(parseTimestamp("not-a-date"), null);
});

test("computeBursts：90 秒内同人连发归为一次 burst", () => {
  const msgs = [
    her(T("2023-05-20T14:00:00"), "刚洗完澡"),
    her(T("2023-05-20T14:00:01"), "你呢"),
    her(T("2023-05-20T14:00:02"), "在干嘛"),
    me(T("2023-05-20T14:00:20"), "没事"),
    her(T("2023-05-20T14:00:30"), "哦"),
    her(T("2023-05-20T14:05:00"), "早点睡"),
  ];
  const out = computeBursts(msgs);
  assert.deepEqual(
    out.map((m) => [m.burst_index, m.burst_size]),
    [
      [1, 3],
      [2, 3],
      [3, 3],
      [1, 1],
      [1, 1],
      [1, 1],
    ],
  );
});

test("computeLatency：对最后一条对方消息计时，并截断上限", () => {
  const msgs = [
    me(T("2023-05-20T14:00:00"), "在干嘛"),
    her(T("2023-05-20T14:02:17"), "刚洗完澡"),
    me(T("2023-05-20T14:02:20"), "哦"),
    her(T("2023-05-22T14:02:20"), "嗯"),
  ];
  const out = computeLatency(msgs);
  assert.equal(out[0]?.latency_s, null);
  assert.equal(out[1]?.latency_s, 137);
  assert.equal(out[2]?.latency_s, 3);
  assert.equal(out[3]?.latency_s, 86400); // 两天 → 截断到 86400
});

test("fillBehaviorSignals：组合后字段完整", () => {
  const out = fillBehaviorSignals([
    me(T("2023-05-20T14:00:00"), "在干嘛"),
    her(T("2023-05-20T14:00:05"), "嗯"),
  ]);
  for (const m of out) {
    assert.ok(m.burst_index >= 1);
    assert.ok(m.burst_size >= m.burst_index);
  }
  assert.equal(out[1]?.latency_s, 5);
});

test("dedupeMessages：按 conv+ts+sender+content 去重", () => {
  const a = her(T("2023-05-20T14:00:00"), "在干嘛");
  const b = her(T("2023-05-20T14:00:00"), "在干嘛");
  const c = me(T("2023-05-20T14:00:00"), "在干嘛");
  const { messages, duplicates } = dedupeMessages([a, b, c]);
  assert.equal(messages.length, 2);
  assert.equal(duplicates, 1);
});

test("plaintext 适配器：嗅探 + 解析 + 多行续写", () => {
  const text = [
    "2023-05-20 14:03:22 小林: 在干嘛",
    "2023-05-20 14:03:25 我：刚洗完澡",
    "2023/05/20 14:04 小林：哦",
    "  多行补充内容",
    "2023年5月20日 14:05 小林：早点睡",
  ].join("\n");
  const adapter = new PlaintextPasteAdapter();
  const confidence = adapter.sniff({ text });
  assert.ok(confidence > 0.5);
  const raw = adapter.parse({ text });
  assert.equal(raw.length, 4);
  assert.equal(raw[0]?.sender_name, "小林");
  assert.equal(raw[1]?.sender, "me");
  assert.match(String(raw[2]?.content), /多行补充内容/);
  const reg = new AdapterRegistry().register(adapter);
  assert.equal(reg.detect({ text })[0]?.adapter.name, "plaintext_paste");
});

test("体检报告：小样本低还原度，大样本高保真，且 holdout 不计入", () => {
  const small = [me(T("2023-05-20T14:00:00"), "在干嘛"), her(T("2023-05-20T14:00:05"), "嗯")];
  const r1 = buildHealthReport(small, { now: 1_700_000_000_000 });
  assert.equal(r1.total_msgs, 2);
  assert.equal(r1.her_msgs, 1);
  assert.equal(r1.fidelity_level, "low");
  assert.equal(r1.meta.holdout_count, 0);

  const big: NormalizedMessage[] = [];
  for (let i = 0; i < 9000; i++) {
    const ts = T("2019-01-01T00:00:00") + i * 7_800_000; // 平均 2.17 小时一条，跨越约 800 天
    const hour = new Date(ts).getHours();
    const msg = her(ts, "今天有点累");
    msg.type = hour >= 23 || hour < 2 ? "voice" : "text";
    msg.burst_size = 2;
    big.push(msg);
  }
  const holdout = { ...her(T("2020-01-01T00:00:00"), "留出样本"), is_holdout: 1 as const };
  const r2 = buildHealthReport([...big, holdout], { conflictEpisodes: 30, now: 1_700_000_000_000 });
  assert.equal(r2.total_msgs, 9000);
  assert.equal(r2.her_msgs, 9000);
  assert.equal(r2.fidelity_level, "high");
  assert.ok(r2.fidelity_estimate >= 70);
  assert.equal(r2.meta.holdout_count, 1);
  assert.equal(r2.has_voice, true);
  assert.equal(r2.burst_p50, 2);
});

test("fidelity 公式与分档边界", () => {
  assert.equal(fidelityScore({ herMessages: 0, spanDays: 0, nightRatio: 0, conflictEpisodes: 0, hasVoice: false }), 0);
  assert.equal(fidelityScore({ herMessages: 8000, spanDays: 730, nightRatio: 0.3, conflictEpisodes: 20, hasVoice: true }), 100);
  assert.equal(fidelityLevel(44), "low");
  assert.equal(fidelityLevel(45), "medium");
  assert.equal(fidelityLevel(70), "medium");
  assert.equal(fidelityLevel(71), "high");
});

test("findGaps：超过 30 天的记录空洞", () => {
  const msgs = [her(T("2023-05-20T00:00:00"), "a"), her(T("2023-08-01T00:00:00"), "b")];
  const gaps = findGaps(msgs);
  assert.equal(gaps.length, 1);
  assert.match(gaps[0] ?? "", /2023-05 至 2023-08/);
});

test("DDL v2 包含 trigram、FTS 同步触发器、correction、holdout、profile、media", () => {
  assert.equal(SCHEMA_VERSION, 2);
  assert.match(DDL_V2, /tokenize='trigram'/);
  assert.match(DDL_V2, /CREATE TRIGGER IF NOT EXISTS memory_ai/);
  assert.match(DDL_V2, /CREATE TRIGGER IF NOT EXISTS memory_ad/);
  assert.match(DDL_V2, /CREATE TRIGGER IF NOT EXISTS memory_au/);
  assert.match(DDL_V2, /CREATE TABLE IF NOT EXISTS correction/);
  assert.match(DDL_V2, /is_holdout INTEGER/);
  assert.match(DDL_V2, /relationship/);
  assert.match(DDL_V2, /ingest_job/);
  assert.match(DDL_V2, /CREATE TABLE IF NOT EXISTS profile/);
  assert.match(DDL_V2, /CREATE TABLE IF NOT EXISTS media/);
  assert.match(DDL_V2, /avatar_path TEXT/);
});
