import { beforeEach, describe, expect, it } from 'vitest';
import { EditorSession } from '@/core/editor/EditorSession';
import { resetIdCounter } from '@/core/ids/IdService';
import { createImageAssetFromPixels } from '@/core/image/PixelEditor';
import { applyHeightmap, sampleHeight } from '@/core/terrain/Heightmap';
import { createTerrain, terrainHeightRange } from '@/core/terrain/Terrain';
import { terrainPlacedObjects } from '@/core/terrain/TerrainProps';
import { TerrainObjectTool } from '@/core/tools/TerrainObjectTool';

beforeEach(() => resetIdCounter(1));

describe('terrain heightmaps', () => {
  it('bilinearly samples image channels', () => {
    const session = new EditorSession();
    const image = createImageAssetFromPixels(
      session.document,
      'Corners',
      2,
      2,
      new Uint8ClampedArray([
        0, 0, 0, 255,
        255, 0, 0, 255,
        128, 0, 0, 255,
        64, 0, 0, 255,
      ]),
    );
    expect(sampleHeight(image, 0, 0, 'red')).toBe(0);
    expect(sampleHeight(image, 1, 0, 'red')).toBe(1);
    expect(sampleHeight(image, 0.5, 0.5, 'red')).toBeCloseTo(
      (0 + 1 + 128 / 255 + 64 / 255) / 4,
    );
  });

  it('replaces terrain heights and restores geometry and metadata with undo', () => {
    const session = new EditorSession();
    const terrain = createTerrain(session, { size: 10, resolution: 2 });
    const mesh = session.document.meshes.get(terrain.meshId)!;
    const object = session.document.objects.get(terrain.objectId)!;
    const image = createImageAssetFromPixels(
      session.document,
      'Slope',
      2,
      2,
      new Uint8ClampedArray([
        0, 0, 0, 255,
        255, 255, 255, 255,
        0, 0, 0, 255,
        255, 255, 255, 255,
      ]),
    );

    expect(applyHeightmap(session, terrain.objectId, image, {
      strength: 12,
      offset: -2,
      mode: 'replace',
    })).toBe(true);
    expect(terrainHeightRange(mesh)).toEqual({ min: -2, max: 10 });
    expect(object.metadata.heightmapImageId).toBe(image.id);
    expect(object.metadata.heightmapStrength).toBe('12');

    expect(session.undo()).toBe(true);
    expect(terrainHeightRange(mesh)).toEqual({ min: 0, max: 0 });
    expect(object.metadata.heightmapImageId).toBeUndefined();

    expect(session.redo()).toBe(true);
    expect(terrainHeightRange(mesh)).toEqual({ min: -2, max: 10 });
  });

  it('adds centered height detail and supports inversion', () => {
    const session = new EditorSession();
    const terrain = createTerrain(session, { size: 6, resolution: 2 });
    const mesh = session.document.meshes.get(terrain.meshId)!;
    const white = createImageAssetFromPixels(
      session.document,
      'White',
      1,
      1,
      new Uint8ClampedArray([255, 255, 255, 255]),
    );

    applyHeightmap(session, terrain.objectId, white, {
      strength: 4,
      mode: 'add',
      invert: true,
    });
    expect(terrainHeightRange(mesh)).toEqual({ min: -2, max: -2 });
  });

  it('keeps placed level objects grounded and restores them with undo', () => {
    const session = new EditorSession();
    const terrain = createTerrain(session, { size: 10, resolution: 2 });
    const tool = session.tools.get('terrain-object') as TerrainObjectTool;
    tool.setTerrain(terrain.objectId, session.context());
    tool.setPreset('tree', session.context());
    tool.begin({
      button: 'left',
      screenX: 10,
      screenY: 10,
      worldPosition: { x: 5, y: 0, z: 0 },
      rayOrigin: { x: 5, y: 10, z: 0 },
      rayDirection: { x: 0, y: -1, z: 0 },
      shiftKey: false,
      ctrlKey: false,
      altKey: false,
    }, session.context());
    tool.endStroke(session.context());
    const placed = terrainPlacedObjects(session.document, terrain.objectId)[0]!;
    const originalY = placed.transform.position.y;
    const slope = createImageAssetFromPixels(
      session.document,
      'Slope',
      2,
      1,
      new Uint8ClampedArray([
        0, 0, 0, 255,
        255, 255, 255, 255,
      ]),
    );

    applyHeightmap(session, terrain.objectId, slope, {
      strength: 10,
      mode: 'replace',
      reprojectObjects: true,
    });
    expect(placed.transform.position.y).toBeCloseTo(originalY + 10);
    session.undo();
    expect(placed.transform.position.y).toBeCloseTo(originalY);
  });
});
