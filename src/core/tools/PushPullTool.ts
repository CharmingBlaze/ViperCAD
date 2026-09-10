import type { ObjectId } from '@/core/document/types';
import {
  cloneMeshPreserveIds,
  restoreMeshFromSnapshot,
} from '@/core/mesh/EditableMesh';
import { cloneTransform, inverseTransformPointApprox, transformPoint, type Transform } from '@/core/math/Transform';
import {
  addVec3,
  cloneVec3,
  crossVec3,
  dotVec3,
  lengthSqVec3,
  normalizeVec3,
  scaleVec3,
  subVec3,
  v3,
  type Vec3,
} from '@/core/math/Vec3';
import { computeFaceNormal } from '@/core/mesh/Normals';
import { extrudeFaceRegion, setVerticesPositions } from '@/core/mesh/ops/extrude';
import type { EditableMesh, FaceId, VertexId } from '@/core/mesh/types';
import { expandSymmetryFaceIds } from '@/core/symmetry/Symmetry';
import type { ModellingContext, Tool, ToolPointerInput } from './Tool';

export type PushPullViewportPick = {
  objectId: ObjectId;
  faceId: FaceId;
  localPoint: Vec3;
  transform: Transform;
};

type Phase = 'hover' | 'dragging';

/**
 * SketchUp-style Push/Pull: hover a face → click → move to extrude → click/Enter to commit.
 */
export class PushPullTool implements Tool {
  id = 'push-pull' as const;
  label = 'Push/Pull';

  state = {
    phase: 'hover' as Phase,
    distance: 0,
    revision: 0,
    lastError: null as string | null,
  };

  private viewportPick: PushPullViewportPick | null = null;
  private objectId: ObjectId | null = null;
  private transform: Transform | null = null;
  private meshBefore: EditableMesh | null = null;
  private extrudedVertexIds: VertexId[] = [];
  private basePositions = new Map<VertexId, Vec3>();
  private localNormal = v3(0, 1, 0);
  private localStart = v3(0, 0, 0);
  private worldNormal = v3(0, 1, 0);
  private worldStart = v3(0, 0, 0);

  setViewportPick(pick: PushPullViewportPick | null): void {
    this.viewportPick = pick;
  }

  getStatusLine(): string {
    if (this.state.lastError) return `Push/Pull · ${this.state.lastError}`;
    if (this.state.phase === 'dragging') {
      const sign = this.state.distance >= 0 ? '+' : '';
      return `Push/Pull · ${sign}${this.state.distance.toFixed(3)} · click / Enter to finish · Esc cancel`;
    }
    return this.viewportPick
      ? 'Push/Pull · click face to extrude'
      : 'Push/Pull · hover a face';
  }

  activate(context: ModellingContext): void {
    this.resetLive(context);
    context.selection.setMode('face');
    context.requestRedraw();
  }

  deactivate(context: ModellingContext): void {
    if (this.state.phase === 'dragging') {
      this.restoreBefore(context);
    }
    this.resetLive(context);
    context.requestRedraw();
  }

  begin(input: ToolPointerInput, context: ModellingContext): void {
    if (input.button !== 'left') return;

    if (this.state.phase === 'dragging') {
      this.confirm(context);
      return;
    }

    const pick = this.viewportPick;
    if (!pick) {
      this.state.lastError = 'Click a face to push/pull';
      this.touch(context);
      return;
    }

    const mesh = meshFor(context, pick.objectId);
    if (!mesh || !mesh.faces.has(pick.faceId)) {
      this.state.lastError = 'No face under cursor';
      this.touch(context);
      return;
    }

    const faceIds = [
      ...expandSymmetryFaceIds(
        mesh,
        new Set([pick.faceId]),
        context.document.settings.symmetry,
      ),
    ];
    const primaryNormal = computeFaceNormal(mesh, pick.faceId);
    if (lengthSqVec3(primaryNormal) < 1e-12) {
      this.state.lastError = 'Face normal is degenerate';
      this.touch(context);
      return;
    }

    this.meshBefore = cloneMeshPreserveIds(mesh);
    const result = extrudeFaceRegion(mesh, faceIds, {
      distance: 0,
      direction: primaryNormal,
    });
    if (!result.ok) {
      this.meshBefore = null;
      this.state.lastError = result.error?.message ?? 'Could not extrude that face';
      this.touch(context);
      return;
    }

    context.selection.applyTopologyChange(result.change);
    this.objectId = pick.objectId;
    this.transform = cloneTransform(pick.transform);
    this.localNormal = normalizeVec3(primaryNormal);
    this.localStart = cloneVec3(pick.localPoint);
    this.worldStart = transformPoint(this.localStart, this.transform);
    this.worldNormal = normalizeVec3(
      subVec3(
        transformPoint(addVec3(this.localStart, this.localNormal), this.transform),
        this.worldStart,
      ),
    );
    this.extrudedVertexIds = [...result.change.createdVertexIds];
    this.basePositions = new Map();
    for (const id of this.extrudedVertexIds) {
      const v = mesh.vertices.get(id);
      if (v) this.basePositions.set(id, cloneVec3(v.position));
    }

    this.state.phase = 'dragging';
    this.state.distance = 0;
    this.state.lastError = null;
    context.document.dirty = true;
    this.touch(context);
  }

  update(input: ToolPointerInput, context: ModellingContext): void {
    if (this.state.phase === 'dragging') {
      this.applyDistance(this.distanceFromPointer(input), context);
      return;
    }

    const pick = this.viewportPick;
    if (!pick) {
      if (context.selection.state.hoveredFaceId) {
        context.selection.clearHover();
        this.state.lastError = null;
        this.touch(context);
      }
      return;
    }

    context.selection.setMode('face');
    context.selection.selectObjects([pick.objectId], 'replace');
    context.selection.setHoverFace(pick.faceId);
    this.state.lastError = null;
    this.touch(context);
  }

  preview(_context: ModellingContext): void {}

  confirm(context: ModellingContext): void {
    if (this.state.phase !== 'dragging' || !this.objectId || !this.meshBefore) {
      this.resetLive(context);
      return;
    }

    const mesh = meshFor(context, this.objectId);
    if (!mesh) {
      this.resetLive(context);
      return;
    }

    // Tiny moves are treated as cancel (no history noise).
    if (Math.abs(this.state.distance) < 1e-5) {
      this.restoreBefore(context);
      this.resetLive(context);
      context.requestRedraw();
      return;
    }

    const before = this.meshBefore;
    const after = cloneMeshPreserveIds(mesh);
    const objectId = this.objectId;
    const selectionAfter = {
      mode: context.selection.state.mode,
      objectIds: [...context.selection.state.selectedObjectIds],
      faceIds: [...context.selection.state.selectedFaceIds],
      edgeIds: [...context.selection.state.selectedEdgeIds],
      vertexIds: [...context.selection.state.selectedVertexIds],
      activeObjectId: context.selection.state.activeObjectId,
    };
    let applied = true;

    context.history.execute({
      name: 'Push/Pull',
      execute: () => {
        if (applied) return;
        restoreMeshFromSnapshot(mesh, after);
        context.selection.setMode(selectionAfter.mode);
        context.selection.selectObjects(selectionAfter.objectIds, 'replace');
        if (selectionAfter.mode === 'face') {
          context.selection.selectFaces(selectionAfter.faceIds, 'replace');
        }
        context.document.dirty = true;
        applied = true;
      },
      undo: () => {
        restoreMeshFromSnapshot(mesh, before);
        context.selection.setMode('face');
        context.selection.selectObjects([objectId], 'replace');
        context.selection.selectFaces([], 'replace');
        context.document.dirty = true;
        applied = false;
      },
    });

    this.meshBefore = null;
    this.resetLive(context);
    context.requestRedraw();
  }

  cancel(context: ModellingContext): void {
    if (this.state.phase === 'dragging') {
      this.restoreBefore(context);
    }
    this.resetLive(context);
    context.requestRedraw();
  }

  getAllowedSelectionModes() {
    return ['face', 'object'] as const;
  }

  getSnapPolicy() {
    return ['face'] as const;
  }

  private distanceFromPointer(input: ToolPointerInput): number {
    if (!this.transform) return this.state.distance;

    const viewDir = normalizeVec3(input.rayDirection);
    let side = crossVec3(this.worldNormal, viewDir);
    if (lengthSqVec3(side) < 1e-10) {
      side = crossVec3(this.worldNormal, v3(0, 1, 0));
      if (lengthSqVec3(side) < 1e-10) side = crossVec3(this.worldNormal, v3(1, 0, 0));
    }
    const planeNormal = normalizeVec3(crossVec3(side, this.worldNormal));
    const hit = rayPlaneIntersect(input.rayOrigin, input.rayDirection, this.worldStart, planeNormal);
    if (!hit) return this.state.distance;

    const localHit = inverseTransformPointApprox(hit, this.transform);
    return dotVec3(subVec3(localHit, this.localStart), this.localNormal);
  }

  private applyDistance(distance: number, context: ModellingContext): void {
    if (!this.objectId) return;
    const mesh = meshFor(context, this.objectId);
    if (!mesh) return;

    const positions = new Map<VertexId, Vec3>();
    const offset = scaleVec3(this.localNormal, distance);
    for (const id of this.extrudedVertexIds) {
      const base = this.basePositions.get(id);
      if (!base) continue;
      positions.set(id, addVec3(base, offset));
    }
    setVerticesPositions(mesh, positions);
    this.state.distance = distance;
    context.document.dirty = true;
    this.touch(context);
  }

  private restoreBefore(context: ModellingContext): void {
    if (!this.objectId || !this.meshBefore) return;
    const mesh = meshFor(context, this.objectId);
    if (!mesh) return;
    restoreMeshFromSnapshot(mesh, this.meshBefore);
    context.selection.selectFaces([], 'replace');
    context.document.dirty = true;
  }

  private resetLive(context: ModellingContext): void {
    this.viewportPick = null;
    this.objectId = null;
    this.transform = null;
    this.meshBefore = null;
    this.extrudedVertexIds = [];
    this.basePositions = new Map();
    this.state.phase = 'hover';
    this.state.distance = 0;
    this.state.lastError = null;
    this.state.revision += 1;
    context.selection.clearHover();
  }

  private touch(context: ModellingContext): void {
    this.state.revision += 1;
    context.requestRedraw();
  }
}

function meshFor(context: ModellingContext, objectId: ObjectId): EditableMesh | null {
  const object = context.document.objects.get(objectId);
  if (!object?.meshId) return null;
  return context.document.meshes.get(object.meshId) ?? null;
}

function rayPlaneIntersect(
  origin: Vec3,
  direction: Vec3,
  planePoint: Vec3,
  planeNormal: Vec3,
): Vec3 | null {
  const denom = dotVec3(direction, planeNormal);
  if (Math.abs(denom) < 1e-8) return null;
  const t = dotVec3(subVec3(planePoint, origin), planeNormal) / denom;
  if (!Number.isFinite(t)) return null;
  return addVec3(origin, scaleVec3(direction, t));
}
