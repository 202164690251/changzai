import type { ReactElement } from "react";
import type { PersonProfile } from "../lib/profile.ts";
import { Avatar } from "./Avatar.tsx";
import { Icon, type IconName } from "./Icons.tsx";

export type RailTab = "chat" | "contacts" | "favorites";

interface RailEntry {
  id: RailTab;
  label: string;
  icon: IconName;
}

const TABS: RailEntry[] = [
  { id: "chat", label: "聊天", icon: "chat" },
  { id: "contacts", label: "通讯录", icon: "contacts" },
  { id: "favorites", label: "收藏", icon: "star" },
];

export interface NavRailProps {
  me: PersonProfile;
  active: RailTab;
  onSelect: (tab: RailTab) => void;
  onOpenSettings: () => void;
}

/** 最左 64px 导航栏：顶部我的头像，中间聊天/通讯录/收藏，底部设置。 */
export function NavRail({ me, active, onSelect, onOpenSettings }: NavRailProps): ReactElement {
  return (
    <nav className="nav-rail" aria-label="主导航">
      <button
        type="button"
        className="rail-avatar"
        title={`${me.name} · 设置`}
        aria-label="打开设置"
        onClick={onOpenSettings}
      >
        <Avatar name={me.name} src={me.avatar} size={40} />
      </button>

      <div className="rail-tabs">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={`rail-tab${active === tab.id ? " is-active" : ""}`}
            title={tab.label}
            aria-label={tab.label}
            aria-pressed={active === tab.id}
            onClick={() => onSelect(tab.id)}
          >
            <Icon name={tab.icon} size={22} />
          </button>
        ))}
      </div>

      <div className="rail-bottom">
        <button type="button" className="rail-tab" title="设置" aria-label="设置" onClick={onOpenSettings}>
          <Icon name="settings" size={21} />
        </button>
      </div>
    </nav>
  );
}
