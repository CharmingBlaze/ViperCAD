import { defaultTransform, transformDeterminantSign, transformPoint } from '@/core/math/Transform';
import { bumpPositions } from '@/core/mesh/EditableMesh';
import { flipFaces } from '@/core/mesh/ops/basic';
import type { ModelDocument, ObjectId } from './types';

/** Bake an object's local transform into its mesh and preserve child world placement. */
export function applyObjectTransform(doc: ModelDocument, objectId: ObjectId): void {
  const object = doc.objects.get(objectId);
  if (!object) throw new Error(`Object ${objectId} not found`);
  const old = object.transform;
  if (object.meshId) {
    const mesh = doc.meshes.get(object.meshId);
    if (mesh) {
      for (const vertex of mesh.vertices.values()) vertex.position = transformPoint(vertex.position, old);
      bumpPositions(mesh);
      if (transformDeterminantSign(old) < 0) {
        const result = flipFaces(mesh, [...mesh.faces.keys()]);
        if (!result.ok) throw new Error(result.error?.message ?? 'Failed to correct winding');
      }
    }
  }
  for (const childId of object.childIds) {
    const child = doc.objects.get(childId); if (!child) continue;
    child.transform.position = transformPoint(child.transform.position, old);
    child.transform.rotation = { x: child.transform.rotation.x + old.rotation.x, y: child.transform.rotation.y + old.rotation.y, z: child.transform.rotation.z + old.rotation.z };
    child.transform.scale = { x: child.transform.scale.x * old.scale.x, y: child.transform.scale.y * old.scale.y, z: child.transform.scale.z * old.scale.z };
  }
  object.transform = defaultTransform(); doc.dirty = true;
}

export type PivotMode = 'object-origin' | 'selection-centre' | 'bounding-box-centre' | 'median' | 'active-object' | 'individual-origins' | 'custom';

export function objectSelectionPivot(doc: ModelDocument, objectIds: ObjectId[], mode: PivotMode = 'selection-centre', custom = { x: 0, y: 0, z: 0 }) {
  if (mode === 'custom') return { ...custom };
  const objects = objectIds.map((id) => doc.objects.get(id)).filter((o) => !!o);
  if (!objects.length) return { x: 0, y: 0, z: 0 };
  if (mode === 'object-origin' || mode === 'active-object' || mode === 'individual-origins') return { ...objects[objects.length - 1]!.transform.position };
  return objects.reduce((p, o) => ({ x: p.x + o.transform.position.x / objects.length, y: p.y + o.transform.position.y / objects.length, z: p.z + o.transform.position.z / objects.length }), { x: 0, y: 0, z: 0 });
}
