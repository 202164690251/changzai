// 常在 · 导入流水线（Step 2）
// 原始文件 → 适配器嗅探/解析 → 归一化 → 去重 → 行为信号 → holdout 切分 → 体检报告
// 纯函数：不读文件、不联网；文件内容由 UI / Rust 层读取后传进来。

import type { HealthReport, NormalizedMessage, RawMessage } from "@veyrimi/shared";
import { AdapterRegistry } from "./adapters/base.ts";
import type { IngestAdapter } from "./adapters/base.ts";
import { PlaintextPasteAdapter } from "./adapters/plaintext.ts";
import { WechatmsgTxtAdapter } from "./adapters/wechatmsg-txt.ts";
import { WechatmsgCsvAdapter } from "./adapters/wechatmsg-csv.ts";
import { LiuhenJsonAdapter } from "./adapters/liuhen-json.ts";
import { QqTxtAdapter } from "./adapters/qq-txt.ts";
import { ChatDataJsAdapter } from "./adapters/chatdata-js.ts";
import { dedupeMessages, normalizeMessage, sortMessages, validateMessage } from "./schema.ts";
import { fillBehaviorSignals } from "./burst.ts";
import { buildHealthReport } from "./report.ts";

/** 一个待导入文件：文件名用于嗅探与展示，text 是读取后的文本内容 */
export interface ImportSource {
  name: string;
  text: string;
}

export interface ImportOptions {
  /** holdout 目标条数（默认 400；数据少时自动缩小） */
  holdoutTarget?: number;
  holdoutSeed?: number;
  now?: number;
}

export interface AdapterUsage {
  sourceName: string;
  adapterName: string;
  confidence: number;
  rawCount: number;
  parsedCount: number;
}

export interface ImportResult {
  messages: NormalizedMessage[];
  report: HealthReport;
  adapters: AdapterUsage[];
  holdoutCount: number;
  warnings: string[];
  /** 解析出的原始条数（去重前） */
  totalRaw: number;
}

/** 默认适配器顺序：越具体的越靠前（detect 按置信度排序，顺序只影响平手） */
export function createDefaultRegistry(): AdapterRegistry {
  return new AdapterRegistry()
    // plaintext 放第一位：单行粘贴与 wechatmsg_txt 置信度打平时优先按粘贴处理
    .register(new PlaintextPasteAdapter())
    .register(new WechatmsgCsvAdapter())
    .register(new LiuhenJsonAdapter())
    .register(new WechatmsgTxtAdapter())
    .register(new QqTxtAdapter())
    .register(new ChatDataJsAdapter());
}

/** 供设置页/导入向导展示的支持格式 */
export function adapterCatalog(registry: AdapterRegistry = createDefaultRegistry()): Array<{
  name: string;
  description: string;
}> {
  return registry.list().map((adapter: IngestAdapter) => ({
    name: adapter.name,
    description:
      adapter.description ??
      (adapter.name === "plaintext_paste"
        ? "直接粘贴：每行「时间 发送人: 内容」"
        : "聊天记录导出文件"),
  }));
}

/** mulberry32：确定性 PRNG，保证 holdout 可复现 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * 从她的真实回复里抽 holdout（固定种子）。数据少时按 5% 缩放，最少 20 条。
 * 只标记，不删除；蒸馏/检索必须通过 is_holdout 字段排除它们。
 */
export function applyHoldoutSplit(
  messages: NormalizedMessage[],
  target = 400,
  seed = 20261117,
): { messages: NormalizedMessage[]; holdoutCount: number } {
  const candidates: number[] = [];
  messages.forEach((message, index) => {
    if (message.sender === "her" && message.type === "text" && message.content.trim().length > 0) {
      candidates.push(index);
    }
  });
  const targetCount =
    candidates.length >= 8000
      ? Math.min(target, candidates.length)
      : Math.max(candidates.length >= 200 ? 20 : 0, Math.min(target, Math.floor(candidates.length * 0.05)));
  if (targetCount === 0) return { messages, holdoutCount: 0 };

  const random = mulberry32(seed);
  // Fisher-Yates 只洗需要的部分
  const pool = [...candidates];
  for (let i = 0; i < targetCount; i += 1) {
    const j = i + Math.floor(random() * (pool.length - i));
    const a = pool[i];
    const b = pool[j];
    if (a === undefined || b === undefined) continue;
    pool[i] = b;
    pool[j] = a;
  }
  const chosen = new Set(pool.slice(0, targetCount));
  const out = messages.map((message, index) =>
    chosen.has(index) ? { ...message, is_holdout: 1 as const } : message,
  );
  return { messages: out, holdoutCount: chosen.size };
}

export function importSources(
  sources: ImportSource[],
  options: ImportOptions = {},
  registry: AdapterRegistry = createDefaultRegistry(),
): ImportResult {
  const warnings: string[] = [];
  const adapters: AdapterUsage[] = [];
  const raw: NormalizedMessage[] = [];
  let skippedNoTs = 0;
  let totalRaw = 0;

  const parseWith = (adapter: IngestAdapter, text: string): RawMessage[] => {
    try {
      return adapter.parse({ text });
    } catch (error) {
      warnings.push(`适配器 ${adapter.name} 解析失败：${error instanceof Error ? error.message : String(error)}`);
      return [];
    }
  };

  for (const source of sources) {
    if (!source.text.trim()) {
      warnings.push(`${source.name}：文件为空，已跳过`);
      continue;
    }
    const detections = registry.detect({ fileName: source.name, text: source.text });
    const best = detections[0];
    let parsed: RawMessage[] = [];
    let usedName = "unparsed";
    let confidence = 0;
    if (best) {
      usedName = best.adapter.name;
      confidence = best.confidence;
      parsed = parseWith(best.adapter, source.text);
    }
    // 选中的适配器解析不出东西时，退回 plaintext 再试一次
    if (parsed.length === 0) {
      const fallback = new PlaintextPasteAdapter();
      const fallbackParsed = parseWith(fallback, source.text);
      if (fallbackParsed.length > 0) {
        parsed = fallbackParsed;
        usedName = fallback.name;
        confidence = Math.max(confidence, 0.2);
        warnings.push(`${source.name}：没有识别出专用格式，按「粘贴文本」解析`);
      }
    }
    totalRaw += parsed.length;
    adapters.push({
      sourceName: source.name,
      adapterName: usedName,
      confidence: Math.round(confidence * 100) / 100,
      rawCount: parsed.length,
      parsedCount: parsed.length,
    });
    if (parsed.length === 0) {
      warnings.push(`${source.name}：没有解析出任何消息，请检查格式`);
      continue;
    }
    for (const item of parsed) {
      const normalized = normalizeMessage(item, { convId: "conv_default" });
      if (!normalized.ts) {
        skippedNoTs += 1;
        continue;
      }
      if (normalized.type === "text" && normalized.content.trim().length === 0) continue;
      if (validateMessage(normalized).length > 0) {
        warnings.push(`${source.name}：有消息字段异常（已尽量修复）`);
      }
      raw.push(normalized);
    }
  }

  if (skippedNoTs > 0) warnings.push(`有 ${skippedNoTs} 条消息缺少时间戳，已跳过`);
  if (raw.length === 0) {
    return {
      messages: [],
      report: buildHealthReport([], { now: options.now }),
      adapters,
      holdoutCount: 0,
      warnings,
      totalRaw,
    };
  }

  const { messages: deduped, duplicates } = dedupeMessages(sortMessages(raw));
  if (duplicates > 0) warnings.push(`去重合并了 ${duplicates} 条重复消息`);
  const withSignals = fillBehaviorSignals(deduped);
  const { messages, holdoutCount } = applyHoldoutSplit(
    withSignals,
    options.holdoutTarget ?? 400,
    options.holdoutSeed ?? 20261117,
  );

  const report = buildHealthReport(messages, { now: options.now });
  if (report.fidelity_level === "low") {
    warnings.push("数据量偏少：将进入轻度模式（只启用风格卡与检索）");
  }
  if (holdoutCount > 0 && holdoutCount < 300) {
    warnings.push(`holdout 只有 ${holdoutCount} 条（建议 300–500）；数据量增大后会自动补足`);
  }
  if (report.missing.length > 0) {
    warnings.push(`数据有 ${report.missing.length} 段明显空缺：${report.missing.slice(0, 3).join("；")}`);
  }

  return { messages, report, adapters, holdoutCount, warnings, totalRaw };
}
