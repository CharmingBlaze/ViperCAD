import { useEffect, useState } from 'react';
import { subscribeToasts, type ToastMessage } from '@/app/toastBus';

export type { ToastKind, ToastMessage } from '@/app/toastBus';
export { pushToast } from '@/app/toastBus';

export function useToasts(timeoutMs = 4200): ToastMessage[] {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  useEffect(() => {
    const unsubscribe = subscribeToasts((toast) => {
      setToasts((current) => [...current.slice(-4), toast]);
      window.setTimeout(() => {
        setToasts((current) => current.filter((item) => item.id !== toast.id));
      }, timeoutMs);
    });
    return unsubscribe;
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
