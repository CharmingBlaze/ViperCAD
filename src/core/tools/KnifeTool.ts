import type { ObjectId } from '@/core/document/types';
import { runMeshTransaction } from '@/core/history/Transaction';
import { inverseTransformPointApprox, transformPoint, type Transform } from '@/core/math/Transform';
import {
  addVec3,
  dotVec3,
  scaleVec3,
  subVec3,
  type Vec3,
} from '@/core/math/Vec3';
import { faceVertexIds } from '@/core/mesh/EditableMesh';
import { computeFaceNormal } from '@/core/mesh/Normals';
import {
  closestBoundaryEdgeToPoint,
  knifeFace,
  type FaceEdgeHit,
} from '@/core/mesh/ops/cut';
import type { EditableMesh, FaceId } from '@/core/mesh/types';
import type { ModellingContext, Tool, ToolPointerInput } from './Tool';

export type KnifeViewportPick = {
  objectId: ObjectId;
  faceId: FaceId;
  /** Intersection in mesh-local space. */
  localPoint: Vec3;
  transform: Transform;
};

/**
 * Drag across a face to cut a chord between two boundary edges.
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
  private faceId: FaceId | null = null;
  private transform: Transform | null = null;
  private entry: FaceEdgeHit | null = null;
  private exit: FaceEdgeHit | null = null;
  private planeOrigin: Vec3 | null = null;
  private planeNormal: Vec3 | null = null;

  setViewportPick(pick: KnifeViewportPick | null): void {
    this.viewportPick = pick;
  }

  getPreviewPoints(): Vec3[] {
    if (!this.entry || !this.transform) return [];
    const a = transformPoint(this.entry.point, this.transform);
    const b = transformPoint((this.exit ?? this.entry).point, this.transform);
    return [a, b];
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
    this.faceId = pick.faceId;
    this.transform = pick.transform;
    this.entry = entry;
    this.exit = null;
    this.state.dragging = true;
    this.state.lastError = null;
    this.cacheFacePlane(mesh, pick.faceId);
    this.touch(context);
  }

  update(input: ToolPointerInput, context: ModellingContext): void {
    if (!this.state.dragging || !this.objectId || !this.faceId || !this.entry) return;
    const mesh = this.meshFor(context, this.objectId);
    if (!mesh) return;

    let localPoint = this.viewportPick?.localPoint ?? null;
    if (
      !localPoint ||
      this.viewportPick?.objectId !== this.objectId ||
      this.viewportPick?.faceId !== this.faceId
    ) {
      localPoint = this.intersectFacePlane(input);
    }
    if (!localPoint) return;

    const exit = closestBoundaryEdgeToPoint(mesh, this.faceId, localPoint, {
      excludeEdgeId: this.entry.edgeId,
    });
    this.exit = exit;
    this.touch(context);
  }

  preview(_context: ModellingContext): void {}

  confirm(context: ModellingContext): void {
    if (!this.state.dragging) return;
    const objectId = this.objectId;
    const faceId = this.faceId;
    const entry = this.entry;
    const exit = this.exit;
    if (!objectId || !faceId || !entry || !exit || entry.edgeId === exit.edgeId) {
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
      'Knife Face',
      (m) => {
        const cut = knifeFace(m, faceId, entry.edgeId, exit.edgeId, entry.factor, exit.factor);
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
    // Transform world ray into local space via two points.
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
    this.faceId = null;
    this.transform = null;
    this.entry = null;
    this.exit = null;
    this.planeOrigin = null;
    this.planeNormal = null;
    this.viewportPick = null;
  }

  private touch(context: ModellingContext): void {
    this.state.revision += 1;
    context.requestRedraw();
  }
}
