import { Matrix4, Vector3 } from 'three';
import {
  addMeshToDocument,
  ensureDefaultPlaceholderMaterial,
  removeObject,
} from '@/core/document/ModelDocument';
import type { ModelDocument, ObjectId, SceneObject } from '@/core/document/types';
import { getObjectWorldMatrix } from '@/core/editor/Hierarchy';
import { centreObjectOrigin } from '@/core/editor/GameAssetTools';
import type { CommandHistory } from '@/core/history/CommandHistory';
import { cloneTransform } from '@/core/math/Transform';
import { cloneMeshPreserveIds } from '@/core/mesh/EditableMesh';
import type { EditableMesh } from '@/core/mesh/types';
import type { SelectionManager } from '@/core/selection/SelectionManager';
import { executeSolidBoolean, type BooleanOp } from './ManifoldBridge';

export type SolidBooleanOptions = {
  keepCutters?: boolean;
  name?: string;
};

export type SolidBooleanResult = {
  ok: boolean;
  objectId?: ObjectId;
  message?: string;
};

/**
 * Applies a watertight CAD solid boolean operation (difference, union, intersection)
 * between a target object and one or more cutter objects in the ModelDocument.
 * Records the change in CommandHistory with full undo/redo support.
 */
export async function applySolidBoolean(
  document: ModelDocument,
  history: CommandHistory,
  selection: SelectionManager | undefined,
  targetObjectId: ObjectId,
  cutterObjectIds: ObjectId[],
  operation: BooleanOp,
  options: SolidBooleanOptions = {},
): Promise<SolidBooleanResult> {
  const targetObject = document.objects.get(targetObjectId);
  if (!targetObject || !targetObject.meshId) {
    return { ok: false, message: 'Select a valid target mesh object' };
  }
  const targetMesh = document.meshes.get(targetObject.meshId);
  if (!targetMesh || targetMesh.vertices.size === 0) {
    return { ok: false, message: 'Target mesh is empty' };
  }

  const validCutters: { object: SceneObject; mesh: EditableMesh; matrix: Matrix4 }[] = [];
  for (const cutterId of cutterObjectIds) {
    if (cutterId === targetObjectId) continue;
    const cutterObj = document.objects.get(cutterId);
    if (!cutterObj || !cutterObj.meshId) continue;
    const cutterMesh = document.meshes.get(cutterObj.meshId);
    if (!cutterMesh || cutterMesh.vertices.size === 0) continue;
    validCutters.push({
      object: cutterObj,
      mesh: cutterMesh,
      matrix: getObjectWorldMatrix(document, cutterId),
    });
  }

  if (validCutters.length === 0) {
    return { ok: false, message: 'Select at least one valid cutter/secondary mesh object' };
  }

  const targetMatrix = getObjectWorldMatrix(document, targetObjectId);
  const cutterMeshes = validCutters.map((c) => c.mesh);
  const cutterMatrices = validCutters.map((c) => c.matrix);

  const opName =
    operation === 'difference' ? 'Cut' : operation === 'union' ? 'Union' : 'Intersect';
  const resultName = options.name ?? `${targetObject.name}_${opName}`;

  try {
    const resultMeshWorld = await executeSolidBoolean(
      operation,
      targetMesh,
      cutterMeshes,
      targetMatrix,
      cutterMatrices,
      resultName,
    );

    // Transform resulting mesh vertices back from world space into target's local space
    const invTargetMatrix = targetMatrix.clone().invert();
    for (const vertex of resultMeshWorld.vertices.values()) {
      const p = new Vector3(vertex.position.x, vertex.position.y, vertex.position.z).applyMatrix4(
        invTargetMatrix,
      );
      vertex.position.x = p.x;
      vertex.position.y = p.y;
      vertex.position.z = p.z;
    }

    // Material slot setup
    const materialIds = [...targetObject.materialSlotIds];
    for (const cutter of validCutters) {
      for (const matId of cutter.object.materialSlotIds) {
        if (!materialIds.includes(matId)) materialIds.push(matId);
      }
    }
    if (!materialIds.length) {
      const defaultMat = ensureDefaultPlaceholderMaterial(document);
      materialIds.push(defaultMat);
    }
    resultMeshWorld.materialSlotCount = materialIds.length;

    // Snapshot state for undo/redo
    const originalTargetMeshId = targetObject.meshId;
    const originalTargetMesh = cloneMeshPreserveIds(targetMesh);
    const originalTargetSlots = [...targetObject.materialSlotIds];
    const originalTargetTransform = cloneTransform(targetObject.transform);

    // Cutters to remove if not keepCutters
    const removeCutters = !options.keepCutters;
    const cutterSnapshots: {
      object: SceneObject;
      mesh: EditableMesh;
    }[] = validCutters.map((c) => ({
      object: JSON.parse(JSON.stringify(c.object)),
      mesh: cloneMeshPreserveIds(c.mesh),
    }));

    const newMeshId = addMeshToDocument(document, resultMeshWorld);

    const executeOp = () => {
      targetObject.meshId = newMeshId;
      targetObject.materialSlotIds = materialIds;
      if (removeCutters) {
        for (const c of validCutters) {
          removeObject(document, c.object.id, true);
        }
      }
      centreObjectOrigin(document, targetObject.id);
      if (selection) {
        selection.selectObjects([targetObject.id], 'replace');
      }
      document.dirty = true;
    };

    const undoOp = () => {
      targetObject.meshId = originalTargetMeshId;
      targetObject.materialSlotIds = originalTargetSlots;
      targetObject.transform = cloneTransform(originalTargetTransform);
      document.meshes.set(originalTargetMeshId, originalTargetMesh);

      if (removeCutters) {
        for (const snap of cutterSnapshots) {
          document.objects.set(snap.object.id, snap.object);
          document.meshes.set(snap.mesh.id, snap.mesh);
          if (!snap.object.parentId && !document.rootObjectIds.includes(snap.object.id)) {
            document.rootObjectIds.push(snap.object.id);
          }
        }
      }
      if (selection) {
        selection.selectObjects([targetObject.id], 'replace');
      }
      document.dirty = true;
    };

    history.execute({
      name: `Solid ${opName}: ${targetObject.name}`,
      execute: executeOp,
      undo: undoOp,
    });

    return { ok: true, objectId: targetObject.id };
  } catch (error: any) {
    return { ok: false, message: error?.message || 'Solid boolean operation failed' };
  }
}
