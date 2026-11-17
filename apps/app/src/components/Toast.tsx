import type { ReactElement } from "react";

export interface ToastProps {
  text: string | null;
}

export function Toast({ text }: ToastProps): ReactElement | null {
  if (text === null) return null;
  return (
    <div className="toast" role="status" aria-live="polite">
      {text}
    </div>
  );
}
