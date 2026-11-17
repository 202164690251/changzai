// 与 Rust 宿主命令的契约（Step 1 技术自检）
// 浏览器里（纯 vite dev）这些命令不可用，UI 会显示"请用 Tauri 启动"。

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

export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function requireTauri(): void {
  if (!isTauri()) {
    throw new Error("当前在浏览器中运行：请用 `pnpm dev`（Tauri 桌面）启动后再执行自检。");
  }
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
};
