import type { VertexId } from '@/core/mesh/types';
import type { EditableMesh } from '@/core/mesh/types';
import { bumpPositions } from '@/core/mesh/EditableMesh';
import type { Vec3 } from '@/core/math/Vec3';
import { cloneVec3 } from '@/core/math/Vec3';

export type XZ = { x: number; z: number };

/** Soft channel stamp along a polyline (terrain-local XZ). */
export function carveTerrainChannel(
  mesh: EditableMesh,
  points: XZ[],
  width: number,
  depth: number,
  options: { feather?: number } = {},
): number {
  if (points.length < 2 || depth <= 1e-6) return 0;
  const halfWidth = Math.max(0.05, width) * 0.5;
  const feather = Math.max(halfWidth * 0.35, options.feather ?? halfWidth * 0.55);
  const outer = halfWidth + feather;
  let affected = 0;

  for (const vertex of mesh.vertices.values()) {
    const dist = distancePointToPolylineXZ(vertex.position.x, vertex.position.z, points);
    if (dist > outer) continue;
    const channel = 1 - smoothstep(0, halfWidth, dist);
    const bank = 1 - smoothstep(halfWidth, outer, dist);
    const weight = channel * 0.85 + bank * 0.15;
    if (weight <= 1e-4) continue;
    // U-shaped bed: stronger in the centre, soft shoulders.
    const bowl = weight * weight * (3 - 2 * weight);
    vertex.position.y -= depth * bowl;
    affected += 1;
  }
  if (affected > 0) bumpPositions(mesh);
  return affected;
}

/**
 * Soft basin / crater for lakes. When `waterLevel` is set, terrain is pushed
 * down toward a bed below the water plane (never raises ground).
 */
export function carveTerrainBasin(
  mesh: EditableMesh,
  centerX: number,
  centerZ: number,
  radius: number,
  depth: number,
  options: { waterLevel?: number; feather?: number } = {},
): number {
  const r = Math.max(0.1, radius);
  const feather = Math.max(r * 0.12, options.feather ?? r * 0.22);
  const outer = r + feather;
  const waterLevel = options.waterLevel;
  let affected = 0;

  for (const vertex of mesh.vertices.values()) {
    const dist = Math.hypot(vertex.position.x - centerX, vertex.position.z - centerZ);
    if (dist > outer) continue;
    const t = 1 - smoothstep(0, outer, dist);
    // Flatter floor near the centre, steepening toward the shore.
    const bowl = t * t * (0.55 + 0.45 * t);
    if (bowl <= 1e-4) continue;

    if (waterLevel !== undefined) {
      const bed = waterLevel - depth * bowl;
      if (vertex.position.y > bed) {
        vertex.position.y = bed + (vertex.position.y - bed) * (1 - Math.min(1, bowl * 0.92));
        affected += 1;
      }
    } else {
      vertex.position.y -= depth * bowl;
      affected += 1;
    }
  }
  if (affected > 0) bumpPositions(mesh);
  return affected;
}

/** Broad soft depression under an ocean footprint (terrain-local AABB). */
export function carveTerrainOceanBed(
  mesh: EditableMesh,
  halfSize: number,
  depth: number,
  waterLevel: number,
  options: { feather?: number } = {},
): number {
  const half = Math.max(0.1, halfSize);
  const feather = Math.max(half * 0.08, options.feather ?? half * 0.12);
  let affected = 0;

  for (const vertex of mesh.vertices.values()) {
    const ax = Math.abs(vertex.position.x);
    const az = Math.abs(vertex.position.z);
    if (ax > half + feather || az > half + feather) continue;
    const edgeX = 1 - smoothstep(half - feather, half + feather, ax);
    const edgeZ = 1 - smoothstep(half - feather, half + feather, az);
    const weight = edgeX * edgeZ;
    if (weight <= 1e-4) continue;
    const bed = waterLevel - depth * (0.35 + 0.65 * weight);
    if (vertex.position.y > bed) {
      vertex.position.y += (bed - vertex.position.y) * Math.min(1, weight * 0.95);
      affected += 1;
    }
  }
  if (affected > 0) bumpPositions(mesh);
  return affected;
}

export function snapshotTerrainHeights(mesh: EditableMesh): Map<VertexId, Vec3> {
  return new Map([...mesh.vertices].map(([id, vertex]) => [id, cloneVec3(vertex.position)]));
}

export function restoreTerrainHeights(mesh: EditableMesh, positions: Map<VertexId, Vec3>): void {
  for (const [id, position] of positions) {
    const vertex = mesh.vertices.get(id);
    if (vertex) vertex.position = cloneVec3(position);
  }
  bumpPositions(mesh);
}

export function distancePointToPolylineXZ(x: number, z: number, points: XZ[]): number {
  let best = Infinity;
  for (let index = 0; index < points.length - 1; index++) {
    const a = points[index]!;
    const b = points[index + 1]!;
    best = Math.min(best, distancePointToSegmentXZ(x, z, a, b));
  }
  return best;
}

function distancePointToSegmentXZ(x: number, z: number, a: XZ, b: XZ): number {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const lengthSq = dx * dx + dz * dz;
  if (lengthSq < 1e-12) return Math.hypot(x - a.x, z - a.z);
  let t = ((x - a.x) * dx + (z - a.z) * dz) / lengthSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(x - (a.x + dx * t), z - (a.z + dz * t));
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  if (edge1 <= edge0) return value >= edge1 ? 1 : 0;
  const t = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}
