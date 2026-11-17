import type { ReactElement } from "react";
import { ChatPreview } from "./components/ChatPreview.tsx";
import { SpikePanel } from "./components/SpikePanel.tsx";

export function App(): ReactElement {
  return (
    <div className="app">
      <header className="app-bar">
        <div className="brand">
          <span className="brand-mark">常</span>
          <div>
            <strong>常在</strong>
            <span className="muted small">Still Here · Windows PC 单端</span>
          </div>
        </div>
        <span className="pill">Step 1 · 技术底座</span>
      </header>

      <main className="layout">
        <SpikePanel />
        <ChatPreview />
      </main>
    </div>
  );
}
