import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AtlasTilePanel, type AtlasTilePanelProps } from '@/app/UvEditorSidePanel';
import { BlenderIcon } from '@/components/BlenderIcon';
import type { AtlasPanelDock } from '@/workspace/TextureWorkspace';

type DragState = { pointerId: number; offsetX: number; offsetY: number };

export function FloatingAtlasTilePanel(props: AtlasTilePanelProps & { docked?: boolean }) {
  const { workspace, docked } = props;
  const tex = workspace.texture;
  const panel = useRef<HTMLElement>(null);
  const drag = useRef<DragState | null>(null);
  const [position, setPosition] = useState({ x: tex.atlasPanelX, y: tex.atlasPanelY });
  const positionRef = useRef(position);

  useEffect(() => {
    if (docked) return;
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
  }, [docked, workspace]);

  useEffect(() => {
    const next = { x: tex.atlasPanelX, y: tex.atlasPanelY };
    positionRef.current = next;
    setPosition(next);
  }, [tex.atlasPanelX, tex.atlasPanelY]);

  useEffect(() => {
    if (docked) return;
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
  }, [docked, tex.atlasPanelMinimized]);

  const setDock = (dock: AtlasPanelDock) => workspace.patchTexture({ atlasPanelDock: dock, atlasPanelOpen: true });

  const chrome = (
    <>
      <header
        className="tile-panel-header"
        onDoubleClick={() => workspace.patchTexture({ atlasPanelMinimized: !tex.atlasPanelMinimized })}
        onPointerDown={(event) => {
          if ((event.target as HTMLElement).closest('button')) return;
          const host = panel.current ?? event.currentTarget.closest('aside');
          const rect = host?.getBoundingClientRect();
          if (docked) {
            workspace.patchTexture({
              atlasPanelDock: 'float',
              atlasPanelX: rect?.left ?? event.clientX - 24,
              atlasPanelY: rect?.top ?? event.clientY - 16,
            });
            return;
          }
          drag.current = {
            pointerId: event.pointerId,
            offsetX: event.clientX - (rect?.left ?? position.x),
            offsetY: event.clientY - (rect?.top ?? position.y),
          };
        }}
      >
        <div>
          <strong>Palette</strong>
          <span>{tex.atlasTileWidth}×{tex.atlasTileHeight}</span>
        </div>
        <div className="outliner-actions">
          <button type="button" className={`outliner-icon${tex.atlasPanelDock === 'left' ? ' is-active' : ''}`} title="Dock left" onClick={() => setDock('left')}>
            <BlenderIcon name="align_left" size={12} />
          </button>
          <button type="button" className={`outliner-icon${tex.atlasPanelDock === 'right' ? ' is-active' : ''}`} title="Dock right" onClick={() => setDock('right')}>
            <BlenderIcon name="align_right" size={12} />
          </button>
          <button type="button" className={`outliner-icon${tex.atlasPanelDock === 'float' ? ' is-active' : ''}`} title="Float" onClick={() => setDock('float')}>
            <BlenderIcon name="window" size={12} />
          </button>
          <button
            type="button"
            className={`outliner-icon${tex.atlasPanelPinned ? ' is-active' : ''}`}
            title={tex.atlasPanelPinned ? 'Unpin' : 'Pin'}
            onClick={() => workspace.patchTexture({ atlasPanelPinned: !tex.atlasPanelPinned })}
          >
            <BlenderIcon name={tex.atlasPanelPinned ? 'pinned' : 'unpinned'} size={12} />
          </button>
          <button
            type="button"
            className="outliner-icon"
            title={tex.atlasPanelMinimized ? 'Restore' : 'Minimize'}
            onClick={() => workspace.patchTexture({ atlasPanelMinimized: !tex.atlasPanelMinimized })}
          >
            <BlenderIcon name={tex.atlasPanelMinimized ? 'tria_down' : 'tria_up'} size={12} />
          </button>
          <button
            type="button"
            className="outliner-icon danger"
            title="Close"
            onClick={() => workspace.patchTexture({ atlasPanelOpen: false })}
          >
            <BlenderIcon name="panel_close" size={12} />
          </button>
        </div>
      </header>
      {!tex.atlasPanelMinimized && (
        <div className="tile-panel-body">
          <p className="tile-panel-layer">{tex.atlasTileLayer}</p>
          <AtlasTilePanel {...props} variant="palette" />
        </div>
      )}
    </>
  );

  if (docked) {
    return (
      <aside ref={panel} className={`floating-tile-panel is-palette is-docked${tex.atlasPanelMinimized ? ' is-minimized' : ''}`} aria-label="Tile palette">
        {chrome}
      </aside>
    );
  }

  return createPortal(
    <aside
      ref={panel}
      className={`floating-tile-panel is-palette${tex.atlasPanelMinimized ? ' is-minimized' : ''}`}
      style={{ left: position.x, top: position.y }}
      aria-label="Tile palette"
    >
      {chrome}
    </aside>,
    document.body,
  );
}
