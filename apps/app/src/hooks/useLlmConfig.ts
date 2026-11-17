// Step 3 · 模型配置（Base URL / 模型 / API Key / 温度）
// 配置存 SQLCipher DB 的 setting 表；API Key 不写入前端存储。
import { useCallback, useEffect, useState } from "react";
import { api, isTauri, type LlmConfig } from "../lib/tauri.ts";

export const DEFAULT_LLM_CONFIG: LlmConfig = {
  provider: "deepseek",
  baseUrl: "https://api.deepseek.com/v1",
  model: "deepseek-chat",
  fastModel: "deepseek-chat",
  apiKey: "",
  temperature: 0.85,
};

export interface LlmApi {
  config: LlmConfig;
  ready: boolean;
  saving: boolean;
  message: string | null;
  save: (config: LlmConfig) => Promise<boolean>;
  replace: (config: LlmConfig) => void;
}

export function useLlmConfig(): LlmApi {
  const [config, setConfig] = useState<LlmConfig>(DEFAULT_LLM_CONFIG);
  const [ready, setReady] = useState(!isTauri());
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!isTauri()) return;
    let alive = true;
    void (async () => {
      try {
        const loaded = await api.llmConfigLoad();
        if (alive) setConfig({ ...DEFAULT_LLM_CONFIG, ...loaded });
      } catch (error) {
        if (alive) setMessage(error instanceof Error ? error.message : String(error));
      } finally {
        if (alive) setReady(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const replace = useCallback((next: LlmConfig) => {
    setConfig(next);
    if (isTauri()) void api.llmConfigSave(next).catch(() => undefined);
  }, []);

  const save = useCallback(async (next: LlmConfig): Promise<boolean> => {
    setSaving(true);
    setMessage(null);
    try {
      const ok = await api.llmConfigSave(next);
      if (ok) {
        setConfig(next);
        setMessage("模型配置已保存（API Key 存在本机加密数据库）");
      }
      return ok;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
      return false;
    } finally {
      setSaving(false);
    }
  }, []);

  return { config, ready, saving, message, save, replace };
}
