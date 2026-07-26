import { beforeEach, describe, expect, it } from 'vitest';
import { createEmptyDocument } from '@/core/document/ModelDocument';
import { EditorSession } from '@/core/editor/EditorSession';
import { resetIdCounter } from '@/core/ids/IdService';
import { getMeshStats } from '@/core/mesh/EditableMesh';
import { validateMeshFull } from '@/core/mesh/Validation';
import {
  buildLakeMesh,
  buildOceanMesh,
  buildTerrainRibbon,
  commitLakeWithCarve,
  commitPathWithCarve,
  commitRiverWithCarve,
  commitTerrainFeature,
} from '@/core/terrain/TerrainFeatures';
import { createTerrain } from '@/core/terrain/Terrain';
import { carveTerrainBasin, carveTerrainChannel } from '@/core/terrain/WaterCarve';
import { TerrainFeatureTool } from '@/core/tools/TerrainFeatureTool';
import type { ToolPointerInput } from '@/core/tools/Tool';

beforeEach(() => resetIdCounter(1));

describe('terrain water and path features', () => {
  it('builds a valid UV-ready ribbon along a terrain stroke', () => {
    const mesh = buildTerrainRibbon(
      [
        { x: 0, y: 2, z: 0 },
        { x: 3, y: 3, z: 1 },
        { x: 7, y: 5, z: 0 },
      ],
      2,
      2,
      'River',
    );
    expect(validateMeshFull(mesh).ok).toBe(true);
    expect(getMeshStats(mesh)).toMatchObject({ verts: 6, faces: 2 });
    expect([...mesh.faceCorners.values()].every((corner) => corner.uvs.size > 0)).toBe(true);
  });

  it('builds subdivided lake and ocean surfaces', () => {
    const lake = buildLakeMesh(8);
    const ocean = buildOceanMesh(100);
    expect(validateMeshFull(lake).ok).toBe(true);
    expect(validateMeshFull(ocean).ok).toBe(true);
    expect(getMeshStats(lake).faces).toBeGreaterThan(48);
    expect(getMeshStats(ocean).faces).toBeGreaterThan(1);
  });

  it('creates animated water as an ordinary undoable scene object', () => {
    const session = new EditorSession(createEmptyDocument());
    const object = commitTerrainFeature(
      session,
      'terrain-owner',
      'lake',
      buildLakeMesh(4),
      { animated: true, flowSpeed: 0.3, opacity: 0.65 },
    );
    expect(object.metadata.terrainFeature).toBe('lake');
    expect(object.metadata.waterAnimated).toBe('true');
    expect(session.document.materials.get(object.materialSlotIds[0]!)?.opacity).toBe(0.65);

    expect(session.undo()).toBe(true);
    expect(session.document.objects.has(object.id)).toBe(false);
    expect(session.redo()).toBe(true);
    expect(session.document.objects.has(object.id)).toBe(true);
  });

  it('carves a soft channel into the heightmap along a polyline', () => {
    const session = new EditorSession(createEmptyDocument());
    const terrain = createTerrain(session, { size: 20, resolution: 16 });
    const mesh = session.document.meshes.get(terrain.meshId)!;
    const before = [...mesh.vertices.values()].map((vertex) => vertex.position.y);
    const affected = carveTerrainChannel(
      mesh,
      [
        { x: -4, z: 0 },
        { x: 0, z: 0 },
        { x: 4, z: 0 },
      ],
      3,
      1.2,
    );
    expect(affected).toBeGreaterThan(10);
    const after = [...mesh.vertices.values()].map((vertex) => vertex.position.y);
    expect(Math.min(...after)).toBeLessThan(Math.min(...before) - 0.4);
  });

  it('carves a lake basin below the water plane', () => {
    const session = new EditorSession(createEmptyDocument());
    const terrain = createTerrain(session, { size: 20, resolution: 16 });
    const mesh = session.document.meshes.get(terrain.meshId)!;
    // Raise the centre so there is something to push down.
    for (const vertex of mesh.vertices.values()) {
      const dist = Math.hypot(vertex.position.x, vertex.position.z);
      if (dist < 5) vertex.position.y = 1.5;
    }
    carveTerrainBasin(mesh, 0, 0, 4, 1.2, { waterLevel: 0.2 });
    const centre = [...mesh.vertices.values()].find(
      (vertex) => Math.hypot(vertex.position.x, vertex.position.z) < 0.6,
    )!;
    expect(centre.position.y).toBeLessThan(0.2);
  });

  it('river carve depresses terrain and undoes water + heights together', () => {
    const session = new EditorSession(createEmptyDocument());
    const terrain = createTerrain(session, { size: 20, resolution: 12 });
    const mesh = session.document.meshes.get(terrain.meshId)!;
    for (const vertex of mesh.vertices.values()) {
      vertex.position.y = 2;
    }
    const beforeMin = Math.min(...[...mesh.vertices.values()].map((v) => v.position.y));

    const river = commitRiverWithCarve(
      session,
      terrain.objectId,
      [
        { x: -4, y: 2, z: -1 },
        { x: 0, y: 2, z: 0 },
        { x: 4, y: 2, z: 1 },
      ],
      2.5,
      { carve: true, carveDepth: 1.1, animated: true, opacity: 0.7 },
    );
    expect(river).toBeTruthy();
    expect(river!.metadata.waterCarved).toBe('true');
    const afterMin = Math.min(...[...mesh.vertices.values()].map((v) => v.position.y));
    expect(afterMin).toBeLessThan(beforeMin - 0.5);

    expect(session.undo()).toBe(true);
    expect(session.document.objects.has(river!.id)).toBe(false);
    const undoneMin = Math.min(...[...mesh.vertices.values()].map((v) => v.position.y));
    expect(undoneMin).toBeCloseTo(beforeMin, 5);
  });

  it('lake carve creates a basin and fills it with water', () => {
    const session = new EditorSession(createEmptyDocument());
    const terrain = createTerrain(session, { size: 20, resolution: 12 });
    const mesh = session.document.meshes.get(terrain.meshId)!;
    for (const vertex of mesh.vertices.values()) {
      vertex.position.y = 1.2;
    }
    const lake = commitLakeWithCarve(session, terrain.objectId, {
      radius: 3.5,
      waterLevel: 0.4,
      carveDepth: 1,
      carve: true,
      style: { animated: true, opacity: 0.75 },
    });
    expect(lake).toBeTruthy();
    const centre = [...mesh.vertices.values()].find(
      (vertex) => Math.hypot(vertex.position.x, vertex.position.z) < 0.8,
    )!;
    expect(centre.position.y).toBeLessThan(0.4);
  });

  it('path carve wears a trail into the heightmap', () => {
    const session = new EditorSession(createEmptyDocument());
    const terrain = createTerrain(session, { size: 20, resolution: 12 });
    const mesh = session.document.meshes.get(terrain.meshId)!;
    for (const vertex of mesh.vertices.values()) {
      vertex.position.y = 1.8;
    }
    const beforeMin = Math.min(...[...mesh.vertices.values()].map((v) => v.position.y));
    const path = commitPathWithCarve(
      session,
      terrain.objectId,
      [
        { x: -3, y: 1.8, z: 0 },
        { x: 0, y: 1.8, z: 0.5 },
        { x: 3, y: 1.8, z: 0 },
      ],
      2,
      { carve: true, carveDepth: 0.55, opacity: 1 },
    );
    expect(path).toBeTruthy();
    expect(path!.metadata.terrainFeature).toBe('path');
    expect(path!.metadata.waterCarved).toBe('true');
    const afterMin = Math.min(...[...mesh.vertices.values()].map((v) => v.position.y));
    expect(afterMin).toBeLessThan(beforeMin - 0.25);
  });

  it('draws a carving river stroke through the interactive tool', () => {
    const session = new EditorSession(createEmptyDocument());
    const terrain = createTerrain(session, { size: 20, resolution: 10 });
    const terrainMesh = session.document.meshes.get(terrain.meshId)!;
    for (const vertex of terrainMesh.vertices.values()) {
      vertex.position.y = 1.5;
    }
    const tool = session.tools.get('terrain-feature') as TerrainFeatureTool;
    const sample = (x: number, y: number, z: number): ToolPointerInput => ({
      button: 'left',
      screenX: x * 10,
      screenY: z * 10,
      worldPosition: { x, y, z },
      rayOrigin: { x, y: y + 10, z },
      rayDirection: { x: 0, y: -1, z: 0 },
      shiftKey: false,
      ctrlKey: false,
      altKey: false,
    });
    tool.configure('river', terrain.objectId, session.context());
    tool.carveTerrain = true;
    tool.carveDepth = 1;
    tool.width = 2.5;
    tool.begin(sample(-4, 1.5, -2), session.context());
    tool.update(sample(0, 1.5, 0), session.context());
    tool.update(sample(4, 1.5, 3), session.context());
    expect(tool.endStroke(session)).toBe(true);

    const river = [...session.document.objects.values()].find(
      (object) => object.metadata.terrainFeature === 'river',
    );
    expect(river).toBeDefined();
    expect(river!.metadata.waterCarved).toBe('true');
    const minHeight = Math.min(
      ...[...terrainMesh.vertices.values()].map((vertex) => vertex.position.y),
    );
    expect(minHeight).toBeLessThan(1.0);
  });
});
