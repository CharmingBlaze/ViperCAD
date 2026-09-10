import { describe, expect, it } from 'vitest';
import { v3 } from '@/core/math/Vec3';
import { buildPlane } from '@/core/mesh/builders/PlaneBuilder';
import { generateBuildingMesh, generateRoadGridMesh } from '@/core/level/CityGenerator';
import { buildBridgeMesh, carveCaveTunnel, generateWaterfallMesh } from '@/core/level/InfrastructureBuilder';
import { autoPaintTerrainMesh } from '@/core/terrain/TerrainAutoPaint';

describe('CityGenerator & Infrastructure', () => {
  it('generates 3D skyscraper building mesh with roof parapet', () => {
    const building = generateBuildingMesh({
      width: 8,
      depth: 8,
      floors: 6,
      style: 'skyscraper',
    });

    expect(building.vertices.size).toBeGreaterThan(0);
    expect(building.faces.size).toBeGreaterThan(0);
  });

  it('generates road grid mesh with sidewalk street light positions', () => {
    const { roadMesh, lampPositions } = generateRoadGridMesh(2, 2, 12, 4);

    expect(roadMesh.vertices.size).toBeGreaterThan(0);
    expect(lampPositions.length).toBeGreaterThan(0);
  });

  it('builds girder bridge mesh across canyon', () => {
    const bridge = buildBridgeMesh(v3(-10, 0, 0), v3(10, 0, 0), { width: 4, archHeight: 1 });

    expect(bridge.vertices.size).toBeGreaterThan(0);
    expect(bridge.faces.size).toBeGreaterThan(0);
  });

  it('carves 3D hollow cave tunnel into cliff mesh', () => {
    const cliff = buildPlane({ width: 20, depth: 20 });
    const affected = carveCaveTunnel(cliff, v3(-10, 0, -10), 15, 25);

    expect(affected).toBeGreaterThan(0);
  });

  it('generates vertical waterfall ribbon mesh', () => {
    const waterfall = generateWaterfallMesh(v3(0, 10, 0), v3(0, 0, 0), 4);

    expect(waterfall.vertices.size).toBeGreaterThan(0);
    expect(waterfall.faces.size).toBeGreaterThan(0);
  });

  it('auto-paints terrain UV layers based on slope and height', () => {
    const terrainMesh = buildPlane({ width: 20, depth: 20 });
    const painted = autoPaintTerrainMesh(terrainMesh, { cliffMinAngleDeg: 30 });

    expect(painted).toBeGreaterThan(0);
  });
});
