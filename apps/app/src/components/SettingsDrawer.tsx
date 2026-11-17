import { useEffect, useRef, useState } from "react";
import type { ChangeEvent, ReactElement } from "react";
import { LLM_PROVIDERS, findProvider, personaHeadline, describeEmotion, weatherLabel, type EmotionState, type PersonaProfile } from "@changzai/core";
import type { ImportState } from "../hooks/useMediaImport.ts";
import { readAvatarFile } from "../lib/avatar.ts";
import { MAX_NAME_LENGTH, displayName, type PersonKey, type Profile } from "../lib/profile.ts";
import type { DbStats, LlmConfig, MediaKind } from "../lib/tauri.ts";
import { Avatar } from "./Avatar.tsx";
import { Icon } from "./Icons.tsx";

export interface SettingsDrawerProps {
  onClose: () => void;
  profile: Profile;
  storageError: string | null;
  onNameChange: (who: PersonKey, name: string) => void;
  onAvatarChange: (who: PersonKey, avatar: string | null) => void;
  onReset: () => void;
  media: ImportState;
  canImport: boolean;
  onImport: (kind: MediaKind) => void;
  dbStats: DbStats | null;
  dbReady: boolean;
  dbError: string | null;
  onOpenImport: () => void;
  llmConfig: LlmConfig;
  llmStatus: string | null;
  llmTesting: boolean;
  llmTest: { ok: boolean; text: string; error: string } | null;
  onSaveLlm: (config: LlmConfig) => void;
  onTestLlm: (config: LlmConfig) => void;
  persona: PersonaProfile | null;
  personaBusy: boolean;
  personaMessage: string | null;
  onRebuildPersona: () => void;
  emotion: EmotionState;
  analyticsCounts: Record<string, number>;
  analyticsTotal: number;
  onClearAnalytics: () => void;
  proactiveEnabled: boolean;
  proactiveBusy: boolean;
  proactiveReason: string;
  onToggleProactive: (enabled: boolean) => void;
  onTestProactive: () => void;
}

/** 设置抽屉：双方昵称/头像、回忆素材导入、使用说明。 */
export function SettingsDrawer({
  onClose,
  profile,
  storageError,
  onNameChange,
  onAvatarChange,
  onReset,
  media,
  canImport,
  onImport,
  dbStats,
  dbReady,
  dbError,
  onOpenImport,
  llmConfig,
  llmStatus,
  llmTesting,
  llmTest,
  onSaveLlm,
  onTestLlm,
  persona,
  personaBusy,
  personaMessage,
  onRebuildPersona,
  emotion,
  analyticsCounts,
  analyticsTotal,
  onClearAnalytics,
  proactiveEnabled,
  proactiveBusy,
  proactiveReason,
  onToggleProactive,
  onTestProactive,
}: SettingsDrawerProps): ReactElement {
  const herInputRef = useRef<HTMLInputElement | null>(null);
  const meInputRef = useRef<HTMLInputElement | null>(null);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const [provider, setProvider] = useState(llmConfig.provider);
  const [baseUrl, setBaseUrl] = useState(llmConfig.baseUrl);
  const [model, setModel] = useState(llmConfig.model);
  const [fastModel, setFastModel] = useState(llmConfig.fastModel);
  const [apiKey, setApiKey] = useState(llmConfig.apiKey);
  const [temperature, setTemperature] = useState(String(llmConfig.temperature));

  useEffect(() => {
    setProvider(llmConfig.provider);
    setBaseUrl(llmConfig.baseUrl);
    setModel(llmConfig.model);
    setFastModel(llmConfig.fastModel);
    setApiKey(llmConfig.apiKey);
    setTemperature(String(llmConfig.temperature));
  }, [llmConfig]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const handleAvatarFile = async (who: PersonKey, event: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const dataUrl = await readAvatarFile(file);
      onAvatarChange(who, dataUrl);
      setAvatarError(null);
    } catch (error) {
      setAvatarError(error instanceof Error ? error.message : "图片读取失败");
    }
  };

  const renderPerson = (who: PersonKey, label: string, inputRef: typeof herInputRef): ReactElement => {
    const person = profile[who];
    const fallback = who === "her" ? "ta" : "我";
    return (
      <div className="profile-field" key={who}>
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          className="visually-hidden"
          tabIndex={-1}
          onChange={(event) => void handleAvatarFile(who, event)}
        />
        <button
          type="button"
          className="avatar-edit"
          title="更换头像"
          aria-label={`更换${label}的头像`}
          onClick={() => inputRef.current?.click()}
        >
          <Avatar name={displayName(person, fallback)} src={person.avatar} size={56} />
          <span className="avatar-edit-mask">更换</span>
        </button>
        <div className="field-body">
          <label className="field-label" htmlFor={`profile-name-${who}`}>
            {label}
          </label>
          <input
            id={`profile-name-${who}`}
            type="text"
            className="text-input"
            value={person.name}
            maxLength={MAX_NAME_LENGTH}
            placeholder={who === "her" ? "ta 的昵称" : "我的昵称"}
            onChange={(event) => onNameChange(who, event.target.value)}
          />
          {person.avatar !== null && (
            <button type="button" className="link-btn" onClick={() => onAvatarChange(who, null)}>
              移除头像
            </button>
          )}
        </div>
      </div>
    );
  };

  const herName = displayName(profile.her, "ta");
  const importDisabled = !canImport || media.busy;

  return (
    <div
      className="drawer-root"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section className="drawer" role="dialog" aria-modal="true" aria-label="设置">
        <header className="drawer-head">
          <h2>设置</h2>
          <button type="button" className="icon-btn" title="关闭" aria-label="关闭设置" onClick={onClose}>
            <Icon name="close" size={18} />
          </button>
        </header>

        <div className="drawer-body">
          <section className="settings-section" aria-labelledby="settings-profile">
            <header className="settings-section-head">
              <h3 id="settings-profile">资料</h3>
              <button type="button" className="link-btn" onClick={onReset}>
                恢复默认
              </button>
            </header>
            <p className="settings-hint">名字改完立即生效，聊天列表和消息头像会一起更新。点头像可换成自己的图片，小于 2MB。</p>
            {renderPerson("her", "ta 的昵称", herInputRef)}
            {renderPerson("me", "我的昵称", meInputRef)}
            {avatarError !== null && <p className="settings-warn">{avatarError}</p>}
            {storageError !== null && <p className="settings-warn">{storageError}</p>}
          </section>

          <section className="settings-section" aria-labelledby="settings-data">
            <header className="settings-section-head">
              <h3 id="settings-data">数据</h3>
            </header>
            <p className="settings-hint">
              导入你和{herName}的微信聊天记录（txt / csv / json），会自动生成体检报告并加密保存在本机。
            </p>
            {dbError !== null && <p className="settings-warn">{dbError}</p>}
            {dbReady && dbStats?.ok ? (
              <p className="settings-note">
                已导入 {dbStats.messageCount.toLocaleString("zh-CN")} 条消息（ta 的{" "}
                {dbStats.herCount.toLocaleString("zh-CN")} 条，holdout {dbStats.holdoutCount} 条），跨度{" "}
                {dbStats.spanDays} 天。
              </p>
            ) : (
              <p className="settings-note">{dbReady ? "还没有导入聊天记录。" : "正在初始化本地数据库…"}</p>
            )}
            <div className="media-actions">
              <button type="button" className="btn primary" disabled={!dbReady} onClick={onOpenImport}>
                导入聊天记录
              </button>
            </div>
            <p className="settings-hint">导入后会按聊天记录自动生成人格卡；可在这里重建。</p>
          </section>

          <section className="settings-section" aria-labelledby="settings-llm">
            <header className="settings-section-head">
              <h3 id="settings-llm">模型</h3>
            </header>
            <p className="settings-hint">
              任意 OpenAI 兼容接口（推荐 DeepSeek）。API Key 只保存在本机 SQLCipher 数据库，不上传。
            </p>
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
                    if (preset.fastModel) setFastModel(preset.fastModel);
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
                <input
                  className="text-input"
                  value={baseUrl}
                  placeholder="https://api.deepseek.com/v1"
                  onChange={(event) => setBaseUrl(event.target.value)}
                />
              </label>
              <label className="settings-field">
                <span className="field-label">主模型</span>
                <input
                  className="text-input"
                  value={model}
                  placeholder="deepseek-chat"
                  onChange={(event) => setModel(event.target.value)}
                />
              </label>
              <label className="settings-field">
                <span className="field-label">快速模型（摘要/标注用）</span>
                <input
                  className="text-input"
                  value={fastModel}
                  placeholder="deepseek-chat"
                  onChange={(event) => setFastModel(event.target.value)}
                />
              </label>
              <label className="settings-field">
                <span className="field-label">API Key</span>
                <input
                  className="text-input"
                  type="password"
                  value={apiKey}
                  placeholder="sk-..."
                  autoComplete="off"
                  onChange={(event) => setApiKey(event.target.value)}
                />
              </label>
              <label className="settings-field">
                <span className="field-label">温度（0–2）</span>
                <input
                  className="text-input"
                  type="number"
                  min={0}
                  max={2}
                  step={0.05}
                  value={temperature}
                  onChange={(event) => setTemperature(event.target.value)}
                />
              </label>
            </div>
            <div className="media-actions">
              <button
                type="button"
                className="btn primary"
                onClick={() =>
                  onSaveLlm({
                    provider,
                    baseUrl: baseUrl.trim(),
                    model: model.trim(),
                    fastModel: fastModel.trim(),
                    apiKey: apiKey.trim(),
                    temperature: Math.min(2, Math.max(0, Number(temperature) || 0.85)),
                  })
                }
              >
                保存模型配置
              </button>
              <button type="button" className="btn" disabled={llmTesting} onClick={() => onTestLlm({ provider, baseUrl: baseUrl.trim(), model: model.trim(), fastModel: fastModel.trim(), apiKey: apiKey.trim(), temperature: Math.min(2, Math.max(0, Number(temperature) || 0.85)) })}>
                {llmTesting ? "测试中…" : "测一下"}
              </button>
            </div>
            {llmStatus !== null && <p className="settings-note">{llmStatus}</p>}
            {llmTest !== null && (
              <p className={`settings-message ${llmTest.ok ? "ok" : "bad"}`}>
                {llmTest.ok ? `✅ ${llmTest.text}` : `❌ ${llmTest.error || llmTest.text || "测试失败"}`}
              </p>
            )}
          </section>

          <section className="settings-section" aria-labelledby="settings-persona">
            <header className="settings-section-head">
              <h3 id="settings-persona">人格卡</h3>
            </header>
            {persona !== null && persona.source.her_messages > 0 ? (
              <>
                <p className="settings-note">{personaHeadline(persona)}</p>
                <p className="settings-hint">{persona.summary}</p>
                <p className="settings-hint">
                  事实 {persona.facts.length} 条 · 参考对话 {persona.samples.length} 段 · holdout 已排除
                </p>
              </>
            ) : (
              <p className="settings-hint">导入聊天记录后会自动生成人格卡；也可以从已有消息手动重建。</p>
            )}
            <p className="settings-note">
              当前状态：{weatherLabel(emotion.weather)} · 亲近度 {emotion.closeness.toFixed(2)} · 紧张度{" "}
              {emotion.tension.toFixed(2)}
            </p>
            <p className="settings-hint">{describeEmotion(emotion)}</p>
            <div className="media-actions">
              <button
                type="button"
                className="btn"
                disabled={!dbReady || personaBusy}
                onClick={onRebuildPersona}
              >
                {personaBusy ? "重建中…" : "从已有消息重建"}
              </button>
            </div>
            {personaMessage !== null && <p className="settings-note">{personaMessage}</p>}
          </section>

          <section className="settings-section" aria-labelledby="settings-media">
            <header className="settings-section-head">
              <h3 id="settings-media">回忆素材</h3>
            </header>
            <p className="settings-hint">
              导入的图片和语音会出现在和{herName}的聊天里，只在本次打开时保留。
            </p>
            <div className="media-actions">
              <button
                type="button"
                className="btn primary"
                disabled={importDisabled}
                onClick={() => onImport("image")}
              >
                导入图片
              </button>
              <button
                type="button"
                className="btn"
                disabled={importDisabled}
                onClick={() => onImport("voice")}
              >
                导入语音
              </button>
            </div>
            {!canImport && <p className="settings-warn">请用桌面应用导入</p>}
            {canImport && media.busy && <p className="settings-note">正在导入…</p>}
            {media.message !== null && (
              <p className={`settings-message ${media.ok === true ? "ok" : "bad"}`}>{media.message}</p>
            )}
          </section>

          <section className="settings-section" aria-labelledby="settings-stats">
            <header className="settings-section-head">
              <h3 id="settings-stats">本地统计</h3>
              <button type="button" className="link-btn" onClick={onClearAnalytics}>
                清空
              </button>
            </header>
            <p className="settings-hint">只在本机记录漏斗，不上传；清空后不可恢复。</p>
            <ul className="usage-list">
              <li>启动：{analyticsCounts.app_open ?? 0} 次</li>
              <li>导入完成：{analyticsCounts.import_done ?? 0} 次</li>
              <li>首次对话：{analyticsCounts.first_message ?? 0} 次</li>
              <li>我发出的消息：{analyticsCounts.message_me ?? 0} 条</li>
              <li>总计事件：{analyticsTotal} 条</li>
            </ul>
          </section>

          <section className="settings-section" aria-labelledby="settings-proactive">
            <header className="settings-section-head">
              <h3 id="settings-proactive">主动消息</h3>
            </header>
            <p className="settings-hint">
              开启后，ta 会在你一段时间没说话时主动发一条（日上限 3，周 12，23:00–8:00 免打扰）。
              关窗到托盘后由进程内定时器继续尝试；完全退出后不补发。
            </p>
            <label className="settings-check">
              <input
                type="checkbox"
                checked={proactiveEnabled}
                onChange={(event) => onToggleProactive(event.target.checked)}
              />
              <span>允许 ta 主动找我</span>
            </label>
            <div className="media-actions">
              <button type="button" className="btn" disabled={proactiveBusy} onClick={onTestProactive}>
                {proactiveBusy ? "正在想说什么…" : "现在发一条试试"}
              </button>
            </div>
            {proactiveReason.length > 0 && <p className="settings-note">上次判断：{proactiveReason}</p>}
          </section>

          <section className="settings-section" aria-labelledby="settings-usage">
            <header className="settings-section-head">
              <h3 id="settings-usage">使用说明</h3>
            </header>
            <ul className="usage-list">
              <li>这里的消息由 AI 模拟生成，不是真人。</li>
              <li>ta 不是真人。但你可以当真一会儿。</li>
              <li>昵称和头像只改变显示，改动保存在这台电脑上。</li>
              <li>回忆素材只在本机读取，不会上传。</li>
            </ul>
          </section>
        </div>
      </section>
    </div>
  );
}
