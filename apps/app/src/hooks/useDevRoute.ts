import { useCallback, useEffect, useState } from "react";

const DEV_HASH = "#/dev";

function isDevHash(hash: string): boolean {
  return hash.trim().toLowerCase().startsWith(DEV_HASH);
}

export interface DevRoute {
  isDev: boolean;
  exitDev: () => void;
  toggleDev: () => void;
}

/**
 * 开发调试页开关：
 * - URL hash 为 #/dev 时显示
 * - Ctrl+Shift+D 在聊天页与调试页之间切换
 * 正常启动（无 hash）永远不显示。
 */
export function useDevRoute(): DevRoute {
  const [isDev, setIsDev] = useState<boolean>(
    () => typeof window !== "undefined" && isDevHash(window.location.hash),
  );

  const exitDev = useCallback(() => {
    if (typeof window !== "undefined") {
      const { pathname, search } = window.location;
      try {
        window.history.replaceState(null, "", `${pathname}${search}`);
      } catch {
        window.location.hash = "";
      }
    }
    setIsDev(false);
  }, []);

  const toggleDev = useCallback(() => {
    if (typeof window === "undefined") return;
    if (isDevHash(window.location.hash)) {
      exitDev();
      return;
    }
    window.location.hash = DEV_HASH;
  }, [exitDev]);

  useEffect(() => {
    const handleHashChange = (): void => setIsDev(isDevHash(window.location.hash));
    window.addEventListener("hashchange", handleHashChange);
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (!event.ctrlKey || !event.shiftKey || event.altKey) return;
      if (event.key !== "D" && event.key !== "d") return;
      event.preventDefault();
      toggleDev();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [toggleDev]);

  return { isDev, exitDev, toggleDev };
}
