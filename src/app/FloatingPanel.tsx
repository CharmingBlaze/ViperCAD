import { useEffect, useRef, useState, type ReactNode } from 'react';
import { BlenderIcon } from '@/components/BlenderIcon';

type Props = {
  title: string;
  children: ReactNode;
  storageKey?: string;
  defaultPosition?: { x: number; y: number };
  defaultSize?: { width: number };
  defaultMinimized?: boolean;
  className?: string;
  onClose?: () => void;
};

type DragState = { pointerId: number; offsetX: number; offsetY: number };

let floatingPanelZ = 50;

function readStoredPosition(storageKey: string | undefined, fallback: { x: number; y: number }) {
  if (!storageKey) return fallback;
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as { x?: number; y?: number };
    if (typeof parsed.x === 'number' && typeof parsed.y === 'number') return { x: parsed.x, y: parsed.y };
  } catch {
    // ignore
  }
  return fallback;
}

function clampPosition(next: { x: number; y: number }, width: number, height: number) {
  return {
    x: Math.max(0, Math.min(Math.max(0, window.innerWidth - width), next.x)),
    y: Math.max(40, Math.min(Math.max(40, window.innerHeight - height), next.y)),
  };
}

export function FloatingPanel({
  title,
  children,
  storageKey,
  defaultPosition = { x: 12, y: 52 },
  defaultSize = { width: 260 },
  defaultMinimized = false,
  className = '',
  onClose,
}: Props) {
  const [minimized, setMinimized] = useState(defaultMinimized);
  const [zIndex, setZIndex] = useState(50);
  const [position, setPosition] = useState(() => readStoredPosition(storageKey, defaultPosition));
  const drag = useRef<DragState | null>(null);
  const panel = useRef<HTMLElement>(null);

  useEffect(() => {
    const persist = () => {
      const node = panel.current;
      if (!storageKey || !node) return;
      try {
        localStorage.setItem(storageKey, JSON.stringify({ x: node.offsetLeft, y: node.offsetTop }));
      } catch {
        // ignore
      }
    };
    const move = (event: PointerEvent) => {
      const current = drag.current;
      if (!current || current.pointerId !== event.pointerId) return;
      const width = panel.current?.offsetWidth ?? defaultSize.width;
      const height = panel.current?.offsetHeight ?? 42;
      setPosition(clampPosition({
        x: event.clientX - current.offsetX,
        y: event.clientY - current.offsetY,
      }, width, height));
    };
    const end = (event: PointerEvent) => {
      if (drag.current?.pointerId !== event.pointerId) return;
      drag.current = null;
      persist();
    };
    const onResize = () => {
      const node = panel.current;
      if (!node) return;
      setPosition((current) => clampPosition(current, node.offsetWidth, node.offsetHeight));
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
    window.addEventListener('resize', onResize);
    onResize();
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
      window.removeEventListener('resize', onResize);
    };
  }, [defaultSize.width, storageKey]);

  return (
    <aside
      ref={panel}
      className={`floating-panel${minimized ? ' is-minimized' : ''} ${className}`.trim()}
      style={{ left: position.x, top: position.y, width: minimized ? undefined : defaultSize.width, zIndex }}
      onPointerDown={() => {
        floatingPanelZ += 1;
        setZIndex(floatingPanelZ);
      }}
    >
      <header
        className="floating-panel-header"
        onPointerDown={(event) => {
          if ((event.target as HTMLElement).closest('button')) return;
          event.preventDefault();
          const rect = panel.current?.getBoundingClientRect();
          drag.current = {
            pointerId: event.pointerId,
            offsetX: event.clientX - (rect?.left ?? position.x),
            offsetY: event.clientY - (rect?.top ?? position.y),
          };
          panel.current?.setPointerCapture(event.pointerId);
        }}
      >
        <strong>{title}</strong>
        <div className="floating-panel-actions">
          <button
            type="button"
            className="floating-panel-icon"
            aria-label={minimized ? 'Restore panel' : 'Minimize panel'}
            title={minimized ? 'Restore' : 'Minimize'}
            onClick={() => setMinimized((value) => !value)}
          >
            <BlenderIcon name={minimized ? 'tria_up' : 'tria_down'} size={12} />
          </button>
          {onClose && (
            <button
              type="button"
              className="floating-panel-icon is-close"
              aria-label="Close panel"
              title="Close"
              onClick={onClose}
            >
              <BlenderIcon name="panel_close" size={12} />
            </button>
          )}
        </div>
      </header>
      {!minimized && <div className="floating-panel-body">{children}</div>}
    </aside>
  );
}
