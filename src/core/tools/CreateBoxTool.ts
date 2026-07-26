import { commitMeshObject } from '@/core/document/ModelDocument';
import type { ObjectId } from '@/core/document/types';
import { addVec3, dotVec3, scaleVec3, subVec3, v3, type Vec3 } from '@/core/math/Vec3';
import { buildBox } from '@/core/mesh/builders/BoxBuilder';
import type { EditableMesh } from '@/core/mesh/types';
import {
  rayPlaneIntersection,
  resolveSnap,
  type ConstructionPlane,
} from '@/core/snap/SnapEngine';
import type { ModellingContext, Tool, ToolPointerInput } from './Tool';

export type BoxDrawStage = 'idle' | 'base' | 'height' | 'done';

export type BoxPreviewState = {
  stage: BoxDrawStage;
  cornerA: Vec3 | null;
  cornerB: Vec3 | null;
  height: number;
  plane: ConstructionPlane | null;
};

/**
 * CAD-style three-stage box creation:
 * 1) Place first corner
 * 2) Draw base rectangle
 * 3) Set height
 */
export class CreateBoxTool implements Tool {
  id = 'create-box' as const;
  label = 'Create Box';

  previewState: BoxPreviewState = {
    stage: 'idle',
    cornerA: null,
    cornerB: null,
    height: 0,
    plane: null,
  };

  activate(_context: ModellingContext): void {
    this.reset();
  }

  deactivate(_context: ModellingContext): void {
    this.reset();
  }

  begin(input: ToolPointerInput, context: ModellingContext): void {
    if (input.button !== 'left') return;
    const hit = this.hitOnPlane(input, context);
    if (!hit) return;

    if (this.previewState.stage === 'idle') {
      this.previewState.stage = 'base';
      this.previewState.cornerA = hit;
      this.previewState.cornerB = hit;
      this.previewState.plane = context.constructionPlane;
      this.previewState.height = 0;
      context.requestRedraw();
      return;
    }

    if (this.previewState.stage === 'base') {
      this.previewState.cornerB = hit;
      this.previewState.stage = 'height';
      context.requestRedraw();
      return;
    }

    if (this.previewState.stage === 'height') {
      this.previewState.height = this.computeHeight(input, context);
      this.confirm(context);
    }
  }

  update(input: ToolPointerInput, context: ModellingContext): void {
    if (this.previewState.stage === 'base') {
      const hit = this.hitOnPlane(input, context);
      if (hit) {
        this.previewState.cornerB = hit;
        context.requestRedraw();
      }
      return;
    }
    if (this.previewState.stage === 'height') {
      this.previewState.height = this.computeHeight(input, context);
      if (input.numericValue != null) this.previewState.height = input.numericValue;
      context.requestRedraw();
    }
  }

  preview(_context: ModellingContext): void {}

  confirm(context: ModellingContext): void {
    const { cornerA, cornerB, height } = this.previewState;
    if (!cornerA || !cornerB) {
      this.reset();
      return;
    }

    const plane = this.previewState.plane ?? context.constructionPlane;
    const delta = subVec3(cornerB, cornerA);
    const localX = dotVec3(delta, plane.xAxis);
    const localY = dotVec3(delta, plane.yAxis);
    const width = Math.abs(localX);
    const depth = Math.abs(localY);
    const h = Math.abs(height) < 1e-8 ? context.gridSize : Math.abs(height);
    if (width < 1e-8 || depth < 1e-8) {
      this.reset();
      return;
    }

    const mesh = buildBox({
      width,
      height: h,
      depth,
      name: 'Box',
      centered: false,
    });

    let origin = addVec3(cornerA, addVec3(scaleVec3(plane.xAxis, Math.min(0, localX)), scaleVec3(plane.yAxis, Math.min(0, localY))));
    if (height < 0) origin = addVec3(origin, scaleVec3(plane.normal, -h));
    for (const v of mesh.vertices.values()) {
      const local = v.position;
      v.position = addVec3(origin, addVec3(scaleVec3(plane.xAxis, local.x), addVec3(scaleVec3(plane.normal, local.y), scaleVec3(plane.yAxis, local.z))));
    }

    const objectId = this.commitCreate(context, mesh);
    context.selection.setMode('object');
    context.selection.selectObjects([objectId], 'replace');
    this.reset();
    this.previewState.stage = 'done';
    context.requestRedraw();
  }

  cancel(context: ModellingContext): void {
    this.reset();
    context.requestRedraw();
  }

  getAllowedSelectionModes(): readonly ('object')[] {
    return ['object'];
  }

  getSnapPolicy(): readonly ('grid' | 'vertex' | 'edge' | 'face' | 'origin')[] {
    return ['grid', 'vertex', 'edge', 'face', 'origin'];
  }

  getPreviewBounds(): { min: Vec3; max: Vec3 } | null {
    const { cornerA, cornerB, height, stage, plane } = this.previewState;
    if (!cornerA || !cornerB || stage === 'idle') return null;
    const p = plane!;
    const d = subVec3(cornerB, cornerA);
    const u = dotVec3(d, p.xAxis); const v = dotVec3(d, p.yAxis);
    const base = [cornerA, addVec3(cornerA, scaleVec3(p.xAxis, u)), addVec3(cornerA, scaleVec3(p.yAxis, v)), addVec3(cornerA, addVec3(scaleVec3(p.xAxis, u), scaleVec3(p.yAxis, v)))];
    const h = stage === 'height' || stage === 'done' ? height : 0;
    const points = [...base, ...base.map((point) => addVec3(point, scaleVec3(p.normal, h)))];
    return {
      min: v3(Math.min(...points.map((q) => q.x)), Math.min(...points.map((q) => q.y)), Math.min(...points.map((q) => q.z))),
      max: v3(Math.max(...points.map((q) => q.x)), Math.max(...points.map((q) => q.y)), Math.max(...points.map((q) => q.z))),
    };
  }

  private commitCreate(context: ModellingContext, mesh: EditableMesh): ObjectId {
    const { objectId, meshId } = commitMeshObject(context.document, mesh, { name: 'Box' });
    const object = context.document.objects.get(objectId)!;
    const meshRef = context.document.meshes.get(meshId)!;

    // Object is already in the document; history command only handles undo/redo restore.
    let applied = true;
    context.history.execute({
      name: 'Create Box',
      execute: () => {
        if (applied) return;
        context.document.objects.set(object.id, object);
        context.document.meshes.set(meshRef.id, meshRef);
        if (!context.document.rootObjectIds.includes(object.id)) {
          context.document.rootObjectIds.push(object.id);
        }
        context.document.dirty = true;
        applied = true;
      },
      undo: () => {
        context.document.objects.delete(object.id);
        context.document.rootObjectIds = context.document.rootObjectIds.filter((id) => id !== object.id);
        context.document.meshes.delete(meshRef.id);
        context.document.dirty = true;
        applied = false;
      },
    });

    return objectId;
  }

  private reset(): void {
    this.previewState = {
      stage: 'idle',
      cornerA: null,
      cornerB: null,
      height: 0,
      plane: null,
    };
  }

  private hitOnPlane(input: ToolPointerInput, context: ModellingContext): Vec3 | null {
    const raw =
      rayPlaneIntersection(input.rayOrigin, input.rayDirection, context.constructionPlane) ??
      input.worldPosition;
    if (!raw) return null;
    const snap = context.snapEnabled
      ? context.resolveSnap({
          rawPosition: raw,
          pointerRayOrigin: input.rayOrigin,
          pointerRayDirection: input.rayDirection,
          plane: context.constructionPlane,
          allowed: [...this.getSnapPolicy()],
          gridSize: context.gridSize,
        })
      : resolveSnap({
          rawPosition: raw,
          plane: context.constructionPlane,
          allowed: [],
        });
    return snap.position;
  }

  private computeHeight(input: ToolPointerInput, context: ModellingContext): number {
    if (!this.previewState.cornerA || !this.previewState.cornerB) return 0;
    if (input.numericValue != null) return input.numericValue;
    const plane = this.previewState.plane ?? context.constructionPlane;
    const axisOrigin = this.previewState.cornerB;
    const rayOffset = subVec3(input.rayOrigin, axisOrigin);
    const b = dotVec3(input.rayDirection, plane.normal);
    const denom = 1 - b * b;
    let h = Math.abs(denom) < 1e-8 ? this.previewState.height : (dotVec3(plane.normal, rayOffset) - b * dotVec3(input.rayDirection, rayOffset)) / denom;
    if (context.snapEnabled) {
      const g = context.gridSize > 0 ? context.gridSize : 1;
      h = Math.round(h / g) * g;
    }
    return h;
  }
}
