import { Scene } from 'three';
import type { EditorSession } from '@/core/editor/EditorSession';
import { getObjectWorldMatrix } from '@/core/editor/Hierarchy';
import type { ModelDocument } from '@/core/document/types';
import { getActiveClip, getSkinBindingsForRig, readRigDocumentSettings } from '@/core/rig/RigDocument';
import { findPrimaryRigForModel } from '@/core/rig/RigLookup';
import { disposeRigMeshMaterials, resolveObjectMaterials } from '@/core/rig/rigMeshDisplay';
import { skinBindingSignature } from '@/core/rig/skinning';
import {
  buildSkinnedMesh,
  updateSkinnedMeshPose,
  type RigSkinnedMesh,
} from '@/core/rig/SkinnedMeshBuilder';

type PreviewEntry = {
  rigMesh: RigSkinnedMesh;
  bindingId: string;
  signature: string;
};

function disposePreviewMesh(rigMesh: RigSkinnedMesh): void {
  rigMesh.mesh.geometry.dispose();
  disposeRigMeshMaterials(rigMesh);
}

/** Renders posed skinned meshes in ViperCAD when viewing a model linked to a rig. */
export class RigPreviewSynchronizer {
  private entries = new Map<string, PreviewEntry>();
  private previewTime = 0;
  private enabled = true;

  setEnabled(value: boolean): void {
    this.enabled = value;
  }

  setPreviewTime(time: number): void {
    this.previewTime = time;
  }

  reset(): void {
    for (const entry of this.entries.values()) disposePreviewMesh(entry.rigMesh);
    this.entries.clear();
  }

  sync(scene: Scene, session: EditorSession): void {
    if (!this.enabled || session.document.kind !== 'model') {
      this.removeFromScene(scene);
      return;
    }

    const rigDoc = findPrimaryRigForModel(session.project, session.documentId);
    if (!rigDoc) {
      this.removeFromScene(scene);
      return;
    }

    const settings = readRigDocumentSettings(rigDoc);
    const armature = settings.armatureId ? session.project.armatures.get(settings.armatureId) : null;
    if (!armature) {
      this.removeFromScene(scene);
      return;
    }

    const bindings = getSkinBindingsForRig(session.project, rigDoc);
    if (!bindings.length) {
      this.removeFromScene(scene);
      return;
    }

    const clip = getActiveClip(session.project, rigDoc);
    const live = new Set<string>();
    const modelDoc = session.document as ModelDocument;

    for (const binding of bindings) {
      live.add(binding.id);
      const mesh = session.project.meshes.get(binding.meshId);
      if (!mesh) continue;

      const signature = skinBindingSignature(binding, armature, mesh);
      const materialContext = resolveObjectMaterials(session.project, modelDoc, binding.objectId);
      let entry = this.entries.get(binding.id);
      if (!entry) {
        const rigMesh = buildSkinnedMesh(mesh, binding, armature, materialContext);
        rigMesh.mesh.userData.rigPreview = true;
        scene.add(rigMesh.mesh);
        entry = { rigMesh, bindingId: binding.id, signature };
        this.entries.set(binding.id, entry);
      } else if (entry.signature !== signature) {
        scene.remove(entry.rigMesh.mesh);
        disposePreviewMesh(entry.rigMesh);
        const rigMesh = buildSkinnedMesh(mesh, binding, armature, materialContext);
        rigMesh.mesh.userData.rigPreview = true;
        scene.add(rigMesh.mesh);
        entry.rigMesh = rigMesh;
        entry.signature = signature;
      }

      updateSkinnedMeshPose(entry.rigMesh, armature, clip, this.previewTime);
      const world = getObjectWorldMatrix(modelDoc, binding.objectId);
      entry.rigMesh.mesh.matrixAutoUpdate = false;
      entry.rigMesh.mesh.matrix.copy(world);
      entry.rigMesh.mesh.updateMatrixWorld(true);
    }

    for (const [id, entry] of this.entries) {
      if (live.has(id)) continue;
      scene.remove(entry.rigMesh.mesh);
      disposePreviewMesh(entry.rigMesh);
      this.entries.delete(id);
    }
  }

  private removeFromScene(scene: Scene): void {
    for (const entry of this.entries.values()) {
      scene.remove(entry.rigMesh.mesh);
      disposePreviewMesh(entry.rigMesh);
    }
    this.entries.clear();
  }
}

export function hideStaticMeshWhenRigPreview(
  session: EditorSession,
  objectId: string,
): boolean {
  if (session.document.kind !== 'model') return false;
  const rigDoc = findPrimaryRigForModel(session.project, session.documentId);
  if (!rigDoc) return false;
  return getSkinBindingsForRig(session.project, rigDoc).some((binding) => binding.objectId === objectId);
}
