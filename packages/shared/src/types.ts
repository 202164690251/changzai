// 常在 · 共享类型（前后端、core、Rust 侧 JSON 契约都以此为准）

export type Sender = "her" | "me" | "system";

export type MessageType =
  | "text"
  | "image"
  | "voice"
  | "video"
  | "emoji"
  | "quote"
  | "file"
  | "redpacket"
  | "call"
  | "system";

/** 导入阶段的宽松原始消息（字段可能缺失，由 ingest 补全） */
export interface RawMessage {
  msg_id?: string;
  conv_id?: string;
  ts?: number | string;
  sender?: string;
  sender_name?: string;
  type?: string;
  content?: string;
  media_path?: string | null;
  media_duration?: number | null;
  reply_to?: string | null;
  latency_s?: number | null;
  burst_index?: number;
  burst_size?: number;
  raw_type?: number | string;
}

/** 归一化消息（02 §3.1；latency/burst/reply_to 由 ingest 补全） */
export interface NormalizedMessage {
  msg_id: string;
  conv_id: string;
  ts: number;
  sender: Sender;
  sender_name: string;
  type: MessageType;
  content: string;
  media_path: string | null;
  media_duration: number | null;
  reply_to: string | null;
  latency_s: number | null;
  burst_index: number;
  burst_size: number;
  raw_type: number;
  /** 1 = 留出评测集，不参与蒸馏/检索 */
  is_holdout: 0 | 1;
}

export interface IngestIssue {
  code: string;
  message: string;
  index?: number;
  raw?: unknown;
}

export type FidelityLevel = "low" | "medium" | "high";

/** 数据体检报告（02 §4.4） */
export interface HealthReport {
  total_msgs: number;
  her_msgs: number;
  span_days: number;
  night_ratio: number;
  avg_len: number;
  burst_p50: number;
  conflict_episodes: number;
  sweet_episodes: number;
  has_voice: boolean;
  has_image: boolean;
  fidelity_estimate: number;
  fidelity_level: FidelityLevel;
  missing: string[];
  advice: string;
  /** 报告口径与算法版本，便于复现 */
  meta: {
    algorithm: "fidelity_v1";
    built_at: number;
    holdout_count: number;
  };
}

/** 导入进度（CoreAPI.importFiles 的进度对象） */
export interface Progress {
  stage: "read" | "parse" | "normalize" | "dedupe" | "signals" | "done";
  processed: number;
  total?: number;
  message?: string;
}
