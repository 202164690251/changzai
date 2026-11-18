// 左侧会话列表 + 微信式搜索
import type { MouseEvent, ReactElement } from "react";
import { personaMbti } from "@changzai/core";
import type { ConversationRecord } from "../hooks/useConversations.ts";
import { formatConversationTime } from "../lib/time.ts";
import { Avatar } from "./Avatar.tsx";
import { Icon } from "./Icons.tsx";

export interface ConversationSearchHit {
  convId: string;
  title: string;
  text: string;
  ts: number;
  sender: string;
}

export interface ConversationSearchResults {
  conversations: ConversationRecord[];
  messages: ConversationSearchHit[];
}

export interface ConversationListProps {
  items: ConversationRecord[];
  activeId: string | null;
  search: string;
  searchResults: ConversationSearchResults;
  onSearch: (value: string) => void;
  onSelect: (id: string) => void;
  onAdd: () => void;
  onContextMenu: (record: ConversationRecord, event: MouseEvent<HTMLElement>) => void;
}

export function ConversationList({
  items,
  activeId,
  search,
  searchResults,
  onSearch,
  onSelect,
  onAdd,
  onContextMenu,
}: ConversationListProps): ReactElement {
  const keyword = search.trim();
  const filtered = keyword
    ? items.filter((item) => item.title.includes(keyword) || item.herName.includes(keyword))
    : items;

  return (
    <section className="conv-panel" aria-label="会话列表">
      <div className="conv-head">
        <div className="search-box">
          <Icon name="search" size={15} />
          <input
            type="text"
            value={search}
            placeholder="搜索聊天或聊天记录"
            aria-label="搜索聊天或聊天记录"
            onChange={(event) => onSearch(event.target.value)}
          />
        </div>
        <button type="button" className="conv-add" title="发起新聊天" aria-label="发起新聊天" onClick={onAdd}>
          <Icon name="plus" size={18} />
        </button>
      </div>

      {keyword.length > 0 ? (
        <div className="conv-search-results">
          <div className="conv-search-group">聊天</div>
          {searchResults.conversations.length === 0 && <p className="conv-empty">没有匹配的聊天</p>}
          {searchResults.conversations.map((item) => (
            <button
              key={`conv-${item.id}`}
              type="button"
              className="conv-search-item"
              onClick={() => onSelect(item.id)}
              onContextMenu={(event) => onContextMenu(item, event)}
            >
              <Avatar name={item.herName} src={item.herAvatar} size={32} />
              <span>
                <b>{item.title}</b>
                <small>{item.lastPreview ?? "还没有开始"}</small>
              </span>
            </button>
          ))}

          <div className="conv-search-group">聊天记录</div>
          {searchResults.messages.length === 0 && <p className="conv-empty">没有匹配的消息</p>}
          {searchResults.messages.map((hit) => (
            <button
              key={`hit-${hit.convId}-${hit.ts}-${hit.text.slice(0, 8)}`}
              type="button"
              className="conv-search-item"
              onClick={() => onSelect(hit.convId)}
            >
              <span className="conv-search-dot" />
              <span>
                <b>{hit.title}</b>
                <small>
                  {hit.sender === "her" ? "ta" : "我"}：{hit.text}
                </small>
              </span>
              <time>{formatConversationTime(hit.ts)}</time>
            </button>
          ))}
        </div>
      ) : (
        <div className="conv-list">
          {filtered.length === 0 && <p className="conv-empty">还没有聊天，点右上角 + 创建一个</p>}
          {filtered.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`conv-item ${item.id === activeId ? "is-active" : ""}`}
              aria-current={item.id === activeId ? "true" : undefined}
              onClick={() => onSelect(item.id)}
              onContextMenu={(event) => onContextMenu(item, event)}
            >
              <span className="conv-avatar-wrap">
                <Avatar name={item.herName} src={item.herAvatar} size={40} />
              </span>
              <span className="conv-main">
                <span className="conv-top">
                  <span className="conv-name">{item.title}</span>
                  <span className="conv-time">
                    {formatConversationTime(item.lastMessageAt || item.updatedAt)}
                  </span>
                </span>
                <span className="conv-preview">{item.lastPreview ?? "还没有开始"}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
