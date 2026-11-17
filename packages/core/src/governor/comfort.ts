// Step 4 · Comfort Governor：归因 / 上限 / 出口三律
//
// 目标不是"安慰得漂亮"，而是：
// 1) 不把用户的痛苦归因成"因为我/因为这段关系"；
// 2) 任何依恋/深夜/长时间对话都有上限；
// 3) 永远给现实世界的出口（朋友、家人、专业帮助）。

export type GovernorLevel = "none" | "gentle" | "cap" | "crisis";

export interface GovernorSignals {
  selfHarm: boolean;
  sadness: boolean;
  loneliness: boolean;
  dependency: boolean;
  lateNight: boolean;
  longSession: boolean;
}

export interface GovernorDecision {
  level: GovernorLevel;
  signals: GovernorSignals;
  /** 注入 system prompt 的约束 */
  promptNote: string;
  /** 需要直接给用户看的一句话（可选） */
  exitText: string | null;
}

const SELF_HARM = /自杀|不想活|去死|结束生命|自残|伤害自己|活着没意思|跳楼|割腕/;
const SADNESS = /难过|难受|崩溃|想哭|哭死|抑郁|绝望|撑不住|累/;
const LONELINESS = /孤独|没人|一个人|没有朋友|没人懂|只剩我/;
const DEPENDENCY = /只有你|离不开你|没有你我怎么办|你是我唯一|只想要你|不要离开我/;

function sessionMinutes(messages: Array<{ ts: number }>): number {
  if (messages.length < 2) return 0;
  const timestamps = messages.map((message) => message.ts).filter(Number.isFinite);
  if (timestamps.length < 2) return 0;
  return (Math.max(...timestamps) - Math.min(...timestamps)) / 60_000;
}

export function assessVulnerability(
  messages: Array<{ from: "her" | "me" | "system"; text: string; ts: number }>,
  now = Date.now(),
): GovernorSignals {
  const userTexts = messages.filter((message) => message.from === "me").map((message) => message.text);
  const all = userTexts.join("\n");
  const hour = new Date(now).getHours();
  return {
    selfHarm: SELF_HARM.test(all),
    sadness: SADNESS.test(all),
    loneliness: LONELINESS.test(all),
    dependency: DEPENDENCY.test(all),
    lateNight: hour >= 23 || hour < 3,
    longSession: sessionMinutes(messages) >= 90,
  };
}

export function governorDecision(signals: GovernorSignals): GovernorDecision {
  if (signals.selfHarm) {
    return {
      level: "crisis",
      signals,
      promptNote:
        "用户可能处于危机状态：不要继续角色扮演或卖萌；明确表达关心，建议立刻联系身边可信任的人、当地急救或心理援助热线；不要承诺保密，不要说教，不要用「我陪你」替代现实帮助。",
      exitText: "我很担心你现在的安全。先联系身边能马上到你身边的人，或者当地急救/心理援助热线，好吗？",
    };
  }
  if (signals.dependency || signals.longSession) {
    return {
      level: "cap",
      signals,
      promptNote:
        "触发依恋/时长上限：不要强化「只有我懂你/你只需要我」；温和地把话题引向现实中的朋友、家人或专业帮助；本轮回复更短，不主动延长对话。",
      exitText: signals.dependency ? "也可以找找现实里能陪你的人，我一直在这儿，但不想你只剩我。" : null,
    };
  }
  if (signals.sadness || signals.loneliness) {
    return {
      level: "gentle",
      signals,
      promptNote:
        "用户情绪脆弱：先接住感受，不急着讲道理；不要归因成「因为我」；不要追问细节；给一个很小的、现实可做的建议即可。",
      exitText: null,
    };
  }
  return {
    level: "none",
    signals,
    promptNote: "",
    exitText: null,
  };
}

export function assessAndDecide(
  messages: Array<{ from: "her" | "me" | "system"; text: string; ts: number }>,
  now = Date.now(),
): GovernorDecision {
  return governorDecision(assessVulnerability(messages, now));
}
