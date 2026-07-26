import { beforeEach, describe, expect, it } from 'vitest';
import { EditorSession } from '@/core/editor/EditorSession';
import { resetIdCounter } from '@/core/ids/IdService';
import { createTerrain, resampleTerrain } from '@/core/terrain/Terrain';
import {
  ensureTerrainPresetSource,
  groundObjectToTerrain,
  reprojectTerrainPlacedObjects,
  terrainHeightAtLocalPoint,
  terrainPlacedObjects,
} from '@/core/terrain/TerrainProps';
import { TerrainObjectTool } from '@/core/tools/TerrainObjectTool';
import { TerrainSculptTool } from '@/core/tools/TerrainSculptTool';
import type { ToolPointerInput } from '@/core/tools/Tool';

beforeEach(() => resetIdCounter(1));

const pointer = (x: number, y: number, z: number, extras: Partial<ToolPointerInput> = {}): ToolPointerInput => ({
  button: 'left',
  screenX: 100,
  screenY: 100,
  worldPosition: { x, y, z },
  rayOrigin: { x, y: y + 10, z },
  rayDirection: { x: 0, y: -1, z: 0 },
  shiftKey: false,
  ctrlKey: false,
  altKey: false,
  worldUnitsPerPixel: 0.02,
  ...extras,
});

describe('terrain prop reproject', () => {
  it('keeps placed props grounded after a sculpt stroke', () => {
    const session = new EditorSession();
    const terrain = createTerrain(session, { size: 20, resolution: 8 });
    const objectTool = session.tools.get('terrain-object') as TerrainObjectTool;
    objectTool.setTerrain(terrain.objectId, session.context());
    objectTool.setPreset('rock', session.context());
    objectTool.begin(pointer(0, 0, 0), session.context());
    objectTool.endStroke(session.context());

    const placed = terrainPlacedObjects(session.document, terrain.objectId)[0]!;
    const yBefore = placed.transform.position.y;

    const sculpt = session.tools.get('terrain-sculpt') as TerrainSculptTool;
    sculpt.mode = 'raise';
    sculpt.strength = 2;
    sculpt.radius = 4;
    sculpt.begin(pointer(0, 0, 0), session.context());
    sculpt.update(pointer(0.5, 0, 0.5), session.context());
    sculpt.endStroke(session.context());

    expect(placed.transform.position.y).toBeGreaterThan(yBefore);
    const mesh = session.document.meshes.get(terrain.meshId)!;
    const terrainObject = session.document.objects.get(terrain.objectId)!;
    const surface = terrainHeightAtLocalPoint(terrainObject, mesh, 0, 0);
    expect(placed.transform.position.y).toBeGreaterThan(surface);
  });

  it('samples flatten height with Alt+click without sculpting', () => {
    const session = new EditorSession();
    const terrain = createTerrain(session, { size: 10, resolution: 4 });
    const mesh = session.document.meshes.get(terrain.meshId)!;
    for (const vertex of mesh.vertices.values()) vertex.position.y = 1.5;

    const sculpt = session.tools.get('terrain-sculpt') as TerrainSculptTool;
    sculpt.mode = 'flatten';
    sculpt.flattenHeight = 0;
    sculpt.begin(pointer(0, 1.5, 0, { altKey: true }), session.context());
    expect(sculpt.flattenHeight).toBeCloseTo(1.5, 4);
    expect(sculpt.dragging).toBe(false);
  });

  it('resamples terrain resolution and reprojects props', () => {
    const session = new EditorSession();
    const terrain = createTerrain(session, { size: 16, resolution: 4 });
    const mesh = session.document.meshes.get(terrain.meshId)!;
    for (const vertex of mesh.vertices.values()) {
      vertex.position.y = vertex.position.x * 0.1;
    }

    ensureTerrainPresetSource(session.document, 'column');
    const objectTool = session.tools.get('terrain-object') as TerrainObjectTool;
    objectTool.setTerrain(terrain.objectId, session.context());
    objectTool.setPreset('column', session.context());
    objectTool.begin(pointer(1, 0, 1), session.context());
    objectTool.endStroke(session.context());
    const placed = terrainPlacedObjects(session.document, terrain.objectId)[0]!;
    const yBefore = placed.transform.position.y;

    expect(resampleTerrain(session, terrain.objectId, 8)).toBe(true);
    const object = session.document.objects.get(terrain.objectId)!;
    expect(object.metadata.terrainResolution).toBe('8');
    expect(session.document.meshes.get(terrain.meshId)!.vertices.size).toBe(81);
    expect(placed.transform.position.y).toBeCloseTo(yBefore, 1);
  });

  it('grounds an object with optional slope alignment', () => {
    const session = new EditorSession();
    const terrain = createTerrain(session, { size: 12, resolution: 6 });
    const mesh = session.document.meshes.get(terrain.meshId)!;
    for (const vertex of mesh.vertices.values()) {
      vertex.position.y = vertex.position.x * 0.25;
    }
    const objectTool = session.tools.get('terrain-object') as TerrainObjectTool;
    objectTool.setTerrain(terrain.objectId, session.context());
    objectTool.setPreset('building', session.context());
    objectTool.alignToSlope = true;
    objectTool.begin(pointer(2, 0, 0), session.context());
    objectTool.endStroke(session.context());
    const placed = terrainPlacedObjects(session.document, terrain.objectId)[0]!;
    expect(placed.metadata.terrainAlignToSlope).toBe('true');
    expect(Math.abs(placed.transform.rotation.z)).toBeGreaterThan(0.01);

    placed.transform.position.y += 3;
    expect(groundObjectToTerrain(session.document, placed.id, terrain.objectId, { alignToSlope: true })).toBe(true);
    reprojectTerrainPlacedObjects(session.document, terrain.objectId, { alignToSlope: true });
    const surface = terrainHeightAtLocalPoint(
      session.document.objects.get(terrain.objectId)!,
      session.document.meshes.get(terrain.meshId)!,
      2,
      0,
    );
    expect(placed.transform.position.y).toBeGreaterThan(surface);
  });
});
