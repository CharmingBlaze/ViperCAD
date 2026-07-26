import { describe, expect, it } from 'vitest';
import { commitMeshObject } from '@/core/document/ModelDocument';
import { EditorSession } from '@/core/editor/EditorSession';
import { buildBox } from '@/core/mesh/builders/BoxBuilder';

describe('EditorSession snapping', () => {
  it('creates and offsets a construction plane from the active face', () => {
    const session = new EditorSession();
    const mesh = buildBox({ width: 2, height: 2, depth: 2 });
    const { objectId } = commitMeshObject(session.document, mesh);
    const faceId = [...mesh.faces.keys()][0]!;
    session.selection.setMode('face');
    session.selection.selectObjects([objectId], 'replace');
    session.selection.selectFaces([faceId], 'replace');

    expect(session.setConstructionPlaneFromSelection()).toBe(true);
    const before = { ...session.constructionPlane.origin };
    session.offsetConstructionPlane(0.5);
    const moved = session.constructionPlane.origin;
    expect(Math.hypot(moved.x - before.x, moved.y - before.y, moved.z - before.z)).toBeCloseTo(0.5);
  });

  it('resolves vertices, midpoints, edges, and face centres from the shared index', () => {
    const session = new EditorSession();
    const mesh = buildBox({ width: 2, height: 2, depth: 2 });
    commitMeshObject(session.document, mesh);
    const context = session.context();

    const vertex = context.resolveSnap({
      rawPosition: { x: 1.01, y: 1.01, z: 1.01 },
      allowed: ['vertex', 'edgeMid', 'edge', 'faceCentre'],
      maxWorldDistance: 0.2,
    });
    expect(vertex.targetType).toBe('vertex');
    expect(vertex.position).toEqual({ x: 1, y: 1, z: 1 });

    const midpoint = context.resolveSnap({
      rawPosition: { x: 0.01, y: 1.01, z: 1.01 },
      allowed: ['edgeMid', 'edge'],
      maxWorldDistance: 0.2,
    });
    expect(midpoint.targetType).toBe('edgeMid');
    expect(midpoint.position).toEqual({ x: 0, y: 1, z: 1 });
  });

  it('raycasts the nearest mesh surface and returns its normal', () => {
    const session = new EditorSession();
    const mesh = buildBox({ width: 2, height: 2, depth: 2 });
    commitMeshObject(session.document, mesh);

    const surface = session.context().resolveSnap({
      rawPosition: { x: 0, y: 0, z: 0 },
      pointerRayOrigin: { x: 0, y: 0, z: 5 },
      pointerRayDirection: { x: 0, y: 0, z: -1 },
      allowed: ['face'],
      maxWorldDistance: 0.2,
    });

    expect(surface.targetType).toBe('face');
    expect(surface.position.z).toBeCloseTo(1);
    expect(surface.worldNormal?.z).toBeCloseTo(1);
  });

  it('does not return excluded components', () => {
    const session = new EditorSession();
    const mesh = buildBox({ width: 2, height: 2, depth: 2 });
    commitMeshObject(session.document, mesh);
    const excluded = [...mesh.vertices.values()].find(
      (vertex) => vertex.position.x === 1 && vertex.position.y === 1 && vertex.position.z === 1,
    )!;

    const result = session.context().resolveSnap({
      rawPosition: { x: 1, y: 1, z: 1 },
      allowed: ['vertex'],
      excludedElementIds: [excluded.id],
      maxWorldDistance: 0.1,
    });
    expect(result.targetType).toBe('none');
  });
});
