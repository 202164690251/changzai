// 「ta 现在的状态」：用户可手动覆盖，不常驻聊天区
import { useEffect, useState } from "react";
import type { ReactElement } from "react";
import { MOOD_PRESETS, moodPresetState, type EmotionState } from "@veyrimi/core";

export interface MoodPanelProps {
  open: boolean;
  current: EmotionState;
  note: string;
  onSave: (state: EmotionState, note: string, until: number | null) => void;
  onClear: () => void;
  onClose: () => void;
}

const DURATIONS: Array<{ label: string; minutes: number | null }> = [
  { label: "1 小时", minutes: 60 },
  { label: "今天", minutes: 24 * 60 },
  { label: "直到我改回", minutes: null },
];

export function MoodPanel({ open, current, note, onSave, onClear, onClose }: MoodPanelProps): ReactElement | null {
  const [draft, setDraft] = useState<EmotionState>(current);
  const [text, setText] = useState(note);
  const [duration, setDuration] = useState<number | null>(null);

  useEffect(() => {
    if (!open) return;
    setDraft(current);
    setText(note);
  }, [current, note, open]);

  if (!open) return null;

  const save = (): void => {
    const until = duration === null ? null : Date.now() + duration * 60_000;
    onSave(draft, text.trim(), until);
    onClose();
  };

  return (
    <div className="modal-root" role="presentation" onClick={onClose}>
      <section className="modal-card mood-modal" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
        <header className="modal-head">
          <div>
            <h2>ta 现在的状态</h2>
            <p className="settings-hint">只影响接下来一段时间的回复；到期或点“恢复自动”会回到自动情绪。</p>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="关闭">
            ×
          </button>
        </header>
        <div className="modal-body">
          <div className="mood-presets">
            {MOOD_PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                className="btn"
                title={preset.description}
                onClick={() => {
                  setDraft(moodPresetState(preset));
                  setText(preset.label);
                }}
              >
                {preset.label}
              </button>
            ))}
          </div>

          <div className="settings-form proactive-grid">
            <label className="settings-field">
              <span className="field-label">心情 -5 ~ 5</span>
              <input
                type="range"
                min={-5}
                max={5}
                step={1}
                value={Math.round(draft.valence * 5)}
                onChange={(event) =>
                  setDraft({ ...draft, valence: Number(event.target.value) / 5 })
                }
              />
            </label>
            <label className="settings-field">
              <span className="field-label">精力 0 ~ 10</span>
              <input
                type="range"
                min={0}
                max={10}
                value={Math.round(draft.arousal * 10)}
                onChange={(event) => setDraft({ ...draft, arousal: Number(event.target.value) / 10 })}
              />
            </label>
            <label className="settings-field">
              <span className="field-label">亲近 0 ~ 10</span>
              <input
                type="range"
                min={0}
                max={10}
                value={Math.round(draft.closeness * 10)}
                onChange={(event) => setDraft({ ...draft, closeness: Number(event.target.value) / 10 })}
              />
            </label>
            <label className="settings-field">
              <span className="field-label">防备 0 ~ 10</span>
              <input
                type="range"
                min={0}
                max={10}
                value={Math.round(draft.defensiveness * 10)}
                onChange={(event) => setDraft({ ...draft, defensiveness: Number(event.target.value) / 10 })}
              />
            </label>
          </div>

          <label className="settings-field">
            <span className="field-label">一句状态备注（会进入 prompt）</span>
            <input
              className="text-input"
              value={text}
              maxLength={80}
              placeholder="例如：今天加班很累，不想多说话"
              onChange={(event) => setText(event.target.value)}
            />
          </label>

          <label className="settings-field">
            <span className="field-label">持续多久</span>
            <select
              className="text-input"
              value={duration === null ? "forever" : String(duration)}
              onChange={(event) =>
                setDuration(event.target.value === "forever" ? null : Number(event.target.value))
              }
            >
              <option value="forever">直到我改回</option>
              {DURATIONS.filter((item) => item.minutes !== null).map((item) => (
                <option key={item.label} value={String(item.minutes)}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>

          <div className="modal-actions">
            <button type="button" className="btn primary" onClick={save}>
              应用状态
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => {
                onClear();
                onClose();
              }}
            >
              恢复自动
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
