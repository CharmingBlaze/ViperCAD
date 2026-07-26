import { commitMeshObject } from '@/core/document/ModelDocument';
import {
  addVec3,
  lengthSqVec3,
  normalizeVec3,
  scaleVec3,
  subVec3,
  type Vec3,
  v3,
} from '@/core/math/Vec3';
import type { EditableMesh } from '@/core/mesh/types';
import {
  buildInflatedDoodle,
  doodleCloseDistance,
  isStrokeClosed,
  strokePathLength,
} from '@/core/mesh/builders/StrokeInflateBuilder';
import { buildStrokeTube } from '@/core/mesh/builders/StrokeTubeBuilder';
import { validateMeshFull } from '@/core/mesh/Validation';
import { cloneSelection, type SelectionState } from '@/core/selection/SelectionManager';
import type { ModellingContext, Tool, ToolPointerInput } from './Tool';

export type DoodleDrawStage = 'idle' | 'drawing';
export type DoodlePolyPreset = 'low' | 'medium';
export type DoodleStyle = 'soft' | 'sharp' | 'tube';

export type DoodleToolState = {
  stage: DoodleDrawStage;
  points: Vec3[];
  depth: number;
  revision: number;
  /** End returned near start — inflate on commit. */
  closed: boolean;
};

const RADIAL: Record<DoodlePolyPreset, number> = { low: 6, medium: 10 };
const OUTLINE: Record<DoodlePolyPreset, number> = { low: 16, medium: 28 };

/**
 * Free-air Paint 3D–style doodle:
 * open stroke → tube; connected loop → inflated low/mid-poly solid.
 */
export class CreateDoodleTool implements Tool {
  id = 'create-doodle' as const;
  label = '3D Doodle';
  radius = 0.08;
  preset: DoodlePolyPreset = 'low';
  style: DoodleStyle = 'soft';
  smoothDrawing = true;
  state: DoodleToolState = this.emptyState();
  private previousSelection: SelectionState | null = null;
  private strokePlaneOrigin: Vec3 | null = null;
  private strokePlaneNormal: Vec3 | null = null;

  activate(context: ModellingContext): void {
    this.cancel(context);
  }

  deactivate(context: ModellingContext): void {
    this.cancel(context);
  }

  setPreset(preset: DoodlePolyPreset, context: ModellingContext): void {
    this.preset = preset;
    this.touch(context);
  }

  setStyle(style: DoodleStyle, context: ModellingContext): void {
    this.style = style;
    if (this.state.stage === 'drawing') {
      this.state.closed = style !== 'tube' && this.state.points.length >= 3;
    }
    this.touch(context);
  }

  setSmoothDrawing(enabled: boolean, context: ModellingContext): void {
    this.smoothDrawing = enabled;
    this.touch(context);
  }

  setRadius(radius: number, context: ModellingContext): void {
    this.radius = Math.max(0.01, Math.min(2, radius));
    this.touch(context);
  }

  begin(input: ToolPointerInput, context: ModellingContext): void {
    if (input.button !== 'left') return;
    if (this.state.stage !== 'idle') return;
    const depth = this.resolveDepth(input);
    const point = this.samplePoint(input, depth);
    this.strokePlaneOrigin = { ...point };
    this.strokePlaneNormal = normalizeVec3(input.rayDirection);
    this.previousSelection = cloneSelection(context.selection.state);
    this.state = {
      stage: 'drawing',
      points: [point],
      depth,
      revision: this.state.revision + 1,
      closed: false,
    };
    context.requestRedraw();
  }

  update(input: ToolPointerInput, context: ModellingContext): void {
    if (this.state.stage !== 'drawing') return;
    const point = this.sampleOnStrokePlane(input);
    const minSpacing = this.radius * 0.55;
    const last = this.state.points[this.state.points.length - 1];
    if (!last || lengthSqVec3(subVec3(point, last)) >= minSpacing * minSpacing) {
      this.state.points.push(point);
      this.state.closed = this.shouldFill(this.state.points);
      this.state.revision += 1;
      context.requestRedraw();
    } else {
      // Still refresh close state when hovering near the start without adding a point.
      const closed = this.shouldFill([...this.state.points, point]);
      if (closed !== this.state.closed) {
        this.state.closed = closed;
        this.state.revision += 1;
        context.requestRedraw();
      }
    }
  }

  preview(_context: ModellingContext): void {}

  /** Finish stroke on pointer up (or Enter). */
  confirm(context: ModellingContext): void {
    if (this.state.stage !== 'drawing') return;
    const points = [...this.state.points];
    if (points.length < 2) {
      const p = points[0] ?? v3();
      points.push(addVec3(p, v3(this.radius * 2, 0, 0)));
    }

    const closed = this.shouldFill(points);
    const mesh = this.buildMesh(points, closed);
    const validation = validateMeshFull(mesh);
    const errors = validation.issues.filter((i) => i.severity === 'error');
    if (errors.length) {
      this.cancel(context);
      throw new Error(`Cannot create doodle: ${errors.map((i) => i.message).join('; ')}`);
    }

    const beforeSelection = this.previousSelection
      ? cloneSelection(this.previousSelection)
      : cloneSelection(context.selection.state);
    const label =
      this.style === 'soft' ? 'Soft Doodle' : this.style === 'sharp' ? 'Sharp Doodle' : 'Doodle Tube';
    const { objectId, meshId } = commitMeshObject(context.document, mesh, { name: label });
    const object = context.document.objects.get(objectId)!;
    const meshRef = context.document.meshes.get(meshId)!;
    context.selection.setMode('object');
    context.selection.selectObjects([objectId], 'replace');
    const afterSelection = cloneSelection(context.selection.state);
    let applied = true;
    context.history.execute({
      name:
        this.style === 'soft'
          ? 'Create Soft Doodle'
          : this.style === 'sharp'
            ? 'Create Sharp Doodle'
            : 'Create Doodle Tube',
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
        context.document.rootObjectIds = context.document.rootObjectIds.filter(
          (id) => id !== object.id,
        );
        if (![...context.document.objects.values()].some((o) => o.meshId === meshRef.id)) {
          context.document.meshes.delete(meshRef.id);
        }
        context.selection.state = cloneSelection(beforeSelection);
        context.document.dirty = true;
        applied = false;
      },
    });

    this.previousSelection = null;
    this.strokePlaneOrigin = null;
    this.strokePlaneNormal = null;
    this.state = this.emptyState(this.state.revision + 1);
    context.requestRedraw();
  }

  cancel(context: ModellingContext): void {
    if (this.previousSelection) context.selection.state = cloneSelection(this.previousSelection);
    this.previousSelection = null;
    this.strokePlaneOrigin = null;
    this.strokePlaneNormal = null;
    this.state = this.emptyState(this.state.revision + 1);
    context.requestRedraw();
  }

  getAllowedSelectionModes() {
    return ['object'] as const;
  }

  getSnapPolicy() {
    return [] as const;
  }

  getPreviewMesh() {
    if (this.state.stage !== 'drawing' || this.state.points.length < 1) return null;
    const points =
      this.state.points.length >= 2
        ? this.state.points
        : [this.state.points[0]!, addVec3(this.state.points[0]!, v3(this.radius * 1.5, 0, 0))];
    return this.buildMesh(points, this.shouldFill(points));
  }

  radialSegments(): number {
    return RADIAL[this.preset];
  }

  isClosedPreview(): boolean {
    return this.state.closed;
  }

  samplePoint(input: ToolPointerInput, depth: number): Vec3 {
    const origin = input.rayOrigin;
    const dir = normalizeVec3(input.rayDirection);
    const along = Math.max(0.25, depth);
    return addVec3(origin, scaleVec3(dir, along));
  }

  resolveDepth(input: ToolPointerInput): number {
    if (input.worldPosition) {
      const d = Math.sqrt(lengthSqVec3(subVec3(input.worldPosition, input.rayOrigin)));
      if (Number.isFinite(d) && d > 0.1) return Math.min(80, Math.max(0.35, d));
    }
    const wupp = input.worldUnitsPerPixel;
    if (wupp && wupp > 1e-6) {
      const approx = wupp * 120;
      return Math.min(80, Math.max(0.35, approx));
    }
    return 4;
  }

  setDepthHint(depth: number): void {
    if (!Number.isFinite(depth) || depth <= 0) return;
    this.state.depth = Math.min(80, Math.max(0.35, depth));
  }

  private sampleOnStrokePlane(input: ToolPointerInput): Vec3 {
    const planeOrigin = this.strokePlaneOrigin;
    const planeNormal = this.strokePlaneNormal;
    if (!planeOrigin || !planeNormal) return this.samplePoint(input, this.state.depth);
    const direction = normalizeVec3(input.rayDirection);
    const denominator =
      direction.x * planeNormal.x + direction.y * planeNormal.y + direction.z * planeNormal.z;
    if (Math.abs(denominator) < 1e-6) return this.samplePoint(input, this.state.depth);
    const toPlane = subVec3(planeOrigin, input.rayOrigin);
    const distance =
      (toPlane.x * planeNormal.x + toPlane.y * planeNormal.y + toPlane.z * planeNormal.z) /
      denominator;
    if (!Number.isFinite(distance) || distance <= 0) {
      return this.samplePoint(input, this.state.depth);
    }
    return addVec3(input.rayOrigin, scaleVec3(direction, distance));
  }

  private detectClosed(points: Vec3[]): boolean {
    const len = strokePathLength(points);
    return isStrokeClosed(points, doodleCloseDistance(this.radius, len));
  }

  private shouldFill(points: Vec3[]): boolean {
    if (this.style === 'tube') return false;
    if (points.length < 3) return false;
    // Shape modes close the final segment automatically, like Paint 3D's
    // soft/sharp doodles. Near-start detection is still used for live feedback.
    return this.detectClosed(points) || strokePathLength(points) > this.radius * 4;
  }

  private buildMesh(points: Vec3[], closed: boolean): EditableMesh {
    let source = points;
    if (closed && this.detectClosed(points) && points.length > 3) {
      source = points.slice(0, -1);
    }
    if (this.smoothDrawing) {
      source = smoothDoodlePoints(source, closed, this.preset === 'medium' ? 2 : 1);
    }
    if (closed) {
      return buildInflatedDoodle({
        points: source,
        thickness: this.style === 'soft' ? this.radius * 1.35 : this.radius,
        outlineSegments: OUTLINE[this.preset],
        profile: this.style === 'soft' ? 'soft' : 'sharp',
        name: 'Doodle',
      });
    }
    return buildStrokeTube({
      points: source,
      radius: this.radius,
      radialSegments: RADIAL[this.preset],
      name: 'Doodle',
    });
  }

  private emptyState(revision = 0): DoodleToolState {
    return { stage: 'idle', points: [], depth: 4, revision, closed: false };
  }

  private touch(context: ModellingContext): void {
    this.state.revision += 1;
    context.requestRedraw();
  }
}

/** Smooth freehand jitter without changing point count or open-stroke endpoints. */
export function smoothDoodlePoints(points: Vec3[], closed: boolean, passes = 1): Vec3[] {
  if (points.length < 3 || passes < 1) return points.map((point) => ({ ...point }));
  const original = points.map((point) => ({ ...point }));
  let result = original;
  for (let pass = 0; pass < passes; pass++) {
    result = result.map((point, index) => {
      if (!closed && (index === 0 || index === result.length - 1)) return { ...point };
      const previous = result[(index - 1 + result.length) % result.length]!;
      const next = result[(index + 1) % result.length]!;
      return {
        x: point.x * 0.5 + (previous.x + next.x) * 0.25,
        y: point.y * 0.5 + (previous.y + next.y) * 0.25,
        z: point.z * 0.5 + (previous.z + next.z) * 0.25,
      };
    });
  }

  // Cyclic smoothing naturally contracts loops. Restore their average radius
  // so enabling smoothing cleans the hand motion without shrinking the shape.
  if (closed) {
    const centre = (values: Vec3[]) =>
      scaleVec3(values.reduce((sum, point) => addVec3(sum, point), v3()), 1 / values.length);
    const beforeCentre = centre(original);
    const afterCentre = centre(result);
    const averageRadius = (values: Vec3[], c: Vec3) =>
      values.reduce((sum, point) => sum + Math.sqrt(lengthSqVec3(subVec3(point, c))), 0) /
      values.length;
    const beforeRadius = averageRadius(original, beforeCentre);
    const afterRadius = averageRadius(result, afterCentre);
    const scale = afterRadius > 1e-8 ? beforeRadius / afterRadius : 1;
    result = result.map((point) =>
      addVec3(beforeCentre, scaleVec3(subVec3(point, afterCentre), scale)),
    );
  }
  return result;
}
