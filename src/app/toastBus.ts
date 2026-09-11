/** React-free toast bus so core code can notify without importing UI modules. */

export type ToastKind = 'info' | 'success' | 'error' | 'warning';

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

export function subscribeToasts(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
