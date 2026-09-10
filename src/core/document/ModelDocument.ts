import { createId } from '@/core/ids/IdService';
import { defaultTransform, cloneTransform } from '@/core/math/Transform';
import { v3 } from '@/core/math/Vec3';
import { cloneMeshPreserveIds } from '@/core/mesh/EditableMesh';
import {
  createGeneratedPlaceholderPixels,
  DEFAULT_PLACEHOLDER_IMAGE_NAME,
  GENERATED_PLACEHOLDER_SIZE,
} from '@/core/image/DefaultPlaceholderImage';
import { normalizeMaterialAsset } from '@/core/material/MaterialPresets';
import type { EditableMesh, MeshId } from '@/core/mesh/types';
import {
  inferKindForNewObject,
  normalizeSceneObject,
} from './SceneObjectKind';
import {
  DEFAULT_PROJECT_SETTINGS,
  type ImageAsset,
  type MaterialAsset,
  type MaterialId,
  type ModelDocument,
  type ObjectId,
  type SceneObject,
  type SceneObjectKind,
  type TextureAsset,
  type TextureId,
} from './types';

/** Clear azure tint. Multiplies with the default texture so both colour and detail read. */
export const DEFAULT_MATERIAL_COLOUR = v3(0.42, 0.68, 0.96);

export function createDefaultMaterial(name = 'Material'): MaterialAsset {
  return normalizeMaterialAsset({
    id: createId('mat'),
    name,
    shadingModel: 'unlit',
    presetId: 'default-low-poly-terrain',
    baseColour: { ...DEFAULT_MATERIAL_COLOUR },
    baseColourTextureId: null,
    normalTextureId: null,
    roughness: 0.55,
    roughnessTextureId: null,
    metallic: 0,
    metallicTextureId: null,
    emissive: v3(0, 0, 0),
    emissiveIntensity: 1,
    emissiveTextureId: null,
    opacity: 1,
    alphaMode: 'opaque',
    alphaCutoff: 0.5,
    transmission: 0,
    ior: 1.5,
    clearcoat: 0,
    clearcoatRoughness: 0.03,
    doubleSided: true,
    unlit: true,
    flatShaded: false,
    textureFiltering: 'linear',
    textureWrapping: 'repeat',
    uvLayerIndex: 0,
  });
}

/** Default material map. Tiny generated pixels until the bundled object texture hydrates. */
export function createDefaultPlaceholderAssets(): {
  material: MaterialAsset;
  texture: TextureAsset;
  image: ImageAsset;
} {
  const size = GENERATED_PLACEHOLDER_SIZE;
  const image: ImageAsset = {
    id: createId('img'),
    name: DEFAULT_PLACEHOLDER_IMAGE_NAME,
    width: size,
    height: size,
    colourMode: 'rgba',
    pixels: createGeneratedPlaceholderPixels(size),
    revision: 1,
  };
  const texture: TextureAsset = {
    id: createId('tex'),
    name: DEFAULT_PLACEHOLDER_IMAGE_NAME,
    imageAssetId: image.id,
    filtering: 'linear',
    wrapping: 'repeat',
    colourSpace: 'srgb',
    generateMipmaps: true,
  };
  const material = createDefaultMaterial(DEFAULT_PLACEHOLDER_IMAGE_NAME);
  material.baseColourTextureId = texture.id;
  return { material, texture, image };
}

export function createEmptyDocument(
  name = 'Untitled',
  options: { modellingProfile?: 'general' | 'character' } = {},
): ModelDocument {
  const { material, texture, image } = createDefaultPlaceholderAssets();
  const document: ModelDocument = {
    id: createId('doc'),
    name,
    version: 1,
    objects: new Map(),
    rootObjectIds: [],
    meshes: new Map(),
    materials: new Map([[material.id, material]]),
    textures: new Map([[texture.id, texture]]),
    images: new Map([[image.id, image]]),
    settings: {
      ...DEFAULT_PROJECT_SETTINGS,
      symmetry: { ...DEFAULT_PROJECT_SETTINGS.symmetry },
    },
    dirty: false,
  };
  if (options.modellingProfile === 'character') {
    document.settings.modellingProfile = 'character';
    document.settings.symmetry.x = true;
    document.settings.symmetry.liveMirror = true;
  }
  return document;
}

export function createSceneObject(
  name: string,
  meshId: MeshId | null = null,
  materialSlotIds: MaterialId[] = [],
  options: { kind?: SceneObjectKind } = {},
): SceneObject {
  const kind = inferKindForNewObject(meshId, options);
  return {
    id: createId('obj'),
    name,
    kind,
    parentId: null,
    childIds: [],
    transform: defaultTransform(),
    meshId,
    instanceSourceModelId: null,
    materialSlotIds,
    visible: true,
    locked: false,
    metadata: {},
  };
}

export function addMeshToDocument(doc: ModelDocument, mesh: EditableMesh): MeshId {
  doc.meshes.set(mesh.id, mesh);
  doc.dirty = true;
  return mesh.id;
}

export function addObjectToDocument(doc: ModelDocument, object: SceneObject): ObjectId {
  normalizeSceneObject(object);
  doc.objects.set(object.id, object);
  if (!object.parentId) {
    doc.rootObjectIds.push(object.id);
  } else {
    const parent = doc.objects.get(object.parentId);
    if (parent && !parent.childIds.includes(object.id)) {
      parent.childIds.push(object.id);
    }
  }
  doc.dirty = true;
  return object.id;
}

/** Material that carries the bundled default object texture, creating it if needed. */
export function ensureDefaultPlaceholderMaterial(doc: ModelDocument): MaterialId {
  let textureId = findPlaceholderTextureId(doc);
  if (!textureId) {
    const assets = createDefaultPlaceholderAssets();
    doc.textures.set(assets.texture.id, assets.texture);
    doc.images.set(assets.image.id, assets.image);
    textureId = assets.texture.id;
    const untextured = [...doc.materials.values()].find((material) => !material.baseColourTextureId);
    if (untextured) {
      bindPlaceholderTexture(untextured, textureId);
      doc.dirty = true;
      return untextured.id;
    }
    doc.materials.set(assets.material.id, assets.material);
    doc.dirty = true;
    return assets.material.id;
  }

  for (const material of doc.materials.values()) {
    if (material.baseColourTextureId === textureId) {
      if (retuneDefaultPlaceholderMaterial(material)) doc.dirty = true;
      return material.id;
    }
  }
  const untextured = [...doc.materials.values()].find((material) => !material.baseColourTextureId);
  if (untextured) {
    bindPlaceholderTexture(untextured, textureId);
    doc.dirty = true;
    return untextured.id;
  }
  const material = createDefaultMaterial(DEFAULT_PLACEHOLDER_IMAGE_NAME);
  material.baseColourTextureId = textureId;
  doc.materials.set(material.id, material);
  doc.dirty = true;
  return material.id;
}

/** Keep the bundled clay look as unlit + double-sided so it cannot go black under studio lights. */
export function retuneDefaultPlaceholderMaterial(material: MaterialAsset): boolean {
  const isPlaceholder =
    material.presetId === 'default-low-poly-terrain' ||
    material.presetId === 'default-pixel-clay' ||
    material.name === DEFAULT_PLACEHOLDER_IMAGE_NAME;
  if (!isPlaceholder) return false;
  let changed = false;
  if (material.presetId !== 'default-low-poly-terrain' && material.presetId !== 'default-pixel-clay') {
    material.presetId = 'default-low-poly-terrain';
    changed = true;
  }
  if (material.shadingModel !== 'unlit') {
    material.shadingModel = 'unlit';
    changed = true;
  }
  if (!material.unlit) {
    material.unlit = true;
    changed = true;
  }
  if (!material.doubleSided) {
    material.doubleSided = true;
    changed = true;
  }
  if (
    material.baseColour.x !== DEFAULT_MATERIAL_COLOUR.x ||
    material.baseColour.y !== DEFAULT_MATERIAL_COLOUR.y ||
    material.baseColour.z !== DEFAULT_MATERIAL_COLOUR.z
  ) {
    material.baseColour = { ...DEFAULT_MATERIAL_COLOUR };
    changed = true;
  }
  return changed;
}

function bindPlaceholderTexture(material: MaterialAsset, textureId: TextureId): void {
  material.baseColourTextureId = textureId;
  if (!material.presetId || material.presetId === 'default') {
    material.presetId = 'default-low-poly-terrain';
  }
  retuneDefaultPlaceholderMaterial(material);
}

function findPlaceholderTextureId(doc: ModelDocument): TextureId | null {
  for (const texture of doc.textures.values()) {
    const image = doc.images.get(texture.imageAssetId);
    if (image?.name === DEFAULT_PLACEHOLDER_IMAGE_NAME) return texture.id;
  }
  return null;
}

/** Create mesh asset + scene object in one step. */
export function commitMeshObject(
  doc: ModelDocument,
  mesh: EditableMesh,
  options: { name?: string; materialId?: MaterialId } = {},
): { objectId: ObjectId; meshId: MeshId } {
  const materialId = options.materialId ?? ensureDefaultPlaceholderMaterial(doc);
  if (!materialId) throw new Error('Document has no materials');
  mesh.name = options.name ?? mesh.name;
  addMeshToDocument(doc, mesh);
  const object = createSceneObject(options.name ?? mesh.name, mesh.id, [materialId], { kind: 'mesh' });
  addObjectToDocument(doc, object);
  return { objectId: object.id, meshId: mesh.id };
}

export function getObjectWorldLike(doc: ModelDocument, objectId: ObjectId): SceneObject | undefined {
  return doc.objects.get(objectId);
}

export function duplicateObject(doc: ModelDocument, objectId: ObjectId, uniqueMesh: boolean): ObjectId {
  const src = doc.objects.get(objectId);
  if (!src) throw new Error(`Object ${objectId} not found`);

  let meshId = src.meshId;
  if (uniqueMesh && src.meshId) {
    const srcMesh = doc.meshes.get(src.meshId);
    if (srcMesh) {
      const clone = cloneMeshPreserveIds(srcMesh);
      clone.id = createId('mesh');
      clone.name = `${srcMesh.name}_copy`;
      doc.meshes.set(clone.id, clone);
      meshId = clone.id;
    }
  }

  const copy = createSceneObject(`${src.name}_copy`, meshId, [...src.materialSlotIds], { kind: src.kind });
  copy.transform = cloneTransform(src.transform);
  copy.visible = src.visible;
  copy.locked = src.locked;
  copy.metadata = { ...src.metadata };
  copy.instanceSourceModelId = src.instanceSourceModelId;
  addObjectToDocument(doc, copy);
  return copy.id;
}

export function removeObject(doc: ModelDocument, objectId: ObjectId, deleteOrphanMesh = true): void {
  const object = doc.objects.get(objectId);
  if (!object) return;

  for (const childId of [...object.childIds]) {
    removeObject(doc, childId, deleteOrphanMesh);
  }

  if (object.parentId) {
    const parent = doc.objects.get(object.parentId);
    if (parent) parent.childIds = parent.childIds.filter((id) => id !== objectId);
  } else {
    doc.rootObjectIds = doc.rootObjectIds.filter((id) => id !== objectId);
  }

  const meshId = object.meshId;
  doc.objects.delete(objectId);

  if (deleteOrphanMesh && meshId) {
    const stillUsed = [...doc.objects.values()].some((o) => o.meshId === meshId);
    if (!stillUsed) doc.meshes.delete(meshId);
  }
  doc.dirty = true;
}

/** Material id on object slot 0 (or null if unset / missing). */
export function getObjectMaterialId(object: SceneObject, slot = 0): MaterialId | null {
  return object.materialSlotIds[slot] ?? null;
}

/** Point an object slot at an existing document material. */
export function assignMaterialToObject(
  doc: ModelDocument,
  objectId: ObjectId,
  materialId: MaterialId,
  slot = 0,
): boolean {
  const object = doc.objects.get(objectId);
  if (!object || !doc.materials.has(materialId)) return false;
  if (slot < 0) return false;
  while (object.materialSlotIds.length <= slot) {
    const fallback = object.materialSlotIds[0] ?? materialId;
    object.materialSlotIds.push(fallback);
  }
  object.materialSlotIds[slot] = materialId;
  doc.dirty = true;
  return true;
}

/**
 * Create a new material asset and optionally assign it to an object (slot 0).
 * Name defaults to the object name, or "Material N".
 */
export function createMaterial(
  doc: ModelDocument,
  options: { name?: string; assignToObjectId?: ObjectId; slot?: number } = {},
): MaterialAsset {
  const object = options.assignToObjectId ? doc.objects.get(options.assignToObjectId) : undefined;
  const name =
    options.name ??
    (object ? `${object.name} Material` : `Material ${doc.materials.size + 1}`);
  const material = createDefaultMaterial(name);
  doc.materials.set(material.id, material);
  if (options.assignToObjectId) {
    assignMaterialToObject(doc, options.assignToObjectId, material.id, options.slot ?? 0);
  } else {
    doc.dirty = true;
  }
  return material;
}

/** How many scene objects reference this material on any slot. */
export function countMaterialUsers(doc: ModelDocument, materialId: MaterialId): number {
  let n = 0;
  for (const object of doc.objects.values()) {
    if (object.materialSlotIds.includes(materialId)) n += 1;
  }
  return n;
}
