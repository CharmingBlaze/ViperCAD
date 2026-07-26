import { LineBasicMaterial, type Scene } from 'three';
import type { EditorSession } from '@/core/editor/EditorSession';
import { getObjectWorldMatrix } from '@/core/editor/Hierarchy';
import type { MaterialAsset } from '@/core/document/types';
import type { EditableMesh } from '@/core/mesh/types';
import { v3 } from '@/core/math/Vec3';
import {
  applyMeshEvaluation,
  createObjectRenderHandle,
  updateObjectRenderHandle,
  type ObjectRenderHandle,
} from '@/renderer/MeshRenderAdapter';
import { evaluateMeshAsync } from '@/renderer/workers/MeshEvaluationWorkerClient';

type Options = {
  handles: Map<string, ObjectRenderHandle>;
  getSession: () => EditorSession | null;
  isAttached: () => boolean;
  onApplied: () => void;
};

/** Maintains document objects as render handles and owns asynchronous mesh evaluation. */
export class ViewportSceneSynchronizer {
  private pending = new Map<string, string>();
  private readonly options: Options;

  constructor(options: Options) {
    this.options = options;
  }

  reset(): void {
    this.pending.clear();
  }

  /** Update only object matrices during object-mode transforms. */
  syncTransforms(): void {
    const session = this.options.getSession();
    if (!this.options.isAttached() || !session) return;
    for (const [objectId, handle] of this.options.handles) {
      if (!session.document.objects.has(objectId)) continue;
      const world = getObjectWorldMatrix(session.document, objectId);
      handle.group.matrixAutoUpdate = false;
      handle.group.matrix.copy(world);
      handle.group.updateMatrixWorld(true);
    }
  }

  sync(scene: Scene): void {
    const session = this.options.getSession();
    if (!this.options.isAttached() || !session) return;
    const liveIds = new Set<string>();
    for (const object of session.document.objects.values()) {
      if (!object.meshId || !object.visible) continue;
      const mesh = session.document.meshes.get(object.meshId);
      if (!mesh) continue;
      liveIds.add(object.id);
      const materials = object.materialSlotIds
        .map((id) => session.document.materials.get(id))
        .filter(Boolean) as MaterialAsset[];
      const resolvedMaterials = materials.length ? materials : [defaultMaterial(session)];
      let handle = this.options.handles.get(object.id);
      if (!handle) {
        handle = createObjectRenderHandle(object.id, mesh, resolvedMaterials, {
          textures: session.document.textures,
          images: session.document.images,
        });
        this.options.handles.set(object.id, handle);
        scene.add(handle.group);
      } else {
        updateObjectRenderHandle(
          handle,
          mesh,
          resolvedMaterials,
          { textures: session.document.textures, images: session.document.images },
          (targetHandle, targetMesh) => this.schedule(targetHandle, targetMesh),
        );
      }
      const world = getObjectWorldMatrix(session.document, object.id);
      handle.group.matrixAutoUpdate = false;
      handle.group.matrix.copy(world);
      handle.group.updateMatrixWorld(true);
    }
    for (const [id, handle] of this.options.handles) {
      if (liveIds.has(id)) continue;
      scene.remove(handle.group);
      handle.renderData.geometry.dispose();
      handle.edgeOverlay.geometry.dispose();
      (handle.edgeOverlay.material as LineBasicMaterial).dispose();
      for (const material of handle.materials) material.dispose();
      this.options.handles.delete(id);
      this.pending.delete(id);
    }
  }

  private schedule(handle: ObjectRenderHandle, mesh: EditableMesh): void {
    const token = `${mesh.id}:${mesh.topologyVersion}:${mesh.geometryVersion}`;
    if (this.pending.get(handle.objectId) === token) return;
    this.pending.set(handle.objectId, token);
    void evaluateMeshAsync(mesh).then((result) => {
      const session = this.options.getSession();
      if (!this.options.isAttached() || !session || this.pending.get(handle.objectId) !== token) return;
      const currentHandle = this.options.handles.get(handle.objectId);
      const currentMesh = session.document.meshes.get(mesh.id);
      if (!currentHandle || currentHandle !== handle || !currentMesh) return;
      if (currentMesh.topologyVersion !== result.topologyVersion || currentMesh.geometryVersion !== result.geometryVersion) return;
      applyMeshEvaluation(handle, result, currentMesh);
      this.pending.delete(handle.objectId);
      this.options.onApplied();
    }).catch(() => {
      this.pending.delete(handle.objectId);
      const currentMesh = this.options.getSession()?.document.meshes.get(mesh.id);
      if (currentMesh) updateObjectRenderHandle(handle, currentMesh);
      this.options.onApplied();
    });
  }
}

function defaultMaterial(session: EditorSession): MaterialAsset {
  return [...session.document.materials.values()][0] ?? {
    id: 'mat_fallback', name: 'Default', shadingModel: 'lit',
    baseColour: v3(0.72, 0.74, 0.78), baseColourTextureId: null,
    normalTextureId: null, roughness: 0.55, roughnessTextureId: null,
    metallic: 0, metallicTextureId: null, emissive: v3(0, 0, 0),
    emissiveTextureId: null, opacity: 1, alphaMode: 'opaque', alphaCutoff: 0.5,
    doubleSided: false, unlit: false, flatShaded: true,
    textureFiltering: 'nearest', textureWrapping: 'repeat', uvLayerIndex: 0,
  };
}
