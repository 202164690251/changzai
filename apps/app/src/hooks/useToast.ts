import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export interface ToastState {
  id: number;
  text: string;
}

export interface ToastApi {
  toast: ToastState | null;
  show: (text: string) => void;
}

/** 轻提示：界面里未接入的动作给一句人话反馈，不弹窗、不阻塞。 */
export function useToast(): ToastApi {
  const [toast, setToast] = useState<ToastState | null>(null);
  const timer = useRef<number | null>(null);

  const show = useCallback((text: string) => {
    const value = text.trim();
    if (value.length === 0) return;
    if (timer.current !== null) window.clearTimeout(timer.current);
    setToast({ id: Date.now(), text: value });
    timer.current = window.setTimeout(() => {
      timer.current = null;
      setToast(null);
    }, 2400);
  }, []);

  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );

  return useMemo(() => ({ toast, show }), [toast, show]);
}
