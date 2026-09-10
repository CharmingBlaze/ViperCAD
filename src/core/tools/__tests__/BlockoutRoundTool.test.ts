import { describe, expect, it } from 'vitest';
import { EditorSession } from '@/core/editor/EditorSession';
import { v3 } from '@/core/math/Vec3';
import { BlockoutRoundTool } from '../BlockoutRoundTool';
import type { ToolPointerInput } from '../Tool';

function pointer(origin: { x: number; y: number; z: number }, viewportId = 'front'): ToolPointerInput {
  return {
    worldPosition: v3(origin.x, origin.y, 0),
    rayOrigin: origin,
    rayDirection: v3(0, 0, -1),
    screenX: 0,
    screenY: 0,
    shiftKey: false,
    altKey: false,
    ctrlKey: false,
    button: 'left',
    viewportId,
  };
}

describe('BlockoutRoundTool', () => {
  it('is registered as the Round blockout tool', () => {
    const session = new EditorSession();
    const tool = session.tools.get('blockout-round');
    expect(tool).toBeInstanceOf(BlockoutRoundTool);
    expect(tool?.label).toBe('Round');
  });

  it('turns a click-drag box into an 8-sided live solid', () => {
    const session = new EditorSession();
    const tool = new BlockoutRoundTool();
    const context = session.context();
    tool.onPointerDown(pointer(v3(0, 0, 10)), context);
    tool.onPointerMove(pointer(v3(2, 2, 10)), context);
    expect(tool.state.points).toHaveLength(8);
    expect(tool.getPreviewMesh()).toBeTruthy();
    tool.onPointerUp(pointer(v3(2, 2, 10)), context);
    expect(tool.state.stage).toBe('width');
    expect(tool.state.closed).toBe(true);
  });

  it('commits a faceted cylinder into the document', () => {
    const session = new EditorSession();
    const tool = session.tools.get('blockout-round') as BlockoutRoundTool;
    tool.state.points = [
      v3(1, 0, 0),
      v3(2, 1, 0),
      v3(1, 2, 0),
      v3(0, 1, 0),
    ];
    tool.state.activePlane = 'front';
    expect(tool.commitExtrude(session.context())).toBe(true);
    expect(session.document.objects.size).toBe(1);
    expect(session.tools.getActive()?.id).toBe('select');
    const object = session.document.objects.get(session.selection.state.activeObjectId!);
    expect(object?.name).toBe('Blockout Round');
  });

  it('rebuilds the silhouette when sides change', () => {
    const session = new EditorSession();
    const tool = new BlockoutRoundTool();
    const context = session.context();
    tool.onPointerDown(pointer(v3(0, 0, 10)), context);
    tool.onPointerMove(pointer(v3(2, 2, 10)), context);
    tool.onPointerUp(pointer(v3(2, 2, 10)), context);
    tool.setSides(6, context);
    expect(tool.sides).toBe(6);
    expect(tool.state.points).toHaveLength(6);
  });
});
