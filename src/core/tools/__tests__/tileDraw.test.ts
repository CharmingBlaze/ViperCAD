import { beforeEach, describe, expect, it } from 'vitest';
import { EditorSession } from '@/core/editor/EditorSession';
import { resetIdCounter } from '@/core/ids/IdService';
import { WORLD_XZ_PLANE } from '@/core/snap/SnapEngine';
import { TileDrawTool } from '@/core/tools/TileDrawTool';
import { getMeshStats } from '@/core/mesh/EditableMesh';

beforeEach(() => resetIdCounter(1));

const pointer = (x: number, z: number) => ({
  button: 'left' as const,
  screenX: x,
  screenY: z,
  worldPosition: null,
  rayOrigin: { x, y: 10, z },
  rayDirection: { x: 0, y: -1, z: 0 },
  shiftKey: false,
  ctrlKey: false,
  altKey: false,
});

describe('3D tile draw tool', () => {
  it('creates an auto-joined drag stroke with one undo entry', () => {
    const session = new EditorSession();
    session.constructionPlane = WORLD_XZ_PLANE;
    const tool = session.tools.get('tile-draw') as TileDrawTool;
    tool.setConfig({ mode: 'paint', cellWidth: 1, cellHeight: 1 }, session.context());
    session.tools.setActive('tile-draw', session.context());

    tool.begin(pointer(0.2, 0.2), session.context());
    tool.update(pointer(2.2, 0.2), session.context());
    tool.confirm(session.context());

    expect(session.document.objects.size).toBe(1);
    const object = [...session.document.objects.values()][0]!;
    const mesh = session.document.meshes.get(object.meshId!)!;
    const stats = getMeshStats(mesh);
    expect(stats.faces).toBe(3);
    expect(stats.verts).toBe(8);
    expect(session.history.canUndo()).toBe(true);
    session.undo();
    expect(session.document.objects.size).toBe(0);
  });

  it('keeps the work plane and hover cursor active between strokes', () => {
    const session = new EditorSession();
    session.constructionPlane = WORLD_XZ_PLANE;
    const tool = session.tools.get('tile-draw') as TileDrawTool;
    tool.setConfig({ mode: 'paint', cellWidth: 1, cellHeight: 1 }, session.context());
    session.tools.setActive('tile-draw', session.context());

    tool.update(pointer(2.2, 3.2), session.context());
    expect(tool.state.hoverCell).toMatchObject({ column: 2, row: 3 });
    expect(tool.getOverlayInfo()).not.toBeNull();
    tool.begin(pointer(2.2, 3.2), session.context());
    tool.confirm(session.context());
    tool.update(pointer(4.2, 5.2), session.context());
    expect(tool.state.hoverCell).toMatchObject({ column: 4, row: 5 });
  });

  it('rectangle mode fills every cell inside the drag bounds', () => {
    const session = new EditorSession();
    session.constructionPlane = WORLD_XZ_PLANE;
    const tool = session.tools.get('tile-draw') as TileDrawTool;
    tool.setConfig({ mode: 'paint', shape: 'rectangle', cellWidth: 1, cellHeight: 1 }, session.context());
    session.tools.setActive('tile-draw', session.context());

    tool.begin(pointer(0.2, 0.2), session.context());
    tool.update(pointer(1.2, 2.2), session.context());
    tool.confirm(session.context());

    const object = [...session.document.objects.values()][0]!;
    const mesh = session.document.meshes.get(object.meshId!)!;
    expect(getMeshStats(mesh).faces).toBe(6);
  });

  it('merges strokes into one layer and supports erase with undo', () => {
    const session = new EditorSession();
    session.constructionPlane = WORLD_XZ_PLANE;
    const tool = session.tools.get('tile-draw') as TileDrawTool;
    tool.setConfig({ mode: 'paint', shape: 'stroke', cellWidth: 1, cellHeight: 1 }, session.context());
    session.tools.setActive('tile-draw', session.context());
    tool.begin(pointer(0.2, 0.2), session.context());
    tool.update(pointer(2.2, 0.2), session.context());
    tool.confirm(session.context());
    tool.begin(pointer(3.2, 0.2), session.context());
    tool.confirm(session.context());

    expect(session.document.objects.size).toBe(1);
    let object = [...session.document.objects.values()][0]!;
    expect(getMeshStats(session.document.meshes.get(object.meshId!)!).faces).toBe(4);

    tool.setConfig({ mode: 'erase' }, session.context());
    tool.begin(pointer(1.2, 0.2), session.context());
    tool.confirm(session.context());
    object = [...session.document.objects.values()][0]!;
    expect(getMeshStats(session.document.meshes.get(object.meshId!)!).faces).toBe(3);
    session.undo();
    object = [...session.document.objects.values()][0]!;
    expect(getMeshStats(session.document.meshes.get(object.meshId!)!).faces).toBe(4);
  });

  it('picks a tile and flood-replaces matching connected cells', () => {
    const session = new EditorSession();
    session.constructionPlane = WORLD_XZ_PLANE;
    const tool = session.tools.get('tile-draw') as TileDrawTool;
    tool.setConfig({ mode: 'paint', shape: 'rectangle', cellWidth: 1, cellHeight: 1, tileX: 0, tileY: 0 }, session.context());
    session.tools.setActive('tile-draw', session.context());
    tool.begin(pointer(0.2, 0.2), session.context());
    tool.update(pointer(1.2, 1.2), session.context());
    tool.confirm(session.context());

    tool.setConfig({ mode: 'pick' }, session.context());
    tool.begin(pointer(0.2, 0.2), session.context());
    expect(tool.state.pickedTile?.tileX).toBe(0);

    tool.setConfig({ mode: 'fill', tileX: 16 }, session.context());
    tool.begin(pointer(0.2, 0.2), session.context());
    tool.confirm(session.context());
    const object = [...session.document.objects.values()][0]!;
    const cells = JSON.parse(object.metadata.tileDrawCells!) as { tileX: number }[];
    expect(cells).toHaveLength(4);
    expect(cells.every((cell) => cell.tileX === 16)).toBe(true);
  });

  it('autotiles every cardinal neighbour state and updates after erasing', () => {
    const session = new EditorSession();
    session.constructionPlane = WORLD_XZ_PLANE;
    const tool = session.tools.get('tile-draw') as TileDrawTool;
    tool.setConfig({
      mode: 'paint', shape: 'stroke', autoTile: true,
      imageWidth: 64, imageHeight: 64, tileWidth: 16, tileHeight: 16,
      cellWidth: 1, cellHeight: 1, tileX: 0, tileY: 0,
    }, session.context());
    session.tools.setActive('tile-draw', session.context());
    tool.begin(pointer(0.2, 0.2), session.context());
    tool.update(pointer(2.2, 0.2), session.context());
    tool.confirm(session.context());

    const object = [...session.document.objects.values()][0]!;
    let cells = JSON.parse(object.metadata.tileDrawCells!) as { column: number; tileX: number; tileY: number }[];
    cells.sort((a, b) => a.column - b.column);
    expect(cells.map(({ tileX, tileY }) => [tileX, tileY])).toEqual([[32, 0], [32, 32], [0, 32]]);
    expect(object.metadata.tileAutoRule).toBe('cardinal-4x4');

    tool.setConfig({ mode: 'pick' }, session.context());
    tool.begin(pointer(1.2, 0.2), session.context());
    expect(tool.consumePickedTile()).toMatchObject({ tileX: 0, tileY: 0 });

    tool.setConfig({ mode: 'erase' }, session.context());
    tool.begin(pointer(1.2, 0.2), session.context());
    tool.confirm(session.context());
    cells = JSON.parse(object.metadata.tileDrawCells!) as { column: number; tileX: number; tileY: number }[];
    expect(cells.map(({ tileX, tileY }) => [tileX, tileY])).toEqual([[0, 0], [0, 0]]);
    session.undo();
    cells = JSON.parse(object.metadata.tileDrawCells!) as { column: number; tileX: number; tileY: number }[];
    expect(cells).toHaveLength(3);
  });
});
