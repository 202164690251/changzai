import { useEffect, useRef, useState } from "react";
import type { ChangeEvent, ReactElement } from "react";
import { LLM_PROVIDERS, PROACTIVE_PRESETS, findProvider, personaHeadline, personaMbti, describeEmotion, weatherLabel, type EmotionState, type PersonaProfile, type ProactiveDesire, type ProactiveState, type RelationshipProfile } from "@changzai/core";
import type { ImportState } from "../hooks/useMediaImport.ts";
import type { VoiceSettings } from "../hooks/useConversations.ts";
import { readAvatarFile } from "../lib/avatar.ts";
import { MAX_NAME_LENGTH, displayName, type PersonKey, type Profile } from "../lib/profile.ts";
import { api, isTauri, type DbStats, type LlmConfig, type MediaKind, type TtsVoice } from "../lib/tauri.ts";
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
  voice: VoiceSettings;
  voiceTesting: boolean;
  voiceError: string | null;
  onUpdateVoice: (patch: Partial<VoiceSettings>) => void;
  onTestVoice: () => void;
  persona: PersonaProfile | null;
  personaBusy: boolean;
  personaMessage: string | null;
  onRebuildPersona: () => void;
  emotion: EmotionState;
  analyticsCounts: Record<string, number>;
  analyticsTotal: number;
  onClearAnalytics: () => void;
  proactiveState: ProactiveState;
  proactiveBusy: boolean;
  proactiveReason: string;
  onToggleProactive: (enabled: boolean) => void;
  onSetProactiveDesire: (level: ProactiveDesire) => void;
  onUpdateProactive: (patch: Partial<ProactiveState>) => void;
  onPauseProactive: (minutes: number | null) => void;
  onTestProactive: () => void;
  safetyBusy: boolean;
  safetyMessage: string | null;
  onBackup: (passphrase: string) => void;
  onRestore: (passphrase: string) => void;
  onDestroy: (confirm: string) => void;
  pinEnabled: boolean;
  pinError: string | null;
  onSetPin: (pin: string) => void;
  onDisablePin: (pin: string) => void;
  personaHistoryCount: number;
  onUpdateFacts: (facts: PersonaProfile["facts"]) => void;
  onUpdatePersona: (patch: Partial<PersonaProfile>) => void;
  relationship: RelationshipProfile | null;
  relationshipBusy: boolean;
  relationshipMessage: string | null;
  onSaveRelationship: (profile: RelationshipProfile) => void;
  onRebuildRelationship: () => void;
  styleReviewEnabled: boolean;
  styleFeedbackCount: number;
  onToggleStyleReview: (enabled: boolean) => void;
  onClearStyleFeedback: () => void;
  onOpenMood: () => void;
  onOpenPersonaStart: () => void;
  onRollbackPersona: () => void;
  petOpen: boolean;
  onTogglePet: () => void;
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
  voice,
  voiceTesting,
  voiceError,
  onUpdateVoice,
  onTestVoice,
  persona,
  personaBusy,
  personaMessage,
  onRebuildPersona,
  emotion,
  analyticsCounts,
  analyticsTotal,
  onClearAnalytics,
  proactiveState,
  proactiveBusy,
  proactiveReason,
  onToggleProactive,
  onSetProactiveDesire,
  onUpdateProactive,
  onPauseProactive,
  onTestProactive,
  safetyBusy,
  safetyMessage,
  onBackup,
  onRestore,
  onDestroy,
  pinEnabled,
  pinError,
  onSetPin,
  onDisablePin,
  personaHistoryCount,
  onUpdateFacts,
  onUpdatePersona,
  relationship,
  relationshipBusy,
  relationshipMessage,
  onSaveRelationship,
  onRebuildRelationship,
  styleReviewEnabled,
  styleFeedbackCount,
  onToggleStyleReview,
  onClearStyleFeedback,
  onOpenMood,
  onRollbackPersona,
  petOpen,
  onTogglePet,
}: SettingsDrawerProps): ReactElement {
  const herInputRef = useRef<HTMLInputElement | null>(null);
  const meInputRef = useRef<HTMLInputElement | null>(null);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const [ttsVoices, setTtsVoices] = useState<TtsVoice[]>([]);
  const [ttsLoading, setTtsLoading] = useState(false);
  const [provider, setProvider] = useState(llmConfig.provider);
  const [baseUrl, setBaseUrl] = useState(llmConfig.baseUrl);
  const [model, setModel] = useState(llmConfig.model);
  const [fastModel, setFastModel] = useState(llmConfig.fastModel);
  const [apiKey, setApiKey] = useState(llmConfig.apiKey);
  const [temperature, setTemperature] = useState(String(llmConfig.temperature));
  const [backupPass, setBackupPass] = useState("");
  const [destroyConfirm, setDestroyConfirm] = useState("");
  const [pinDraft, setPinDraft] = useState("");
  const [factsDraft, setFactsDraft] = useState<PersonaProfile["facts"]>(persona?.facts ?? []);
  const [factDraft, setFactDraft] = useState("");
  const [personaSummary, setPersonaSummary] = useState(persona?.summary ?? "");
  const [personaBoundaries, setPersonaBoundaries] = useState((persona?.boundaries ?? []).join("\n"));
  const [relationType, setRelationType] = useState<RelationshipProfile["type"]>(relationship?.type ?? "朋友");
  const [relationUserName, setRelationUserName] = useState(relationship?.userName ?? "");
  const [relationNickname, setRelationNickname] = useState(relationship?.herNicknameForUser ?? "");
  const [relationSummary, setRelationSummary] = useState(relationship?.summary ?? "");
  const [relationFacts, setRelationFacts] = useState((relationship?.userFacts ?? []).join("\n"));
  const [relationNotes, setRelationNotes] = useState(relationship?.notes ?? "");

  useEffect(() => {
    setFactsDraft(persona?.facts ?? []);
    setPersonaSummary(persona?.summary ?? "");
    setPersonaBoundaries((persona?.boundaries ?? []).join("\n"));
  }, [persona]);

  useEffect(() => {
    if (!relationship) return;
    setRelationType(relationship.type);
    setRelationUserName(relationship.userName);
    setRelationNickname(relationship.herNicknameForUser);
    setRelationSummary(relationship.summary);
    setRelationFacts(relationship.userFacts.join("\n"));
    setRelationNotes(relationship.notes);
  }, [relationship]);

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

          <section className="settings-section" aria-labelledby="settings-pet">
            <header className="settings-section-head">
              <h3 id="settings-pet">桌宠（V2.3 MVP）</h3>
            </header>
            <p className="settings-hint">
              透明小窗，使用当前聊天头像。单击说话、双击打开聊天、右键菜单、可拖动并记住位置。默认关闭。
            </p>
            <div className="media-actions">
              <button type="button" className="btn primary" onClick={onTogglePet}>
                {petOpen ? "关闭桌宠" : "打开桌宠"}
              </button>
            </div>
            <p className="settings-hint">
              Live2D 需要单独导入模型文件；这一版先用头像图片跑通窗口与交互，下一阶段再接 Live2D。
            </p>
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


          <section className="settings-section" aria-labelledby="settings-voice">
            <header className="settings-section-head">
              <h3 id="settings-voice">语音朗读</h3>
            </header>
            <p className="settings-hint">
              默认关闭。Windows 本机语音不需要 API Key、完全离线；云 TTS 会把朗读文字发给服务商，需要自备 Key。
            </p>
            <div className="settings-form">
              <label className="settings-check">
                <input
                  type="checkbox"
                  checked={voice.enabled}
                  onChange={(event) => onUpdateVoice({ enabled: event.target.checked })}
                />
                <span>启用 TTS（在 ta 的文字气泡上显示朗读按钮）</span>
              </label>
              <label className="settings-check">
                <input
                  type="checkbox"
                  checked={voice.autoSpeak}
                  onChange={(event) => onUpdateVoice({ autoSpeak: event.target.checked })}
                />
                <span>自动朗读 ta 的新回复（默认关闭）</span>
              </label>
              <label className="settings-field">
                <span className="field-label">ta 用语音气泡回复的概率（0–100%）</span>
                <input
                  className="text-input"
                  type="number"
                  min={0}
                  max={100}
                  value={voice.voiceReplyChance}
                  onChange={(event) =>
                    onUpdateVoice({
                      voiceReplyChance: Math.min(100, Math.max(0, Number(event.target.value) || 0)),
                    })
                  }
                />
              </label>
              <label className="settings-field">
                <span className="field-label">语音来源</span>
                <select
                  className="text-input"
                  value={voice.provider}
                  onChange={(event) =>
                    onUpdateVoice({ provider: event.target.value === "openai" ? "openai" : "windows" })
                  }
                >
                  <option value="windows">Windows 本机（免费 / 离线）</option>
                  <option value="openai">OpenAI 兼容云 TTS（需 Key）</option>
                </select>
              </label>
              {voice.provider === "windows" ? (
                <label className="settings-field">
                  <span className="field-label">系统音色（留空用默认）</span>
                  <select
                    className="text-input"
                    value={voice.voice}
                    onChange={(event) => onUpdateVoice({ voice: event.target.value })}
                  >
                    <option value="">自动（系统默认）</option>
                    {ttsVoices.map((item) => (
                      <option key={item.name} value={item.name}>
                        {item.name}
                        {item.culture ? ` · ${item.culture}` : ""}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="btn"
                    disabled={ttsLoading}
                    onClick={() => {
                      if (!isTauri()) return;
                      setTtsLoading(true);
                      void api
                        .ttsVoices()
                        .then(setTtsVoices)
                        .catch(() => undefined)
                        .finally(() => setTtsLoading(false));
                    }}
                  >
                    {ttsLoading ? "读取中…" : "读取系统音色"}
                  </button>
                </label>
              ) : (
                <>
                  <label className="settings-field">
                    <span className="field-label">Base URL</span>
                    <input
                      className="text-input"
                      value={voice.baseUrl}
                      placeholder="https://api.openai.com/v1"
                      onChange={(event) => onUpdateVoice({ baseUrl: event.target.value })}
                    />
                  </label>
                  <label className="settings-field">
                    <span className="field-label">TTS 模型</span>
                    <input
                      className="text-input"
                      value={voice.model}
                      placeholder="tts-1"
                      onChange={(event) => onUpdateVoice({ model: event.target.value })}
                    />
                  </label>
                  <label className="settings-field">
                    <span className="field-label">云音色</span>
                    <input
                      className="text-input"
                      value={voice.voice}
                      placeholder="alloy"
                      onChange={(event) => onUpdateVoice({ voice: event.target.value })}
                    />
                  </label>
                  <label className="settings-field">
                    <span className="field-label">TTS API Key</span>
                    <input
                      className="text-input"
                      type="password"
                      value={voice.apiKey}
                      placeholder="sk-..."
                      autoComplete="off"
                      onChange={(event) => onUpdateVoice({ apiKey: event.target.value })}
                    />
                  </label>
                </>
              )}
              <label className="settings-field">
                <span className="field-label">语速（-10 慢 … 10 快）</span>
                <input
                  className="text-input"
                  type="number"
                  min={-10}
                  max={10}
                  value={voice.rate}
                  onChange={(event) =>
                    onUpdateVoice({ rate: Math.min(10, Math.max(-10, Number(event.target.value) || 0)) })
                  }
                />
              </label>
            </div>
            <div className="media-actions">
              <button type="button" className="btn" disabled={voiceTesting} onClick={onTestVoice}>
                {voiceTesting ? "合成中…" : "试听一句"}
              </button>
            </div>
            {voiceError !== null && <p className="settings-message bad">❌ {voiceError}</p>}
            <p className="settings-hint">
              需要“上传对方音频变成她的声音”时，普通 TTS 不够，必须用支持声音克隆的云服务或本地 GPT-SoVITS/CosyVoice；这一版先不做克隆。
            </p>
          </section>
          <section className="settings-section" aria-labelledby="settings-persona">
            <header className="settings-section-head">
              <h3 id="settings-persona">
                人格卡
                {persona && personaMbti(persona) && <span className="persona-mbti">{personaMbti(persona)}</span>}
              </h3>
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
            {persona !== null && persona.source.her_messages > 0 && (
              <details className="persona-review">
                <summary>逐条审阅事实（{factsDraft.length} 条）</summary>
                <ul className="usage-list">
                  {factsDraft.map((fact, index) => (
                    <li key={`${fact.kind}-${fact.text}-${index}`}>
                      {fact.kind}：{fact.text}
                      <button
                        type="button"
                        className="link-btn"
                        onClick={() => setFactsDraft(factsDraft.filter((_, position) => position !== index))}
                      >
                        移除
                      </button>
                    </li>
                  ))}
                </ul>
                <div className="media-actions">
                  <input
                    className="text-input"
                    value={factDraft}
                    placeholder="补充一条事实，如：喜欢雨天"
                    onChange={(event) => setFactDraft(event.target.value)}
                  />
                  <button
                    type="button"
                    className="btn"
                    disabled={factDraft.trim().length < 2}
                    onClick={() => {
                      setFactsDraft([...factsDraft, { kind: "补充", text: factDraft.trim() }]);
                      setFactDraft("");
                    }}
                  >
                    添加
                  </button>
                </div>
                <div className="media-actions">
                  <button type="button" className="btn primary" onClick={() => onUpdateFacts(factsDraft)}>
                    保存审阅
                  </button>
                  <button
                    type="button"
                    className="btn"
                    disabled={personaHistoryCount === 0}
                    onClick={onRollbackPersona}
                  >
                    回滚上一版
                  </button>
                </div>
              </details>
            )}
            {persona !== null && (
              <details className="persona-review">
                <summary>编辑人格卡文字</summary>
                <label className="settings-field">
                  <span className="field-label">整体印象 / 风格总结</span>
                  <textarea
                    className="text-input"
                    rows={3}
                    value={personaSummary}
                    onChange={(event) => setPersonaSummary(event.target.value)}
                  />
                </label>
                <label className="settings-field">
                  <span className="field-label">边界（每行一条）</span>
                  <textarea
                    className="text-input"
                    rows={3}
                    value={personaBoundaries}
                    onChange={(event) => setPersonaBoundaries(event.target.value)}
                  />
                </label>
                <div className="media-actions">
                  <button
                    type="button"
                    className="btn primary"
                    onClick={() =>
                      onUpdatePersona({
                        summary: personaSummary,
                        boundaries: personaBoundaries
                          .split("\n")
                          .map((line) => line.trim())
                          .filter(Boolean),
                      })
                    }
                  >
                    保存人格卡
                  </button>
                  <button type="button" className="btn" onClick={onOpenMood}>
                    调整 ta 现在的状态
                  </button>
                </div>
              </details>
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

          <section className="settings-section" aria-labelledby="settings-relationship">
            <header className="settings-section-head">
              <h3 id="settings-relationship">关系与称呼</h3>
            </header>
            <p className="settings-hint">
              首次会从聊天记录自动总结一次；这里可以改成你确认的关系、她对你的称呼和关于你的事实。
            </p>
            {relationship !== null ? (
              <>
                <div className="settings-form proactive-grid">
                  <label className="settings-field">
                    <span className="field-label">关系</span>
                    <select
                      className="text-input"
                      value={relationType}
                      onChange={(event) => setRelationType(event.target.value as RelationshipProfile["type"])}
                    >
                      {["情侣", "前任", "暗恋", "朋友", "亲人", "同事", "其他"].map((type) => (
                        <option key={type} value={type}>
                          {type}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="settings-field">
                    <span className="field-label">你的名字</span>
                    <input
                      className="text-input"
                      value={relationUserName}
                      onChange={(event) => setRelationUserName(event.target.value)}
                    />
                  </label>
                  <label className="settings-field">
                    <span className="field-label">她怎么叫你</span>
                    <input
                      className="text-input"
                      value={relationNickname}
                      onChange={(event) => setRelationNickname(event.target.value)}
                    />
                  </label>
                </div>
                <label className="settings-field">
                  <span className="field-label">关系总结</span>
                  <textarea
                    className="text-input"
                    rows={3}
                    value={relationSummary}
                    onChange={(event) => setRelationSummary(event.target.value)}
                  />
                </label>
                <label className="settings-field">
                  <span className="field-label">关于你的事实（每行一条）</span>
                  <textarea
                    className="text-input"
                    rows={4}
                    value={relationFacts}
                    onChange={(event) => setRelationFacts(event.target.value)}
                  />
                </label>
                <label className="settings-field">
                  <span className="field-label">重要日期 / 共同经历 / 不要提的事</span>
                  <textarea
                    className="text-input"
                    rows={3}
                    value={relationNotes}
                    onChange={(event) => setRelationNotes(event.target.value)}
                  />
                </label>
                <div className="media-actions">
                  <button
                    type="button"
                    className="btn primary"
                    onClick={() =>
                      onSaveRelationship({
                        ...relationship,
                        type: relationType,
                        userName: relationUserName.trim() || "我",
                        herNicknameForUser: relationNickname.trim() || relationUserName.trim() || "你",
                        summary: relationSummary.trim(),
                        userFacts: relationFacts
                          .split("\n")
                          .map((line) => line.trim())
                          .filter(Boolean),
                        notes: relationNotes.trim(),
                        updatedAt: Date.now(),
                      })
                    }
                  >
                    保存关系卡
                  </button>
                  <button type="button" className="btn" disabled={relationshipBusy} onClick={onRebuildRelationship}>
                    {relationshipBusy ? "总结中…" : "重新从记录总结"}
                  </button>
                </div>
              </>
            ) : (
              <button type="button" className="btn" disabled={relationshipBusy} onClick={onRebuildRelationship}>
                {relationshipBusy ? "总结中…" : "从聊天记录生成关系卡"}
              </button>
            )}
            {relationshipMessage !== null && <p className="settings-note">{relationshipMessage}</p>}
          </section>

          <section className="settings-section" aria-labelledby="settings-style-review">
            <header className="settings-section-head">
              <h3 id="settings-style-review">风格校准</h3>
            </header>
            <p className="settings-hint">
              默认关闭。开启后只在鼠标悬停/右键消息时出现「校准」入口，不会主动弹出，也不影响聊天布局。
            </p>
            <label className="settings-check">
              <input
                type="checkbox"
                checked={styleReviewEnabled}
                onChange={(event) => onToggleStyleReview(event.target.checked)}
              />
              <span>显示风格校准入口</span>
            </label>
            <p className="settings-hint">已记录 {styleFeedbackCount} 条反馈；只存本机。</p>
            {styleFeedbackCount > 0 && (
              <button type="button" className="btn" onClick={onClearStyleFeedback}>
                清空风格反馈
              </button>
            )}
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

          <section className="settings-section" aria-labelledby="settings-safety">
            <header className="settings-section-head">
              <h3 id="settings-safety">安全与备份</h3>
            </header>
            <p className="settings-hint">
              所有数据只在本机。需要换电脑时用加密备份；销毁会删除数据库、密钥和素材，不承诺可恢复。
            </p>
            <ul className="usage-list">
              <li>危机资源：当地急救 120 / 心理援助热线 12356（中国大陆）</li>
              <li>如果最近情绪不好，请优先联系身边的人或专业帮助。</li>
              <li>网络：只有你配置的模型 Base URL 会被访问，没有遥测。</li>
            </ul>
            <label className="settings-field">
              <span className="field-label">备份口令（至少 6 位，勿与 Key 相同）</span>
              <input
                className="text-input"
                type="password"
                value={backupPass}
                onChange={(event) => setBackupPass(event.target.value)}
                placeholder="用于加密 .czbak"
              />
            </label>
            <div className="media-actions">
              <button
                type="button"
                className="btn"
                disabled={safetyBusy || backupPass.trim().length < 6}
                onClick={() => onBackup(backupPass)}
              >
                导出备份
              </button>
              <button
                type="button"
                className="btn"
                disabled={safetyBusy || backupPass.trim().length < 6}
                onClick={() => onRestore(backupPass)}
              >
                恢复备份
              </button>
            </div>
            <label className="settings-field">
              <span className="field-label">
                启动 PIN（4–8 位数字）{pinEnabled ? " · 已开启" : " · 未开启"}
              </span>
              <input
                className="text-input"
                type="password"
                inputMode="numeric"
                maxLength={8}
                value={pinDraft}
                onChange={(event) => setPinDraft(event.target.value.replace(/\D/g, ""))}
                placeholder={pinEnabled ? "输入当前 PIN 关闭" : "设置启动 PIN"}
              />
            </label>
            <div className="media-actions">
              <button
                type="button"
                className="btn"
                disabled={pinDraft.length < 4}
                onClick={() => {
                  if (pinEnabled) onDisablePin(pinDraft);
                  else onSetPin(pinDraft);
                  setPinDraft("");
                }}
              >
                {pinEnabled ? "关闭 PIN" : "设置 PIN"}
              </button>
            </div>
            {pinError !== null && <p className="settings-warn">{pinError}</p>}
            <label className="settings-field">
              <span className="field-label">销毁本机数据：输入「删除」确认</span>
              <input
                className="text-input"
                value={destroyConfirm}
                onChange={(event) => setDestroyConfirm(event.target.value)}
                placeholder="删除"
              />
            </label>
            <div className="media-actions">
              <button
                type="button"
                className="btn danger"
                disabled={safetyBusy || destroyConfirm.trim() !== "删除"}
                onClick={() => {
                  onDestroy(destroyConfirm);
                  setDestroyConfirm("");
                }}
              >
                永久删除本机数据
              </button>
            </div>
            {safetyMessage !== null && <p className="settings-message">{safetyMessage}</p>}
          </section>

          <section className="settings-section" aria-labelledby="settings-proactive">
            <header className="settings-section-head">
              <h3 id="settings-proactive">主动消息</h3>
            </header>
            <p className="settings-hint">
              默认关闭。开启后，ta 会在你一段时间没说话时主动发一条；关窗到托盘仍会继续，完全退出后不补发。每次主动消息都会消耗模型 token。
            </p>
            <label className="settings-check">
              <input
                type="checkbox"
                checked={proactiveState.enabled}
                onChange={(event) => onToggleProactive(event.target.checked)}
              />
              <span>允许 ta 主动找我</span>
            </label>

            <label className="settings-field">
              <span className="field-label">主动程度</span>
              <select
                className="text-input"
                value={proactiveState.desireLevel}
                onChange={(event) => onSetProactiveDesire(event.target.value as ProactiveDesire)}
              >
                <option value="low">克制 · 每天最多 2 条</option>
                <option value="medium">日常 · 每天最多 8 条</option>
                <option value="high">黏人 · 每天最多 16 条</option>
                <option value="custom">自定义</option>
              </select>
            </label>
            <p className="settings-hint">
              {proactiveState.desireLevel === "custom"
                ? "自定义：时间和频率都按秒计算；上限填 0 表示不限制。"
                : PROACTIVE_PRESETS[proactiveState.desireLevel]?.description ?? "自定义主动消息参数"}
            </p>

            <div className="media-actions">
              <button type="button" className="btn" disabled={proactiveBusy} onClick={onTestProactive}>
                {proactiveBusy ? "正在想说什么…" : "现在发一条试试"}
              </button>
              <button type="button" className="btn" onClick={() => onPauseProactive(60)}>
                暂停 1 小时
              </button>
              <button type="button" className="btn" onClick={() => onPauseProactive(24 * 60)}>
                暂停 24 小时
              </button>
              <button type="button" className="btn" onClick={() => onPauseProactive(null)}>
                恢复
              </button>
            </div>
            {proactiveState.pausedUntil > Date.now() && (
              <p className="settings-note">已暂停到 {new Date(proactiveState.pausedUntil).toLocaleString()}</p>
            )}

            <details className="persona-review">
              <summary>高级设置（频率按秒）</summary>
              <div className="settings-form proactive-grid">
                <label className="settings-field">
                  <span className="field-label">每日上限（0=不限）</span>
                  <input
                    className="text-input"
                    type="number"
                    min={0}
                    max={200}
                    value={proactiveState.dailyLimit}
                    onChange={(event) =>
                      onUpdateProactive({ dailyLimit: Number(event.target.value), desireLevel: "custom" })
                    }
                  />
                </label>
                <label className="settings-field">
                  <span className="field-label">每周上限（0=不限）</span>
                  <input
                    className="text-input"
                    type="number"
                    min={0}
                    max={2000}
                    value={proactiveState.weeklyLimit}
                    onChange={(event) =>
                      onUpdateProactive({ weeklyLimit: Number(event.target.value), desireLevel: "custom" })
                    }
                  />
                </label>
                <label className="settings-check">
                  <input
                    type="checkbox"
                    checked={proactiveState.dndEnabled}
                    onChange={(event) =>
                      onUpdateProactive({ dndEnabled: event.target.checked, desireLevel: "custom" })
                    }
                  />
                  <span>启用免打扰</span>
                </label>
                <label className="settings-field">
                  <span className="field-label">免打扰开始（0–23）</span>
                  <input
                    className="text-input"
                    type="number"
                    min={0}
                    max={23}
                    value={proactiveState.dndStart}
                    onChange={(event) =>
                      onUpdateProactive({ dndStart: Number(event.target.value), desireLevel: "custom" })
                    }
                  />
                </label>
                <label className="settings-field">
                  <span className="field-label">免打扰结束（0–23）</span>
                  <input
                    className="text-input"
                    type="number"
                    min={0}
                    max={23}
                    value={proactiveState.dndEnd}
                    onChange={(event) =>
                      onUpdateProactive({ dndEnd: Number(event.target.value), desireLevel: "custom" })
                    }
                  />
                </label>
                <label className="settings-field">
                  <span className="field-label">最小空闲（秒）</span>
                  <input
                    className="text-input"
                    type="number"
                    min={1}
                    max={86400}
                    value={proactiveState.minIdleSeconds}
                    onChange={(event) =>
                      onUpdateProactive({ minIdleSeconds: Number(event.target.value), desireLevel: "custom" })
                    }
                  />
                </label>
                <label className="settings-field">
                  <span className="field-label">检查间隔（秒）</span>
                  <input
                    className="text-input"
                    type="number"
                    min={3}
                    max={3600}
                    value={proactiveState.checkIntervalSeconds}
                    onChange={(event) =>
                      onUpdateProactive({ checkIntervalSeconds: Number(event.target.value), desireLevel: "custom" })
                    }
                  />
                </label>
                <label className="settings-field">
                  <span className="field-label">欲望系数（0.1–2）</span>
                  <input
                    className="text-input"
                    type="number"
                    min={0.1}
                    max={2}
                    step={0.1}
                    value={proactiveState.desireFactor}
                    onChange={(event) =>
                      onUpdateProactive({ desireFactor: Number(event.target.value), desireLevel: "custom" })
                    }
                  />
                </label>
                <label className="settings-field">
                  <span className="field-label">触发阈值（0.02–0.95）</span>
                  <input
                    className="text-input"
                    type="number"
                    min={0.02}
                    max={0.95}
                    step={0.01}
                    value={proactiveState.triggerThreshold}
                    onChange={(event) =>
                      onUpdateProactive({ triggerThreshold: Number(event.target.value), desireLevel: "custom" })
                    }
                  />
                </label>
                <label className="settings-field">
                  <span className="field-label">连续未回上限（1–20）</span>
                  <input
                    className="text-input"
                    type="number"
                    min={1}
                    max={20}
                    value={proactiveState.noReplyLimit}
                    onChange={(event) =>
                      onUpdateProactive({ noReplyLimit: Number(event.target.value), desireLevel: "custom" })
                    }
                  />
                </label>
              </div>
            </details>

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
