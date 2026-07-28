import { v2 } from '@/core/math/Vec2';
import {
  addVec3,
  crossVec3,
  dotVec3,
  lengthSqVec3,
  scaleVec3,
  subVec3,
  v3,
  type Vec3,
} from '@/core/math/Vec3';
import { MeshBuilder } from '@/core/mesh/MeshBuilder';
import { flipFaces } from '@/core/mesh/ops/basic';
import type { EditableMesh, VertexId } from '@/core/mesh/types';
import { validateMeshFull } from '@/core/mesh/Validation';
import { unwrapUvAuto } from '@/core/uv/UvOperations';
import { fitStrokePlane, toLocalPoint } from '@/core/mesh/builders/SilhouetteExtrudeBuilder';
import { capBoundaryPoints } from '@/core/mesh/builders/OutlineBoundary';
import { resampleStrokePoints } from '@/core/mesh/builders/StrokeTubeBuilder';

export type WorkflowVerticalProfileOptions = {
  radialSegments?: number;
  profileRings?: number;
  minRadius?: number;
  preserveBoundary?: boolean;
  silhouetteInfluence?: number;
  name?: string;
};

type SilhouettePoint = { x: number; y: number };
type SilhouetteAxes = {
  origin: Vec3;
  width: Vec3;
  height: Vec3;
  depth: Vec3;
};

/** Workflow closed profile — silhouette-following standing solid (not Curves capsule). */
export function buildWorkflowVerticalProfile(
  boundary: SilhouettePoint[],
  options: WorkflowVerticalProfileOptions = {},
): EditableMesh {
  const {
    radialSegments = 12,
    profileRings = 12,
    minRadius = 0.08,
    name = 'Workflow Profile Solid',
  } = options;

  const polygon = ensureCCW(boundary);
  if (polygon.length < 3) {
    return new MeshBuilder(name, false).build();
  }

  const { minY, maxY } = boundsY(polygon);
  const height = maxY - minY;
  if (height < 1e-4) {
    return new MeshBuilder(name, false).build();
  }

  const fitR = Math.max(minRadius, bodyFitRadius(polygon, minY, maxY));
  const segments = Math.max(8, Math.min(16, Math.round(radialSegments)));
  const ringCount = Math.max(6, Math.min(12, profileRings));
  const influence = 0.92;
  const span = Math.max(1e-6, height);
  const minRingRadius = minRadius * 0.08;

  const heights = sampleProfileHeights(minY, maxY, ringCount);
  const builder = new MeshBuilder(name, false);
  const slots: { ring: VertexId[]; v: number }[] = [];

  for (const y of heights) {
    const chord = chordAtY(polygon, y);
    if (!chord) continue;
    const halfWidth = Math.max(0, (chord.x1 - chord.x0) * 0.5);
    const centerX = (chord.x0 + chord.x1) * 0.5;

    const idealRadius = influence < 1
      ? idealCapsuleRadiusAtY(y, minY, maxY, fitR)
      : halfWidth;
    const shapedRadius = halfWidth * influence + idealRadius * (1 - influence);
    if (shapedRadius < minRingRadius) continue;

    slots.push({
      ring: addRing(builder, centerX, y, Math.max(minRingRadius, shapedRadius), segments),
      v: (y - minY) / span,
    });
  }

  if (slots.length < 2) {
    return builder.build();
  }

  for (let ringIndex = 0; ringIndex < slots.length - 1; ringIndex++) {
    stitchRingPair(
      builder,
      slots[ringIndex]!.ring,
      slots[ringIndex + 1]!.ring,
      slots[ringIndex]!.v,
      slots[ringIndex + 1]!.v,
    );
  }

  return finishDoodleMesh(ensureOutward(builder.build()));
}

export function buildWorkflowVerticalProfileFromStroke(
  points: Vec3[],
  options: WorkflowVerticalProfileOptions = {},
): EditableMesh {
  const minSpacing = Math.max(0.02, (options.minRadius ?? 0.08) * 0.5);
  let path = resampleStrokePoints(points, minSpacing);
  if (
    path.length >= 2 &&
    lengthSqVec3(subVec3(path[0]!, path[path.length - 1]!)) < minSpacing * minSpacing
  ) {
    path = path.slice(0, -1);
  }
  if (path.length < 3) {
    path = [v3(0, 0, 0), v3(0.4, 0, 0), v3(0.2, 0.4, 0)];
  }

  const axes = fitSilhouetteAxes(path);
  const silhouette = simplifySilhouette(
    path.map((point) => toSilhouettePoint(point, axes)),
    20,
  );
  const mesh = buildWorkflowVerticalProfile(silhouette, options);
  transformCapsuleToWorld(mesh, axes);
  return ensureOutward(mesh);
}

function fitSilhouetteAxes(points: Vec3[]): SilhouetteAxes {
  const plane = fitStrokePlane(points);
  const locals = points.map((point) => toLocalPoint(point, plane));
  let minU = Infinity;
  let maxU = -Infinity;
  let minV = Infinity;
  let maxV = -Infinity;
  for (const point of locals) {
    minU = Math.min(minU, point.u);
    maxU = Math.max(maxU, point.u);
    minV = Math.min(minV, point.v);
    maxV = Math.max(maxV, point.v);
  }
  const spanU = maxU - minU;
  const spanV = maxV - minV;
  let width = plane.axisU;
  let height = plane.axisV;
  if (spanU > spanV) {
    width = plane.axisV;
    height = plane.axisU;
  }
  let depth = plane.normal;
  if (dotVec3(crossVec3(width, height), depth) < 0) {
    depth = scaleVec3(depth, -1);
  }
  return { origin: plane.origin, width, height, depth };
}

function toSilhouettePoint(point: Vec3, axes: SilhouetteAxes): SilhouettePoint {
  const delta = subVec3(point, axes.origin);
  return {
    x: dotVec3(delta, axes.width),
    y: dotVec3(delta, axes.height),
  };
}

function fromSilhouettePoint(
  silhouette: SilhouettePoint,
  depthOffset: number,
  axes: SilhouetteAxes,
): Vec3 {
  return addVec3(
    axes.origin,
    addVec3(
      addVec3(scaleVec3(axes.width, silhouette.x), scaleVec3(axes.height, silhouette.y)),
      scaleVec3(axes.depth, depthOffset),
    ),
  );
}

function transformCapsuleToWorld(mesh: EditableMesh, axes: SilhouetteAxes): EditableMesh {
  for (const vertex of mesh.vertices.values()) {
    const local = vertex.position;
    vertex.position = fromSilhouettePoint({ x: local.x, y: local.y }, local.z, axes);
  }
  return mesh;
}

function ensureCCW(polygon: SilhouettePoint[]): SilhouettePoint[] {
  let area = 0;
  for (let index = 0; index < polygon.length; index++) {
    const current = polygon[index]!;
    const next = polygon[(index + 1) % polygon.length]!;
    area += current.x * next.y - next.x * current.y;
  }
  return area >= 0 ? polygon : [...polygon].reverse();
}

function boundsY(polygon: SilhouettePoint[]): { minY: number; maxY: number } {
  let minY = Infinity;
  let maxY = -Infinity;
  for (const point of polygon) {
    minY = Math.min(minY, point.y);
    maxY = Math.max(maxY, point.y);
  }
  return { minY, maxY };
}

function chordAtY(polygon: SilhouettePoint[], y: number): { x0: number; x1: number } | null {
  const xs: number[] = [];
  for (let index = 0; index < polygon.length; index++) {
    const a = polygon[index]!;
    const b = polygon[(index + 1) % polygon.length]!;
    const dy = b.y - a.y;
    if (Math.abs(dy) < 1e-10) continue;
    const crosses = (a.y <= y && b.y > y) || (b.y <= y && a.y > y);
    if (!crosses) continue;
    const t = (y - a.y) / dy;
    xs.push(a.x + t * (b.x - a.x));
  }
  if (xs.length < 2) return null;
  xs.sort((left, right) => left - right);
  return { x0: xs[0]!, x1: xs[xs.length - 1]! };
}

function sampleProfileHeights(minY: number, maxY: number, ringCount: number): number[] {
  const heights: number[] = [];
  for (let index = 0; index <= ringCount; index++) {
    heights.push(minY + ((maxY - minY) * index) / ringCount);
  }
  return heights;
}

function simplifySilhouette(boundary: SilhouettePoint[], maxPoints: number): SilhouettePoint[] {
  if (boundary.length <= maxPoints) return boundary;
  return capBoundaryPoints(
    boundary.map((point) => ({ u: point.x, v: point.y })),
    maxPoints,
  ).map((point) => ({ x: point.u, y: point.v }));
}

function bodyFitRadius(polygon: SilhouettePoint[], minY: number, maxY: number): number {
  const height = maxY - minY;
  if (height < 1e-4) return 0.35;
  const samples: number[] = [];
  for (let index = 0; index < 24; index++) {
    const t = 0.08 + (0.84 * index) / 23;
    const chord = chordAtY(polygon, minY + height * t);
    if (!chord) continue;
    samples.push(Math.max(height * 0.02, (chord.x1 - chord.x0) * 0.5));
  }
  if (samples.length === 0) return Math.min(0.35, height * 0.49);
  samples.sort((left, right) => left - right);
  const median = samples[Math.floor(samples.length * 0.5)]!;
  return Math.min(median, height * 0.49);
}

function idealCapsuleRadiusAtY(
  y: number,
  minY: number,
  maxY: number,
  fitR: number,
): number {
  const bottomEnd = minY + fitR;
  const topStart = maxY - fitR;
  if (y <= bottomEnd) {
    const dy = y - minY;
    const theta = fitR > 1e-8 ? Math.asin(Math.max(0, Math.min(1, dy / fitR))) : 0;
    return fitR * Math.sin(theta);
  }
  if (y >= topStart) {
    const dy = maxY - y;
    const theta = fitR > 1e-8 ? Math.asin(Math.max(0, Math.min(1, dy / fitR))) : 0;
    return fitR * Math.sin(theta);
  }
  return fitR;
}

function addRing(
  builder: MeshBuilder,
  centerX: number,
  y: number,
  radius: number,
  segments: number,
): VertexId[] {
  const ring: VertexId[] = [];
  for (let segment = 0; segment < segments; segment++) {
    const angle = (segment / segments) * Math.PI * 2;
    ring.push(builder.vertex(v3(
      centerX + Math.cos(angle) * radius,
      y,
      Math.sin(angle) * radius,
    )));
  }
  return ring;
}

function stitchRingPair(
  builder: MeshBuilder,
  ringA: VertexId[],
  ringB: VertexId[],
  vA: number,
  vB: number,
): void {
  const segments = ringA.length;
  for (let segment = 0; segment < segments; segment++) {
    const next = (segment + 1) % segments;
    const u0 = segment / segments;
    const u1 = (segment + 1) / segments;
    builder.quad(ringA[segment]!, ringA[next]!, ringB[next]!, ringB[segment]!, [
      v2(u0, vA),
      v2(u1, vA),
      v2(u1, vB),
      v2(u0, vB),
    ]);
  }
}

function finishDoodleMesh(mesh: EditableMesh): EditableMesh {
  if (
    mesh.defaultUvLayerId &&
    [...mesh.faceCorners.values()].every((corner) => {
      const uv = corner.uvs.get(mesh.defaultUvLayerId!);
      return !uv || (uv.x === 0 && uv.y === 0);
    })
  ) {
    unwrapUvAuto(mesh, [...mesh.faces.keys()], mesh.defaultUvLayerId);
  }
  return mesh;
}

function ensureOutward(mesh: EditableMesh): EditableMesh {
  if (validateMeshFull(mesh).issues.some((issue) => issue.code === 'INWARD_WINDING')) {
    const result = flipFaces(mesh, [...mesh.faces.keys()]);
    if (!result.ok) throw new Error(result.error?.message ?? 'Could not correct vertical capsule winding');
  }
  return mesh;
}
