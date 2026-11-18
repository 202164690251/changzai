import { useEffect, useRef, useState, type PointerEvent, type ReactElement } from "react";

const BOX = 280;
const OUTPUT = 512;

export interface PetImageCropProps {
  source: string | null;
  onCancel: () => void;
  onApply: (dataUrl: string) => void;
  /** 输出正方形边长；头像用 256，桌宠用默认 512 */
  outputSize?: number;
  title?: string;
  description?: string;
  /** 桌宠图片允许自动去除纯色背景；头像默认不处理 */
  allowCutout?: boolean;
}

export function PetImageCrop({
  source,
  onCancel,
  onApply,
  outputSize = OUTPUT,
  title = "裁剪桌宠图片",
  description = "拖动调整位置，滑块缩放；保存为 512×512 正方形。",
  allowCutout = false,
}: PetImageCropProps): ReactElement | null {
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [cutout, setCutout] = useState(allowCutout);
  const dragRef = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);

  useEffect(() => {
    if (!source) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onCancel, source]);

  useEffect(() => {
    if (!source) {
      setImage(null);
      return;
    }
    const next = new Image();
    next.onload = () => {
      setImage(next);
      setZoom(1);
      setOffset({ x: 0, y: 0 });
    };
    next.src = source;
  }, [source]);

  if (!source) return null;

  const base = image ? Math.max(BOX / image.naturalWidth, BOX / image.naturalHeight) : 1;
  const scale = base * zoom;
  const width = image ? image.naturalWidth * scale : BOX;
  const height = image ? image.naturalHeight * scale : BOX;
  const maxX = Math.max(0, (width - BOX) / 2);
  const maxY = Math.max(0, (height - BOX) / 2);
  const left = (BOX - width) / 2 + offset.x;
  const top = (BOX - height) / 2 + offset.y;

  const clampOffset = (x: number, y: number, nextZoom = zoom): { x: number; y: number } => {
    if (!image) return { x: 0, y: 0 };
    const s = Math.max(BOX / image.naturalWidth, BOX / image.naturalHeight) * nextZoom;
    const max = {
      x: Math.max(0, (image.naturalWidth * s - BOX) / 2),
      y: Math.max(0, (image.naturalHeight * s - BOX) / 2),
    };
    return { x: Math.min(max.x, Math.max(-max.x, x)), y: Math.min(max.y, Math.max(-max.y, y)) };
  };

  const changeZoom = (next: number): void => {
    const value = Math.min(3, Math.max(1, next));
    setZoom(value);
    setOffset((current) => clampOffset(current.x, current.y, value));
  };

  const startDrag = (event: PointerEvent<HTMLDivElement>): void => {
    if (!image) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { x: event.clientX, y: event.clientY, ox: offset.x, oy: offset.y };
  };

  const moveDrag = (event: PointerEvent<HTMLDivElement>): void => {
    const drag = dragRef.current;
    if (!drag) return;
    setOffset(clampOffset(drag.ox + event.clientX - drag.x, drag.oy + event.clientY - drag.y));
  };

  const endDrag = (): void => {
    dragRef.current = null;
  };

  const removeSolidBackground = (canvas: HTMLCanvasElement): void => {
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return;
    const { width, height } = canvas;
    const imageData = context.getImageData(0, 0, width, height);
    const data = imageData.data;
    const counts = new Map<number, number>();
    const quantize = (index: number): number =>
      ((data[index]! >> 3) << 10) | ((data[index + 1]! >> 3) << 5) | (data[index + 2]! >> 3);
    for (let x = 0; x < width; x += 2) {
      for (const y of [0, height - 1]) {
        if (data[(y * width + x) * 4 + 3]! < 20) continue;
        const key = quantize((y * width + x) * 4);
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }
    for (let y = 0; y < height; y += 2) {
      for (const x of [0, width - 1]) {
        if (data[(y * width + x) * 4 + 3]! < 20) continue;
        const key = quantize((y * width + x) * 4);
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }
    let bgKey = -1;
    let bgCount = 0;
    for (const [key, count] of counts) {
      if (count > bgCount) {
        bgCount = count;
        bgKey = key;
      }
    }
    if (bgKey < 0 || bgCount < 20) return;
    const bgR = ((bgKey >> 10) & 31) * 8 + 4;
    const bgG = ((bgKey >> 5) & 31) * 8 + 4;
    const bgB = (bgKey & 31) * 8 + 4;
    const tolerance = 42;
    const visited = new Uint8Array(width * height);
    const queue: number[] = [];
    const match = (offset: number): boolean => {
      const r = data[offset]!;
      const g = data[offset + 1]!;
      const b = data[offset + 2]!;
      const a = data[offset + 3]!;
      return a > 0 && Math.abs(r - bgR) + Math.abs(g - bgG) + Math.abs(b - bgB) <= tolerance;
    };
    for (let x = 0; x < width; x += 1) {
      queue.push(x, (height - 1) * width + x);
    }
    for (let y = 0; y < height; y += 1) {
      queue.push(y * width, y * width + width - 1);
    }
    while (queue.length > 0) {
      const index = queue.pop()!;
      if (visited[index]) continue;
      visited[index] = 1;
      if (!match(index * 4)) continue;
      data[index * 4 + 3] = 0;
      const x = index % width;
      const y = Math.floor(index / width);
      if (x > 0) queue.push(index - 1);
      if (x < width - 1) queue.push(index + 1);
      if (y > 0) queue.push(index - width);
      if (y < height - 1) queue.push(index + width);
    }
    context.putImageData(imageData, 0, 0);
  };

  const apply = (): void => {
    if (!image) return;
    const canvas = document.createElement("canvas");
    canvas.width = outputSize;
    canvas.height = outputSize;
    const context = canvas.getContext("2d");
    if (!context) return;
    const sx = -left / scale;
    const sy = -top / scale;
    const sw = BOX / scale;
    context.drawImage(image, sx, sy, sw, sw, 0, 0, outputSize, outputSize);
    if (allowCutout && cutout) removeSolidBackground(canvas);
    onApply(canvas.toDataURL("image/png"));
  };

  return (
    <div className="crop-overlay" role="dialog" aria-modal="true" aria-label="裁剪桌宠图片">
      <div className="crop-card">
        <header className="crop-head">
          <div>
            <h3>{title}</h3>
            <p>{description}</p>
          </div>
          <button type="button" className="crop-close" onClick={onCancel} aria-label="关闭">
            ×
          </button>
        </header>

        <div
          className="crop-box"
          onPointerDown={startDrag}
          onPointerMove={moveDrag}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onWheel={(event) => {
            event.preventDefault();
            changeZoom(zoom + (event.deltaY > 0 ? -0.08 : 0.08));
          }}
        >
          {image ? (
            <img
              src={source}
              alt="待裁剪的桌宠图片"
              draggable={false}
              style={{ width, height, left, top }}
            />
          ) : (
            <span className="crop-loading">图片加载中…</span>
          )}
          <div className="crop-grid" aria-hidden="true" />
        </div>

        <label className="crop-zoom">
          <span>缩放</span>
          <input
            type="range"
            min={1}
            max={3}
            step={0.01}
            value={zoom}
            onChange={(event) => changeZoom(Number(event.target.value))}
          />
          <span>{zoom.toFixed(2)}×</span>
        </label>

        {allowCutout && (
          <label className="crop-cutout">
            <input type="checkbox" checked={cutout} onChange={(event) => setCutout(event.target.checked)} />
            <span>自动去除纯色背景（适合白底插画，复杂背景会保留）</span>
          </label>
        )}

        <div className="crop-actions">
          <button type="button" className="btn" onClick={onCancel}>
            取消
          </button>
          <button type="button" className="btn primary" onClick={apply} disabled={!image}>
            保存正方形
          </button>
        </div>
      </div>
    </div>
  );
}
