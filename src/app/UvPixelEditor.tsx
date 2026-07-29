import { useCallback, useEffect, useRef, useState } from 'react';
import type { EditorSession } from '@/core/editor/EditorSession';
import { floodFill, getPixel } from '@/core/image/PixelEditor';
import { PixelStrokeRecorder } from '@/core/image/PixelStroke';
import {
  brushColourForTool,
  stampBrush,
  stampBrushLine,
} from '@/core/image/paintBrush';
import type { FaceCornerId, FaceId } from '@/core/mesh/types';
import { faceCornerIds } from '@/core/mesh/EditableMesh';
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
  snapUvsToPixelGrid,
  weldSelectedUvs,
  type UvAlignMode,
  type UvGizmoHandle,
  type UvSnapshot,
} from '@/core/uv/UvEdit';
import {
  islandForFace,
  markUvSeams,
  unwrapUvs,
  viewAxesFromCamera,
  type UvUnwrapMode,
} from '@/core/uv/UvOperations';
import { packUvsAsync } from '@/core/uv/workers/UvPackingWorkerClient';
import { v3 } from '@/core/math/Vec3';
import type { WorkspaceController } from '@/workspace/WorkspaceController';
import { editorCamera } from '@/workspace/TextureWorkspace';
import { UvEditorSidePanel } from '@/app/UvEditorSidePanel';
import { pushToast } from '@/app/Toast';
import { FloatingAtlasTilePanel } from '@/app/FloatingAtlasTilePanel';
import { applyAtlasTileToFaces, buildAtlasTileGrid } from '@/core/uv/AtlasUv';
import { buildPlane } from '@/core/mesh/builders/PlaneBuilder';
import { importImageFile } from '@/core/image/ImageImport';
import { commitMeshObject, createMaterial, getObjectMaterialId } from '@/core/document/ModelDocument';
import { TileDrawTool } from '@/core/tools/TileDrawTool';
import { WORLD_XY_PLANE, WORLD_XZ_PLANE, WORLD_YZ_PLANE } from '@/core/snap/SnapEngine';
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
import {
  hexToRgba,
  nearestZoomIndex,
  resolveSelectedCorners,
  rgbaToHex,
  uniqueFacesForCorners,
  UV_ZOOM_STEPS as ZOOM_STEPS,
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
  const panning = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);
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
  const image = ctxInfo.imageId ? session.document.images.get(ctxInfo.imageId) : null;
  const uvPointerActive =
    tex.activeRightEditor === 'uv' ||
    (tex.activeRightEditor === 'combined' && tex.uvPointerMode);

  useEffect(() => {
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
  }, [ctxInfo.imageId, ctxInfo.materialId, ctxInfo.textureId, ctxInfo.uvLayerId, tex, workspace]);

  const activeMesh = useCallback(() => {
    const objectId = session.selection.state.activeObjectId;
    const object = objectId ? session.document.objects.get(objectId) : null;
    const mesh = object?.meshId ? session.document.meshes.get(object.meshId) : null;
    const layerId = mesh ? resolveUvLayerId(mesh, activeUvLayerId ?? mesh.defaultUvLayerId) : null;
    if (!object || !mesh || !layerId) return null;
    return { objectId: object.id, mesh, layerId };
  }, [activeUvLayerId, session]);

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
    workspace.patchTexture({
      uvPointerMode: true,
      activeRightEditor: tex.activeRightEditor === 'pixel' ? 'uv' : tex.activeRightEditor,
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
      image,
      session,
      workspace,
      uvPointerActive,
      activeMesh: active ? { mesh: active.mesh, layerId: active.layerId } : null,
      hoverPixel: hoverPixel.current,
      marquee: marquee.current,
    });
  }, [activeMesh, image, session, workspace, uvPointerActive]);

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
    if (!canvas || !image) return null;
    const rect = canvas.getBoundingClientRect();
    const cam = editorCamera(workspace.texture);
    const sx = clientX - rect.left;
    const sy = clientY - rect.top;
    const px = (sx - cam.panX) / cam.zoom;
    const py = (sy - cam.panY) / cam.zoom;
    return { x: px / image.width, y: 1 - py / image.height };
  };

  const screenToPixel = (clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas || !image) return null;
    const rect = canvas.getBoundingClientRect();
    const cam = editorCamera(workspace.texture);
    const sx = clientX - rect.left;
    const sy = clientY - rect.top;
    const px = Math.floor((sx - cam.panX) / cam.zoom);
    const py = Math.floor((sy - cam.panY) / cam.zoom);
    if (px < 0 || py < 0 || px >= image.width || py >= image.height) return null;
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
    if (!previous) {
      stampBrush(image, p.x, p.y, size, colour, stroke.current, shape);
    } else {
      stampBrushLine(
        image,
        previous.x,
        previous.y,
        p.x,
        p.y,
        size,
        colour,
        stroke.current,
        shape,
      );
    }
    lastPaintPixel.current = p;
    session.requestRedraw();
    draw();
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
    if (!ctx || !uv || !image) return;

    // Ctrl/Cmd+LMB always starts a bidirectional marquee (even over faces / gizmos).
    if (ctrlKey) {
      beginUvMarquee(clientX, clientY, shiftKey, true);
      return;
    }

    const cam = editorCamera(workspace.texture);
    const pickRadiusPx = UV_GIZMO_PX.handleHit;
    const edgeRadiusPx = UV_GIZMO_PX.edgeHit;
    // Screen-stable UV radii (must include zoom — otherwise handles eat the whole island).
    const radiusU = Math.max(edgeRadiusPx, pickRadiusPx) / Math.max(1e-6, cam.zoom * image.width);
    const radiusV = Math.max(edgeRadiusPx, pickRadiusPx) / Math.max(1e-6, cam.zoom * image.height);
    const rotateOffsetV = UV_GIZMO_PX.rotateStem / Math.max(1e-6, cam.zoom * image.height);
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

    const hit = pickUvElement(ctx.mesh, ctx.layerId, uv, pickRadiusPx, image.width, image.height);
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
    if (!box || !image) return;
    const ctx = activeMesh();
    if (!ctx) return;
    const dx = Math.abs(box.currentUv.x - box.startUv.x);
    const dy = Math.abs(box.currentUv.y - box.startUv.y);
    if (dx < 1 / image.width && dy < 1 / image.height) {
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
    if (!drag || !image) return;
    const mesh = session.document.meshes.get(drag.meshId);
    if (!mesh) return;
    const uv = screenToUv(clientX, clientY);
    if (!uv) return;
    const cam = editorCamera(workspace.texture);
    // Minimum axis length ≈ 2 screen pixels in UV — stops thin islands exploding.
    const minAxis = Math.max(
      2 / Math.max(1e-6, cam.zoom * image.width),
      2 / Math.max(1e-6, cam.zoom * image.height),
    );

    if (drag.mode === 'move') {
      let dx = uv.x - drag.startUv.x;
      let dy = uv.y - drag.startUv.y;
      if (drag.axis === 'u') dy = 0;
      if (drag.axis === 'v') dx = 0;
      // Pixel-snap only with Shift held — continuous drag is the default (accurate).
      if (shiftKey || drag.snapAngle) {
        const stepU = 1 / image.width;
        const stepV = 1 / image.height;
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
    if (!image) return;
    const w = Math.max(1, Math.round(widthPx));
    const h = Math.max(1, Math.round(heightPx));
    mutateSelection(`Resize UVs ${w}×${h}`, (mesh, layerId, before) => {
      resizeUvsToSize(mesh, before, layerId, w / image.width, h / image.height);
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
    if (!image) return;
    mutateSelection('Nudge UVs', (mesh, layerId, before) => {
      translateUvsFromSnapshot(mesh, before, layerId, {
        x: du / image.width,
        y: dv / image.height,
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
    if (!host || !image) return;
    const sel = selectedSnapshot();
    const bounds = sel
      ? boundsOfUvs(sel.snap)
      : { min: { x: 0, y: 0 }, max: { x: 1, y: 1 }, center: { x: 0.5, y: 0.5 }, size: { x: 1, y: 1 } };
    if (!bounds) return;
    const cam = cameraToFrameUvBounds(
      bounds,
      image.width,
      image.height,
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
    requestAnimationFrame(frameSelection);
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

  const actualPixels = () => {
    const host = hostRef.current;
    if (!host || !image) return;
    const cam = {
      zoom: 1,
      panX: (host.clientWidth - image.width) / 2,
      panY: (host.clientHeight - image.height) / 2,
    };
    workspace.patchTexture({ uvCamera: cam, pixelCamera: cam });
  };

  useEffect(() => {
    if (!image || lastAutoFramedImage.current === image.id) return;
    lastAutoFramedImage.current = image.id;
    const frame = requestAnimationFrame(frameSelection);
    return () => cancelAnimationFrame(frame);
    // Frame once when the active image changes; later camera changes remain user-owned.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [image?.id]);

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
    if (!image || !ctxInfo.materialId) return;
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
      materialId: ctxInfo.materialId,
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
    if (!image || !ctxInfo.materialId) return;
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
      materialId: ctxInfo.materialId,
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
    const current = session.tools.getActive();
    if (current?.id === 'tile-draw') {
      session.tools.setActive('select', session.context());
      session.requestRedraw();
      refresh();
      return;
    }
    if (!image || !ctxInfo.materialId) return;
    const tool = session.tools.get('tile-draw') as TileDrawTool;
    const pixelsPerUnit = Math.max(1, tex.atlasPixelsPerUnit);
    tool.setConfig({
      mode: tex.atlasDrawMode,
      shape: tex.atlasDrawShape,
      autoTile: tex.atlasAutoTile,
      materialId: ctxInfo.materialId,
      imageName: image.name,
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
      cellWidth: tex.atlasUsePixelDensity ? tex.atlasTileWidth / pixelsPerUnit : tex.atlasPlaneSize,
      cellHeight: tex.atlasUsePixelDensity ? tex.atlasTileHeight / pixelsPerUnit : tex.atlasPlaneSize,
      pattern: tex.atlasFillPattern,
      randomSeed: tex.atlasRandomSeed,
      layer: tex.atlasTileLayer,
    }, session.context());
    if (tex.atlasPlaneOrientation === 'floor') {
      session.constructionPlane = WORLD_XZ_PLANE;
      session.constructionPlaneId = 'top';
    } else if (tex.atlasPlaneOrientation === 'wall-x') {
      session.constructionPlane = WORLD_XY_PLANE;
      session.constructionPlaneId = 'front';
    } else {
      session.constructionPlane = WORLD_YZ_PLANE;
      session.constructionPlaneId = 'right';
    }
    workspace.patchTexture({ paintMode3D: false, atlasPaintMode: false, uvPointerMode: true });
    session.tools.setActive('tile-draw', session.context());
    session.requestRedraw();
    refresh();
  };

  useEffect(() => {
    if (session.tools.getActive()?.id !== 'tile-draw' || !image || !ctxInfo.materialId) return;
    const pixelsPerUnit = Math.max(1, tex.atlasPixelsPerUnit);
    (session.tools.get('tile-draw') as TileDrawTool).setConfig({
      mode: tex.atlasDrawMode,
      shape: tex.atlasDrawShape,
      autoTile: tex.atlasAutoTile,
      materialId: ctxInfo.materialId,
      imageName: image.name,
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
      cellWidth: tex.atlasUsePixelDensity ? tex.atlasTileWidth / pixelsPerUnit : tex.atlasPlaneSize,
      cellHeight: tex.atlasUsePixelDensity ? tex.atlasTileHeight / pixelsPerUnit : tex.atlasPlaneSize,
      pattern: tex.atlasFillPattern,
      randomSeed: tex.atlasRandomSeed,
      layer: tex.atlasTileLayer,
    }, session.context());
    if (tex.atlasPlaneOrientation === 'floor') {
      session.constructionPlane = WORLD_XZ_PLANE;
      session.constructionPlaneId = 'top';
    } else if (tex.atlasPlaneOrientation === 'wall-x') {
      session.constructionPlane = WORLD_XY_PLANE;
      session.constructionPlaneId = 'front';
    } else {
      session.constructionPlane = WORLD_YZ_PLANE;
      session.constructionPlaneId = 'right';
    }
    (session.tools.get('tile-draw') as TileDrawTool).syncWorkPlane(session.constructionPlane, session.context());
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

  const toggleSeams = (seam: boolean) => {
    const ctx = activeMesh();
    if (!ctx) return;
    const edgeIds = [...session.selection.state.selectedEdgeIds];
    if (!edgeIds.length) return;
    const beforeSeams = edgeIds.map((id) => ({
      id,
      seam: ctx.mesh.edges.get(id)?.seam ?? false,
    }));
    markUvSeams(ctx.mesh, edgeIds, seam);
    let applied = true;
    session.history.execute({
      name: seam ? 'Mark UV Seams' : 'Clear UV Seams',
      execute: () => {
        if (applied) return;
        markUvSeams(ctx.mesh, edgeIds, seam);
        applied = true;
        session.requestRedraw();
      },
      undo: () => {
        for (const e of beforeSeams) {
          const edge = ctx.mesh.edges.get(e.id);
          if (edge) edge.seam = e.seam;
        }
        ctx.mesh.geometryVersion += 1;
        ctx.mesh.dirty.uvs = true;
        applied = false;
        session.requestRedraw();
      },
    });
    session.requestRedraw();
    refresh();
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button === 1 || (e.button === 0 && e.altKey && !e.ctrlKey && !e.metaKey)) {
      e.preventDefault();
      const cam = editorCamera(workspace.texture);
      panning.current = { x: e.clientX, y: e.clientY, panX: cam.panX, panY: cam.panY };
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      return;
    }
    const useBackground = e.button === 2;
    if (e.button !== 0 && e.button !== 2) return;

    // Ctrl/Cmd+LMB marquee works in paint and UV modes.
    if (e.button === 0 && (e.ctrlKey || e.metaKey) && image && activeMesh()) {
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
        const before = new Uint8ClampedArray(image.pixels);
        const count = floodFill(image, p.x, p.y, fillColour);
        if (count) {
          const after = new Uint8ClampedArray(image.pixels);
          let applied = true;
          session.history.execute({
            name: 'Fill Pixels',
            execute: () => {
              if (applied) return;
              image.pixels.set(after);
              image.revision += 1;
              applied = true;
              session.requestRedraw();
            },
            undo: () => {
              image.pixels.set(before);
              image.revision += 1;
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
    painting.current = true;
    lastPaintPixel.current = null;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    paintAt(e.clientX, e.clientY, useBackground);
  };

  const hoverGizmoCursor = (clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas || !image || !uvPointerActive) {
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
    const radiusU = hitPx / Math.max(1e-6, cam.zoom * image.width);
    const radiusV = hitPx / Math.max(1e-6, cam.zoom * image.height);
    const rotateOffsetV = UV_GIZMO_PX.rotateStem / Math.max(1e-6, cam.zoom * image.height);
    const gizmo = pickUvGizmo(uv, bounds, radiusU, radiusV, rotateOffsetV);
    canvas.style.cursor = uvGizmoCursor(gizmo?.handle ?? null);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    hoverPixel.current = screenToPixel(e.clientX, e.clientY);
    if (panning.current) {
      const dx = e.clientX - panning.current.x;
      const dy = e.clientY - panning.current.y;
      const next = {
        panX: panning.current.panX + dx,
        panY: panning.current.panY + dy,
        zoom: editorCamera(workspace.texture).zoom,
      };
      workspace.patchTexture({ uvCamera: next, pixelCamera: next });
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
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const cam = editorCamera(workspace.texture);
    const idx = nearestZoomIndex(cam.zoom);
    const nextIdx = e.deltaY > 0 ? Math.max(0, idx - 1) : Math.min(ZOOM_STEPS.length - 1, idx + 1);
    const nextZoom = ZOOM_STEPS[nextIdx]!;
    const worldX = (mx - cam.panX) / cam.zoom;
    const worldY = (my - cam.panY) / cam.zoom;
    const next = {
      zoom: nextZoom,
      panX: mx - worldX * nextZoom,
      panY: my - worldY * nextZoom,
    };
    workspace.patchTexture({ uvCamera: next, pixelCamera: next });
    draw();
  };

  const stepZoom = (direction: -1 | 1) => {
    const host = hostRef.current;
    if (!host) return;
    const cam = editorCamera(workspace.texture);
    const idx = nearestZoomIndex(cam.zoom);
    const nextZoom = ZOOM_STEPS[Math.max(0, Math.min(ZOOM_STEPS.length - 1, idx + direction))]!;
    const mx = host.clientWidth / 2;
    const my = host.clientHeight / 2;
    const next = {
      zoom: nextZoom,
      panX: mx - ((mx - cam.panX) / cam.zoom) * nextZoom,
      panY: my - ((my - cam.panY) / cam.zoom) * nextZoom,
    };
    workspace.patchTexture({ uvCamera: next, pixelCamera: next });
  };

  const activatePaintTool = (pixelTool: typeof tex.pixelTool) => {
    workspace.patchTexture({
      pixelTool,
      uvPointerMode: false,
      paintMode3D: true,
      activeRightEditor: tex.activeRightEditor === 'uv' ? 'combined' : tex.activeRightEditor,
      uvPanelTab: 'paint',
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

      if (tileDrawActive && !e.ctrlKey && !e.metaKey) {
        if (key === 'q' || key === 'e') {
          e.preventDefault();
          if (e.shiftKey) {
            workspace.patchTexture(key === 'q'
              ? { atlasFlipV: !tex.atlasFlipV }
              : { atlasFlipU: !tex.atlasFlipU });
          } else {
            const delta = key === 'q' ? 3 : 1;
            workspace.patchTexture({ atlasQuarterTurns: ((tex.atlasQuarterTurns + delta) % 4) as 0 | 1 | 2 | 3 });
          }
          return;
        }
        if (key === '1' || key === '2') {
          e.preventDefault();
          workspace.patchTexture({ atlasDrawShape: key === '1' ? 'stroke' : 'rectangle' });
          return;
        }
        if (e.key.startsWith('Arrow') && image) {
          e.preventDefault();
          const dx = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0;
          const dy = e.key === 'ArrowUp' ? -1 : e.key === 'ArrowDown' ? 1 : 0;
          const stepX = tex.atlasTileWidth + tex.atlasMarginX;
          const stepY = tex.atlasTileHeight + tex.atlasMarginY;
          workspace.patchTexture({
            atlasTileX: Math.max(tex.atlasOffsetX, Math.min(image.width - tex.atlasTileWidth, tex.atlasTileX + dx * stepX)),
            atlasTileY: Math.max(tex.atlasOffsetY, Math.min(image.height - tex.atlasTileHeight, tex.atlasTileY + dy * stepY)),
          });
          return;
        }
        if (key === 'escape') {
          e.preventDefault();
          toggleTileDraw();
          return;
        }
      }

      if (!e.ctrlKey && !e.metaKey && (key === 'b' || key === 'e' || key === 'i' || key === 'f')) {
        e.preventDefault();
        activatePaintTool(key === 'b' ? 'pencil' : key === 'e' ? 'eraser' : key === 'i' ? 'eyedropper' : 'fill');
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
      if (e.key === '[' || e.key === ']') {
        e.preventDefault();
        workspace.patchTexture({
          brushSize: Math.max(1, Math.min(64, tex.brushSize + (e.key === '[' ? -1 : 1))),
        });
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
    if (!bounds || !image) {
      return `${session.uvSelection.size} UV points · ${session.selection.state.selectedFaceIds.size} faces`;
    }
    return `${session.uvSelection.size} pts · ${session.selection.state.selectedFaceIds.size} faces · ${Math.round(bounds.size.x * image.width)}×${Math.round(bounds.size.y * image.height)}px`;
  })();
  const uvDiagnostics = (() => {
    const ctx = activeMesh();
    if (!ctx || !image) return null;
    return analyseUvs(ctx.mesh, ctx.layerId, image.width, image.height);
  })();
  const modeSummary = uvPointerActive
    ? `UV ${tex.uvEditMode} · ${tex.uvTransformTool}`
    : `${tex.pixelTool} · ${tex.brushSize}px ${tex.brushShape}${tex.paintMode3D ? ' · 3D paint' : ''}`;
  const activeObjectId = session.selection.state.activeObjectId;

  const handleAlign = (mode: UvAlignMode) => {
    const sel = selectedSnapshot();
    if (!sel || !sel.corners.length) {
      pushToast('Select UV corners or faces to align');
      return;
    }
    alignUvs(sel.ctx.mesh, sel.corners, sel.ctx.layerId, mode);
    session.history.execute({
      name: `Align UVs (${mode})`,
      execute: () => session.requestRedraw(),
      undo: () => session.requestRedraw(),
    });
    session.requestRedraw();
  };

  const handlePixelSnap = () => {
    const sel = selectedSnapshot();
    if (!sel || !sel.corners.length) {
      pushToast('Select UV corners to snap to pixels');
      return;
    }
    snapUvsToPixelGrid(sel.ctx.mesh, sel.corners, sel.ctx.layerId, image?.width ?? 64, image?.height ?? 64);
    session.history.execute({
      name: 'Snap UVs to Pixel Grid',
      execute: () => session.requestRedraw(),
      undo: () => session.requestRedraw(),
    });
    session.requestRedraw();
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

  return (
    <div className="uv-pixel-editor">
      <div ref={hostRef} className="uv-pixel-canvas-host">
        <div className="uv-canvas-toolbar" aria-label="UV and pixel tools">
          <div className="uv-canvas-toolgroup" role="group" aria-label="Interaction mode">
            <button
              type="button"
              className={`uv-canvas-tool${uvPointerActive ? ' is-active' : ''}`}
              onClick={() => armUv({ uvPanelTab: 'edit' })}
              title="Arrange how the texture wraps around the model"
            >
              UV Layout
            </button>
            <button
              type="button"
              className={`uv-canvas-tool${!uvPointerActive ? ' is-active' : ''}`}
              onClick={() => activatePaintTool(tex.pixelTool)}
              title="Draw colour on the texture and directly on the 3D model"
            >
              Paint Texture
            </button>
            <label
              className="uv-canvas-tool"
              style={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4 }}
              title="Import image texture file (.png, .jpg, .webp)"
            >
              📁 Import Image
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
          </div>
          <div className="uv-canvas-toolgroup" role="group" aria-label="Layout view mode">
            <button
              type="button"
              className={`uv-canvas-tool${tex.maximize === 'none' ? ' is-active' : ''}`}
              onClick={() => workspace.patchTexture({ maximize: 'none' })}
              title="Show 3D View and UV Editor side-by-side"
            >
              📐 Split
            </button>
            <button
              type="button"
              className={`uv-canvas-tool${tex.maximize === 'left' ? ' is-active' : ''}`}
              onClick={() => workspace.patchTexture({ maximize: 'left' })}
              title="Focus 3D Viewport (Full Screen 3D)"
            >
              🧊 Full 3D
            </button>
            <button
              type="button"
              className={`uv-canvas-tool${tex.maximize === 'right' ? ' is-active' : ''}`}
              onClick={() => workspace.patchTexture({ maximize: 'right' })}
              title="Focus UV Editor (Full Screen UV)"
            >
              🎨 Full UV
            </button>
          </div>
          {uvPointerActive ? (
            <>
              <div className="uv-canvas-toolgroup" role="group" aria-label="UV selection mode">
                {(['face', 'point', 'island'] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    className={`uv-canvas-tool${tex.uvEditMode === mode ? ' is-active' : ''}`}
                    onClick={() => armUv({ uvEditMode: mode, uvPanelTab: 'edit' })}
                  >
                    {mode[0]!.toUpperCase() + mode.slice(1)}
                  </button>
                ))}
              </div>
              <div className="uv-canvas-toolgroup" role="group" aria-label="Smart Unwrap">
                <button
                  type="button"
                  className="uv-canvas-tool"
                  style={{ color: '#ffd2a8', fontWeight: 600 }}
                  onClick={() => runUnwrap('smart')}
                  title="Smart Conformal Unwrap: Auto seam sharp edges & pack islands"
                >
                  ⚡ Smart Unwrap
                </button>
              </div>
              <div className="uv-canvas-toolgroup" role="group" aria-label="UV transform tool">
                {(['move', 'scale', 'rotate'] as const).map((tool) => (
                  <button
                    key={tool}
                    type="button"
                    className={`uv-canvas-tool${tex.uvTransformTool === tool ? ' is-active' : ''}`}
                    onClick={() => armUv({ uvTransformTool: tool, uvPanelTab: 'edit' })}
                  >
                    {tool[0]!.toUpperCase() + tool.slice(1)}
                  </button>
                ))}
              </div>
              <div className="uv-canvas-toolgroup" role="group" aria-label="UV alignment">
                <button type="button" className="uv-canvas-tool" onClick={() => handleAlign('left')} title="Align Left (U min)">Align L</button>
                <button type="button" className="uv-canvas-tool" onClick={() => handleAlign('center-u')} title="Align Center U">Center U</button>
                <button type="button" className="uv-canvas-tool" onClick={() => handleAlign('right')} title="Align Right (U max)">Align R</button>
                <button type="button" className="uv-canvas-tool" onClick={() => handleAlign('top')} title="Align Top (V max)">Align T</button>
                <button type="button" className="uv-canvas-tool" onClick={handlePixelSnap} title="Snap to Pixel Grid">Pixel Snap</button>
              </div>
            </>
          ) : (
            <div className="uv-canvas-toolgroup uv-canvas-brush-tools" role="group" aria-label="Brush">
              {(['pencil', 'eraser', 'eyedropper', 'fill'] as const).map((tool) => (
                <button
                  key={tool}
                  type="button"
                  className={`uv-canvas-tool${tex.pixelTool === tool ? ' is-active' : ''}`}
                  onClick={() => activatePaintTool(tool)}
                  title={`${tool[0]!.toUpperCase() + tool.slice(1)} (${tool === 'pencil' ? 'B' : tool === 'eraser' ? 'E' : tool === 'eyedropper' ? 'I' : 'F'})`}
                >
                  {tool === 'pencil' ? 'Draw' : tool === 'eyedropper' ? 'Pick' : tool[0]!.toUpperCase() + tool.slice(1)}
                </button>
              ))}
              <span className="uv-canvas-divider" aria-hidden />
              <button
                type="button"
                className={`uv-canvas-tool${tex.paintMode3D ? ' is-active' : ''}`}
                title="Paint on the 3D model"
                onClick={() => workspace.patchTexture({ paintMode3D: !tex.paintMode3D })}
              >
                3D
              </button>
              <button
                type="button"
                className="uv-canvas-tool"
                title="Toggle brush shape (C)"
                onClick={() => workspace.patchTexture({ brushShape: tex.brushShape === 'square' ? 'circle' : 'square' })}
              >
                {tex.brushShape === 'circle' ? '○' : '□'}
              </button>
              <input
                className="uv-canvas-size"
                type="range"
                min={1}
                max={64}
                value={tex.brushSize}
                title={`Brush size ${tex.brushSize}px ([ ])`}
                onChange={(e) => workspace.patchTexture({ brushSize: Number(e.target.value) })}
              />
              <span className="uv-canvas-zoom">{tex.brushSize}px</span>
              <label className="uv-canvas-swatch" title="Foreground colour (X swaps)">
                <input
                  type="color"
                  value={rgbaToHex(tex.foreground)}
                  onChange={(e) => workspace.patchTexture({ foreground: hexToRgba(e.target.value, tex.foreground[3]) })}
                />
              </label>
            </div>
          )}
          <div className="uv-canvas-toolgroup uv-canvas-view-tools" role="group" aria-label="Canvas view">
            <button
              type="button"
              className={`uv-canvas-tool${tex.showUvCheckerboard ? ' is-active' : ''}`}
              onClick={() => workspace.patchTexture({ showUvCheckerboard: !tex.showUvCheckerboard })}
              title="Toggle UV Checkerboard pattern"
            >
              Checker
            </button>
            <button type="button" className="uv-canvas-tool" onClick={() => stepZoom(-1)} aria-label="Zoom out">−</button>
            <span className="uv-canvas-zoom">{Math.round(editorCamera(tex).zoom * 100)}%</span>
            <button type="button" className="uv-canvas-tool" onClick={() => stepZoom(1)} aria-label="Zoom in">+</button>
            <button type="button" className="uv-canvas-tool" onClick={actualPixels} title="Actual pixels">1:1</button>
            <button type="button" className="uv-canvas-tool" onClick={frameSelection} title="Frame selection or image">Frame</button>
          </div>
        </div>
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
        {image && (
          <div className="uv-canvas-status" aria-live="polite">
            <span className={`uv-status-mode${uvPointerActive ? ' is-uv' : ' is-paint'}`}>
              {uvPointerActive ? 'UV EDIT' : 'PIXEL PAINT'}
            </span>
            <span>{image.name}</span>
            <span>{image.width}×{image.height}</span>
            <span>{Math.round(editorCamera(tex).zoom * 100)}%</span>
            <span>{modeSummary}</span>
            {selectionSummary && <span className="uv-status-selection">{selectionSummary}</span>}
          </div>
        )}
        {!image && (
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
      <UvEditorSidePanel
        session={session}
        workspace={workspace}
        uvPointerActive={uvPointerActive}
        imageLabel={image ? `${image.name} · ${image.width}×${image.height}` : null}
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
        onToggleSeams={toggleSeams}
        onFrame={frameSelection}
        onArmUv={armUv}
      />
      {tex.atlasPanelOpen && (
        <FloatingAtlasTilePanel
          session={session}
          workspace={workspace}
          hasUvSelection={!!selectedSnapshot()}
          onApply={() => applySelectedAtlasTile()}
          onCreatePlane={createAtlasTilePlane}
          onCreateGrid={createAtlasGrid}
          onPickTile={pickAtlasTileFromFace}
          onToggleDraw={toggleTileDraw}
          onEraseFaces={eraseSelectedTileFaces}
          onFillConnected={fillConnectedTileFaces}
        />
      )}
    </div>
  );
}
