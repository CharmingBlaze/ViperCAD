import { describe, expect, it } from 'vitest';
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
