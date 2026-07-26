import { describe, expect, it, beforeEach } from 'vitest';
import { resetIdCounter } from '@/core/ids/IdService';
import { buildBox, buildPlane } from '@/core/mesh/builders';
import { faceHalfEdgeIds, getMeshStats, isBoundaryEdge } from '@/core/mesh/EditableMesh';
import { extrudeEdges, extrudeFaceRegion } from '@/core/mesh/ops/extrude';
import { validateMeshFull } from '@/core/mesh/Validation';
import { CommandHistory } from '@/core/history/CommandHistory';
import { runMeshTransaction } from '@/core/history/Transaction';

beforeEach(() => {
  resetIdCounter(1);
});

describe('Face region extrude', () => {
  it('extrudes one face and remains manifold and valid', () => {
    const mesh = buildBox({ width: 1, height: 1, depth: 1 });
    const faceId = [...mesh.faces.keys()][0]!;
    const beforeFaces = mesh.faces.size;

    const result = extrudeFaceRegion(mesh, [faceId], { distance: 0.5 });
    expect(result.ok).toBe(true);

    const report = validateMeshFull(mesh);
    expect(report.ok).toBe(true);

    // Original face removed, top + 4 sides added => +4 faces net.
    expect(mesh.faces.size).toBe(beforeFaces + 4);
    expect(getMeshStats(mesh).boundaryEdges).toBe(0);
  });

  it('allows zero-distance extrude for interactive grab (warnings only)', () => {
    const mesh = buildBox({ width: 1, height: 1, depth: 1 });
    const faceId = [...mesh.faces.keys()][0]!;
    const result = extrudeFaceRegion(mesh, [faceId], { distance: 0 });
    expect(result.ok).toBe(true);
    expect(validateMeshFull(mesh).ok).toBe(true);
  });

  it('is undoable via mesh transaction', () => {
    const mesh = buildBox({ width: 1, height: 1, depth: 1 });
    const history = new CommandHistory();
    const faceId = [...mesh.faces.keys()][0]!;
    const vertsBefore = mesh.vertices.size;

    const tx = runMeshTransaction(history, mesh, 'Extrude', (m) => {
      return extrudeFaceRegion(m, [faceId], { distance: 1 });
    }, { fullValidation: true });

    expect(tx.ok).toBe(true);
    expect(mesh.vertices.size).toBeGreaterThan(vertsBefore);

    history.undo();
    expect(mesh.vertices.size).toBe(vertsBefore);
    expect(validateMeshFull(mesh).ok).toBe(true);

    history.redo();
    expect(mesh.vertices.size).toBeGreaterThan(vertsBefore);
    expect(validateMeshFull(mesh).ok).toBe(true);
  });
});

describe('Edge extrude', () => {
  it('extrudes a boundary edge of a plane into a side face', () => {
    const mesh = buildPlane({ width: 2, depth: 2 });
    const boundary = [...mesh.edges.keys()].filter((id) => isBoundaryEdge(mesh, id));
    expect(boundary.length).toBe(4);
    const beforeFaces = mesh.faces.size;
    const result = extrudeEdges(mesh, [boundary[0]!], { distance: 0.5 });
    expect(result.ok).toBe(true);
    expect(mesh.faces.size).toBe(beforeFaces + 1);
    expect(validateMeshFull(mesh).ok).toBe(true);
  });

  it('extrudes a face when all of its edges are selected', () => {
    const mesh = buildBox({ width: 1, height: 1, depth: 1 });
    const faceId = [...mesh.faces.keys()][0]!;
    const edgeIds = faceHalfEdgeIds(mesh, faceId).map((heId) => mesh.halfEdges.get(heId)!.edgeId);
    const before = mesh.faces.size;
    const result = extrudeEdges(mesh, edgeIds, { distance: 0.25 });
    expect(result.ok).toBe(true);
    expect(mesh.faces.size).toBe(before + 4);
    expect(validateMeshFull(mesh).ok).toBe(true);
  });
});
