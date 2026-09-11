import type { EditableMesh, MeshId } from '@/core/mesh/types';
import type {
  ImageId,
  MaterialAsset,
  MaterialId,
  ModelDocument,
  ObjectId,
  SceneObject,
  TextureAsset,
  TextureId,
  ViperProject,
} from '@/core/document/types';
import { validateMeshFull } from '@/core/mesh/Validation';
import {
  deserializeViperProject,
  type DeserializeProjectResult,
} from '@/core/persistence/ProjectSerializer';
import { readRigDocumentSettings } from '@/core/rig/RigDocument';

const MATERIAL_TEXTURE_SLOTS: Array<keyof MaterialAsset> = [
  'baseColourTextureId',
  'normalTextureId',
  'roughnessTextureId',
  'metallicTextureId',
  'emissiveTextureId',
];

function collectAssetErrors(
  materials: Map<MaterialId, MaterialAsset>,
  textures: Map<TextureId, TextureAsset>,
  images: Map<ImageId, unknown>,
  errors: string[],
): void {
  for (const material of materials.values()) {
    for (const slot of MATERIAL_TEXTURE_SLOTS) {
      const textureId = material[slot];
      if (typeof textureId === 'string' && !textures.has(textureId as TextureId)) {
        errors.push(`${material.name}: missing texture`);
      }
    }
  }
  for (const texture of textures.values()) {
    if (!images.has(texture.imageAssetId)) errors.push(`${texture.name}: missing image`);
  }
}

function collectMeshErrors(name: string, mesh: EditableMesh, errors: string[]): void {
  try {
    const report = validateMeshFull(mesh);
    if (report.ok) return;
    const first = report.issues.find((issue) => issue.severity === 'error');
    errors.push(first ? `${name}: ${first.message}` : `${name} failed validation`);
  } catch (error) {
    errors.push(error instanceof Error ? `${name}: ${error.message}` : `${name} failed validation`);
  }
}

function collectSceneErrors(
  label: string,
  objects: Map<ObjectId, SceneObject>,
  rootObjectIds: ObjectId[],
  meshes: Map<MeshId, EditableMesh>,
  materials: Map<MaterialId, unknown>,
  errors: string[],
): void {
  for (const rootId of rootObjectIds) {
    if (!objects.has(rootId)) errors.push(`${label}: missing root object`);
  }
  for (const object of objects.values()) {
    if (object.parentId && !objects.has(object.parentId)) {
      errors.push(`${object.name}: missing parent`);
    }
    for (const childId of object.childIds) {
      if (!objects.has(childId)) errors.push(`${object.name}: missing child`);
    }
    if (object.meshId && !meshes.has(object.meshId)) {
      errors.push(`${object.name}: missing mesh`);
    }
    for (const materialId of object.materialSlotIds) {
      if (!materials.has(materialId)) errors.push(`${object.name}: missing material`);
    }
  }
}

function collectRigErrors(project: ViperProject, errors: string[]): void {
  const objectIds = new Set<ObjectId>();
  for (const document of project.documents.values()) {
    for (const objectId of document.objects.keys()) objectIds.add(objectId);
  }

  for (const armature of project.armatures.values()) {
    for (const rootId of armature.rootBoneIds) {
      if (!armature.bones.has(rootId)) errors.push(`${armature.name}: missing root bone`);
    }
    for (const bone of armature.bones.values()) {
      if (bone.parentId && !armature.bones.has(bone.parentId)) {
        errors.push(`${bone.name}: missing parent bone`);
      }
    }
  }

  for (const binding of project.skinBindings.values()) {
    if (!project.meshes.has(binding.meshId)) errors.push(`${binding.name}: missing mesh`);
    if (!project.armatures.has(binding.armatureId)) errors.push(`${binding.name}: missing armature`);
    if (!objectIds.has(binding.objectId)) errors.push(`${binding.name}: missing object`);
  }

  for (const document of project.documents.values()) {
    if (document.kind !== 'rig' && !document.settings.rig) continue;
    const rig = readRigDocumentSettings(document);
    if (rig.sourceModelDocumentId && !project.documents.has(rig.sourceModelDocumentId)) {
      errors.push(`${document.name}: missing source model`);
    }
    if (rig.armatureId && !project.armatures.has(rig.armatureId)) {
      errors.push(`${document.name}: missing armature`);
    }
    for (const bindingId of rig.skinBindingIds) {
      if (!project.skinBindings.has(bindingId)) errors.push(`${document.name}: missing skin binding`);
    }
    for (const clipId of rig.clipIds) {
      if (!project.animationClips.has(clipId)) errors.push(`${document.name}: missing clip`);
    }
    if (rig.activeClipId && !project.animationClips.has(rig.activeClipId)) {
      errors.push(`${document.name}: missing active clip`);
    }
    for (const item of rig.clipSequence) {
      if (!project.animationClips.has(item.clipId)) {
        errors.push(`${document.name}: missing sequence clip`);
      }
    }
    const armature = rig.armatureId ? project.armatures.get(rig.armatureId) : null;
    if (!armature) continue;
    for (const constraint of rig.constraints) {
      if (!armature.bones.has(constraint.ownerId)) {
        errors.push(`${document.name}: missing constraint bone`);
      }
      if (constraint.targetId && !armature.bones.has(constraint.targetId)) {
        errors.push(`${document.name}: missing constraint target`);
      }
    }
    for (const clipId of rig.clipIds) {
      const clip = project.animationClips.get(clipId);
      if (!clip) continue;
      for (const track of clip.tracks) {
        if (!armature.bones.has(track.boneId)) {
          errors.push(`${clip.name}: missing bone`);
        }
      }
    }
  }
}

export type ProjectHealthReport = {
  ok: boolean;
  errors: string[];
};

/** Block saves that would persist broken topology or dangling scene refs. */
export function inspectDocumentHealth(document: ModelDocument): ProjectHealthReport {
  const errors: string[] = [];
  for (const mesh of document.meshes.values()) {
    collectMeshErrors(mesh.name, mesh, errors);
  }
  collectSceneErrors(
    document.name,
    document.objects,
    document.rootObjectIds,
    document.meshes,
    document.materials,
    errors,
  );
  collectAssetErrors(document.materials, document.textures, document.images, errors);
  return { ok: errors.length === 0, errors };
}

export function inspectProjectHealth(project: ViperProject): ProjectHealthReport {
  const errors: string[] = [];
  for (const mesh of project.meshes.values()) {
    collectMeshErrors(mesh.name, mesh, errors);
  }
  if (project.activeDocumentId && !project.documents.has(project.activeDocumentId)) {
    errors.push('Active document is missing');
  }
  for (const documentId of [
    ...project.modelDocumentIds,
    ...project.levelDocumentIds,
    ...project.rigDocumentIds,
  ]) {
    if (!project.documents.has(documentId)) errors.push('Project lists a missing document');
  }
  for (const document of project.documents.values()) {
    collectSceneErrors(
      document.name,
      document.objects,
      document.rootObjectIds,
      project.meshes,
      project.materials,
      errors,
    );
  }
  collectAssetErrors(project.materials, project.textures, project.images, errors);
  collectRigErrors(project, errors);
  return { ok: errors.length === 0, errors };
}

/** Open a `.viper` payload only when checksum, topology, and scene refs are valid. */
export function openViperProjectText(text: string): DeserializeProjectResult {
  const result = deserializeViperProject(text);
  const health = inspectProjectHealth(result.project);
  if (!health.ok) throw new Error(health.errors[0] ?? 'Project failed validation');
  return result;
}

export function firstMeshValidationError(mesh: EditableMesh): string | null {
  const report = validateMeshFull(mesh);
  if (report.ok) return null;
  const first = report.issues.find((issue) => issue.severity === 'error');
  return first?.message ?? `${mesh.name} failed validation`;
}
