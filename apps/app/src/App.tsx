import type { ReactElement } from "react";
import { ChatShell } from "./components/ChatShell.tsx";
import { useDevRoute } from "./hooks/useDevRoute.ts";
import { DevPanel } from "./pages/DevPanel.tsx";

export function App(): ReactElement {
  const { isDev, exitDev } = useDevRoute();

  return (
    <div className="app-root">
      <ChatShell />
      {isDev && <DevPanel onExit={exitDev} />}
    </div>
  );
}
