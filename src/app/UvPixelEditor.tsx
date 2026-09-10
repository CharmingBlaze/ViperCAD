import { useCallback, useEffect, useRef, useState } from 'react';
import type { EditorSession } from '@/core/editor/EditorSession';
import { floodFill, getPixel } from '@/core/image/PixelEditor';
import { applyPaintTarget, clonePaintTarget, getPaintPixel, getPaintTarget } from '@/core/image/PaintLayers';
import { PixelStrokeRecorder } from '@/core/image/PixelStroke';
import {
  brushColourForTool,
  mirroredPaintPixels,
  stampBrush,
  stampBrushLine,
} from '@/core/image/paintBrush';
import type { FaceCornerId, FaceId } from '@/core/mesh/types';
import { cloneMeshPreserveIds, faceCornerIds, restoreMeshFromSnapshot } from '@/core/mesh/EditableMesh';
import { flipFaces } from '@/core/mesh/ops/basic';
import { resolveActiveTexture } from '@/core/texture/resolveActiveTexture';
import {
  boundsOfUvs,
  cameraToFrameUvBounds,
  commitUvEdit,
  cornersForFaces,
  cornersInUvRect,
  expandWeldedUvCorners,
  facesInUvRect,
  flipUvs,
  isScaleHandle,
  normalizeUvsToUnit,
  pickUvElement,
  pickUvGizmo,
  resolveUvLayerId,
  resizeUvsToSize,
  relaxSelectedUvs,
  rotateSelectedUvsToEdge,
  rotateUvsFromSnapshot,
  scaleFactorsFromDrag,
  scaleUvsFromSnapshot,
  snapshotUvs,
  splitSelectedUvs,
  straightenSelectedUvs,
  translateUvsFromSnapshot,
  UV_GIZMO_PX,
  uvGizmoCursor,
  alignUvs,
  distributeUvs,
  snapUvsToPixelGrid,
  translateUvsToAlign,
  weldSelectedUvs,
  type UvAlignMode,
  type UvGizmoHandle,
  type UvSnapshot,
} from '@/core/uv/UvEdit';
import {
  applySeamSnapshot,
  clearAllUvSeams,
  islandForFace,
  markUvSeams,
  markUvSeamsByAngle,
  snapshotSeams,
  unwrapUvs,
  viewAxesFromCamera,
  type UvUnwrapMode,
} from '@/core/uv/UvOperations';
import { packUvsAsync } from '@/core/uv/workers/UvPackingWorkerClient';
import { v3 } from '@/core/math/Vec3';
import type { WorkspaceController } from '@/workspace/WorkspaceController';
import { editorCamera } from '@/workspace/TextureWorkspace';
import { UvEditorSidePanel } from '@/app/UvEditorSidePanel';
import { UvInspectorPortal } from '@/app/UvInspectorHost';
import { ViewportNavToolbar } from '@/app/ViewportNavToolbar';
import type { ViewportNavMode } from '@/workspace/WorkspaceController';
import {
  canvasNavKind,
  classifyPointerButton,
  classifyWheel,
  wheelZoomPixels,
} from '@/app/viewport/ViewportInputEngine';
import { BlenderIcon } from '@/components/BlenderIcon';
import { pushToast } from '@/app/Toast';
import { FloatingAtlasTilePanel } from '@/app/FloatingAtlasTilePanel';
import { applyAtlasTileToFaces, buildAtlasTileGrid } from '@/core/uv/AtlasUv';
import { buildPlane } from '@/core/mesh/builders/PlaneBuilder';
import { importImageFile } from '@/core/image/ImageImport';
import { commitMeshObject, createMaterial, getObjectMaterialId } from '@/core/document/ModelDocument';
import { TileDrawTool } from '@/core/tools/TileDrawTool';
import {
  applyTileDrawHotkey,
  applyTileDrawToolConfig,
  rememberAtlasStamp,
  shouldKeepWorkspaceTileset,
  shouldShowTilesetPanel,
  toggleTilesetPopup,
  toggleTileDrawTool,
} from '@/app/tilesetWorkspace';
import { commitDeleteSelection } from '@/core/editor/DeleteSelection';
import {
  applyAtlasTileSnapshot,
  buildAtlasTileParamsKey,
  buildAtlasTilePlacement,
  type LiveAtlasTileSession,
  restoreUvAndAtlasSnapshot,
  snapshotAtlasTiles,
} from '@/app/uvEditor/atlasTileLive';
import { drawUvPixelCanvas } from '@/app/uvEditor/drawUvPixelCanvas';
import { analyseUvs } from '@/core/uv/UvDiagnostics';
import { ensureEditableUvs } from '@/core/uv/EnsurePaintableUvs';
import type { ImageAsset } from '@/core/document/types';
import {
  hexToRgba,
  paintToolFromHotkey,
  PIXEL_TOOL_HOTKEYS,
  PIXEL_TOOL_ICONS,
  PIXEL_TOOL_LABELS,
  PIXEL_TOOLS,
  UV_EDIT_MODE_ICONS,
  UV_TRANSFORM_ICONS,
  resolveSelectedCorners,
  rgbaToHex,
  shiftShadeColor,
  uniqueFacesForCorners,
  UV_ZOOM_MAX,
  UV_ZOOM_MIN,
  UV_ZOOM_STEPS,
  zoomCameraAt,
} from '@/app/uvEditor/uvEditorUtils';

type Props = {
  session: EditorSession;
  workspace: WorkspaceController;
};

type AxisLock = 'none' | 'u' | 'v';

type UvDragState = {
  meshId: string;
  layerId: string;
  before: UvSnapshot;
  startUv: { x: number; y: number };
  moved: boolean;
  mode: 'move' | 'scale' | 'rotate';
  handle: UvGizmoHandle;
  pivot: { x: number; y: number };
  startAngle: number;
  uniform: boolean;
  snapAngle: boolean;
  axis: AxisLock;
};

type MarqueeState = {
  startUv: { x: number; y: number };
  currentUv: { x: number; y: number };
  startScreenX: number;
  currentScreenX: number;
  shiftKey: boolean;
};

type PixelShapeDrag = {
  start: { x: number; y: number };
  current: { x: number; y: number };
  useBackground: boolean;
};

// UV editing does not depend on a material image. This transparent guide gives
// untextured meshes a stable 0–1 canvas without creating a material or asset.
const UV_GUIDE_IMAGE: ImageAsset = {
  id: '__uv-guide__',
  name: 'UV guide (no texture assigned)',
  width: 256,
  height: 256,
  colourMode: 'rgba',
  pixels: new Uint8ClampedArray(256 * 256 * 4),
  revision: 0,
};

/**
 * Shared UV + pixel image canvas.
 * UV / Combined (when armed): Blockbench-style select + move / scale / rotate.
 */
export function UvPixelEditor({ session, workspace }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stroke = useRef(new PixelStrokeRecorder());
  const painting = useRef(false);
  const lastPaintPixel = useRef<{ x: number; y: number } | null>(null);
  const hoverPixel = useRef<{ x: number; y: number } | null>(null);
  const pixelShapeDrag = useRef<PixelShapeDrag | null>(null);
  const panning = useRef<{
    kind: 'pan' | 'zoom';
    x: number;
    y: number;
    panX: number;
    panY: number;
    zoom: number;
  } | null>(null);
  const [canvasNavMode, setCanvasNavMode] = useState<ViewportNavMode>('none');
  const uvDrag = useRef<UvDragState | null>(null);
  const marquee = useRef<MarqueeState | null>(null);
  const lastAutoFramedImage = useRef<string | null>(null);
  const lastAutoFollowedFace = useRef<string>('');
  const lastClick = useRef<{ t: number; faceId: FaceId | null }>({ t: 0, faceId: null });
  const lastTileBrushedFace = useRef<string | null>(null);
  const liveAtlasTile = useRef<LiveAtlasTileSession | null>(null);
  const [tick, setTick] = useState(0);
  const refresh = () => setTick((t) => t + 1);

  useEffect(() => session.onRedraw(refresh), [session]);
  useEffect(
    () =>
      workspace.subscribe(() => {
        // Split-divider drags update layout via DOM; skip React redraw thrash.
        if (workspace.input.owner === 'divider') return;
        refresh();
      }),
    [workspace],
  );

  const tex = workspace.texture;
  const tileDrawTool = session.tools.get('tile-draw') as TileDrawTool;
  const tileDrawActive = session.tools.getActive()?.id === 'tile-draw';
  const tileDrawRevision = tileDrawTool.state.revision;
  const selectedFaceKey = [...session.selection.state.selectedFaceIds].sort().join('|');
  const activeUvLayerId = tex.activeUvLayerId;
  const ctxInfo = resolveActiveTexture(session.document, session.selection.state);
  const keepTileset = shouldKeepWorkspaceTileset(session, workspace);
  const image = (keepTileset && tex.activeImageId
    ? session.document.images.get(tex.activeImageId)
    : null) ?? (ctxInfo.imageId ? session.document.images.get(ctxInfo.imageId) : null);
  const tilesetMaterialId = keepTileset ? (tex.activeMaterialId ?? ctxInfo.materialId) : ctxInfo.materialId;
  const uvPointerActive =
    tex.activeRightEditor === 'uv' ||
    (tex.activeRightEditor === 'combined' && tex.uvPointerMode);

  useEffect(() => {
    if (shouldKeepWorkspaceTileset(session, workspace)) {
      if (ctxInfo.uvLayerId && tex.activeUvLayerId !== ctxInfo.uvLayerId) {
        workspace.patchTexture({ activeUvLayerId: ctxInfo.uvLayerId });
      }
      return;
    }
    if (
      tex.activeImageId !== ctxInfo.imageId ||
      tex.activeMaterialId !== ctxInfo.materialId ||
      tex.activeTextureId !== ctxInfo.textureId ||
      tex.activeUvLayerId !== ctxInfo.uvLayerId
    ) {
      workspace.patchTexture({
        activeImageId: ctxInfo.imageId,
        activeMaterialId: ctxInfo.materialId,
        activeTextureId: ctxInfo.textureId,
        activeUvLayerId: ctxInfo.uvLayerId,
      });
    }
  }, [ctxInfo.imageId, ctxInfo.materialId, ctxInfo.textureId, ctxInfo.uvLayerId, session, tex, workspace]);

  const activeMesh = useCallback(() => {
    const objectId = session.selection.state.activeObjectId;
    const object = objectId ? session.document.objects.get(objectId) : null;
    const mesh = object?.meshId ? session.document.meshes.get(object.meshId) : null;
    const layerId = mesh ? resolveUvLayerId(mesh, activeUvLayerId ?? mesh.defaultUvLayerId) : null;
    if (!object || !mesh || !layerId) return null;
    return { objectId: object.id, mesh, layerId };
  }, [activeUvLayerId, session]);

  // Make imported/procedural meshes UV-editable on first use. This only repairs
  // absent or degenerate UVs; healthy mappings are left exactly as they are.
  useEffect(() => {
    if (!uvPointerActive) return;
    const objectId = session.selection.state.activeObjectId;
    const object = objectId ? session.document.objects.get(objectId) : null;
    const mesh = object?.meshId ? session.document.meshes.get(object.meshId) : null;
    if (!mesh) return;
    const result = ensureEditableUvs(mesh);
    if (!result.changed) return;
    session.document.dirty = true;
    session.requestRedraw();
    refresh();
  }, [uvPointerActive, session.selection.state.activeObjectId, activeUvLayerId]);

  const active = activeMesh();
  const canvasImage = image ?? (uvPointerActive && active ? UV_GUIDE_IMAGE : null);

  const selectedSnapshot = useCallback(() => {
    const ctx = activeMesh();
    if (!ctx) return null;
    const corners = resolveSelectedCorners(ctx.mesh, session, tex);
    if (!corners.length) return null;
    return { ctx, corners, snap: snapshotUvs(ctx.mesh, corners, ctx.layerId) };
  }, [activeMesh, session, tex]);

  // Keep UV corners aligned with 3D face picks (stale UV selection otherwise wins).
  useEffect(() => {
    if (workspace.shellMode !== 'texture') return;
    if (tex.uvSelectionSync === 'off' || tex.uvEditMode === 'point') return;
    const ctx = activeMesh();
    if (!ctx) return;
    const faces = session.selection.state.selectedFaceIds;
    if (!faces.size) {
      if (session.uvSelection.size > 0) session.uvSelection.clear();
      return;
    }
    let faceIds = [...faces];
    if (tex.uvSelectionSync === 'island') {
      const expanded = new Set<FaceId>();
      for (const f of faceIds) {
        const island = islandForFace(ctx.mesh, f);
        for (const id of island?.faceIds ?? [f]) expanded.add(id);
      }
      faceIds = [...expanded];
    }
    const corners = cornersForFaces(ctx.mesh, faceIds);
    const current = session.uvSelection.state.selectedCornerIds;
    const same =
      corners.length === current.size && corners.every((id) => current.has(id));
    if (!same) session.uvSelection.selectCorners(corners, 'replace');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    workspace.shellMode,
    tex.uvSelectionSync,
    tex.uvEditMode,
    selectedFaceKey,
    session.selection.state.activeObjectId,
    session.selection.state.activeFaceId,
  ]);

  const armUv = (patch: Partial<typeof tex> = {}) => {
    session.selection.setMode('face');
    const leavingTiles = patch.uvPanelTab !== undefined && patch.uvPanelTab !== 'tiles';
    workspace.patchTexture({
      uvPointerMode: true,
      activeRightEditor: tex.activeRightEditor === 'pixel' ? 'uv' : tex.activeRightEditor,
      ...(leavingTiles ? { atlasPanelOpen: false, atlasPaintMode: false } : {}),
      ...patch,
    });
  };

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const host = hostRef.current;
    if (!canvas || !host) return;
    const active = activeMesh();
    drawUvPixelCanvas({
      canvas,
      host,
      image: canvasImage,
      session,
      workspace,
      uvPointerActive,
      activeMesh: active ? { mesh: active.mesh, layerId: active.layerId } : null,
      hoverPixel: hoverPixel.current,
      marquee: marquee.current,
      pixelShapePreview: pixelShapeDrag.current
        ? { tool: tex.pixelTool as 'line' | 'rectangle' | 'ellipse', ...pixelShapeDrag.current }
        : null,
    });
  }, [activeMesh, canvasImage, session, tex.pixelTool, workspace, uvPointerActive]);

  useEffect(() => {
    draw();
  }, [draw, tick]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const ro = new ResizeObserver(() => {
      draw();
    });
    ro.observe(host);
    return () => {
      ro.disconnect();
    };
  }, [draw]);

  const screenToUv = (clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas || !canvasImage) return null;
    const rect = canvas.getBoundingClientRect();
    const cam = editorCamera(workspace.texture);
    const sx = clientX - rect.left;
    const sy = clientY - rect.top;
    const px = (sx - cam.panX) / cam.zoom;
    const py = (sy - cam.panY) / cam.zoom;
    return { x: px / canvasImage.width, y: 1 - py / canvasImage.height };
  };

  const screenToPixel = (clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas || !image) return null;
    const rect = canvas.getBoundingClientRect();
    const cam = editorCamera(workspace.texture);
    const sx = clientX - rect.left;
    const sy = clientY - rect.top;
    const rawX = (sx - cam.panX) / cam.zoom;
    const rawY = (sy - cam.panY) / cam.zoom;
    if (rawX < 0 || rawY < 0 || rawX >= image.width || rawY >= image.height) return null;
    const snap = workspace.texture.pixelGridSnap;
    const px = snap
      ? Math.max(0, Math.min(image.width - 1, Math.round(rawX)))
      : Math.floor(rawX);
    const py = snap
      ? Math.max(0, Math.min(image.height - 1, Math.round(rawY)))
      : Math.floor(rawY);
    return { x: px, y: py };
  };

  const paintAt = (clientX: number, clientY: number, useBackground = false) => {
    if (!image) return;
    const p = screenToPixel(clientX, clientY);
    if (!p) return;
    const tool = workspace.texture.pixelTool;
    const colour = brushColourForTool(
      tool,
      workspace.texture.foreground,
      workspace.texture.background,
      useBackground,
    );
    const size = Math.max(1, workspace.texture.brushSize);
    const shape = workspace.texture.brushShape;
    if (!stroke.current.isActive) stroke.current.begin(image);
    const previous = lastPaintPixel.current;
    const mirrored = (point: { x: number; y: number }) =>
      mirroredPaintPixels(
        image.width,
        image.height,
        point,
        workspace.texture.paintMirrorX,
        workspace.texture.paintMirrorY,
      );
    const dither = workspace.texture.ditherMode;
    const recolor = workspace.texture.recolorOnlyBg ? workspace.texture.background : null;
    if (!previous) {
      for (const target of mirrored(p)) stampBrush(image, target.x, target.y, size, colour, stroke.current, shape, dither, recolor);
    } else {
      const previousMirrors = mirrored(previous);
      const nextMirrors = mirrored(p);
      for (let index = 0; index < Math.min(previousMirrors.length, nextMirrors.length); index++) {
        const from = previousMirrors[index]!;
        const to = nextMirrors[index]!;
        stampBrushLine(image, from.x, from.y, to.x, to.y, size, colour, stroke.current, shape, dither, recolor);
      }
    }
    lastPaintPixel.current = p;
    session.requestRedraw();
    draw();
  };

  const commitPixelShape = () => {
    const drag = pixelShapeDrag.current;
    if (!drag || !image) return;
    const tex = workspace.texture;
    const colour = brushColourForTool(tex.pixelTool, tex.foreground, tex.background, drag.useBackground);
    const size = Math.max(1, tex.brushSize);
    const mirrorPoint = (point: { x: number; y: number }) => ({
      x: tex.paintMirrorX ? image.width - 1 - point.x : point.x,
      y: tex.paintMirrorY ? image.height - 1 - point.y : point.y,
    });
    const dither = tex.ditherMode;
    const recolor = tex.recolorOnlyBg ? tex.background : null;
    const drawLine = (from: { x: number; y: number }, to: { x: number; y: number }) => {
      stampBrushLine(image, from.x, from.y, to.x, to.y, size, colour, stroke.current, tex.brushShape, dither, recolor);
      if (tex.paintMirrorX) {
        const a = { x: image.width - 1 - from.x, y: from.y };
        const b = { x: image.width - 1 - to.x, y: to.y };
        stampBrushLine(image, a.x, a.y, b.x, b.y, size, colour, stroke.current, tex.brushShape, dither, recolor);
      }
      if (tex.paintMirrorY) {
        const a = { x: from.x, y: image.height - 1 - from.y };
        const b = { x: to.x, y: image.height - 1 - to.y };
        stampBrushLine(image, a.x, a.y, b.x, b.y, size, colour, stroke.current, tex.brushShape, dither, recolor);
      }
      if (tex.paintMirrorX && tex.paintMirrorY) {
        const a = mirrorPoint(from);
        const b = mirrorPoint(to);
        stampBrushLine(image, a.x, a.y, b.x, b.y, size, colour, stroke.current, tex.brushShape, dither, recolor);
      }
    };
    if (tex.pixelTool === 'line') {
      drawLine(drag.start, drag.current);
    } else if (tex.pixelTool === 'rectangle') {
      const minX = Math.min(drag.start.x, drag.current.x);
      const maxX = Math.max(drag.start.x, drag.current.x);
      const minY = Math.min(drag.start.y, drag.current.y);
      const maxY = Math.max(drag.start.y, drag.current.y);
      drawLine({ x: minX, y: minY }, { x: maxX, y: minY });
      drawLine({ x: minX, y: maxY }, { x: maxX, y: maxY });
      drawLine({ x: minX, y: minY }, { x: minX, y: maxY });
      drawLine({ x: maxX, y: minY }, { x: maxX, y: maxY });
    } else {
      const minX = Math.min(drag.start.x, drag.current.x);
      const maxX = Math.max(drag.start.x, drag.current.x);
      const minY = Math.min(drag.start.y, drag.current.y);
      const maxY = Math.max(drag.start.y, drag.current.y);
      const cx = (minX + maxX) / 2;
      const cy = (minY + maxY) / 2;
      const rx = Math.max(0.5, (maxX - minX) / 2);
      const ry = Math.max(0.5, (maxY - minY) / 2);
      const steps = Math.max(12, Math.ceil(Math.PI * 2 * Math.max(rx, ry) * 1.5));
      let previous: { x: number; y: number } | null = null;
      for (let i = 0; i <= steps; i++) {
        const angle = (i / steps) * Math.PI * 2;
        const point = { x: Math.round(cx + Math.cos(angle) * rx), y: Math.round(cy + Math.sin(angle) * ry) };
        if (previous) drawLine(previous, point);
        previous = point;
      }
    }
    pixelShapeDrag.current = null;
    stroke.current.commit(session.history, () => session.requestRedraw());
    session.requestRedraw();
    refresh();
  };

  const syncFacesFromUv = (faceIds: FaceId[], objectId: string, op: 'replace' | 'add' | 'toggle') => {
    session.selectionSource = 'uv';
    session.selection.setMode('face');
    session.selection.selectObjects([objectId], 'replace');
    session.selection.selectFaces(faceIds, op);
  };

  const applySelection = (
    ctx: NonNullable<ReturnType<typeof activeMesh>>,
    faceIds: FaceId[],
    cornerIds: FaceCornerId[],
    op: 'replace' | 'add' | 'toggle',
  ) => {
    if (op === 'replace') {
      syncFacesFromUv(faceIds, ctx.objectId, 'replace');
      session.uvSelection.selectCorners(cornerIds, 'replace');
    } else if (op === 'add') {
      syncFacesFromUv(faceIds, ctx.objectId, 'add');
      session.uvSelection.selectCorners(cornerIds, 'add');
    } else {
      syncFacesFromUv(faceIds, ctx.objectId, 'toggle');
      session.uvSelection.selectCorners(cornerIds, 'toggle');
    }
  };

  const beginUvMarquee = (
    clientX: number,
    clientY: number,
    shiftKey: boolean,
    clearUnlessAdd: boolean,
  ) => {
    const uv = screenToUv(clientX, clientY);
    if (!uv || !activeMesh()) return false;
    marquee.current = {
      startUv: uv,
      currentUv: uv,
      startScreenX: clientX,
      currentScreenX: clientX,
      shiftKey,
    };
    if (clearUnlessAdd && !shiftKey) {
      session.uvSelection.clear();
      session.selection.selectFaces([], 'replace');
    }
    session.requestRedraw();
    refresh();
    return true;
  };

  const beginUvInteraction = (
    clientX: number,
    clientY: number,
    shiftKey: boolean,
    ctrlKey = false,
  ) => {
    const ctx = activeMesh();
    const uv = screenToUv(clientX, clientY);
    if (!ctx || !uv || !canvasImage) return;

    // Ctrl/Cmd+LMB always starts a bidirectional marquee (even over faces / gizmos).
    if (ctrlKey) {
      beginUvMarquee(clientX, clientY, shiftKey, true);
      return;
    }

    const cam = editorCamera(workspace.texture);
    const pickRadiusPx = UV_GIZMO_PX.handleHit;
    const edgeRadiusPx = UV_GIZMO_PX.edgeHit;
    // Screen-stable UV radii (must include zoom — otherwise handles eat the whole island).
    const radiusU = Math.max(edgeRadiusPx, pickRadiusPx) / Math.max(1e-6, cam.zoom * canvasImage.width);
    const radiusV = Math.max(edgeRadiusPx, pickRadiusPx) / Math.max(1e-6, cam.zoom * canvasImage.height);
    const rotateOffsetV = UV_GIZMO_PX.rotateStem / Math.max(1e-6, cam.zoom * canvasImage.height);
    const transformTool = workspace.texture.uvTransformTool;
    const editMode = workspace.texture.uvEditMode;
    const op = shiftKey ? 'add' : 'replace';

    let corners = resolveSelectedCorners(ctx.mesh, session, workspace.texture);
    if (
      corners.length &&
      session.uvSelection.size === 0 &&
      session.selection.state.selectedFaceIds.size
    ) {
      session.uvSelection.selectCorners(corners, 'replace');
    }

    if (corners.length) {
      const snap = snapshotUvs(ctx.mesh, corners, ctx.layerId);
      const bounds = boundsOfUvs(snap);
      if (bounds) {
        const gizmo = pickUvGizmo(uv, bounds, radiusU, radiusV, rotateOffsetV);
        if (gizmo) {
          // Handles always do their job (resize / rotate). Tool only changes body drag.
          let mode: UvDragState['mode'] = 'move';
          let handle = gizmo.handle;
          let pivot = gizmo.pivot;
          if (handle === 'rotate') {
            mode = 'rotate';
            pivot = bounds.center;
          } else if (transformTool === 'move') {
            if (handle === 'nw' || handle === 'ne' || handle === 'sw' || handle === 'se') {
              mode = 'scale';
            } else {
              mode = 'move';
              handle = 'body';
            }
          } else if (isScaleHandle(handle)) {
            mode = 'scale';
          } else if (handle === 'body') {
            if (transformTool === 'rotate') {
              mode = 'rotate';
              handle = 'rotate';
              pivot = bounds.center;
            } else if (transformTool === 'scale') {
              mode = 'scale';
              handle = 'ne';
              pivot = bounds.center;
            }
          }
          uvDrag.current = {
            meshId: ctx.mesh.id,
            layerId: ctx.layerId,
            before: snap,
            startUv: uv,
            moved: false,
            mode,
            handle,
            pivot,
            startAngle: Math.atan2(uv.y - pivot.y, uv.x - pivot.x),
            uniform: mode === 'scale' && (shiftKey || (transformTool === 'scale' && handle === 'body')),
            snapAngle: shiftKey,
            axis: 'none',
          };
          if (mode === 'scale' && (handle === 'n' || handle === 's' || handle === 'e' || handle === 'w')) {
            uvDrag.current.uniform = false;
          }
          session.requestRedraw();
          refresh();
          return;
        }
      }
    }

    const hit = pickUvElement(ctx.mesh, ctx.layerId, uv, pickRadiusPx, canvasImage.width, canvasImage.height);
    if (!hit) {
      beginUvMarquee(clientX, clientY, shiftKey, true);
      return;
    }

    // Double-click → island
    const now = performance.now();
    const dbl =
      hit.kind === 'face' &&
      lastClick.current.faceId === hit.faceId &&
      now - lastClick.current.t < 350;
    lastClick.current = { t: now, faceId: hit.faceId };

    let faceIds: FaceId[] = [];
    let cornerIds: FaceCornerId[] = [];

    if (editMode === 'island' || dbl) {
      const island = islandForFace(ctx.mesh, hit.faceId);
      faceIds = island?.faceIds ?? [hit.faceId];
      cornerIds = island?.cornerIds ?? cornersForFaces(ctx.mesh, faceIds);
    } else if (editMode === 'point') {
      cornerIds =
        hit.kind === 'corner'
          ? expandWeldedUvCorners(ctx.mesh, [hit.cornerId], ctx.layerId)
          : cornersForFaces(ctx.mesh, [hit.faceId]);
      faceIds = uniqueFacesForCorners(ctx.mesh, cornerIds);
    } else {
      faceIds = [hit.faceId];
      cornerIds = cornersForFaces(ctx.mesh, faceIds);
    }

    const alreadyFaces = faceIds.every((id) => session.selection.state.selectedFaceIds.has(id));
    const alreadyCorners =
      cornerIds.length > 0 && cornerIds.every((id) => session.uvSelection.has(id));
    if (!(alreadyFaces && alreadyCorners) || shiftKey) {
      applySelection(ctx, faceIds, cornerIds, op);
    } else if (editMode === 'face' || editMode === 'island') {
      // Keep full selection corners in sync
      session.uvSelection.selectCorners(
        cornersForFaces(ctx.mesh, session.selection.state.selectedFaceIds),
        'replace',
      );
    }

    const selectedCorners = [...session.uvSelection.state.selectedCornerIds];
    if (!selectedCorners.length) {
      session.requestRedraw();
      refresh();
      return;
    }

    const before = snapshotUvs(ctx.mesh, selectedCorners, ctx.layerId);
    const bounds = boundsOfUvs(before)!;
    const mode: UvDragState['mode'] =
      transformTool === 'scale' ? 'scale' : transformTool === 'rotate' ? 'rotate' : 'move';
    uvDrag.current = {
      meshId: ctx.mesh.id,
      layerId: ctx.layerId,
      before,
      startUv: uv,
      moved: false,
      mode,
      handle: mode === 'scale' ? 'ne' : mode === 'rotate' ? 'rotate' : 'body',
      pivot: mode === 'scale' ? bounds.center : bounds.center,
      startAngle: Math.atan2(uv.y - bounds.center.y, uv.x - bounds.center.x),
      uniform: shiftKey,
      snapAngle: shiftKey,
      axis: 'none',
    };
    session.requestRedraw();
    refresh();
  };

  const finishMarquee = () => {
    const box = marquee.current;
    marquee.current = null;
    if (!box || !canvasImage) return;
    const ctx = activeMesh();
    if (!ctx) return;
    const dx = Math.abs(box.currentUv.x - box.startUv.x);
    const dy = Math.abs(box.currentUv.y - box.startUv.y);
    if (dx < 1 / canvasImage.width && dy < 1 / canvasImage.height) {
      session.requestRedraw();
      refresh();
      return;
    }
    const op = box.shiftKey ? 'add' : 'replace';
    const mode = box.currentScreenX >= box.startScreenX ? 'window' : 'crossing';
    if (workspace.texture.uvEditMode === 'point') {
      const corners = cornersInUvRect(ctx.mesh, ctx.layerId, box.startUv, box.currentUv);
      const faces = uniqueFacesForCorners(ctx.mesh, corners);
      applySelection(ctx, faces, corners, op);
    } else {
      const faces = facesInUvRect(ctx.mesh, ctx.layerId, box.startUv, box.currentUv, mode);
      let faceIds = faces;
      if (workspace.texture.uvEditMode === 'island') {
        const expanded = new Set<FaceId>();
        for (const f of faces) {
          const island = islandForFace(ctx.mesh, f);
          for (const id of island?.faceIds ?? [f]) expanded.add(id);
        }
        faceIds = [...expanded];
      }
      applySelection(ctx, faceIds, cornersForFaces(ctx.mesh, faceIds), op);
    }
    session.requestRedraw();
    refresh();
  };

  const updateUvDrag = (clientX: number, clientY: number, shiftKey: boolean) => {
    const drag = uvDrag.current;
    if (!drag || !canvasImage) return;
    const mesh = session.document.meshes.get(drag.meshId);
    if (!mesh) return;
    const uv = screenToUv(clientX, clientY);
    if (!uv) return;
    const cam = editorCamera(workspace.texture);
    // Minimum axis length ≈ 2 screen pixels in UV — stops thin islands exploding.
    const minAxis = Math.max(
      2 / Math.max(1e-6, cam.zoom * canvasImage.width),
      2 / Math.max(1e-6, cam.zoom * canvasImage.height),
    );

    if (drag.mode === 'move') {
      let dx = uv.x - drag.startUv.x;
      let dy = uv.y - drag.startUv.y;
      if (drag.axis === 'u') dy = 0;
      if (drag.axis === 'v') dx = 0;
      // Pixel-snap only with Shift held — continuous drag is the default (accurate).
      if (shiftKey || drag.snapAngle || workspace.texture.uvSnapToPixels) {
        const stepU = 1 / canvasImage.width;
        const stepV = 1 / canvasImage.height;
        dx = Math.round(dx / stepU) * stepU;
        dy = Math.round(dy / stepV) * stepV;
      }
      if (Math.abs(dx) > 1e-10 || Math.abs(dy) > 1e-10) drag.moved = true;
      translateUvsFromSnapshot(mesh, drag.before, drag.layerId, { x: dx, y: dy });
    } else if (drag.mode === 'scale') {
      const uniform = shiftKey || drag.uniform;
      const { scaleU, scaleV } = scaleFactorsFromDrag(
        isScaleHandle(drag.handle) ? drag.handle : 'ne',
        drag.pivot,
        drag.startUv,
        uv,
        uniform,
        minAxis,
      );
      if (Math.abs(scaleU - 1) > 1e-6 || Math.abs(scaleV - 1) > 1e-6) drag.moved = true;
      scaleUvsFromSnapshot(mesh, drag.before, drag.layerId, drag.pivot, scaleU, scaleV);
    } else {
      let angle = Math.atan2(uv.y - drag.pivot.y, uv.x - drag.pivot.x) - drag.startAngle;
      if (shiftKey || drag.snapAngle) {
        const step = Math.PI / 12;
        angle = Math.round(angle / step) * step;
      }
      if (Math.abs(angle) > 1e-6) drag.moved = true;
      rotateUvsFromSnapshot(mesh, drag.before, drag.layerId, drag.pivot, angle);
    }
    session.requestRedraw();
    draw();
  };

  const endUvDrag = () => {
    const drag = uvDrag.current;
    uvDrag.current = null;
    if (!drag || !drag.moved) return;
    const mesh = session.document.meshes.get(drag.meshId);
    if (!mesh) return;
    const after = snapshotUvs(mesh, drag.before.keys(), drag.layerId);
    const name =
      drag.mode === 'scale' ? 'Scale UVs' : drag.mode === 'rotate' ? 'Rotate UVs' : 'Move UVs';
    commitUvEdit(session.history, mesh, drag.layerId, drag.before, after, name, () =>
      session.requestRedraw(),
    );
    session.requestRedraw();
    refresh();
  };

  const mutateSelection = (
    name: string,
    apply: (mesh: NonNullable<ReturnType<typeof activeMesh>>['mesh'], layerId: string, before: UvSnapshot) => void,
  ) => {
    const sel = selectedSnapshot();
    if (!sel) return;
    const before = sel.snap;
    apply(sel.ctx.mesh, sel.ctx.layerId, before);
    const after = snapshotUvs(sel.ctx.mesh, before.keys(), sel.ctx.layerId);
    commitUvEdit(session.history, sel.ctx.mesh, sel.ctx.layerId, before, after, name, () =>
      session.requestRedraw(),
    );
    session.requestRedraw();
    refresh();
  };

  const rotateSelectionBy = (degrees: number) => {
    mutateSelection(`Rotate UVs ${degrees}°`, (mesh, layerId, before) => {
      const bounds = boundsOfUvs(before);
      if (!bounds) return;
      rotateUvsFromSnapshot(mesh, before, layerId, bounds.center, (degrees * Math.PI) / 180);
    });
  };

  const resizeSelectionToPixels = (widthPx: number, heightPx: number) => {
    if (!canvasImage) return;
    const w = Math.max(1, Math.round(widthPx));
    const h = Math.max(1, Math.round(heightPx));
    mutateSelection(`Resize UVs ${w}×${h}`, (mesh, layerId, before) => {
      resizeUvsToSize(mesh, before, layerId, w / canvasImage.width, h / canvasImage.height);
    });
  };

  const scaleSelectionBy = (factor: number) => {
    mutateSelection(`Scale UVs ×${factor}`, (mesh, layerId, before) => {
      const bounds = boundsOfUvs(before);
      if (!bounds) return;
      scaleUvsFromSnapshot(mesh, before, layerId, bounds.center, factor, factor);
    });
  };

  const flipSelection = (axis: 'u' | 'v') => {
    mutateSelection(axis === 'u' ? 'Flip U' : 'Flip V', (mesh, layerId, before) => {
      flipUvs(mesh, before, layerId, axis);
    });
  };

  const nudgeSelection = (du: number, dv: number) => {
    if (!canvasImage) return;
    mutateSelection('Nudge UVs', (mesh, layerId, before) => {
      translateUvsFromSnapshot(mesh, before, layerId, {
        x: du / canvasImage.width,
        y: dv / canvasImage.height,
      });
    });
  };

  const selectAllPoints = () => {
    const ctx = activeMesh();
    if (!ctx) return;
    const faceIds =
      session.selection.state.selectedFaceIds.size > 0
        ? [...session.selection.state.selectedFaceIds]
        : [...ctx.mesh.faces.keys()];
    if (!session.selection.state.selectedFaceIds.size) {
      syncFacesFromUv(faceIds, ctx.objectId, 'replace');
    }
    session.uvSelection.selectCorners(cornersForFaces(ctx.mesh, faceIds), 'replace');
    armUv({ uvEditMode: 'point', uvPanelTab: 'edit' });
    session.requestRedraw();
    refresh();
  };

  const frameSelection = () => {
    const host = hostRef.current;
    if (!host || !canvasImage) return;
    const sel = selectedSnapshot();
    const bounds = sel
      ? boundsOfUvs(sel.snap)
      : { min: { x: 0, y: 0 }, max: { x: 1, y: 1 }, center: { x: 0.5, y: 0.5 }, size: { x: 1, y: 1 } };
    if (!bounds) return;
    const cam = cameraToFrameUvBounds(
      bounds,
      canvasImage.width,
      canvasImage.height,
      host.clientWidth,
      host.clientHeight,
    );
    workspace.patchTexture({ uvCamera: cam, pixelCamera: cam });
  };

  const focusSelected3dFace = () => {
    const ctx = activeMesh();
    if (!ctx) return;
    const faceIds = [...session.selection.state.selectedFaceIds].filter((id) => ctx.mesh.faces.has(id));
    if (!faceIds.length) return;
    session.uvSelection.selectCorners(cornersForFaces(ctx.mesh, faceIds), 'replace');
    armUv({ uvEditMode: 'face', uvTransformTool: 'move', uvPanelTab: 'edit' });
    workspace.patchTexture({ uvSelectionSync: 'face' });
    session.requestRedraw();
    refresh();
  };

  useEffect(() => {
    if (!tex.uvAutoFrame3dSelection || session.selectionSource !== 'viewport' || !selectedFaceKey) return;
    const signature = `${session.selection.state.activeObjectId ?? ''}:${selectedFaceKey}:${ctxInfo.imageId ?? ''}`;
    if (signature === lastAutoFollowedFace.current) return;
    lastAutoFollowedFace.current = signature;
    const frame = requestAnimationFrame(frameSelection);
    return () => cancelAnimationFrame(frame);
    // Only viewport-originated picks auto-frame; UV canvas selection keeps the user's camera.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tex.uvAutoFrame3dSelection, selectedFaceKey, session.selection.state.activeObjectId, ctxInfo.imageId]);

  const stepZoom = (direction: -1 | 1) => {
    const cam = editorCamera(tex);
    const host = hostRef.current;
    const mx = host ? host.clientWidth / 2 : 0;
    const my = host ? host.clientHeight / 2 : 0;
    const current = UV_ZOOM_STEPS.reduce((best, step) => (
      Math.abs(step - cam.zoom) < Math.abs(best - cam.zoom) ? step : best
    ), UV_ZOOM_STEPS[0]!);
    const index = Math.max(0, Math.min(UV_ZOOM_STEPS.length - 1, UV_ZOOM_STEPS.indexOf(current) + direction));
    const nextZoom = UV_ZOOM_STEPS[index]!;
    const next = zoomCameraAt(cam, mx, my, nextZoom / Math.max(1e-6, cam.zoom), UV_ZOOM_MIN, UV_ZOOM_MAX);
    workspace.patchTexture({ uvCamera: next, pixelCamera: next });
  };

  const actualPixels = () => {
    const host = hostRef.current;
    if (!host || !canvasImage) return;
    const cam = {
      zoom: 1,
      panX: (host.clientWidth - canvasImage.width) / 2,
      panY: (host.clientHeight - canvasImage.height) / 2,
    };
    workspace.patchTexture({ uvCamera: cam, pixelCamera: cam });
  };

  useEffect(() => {
    if (!image) return;
    const frameKey = `${image.id}:${image.width}x${image.height}`;
    if (lastAutoFramedImage.current === frameKey) return;
    lastAutoFramedImage.current = frameKey;
    const frame = requestAnimationFrame(frameSelection);
    return () => cancelAnimationFrame(frame);
    // Frame when the active image or its size changes (default texture hydrate).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [image?.id, image?.width, image?.height]);

  const runPack = async () => {
    const ctx = activeMesh();
    if (!ctx) return;
    const faceIds =
      session.selection.state.selectedFaceIds.size > 0
        ? [...session.selection.state.selectedFaceIds]
        : [...ctx.mesh.faces.keys()];
    const before = snapshotUvs(ctx.mesh, cornersForFaces(ctx.mesh, faceIds), ctx.layerId);
    try {
      await packUvsAsync(ctx.mesh, faceIds, 0.01, ctx.layerId);
    } catch (error) {
      pushToast(error instanceof Error ? error.message : 'UV packing failed', 'error');
      return;
    }
    const after = snapshotUvs(ctx.mesh, before.keys(), ctx.layerId);
    commitUvEdit(session.history, ctx.mesh, ctx.layerId, before, after, 'Pack UVs', () =>
      session.requestRedraw(),
    );
    session.requestRedraw();
    refresh();
  };

  const runUnwrap = (mode: UvUnwrapMode) => {
    const ctx = activeMesh();
    if (!ctx) return;
    const faceIds =
      session.selection.state.selectedFaceIds.size > 0
        ? [...session.selection.state.selectedFaceIds]
        : [...ctx.mesh.faces.keys()];
    const corners = cornersForFaces(ctx.mesh, faceIds);
    const before = snapshotUvs(ctx.mesh, corners, ctx.layerId);
    const cam = workspace.getCamera(workspace.activeViewportId);
    const view = viewAxesFromCamera(
      v3(cam.position[0], cam.position[1], cam.position[2]),
      v3(cam.target[0], cam.target[1], cam.target[2]),
      v3(cam.up[0], cam.up[1], cam.up[2]),
    );
    unwrapUvs(ctx.mesh, faceIds, mode, ctx.layerId, { view });
    const after = snapshotUvs(ctx.mesh, corners, ctx.layerId);
    const labels: Record<UvUnwrapMode, string> = {
      smart: 'Smart UV',
      auto: 'Auto UV',
      angle: 'Angle-based UV',
      box: 'Box UV',
      cubic: 'Cubic UV',
      cylinder: 'Cylinder UV',
      sphere: 'Sphere UV',
      view: 'Project from View',
      planar: 'Planar UV',
    };
    commitUvEdit(session.history, ctx.mesh, ctx.layerId, before, after, labels[mode], () =>
      session.requestRedraw(),
    );
    session.requestRedraw();
    refresh();
  };

  const runNormalize = () => {
    mutateSelection('Normalize UVs', (mesh, layerId, before) => {
      normalizeUvsToUnit(mesh, before, layerId);
    });
  };

  const runStraighten = () => {
    mutateSelection('Straighten UVs', (mesh, layerId, before) => {
      straightenSelectedUvs(mesh, before.keys(), layerId);
    });
  };

  const runRelax = () => {
    mutateSelection('Relax UVs', (mesh, layerId, before) => {
      relaxSelectedUvs(mesh, before.keys(), layerId, 8, 0.35);
    });
  };

  const runRotateToEdge = () => {
    mutateSelection('Rotate UVs to Edge', (mesh, layerId, before) => {
      rotateSelectedUvsToEdge(mesh, before.keys(), layerId);
    });
  };

  const atlasTilePlacement = () => buildAtlasTilePlacement(tex, image);
  const atlasTileParamsKey = () => buildAtlasTileParamsKey(tex, image?.id ?? '');

  const commitLiveAtlasTileSession = (options?: { clear?: boolean }) => {
    const live = liveAtlasTile.current;
    if (!live) return;
    if (live.dirty) {
      const object = session.document.objects.get(live.objectId);
      const mesh = object?.meshId ? session.document.meshes.get(object.meshId) : null;
      if (mesh && mesh.id === live.meshId) {
        const after = snapshotUvs(mesh, live.before.keys(), live.layerId);
        const afterTiles = snapshotAtlasTiles(mesh, live.before.keys());
        const before = live.before;
        const beforeTiles = live.beforeTiles;
        let applied = true;
        session.history.execute({
          name: 'Apply Atlas Tile',
          execute: () => {
            if (applied) return;
            for (const [cornerId, uv] of after) {
              const corner = mesh.faceCorners.get(cornerId);
              if (corner) corner.uvs.set(live.layerId, { x: uv.x, y: uv.y });
            }
            applyAtlasTileSnapshot(mesh, afterTiles);
            mesh.geometryVersion += 1;
            mesh.dirty.uvs = true;
            applied = true;
            session.requestRedraw();
          },
          undo: () => {
            restoreUvAndAtlasSnapshot(mesh, live.layerId, before, beforeTiles);
            applied = false;
            session.requestRedraw();
          },
        });
      }
      live.dirty = false;
    }
    if (options?.clear) liveAtlasTile.current = null;
  };

  const previewAtlasTileLive = (explicitFaceIds?: FaceId[], options?: { commit?: boolean; advance?: boolean }) => {
    const placement = atlasTilePlacement();
    const ctx = activeMesh();
    if (!placement || !ctx || !image) return;
    const live = liveAtlasTile.current;
    const faceIds = explicitFaceIds?.length
      ? explicitFaceIds
      : live && live.objectId === ctx.objectId && live.meshId === ctx.mesh.id && selectedFaceKey === live.sourceSelectionKey
        ? live.faceIds
        : session.selection.state.selectedFaceIds.size
          ? [...session.selection.state.selectedFaceIds]
          : uniqueFacesForCorners(ctx.mesh, [...session.uvSelection.state.selectedCornerIds]);
    if (!faceIds.length) return;
    const sourceSelectionKey = [...faceIds].sort().join('|');
    const paramsKey = atlasTileParamsKey();

    let sessionLive = live;
    if (
      !sessionLive ||
      sessionLive.objectId !== ctx.objectId ||
      sessionLive.meshId !== ctx.mesh.id ||
      sessionLive.sourceSelectionKey !== sourceSelectionKey
    ) {
      if (sessionLive) commitLiveAtlasTileSession({ clear: true });
      const corners = cornersForFaces(ctx.mesh, faceIds);
      sessionLive = {
        objectId: ctx.objectId,
        meshId: ctx.mesh.id,
        layerId: ctx.layerId,
        faceIds: [...faceIds],
        before: snapshotUvs(ctx.mesh, corners, ctx.layerId),
        beforeTiles: snapshotAtlasTiles(ctx.mesh, corners),
        sourceSelectionKey,
        paramsKey: '',
        dirty: false,
      };
      liveAtlasTile.current = sessionLive;
    }

    if (sessionLive.paramsKey === paramsKey && !options?.advance) {
      if (options?.commit) commitLiveAtlasTileSession();
      return;
    }

    restoreUvAndAtlasSnapshot(ctx.mesh, sessionLive.layerId, sessionLive.before, sessionLive.beforeTiles);
    applyAtlasTileToFaces(ctx.mesh, sessionLive.faceIds, sessionLive.layerId, placement);
    sessionLive.paramsKey = paramsKey;
    sessionLive.dirty = true;

    const object = session.document.objects.get(ctx.objectId);
    if (object) {
      object.metadata.atlasTileSize = `${tex.atlasTileWidth}x${tex.atlasTileHeight}`;
      object.metadata.atlasRepeat = `${tex.atlasRepeatU}x${tex.atlasRepeatV}`;
      object.metadata.atlasImage = image.name;
    }
    session.document.dirty = true;
    session.requestRedraw();
    refresh();

    if (options?.commit) commitLiveAtlasTileSession();

    if (options?.advance && tex.atlasAutoAdvance) {
      let nextX = tex.atlasTileX + tex.atlasTileWidth + tex.atlasMarginX;
      let nextY = tex.atlasTileY;
      if (nextX >= image.width) {
        nextX = 0;
        nextY += tex.atlasTileHeight + tex.atlasMarginY;
        if (nextY >= image.height) nextY = 0;
      }
      workspace.patchTexture({ atlasTileX: nextX, atlasTileY: nextY });
    }
  };

  const applySelectedAtlasTile = (explicitFaceIds?: FaceId[], advance = false) => {
    previewAtlasTileLive(explicitFaceIds, { commit: true, advance });
  };

  const liveTileParamsRef = useRef('');
  const liveTileSelectionRef = useRef('');

  // Live UV tile stamps (cheap — no topology rebuild).
  useEffect(() => {
    const tilesActive = tex.atlasPanelOpen || tex.uvPanelTab === 'tiles';
    if (!tilesActive) {
      commitLiveAtlasTileSession({ clear: true });
      liveTileParamsRef.current = '';
      liveTileSelectionRef.current = '';
      return;
    }
    if (!image) return;

    const paramsKey = atlasTileParamsKey();
    const live = liveAtlasTile.current;
    const selectionIsLive = !!(live && selectedFaceKey === live.sourceSelectionKey);

    if (!selectedFaceKey) {
      commitLiveAtlasTileSession({ clear: true });
      liveTileParamsRef.current = '';
      liveTileSelectionRef.current = '';
      return;
    }

    if (live && !selectionIsLive) commitLiveAtlasTileSession({ clear: true });

    if (!selectionIsLive) {
      if (selectedFaceKey !== liveTileSelectionRef.current) {
        liveTileSelectionRef.current = selectedFaceKey;
        liveTileParamsRef.current = paramsKey;
        return;
      }
      if (paramsKey === liveTileParamsRef.current) return;
    }

    liveTileParamsRef.current = paramsKey;
    liveTileSelectionRef.current = selectedFaceKey;
    previewAtlasTileLive();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    image?.id,
    selectedFaceKey,
    tex.atlasPanelOpen,
    tex.uvPanelTab,
    tex.atlasTileX,
    tex.atlasTileY,
    tex.atlasTileWidth,
    tex.atlasTileHeight,
    tex.atlasSelectionColumns,
    tex.atlasSelectionRows,
    tex.atlasMarginX,
    tex.atlasMarginY,
    tex.atlasPadding,
    tex.atlasQuarterTurns,
    tex.atlasFlipU,
    tex.atlasFlipV,
    tex.atlasRepeatU,
    tex.atlasRepeatV,
  ]);

  const createAtlasTilePlane = () => {
    if (!image || !tilesetMaterialId) return;
    const tileWidth = Math.min(image.width, tex.atlasTileWidth);
    const tileHeight = Math.min(image.height, tex.atlasTileHeight);
    const regionWidth = tileWidth * tex.atlasSelectionColumns + tex.atlasMarginX * (tex.atlasSelectionColumns - 1);
    const regionHeight = tileHeight * tex.atlasSelectionRows + tex.atlasMarginY * (tex.atlasSelectionRows - 1);
    const repeatU = Math.max(1, Math.min(64, Math.round(tex.atlasRepeatU)));
    const repeatV = Math.max(1, Math.min(64, Math.round(tex.atlasRepeatV)));
    const cellWidth = tex.atlasUsePixelDensity
      ? regionWidth / Math.max(1, tex.atlasPixelsPerUnit)
      : Math.max(0.01, tex.atlasPlaneSize) * (regionWidth / regionHeight);
    const cellHeight = tex.atlasUsePixelDensity
      ? regionHeight / Math.max(1, tex.atlasPixelsPerUnit)
      : Math.max(0.01, tex.atlasPlaneSize);
    const mesh = buildPlane({
      width: cellWidth * repeatU,
      depth: cellHeight * repeatV,
      name: 'Tile Plane',
    });
    if (tex.atlasPlaneOrientation !== 'floor') {
      for (const vertex of mesh.vertices.values()) {
        const oldX = vertex.position.x;
        const oldZ = vertex.position.z;
        if (tex.atlasPlaneOrientation === 'wall-x') {
          vertex.position = { x: oldX, y: oldZ, z: 0 };
        } else {
          vertex.position = { x: 0, y: oldZ, z: oldX };
        }
      }
      mesh.geometryVersion += 1;
      mesh.dirty.positions = true;
      mesh.dirty.bounds = true;
    }
    applyAtlasTileToFaces(mesh, [[...mesh.faces.keys()][0]!], mesh.defaultUvLayerId!, {
      imageWidth: image.width,
      imageHeight: image.height,
      x: tex.atlasTileX,
      y: tex.atlasTileY,
      width: regionWidth,
      height: regionHeight,
      padding: tex.atlasPadding,
      quarterTurns: tex.atlasQuarterTurns,
      flipU: tex.atlasFlipU,
      flipV: tex.atlasFlipV,
      repeatU,
      repeatV,
    });

    const committed = commitMeshObject(session.document, mesh, {
      name:
        repeatU === 1 && repeatV === 1
          ? `Tile_${Math.floor(tex.atlasTileX / tileWidth)}_${Math.floor(tex.atlasTileY / tileHeight)}`
          : `Tile_${Math.floor(tex.atlasTileX / tileWidth)}_${Math.floor(tex.atlasTileY / tileHeight)}_${repeatU}x${repeatV}`,
      materialId: tilesetMaterialId,
    });
    const object = session.document.objects.get(committed.objectId)!;
    object.metadata.atlasTile = `${tex.atlasTileX},${tex.atlasTileY},${tileWidth},${tileHeight}`;
    object.metadata.atlasRepeat = `${repeatU}x${repeatV}`;
    object.metadata.atlasImage = image.name;
    session.selection.setMode('object');
    session.selection.selectObjects([object.id], 'replace');
    session.document.dirty = true;
    session.requestRedraw();
    refresh();
  };

  const createAtlasGrid = () => {
    if (!image || !tilesetMaterialId) return;
    const mesh = buildAtlasTileGrid({
      columns: tex.atlasFillColumns,
      rows: tex.atlasFillRows,
      cellSize: tex.atlasPlaneSize,
      cellWidth: tex.atlasUsePixelDensity
        ? tex.atlasTileWidth / Math.max(1, tex.atlasPixelsPerUnit)
        : tex.atlasPlaneSize,
      cellHeight: tex.atlasUsePixelDensity
        ? tex.atlasTileHeight / Math.max(1, tex.atlasPixelsPerUnit)
        : tex.atlasPlaneSize,
      orientation: tex.atlasPlaneOrientation,
      imageWidth: image.width,
      imageHeight: image.height,
      tileX: tex.atlasTileX,
      tileY: tex.atlasTileY,
      tileWidth: tex.atlasTileWidth,
      tileHeight: tex.atlasTileHeight,
      marginX: tex.atlasMarginX,
      marginY: tex.atlasMarginY,
      selectionColumns: tex.atlasSelectionColumns,
      selectionRows: tex.atlasSelectionRows,
      padding: tex.atlasPadding,
      quarterTurns: tex.atlasQuarterTurns,
      flipU: tex.atlasFlipU,
      flipV: tex.atlasFlipV,
      name: 'Atlas Tile Grid',
      pattern: tex.atlasFillPattern,
      randomSeed: tex.atlasRandomSeed,
    });
    const committed = commitMeshObject(session.document, mesh, {
      name: `TileGrid_${tex.atlasFillColumns}x${tex.atlasFillRows}`,
      materialId: tilesetMaterialId,
    });
    const object = session.document.objects.get(committed.objectId)!;
    object.metadata.atlasGrid = `${tex.atlasFillColumns}x${tex.atlasFillRows}`;
    object.metadata.atlasImage = image.name;
    session.selection.setMode('object');
    session.selection.selectObjects([object.id], 'replace');
    session.document.dirty = true;
    session.requestRedraw();
    refresh();
  };

  const pickAtlasTileFromFace = () => {
    const ctx = activeMesh();
    const faceId = session.selection.state.activeFaceId;
    if (!ctx || !faceId || !image || !ctx.mesh.faces.has(faceId)) return;
    const corners = faceCornerIds(ctx.mesh, faceId);
    const bounds = boundsOfUvs(snapshotUvs(ctx.mesh, corners, ctx.layerId));
    if (!bounds) return;
    const stepX = tex.atlasTileWidth + tex.atlasMarginX;
    const stepY = tex.atlasTileHeight + tex.atlasMarginY;
    const pixelLeft = bounds.min.x * image.width;
    const pixelTop = (1 - bounds.max.y) * image.height;
    const tileX = tex.atlasOffsetX + Math.round((pixelLeft - tex.atlasOffsetX) / stepX) * stepX;
    const tileY = tex.atlasOffsetY + Math.round((pixelTop - tex.atlasOffsetY) / stepY) * stepY;
    workspace.patchTexture({
      atlasTileX: Math.max(tex.atlasOffsetX, Math.min(image.width - tex.atlasTileWidth, tileX)),
      atlasTileY: Math.max(tex.atlasOffsetY, Math.min(image.height - tex.atlasTileHeight, tileY)),
      atlasSelectionColumns: Math.max(1, Math.round((bounds.size.x * image.width + tex.atlasMarginX) / stepX)),
      atlasSelectionRows: Math.max(1, Math.round((bounds.size.y * image.height + tex.atlasMarginY) / stepY)),
      uvPanelTab: 'tiles',
    });
  };

  const eraseSelectedTileFaces = () => {
    if (!session.selection.state.selectedFaceIds.size) return;
    session.selection.setMode('face');
    commitDeleteSelection(session);
    session.requestRedraw();
    refresh();
  };

  const fillConnectedTileFaces = () => {
    const ctx = activeMesh();
    const activeFace = session.selection.state.activeFaceId;
    if (!ctx || !activeFace) return;
    session.selection.setMode('face');
    session.selection.selectFaces([activeFace], 'replace');
    session.selection.selectConnected(ctx.mesh);
    applySelectedAtlasTile();
  };

  const toggleTileDraw = () => {
    toggleTileDrawTool(session, workspace);
    refresh();
  };

  useEffect(() => {
    if (session.tools.getActive()?.id !== 'tile-draw') return;
    applyTileDrawToolConfig(session, workspace);
    // Live tile-board changes update the active 3D draw tool.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    image?.id,
    ctxInfo.materialId,
    tex.atlasDrawMode,
    tex.atlasDrawShape,
    tex.atlasAutoTile,
    tex.atlasTileX,
    tex.atlasTileY,
    tex.atlasTileWidth,
    tex.atlasTileHeight,
    tex.atlasMarginX,
    tex.atlasMarginY,
    tex.atlasSelectionColumns,
    tex.atlasSelectionRows,
    tex.atlasPadding,
    tex.atlasQuarterTurns,
    tex.atlasFlipU,
    tex.atlasFlipV,
    tex.atlasUsePixelDensity,
    tex.atlasPixelsPerUnit,
    tex.atlasPlaneSize,
    tex.atlasWorldTileWidth,
    tex.atlasWorldTileHeight,
    tex.atlasSurfaceLocked,
    tex.atlasFillPattern,
    tex.atlasRandomSeed,
    tex.atlasTileLayer,
    tex.atlasPlaneOrientation,
  ]);

  useEffect(() => {
    if (!tileDrawActive) return;
    const picked = tileDrawTool.consumePickedTile();
    if (!picked) return;
    workspace.patchTexture({
      atlasTileX: picked.tileX,
      atlasTileY: picked.tileY,
      atlasQuarterTurns: picked.quarterTurns,
      atlasFlipU: picked.flipU,
      atlasFlipV: picked.flipV,
      atlasDrawMode: 'paint',
      uvPanelTab: 'tiles',
    });
    rememberAtlasStamp(workspace);
  }, [tileDrawActive, tileDrawRevision, tileDrawTool, workspace]);

  useEffect(() => {
    if (!tex.atlasPaintMode) {
      lastTileBrushedFace.current = null;
      return;
    }
    const faceId = session.selection.state.activeFaceId;
    const objectId = session.selection.state.activeObjectId;
    if (!faceId || !objectId) return;
    const key = `${objectId}:${faceId}`;
    if (lastTileBrushedFace.current === key) return;
    lastTileBrushedFace.current = key;
    applySelectedAtlasTile([faceId], true);
    // Apply once when a different 3D face becomes active.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tex.atlasPaintMode, session.selection.state.activeFaceId, session.selection.state.activeObjectId]);

  const runWeld = () => {
    const sel = selectedSnapshot();
    if (!sel) return;
    const before = weldSelectedUvs(sel.ctx.mesh, sel.corners, sel.ctx.layerId);
    const after = snapshotUvs(sel.ctx.mesh, before.keys(), sel.ctx.layerId);
    commitUvEdit(session.history, sel.ctx.mesh, sel.ctx.layerId, before, after, 'Weld UVs', () =>
      session.requestRedraw(),
    );
    session.requestRedraw();
    refresh();
  };

  const runSplit = () => {
    const sel = selectedSnapshot();
    if (!sel) return;
    const before = splitSelectedUvs(sel.ctx.mesh, sel.corners, sel.ctx.layerId);
    const after = snapshotUvs(sel.ctx.mesh, before.keys(), sel.ctx.layerId);
    commitUvEdit(session.history, sel.ctx.mesh, sel.ctx.layerId, before, after, 'Split UVs', () =>
      session.requestRedraw(),
    );
    session.requestRedraw();
    refresh();
  };

  const flipSelectedFaces = () => {
    const ctx = activeMesh();
    if (!ctx) return;
    const faceIds = [...session.selection.state.selectedFaceIds].filter((id) => ctx.mesh.faces.has(id));
    if (!faceIds.length) {
      pushToast('Select one or more faces to flip.', 'info');
      return;
    }

    const before = cloneMeshPreserveIds(ctx.mesh);
    const result = flipFaces(ctx.mesh, faceIds);
    if (!result.ok) {
      restoreMeshFromSnapshot(ctx.mesh, before);
      pushToast(result.error?.message ?? 'Could not flip the selected faces.', 'error');
      return;
    }
    const after = cloneMeshPreserveIds(ctx.mesh);
    const selectedFaceIds = result.change.recommendedSelection.faceIds ?? faceIds;
    let applied = true;
    const applySelection = (ids: FaceId[]) => {
      session.selection.setMode('face');
      session.selection.selectFaces(ids, 'replace');
    };

    session.history.execute({
      name: 'Flip Faces',
      execute: () => {
        if (applied) return;
        restoreMeshFromSnapshot(ctx.mesh, after);
        applySelection(selectedFaceIds);
        applied = true;
        session.requestRedraw();
      },
      undo: () => {
        restoreMeshFromSnapshot(ctx.mesh, before);
        applySelection(faceIds);
        applied = false;
        session.requestRedraw();
      },
    });
    applySelection(selectedFaceIds);
    session.requestRedraw();
    refresh();
  };

  const commitSeamEdit = (name: string, apply: () => void) => {
    const ctx = activeMesh();
    if (!ctx) return;
    const before = snapshotSeams(ctx.mesh);
    apply();
    const after = snapshotSeams(ctx.mesh);
    let applied = true;
    session.history.execute({
      name,
      execute: () => {
        if (applied) return;
        applySeamSnapshot(ctx.mesh, after);
        applied = true;
        session.requestRedraw();
      },
      undo: () => {
        applySeamSnapshot(ctx.mesh, before);
        applied = false;
        session.requestRedraw();
      },
    });
    session.requestRedraw();
    refresh();
  };

  const toggleSeams = (seam: boolean) => {
    const ctx = activeMesh();
    if (!ctx) return;
    const edgeIds = [...session.selection.state.selectedEdgeIds];
    if (!edgeIds.length) return;
    commitSeamEdit(seam ? 'Mark UV Seams' : 'Clear UV Seams', () => {
      markUvSeams(ctx.mesh, edgeIds, seam);
    });
  };

  const autoMarkSeams = () => {
    const ctx = activeMesh();
    if (!ctx) return;
    commitSeamEdit('Auto UV Seams (45°)', () => {
      markUvSeamsByAngle(ctx.mesh, 45);
    });
  };

  const clearSeams = () => {
    const ctx = activeMesh();
    if (!ctx) return;
    commitSeamEdit('Clear All UV Seams', () => {
      clearAllUvSeams(ctx.mesh);
    });
  };

  const applyUvCanvasNav = (kind: 'pan' | 'zoom', dx: number, dy: number, clientX: number, clientY: number) => {
    const cam = editorCamera(workspace.texture);
    const host = hostRef.current;
    if (kind === 'pan') {
      const next = { panX: cam.panX + dx, panY: cam.panY + dy, zoom: cam.zoom };
      workspace.patchTexture({ uvCamera: next, pixelCamera: next });
      return;
    }
    const rect = host?.getBoundingClientRect();
    const mx = rect ? clientX - rect.left : (host?.clientWidth ?? 0) / 2;
    const my = rect ? clientY - rect.top : (host?.clientHeight ?? 0) / 2;
    const next = zoomCameraAt(cam, mx, my, Math.exp(-dy * 0.008), UV_ZOOM_MIN, UV_ZOOM_MAX);
    workspace.patchTexture({ uvCamera: next, pixelCamera: next });
  };

  const beginCanvasNav = (kind: 'pan' | 'zoom', e: React.PointerEvent) => {
    e.preventDefault();
    const cam = editorCamera(workspace.texture);
    panning.current = {
      kind,
      x: e.clientX,
      y: e.clientY,
      panX: cam.panX,
      panY: cam.panY,
      zoom: cam.zoom,
    };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onPointerDown = (e: React.PointerEvent) => {
    const chord = canvasNavKind(classifyPointerButton(e.button), {
      altKey: e.altKey,
      shiftKey: e.shiftKey,
      ctrlKey: e.ctrlKey || e.metaKey,
    });
    if (chord) {
      beginCanvasNav(chord, e);
      return;
    }

    if (e.button === 0 && canvasNavMode === 'select' && canvasImage && activeMesh()) {
      e.preventDefault();
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      beginUvMarquee(e.clientX, e.clientY, e.shiftKey, true);
      return;
    }
    if (e.button === 0 && (canvasNavMode === 'pan' || canvasNavMode === 'zoom')) {
      beginCanvasNav(canvasNavMode, e);
      return;
    }

    const useBackground = e.button === 2;
    if (e.button !== 0 && e.button !== 2) return;

    // Ctrl/Cmd+LMB marquee works in paint and UV modes (not with Alt — that's zoom).
    if (e.button === 0 && (e.ctrlKey || e.metaKey) && !e.altKey && canvasImage && activeMesh()) {
      e.preventDefault();
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      beginUvMarquee(e.clientX, e.clientY, e.shiftKey, true);
      return;
    }

    if (uvPointerActive) {
      if (e.button !== 0) return;
      e.preventDefault();
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      beginUvInteraction(e.clientX, e.clientY, e.shiftKey, e.ctrlKey || e.metaKey);
      return;
    }

    e.preventDefault();

    if (workspace.texture.pixelTool === 'fill' && image) {
      const p = screenToPixel(e.clientX, e.clientY);
      if (p) {
        const fillColour = useBackground
          ? workspace.texture.background
          : workspace.texture.foreground;
        const before = clonePaintTarget(image);
        let count = 0;
        for (const target of mirroredPaintPixels(
          image.width,
          image.height,
          p,
          workspace.texture.paintMirrorX,
          workspace.texture.paintMirrorY,
        )) {
          count += floodFill(image, target.x, target.y, fillColour, {
            tolerance: workspace.texture.fillTolerance,
            contiguous: workspace.texture.fillContiguous,
          });
        }
        if (count) {
          const after = clonePaintTarget(image);
          let applied = true;
          session.history.execute({
            name: 'Fill Pixels',
            execute: () => {
              if (applied) return;
              applyPaintTarget(image, after);
              applied = true;
              session.requestRedraw();
            },
            undo: () => {
              applyPaintTarget(image, before);
              applied = false;
              session.requestRedraw();
            },
          });
        }
        session.requestRedraw();
        draw();
      }
      return;
    }
    if (workspace.texture.pixelTool === 'eyedropper' && image) {
      const p = screenToPixel(e.clientX, e.clientY);
      const sampled = p ? getPixel(image, p.x, p.y) : null;
      if (sampled) {
        workspace.patchTexture({
          foreground: [...sampled] as [number, number, number, number],
          pixelTool: 'pencil',
        });
      }
      return;
    }
    if (workspace.texture.pixelTool === 'replace' && image) {
      const p = screenToPixel(e.clientX, e.clientY);
      const source = p ? getPaintPixel(image, p.x, p.y) : null;
      if (!source) return;
      const replacement = useBackground ? workspace.texture.background : workspace.texture.foreground;
      const before = clonePaintTarget(image);
      const buf = getPaintTarget(image);
      let changed = 0;
      for (let i = 0; i < buf.length; i += 4) {
        if (buf[i] === source[0] && buf[i + 1] === source[1] && buf[i + 2] === source[2] && buf[i + 3] === source[3]) {
          buf[i] = replacement[0]; buf[i + 1] = replacement[1]; buf[i + 2] = replacement[2]; buf[i + 3] = replacement[3]; changed++;
        }
      }
      if (changed) {
        applyPaintTarget(image, buf);
        const after = clonePaintTarget(image);
        let applied = true;
        session.history.execute({
          name: 'Replace Colour',
          execute: () => { if (!applied) { applyPaintTarget(image, after); applied = true; session.requestRedraw(); } },
          undo: () => { applyPaintTarget(image, before); applied = false; session.requestRedraw(); },
        });
      }
      session.requestRedraw(); draw();
      return;
    }
    if ((workspace.texture.pixelTool === 'line' || workspace.texture.pixelTool === 'rectangle' || workspace.texture.pixelTool === 'ellipse') && image) {
      const p = screenToPixel(e.clientX, e.clientY);
      if (!p) return;
      stroke.current.begin(image);
      pixelShapeDrag.current = { start: p, current: p, useBackground };
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      return;
    }
    painting.current = true;
    lastPaintPixel.current = null;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    paintAt(e.clientX, e.clientY, useBackground);
  };

  const hoverGizmoCursor = (clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas || !canvasImage || !uvPointerActive) {
      if (canvas) canvas.style.cursor = uvPointerActive ? 'crosshair' : 'cell';
      return;
    }
    if (uvDrag.current) {
      canvas.style.cursor =
        uvDrag.current.mode === 'rotate' ? 'grabbing' : uvGizmoCursor(uvDrag.current.handle);
      return;
    }
    const ctx = activeMesh();
    const uv = screenToUv(clientX, clientY);
    if (!ctx || !uv) {
      canvas.style.cursor = 'crosshair';
      return;
    }
    const corners = resolveSelectedCorners(ctx.mesh, session, workspace.texture);
    if (!corners.length) {
      canvas.style.cursor = 'crosshair';
      return;
    }
    const bounds = boundsOfUvs(snapshotUvs(ctx.mesh, corners, ctx.layerId));
    if (!bounds) {
      canvas.style.cursor = 'crosshair';
      return;
    }
    const cam = editorCamera(workspace.texture);
    const hitPx = Math.max(UV_GIZMO_PX.handleHit, UV_GIZMO_PX.edgeHit);
    const radiusU = hitPx / Math.max(1e-6, cam.zoom * canvasImage.width);
    const radiusV = hitPx / Math.max(1e-6, cam.zoom * canvasImage.height);
    const rotateOffsetV = UV_GIZMO_PX.rotateStem / Math.max(1e-6, cam.zoom * canvasImage.height);
    const gizmo = pickUvGizmo(uv, bounds, radiusU, radiusV, rotateOffsetV);
    canvas.style.cursor = uvGizmoCursor(gizmo?.handle ?? null);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    hoverPixel.current = screenToPixel(e.clientX, e.clientY);
    if (panning.current) {
      const dx = e.clientX - panning.current.x;
      const dy = e.clientY - panning.current.y;
      panning.current.x = e.clientX;
      panning.current.y = e.clientY;
      applyUvCanvasNav(panning.current.kind, dx, dy, e.clientX, e.clientY);
      draw();
      return;
    }
    if (marquee.current) {
      const uv = screenToUv(e.clientX, e.clientY);
      if (uv) {
        marquee.current.currentUv = uv;
        marquee.current.currentScreenX = e.clientX;
        marquee.current.shiftKey = e.shiftKey;
        draw();
      }
      return;
    }
    if (uvDrag.current) {
      updateUvDrag(e.clientX, e.clientY, e.shiftKey);
      hoverGizmoCursor(e.clientX, e.clientY);
      return;
    }
    if (pixelShapeDrag.current) {
      const p = screenToPixel(e.clientX, e.clientY);
      if (p) pixelShapeDrag.current.current = p;
      draw();
      return;
    }
    if (painting.current) {
      paintAt(e.clientX, e.clientY, e.buttons === 2);
      return;
    }
    if (uvPointerActive) hoverGizmoCursor(e.clientX, e.clientY);
    else draw(); // brush preview follows hoverPixel
  };

  const onPointerUp = () => {
    if (panning.current) {
      panning.current = null;
      return;
    }
    if (marquee.current) {
      finishMarquee();
      return;
    }
    if (uvDrag.current) {
      endUvDrag();
      return;
    }
    if (pixelShapeDrag.current) {
      commitPixelShape();
      return;
    }
    if (painting.current) {
      painting.current = false;
      stroke.current.commit(session.history, () => session.requestRedraw());
      lastPaintPixel.current = null;
      session.requestRedraw();
      refresh();
    }
  };

  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const gesture = classifyWheel(e.deltaX, e.deltaY, e.ctrlKey || e.metaKey, e.shiftKey);
    if (gesture.type === 'pan') {
      applyUvCanvasNav('pan', gesture.dx, gesture.dy, e.clientX, e.clientY);
      draw();
      return;
    }
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const cam = editorCamera(workspace.texture);
    const pixels = wheelZoomPixels(e.deltaY, e.nativeEvent.deltaMode);
    const next = zoomCameraAt(cam, mx, my, Math.exp(-pixels * 0.0035), UV_ZOOM_MIN, UV_ZOOM_MAX);
    workspace.patchTexture({ uvCamera: next, pixelCamera: next });
    draw();
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const blockBrowserZoom = (event: WheelEvent) => event.preventDefault();
    canvas.addEventListener('wheel', blockBrowserZoom, { passive: false });
    return () => canvas.removeEventListener('wheel', blockBrowserZoom);
  }, []);

  const activatePaintTool = (pixelTool: typeof tex.pixelTool) => {
    workspace.patchTexture({
      pixelTool,
      uvPointerMode: false,
      // Shape tools are texture-canvas tools; keep 3D painting on the direct brush tools.
      paintMode3D: !['line', 'rectangle', 'ellipse', 'replace'].includes(pixelTool),
      activeRightEditor: tex.activeRightEditor === 'uv' ? 'combined' : tex.activeRightEditor,
      uvPanelTab: 'paint',
      atlasPanelOpen: false,
      atlasPaintMode: false,
    });
  };

  const swapColours = () => {
    workspace.patchTexture({
      foreground: tex.background,
      background: tex.foreground,
    });
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      const key = e.key.toLowerCase();

      if (tileDrawActive && applyTileDrawHotkey(session, workspace, e)) {
        e.preventDefault();
        refresh();
        return;
      }

      const paintTool = paintToolFromHotkey(e.key, e.shiftKey, uvPointerActive);
      if (!e.ctrlKey && !e.metaKey && paintTool) {
        e.preventDefault();
        activatePaintTool(paintTool);
        return;
      }
      if (!e.ctrlKey && !e.metaKey && key === 'x' && !uvPointerActive) {
        e.preventDefault();
        swapColours();
        return;
      }
      if (!e.ctrlKey && !e.metaKey && key === 'c' && !uvPointerActive) {
        e.preventDefault();
        workspace.patchTexture({
          brushShape: tex.brushShape === 'square' ? 'circle' : 'square',
        });
        return;
      }
      if (key === 'd' && !e.ctrlKey && !e.metaKey && !uvPointerActive) {
        e.preventDefault();
        workspace.patchTexture({
          foreground: [0, 0, 0, 255],
          background: [255, 255, 255, 255],
        });
        return;
      }
      if (e.key === '[' || e.key === ']' || e.key === '{' || e.key === '}') {
        e.preventDefault();
        if (e.shiftKey) {
          workspace.patchTexture({
            foreground: shiftShadeColor(tex.foreground, e.key === '{' ? 'darker' : 'lighter'),
          });
        } else {
          workspace.patchTexture({
            brushSize: Math.max(1, Math.min(64, tex.brushSize + (e.key === '[' ? -1 : 1))),
          });
        }
        return;
      }
      if (!uvPointerActive && tex.activeRightEditor !== 'uv') return;

      if (uvDrag.current?.mode === 'move') {
        if (key === 'x') {
          e.preventDefault();
          uvDrag.current.axis = uvDrag.current.axis === 'u' ? 'none' : 'u';
          return;
        }
        if (key === 'y') {
          e.preventDefault();
          uvDrag.current.axis = uvDrag.current.axis === 'v' ? 'none' : 'v';
          return;
        }
      }

      if (key === 'g') {
        e.preventDefault();
        armUv({ uvTransformTool: 'move', uvPanelTab: 'edit' });
      } else if (key === 's' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        armUv({ uvTransformTool: 'scale', uvPanelTab: 'edit' });
      } else if (key === 'r' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        armUv({ uvTransformTool: 'rotate', uvPanelTab: 'edit' });
      } else if (key === 'a' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        selectAllPoints();
      } else if (key === 'l' && !e.ctrlKey) {
        e.preventDefault();
        armUv({ uvEditMode: 'island', uvPanelTab: 'edit' });
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        nudgeSelection(e.shiftKey ? -8 : -1, 0);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        nudgeSelection(e.shiftKey ? 8 : 1, 0);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        nudgeSelection(0, e.shiftKey ? 8 : 1);
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        nudgeSelection(0, e.shiftKey ? -8 : -1);
      } else if (e.key === 'Escape') {
        session.uvSelection.clear();
        session.selection.selectFaces([], 'replace');
        session.requestRedraw();
        refresh();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uvPointerActive, tex.activeRightEditor, workspace, session, image, tileDrawActive, tex.atlasQuarterTurns, tex.atlasFlipU, tex.atlasFlipV, tex.atlasTileX, tex.atlasTileY, tex.atlasDrawMode, tex.atlasDrawShape]);

  const selectionSummary = (() => {
    const sel = selectedSnapshot();
    if (!sel) return null;
    const bounds = boundsOfUvs(sel.snap);
    if (!bounds || !canvasImage) {
      return `${session.uvSelection.size} UV points · ${session.selection.state.selectedFaceIds.size} faces`;
    }
    return `${session.uvSelection.size} pts · ${session.selection.state.selectedFaceIds.size} faces · ${Math.round(bounds.size.x * canvasImage.width)}×${Math.round(bounds.size.y * canvasImage.height)}px`;
  })();
  const uvDiagnostics = (() => {
    const ctx = activeMesh();
    if (!ctx || !canvasImage) return null;
    return analyseUvs(ctx.mesh, ctx.layerId, canvasImage.width, canvasImage.height);
  })();
  const modeSummary = uvPointerActive
    ? `UV ${tex.uvEditMode} · ${tex.uvTransformTool}`
    : `${PIXEL_TOOL_LABELS[tex.pixelTool]} · ${tex.brushSize}px ${tex.brushShape}${tex.paintMode3D ? ' · 3D' : ''}`;
  const activeObjectId = session.selection.state.activeObjectId;

  const handleAlign = (mode: UvAlignMode) => {
    const sel = selectedSnapshot();
    if (!sel || !sel.corners.length) {
      pushToast('Select UV corners or faces to align');
      return;
    }
    mutateSelection(`Align UVs (${mode})`, (mesh, layerId, before) => {
      translateUvsToAlign(mesh, before.keys(), layerId, mode);
    });
  };

  const handleFlatten = (mode: UvAlignMode) => {
    const sel = selectedSnapshot();
    if (!sel || !sel.corners.length) {
      pushToast('Select UV corners or faces to flatten');
      return;
    }
    mutateSelection(`Flatten UVs (${mode})`, (mesh, layerId, before) => {
      alignUvs(mesh, before.keys(), layerId, mode);
    });
  };

  const handleDistribute = (axis: 'u' | 'v') => {
    const sel = selectedSnapshot();
    if (!sel || sel.corners.length < 3) {
      pushToast('Select at least 3 UV corners to distribute');
      return;
    }
    mutateSelection(`Distribute UVs (${axis.toUpperCase()})`, (mesh, layerId, before) => {
      distributeUvs(mesh, before.keys(), layerId, axis);
    });
  };

  const handlePixelSnap = () => {
    const sel = selectedSnapshot();
    if (!sel || !sel.corners.length) {
      pushToast('Select UV corners to snap to pixels');
      return;
    }
    const width = image?.width ?? canvasImage?.width ?? 64;
    const height = image?.height ?? canvasImage?.height ?? 64;
    mutateSelection('Snap UVs to Pixel Grid', (mesh, layerId, before) => {
      snapUvsToPixelGrid(mesh, before.keys(), layerId, width, height);
    });
  };

  const handleImportImageFile = async (file: File | null) => {
    if (!file) return;
    try {
      const result = await importImageFile(session.document, file);
      const activeObjId = session.selection.state.activeObjectId;
      const obj = activeObjId ? session.document.objects.get(activeObjId) : null;
      let matId = obj ? getObjectMaterialId(obj) : null;

      if (!matId && activeObjId) {
        const mat = createMaterial(session.document, {
          assignToObjectId: activeObjId,
          name: file.name.replace(/\.[^/.]+$/, ''),
        });
        matId = mat.id;
      }

      if (matId) {
        const mat = session.document.materials.get(matId);
        if (mat) {
          mat.baseColourTextureId = result.textureId;
          mat.presetId = null;
        }
      }

      workspace.patchTexture({
        activeImageId: result.imageId,
        activeTextureId: result.textureId,
        activeMaterialId: matId ?? workspace.texture.activeMaterialId,
      });

      pushToast(`Imported ${file.name} (${result.width}×${result.height})`);
      session.document.dirty = true;
      session.requestRedraw();
      refresh();
    } catch (err) {
      pushToast(err instanceof Error ? err.message : 'Failed to import image');
    }
  };

  const paletteProps = {
    session,
    workspace,
    hasUvSelection: !!selectedSnapshot(),
    onApply: () => applySelectedAtlasTile(),
    onCreatePlane: createAtlasTilePlane,
    onCreateGrid: createAtlasGrid,
    onPickTile: pickAtlasTileFromFace,
    onToggleDraw: toggleTileDraw,
    onEraseFaces: eraseSelectedTileFaces,
    onFillConnected: fillConnectedTileFaces,
  };
  const showPalette = shouldShowTilesetPanel(workspace);
  const paletteDocked = showPalette && tex.atlasPanelDock !== 'float';

  return (
    <div className={`uv-pixel-editor${paletteDocked ? ` has-tile-dock-${tex.atlasPanelDock}` : ''}`}>
      {paletteDocked && tex.atlasPanelDock === 'left' && (
        <aside className="tile-palette-dock" aria-label="Tile palette">
          <FloatingAtlasTilePanel {...paletteProps} docked />
        </aside>
      )}
      <div className="uv-pixel-canvas-column">
        <div className="uv-canvas-toolbar" aria-label="UV and pixel tools">
          <div className="uv-canvas-toolbar-row">
            {tex.uvPanelTab !== 'tiles' && (
              <div className="uv-canvas-toolgroup uv-canvas-mode-switch" role="group" aria-label="Editor mode">
                <button
                  type="button"
                  className={`uv-canvas-tool${uvPointerActive ? ' is-active' : ''}`}
                  onClick={() => armUv({ uvPanelTab: 'edit' })}
                  aria-pressed={uvPointerActive}
                  title="Edit UV islands on the texture"
                >
                  <BlenderIcon name="uv" size={13} />
                  <span>UV</span>
                </button>
                <button
                  type="button"
                  className={`uv-canvas-tool${!uvPointerActive ? ' is-active' : ''}`}
                  onClick={() => activatePaintTool(tex.pixelTool)}
                  aria-pressed={!uvPointerActive}
                  title="Paint the texture and the 3D model"
                >
                  <BlenderIcon name="greasepencil" size={13} />
                  <span>Paint</span>
                </button>
              </div>
            )}
            <label
              className="uv-canvas-tool is-icon"
              title="Import image texture (.png, .jpg, .webp)"
            >
              <BlenderIcon name="import" size={13} />
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                style={{ display: 'none' }}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void handleImportImageFile(file);
                  e.target.value = '';
                }}
              />
            </label>
            <div className="uv-canvas-toolgroup" role="group" aria-label="Workspace layout">
              <button
                type="button"
                className={`uv-canvas-tool${tex.maximize === 'none' ? ' is-active' : ''}`}
                onClick={() => workspace.patchTexture({ maximize: 'none' })}
                title="Show 3D and canvas side-by-side"
              >
                <BlenderIcon name="split_vertical" size={13} />
                <span>Split</span>
              </button>
              <button
                type="button"
                className={`uv-canvas-tool${tex.maximize === 'left' ? ' is-active' : ''}`}
                onClick={() => workspace.patchTexture({ maximize: 'left' })}
                title="Focus 3D viewport"
              >
                <BlenderIcon name="view3d" size={13} />
                <span>3D</span>
              </button>
              <button
                type="button"
                className={`uv-canvas-tool${tex.maximize === 'right' ? ' is-active' : ''}`}
                onClick={() => workspace.patchTexture({ maximize: 'right' })}
                title="Focus UV / Paint canvas"
              >
                <BlenderIcon name="image" size={13} />
                <span>Canvas</span>
              </button>
            </div>
            <div className="uv-canvas-toolbar-spacer" />
            <div className="uv-canvas-toolgroup uv-canvas-view-tools" role="group" aria-label="Canvas view">
              <button
                type="button"
                className={`uv-canvas-tool is-icon${tex.showUvCheckerboard ? ' is-active' : ''}`}
                onClick={() => workspace.patchTexture({ showUvCheckerboard: !tex.showUvCheckerboard })}
                title="Toggle checkerboard"
                aria-pressed={tex.showUvCheckerboard}
                aria-label="Toggle checkerboard"
              >
                <BlenderIcon name="grid" size={13} />
              </button>
              <button type="button" className="uv-canvas-tool is-icon" onClick={() => stepZoom(-1)} aria-label="Zoom out">
                <BlenderIcon name="zoom_out" size={13} />
              </button>
              <span className="uv-canvas-zoom">{Math.round(editorCamera(tex).zoom * 100)}%</span>
              <button type="button" className="uv-canvas-tool is-icon" onClick={() => stepZoom(1)} aria-label="Zoom in">
                <BlenderIcon name="zoom_in" size={13} />
              </button>
              <button type="button" className="uv-canvas-tool" onClick={actualPixels} title="Actual pixels">
                <BlenderIcon name="viewzoom" size={13} />
                <span>1:1</span>
              </button>
              <button
                type="button"
                className={`uv-canvas-tool is-icon${tex.uvInspectorOpen ? ' is-active' : ''}`}
                onClick={() => workspace.patchTexture({ uvInspectorOpen: !tex.uvInspectorOpen })}
                title={tex.uvInspectorOpen ? 'Hide inspector (N)' : 'Show inspector (N)'}
                aria-pressed={tex.uvInspectorOpen}
                aria-label={tex.uvInspectorOpen ? 'Hide inspector' : 'Show inspector'}
              >
                <BlenderIcon name="properties" size={13} />
              </button>
            </div>
          </div>
          <div className="uv-canvas-toolbar-row uv-canvas-toolbar-tools">
            {tex.uvPanelTab === 'tiles' ? (
              <div className="uv-canvas-toolgroup" role="group" aria-label="Tileset tools">
                <span className="uv-canvas-tool is-label">Tileset</span>
                <button
                  type="button"
                  className={`uv-canvas-tool${!tex.atlasNavigatorPan ? ' is-active' : ''}`}
                  onClick={() => workspace.patchTexture({ atlasNavigatorPan: false })}
                  title="Click a tile to select it. Shift+drag selects a stamp."
                >
                  Select
                </button>
                <button
                  type="button"
                  className={`uv-canvas-tool${tex.atlasNavigatorPan ? ' is-active' : ''}`}
                  onClick={() => workspace.patchTexture({ atlasNavigatorPan: true })}
                  title="Drag to pan the atlas"
                >
                  Pan
                </button>
                <button
                  type="button"
                  className={`uv-canvas-tool${tex.atlasPanelOpen ? ' is-active' : ''}`}
                  onClick={() => toggleTilesetPopup(workspace)}
                  title={tex.atlasPanelOpen ? 'Hide tileset palette' : 'Show tileset palette'}
                  aria-pressed={tex.atlasPanelOpen}
                >
                  Palette
                </button>
              </div>
            ) : uvPointerActive ? (
              <>
                <div className="uv-canvas-toolgroup" role="group" aria-label="UV selection mode">
                  {(['face', 'point', 'island'] as const).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      className={`uv-canvas-tool${tex.uvEditMode === mode ? ' is-active' : ''}`}
                      onClick={() => armUv({ uvEditMode: mode, uvPanelTab: 'edit' })}
                      title={`${mode[0]!.toUpperCase() + mode.slice(1)} selection`}
                    >
                      <BlenderIcon name={UV_EDIT_MODE_ICONS[mode]} size={13} />
                      <span>{mode[0]!.toUpperCase() + mode.slice(1)}</span>
                    </button>
                  ))}
                </div>
                <div className="uv-canvas-toolgroup" role="group" aria-label="Smart Unwrap">
                  <button
                    type="button"
                    className="uv-canvas-tool"
                    onClick={() => runUnwrap('smart')}
                    title="Planar unwrap per island, then pack into 0–1"
                  >
                    <BlenderIcon name="mod_uvproject" size={13} />
                    <span>Unwrap</span>
                  </button>
                </div>
                <div className="uv-canvas-toolgroup" role="group" aria-label="UV transform tool">
                  {(['move', 'scale', 'rotate'] as const).map((tool) => (
                    <button
                      key={tool}
                      type="button"
                      className={`uv-canvas-tool${tex.uvTransformTool === tool ? ' is-active' : ''}`}
                      onClick={() => armUv({ uvTransformTool: tool, uvPanelTab: 'edit' })}
                      title={tool[0]!.toUpperCase() + tool.slice(1)}
                    >
                      <BlenderIcon name={UV_TRANSFORM_ICONS[tool]} size={13} />
                      <span>{tool[0]!.toUpperCase() + tool.slice(1)}</span>
                    </button>
                  ))}
                </div>
                <div className="uv-canvas-toolgroup" role="group" aria-label="UV alignment">
                  <button type="button" className="uv-canvas-tool is-icon" onClick={() => handleAlign('left')} title="Move selection to U=0">
                    <BlenderIcon name="align_left" size={13} />
                    <span className="uv-canvas-tool-key">L</span>
                  </button>
                  <button type="button" className="uv-canvas-tool is-icon" onClick={() => handleAlign('center-u')} title="Center selection on U=0.5">
                    <BlenderIcon name="align_center" size={13} />
                    <span className="uv-canvas-tool-key">U</span>
                  </button>
                  <button type="button" className="uv-canvas-tool is-icon" onClick={() => handleAlign('right')} title="Move selection to U=1">
                    <BlenderIcon name="align_right" size={13} />
                    <span className="uv-canvas-tool-key">R</span>
                  </button>
                  <button type="button" className="uv-canvas-tool is-icon" onClick={() => handleAlign('top')} title="Move selection to V=1">
                    <BlenderIcon name="align_top" size={13} />
                    <span className="uv-canvas-tool-key">T</span>
                  </button>
                  <button type="button" className="uv-canvas-tool is-icon" onClick={() => handleAlign('bottom')} title="Move selection to V=0">
                    <BlenderIcon name="align_bottom" size={13} />
                    <span className="uv-canvas-tool-key">B</span>
                  </button>
                  <button type="button" className="uv-canvas-tool" onClick={handlePixelSnap} title="Snap selected UVs to texels">
                    <BlenderIcon name="snap_increment" size={13} />
                    <span>Snap</span>
                  </button>
                </div>
              </>
            ) : (
              <div className="uv-canvas-toolgroup uv-canvas-brush-tools" role="group" aria-label="Paint tools">
                {PIXEL_TOOLS.map((tool) => (
                  <button
                    key={tool}
                    type="button"
                    className={`uv-canvas-tool is-icon${tex.pixelTool === tool ? ' is-active' : ''}`}
                    onClick={() => activatePaintTool(tool)}
                    title={`${PIXEL_TOOL_LABELS[tool]} (${PIXEL_TOOL_HOTKEYS[tool]})`}
                    aria-label={`${PIXEL_TOOL_LABELS[tool]} (${PIXEL_TOOL_HOTKEYS[tool]})`}
                    aria-pressed={tex.pixelTool === tool}
                  >
                    <BlenderIcon name={PIXEL_TOOL_ICONS[tool]} size={14} />
                  </button>
                ))}
                <span className="uv-canvas-divider" aria-hidden />
                <button
                  type="button"
                  className={`uv-canvas-tool${tex.paintMode3D ? ' is-active' : ''}`}
                  title="Paint on the 3D model"
                  aria-pressed={tex.paintMode3D}
                  onClick={() => workspace.patchTexture({ paintMode3D: !tex.paintMode3D })}
                >
                  <BlenderIcon name="view3d" size={13} />
                  <span>3D</span>
                </button>
                <label className="uv-canvas-swatch" title="Foreground colour (X swaps)">
                  <input
                    type="color"
                    value={rgbaToHex(tex.foreground)}
                    onChange={(e) => workspace.patchTexture({ foreground: hexToRgba(e.target.value, tex.foreground[3]) })}
                  />
                </label>
              </div>
            )}
          </div>
        </div>
        <div ref={hostRef} className="uv-pixel-canvas-host">
        {workspace.viewportNavToolsVisible && (
          <ViewportNavToolbar
            viewId="persp"
            right={8}
            top={8}
            isPerspective={false}
            isMaximized={workspace.texture.maximize === 'right'}
            navMode={canvasNavMode}
            navViewId={canvasNavMode === 'none' ? null : 'persp'}
            onSetNav={(mode) => setCanvasNavMode(mode)}
            onFrame={() => frameSelection()}
            onMaximize={() => {
              if (workspace.texture.maximize === 'right') workspace.restoreTextureSplit();
              else workspace.toggleTextureMaximize('right');
            }}
            onDrag={(mode, deltaX, deltaY) => {
              if (mode === 'orbit') return;
              const host = hostRef.current;
              const rect = host?.getBoundingClientRect();
              applyUvCanvasNav(
                mode,
                deltaX,
                deltaY,
                (rect?.left ?? 0) + (rect?.width ?? 0) / 2,
                (rect?.top ?? 0) + (rect?.height ?? 0) / 2,
              );
              draw();
            }}
          />
        )}
        <canvas
          ref={canvasRef}
          className="uv-pixel-canvas"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={() => {
            hoverPixel.current = null;
            onPointerUp();
            draw();
          }}
          onWheel={onWheel}
          onContextMenu={(e) => e.preventDefault()}
        />
        {canvasImage && (
          <div className="uv-canvas-status" aria-live="polite">
            <span className={`uv-status-mode${tex.uvPanelTab === 'tiles' ? ' is-tiles' : uvPointerActive ? ' is-uv' : ' is-paint'}`}>
              {tex.uvPanelTab === 'tiles' ? 'TILESET' : uvPointerActive ? 'UV EDIT' : 'PIXEL PAINT'}
            </span>
            <span className="uv-status-name">{image ? image.name : 'UV guide · no texture assigned'}</span>
            <span>{canvasImage.width}×{canvasImage.height}</span>
            <span>{Math.round(editorCamera(tex).zoom * 100)}%</span>
            <span>{modeSummary}</span>
            {selectionSummary && <span className="uv-status-selection">{selectionSummary}</span>}
          </div>
        )}
        {!canvasImage && (
          <div className="uv-canvas-empty">
            <strong>{activeObjectId ? 'No editable texture yet' : 'Select a model first'}</strong>
            <span>
              {activeObjectId
                ? 'Create a blank pixel map or import an image for the selected material.'
                : 'Choose an object in the Model workspace, then return here to edit its UVs and texture.'}
            </span>
            <button
              type="button"
              className="tool primary"
              onClick={() =>
                activeObjectId
                  ? workspace.patchTexture({ uvPanelTab: 'material' })
                  : workspace.setShellMode('model')
              }
            >
              {activeObjectId ? 'Open Material setup' : 'Back to Model'}
            </button>
          </div>
        )}
        </div>
      </div>
      <UvInspectorPortal>
        <UvEditorSidePanel
          session={session}
          workspace={workspace}
          uvPointerActive={uvPointerActive}
          imageLabel={image ? `${image.name} · ${image.width}×${image.height}` : canvasImage ? 'UV guide · no texture assigned' : null}
          selectionSummary={selectionSummary}
          uvDiagnostics={uvDiagnostics}
          onSelectAll={selectAllPoints}
          onFocusSelectedFace={focusSelected3dFace}
          onRotate={rotateSelectionBy}
          onResizePixels={resizeSelectionToPixels}
          onScaleFactor={scaleSelectionBy}
          onFlip={flipSelection}
          onUnwrap={runUnwrap}
          onPack={runPack}
          onNormalize={runNormalize}
          onWeld={runWeld}
          onSplit={runSplit}
          onStraighten={runStraighten}
          onRelax={runRelax}
          onRotateToEdge={runRotateToEdge}
          onFlipFaces={flipSelectedFaces}
          onToggleSeams={toggleSeams}
          onAutoSeams={autoMarkSeams}
          onClearSeams={clearSeams}
          onAlign={handleAlign}
          onFlatten={handleFlatten}
          onDistribute={handleDistribute}
          onPixelSnap={handlePixelSnap}
          onFrame={frameSelection}
          onArmUv={armUv}
          onRefresh={refresh}
          embedded
          onApplyAtlasTile={() => applySelectedAtlasTile()}
          onCreateAtlasPlane={createAtlasTilePlane}
          onCreateAtlasGrid={createAtlasGrid}
          onPickAtlasTile={pickAtlasTileFromFace}
          onToggleTileDraw={toggleTileDraw}
          onEraseAtlasFaces={eraseSelectedTileFaces}
          onFillAtlasConnected={fillConnectedTileFaces}
        />
      </UvInspectorPortal>
      {paletteDocked && tex.atlasPanelDock === 'right' && (
        <aside className="tile-palette-dock" aria-label="Tile palette">
          <FloatingAtlasTilePanel {...paletteProps} docked />
        </aside>
      )}
      {showPalette && tex.atlasPanelDock === 'float' && (
        <FloatingAtlasTilePanel {...paletteProps} />
      )}
    </div>
  );
}
