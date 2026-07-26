import {
  commitMeshObject,
  createMaterial,
  removeObject,
} from '@/core/document/ModelDocument';
import type {
  ImageId,
  MaterialId,
  ModelDocument,
  ObjectId,
  TextureId,
} from '@/core/document/types';
import type { EditorSession } from '@/core/editor/EditorSession';
import { importImageFile } from '@/core/image/ImageImport';
import { buildPlane } from '@/core/mesh/builders/PlaneBuilder';
import type { MeshId } from '@/core/mesh/types';

export type ImagePlaneResult = {
  objectId: ObjectId;
  meshId: MeshId;
  materialId: MaterialId;
  textureId: TextureId;
  imageId: ImageId;
  width: number;
  height: number;
};

/**
 * Create an upright editable image plane from an existing texture.
 * One logical face is rendered on both sides, so both sides share exactly the
 * same four UV corners.
 */
export function createImagePlane(
  document: ModelDocument,
  options: {
    textureId: TextureId;
    imageId: ImageId;
    imageWidth: number;
    imageHeight: number;
    name?: string;
    maxSize?: number;
  },
): ImagePlaneResult {
  if (!document.textures.has(options.textureId) || !document.images.has(options.imageId)) {
    throw new Error('The imported image texture is unavailable');
  }
  const sourceWidth = Math.max(1, options.imageWidth);
  const sourceHeight = Math.max(1, options.imageHeight);
  const maxSize = Math.max(0.01, options.maxSize ?? 4);
  const scale = maxSize / Math.max(sourceWidth, sourceHeight);
  const width = sourceWidth * scale;
  const height = sourceHeight * scale;
  const name = options.name?.trim() || 'Image Plane';

  const material = createMaterial(document, { name: `${name} Material` });
  material.baseColour = { x: 1, y: 1, z: 1 };
  material.baseColourTextureId = options.textureId;
  material.doubleSided = true;
  material.unlit = true;
  material.shadingModel = 'unlit';
  material.alphaMode = 'blend';
  material.flatShaded = true;

  const texture = document.textures.get(options.textureId)!;
  texture.wrapping = 'clamp';
  texture.filtering = 'nearest';

  const mesh = buildPlane({ width, depth: height, name });
  // PlaneBuilder uses XZ. Rotate its actual vertices into XY so imported art
  // stands upright and faces the default Front/Perspective cameras.
  for (const vertex of mesh.vertices.values()) {
    vertex.position = { x: vertex.position.x, y: vertex.position.z, z: 0 };
  }
  mesh.geometryVersion += 1;
  mesh.dirty.positions = true;
  mesh.dirty.normals = true;
  mesh.dirty.bounds = true;
  mesh.dirty.bvh = true;

  const committed = commitMeshObject(document, mesh, {
    name,
    materialId: material.id,
  });
  const object = document.objects.get(committed.objectId)!;
  object.metadata.imagePlane = 'true';
  object.metadata.sourceImageId = options.imageId;
  object.metadata.sourceTextureId = options.textureId;
  object.metadata.sourceAspect = String(sourceWidth / sourceHeight);

  return {
    ...committed,
    materialId: material.id,
    textureId: options.textureId,
    imageId: options.imageId,
    width,
    height,
  };
}

/** Decode a dropped PNG, create its image plane, and make the whole import undoable. */
export async function importPngAsImagePlane(
  session: EditorSession,
  file: File,
): Promise<ImagePlaneResult> {
  if (file.type !== 'image/png' && !file.name.toLowerCase().endsWith('.png')) {
    throw new Error('Drop a PNG image to create an image plane');
  }
  const name = file.name.replace(/\.png$/i, '') || 'Image Plane';
  const imported = await importImageFile(session.document, file, { name });
  const created = createImagePlane(session.document, {
    textureId: imported.textureId as TextureId,
    imageId: imported.imageId as ImageId,
    imageWidth: imported.width,
    imageHeight: imported.height,
    name,
  });

  const object = session.document.objects.get(created.objectId)!;
  const mesh = session.document.meshes.get(created.meshId)!;
  const material = session.document.materials.get(created.materialId)!;
  const texture = session.document.textures.get(created.textureId)!;
  const image = session.document.images.get(created.imageId)!;
  let applied = true;

  session.history.execute({
    name: 'Import PNG as 3D Object',
    execute: () => {
      if (applied) return;
      session.document.images.set(image.id, image);
      session.document.textures.set(texture.id, texture);
      session.document.materials.set(material.id, material);
      session.document.meshes.set(mesh.id, mesh);
      session.document.objects.set(object.id, object);
      if (!session.document.rootObjectIds.includes(object.id)) {
        session.document.rootObjectIds.push(object.id);
      }
      session.selection.setMode('object');
      session.selection.selectObjects([object.id], 'replace');
      session.document.dirty = true;
      session.requestRedraw();
      applied = true;
    },
    undo: () => {
      removeObject(session.document, object.id, true);
      session.document.materials.delete(material.id);
      session.document.textures.delete(texture.id);
      session.document.images.delete(image.id);
      session.selection.clear();
      session.document.dirty = true;
      session.requestRedraw();
      applied = false;
    },
  });

  session.selection.setMode('object');
  session.selection.selectObjects([created.objectId], 'replace');
  session.document.dirty = true;
  session.requestRedraw();
  return created;
}
