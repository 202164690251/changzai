// Step 6 · 锁屏（PIN 只是 UI 锁；数据本身已由 SQLCipher 加密）
import { useState } from "react";
import type { ReactElement } from "react";

export interface LockScreenProps {
  open: boolean;
  error: string | null;
  onUnlock: (pin: string) => Promise<boolean>;
  onForgot: () => void;
}

export function LockScreen({ open, error, onUnlock, onForgot }: LockScreenProps): ReactElement | null {
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  if (!open) return null;
  return (
    <div className="lock-root" role="dialog" aria-modal="true" aria-label="解锁如晤">
      <div className="lock-card">
        <img className="lock-brand-mark" src="/brand/brand-mark.png" alt="" />
        <h1>如晤</h1>
        <p>输入 PIN 继续。数据只在这台电脑上。</p>
        <input
          className="text-input"
          type="password"
          inputMode="numeric"
          maxLength={8}
          value={pin}
          autoFocus
          onChange={(event) => setPin(event.target.value.replace(/\D/g, ""))}
          onKeyDown={(event) => {
            if (event.key !== "Enter" || busy) return;
            setBusy(true);
            void onUnlock(pin).finally(() => setBusy(false));
          }}
          placeholder="4–8 位数字"
        />
        {error !== null && <p className="settings-warn">{error}</p>}
        <button
          type="button"
          className="btn primary"
          disabled={busy || pin.length < 4}
          onClick={() => {
            setBusy(true);
            void onUnlock(pin).finally(() => setBusy(false));
          }}
        >
          {busy ? "校验中…" : "解锁"}
        </button>
        <button type="button" className="link-btn" onClick={onForgot}>
          忘记 PIN / 删除本机数据
        </button>
      </div>
    </div>
  );
}
