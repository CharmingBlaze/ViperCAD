import { describe, expect, it } from 'vitest';
import { v3 } from '@/core/math/Vec3';
import { buildPlane } from '@/core/mesh/builders/PlaneBuilder';
import {
  addTerrainLayer,
  getTerrainLayerStack,
  paintTerrainLayerAtPosition,
  removeTerrainLayer,
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
    const painted = paintTerrainLayerAtPosition(mesh, v3(-10, 0, -10), 1, 15, 0.8);

    expect(painted).toBeGreaterThan(0);
  });
});
