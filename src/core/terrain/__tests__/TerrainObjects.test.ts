import { beforeEach, describe, expect, it } from 'vitest';
import { commitMeshObject } from '@/core/document/ModelDocument';
import { buildModelDocumentView } from '@/core/document/ViperProject';
import { EditorSession } from '@/core/editor/EditorSession';
import {
  collectInstanceRenderParts,
  makeModelInstanceUnique,
  modelDocumentBaseOffset,
} from '@/core/editor/ModelInstances';
import { resetIdCounter } from '@/core/ids/IdService';
import { buildBox } from '@/core/mesh/builders/BoxBuilder';
import { createTerrain } from '@/core/terrain/Terrain';
import {
  ensureTerrainPresetSource,
  repairTerrainPresetSources,
  reprojectTerrainPlacedObjects,
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
  it('starts without a built-in object selected', () => {
    const { session, terrain, tool } = setup();
    tool.setMode('place', session.context());
    tool.begin(pointer(0, 0), session.context());

    expect(tool.endStroke(session.context())).toBe(false);
    expect(terrainPlacedObjects(session.document, terrain.objectId)).toHaveLength(0);
    expect(
      [...session.document.objects.values()].some(
        (object) => object.metadata.terrainPresetSource,
      ),
    ).toBe(false);
  });

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

  it('places linked Outliner models on the terrain', () => {
    const { session, terrain, tool } = setup();
    const modelId = session.project.modelDocumentIds[0]!;
    const modelView = buildModelDocumentView(session.project, modelId);
    commitMeshObject(
      modelView,
      buildBox({ width: 1, height: 2, depth: 1, name: 'Creature' }),
      { name: 'Creature' },
    );

    tool.setSourceModel(
      modelId,
      'Creature',
      modelDocumentBaseOffset(session.project, modelId),
      0.75,
      session.context(),
    );
    tool.setMode('place', session.context());
    tool.begin(pointer(1, -2), session.context());
    expect(tool.endStroke(session.context())).toBe(true);

    const [placed] = terrainPlacedObjects(session.document, terrain.objectId);
    expect(placed?.kind).toBe('instance');
    expect(placed?.instanceSourceModelId).toBe(modelId);
    expect(placed?.metadata.terrainSourceModelId).toBe(modelId);
    expect(placed?.transform.position.y).toBeCloseTo(1 + tool.groundClearance);
    expect(
      collectInstanceRenderParts(session.project, session.documentId, placed!),
    ).toHaveLength(1);

    session.undo();
    expect(terrainPlacedObjects(session.document, terrain.objectId)).toHaveLength(0);
    session.redo();
    expect(terrainPlacedObjects(session.document, terrain.objectId)).toHaveLength(1);
  });

  it('prevents overlapping linked models and makes a selected copy editable', () => {
    const { session, terrain, tool } = setup();
    const modelId = session.project.modelDocumentIds[0]!;
    const modelView = buildModelDocumentView(session.project, modelId);
    commitMeshObject(
      modelView,
      buildBox({ width: 2, height: 2, depth: 2, name: 'Boulder' }),
      { name: 'Boulder' },
    );
    tool.setSourceModel(modelId, 'Boulder', 1, 1, session.context());
    tool.placementYaw = Math.PI / 3;
    tool.placementScale = 1.5;
    tool.collisionAvoidance = true;
    tool.setMode('place', session.context());

    tool.begin(pointer(0, 0), session.context());
    expect(tool.endStroke(session.context())).toBe(true);
    tool.begin(pointer(0.25, 0), session.context());
    expect(tool.endStroke(session.context())).toBe(false);

    const [linked] = terrainPlacedObjects(session.document, terrain.objectId);
    expect(linked!.transform.rotation.y).toBeCloseTo(Math.PI / 3);
    expect(linked!.transform.scale.x).toBeCloseTo(1.5);
    const uniqueId = makeModelInstanceUnique(session, linked!.id);
    expect(uniqueId).not.toBeNull();
    expect(session.document.objects.has(linked!.id)).toBe(false);
    expect(session.document.objects.get(uniqueId!)?.kind).toBe('mesh');
    expect(session.document.objects.get(uniqueId!)?.metadata.terrainLinkedStatus).toBe('unique');
    expect(session.undo()).toBe(true);
    expect(session.document.objects.get(linked!.id)?.kind).toBe('instance');
    expect(session.document.objects.has(uniqueId!)).toBe(false);
    expect(session.redo()).toBe(true);
    expect(session.document.objects.get(uniqueId!)?.kind).toBe('mesh');
  });

  it('uses height masks to reject unsuitable terrain placement', () => {
    const { session, terrain, tool } = setup();
    tool.setPreset('rock', session.context());
    tool.maskEnabled = true;
    tool.minimumHeight = 5;
    tool.maximumHeight = 10;
    tool.setMode('place', session.context());
    tool.begin(pointer(0, 0), session.context());

    expect(tool.endStroke(session.context())).toBe(false);
    expect(terrainPlacedObjects(session.document, terrain.objectId)).toHaveLength(0);
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

  it('stacks a model on the visible surface of another placed model', () => {
    const { session, terrain, tool } = setup();
    tool.setPreset('building', session.context());
    tool.setMode('place', session.context());
    tool.begin(pointer(0, 0), session.context());
    tool.endStroke(session.context());
    const base = terrainPlacedObjects(session.document, terrain.objectId)[0]!;

    tool.setPreset('rock', session.context());
    tool.stackModels = true;
    tool.collisionAvoidance = true;
    tool.begin({
      ...pointer(0, 0),
      worldPosition: { x: 0, y: 4, z: 0 },
      surfaceObjectId: base.id,
    }, session.context());
    expect(tool.endStroke(session.context())).toBe(true);

    const placed = terrainPlacedObjects(session.document, terrain.objectId);
    expect(placed).toHaveLength(2);
    const stacked = placed.find((object) => object.id !== base.id)!;
    expect(stacked.metadata.terrainStacked).toBe('true');
    expect(stacked.metadata.terrainStackedOnId).toBe(base.id);
    expect(stacked.transform.position.y).toBeGreaterThan(4);
    expect(stacked.transform.position.x).toBeCloseTo(base.transform.position.x);

    const beforeBaseY = base.transform.position.y;
    const beforeStackY = stacked.transform.position.y;
    session.document.objects.get(terrain.objectId)!.transform.position.y += 2;
    reprojectTerrainPlacedObjects(session.document, terrain.objectId);
    expect(base.transform.position.y).toBeCloseTo(beforeBaseY + 2);
    expect(stacked.transform.position.y).toBeCloseTo(beforeStackY + 2);
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
