import { useEffect } from "react";
import type { ReactElement } from "react";
import { Icon } from "./Icons.tsx";

export interface PreviewImage {
  src: string;
  name?: string;
}

export interface ImageLightboxProps {
  image: PreviewImage | null;
  onClose: () => void;
}

/** 点击图片气泡后的放大预览：点遮罩或 Esc 关闭。 */
export function ImageLightbox({ image, onClose }: ImageLightboxProps): ReactElement | null {
  useEffect(() => {
    if (image === null) return;
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [image, onClose]);

  if (image === null) return null;

  return (
    <div
      className="lightbox"
      role="dialog"
      aria-modal="true"
      aria-label={image.name ?? "图片预览"}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <button type="button" className="lightbox-close" title="关闭" aria-label="关闭预览" onClick={onClose}>
        <Icon name="close" size={22} />
      </button>
      <img src={image.src} alt={image.name ?? "图片预览"} draggable={false} />
    </div>
  );
}
