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
  commitTerrainFeature,
} from '@/core/terrain/TerrainFeatures';
import { createTerrain } from '@/core/terrain/Terrain';
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

  it('builds valid lake and ocean surfaces', () => {
    const lake = buildLakeMesh(8);
    const ocean = buildOceanMesh(100);
    expect(validateMeshFull(lake).ok).toBe(true);
    expect(validateMeshFull(ocean).ok).toBe(true);
    expect(getMeshStats(lake).faces).toBe(1);
    expect(getMeshStats(ocean)).toMatchObject({ verts: 4, faces: 1 });
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

  it('draws a terrain-following river stroke through the interactive tool', () => {
    const session = new EditorSession(createEmptyDocument());
    const terrain = createTerrain(session, { size: 20, resolution: 8 });
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
    tool.begin(sample(-4, 1, -2), session.context());
    tool.update(sample(0, 3, 0), session.context());
    tool.update(sample(4, 2, 3), session.context());
    expect(tool.endStroke(session)).toBe(true);

    const river = [...session.document.objects.values()].find(
      (object) => object.metadata.terrainFeature === 'river',
    );
    expect(river).toBeDefined();
    const mesh = session.document.meshes.get(river!.meshId!)!;
    expect(Math.max(...[...mesh.vertices.values()].map((vertex) => vertex.position.y))).toBeGreaterThan(3);
  });
});
