import {
  commitMeshObject,
  createMaterial,
  removeObject,
} from '@/core/document/ModelDocument';
import type { ObjectId } from '@/core/document/types';
import type { EditorSession } from '@/core/editor/EditorSession';
import { createImageAsset, createTextureAsset } from '@/core/image/PixelEditor';
import { v2 } from '@/core/math/Vec2';
import { v3 } from '@/core/math/Vec3';
import { MeshBuilder } from '@/core/mesh/MeshBuilder';
import { faceCornerIds } from '@/core/mesh/EditableMesh';
import type { EditableMesh, MeshId } from '@/core/mesh/types';

export type TerrainOptions = {
  name?: string;
  size?: number;
  resolution?: number;
  tileRepeat?: number;
};

export type TerrainAsset = {
  objectId: ObjectId;
  meshId: MeshId;
  size: number;
  resolution: number;
};

export function buildTerrainMesh(options: TerrainOptions = {}): EditableMesh {
  const size = clamp(options.size ?? 20, 1, 1000);
  const resolution = Math.round(clamp(options.resolution ?? 32, 2, 64));
  const name = options.name?.trim() || 'Terrain';
  const builder = new MeshBuilder(name, false);
  const vertices: string[][] = [];

  for (let z = 0; z <= resolution; z++) {
    const row: string[] = [];
    for (let x = 0; x <= resolution; x++) {
      row.push(builder.vertex(v3(
        (x / resolution - 0.5) * size,
        0,
        (z / resolution - 0.5) * size,
      )));
    }
    vertices.push(row);
  }

  for (let z = 0; z < resolution; z++) {
    for (let x = 0; x < resolution; x++) {
      const u0 = x / resolution;
      const u1 = (x + 1) / resolution;
      const v0 = z / resolution;
      const v1 = (z + 1) / resolution;
      builder.quad(
        vertices[z]![x]!,
        vertices[z + 1]![x]!,
        vertices[z + 1]![x + 1]!,
        vertices[z]![x + 1]!,
        [v2(u0, v0), v2(u0, v1), v2(u1, v1), v2(u1, v0)],
      );
    }
  }
  return builder.build();
}

export function createTerrain(session: EditorSession, options: TerrainOptions = {}): TerrainAsset {
  const document = session.document;
  const index = [...document.objects.values()].filter((object) => object.metadata.terrain === 'true').length + 1;
  const name = options.name?.trim() || `Terrain ${index}`;
  const size = clamp(options.size ?? 20, 1, 1000);
  const resolution = Math.round(clamp(options.resolution ?? 32, 2, 64));
  const tileRepeat = Math.round(clamp(options.tileRepeat ?? 8, 1, 128));
  const mesh = buildTerrainMesh({ name, size, resolution });

  const image = createImageAsset(document, `${name} Paint`, 256, 256, [104, 132, 82, 255]);
  const texture = createTextureAsset(document, image, `${name} Surface`);
  texture.filtering = 'linear';
  texture.wrapping = 'repeat';
  texture.generateMipmaps = true;
  const material = createMaterial(document, { name: `${name} Material` });
  material.baseColour = v3(1, 1, 1);
  material.baseColourTextureId = texture.id;
  material.roughness = 0.92;
  material.metallic = 0;
  material.doubleSided = false;

  const committed = commitMeshObject(document, mesh, { name, materialId: material.id });
  const object = document.objects.get(committed.objectId)!;
  object.metadata.terrain = 'true';
  object.metadata.terrainSize = String(size);
  object.metadata.terrainResolution = String(resolution);
  object.metadata.terrainTileRepeat = String(tileRepeat);
  object.metadata.gameRole = 'terrain';
  applyTerrainTileRepeat(mesh, tileRepeat);

  let applied = true;
  session.history.execute({
    name: 'Create Terrain',
    execute: () => {
      if (applied) return;
      document.images.set(image.id, image);
      document.textures.set(texture.id, texture);
      document.materials.set(material.id, material);
      document.meshes.set(mesh.id, mesh);
      document.objects.set(object.id, object);
      if (!document.rootObjectIds.includes(object.id)) document.rootObjectIds.push(object.id);
      session.selection.setMode('object');
      session.selection.selectObjects([object.id], 'replace');
      document.dirty = true;
      session.requestRedraw();
      applied = true;
    },
    undo: () => {
      removeObject(document, object.id, true);
      document.materials.delete(material.id);
      document.textures.delete(texture.id);
      document.images.delete(image.id);
      session.selection.clear();
      document.dirty = true;
      session.requestRedraw();
      applied = false;
    },
  });

  session.selection.setMode('object');
  session.selection.selectObjects([object.id], 'replace');
  document.dirty = true;
  session.requestRedraw();
  return { ...committed, size, resolution };
}

export function activeTerrain(session: EditorSession) {
  const objectId = session.selection.state.activeObjectId;
  const object = objectId ? session.document.objects.get(objectId) : null;
  const mesh = object?.meshId ? session.document.meshes.get(object.meshId) : null;
  return object?.metadata.terrain === 'true' && mesh ? { object, mesh } : null;
}

export function applyTerrainTileRepeat(mesh: EditableMesh, repeat: number): void {
  const layerId = mesh.defaultUvLayerId;
  if (!layerId) return;
  const amount = clamp(repeat, 1, 128);
  const xs = [...mesh.vertices.values()].map((vertex) => vertex.position.x);
  const zs = [...mesh.vertices.values()].map((vertex) => vertex.position.z);
  const minX = Math.min(...xs);
  const minZ = Math.min(...zs);
  const spanX = Math.max(1e-8, Math.max(...xs) - minX);
  const spanZ = Math.max(1e-8, Math.max(...zs) - minZ);
  for (const face of mesh.faces.values()) {
    for (const cornerId of faceCornerIds(mesh, face.id)) {
      const corner = mesh.faceCorners.get(cornerId)!;
      const vertex = mesh.vertices.get(corner.vertexId)!;
      // Terrain vertices are centred; derive stable normalized coordinates from bounds.
      corner.uvs.set(layerId, {
        x: ((vertex.position.x - minX) / spanX) * amount,
        y: ((vertex.position.z - minZ) / spanZ) * amount,
      });
    }
  }
  mesh.geometryVersion += 1;
  mesh.dirty.uvs = true;
}

export function terrainHeightRange(mesh: EditableMesh): { min: number; max: number } {
  let min = Infinity;
  let max = -Infinity;
  for (const vertex of mesh.vertices.values()) {
    min = Math.min(min, vertex.position.y);
    max = Math.max(max, vertex.position.y);
  }
  return Number.isFinite(min) ? { min, max } : { min: 0, max: 0 };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Number(value) || min));
}
