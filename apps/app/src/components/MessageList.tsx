import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
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
const ESTIMATED_HEIGHT = 76;
const OVERSCAN = 320;

export interface MessageListProps {
  messages: ChatMsg[];
  her: PersonProfile;
  me: PersonProfile;
  typing: boolean;
  onPreview: (image: PreviewImage) => void;
  onMessageMenu?: (message: ChatMsg, event: MouseEvent<HTMLDivElement>) => void;
  canSpeak?: boolean;
  onSpeak?: (text: string) => void;
}

interface VirtualItem {
  id: string;
  message?: ChatMsg;
  typing?: boolean;
  height: number;
  offset: number;
}

/** 消息列表：可变高度虚拟滚动（只渲染视口 ±320px）。 */
export function MessageList({
  messages,
  her,
  me,
  typing,
  onPreview,
  onMessageMenu,
  canSpeak = false,
  onSpeak,
}: MessageListProps): ReactElement {
  const listRef = useRef<HTMLDivElement | null>(null);
  const rowRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const pinnedRef = useRef(true);
  const [heights, setHeights] = useState<Map<string, number>>(() => new Map());
  const [scrollTop, setScrollTop] = useState(0);
  const [viewport, setViewport] = useState(600);

  const items = useMemo<VirtualItem[]>(() => {
    const list: VirtualItem[] = [];
    let offset = 0;
    for (const message of messages) {
      const height = heights.get(message.id) ?? ESTIMATED_HEIGHT;
      list.push({ id: message.id, message, height, offset });
      offset += height;
    }
    if (typing) {
      list.push({ id: "__typing__", typing: true, height: 64, offset });
    }
    return list;
  }, [heights, messages, typing]);

  const totalHeight = items.reduce((sum, item) => sum + item.height, 0);
  const rawStart = items.findIndex((item) => item.offset + item.height >= scrollTop - OVERSCAN);
  const startIndex = rawStart < 0 ? 0 : rawStart;
  const endIndex = (() => {
    const index = items.findIndex((item) => item.offset > scrollTop + viewport + OVERSCAN);
    return index < 0 ? items.length : index;
  })();
  const visible = items.slice(startIndex, endIndex);
  const visibleKey = visible.map((item) => item.id).join("|");

  // 监听滚动容器尺寸
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const update = (): void => setViewport(list.clientHeight);
    update();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(update);
    observer.observe(list);
    return () => observer.disconnect();
  }, []);

  // 测量可见行（图片/语音加载后高度变化也能更新）
  useLayoutEffect(() => {
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      let changed = false;
      const next = new Map(heights);
      for (const entry of entries) {
        const element = entry.target as HTMLDivElement;
        const id = element.dataset.itemId;
        if (!id || id === "__typing__") continue;
        const height = Math.round(entry.contentRect.height);
        if (height > 0 && Math.abs((next.get(id) ?? 0) - height) > 1) {
          next.set(id, height);
          changed = true;
        }
      }
      if (changed) setHeights(next);
    });
    rowRefs.current.forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, [heights, visibleKey]);

  // 贴底：新消息/typing 时滚动到底部
  useEffect(() => {
    const list = listRef.current;
    if (!list || !pinnedRef.current) return;
    const frame = window.requestAnimationFrame(() => {
      list.scrollTop = list.scrollHeight;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [messages.length, typing, totalHeight]);

  const handleScroll = (): void => {
    const list = listRef.current;
    if (!list) return;
    setScrollTop(list.scrollTop);
    pinnedRef.current = list.scrollHeight - list.scrollTop - list.clientHeight < 48;
  };

  return (
    <div className="message-list" ref={listRef} onScroll={handleScroll}>
      <div className="message-list-inner" style={{ height: totalHeight, position: "relative" }}>
        {messages.length === 0 && !typing && <p className="chat-empty">还没有开始</p>}

        {visible.map((item) => {
          const rowStyle = { position: "absolute" as const, left: 0, right: 0, top: item.offset };
          if (item.typing) {
            return (
              <div className="msg-row her" style={rowStyle} key={item.id}>
                <Avatar className="msg-avatar" name={her.name} src={her.avatar} size={40} />
                <div className="msg-content">
                  <div className="typing-bubble" aria-label="对方正在输入">
                    <i />
                    <i />
                    <i />
                  </div>
                </div>
              </div>
            );
          }
          const message = item.message;
          if (!message) return null;
          const index = messages.findIndex((entry) => entry.id === message.id);
          const previous = index > 0 ? messages[index - 1] : undefined;
          const needsDivider =
            message.from !== "system" && (!previous || message.ts - previous.ts >= TIME_GAP_MS);
          return (
            <div
              key={item.id}
              data-item-id={item.id}
              ref={(element) => {
                if (element) rowRefs.current.set(item.id, element);
                else rowRefs.current.delete(item.id);
              }}
              style={rowStyle}
            >
              {needsDivider && <div className="time-divider">{formatTimeDivider(message.ts)}</div>}
              {message.from === "system" ? (
                <div className="msg-system">{message.text}</div>
              ) : (
                <MessageRow
                  message={message}
                  her={her}
                  me={me}
                  onPreview={onPreview}
                  onMessageMenu={onMessageMenu}
                  canSpeak={canSpeak}
                  onSpeak={onSpeak}
                />
              )}
            </div>
          );
        })}
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
  canSpeak?: boolean;
  onSpeak?: (text: string) => void;
}

function MessageRow({
  message,
  her,
  me,
  onPreview,
  onMessageMenu,
  canSpeak = false,
  onSpeak,
}: MessageRowProps): ReactElement {
  const mine = message.from === "me";
  const person = mine ? me : her;
  const side = mine ? "me" : "her";

  let bubble: ReactElement;
  if (message.kind === "image") {
    bubble = <ImageBubble dataUrl={message.dataUrl} name={message.name} side={side} onPreview={onPreview} />;
  } else if (message.kind === "voice") {
    bubble = <VoiceBubble dataUrl={message.dataUrl} durationSec={message.durationSec} side={side} />;
  } else {
    bubble = (
      <TextBubble
        text={message.text}
        side={side}
        canSpeak={canSpeak && !mine}
        onSpeak={onSpeak ? () => onSpeak(message.text) : undefined}
      />
    );
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
