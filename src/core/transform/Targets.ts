import type { ModelDocument, ObjectId } from '@/core/document/types';
import { faceVertexIds, getEdgeVertices } from '@/core/mesh/EditableMesh';
import type { EdgeId, FaceId, VertexId } from '@/core/mesh/types';
import type { SelectionState } from '@/core/selection/SelectionManager';
import { expandSymmetryVertexIds } from '@/core/symmetry/Symmetry';

/** Unique logical vertices for the current component selection. */
export function gatherTargetVertexIds(
  doc: ModelDocument,
  selection: SelectionState,
): {
  objectId: ObjectId;
  meshId: string;
  primaryVertexIds: Set<VertexId>;
  vertexIds: Set<VertexId>;
} | null {
  const objectId = selection.activeObjectId;
  if (!objectId) return null;
  const object = doc.objects.get(objectId);
  if (!object?.meshId) return null;
  const mesh = doc.meshes.get(object.meshId);
  if (!mesh) return null;

  const primaryVertexIds = new Set<VertexId>();
  if (selection.mode === 'vertex') {
    for (const id of selection.selectedVertexIds) {
      if (mesh.vertices.has(id)) primaryVertexIds.add(id);
    }
  } else if (selection.mode === 'edge') {
    for (const edgeId of selection.selectedEdgeIds) {
      const pair = getEdgeVertices(mesh, edgeId);
      if (pair) {
        primaryVertexIds.add(pair[0]);
        primaryVertexIds.add(pair[1]);
      }
    }
  } else if (selection.mode === 'face') {
    for (const faceId of selection.selectedFaceIds) {
      for (const id of faceVertexIds(mesh, faceId)) primaryVertexIds.add(id);
    }
  } else {
    return null;
  }

  if (!primaryVertexIds.size) return null;
  const vertexIds = expandSymmetryVertexIds(
    mesh,
    primaryVertexIds,
    doc.settings.symmetry,
  );
  return { objectId, meshId: object.meshId, primaryVertexIds, vertexIds };
}

export function selectionHasTransformTarget(selection: SelectionState): boolean {
  if (selection.mode === 'object') return selection.selectedObjectIds.size > 0;
  if (selection.mode === 'vertex') return selection.selectedVertexIds.size > 0;
  if (selection.mode === 'edge') return selection.selectedEdgeIds.size > 0;
  if (selection.mode === 'face') return selection.selectedFaceIds.size > 0;
  return false;
}

export function cloneSelectionIds(selection: SelectionState) {
  return {
    objectIds: [...selection.selectedObjectIds],
    vertexIds: [...selection.selectedVertexIds] as VertexId[],
    edgeIds: [...selection.selectedEdgeIds] as EdgeId[],
    faceIds: [...selection.selectedFaceIds] as FaceId[],
    activeObjectId: selection.activeObjectId,
    activeVertexId: selection.activeVertexId,
    activeEdgeId: selection.activeEdgeId,
    activeFaceId: selection.activeFaceId,
  };
}
