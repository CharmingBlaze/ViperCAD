import { addFace, addVertex, buildEdgeLookup, faceCornerIds, faceVertexIds } from '@/core/mesh/EditableMesh';
import type { EditableMesh, FaceId, VertexId } from '@/core/mesh/types';
import type { ModelDocument, ObjectId } from '@/core/document/types';
import { duplicateObject } from '@/core/document/ModelDocument';
import { v3, type Vec3 } from '@/core/math/Vec3';
import { createMirroredInstance } from './GameAssetTools';
import { flipFaces } from '@/core/mesh/ops/basic';

export type MirrorAxis = 'x' | 'y' | 'z';

/** Flip object scale in place along an axis. */
export function flipObjectScale(
  document: ModelDocument,
  objectIds: Iterable<ObjectId>,
  axis: MirrorAxis = 'x',
): number {
  let count = 0;
  for (const id of objectIds) {
    const obj = document.objects.get(id);
    if (!obj) continue;
    obj.transform.scale[axis] *= -1;
    count++;
  }
  if (count > 0) document.dirty = true;
  return count;
}

/** Mirror object position and scale across the world origin along an axis. */
export function mirrorObjectAcrossWorld(
  document: ModelDocument,
  objectIds: Iterable<ObjectId>,
  axis: MirrorAxis = 'x',
): number {
  let count = 0;
  for (const id of objectIds) {
    const obj = document.objects.get(id);
    if (!obj) continue;
    obj.transform.position[axis] *= -1;
    obj.transform.scale[axis] *= -1;
    count++;
  }
  if (count > 0) document.dirty = true;
  return count;
}

/**
 * Duplicate objects and mirror them across the world center (e.g. ±X).
 * Useful for duplicating wheels, doors, wings, headlights to the opposite side of a car/model.
 */
export function duplicateAndMirrorObjects(
  document: ModelDocument,
  objectIds: Iterable<ObjectId>,
  axis: MirrorAxis = 'x',
  linked = false,
): ObjectId[] {
  const newIds: ObjectId[] = [];
  for (const id of objectIds) {
    const source = document.objects.get(id);
    if (!source) continue;

    if (linked && source.meshId) {
      const mirrorId = createMirroredInstance(document, id, axis);
      const mirror = document.objects.get(mirrorId);
      if (mirror) {
        mirror.transform.position[axis] = -source.transform.position[axis];
        newIds.push(mirrorId);
      }
      continue;
    }

    const dupId = duplicateObject(document, id, false);
    const dup = document.objects.get(dupId);
    if (!dup) continue;

    dup.name = `${source.name}_Mirror${axis.toUpperCase()}`;
    dup.transform.position[axis] = -source.transform.position[axis];
    dup.transform.scale[axis] = -source.transform.scale[axis];
    newIds.push(dupId);
  }
  if (newIds.length > 0) document.dirty = true;
  return newIds;
}

/** Rotate objects around an axis by a given angle in degrees. */
export function rotateObjectsDegrees(
  document: ModelDocument,
  objectIds: Iterable<ObjectId>,
  axis: MirrorAxis,
  degrees: number,
): number {
  const rad = (degrees * Math.PI) / 180;
  let count = 0;
  for (const id of objectIds) {
    const obj = document.objects.get(id);
    if (!obj) continue;
    obj.transform.rotation[axis] = (obj.transform.rotation[axis] + rad) % (Math.PI * 2);
    count++;
  }
  if (count > 0) document.dirty = true;
  return count;
}

/** Center objects along an axis to 0. */
export function centerObjectsOnAxis(
  document: ModelDocument,
  objectIds: Iterable<ObjectId>,
  axis: MirrorAxis = 'x',
): number {
  let count = 0;
  for (const id of objectIds) {
    const obj = document.objects.get(id);
    if (!obj) continue;
    obj.transform.position[axis] = 0;
    count++;
  }
  if (count > 0) document.dirty = true;
  return count;
}

/** Snap objects so their bottom bounding box sits exactly at ground level Y=0. */
export function snapObjectsToGround(
  document: ModelDocument,
  objectIds: Iterable<ObjectId>,
): number {
  let count = 0;
  for (const id of objectIds) {
    const obj = document.objects.get(id);
    if (!obj) continue;
    const mesh = obj.meshId ? document.meshes.get(obj.meshId) : null;
    if (!mesh || !mesh.vertices.size) {
      obj.transform.position.y = 0;
      count++;
      continue;
    }

    let minY = Infinity;
    for (const v of mesh.vertices.values()) {
      const worldY = obj.transform.position.y + v.position.y * obj.transform.scale.y;
      if (worldY < minY) minY = worldY;
    }

    if (Number.isFinite(minY)) {
      obj.transform.position.y -= minY;
      count++;
    }
  }
  if (count > 0) document.dirty = true;
  return count;
}

/**
 * Duplicate selected mesh faces and mirror them across an axis (defaults to X=0).
 * Vertices are mirrored across 0, vertex winding is reversed so normals face outward,
 * and UVs are preserved with horizontal flipping.
 */
export function duplicateAndMirrorFaces(
  mesh: EditableMesh,
  faceIds: Iterable<FaceId>,
  axis: MirrorAxis = 'x',
  _tolerance = 0.001,
): { newFaceIds: FaceId[]; createdVertexCount: number } {
  const ids = [...faceIds];
  if (!ids.length) return { newFaceIds: [], createdVertexCount: 0 };

  const edgeLookup = buildEdgeLookup(mesh);
  const newFaceIds: FaceId[] = [];
  let createdVertexCount = 0;

  const vertexMap = new Map<VertexId, VertexId>();

  const getOrAddMirroredVertex = (srcVertId: VertexId): VertexId => {
    const cached = vertexMap.get(srcVertId);
    if (cached) return cached;

    const srcV = mesh.vertices.get(srcVertId);
    if (!srcV) return srcVertId;

    const targetPos: Vec3 = { ...srcV.position };
    targetPos[axis] = -targetPos[axis];

    const newVId = addVertex(mesh, v3(targetPos.x, targetPos.y, targetPos.z));
    createdVertexCount++;
    vertexMap.set(srcVertId, newVId);
    return newVId;
  };

  for (const faceId of ids) {
    const face = mesh.faces.get(faceId);
    if (!face) continue;

    const srcVertIds = faceVertexIds(mesh, faceId);
    if (srcVertIds.length < 3) continue;

    const srcCornerIds = faceCornerIds(mesh, faceId);
    const mirroredVerts = srcVertIds.map(getOrAddMirroredVertex);

    // Extract UVs
    const uvs = srcCornerIds.map((cId) => {
      const corner = mesh.faceCorners.get(cId);
      const uv = mesh.defaultUvLayerId ? corner?.uvs.get(mesh.defaultUvLayerId) : null;
      return uv ? { x: 1 - uv.x, y: uv.y } : { x: 0, y: 0 };
    });

    mirroredVerts.reverse();
    uvs.reverse();

    const added = addFace(mesh, mirroredVerts, {
      uvs,
      materialSlot: face.materialSlot,
      flatShaded: face.flatShaded,
      edgeLookup,
    });

    newFaceIds.push(added.faceId);
  }

  if (newFaceIds.length > 0) {
    mesh.topologyVersion++;
    mesh.geometryVersion++;
    mesh.dirty.topology = true;
    mesh.dirty.positions = true;
    mesh.dirty.normals = true;
    mesh.dirty.uvs = true;
  }

  return { newFaceIds, createdVertexCount };
}

export { flipFaces };
