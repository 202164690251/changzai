import { useEffect, useRef, useState, type ReactElement } from "react";
import { unzipSync } from "fflate";
import { listLive2DModels, loadLive2D, removeLive2D, saveLive2D } from "../lib/live2dStore.ts";

export interface Live2DImportProps {
  conversationId: string | null;
}

const RUNTIME_FILE = /\.(json|moc3|png|jpe?g|webp|wav|mp3|ogg)$/i;

function zipToFiles(buffer: ArrayBuffer): File[] {
  // 先过滤再解压：大肥鱼这类模型带 130MB PSD，直接全解会卡死/超限。
  const entries = unzipSync(new Uint8Array(buffer), {
    filter: (file) => RUNTIME_FILE.test(file.name),
  });
  return Object.entries(entries)
    .filter(([path, data]) => !path.endsWith("/") && data.length > 0)
    .map(([path, data]) => {
      const name = path.split("/").pop() || "file";
      const type = name.endsWith(".json")
        ? "application/json"
        : name.endsWith(".png")
          ? "image/png"
          : "application/octet-stream";
      const file = new File([data as unknown as BlobPart], name, { type });
      Object.defineProperty(file, "webkitRelativePath", { value: path });
      return file;
    });
}

export function Live2DImport({ conversationId }: Live2DImportProps): ReactElement {
  const folderRef = useRef<HTMLInputElement | null>(null);
  const zipRef = useRef<HTMLInputElement | null>(null);
  const pendingRef = useRef<File[] | null>(null);
  const [modelName, setModelName] = useState<string | null>(null);
  const [modelOptions, setModelOptions] = useState<string[]>([]);
  const [selectedModel, setSelectedModel] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setModelName(null);
    setError(null);
    setMessage(null);
    setModelOptions([]);
    pendingRef.current = null;
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

  const commit = async (files: File[], modelPath: string): Promise<void> => {
    if (!conversationId) return;
    setBusy(true);
    setError(null);
    setMessage("正在写入模型，请稍等…");
    try {
      const stored = await saveLive2D(conversationId, files, modelPath);
      setModelName(stored.name);
      setMessage("Live2D 模型已导入，桌宠会自动切换。");
      setModelOptions([]);
      pendingRef.current = null;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Live2D 导入失败");
      setMessage(null);
    } finally {
      setBusy(false);
    }
  };

  const prepare = (files: File[]): void => {
    setError(null);
    setMessage(null);
    const models = listLive2DModels(files);
    if (models.length === 0) {
      setError("没有找到 .model3.json；请选择 koharu/runtime 或 haruto/runtime 文件夹");
      return;
    }
    pendingRef.current = files;
    if (models.length === 1) {
      void commit(files, models[0]!);
      return;
    }
    setModelOptions(models);
    setSelectedModel(models[0]!);
    setMessage("检测到多个模型，请选择要导入的角色。");
  };

  const importZip = async (file: File | undefined): Promise<void> => {
    if (!file) return;
    setBusy(true);
    setError(null);
    setMessage("正在解压模型压缩包…");
    try {
      const files = zipToFiles(await file.arrayBuffer());
      setBusy(false);
      prepare(files);
    } catch (cause) {
      setBusy(false);
      setError(cause instanceof Error ? cause.message : "zip 解压失败");
      setMessage(null);
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
          onClick={() => folderRef.current?.click()}
        >
          {modelName ? "更换模型文件夹" : "导入模型文件夹"}
        </button>
        <button
          type="button"
          className="btn"
          disabled={busy || !conversationId}
          onClick={() => zipRef.current?.click()}
        >
          导入 .zip
        </button>
        {modelName && (
          <button type="button" className="btn" disabled={busy} onClick={() => void remove()}>
            移除模型
          </button>
        )}
      </div>
      {modelOptions.length > 1 && (
        <div className="live2d-picker">
          <select
            className="text-input"
            value={selectedModel}
            onChange={(event) => setSelectedModel(event.target.value)}
          >
            {modelOptions.map((path) => (
              <option key={path} value={path}>
                {path}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="btn primary"
            disabled={busy}
            onClick={() => {
              const files = pendingRef.current;
              if (files) void commit(files, selectedModel);
            }}
          >
            导入所选
          </button>
        </div>
      )}
      {message !== null && <p className="settings-note">{message}</p>}
      {error !== null && <p className="settings-warn">{error}</p>}
      <p className="settings-hint">
        支持 Cubism 4 模型；直接选择包含 .model3.json 的 runtime 文件夹，或上传整个 zip。
        模型只在本机读取，不上传。
      </p>
      <input
        ref={(node) => {
          folderRef.current = node;
          if (node) node.setAttribute("webkitdirectory", "");
        }}
        type="file"
        multiple
        className="visually-hidden"
        tabIndex={-1}
        onChange={(event) => {
          const files = event.target.files ? Array.from(event.target.files) : [];
          event.target.value = "";
          prepare(files);
        }}
      />
      <input
        ref={zipRef}
        type="file"
        accept=".zip,application/zip"
        className="visually-hidden"
        tabIndex={-1}
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          void importZip(file);
        }}
      />
    </div>
  );
}
