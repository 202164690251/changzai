import { useState } from "react";
import type { ReactElement } from "react";
import { STYLE_TAGS } from "@changzai/core";

export interface StyleReviewModalProps {
  text: string;
  onSave: (rating: number, tags: string[], correctedText?: string) => void;
  onClose: () => void;
}

export function StyleReviewModal({ text, onSave, onClose }: StyleReviewModalProps): ReactElement {
  const [rating, setRating] = useState(4);
  const [tags, setTags] = useState<string[]>([]);
  const [corrected, setCorrected] = useState("");

  return (
    <div className="modal-root" role="presentation" onClick={onClose}>
      <section className="modal-card style-review-modal" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
        <header className="modal-head">
          <div>
            <h2>这句话像 ta 吗？</h2>
            <p className="settings-hint">只存在本机，用来调整之后的语气；不会发给对方。</p>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="关闭">
            ×
          </button>
        </header>
        <div className="modal-body">
          <blockquote className="style-review-quote">{text}</blockquote>
          <div className="style-rating">
            {[1, 2, 3, 4, 5].map((value) => (
              <button
                key={value}
                type="button"
                className={`btn ${rating === value ? "primary" : ""}`}
                onClick={() => setRating(value)}
              >
                {value === 1 ? "完全不像" : value === 3 ? "一般" : value === 5 ? "很像" : value}
              </button>
            ))}
          </div>
          <div className="style-tags">
            {STYLE_TAGS.map((tag) => (
              <label key={tag} className="settings-check">
                <input
                  type="checkbox"
                  checked={tags.includes(tag)}
                  onChange={(event) =>
                    setTags(event.target.checked ? [...tags, tag] : tags.filter((item) => item !== tag))
                  }
                />
                <span>{tag}</span>
              </label>
            ))}
          </div>
          <label className="settings-field">
            <span className="field-label">更希望 ta 这样说（可选）</span>
            <textarea
              className="text-input"
              rows={3}
              value={corrected}
              placeholder="不填也可以；填了会作为下一轮参考"
              onChange={(event) => setCorrected(event.target.value)}
            />
          </label>
          <div className="modal-actions">
            <button
              type="button"
              className="btn primary"
              onClick={() => {
                onSave(rating, tags, corrected);
                onClose();
              }}
            >
              保存反馈
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
