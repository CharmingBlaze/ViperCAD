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
import {
  fitStrokePlane,
  toLocalPoint,
} from '@/core/mesh/builders/SilhouetteExtrudeBuilder';

export type OutlineBlockoutOptions = {
  points: Vec3[];
  depth: number;
  /** How many depth slices (1 = front/back only, 2–4 adds mid rings for soft thickness). */
  depthSegments?: number;
  /** 0 = flat slab, ~0.2–0.35 = slightly rounded front/back (pillow). */
  roundness?: number;
  /** Scale silhouette width around centroid (1 = exact). */
  widthScale?: number;
  /** Scale silhouette height around centroid (1 = exact). */
  heightScale?: number;
  /** Uniform scale after width/height. */
  uniformScale?: number;
  /** Cap freehand outlines to this many corners. Ignored when exactOutline. */
  maxCorners?: number;
  exactOutline?: boolean;
  name?: string;
};

export type LimbBlockoutOptions = {
  points: Vec3[];
  radius: number;
  sides?: number;
  profileWidth?: number;
  profileHeight?: number;
  startScale?: number;
  endScale?: number;
  name?: string;
};

type Point2 = { u: number; v: number };

/**
 * Closed outline → solid blockout that keeps your silhouette exact.
 *
 * Front/back faces follow the drawn polygon. Depth is sliced into a few
 * rings; outer faces shrink slightly toward the centroid so thickness reads
 * a little round — without remaking the shape as stacked width tubes.
 */
export function buildOutlineBlockout(options: OutlineBlockoutOptions): EditableMesh {
  const depth = Math.max(1e-4, options.depth);
  const half = depth * 0.5;
  const depthSegments = Math.max(1, Math.min(6, options.depthSegments ?? 3));
  const roundness = Math.max(0, Math.min(0.45, options.roundness ?? 0.22));
  const maxCorners = Math.max(6, Math.min(48, options.maxCorners ?? 16));

  let path = options.points.map((point) => ({ ...point }));
  if (path.length >= 2) {
    const first = path[0]!;
    const last = path[path.length - 1]!;
    if (lengthSqVec3(subVec3(first, last)) < 1e-10) {
      path = path.slice(0, -1);
    }
  }
  if (path.length < 3) {
    return new MeshBuilder(options.name ?? 'Blockout', false).build();
  }

  const plane = fitStrokePlane(path);
  let boundary = ensureCCW(path.map((point) => toLocalPoint(point, plane)));
  if (!options.exactOutline) {
    boundary = simplifyOutline(boundary, maxCorners);
  }
  if (boundary.length < 3) {
    return new MeshBuilder(options.name ?? 'Blockout', false).build();
  }

  const widthScale = Math.max(0.05, Math.min(4, options.widthScale ?? 1));
  const heightScale = Math.max(0.05, Math.min(4, options.heightScale ?? 1));
  const uniformScale = Math.max(0.05, Math.min(4, options.uniformScale ?? 1));
  let centroid = polygonCentroid(boundary);
  if (widthScale !== 1 || heightScale !== 1 || uniformScale !== 1) {
    boundary = boundary.map((point) => ({
      u: centroid.u + (point.u - centroid.u) * widthScale * uniformScale,
      v: centroid.v + (point.v - centroid.v) * heightScale * uniformScale,
    }));
    centroid = polygonCentroid(boundary);
  }

  const layerCount = depthSegments + 1;
  const builder = new MeshBuilder(options.name ?? 'Blockout', false);
  const rings: VertexId[][] = [];

  const minU = Math.min(...boundary.map((p) => p.u));
  const maxU = Math.max(...boundary.map((p) => p.u));
  const minV = Math.min(...boundary.map((p) => p.v));
  const maxV = Math.max(...boundary.map((p) => p.v));
  const spanU = Math.max(1e-8, maxU - minU);
  const spanV = Math.max(1e-8, maxV - minV);
  const planarUv = (point: Point2) =>
    v2((point.u - minU) / spanU, (point.v - minV) / spanV);

  for (let layer = 0; layer < layerCount; layer++) {
    const t = layer / Math.max(1, depthSegments);
    const depthT = t * 2 - 1;
    const scale = 1 - roundness * depthT * depthT;
    const normalOffset = depthT * half;
    const ring: VertexId[] = [];
    for (const point of boundary) {
      const scaled: Point2 = {
        u: centroid.u + (point.u - centroid.u) * scale,
        v: centroid.v + (point.v - centroid.v) * scale,
      };
      ring.push(builder.vertex(fromLocal(scaled.u, scaled.v, plane, normalOffset)));
    }
    rings.push(ring);
  }

  const front = rings[0]!;
  const back = rings[rings.length - 1]!;
  const n = boundary.length;

  builder.ngon([...front], front.map((_, index) => planarUv(boundary[index]!)));
  builder.ngon(
    [...back].reverse(),
    back.map((_, index) => planarUv(boundary[n - 1 - index]!)),
  );

  for (let layer = 0; layer < rings.length - 1; layer++) {
    const current = rings[layer]!;
    const next = rings[layer + 1]!;
    const v0 = layer / Math.max(1, rings.length - 1);
    const v1 = (layer + 1) / Math.max(1, rings.length - 1);
    for (let index = 0; index < n; index++) {
      const nextIndex = (index + 1) % n;
      const u0 = index / n;
      const u1 = (index + 1) / n;
      builder.quad(current[index]!, next[index]!, next[nextIndex]!, current[nextIndex]!, [
        v2(u0, v0),
        v2(u0, v1),
        v2(u1, v1),
        v2(u1, v0),
      ]);
    }
  }

  return finishMesh(ensureOutward(builder.build()));
}

/** @deprecated Use buildOutlineBlockout */
export function buildBodyBlockoutFromSilhouette(options: {
  points: Vec3[];
  depth: number;
  ringCount?: number;
  sides?: number;
  name?: string;
}): EditableMesh {
  return buildOutlineBlockout({
    points: options.points,
    depth: options.depth,
    depthSegments: 3,
    roundness: 0.22,
    maxCorners: Math.max(8, options.ringCount ?? 16),
    exactOutline: true,
    name: options.name,
  });
}

/**
 * Open limb path → continuous faceted box with rings only at drawn joints.
 */
export function buildLimbBlockoutChain(options: LimbBlockoutOptions): EditableMesh {
  const radius = Math.max(1e-4, options.radius);
  const sides = Math.max(4, Math.min(8, options.sides ?? 6));
  const profileWidth = Math.max(0.05, Math.min(4, options.profileWidth ?? 0.9));
  const profileHeight = Math.max(0.05, Math.min(4, options.profileHeight ?? 0.9));
  const startScale = Math.max(0.05, Math.min(4, options.startScale ?? 1));
  const endScale = Math.max(0.05, Math.min(4, options.endScale ?? 1));
  let path = dedupePath(options.points.map((point) => ({ ...point })));
  if (path.length < 2) {
    path.push(addVec3(path[0] ?? v3(), v3(radius * 2, 0, 0)));
  }

  const profile = squareProfile(sides);
  const frames = buildPathFrames(path);
  const builder = new MeshBuilder(options.name ?? 'Limb Blockout', false);
  const rings: VertexId[][] = [];

  for (let index = 0; index < frames.path.length; index++) {
    const t = index / Math.max(1, frames.path.length - 1);
    const ringScale = startScale + (endScale - startScale) * t;
    const ring: VertexId[] = [];
    for (const point of profile) {
      const offset = addVec3(
        scaleVec3(frames.normals[index]!, point.x * radius * profileWidth * ringScale),
        scaleVec3(frames.binormals[index]!, point.y * radius * profileHeight * ringScale),
      );
      ring.push(builder.vertex(addVec3(frames.path[index]!, offset)));
    }
    rings.push(ring);
  }

  const count = profile.length;
  for (let index = 0; index < rings.length - 1; index++) {
    const current = rings[index]!;
    const next = rings[index + 1]!;
    const v0 = index / Math.max(1, rings.length - 1);
    const v1 = (index + 1) / Math.max(1, rings.length - 1);
    for (let side = 0; side < count; side++) {
      const sideNext = (side + 1) % count;
      builder.quad(current[side]!, current[sideNext]!, next[sideNext]!, next[side]!, [
        v2(side / count, v0),
        v2((side + 1) / count, v0),
        v2((side + 1) / count, v1),
        v2(side / count, v1),
      ]);
    }
  }

  builder.ngon([...rings[0]!].reverse());
  builder.ngon([...rings[rings.length - 1]!]);

  return finishMesh(ensureOutward(builder.build()));
}

function squareProfile(sides: number): { x: number; y: number }[] {
  if (sides <= 4) {
    return [
      { x: -0.9, y: -0.9 },
      { x: 0.9, y: -0.9 },
      { x: 0.9, y: 0.9 },
      { x: -0.9, y: 0.9 },
    ];
  }
  // Soft square: slightly rounded corners via extra samples.
  const samples: { x: number; y: number }[] = [];
  const corners = [
    { cx: 0.72, cy: 0.72, start: 0 },
    { cx: -0.72, cy: 0.72, start: Math.PI * 0.5 },
    { cx: -0.72, cy: -0.72, start: Math.PI },
    { cx: 0.72, cy: -0.72, start: Math.PI * 1.5 },
  ];
  const steps = Math.max(1, Math.ceil(sides / 4));
  const arc = (Math.PI * 0.5) / steps;
  for (const corner of corners) {
    for (let step = 0; step < steps; step++) {
      const angle = corner.start + arc * step;
      samples.push({
        x: corner.cx + Math.cos(angle) * 0.2,
        y: corner.cy + Math.sin(angle) * 0.2,
      });
    }
  }
  return samples.slice(0, sides);
}

function buildPathFrames(path: Vec3[]): {
  path: Vec3[];
  normals: Vec3[];
  binormals: Vec3[];
} {
  const tangents = path.map((_point, index) => {
    const tangent =
      index === 0
        ? subVec3(path[1]!, path[0]!)
        : index === path.length - 1
          ? subVec3(path[index]!, path[index - 1]!)
          : subVec3(path[index + 1]!, path[index - 1]!);
    return lengthVec3(tangent) > 1e-8 ? normalizeVec3(tangent) : v3(0, 1, 0);
  });
  const normals: Vec3[] = [];
  const binormals: Vec3[] = [];
  const t0 = tangents[0]!;
  let firstNormal =
    Math.abs(dotVec3(t0, v3(0, 1, 0))) < 0.9
      ? normalizeVec3(crossVec3(t0, v3(0, 1, 0)))
      : normalizeVec3(crossVec3(t0, v3(1, 0, 0)));
  if (lengthVec3(firstNormal) < 1e-8) firstNormal = v3(1, 0, 0);

  for (let index = 0; index < path.length; index++) {
    const tangent = tangents[index]!;
    let normal =
      index === 0
        ? firstNormal
        : normalizeVec3(
            subVec3(normals[index - 1]!, scaleVec3(tangent, dotVec3(normals[index - 1]!, tangent))),
          );
    if (lengthVec3(normal) < 1e-8) {
      normal = normalizeVec3(crossVec3(tangent, v3(0, 0, 1)));
      if (lengthVec3(normal) < 1e-8) normal = v3(1, 0, 0);
    }
    normals.push(normal);
    binormals.push(normalizeVec3(crossVec3(tangent, normal)));
  }
  return { path, normals, binormals };
}

function fromLocal(
  u: number,
  v: number,
  plane: ReturnType<typeof fitStrokePlane>,
  normalOffset: number,
): Vec3 {
  return addVec3(
    plane.origin,
    addVec3(
      addVec3(scaleVec3(plane.axisU, u), scaleVec3(plane.axisV, v)),
      scaleVec3(plane.normal, normalOffset),
    ),
  );
}

function ensureCCW(poly: Point2[]): Point2[] {
  let area = 0;
  for (let index = 0; index < poly.length; index++) {
    const current = poly[index]!;
    const next = poly[(index + 1) % poly.length]!;
    area += current.u * next.v - next.u * current.v;
  }
  return area >= 0 ? poly : [...poly].reverse();
}

function polygonCentroid(poly: Point2[]): Point2 {
  let area = 0;
  let cx = 0;
  let cy = 0;
  for (let index = 0; index < poly.length; index++) {
    const current = poly[index]!;
    const next = poly[(index + 1) % poly.length]!;
    const cross = current.u * next.v - next.u * current.v;
    area += cross;
    cx += (current.u + next.u) * cross;
    cy += (current.v + next.v) * cross;
  }
  area *= 0.5;
  if (Math.abs(area) < 1e-10) {
    const avg = poly.reduce(
      (acc, point) => ({ u: acc.u + point.u, v: acc.v + point.v }),
      { u: 0, v: 0 },
    );
    return { u: avg.u / poly.length, v: avg.v / poly.length };
  }
  return { u: cx / (6 * area), v: cy / (6 * area) };
}

function simplifyOutline(boundary: Point2[], maxCorners: number): Point2[] {
  if (boundary.length <= maxCorners) return boundary;
  const closed = [...boundary];
  let tolerance = outlineExtent(closed) * 0.01;
  let simplified = rdpClosed(closed, tolerance);
  for (let attempt = 0; attempt < 8 && simplified.length > maxCorners; attempt++) {
    tolerance *= 1.6;
    simplified = rdpClosed(closed, tolerance);
  }
  if (simplified.length > maxCorners) {
    simplified = evenSample(simplified, maxCorners);
  }
  return simplified.length >= 3 ? simplified : closed.slice(0, maxCorners);
}

function outlineExtent(poly: Point2[]): number {
  let minU = Infinity;
  let maxU = -Infinity;
  let minV = Infinity;
  let maxV = -Infinity;
  for (const point of poly) {
    minU = Math.min(minU, point.u);
    maxU = Math.max(maxU, point.u);
    minV = Math.min(minV, point.v);
    maxV = Math.max(maxV, point.v);
  }
  return Math.max(maxU - minU, maxV - minV, 1e-4);
}

function rdpClosed(points: Point2[], tolerance: number): Point2[] {
  if (points.length <= 3) return points;
  const open = rdpOpen(points, tolerance);
  return open.length >= 3 ? open : points;
}

function rdpOpen(points: Point2[], tolerance: number): Point2[] {
  if (points.length <= 2) return points;
  let maxDist = 0;
  let maxIndex = 0;
  const first = points[0]!;
  const last = points[points.length - 1]!;
  for (let index = 1; index < points.length - 1; index++) {
    const dist = pointLineDistance(points[index]!, first, last);
    if (dist > maxDist) {
      maxDist = dist;
      maxIndex = index;
    }
  }
  if (maxDist <= tolerance) return [first, last];
  const left = rdpOpen(points.slice(0, maxIndex + 1), tolerance);
  const right = rdpOpen(points.slice(maxIndex), tolerance);
  return [...left.slice(0, -1), ...right];
}

function pointLineDistance(point: Point2, a: Point2, b: Point2): number {
  const dx = b.u - a.u;
  const dy = b.v - a.v;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq < 1e-14) {
    return Math.hypot(point.u - a.u, point.v - a.v);
  }
  const t = Math.max(
    0,
    Math.min(1, ((point.u - a.u) * dx + (point.v - a.v) * dy) / lengthSq),
  );
  return Math.hypot(point.u - (a.u + t * dx), point.v - (a.v + t * dy));
}

function evenSample(points: Point2[], count: number): Point2[] {
  if (points.length <= count) return points;
  const result: Point2[] = [];
  for (let index = 0; index < count; index++) {
    const t = (index / count) * points.length;
    result.push(points[Math.floor(t) % points.length]!);
  }
  return result;
}

function dedupePath(path: Vec3[]): Vec3[] {
  const result: Vec3[] = [];
  for (const point of path) {
    const last = result[result.length - 1];
    if (!last || lengthSqVec3(subVec3(point, last)) > 1e-10) {
      result.push(point);
    }
  }
  return result;
}

function finishMesh(mesh: EditableMesh): EditableMesh {
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
    if (!result.ok) throw new Error(result.error?.message ?? 'Could not correct blockout winding');
  }
  return mesh;
}
