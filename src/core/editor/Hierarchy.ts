import {
  addObjectToDocument,
  createSceneObject,
} from '@/core/document/ModelDocument';
import type { ModelDocument, ObjectId, SceneObject } from '@/core/document/types';
import { cloneTransform, type Transform } from '@/core/math/Transform';
import { createId } from '@/core/ids/IdService';
import { cloneMeshPreserveIds } from '@/core/mesh/EditableMesh';
import type { MeshId } from '@/core/mesh/types';
import { Euler, Matrix4, Quaternion, Vector3 } from 'three';
import { v3 } from '@/core/math/Vec3';

/** Empty container (prefab group) — no mesh, used as a hierarchy parent. */
export function isGroupObject(object: SceneObject | null | undefined): boolean {
  if (!object) return false;
  return !object.meshId && (object.childIds.length > 0 || object.metadata.prefab === 'true');
}

/** Nearest group ancestor, or null if the object is not inside a group. */
export function findGroupAncestor(document: ModelDocument, objectId: ObjectId): ObjectId | null {
  let parentId = document.objects.get(objectId)?.parentId ?? null;
  while (parentId) {
    const parent = document.objects.get(parentId);
    if (!parent) return null;
    if (isGroupObject(parent)) return parentId;
    parentId = parent.parentId;
  }
  return null;
}

/** Outermost group ancestor (top of the group chain), or null. */
export function findOutermostGroupAncestor(document: ModelDocument, objectId: ObjectId): ObjectId | null {
  let found: ObjectId | null = null;
  let parentId = document.objects.get(objectId)?.parentId ?? null;
  while (parentId) {
    const parent = document.objects.get(parentId);
    if (!parent) break;
    if (isGroupObject(parent)) found = parentId;
    parentId = parent.parentId;
  }
  return found;
}

/** Expand selection ids so group containers include every descendant mesh id (for outlines / marquee). */
export function expandGroupsToDescendants(document: ModelDocument, ids: Iterable<ObjectId>): ObjectId[] {
  const out = new Set<ObjectId>();
  for (const id of ids) {
    const object = document.objects.get(id);
    if (!object) continue;
    if (isGroupObject(object)) {
      for (const desc of collectDescendantIds(document, id)) {
        if (document.objects.get(desc)?.meshId) out.add(desc);
      }
    } else if (object.meshId) {
      out.add(id);
    }
  }
  return [...out];
}

/** Roots among `ids` whose ancestors are not also in `ids` (for group / copy / transform). */
export function topmostObjectIds(document: ModelDocument, ids: Iterable<ObjectId>): ObjectId[] {
  const selected = new Set(ids);
  const result: ObjectId[] = [];
  for (const id of selected) {
    const object = document.objects.get(id);
    if (!object) continue;
    let parentId = object.parentId;
    let nested = false;
    while (parentId) {
      if (selected.has(parentId)) {
        nested = true;
        break;
      }
      parentId = document.objects.get(parentId)?.parentId ?? null;
    }
    if (!nested) result.push(id);
  }
  return result;
}

export function collectDescendantIds(document: ModelDocument, rootId: ObjectId): ObjectId[] {
  const root = document.objects.get(rootId);
  if (!root) return [];
  const out: ObjectId[] = [];
  const walk = (id: ObjectId) => {
    out.push(id);
    const object = document.objects.get(id);
    if (!object) return;
    for (const childId of object.childIds) walk(childId);
  };
  walk(rootId);
  return out;
}

export function getObjectWorldMatrix(document: ModelDocument, objectId: ObjectId): Matrix4 {
  const object = document.objects.get(objectId);
  if (!object) return new Matrix4();
  const local = matrixFromTransform(object.transform);
  if (!object.parentId) return local;
  return getObjectWorldMatrix(document, object.parentId).multiply(local);
}

export function getObjectWorldTransform(document: ModelDocument, objectId: ObjectId): Transform {
  return matrixToTransform(getObjectWorldMatrix(document, objectId));
}

/**
 * Reparent an object while preserving its world transform.
 * `newParentId = null` moves it to the document root list.
 */
export function reparentObject(
  document: ModelDocument,
  objectId: ObjectId,
  newParentId: ObjectId | null,
  index?: number,
): boolean {
  const object = document.objects.get(objectId);
  if (!object) return false;
  if (newParentId === objectId) return false;
  if (newParentId) {
    const parent = document.objects.get(newParentId);
    if (!parent) return false;
    // Reject cycles.
    let walk: ObjectId | null = newParentId;
    while (walk) {
      if (walk === objectId) return false;
      walk = document.objects.get(walk)?.parentId ?? null;
    }
  }
  if (object.parentId === newParentId) {
    if (newParentId) {
      const parent = document.objects.get(newParentId)!;
      const without = parent.childIds.filter((id) => id !== objectId);
      const at = index === undefined ? without.length : Math.max(0, Math.min(index, without.length));
      without.splice(at, 0, objectId);
      parent.childIds = without;
    } else {
      const without = document.rootObjectIds.filter((id) => id !== objectId);
      const at = index === undefined ? without.length : Math.max(0, Math.min(index, without.length));
      without.splice(at, 0, objectId);
      document.rootObjectIds = without;
    }
    document.dirty = true;
    return true;
  }

  const world = getObjectWorldMatrix(document, objectId);
  if (object.parentId) {
    const parent = document.objects.get(object.parentId);
    if (parent) parent.childIds = parent.childIds.filter((id) => id !== objectId);
  } else {
    document.rootObjectIds = document.rootObjectIds.filter((id) => id !== objectId);
  }

  object.parentId = newParentId;
  if (newParentId) {
    const parent = document.objects.get(newParentId)!;
    const inverse = getObjectWorldMatrix(document, newParentId).invert();
    object.transform = matrixToTransform(inverse.multiply(world));
    const at = index === undefined ? parent.childIds.length : Math.max(0, Math.min(index, parent.childIds.length));
    parent.childIds.splice(at, 0, objectId);
  } else {
    object.transform = matrixToTransform(world);
    const at = index === undefined
      ? document.rootObjectIds.length
      : Math.max(0, Math.min(index, document.rootObjectIds.length));
    document.rootObjectIds.splice(at, 0, objectId);
  }
  document.dirty = true;
  return true;
}

/** Deep-duplicate an object and all descendants; keeps the same parent as the source. */
export function duplicateObjectSubtree(
  document: ModelDocument,
  objectId: ObjectId,
  uniqueMesh = true,
): ObjectId {
  const src = document.objects.get(objectId);
  if (!src) throw new Error(`Object ${objectId} not found`);

  const idMap = new Map<ObjectId, ObjectId>();

  const cloneNode = (sourceId: ObjectId, parentId: ObjectId | null): ObjectId => {
    const source = document.objects.get(sourceId)!;
    let meshId: MeshId | null = source.meshId;
    if (uniqueMesh && source.meshId) {
      const srcMesh = document.meshes.get(source.meshId);
      if (srcMesh) {
        const clone = cloneMeshPreserveIds(srcMesh);
        clone.id = createId('mesh');
        clone.name = `${srcMesh.name}_copy`;
        document.meshes.set(clone.id, clone);
        meshId = clone.id;
      }
    }
    const copy = createSceneObject(`${source.name}_copy`, meshId, [...source.materialSlotIds]);
    copy.transform = cloneTransform(source.transform);
    copy.visible = source.visible;
    copy.locked = source.locked;
    copy.metadata = { ...source.metadata };
    copy.parentId = parentId;
    addObjectToDocument(document, copy);
    idMap.set(sourceId, copy.id);
    for (const childId of source.childIds) {
      cloneNode(childId, copy.id);
    }
    return copy.id;
  };

  const newRootId = cloneNode(objectId, src.parentId);
  // Offset only the duplicated root so the copy is visible beside the original.
  const copy = document.objects.get(newRootId)!;
  copy.transform.position.x += 0.5;
  document.dirty = true;
  return newRootId;
}

export function matrixFromTransform(transform: Transform): Matrix4 {
  const quaternion = new Quaternion().setFromEuler(
    new Euler(transform.rotation.x, transform.rotation.y, transform.rotation.z, 'XYZ'),
  );
  return new Matrix4().compose(
    new Vector3(transform.position.x, transform.position.y, transform.position.z),
    quaternion,
    new Vector3(transform.scale.x, transform.scale.y, transform.scale.z),
  );
}

export function matrixToTransform(matrix: Matrix4): Transform {
  const position = new Vector3();
  const quaternion = new Quaternion();
  const scale = new Vector3();
  matrix.decompose(position, quaternion, scale);
  const rotation = new Euler().setFromQuaternion(quaternion, 'XYZ');
  return {
    position: v3(position.x, position.y, position.z),
    rotation: v3(rotation.x, rotation.y, rotation.z),
    scale: v3(scale.x, scale.y, scale.z),
  };
}
