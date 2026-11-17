import type { ReactElement } from "react";

export interface TextBubbleProps {
  text: string;
  side: "her" | "me";
}

export function TextBubble({ text, side }: TextBubbleProps): ReactElement {
  return <div className={`bubble bubble-text ${side}`}>{text}</div>;
}
