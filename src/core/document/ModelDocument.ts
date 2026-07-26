import { createId } from '@/core/ids/IdService';
import { defaultTransform, cloneTransform } from '@/core/math/Transform';
import { v3 } from '@/core/math/Vec3';
import { cloneMeshPreserveIds } from '@/core/mesh/EditableMesh';
import { normalizeMaterialAsset } from '@/core/material/MaterialPresets';
import type { EditableMesh, MeshId } from '@/core/mesh/types';
import {
  DEFAULT_PROJECT_SETTINGS,
  type ImageAsset,
  type MaterialAsset,
  type MaterialId,
  type ModelDocument,
  type ObjectId,
  type SceneObject,
  type TextureAsset,
} from './types';

export function createDefaultMaterial(name = 'Material'): MaterialAsset {
  return normalizeMaterialAsset({
    id: createId('mat'),
    name,
    shadingModel: 'lit',
    presetId: 'default',
    baseColour: v3(0.75, 0.75, 0.78),
    baseColourTextureId: null,
    normalTextureId: null,
    roughness: 0.6,
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
    doubleSided: false,
    unlit: false,
    flatShaded: true,
    textureFiltering: 'nearest',
    textureWrapping: 'repeat',
    uvLayerIndex: 0,
  });
}

/** Small nearest-neighbour checker so selection overlays can be verified over real textures. */
export function createDefaultCheckerAssets(): {
  material: MaterialAsset;
  texture: TextureAsset;
  image: ImageAsset;
} {
  const size = 8;
  const pixels = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const on = ((x ^ y) & 1) === 0;
      pixels[i] = on ? 220 : 60;
      pixels[i + 1] = on ? 90 : 140;
      pixels[i + 2] = on ? 70 : 200;
      pixels[i + 3] = 255;
    }
  }
  const image: ImageAsset = {
    id: createId('img'),
    name: 'Checker',
    width: size,
    height: size,
    colourMode: 'rgba',
    pixels,
    revision: 1,
  };
  const texture: TextureAsset = {
    id: createId('tex'),
    name: 'Checker',
    imageAssetId: image.id,
    filtering: 'nearest',
    wrapping: 'repeat',
    colourSpace: 'srgb',
    generateMipmaps: false,
  };
  const material = createDefaultMaterial('Default');
  material.baseColourTextureId = texture.id;
  return { material, texture, image };
}

export function createEmptyDocument(
  name = 'Untitled',
  options: { modellingProfile?: 'general' | 'character' } = {},
): ModelDocument {
  const { material, texture, image } = createDefaultCheckerAssets();
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
): SceneObject {
  return {
    id: createId('obj'),
    name,
    parentId: null,
    childIds: [],
    transform: defaultTransform(),
    meshId,
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

/** Create mesh asset + scene object in one step. */
export function commitMeshObject(
  doc: ModelDocument,
  mesh: EditableMesh,
  options: { name?: string; materialId?: MaterialId } = {},
): { objectId: ObjectId; meshId: MeshId } {
  const materialId = options.materialId ?? [...doc.materials.keys()][0];
  if (!materialId) throw new Error('Document has no materials');
  mesh.name = options.name ?? mesh.name;
  addMeshToDocument(doc, mesh);
  const object = createSceneObject(options.name ?? mesh.name, mesh.id, [materialId]);
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

  const copy = createSceneObject(`${src.name}_copy`, meshId, [...src.materialSlotIds]);
  copy.transform = cloneTransform(src.transform);
  copy.visible = src.visible;
  copy.locked = src.locked;
  copy.metadata = { ...src.metadata };
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
