import type { EditableMesh } from '@/core/mesh/types';
import { bumpPositions, faceCornerIds } from '@/core/mesh/EditableMesh';
import type { Vec3 } from '@/core/math/Vec3';

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

export const DEFAULT_TERRAIN_LAYERS: TerrainLayerSpec[] = [
  { id: 'layer_grass', name: 'Grass', color: '#4a7c59', tiling: 8, roughness: 0.8, metallic: 0.0, visible: true },
  { id: 'layer_dirt', name: 'Dirt / Soil', color: '#7a5a3a', tiling: 8, roughness: 0.9, metallic: 0.0, visible: true },
  { id: 'layer_rock', name: 'Cliff Rock', color: '#686b73', tiling: 12, roughness: 0.7, metallic: 0.1, visible: true },
  { id: 'layer_snow', name: 'Snow Peak', color: '#e8edf5', tiling: 6, roughness: 0.4, metallic: 0.0, visible: true },
];

/** Retrieve or initialize terrain layer stack from mesh metadata. */
export function getTerrainLayerStack(mesh: EditableMesh): TerrainLayerSpec[] {
  const defaultLayer = mesh.defaultUvLayerId;
  if (!defaultLayer) return DEFAULT_TERRAIN_LAYERS;

  const rawJson = (mesh as unknown as { metadata?: Record<string, string> }).metadata?.terrainLayers;
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

/** Store updated terrain layer stack into mesh metadata. */
export function setTerrainLayerStack(mesh: EditableMesh, layers: TerrainLayerSpec[]): void {
  const meta = (mesh as unknown as { metadata?: Record<string, string> }).metadata ?? {};
  meta.terrainLayers = JSON.stringify(layers);
  (mesh as unknown as { metadata?: Record<string, string> }).metadata = meta;
  mesh.geometryVersion += 1;
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

/** Paints active layer weights onto terrain vertices within brush radius. */
export function paintTerrainLayerAtPosition(
  mesh: EditableMesh,
  centerPos: Vec3,
  layerIndex: number,
  radius = 5,
  opacity = 0.5,
): number {
  let painted = 0;
  const layers = getTerrainLayerStack(mesh);
  if (layerIndex < 0 || layerIndex >= layers.length) return 0;
  const layer = layers[layerIndex]!;
  const layerId = mesh.defaultUvLayerId;
  if (!layerId) return 0;

  // Layer UV offset mapping
  const uOffset = (layerIndex % 4) * 0.25;
  const vOffset = Math.floor(layerIndex / 4) * 0.25;

  for (const vertex of mesh.vertices.values()) {
    const dist = Math.hypot(vertex.position.x - centerPos.x, vertex.position.z - centerPos.z);
    if (dist > radius) continue;

    const falloff = 1 - Math.min(1, dist / Math.max(0.1, radius));
    const weight = falloff * opacity;
    if (weight <= 0.01) continue;

    // Assign painted layer UV coordinates to associated face corners
    for (const face of mesh.faces.values()) {
      for (const cornerId of faceCornerIds(mesh, face.id)) {
        const corner = mesh.faceCorners.get(cornerId)!;
        if (corner.vertexId === vertex.id) {
          const uv = corner.uvs.get(layerId) ?? { x: 0, y: 0 };
          corner.uvs.set(layerId, {
            x: (uv.x % 0.25) + uOffset,
            y: (uv.y % 0.25) + vOffset,
          });
          painted += 1;
        }
      }
    }
  }

  if (painted > 0) {
    bumpPositions(mesh);
    mesh.dirty.uvs = true;
  }
  return painted;
}
