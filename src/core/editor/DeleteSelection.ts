import { removeObject } from '@/core/document/ModelDocument';
import type { ModelDocument, ObjectId, SceneObject } from '@/core/document/types';
import type { CommandHistory } from '@/core/history/CommandHistory';
import { runMeshTransaction } from '@/core/history/Transaction';
import { cloneMeshPreserveIds } from '@/core/mesh/EditableMesh';
import type { EditableMesh, MeshId } from '@/core/mesh/types';
import { deleteMeshSelection, hasDeletableSelection } from '@/core/mesh/ops/draw';
import { cloneSelection, type SelectionManager } from '@/core/selection/SelectionManager';
import {
  expandSymmetryEdgeIds,
  expandSymmetryFaceIds,
  expandSymmetryVertexIds,
} from '@/core/symmetry/Symmetry';

type DeleteSession = {
  document: ModelDocument;
  selection: SelectionManager;
  history: CommandHistory;
  requestRedraw: () => void;
};

/** Delete the current selection (objects or mesh components) with undo. */
export function commitDeleteSelection(session: DeleteSession): boolean {
  if (!hasDeletableSelection(session.document, session.selection)) return false;

  if (session.selection.state.mode === 'object') {
    return deleteObjects(session);
  }

  const objectId =
    session.selection.state.activeObjectId ??
    [...session.selection.state.selectedObjectIds][0] ??
    null;
  if (!objectId) return false;
  const meshId = session.document.objects.get(objectId)?.meshId;
  if (!meshId) return false;
  const mesh = session.document.meshes.get(meshId);
  if (!mesh) return false;

  const tx = runMeshTransaction(
    session.history,
    mesh,
    'Delete',
    (m) => {
      const state = session.selection.state;
      const originalVertices = state.selectedVertexIds;
      const originalEdges = state.selectedEdgeIds;
      const originalFaces = state.selectedFaceIds;
      state.selectedVertexIds = expandSymmetryVertexIds(
        m,
        originalVertices,
        session.document.settings.symmetry,
      );
      state.selectedEdgeIds = expandSymmetryEdgeIds(
        m,
        originalEdges,
        session.document.settings.symmetry,
      );
      state.selectedFaceIds = expandSymmetryFaceIds(
        m,
        originalFaces,
        session.document.settings.symmetry,
      );
      let result;
      try {
        result = deleteMeshSelection(m, session.selection);
      } finally {
        state.selectedVertexIds = originalVertices;
        state.selectedEdgeIds = originalEdges;
        state.selectedFaceIds = originalFaces;
      }
      if (!result.ok) throw new Error(result.error?.message ?? 'Delete failed');
      session.selection.applyTopologyChange(result.change);
      return result;
    },
    { fullValidation: true, selection: session.selection },
  );
  if (!tx.ok) {
    console.error(tx.error);
    return false;
  }
  session.requestRedraw();
  return true;
}

function deleteObjects(session: DeleteSession): boolean {
  const ids = [...session.selection.state.selectedObjectIds];
  if (!ids.length) return false;

  const beforeSelection = cloneSelection(session.selection.state);
  type Snapshot = {
    object: SceneObject;
    mesh: EditableMesh | null;
    meshId: MeshId | null;
    rootIndex: number;
    parentId: ObjectId | null;
    parentChildIndex: number;
  };
  const snapshots: Snapshot[] = [];

  for (const id of ids) {
    const object = session.document.objects.get(id);
    if (!object) continue;
    const mesh = object.meshId ? session.document.meshes.get(object.meshId) ?? null : null;
    const rootIndex = session.document.rootObjectIds.indexOf(id);
    let parentChildIndex = -1;
    if (object.parentId) {
      const parent = session.document.objects.get(object.parentId);
      parentChildIndex = parent ? parent.childIds.indexOf(id) : -1;
    }
    snapshots.push({
      object: {
        ...object,
        childIds: [...object.childIds],
        materialSlotIds: [...object.materialSlotIds],
        transform: {
          position: { ...object.transform.position },
          rotation: { ...object.transform.rotation },
          scale: { ...object.transform.scale },
        },
        metadata: { ...object.metadata },
      },
      mesh: mesh ? cloneMeshPreserveIds(mesh) : null,
      meshId: object.meshId,
      rootIndex,
      parentId: object.parentId,
      parentChildIndex,
    });
  }

  if (!snapshots.length) return false;

  for (const id of ids) removeObject(session.document, id, true);
  session.selection.selectObjects([], 'replace');
  const afterSelection = cloneSelection(session.selection.state);
  let applied = true;

  session.history.execute({
    name: ids.length === 1 ? 'Delete Object' : 'Delete Objects',
    execute: () => {
      if (applied) return;
      for (const snap of snapshots) removeObject(session.document, snap.object.id, true);
      session.selection.state = cloneSelection(afterSelection);
      session.document.dirty = true;
      applied = true;
    },
    undo: () => {
      for (const snap of snapshots) {
        if (snap.mesh && snap.meshId) {
          session.document.meshes.set(snap.meshId, cloneMeshPreserveIds(snap.mesh));
        }
        session.document.objects.set(snap.object.id, {
          ...snap.object,
          childIds: [...snap.object.childIds],
          materialSlotIds: [...snap.object.materialSlotIds],
          transform: {
            position: { ...snap.object.transform.position },
            rotation: { ...snap.object.transform.rotation },
            scale: { ...snap.object.transform.scale },
          },
          metadata: { ...snap.object.metadata },
        });
        if (snap.parentId) {
          const parent = session.document.objects.get(snap.parentId);
          if (parent && !parent.childIds.includes(snap.object.id)) {
            if (snap.parentChildIndex >= 0) {
              parent.childIds.splice(snap.parentChildIndex, 0, snap.object.id);
            } else {
              parent.childIds.push(snap.object.id);
            }
          }
        } else if (!session.document.rootObjectIds.includes(snap.object.id)) {
          if (snap.rootIndex >= 0) {
            session.document.rootObjectIds.splice(snap.rootIndex, 0, snap.object.id);
          } else {
            session.document.rootObjectIds.push(snap.object.id);
          }
        }
      }
      session.selection.state = cloneSelection(beforeSelection);
      session.document.dirty = true;
      applied = false;
    },
  });

  session.requestRedraw();
  return true;
}
