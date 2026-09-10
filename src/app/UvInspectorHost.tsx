import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

type HostApi = {
  host: HTMLElement | null;
  setHost: (node: HTMLElement | null) => void;
};

const UvInspectorHostContext = createContext<HostApi>({
  host: null,
  setHost: () => undefined,
});

export function UvInspectorHostProvider({ children }: { children: ReactNode }) {
  const [host, setHost] = useState<HTMLElement | null>(null);
  const value = useMemo(() => ({ host, setHost }), [host]);
  return <UvInspectorHostContext.Provider value={value}>{children}</UvInspectorHostContext.Provider>;
}

export function UvInspectorHost({ className }: { className?: string }) {
  const { setHost } = useContext(UvInspectorHostContext);
  return <div className={className} ref={setHost} />;
}

export function UvInspectorPortal({ children }: { children: ReactNode }) {
  const { host } = useContext(UvInspectorHostContext);
  if (!host) return null;
  return createPortal(children, host);
}
