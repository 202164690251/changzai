// 常在 · 媒体工具（纯函数，无 DOM / Node API）
// 与 Rust 侧 apps/app/src-tauri/src/media.rs 的规则保持一致。

import { MEDIA } from "@changzai/shared";
import type { MediaKind } from "@changzai/shared";

const IMAGE_EXT_SET = new Set<string>(MEDIA.imageExts);
const VOICE_EXT_SET = new Set<string>(MEDIA.voiceExts);

export function extensionOf(path: string): string {
  const clean = path.split(/[?#]/)[0] ?? path;
  const idx = clean.lastIndexOf(".");
  if (idx < 0 || idx === clean.length - 1) return "";
  return clean.slice(idx + 1).toLowerCase();
}

export function classifyMediaPath(path: string): MediaKind {
  const ext = extensionOf(path);
  if (IMAGE_EXT_SET.has(ext)) return "image";
  if (VOICE_EXT_SET.has(ext)) return "voice";
  return "file";
}

export function isAllowedMedia(kind: "image" | "voice", path: string): boolean {
  const ext = extensionOf(path);
  return kind === "image" ? IMAGE_EXT_SET.has(ext) : VOICE_EXT_SET.has(ext);
}

const MIME_BY_EXT: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  m4a: "audio/mp4",
  aac: "audio/aac",
  ogg: "audio/ogg",
  opus: "audio/ogg",
  amr: "audio/amr",
  silk: "audio/silk",
};

export function mimeForPath(path: string): string {
  return MIME_BY_EXT[extensionOf(path)] ?? "application/octet-stream";
}

/** 只保留字母/数字/汉字/点/横线/下划线；空白与其他字符转下划线；最长 80 字符 */
export function sanitizeMediaFileName(name: string): string {
  const cleaned = Array.from(name)
    .map((ch) => {
      if (/^[\p{L}\p{N}._-]$/u.test(ch)) return ch;
      return "_";
    })
    .join("");
  const trimmed = cleaned.replace(/^_+|_+$/g, "");
  const result = trimmed.length > 0 ? trimmed : "media";
  return Array.from(result).slice(0, 80).join("");
}

/** 媒体落盘路径约定：media/{personaId}/{mediaId}.{ext} */
export function mediaStoragePath(personaId: string, mediaId: string, ext: string): string {
  const safeExt = ext.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
  const safePersona = sanitizeMediaFileName(personaId);
  const safeId = sanitizeMediaFileName(mediaId);
  return `media/${safePersona}/${safeId}${safeExt ? `.${safeExt}` : ""}`;
}

/** 单文件大小是否在限制内（0 字节也视为非法） */
export function isWithinMediaSizeLimit(bytes: number): boolean {
  return Number.isFinite(bytes) && bytes > 0 && bytes <= MEDIA.maxBytesPerFile;
}

/** 从 dataUrl 推断 kind（用于导入回来的素材校验） */
export function classifyDataUrl(dataUrl: string): MediaKind {
  const match = /^data:([^;,]+)[;,]/.exec(dataUrl);
  const mime = match?.[1] ?? "";
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("audio/")) return "voice";
  return "file";
}
