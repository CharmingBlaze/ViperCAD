import {
  addVec3,
  cloneVec3,
  crossVec3,
  dotVec3,
  lengthVec3,
  normalizeVec3,
  scaleVec3,
  subVec3,
  type Vec3,
} from '@/core/math/Vec3';
import { computeVertexNormals } from '@/core/mesh/Normals';
import type { EditableMesh, VertexId } from '@/core/mesh/types';
import { falloffWeight, type SculptFalloff } from '@/core/sculpt/BrushFalloff';
import { getOrCreateSpatialIndex } from '@/core/sculpt/SculptSpatialIndex';
import { getCachedVertexNeighborMap, neighborAverage } from '@/core/sculpt/VertexNeighbors';

export type MeshBrushMode =
  | 'draw'
  | 'clay'
  | 'grab'
  | 'inflate'
  | 'smooth'
  | 'flatten'
  | 'scrape'
  | 'pinch'
  | 'crease'
  | 'snake_hook'
  | 'twist'
  | 'nudge'
  | 'noise'
  | 'mask'
  | 'unmask';

export type BrushAffected = { id: VertexId; weight: number; distance: number };

export function collectBrushVertices(
  mesh: EditableMesh,
  center: Vec3,
  radius: number,
  falloff: SculptFalloff,
  options: {
    hardness?: number;
    frontFacesOnly?: boolean;
    surfaceNormal?: Vec3;
  } = {},
): BrushAffected[] {
  const index = getOrCreateSpatialIndex(mesh);
  const near = index.querySphere(mesh, center, radius);
  const affected: BrushAffected[] = [];
  const hardness = Math.max(0, Math.min(0.95, options.hardness ?? 0));
  const vertexNormals = options.frontFacesOnly ? computeVertexNormals(mesh) : null;
  for (const item of near) {
    if (vertexNormals && options.surfaceNormal) {
      const normal = vertexNormals.get(item.id);
      if (normal && dotVec3(normal, options.surfaceNormal) < -0.05) continue;
    }
    const normalizedDistance = item.distance / Math.max(1e-8, radius);
    const shapedDistance = normalizedDistance <= hardness
      ? 0
      : (normalizedDistance - hardness) / Math.max(1e-6, 1 - hardness);
    const weight = falloffWeight(shapedDistance, falloff);
    if (weight > 0) {
      affected.push({
        id: item.id,
        weight,
        distance: item.distance,
      });
    }
  }
  return affected;
}

export type BrushApplyOptions = {
  grabDelta?: Vec3;
  strokeDelta?: Vec3;
  flattenPlanePoint?: Vec3;
  flattenPlaneNormal?: Vec3;
  strokeBase?: Map<VertexId, Vec3>;
  contactNormal?: Vec3;
  mask?: Map<VertexId, number>;
  hardness?: number;
  pressure?: number;
  buildUp?: number;
  frontFacesOnly?: boolean;
  surfaceNormal?: Vec3;
  preserveVolume?: number;
};

export function applyMeshBrush(
  mesh: EditableMesh,
  mode: MeshBrushMode,
  center: Vec3,
  radius: number,
  strength: number,
  falloff: SculptFalloff,
  invert: boolean,
  options: BrushApplyOptions = {},
): void {
  const affected = collectBrushVertices(mesh, center, radius, falloff, {
    hardness: options.hardness,
    frontFacesOnly: options.frontFacesOnly,
    surfaceNormal: options.surfaceNormal,
  });
  if (!affected.length) return;
  const sign = invert ? -1 : 1;
  const pressure = Math.max(0.05, Math.min(1, options.pressure ?? 1));
  const buildUp = Math.max(0.05, Math.min(3, options.buildUp ?? 1));

  // Masking brushes modify vertex mask weights and return without modifying geometry
  if (mode === 'mask' || mode === 'unmask') {
    if (!options.mask) return;
    for (const item of affected) {
      const current = options.mask.get(item.id) ?? 0;
      const delta = (mode === 'mask' ? 1 : -1) * strength * item.weight * sign * pressure;
      options.mask.set(item.id, Math.max(0, Math.min(1, current + delta)));
    }
    return;
  }

  const vertexNormals = computeVertexNormals(mesh);
  const neighborMap = getCachedVertexNeighborMap(mesh);
  const contactNormal = normalizeVec3(options.contactNormal ?? { x: 0, y: 1, z: 0 });

  if (mode === 'grab' && options.grabDelta && options.strokeBase) {
    for (const item of affected) {
      const maskVal = options.mask?.get(item.id) ?? 0;
      if (maskVal >= 1) continue;
      const base = options.strokeBase.get(item.id);
      const vertex = mesh.vertices.get(item.id);
      if (!base || !vertex) continue;
      const effWeight = item.weight * (1 - maskVal);
      vertex.position = addVec3(base, scaleVec3(options.grabDelta, effWeight));
    }
    return;
  }

  for (const item of affected) {
    const maskVal = options.mask?.get(item.id) ?? 0;
    if (maskVal >= 1) continue;
    const vertex = mesh.vertices.get(item.id)!;
    const effWeight = item.weight * (1 - maskVal);
    const amount = strength * effWeight * sign * pressure * buildUp;
    const normal = vertexNormals.get(item.id) ?? contactNormal;

    if (mode === 'draw') {
      // Moves vertices along contact normal with spherical bell profile
      vertex.position = addVec3(vertex.position, scaleVec3(contactNormal, amount));
    } else if (mode === 'clay') {
      // Builds up flat clay layers clamped to an offset build plane
      const targetOffset = radius * 0.28 * sign;
      const planePt = addVec3(center, scaleVec3(contactNormal, targetOffset));
      const distToPlane = dotVec3(subVec3(planePt, vertex.position), contactNormal);
      if (sign > 0 && distToPlane > 0) {
        const step = Math.min(distToPlane, Math.abs(amount) * radius * 0.6);
        vertex.position = addVec3(vertex.position, scaleVec3(contactNormal, step));
      } else if (sign < 0 && distToPlane < 0) {
        const step = Math.max(distToPlane, -Math.abs(amount) * radius * 0.6);
        vertex.position = addVec3(vertex.position, scaleVec3(contactNormal, step));
      }
    } else if (mode === 'inflate') {
      vertex.position = addVec3(vertex.position, scaleVec3(normal, amount));
    } else if (mode === 'smooth') {
      const average = neighborAverage(mesh, item.id, neighborMap);
      if (!average) continue;
      const delta = subVec3(average, vertex.position);
      const preserveVolume = Math.max(0, Math.min(1, options.preserveVolume ?? 0));
      const normalOffset = dotVec3(delta, normal);
      const relaxed = subVec3(delta, scaleVec3(normal, normalOffset * preserveVolume));
      vertex.position = addVec3(
        vertex.position,
        scaleVec3(relaxed, Math.min(1, Math.abs(amount))),
      );
    } else if (mode === 'flatten') {
      const planePoint = options.flattenPlanePoint ?? center;
      const planeNormal = normalizeVec3(options.flattenPlaneNormal ?? normal);
      const offset = dotVec3(subVec3(vertex.position, planePoint), planeNormal);
      vertex.position = addVec3(
        vertex.position,
        scaleVec3(planeNormal, -offset * Math.min(1, Math.abs(amount))),
      );
    } else if (mode === 'scrape') {
      // Scrapes away material extending above the contact plane
      const planeNormal = normalizeVec3(options.flattenPlaneNormal ?? contactNormal);
      const dist = dotVec3(subVec3(vertex.position, center), planeNormal);
      if (dist * sign > 0) {
        const correction = -dist * Math.min(1, Math.abs(amount) * 2.5);
        vertex.position = addVec3(vertex.position, scaleVec3(planeNormal, correction));
      }
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
    } else if (mode === 'snake_hook') {
      // Pulls geometry along continuous stroke delta
      if (options.strokeDelta) {
        const factor = Math.min(1, effWeight * 1.5);
        vertex.position = addVec3(vertex.position, scaleVec3(options.strokeDelta, factor));
      }
    } else if (mode === 'twist') {
      // Rotates vertices around contact normal
      const v = subVec3(vertex.position, center);
      const angle = amount * 3.14159;
      const cosA = Math.cos(angle);
      const sinA = Math.sin(angle);
      const rotated = addVec3(
        addVec3(scaleVec3(v, cosA), scaleVec3(crossVec3(contactNormal, v), sinA)),
        scaleVec3(contactNormal, dotVec3(contactNormal, v) * (1 - cosA)),
      );
      vertex.position = addVec3(center, rotated);
    } else if (mode === 'nudge') {
      // Moves vertices tangentially along the stroke direction
      if (options.strokeDelta) {
        const normalComp = dotVec3(options.strokeDelta, normal);
        const tangent = subVec3(options.strokeDelta, scaleVec3(normal, normalComp));
        vertex.position = addVec3(vertex.position, scaleVec3(tangent, effWeight * strength));
      }
    } else if (mode === 'noise') {
      const seed = vertex.position.x * 12.9898 + vertex.position.y * 78.233 + vertex.position.z * 37.719;
      const noise = Math.sin(seed) * 43758.5453;
      const value = ((noise - Math.floor(noise)) * 2 - 1) * amount;
      vertex.position = addVec3(vertex.position, scaleVec3(normal, value));
    }
  }
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
