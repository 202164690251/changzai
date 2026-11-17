import { useEffect, useRef, useState } from "react";
import type { ChangeEvent, KeyboardEvent, ReactElement } from "react";
import { Icon } from "./Icons.tsx";

const EMOJIS = [
  "🙂",
  "😊",
  "😅",
  "😴",
  "🥺",
  "😭",
  "😡",
  "🤔",
  "👀",
  "🙈",
  "🌙",
  "🌸",
  "☕",
  "🍜",
  "🎧",
  "📷",
  "✨",
  "❤️",
  "👍",
  "🤝",
  "🥱",
  "🌧️",
  "🎂",
  "🐱",
];

export type ComposerAction = "file" | "screenshot" | "voice";

export interface ComposerProps {
  onSend: (text: string) => void;
  onPickImage: (file: File) => void;
  onUnavailable: (action: ComposerAction) => void;
}

/** 底部输入区：表情 / 图片 / 文件 / 截图 / 语音 + 多行输入 + 绿色发送。 */
export function Composer({ onSend, onPickImage, onUnavailable }: ComposerProps): ReactElement {
  const [draft, setDraft] = useState("");
  const [emojiOpen, setEmojiOpen] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const composingRef = useRef(false);

  const canSend = draft.trim().length > 0;

  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.style.height = "auto";
    input.style.height = `${Math.min(input.scrollHeight, 120)}px`;
  }, [draft]);

  useEffect(() => {
    if (!emojiOpen) return;
    const handlePointerDown = (event: MouseEvent): void => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest(".emoji-panel") || target.closest(".emoji-toggle")) return;
      setEmojiOpen(false);
    };
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [emojiOpen]);

  const submit = (): void => {
    if (!canSend) return;
    onSend(draft);
    setDraft("");
    setEmojiOpen(false);
    inputRef.current?.focus();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key !== "Enter" || event.shiftKey || composingRef.current) return;
    if (event.nativeEvent.isComposing) return;
    event.preventDefault();
    submit();
  };

  const appendEmoji = (emoji: string): void => {
    setDraft((previous) => previous + emoji);
    inputRef.current?.focus();
  };

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>): void => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) onPickImage(file);
  };

  return (
    <footer className="composer">
      <div className="composer-panel">
        <textarea
          ref={inputRef}
          className="composer-input"
          value={draft}
          rows={1}
          placeholder="说点什么…"
          aria-label="输入消息"
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={handleKeyDown}
          onCompositionStart={() => {
            composingRef.current = true;
          }}
          onCompositionEnd={() => {
            composingRef.current = false;
          }}
        />

        <div className="composer-bar">
          <div className="composer-tools">
            <button
              type="button"
              className="tool-btn emoji-toggle"
              title="表情"
              aria-label="表情"
              aria-pressed={emojiOpen}
              onClick={() => setEmojiOpen((open) => !open)}
            >
              <Icon name="emoji" size={21} />
            </button>
            <button
              type="button"
              className="tool-btn"
              title="图片"
              aria-label="发送图片"
              onClick={() => fileRef.current?.click()}
            >
              <Icon name="image" size={21} />
            </button>
            <button
              type="button"
              className="tool-btn"
              title="文件"
              aria-label="发送文件"
              onClick={() => onUnavailable("file")}
            >
              <Icon name="file" size={21} />
            </button>
            <button
              type="button"
              className="tool-btn"
              title="截图"
              aria-label="截图"
              onClick={() => onUnavailable("screenshot")}
            >
              <Icon name="screenshot" size={20} />
            </button>
            <button
              type="button"
              className="tool-btn"
              title="语音"
              aria-label="语音消息"
              onClick={() => onUnavailable("voice")}
            >
              <Icon name="mic" size={21} />
            </button>
          </div>

          <button type="button" className="send-btn" disabled={!canSend} onClick={submit}>
            发送
          </button>
        </div>

        {emojiOpen && (
          <div className="emoji-panel" role="dialog" aria-label="表情">
            {EMOJIS.map((emoji) => (
              <button
                key={emoji}
                type="button"
                className="emoji-item"
                aria-label={emoji}
                onClick={() => appendEmoji(emoji)}
              >
                {emoji}
              </button>
            ))}
          </div>
        )}
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="visually-hidden"
        tabIndex={-1}
        onChange={handleFileChange}
      />
    </footer>
  );
}
