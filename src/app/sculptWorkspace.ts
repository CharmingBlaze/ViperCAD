import type { EditorSession } from '@/core/editor/EditorSession';
import { MeshSculptTool, type MeshBrushMode } from '@/core/tools/MeshSculptTool';

export type SculptFloatingPanelId = 'brushes' | 'settings' | 'mesh';

export const SCULPT_PANEL_OPEN_KEY = 'vipercad.sculpt.panels.open';
export const SCULPT_PANEL_POSITION_KEYS: Record<SculptFloatingPanelId, string> = {
  brushes: 'vipercad.sculpt.panel.brushes',
  settings: 'vipercad.sculpt.panel.settings',
  mesh: 'vipercad.sculpt.panel.mesh',
};

const DEFAULT_SCULPT_PANELS: Record<SculptFloatingPanelId, boolean> = {
  brushes: true,
  settings: true,
  mesh: true,
};

export function readSculptPanelOpen(id: SculptFloatingPanelId, fallback = DEFAULT_SCULPT_PANELS[id]): boolean {
  try {
    const raw = localStorage.getItem(SCULPT_PANEL_OPEN_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<Record<SculptFloatingPanelId, boolean>>;
    return typeof parsed[id] === 'boolean' ? parsed[id] : fallback;
  } catch {
    return fallback;
  }
}

export function writeSculptPanelOpen(next: Record<SculptFloatingPanelId, boolean>): void {
  try {
    localStorage.setItem(SCULPT_PANEL_OPEN_KEY, JSON.stringify(next));
  } catch {
    // ignore
  }
}

export function resetSculptPanelLayout(): void {
  try {
    localStorage.removeItem(SCULPT_PANEL_OPEN_KEY);
    for (const key of Object.values(SCULPT_PANEL_POSITION_KEYS)) {
      localStorage.removeItem(key);
    }
  } catch {
    // ignore
  }
}

export const SCULPT_BRUSH_HOTKEYS: Record<string, MeshBrushMode> = {
  d: 'draw',
  c: 'clay',
  g: 'grab',
  k: 'snake_hook',
  i: 'inflate',
  p: 'pinch',
  f: 'flatten',
  t: 'scrape',
  r: 'crease',
  w: 'twist',
  n: 'nudge',
  o: 'noise',
  m: 'mask',
  u: 'unmask',
};

export function activateSculptBrush(session: EditorSession, mode: MeshBrushMode): boolean {
  const tool = session.tools.get('mesh-sculpt') as MeshSculptTool | undefined;
  if (!tool) return false;
  tool.setMode(mode, session.context());
  session.tools.setActive('mesh-sculpt', session.context());
  session.requestRedraw();
  return true;
}

export function adjustSculptBrushSize(session: EditorSession, factor: number): boolean {
  const tool = session.tools.getActive();
  if (!(tool instanceof MeshSculptTool)) return false;
  tool.setRadius(tool.radius * factor, session.context());
  return true;
}
