import type { ReactElement } from "react";
import { designTokens } from "@changzai/shared";

interface Msg {
  id: string;
  from: "her" | "me" | "system";
  text: string;
  time?: string;
  typing?: boolean;
}

const MESSAGES: Msg[] = [
  { id: "m1", from: "system", text: "2023年5月20日 14:03" },
  { id: "m2", from: "me", text: "在干嘛" },
  { id: "m3", from: "her", text: "刚洗完澡" },
  { id: "m4", from: "her", text: "你呢" },
  { id: "m5", from: "me", text: "没事 就是有点想你了" },
  { id: "m6", from: "her", text: "嗯", typing: false },
  { id: "m7", from: "her", text: "早点睡吧" },
];

export function ChatPreview(): ReactElement {
  const herAvatar = designTokens.color.light.bubbleHer;
  return (
    <section className="chat-shell" aria-label="聊天界面预览">
      <header className="chat-nav">
        <div className="avatar" style={{ background: herAvatar }} aria-hidden />
        <div className="chat-title">
          <strong>小林</strong>
          <span className="muted small">正在输入…</span>
        </div>
        <button className="icon-btn" aria-label="更多">
          ⋯
        </button>
      </header>

      <div className="chat-list">
        {MESSAGES.map((m) =>
          m.from === "system" ? (
            <div className="time-divider" key={m.id}>
              {m.text}
            </div>
          ) : (
            <div className={`row ${m.from}`} key={m.id}>
              {m.from === "her" && <div className="bubble-avatar" aria-hidden />}
              <div className={`bubble ${m.from}`}>
                {m.text}
                {m.from === "her" && (
                  <span className="ai-badge" title="AI 生成内容" aria-label="AI 生成内容">
                    AI
                  </span>
                )}
              </div>
            </div>
          ),
        )}
        <div className="row her">
          <div className="bubble-avatar" aria-hidden />
          <div className="typing" aria-label="对方正在输入">
            <i />
            <i />
            <i />
          </div>
        </div>
      </div>

      <footer className="composer">
        <button className="icon-btn" aria-label="表情">
          ☺
        </button>
        <div className="composer-input">说点什么…</div>
        <button className="icon-btn" aria-label="发送">
          ↑
        </button>
      </footer>
      <div className="chat-caption muted small">
        界面为 Step 1 静态预览：Step 6 接入真实消息流、分段到达、已读与撤回动画。
      </div>
    </section>
  );
}
