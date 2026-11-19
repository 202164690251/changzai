import { useState, type ReactElement } from "react";
import { ChatShell } from "./components/ChatShell.tsx";
import { SplashScreen } from "./components/SplashScreen.tsx";
import { useDevRoute } from "./hooks/useDevRoute.ts";
import { DevPanel } from "./pages/DevPanel.tsx";

export function App(): ReactElement {
  const { isDev, exitDev } = useDevRoute();
  const [splashVisible, setSplashVisible] = useState(true);

  return (
    <>
      {splashVisible && <SplashScreen onDone={() => setSplashVisible(false)} />}
      <div className="app-root">
        <ChatShell />
        {isDev && <DevPanel onExit={exitDev} />}
      </div>
    </>
  );
}
