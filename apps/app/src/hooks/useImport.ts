// Step 2：聊天记录导入（选文件 → core 解析/体检 → 写 SQLCipher）
import { useCallback, useState } from "react";
import { importSources, type ImportResult } from "@changzai/core";
import { api, isTauri, type ImportMessageRow } from "../lib/tauri.ts";

export type ImportStep = "idle" | "picking" | "parsing" | "done" | "error";

export interface ImportState {
  step: ImportStep;
  message: string;
  result: ImportResult | null;
  saved: boolean;
}

export interface ImportApi {
  state: ImportState;
  canImport: boolean;
  run: () => void;
  reset: () => void;
}

const INITIAL: ImportState = {
  step: "idle",
  message: "",
  result: null,
  saved: false,
};

function toRows(result: ImportResult): ImportMessageRow[] {
  return result.messages.map((message) => ({
    id: message.msg_id,
    convId: message.conv_id,
    ts: message.ts,
    sender: message.sender,
    type: message.type,
    content: message.content,
    mediaPath: message.media_path,
    replyTo: message.reply_to,
    latencyS: message.latency_s,
    burstIndex: message.burst_index,
    burstSize: message.burst_size,
    isHoldout: message.is_holdout,
  }));
}

export function useImport(onSaved: () => Promise<void>): ImportApi {
  const [state, setState] = useState<ImportState>(INITIAL);
  const canImport = isTauri();

  const run = useCallback(() => {
    if (!canImport) {
        setState({ step: "error", message: "请用桌面应用导入", result: null, saved: false });
        return;
      }
      void (async () => {
        setState({ step: "picking", message: "正在选择文件…", result: null, saved: false });
        try {
          const picked = await api.pickImportFiles();
          if (!picked.ok || picked.files.length === 0) {
            setState({ step: "idle", message: picked.message, result: null, saved: false });
            return;
          }
          setState({
            step: "parsing",
            message: `正在解析 ${picked.files.length} 个文件…`,
            result: null,
            saved: false,
          });
          // 让 UI 先渲染「解析中」，再跑同步解析
          await new Promise((resolve) => window.setTimeout(resolve, 60));
          const result = importSources(
            picked.files.map((file) => ({ name: file.name, text: file.text })),
            { now: Date.now() },
          );
          if (result.messages.length === 0) {
            setState({
              step: "error",
              message: result.warnings[0] ?? "没有解析出可导入的消息",
              result,
              saved: false,
            });
            return;
          }
          setState({
            step: "parsing",
            message: `正在写入 ${result.messages.length} 条消息…`,
            result,
            saved: false,
          });
          const persisted = await api.importPersist({
            sourceNames: picked.files.map((file) => file.name),
            messages: toRows(result),
            report: result.report,
          });
          if (!persisted.ok) {
            setState({
              step: "error",
              message: persisted.error ?? "写入数据库失败",
              result,
              saved: false,
            });
            return;
          }
          setState({ step: "done", message: "", result, saved: true });
          await onSaved();
        } catch (error) {
          setState({
            step: "error",
            message: error instanceof Error ? error.message : String(error),
            result: null,
            saved: false,
          });
        }
    })();
  }, [canImport, onSaved]);

  const reset = useCallback(() => setState(INITIAL), []);

  return { state, canImport, run, reset };
}
