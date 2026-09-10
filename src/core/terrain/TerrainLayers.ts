import type { EditableMesh, FaceCornerId, VertexId } from '@/core/mesh/types';
import { bumpPositions } from '@/core/mesh/EditableMesh';
import type { Vec3 } from '@/core/math/Vec3';

export const MAX_SPLAT_LAYERS = 4;

export type TerrainLayerSpec = {
  id: string;
  name: string;
  textureAssetId?: string;
  color: string;
  tiling: number;
  roughness: number;
  metallic: number;
  visible: boolean;
};

export type TerrainLayerPreset = {
  name: string;
  color: string;
  tiling: number;
  roughness: number;
  metallic: number;
};

export const TERRAIN_LAYER_PRESETS: TerrainLayerPreset[] = [
  { name: 'Grass', color: '#4a7c59', tiling: 8, roughness: 0.8, metallic: 0.0 },
  { name: 'Dirt / Soil', color: '#7a5a3a', tiling: 8, roughness: 0.9, metallic: 0.0 },
  { name: 'Cliff Rock', color: '#686b73', tiling: 12, roughness: 0.7, metallic: 0.1 },
  { name: 'Snow Peak', color: '#e8edf5', tiling: 6, roughness: 0.4, metallic: 0.0 },
  { name: 'Beach Sand', color: '#d4b27d', tiling: 10, roughness: 0.85, metallic: 0.0 },
  { name: 'Cobblestone', color: '#52525b', tiling: 16, roughness: 0.6, metallic: 0.1 },
  { name: 'Asphalt', color: '#27272a', tiling: 14, roughness: 0.9, metallic: 0.0 },
  { name: 'Volcanic Lava', color: '#ef4444', tiling: 8, roughness: 0.3, metallic: 0.2 },
  { name: 'Wet Mud', color: '#453123', tiling: 8, roughness: 0.2, metallic: 0.1 },
];

export const DEFAULT_TERRAIN_LAYERS: TerrainLayerSpec[] = [
  { id: 'layer_grass', name: 'Grass', color: '#4a7c59', tiling: 8, roughness: 0.8, metallic: 0.0, visible: true },
  { id: 'layer_dirt', name: 'Dirt / Soil', color: '#7a5a3a', tiling: 8, roughness: 0.9, metallic: 0.0, visible: true },
  { id: 'layer_rock', name: 'Cliff Rock', color: '#686b73', tiling: 12, roughness: 0.7, metallic: 0.1, visible: true },
  { id: 'layer_snow', name: 'Snow Peak', color: '#e8edf5', tiling: 6, roughness: 0.4, metallic: 0.0, visible: true },
];

export type SplatWeights = [number, number, number, number];

const DEFAULT_SPLAT_COLOUR: Vec3 = { x: 1, y: 0, z: 0 };

/** Retrieve or initialize terrain layer stack from mesh metadata. */
export function getTerrainLayerStack(mesh: EditableMesh): TerrainLayerSpec[] {
  const rawJson = mesh.metadata?.terrainLayers;
  if (rawJson) {
    try {
      const parsed = JSON.parse(rawJson);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed as TerrainLayerSpec[];
      }
    } catch {
      // Fallback to default
    }
  }
  return DEFAULT_TERRAIN_LAYERS;
}

export function meshHasTerrainLayers(mesh: EditableMesh): boolean {
  return typeof mesh.metadata?.terrainLayers === 'string' && mesh.metadata.terrainLayers.length > 2;
}

/** Store updated terrain layer stack into mesh metadata. */
export function setTerrainLayerStack(mesh: EditableMesh, layers: TerrainLayerSpec[]): void {
  mesh.metadata = { ...(mesh.metadata ?? {}), terrainLayers: JSON.stringify(layers) };
  mesh.geometryVersion += 1;
}

/** Seed every face corner with full weight on layer 0 (Grass). */
export function initializeTerrainSplatWeights(mesh: EditableMesh, layerIndex = 0): void {
  const colour = colourFromSplatWeights(unitWeights(layerIndex));
  for (const corner of mesh.faceCorners.values()) {
    corner.vertexColour = { ...colour };
  }
  mesh.geometryVersion += 1;
  mesh.dirty.uvs = true;
}

export function splatWeightsFromColour(colour: Vec3 | null | undefined): SplatWeights {
  const r = clamp01(colour?.x ?? DEFAULT_SPLAT_COLOUR.x);
  const g = clamp01(colour?.y ?? DEFAULT_SPLAT_COLOUR.y);
  const b = clamp01(colour?.z ?? DEFAULT_SPLAT_COLOUR.z);
  return normalizeWeights([r, g, b, Math.max(0, 1 - r - g - b)]);
}

export function colourFromSplatWeights(weights: SplatWeights): Vec3 {
  const next = normalizeWeights(weights);
  return { x: next[0], y: next[1], z: next[2] };
}

export function splatColourForCorner(mesh: EditableMesh, cornerId: FaceCornerId): Vec3 {
  const corner = mesh.faceCorners.get(cornerId);
  return corner?.vertexColour ? { ...corner.vertexColour } : { ...DEFAULT_SPLAT_COLOUR };
}

export function snapshotTerrainSplat(mesh: EditableMesh): Map<FaceCornerId, Vec3 | null> {
  return new Map(
    [...mesh.faceCorners].map(([id, corner]) => [
      id,
      corner.vertexColour ? { ...corner.vertexColour } : null,
    ]),
  );
}

export function restoreTerrainSplat(mesh: EditableMesh, snapshot: Map<FaceCornerId, Vec3 | null>): void {
  for (const [id, colour] of snapshot) {
    const corner = mesh.faceCorners.get(id);
    if (!corner) continue;
    corner.vertexColour = colour ? { ...colour } : null;
  }
  mesh.geometryVersion += 1;
  mesh.dirty.uvs = true;
}

/** Sample splat colour from the nearest terrain vertex (used when resampling). */
export function splatColourAtLocalPoint(mesh: EditableMesh, x: number, z: number): Vec3 {
  const cornersOf = cornersByVertex(mesh);
  let best = { ...DEFAULT_SPLAT_COLOUR };
  let bestDist = Infinity;
  for (const vertex of mesh.vertices.values()) {
    const dist = Math.hypot(vertex.position.x - x, vertex.position.z - z);
    if (dist >= bestDist) continue;
    bestDist = dist;
    const corners = cornersOf.get(vertex.id);
    const colour = corners?.[0]?.vertexColour;
    best = colour ? { ...colour } : { ...DEFAULT_SPLAT_COLOUR };
  }
  return best;
}

/** Appends a new texture layer to terrain stack. */
export function addTerrainLayer(
  mesh: EditableMesh,
  newLayer: Partial<TerrainLayerSpec> = {},
): TerrainLayerSpec[] {
  const current = getTerrainLayerStack(mesh);
  const count = current.length + 1;
  const layer: TerrainLayerSpec = {
    id: `layer_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
    name: newLayer.name ?? `Layer ${count}`,
    color: newLayer.color ?? '#5a7a9a',
    tiling: newLayer.tiling ?? 8,
    roughness: newLayer.roughness ?? 0.7,
    metallic: newLayer.metallic ?? 0.0,
    visible: true,
    textureAssetId: newLayer.textureAssetId,
  };
  const updated = [...current, layer];
  setTerrainLayerStack(mesh, updated);
  return updated;
}

/** Removes a layer from the terrain stack by ID. */
export function removeTerrainLayer(mesh: EditableMesh, layerId: string): TerrainLayerSpec[] {
  const current = getTerrainLayerStack(mesh);
  if (current.length <= 1) return current; // Keep at least 1 layer
  const updated = current.filter((l) => l.id !== layerId);
  setTerrainLayerStack(mesh, updated);
  return updated;
}

/** Updates layer properties by ID. */
export function updateTerrainLayer(
  mesh: EditableMesh,
  layerId: string,
  updates: Partial<TerrainLayerSpec>,
): TerrainLayerSpec[] {
  const current = getTerrainLayerStack(mesh);
  const updated = current.map((l) => (l.id === layerId ? { ...l, ...updates } : l));
  setTerrainLayerStack(mesh, updated);
  return updated;
}

/** Reorders layer in the splatmap stack. */
export function moveTerrainLayer(
  mesh: EditableMesh,
  layerId: string,
  direction: 'up' | 'down',
): TerrainLayerSpec[] {
  const current = [...getTerrainLayerStack(mesh)];
  const idx = current.findIndex((l) => l.id === layerId);
  if (idx < 0) return current;

  const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
  if (targetIdx < 0 || targetIdx >= current.length) return current;

  const temp = current[idx]!;
  current[idx] = current[targetIdx]!;
  current[targetIdx] = temp;

  setTerrainLayerStack(mesh, current);
  return current;
}

/** Duplicates an existing terrain material layer. */
export function duplicateTerrainLayer(mesh: EditableMesh, layerId: string): TerrainLayerSpec[] {
  const current = getTerrainLayerStack(mesh);
  const target = current.find((l) => l.id === layerId);
  if (!target) return current;

  const clone: TerrainLayerSpec = {
    ...target,
    id: `layer_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
    name: `${target.name} Copy`,
  };
  const updated = [...current, clone];
  setTerrainLayerStack(mesh, updated);
  return updated;
}

/** Flood fills the entire terrain mesh with the active material layer. */
export function fillTerrainWithLayer(mesh: EditableMesh, layerIndex: number): number {
  const layers = getTerrainLayerStack(mesh);
  if (layerIndex < 0 || layerIndex >= layers.length) return 0;
  const colour = colourFromSplatWeights(unitWeights(layerIndex));
  let painted = 0;

  for (const corner of mesh.faceCorners.values()) {
    corner.vertexColour = { ...colour };
    painted += 1;
  }

  if (painted > 0) {
    bumpPositions(mesh);
    mesh.dirty.uvs = true;
  }
  return painted;
}

/** Paints active layer weights onto terrain vertices within brush radius. */
export function paintTerrainLayerAtPosition(
  mesh: EditableMesh,
  centerPos: Vec3,
  layerIndex: number,
  radius = 5,
  opacity = 0.5,
  options: { invert?: boolean } = {},
): number {
  const layers = getTerrainLayerStack(mesh);
  if (layerIndex < 0 || layerIndex >= layers.length) return 0;

  const targetIndex = layerIndex % MAX_SPLAT_LAYERS;
  const invert = !!options.invert;
  const cornersOf = cornersByVertex(mesh);
  let painted = 0;

  for (const vertex of mesh.vertices.values()) {
    const dist = Math.hypot(vertex.position.x - centerPos.x, vertex.position.z - centerPos.z);
    if (dist > radius) continue;

    const falloff = 1 - Math.min(1, dist / Math.max(0.1, radius));
    const blend = falloff * opacity;
    if (blend <= 0.01) continue;

    const corners = cornersOf.get(vertex.id);
    if (!corners?.length) continue;

    for (const corner of corners) {
      const current = splatWeightsFromColour(corner.vertexColour);
      const next = invert
        ? eraseLayerWeight(current, targetIndex, blend)
        : mixTowardLayer(current, targetIndex, blend);
      corner.vertexColour = colourFromSplatWeights(next);
      painted += 1;
    }
  }

  if (painted > 0) {
    bumpPositions(mesh);
    mesh.dirty.uvs = true;
  }
  return painted;
}

function cornersByVertex(mesh: EditableMesh): Map<VertexId, { id: FaceCornerId; vertexColour: Vec3 | null }[]> {
  const map = new Map<VertexId, { id: FaceCornerId; vertexColour: Vec3 | null }[]>();
  for (const corner of mesh.faceCorners.values()) {
    const list = map.get(corner.vertexId);
    const entry = corner;
    if (list) list.push(entry);
    else map.set(corner.vertexId, [entry]);
  }
  return map;
}

function unitWeights(layerIndex: number): SplatWeights {
  const weights: SplatWeights = [0, 0, 0, 0];
  weights[layerIndex % MAX_SPLAT_LAYERS] = 1;
  return weights;
}

function mixTowardLayer(current: SplatWeights, layerIndex: number, amount: number): SplatWeights {
  const target = unitWeights(layerIndex);
  const t = clamp01(amount);
  return normalizeWeights([
    current[0] + (target[0] - current[0]) * t,
    current[1] + (target[1] - current[1]) * t,
    current[2] + (target[2] - current[2]) * t,
    current[3] + (target[3] - current[3]) * t,
  ]);
}

function eraseLayerWeight(current: SplatWeights, layerIndex: number, amount: number): SplatWeights {
  const next: SplatWeights = [...current];
  next[layerIndex] = current[layerIndex] * (1 - clamp01(amount));
  return normalizeWeights(next);
}

function normalizeWeights(weights: SplatWeights): SplatWeights {
  const clamped: SplatWeights = [
    Math.max(0, weights[0]),
    Math.max(0, weights[1]),
    Math.max(0, weights[2]),
    Math.max(0, weights[3]),
  ];
  const sum = clamped[0] + clamped[1] + clamped[2] + clamped[3];
  if (sum <= 1e-6) return [1, 0, 0, 0];
  return [clamped[0] / sum, clamped[1] / sum, clamped[2] / sum, clamped[3] / sum];
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, Number(value) || 0));
}
