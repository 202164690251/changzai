import type { ReactElement } from "react";
import type { PersonProfile } from "../lib/profile.ts";
import { Avatar } from "./Avatar.tsx";
import { Icon } from "./Icons.tsx";

export interface ChatHeaderProps {
  her: PersonProfile;
  typing: boolean;
  onOpenSettings: () => void;
}

/** 52px 聊天标题栏：左边她的头像、名字、在线状态；右边「⋯」。 */
export function ChatHeader({ her, typing, onOpenSettings }: ChatHeaderProps): ReactElement {
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
      <button
        type="button"
        className="icon-btn"
        title="聊天设置"
        aria-label="聊天设置"
        onClick={onOpenSettings}
      >
        <Icon name="more" size={20} />
      </button>
    </header>
  );
}
