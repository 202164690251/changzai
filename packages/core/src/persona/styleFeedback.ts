// 常在 · 风格校准：用户按需评价一条回复，反馈进入下一轮 prompt
export interface StyleFeedback {
  id: string;
  messageId: string;
  text: string;
  /** 1 = 完全不像，5 = 很像 */
  rating: number;
  tags: string[];
  correctedText?: string;
  createdAt: number;
}

export const STYLE_TAGS = [
  "太长",
  "太短",
  "太客气",
  "太冷淡",
  "用词不像",
  "情绪不对",
  "话题跳",
  "标点/表情不对",
] as const;

export function styleCalibrationText(items: StyleFeedback[]): string {
  if (items.length === 0) return "";
  const recent = [...items].sort((a, b) => b.createdAt - a.createdAt).slice(0, 8);
  const tagCounts = new Map<string, number>();
  for (const item of recent) {
    for (const tag of item.tags) tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
  }
  const topTags = [...tagCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
  const corrections = recent
    .filter((item) => item.correctedText?.trim())
    .slice(0, 3)
    .map((item) => `- 原句：${item.text.slice(0, 60)}\n  更希望：${item.correctedText?.trim().slice(0, 80)}`);
  const lines = ["【用户对风格的校准】"];
  if (topTags.length > 0) {
    lines.push(`- 最近反馈集中在：${topTags.map(([tag, count]) => `${tag}(${count})`).join("、")}。`);
    if (topTags.some(([tag]) => tag === "太长")) lines.push("- 尽量更短，通常 1 句就够。");
    if (topTags.some(([tag]) => tag === "太客气")) lines.push("- 少用客套、总结、说教；像熟人一样直接。");
    if (topTags.some(([tag]) => tag === "太冷淡")) lines.push("- 可以多一点关心和追问，但不要连续追问。");
    if (topTags.some(([tag]) => tag === "话题跳")) lines.push("- 先接住用户上一句，再决定是否换话题。");
  }
  if (corrections.length > 0) lines.push("用户改写过、更接近记忆中的说法：", ...corrections);
  return lines.join("\n");
}
