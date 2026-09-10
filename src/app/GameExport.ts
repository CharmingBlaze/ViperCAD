import {
  AnimationClip as ThreeAnimationClip,
  Euler,
  Group,
  Mesh,
  MeshStandardMaterial,
  Quaternion,
  QuaternionKeyframeTrack,
  Scene,
  VectorKeyframeTrack,
  type Material,
  type Object3D,
  type Texture,
} from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { bakeAtlasTilesForExport } from '@/app/AtlasGltfBake';
import type { ModelDocument, ObjectId, SceneObject } from '@/core/document/types';
import {
  EXPORT_PROFILES,
  isExportExcludedObject,
  type ExportProfile,
} from '@/app/GameExportProfiles';
import {
  editableMeshToRenderData,
  materialAssetToThree,
} from '@/renderer/MeshRenderAdapter';
import { buildSkinnedMesh } from '@/core/rig/SkinnedMeshBuilder';
import { readRigDocumentSettings } from '@/core/rig/RigDocument';
import type { AnimationSession } from '@/app/animation/AnimationSession';

/** Objects that would be included in an engine export for the given profile. */
export function objectsForExport(
  document: ModelDocument,
  profile: ExportProfile = EXPORT_PROFILES.godot,
): SceneObject[] {
  return [...document.objects.values()].filter((object) => {
    if (!profile.includeColliders && object.metadata.gameRole === 'collision') return false;
    if (profile.onlyVisible && !object.visible) return false;
    if (isExportExcludedObject(object.metadata)) return false;
    return true;
  });
}

/** Export the complete editable scene as a game-ready binary glTF. */
export async function exportDocumentGlb(
  document: ModelDocument,
  profile: ExportProfile = EXPORT_PROFILES.godot,
): Promise<ArrayBuffer> {
  const scene = new Scene();
  scene.name = document.name;
  const exportRoot = new Group();
  exportRoot.name = `${document.name}_Root`;
  const unitScale = document.settings.units === 'centimeters' ? 0.01 : 1;
  exportRoot.scale.setScalar(unitScale * profile.scale);
  if (profile.upAxis === 'z') exportRoot.rotation.x = -Math.PI / 2;
  exportRoot.userData = { viperUnits: document.settings.units, metersPerUnit: unitScale, exportProfile: profile.id };
  scene.add(exportRoot);
  const nodes = new Map<ObjectId, Object3D>();
  const disposableMaterials: Material[] = [];
  const disposableTextures: Texture[] = [];

  for (const object of objectsForExport(document, profile)) {
    const meshData = object.meshId ? document.meshes.get(object.meshId) : null;
    let node: Object3D;
    if (meshData) {
      // Bake viewport atlas-tile wraps; strip custom attrs Blender cannot use.
      const exportMesh = bakeAtlasTilesForExport(meshData);
      const render = editableMeshToRenderData(exportMesh);
      render.geometry.deleteAttribute('atlasTileRect');
      const assets = { textures: document.textures, images: document.images };
      const materials = object.materialSlotIds
        .map((id) => document.materials.get(id))
        .filter((material) => !!material)
        .map((material) => materialAssetToThree(
          profile.textureFiltering === 'material'
            ? material
            : { ...material, textureFiltering: profile.textureFiltering },
          assets,
          { forGltfExport: true },
        ));
      if (materials.length === 0) {
        materials.push(new MeshStandardMaterial({ color: 0xcccccc, roughness: 0.8, metalness: 0 }));
      }
      disposableMaterials.push(...materials);
      for (const material of materials) {
        if (material.map) disposableTextures.push(material.map);
      }
      node = new Mesh(render.geometry, materials.length === 1 ? materials[0] : materials);
    } else {
      node = new Group();
    }
    node.name = object.name;
    node.visible = object.visible;
    node.position.set(
      object.transform.position.x,
      object.transform.position.y,
      object.transform.position.z,
    );
    node.rotation.set(
      object.transform.rotation.x,
      object.transform.rotation.y,
      object.transform.rotation.z,
    );
    node.scale.set(object.transform.scale.x, object.transform.scale.y, object.transform.scale.z);
    node.userData = {
      ...object.metadata,
      viperId: object.id,
      role: object.metadata.gameRole ?? 'geometry',
      collision: object.metadata.collision ?? 'none',
    };
    nodes.set(object.id, node);
  }

  for (const object of document.objects.values()) {
    const node = nodes.get(object.id);
    if (!node) continue;
    const parent = object.parentId ? nodes.get(object.parentId) : null;
    (parent ?? exportRoot).add(node);
  }

  try {
    return await new Promise<ArrayBuffer>((resolve, reject) => {
      new GLTFExporter().parse(
        scene,
        (result) => {
          if (result instanceof ArrayBuffer) resolve(result);
          else reject(new Error('GLB exporter returned JSON instead of binary data'));
        },
        (error) => reject(error),
        {
          binary: true,
          onlyVisible: profile.onlyVisible,
          trs: true,
          includeCustomExtensions: true,
        },
      );
    });
  } finally {
    for (const node of nodes.values()) {
      if (node instanceof Mesh) node.geometry.dispose();
    }
    for (const material of disposableMaterials) material.dispose();
    for (const texture of disposableTextures) texture.dispose();
  }
}

/** Export rigged character with skinned meshes, skeleton, and animation clips as a game-ready binary glTF. */
export async function exportRigGlb(
  session: AnimationSession,
  profile: ExportProfile = EXPORT_PROFILES.godot,
): Promise<ArrayBuffer> {
  const doc = session.rigDocument;
  const settings = readRigDocumentSettings(doc);
  const source = session.getSourceModel();
  const armature = settings.armatureId ? session.project.armatures.get(settings.armatureId) : null;
  if (!source || !armature) {
    throw new Error('No source model or armature found for animation export.');
  }

  const scene = new Scene();
  scene.name = doc.name;
  const exportRoot = new Group();
  exportRoot.name = `${source.name}_RigRoot`;
  const unitScale = source.settings?.units === 'centimeters' ? 0.01 : 1;
  exportRoot.scale.setScalar(unitScale * profile.scale);
  if (profile.upAxis === 'z') exportRoot.rotation.x = -Math.PI / 2;
  scene.add(exportRoot);

  for (const bindingId of settings.skinBindingIds) {
    const binding = session.project.skinBindings.get(bindingId);
    if (!binding) continue;
    const object = source.objects.get(binding.objectId);
    const mesh = object?.meshId ? session.project.meshes.get(object.meshId) : null;
    if (!mesh) continue;
    const materials = source.materials ? [...source.materials.values()] : [...session.project.materials.values()];
    const textures = source.textures ?? session.project.textures ?? new Map();
    const images = source.images ?? session.project.images ?? new Map();
    const rigMesh = buildSkinnedMesh(mesh, binding, armature, {
      materials,
      assets: { textures, images },
    });
    rigMesh.mesh.name = object?.name ?? 'SkinnedMesh';
    exportRoot.add(rigMesh.mesh);
  }

  // Convert AnimationClips to Three.js AnimationClips
  const threeClips: ThreeAnimationClip[] = [];
  for (const clip of session.getClips()) {
    const tracks: (VectorKeyframeTrack | QuaternionKeyframeTrack)[] = [];

    for (const track of clip.tracks) {
      const bone = armature.bones.get(track.boneId);
      if (!bone || track.keyframes.length === 0) continue;

      const sorted = [...track.keyframes].sort((a, b) => a.time - b.time);
      const times = new Float32Array(sorted.length);
      const posVals = new Float32Array(sorted.length * 3);
      const quatVals = new Float32Array(sorted.length * 4);
      const scaleVals = new Float32Array(sorted.length * 3);

      const euler = new Euler();
      const quat = new Quaternion();

      for (let i = 0; i < sorted.length; i += 1) {
        const kf = sorted[i]!;
        times[i] = kf.time;

        posVals[i * 3] = kf.value.position.x;
        posVals[i * 3 + 1] = kf.value.position.y;
        posVals[i * 3 + 2] = kf.value.position.z;

        euler.set(kf.value.rotation.x, kf.value.rotation.y, kf.value.rotation.z);
        quat.setFromEuler(euler);
        quatVals[i * 4] = quat.x;
        quatVals[i * 4 + 1] = quat.y;
        quatVals[i * 4 + 2] = quat.z;
        quatVals[i * 4 + 3] = quat.w;

        scaleVals[i * 3] = kf.value.scale.x;
        scaleVals[i * 3 + 1] = kf.value.scale.y;
        scaleVals[i * 3 + 2] = kf.value.scale.z;
      }

      tracks.push(new VectorKeyframeTrack(`${bone.name}.position`, times as unknown as number[], posVals as unknown as number[]));
      tracks.push(new QuaternionKeyframeTrack(`${bone.name}.quaternion`, times as unknown as number[], quatVals as unknown as number[]));
      tracks.push(new VectorKeyframeTrack(`${bone.name}.scale`, times as unknown as number[], scaleVals as unknown as number[]));
    }

    const threeClip = new ThreeAnimationClip(clip.name, clip.duration, tracks);
    if (clip.events && clip.events.length > 0) {
      threeClip.userData = { ...threeClip.userData, events: clip.events };
    }
    if (clip.rootMotion) {
      threeClip.userData = { ...threeClip.userData, rootMotion: true };
    }
    threeClips.push(threeClip);
  }

  return await new Promise<ArrayBuffer>((resolve, reject) => {
    new GLTFExporter().parse(
      scene,
      (result) => {
        if (result instanceof ArrayBuffer) resolve(result);
        else reject(new Error('GLB exporter returned JSON instead of binary data'));
      },
      (error) => reject(error),
      {
        binary: true,
        onlyVisible: profile.onlyVisible,
        animations: threeClips,
        trs: true,
        includeCustomExtensions: true,
      },
    );
  });
}

export type GlbRoundTripReport = {
  errors: string[];
  meshes: number;
  triangles: number;
  materials: number;
};

/** Parses the generated GLB again before download to catch corrupt or empty exports. */
export async function validateGlbRoundTrip(buffer: ArrayBuffer): Promise<GlbRoundTripReport> {
  try {
    const gltf = await new Promise<Awaited<ReturnType<GLTFLoader['parseAsync']>>>((resolve, reject) => {
      new GLTFLoader().parse(buffer, '', resolve, reject);
    });
    let meshes = 0;
    let triangles = 0;
    const materials = new Set<Material>();
    gltf.scene.traverse((node) => {
      if (!(node instanceof Mesh)) return;
      meshes += 1;
      const positionCount = node.geometry.getAttribute('position')?.count ?? 0;
      triangles += Math.floor((node.geometry.index?.count ?? positionCount) / 3);
      const nodeMaterials = Array.isArray(node.material) ? node.material : [node.material];
      for (const material of nodeMaterials) materials.add(material);
    });
    return {
      errors: meshes > 0 && triangles === 0 ? ['Round-trip validation found meshes with no triangles.'] : [],
      meshes,
      triangles,
      materials: materials.size,
    };
  } catch (error) {
    return {
      errors: [error instanceof Error ? `GLB round-trip failed: ${error.message}` : 'GLB round-trip failed.'],
      meshes: 0,
      triangles: 0,
      materials: 0,
    };
  }
}

export { EXPORT_PROFILES } from '@/app/GameExportProfiles';
export type { ExportProfile } from '@/app/GameExportProfiles';
