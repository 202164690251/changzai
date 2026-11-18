// Live2D 模型以模型文件夹的形式导入，文件存 IndexedDB，避免把二进制塞进会话 JSON。
export interface StoredLive2D {
  id: string;
  name: string;
  modelPath: string;
  files: Record<string, Blob>;
  importedAt: number;
}

const DB_NAME = "changzai-live2d";
const STORE_NAME = "models";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("无法打开 Live2D 存储"));
  });
}

async function withStore<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, mode);
    const request = run(transaction.objectStore(STORE_NAME));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Live2D 存储失败"));
    transaction.oncomplete = () => db.close();
    transaction.onerror = () => {
      db.close();
      reject(transaction.error ?? new Error("Live2D 事务失败"));
    };
  });
}

function relativePath(file: File): string {
  const raw = file.webkitRelativePath || file.name;
  const parts = raw.split("/").filter(Boolean);
  // 去掉用户选择的根文件夹名，保留模型内部的相对路径
  return parts.length > 1 ? parts.slice(1).join("/") : raw;
}

export function listLive2DModels(selected: FileList | File[]): string[] {
  return Array.from(selected)
    .filter((file) => file.name.endsWith(".model3.json"))
    .map((file) => relativePath(file));
}

export async function saveLive2D(
  conversationId: string,
  selected: FileList | File[],
  chosenModelPath?: string,
): Promise<StoredLive2D> {
  const files = Array.from(selected);
  const total = files.reduce((sum, file) => sum + file.size, 0);
  if (total > 60 * 1024 * 1024) throw new Error("模型文件夹需要小于 60MB");
  const modelPath = chosenModelPath ?? listLive2DModels(files)[0];
  if (!modelPath) throw new Error("没有找到 .model3.json；请选择完整模型文件夹");
  const modelFile = files.find((file) => relativePath(file) === modelPath);
  if (!modelFile) throw new Error("模型入口文件不完整");

  const map: Record<string, Blob> = {};
  const runtimeFile = /\.(json|moc3|png|jpe?g|webp|wav|mp3|ogg)$/i;
  for (const file of files) {
    const path = relativePath(file);
    // 只保存运行时资源，忽略 PSD/cmo3/can3/ReadMe 等大文件
    if (path === modelPath || runtimeFile.test(path)) map[path] = file;
  }
  const entry = JSON.parse(await modelFile.text()) as { FileReferences?: { Moc?: string; Textures?: string[] } };
  const refs = entry.FileReferences ?? {};
  const resolve = (ref: string): string => {
    const parts = [...modelPath.split("/").slice(0, -1), ...ref.split("/")];
    const output: string[] = [];
    for (const part of parts) {
      if (part === "." || part === "") continue;
      if (part === "..") output.pop();
      else output.push(part);
    }
    return output.join("/");
  };
  const missing = [
    refs.Moc ? resolve(refs.Moc) : "",
    ...(refs.Textures ?? []).map(resolve),
  ].filter((path) => path.length > 0 && !map[path]);
  if (missing.length > 0) {
    throw new Error(`模型文件不完整，缺少：${missing.slice(0, 3).join("、")}`);
  }

  const stored: StoredLive2D = {
    id: conversationId,
    name: modelFile.name.replace(/\.model3\.json$/i, ""),
    modelPath,
    files: map,
    importedAt: Date.now(),
  };
  await withStore("readwrite", (store) => store.put(stored));
  try {
    localStorage.setItem("pet.live2d.rev", String(Date.now()));
  } catch {
    /* 忽略 */
  }
  return stored;
}

export async function loadLive2D(conversationId: string): Promise<StoredLive2D | null> {
  const result = await withStore<StoredLive2D | undefined>("readonly", (store) => store.get(conversationId));
  return result ?? null;
}

export async function hasLive2D(conversationId: string): Promise<boolean> {
  const result = await withStore<StoredLive2D | undefined>("readonly", (store) => store.get(conversationId));
  return Boolean(result);
}

export async function removeLive2D(conversationId: string): Promise<void> {
  await withStore("readwrite", (store) => store.delete(conversationId));
  try {
    localStorage.setItem("pet.live2d.rev", String(Date.now()));
  } catch {
    /* 忽略 */
  }
}
