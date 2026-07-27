import { addVec3, scaleVec3 } from '@/core/math/Vec3';
import type { Vec3 } from '@/core/math/Vec3';
import {
  addFace,
  addVertex,
  buildEdgeLookup,
  createEmptyMesh,
  faceCornerIds,
  faceVertexIds,
} from '@/core/mesh/EditableMesh';
import { weldVerticesByDistance } from '@/core/mesh/ops/basic';
import type { EditableMesh, FaceId, VertexId } from '@/core/mesh/types';
import type { MirrorModifierSpec } from '@/core/modifiers/types';

const AXIS_INDEX = { x: 0, y: 1, z: 2 } as const;

function axisCoord(position: Vec3, axis: MirrorModifierSpec['axis']): number {
  return axis === 'x' ? position.x : axis === 'y' ? position.y : position.z;
}

function setAxisCoord(position: Vec3, axis: MirrorModifierSpec['axis'], value: number): Vec3 {
  if (axis === 'x') return { ...position, x: value };
  if (axis === 'y') return { ...position, y: value };
  return { ...position, z: value };
}

function mirrorPosition(position: Vec3, axis: MirrorModifierSpec['axis']): Vec3 {
  return setAxisCoord(position, axis, -axisCoord(position, axis));
}

function quantize(value: number, step: number): number {
  if (step <= 0) return value;
  return Math.round(value / step) * step;
}

function positionCacheKey(position: Vec3, merge: number): string {
  const coords = [
    quantize(position.x, merge),
    quantize(position.y, merge),
    quantize(position.z, merge),
  ];
  return coords.map((value) => value.toFixed(5)).join('|');
}

function averagePosition(positions: Vec3[]): Vec3 {
  if (!positions.length) return { x: 0, y: 0, z: 0 };
  const sum = positions.reduce(
    (acc, position) => addVec3(acc, position),
    { x: 0, y: 0, z: 0 },
  );
  return scaleVec3(sum, 1 / positions.length);
}

function shouldKeepFaceForClip(
  mesh: EditableMesh,
  faceId: FaceId,
  axis: MirrorModifierSpec['axis'],
): boolean {
  const verts = faceVertexIds(mesh, faceId);
  const positions = verts
    .map((id) => mesh.vertices.get(id)?.position)
    .filter(Boolean) as Vec3[];
  if (!positions.length) return false;
  const centroid = averagePosition(positions);
  return axisCoord(centroid, axis) >= -1e-8;
}

function isFaceOnMirrorPlane(
  mesh: EditableMesh,
  faceId: FaceId,
  axis: MirrorModifierSpec['axis'],
  epsilon: number,
): boolean {
  const positions = faceVertexIds(mesh, faceId)
    .map((id) => mesh.vertices.get(id)?.position)
    .filter(Boolean) as Vec3[];
  return positions.every((position) => Math.abs(axisCoord(position, axis)) <= epsilon);
}

function getOrCreateVertex(
  target: EditableMesh,
  cache: Map<string, VertexId>,
  position: Vec3,
  merge: number,
): VertexId {
  const key = positionCacheKey(position, merge);
  const existing = cache.get(key);
  if (existing) return existing;
  const id = addVertex(target, position);
  cache.set(key, id);
  return id;
}

function addFaceLoop(
  target: EditableMesh,
  vertexIds: VertexId[],
  source: EditableMesh,
  sourceFaceId: FaceId,
  edgeLookup: Map<string, import('@/core/mesh/types').EdgeId>,
): void {
  if (vertexIds.length < 3) return;
  const cornerIds = faceCornerIds(source, sourceFaceId);
  const uvs = cornerIds.map((cornerId) => {
    const corner = source.faceCorners.get(cornerId);
    const layerId = source.defaultUvLayerId;
    const uv = layerId ? corner?.uvs.get(layerId) : null;
    return uv ? { ...uv } : { x: 0, y: 0 };
  });
  const face = source.faces.get(sourceFaceId);
  addFace(target, vertexIds, {
    materialSlot: face?.materialSlot ?? 0,
    uvs,
    edgeLookup,
  });
}

export function applyMirrorModifier(
  source: EditableMesh,
  modifier: MirrorModifierSpec,
): EditableMesh {
  const merge = Math.max(0, modifier.mergeThreshold);
  const target = createEmptyMesh(`${source.name}_mirror`);
  target.materialSlotCount = source.materialSlotCount;
  const originalCache = new Map<string, VertexId>();
  const mirroredCache = new Map<string, VertexId>();
  const edgeLookup = buildEdgeLookup(target);

  const emitFace = (faceId: FaceId, mirror: boolean) => {
    if (modifier.clip && !shouldKeepFaceForClip(source, faceId, modifier.axis)) return;
    if (mirror && isFaceOnMirrorPlane(source, faceId, modifier.axis, merge || 1e-6)) return;

    const loop = faceVertexIds(source, faceId);
    const cache = mirror ? mirroredCache : originalCache;
    const vertexIds = loop.map((vertexId) => {
      const position = source.vertices.get(vertexId)!.position;
      const next = mirror ? mirrorPosition(position) : position;
      return getOrCreateVertex(target, cache, next, merge);
    });
    const winding = mirror ? [...vertexIds].reverse() : vertexIds;
    addFaceLoop(target, winding, source, faceId, edgeLookup);
  };

  for (const faceId of source.faces.keys()) {
    emitFace(faceId, false);
    emitFace(faceId, true);
  }

  if (merge > 0) {
    const weldCandidates = [...target.vertices.values()]
      .filter((vertex) => Math.abs(axisCoord(vertex.position, modifier.axis)) <= merge)
      .map((vertex) => vertex.id);
    if (weldCandidates.length > 1) {
      weldVerticesByDistance(target, weldCandidates, merge);
    }
  }

  return target;
}
