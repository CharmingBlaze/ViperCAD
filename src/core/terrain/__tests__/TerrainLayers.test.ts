import { describe, expect, it } from 'vitest';
import { v3 } from '@/core/math/Vec3';
import { cloneMeshPreserveIds } from '@/core/mesh/EditableMesh';
import { buildPlane } from '@/core/mesh/builders/PlaneBuilder';
import {
  addTerrainLayer,
  fillTerrainWithLayer,
  getTerrainLayerStack,
  initializeTerrainSplatWeights,
  paintTerrainLayerAtPosition,
  removeTerrainLayer,
  setTerrainLayerStack,
  splatWeightsFromColour,
} from '@/core/terrain/TerrainLayers';

describe('TerrainLayers', () => {
  it('initializes default terrain layer stack', () => {
    const mesh = buildPlane({ width: 20, depth: 20 });
    const layers = getTerrainLayerStack(mesh);

    expect(layers.length).toBeGreaterThanOrEqual(4);
    expect(layers[0]!.name).toBe('Grass');
    expect(layers[1]!.name).toBe('Dirt / Soil');
  });

  it('adds and removes terrain material layers in stack', () => {
    const mesh = buildPlane({ width: 20, depth: 20 });
    const initialCount = getTerrainLayerStack(mesh).length;

    const added = addTerrainLayer(mesh, { name: 'Volcanic Lava', color: '#ff4500' });
    expect(added.length).toBe(initialCount + 1);
    expect(added[added.length - 1]!.name).toBe('Volcanic Lava');

    const removed = removeTerrainLayer(mesh, added[added.length - 1]!.id);
    expect(removed.length).toBe(initialCount);
  });

  it('paints active layer weights onto terrain vertices within radius', () => {
    const mesh = buildPlane({ width: 20, depth: 20 });
    initializeTerrainSplatWeights(mesh);
    const painted = paintTerrainLayerAtPosition(mesh, v3(-10, 0, -10), 1, 15, 0.8);

    expect(painted).toBeGreaterThan(0);
    const paintedCorner = [...mesh.faceCorners.values()].find((corner) => (corner.vertexColour?.y ?? 0) > 0.1);
    expect(paintedCorner).toBeTruthy();
    expect(splatWeightsFromColour(paintedCorner!.vertexColour)[1]).toBeGreaterThan(0.2);
  });

  it('flood fills every corner with the selected layer', () => {
    const mesh = buildPlane({ width: 8, depth: 8 });
    initializeTerrainSplatWeights(mesh);
    expect(fillTerrainWithLayer(mesh, 2)).toBeGreaterThan(0);
    for (const corner of mesh.faceCorners.values()) {
      expect(splatWeightsFromColour(corner.vertexColour)[2]).toBeCloseTo(1, 5);
    }
  });

  it('keeps the layer stack across clone/undo snapshots', () => {
    const mesh = buildPlane({ width: 10, depth: 10 });
    addTerrainLayer(mesh, { name: 'Moss', color: '#3f6b3a' });
    const cloned = cloneMeshPreserveIds(mesh);
    expect(getTerrainLayerStack(cloned).some((layer) => layer.name === 'Moss')).toBe(true);
    setTerrainLayerStack(cloned, getTerrainLayerStack(cloned).slice(0, 2));
    expect(getTerrainLayerStack(mesh).some((layer) => layer.name === 'Moss')).toBe(true);
  });
});
