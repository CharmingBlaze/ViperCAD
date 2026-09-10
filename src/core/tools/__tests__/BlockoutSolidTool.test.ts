import { describe, expect, it } from 'vitest';
import { EditorSession } from '@/core/editor/EditorSession';
import { v3 } from '@/core/math/Vec3';
import { BlockoutSolidTool } from '../BlockoutSolidTool';

describe('BlockoutSolidTool', () => {
  it('is registered as the Square blockout tool', () => {
    const session = new EditorSession();
    const tool = session.tools.get('blockout-solid');
    expect(tool).toBeInstanceOf(BlockoutSolidTool);
    expect(tool?.label).toBe('Square');
  });

  it('builds a live thickness preview that updates with the slider', () => {
    const tool = new BlockoutSolidTool();
    tool.state.points = [v3(0, 0, 0), v3(2, 0, 0), v3(2, 2, 0), v3(0, 2, 0)];
    tool.state.activePlane = 'front';
    tool.thickness = 1;
    tool.symmetric = true;

    const first = tool.getPreviewMesh();
    expect(first).toBeTruthy();
    const z1 = [...first!.vertices.values()].map((v) => v.position.z);
    expect(Math.min(...z1)).toBeCloseTo(-0.5);
    expect(Math.max(...z1)).toBeCloseTo(0.5);

    tool.thickness = 2;
    const second = tool.getPreviewMesh();
    const z2 = [...second!.vertices.values()].map((v) => v.position.z);
    expect(Math.min(...z2)).toBeCloseTo(-1);
    expect(Math.max(...z2)).toBeCloseTo(1);
  });

  it('does not show a solid until three points exist', () => {
    const tool = new BlockoutSolidTool();
    tool.state.points = [v3(0, 0, 0), v3(1, 0, 0)];
    expect(tool.getPreviewMesh()).toBeNull();
  });

  it('commits the live solid into the document', () => {
    const session = new EditorSession();
    const tool = session.tools.get('blockout-solid') as BlockoutSolidTool;
    tool.state.points = [v3(0, 0, 0), v3(2, 0, 0), v3(2, 2, 0), v3(0, 2, 0)];
    tool.state.activePlane = 'front';
    expect(tool.commitExtrude(session.context())).toBe(true);
    expect(session.document.objects.size).toBe(1);
    expect(session.tools.getActive()?.id).toBe('select');
    const object = session.document.objects.get(session.selection.state.activeObjectId!);
    const material = session.document.materials.get(object!.materialSlotIds[0]!);
    expect(material?.baseColourTextureId).toBeTruthy();
    expect(object!.transform.position.x).toBeCloseTo(1);
    expect(object!.transform.position.y).toBeCloseTo(1);
    expect(object!.transform.position.z).toBeCloseTo(0);
    expect(session.document.rootObjectIds).toContain(object!.id);
  });
});
