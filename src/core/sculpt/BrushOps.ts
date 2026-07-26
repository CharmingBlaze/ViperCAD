import {
  addVec3,
  cloneVec3,
  lengthVec3,
  normalizeVec3,
  scaleVec3,
  subVec3,
  type Vec3,
} from '@/core/math/Vec3';
import { computeVertexNormals } from '@/core/mesh/Normals';
import type { EditableMesh, VertexId } from '@/core/mesh/types';
import { falloffWeight, type SculptFalloff } from '@/core/sculpt/BrushFalloff';
import { buildVertexNeighborMap, neighborAverage } from '@/core/sculpt/VertexNeighbors';

export type MeshBrushMode =
  | 'grab'
  | 'inflate'
  | 'smooth'
  | 'flatten'
  | 'pinch'
  | 'crease'
  | 'noise';

export type BrushAffected = { id: VertexId; weight: number; distance: number };

export function collectBrushVertices(
  mesh: EditableMesh,
  center: Vec3,
  radius: number,
  falloff: SculptFalloff,
): BrushAffected[] {
  const affected: BrushAffected[] = [];
  for (const vertex of mesh.vertices.values()) {
    const distance = lengthVec3(subVec3(vertex.position, center));
    if (distance > radius) continue;
    affected.push({
      id: vertex.id,
      weight: falloffWeight(distance / radius, falloff),
      distance,
    });
  }
  return affected;
}

export function applyMeshBrush(
  mesh: EditableMesh,
  mode: MeshBrushMode,
  center: Vec3,
  radius: number,
  strength: number,
  falloff: SculptFalloff,
  invert: boolean,
  options: {
    grabDelta?: Vec3;
    flattenPlanePoint?: Vec3;
    flattenPlaneNormal?: Vec3;
    strokeBase?: Map<VertexId, Vec3>;
  } = {},
): void {
  const affected = collectBrushVertices(mesh, center, radius, falloff);
  if (!affected.length) return;
  const sign = invert ? -1 : 1;
  const vertexNormals = computeVertexNormals(mesh);
  const neighborMap = buildVertexNeighborMap(mesh);

  if (mode === 'grab' && options.grabDelta && options.strokeBase) {
    for (const item of affected) {
      const base = options.strokeBase.get(item.id);
      const vertex = mesh.vertices.get(item.id);
      if (!base || !vertex) continue;
      vertex.position = addVec3(base, scaleVec3(options.grabDelta, item.weight));
    }
    return;
  }

  for (const item of affected) {
    const vertex = mesh.vertices.get(item.id)!;
    const amount = strength * item.weight * sign;
    const normal = vertexNormals.get(item.id) ?? { x: 0, y: 1, z: 0 };

    if (mode === 'inflate') {
      vertex.position = addVec3(vertex.position, scaleVec3(normal, amount));
    } else if (mode === 'smooth') {
      const average = neighborAverage(mesh, item.id, neighborMap);
      if (!average) continue;
      vertex.position = addVec3(
        vertex.position,
        scaleVec3(subVec3(average, vertex.position), Math.min(1, Math.abs(amount))),
      );
    } else if (mode === 'flatten') {
      const planePoint = options.flattenPlanePoint ?? center;
      const planeNormal = normalizeVec3(options.flattenPlaneNormal ?? normal);
      const offset = dot(subVec3(vertex.position, planePoint), planeNormal);
      vertex.position = addVec3(
        vertex.position,
        scaleVec3(planeNormal, -offset * Math.min(1, Math.abs(amount))),
      );
    } else if (mode === 'pinch') {
      const toCenter = subVec3(center, vertex.position);
      const len = lengthVec3(toCenter);
      if (len < 1e-8) continue;
      vertex.position = addVec3(vertex.position, scaleVec3(normalizeVec3(toCenter), amount));
    } else if (mode === 'crease') {
      const average = neighborAverage(mesh, item.id, neighborMap);
      if (!average) continue;
      const deviation = subVec3(vertex.position, average);
      vertex.position = addVec3(
        vertex.position,
        scaleVec3(deviation, Math.min(1, Math.abs(amount)) * 0.65),
      );
    } else if (mode === 'noise') {
      const seed = vertex.position.x * 12.9898 + vertex.position.y * 78.233 + vertex.position.z * 37.719;
      const noise = Math.sin(seed) * 43758.5453;
      const value = ((noise - Math.floor(noise)) * 2 - 1) * amount;
      vertex.position = addVec3(vertex.position, scaleVec3(normal, value));
    }
  }
}

function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

export function snapshotVertexPositions(mesh: EditableMesh): Map<VertexId, Vec3> {
  return new Map([...mesh.vertices].map(([id, vertex]) => [id, cloneVec3(vertex.position)]));
}

export function restoreVertexPositions(mesh: EditableMesh, positions: Map<VertexId, Vec3>): void {
  for (const [id, position] of positions) {
    const vertex = mesh.vertices.get(id);
    if (vertex) vertex.position = cloneVec3(position);
  }
}
