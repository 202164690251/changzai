import { useCallback, useState } from "react";
import { api, isTauri, type ImportedMediaFile, type MediaKind } from "../lib/tauri.ts";

export interface ImportState {
  busy: boolean;
  ok: boolean | null;
  message: string | null;
  count: number;
}

export interface MediaImportApi {
  state: ImportState;
  canImport: boolean;
  importMedia: (kind: MediaKind) => void;
}

const INITIAL_STATE: ImportState = { busy: false, ok: null, message: null, count: 0 };

/**
 * 回忆素材导入：调用 Rust 命令，成功把素材交给聊天，失败显示后端 message。
 * 浏览器里不发起调用，由界面禁用按钮并提示改用桌面应用。
 */
export function useMediaImport(onImported: (files: ImportedMediaFile[]) => void): MediaImportApi {
  const [state, setState] = useState<ImportState>(INITIAL_STATE);
  const canImport = isTauri();

  const importMedia = useCallback(
    (kind: MediaKind) => {
      if (!canImport) {
        setState((previous) => ({ ...previous, ok: false, message: "请用桌面应用导入" }));
        return;
      }
      setState((previous) => ({ ...previous, busy: true, ok: null, message: null }));
      void (async () => {
        try {
          const result = await api.importMediaFiles(kind);
          const files = Array.isArray(result.files) ? result.files : [];
          if (result.ok && files.length > 0) {
            onImported(files);
            // Step 2：把素材记录写入 media 表（失败不阻塞 UI，文件已经落盘）
            void api
              .mediaPersist(
                files.map((file) => ({
                  name: file.name,
                  path: file.path,
                  size: file.size,
                  kind: file.kind,
                })),
              )
              .catch(() => undefined);
            setState((previous) => {
              const count = previous.count + files.length;
              return { busy: false, ok: true, message: `已导入 ${count} 个素材`, count };
            });
          } else {
            setState((previous) => ({
              ...previous,
              busy: false,
              ok: false,
              message: result.message.trim().length > 0 ? result.message : "没有选中素材",
            }));
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          setState((previous) => ({ ...previous, busy: false, ok: false, message }));
        }
      })();
    },
    [canImport, onImported],
  );

  return { state, canImport, importMedia };
}
