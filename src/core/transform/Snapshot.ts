import type { ModelDocument } from '@/core/document/types';
import { topmostObjectIds } from '@/core/editor/Hierarchy';
import { cloneTransform } from '@/core/math/Transform';
import { cloneVec3 } from '@/core/math/Vec3';
import { bumpPositions } from '@/core/mesh/EditableMesh';
import type { SelectionState } from '@/core/selection/SelectionManager';
import { cloneSelectionIds, gatherTargetVertexIds } from './Targets';
import type { TransformSnapshot } from './types';

export function captureSnapshot(doc: ModelDocument, selection: SelectionState): TransformSnapshot {
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

  return {
    mode,
    objects,
    vertices,
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
  return { mode: before.mode, objects, vertices, selection: before.selection };
}
