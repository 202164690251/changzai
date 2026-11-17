import { useState } from "react";
import type { ReactElement } from "react";
import type { PersonProfile } from "../lib/profile.ts";
import { Avatar } from "./Avatar.tsx";
import { Icon } from "./Icons.tsx";

export interface ChatHeaderProps {
  her: PersonProfile;
  typing: boolean;
  onOpenSettings: () => void;
  onRecall: () => void;
  onMemory: () => void;
  onMood: () => void;
}

/** 52px 聊天标题栏：左边她的头像、名字、在线状态；右边「⋯」。 */
export function ChatHeader({ her, typing, onOpenSettings, onRecall, onMemory, onMood }: ChatHeaderProps): ReactElement {
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <header className="chat-header">
      <div className="chat-header-id">
        <Avatar name={her.name} src={her.avatar} size={32} />
        <div className="chat-header-text">
          <span className="chat-header-name">{her.name}</span>
          <span className={`chat-header-status${typing ? " is-typing" : ""}`}>
            <i className="status-dot" aria-hidden="true" />
            {typing ? "对方正在输入…" : "在线"}
          </span>
        </div>
      </div>
      <div className="chat-header-actions">
        <button
          type="button"
          className="icon-btn"
          title="聊天菜单"
          aria-label="聊天菜单"
          onClick={() => setMenuOpen((open) => !open)}
        >
          <Icon name="more" size={20} />
        </button>
        {menuOpen && (
          <div className="chat-menu" role="menu">
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setMenuOpen(false);
                onRecall();
              }}
            >
              撤回上一条
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setMenuOpen(false);
                onMemory();
              }}
            >
              翻一翻
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setMenuOpen(false);
                onOpenSettings();
              }}
            >
              聊天设置
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
