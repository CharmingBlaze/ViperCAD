import { v2 } from '@/core/math/Vec2';
import {
  addVec3,
  crossVec3,
  dotVec3,
  lengthSqVec3,
  lengthVec3,
  normalizeVec3,
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
import { resampleStrokePoints } from '@/core/mesh/builders/StrokeTubeBuilder';

export type VerticalShapedCapsuleOptions = {
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

/** Closed side-view outline → standing low-poly capsule with circular cross-sections. */
export function buildVerticalShapedCapsule(
  boundary: SilhouettePoint[],
  options: VerticalShapedCapsuleOptions = {},
): EditableMesh {
  const {
    radialSegments = 12,
    profileRings = 12,
    minRadius = 0.08,
    silhouetteInfluence = 0.3,
    name = 'Vertical Capsule',
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
  const segments = Math.max(6, Math.min(20, Math.round(radialSegments)));
  const bodyLen = Math.max(0, height - 2 * fitR);
  const hemiArc = fitR * (Math.PI * 0.5);
  const totalArc = bodyLen + 2 * hemiArc;
  if (totalArc < 1e-4) {
    return new MeshBuilder(name, false).build();
  }

  const equatorEdge = (2 * Math.PI * fitR) / segments;
  const fromSpacing = Math.max(6, Math.round(totalArc / Math.max(0.5, equatorEdge)));
  const maxLong = Math.max(6, Math.min(18, profileRings + 4));
  const longSegs = Math.max(6, Math.min(maxLong, fromSpacing));

  const midY = (minY + maxY) * 0.5;
  const bodyCx = centerXAt(polygon, midY, 0);
  const influence = Math.max(0, Math.min(0.5, silhouetteInfluence));
  const span = Math.max(1e-6, height);

  const builder = new MeshBuilder(name, false);
  const slots: { ring: VertexId[]; v: number }[] = [];

  const bottomPole = builder.vertex(v3(
    centerXAt(polygon, minY + fitR * 0.15, bodyCx),
    minY,
    0,
  ));

  for (let index = 1; index < longSegs; index++) {
    const arc = (totalArc * index) / longSegs;
    const { y, radius } = sampleMeridian(arc, minY, maxY, fitR, bodyLen, hemiArc);
    if (radius < 1e-4) continue;
    const localChord = chordAtY(polygon, y);
    const localRadius = localChord
      ? Math.max(fitR * 0.72, Math.min(fitR * 1.28, (localChord.x1 - localChord.x0) * 0.5))
      : fitR;
    const shapedBodyRadius = fitR + (localRadius - fitR) * influence;
    const shapedRadius = radius * (shapedBodyRadius / Math.max(1e-6, fitR));
    const cx = centerXAt(polygon, y, bodyCx);
    slots.push({
      ring: addRing(builder, cx, y, Math.max(minRadius * 0.5, shapedRadius), segments),
      v: (y - minY) / span,
    });
  }

  const topPole = builder.vertex(v3(
    centerXAt(polygon, maxY - fitR * 0.15, bodyCx),
    maxY,
    0,
  ));

  if (slots.length === 0) {
    return builder.build();
  }

  fanPole(builder, bottomPole, slots[0]!.ring, 0, slots[0]!.v, true);
  for (let ringIndex = 0; ringIndex < slots.length - 1; ringIndex++) {
    stitchRingPair(
      builder,
      slots[ringIndex]!.ring,
      slots[ringIndex + 1]!.ring,
      slots[ringIndex]!.v,
      slots[ringIndex + 1]!.v,
    );
  }
  fanPole(builder, topPole, slots[slots.length - 1]!.ring, 1, slots[slots.length - 1]!.v, false);

  return finishDoodleMesh(ensureOutward(builder.build()));
}

/** Map a closed 3D stroke loop into silhouette space and build a vertical capsule in world space. */
export function buildVerticalShapedCapsuleFromStroke(
  points: Vec3[],
  options: VerticalShapedCapsuleOptions = {},
): EditableMesh {
  const minSpacing = Math.max(0.01, (options.minRadius ?? 0.08) * 0.35);
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
  const silhouette = path.map((point) => toSilhouettePoint(point, axes));
  const mesh = buildVerticalShapedCapsule(silhouette, options);
  transformCapsuleToWorld(mesh, axes);
  return ensureOutward(mesh);
}

function fitSilhouetteAxes(points: Vec3[]): SilhouetteAxes {
  const origin = points.reduce((sum, point) => addVec3(sum, point), v3());
  const o = scaleVec3(origin, 1 / points.length);
  let normal = v3(0, 0, 0);
  for (let index = 1; index < points.length - 1; index++) {
    normal = addVec3(
      normal,
      crossVec3(subVec3(points[index]!, o), subVec3(points[index + 1]!, o)),
    );
  }
  if (lengthVec3(normal) < 1e-8) normal = v3(0, 0, 1);
  normal = normalizeVec3(normal);

  const worldUp = v3(0, 1, 0);
  let height = subVec3(worldUp, scaleVec3(normal, dotVec3(worldUp, normal)));
  if (lengthVec3(height) < 1e-6) {
    height = normalizeVec3(crossVec3(normal, v3(1, 0, 0)));
    if (lengthVec3(height) < 1e-6) height = v3(0, 0, 1);
  } else {
    height = normalizeVec3(height);
  }
  const width = normalizeVec3(crossVec3(normal, height));
  let depth = normal;
  if (dotVec3(crossVec3(width, height), depth) < 0) {
    depth = scaleVec3(depth, -1);
  }
  return { origin: o, width, height, depth };
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

function bodyFitRadius(polygon: SilhouettePoint[], minY: number, maxY: number): number {
  const height = maxY - minY;
  if (height < 1e-4) return 0.35;
  const samples: number[] = [];
  for (let index = 0; index < 16; index++) {
    const t = 0.2 + (0.6 * index) / 15;
    const chord = chordAtY(polygon, minY + height * t);
    if (!chord) continue;
    samples.push(Math.max(0.35, (chord.x1 - chord.x0) * 0.5));
  }
  if (samples.length === 0) return Math.min(0.35, height * 0.49);
  samples.sort((left, right) => left - right);
  const mid = samples[Math.floor(samples.length * 0.6)]!;
  return Math.min(mid, height * 0.49);
}

function centerXAt(polygon: SilhouettePoint[], y: number, fallback: number): number {
  const chord = chordAtY(polygon, y);
  if (!chord) return fallback;
  return (chord.x0 + chord.x1) * 0.5;
}

function sampleMeridian(
  arc: number,
  minY: number,
  maxY: number,
  fitR: number,
  bodyLen: number,
  hemiArc: number,
): { y: number; radius: number } {
  if (arc <= hemiArc) {
    const theta = fitR > 1e-8 ? arc / fitR : 0;
    return {
      y: minY + fitR * (1 - Math.cos(theta)),
      radius: fitR * Math.sin(theta),
    };
  }
  if (arc <= hemiArc + bodyLen) {
    return {
      y: minY + fitR + (arc - hemiArc),
      radius: fitR,
    };
  }
  const topArc = arc - hemiArc - bodyLen;
  const theta = fitR > 1e-8 ? topArc / fitR : 0;
  return {
    y: maxY - fitR + fitR * Math.sin(theta),
    radius: fitR * Math.cos(theta),
  };
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

function fanPole(
  builder: MeshBuilder,
  pole: VertexId,
  ring: VertexId[],
  vPole: number,
  vRing: number,
  poleIsMin: boolean,
): void {
  const segments = ring.length;
  for (let segment = 0; segment < segments; segment++) {
    const next = (segment + 1) % segments;
    const u0 = segment / segments;
    const u1 = (segment + 1) / segments;
    if (poleIsMin) {
      builder.tri(pole, ring[next]!, ring[segment]!, [v2(0.5, vPole), v2(u1, vRing), v2(u0, vRing)]);
    } else {
      builder.tri(pole, ring[segment]!, ring[next]!, [v2(0.5, vPole), v2(u0, vRing), v2(u1, vRing)]);
    }
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
