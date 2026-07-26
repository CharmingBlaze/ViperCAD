import { useEffect, useState } from 'react';

export type ToastKind = 'info' | 'success' | 'error';

export type ToastMessage = {
  id: number;
  kind: ToastKind;
  text: string;
};

type Listener = (toast: ToastMessage) => void;

let nextId = 1;
const listeners = new Set<Listener>();

/** Push a short-lived status toast (errors, copy confirmations, etc.). */
export function pushToast(text: string, kind: ToastKind = 'info'): void {
  const toast: ToastMessage = { id: nextId++, kind, text };
  for (const listener of listeners) listener(toast);
}

export function useToasts(timeoutMs = 4200): ToastMessage[] {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  useEffect(() => {
    const onToast = (toast: ToastMessage) => {
      setToasts((current) => [...current.slice(-4), toast]);
      window.setTimeout(() => {
        setToasts((current) => current.filter((item) => item.id !== toast.id));
      }, timeoutMs);
    };
    listeners.add(onToast);
    return () => {
      listeners.delete(onToast);
    };
  }, [timeoutMs]);

  return toasts;
}

export function ToastStack({ toasts }: { toasts: ToastMessage[] }) {
  if (!toasts.length) return null;
  return (
    <div className="toast-stack" aria-live="polite">
      {toasts.map((toast) => (
        <div key={toast.id} className={`toast toast-${toast.kind}`}>
          {toast.text}
        </div>
      ))}
    </div>
  );
}
