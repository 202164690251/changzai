// Step 6 · 四步引导：说明/18+ → 导入 → 人格卡 → 模型配置
import { useState } from "react";
import type { ReactElement } from "react";
import { LLM_PROVIDERS, findProvider, personaHeadline, type PersonaProfile } from "@veyrimi/core";
import type { DbStats, LlmConfig } from "../lib/tauri.ts";
import type { ImportState } from "../hooks/useImport.ts";


export interface OnboardingProps {
  open: boolean;
  dbStats: DbStats | null;
  importState: ImportState;
  persona: PersonaProfile | null;
  llmConfig: LlmConfig;
  onOpenImport: () => void;
  onSaveLlm: (config: LlmConfig) => void;
  onFinish: () => void;
  onSkip: () => void;
  onSkipToPreset: () => void;
}

const STEPS = ["开始", "导入", "人格卡", "模型"] as const;

export function Onboarding({
  open,
  dbStats,
  importState,
  persona,
  llmConfig,
  onOpenImport,
  onSaveLlm,
  onFinish,
  onSkip,
  onSkipToPreset,
}: OnboardingProps): ReactElement | null {
  const [step, setStep] = useState(0);
  const [adult, setAdult] = useState(false);
  const [provider, setProvider] = useState(llmConfig.provider);
  const [baseUrl, setBaseUrl] = useState(llmConfig.baseUrl);
  const [model, setModel] = useState(llmConfig.model);
  const [apiKey, setApiKey] = useState(llmConfig.apiKey);

  if (!open) return null;

  const imported = (dbStats?.messageCount ?? 0) > 0;
  const next = (): void => setStep((current) => Math.min(STEPS.length - 1, current + 1));
  const back = (): void => setStep((current) => Math.max(0, current - 1));

  return (
    <div className="onboarding-root" role="dialog" aria-modal="true" aria-label="如晤引导">
      <section className="onboarding-card">
        <header className="onboarding-head">
          <div>
            <strong>veyrimi · 如晤</strong>
            <span className="onboarding-step">
              {step + 1}/{STEPS.length} · {STEPS[step]}
            </span>
          </div>
          <button type="button" className="link-btn" onClick={onSkip}>
            跳过
          </button>
        </header>

        {step === 0 && (
          <div className="onboarding-body">
            <h1>把一段关系，做成一个还愿意陪你说说话的人。</h1>
            <p>这里没有服务器，所有聊天记录、头像、素材和模型 Key 都只保存在这台电脑。</p>
            <ul className="usage-list">
              <li>所有回复都由 AI 模拟，不是真人，也不代表对方本人。</li>
              <li>别人看不到你的数据；如果你共用电脑，请使用自己的 Windows 账户。</li>
              <li>如果最近情绪不好，请优先联系身边的人或专业帮助。</li>
            </ul>
            <label className="settings-check">
              <input type="checkbox" checked={adult} onChange={(event) => setAdult(event.target.checked)} />
              <span>我已年满 18 岁，并理解这里的 ta 是 AI 模拟</span>
            </label>
            <div className="modal-actions">
              <button type="button" className="btn primary" disabled={!adult} onClick={next}>
                开始
              </button>
            </div>
          </div>
        )}

        {step === 1 && (
          <div className="onboarding-body">
            <h2>导入聊天记录</h2>
            <p>支持 WeChatMsg / 留痕 / QQ 导出的 txt、csv、json；不导入也可以先手动聊聊（功能会少很多）。</p>
            <div className="media-actions">
              <button type="button" className="btn primary" onClick={onOpenImport}>
                {imported ? "再导入一批" : "选择聊天记录文件"}
              </button>
            </div>
            <p className="settings-note">
              {imported
                ? `已导入 ${dbStats?.messageCount.toLocaleString("zh-CN")} 条消息（ta 的 ${dbStats?.herCount} 条）`
                : importState.step === "parsing"
                  ? "解析中…"
                  : "还没有导入记录"}
            </p>
            <div className="modal-actions">
              <button type="button" className="btn" onClick={back}>
                上一步
              </button>
              <button type="button" className="btn" onClick={onSkipToPreset}>
                没有记录？先选一个性格
              </button>
              <button type="button" className="btn primary" disabled={!imported} onClick={next}>
                下一步
              </button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="onboarding-body">
            <h2>看一眼人格卡</h2>
            {persona && persona.source.her_messages > 0 ? (
              <>
                <p className="settings-note">{personaHeadline(persona)}</p>
                <p>{persona.summary}</p>
                <ul className="usage-list">
                  {persona.facts.slice(0, 5).map((fact) => (
                    <li key={`${fact.kind}-${fact.text}`}>
                      {fact.kind}：{fact.text}
                    </li>
                  ))}
                </ul>
                <p className="settings-hint">这些事实只从聊天记录里抽取；后续可以在设置里重建，不会上传。</p>
              </>
            ) : (
              <p>还没有生成人格卡。也可以先跳过，在设置里导入后再生成。</p>
            )}
            <div className="modal-actions">
              <button type="button" className="btn" onClick={back}>
                上一步
              </button>
              <button type="button" className="btn primary" onClick={next}>
                {persona ? "下一步" : "先跳过"}
              </button>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="onboarding-body">
            <h2>配置模型</h2>
            <p>任意 OpenAI 兼容服务；Key 只存本机加密数据库。也可以稍后在设置里配置。</p>
            <div className="settings-form">
              <label className="settings-field">
                <span className="field-label">服务商</span>
                <select
                  className="text-input"
                  value={provider}
                  onChange={(event) => {
                    const preset = findProvider(event.target.value);
                    setProvider(preset.id);
                    if (preset.baseUrl) setBaseUrl(preset.baseUrl);
                    if (preset.models[0]) setModel(preset.models[0]);
                  }}
                >
                  {LLM_PROVIDERS.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="settings-field">
                <span className="field-label">Base URL</span>
                <input className="text-input" value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} />
              </label>
              <label className="settings-field">
                <span className="field-label">模型</span>
                <input className="text-input" value={model} onChange={(event) => setModel(event.target.value)} />
              </label>
              <label className="settings-field">
                <span className="field-label">API Key</span>
                <input
                  className="text-input"
                  type="password"
                  value={apiKey}
                  placeholder="sk-..."
                  onChange={(event) => setApiKey(event.target.value)}
                />
              </label>
            </div>
            <div className="modal-actions">
              <button type="button" className="btn" onClick={back}>
                上一步
              </button>
              <button
                type="button"
                className="btn primary"
                onClick={() => {
                  onSaveLlm({
                    ...llmConfig,
                    provider,
                    baseUrl: baseUrl.trim(),
                    model: model.trim(),
                    fastModel: llmConfig.fastModel || model.trim(),
                    apiKey: apiKey.trim(),
                  });
                  onFinish();
                }}
              >
                保存并进入如晤
              </button>
            </div>
          </div>
        )}

        <footer className="onboarding-foot">

          本地优先 · 不上传 · 已加密
        </footer>
      </section>
    </div>
  );
}
