// Step 6 · 翻一翻：从人格卡的参考对话里抽几段，给一个「回到过去」的入口
import { useMemo } from "react";
import type { ReactElement } from "react";
import type { PersonaSample } from "@changzai/core";

export interface MemoryModalProps {
  open: boolean;
  samples: PersonaSample[];
  onClose: () => void;
}

export function MemoryModal({ open, samples, onClose }: MemoryModalProps): ReactElement | null {
  const picked = useMemo(() => {
    if (samples.length <= 4) return samples;
    return [...samples].sort(() => Math.random() - 0.5).slice(0, 4);
  }, [samples, open]);
  if (!open) return null;
  return (
    <div className="modal-root" role="presentation" onClick={onClose}>
      <section className="modal-card memory-modal" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
        <header className="modal-head">
          <div>
            <h2>翻一翻</h2>
            <p className="settings-hint">从你们聊过的话里抽几段。看完可以回到现在。</p>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="关闭">
            ×
          </button>
        </header>
        <div className="modal-body">
          {picked.length === 0 && <p className="settings-hint">还没有可以翻的回忆，先导入聊天记录。</p>}
          {picked.map((sample) => (
            <div className="memory-card" key={`${sample.ts}-${sample.her}`}>
              <p className="memory-me">我：{sample.me}</p>
              <p className="memory-her">ta：{sample.her}</p>
            </div>
          ))}
          <div className="modal-actions">
            <button type="button" className="btn primary" onClick={onClose}>
              回到现在
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
