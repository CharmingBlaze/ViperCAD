import { resolveTerrainAsset } from '@/core/terrain/Terrain';
import type { EditorSession } from '@/core/editor/EditorSession';
import { TerrainFeatureTool } from '@/core/tools/TerrainFeatureTool';
import { TerrainObjectTool } from '@/core/tools/TerrainObjectTool';
import { TerrainSculptTool } from '@/core/tools/TerrainSculptTool';

export type TerrainWorkspaceTool = 'sculpt' | 'objects' | 'water' | 'select';

export function activateTerrainWorkspaceTool(
  session: EditorSession,
  tool: TerrainWorkspaceTool,
): boolean {
  const terrain = resolveTerrainAsset(session);
  session.selection.setMode('object');
  if (tool === 'select') {
    session.tools.setActive('select', session.context());
    session.requestRedraw();
    return true;
  }
  if (!terrain) return false;
  session.selection.selectObjects([terrain.object.id], 'replace');
  if (tool === 'sculpt') {
    session.tools.setActive('terrain-sculpt', session.context());
  } else if (tool === 'objects') {
    const objectTool = session.tools.get('terrain-object') as TerrainObjectTool;
    objectTool.setTerrain(terrain.object.id, session.context());
    session.tools.setActive('terrain-object', session.context());
  } else {
    const featureTool = session.tools.get('terrain-feature') as TerrainFeatureTool;
    featureTool.configure(featureTool.kind, terrain.object.id, session.context());
    session.tools.setActive('terrain-feature', session.context());
  }
  session.requestRedraw();
  return true;
}

export function adjustTerrainBrushSize(session: EditorSession, factor: number): boolean {
  const context = session.context();
  const tool = session.tools.getActive();
  if (tool instanceof TerrainSculptTool) {
    tool.setRadius(tool.radius * factor, context);
    return true;
  }
  if (tool instanceof TerrainObjectTool) {
    tool.setRadius(tool.radius * factor, context);
    return true;
  }
  if (tool instanceof TerrainFeatureTool) {
    tool.width = Math.max(0.1, Math.min(100, tool.width * factor));
    tool.revision += 1;
    context.requestRedraw();
    return true;
  }
  return false;
}
