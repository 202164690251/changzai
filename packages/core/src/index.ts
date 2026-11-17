// 常在 · core 包入口
// 架构纪律：本包禁止出现 window / fs / fetch / localStorage；
// 外部能力一律通过 ports.ts 注入。

export * from "./ports.ts";
export * from "./ingest/schema.ts";
export * from "./ingest/burst.ts";
export * from "./ingest/report.ts";
export * from "./ingest/adapters/base.ts";
export * from "./ingest/adapters/plaintext.ts";
export * from "./media/index.ts";
export * from "./db/ddl.ts";
