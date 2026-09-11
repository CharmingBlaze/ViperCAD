import { applyDefaultBlockoutLook } from '@/core/blockout/BlockoutMaterial';
import { commitMeshObject } from '@/core/document/ModelDocument';
import { buildBlockoutExtrudeMesh, localizeMeshToBoundsCentre, planeNormal } from '@/core/blockout/BlockoutExtrude';
import {
  crossVec3,
  dotVec3,
  lengthSqVec3,
  normalizeVec3,
  subVec3,
  type Vec3,
  v3,
} from '@/core/math/Vec3';
import type { EditableMesh } from '@/core/mesh/types';
import {
  WORLD_XY_PLANE,
  WORLD_XZ_PLANE,
  WORLD_YZ_PLANE,
  rayPlaneIntersection,
  snapScalarToIncrement,
  type ConstructionPlane,
  type SnapQuery,
} from '@/core/snap/SnapEngine';
import { cloneSelection, type SelectionMode } from '@/core/selection/SelectionManager';
import type { ModellingContext, Tool, ToolPointerInput } from './Tool';

export type BlockoutDrawStage = 'draw' | 'width';

export type BlockoutVectorToolState = {
  points: Vec3[];
  previewPoint: Vec3 | null;
  canClose: boolean;
  closed: boolean;
  draggingIndex: number;
  stage: BlockoutDrawStage;
  activePlane: 'front' | 'side' | 'top';
  revision: number;
};

export type BlockoutVectorPreviewInfo = {
  points: Vec3[];
  chainPoints: Vec3[];
  canClose: boolean;
  closed: boolean;
  stage: BlockoutDrawStage;
  activePlane: 'front' | 'side' | 'top';
  mirrorX: boolean;
  thickness: number;
  symmetric: boolean;
};

export function buildSymmetricPoints(points: Vec3[], mirrorX: boolean, plane: string): Vec3[] {
  if (!mirrorX || plane !== 'front' || points.length < 2) {
    return [...points];
  }
  const original = points.map((p) => (Math.abs(p.x) < 0.01 ? v3(0, p.y, p.z) : p));
  const reflected: Vec3[] = [];
  for (let i = original.length - 1; i >= 0; i--) {
    const p = original[i]!;
    if (Math.abs(p.x) > 0.01) {
      reflected.push(v3(-p.x, p.y, p.z));
    }
  }
  return [...original, ...reflected];
}

export class BlockoutVectorTool implements Tool {
  id: 'blockout-vector' | 'blockout-solid' | 'blockout-round' = 'blockout-vector';
  label = 'Flat';

  thickness = 0.5;
  symmetric = true;
  bevel = 0;
  mirrorX = false;
  private widthScreenAnchor: { screenY: number; startWidth: number } | null = null;
  private widthDragging = false;

  state: BlockoutVectorToolState = {
    points: [],
    previewPoint: null,
    canClose: false,
    closed: false,
    draggingIndex: -1,
    stage: 'draw',
    activePlane: 'front',
    revision: 0,
  };

  activate(context: ModellingContext): void {
    this.state.revision += 1;
    context.requestRedraw();
  }

  deactivate(context: ModellingContext): void {
    this.state.revision += 1;
    context.requestRedraw();
  }

  setThickness(val: number, context: ModellingContext): void {
    this.thickness = Math.max(0.01, Math.min(20, val));
    this.state.revision += 1;
    context.requestRedraw();
  }

  setSymmetric(val: boolean, context: ModellingContext): void {
    this.symmetric = val;
    this.state.revision += 1;
    context.requestRedraw();
  }

  setMirrorX(val: boolean, context?: ModellingContext): void {
    this.mirrorX = val;
    this.state.revision += 1;
    if (context) context.requestRedraw();
  }

  clear(context?: ModellingContext): void {
    this.state.points = [];
    this.state.previewPoint = null;
    this.state.canClose = false;
    this.state.closed = false;
    this.state.draggingIndex = -1;
    this.state.stage = 'draw';
    this.widthScreenAnchor = null;
    this.widthDragging = false;
    this.state.revision += 1;
    if (context) context.requestRedraw();
  }

  private planeForType(type: 'front' | 'side' | 'top'): ConstructionPlane {
    if (type === 'side') return WORLD_YZ_PLANE;
    if (type === 'top') return WORLD_XZ_PLANE;
    return WORLD_XY_PLANE;
  }

  private planeTypeFromView(
    viewId: string | undefined,
    context: ModellingContext,
  ): 'front' | 'side' | 'top' {
    if (viewId === 'right') return 'side';
    if (viewId === 'top') return 'top';
    if (viewId === 'front') return 'front';
    const id = context.constructionPlaneId ?? '';
    if (id.startsWith('right')) return 'side';
    if (id.startsWith('top')) return 'top';
    if (id.startsWith('front')) return 'front';
    const n = context.constructionPlane.normal;
    const ax = Math.abs(n.x);
    const ay = Math.abs(n.y);
    const az = Math.abs(n.z);
    if (ax >= ay && ax >= az) return 'side';
    if (ay >= ax && ay >= az) return 'top';
    return 'front';
  }

  /**
   * Keep an in-progress silhouette planar. Perspective (and unknown) views
   * project onto the active plane; a different ortho view is ignored so Front
   * and Side rays — which never meet — cannot mix one stroke.
   */
  protected resolveDrawPlane(
    viewId: string | undefined,
    context: ModellingContext,
  ): { plane: ConstructionPlane; type: 'front' | 'side' | 'top' } | null {
    const incoming = this.planeTypeFromView(viewId, context);
    const fromOrtho = viewId === 'front' || viewId === 'right' || viewId === 'top';
    if (this.state.points.length > 0 && !this.state.closed && fromOrtho && incoming !== this.state.activePlane) {
      return null;
    }
    const type =
      this.state.points.length > 0
        ? this.state.activePlane
        : incoming;
    return { plane: this.planeForType(type), type };
  }

  onPointerDown(input: ToolPointerInput, context: ModellingContext): void {
    if (input.button !== 'left') return;
    if (this.state.stage === 'width') {
      this.widthDragging = true;
      this.applyWidthFromPointer(input, context);
      return;
    }

    const resolved = this.resolveDrawPlane(input.viewportId, context);
    if (!resolved) return;
    const { plane, type } = resolved;
    this.state.activePlane = type;

    const hit = rayPlaneIntersection(input.rayOrigin, input.rayDirection, plane);
    if (!hit) return;

    // Snap to centerline if mirrorX is enabled in front view
    if (this.mirrorX && type === 'front' && Math.abs(hit.x) < 0.08) {
      hit.x = 0;
    }

    if (this.isNearFirst(hit, input) && !this.state.closed) {
      this.state.closed = true;
      this.state.canClose = false;
      this.state.previewPoint = null;
      this.state.revision += 1;
      context.requestRedraw();
      this.beginWidthStage(context);
      return;
    }

    // Check if clicking an existing point to drag
    const grabR = this.pointGrabRadius(input);
    const grabRSq = grabR * grabR;
    for (let i = 0; i < this.state.points.length; i++) {
      const p = this.state.points[i]!;
      const distSq = (p.x - hit.x) ** 2 + (p.y - hit.y) ** 2 + (p.z - hit.z) ** 2;
      if (distSq < grabRSq) {
        this.state.draggingIndex = i;
        this.state.revision += 1;
        context.requestRedraw();
        return;
      }
    }

    if (this.state.closed) {
      if (this.canBeginWidth()) {
        this.beginWidthStage(context);
        this.widthDragging = true;
        this.applyWidthFromPointer(input, context);
        return;
      }
      this.state.points = [hit];
      this.state.closed = false;
      this.state.canClose = false;
      this.state.revision += 1;
      context.requestRedraw();
      return;
    }

    // Add new point
    this.state.points.push(hit);
    this.state.previewPoint = hit;
    this.state.revision += 1;
    context.requestRedraw();
  }

  onPointerMove(input: ToolPointerInput, context: ModellingContext): void {
    if (this.state.stage === 'width') {
      this.applyWidthFromPointer(input, context);
      return;
    }
    const resolved = this.resolveDrawPlane(input.viewportId, context);
    if (!resolved) return;
    const { plane, type } = resolved;
    const hit = rayPlaneIntersection(input.rayOrigin, input.rayDirection, plane);
    if (!hit) return;

    if (this.mirrorX && type === 'front' && Math.abs(hit.x) < 0.08) {
      hit.x = 0;
    }

    if (this.state.draggingIndex >= 0 && this.state.draggingIndex < this.state.points.length) {
      this.state.points[this.state.draggingIndex] = hit;
      this.state.previewPoint = hit;
      this.state.revision += 1;
      context.requestRedraw();
      return;
    }

    const canClose = this.isNearFirst(hit, input) && !this.state.closed;
    this.state.previewPoint = canClose ? this.state.points[0]! : hit;
    this.state.canClose = canClose;

    this.state.revision += 1;
    context.requestRedraw();
  }

  onPointerUp(_input: ToolPointerInput, context: ModellingContext): void {
    if (this.state.stage === 'width' && this.widthDragging) {
      this.widthDragging = false;
      this.commitExtrude(context);
      return;
    }
    if (this.state.draggingIndex >= 0) {
      this.state.draggingIndex = -1;
      this.state.revision += 1;
      context.requestRedraw();
    }
  }

  onKeyDown(event: KeyboardEvent, context: ModellingContext): void {
    if (event.key === 'Enter') {
      event.preventDefault();
      if (this.state.stage === 'width') this.commitExtrude(context);
      else this.beginWidthStage(context);
    } else if (event.key === 'Backspace' || event.key === 'Delete') {
      event.preventDefault();
      if (this.state.stage === 'width') {
        this.cancelWidthStage(context);
        return;
      }
      if (this.state.points.length > 0) {
        this.state.points.pop();
        this.state.closed = false;
        this.state.revision += 1;
        context.requestRedraw();
      }
    } else if (event.key === 'Escape') {
      event.preventDefault();
      if (this.state.stage === 'width') this.cancelWidthStage(context);
      else this.clear(context);
    } else if (event.code === 'KeyC') {
      event.preventDefault();
      this.mirrorX = !this.mirrorX;
      this.state.revision += 1;
      context.requestRedraw();
    }
  }

  canBeginWidth(): boolean {
    return this.state.points.length >= 3 || (this.mirrorX && this.state.points.length >= 2);
  }

  beginWidthStage(context: ModellingContext): boolean {
    if (!this.canBeginWidth()) return false;
    this.state.stage = 'width';
    this.state.closed = true;
    this.state.canClose = false;
    this.state.previewPoint = null;
    this.widthScreenAnchor = null;
    this.widthDragging = false;
    this.state.revision += 1;
    context.requestRedraw();
    return true;
  }

  cancelWidthStage(context: ModellingContext): void {
    this.state.stage = 'draw';
    this.widthScreenAnchor = null;
    this.widthDragging = false;
    this.state.revision += 1;
    context.requestRedraw();
  }

  private applyWidthFromPointer(input: ToolPointerInput, context: ModellingContext): void {
    const origin = this.state.points[0];
    if (!origin) return;
    const n = planeNormal(this.state.activePlane);
    const view = normalizeVec3(input.rayDirection);
    const alongNormal = Math.abs(dotVec3(view, n)) > 0.92;
    let width: number;
    if (alongNormal) {
      if (!this.widthScreenAnchor) {
        this.widthScreenAnchor = { screenY: input.screenY, startWidth: this.thickness };
      }
      const units = input.worldUnitsPerPixel ?? 0.01;
      width = this.widthScreenAnchor.startWidth + (this.widthScreenAnchor.screenY - input.screenY) * units;
    } else {
      this.widthScreenAnchor = null;
      let side = crossVec3(n, view);
      if (lengthSqVec3(side) < 1e-10) {
        side = Math.abs(n.y) < 0.9 ? crossVec3(n, v3(0, 1, 0)) : crossVec3(n, v3(1, 0, 0));
      }
      side = normalizeVec3(side);
      const faceCamera = normalizeVec3(crossVec3(side, n));
      const hit = rayPlaneIntersection(input.rayOrigin, input.rayDirection, {
        origin,
        normal: faceCamera,
        xAxis: side,
        yAxis: n,
      });
      const signed = hit ? dotVec3(subVec3(hit, origin), n) : this.thickness;
      width = this.symmetric ? Math.abs(signed) * 2 : Math.abs(signed);
    }
    if (context.snapEnabled !== input.ctrlKey) {
      width = snapScalarToIncrement(width, context.gridSize || 0.1);
    }
    this.setThickness(width, context);
  }

  commitExtrude(context: ModellingContext): boolean {
    if (this.state.points.length < 3 && (!this.mirrorX || this.state.points.length < 2)) return false;

    const planeType = this.state.activePlane;
    const rawPoints = buildSymmetricPoints(this.state.points, this.mirrorX, planeType);
    const mesh = buildBlockoutExtrudeMesh(
      rawPoints,
      planeType,
      this.thickness,
      this.symmetric,
      this.id === 'blockout-solid' ? 'Blockout Solid' : this.id === 'blockout-round' ? 'Blockout Round' : 'Blockout Extrude',
    );
    if (!mesh) return false;
    const origin = localizeMeshToBoundsCentre(mesh);
    const beforeSelection = cloneSelection(context.selection.state);
    const { objectId, meshId } = commitMeshObject(context.document, mesh, {
      name: mesh.name,
    });
    const object = context.document.objects.get(objectId);
    const meshRef = context.document.meshes.get(meshId);
    if (object) {
      object.transform.position = origin;
      applyDefaultBlockoutLook(context.document, objectId);
    }
    if (object && meshRef) {
      context.selection.setMode('object');
      context.selection.selectObjects([objectId], 'replace');
      const afterSelection = cloneSelection(context.selection.state);
      let applied = true;
      context.history.execute({
        name: `Create ${mesh.name}`,
        execute: () => {
          if (applied) return;
          context.document.objects.set(object.id, object);
          context.document.meshes.set(meshRef.id, meshRef);
          if (!context.document.rootObjectIds.includes(object.id)) {
            context.document.rootObjectIds.push(object.id);
          }
          context.selection.state = cloneSelection(afterSelection);
          context.document.dirty = true;
          applied = true;
        },
        undo: () => {
          context.document.objects.delete(object.id);
          context.document.rootObjectIds = context.document.rootObjectIds.filter((id) => id !== object.id);
          if (![...context.document.objects.values()].some((item) => item.meshId === meshRef.id)) {
            context.document.meshes.delete(meshRef.id);
          }
          context.selection.state = cloneSelection(beforeSelection);
          context.document.dirty = true;
          applied = false;
        },
      });
    }

    this.clear(context);
    context.setActiveTool?.('select');
    context.setGizmoMode?.('combined');
    return true;
  }

  private pointGrabRadius(input: ToolPointerInput): number {
    return Math.max(0.16, (input.worldUnitsPerPixel ?? 0.01) * 16);
  }

  private isNearFirst(hit: Vec3, input: ToolPointerInput): boolean {
    if (this.state.points.length < 3) return false;
    const first = this.state.points[0]!;
    const r = this.pointGrabRadius(input);
    const distSq = (first.x - hit.x) ** 2 + (first.y - hit.y) ** 2 + (first.z - hit.z) ** 2;
    return distSq <= r * r;
  }

  getPreviewMesh(): EditableMesh | null {
    if (this.id === 'blockout-vector' && this.state.stage !== 'width') return null;
    const info = this.getPreviewInfo();
    const pts = info.closed || this.state.stage === 'width' ? info.points : info.chainPoints;
    return buildBlockoutExtrudeMesh(pts, this.state.activePlane, this.thickness, this.symmetric);
  }

  getPreviewInfo(): BlockoutVectorPreviewInfo {
    const rawChain = [...this.state.points];
    if (this.state.closed && rawChain.length >= 2) {
      rawChain.push(rawChain[0]!);
    } else if (this.state.previewPoint && !this.state.closed) {
      rawChain.push(this.state.previewPoint);
    }
    const chainPoints = buildSymmetricPoints(rawChain, this.mirrorX, this.state.activePlane);
    const displayPoints = buildSymmetricPoints(this.state.points, this.mirrorX, this.state.activePlane);

    return {
      points: displayPoints,
      chainPoints,
      canClose: this.state.canClose,
      closed: this.state.closed,
      stage: this.state.stage,
      activePlane: this.state.activePlane,
      mirrorX: this.mirrorX,
      thickness: this.thickness,
      symmetric: this.symmetric,
    };
  }

  begin(input: ToolPointerInput, context: ModellingContext): void {
    this.onPointerDown(input, context);
  }

  update(input: ToolPointerInput, context: ModellingContext): void {
    this.onPointerMove(input, context);
  }

  preview(_context: ModellingContext): void {}

  confirm(context: ModellingContext): void {
    if (this.state.stage === 'width') this.commitExtrude(context);
    else this.beginWidthStage(context);
  }

  cancel(context: ModellingContext): void {
    this.clear(context);
  }

  getAllowedSelectionModes(): readonly SelectionMode[] {
    return ['object'];
  }

  getSnapPolicy(): readonly SnapQuery['allowed'][number][] {
    return ['vertex', 'grid'];
  }
}
