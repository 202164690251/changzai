import type { ReactElement } from "react";
import { SpikePanel } from "../components/SpikePanel.tsx";

export interface DevPanelProps {
  onExit: () => void;
}

/**
 * 开发调试页：只有 hash 为 #/dev 或按 Ctrl+Shift+D 才会挂载，正常启动不出现。
 * 技术自检面板从主界面移到这里，功能保持原样。
 */
export function DevPanel({ onExit }: DevPanelProps): ReactElement {
  return (
    <div className="dev-page" role="region" aria-label="开发调试">
      <header className="dev-header">
        <div>
          <h1>开发调试</h1>
          <p>技术自检与运行环境检查。这个页面只在地址栏 hash 为 #/dev 或按 Ctrl+Shift+D 时出现。</p>
        </div>
        <button type="button" className="btn" onClick={onExit}>
          返回聊天
        </button>
      </header>
      <SpikePanel />
    </div>
  );
}
