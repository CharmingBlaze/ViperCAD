import { describe, expect, it } from 'vitest';
import { activateSculptBrush, adjustSculptBrushSize } from '@/app/sculptWorkspace';
import { EditorSession } from '@/core/editor/EditorSession';
import { MeshSculptTool } from '@/core/tools/MeshSculptTool';

describe('sculpt workspace tools', () => {
  it('activates letter-key brushes on the mesh sculpt tool', () => {
    const session = new EditorSession();
    expect(activateSculptBrush(session, 'grab')).toBe(true);
    const tool = session.tools.getActive() as MeshSculptTool;
    expect(tool.id).toBe('mesh-sculpt');
    expect(tool.mode).toBe('grab');
    expect(activateSculptBrush(session, 'clay')).toBe(true);
    expect(tool.mode).toBe('clay');
  });

  it('grows the sculpt brush with ]', () => {
    const session = new EditorSession();
    activateSculptBrush(session, 'draw');
    const tool = session.tools.getActive() as MeshSculptTool;
    tool.radius = 0.5;
    expect(adjustSculptBrushSize(session, 1.12)).toBe(true);
    expect(tool.radius).toBeCloseTo(0.56, 5);
  });
});
