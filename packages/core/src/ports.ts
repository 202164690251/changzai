// 常在 · 平台能力注入接口（core 禁止直接使用 window / fs / fetch / localStorage）
// Step 1 只定义契约；Step 2 起由 apps/app 的 Rust 宿主 / UI 层实现并注入。
// 注意：这里刻意不引用 DOM 的 AbortSignal 类型，保持 core 平台无关。

import type { NormalizedMessage, HealthReport, Progress } from "@veyrimi/shared";

/** 与 DOM/Node 的 AbortSignal 结构兼容的最小接口 */
export interface AbortSignalLike {
  readonly aborted: boolean;
  addEventListener(type: "abort", listener: () => void): void;
}

export interface DbPort {
  exec(sql: string, params?: unknown[]): Promise<void>;
  query<T = unknown>(sql: string, params?: unknown[]): Promise<T[]>;
  transaction<T>(fn: (tx: DbPort) => Promise<T>): Promise<T>;
}

export interface HttpPort {
  /** 流式 chat：逐块产出文本（由实现负责 SSE/JSON 解析、重试与超时） */
  streamChat(req: {
    baseUrl: string;
    apiKey: string;
    model: string;
    messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
    temperature?: number;
    signal?: AbortSignalLike;
  }): AsyncIterable<string>;
}

export interface ClockPort {
  now(): number;
  sleep(ms: number, signal?: AbortSignalLike): Promise<void>;
}

export interface NotifyPort {
  notify(input: { title: string; body: string; silent?: boolean }): Promise<void>;
}

export interface KeyPort {
  get(name: string): Promise<string | null>;
  set(name: string, value: string): Promise<void>;
  delete(name: string): Promise<void>;
}

export interface FilePort {
  readText(path: string): Promise<string>;
  writeText(path: string, content: string): Promise<void>;
  list(dir: string): Promise<Array<{ name: string; path: string; size: number }>>;
}

export interface Ports {
  db: DbPort;
  http: HttpPort;
  clock: ClockPort;
  notify: NotifyPort;
  key: KeyPort;
  file: FilePort;
}

/** 导入作业接口（Step 2 实现） */
export interface IngestJob {
  importText(
    input: { fileName: string; text: string },
    onProgress?: (p: Progress) => void,
  ): Promise<{ messages: NormalizedMessage[]; report: HealthReport }>;
}
