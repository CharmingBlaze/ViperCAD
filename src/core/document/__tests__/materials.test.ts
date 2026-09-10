import { describe, expect, it } from 'vitest';
import { DEFAULT_PLACEHOLDER_IMAGE_NAME } from '@/core/image/DefaultPlaceholderImage';
import {
  assignMaterialToObject,
  commitMeshObject,
  countMaterialUsers,
  createDefaultMaterial,
  createEmptyDocument,
  createMaterial,
  DEFAULT_MATERIAL_COLOUR,
  ensureDefaultPlaceholderMaterial,
  getObjectMaterialId,
} from '@/core/document/ModelDocument';
import { buildBox } from '@/core/mesh/builders/BoxBuilder';

function box(name = 'Box') {
  return buildBox({ width: 1, height: 1, depth: 1, name, centered: true });
}

describe('per-object materials', () => {
  it('uses a blue tint and the default texture on new documents', () => {
    const doc = createEmptyDocument();
    const material = [...doc.materials.values()][0]!;
    expect(material.baseColour).toEqual(DEFAULT_MATERIAL_COLOUR);
    expect(material.baseColour.z).toBeGreaterThan(material.baseColour.y);
    expect(material.baseColour.y).toBeGreaterThan(material.baseColour.x);
    expect(material.baseColourTextureId).toBeTruthy();
    const texture = doc.textures.get(material.baseColourTextureId!)!;
    expect(doc.images.get(texture.imageAssetId)?.name).toBe(DEFAULT_PLACEHOLDER_IMAGE_NAME);
    expect(createDefaultMaterial().baseColour).toEqual(DEFAULT_MATERIAL_COLOUR);
    expect(material.unlit).toBe(true);
    expect(material.doubleSided).toBe(true);
    expect(material.shadingModel).toBe('unlit');
  });

  it('retunes a leftover lit placeholder so new objects stay visible', () => {
    const doc = createEmptyDocument();
    const material = [...doc.materials.values()][0]!;
    material.unlit = false;
    material.shadingModel = 'lit';
    material.doubleSided = false;
    const materialId = ensureDefaultPlaceholderMaterial(doc);
    const tuned = doc.materials.get(materialId)!;
    expect(tuned.unlit).toBe(true);
    expect(tuned.shadingModel).toBe('unlit');
    expect(tuned.doubleSided).toBe(true);
  });

  it('assigns an existing material to an object slot', () => {
    const doc = createEmptyDocument();
    const { objectId } = commitMeshObject(doc, box());
    const shared = createMaterial(doc, { name: 'Shared' });
    expect(assignMaterialToObject(doc, objectId, shared.id)).toBe(true);
    const object = doc.objects.get(objectId)!;
    expect(getObjectMaterialId(object)).toBe(shared.id);
  });

  it('creates a new material and assigns it to one object only', () => {
    const doc = createEmptyDocument();
    const a = commitMeshObject(doc, box('Box A'), { name: 'Box A' });
    const b = commitMeshObject(doc, box('Box B'), { name: 'Box B' });
    const defaultId = getObjectMaterialId(doc.objects.get(a.objectId)!)!;

    const unique = createMaterial(doc, {
      assignToObjectId: a.objectId,
      name: 'Box A Material',
    });

    expect(doc.materials.has(unique.id)).toBe(true);
    expect(getObjectMaterialId(doc.objects.get(a.objectId)!)).toBe(unique.id);
    expect(getObjectMaterialId(doc.objects.get(b.objectId)!)).toBe(defaultId);
    expect(countMaterialUsers(doc, unique.id)).toBe(1);
    expect(countMaterialUsers(doc, defaultId)).toBe(1);
  });

  it('reattaches the default image when the first material lost its texture', () => {
    const doc = createEmptyDocument();
    const first = [...doc.materials.values()][0]!;
    first.baseColourTextureId = null;
    const materialId = ensureDefaultPlaceholderMaterial(doc);
    const material = doc.materials.get(materialId)!;
    expect(material.baseColourTextureId).toBeTruthy();
    const texture = doc.textures.get(material.baseColourTextureId!)!;
    expect(doc.images.get(texture.imageAssetId)?.name).toBe(DEFAULT_PLACEHOLDER_IMAGE_NAME);

    const { objectId } = commitMeshObject(doc, box());
    expect(getObjectMaterialId(doc.objects.get(objectId)!)).toBe(materialId);
  });

  it('lets two objects share one library material', () => {
    const doc = createEmptyDocument();
    const a = commitMeshObject(doc, box());
    const b = commitMeshObject(doc, box());
    const paint = createMaterial(doc, { name: 'Paint' });
    assignMaterialToObject(doc, a.objectId, paint.id);
    assignMaterialToObject(doc, b.objectId, paint.id);
    expect(countMaterialUsers(doc, paint.id)).toBe(2);
  });
});
