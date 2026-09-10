import { describe, expect, it } from 'vitest';
import { EditorSession } from '@/core/editor/EditorSession';
import { createTerrain } from '@/core/terrain/Terrain';
import { TerrainStructureTool } from '@/core/tools/TerrainStructureTool';
import { v3 } from '@/core/math/Vec3';

describe('TerrainStructureTool', () => {
  it('places building on terrain at clicked position', () => {
    const session = new EditorSession();
    createTerrain(session, { size: 30, resolution: 16 });
    const terrain = [...session.document.objects.values()].find(
      (o) => o.metadata.terrain === 'true',
    );
    expect(terrain).toBeDefined();

    const tool = new TerrainStructureTool();
    tool.configure('building', terrain!.id, session.context());
    tool.buildingStyle = 'skyscraper';
    tool.buildingFloors = 8;

    const countBefore = session.document.objects.size;
    tool.begin(
      {
        button: 'left',
        screenX: 100,
        screenY: 100,
        worldPosition: v3(5, 0, 5),
        rayOrigin: v3(5, 20, 5),
        rayDirection: v3(0, -1, 0),
        shiftKey: false,
        ctrlKey: false,
        altKey: false,
      },
      session.context(),
    );

    expect(session.document.objects.size).toBe(countBefore + 1);
    const placed = [...session.document.objects.values()].pop();
    expect(placed?.name).toContain('Building');
  });

  it('places road grid on terrain at clicked position', () => {
    const session = new EditorSession();
    createTerrain(session, { size: 30, resolution: 16 });
    const terrain = [...session.document.objects.values()].find(
      (o) => o.metadata.terrain === 'true',
    );

    const tool = new TerrainStructureTool();
    tool.configure('road_grid', terrain!.id, session.context());

    const countBefore = session.document.objects.size;
    tool.begin(
      {
        button: 'left',
        screenX: 100,
        screenY: 100,
        worldPosition: v3(-4, 0, 2),
        rayOrigin: v3(-4, 20, 2),
        rayDirection: v3(0, -1, 0),
        shiftKey: false,
        ctrlKey: false,
        altKey: false,
      },
      session.context(),
    );

    expect(session.document.objects.size).toBe(countBefore + 1);
  });

  it('supports 2-click bridge placement', () => {
    const session = new EditorSession();
    createTerrain(session, { size: 30, resolution: 16 });
    const terrain = [...session.document.objects.values()].find(
      (o) => o.metadata.terrain === 'true',
    );

    const tool = new TerrainStructureTool();
    tool.configure('bridge', terrain!.id, session.context());

    tool.begin(
      {
        button: 'left',
        screenX: 100,
        screenY: 100,
        worldPosition: v3(-10, 0, 0),
        rayOrigin: v3(-10, 20, 0),
        rayDirection: v3(0, -1, 0),
        shiftKey: false,
        ctrlKey: false,
        altKey: false,
      },
      session.context(),
    );
    expect(tool.point1).toEqual(v3(-10, 0, 0));

    const countBefore = session.document.objects.size;
    tool.begin(
      {
        button: 'left',
        screenX: 200,
        screenY: 100,
        worldPosition: v3(10, 0, 0),
        rayOrigin: v3(10, 20, 0),
        rayDirection: v3(0, -1, 0),
        shiftKey: false,
        ctrlKey: false,
        altKey: false,
      },
      session.context(),
    );

    expect(session.document.objects.size).toBe(countBefore + 1);
    expect(tool.point1).toBeNull();
  });

  it('restores a placed building mesh on redo', () => {
    const session = new EditorSession();
    createTerrain(session, { size: 20, resolution: 8 });
    const terrain = [...session.document.objects.values()].find(
      (o) => o.metadata.terrain === 'true',
    );
    const tool = new TerrainStructureTool();
    tool.configure('building', terrain!.id, session.context());
    tool.begin(
      {
        button: 'left',
        screenX: 100,
        screenY: 100,
        worldPosition: v3(2, 0, 2),
        rayOrigin: v3(2, 20, 2),
        rayDirection: v3(0, -1, 0),
        shiftKey: false,
        ctrlKey: false,
        altKey: false,
      },
      session.context(),
    );
    const placed = [...session.document.objects.values()].find((object) => object.name.includes('Building'))!;
    const meshId = placed.meshId!;
    expect(session.document.meshes.has(meshId)).toBe(true);

    expect(session.undo()).toBe(true);
    expect(session.document.objects.has(placed.id)).toBe(false);
    expect(session.document.meshes.has(meshId)).toBe(false);

    expect(session.redo()).toBe(true);
    expect(session.document.objects.has(placed.id)).toBe(true);
    expect(session.document.meshes.has(meshId)).toBe(true);
  });
});
