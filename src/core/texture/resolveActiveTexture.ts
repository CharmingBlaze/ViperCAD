import type { ModelDocument, ObjectId } from '@/core/document/types';
import type { FaceId } from '@/core/mesh/types';
import type { SelectionState } from '@/core/selection/SelectionManager';

export type ActiveTextureContext = {
  objectId: ObjectId | null;
  materialId: string | null;
  textureId: string | null;
  imageId: string | null;
  uvLayerId: string | null;
};

/**
 * Resolve which image the UV/Pixel editor should display.
 * Active face material → base-colour texture → image; else active object material.
 */
export function resolveActiveTexture(
  doc: ModelDocument,
  selection: SelectionState,
): ActiveTextureContext {
  const objectId = selection.activeObjectId;
  const object = objectId ? doc.objects.get(objectId) : null;
  const mesh = object?.meshId ? doc.meshes.get(object.meshId) : null;
  const uvLayerId = mesh?.defaultUvLayerId ?? null;

  let materialId: string | null = null;
  if (mesh && selection.mode === 'face' && selection.activeFaceId) {
    const face = mesh.faces.get(selection.activeFaceId);
    if (face) {
      materialId = object?.materialSlotIds[face.materialSlot] ?? object?.materialSlotIds[0] ?? null;
    }
  }
  if (!materialId && object?.materialSlotIds.length) {
    materialId = object.materialSlotIds[0] ?? null;
  }
  if (!materialId) {
    materialId = [...doc.materials.keys()][0] ?? null;
  }

  const material = materialId ? doc.materials.get(materialId) : null;
  const textureId = material?.baseColourTextureId ?? null;
  const texture = textureId ? doc.textures.get(textureId) : null;
  const imageId = texture?.imageAssetId ?? null;

  return {
    objectId: objectId ?? null,
    materialId,
    textureId,
    imageId,
    uvLayerId,
  };
}

export function facesForImage(
  doc: ModelDocument,
  objectId: ObjectId,
  imageId: string,
): FaceId[] {
  const object = doc.objects.get(objectId);
  const mesh = object?.meshId ? doc.meshes.get(object.meshId) : null;
  if (!object || !mesh) return [];
  const result: FaceId[] = [];
  for (const face of mesh.faces.values()) {
    const matId = object.materialSlotIds[face.materialSlot];
    const mat = matId ? doc.materials.get(matId) : null;
    const tex = mat?.baseColourTextureId ? doc.textures.get(mat.baseColourTextureId) : null;
    if (tex?.imageAssetId === imageId) result.push(face.id);
  }
  return result;
}
