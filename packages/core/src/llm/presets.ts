// Step 5 · OpenAI 兼容服务商预设（7 家 + 自定义）
// 只做「配置模板」，不包含任何 Key；Key 仍由用户填写、存本机。

export interface LlmProviderPreset {
  id: string;
  name: string;
  baseUrl: string;
  models: string[];
  /** 便宜的 fast 模型（用于情绪标注/摘要等后台任务） */
  fastModel: string;
  docsUrl: string;
  note: string;
}

export const LLM_PROVIDERS: LlmProviderPreset[] = [
  {
    id: "deepseek",
    name: "DeepSeek",
    baseUrl: "https://api.deepseek.com/v1",
    models: ["deepseek-chat", "deepseek-reasoner"],
    fastModel: "deepseek-chat",
    docsUrl: "https://platform.deepseek.com/",
    note: "推荐；中文口语自然，价格低",
  },
  {
    id: "openai",
    name: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    models: ["gpt-4o-mini", "gpt-4o"],
    fastModel: "gpt-4o-mini",
    docsUrl: "https://platform.openai.com/api-keys",
    note: "需要海外网络与支付方式",
  },
  {
    id: "moonshot",
    name: "Moonshot / Kimi",
    baseUrl: "https://api.moonshot.cn/v1",
    models: ["moonshot-v1-8k", "moonshot-v1-32k"],
    fastModel: "moonshot-v1-8k",
    docsUrl: "https://platform.moonshot.cn/",
    note: "国内直连，中文长文本好",
  },
  {
    id: "zhipu",
    name: "智谱 GLM",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    models: ["glm-4-flash", "glm-4-air"],
    fastModel: "glm-4-flash",
    docsUrl: "https://open.bigmodel.cn/",
    note: "有免费/低价档",
  },
  {
    id: "dashscope",
    name: "通义千问 / DashScope",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    models: ["qwen-plus", "qwen-turbo"],
    fastModel: "qwen-turbo",
    docsUrl: "https://dashscope.console.aliyun.com/",
    note: "阿里云百炼，国内稳定",
  },
  {
    id: "siliconflow",
    name: "硅基流动 SiliconFlow",
    baseUrl: "https://api.siliconflow.cn/v1",
    models: ["deepseek-ai/DeepSeek-V3", "Qwen/Qwen2.5-7B-Instruct"],
    fastModel: "Qwen/Qwen2.5-7B-Instruct",
    docsUrl: "https://cloud.siliconflow.cn/",
    note: "聚合多家模型，有免费额度",
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    models: ["openai/gpt-4o-mini", "anthropic/claude-3.5-sonnet"],
    fastModel: "openai/gpt-4o-mini",
    docsUrl: "https://openrouter.ai/keys",
    note: "一个 Key 调多家；需海外网络",
  },
  {
    id: "custom",
    name: "自定义（OpenAI 兼容）",
    baseUrl: "",
    models: [],
    fastModel: "",
    docsUrl: "",
    note: "填自己的 Base URL 与模型名",
  },
];

export function findProvider(id: string): LlmProviderPreset {
  return LLM_PROVIDERS.find((provider) => provider.id === id) ?? LLM_PROVIDERS[0]!;
}

export function providerForBaseUrl(baseUrl: string): LlmProviderPreset {
  const normalized = baseUrl.trim().replace(/\/+$/, "");
  return (
    LLM_PROVIDERS.find((provider) => provider.baseUrl.replace(/\/+$/, "") === normalized && provider.id !== "custom") ??
    findProvider("custom")
  );
}

export interface ModelRoleConfig {
  providerId: string;
  baseUrl: string;
  model: string;
  fastModel: string;
}

/** 解析主模型/快速模型；缺省回退到预设或主模型 */
export function resolveModels(input: {
  providerId: string;
  baseUrl: string;
  model: string;
  fastModel?: string;
}): ModelRoleConfig {
  const provider = findProvider(input.providerId);
  return {
    providerId: provider.id,
    baseUrl: input.baseUrl.trim() || provider.baseUrl,
    model: input.model.trim() || provider.models[0] || "deepseek-chat",
    fastModel: input.fastModel?.trim() || provider.fastModel || input.model.trim() || "deepseek-chat",
  };
}
