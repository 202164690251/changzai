// 常在 · 关系卡：从聊天记录里先做一次可解释的本地总结，再由用户编辑确认
import type { NormalizedMessage } from "@changzai/shared";

export type RelationshipType = "情侣" | "前任" | "暗恋" | "朋友" | "亲人" | "同事" | "其他";

export interface RelationshipProfile {
  version: 1;
  type: RelationshipType;
  confidence: number;
  /** 用户在关系里的名字 */
  userName: string;
  /** 她平时怎么叫用户 */
  herNicknameForUser: string;
  /** 关于用户的事实（从“我…”消息里抽） */
  userFacts: string[];
  /** 用户可编辑的补充：重要日期、共同经历、不要提的事 */
  notes: string;
  /** 展示用总结 */
  summary: string;
  updatedAt: number;
  source: {
    messages: number;
    herMessages: number;
    spanDays: number;
  };
}

export type RelationshipSourceMessage = Pick<
  NormalizedMessage,
  "ts" | "sender" | "type" | "content" | "is_holdout"
>;

const COUPLE_WORDS = ["宝宝", "亲爱的", "老公", "老婆", "宝贝", "想你", "爱你", "亲亲", "抱抱", "约会", "在一起", "晚安"];
const FAMILY_WORDS = ["妈", "爸", "儿子", "女儿", "家里", "回家", "吃饭没", "照顾好自己", "过年"];
const FRIEND_WORDS = ["兄弟", "姐妹", "朋友", "同学", "同事", "在吗", "哈哈", "有空吗"];
const NICKNAMES = ["宝宝", "宝贝", "亲爱的", "老公", "老婆", "小朋友", "傻瓜", "笨蛋", "哥哥", "弟弟"];

function countWords(texts: string[], words: string[]): number {
  return texts.reduce((sum, text) => sum + words.filter((word) => text.includes(word)).length, 0);
}

function pickType(texts: string[]): { type: RelationshipType; confidence: number } {
  const scores: Array<[RelationshipType, number]> = [
    ["情侣", countWords(texts, COUPLE_WORDS)],
    ["亲人", countWords(texts, FAMILY_WORDS)],
    ["朋友", countWords(texts, FRIEND_WORDS)],
  ];
  scores.sort((a, b) => b[1] - a[1]);
  const [type, score] = scores[0] ?? ["朋友", 0];
  if (score <= 1) return { type: "朋友", confidence: 0.3 };
  return { type, confidence: Math.min(0.85, 0.45 + score * 0.04) };
}

function extractUserFacts(messages: RelationshipSourceMessage[]): string[] {
  const facts: string[] = [];
  const patterns = [
    /^我(?:是|在|做|住|住在|养了|喜欢|不喜欢|害怕|最近|今天|明天|这周|下周|想去|想买)(.{2,40})/,
    /^我(?:的)?(.{2,30})(?:了|过|呢|啊|吧)$/,
  ];
  for (const message of messages) {
    if (message.sender !== "me" || typeof message.content !== "string") continue;
    const text = message.content.trim();
    if (text.length < 4 || text.length > 80) continue;
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (!match?.[1]) continue;
      const fact = match[1].replace(/[，。！？!?、\s]+$/g, "").trim();
      if (fact.length >= 2 && !facts.some((item) => item === fact)) facts.push(fact);
      break;
    }
    if (facts.length >= 8) break;
  }
  return facts;
}

function pickNickname(herMessages: RelationshipSourceMessage[], fallback: string): string {
  const counts = new Map<string, number>();
  for (const message of herMessages) {
    if (message.type !== "text" || typeof message.content !== "string") continue;
    for (const nickname of NICKNAMES) {
      if (message.content.includes(nickname)) counts.set(nickname, (counts.get(nickname) ?? 0) + 1);
    }
  }
  const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  return best && best[1] >= 1 ? best[0] : fallback;
}

export interface RelationshipBuildOptions {
  meName?: string;
  herName?: string;
  now?: number;
}

export function deriveRelationshipProfile(
  messages: RelationshipSourceMessage[],
  options: RelationshipBuildOptions = {},
): RelationshipProfile {
  const usable = messages.filter(
    (message) => message.is_holdout !== 1 && message.type !== "system" && typeof message.content === "string",
  );
  const herMessages = usable.filter((message) => message.sender === "her");
  const texts = usable.map((message) => message.content.trim()).filter((text) => text.length > 0);
  const { type, confidence } = pickType(texts);
  const userName = options.meName?.trim() || "我";
  const nickname = pickNickname(herMessages, userName);
  const userFacts = extractUserFacts(usable);
  const spanDays =
    usable.length > 1
      ? Math.max(1, Math.round((Math.max(...usable.map((m) => m.ts)) - Math.min(...usable.map((m) => m.ts))) / 86_400_000))
      : 0;
  const summaryParts = [
    `从聊天记录看，你们更像「${type}」关系（置信度 ${Math.round(confidence * 100)}%）。`,
    nickname !== userName ? `她平时叫你「${nickname}」。` : `她平时叫你「${userName}」。`,
  ];
  if (userFacts.length > 0) summaryParts.push(`关于你：${userFacts.slice(0, 4).join("；")}。`);
  if (spanDays > 0) summaryParts.push(`记录跨度约 ${spanDays} 天，共 ${usable.length} 条消息。`);
  return {
    version: 1,
    type,
    confidence,
    userName,
    herNicknameForUser: nickname,
    userFacts,
    notes: "",
    summary: summaryParts.join(""),
    updatedAt: options.now ?? Date.now(),
    source: {
      messages: usable.length,
      herMessages: herMessages.length,
      spanDays,
    },
  };
}

export function relationshipPromptText(profile: RelationshipProfile): string {
  return [
    `【你和用户的关系】`,
    `- 关系：${profile.type}（这是从聊天记录推断、并由用户确认的设定，不要否定它）。`,
    `- 你平时称呼用户「${profile.herNicknameForUser}」；用户的名字是「${profile.userName}」。`,
    profile.userFacts.length > 0 ? `- 关于用户：${profile.userFacts.map((fact) => `- ${fact}`).join("\n")}` : "",
    profile.notes.trim() ? `- 补充：${profile.notes.trim()}` : "",
    `- 不要编造未提供的共同经历；不确定时先问，不要假装记得。`,
  ]
    .filter((line) => line !== "")
    .join("\n");
}
