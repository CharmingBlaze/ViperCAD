import { describe, expect, it } from 'vitest';
import {
  assignMaterialToObject,
  commitMeshObject,
  countMaterialUsers,
  createEmptyDocument,
  createMaterial,
  getObjectMaterialId,
} from '@/core/document/ModelDocument';
import { buildBox } from '@/core/mesh/builders/BoxBuilder';

function box(name = 'Box') {
  return buildBox({ width: 1, height: 1, depth: 1, name, centered: true });
}

describe('per-object materials', () => {
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
