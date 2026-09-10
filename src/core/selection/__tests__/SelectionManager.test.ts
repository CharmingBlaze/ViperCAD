import { describe, expect, it } from 'vitest';
import { commitMeshObject, createEmptyDocument } from '@/core/document/ModelDocument';
import { buildBox } from '@/core/mesh/builders/BoxBuilder';
import { faceVertexIds } from '@/core/mesh/EditableMesh';
import { SelectionManager } from '@/core/selection/SelectionManager';

describe('SelectionManager edit modes', () => {
  it('converts a face selection to its vertices and back to the same face', () => {
    const mesh = buildBox({ width: 1, height: 1, depth: 1 });
    const faceId = [...mesh.faces.keys()][0]!;
    const verts = faceVertexIds(mesh, faceId);
    const selection = new SelectionManager();
    selection.setMode('face');
    selection.selectFaces([faceId], 'replace');

    selection.switchEditMode('vertex', mesh);
    expect(selection.state.mode).toBe('vertex');
    expect([...selection.state.selectedVertexIds].sort()).toEqual([...verts].sort());

    selection.switchEditMode('face', mesh);
    expect(selection.state.mode).toBe('face');
    expect([...selection.state.selectedFaceIds]).toEqual([faceId]);
  });

  it('restores the per-mode cache when the other mode has an empty selection', () => {
    const mesh = buildBox({ width: 1, height: 1, depth: 1 });
    const vertexId = [...mesh.vertices.keys()][0]!;
    const selection = new SelectionManager();
    selection.setMode('vertex');
    selection.selectVertices([vertexId], 'replace');
    // One vertex does not contain an edge, so this converts to an empty edge selection
    // and stashes the vertex for later.
    selection.switchEditMode('edge', mesh);
    expect(selection.state.mode).toBe('edge');
    expect(selection.state.selectedEdgeIds.size).toBe(0);

    selection.switchEditMode('vertex', mesh);
    expect(selection.state.selectedVertexIds.has(vertexId)).toBe(true);
  });

  it('grows a vertex across its edges and connected fills the mesh', () => {
    const mesh = buildBox({ width: 1, height: 1, depth: 1 });
    const vertexId = [...mesh.vertices.keys()][0]!;
    const selection = new SelectionManager();
    selection.setMode('vertex');
    selection.selectVertices([vertexId], 'replace');
    selection.grow(mesh);
    expect(selection.state.selectedVertexIds.size).toBeGreaterThan(1);
    selection.selectConnected(mesh);
    expect(selection.state.selectedVertexIds.size).toBe(mesh.vertices.size);
  });

  it('shrinks a face island down to interior faces', () => {
    const mesh = buildBox({ width: 1, height: 1, depth: 1 });
    const faceIds = [...mesh.faces.keys()];
    const keepOut = faceIds[0]!;
    const selection = new SelectionManager();
    selection.setMode('face');
    selection.selectFaces(faceIds.filter((id) => id !== keepOut), 'replace');
    expect(selection.state.selectedFaceIds.size).toBe(5);
    selection.shrink(mesh);
    expect(selection.state.selectedFaceIds.size).toBe(1);
    expect(selection.state.selectedFaceIds.has(keepOut)).toBe(false);
  });
});

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
