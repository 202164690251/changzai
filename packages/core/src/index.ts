// 常在 · core 包入口
// 架构纪律：本包禁止出现 window / fs / fetch / localStorage；
// 外部能力一律通过 ports.ts 注入。

export * from "./ports.ts";
export * from "./ingest/schema.ts";
export * from "./ingest/burst.ts";
export * from "./ingest/report.ts";
export * from "./ingest/adapters/base.ts";
export * from "./ingest/adapters/plaintext.ts";
export * from "./ingest/adapters/common.ts";
export * from "./ingest/adapters/wechatmsg-txt.ts";
export * from "./ingest/adapters/wechatmsg-csv.ts";
export * from "./ingest/adapters/liuhen-json.ts";
export * from "./ingest/adapters/qq-txt.ts";
export * from "./ingest/pipeline.ts";
export * from "./persona/types.ts";
export * from "./persona/build.ts";
export * from "./persona/prompt.ts";
export * from "./emotion/state.ts";
export * from "./arc/director.ts";
export * from "./governor/comfort.ts";
export * from "./memory/index.ts";
export * from "./safety/factGuard.ts";
export * from "./runtime/prompt.ts";
export * from "./media/index.ts";
export * from "./db/ddl.ts";
