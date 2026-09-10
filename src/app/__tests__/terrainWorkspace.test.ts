import { describe, expect, it } from 'vitest';
import { activateTerrainWorkspaceTool, adjustTerrainBrushSize } from '@/app/terrainWorkspace';
import { EditorSession } from '@/core/editor/EditorSession';
import { createTerrain } from '@/core/terrain/Terrain';
import { TerrainSculptTool } from '@/core/tools/TerrainSculptTool';

describe('terrain workspace tools', () => {
  it('activates sculpt and water tools on the level terrain', () => {
    const session = new EditorSession();
    createTerrain(session, { size: 8, resolution: 4 });
    expect(activateTerrainWorkspaceTool(session, 'sculpt')).toBe(true);
    expect(session.tools.getActive()?.id).toBe('terrain-sculpt');
    expect(activateTerrainWorkspaceTool(session, 'water')).toBe(true);
    expect(session.tools.getActive()?.id).toBe('terrain-feature');
    expect(activateTerrainWorkspaceTool(session, 'objects')).toBe(true);
    expect(session.tools.getActive()?.id).toBe('terrain-object');
  });

  it('grows the sculpt brush with ]', () => {
    const session = new EditorSession();
    createTerrain(session, { size: 8, resolution: 4 });
    activateTerrainWorkspaceTool(session, 'sculpt');
    const tool = session.tools.getActive() as TerrainSculptTool;
    tool.radius = 2;
    expect(adjustTerrainBrushSize(session, 1.12)).toBe(true);
    expect(tool.radius).toBeCloseTo(2.24, 5);
  });
});
