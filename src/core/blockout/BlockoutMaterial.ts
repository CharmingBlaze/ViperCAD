import {
  assignMaterialToObject,
  ensureDefaultPlaceholderMaterial,
} from '@/core/document/ModelDocument';
import type { MaterialAsset, MaterialId, ModelDocument, ObjectId } from '@/core/document/types';
import { centreObjectOrigin } from '@/core/editor/GameAssetTools';
import { unwrapUvAuto } from '@/core/uv/UvOperations';

export function ensureBlockoutMaterial(doc: ModelDocument): MaterialId {
  return ensureDefaultPlaceholderMaterial(doc);
}

/** Keep the default clay map on a blockout colour so finish matches the live preview. */
export function bindPlaceholderTexture(doc: ModelDocument, material: MaterialAsset): void {
  const placeholderId = ensureDefaultPlaceholderMaterial(doc);
  const placeholder = doc.materials.get(placeholderId);
  material.baseColourTextureId = placeholder?.baseColourTextureId ?? null;
  material.shadingModel = 'unlit';
  material.unlit = true;
  material.doubleSided = true;
}

export function assignDefaultBlockoutMaterial(doc: ModelDocument, objectId: ObjectId): void {
  const object = doc.objects.get(objectId);
  if (!object) return;
  assignMaterialToObject(doc, objectId, ensureDefaultPlaceholderMaterial(doc));
  doc.dirty = true;
}

function unwrapBlockoutUvs(doc: ModelDocument, objectId: ObjectId): void {
  const object = doc.objects.get(objectId);
  const mesh = object?.meshId ? doc.meshes.get(object.meshId) : null;
  if (!mesh?.faces.size || !mesh.defaultUvLayerId) return;
  try {
    unwrapUvAuto(mesh, [...mesh.faces.keys()], mesh.defaultUvLayerId);
  } catch {
    /* degenerate faces can skip unwrap */
  }
}

function centreBlockoutOrigin(doc: ModelDocument, objectId: ObjectId): void {
  const object = doc.objects.get(objectId);
  const mesh = object?.meshId ? doc.meshes.get(object.meshId) : null;
  if (!object || !mesh || mesh.vertices.size === 0) return;
  centreObjectOrigin(doc, objectId);
}

/**
 * Default placeholder texture, paintable UVs, and origin at the mesh bounds centre.
 * Also keeps live curve points in sync with that origin.
 */
export function applyDefaultBlockoutLook(doc: ModelDocument, objectId: ObjectId): void {
  assignDefaultBlockoutMaterial(doc, objectId);
  unwrapBlockoutUvs(doc, objectId);
  centreBlockoutOrigin(doc, objectId);
}
