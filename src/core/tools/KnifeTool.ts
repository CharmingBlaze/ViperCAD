import type { ObjectId } from '@/core/document/types';
import { runMeshTransaction } from '@/core/history/Transaction';
import { inverseTransformPointApprox, transformPoint, type Transform } from '@/core/math/Transform';
import {
  addVec3,
  dotVec3,
  lengthSqVec3,
  lerpVec3,
  scaleVec3,
  subVec3,
  type Vec3,
} from '@/core/math/Vec3';
import { faceHalfEdgeIds, faceVertexIds, getEdgeVertices } from '@/core/mesh/EditableMesh';
import { computeFaceNormal } from '@/core/mesh/Normals';
import {
  closestBoundaryEdgeToPoint,
  knifePath,
  type FaceEdgeHit,
  type KnifePathHit,
} from '@/core/mesh/ops/cut';
import type { EditableMesh, EdgeId, FaceId } from '@/core/mesh/types';
import type { ModellingContext, Tool, ToolPointerInput } from './Tool';

export type KnifeViewportPick = {
  objectId: ObjectId;
  faceId: FaceId;
  /** Intersection in mesh-local space. */
  localPoint: Vec3;
  transform: Transform;
};

/**
 * Drag across one or more faces to cut a chord / path between boundary edges.
 * Crossing onto an adjacent face inserts a hit on the shared edge.
 * Viewport supplies face picks via {@link setViewportPick} before begin/update.
 */
export class KnifeTool implements Tool {
  id = 'knife' as const;
  label = 'Knife';

  state = {
    dragging: false,
    revision: 0,
    lastError: null as string | null,
  };

  private viewportPick: KnifeViewportPick | null = null;
  private objectId: ObjectId | null = null;
  private transform: Transform | null = null;
  /** Committed path hits (entry + any shared-edge crossings). */
  private pathHits: KnifePathHit[] = [];
  /** Local-space points matching pathHits for preview. */
  private pathPoints: Vec3[] = [];
  /** Tentative exit on the current face. */
  private exit: FaceEdgeHit | null = null;
  private currentFaceId: FaceId | null = null;
  private planeOrigin: Vec3 | null = null;
  private planeNormal: Vec3 | null = null;

  setViewportPick(pick: KnifeViewportPick | null): void {
    this.viewportPick = pick;
  }

  getPreviewPoints(): Vec3[] {
    if (!this.transform || !this.pathPoints.length) return [];
    const points = [...this.pathPoints];
    if (this.exit) points.push(this.exit.point);
    return points.map((p) => transformPoint(p, this.transform!));
  }

  activate(context: ModellingContext): void {
    this.reset();
    this.state.lastError = null;
    context.requestRedraw();
  }

  deactivate(context: ModellingContext): void {
    this.reset();
    context.requestRedraw();
  }

  begin(input: ToolPointerInput, context: ModellingContext): void {
    if (input.button !== 'left') return;
    if (this.state.dragging) {
      // Blender-style second click: use the current preview point and commit.
      this.update(input, context);
      this.confirm(context);
      return;
    }
    const pick = this.viewportPick;
    if (!pick) {
      this.state.lastError = 'Click a face to start the knife cut';
      this.touch(context);
      return;
    }
    const mesh = this.meshFor(context, pick.objectId);
    if (!mesh || !mesh.faces.has(pick.faceId)) {
      this.state.lastError = 'No mesh face under cursor';
      this.touch(context);
      return;
    }

    const entry = closestBoundaryEdgeToPoint(mesh, pick.faceId, pick.localPoint);
    if (!entry) {
      this.state.lastError = 'Could not find a face edge to cut from';
      this.touch(context);
      return;
    }

    this.objectId = pick.objectId;
    this.transform = pick.transform;
    this.currentFaceId = pick.faceId;
    this.pathHits = [{ faceId: pick.faceId, edgeId: entry.edgeId, factor: entry.factor }];
    this.pathPoints = [{ ...entry.point }];
    this.exit = null;
    this.state.dragging = true;
    this.state.lastError = null;
    this.cacheFacePlane(mesh, pick.faceId);
    this.touch(context);
  }

  update(input: ToolPointerInput, context: ModellingContext): void {
    if (!this.state.dragging || !this.objectId || !this.currentFaceId || !this.pathHits.length) return;
    const mesh = this.meshFor(context, this.objectId);
    if (!mesh) return;

    const pick = this.viewportPick;
    if (pick && pick.objectId === this.objectId && pick.faceId !== this.currentFaceId) {
      // Crossed onto an adjacent face — pin shared-edge hit and continue.
      const shared = sharedEdgeBetweenFaces(mesh, this.currentFaceId, pick.faceId);
      if (shared) {
        const last = this.pathHits[this.pathHits.length - 1]!;
        if (last.edgeId !== shared.edgeId) {
          const factor = shared.factorForPoint(pick.localPoint);
          this.pathHits.push({
            faceId: this.currentFaceId,
            edgeId: shared.edgeId,
            factor,
          });
          this.pathPoints.push(this.edgePoint(mesh, { faceId: this.currentFaceId, edgeId: shared.edgeId, factor }));
        }
        this.currentFaceId = pick.faceId;
        this.cacheFacePlane(mesh, pick.faceId);
      }
    }

    let localPoint = pick?.localPoint ?? null;
    if (!localPoint || pick?.objectId !== this.objectId) {
      localPoint = this.intersectFacePlane(input);
    }
    if (!localPoint) return;

    const exclude = this.pathHits[this.pathHits.length - 1]!.edgeId;
    this.exit = closestBoundaryEdgeToPoint(mesh, this.currentFaceId, localPoint, {
      excludeEdgeId: exclude,
    });
    this.touch(context);
  }

  preview(_context: ModellingContext): void {}

  confirm(context: ModellingContext): void {
    if (!this.state.dragging) return;
    const objectId = this.objectId;
    const exit = this.exit;
    if (!objectId || !this.currentFaceId || !exit || this.pathHits.length === 0) {
      this.state.lastError = 'Drag across the face to a different edge';
      this.reset();
      this.touch(context);
      return;
    }

    const hits: KnifePathHit[] = [
      ...this.pathHits,
      { faceId: this.currentFaceId, edgeId: exit.edgeId, factor: exit.factor },
    ];
    // Deduplicate consecutive identical hits.
    const compact: KnifePathHit[] = [];
    for (const hit of hits) {
      const prev = compact[compact.length - 1];
      if (prev && prev.edgeId === hit.edgeId && Math.abs(prev.factor - hit.factor) < 1e-6) continue;
      compact.push(hit);
    }
    if (compact.length < 2) {
      this.state.lastError = 'Drag across the face to a different edge';
      this.reset();
      this.touch(context);
      return;
    }

    const mesh = this.meshFor(context, objectId);
    if (!mesh) {
      this.reset();
      this.touch(context);
      return;
    }

    const result = runMeshTransaction(
      context.history,
      mesh,
      compact.length > 2 ? 'Knife Path' : 'Knife Face',
      (m) => {
        const cut = knifePath(m, compact);
        if (!cut.ok) throw new Error(cut.error?.message ?? 'Knife failed');
        context.selection.applyTopologyChange(cut.change);
        return cut.change;
      },
      { selection: context.selection },
    );

    if (!result.ok) {
      this.state.lastError = result.error ?? 'Knife failed';
    } else {
      this.state.lastError = null;
    }
    this.reset();
    this.touch(context);
  }

  cancel(context: ModellingContext): void {
    this.reset();
    this.touch(context);
  }

  getAllowedSelectionModes() {
    return ['face', 'edge', 'object'] as const;
  }

  getSnapPolicy() {
    return ['face', 'edge'] as const;
  }

  private meshFor(context: ModellingContext, objectId: ObjectId): EditableMesh | null {
    const object = context.document.objects.get(objectId);
    if (!object?.meshId) return null;
    return context.document.meshes.get(object.meshId) ?? null;
  }

  private edgePoint(mesh: EditableMesh, hit: KnifePathHit): Vec3 {
    const ends = getEdgeVertices(mesh, hit.edgeId);
    if (!ends) return { x: 0, y: 0, z: 0 };
    return lerpVec3(
      mesh.vertices.get(ends[0])!.position,
      mesh.vertices.get(ends[1])!.position,
      hit.factor,
    );
  }

  private cacheFacePlane(mesh: EditableMesh, faceId: FaceId): void {
    const verts = faceVertexIds(mesh, faceId);
    const first = mesh.vertices.get(verts[0]!)?.position;
    if (!first) {
      this.planeOrigin = null;
      this.planeNormal = null;
      return;
    }
    this.planeOrigin = { ...first };
    this.planeNormal = computeFaceNormal(mesh, faceId);
  }

  private intersectFacePlane(input: ToolPointerInput): Vec3 | null {
    if (!this.planeOrigin || !this.planeNormal || !this.transform) return null;
    const worldA = input.rayOrigin;
    const worldB = addVec3(input.rayOrigin, input.rayDirection);
    const localA = inverseTransformPointApprox(worldA, this.transform);
    const localB = inverseTransformPointApprox(worldB, this.transform);
    const dir = subVec3(localB, localA);
    const denom = dotVec3(this.planeNormal, dir);
    if (Math.abs(denom) < 1e-10) return null;
    const t = dotVec3(this.planeNormal, subVec3(this.planeOrigin, localA)) / denom;
    if (t < 0) return null;
    return addVec3(localA, scaleVec3(dir, t));
  }

  private reset(): void {
    this.state.dragging = false;
    this.objectId = null;
    this.transform = null;
    this.pathHits = [];
    this.pathPoints = [];
    this.exit = null;
    this.currentFaceId = null;
    this.planeOrigin = null;
    this.planeNormal = null;
    this.viewportPick = null;
  }

  private touch(context: ModellingContext): void {
    this.state.revision += 1;
    context.requestRedraw();
  }
}

function sharedEdgeBetweenFaces(
  mesh: EditableMesh,
  faceA: FaceId,
  faceB: FaceId,
): { edgeId: EdgeId; factorForPoint: (point: Vec3) => number } | null {
  for (const heId of faceHalfEdgeIds(mesh, faceA)) {
    const he = mesh.halfEdges.get(heId);
    if (!he?.twinHalfEdgeId) continue;
    const twin = mesh.halfEdges.get(he.twinHalfEdgeId);
    if (twin?.faceId !== faceB) continue;
    const edgeId = he.edgeId;
    return {
      edgeId,
      factorForPoint: (point: Vec3) => {
        const ends = getEdgeVertices(mesh, edgeId);
        if (!ends) return 0.5;
        const a = mesh.vertices.get(ends[0])!.position;
        const b = mesh.vertices.get(ends[1])!.position;
        const ab = subVec3(b, a);
        const ap = subVec3(point, a);
        const abLenSq = lengthSqVec3(ab);
        if (abLenSq < 1e-20) return 0.5;
        return Math.max(0.0001, Math.min(0.9999, dotVec3(ap, ab) / abLenSq));
      },
    };
  }
  return null;
}
