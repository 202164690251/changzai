// 与 Rust 宿主命令的契约。
// 浏览器里（纯 vite dev）命令不可用：界面会提示改用桌面应用启动。

import { Channel, invoke } from "@tauri-apps/api/core";

export interface AppInfo {
  version: string;
  tauriVersion: string;
  os: string;
  arch: string;
  webview: string;
}

export interface ProbeStep {
  name: string;
  ok: boolean;
  ms: number;
  detail: string | null;
}

export interface DbProbeResult {
  ok: boolean;
  dbPath: string;
  encryptedHeader: boolean;
  fts5: boolean;
  trigram: boolean;
  argon2: boolean;
  steps: ProbeStep[];
  error: string | null;
}

export interface HttpProbeResult {
  ok: boolean;
  url: string;
  firstChunkMs: number;
  totalMs: number;
  chunks: number;
  bytes: number;
  text: string;
  error: string | null;
}

export interface NotifyProbeResult {
  ok: boolean;
  message: string;
}

export type MediaKind = "image" | "voice";

/** Rust `import_media_files` 返回的单个素材。 */
export interface ImportedMediaFile {
  name: string;
  path: string;
  size: number;
  kind: MediaKind;
  dataUrl: string;
}

export interface ImportMediaResult {
  ok: boolean;
  files: ImportedMediaFile[];
  message: string;
}

/* ───────────────── Step 2：导入 / 数据库 / 资料 ───────────────── */

export interface PickedImportFile {
  name: string;
  path: string;
  text: string;
  size: number;
}

export interface PickImportResult {
  ok: boolean;
  files: PickedImportFile[];
  message: string;
}

export interface ImportMessageRow {
  id: string;
  convId: string;
  ts: number;
  sender: string;
  type: string;
  content: string;
  mediaPath: string | null;
  replyTo: string | null;
  latencyS: number | null;
  burstIndex: number;
  burstSize: number;
  isHoldout: number;
}

export interface ImportPayload {
  sourceNames: string[];
  messages: ImportMessageRow[];
  report: unknown;
}

export interface PersistResult {
  ok: boolean;
  inserted: number;
  holdout: number;
  dbPath: string;
  messageCount: number;
  error: string | null;
}

export interface DbInitResult {
  ok: boolean;
  dbPath: string;
  messageCount: number;
  error: string | null;
}

export interface DbStats {
  ok: boolean;
  dbPath: string;
  messageCount: number;
  herCount: number;
  spanDays: number;
  holdoutCount: number;
  lastImportAt: number | null;
}

export interface ProfileSidePayload {
  name: string;
  avatar: string | null;
}

export interface ProfilePayload {
  her: ProfileSidePayload;
  me: ProfileSidePayload;
}

export interface MediaPersistItem {
  name: string;
  path: string;
  size: number;
  kind: MediaKind;
}

export interface MediaPersistResult {
  ok: boolean;
  inserted: number;
  message: string;
}

/* ───────────────── Step 3：模型 / 人格 / 流式对话 ───────────────── */

export interface LlmConfig {
  provider: string;
  baseUrl: string;
  model: string;
  fastModel: string;
  apiKey: string;
  temperature: number;
}

export interface TtsRequest {
  text: string;
  provider: "windows" | "openai";
  voice: string;
  rate: number;
  baseUrl: string;
  apiKey: string;
  model: string;
}

export interface TtsResult {
  audioBase64: string;
  mime: string;
  provider: string;
}

export interface TtsVoice {
  name: string;
  culture: string;
}

export interface SttResult {
  text: string;
  confidence: number;
}

export interface LlmTestResult {
  ok: boolean;
  text: string;
  error: string;
}

export type ChatRole = "system" | "user" | "assistant";

export interface ChatMessagePayload {
  role: ChatRole;
  content: string;
}

export interface LlmChatEvent {
  kind: "delta" | "done" | "error";
  text: string;
}

export interface BackupResult {
  ok: boolean;
  path: string;
  message: string;
}

export interface RestoreResult {
  ok: boolean;
  message: string;
  backupPath: string;
}

export interface DestroyResult {
  ok: boolean;
  removed: string[];
  message: string;
}

export interface MemoryHit {
  id: string;
  text: string;
  ts: number;
  importance: number;
  valence: number | null;
  score: number;
}

export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

const BROWSER_HINT = "当前在浏览器中运行：请用 `pnpm dev`（Tauri 桌面）启动后再试。";

function requireTauri(): void {
  if (!isTauri()) throw new Error(BROWSER_HINT);
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/**
 * 兼容 Rust 侧的序列化写法：契约字段是 dataUrl，若后端仍按 snake_case 返回 data_url 也能读。
 * 缺字段的条目直接丢弃，避免渲染空图片。
 */
function normalizeMediaFile(raw: unknown): ImportedMediaFile | null {
  if (typeof raw !== "object" || raw === null) return null;
  const record = raw as Record<string, unknown>;
  const dataUrl = asString(record.dataUrl).length > 0 ? asString(record.dataUrl) : asString(record.data_url);
  if (dataUrl.length === 0) return null;
  const kind: MediaKind = record.kind === "voice" ? "voice" : "image";
  const rawSize = record.size;
  const size = typeof rawSize === "number" && Number.isFinite(rawSize) ? rawSize : 0;
  return {
    name: asString(record.name).length > 0 ? asString(record.name) : kind === "voice" ? "语音" : "图片",
    path: asString(record.path),
    size,
    kind,
    dataUrl,
  };
}

export interface ChatStoredRow {
  id: string;
  ts: number;
  payload: string;
}

export const api = {
  async appInfo(): Promise<AppInfo> {
    requireTauri();
    return invoke<AppInfo>("app_info");
  },
  async dbProbe(): Promise<DbProbeResult> {
    requireTauri();
    return invoke<DbProbeResult>("db_probe", { dir: null });
  },
  async httpProbe(): Promise<HttpProbeResult> {
    requireTauri();
    return invoke<HttpProbeResult>("http_stream_probe");
  },
  async notifyProbe(): Promise<NotifyProbeResult> {
    requireTauri();
    return invoke<NotifyProbeResult>("notify_probe", {
      title: "如晤 · 技术自检",
      body: "如果你看到这条通知，说明 Windows 通知链路可用。这条不是 ta 发的。",
    });
  },
  /** 回忆素材导入：由 Rust 弹出系统文件选择框，读回 dataUrl。 */
  async importMediaFiles(kind: MediaKind): Promise<ImportMediaResult> {
    requireTauri();
    const result = await invoke<unknown>("import_media_files", { kind });
    const record = (typeof result === "object" && result !== null ? result : {}) as Record<string, unknown>;
    const rawFiles = Array.isArray(record.files) ? record.files : [];
    const files: ImportedMediaFile[] = [];
    for (const raw of rawFiles) {
      const file = normalizeMediaFile(raw);
      if (file !== null) files.push(file);
    }
    return {
      ok: record.ok === true,
      files,
      message: asString(record.message),
    };
  },
  /** Step 2：初始化 SQLCipher 数据库（DDL 唯一事实源在 core 包） */
  async dbInit(ddl: string): Promise<DbInitResult> {
    requireTauri();
    return invoke<DbInitResult>("db_init", { ddl });
  },
  async dbStats(): Promise<DbStats> {
    requireTauri();
    return invoke<DbStats>("db_stats");
  },
  /** Step 2：选择聊天记录文件（txt/csv/json），Rust 读取内容并处理编码 */
  async pickImportFiles(): Promise<PickImportResult> {
    requireTauri();
    return invoke<PickImportResult>("pick_import_files");
  },
  /** Step 2：把归一化后的消息与报告写入 SQLCipher */
  async importPersist(payload: ImportPayload): Promise<PersistResult> {
    requireTauri();
    return invoke<PersistResult>("import_persist", { payload });
  },
  async profileLoad(): Promise<ProfilePayload | null> {
    requireTauri();
    return invoke<ProfilePayload | null>("profile_load");
  },
  async profileSave(profile: ProfilePayload): Promise<boolean> {
    requireTauri();
    return invoke<boolean>("profile_save", { profile });
  },
  async mediaPersist(files: MediaPersistItem[]): Promise<MediaPersistResult> {
    requireTauri();
    return invoke<MediaPersistResult>("media_persist", { files });
  },
  /** Step 3：模型配置（存在 SQLCipher setting 表） */
  async llmConfigLoad(): Promise<LlmConfig> {
    requireTauri();
    return invoke<LlmConfig>("llm_config_load");
  },
  async llmConfigSave(config: LlmConfig): Promise<boolean> {
    requireTauri();
    return invoke<boolean>("llm_config_save", { config });
  },
  async llmTest(): Promise<LlmTestResult> {
    requireTauri();
    return invoke<LlmTestResult>("llm_test");
  },
  async ttsSpeak(request: TtsRequest): Promise<TtsResult> {
    requireTauri();
    return invoke<TtsResult>("tts_speak", { request });
  },
  async ttsVoices(): Promise<TtsVoice[]> {
    requireTauri();
    return invoke<TtsVoice[]>("tts_voices");
  },
  async petOpen(): Promise<boolean> {
    requireTauri();
    return invoke<boolean>("pet_open");
  },
  async petClose(): Promise<boolean> {
    requireTauri();
    return invoke<boolean>("pet_close");
  },
  async petIsOpen(): Promise<boolean> {
    requireTauri();
    return invoke<boolean>("pet_is_open");
  },
  async videoCallOpen(): Promise<boolean> {
    requireTauri();
    return invoke<boolean>("video_call_open");
  },
  async videoCallClose(): Promise<boolean> {
    requireTauri();
    return invoke<boolean>("video_call_close");
  },
  async videoCallIsOpen(): Promise<boolean> {
    requireTauri();
    return invoke<boolean>("video_call_is_open");
  },
  async sttTranscribe(audioBase64: string): Promise<SttResult> {
    requireTauri();
    return invoke<SttResult>("stt_transcribe", { request: { audioBase64 } });
  },
  /** Step 3：人格卡持久化 */
  async personaSave(persona: unknown): Promise<boolean> {
    requireTauri();
    return invoke<boolean>("persona_save", { persona });
  },
  async personaLoad(): Promise<unknown | null> {
    requireTauri();
    return invoke<unknown | null>("persona_load");
  },
  async chatAppend(id: string, ts: number, payload: string): Promise<boolean> {
    requireTauri();
    return invoke<boolean>("chat_append", { id, ts, payload });
  },
  async chatLoad(limit = 300): Promise<ChatStoredRow[]> {
    requireTauri();
    return invoke<ChatStoredRow[]>("chat_load", { limit });
  },
  async chatDelete(id: string): Promise<boolean> {
    requireTauri();
    return invoke<boolean>("chat_delete", { id });
  },
  async chatClear(): Promise<boolean> {
    requireTauri();
    return invoke<boolean>("chat_clear");
  },

  async messagesLoad(limit?: number, convId?: string | null): Promise<ImportMessageRow[]> {
    requireTauri();
    return invoke<ImportMessageRow[]>("messages_load", {
      limit: limit ?? null,
      convId: convId ?? null,
    });
  },
  /** Step 4：通用 setting 读写（情绪状态/统计事件等） */
  async settingGet(key: string): Promise<string | null> {
    requireTauri();
    return invoke<string | null>("setting_get", { key });
  },
  async settingSet(key: string, value: string): Promise<boolean> {
    requireTauri();
    return invoke<boolean>("setting_set", { key, value });
  },
  /** Step 4：记忆重建 / 检索（SQLite memory + FTS5 trigram） */
  async memoryRebuild(scope?: string | null): Promise<number> {
    requireTauri();
    return invoke<number>("memory_rebuild", { scope: scope ?? null });
  },
  async memorySearch(query: string, limit = 20, scope?: string | null): Promise<MemoryHit[]> {
    requireTauri();
    return invoke<MemoryHit[]>("memory_search", { query, limit, scope: scope ?? null });
  },
  async backupExport(passphrase: string): Promise<BackupResult> {
    requireTauri();
    return invoke<BackupResult>("backup_export", { passphrase });
  },
  async backupRestore(passphrase: string): Promise<RestoreResult> {
    requireTauri();
    return invoke<RestoreResult>("backup_restore", { passphrase });
  },
  async dataDestroy(confirm: string): Promise<DestroyResult> {
    requireTauri();
    return invoke<DestroyResult>("data_destroy", { confirm });
  },
  async pinSet(pin: string): Promise<boolean> {
    requireTauri();
    return invoke<boolean>("pin_set", { pin });
  },
  async pinVerify(pin: string): Promise<boolean> {
    requireTauri();
    return invoke<boolean>("pin_verify", { pin });
  },
  async pinDisable(pin: string): Promise<boolean> {
    requireTauri();
    return invoke<boolean>("pin_disable", { pin });
  },
  async pinEnabled(): Promise<boolean> {
    requireTauri();
    return invoke<boolean>("pin_enabled");
  },
  async memoryCount(scope?: string | null): Promise<number> {
    requireTauri();
    return invoke<number>("memory_count", { scope: scope ?? null });
  },
  /** Step 3：流式对话；onEvent 先于 Promise resolve 收到 delta */
  async llmChatStream(
    messages: ChatMessagePayload[],
    onEvent: (event: LlmChatEvent) => void,
  ): Promise<void> {
    requireTauri();
    const channel = new Channel<LlmChatEvent>();
    channel.onmessage = onEvent;
    await invoke("llm_chat_stream", { messages, onEvent: channel });
  },
};
