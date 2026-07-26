import {
  addObjectToDocument,
  commitMeshObject,
  createMaterial,
  removeObject,
} from '@/core/document/ModelDocument';
import type {
  MaterialAsset,
  ModelDocument,
  ObjectId,
  SceneObject,
  TextureId,
} from '@/core/document/types';
import type { EditorSession } from '@/core/editor/EditorSession';
import { v2 } from '@/core/math/Vec2';
import type { Vec3 } from '@/core/math/Vec3';
import { MeshBuilder } from '@/core/mesh/MeshBuilder';
import type { EditableMesh } from '@/core/mesh/types';

export type TerrainFeatureKind = 'river' | 'path' | 'lake' | 'ocean';

export type TerrainFeatureStyle = {
  textureId?: TextureId | null;
  colour?: Vec3;
  opacity?: number;
  animated?: boolean;
  flowSpeed?: number;
  textureScale?: number;
};

export function buildTerrainRibbon(
  points: Vec3[],
  width: number,
  textureScale = 2,
  name = 'Terrain Ribbon',
): EditableMesh {
  if (points.length < 2) throw new Error('Draw a longer stroke to create this feature');
  const builder = new MeshBuilder(name);
  const halfWidth = Math.max(0.025, width) / 2;
  const left: string[] = [];
  const right: string[] = [];
  const distances = [0];

  for (let index = 0; index < points.length; index++) {
    const point = points[index]!;
    const previous = points[Math.max(0, index - 1)]!;
    const next = points[Math.min(points.length - 1, index + 1)]!;
    let dx = next.x - previous.x;
    let dz = next.z - previous.z;
    const length = Math.hypot(dx, dz) || 1;
    dx /= length;
    dz /= length;
    const sideX = -dz * halfWidth;
    const sideZ = dx * halfWidth;
    left.push(builder.vertex({ x: point.x + sideX, y: point.y, z: point.z + sideZ }));
    right.push(builder.vertex({ x: point.x - sideX, y: point.y, z: point.z - sideZ }));
    if (index > 0) {
      const before = points[index - 1]!;
      distances[index] =
        distances[index - 1]! +
        Math.hypot(point.x - before.x, point.y - before.y, point.z - before.z);
    }
  }

  const repeat = Math.max(0.1, textureScale);
  for (let index = 0; index < points.length - 1; index++) {
    const v0 = distances[index]! / repeat;
    const v1 = distances[index + 1]! / repeat;
    builder.quad(
      left[index]!,
      left[index + 1]!,
      right[index + 1]!,
      right[index]!,
      [v2(0, v0), v2(0, v1), v2(1, v1), v2(1, v0)],
    );
  }
  return builder.build();
}

export function buildLakeMesh(
  radius: number,
  segments = 48,
  shorelineVariation = 0.1,
): EditableMesh {
  const builder = new MeshBuilder('Lake');
  const count = Math.max(8, Math.min(128, Math.round(segments)));
  const r = Math.max(0.1, radius);
  const variation = clamp(shorelineVariation, 0, 0.22);
  const ids = [];
  const uvs = [];
  for (let index = 0; index < count; index++) {
    const angle = -(index / count) * Math.PI * 2;
    const edge =
      r *
      (1 +
        variation *
          (
            Math.sin(angle * 3 + 0.7) * 0.48 +
            Math.sin(angle * 5 - 1.1) * 0.3 +
            Math.sin(angle * 9 + 2.2) * 0.22
          ));
    const x = Math.cos(angle) * edge;
    const z = Math.sin(angle) * edge;
    ids.push(builder.vertex({ x, y: 0, z }));
    uvs.push(v2(x / (r * 2) + 0.5, z / (r * 2) + 0.5));
  }
  builder.ngon(ids, uvs);
  return builder.build();
}

export function buildOceanMesh(size: number): EditableMesh {
  const builder = new MeshBuilder('Ocean');
  const half = Math.max(0.1, size) / 2;
  const a = builder.vertex({ x: -half, y: 0, z: -half });
  const b = builder.vertex({ x: -half, y: 0, z: half });
  const c = builder.vertex({ x: half, y: 0, z: half });
  const d = builder.vertex({ x: half, y: 0, z: -half });
  builder.quad(a, b, c, d, [v2(0, 0), v2(0, 8), v2(8, 8), v2(8, 0)]);
  return builder.build();
}

export function createTerrainFeatureMaterial(
  document: ModelDocument,
  kind: TerrainFeatureKind,
  style: TerrainFeatureStyle,
): MaterialAsset {
  const water = kind !== 'path';
  const material = createMaterial(document, {
    name: water ? `${title(kind)} Water` : 'Terrain Path',
  });
  material.baseColour = style.colour ?? (water
    ? { x: 0.08, y: 0.42, z: 0.66 }
    : { x: 0.3, y: 0.22, z: 0.14 });
  material.baseColourTextureId = style.textureId ?? null;
  material.opacity = water ? clamp(style.opacity ?? 0.72, 0.05, 1) : 1;
  material.alphaMode = material.opacity < 1 ? 'blend' : 'opaque';
  material.roughness = water ? 0.16 : 0.82;
  material.metallic = water ? 0.12 : 0;
  material.doubleSided = true;
  material.flatShaded = false;
  material.textureFiltering = 'linear';
  material.textureWrapping = 'repeat';
  return material;
}

export function commitTerrainFeature(
  session: EditorSession,
  terrainObjectId: ObjectId,
  kind: TerrainFeatureKind,
  mesh: EditableMesh,
  style: TerrainFeatureStyle,
): SceneObject {
  const material = createTerrainFeatureMaterial(session.document, kind, style);
  const committed = commitMeshObject(session.document, mesh, {
    name: title(kind),
    materialId: material.id,
  });
  const object = session.document.objects.get(committed.objectId)!;
  object.metadata = {
    terrainFeature: kind,
    terrainOwnerId: terrainObjectId,
    waterAnimated: kind !== 'path' && style.animated ? 'true' : 'false',
    waterFlowSpeed: String(clamp(style.flowSpeed ?? 0.12, -4, 4)),
    textureScale: String(Math.max(0.1, style.textureScale ?? 2)),
  };

  const savedObject = cloneObject(object);
  let applied = true;
  session.history.execute({
    name: `Create ${title(kind)}`,
    execute: () => {
      if (applied) return;
      session.document.materials.set(material.id, material);
      session.document.meshes.set(mesh.id, mesh);
      addObjectToDocument(session.document, cloneObject(savedObject));
      session.requestRedraw();
      applied = true;
    },
    undo: () => {
      removeObject(session.document, object.id, true);
      session.document.materials.delete(material.id);
      session.document.dirty = true;
      session.requestRedraw();
      applied = false;
    },
  });
  session.selection.setMode('object');
  session.selection.selectObjects([object.id], 'replace');
  session.document.dirty = true;
  session.requestRedraw();
  return object;
}

function cloneObject(object: SceneObject): SceneObject {
  return {
    ...object,
    childIds: [...object.childIds],
    materialSlotIds: [...object.materialSlotIds],
    transform: {
      position: { ...object.transform.position },
      rotation: { ...object.transform.rotation },
      scale: { ...object.transform.scale },
    },
    metadata: { ...object.metadata },
  };
}

function title(kind: TerrainFeatureKind): string {
  return kind[0]!.toUpperCase() + kind.slice(1);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Number(value) || 0));
}
