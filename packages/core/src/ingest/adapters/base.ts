// 常在 · 导入适配器接口（插件式；新格式 = 加一个文件）

import type { RawMessage } from "@changzai/shared";

export interface AdapterSource {
  /** 文件名（用于嗅探扩展名/表头） */
  fileName?: string;
  /** 文本内容（txt/csv/json/paste） */
  text?: string;
}

export interface IngestAdapter {
  readonly name: string;
  /** 0–1 置信度：判断这份输入像不像本适配器的格式 */
  sniff(source: AdapterSource): number;
  /** 解析为宽松原始消息；归一化交给 core/ingest/schema */
  parse(source: AdapterSource): RawMessage[];
  /** 供 UI 展示的格式说明 */
  readonly description?: string;
}

export class AdapterRegistry {
  private adapters: IngestAdapter[] = [];

  register(adapter: IngestAdapter): this {
    this.adapters.push(adapter);
    return this;
  }

  list(): IngestAdapter[] {
    return [...this.adapters];
  }

  /** 按置信度排序，返回最可能的适配器 */
  detect(source: AdapterSource): Array<{ adapter: IngestAdapter; confidence: number }> {
    return this.adapters
      .map((adapter) => ({ adapter, confidence: adapter.sniff(source) }))
      .filter((x) => x.confidence > 0)
      .sort((a, b) => b.confidence - a.confidence);
  }

  parseWith(name: string, source: AdapterSource): RawMessage[] {
    const adapter = this.adapters.find((a) => a.name === name);
    if (!adapter) throw new Error(`ADAPTER_NOT_FOUND: ${name}`);
    return adapter.parse(source);
  }
}
