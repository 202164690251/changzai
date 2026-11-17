// Step 7 · 最小评测：黄金集 + mock 响应；真实模型结果需另行导出 responses.json
import { readFileSync, writeFileSync } from "node:fs";
import { evaluateCase, summarize, type GoldenCase } from "../packages/core/src/eval/metrics.ts";

const golden = JSON.parse(
  readFileSync(new URL("../eval/golden.json", import.meta.url), "utf8"),
) as GoldenCase[];
const responses = JSON.parse(
  readFileSync(new URL("../eval/mock-responses.json", import.meta.url), "utf8"),
) as Record<string, string>;

const results = golden.map((testCase) => evaluateCase(testCase, responses[testCase.id] ?? ""));
const summary = summarize(results);
const lines = [
  "# 评测报告（mock）",
  "",
  `- 日期：${new Date().toISOString().slice(0, 10)}`,
  `- 用例：${summary.total}`,
  `- 通过：${summary.passed}`,
  `- 失败：${summary.failed}`,
  "",
  "| 用例 | 结果 | 原因 |",
  "|---|---|---|",
  ...results.map((result) => `| ${result.id} | ${result.passed ? "PASS" : "FAIL"} | ${result.reasons.join("；") || "-"} |`),
  "",
  "> 这是 mock 响应的 harness 自检，不是真人盲测；真实模型结果需用 `--responses` 生成后替换。",
];
writeFileSync(new URL("../docs/eval-report.md", import.meta.url), lines.join("\n"), "utf8");
console.log(lines.slice(0, 7).join("\n"));
if (summary.failed > 0) {
  console.error("评测失败：", summary.failures.map((failure) => `${failure.id}: ${failure.reasons.join("；")}`).join("\n"));
  process.exit(1);
}
