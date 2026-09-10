import type { ModelDocument, ObjectId } from "@/core/document/types";
import {
  getObjectWorldMatrix,
  matrixFromTransform,
  matrixToTransform,
} from "@/core/editor/Hierarchy";
import { cloneTransform, type Transform } from "@/core/math/Transform";
import { cloneVec3, v3, type Vec3 } from "@/core/math/Vec3";
import { bumpPositions } from "@/core/mesh/EditableMesh";
import { Vector3 } from "three";

export type OriginSnapshot = {
  objectId: ObjectId;
  transform: Transform;
  meshId: string | null;
  vertexPositions: Map<string, Vec3> | null;
  childTransforms: Map<ObjectId, Transform>;
};

export type ObjectBounds = {
  min: Vec3;
  max: Vec3;
  center: Vec3;
  size: Vec3;
};

/** Get the world-space origin (pivot point) of an object. */
export function getObjectOrigin(document: ModelDocument, objectId: ObjectId): Vec3 {
  const worldMatrix = getObjectWorldMatrix(document, objectId);
  const e = worldMatrix.elements;
  return v3(e[12] ?? 0, e[13] ?? 0, e[14] ?? 0);
}

/**
 * Capture an origin snapshot for undo/redo history.
 */
export function captureOriginSnapshot(
  document: ModelDocument,
  objectId: ObjectId,
): OriginSnapshot | null {
  const object = document.objects.get(objectId);
  if (!object) return null;

  let vertexPositions: Map<string, Vec3> | null = null;
  if (object.meshId) {
    const mesh = document.meshes.get(object.meshId);
    if (mesh) {
      vertexPositions = new Map();
      for (const [vId, vertex] of mesh.vertices) {
        vertexPositions.set(vId, cloneVec3(vertex.position));
      }
    }
  }

  const childTransforms = new Map<ObjectId, Transform>();
  for (const childId of object.childIds) {
    const child = document.objects.get(childId);
    if (child) {
      childTransforms.set(childId, cloneTransform(child.transform));
    }
  }

  return {
    objectId,
    transform: cloneTransform(object.transform),
    meshId: object.meshId,
    vertexPositions,
    childTransforms,
  };
}

/**
 * Restore an origin snapshot (reverts origin and vertex positions).
 */
export function restoreOriginSnapshot(
  document: ModelDocument,
  snapshot: OriginSnapshot,
): void {
  const object = document.objects.get(snapshot.objectId);
  if (!object) return;

  object.transform = cloneTransform(snapshot.transform);

  if (snapshot.meshId && snapshot.vertexPositions) {
    const mesh = document.meshes.get(snapshot.meshId);
    if (mesh) {
      for (const [vId, pos] of snapshot.vertexPositions) {
        const vertex = mesh.vertices.get(vId);
        if (vertex) {
          vertex.position = cloneVec3(pos);
        }
      }
      bumpPositions(mesh);
    }
  }

  for (const [childId, transform] of snapshot.childTransforms) {
    const child = document.objects.get(childId);
    if (child) {
      child.transform = cloneTransform(transform);
    }
  }

  document.dirty = true;
}

/**
 * Move the origin of an object to a new world position without moving visible geometry or children.
 *
 * All mesh vertices are offset in local space so their world positions remain identical.
 * All child objects have their local transforms adjusted so their world transforms remain identical.
 */
export function setObjectOrigin(
  document: ModelDocument,
  objectId: ObjectId,
  newWorldOrigin: Vec3,
): void {
  const object = document.objects.get(objectId);
  if (!object) return;

  const currentWorldMatrix = getObjectWorldMatrix(document, objectId);

  // New world matrix has the exact same orientation and scale, but new translation
  const nextWorldMatrix = currentWorldMatrix.clone();
  nextWorldMatrix.setPosition(newWorldOrigin.x, newWorldOrigin.y, newWorldOrigin.z);

  // Relative matrix mapping from old object space into new object space:
  // V_new_local = (nextWorldMatrix)^-1 * currentWorldMatrix * V_old_local
  const nextWorldInv = nextWorldMatrix.clone().invert();
  const relMatrix = nextWorldInv.clone().multiply(currentWorldMatrix);

  // Update object local transform
  if (object.parentId) {
    const parentWorldMatrix = getObjectWorldMatrix(document, object.parentId);
    const parentWorldInv = parentWorldMatrix.clone().invert();
    const nextLocalMatrix = parentWorldInv.multiply(nextWorldMatrix);
    object.transform = matrixToTransform(nextLocalMatrix);
  } else {
    object.transform = matrixToTransform(nextWorldMatrix);
  }

  // Adjust mesh vertices so world geometry stays completely stationary
  if (object.meshId) {
    const mesh = document.meshes.get(object.meshId);
    if (mesh && mesh.vertices.size > 0) {
      const v = new Vector3();
      for (const vertex of mesh.vertices.values()) {
        v.set(vertex.position.x, vertex.position.y, vertex.position.z);
        v.applyMatrix4(relMatrix);
        vertex.position.x = v.x;
        vertex.position.y = v.y;
        vertex.position.z = v.z;
      }
      bumpPositions(mesh);
    }
  }

  // Adjust child objects so their world placement is unaffected
  for (const childId of object.childIds) {
    const child = document.objects.get(childId);
    if (child) {
      const childLocalMatrix = matrixFromTransform(child.transform);
      const nextChildLocalMatrix = relMatrix.clone().multiply(childLocalMatrix);
      child.transform = matrixToTransform(nextChildLocalMatrix);
    }
  }

  document.dirty = true;
}

/**
 * Calculate the world-space bounding box of an object geometry.
 */
export function getObjectWorldBounds(
  document: ModelDocument,
  objectId: ObjectId,
): ObjectBounds | null {
  const object = document.objects.get(objectId);
  if (!object) return null;

  const worldMatrix = getObjectWorldMatrix(document, objectId);
  const mesh = object.meshId ? document.meshes.get(object.meshId) : null;

  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;

  if (mesh && mesh.vertices.size > 0) {
    const p = new Vector3();
    for (const vertex of mesh.vertices.values()) {
      p.set(vertex.position.x, vertex.position.y, vertex.position.z).applyMatrix4(worldMatrix);
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      minZ = Math.min(minZ, p.z);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
      maxZ = Math.max(maxZ, p.z);
    }
  } else {
    // Empty / container / light fallback: use object origin
    const origin = getObjectOrigin(document, objectId);
    minX = maxX = origin.x;
    minY = maxY = origin.y;
    minZ = maxZ = origin.z;
  }

  return {
    min: v3(minX, minY, minZ),
    max: v3(maxX, maxY, maxZ),
    center: v3((minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2),
    size: v3(Math.max(0, maxX - minX), Math.max(0, maxY - minY), Math.max(0, maxZ - minZ)),
  };
}

/** Move the object origin to the center of its geometry bounding box. */
export function centerObjectOrigin(document: ModelDocument, objectId: ObjectId): void {
  const bounds = getObjectWorldBounds(document, objectId);
  if (!bounds) return;
  setObjectOrigin(document, objectId, bounds.center);
}

/** Move the object origin to the bottom-center of its geometry bounding box. */
export function setObjectOriginToBase(document: ModelDocument, objectId: ObjectId): void {
  const bounds = getObjectWorldBounds(document, objectId);
  if (!bounds) return;
  setObjectOrigin(document, objectId, v3(bounds.center.x, bounds.min.y, bounds.center.z));
}

/** Move the object origin to the top-center of its geometry bounding box. */
export function setObjectOriginToTop(document: ModelDocument, objectId: ObjectId): void {
  const bounds = getObjectWorldBounds(document, objectId);
  if (!bounds) return;
  setObjectOrigin(document, objectId, v3(bounds.center.x, bounds.max.y, bounds.center.z));
}

/** Move the object origin to the scene/world origin (0, 0, 0). */
export function setObjectOriginToScene(document: ModelDocument, objectId: ObjectId): void {
  setObjectOrigin(document, objectId, v3(0, 0, 0));
}
