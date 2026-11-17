// 与 Rust 宿主命令的契约。
// 浏览器里（纯 vite dev）命令不可用：界面会提示改用桌面应用启动。

import { invoke } from "@tauri-apps/api/core";

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
      title: "常在 · 技术自检",
      body: "如果你看到这条通知，说明 Windows 通知链路可用。这条不是她发的。",
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
};
