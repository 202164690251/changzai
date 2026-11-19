// 如晤 · 头像工具：名字首字 + 稳定颜色；点选本地图片后转 dataURL 并等比压缩。

const AVATAR_COLORS = [
  "#6E8FB8",
  "#7FA98C",
  "#B08A6B",
  "#9480B0",
  "#B07D8E",
  "#6FA3A6",
  "#A69C74",
  "#8C8C94",
] as const;

export const MAX_AVATAR_BYTES = 2 * 1024 * 1024;
export const MAX_CHAT_IMAGE_BYTES = 8 * 1024 * 1024;

/** 同一个名字永远拿到同一种颜色，换名字会换颜色。 */
export function avatarColor(seed: string): string {
  const key = seed.trim() || "如晤";
  let hash = 0;
  for (let index = 0; index < key.length; index += 1) {
    hash = (hash * 31 + key.charCodeAt(index)) % 100_000;
  }
  return AVATAR_COLORS[hash % AVATAR_COLORS.length] ?? AVATAR_COLORS[0];
}

/** 取第一个字符做字母头像，中文取首字，英文转大写。 */
export function initialOf(name: string): string {
  const chars = Array.from(name.trim());
  const first = chars[0] ?? "?";
  return first.toUpperCase();
}

function assertImageFile(file: File, maxBytes: number, message: string): void {
  if (!file.type.startsWith("image/")) throw new Error("请选择图片文件");
  if (file.size >= maxBytes) throw new Error(message);
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") resolve(reader.result);
      else reject(new Error("图片读取失败"));
    };
    reader.onerror = () => reject(new Error("图片读取失败"));
    reader.readAsDataURL(file);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("图片解析失败"));
    image.src = src;
  });
}

async function shrinkImage(dataUrl: string, maxSize: number, quality: number): Promise<string> {
  const image = await loadImage(dataUrl);
  const longest = Math.max(image.naturalWidth, image.naturalHeight);
  if (longest <= maxSize) return dataUrl;
  const scale = maxSize / longest;
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const context = canvas.getContext("2d");
  if (!context) return dataUrl;
  context.fillStyle = "#FFFFFF";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", quality);
}

/** 头像：小于 2MB，读成 dataURL 后压到 256px，避免撑爆 localStorage。 */
export async function readAvatarFile(file: File): Promise<string> {
  assertImageFile(file, MAX_AVATAR_BYTES, "图片需要小于 2MB");
  const dataUrl = await readAsDataUrl(file);
  return shrinkImage(dataUrl, 256, 0.9).catch(() => dataUrl);
}

/** 桌宠图片：保留透明通道，最长边压到 1024px，供用户选择正方形裁剪范围。 */
export async function readPetImageFile(file: File): Promise<string> {
  assertImageFile(file, MAX_AVATAR_BYTES, "图片需要小于 2MB");
  const dataUrl = await readAsDataUrl(file);
  const image = await loadImage(dataUrl);
  const longest = Math.max(image.naturalWidth, image.naturalHeight);
  if (longest <= 1024) return dataUrl;
  const scale = 1024 / longest;
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const context = canvas.getContext("2d");
  if (!context) return dataUrl;
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/png");
}

/** 聊天里发送的本地图片：小于 8MB，最长边压到 1600px。 */
export async function readChatImageFile(file: File): Promise<string> {
  assertImageFile(file, MAX_CHAT_IMAGE_BYTES, "图片需要小于 8MB");
  const dataUrl = await readAsDataUrl(file);
  return shrinkImage(dataUrl, 1600, 0.9).catch(() => dataUrl);
}
