import { commitMeshObject } from '@/core/document/ModelDocument';
import type { ObjectId } from '@/core/document/types';
import { buildBox } from '@/core/mesh/builders/BoxBuilder';
import type { EditorSession } from './EditorSession';

/**
 * Create a cube resting on the XZ construction plane (Y = 0).
 * Base sits on the plane; height extends along +Y. Centred in X/Z.
 */
export function createCube(session: EditorSession, size = 1): ObjectId {
  const mesh = buildBox({
    width: size,
    height: size,
    depth: size,
    name: 'Cube',
    centered: false,
  });

  // Shift so base stays on Y=0 and footprint is centred on origin.
  const half = size / 2;
  for (const v of mesh.vertices.values()) {
    v.position.x -= half;
    v.position.z -= half;
  }

  const { objectId, meshId } = commitMeshObject(session.document, mesh, { name: 'Cube' });
  const object = session.document.objects.get(objectId)!;
  const meshRef = session.document.meshes.get(meshId)!;

  let applied = true;
  session.history.execute({
    name: 'Create Cube',
    execute: () => {
      if (applied) return;
      session.document.objects.set(object.id, object);
      session.document.meshes.set(meshRef.id, meshRef);
      if (!session.document.rootObjectIds.includes(object.id)) {
        session.document.rootObjectIds.push(object.id);
      }
      session.document.dirty = true;
      applied = true;
    },
    undo: () => {
      session.document.objects.delete(object.id);
      session.document.rootObjectIds = session.document.rootObjectIds.filter((id) => id !== object.id);
      session.document.meshes.delete(meshRef.id);
      session.document.dirty = true;
      applied = false;
    },
  });

  session.selection.setMode('object');
  session.selection.selectObjects([objectId], 'replace');
  session.requestRedraw();
  return objectId;
}
