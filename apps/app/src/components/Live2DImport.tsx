import { useEffect, useRef, useState, type ReactElement } from "react";
import { loadLive2D, removeLive2D, saveLive2D } from "../lib/live2dStore.ts";

export interface Live2DImportProps {
  conversationId: string | null;
}

export function Live2DImport({ conversationId }: Live2DImportProps): ReactElement {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [modelName, setModelName] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setModelName(null);
    setError(null);
    setMessage(null);
    if (!conversationId) return;
    void (async () => {
      try {
        const stored = await loadLive2D(conversationId);
        if (alive) setModelName(stored?.name ?? null);
      } catch {
        if (alive) setError("Live2D 存储不可用");
      }
    })();
    return () => {
      alive = false;
    };
  }, [conversationId]);

  const importFiles = async (files: FileList | null): Promise<void> => {
    if (!conversationId || !files || files.length === 0) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const stored = await saveLive2D(conversationId, files);
      setModelName(stored.name);
      setMessage("Live2D 模型已导入；桌宠会自动切换。");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Live2D 导入失败");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (): Promise<void> => {
    if (!conversationId) return;
    setBusy(true);
    setError(null);
    try {
      await removeLive2D(conversationId);
      setModelName(null);
      setMessage("已移除 Live2D 模型，桌宠回到图片模式。");
    } catch {
      setError("移除失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="live2d-import">
      <div className="live2d-status">
        <span className="field-label">Live2D 模型</span>
        <span className="settings-note">
          {modelName ? `已导入：${modelName}` : "未导入，当前使用图片桌宠"}
        </span>
      </div>
      <div className="media-actions">
        <button
          type="button"
          className="btn"
          disabled={busy || !conversationId}
          onClick={() => inputRef.current?.click()}
        >
          {modelName ? "更换 Live2D 模型" : "导入 Live2D 模型"}
        </button>
        {modelName && (
          <button type="button" className="btn" disabled={busy} onClick={() => void remove()}>
            移除模型
          </button>
        )}
      </div>
      {message !== null && <p className="settings-note">{message}</p>}
      {error !== null && <p className="settings-warn">{error}</p>}
      <p className="settings-hint">
        选择包含 .model3.json、.moc3 和 textures 的 Cubism 4 模型文件夹。模型只在本机读取，不上传。
      </p>
      <input
        ref={(node) => {
          inputRef.current = node;
          if (node) node.setAttribute("webkitdirectory", "");
        }}
        type="file"
        multiple
        className="visually-hidden"
        tabIndex={-1}
        onChange={(event) => {
          const files = event.target.files;
          event.target.value = "";
          void importFiles(files);
        }}
      />
    </div>
  );
}
