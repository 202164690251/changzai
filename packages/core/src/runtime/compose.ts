// Step 5 · Compose：在 Step 4 runtime prompt 上叠加「AI 味硬规则」
import { buildRuntimeMessages, type RuntimePromptOptions, type RuntimePromptResult } from "./prompt.ts";
import { COMPOSE_HARD_RULES } from "./filter.ts";

export function buildComposedMessages(options: RuntimePromptOptions): RuntimePromptResult {
  const runtime = buildRuntimeMessages(options);
  const [first, ...rest] = runtime.messages;
  if (first && first.role === "system") {
    runtime.messages = [
      { ...first, content: `${first.content}\n\n【硬规则（优先于风格）】\n${COMPOSE_HARD_RULES}` },
      ...rest,
    ];
    runtime.systemPrompt = runtime.messages[0]?.content ?? runtime.systemPrompt;
  }
  return runtime;
}
