import { lazy, Suspense, useCallback, useEffect, useRef, useState, type DragEvent } from 'react';
import type { EditorSession } from '@/core/editor/EditorSession';
import { viewportEngine } from '@/app/viewportEngine';
import type { WorkspaceController } from '@/workspace/WorkspaceController';
import type { ViewId } from '@/workspace/types';
import {
  DEFAULT_VIEW_PRESETS,
  VIEW_PRESETS,
  VIEW_PRESET_LABELS,
  type ViewPreset,
} from '@/workspace/types';
import type { ViewportRect } from '@/workspace/SplitLayoutManager';
import { CreateDoodleTool } from '@/core/tools/CreateDoodleTool';
import { CreatePrimitiveTool } from '@/core/tools/CreatePrimitiveTool';
import { DrawPolyTool } from '@/core/tools/DrawPolyTool';
import { KnifeTool } from '@/core/tools/KnifeTool';
import { LoopCutTool } from '@/core/tools/LoopCutTool';
import { PushPullTool } from '@/core/tools/PushPullTool';
import { commitDeleteSelection } from '@/core/editor/DeleteSelection';
import { exitGroupFocus } from '@/core/editor/GroupFocus';
import { handleTransformHotkey } from '@/app/TransformHotkeys';
import { clampTextureSplit } from '@/workspace/TextureWorkspace';
import type { CameraAxes } from '@/core/transform/Orientation';
import { importPngAsImagePlane } from '@/core/editor/ImagePlane';
import { combineMeshObjects } from '@/core/editor/GameAssetTools';
import { pushToast } from '@/app/Toast';
import { ViewportNavToolbar, viewportNavToolbarRightInset } from '@/app/ViewportNavToolbar';
import type { ViewportNavMode } from '@/workspace/WorkspaceController';
import { hasModelDrag, readModelDrag } from '@/app/outliner/modelDrag';

const UvPixelEditor = lazy(() =>
  import('@/app/UvPixelEditor').then((module) => ({ default: module.UvPixelEditor })),
);

type Props = {
  session: EditorSession;
  workspace: WorkspaceController;
};

type DragKind = 'horizontal' | 'upperVertical' | 'lowerVertical';

export function Viewport({ session, workspace }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [rects, setRects] = useState<ViewportRect[]>([]);
  const [hovered, setHovered] = useState<ViewId | null>(null);
  const [mode, setMode] = useState(workspace.layoutMode);
  const [cameraAxes, setCameraAxes] = useState<Partial<Record<ViewId, CameraAxes>>>({});
  const [paneViews, setPaneViews] =
    useState<Record<ViewId, ViewPreset>>({ ...DEFAULT_VIEW_PRESETS });
  const [openViewMenu, setOpenViewMenu] = useState<ViewId | null>(null);
  const [pngDropActive, setPngDropActive] = useState(false);
  const [pngImporting, setPngImporting] = useState(false);
  const [splits, setSplits] = useState({ ...workspace.splits.splits });
  const dragRef = useRef<{ kind: DragKind; start: number; origin: number } | null>(null);
  const textureDividerDrag = useRef<{ startX: number; origin: number } | null>(null);
  const textureLeftRef = useRef<HTMLDivElement>(null);
  const textureRightRef = useRef<HTMLDivElement>(null);
  const textureSplitRef = useRef<HTMLDivElement>(null);
  const liveTextureSplitRef = useRef<number | null>(null);

  const syncUi = useCallback(() => {
    const host = hostRef.current;
    if (host) {
      const bounds = host.getBoundingClientRect();
      const w = Math.max(1, Math.floor(bounds.width));
      const h = Math.max(1, Math.floor(bounds.height));
      // Always derive chrome labels from workspace layout (not a stale engine cache).
      setRects(workspace.computeViewportRects(w, h));
    } else {
      setRects(viewportEngine.getRects());
    }
    setHovered(workspace.hoveredViewportId);
    setMode(workspace.layoutMode);
    setSplits({ ...workspace.splits.splits });
    setPaneViews({
      persp: viewportEngine.getPaneView('persp'),
      top: viewportEngine.getPaneView('top'),
      front: viewportEngine.getPaneView('front'),
      right: viewportEngine.getPaneView('right'),
    });
    setCameraAxes({
      persp: viewportEngine.getCameraAxes('persp') ?? undefined,
      top: viewportEngine.getCameraAxes('top') ?? undefined,
      front: viewportEngine.getCameraAxes('front') ?? undefined,
      right: viewportEngine.getCameraAxes('right') ?? undefined,
    });
  }, [workspace]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;

    const mount = (attempt: number) => {
      if (cancelled) return;
      try {
        viewportEngine.attach(host, session, workspace, {
          onLayoutChange: syncUi,
          onCameraChange: (id, axes) => {
            setCameraAxes((current) => ({ ...current, [id]: axes }));
          },
        });
        syncUi();
        setError(null);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setError(message);
        if (attempt < 5) {
          retryTimer = setTimeout(() => mount(attempt + 1), 500 * (attempt + 1));
        }
      }
    };

    mount(0);
    const unsub = workspace.subscribe(syncUi);

    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
      unsub();
      viewportEngine.detach();
    };
  }, [session, workspace, syncUi]);

  const hasPngFiles = (event: DragEvent<HTMLElement>) =>
    [...event.dataTransfer.items].some(
      (item) => item.kind === 'file' && item.type === 'image/png',
    ) ||
    [...event.dataTransfer.files].some((file) => file.name.toLowerCase().endsWith('.png')) ||
    [...event.dataTransfer.types].includes('Files');

  const importDroppedPngs = async (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setPngDropActive(false);
    const files = [...event.dataTransfer.files].filter(
      (file) => file.type === 'image/png' || file.name.toLowerCase().endsWith('.png'),
    );
    if (!files.length) return;

    setPngImporting(true);
    const objectIds: string[] = [];
    try {
      let xOffset = 0;
      for (const file of files) {
        const created = await importPngAsImagePlane(session, file);
        const object = session.document.objects.get(created.objectId)!;
        object.transform.position = {
          x: session.constructionPlane.origin.x + xOffset,
          y: session.constructionPlane.origin.y,
          z: session.constructionPlane.origin.z,
        };
        xOffset += created.width + 0.25;
        objectIds.push(created.objectId);
      }
      session.selection.setMode('object');
      session.selection.selectObjects(objectIds, 'replace');
      session.requestRedraw();
      viewportEngine.invalidate();
      window.requestAnimationFrame(() => viewportEngine.frameSelection());
      pushToast(
        `${files.length} PNG${files.length === 1 ? '' : 's'} created as two-sided 3D object${files.length === 1 ? '' : 's'}`,
        'success',
      );
      syncUi();
    } catch (error) {
      pushToast(error instanceof Error ? error.message : 'Could not create the PNG object', 'error');
    } finally {
      setPngImporting(false);
    }
  };

  const placeDroppedModel = (event: DragEvent<HTMLDivElement>) => {
    const modelDocumentId = readModelDrag(event.dataTransfer);
    if (!modelDocumentId) return false;
    event.preventDefault();
    event.stopPropagation();
    const model = session.project.documents.get(modelDocumentId);
    const objectId = viewportEngine.placeModelAtScreen(
      modelDocumentId,
      event.clientX,
      event.clientY,
    );
    if (objectId) {
      pushToast(`Placed ${model?.name ?? 'model'} from Outliner`, 'success');
      syncUi();
    } else {
      pushToast(
        `Could not place ${model?.name ?? 'model'} — drop it over an active Level viewport`,
        'error',
      );
    }
    return true;
  };

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (
        handleTransformHotkey(
          e,
          session,
          workspace,
          (id) => viewportEngine.getCameraAxes(id),
          (id) => viewportEngine.getLastPointerSample(id),
        )
      ) {
        viewportEngine.syncTransformInteractionState();
        if (session.transform.active) {
          viewportEngine.syncLiveTransform();
        } else {
          viewportEngine.syncGizmo();
          viewportEngine.invalidate();
        }
        syncUi();
        return;
      }
      if (e.key === 'Escape' && viewportEngine.getModelPlacement()) {
        e.preventDefault();
        viewportEngine.cancelModelPlacement();
        syncUi();
        return;
      }
      if (e.key === 'Escape' && session.focusGroupId && workspace.input.owner === 'none') {
        e.preventDefault();
        exitGroupFocus(session);
        viewportEngine.invalidate();
        syncUi();
        return;
      }
      const tool = session.tools.getActive();
      if (
        e.key === 'Escape' &&
        (tool instanceof CreatePrimitiveTool || tool instanceof CreateDoodleTool)
      ) {
        e.preventDefault();
        tool.cancel(session.context());
        session.tools.setActive('select', session.context());
        workspace.input.end('tool');
        syncUi();
        return;
      }
      if (e.key === 'Escape' && tool instanceof DrawPolyTool) {
        e.preventDefault();
        if (tool.state.chain.length > 0) {
          tool.cancel(session.context());
        } else {
          tool.cancel(session.context());
          session.tools.setActive('select', session.context());
          workspace.input.end('tool');
        }
        viewportEngine.invalidate();
        syncUi();
        return;
      }
      if (e.key === 'Escape' && tool instanceof KnifeTool) {
        e.preventDefault();
        if (tool.state.dragging) {
          tool.cancel(session.context());
          workspace.input.end('tool');
          viewportEngine.syncInputControls();
        } else {
          tool.cancel(session.context());
          session.tools.setActive('select', session.context());
          workspace.input.end('tool');
        }
        viewportEngine.invalidate();
        syncUi();
        return;
      }
      if (e.key === 'Enter' && tool instanceof KnifeTool && tool.state.dragging) {
        e.preventDefault();
        tool.confirm(session.context());
        workspace.input.end('tool');
        viewportEngine.syncInputControls();
        viewportEngine.invalidate();
        syncUi();
        return;
      }
      if (e.key === 'Escape' && tool instanceof LoopCutTool) {
        e.preventDefault();
        tool.cancel(session.context());
        session.tools.setActive('select', session.context());
        workspace.input.end('tool');
        viewportEngine.syncInputControls();
        syncUi();
        return;
      }
      if (e.key === 'Escape' && tool instanceof PushPullTool) {
        e.preventDefault();
        if (tool.state.phase === 'dragging') {
          tool.cancel(session.context());
          workspace.input.end('tool');
          viewportEngine.syncInputControls();
        } else {
          tool.cancel(session.context());
          session.tools.setActive('select', session.context());
          workspace.input.end('tool');
          viewportEngine.syncInputControls();
        }
        viewportEngine.invalidate();
        syncUi();
        return;
      }
      if (e.key === 'Enter' && tool instanceof PushPullTool && tool.state.phase === 'dragging') {
        e.preventDefault();
        tool.confirm(session.context());
        workspace.input.end('tool');
        viewportEngine.syncInputControls();
        viewportEngine.invalidate();
        syncUi();
        return;
      }
      if (
        e.key === 'Enter' &&
        tool instanceof LoopCutTool &&
        tool.state.phase === 'slide'
      ) {
        e.preventDefault();
        const completed = tool.confirm(session.context());
        if (completed) {
          session.tools.setActive('select', session.context());
          workspace.input.end('tool');
          viewportEngine.syncInputControls();
        }
        syncUi();
        return;
      }
      if (
        e.key === 'Enter' &&
        tool instanceof CreatePrimitiveTool &&
        tool.state.stage !== 'idle'
      ) {
        e.preventDefault();
        (e.target as HTMLElement)?.blur?.();
        tool.confirm(session.context());
        viewportEngine.invalidate();
        syncUi();
        return;
      }
      if (
        e.key === 'Backspace' &&
        tool instanceof CreateDoodleTool &&
        tool.inputMode === 'pen' &&
        tool.state.stage === 'drawing'
      ) {
        const tag = (e.target as HTMLElement)?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
        e.preventDefault();
        tool.popPoint(session.context());
        viewportEngine.invalidate();
        syncUi();
        return;
      }
      if (e.key === 'Enter' && tool instanceof CreateDoodleTool && tool.state.stage === 'drawing') {
        e.preventDefault();
        (e.target as HTMLElement)?.blur?.();
        tool.confirm(session.context());
        workspace.setCurveNodeEditMode(false);
        workspace.setSelectedCurvePointIndex(0);
        workspace.input.end('tool');
        viewportEngine.invalidate();
        syncUi();
        return;
      }
      if (
        e.key === 'Enter' &&
        tool instanceof DrawPolyTool &&
        (tool.buildMode === 'vertices'
          ? tool.state.createdInChain.length > 0
          : tool.state.chain.length >= 3)
      ) {
        e.preventDefault();
        (e.target as HTMLElement)?.blur?.();
        tool.confirm(session.context());
        viewportEngine.invalidate();
        syncUi();
        return;
      }
      if (e.key === 'Backspace' && tool instanceof DrawPolyTool) {
        const tag = (e.target as HTMLElement)?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
        e.preventDefault();
        if (tool.state.chain.length > 0) {
          tool.popLast(session.context());
        } else {
          commitDeleteSelection(session);
        }
        viewportEngine.invalidate();
        syncUi();
        return;
      }
      if (e.key === 'Delete' || (e.key === 'Backspace' && !(tool instanceof DrawPolyTool))) {
        const tag = (e.target as HTMLElement)?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
        e.preventDefault();
        commitDeleteSelection(session);
        viewportEngine.invalidate();
        syncUi();
        return;
      }
      if (
        (e.ctrlKey || e.metaKey) &&
        e.key.toLowerCase() === 'j' &&
        workspace.shellMode === 'model'
      ) {
        const tag = (e.target as HTMLElement)?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
        e.preventDefault();
        session.selection.setMode('object');
        const result = combineMeshObjects(
          session.document,
          session.selection.state.selectedObjectIds,
        );
        if (!result.ok) {
          pushToast(result.message, 'info');
        } else {
          session.selection.selectObjects([result.objectId], 'replace');
          session.tools.setActive('select', session.context());
          pushToast(`Combined ${result.sourceCount} objects into one mesh`, 'success');
        }
        viewportEngine.invalidate();
        syncUi();
        return;
      }
      const tag = (e.target as HTMLElement)?.tagName;
      const isTextInput = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
      if (!isTextInput && !session.transform.active && workspace.shellMode === 'model') {
        if (e.code === 'NumpadDecimal' || e.key === '.' || e.key.toLowerCase() === 'f') {
          e.preventDefault();
          viewportEngine.frameSelection();
          syncUi();
          return;
        }
        if (e.key === 'Home' && e.shiftKey) {
          e.preventDefault();
          viewportEngine.resetView();
          syncUi();
          return;
        }
        if (e.key === 'Home') {
          e.preventDefault();
          viewportEngine.frameAll();
          syncUi();
          return;
        }
      }
      if (!workspace.input.canHandleTab(e)) return;
      e.preventDefault();
      // Texture shell: Tab maximizes left/right based on pointer side
      if (workspace.shellMode === 'texture') {
        const host = hostRef.current?.parentElement;
        if (host) {
          const rect = host.getBoundingClientRect();
          const ratio = workspace.texture.splitRatio;
          const overLeft = (window as unknown as { __lastPointerX?: number }).__lastPointerX != null
            ? ((window as unknown as { __lastPointerX: number }).__lastPointerX - rect.left) / rect.width < ratio
            : true;
          workspace.toggleTextureMaximize(overLeft ? 'left' : 'right');
        } else {
          workspace.handleTab();
        }
      } else {
        workspace.handleTab();
      }
      viewportEngine.invalidate();
      syncUi();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [workspace, session, syncUi]);

  useEffect(() => {
    if (!openViewMenu) return;
    const close = () => setOpenViewMenu(null);
    const closeOnOutsidePointer = (event: PointerEvent) => {
      const isInsideMenu = event.composedPath().some(
        (node) =>
          node instanceof HTMLElement &&
          (node.classList.contains('viewport-label') ||
            node.classList.contains('viewport-view-menu')),
      );
      if (!isInsideMenu) close();
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    window.addEventListener('pointerdown', closeOnOutsidePointer);
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      window.removeEventListener('pointerdown', closeOnOutsidePointer);
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [openViewMenu]);

  useEffect(() => {
    const track = (e: PointerEvent) => {
      (window as unknown as { __lastPointerX: number }).__lastPointerX = e.clientX;
    };
    window.addEventListener('pointermove', track);
    return () => window.removeEventListener('pointermove', track);
  }, []);

  const beginDrag = (kind: DragKind, clientPos: number) => {
    const origin =
      kind === 'horizontal'
        ? splits.horizontal
        : kind === 'upperVertical'
          ? splits.upperVertical
          : splits.lowerVertical;
    dragRef.current = { kind, start: clientPos, origin };
    workspace.input.begin('divider');
  };

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const drag = dragRef.current;
      const host = hostRef.current;
      if (!drag || !host) return;
      const rect = host.getBoundingClientRect();
      if (drag.kind === 'horizontal') {
        const y = (e.clientY - rect.top) / Math.max(rect.height, 1);
        workspace.setSplits({ horizontal: y });
      } else if (drag.kind === 'upperVertical') {
        const x = (e.clientX - rect.left) / Math.max(rect.width, 1);
        workspace.setSplits({ upperVertical: x });
      } else {
        const x = (e.clientX - rect.left) / Math.max(rect.width, 1);
        workspace.setSplits({ lowerVertical: x });
      }
      viewportEngine.invalidate();
      syncUi();
    };
    const onUp = () => {
      if (!dragRef.current) return;
      dragRef.current = null;
      workspace.input.end('divider');
      workspace.schedulePersist();
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [workspace, syncUi]);

  const showDividers = mode === 'quad' && workspace.shellMode === 'model';
  const textureMode = workspace.shellMode === 'texture';
  const texMax = workspace.texture.maximize;
  const leftPct =
    texMax === 'left' ? 100 : texMax === 'right' ? 0 : workspace.texture.splitRatio * 100;
  const rightPct = 100 - leftPct;

  useEffect(() => {
    if (!textureMode) return;
    let raf = 0;
    const applyLiveSplit = (ratio: number) => {
      const left = `${ratio * 100}%`;
      const right = `${(1 - ratio) * 100}%`;
      if (textureLeftRef.current) {
        textureLeftRef.current.style.width = left;
        textureLeftRef.current.style.display = ratio <= 0 ? 'none' : 'block';
      }
      if (textureRightRef.current) {
        textureRightRef.current.style.width = right;
        textureRightRef.current.style.display = ratio >= 1 ? 'none' : 'flex';
      }
      if (textureSplitRef.current) textureSplitRef.current.style.left = left;
      liveTextureSplitRef.current = ratio;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => viewportEngine.invalidate());
    };
    const onMove = (e: PointerEvent) => {
      const drag = textureDividerDrag.current;
      const region = hostRef.current?.parentElement;
      if (!drag || !region) return;
      const rect = region.getBoundingClientRect();
      applyLiveSplit(clampTextureSplit((e.clientX - rect.left) / Math.max(1, rect.width)));
    };
    const onUp = () => {
      if (!textureDividerDrag.current) return;
      textureDividerDrag.current = null;
      const ratio = liveTextureSplitRef.current;
      liveTextureSplitRef.current = null;
      if (ratio != null) workspace.setTextureSplit(ratio);
      workspace.input.end('divider');
      requestAnimationFrame(() => {
        viewportEngine.invalidate();
        syncUi();
      });
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [textureMode, workspace, syncUi]);

  return (
    <div
      className={`modelling-region${textureMode ? ' is-texture-shell' : ''}`}
      onDragEnter={(event) => {
        if (hasModelDrag(event.dataTransfer)) {
          event.preventDefault();
          event.dataTransfer.dropEffect = 'copy';
          return;
        }
        if (!hasPngFiles(event)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'copy';
        setPngDropActive(true);
      }}
      onDragOver={(event) => {
        if (hasModelDrag(event.dataTransfer)) {
          event.preventDefault();
          event.dataTransfer.dropEffect = 'copy';
          return;
        }
        if (!hasPngFiles(event)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'copy';
        if (!pngDropActive) setPngDropActive(true);
      }}
      onDragLeave={(event) => {
        const next = event.relatedTarget as Node | null;
        if (!next || !event.currentTarget.contains(next)) setPngDropActive(false);
      }}
      onDrop={(event) => {
        if (placeDroppedModel(event)) return;
        void importDroppedPngs(event);
      }}
    >
      <div
        ref={textureLeftRef}
        className="texture-left"
        style={textureMode ? { width: `${leftPct}%`, display: leftPct <= 0 ? 'none' : 'block' } : undefined}
      >
        <div ref={hostRef} className="modelling-canvas" />

        {!textureMode && (
          <div className={`viewport-chrome${openViewMenu ? ' is-menu-open' : ''}`}>
            {rects.map((r) => (
              <div
                key={r.id}
                className="viewport-chrome-pane"
                style={{ left: r.x, top: r.y, width: r.width, height: r.height }}
              >
                <button
                  type="button"
                  className={`viewport-label${hovered === r.id ? ' is-hover' : ''}${
                    workspace.activeViewportId === r.id || mode === 'maximized' ? ' is-active' : ''
                  }`}
                  style={{ left: 4, top: 7 }}
                  aria-haspopup="menu"
                  aria-expanded={openViewMenu === r.id}
                  aria-label={`Change ${VIEW_PRESET_LABELS[paneViews[r.id]]} viewport view`}
                  onPointerDown={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                  }}
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    setOpenViewMenu((current) => (current === r.id ? null : r.id));
                  }}
                >
                  <span className="viewport-name">
                    {VIEW_PRESET_LABELS[paneViews[r.id]]}
                  </span>
                  <span className="viewport-proj">
                    {paneViews[r.id] === 'perspective' ? 'Perspective' : 'Orthographic'}
                  </span>
                </button>
                {openViewMenu === r.id && (
                  <div
                    className="viewport-view-menu"
                    role="menu"
                    aria-label="Viewport view"
                    style={{ left: 4, top: 29 }}
                    onPointerDown={(event) => event.stopPropagation()}
                  >
                    {VIEW_PRESETS.map((view) => (
                      <button
                        type="button"
                        role="menuitemradio"
                        aria-checked={paneViews[r.id] === view}
                        className={paneViews[r.id] === view ? 'is-selected' : ''}
                        key={view}
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          viewportEngine.setPaneView(r.id, view);
                          setPaneViews((current) => ({ ...current, [r.id]: view }));
                          setOpenViewMenu(null);
                        }}
                      >
                        <span>{VIEW_PRESET_LABELS[view]}</span>
                        {paneViews[r.id] === view && <span aria-hidden>✓</span>}
                      </button>
                    ))}
                  </div>
                )}
                {workspace.viewportNavToolsVisible && (
                  <ViewportNavToolbar
                    viewId={r.id}
                    right={viewportNavToolbarRightInset(r.id, mode)}
                    top={8}
                    isPerspective={paneViews[r.id] === 'perspective'}
                    isMaximized={mode === 'maximized' && workspace.splits.state.maximizedViewportId === r.id}
                    navMode={workspace.viewportNavMode}
                    navViewId={workspace.viewportNavViewId}
                    onSetNav={(nav: ViewportNavMode, viewId) => {
                      workspace.setViewportNav(nav, nav === 'none' ? null : viewId);
                      viewportEngine.invalidate();
                      syncUi();
                    }}
                    onFrame={(viewId) => {
                      workspace.setActiveViewport(viewId);
                      viewportEngine.frameSelection(viewId);
                      syncUi();
                    }}
                    onMaximize={(viewId) => {
                      workspace.toggleViewportMaximize(viewId);
                      viewportEngine.invalidate();
                      syncUi();
                    }}
                    onDrag={(navMode, deltaX, deltaY, viewId) => {
                      viewportEngine.applyViewportNavDrag(navMode, deltaX, deltaY, viewId);
                      syncUi();
                    }}
                  />
                )}
                {paneViews[r.id] === 'perspective' && (
                  <PerspectiveOrientationWidget
                    axes={cameraAxes[r.id] ?? null}
                    right={8}
                    bottom={8}
                    onOrient={(axis, sign) =>
                      viewportEngine.orientPerspective(axis, sign, r.id)
                    }
                    onOrbit={(deltaX, deltaY) =>
                      viewportEngine.orbitPerspective(deltaX, deltaY, r.id)
                    }
                  />
                )}
              </div>
            ))}
          </div>
        )}

        {textureMode && leftPct > 0 && (
          <div className="viewport-chrome">
            <div
              className="viewport-chrome-pane"
              style={{ left: 0, top: 0, width: '100%', height: '100%' }}
            >
            <div className="viewport-label is-active" style={{ left: 8, top: 8 }}>
              <span className="viewport-name">User</span>
              <span className="viewport-proj">Perspective</span>
            </div>
            {workspace.viewportNavToolsVisible && (
              <ViewportNavToolbar
                viewId="persp"
                right={viewportNavToolbarRightInset('persp', mode, true)}
                top={8}
                isPerspective
                isMaximized={texMax === 'left'}
                navMode={workspace.viewportNavMode}
                navViewId={workspace.viewportNavViewId}
                onSetNav={(nav, viewId) => {
                  workspace.setViewportNav(nav, nav === 'none' ? null : viewId);
                  viewportEngine.invalidate();
                  syncUi();
                }}
                onFrame={() => {
                  viewportEngine.frameSelection('persp');
                  syncUi();
                }}
                onMaximize={() => {
                  if (texMax === 'left') workspace.toggleTextureMaximize();
                  else workspace.toggleTextureMaximize('left');
                  syncUi();
                }}
                onDrag={(navMode, deltaX, deltaY, viewId) => {
                  viewportEngine.applyViewportNavDrag(navMode, deltaX, deltaY, viewId);
                  syncUi();
                }}
              />
            )}
            </div>
          </div>
        )}

        {showDividers && (
          <>
            <div
              className="divider divider-h"
              style={{ top: `${splits.horizontal * 100}%` }}
              onPointerDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
                (e.target as HTMLElement).setPointerCapture(e.pointerId);
                beginDrag('horizontal', e.clientY);
              }}
            />
            <div
              className="divider divider-v upper"
              style={{
                left: `${splits.upperVertical * 100}%`,
                height: `${splits.horizontal * 100}%`,
              }}
              onPointerDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
                (e.target as HTMLElement).setPointerCapture(e.pointerId);
                beginDrag('upperVertical', e.clientX);
              }}
            />
            <div
              className="divider divider-v lower"
              style={{
                left: `${splits.lowerVertical * 100}%`,
                top: `${splits.horizontal * 100}%`,
                height: `${(1 - splits.horizontal) * 100}%`,
              }}
              onPointerDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
                (e.target as HTMLElement).setPointerCapture(e.pointerId);
                beginDrag('lowerVertical', e.clientX);
              }}
            />
          </>
        )}
      </div>

      {textureMode && texMax === 'none' && (
        <div
          ref={textureSplitRef}
          className="divider divider-v texture-split"
          style={{ left: `${leftPct}%` }}
          onPointerDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
            (e.target as HTMLElement).setPointerCapture(e.pointerId);
            textureDividerDrag.current = {
              startX: e.clientX,
              origin: workspace.texture.splitRatio,
            };
            liveTextureSplitRef.current = workspace.texture.splitRatio;
            workspace.input.begin('divider');
          }}
        />
      )}

      {textureMode && rightPct > 0 && (
        <div ref={textureRightRef} className="texture-right" style={{ width: `${rightPct}%` }}>
          <Suspense fallback={<div className="uv-canvas-empty"><strong>Loading UV workspace…</strong></div>}>
            <UvPixelEditor session={session} workspace={workspace} />
          </Suspense>
        </div>
      )}

      {error && (
        <div className="quad-error">
          <div>
            <strong>WebGL unavailable</strong>
            <p>{error}</p>
            <button type="button" onClick={() => window.location.reload()}>
              Reload
            </button>
          </div>
        </div>
      )}
      {(pngDropActive || pngImporting) && (
        <div className="png-drop-overlay" aria-live="polite">
          <div>
            <strong>{pngImporting ? 'Creating 3D image object…' : 'Drop PNG to create a 3D object'}</strong>
            <span>Correct aspect ratio · full-image UV · same texture on both sides</span>
          </div>
        </div>
      )}
    </div>
  );
}

type OrientationAxis = 'x' | 'y' | 'z';

function PerspectiveOrientationWidget({
  axes,
  right,
  bottom,
  onOrient,
  onOrbit,
}: {
  axes: CameraAxes | null;
  right: number;
  bottom: number;
  onOrient: (axis: OrientationAxis, sign: 1 | -1) => void;
  onOrbit: (deltaX: number, deltaY: number) => void;
}) {
  const drag = useRef<{
    pointerId: number;
    lastX: number;
    lastY: number;
    startX: number;
    startY: number;
    moved: boolean;
  } | null>(null);
  const suppressAxisClick = useRef(false);
  const centre = 36;
  const radius = 24;
  const projected = (['x', 'y', 'z'] as const).map((axis) => {
    const right = axes?.right[axis] ?? (axis === 'x' ? -0.75 : axis === 'y' ? 0.9 : 0);
    const up = axes?.up[axis] ?? (axis === 'x' ? -0.65 : axis === 'z' ? 1 : 0.15);
    return {
      axis,
      positive: { x: centre + right * radius, y: centre - up * radius },
      negative: { x: centre - right * radius, y: centre + up * radius },
    };
  });
  const beginOrbit = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    suppressAxisClick.current = false;
    drag.current = {
      pointerId: event.pointerId,
      lastX: event.clientX,
      lastY: event.clientY,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
    };
  };
  const updateOrbit = (event: React.PointerEvent<HTMLDivElement>) => {
    const active = drag.current;
    if (!active || active.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    const deltaX = event.clientX - active.lastX;
    const deltaY = event.clientY - active.lastY;
    active.lastX = event.clientX;
    active.lastY = event.clientY;
    if (Math.hypot(event.clientX - active.startX, event.clientY - active.startY) > 3) {
      active.moved = true;
    }
    if (active.moved && (deltaX !== 0 || deltaY !== 0)) onOrbit(deltaX, deltaY);
  };
  const endOrbit = (event: React.PointerEvent<HTMLDivElement>) => {
    const active = drag.current;
    if (!active || active.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    suppressAxisClick.current = active.moved;
    drag.current = null;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    window.setTimeout(() => {
      suppressAxisClick.current = false;
    }, 0);
  };
  return (
    <div
      className="viewport-axis-gizmo"
      style={{ right, bottom }}
      aria-label="Perspective viewport orientation"
      role="group"
      onPointerDown={beginOrbit}
      onPointerMove={updateOrbit}
      onPointerUp={endOrbit}
      onPointerCancel={endOrbit}
    >
      <svg viewBox="0 0 72 72" aria-hidden>
        <circle className="axis-centre" cx={centre} cy={centre} r="3" />
        {projected.map(({ axis, positive, negative }) => (
          <g key={axis}>
            <line
              className={`axis-line axis-${axis}`}
              x1={negative.x}
              y1={negative.y}
              x2={positive.x}
              y2={positive.y}
            />
          </g>
        ))}
      </svg>
      {projected.flatMap(({ axis, positive, negative }) => [
        <button
          key={`${axis}+`}
          type="button"
          className={`axis-button axis-node axis-${axis}`}
          style={{ left: positive.x, top: positive.y }}
          aria-label={`View from positive ${axis.toUpperCase()} axis`}
          title={`View from +${axis.toUpperCase()}`}
          onClick={(event) => {
            event.stopPropagation();
            if (suppressAxisClick.current) return;
            onOrient(axis, 1);
          }}
        >
          {axis.toUpperCase()}
        </button>,
        <button
          key={`${axis}-`}
          type="button"
          className={`axis-button axis-tail axis-${axis}`}
          style={{ left: negative.x, top: negative.y }}
          aria-label={`View from negative ${axis.toUpperCase()} axis`}
          title={`View from −${axis.toUpperCase()}`}
          onClick={(event) => {
            event.stopPropagation();
            if (suppressAxisClick.current) return;
            onOrient(axis, -1);
          }}
        />,
      ])}
    </div>
  );
}
