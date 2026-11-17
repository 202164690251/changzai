import type { ReactElement } from "react";
import type { PreviewImage } from "../ImageLightbox.tsx";

export interface ImageBubbleProps {
  dataUrl: string;
  name?: string;
  side: "her" | "me";
  onPreview: (image: PreviewImage) => void;
}

/** 图片气泡：最大 220×220、圆角 4px，点击看大图。 */
export function ImageBubble({ dataUrl, name, side, onPreview }: ImageBubbleProps): ReactElement {
  const label = name !== undefined && name.length > 0 ? name : "图片";
  return (
    <button
      type="button"
      className={`bubble-image ${side}`}
      title={`查看大图 · ${label}`}
      aria-label={`图片：${label}`}
      onClick={() => onPreview({ src: dataUrl, name })}
    >
      <img src={dataUrl} alt={label} draggable={false} />
    </button>
  );
}
