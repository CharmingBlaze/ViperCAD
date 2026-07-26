import { commitMeshObject } from '@/core/document/ModelDocument';
import type { ModelDocument, SceneObject } from '@/core/document/types';
import { importGltf } from '@/core/io/GltfAdapter';
import { importObj } from '@/core/io/ObjAdapter';
import type { EditableMesh } from '@/core/mesh/types';

/** Add mesh assets as hidden, reusable sources for the Terrain Scene Objects palette. */
export function addMeshesToTerrainLibrary(
  document: ModelDocument,
  meshes: EditableMesh[],
  fallbackName = 'Imported Object',
): SceneObject[] {
  return meshes.map((mesh, index) => {
    const name = mesh.name?.trim() || `${fallbackName}${meshes.length > 1 ? ` ${index + 1}` : ''}`;
    const committed = commitMeshObject(document, mesh, { name });
    const object = document.objects.get(committed.objectId)!;
    object.visible = false;
    object.locked = true;
    object.metadata.terrainLibrarySource = 'true';
    return object;
  });
}

export async function importTerrainLibraryFile(
  document: ModelDocument,
  file: File,
): Promise<SceneObject[]> {
  const baseName = file.name.replace(/\.[^.]+$/, '').trim() || 'Imported Object';
  const lowerName = file.name.toLocaleLowerCase();
  if (lowerName.endsWith('.obj')) {
    return addMeshesToTerrainLibrary(
      document,
      [importObj(await file.text(), baseName)],
      baseName,
    );
  }
  if (lowerName.endsWith('.gltf') || lowerName.endsWith('.glb')) {
    return addMeshesToTerrainLibrary(
      document,
      await importGltf(await file.arrayBuffer()),
      baseName,
    );
  }
  throw new Error('Choose an OBJ, glTF, or GLB model file');
}
