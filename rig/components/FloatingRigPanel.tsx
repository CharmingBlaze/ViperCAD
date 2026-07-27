import { useEffect, useRef, useState, type ReactNode } from 'react';

type Props = {
  title: string;
  children: ReactNode;
  defaultPosition?: { x: number; y: number };
  defaultSize?: { width: number; height: number };
  className?: string;
  onClose?: () => void;
  minimized?: boolean;
  onMinimizedChange?: (value: boolean) => void;
};

type DragState = { pointerId: number; offsetX: number; offsetY: number };

export function FloatingRigPanel({
  title,
  children,
  defaultPosition = { x: 12, y: 52 },
  defaultSize = { width: 320, height: 280 },
  className = '',
  onClose,
  minimized: minimizedProp,
  onMinimizedChange,
}: Props) {
  const [internalMinimized, setInternalMinimized] = useState(false);
  const minimized = minimizedProp ?? internalMinimized;
  const setMinimized = (value: boolean) => {
    if (minimizedProp === undefined) setInternalMinimized(value);
    onMinimizedChange?.(value);
  };

  const [position, setPosition] = useState(defaultPosition);
  const drag = useRef<DragState | null>(null);
  const panel = useRef<HTMLElement>(null);

  useEffect(() => {
    const move = (event: PointerEvent) => {
      const current = drag.current;
      if (!current || current.pointerId !== event.pointerId) return;
      const width = panel.current?.offsetWidth ?? defaultSize.width;
      const height = panel.current?.offsetHeight ?? 42;
      setPosition({
        x: Math.max(0, Math.min(window.innerWidth - width, event.clientX - current.offsetX)),
        y: Math.max(36, Math.min(window.innerHeight - height, event.clientY - current.offsetY)),
      });
    };
    const end = (event: PointerEvent) => {
      if (drag.current?.pointerId === event.pointerId) drag.current = null;
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
    };
  }, [defaultSize.width]);

  return (
    <aside
      ref={panel}
      className={`floating-outliner${minimized ? ' is-minimized' : ''} ${className}`.trim()}
      style={{ left: position.x, top: position.y, width: minimized ? undefined : defaultSize.width }}
    >
      <header
        className="outliner-header"
        onPointerDown={(event) => {
          if ((event.target as HTMLElement).closest('button')) return;
          drag.current = {
            pointerId: event.pointerId,
            offsetX: event.clientX - position.x,
            offsetY: event.clientY - position.y,
          };
        }}
      >
        <div className="outliner-title">{title}</div>
        <div className="outliner-actions">
          <button
            type="button"
            className="outliner-icon"
            aria-label={minimized ? 'Restore panel' : 'Minimize panel'}
            title={minimized ? 'Restore' : 'Minimize'}
            onClick={() => setMinimized(!minimized)}
          >
            {minimized ? '□' : '–'}
          </button>
          {onClose && (
            <button
              type="button"
              className="outliner-icon danger"
              aria-label="Close panel"
              title="Close"
              onClick={onClose}
            >
              ×
            </button>
          )}
        </div>
      </header>
      {!minimized && children}
    </aside>
  );
}
