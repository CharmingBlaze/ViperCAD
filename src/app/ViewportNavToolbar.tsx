import { useRef } from 'react';
import type { ViewId } from '@/workspace/types';
import type { ViewportNavMode } from '@/workspace/WorkspaceController';

type DragMode = 'pan' | 'orbit' | 'zoom';

type Props = {
  viewId: ViewId;
  right: number;
  top: number;
  isPerspective: boolean;
  isMaximized: boolean;
  navMode: ViewportNavMode;
  navViewId: ViewId | null;
  onSetNav: (mode: ViewportNavMode, viewId: ViewId) => void;
  onFrame: (viewId: ViewId) => void;
  onMaximize: (viewId: ViewId) => void;
  onDrag: (mode: DragMode, deltaX: number, deltaY: number, viewId: ViewId) => void;
};

/** Inset from a pane's right edge; left-column panes need extra clearance at the split. */
export function viewportNavToolbarRightInset(
  viewId: ViewId,
  layoutMode: 'quad' | 'maximized',
  sharesRightEdge = false,
): number {
  if (layoutMode === 'maximized') return 8;
  if (sharesRightEdge || viewId === 'top' || viewId === 'front') return 10;
  return 8;
}

export function ViewportNavToolbar({
  viewId,
  right,
  top,
  isPerspective,
  isMaximized,
  navMode,
  navViewId,
  onSetNav,
  onFrame,
  onMaximize,
  onDrag,
}: Props) {
  const dragRef = useRef<{
    mode: DragMode;
    lastX: number;
    lastY: number;
    moved: boolean;
    wasActive: boolean;
  } | null>(null);

  const isActive = (mode: DragMode) => navMode === mode && navViewId === viewId;

  const beginDrag = (mode: DragMode, event: React.PointerEvent<HTMLButtonElement>) => {
    if (mode === 'orbit' && !isPerspective) return;
    event.preventDefault();
    event.stopPropagation();
    const wasActive = isActive(mode);
    onSetNav(mode, viewId);
    dragRef.current = {
      mode,
      lastX: event.clientX,
      lastY: event.clientY,
      moved: false,
      wasActive,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const updateDrag = (event: React.PointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    event.preventDefault();
    event.stopPropagation();
    const deltaX = event.clientX - drag.lastX;
    const deltaY = event.clientY - drag.lastY;
    drag.lastX = event.clientX;
    drag.lastY = event.clientY;
    if (Math.hypot(deltaX, deltaY) > 2) drag.moved = true;
    if (drag.moved) onDrag(drag.mode, deltaX, deltaY, viewId);
  };

  const endDrag = (event: React.PointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    event.preventDefault();
    event.stopPropagation();
    dragRef.current = null;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    if (!drag.moved && drag.wasActive) onSetNav('none', viewId);
  };

  const dragButton = (
    mode: DragMode,
    label: string,
    title: string,
    icon: React.ReactNode,
    disabled = false,
  ) => (
    <button
      type="button"
      className={`viewport-nav-btn${isActive(mode) ? ' is-active' : ''}`}
      aria-label={label}
      aria-pressed={isActive(mode)}
      title={title}
      disabled={disabled}
      onPointerDown={(event) => beginDrag(mode, event)}
      onPointerMove={updateDrag}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      {icon}
    </button>
  );

  return (
    <div
      className="viewport-nav-toolbar"
      style={{ right, top }}
      role="toolbar"
      aria-label="Viewport navigation"
      onPointerDown={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        className="viewport-nav-btn"
        aria-label="Frame selection"
        title="Frame selection (F)"
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onFrame(viewId);
        }}
      >
        <svg viewBox="0 0 16 16" aria-hidden>
          <circle cx="8" cy="8" r="5.5" />
          <path d="M8 2.5v11M2.5 8h11" />
        </svg>
      </button>
      {dragButton(
        'pan',
        'Pan',
        'Pan view — drag here or in viewport',
        (
          <svg viewBox="0 0 16 16" aria-hidden>
            <path d="M8 2.5v11M2.5 8h11" />
            <path d="M8 1.5 10 4H6zM8 14.5 6 12h4zM1.5 8 4 6v4zM14.5 8 12 10V6z" />
          </svg>
        ),
      )}
      {dragButton(
        'orbit',
        'Rotate',
        isPerspective ? 'Orbit view — drag here or in viewport' : 'Orbit (perspective views only)',
        (
          <svg viewBox="0 0 16 16" aria-hidden>
            <path d="M3.5 8a4.5 4.5 0 0 1 7.8-3.1" />
            <path d="M12.5 8a4.5 4.5 0 0 1-7.8 3.1" />
            <path d="M11.2 3.2 12.5 5l-2 .6M4.8 12.8 3.5 11l2-.6" />
          </svg>
        ),
        !isPerspective,
      )}
      {dragButton(
        'zoom',
        'Zoom',
        'Zoom view — drag here or in viewport',
        (
          <svg viewBox="0 0 16 16" aria-hidden>
            <circle cx="7" cy="7" r="4.25" />
            <path d="M10.2 10.2 14 14" />
            <path d="M7 4.8v4.4M4.8 7h4.4" />
          </svg>
        ),
      )}
      <button
        type="button"
        className={`viewport-nav-btn viewport-nav-maximize${isMaximized ? ' is-active' : ''}`}
        aria-label={isMaximized ? 'Restore quad view' : 'Maximize viewport'}
        title={isMaximized ? 'Restore quad view (Tab)' : 'Maximize viewport (Tab)'}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onMaximize(viewId);
        }}
      >
        {isMaximized ? (
          <svg viewBox="0 0 16 16" aria-hidden>
            <path d="M3.5 6.5h6v6h-6zM6.5 3.5h6v6" />
          </svg>
        ) : (
          <svg viewBox="0 0 16 16" aria-hidden>
            <path d="M3.5 6V3.5H6M10 3.5h2.5V6M12.5 10v2.5H10M6 12.5H3.5V10" />
          </svg>
        )}
      </button>
    </div>
  );
}
