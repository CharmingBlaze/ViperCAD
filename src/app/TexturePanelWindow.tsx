import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  clampTexture3dWindow,
  type Texture3dWindowState,
  type TexturePanelId,
} from '@/workspace/TextureWorkspace';
import type { WorkspaceController } from '@/workspace/WorkspaceController';
import { BlenderIcon } from '@/components/BlenderIcon';

type DragKind = 'move' | 'resize';

type DragState = {
  kind: DragKind;
  pointerId: number;
  startX: number;
  startY: number;
  origin: Texture3dWindowState;
};

export function TexturePanelWindow({
  workspace,
  textureMode,
  panel,
  title,
  hint,
  fill,
  dockedWidth,
  children,
}: {
  workspace: WorkspaceController;
  textureMode: boolean;
  panel: TexturePanelId;
  title: string;
  hint?: string;
  fill: boolean;
  dockedWidth?: string;
  children: ReactNode;
}) {
  const regionRef = useRef<HTMLDivElement>(null);
  const drag = useRef<DragState | null>(null);
  const state = panel === '3d' ? workspace.texture.preview3d : workspace.texture.uvWindow;
  const [rect, setRect] = useState(state);
  const rectRef = useRef(rect);
  const docked = state.docked;
  const maximized =
    (panel === '3d' && workspace.texture.maximize === 'left') ||
    (panel === 'uv' && workspace.texture.maximize === 'right');
  const hidden =
    textureMode &&
    (!state.visible ||
      (panel === '3d' && workspace.texture.maximize === 'right') ||
      (panel === 'uv' && workspace.texture.maximize === 'left'));

  useEffect(() => {
    rectRef.current = state;
    setRect(state);
  }, [state.x, state.y, state.width, state.height, state.visible, state.docked]);

  useEffect(() => {
    const onMove = (event: PointerEvent) => {
      const current = drag.current;
      const region = regionRef.current?.parentElement;
      if (!current || current.pointerId !== event.pointerId || !region) return;
      const bounds = region.getBoundingClientRect();
      const dx = event.clientX - current.startX;
      const dy = event.clientY - current.startY;
      const next =
        current.kind === 'move'
          ? { ...current.origin, x: current.origin.x + dx, y: current.origin.y + dy }
          : { ...current.origin, width: current.origin.width + dx, height: current.origin.height + dy };
      const clamped = clampTexture3dWindow(next, { width: bounds.width, height: bounds.height });
      rectRef.current = clamped;
      setRect(clamped);
    };
    const onUp = (event: PointerEvent) => {
      if (!drag.current || drag.current.pointerId !== event.pointerId) return;
      drag.current = null;
      const region = regionRef.current?.parentElement;
      const bounds = region?.getBoundingClientRect();
      workspace.setTexturePanelWindow(
        panel,
        rectRef.current,
        bounds ? { width: bounds.width, height: bounds.height } : undefined,
      );
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [panel, workspace]);

  const begin = (kind: DragKind, event: React.PointerEvent) => {
    if (event.button !== 0 || !textureMode || maximized || docked) return;
    event.preventDefault();
    event.stopPropagation();
    (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
    drag.current = {
      kind,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      origin: rectRef.current,
    };
    workspace.input.begin('divider');
  };

  const endCapture = (event: React.PointerEvent) => {
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    workspace.input.end('divider');
  };

  const detach = () => {
    const node = regionRef.current;
    const parent = node?.parentElement;
    if (!node || !parent) {
      workspace.setTexturePanelWindow(panel, { docked: false, visible: true });
      return;
    }
    const pane = node.getBoundingClientRect();
    const bounds = parent.getBoundingClientRect();
    workspace.setTexturePanelWindow(
      panel,
      {
        docked: false,
        visible: true,
        x: pane.left - bounds.left,
        y: pane.top - bounds.top,
        width: pane.width,
        height: pane.height,
      },
      { width: bounds.width, height: bounds.height },
    );
  };

  const floating = textureMode && !docked && !maximized && !fill;
  const className = !textureMode
    ? panel === '3d'
      ? 'texture-left'
      : 'texture-uv-window is-hidden'
    : [
        'texture-panel',
        panel === '3d' ? 'texture-3d-window' : 'texture-uv-window',
        docked ? 'is-docked' : 'is-floating',
        fill || maximized ? 'is-fill' : '',
        hidden ? 'is-hidden' : '',
      ]
        .filter(Boolean)
        .join(' ');

  return (
    <div
      ref={regionRef}
      className={className}
      style={
        textureMode && floating
          ? { left: rect.x, top: rect.y, width: rect.width, height: rect.height }
          : textureMode && docked && !fill && !maximized && dockedWidth
            ? { flexBasis: dockedWidth, width: dockedWidth }
            : undefined
      }
      aria-label={textureMode ? title : undefined}
      aria-hidden={hidden}
    >
      <header
        className="texture-3d-window-bar"
        title={hint}
        onPointerDown={(event) => {
          if ((event.target as HTMLElement).closest('button')) return;
          begin('move', event);
        }}
        onPointerUp={endCapture}
      >
        <strong>{title}</strong>
        <div className="texture-3d-window-actions">
          {docked ? (
            <button
              type="button"
              className="outliner-icon"
              title={`Detach ${title}`}
              onClick={detach}
            >
              <BlenderIcon name="window" size={12} />
            </button>
          ) : (
            <button
              type="button"
              className="outliner-icon"
              title="Dock in split"
              onClick={() => workspace.restoreTextureSplit()}
            >
              <BlenderIcon name="split_vertical" size={12} />
            </button>
          )}
          <button
            type="button"
            className="outliner-icon"
            title={maximized ? 'Restore split' : `Fill workspace`}
            onClick={() => {
              if (maximized || fill) workspace.restoreTextureSplit();
              else workspace.toggleTextureMaximize(panel === '3d' ? 'left' : 'right');
            }}
          >
            <BlenderIcon name={maximized || fill ? 'fullscreen_exit' : 'fullscreen_enter'} size={12} />
          </button>
          <button
            type="button"
            className="outliner-icon"
            title={`Hide ${title} (Tab restores split)`}
            onClick={() => {
              if (workspace.texture.maximize !== 'none') workspace.toggleTextureMaximize();
              workspace.setTexturePanelWindow(panel, { visible: false });
            }}
          >
            <BlenderIcon name="panel_close" size={12} />
          </button>
        </div>
      </header>
      <div className="texture-3d-window-body">{children}</div>
      {!docked ? (
        <div
          className="texture-3d-window-resize"
          aria-label={`Resize ${title}`}
          onPointerDown={(event) => begin('resize', event)}
          onPointerUp={endCapture}
        />
      ) : null}
    </div>
  );
}
