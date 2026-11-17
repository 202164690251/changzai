import type { ReactElement } from "react";
import { formatConversationTime } from "../lib/time.ts";
import { Avatar } from "./Avatar.tsx";
import { Icon } from "./Icons.tsx";

export interface ConversationListProps {
  herName: string;
  herAvatar: string | null;
  preview: string;
  ts: number;
  unread: number;
  search: string;
  onSearch: (value: string) => void;
  onSelect: () => void;
  onAdd: () => void;
}

/** 中间 280px 会话列表：搜索框 + 「+」，下面是会话项。 */
export function ConversationList({
  herName,
  herAvatar,
  preview,
  ts,
  unread,
  search,
  onSearch,
  onSelect,
  onAdd,
}: ConversationListProps): ReactElement {
  const keyword = search.trim();
  const visible = keyword.length === 0 || herName.includes(keyword);

  return (
    <section className="conv-panel" aria-label="会话列表">
      <div className="conv-head">
        <div className="search-box">
          <Icon name="search" size={15} />
          <input
            type="text"
            value={search}
            placeholder="搜索"
            aria-label="搜索会话"
            onChange={(event) => onSearch(event.target.value)}
          />
        </div>
        <button type="button" className="conv-add" title="发起会话" aria-label="发起会话" onClick={onAdd}>
          <Icon name="plus" size={18} />
        </button>
      </div>

      <div className="conv-list">
        {visible ? (
          <button
            type="button"
            className="conv-item is-active"
            aria-current="true"
            onClick={onSelect}
          >
            <span className="conv-avatar-wrap">
              <Avatar name={herName} src={herAvatar} size={40} />
              {unread > 0 && (
                <span className="conv-badge" aria-label={`${unread} 条未读`}>
                  {unread > 99 ? "99+" : unread}
                </span>
              )}
            </span>
            <span className="conv-main">
              <span className="conv-top">
                <span className="conv-name">{herName}</span>
                <span className="conv-time">{formatConversationTime(ts)}</span>
              </span>
              <span className="conv-preview">{preview}</span>
            </span>
          </button>
        ) : (
          <p className="conv-empty">没有找到相关会话</p>
        )}
      </div>
    </section>
  );
}
