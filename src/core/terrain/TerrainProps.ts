import {
  commitMeshObject,
  createMaterial,
} from '@/core/document/ModelDocument';
import type {
  ModelDocument,
  ObjectId,
  SceneObject,
} from '@/core/document/types';
import { v3, type Vec3 } from '@/core/math/Vec3';
import {
  buildBox,
  buildCone,
  buildCylinder,
  buildSphere,
} from '@/core/mesh/builders';
import type { EditableMesh } from '@/core/mesh/types';

export type TerrainPropPreset = 'building' | 'tree' | 'rock' | 'column';

export type TerrainPropPresetDefinition = {
  id: TerrainPropPreset;
  label: string;
  description: string;
  colour: Vec3;
  baseOffset: number;
  defaultScale: Vec3;
};

export const TERRAIN_PROP_PRESETS: TerrainPropPresetDefinition[] = [
  {
    id: 'building',
    label: 'Building',
    description: 'Blockout building',
    colour: v3(0.48, 0.53, 0.59),
    baseOffset: 1.25,
    defaultScale: v3(1, 1, 1),
  },
  {
    id: 'tree',
    label: 'Tree',
    description: 'Low-poly pine',
    colour: v3(0.2, 0.48, 0.23),
    baseOffset: 1.5,
    defaultScale: v3(1, 1, 1),
  },
  {
    id: 'rock',
    label: 'Rock',
    description: 'Scatter-ready rock',
    colour: v3(0.42, 0.4, 0.36),
    baseOffset: 0.45,
    defaultScale: v3(1.2, 0.72, 1),
  },
  {
    id: 'column',
    label: 'Column',
    description: 'Level structure',
    colour: v3(0.62, 0.58, 0.5),
    baseOffset: 1.25,
    defaultScale: v3(1, 1, 1),
  },
];

export function terrainPropPreset(id: TerrainPropPreset): TerrainPropPresetDefinition {
  return TERRAIN_PROP_PRESETS.find((preset) => preset.id === id)!;
}

export function ensureTerrainPresetSource(
  document: ModelDocument,
  presetId: TerrainPropPreset,
): SceneObject {
  const existing = [...document.objects.values()].find(
    (object) => object.metadata.terrainPresetSource === presetId,
  );
  if (existing) {
    repairTerrainPresetSource(document, existing);
    return existing;
  }

  const preset = terrainPropPreset(presetId);
  const mesh = buildTerrainPresetMesh(presetId);
  const material = createMaterial(document, { name: `${preset.label} Level Material` });
  material.baseColour = { ...preset.colour };
  material.roughness = 0.86;
  material.flatShaded = presetId !== 'column';
  const committed = commitMeshObject(document, mesh, {
    name: `${preset.label} Brush`,
    materialId: material.id,
  });
  const source = document.objects.get(committed.objectId)!;
  source.visible = false;
  source.locked = true;
  source.metadata.terrainPaletteSource = 'true';
  source.metadata.terrainPresetSource = presetId;
  source.metadata.terrainPresetWinding = 'outward-v2';
  source.metadata.terrainBaseOffset = String(preset.baseOffset);
  source.transform.scale = { ...preset.defaultScale };
  return source;
}

/** Repair cone/cylinder sources created before outward face winding was corrected. */
export function repairTerrainPresetSources(document: ModelDocument): number {
  let repaired = 0;
  for (const object of document.objects.values()) {
    if (!object.metadata.terrainPresetSource) continue;
    if (repairTerrainPresetSource(document, object)) repaired += 1;
  }
  return repaired;
}

function repairTerrainPresetSource(
  document: ModelDocument,
  source: SceneObject,
): boolean {
  const preset = source.metadata.terrainPresetSource as TerrainPropPreset | undefined;
  if (
    (preset !== 'tree' && preset !== 'column') ||
    source.metadata.terrainPresetWinding === 'outward-v2' ||
    !source.meshId
  ) return false;
  const previous = document.meshes.get(source.meshId);
  if (!previous) return false;
  const repaired = buildTerrainPresetMesh(preset);
  repaired.id = previous.id;
  repaired.name = previous.name;
  repaired.topologyVersion = previous.topologyVersion + 1;
  repaired.geometryVersion = previous.geometryVersion + 1;
  document.meshes.set(previous.id, repaired);
  source.metadata.terrainPresetWinding = 'outward-v2';
  document.dirty = true;
  return true;
}

export function projectTerrainPropSources(document: ModelDocument): SceneObject[] {
  return [...document.objects.values()].filter(
    (object) =>
      !!object.meshId &&
      (object.visible || object.metadata.terrainLibrarySource === 'true') &&
      object.metadata.terrain !== 'true' &&
      !object.metadata.terrainFeature &&
      object.metadata.terrainPlaced !== 'true' &&
      object.metadata.terrainPaletteSource !== 'true',
  );
}

export function terrainPlacedObjects(
  document: ModelDocument,
  terrainObjectId?: ObjectId | null,
): SceneObject[] {
  return [...document.objects.values()].filter(
    (object) =>
      object.metadata.terrainPlaced === 'true' &&
      (!terrainObjectId || object.metadata.terrainOwnerId === terrainObjectId),
  );
}

export function terrainHeightAtLocalPoint(
  terrain: SceneObject,
  mesh: EditableMesh,
  x: number,
  z: number,
): number {
  const resolution = Math.max(2, Number(terrain.metadata.terrainResolution) || 2);
  const size = Math.max(1e-6, Number(terrain.metadata.terrainSize) || 1);
  const vertices = [...mesh.vertices.values()];
  const side = resolution + 1;
  if (vertices.length !== side * side) return nearestHeight(vertices, x, z);

  const gx = clamp((x / size + 0.5) * resolution, 0, resolution);
  const gz = clamp((z / size + 0.5) * resolution, 0, resolution);
  const x0 = Math.min(resolution - 1, Math.floor(gx));
  const z0 = Math.min(resolution - 1, Math.floor(gz));
  const tx = gx - x0;
  const tz = gz - z0;
  const y00 = vertices[z0 * side + x0]!.position.y;
  const y10 = vertices[z0 * side + x0 + 1]!.position.y;
  const y01 = vertices[(z0 + 1) * side + x0]!.position.y;
  const y11 = vertices[(z0 + 1) * side + x0 + 1]!.position.y;
  const a = y00 + (y10 - y00) * tx;
  const b = y01 + (y11 - y01) * tx;
  return a + (b - a) * tz;
}

export function buildTerrainPresetMesh(preset: TerrainPropPreset): EditableMesh {
  if (preset === 'building') {
    return buildBox({ width: 2.4, height: 2.5, depth: 2.4, name: 'Building' });
  }
  if (preset === 'tree') {
    return buildCone({
      radius: 1,
      height: 3,
      radialSegments: 8,
      name: 'Tree',
      capped: true,
    });
  }
  if (preset === 'rock') {
    return buildSphere({
      radius: 0.65,
      widthSegments: 8,
      heightSegments: 5,
      name: 'Rock',
    });
  }
  return buildCylinder({
    radius: 0.45,
    height: 2.5,
    radialSegments: 12,
    name: 'Column',
    capped: true,
  });
}

function nearestHeight(
  vertices: Iterable<{ position: Vec3 }>,
  x: number,
  z: number,
): number {
  let best = Infinity;
  let height = 0;
  for (const vertex of vertices) {
    const distance = Math.hypot(vertex.position.x - x, vertex.position.z - z);
    if (distance < best) {
      best = distance;
      height = vertex.position.y;
    }
  }
  return height;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
