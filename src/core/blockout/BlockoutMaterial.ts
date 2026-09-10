import {
  createMaterial,
  ensureDefaultPlaceholderMaterial,
} from '@/core/document/ModelDocument';
import type { MaterialAsset, MaterialId, ModelDocument, ObjectId } from '@/core/document/types';

/** Light clay that stays readable on the dark blockout background. */
export const DEFAULT_BLOCKOUT_CLAY = {
  name: 'Blockout Clay',
  hex: '#d4c4b0',
  rgb: { x: 0xd4 / 255, y: 0xc4 / 255, z: 0xb0 / 255 },
} as const;

export function ensureBlockoutMaterial(doc: ModelDocument): MaterialId {
  for (const material of doc.materials.values()) {
    if (material.name === DEFAULT_BLOCKOUT_CLAY.name) return material.id;
  }
  const material = createMaterial(doc, { name: DEFAULT_BLOCKOUT_CLAY.name });
  material.presetId = 'default';
  material.baseColour = { ...DEFAULT_BLOCKOUT_CLAY.rgb };
  bindPlaceholderTexture(doc, material);
  material.roughness = 0.82;
  material.metallic = 0.04;
  material.flatShaded = true;
  return material.id;
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
  object.materialSlotIds = [ensureBlockoutMaterial(doc)];
  doc.dirty = true;
}
