import { beforeEach, describe, expect, it } from 'vitest';
import { commitMeshObject } from '@/core/document/ModelDocument';
import { EditorSession } from '@/core/editor/EditorSession';
import { resetIdCounter } from '@/core/ids/IdService';
import { buildBox } from '@/core/mesh/builders/BoxBuilder';
import { createTerrain } from '@/core/terrain/Terrain';
import {
  ensureTerrainPresetSource,
  repairTerrainPresetSources,
  terrainPlacedObjects,
  terrainPropPreset,
} from '@/core/terrain/TerrainProps';
import { TerrainObjectTool } from '@/core/tools/TerrainObjectTool';
import type { ToolPointerInput } from '@/core/tools/Tool';

beforeEach(() => resetIdCounter(1));

const pointer = (x: number, z: number): ToolPointerInput => ({
  button: 'left',
  screenX: 120 + x,
  screenY: 160 + z,
  worldPosition: { x, y: 0, z },
  rayOrigin: { x, y: 20, z },
  rayDirection: { x: 0, y: -1, z: 0 },
  shiftKey: false,
  ctrlKey: false,
  altKey: false,
});

function setup() {
  const session = new EditorSession();
  const terrain = createTerrain(session, { size: 20, resolution: 8 });
  const tool = session.tools.get('terrain-object') as TerrainObjectTool;
  tool.setTerrain(terrain.objectId, session.context());
  return { session, terrain, tool };
}

describe('terrain level object brush', () => {
  it('places a preset as an ordinary shared-mesh scene object with undo/redo', () => {
    const { session, terrain, tool } = setup();
    tool.setPreset('tree', session.context());
    tool.setMode('place', session.context());
    tool.begin(pointer(2, 3), session.context());
    expect(tool.endStroke(session.context())).toBe(true);

    const placed = terrainPlacedObjects(session.document, terrain.objectId);
    expect(placed).toHaveLength(1);
    expect(placed[0]!.metadata.terrainOwnerId).toBe(terrain.objectId);
    expect(placed[0]!.transform.position.x).toBeCloseTo(2);
    expect(placed[0]!.transform.position.z).toBeCloseTo(3);
    expect(placed[0]!.transform.position.y).toBeCloseTo(
      terrainPropPreset('tree').baseOffset + tool.groundClearance,
    );
    const source = session.document.objects.get(placed[0]!.metadata.terrainSourceId)!;
    expect(source.visible).toBe(false);
    expect(source.meshId).toBe(placed[0]!.meshId);

    expect(session.undo()).toBe(true);
    expect(terrainPlacedObjects(session.document, terrain.objectId)).toHaveLength(0);
    expect(session.redo()).toBe(true);
    expect(terrainPlacedObjects(session.document, terrain.objectId)).toHaveLength(1);
  });

  it('scatter-paints multiple randomized instances in one undo step', () => {
    const { session, terrain, tool } = setup();
    tool.setPreset('rock', session.context());
    tool.setMode('scatter', session.context());
    tool.radius = 3;
    tool.density = 6;
    tool.spacing = 0.1;
    tool.begin(pointer(0, 0), session.context());
    tool.update(pointer(3, 0), session.context());
    tool.endStroke(session.context());

    const placed = terrainPlacedObjects(session.document, terrain.objectId);
    expect(placed.length).toBeGreaterThanOrEqual(6);
    expect(new Set(placed.map((object) => object.meshId)).size).toBe(1);
    expect(new Set(placed.map((object) => object.transform.rotation.y)).size).toBeGreaterThan(1);

    session.undo();
    expect(terrainPlacedObjects(session.document, terrain.objectId)).toHaveLength(0);
  });

  it('brush-erases placed objects and restores them with undo', () => {
    const { session, terrain, tool } = setup();
    tool.setPreset('building', session.context());
    tool.setMode('place', session.context());
    tool.begin(pointer(0, 0), session.context());
    tool.endStroke(session.context());
    expect(terrainPlacedObjects(session.document, terrain.objectId)).toHaveLength(1);

    tool.setMode('erase', session.context());
    tool.radius = 2;
    tool.begin(pointer(0, 0), session.context());
    tool.endStroke(session.context());
    expect(terrainPlacedObjects(session.document, terrain.objectId)).toHaveLength(0);

    session.undo();
    expect(terrainPlacedObjects(session.document, terrain.objectId)).toHaveLength(1);
  });

  it('uses a model made in the project as a reusable brush source', () => {
    const { session, terrain, tool } = setup();
    const source = commitMeshObject(
      session.document,
      buildBox({ width: 1, height: 2, depth: 1, name: 'House' }),
      { name: 'House' },
    );
    tool.setSourceObject(source.objectId, session.context());
    tool.setMode('place', session.context());
    tool.begin(pointer(-2, -1), session.context());
    tool.endStroke(session.context());

    const placed = terrainPlacedObjects(session.document, terrain.objectId);
    expect(placed).toHaveLength(1);
    expect(placed[0]!.metadata.terrainSourceId).toBe(source.objectId);
    expect(placed[0]!.meshId).toBe(session.document.objects.get(source.objectId)!.meshId);
  });

  it('places objects on sculpted mountain height with an adjustable offset', () => {
    const { session, terrain, tool } = setup();
    const terrainMesh = session.document.meshes.get(terrain.meshId)!;
    const centre = [...terrainMesh.vertices.values()].find(
      (vertex) => vertex.position.x === 0 && vertex.position.z === 0,
    )!;
    centre.position.y = 6;
    tool.setPreset('rock', session.context());
    tool.placementMode = 'terrain';
    tool.heightOffset = 0.75;
    tool.setMode('place', session.context());
    tool.begin({ ...pointer(0, 0), worldPosition: { x: 0, y: 6, z: 0 } }, session.context());
    tool.endStroke(session.context());

    const [placed] = terrainPlacedObjects(session.document, terrain.objectId);
    expect(placed).toBeDefined();
    // Rock preset is scaled to 72% vertically, so its 0.45 base offset
    // contributes 0.324 above the sampled six-unit mountain height.
    expect(placed!.transform.position.y).toBeCloseTo(7.104);
  });

  it('can deliberately place objects against the terrain base plane', () => {
    const { session, terrain, tool } = setup();
    tool.setPreset('building', session.context());
    tool.placementMode = 'base';
    tool.heightOffset = 1;
    tool.setMode('place', session.context());
    tool.begin({ ...pointer(0, 0), worldPosition: { x: 0, y: 8, z: 0 } }, session.context());
    tool.endStroke(session.context());

    const [placed] = terrainPlacedObjects(session.document, terrain.objectId);
    expect(placed!.transform.position.y).toBeCloseTo(2.25);
  });

  it('repairs legacy tree and column source winding without breaking shared mesh ids', () => {
    const { session } = setup();
    const source = ensureTerrainPresetSource(session.document, 'tree');
    const meshId = source.meshId!;
    const previousVersion = session.document.meshes.get(meshId)!.topologyVersion;
    delete source.metadata.terrainPresetWinding;

    expect(repairTerrainPresetSources(session.document)).toBe(1);
    expect(source.meshId).toBe(meshId);
    expect(source.metadata.terrainPresetWinding).toBe('outward-v2');
    expect(session.document.meshes.get(meshId)!.topologyVersion).toBe(previousVersion + 1);
  });
});
