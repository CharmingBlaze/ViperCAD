import { useEffect, useRef, useState } from 'react';
import { AtlasTilePanel, type AtlasTilePanelProps } from '@/app/UvEditorSidePanel';

type DragState = { pointerId: number; offsetX: number; offsetY: number };

export function FloatingAtlasTilePanel(props: AtlasTilePanelProps) {
  const { workspace } = props;
  const tex = workspace.texture;
  const panel = useRef<HTMLElement>(null);
  const drag = useRef<DragState | null>(null);
  const [position, setPosition] = useState({ x: tex.atlasPanelX, y: tex.atlasPanelY });
  const positionRef = useRef(position);

  useEffect(() => {
    const move = (event: PointerEvent) => {
      const current = drag.current;
      if (!current || current.pointerId !== event.pointerId) return;
      const width = panel.current?.offsetWidth ?? 360;
      const height = panel.current?.offsetHeight ?? 42;
      const next = {
        x: Math.max(0, Math.min(window.innerWidth - width, event.clientX - current.offsetX)),
        y: Math.max(48, Math.min(window.innerHeight - height, event.clientY - current.offsetY)),
      };
      positionRef.current = next;
      setPosition(next);
    };
    const end = (event: PointerEvent) => {
      if (drag.current?.pointerId !== event.pointerId) return;
      drag.current = null;
      workspace.patchTexture({ atlasPanelX: positionRef.current.x, atlasPanelY: positionRef.current.y });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
    };
  }, [workspace]);

  useEffect(() => {
    const keepOnScreen = () => {
      const width = panel.current?.offsetWidth ?? 390;
      const height = panel.current?.offsetHeight ?? 42;
      const next = {
        x: Math.max(0, Math.min(window.innerWidth - width, positionRef.current.x)),
        y: Math.max(48, Math.min(window.innerHeight - height, positionRef.current.y)),
      };
      positionRef.current = next;
      setPosition(next);
    };
    keepOnScreen();
    window.addEventListener('resize', keepOnScreen);
    return () => window.removeEventListener('resize', keepOnScreen);
  }, [tex.atlasPanelMinimized]);

  return (
    <aside
      ref={panel}
      className={`floating-tile-panel${tex.atlasPanelMinimized ? ' is-minimized' : ''}`}
      style={{ left: position.x, top: position.y }}
      aria-label="Tile palette"
    >
      <header
        className="tile-panel-header"
        onDoubleClick={() => workspace.patchTexture({ atlasPanelMinimized: !tex.atlasPanelMinimized })}
        onPointerDown={(event) => {
          if ((event.target as HTMLElement).closest('button')) return;
          const rect = panel.current?.getBoundingClientRect();
          drag.current = {
            pointerId: event.pointerId,
            offsetX: event.clientX - (rect?.left ?? position.x),
            offsetY: event.clientY - (rect?.top ?? position.y),
          };
        }}
      >
        <div>
          <strong>Tiles</strong>
          <span>
            {tex.atlasTileWidth} × {tex.atlasTileHeight}px
            {(tex.atlasRepeatU > 1 || tex.atlasRepeatV > 1) ? ` · repeat ${tex.atlasRepeatU}×${tex.atlasRepeatV}` : ''}
            {' · '}{tex.atlasTileLayer}
          </span>
        </div>
        <div className="outliner-actions">
          <button type="button" className="outliner-icon" title={tex.atlasPanelMinimized ? 'Restore' : 'Minimize'} onClick={() => workspace.patchTexture({ atlasPanelMinimized: !tex.atlasPanelMinimized })}>
            {tex.atlasPanelMinimized ? '□' : '–'}
          </button>
          <button type="button" className="outliner-icon danger" title="Close" onClick={() => workspace.patchTexture({ atlasPanelOpen: false })}>×</button>
        </div>
      </header>
      {!tex.atlasPanelMinimized && <div className="tile-panel-body"><AtlasTilePanel {...props} /></div>}
    </aside>
  );
}
