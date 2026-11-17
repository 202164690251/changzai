// 常在 · 设计 token（与 docs/step0-design-baseline.md 同步）
// 只放常量，不依赖 DOM；由 UI 层写入 CSS 变量。

export const designTokens = {
  color: {
    light: {
      bg: "#EDEDED",
      bubbleMe: "#95EC69",
      bubbleHer: "#FFFFFF",
      text: "#191919",
      sub: "#B2B2B2",
      navBg: "#F7F7F7",
      border: "#DADADA",
      danger: "#FA5151",
    },
    dark: {
      bg: "#111111",
      bubbleMe: "#3EB575",
      bubbleHer: "#2C2C2C",
      text: "#E5E5E5",
      sub: "#8A8A8A",
      navBg: "#1C1C1C",
      border: "#2A2A2A",
      danger: "#FF6B6B",
    },
  },
  size: {
    navH: 44,
    composerH: 56,
    radiusBubble: 6,
    radiusAvatar: 4,
    bubbleMaxWidthPct: 70,
    avatar: 40,
    fontSize: 17,
    lineHeight: 1.45,
    aiBadgeSize: 10,
  },
  fontFamily: 'system-ui, -apple-system, "PingFang SC", "Microsoft YaHei"',
  motion: {
    typingCycleMs: 1200,
    typingMaxMs: 6000,
    cancelTypingPct: 8,
    partGapMinMs: 600,
    partGapMaxMs: 2200,
    recallDelayMinMs: 2000,
    recallDelayMaxMs: 6000,
    recallCooldownMs: 3000,
    timeDividerGapMs: 5 * 60 * 1000,
  },
} as const;

/** 生成 CSS 变量字符串（UI 层注入 :root） */
export function designTokensToCss(): string {
  const t = designTokens;
  const light = t.color.light;
  const dark = t.color.dark;
  const lines = [
    `--bg:${light.bg};`,
    `--bubble-me:${light.bubbleMe};`,
    `--bubble-her:${light.bubbleHer};`,
    `--text:${light.text};`,
    `--sub:${light.sub};`,
    `--nav-bg:${light.navBg};`,
    `--border:${light.border};`,
    `--danger:${light.danger};`,
    `--nav-h:${t.size.navH}px;`,
    `--composer-h:${t.size.composerH}px;`,
    `--radius:${t.size.radiusBubble}px;`,
    `--radius-avatar:${t.size.radiusAvatar}px;`,
    `--bubble-max:${t.size.bubbleMaxWidthPct}%;`,
    `--avatar:${t.size.avatar}px;`,
    `--font-size:${t.size.fontSize}px;`,
    `--line-height:${t.size.lineHeight};`,
    `--font:${t.fontFamily};`,
    `--ai-badge:${t.size.aiBadgeSize}px;`,
  ];
  const darkLines = [
    `--bg:${dark.bg};`,
    `--bubble-me:${dark.bubbleMe};`,
    `--bubble-her:${dark.bubbleHer};`,
    `--text:${dark.text};`,
    `--sub:${dark.sub};`,
    `--nav-bg:${dark.navBg};`,
    `--border:${dark.border};`,
    `--danger:${dark.danger};`,
  ];
  return `:root{${lines.join("")}}\n@media (prefers-color-scheme: dark){:root{${darkLines.join("")}}}`;
}
