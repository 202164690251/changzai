import { Fragment, useEffect, useRef, useState } from "react";
import type { MouseEvent, ReactElement } from "react";
import type { ChatMsg } from "../hooks/useChat.ts";
import type { PersonProfile } from "../lib/profile.ts";
import { formatTimeDivider } from "../lib/time.ts";
import { Avatar } from "./Avatar.tsx";
import type { PreviewImage } from "./ImageLightbox.tsx";
import { ImageBubble } from "./bubbles/ImageBubble.tsx";
import { TextBubble } from "./bubbles/TextBubble.tsx";
import { VoiceBubble } from "./bubbles/VoiceBubble.tsx";

const TIME_GAP_MS = 5 * 60 * 1000;

export interface MessageListProps {
  messages: ChatMsg[];
  her: PersonProfile;
  me: PersonProfile;
  typing: boolean;
  onPreview: (image: PreviewImage) => void;
  onMessageMenu?: (message: ChatMsg, event: MouseEvent<HTMLDivElement>) => void;
}

/** 消息列表：浅灰底、居中时间分隔、双方头像对齐气泡顶部、自动贴底。 */
export function MessageList({ messages, her, me, typing, onPreview, onMessageMenu }: MessageListProps): ReactElement {
  const [visibleCount, setVisibleCount] = useState(200);
  const visible = messages.slice(-visibleCount);
  const listRef = useRef<HTMLDivElement | null>(null);
  const innerRef = useRef<HTMLDivElement | null>(null);
  const pinnedRef = useRef(true);

  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    pinnedRef.current = true;
    list.scrollTop = list.scrollHeight;
  }, [messages.length, typing]);

  useEffect(() => {
    const list = listRef.current;
    const inner = innerRef.current;
    if (!list || !inner || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      if (pinnedRef.current) list.scrollTop = list.scrollHeight;
    });
    observer.observe(inner);
    return () => observer.disconnect();
  }, []);

  const handleScroll = (): void => {
    const list = listRef.current;
    if (!list) return;
    pinnedRef.current = list.scrollHeight - list.scrollTop - list.clientHeight < 48;
  };

  return (
    <div className="message-list" ref={listRef} onScroll={handleScroll}>
      <div className="message-list-inner" ref={innerRef}>
        {messages.length === 0 && !typing && <p className="chat-empty">还没有开始</p>}

        {messages.length > visible.length && (
          <button
            type="button"
            className="load-older"
            onClick={() => setVisibleCount((count) => count + 200)}
          >
            加载更早的消息
          </button>
        )}

        {visible.map((message, index) => {
          const previous = index > 0 ? visible[index - 1] : undefined;
          const needsDivider =
            message.from !== "system" && (!previous || message.ts - previous.ts >= TIME_GAP_MS);

          return (
            <Fragment key={message.id}>
              {needsDivider && <div className="time-divider">{formatTimeDivider(message.ts)}</div>}
              {message.from === "system" ? (
                <div className="msg-system">{message.text}</div>
              ) : (
                <MessageRow message={message} her={her} me={me} onPreview={onPreview} onMessageMenu={onMessageMenu} />
              )}
            </Fragment>
          );
        })}

        {typing && (
          <div className="msg-row her">
            <Avatar className="msg-avatar" name={her.name} src={her.avatar} size={40} />
            <div className="msg-content">
              <div className="typing-bubble" aria-label="对方正在输入">
                <i />
                <i />
                <i />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

interface MessageRowProps {
  message: ChatMsg;
  her: PersonProfile;
  me: PersonProfile;
  onPreview: (image: PreviewImage) => void;
  onMessageMenu?: (message: ChatMsg, event: MouseEvent<HTMLDivElement>) => void;
}

function MessageRow({ message, her, me, onPreview, onMessageMenu }: MessageRowProps): ReactElement {
  const mine = message.from === "me";
  const person = mine ? me : her;
  const side = mine ? "me" : "her";

  let bubble: ReactElement;
  if (message.kind === "image") {
    bubble = <ImageBubble dataUrl={message.dataUrl} name={message.name} side={side} onPreview={onPreview} />;
  } else if (message.kind === "voice") {
    bubble = <VoiceBubble dataUrl={message.dataUrl} durationSec={message.durationSec} side={side} />;
  } else {
    bubble = <TextBubble text={message.text} side={side} />;
  }

  return (
    <div
      className={`msg-row ${side}`}
      onContextMenu={(event) => {
        event.preventDefault();
        onMessageMenu?.(message, event);
      }}
    >
      <Avatar className="msg-avatar" name={person.name} src={person.avatar} size={40} />
      <div className="msg-content">{bubble}</div>
    </div>
  );
}
