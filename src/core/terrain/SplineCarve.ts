import { v3, type Vec3 } from '@/core/math/Vec3';
import { createEmptyMesh, bumpPositions, addVertex, addFace, bumpTopology } from '@/core/mesh/EditableMesh';
import type { EditableMesh } from '@/core/mesh/types';

function smoothstep(edge0: number, edge1: number, value: number): number {
  const x = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0 || 1)));
  return x * x * (3 - 2 * x);
}

export type SplinePoint = { x: number; y: number; z: number; width?: number };

/** Evaluate a 3D Catmull-Rom spline at parameter t [0..1] across point array. */
export function evaluateCatmullRomSpline(points: Vec3[], t: number): { position: Vec3; tangent: Vec3 } {
  if (points.length < 2) {
    const p = points[0] ?? v3(0, 0, 0);
    return { position: p, tangent: v3(0, 0, 1) };
  }
  const n = points.length - 1;
  const scaledT = Math.max(0, Math.min(1, t)) * n;
  const idx = Math.min(Math.floor(scaledT), n - 1);
  const localT = scaledT - idx;

  const p0 = points[Math.max(0, idx - 1)]!;
  const p1 = points[idx]!;
  const p2 = points[Math.min(n, idx + 1)]!;
  const p3 = points[Math.min(n, idx + 2)]!;

  const t2 = localT * localT;
  const t3 = t2 * localT;

  // Catmull-Rom spline position calculation
  const posX =
    0.5 *
    (2 * p1.x +
      (-p0.x + p2.x) * localT +
      (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
      (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3);
  const posY =
    0.5 *
    (2 * p1.y +
      (-p0.y + p2.y) * localT +
      (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 +
      (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3);
  const posZ =
    0.5 *
    (2 * p1.z +
      (-p0.z + p2.z) * localT +
      (2 * p0.z - 5 * p1.z + 4 * p2.z - p3.z) * t2 +
      (-p0.z + 3 * p1.z - 3 * p2.z + p3.z) * t3);

  // Tangent derivative
  const tanX =
    0.5 *
    ((-p0.x + p2.x) +
      2 * (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * localT +
      3 * (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t2);
  const tanY =
    0.5 *
    ((-p0.y + p2.y) +
      2 * (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * localT +
      3 * (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t2);
  const tanZ =
    0.5 *
    ((-p0.z + p2.z) +
      2 * (2 * p0.z - 5 * p1.z + 4 * p2.z - p3.z) * localT +
      3 * (-p0.z + 3 * p1.z - 3 * p2.z + p3.z) * t2);

  const len = Math.hypot(tanX, tanY, tanZ);
  const tangent = len > 1e-6 ? v3(tanX / len, tanY / len, tanZ / len) : v3(0, 0, 1);

  return { position: v3(posX, posY, posZ), tangent };
}

/** Distance from a 2D point (x, z) to a 3D spline projected on XZ plane. */
export function distanceToSplineXZ(
  x: number,
  z: number,
  samples: Vec3[],
): { distance: number; sampleIndex: number; t: number } {
  let minDistanceSq = Infinity;
  let bestIdx = 0;
  let bestT = 0;

  for (let i = 0; i < samples.length - 1; i++) {
    const a = samples[i]!;
    const b = samples[i + 1]!;
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const lenSq = dx * dx + dz * dz;

    let t = 0;
    if (lenSq > 1e-8) {
      t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / lenSq));
    }

    const projX = a.x + t * dx;
    const projZ = a.z + t * dz;
    const distSq = (x - projX) * (x - projX) + (z - projZ) * (z - projZ);

    if (distSq < minDistanceSq) {
      minDistanceSq = distSq;
      bestIdx = i;
      bestT = t;
    }
  }

  return {
    distance: Math.sqrt(minDistanceSq),
    sampleIndex: bestIdx,
    t: (bestIdx + bestT) / Math.max(1, samples.length - 1),
  };
}

/** Carves a riverbed or flattens a road path along a 3D spline on terrain. */
export function carveTerrainSplinePath(
  mesh: EditableMesh,
  controlPoints: Vec3[],
  options: {
    width?: number;
    depth?: number;
    mode?: 'river' | 'road';
    feather?: number;
    waterLevel?: number;
    samplesCount?: number;
  } = {},
): number {
  if (controlPoints.length < 2) return 0;
  const width = Math.max(0.2, options.width ?? 3);
  const depth = Math.max(0, options.depth ?? 1.5);
  const mode = options.mode ?? 'river';
  const halfWidth = width * 0.5;
  const feather = Math.max(0.2, options.feather ?? width * 0.4);
  const outer = halfWidth + feather;
  const numSamples = options.samplesCount ?? Math.max(16, controlPoints.length * 10);

  // Sample spline curve
  const samples: Vec3[] = [];
  for (let i = 0; i <= numSamples; i++) {
    const t = i / numSamples;
    const evalResult = evaluateCatmullRomSpline(controlPoints, t);
    samples.push(evalResult.position);
  }

  let affected = 0;

  for (const vertex of mesh.vertices.values()) {
    const hit = distanceToSplineXZ(vertex.position.x, vertex.position.z, samples);
    if (hit.distance > outer) continue;

    const samplePos = samples[hit.sampleIndex]!;
    const dist = hit.distance;

    if (mode === 'road') {
      // Road path: Flattens ground to spline Y height across width with soft shoulder falloff.
      const factor = 1 - smoothstep(halfWidth, outer, dist);
      const targetY = samplePos.y;
      vertex.position.y = vertex.position.y + (targetY - vertex.position.y) * factor;
      affected += 1;
    } else {
      // River channel: U-shaped riverbed carving below water level/spline height.
      const innerWeight = 1 - smoothstep(0, halfWidth, dist);
      const bankWeight = 1 - smoothstep(halfWidth, outer, dist);
      const weight = innerWeight * 0.8 + bankWeight * 0.2;
      if (weight <= 1e-4) continue;

      const bowl = weight * weight * (3 - 2 * weight);
      const targetBedY = (options.waterLevel ?? samplePos.y) - depth * bowl;

      if (vertex.position.y > targetBedY) {
        vertex.position.y = targetBedY + (vertex.position.y - targetBedY) * (1 - Math.min(1, bowl * 0.95));
        affected += 1;
      }
    }
  }

  if (affected > 0) bumpPositions(mesh);
  return affected;
}

/** Generates a conforming 3D River Quad-Strip Water Mesh with flow-aligned UVs. */
export function generateRiverWaterMesh(
  controlPoints: Vec3[],
  width = 3,
  segmentsPerPoint = 8,
): EditableMesh {
  const mesh = createEmptyMesh('River Water Ribbon');
  const layerId = mesh.defaultUvLayerId ?? 'uv1';

  if (controlPoints.length < 2) return mesh;
  const numSegments = (controlPoints.length - 1) * segmentsPerPoint;
  const halfWidth = width * 0.5;

  let totalDistance = 0;
  let prevPos: Vec3 | null = null;
  const stripPoints: { left: Vec3; right: Vec3; v: number }[] = [];

  for (let i = 0; i <= numSegments; i++) {
    const t = i / numSegments;
    const { position, tangent } = evaluateCatmullRomSpline(controlPoints, t);

    if (prevPos) {
      const dx = position.x - prevPos.x;
      const dy = position.y - prevPos.y;
      const dz = position.z - prevPos.z;
      totalDistance += Math.sqrt(dx * dx + dy * dy + dz * dz);
    }
    prevPos = position;

    // Normal vector perpendicular to tangent on XZ plane
    const normX = -tangent.z;
    const normZ = tangent.x;
    const normLen = Math.hypot(normX, normZ);
    const nx = normLen > 1e-6 ? normX / normLen : 1;
    const nz = normLen > 1e-6 ? normZ / normLen : 0;

    const left = v3(position.x - nx * halfWidth, position.y + 0.05, position.z - nz * halfWidth);
    const right = v3(position.x + nx * halfWidth, position.y + 0.05, position.z + nz * halfWidth);

    stripPoints.push({ left, right, v: totalDistance / width });
  }

  // Build quad faces along river strip
  for (let i = 0; i < stripPoints.length - 1; i++) {
    const p1 = stripPoints[i]!;
    const p2 = stripPoints[i + 1]!;

    const v1 = addVertex(mesh, p1.left);
    const v2 = addVertex(mesh, p1.right);
    const v3Pt = addVertex(mesh, p2.right);
    const v4 = addVertex(mesh, p2.left);

    const faceId = addFace(mesh, [v1, v2, v3Pt, v4]);
    const corners = mesh.faces.get(faceId)?.cornerIds ?? [];

    if (corners.length === 4) {
      mesh.faceCorners.get(corners[0]!)?.uvs.set(layerId, { x: 0, y: p1.v });
      mesh.faceCorners.get(corners[1]!)?.uvs.set(layerId, { x: 1, y: p1.v });
      mesh.faceCorners.get(corners[2]!)?.uvs.set(layerId, { x: 1, y: p2.v });
      mesh.faceCorners.get(corners[3]!)?.uvs.set(layerId, { x: 0, y: p2.v });
    }
  }

  bumpTopology(mesh);
  bumpPositions(mesh);
  return mesh;
}
