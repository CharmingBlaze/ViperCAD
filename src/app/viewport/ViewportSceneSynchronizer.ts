import { LineBasicMaterial, type Matrix4, type Scene } from 'three';
import type { EditorSession } from '@/core/editor/EditorSession';
import { getObjectWorldMatrix } from '@/core/editor/Hierarchy';
import { isObjectInFocusScope } from '@/core/editor/GroupFocus';
import {
  collectInstanceRenderParts,
  isInstanceObject,
} from '@/core/editor/ModelInstances';
import type { MaterialAsset, MaterialId, ObjectId } from '@/core/document/types';
import type { EditableMesh, MeshId } from '@/core/mesh/types';
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

    for (const [handleKey, handle] of this.options.handles) {
      const object = session.document.objects.get(handle.objectId);
      if (!object) continue;

      let world: Matrix4 | undefined;
      if (isInstanceObject(object)) {
        world = collectInstanceRenderParts(session.project, session.documentId, object)
          .find((part) => part.handleKey === handleKey)?.worldMatrix;
      } else if (session.document.objects.has(handleKey)) {
        world = getObjectWorldMatrix(session.document, handleKey);
      }
      if (!world) continue;

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
      if (isInstanceObject(object)) {
        for (const part of collectInstanceRenderParts(session.project, session.documentId, object)) {
          this.syncHandle(
            session,
            scene,
            part.handleKey,
            part.meshId,
            part.materialSlotIds,
            part.worldMatrix,
            object.id,
            liveIds,
          );
        }
        continue;
      }
      if (!object.meshId || !object.visible) continue;
      this.syncHandle(
        session,
        scene,
        object.id,
        object.meshId,
        object.materialSlotIds,
        getObjectWorldMatrix(session.document, object.id),
        object.id,
        liveIds,
      );
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

  private syncHandle(
    session: EditorSession,
    scene: Scene,
    handleKey: string,
    meshId: MeshId,
    materialSlotIds: MaterialId[],
    worldMatrix: Matrix4,
    pickObjectId: ObjectId,
    liveIds: Set<string>,
  ): void {
    const mesh = session.document.meshes.get(meshId);
    if (!mesh) return;

    liveIds.add(handleKey);
    const materials = materialSlotIds
      .map((id) => session.document.materials.get(id))
      .filter(Boolean) as MaterialAsset[];
    const resolvedMaterials = materials.length ? materials : [defaultMaterial(session)];

    let handle = this.options.handles.get(handleKey);
    if (!handle) {
      handle = createObjectRenderHandle(pickObjectId, mesh, resolvedMaterials, {
        textures: session.document.textures,
        images: session.document.images,
      });
      handle.group.name = handleKey;
      this.options.handles.set(handleKey, handle);
      scene.add(handle.group);
    } else {
      updateObjectRenderHandle(
        handle,
        mesh,
        resolvedMaterials,
        { textures: session.document.textures, images: session.document.images },
        (targetHandle, targetMesh) => this.schedule(handleKey, targetHandle, targetMesh),
      );
    }

    handle.group.matrixAutoUpdate = false;
    handle.group.matrix.copy(worldMatrix);
    handle.group.updateMatrixWorld(true);

    const inFocus = isObjectInFocusScope(session.document, pickObjectId, session.focusGroupId);
    const ghosted = session.focusGroupId !== null && !inFocus;
    for (const material of handle.materials) {
      if (material.userData.viperBaseOpacity === undefined) {
        material.userData.viperBaseOpacity = material.opacity;
      }
      const base = material.userData.viperBaseOpacity as number;
      if (ghosted) {
        material.transparent = true;
        material.opacity = Math.min(base, 0.25);
        material.depthWrite = false;
      } else {
        material.opacity = base;
      }
    }
    if (ghosted) {
      handle.edgeOverlay.visible = false;
    }
  }

  private schedule(handleKey: string, handle: ObjectRenderHandle, mesh: EditableMesh): void {
    const token = `${mesh.id}:${mesh.topologyVersion}:${mesh.geometryVersion}`;
    if (this.pending.get(handleKey) === token) return;
    this.pending.set(handleKey, token);
    void evaluateMeshAsync(mesh).then((result) => {
      const session = this.options.getSession();
      if (!this.options.isAttached() || !session || this.pending.get(handleKey) !== token) return;
      const currentHandle = this.options.handles.get(handleKey);
      const currentMesh = session.document.meshes.get(mesh.id);
      if (!currentHandle || currentHandle !== handle || !currentMesh) return;
      if (currentMesh.topologyVersion !== result.topologyVersion || currentMesh.geometryVersion !== result.geometryVersion) return;
      applyMeshEvaluation(handle, result, currentMesh);
      this.pending.delete(handleKey);
      this.options.onApplied();
    }).catch(() => {
      this.pending.delete(handleKey);
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
