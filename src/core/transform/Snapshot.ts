import type { ModelDocument } from '@/core/document/types';
import { topmostObjectIds } from '@/core/editor/Hierarchy';
import { cloneTransform } from '@/core/math/Transform';
import { cloneVec3, type Vec3 } from '@/core/math/Vec3';
import { bumpPositions } from '@/core/mesh/EditableMesh';
import type { SelectionState } from '@/core/selection/SelectionManager';
import { cloneSelectionIds, gatherTargetVertexIds } from './Targets';
import type { TransformSnapshot } from './types';

export function captureSnapshot(
  doc: ModelDocument,
  selection: SelectionState,
  includeObjectVertices = false,
): TransformSnapshot {
  const mode = selection.mode === 'object' ? 'object' : selection.mode;
  const objectIds =
    selection.mode === 'object'
      ? topmostObjectIds(doc, selection.selectedObjectIds)
      : selection.activeObjectId
        ? [selection.activeObjectId]
        : [];
  const objects = objectIds
    .map((objectId) => {
      const object = doc.objects.get(objectId);
      if (!object) return null;
      return { objectId, transform: cloneTransform(object.transform) };
    })
    .filter((entry): entry is NonNullable<typeof entry> => !!entry);

  let vertices: TransformSnapshot['vertices'] = null;
  if (selection.mode !== 'object') {
    const target = gatherTargetVertexIds(doc, selection);
    if (target) {
      const mesh = doc.meshes.get(target.meshId)!;
      const positions = new Map(
        [...target.vertexIds].map((id) => [id, cloneVec3(mesh.vertices.get(id)!.position)] as const),
      );
      vertices = {
        objectId: target.objectId,
        meshId: target.meshId,
        primaryVertexIds: new Set(target.primaryVertexIds),
        positions,
      };
    }
  }

  let objectMeshes: TransformSnapshot['objectMeshes'] = null;
  if (includeObjectVertices) {
    objectMeshes = new Map();
    for (const entry of objects) {
      const obj = doc.objects.get(entry.objectId);
      if (obj?.meshId) {
        const mesh = doc.meshes.get(obj.meshId);
        if (mesh) {
          const map = new Map<string, Vec3>();
          for (const [vId, vertex] of mesh.vertices) {
            map.set(vId, cloneVec3(vertex.position));
          }
          objectMeshes.set(obj.meshId, map);
        }
      }
    }
  }

  return {
    mode,
    objects,
    vertices,
    objectMeshes,
    selection: cloneSelectionIds(selection),
  };
}

export function restoreSnapshot(doc: ModelDocument, snapshot: TransformSnapshot): void {
  for (const entry of snapshot.objects) {
    const object = doc.objects.get(entry.objectId);
    if (object) object.transform = cloneTransform(entry.transform);
  }
  if (snapshot.vertices) {
    const mesh = doc.meshes.get(snapshot.vertices.meshId);
    if (mesh) {
      for (const [id, pos] of snapshot.vertices.positions) {
        const v = mesh.vertices.get(id);
        if (v) v.position = cloneVec3(pos);
      }
      bumpPositions(mesh);
    }
  }
  if (snapshot.objectMeshes) {
    for (const [meshId, positions] of snapshot.objectMeshes) {
      const mesh = doc.meshes.get(meshId);
      if (mesh) {
        for (const [id, pos] of positions) {
          const v = mesh.vertices.get(id);
          if (v) v.position = cloneVec3(pos);
        }
        bumpPositions(mesh);
      }
    }
  }
  doc.dirty = true;
}

export function captureAfterSnapshot(doc: ModelDocument, before: TransformSnapshot): TransformSnapshot {
  const objects = before.objects.map((entry) => {
    const object = doc.objects.get(entry.objectId)!;
    return { objectId: entry.objectId, transform: cloneTransform(object.transform) };
  });
  let vertices: TransformSnapshot['vertices'] = null;
  if (before.vertices) {
    const mesh = doc.meshes.get(before.vertices.meshId)!;
    const positions = new Map(
      [...before.vertices.positions.keys()].map(
        (id) => [id, cloneVec3(mesh.vertices.get(id)!.position)] as const,
      ),
    );
    vertices = {
      objectId: before.vertices.objectId,
      meshId: before.vertices.meshId,
      primaryVertexIds: new Set(before.vertices.primaryVertexIds),
      positions,
    };
  }
  let objectMeshes: TransformSnapshot['objectMeshes'] = null;
  if (before.objectMeshes) {
    objectMeshes = new Map();
    for (const [meshId, positions] of before.objectMeshes) {
      const mesh = doc.meshes.get(meshId);
      if (mesh) {
        const map = new Map<string, Vec3>();
        for (const id of positions.keys()) {
          const v = mesh.vertices.get(id);
          if (v) map.set(id, cloneVec3(v.position));
        }
        objectMeshes.set(meshId, map);
      }
    }
  }
  return { mode: before.mode, objects, vertices, objectMeshes, selection: before.selection };
}
