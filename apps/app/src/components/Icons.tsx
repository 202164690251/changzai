import type { ReactElement, ReactNode } from "react";

export type IconName =
  | "chat"
  | "contacts"
  | "star"
  | "settings"
  | "search"
  | "plus"
  | "more"
  | "emoji"
  | "image"
  | "file"
  | "screenshot"
  | "mic"
  | "volume"
  | "play"
  | "pause"
  | "close";

const ICONS: Record<IconName, ReactNode> = {
  chat: (
    <path d="M4 6.4A2.4 2.4 0 0 1 6.4 4h9.2A2.4 2.4 0 0 1 18 6.4v6.2a2.4 2.4 0 0 1-2.4 2.4H9.6l-3.9 3.2v-3.2h-.1A2.4 2.4 0 0 1 4 12.6z" />
  ),
  contacts: (
    <>
      <circle cx="9.4" cy="8.4" r="3.1" />
      <path d="M3.8 19.2c0-3.1 2.5-5.4 5.6-5.4s5.6 2.3 5.6 5.4" />
      <path d="M15.6 5.7a3 3 0 0 1 0 5.4" />
      <path d="M16.9 14.4c2.1.7 3.5 2.5 3.5 4.8" />
    </>
  ),
  star: (
    <path d="M12 4.2l2.4 4.9 5.4.8-3.9 3.8.9 5.4-4.8-2.5-4.8 2.5.9-5.4-3.9-3.8 5.4-.8z" />
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3.1" />
      <path d="M19.4 14.9a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5v.2a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.6-1.1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1h.2a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
    </>
  ),
  search: (
    <>
      <circle cx="10.6" cy="10.6" r="6.1" />
      <path d="M15.2 15.2l4.3 4.3" />
    </>
  ),
  plus: <path d="M12 5.4v13.2M5.4 12h13.2" />,
  more: (
    <>
      <circle cx="5.6" cy="12" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="18.4" cy="12" r="1.4" fill="currentColor" stroke="none" />
    </>
  ),
  emoji: (
    <>
      <circle cx="12" cy="12" r="8.2" />
      <path d="M8.6 14.1c.8 1.4 2 2.2 3.4 2.2s2.6-.8 3.4-2.2" />
      <circle cx="9.4" cy="9.9" r=".9" fill="currentColor" stroke="none" />
      <circle cx="14.6" cy="9.9" r=".9" fill="currentColor" stroke="none" />
    </>
  ),
  image: (
    <>
      <rect x="3.5" y="5" width="17" height="14" rx="2.2" />
      <circle cx="8.6" cy="9.6" r="1.5" />
      <path d="M4.6 16.6l4.5-4.2a1.6 1.6 0 0 1 2.2 0l3 2.8" />
      <path d="M13.6 14.6l1.5-1.3a1.6 1.6 0 0 1 2.2 0l2.1 1.9" />
    </>
  ),
  file: (
    <path d="M3.6 7.5a2 2 0 0 1 2-2h3.1l1.8 2.1h6.1a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5.6a2 2 0 0 1-2-2z" />
  ),
  screenshot: (
    <>
      <path d="M7.2 3.6v13.2h13.2" />
      <path d="M16.8 20.4V7.2H3.6" />
    </>
  ),
  mic: (
    <>
      <rect x="9.2" y="3.4" width="5.6" height="10.6" rx="2.8" />
      <path d="M5.9 11.9a6.1 6.1 0 0 0 12.2 0" />
      <path d="M12 18v2.6" />
    </>
  ),
  volume: (
    <>
      <path d="M4 9.4h3.2L12 5.7v12.6L7.2 14.6H4z" />
      <path d="M15.4 9.2a4.2 4.2 0 0 1 0 5.6" />
      <path d="M17.9 6.7a7.8 7.8 0 0 1 0 10.6" />
    </>
  ),
  play: <path d="M8.6 5.4v13.2l10-6.6z" fill="currentColor" stroke="none" />,
  pause: (
    <>
      <rect x="8" y="5.8" width="2.9" height="12.4" rx="1.1" fill="currentColor" stroke="none" />
      <rect x="13.1" y="5.8" width="2.9" height="12.4" rx="1.1" fill="currentColor" stroke="none" />
    </>
  ),
  close: <path d="M6 6l12 12M18 6L6 18" />,
};

export interface IconProps {
  name: IconName;
  size?: number;
  className?: string;
}

export function Icon({ name, size = 20, className }: IconProps): ReactElement {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {ICONS[name]}
    </svg>
  );
}
