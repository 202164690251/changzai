import { useEffect, useRef, useState, type PointerEvent, type ReactElement } from "react";

const BOX = 280;
const OUTPUT = 512;

export interface PetImageCropProps {
  source: string | null;
  onCancel: () => void;
  onApply: (dataUrl: string) => void;
}

export function PetImageCrop({ source, onCancel, onApply }: PetImageCropProps): ReactElement | null {
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const dragRef = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);

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

  const apply = (): void => {
    if (!image) return;
    const canvas = document.createElement("canvas");
    canvas.width = OUTPUT;
    canvas.height = OUTPUT;
    const context = canvas.getContext("2d");
    if (!context) return;
    const sx = -left / scale;
    const sy = -top / scale;
    const sw = BOX / scale;
    context.drawImage(image, sx, sy, sw, sw, 0, 0, OUTPUT, OUTPUT);
    onApply(canvas.toDataURL("image/png"));
  };

  return (
    <div className="crop-overlay" role="dialog" aria-modal="true" aria-label="裁剪桌宠图片">
      <div className="crop-card">
        <header className="crop-head">
          <div>
            <h3>裁剪桌宠图片</h3>
            <p>拖动调整位置，滑块缩放；保存为 512×512 正方形。</p>
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
