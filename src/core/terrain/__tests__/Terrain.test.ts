import { beforeEach, describe, expect, it } from 'vitest';
import { EditorSession } from '@/core/editor/EditorSession';
import { resetIdCounter } from '@/core/ids/IdService';
import { validateMeshFull } from '@/core/mesh/Validation';
import {
  applyTerrainTileRepeat,
  buildTerrainMesh,
  createTerrain,
  terrainHeightRange,
} from '@/core/terrain/Terrain';
import { TerrainSculptTool } from '@/core/tools/TerrainSculptTool';
import type { ToolPointerInput } from '@/core/tools/Tool';

beforeEach(() => resetIdCounter(1));

const pointer = (x: number, z: number, shiftKey = false): ToolPointerInput => ({
  button: 'left',
  screenX: 100,
  screenY: 100,
  worldPosition: { x, y: 0, z },
  rayOrigin: { x, y: 10, z },
  rayDirection: { x: 0, y: -1, z: 0 },
  shiftKey,
  ctrlKey: false,
  altKey: false,
  worldUnitsPerPixel: 0.02,
});

describe('terrain assets', () => {
  it('builds a valid, evenly sized editable grid', () => {
    const mesh = buildTerrainMesh({ size: 10, resolution: 4 });
    expect(mesh.vertices.size).toBe(25);
    expect(mesh.faces.size).toBe(16);
    expect(validateMeshFull(mesh).ok).toBe(true);
    const xs = [...mesh.vertices.values()].map((vertex) => vertex.position.x);
    const zs = [...mesh.vertices.values()].map((vertex) => vertex.position.z);
    expect(Math.min(...xs)).toBe(-5);
    expect(Math.max(...xs)).toBe(5);
    expect(Math.min(...zs)).toBe(-5);
    expect(Math.max(...zs)).toBe(5);
  });

  it('creates a paint-ready material and restores every asset with undo/redo', () => {
    const session = new EditorSession();
    const terrain = createTerrain(session, { size: 24, resolution: 8, tileRepeat: 6 });
    const object = session.document.objects.get(terrain.objectId)!;
    const material = session.document.materials.get(object.materialSlotIds[0]!)!;
    const texture = session.document.textures.get(material.baseColourTextureId!)!;

    expect(object.metadata.terrain).toBe('true');
    expect(object.metadata.terrainTileRepeat).toBe('6');
    expect(session.document.images.has(texture.imageAssetId)).toBe(true);
    expect(texture.wrapping).toBe('repeat');

    expect(session.undo()).toBe(true);
    expect(session.document.objects.has(terrain.objectId)).toBe(false);
    expect(session.redo()).toBe(true);
    expect(session.document.objects.has(terrain.objectId)).toBe(true);
    expect(session.document.textures.has(texture.id)).toBe(true);
  });

  it('repeats terrain UVs for tiled game surfaces', () => {
    const mesh = buildTerrainMesh({ size: 12, resolution: 3 });
    applyTerrainTileRepeat(mesh, 9);
    const layerId = mesh.defaultUvLayerId!;
    const values = [...mesh.faceCorners.values()].map((corner) => corner.uvs.get(layerId)!);
    expect(Math.min(...values.map((uv) => uv.x))).toBe(0);
    expect(Math.max(...values.map((uv) => uv.x))).toBe(9);
    expect(Math.min(...values.map((uv) => uv.y))).toBe(0);
    expect(Math.max(...values.map((uv) => uv.y))).toBe(9);
  });
});

describe('terrain sculpting', () => {
  it('raises a continuous brush stroke and restores it with undo', () => {
    const session = new EditorSession();
    const terrain = createTerrain(session, { size: 10, resolution: 10 });
    const mesh = session.document.meshes.get(terrain.meshId)!;
    session.tools.setActive('terrain-sculpt', session.context());
    const tool = session.tools.getActive() as TerrainSculptTool;
    tool.setRadius(1.5, session.context());
    tool.setStrength(0.5, session.context());

    tool.begin(pointer(-2, 0), session.context());
    tool.update(pointer(2, 0), session.context());
    expect(tool.endStroke(session.context())).toBe(true);

    const raised = [...mesh.vertices.values()].filter((vertex) => vertex.position.y > 0);
    expect(raised.length).toBeGreaterThan(3);
    expect(terrainHeightRange(mesh).max).toBeGreaterThan(0);

    expect(session.undo()).toBe(true);
    expect(terrainHeightRange(mesh)).toEqual({ min: 0, max: 0 });
  });

  it('supports inverted raise strokes with Shift', () => {
    const session = new EditorSession();
    const terrain = createTerrain(session, { size: 8, resolution: 8 });
    const mesh = session.document.meshes.get(terrain.meshId)!;
    const tool = session.tools.get('terrain-sculpt') as TerrainSculptTool;
    tool.begin(pointer(0, 0, true), session.context());
    tool.endStroke(session.context());
    expect(terrainHeightRange(mesh).min).toBeLessThan(0);
  });
});
