// v2.0 · 初始聊天界面的三选一创建入口
import { useMemo, useState } from "react";
import type { ReactElement } from "react";
import {
  PERSONA_PRESETS,
  PRESET_DISCLAIMER,
  buildCustomPersona,
  buildPresetPersona,
  type CustomPersonaForm,
  type PersonaPreset,
} from "@changzai/core";

export interface PersonaStartProps {
  open: boolean;
  busy: boolean;
  onImport: () => void;
  onCreatePreset: (preset: PersonaPreset) => Promise<void>;
  onCreateCustom: (form: CustomPersonaForm) => Promise<void>;
  onSkip: () => void;
}

type Mode = "home" | "presets" | "preview" | "custom" | "customPreview";

const EMPTY_FORM: CustomPersonaForm = {
  name: "ta",
  identity: "",
  relation: "朋友",
  tone: "gentle",
  sentenceLength: "short",
  initiative: 0.35,
  emojiLevel: 0.08,
  catchphrases: [],
  likes: [],
  dislikes: [],
  boundaries: [],
  advancedPrompt: "",
};

function formFromPreset(preset: PersonaPreset): CustomPersonaForm {
  const toneMap: Record<string, CustomPersonaForm["tone"]> = {
    gentle: "gentle",
    clingy: "playful",
    calm: "calm",
    tsundere: "sarcastic",
    older: "gentle",
    younger: "playful",
    sarcastic: "sarcastic",
    quiet: "quiet",
  };
  return {
    ...EMPTY_FORM,
    identity: preset.summary,
    relation: preset.defaultRelationship,
    tone: toneMap[preset.id] ?? "gentle",
    sentenceLength: preset.style.avg_len <= 6 ? "short" : preset.style.avg_len >= 14 ? "long" : "medium",
    initiative: Math.min(1, preset.style.question_ratio * 2),
    emojiLevel: preset.style.emoji_ratio,
    catchphrases: preset.style.phrases.map((item) => item.text),
    likes: preset.facts.filter((fact) => fact.kind === "偏好").map((fact) => fact.text),
    dislikes: [],
    boundaries: preset.boundaries.filter((rule) => !rule.startsWith("你是 AI")),
    advancedPrompt: "",
  };
}

function lines(value: string): string[] {
  return value
    .split("\n")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function PersonaStart({
  open,
  busy,
  onImport,
  onCreatePreset,
  onCreateCustom,
  onSkip,
}: PersonaStartProps): ReactElement | null {
  const [mode, setMode] = useState<Mode>("home");
  const [selected, setSelected] = useState<PersonaPreset | null>(null);
  const [form, setForm] = useState<CustomPersonaForm>(EMPTY_FORM);
  const [draft, setDraft] = useState<CustomPersonaForm>(EMPTY_FORM);

  const previewProfile = useMemo(() => {
    if (!selected) return null;
    return buildPresetPersona(selected);
  }, [selected]);

  const customProfile = useMemo(() => buildCustomPersona(draft), [draft]);

  if (!open) return null;

  const applyPreset = async (): Promise<void> => {
    if (!selected) return;
    await onCreatePreset(selected);
  };

  const applyCustom = async (): Promise<void> => {
    await onCreateCustom(form);
  };

  return (
    <div className="persona-start-root" role="dialog" aria-modal="true" aria-label="创建人格">
      <section className="persona-start-card">
        <header className="persona-start-head">
          <div>
            <strong>常在 Still Here</strong>
            <span>{mode === "home" ? "先决定怎么认识 ta" : mode === "custom" || mode === "customPreview" ? "自己写一个" : "选一个性格"}</span>
          </div>
          <button type="button" className="link-btn" onClick={onSkip}>
            稍后再说
          </button>
        </header>

        {mode === "home" && (
          <div className="persona-start-body">
            <h1>你想怎么认识 ta？</h1>
            <p className="settings-hint">三种方式最终都会生成同一份人格卡；之后都能继续修改。</p>
            <div className="persona-choice-grid">
              <button type="button" className="persona-choice" onClick={onImport}>
                <b>从聊天记录创建</b>
                <span>导入微信/QQ/网页导出，最像记忆里的那个人。</span>
              </button>
              <button type="button" className="persona-choice" onClick={() => setMode("presets")}>
                <b>选一个性格开始</b>
                <span>没有聊天记录也能 30 秒开始；8 个风格模板。</span>
              </button>
              <button
                type="button"
                className="persona-choice"
                onClick={() => {
                  setForm(EMPTY_FORM);
                  setMode("custom");
                }}
              >
                <b>自己写一个</b>
                <span>用结构化表单描述 ta 的身份、语气和边界。</span>
              </button>
            </div>
            <p className="settings-hint">{PRESET_DISCLAIMER}</p>
          </div>
        )}

        {mode === "presets" && (
          <div className="persona-start-body">
            <div className="persona-start-title-row">
              <h2>选一个大致的感觉</h2>
              <button type="button" className="link-btn" onClick={() => setMode("home")}>
                返回
              </button>
            </div>
            <div className="persona-preset-grid">
              {PERSONA_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  className={`persona-preset ${selected?.id === preset.id ? "selected" : ""}`}
                  onClick={() => {
                    setSelected(preset);
                    setMode("preview");
                  }}
                >
                  <b>{preset.label}</b>
                  <span>{preset.tagline}</span>
                </button>
              ))}
            </div>
            <p className="settings-hint">{PRESET_DISCLAIMER}</p>
          </div>
        )}

        {mode === "preview" && selected && previewProfile && (
          <div className="persona-start-body">
            <div className="persona-start-title-row">
              <h2>{selected.label}</h2>
              <button type="button" className="link-btn" onClick={() => setMode("presets")}>
                换一个
              </button>
            </div>
            <p className="settings-hint">{selected.tagline}</p>
            <div className="persona-preview">
              {selected.samples.slice(0, 3).map((sample, index) => (
                <div className="persona-preview-row" key={`${selected.id}-${index}`}>
                  <span className="persona-preview-me">我：{sample.me}</span>
                  <span className="persona-preview-her">ta：{sample.her}</span>
                </div>
              ))}
            </div>
            <div className="modal-actions">
              <button type="button" className="btn" onClick={() => setMode("custom")}>
                继续微调
              </button>
              <button type="button" className="btn primary" disabled={busy} onClick={() => void applyPreset()}>
                {busy ? "创建中…" : "就用这个"}
              </button>
            </div>
          </div>
        )}

        {mode === "custom" && (
          <div className="persona-start-body">
            <div className="persona-start-title-row">
              <h2>自己写一个</h2>
              <button type="button" className="link-btn" onClick={() => setMode("home")}>
                返回
              </button>
            </div>
            <div className="settings-form">
              <label className="settings-field">
                <span className="field-label">ta 是什么样的</span>
                <textarea
                  className="text-input"
                  rows={2}
                  placeholder="例如：一个说话慢、喜欢看书、不太主动但很认真的人"
                  value={form.identity}
                  onChange={(event) => setForm({ ...form, identity: event.target.value })}
                />
              </label>
              <div className="proactive-grid">
                <label className="settings-field">
                  <span className="field-label">和你的关系</span>
                  <select
                    className="text-input"
                    value={form.relation}
                    onChange={(event) => setForm({ ...form, relation: event.target.value as CustomPersonaForm["relation"] })}
                  >
                    {["情侣", "前任", "暗恋", "朋友", "亲人", "同事", "其他"].map((relation) => (
                      <option key={relation} value={relation}>
                        {relation}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="settings-field">
                  <span className="field-label">语气</span>
                  <select
                    className="text-input"
                    value={form.tone}
                    onChange={(event) => setForm({ ...form, tone: event.target.value as CustomPersonaForm["tone"] })}
                  >
                    <option value="gentle">温柔</option>
                    <option value="playful">活泼</option>
                    <option value="calm">冷静</option>
                    <option value="sarcastic">毒舌</option>
                    <option value="quiet">安静</option>
                  </select>
                </label>
                <label className="settings-field">
                  <span className="field-label">句子长度</span>
                  <select
                    className="text-input"
                    value={form.sentenceLength}
                    onChange={(event) =>
                      setForm({ ...form, sentenceLength: event.target.value as CustomPersonaForm["sentenceLength"] })
                    }
                  >
                    <option value="short">短句</option>
                    <option value="medium">适中</option>
                    <option value="long">长一点</option>
                  </select>
                </label>
                <label className="settings-field">
                  <span className="field-label">主动程度 {Math.round(form.initiative * 100)}%</span>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={form.initiative}
                    onChange={(event) => setForm({ ...form, initiative: Number(event.target.value) })}
                  />
                </label>
                <label className="settings-field">
                  <span className="field-label">表情/语气词 {Math.round(form.emojiLevel * 100)}%</span>
                  <input
                    type="range"
                    min={0}
                    max={0.5}
                    step={0.02}
                    value={form.emojiLevel}
                    onChange={(event) => setForm({ ...form, emojiLevel: Number(event.target.value) })}
                  />
                </label>
              </div>
              <label className="settings-field">
                <span className="field-label">口头禅（每行一条）</span>
                <textarea
                  className="text-input"
                  rows={2}
                  placeholder="例如：慢慢来"
                  value={form.catchphrases.join("\n")}
                  onChange={(event) => setForm({ ...form, catchphrases: lines(event.target.value) })}
                />
              </label>
              <div className="proactive-grid">
                <label className="settings-field">
                  <span className="field-label">喜欢（每行一条）</span>
                  <textarea
                    className="text-input"
                    rows={2}
                    value={form.likes.join("\n")}
                    onChange={(event) => setForm({ ...form, likes: lines(event.target.value) })}
                  />
                </label>
                <label className="settings-field">
                  <span className="field-label">不喜欢（每行一条）</span>
                  <textarea
                    className="text-input"
                    rows={2}
                    value={form.dislikes.join("\n")}
                    onChange={(event) => setForm({ ...form, dislikes: lines(event.target.value) })}
                  />
                </label>
              </div>
              <label className="settings-field">
                <span className="field-label">边界 / 不要提的事（每行一条）</span>
                <textarea
                  className="text-input"
                  rows={2}
                  value={form.boundaries.join("\n")}
                  onChange={(event) => setForm({ ...form, boundaries: lines(event.target.value) })}
                />
              </label>
              <label className="settings-field">
                <span className="field-label">高级自定义 prompt（可选，不覆盖安全规则）</span>
                <textarea
                  className="text-input"
                  rows={2}
                  value={form.advancedPrompt}
                  onChange={(event) => setForm({ ...form, advancedPrompt: event.target.value })}
                />
              </label>
            </div>
            <div className="modal-actions">
              <button
                type="button"
                className="btn primary"
                onClick={() => {
                  setDraft(form);
                  setMode("customPreview");
                }}
              >
                预览 3 句
              </button>
            </div>
          </div>
        )}

        {mode === "customPreview" && (
          <div className="persona-start-body">
            <div className="persona-start-title-row">
              <h2>预览</h2>
              <button type="button" className="link-btn" onClick={() => setMode("custom")}>
                返回修改
              </button>
            </div>
            <p className="settings-hint">{customProfile.summary}</p>
            <div className="persona-preview">
              {customProfile.samples.slice(0, 3).map((sample, index) => (
                <div className="persona-preview-row" key={`custom-${index}`}>
                  <span className="persona-preview-me">我：{sample.me}</span>
                  <span className="persona-preview-her">ta：{sample.her}</span>
                </div>
              ))}
            </div>
            <div className="modal-actions">
              <button type="button" className="btn" onClick={() => setMode("custom")}>
                继续微调
              </button>
              <button type="button" className="btn primary" disabled={busy} onClick={() => void applyCustom()}>
                {busy ? "创建中…" : "用这个开始"}
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
