import { addVec3, scaleVec3 } from '@/core/math/Vec3';
import {
  addFace,
  addVertex,
  createEmptyMesh,
  faceVertexIds,
} from '@/core/mesh/EditableMesh';
import { computeFaceNormal } from '@/core/mesh/Normals';
import type { EditableMesh, FaceId, VertexId } from '@/core/mesh/types';
import { commitMeshObject } from '@/core/document/ModelDocument';
import type { ModelDocument, SceneObject } from '@/core/document/types';
import { getCachedVertexNeighborMap } from './VertexNeighbors';

const meshMaskCache = new Map<string, Map<VertexId, number>>();

export function getMeshMask(meshId: string): Map<VertexId, number> {
  let mask = meshMaskCache.get(meshId);
  if (!mask) {
    mask = new Map();
    meshMaskCache.set(meshId, mask);
  }
  return mask;
}

export function clearMeshMask(meshId: string): void {
  meshMaskCache.delete(meshId);
}

export function invertMeshMask(mesh: EditableMesh): void {
  const mask = getMeshMask(mesh.id);
  for (const vertexId of mesh.vertices.keys()) {
    const val = mask.get(vertexId) ?? 0;
    const inv = 1 - val;
    if (inv <= 0.001) {
      mask.delete(vertexId);
    } else {
      mask.set(vertexId, inv);
    }
  }
}

export function blurMeshMask(mesh: EditableMesh): void {
  const mask = getMeshMask(mesh.id);
  const neighborMap = getCachedVertexNeighborMap(mesh);
  const next = new Map<VertexId, number>();

  for (const [id, neighbors] of neighborMap) {
    const current = mask.get(id) ?? 0;
    if (!neighbors.length) {
      if (current > 0) next.set(id, current);
      continue;
    }
    let sum = current;
    for (const n of neighbors) {
      sum += mask.get(n) ?? 0;
    }
    const blurred = sum / (neighbors.length + 1);
    if (blurred > 0.001) next.set(id, Math.min(1, blurred));
  }

  meshMaskCache.set(mesh.id, next);
}

export function sharpenMeshMask(mesh: EditableMesh): void {
  const mask = getMeshMask(mesh.id);
  for (const [id, val] of mask) {
    // S-curve contrast
    const sharpened = val < 0.5 ? 2 * val * val : 1 - 2 * (1 - val) * (1 - val);
    if (sharpened <= 0.001) mask.delete(id);
    else mask.set(id, Math.min(1, sharpened));
  }
}

export function hasMask(meshId: string): boolean {
  const mask = meshMaskCache.get(meshId);
  return !!mask && mask.size > 0;
}

/**
 * Extracts masked faces into a separate mesh object with optional solidify thickness.
 * Used for creating clothes, armor, hair strands, plates.
 */
export function extractMaskedGeometry(
  document: ModelDocument,
  sourceObject: SceneObject,
  sourceMesh: EditableMesh,
  threshold = 0.4,
  thickness = 0.02,
): string | null {
  const mask = getMeshMask(sourceMesh.id);
  if (!mask.size) return null;

  // Find all faces where majority of vertices are above threshold
  const extractedFaces: FaceId[] = [];
  for (const face of sourceMesh.faces.values()) {
    const vIds = faceVertexIds(sourceMesh, face.id);
    if (!vIds.length) continue;
    let maskedCount = 0;
    for (const vId of vIds) {
      if ((mask.get(vId) ?? 0) >= threshold) maskedCount++;
    }
    if (maskedCount >= Math.ceil(vIds.length / 2)) {
      extractedFaces.push(face.id);
    }
  }

  if (!extractedFaces.length) return null;

  const newMesh = createEmptyMesh(`${sourceObject.name} Extraction`);
  const oldToNewVertex = new Map<VertexId, VertexId>();

  for (const faceId of extractedFaces) {
    const vIds = faceVertexIds(sourceMesh, faceId);
    const newVIds: VertexId[] = [];
    const faceNormal = computeFaceNormal(sourceMesh, faceId);

    for (const oldVId of vIds) {
      let newVId = oldToNewVertex.get(oldVId);
      if (!newVId) {
        const oldPos = sourceMesh.vertices.get(oldVId)!.position;
        // Slightly offset outward along normal by thickness to sit right on top of original
        const pos = addVec3(oldPos, scaleVec3(faceNormal, thickness));
        newVId = addVertex(newMesh, pos);
        oldToNewVertex.set(oldVId, newVId);
      }
      newVIds.push(newVId);
    }
    addFace(newMesh, newVIds);
  }

  const { objectId } = commitMeshObject(document, newMesh, {
    name: `${sourceObject.name}_Extracted`,
  });

  const createdObj = document.objects.get(objectId);
  if (createdObj) {
    createdObj.transform = { ...sourceObject.transform };
  }

  return objectId;
}
