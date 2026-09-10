import { resolveTerrainAsset } from '@/core/terrain/Terrain';
import type { EditorSession } from '@/core/editor/EditorSession';
import { TerrainFeatureTool } from '@/core/tools/TerrainFeatureTool';
import { TerrainObjectTool } from '@/core/tools/TerrainObjectTool';
import { TerrainSculptTool } from '@/core/tools/TerrainSculptTool';
import { TerrainStructureTool } from '@/core/tools/TerrainStructureTool';

export type TerrainWorkspaceTool = 'sculpt' | 'paint' | 'objects' | 'water' | 'structure' | 'select';

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
    const sculpt = session.tools.get('terrain-sculpt') as TerrainSculptTool;
    if (sculpt.mode === 'paint') sculpt.setMode('raise', session.context());
    session.tools.setActive('terrain-sculpt', session.context());
  } else if (tool === 'paint') {
    const sculpt = session.tools.get('terrain-sculpt') as TerrainSculptTool;
    sculpt.setMode('paint', session.context());
    session.tools.setActive('terrain-sculpt', session.context());
  } else if (tool === 'objects') {
    const objectTool = session.tools.get('terrain-object') as TerrainObjectTool;
    objectTool.setTerrain(terrain.object.id, session.context());
    session.tools.setActive('terrain-object', session.context());
  } else if (tool === 'structure') {
    const structureTool = session.tools.get('terrain-structure') as TerrainStructureTool;
    structureTool.configure(structureTool.kind, terrain.object.id, session.context());
    session.tools.setActive('terrain-structure', session.context());
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
  if (tool instanceof TerrainStructureTool && tool.kind === 'cave') {
    tool.caveRadius = Math.max(0.5, Math.min(40, tool.caveRadius * factor));
    tool.revision += 1;
    context.requestRedraw();
    return true;
  }
  return false;
}
