import { describe, expect, it, vi } from 'vitest';
import {
  applyFillHotkey,
  applyMergeHotkey,
  canFillSelection,
  canMergeSelection,
} from '@/app/ModelingEditHotkeys';
import { commitMeshObject, createEmptyDocument } from '@/core/document/ModelDocument';
import { EditorSession } from '@/core/editor/EditorSession';
import { buildBox } from '@/core/mesh/builders/BoxBuilder';
import { addVertex, createEmptyMesh, isBoundaryEdge, removeFace } from '@/core/mesh/EditableMesh';
import { v3 } from '@/core/math/Vec3';

function sessionWithBox() {
  vi.stubGlobal('HTMLElement', class {});
  const document = createEmptyDocument();
  const { objectId } = commitMeshObject(document, buildBox({ width: 1, height: 1, depth: 1 }));
  const session = new EditorSession(document);
  session.selection.setMode('object');
  session.selection.selectObjects([objectId], 'replace');
  const mesh = session.document.meshes.get(session.document.objects.get(objectId)!.meshId!)!;
  return { session, mesh, objectId };
}

describe('ModelingEditHotkeys fill and merge', () => {
  it('makes a face from three vertices with F', () => {
    vi.stubGlobal('HTMLElement', class {});
    const document = createEmptyDocument();
    const mesh = createEmptyMesh('Draw');
    const a = addVertex(mesh, v3(0, 0, 0));
    const b = addVertex(mesh, v3(1, 0, 0));
    const c = addVertex(mesh, v3(0, 0, 1));
    const { objectId } = commitMeshObject(document, mesh);
    const session = new EditorSession(document);
    session.selection.selectObjects([objectId], 'replace');
    session.selection.switchEditMode('vertex', mesh);
    session.selection.selectVertices([a, b, c], 'replace');

    expect(canFillSelection(session)).toBe(true);
    expect(applyFillHotkey(session)).toBe(true);
    expect(mesh.faces.size).toBe(1);
  });

  it('fills the remaining hole with F after a face is deleted', () => {
    const { session, mesh } = sessionWithBox();
    const faceId = [...mesh.faces.keys()][0]!;
    removeFace(mesh, faceId);
    session.selection.switchEditMode('face', mesh);
    session.selection.selectFaces([], 'replace');

    expect(canFillSelection(session)).toBe(true);
    expect(applyFillHotkey(session)).toBe(true);
    expect(mesh.faces.size).toBe(6);
  });

  it('fills a hole from a boundary edge with F', () => {
    const { session, mesh } = sessionWithBox();
    const faceId = [...mesh.faces.keys()][0]!;
    removeFace(mesh, faceId);
    const seed = [...mesh.edges.keys()].find((id) => isBoundaryEdge(mesh, id))!;
    session.selection.switchEditMode('edge', mesh);
    session.selection.selectEdges([seed], 'replace');

    expect(canFillSelection(session)).toBe(true);
    expect(applyFillHotkey(session)).toBe(true);
    expect(mesh.faces.size).toBe(6);
  });

  it('merges selected vertices at center', () => {
    const { session, mesh } = sessionWithBox();
    const verts = [...mesh.vertices.keys()].slice(0, 2);
    session.selection.switchEditMode('vertex', mesh);
    session.selection.selectVertices(verts, 'replace');
    const before = mesh.vertices.size;

    expect(canMergeSelection(session)).toBe(true);
    expect(applyMergeHotkey(session)).toBe(true);
    expect(mesh.vertices.size).toBe(before - 1);
  });

  it('collapses a selected edge with merge', () => {
    const { session, mesh } = sessionWithBox();
    const edgeId = [...mesh.edges.keys()][0]!;
    session.selection.switchEditMode('edge', mesh);
    session.selection.selectEdges([edgeId], 'replace');
    const before = mesh.vertices.size;

    expect(canMergeSelection(session)).toBe(true);
    expect(applyMergeHotkey(session)).toBe(true);
    expect(mesh.vertices.size).toBeLessThan(before);
  });
});
