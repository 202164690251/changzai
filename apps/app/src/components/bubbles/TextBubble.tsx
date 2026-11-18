import type { ReactElement } from "react";
import { Icon } from "../Icons.tsx";

export interface TextBubbleProps {
  text: string;
  side: "her" | "me";
  canSpeak?: boolean;
  onSpeak?: () => void;
}

export function TextBubble({ text, side, canSpeak = false, onSpeak }: TextBubbleProps): ReactElement {
  return (
    <div className={`bubble bubble-text ${side}`}>
      <span className="bubble-text-content">{text}</span>
      {canSpeak && onSpeak && (
        <button
          type="button"
          className="bubble-tts"
          title="朗读这句话"
          aria-label="朗读这句话"
          onClick={(event) => {
            event.stopPropagation();
            onSpeak();
          }}
        >
          <Icon name="volume" size={14} />
        </button>
      )}
    </div>
  );
}
