import type { ReactElement } from "react";
import { avatarColor, initialOf } from "../lib/avatar.ts";

export interface AvatarProps {
  name: string;
  src: string | null;
  size?: number;
  className?: string;
  alt?: string;
}

/** 40px 圆角 4px：有图显示图，没图用「名字首字 + 稳定颜色」的字母头像。 */
export function Avatar({ name, src, size = 40, className, alt }: AvatarProps): ReactElement {
  const label = name.trim().length > 0 ? name.trim() : "?";
  const classes = className ? `avatar ${className}` : "avatar";
  const style = { width: size, height: size } as const;

  if (src !== null && src.length > 0) {
    return (
      <span className={classes} style={style}>
        <img src={src} alt={alt ?? label} draggable={false} />
      </span>
    );
  }

  return (
    <span className={classes} style={{ ...style, background: avatarColor(label) }} role="img" aria-label={alt ?? label}>
      <span className="avatar-initial" style={{ fontSize: Math.max(11, Math.round(size * 0.42)) }}>
        {initialOf(label)}
      </span>
    </span>
  );
}
