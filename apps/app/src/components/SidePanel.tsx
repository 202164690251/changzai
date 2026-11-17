import type { ReactElement } from "react";
import type { PersonProfile } from "../lib/profile.ts";
import { Avatar } from "./Avatar.tsx";

export interface SidePanelProps {
  tab: "contacts" | "favorites";
  her: PersonProfile;
  onOpenChat: () => void;
}

/** 通讯录 / 收藏：产品基线是一对一，这里只做诚实的空状态。 */
export function SidePanel({ tab, her, onOpenChat }: SidePanelProps): ReactElement {
  if (tab === "favorites") {
    return (
      <section className="side-panel" aria-label="收藏">
        <header className="side-panel-head">
          <h2>收藏</h2>
        </header>
        <div className="side-panel-body">
          <p className="side-empty">还没有收藏。</p>
        </div>
      </section>
    );
  }

  return (
    <section className="side-panel" aria-label="通讯录">
      <header className="side-panel-head">
        <h2>通讯录</h2>
      </header>
      <div className="side-panel-body">
        <button type="button" className="side-contact" onClick={onOpenChat}>
          <Avatar name={her.name} src={her.avatar} size={40} />
          <span className="side-contact-text">
            <span className="side-contact-name">{her.name}</span>
            <span className="side-contact-sub">常联系的人</span>
          </span>
        </button>
        <p className="side-empty">通讯录里只有 ta 一个人。</p>
      </div>
    </section>
  );
}
