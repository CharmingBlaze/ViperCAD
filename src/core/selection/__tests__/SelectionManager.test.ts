import { describe, expect, it } from 'vitest';
import { commitMeshObject, createEmptyDocument } from '@/core/document/ModelDocument';
import { buildBox } from '@/core/mesh/builders/BoxBuilder';
import { SelectionManager } from '@/core/selection/SelectionManager';

describe('SelectionManager toggleSelectAll', () => {
  it('selects and deselects all faces with A-style toggle', () => {
    const document = createEmptyDocument();
    const mesh = buildBox({ width: 1, height: 1, depth: 1 });
    commitMeshObject(document, mesh);
    const selection = new SelectionManager();
    selection.setMode('face');
    selection.selectObjects([[...document.objects.keys()][0]!], 'replace');

    expect(selection.toggleSelectAll(mesh, document)).toBe(true);
    expect(selection.state.selectedFaceIds.size).toBe(mesh.faces.size);

    expect(selection.toggleSelectAll(mesh, document)).toBe(true);
    expect(selection.state.selectedFaceIds.size).toBe(0);
  });

  it('selects and deselects all objects in object mode', () => {
    const document = createEmptyDocument();
    commitMeshObject(document, buildBox({ width: 1, height: 1, depth: 1 }), { name: 'A' });
    commitMeshObject(document, buildBox({ width: 1, height: 1, depth: 1 }), { name: 'B' });
    const selection = new SelectionManager();
    selection.setMode('object');

    expect(selection.toggleSelectAll(undefined, document)).toBe(true);
    expect(selection.state.selectedObjectIds.size).toBe(2);

    expect(selection.toggleSelectAll(undefined, document)).toBe(true);
    expect(selection.state.selectedObjectIds.size).toBe(0);
  });

  it('deselectAll clears only the active mode', () => {
    const document = createEmptyDocument();
    const mesh = buildBox({ width: 1, height: 1, depth: 1 });
    const { objectId } = commitMeshObject(document, mesh);
    const selection = new SelectionManager();
    selection.setMode('object');
    selection.selectObjects([objectId], 'replace');
    selection.setMode('vertex');
    selection.selectVertices([[...mesh.vertices.keys()][0]!], 'replace');

    selection.deselectAll();
    expect(selection.state.selectedVertexIds.size).toBe(0);
    expect(selection.state.selectedObjectIds.has(objectId)).toBe(true);
  });
});
