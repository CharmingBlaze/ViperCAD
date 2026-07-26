import { beforeEach, describe, expect, it } from 'vitest';
import { createEmptyDocument } from '@/core/document/ModelDocument';
import { DEFAULT_PROJECT_SETTINGS } from '@/core/document/types';
import { resetIdCounter } from '@/core/ids/IdService';
import { v3 } from '@/core/math/Vec3';
import { addVertex, createEmptyMesh } from '@/core/mesh/EditableMesh';
import { buildBox } from '@/core/mesh/builders/BoxBuilder';
import {
  applyLiveSymmetricVertexEdit,
  expandSymmetryEdgeIds,
  expandSymmetryFaceIds,
  expandSymmetryVertexIds,
  setModellingProfile,
  symmetryOperations,
} from '@/core/symmetry/Symmetry';

beforeEach(() => resetIdCounter(1));

const settings = () => ({
  ...DEFAULT_PROJECT_SETTINGS.symmetry,
  liveMirror: true,
});

describe('symmetry', () => {
  it('enables X symmetry by default for character documents and profiles', () => {
    const character = createEmptyDocument('Character', { modellingProfile: 'character' });
    expect(character.settings.modellingProfile).toBe('character');
    expect(character.settings.symmetry.x).toBe(true);
    expect(character.settings.symmetry.liveMirror).toBe(true);

    const general = createEmptyDocument();
    setModellingProfile(general, 'character');
    expect(general.settings.symmetry.x).toBe(true);
    expect(general.settings.symmetry.liveMirror).toBe(true);
  });

  it('builds combined X, Y, Z and radial operations', () => {
    const operations = symmetryOperations({
      ...settings(),
      x: true,
      y: true,
      z: true,
      radialEnabled: true,
      radialAxis: 'y',
      radialCount: 4,
    });
    expect(operations).toHaveLength(31);
    expect(operations.find((operation) => operation.key === 'mirror-xyz')?.apply(v3(1, 2, 3)))
      .toEqual(v3(-1, -2, -3));
    const quarterTurn = operations.find((operation) => operation.key === 'identity-radial-1');
    expect(quarterTurn?.apply(v3(1, 0, 0)).x).toBeCloseTo(0);
    expect(quarterTurn?.apply(v3(1, 0, 0)).z).toBeCloseTo(-1);
  });

  it('moves an existing X counterpart live and keeps seam vertices on the mirror plane', () => {
    const mesh = createEmptyMesh('Symmetric');
    const right = addVertex(mesh, v3(1, 0, 0));
    const left = addVertex(mesh, v3(-1, 0, 0));
    const seam = addVertex(mesh, v3(0, 0, 0));
    const xSettings = { ...settings(), x: true };

    expect(expandSymmetryVertexIds(mesh, [right], xSettings)).toEqual(new Set([right, left]));
    applyLiveSymmetricVertexEdit(
      mesh,
      new Map([[right, v3(1, 0, 0)]]),
      new Map([[right, v3(1.5, 0.25, 0)]]),
      xSettings,
    );
    expect(mesh.vertices.get(left)?.position).toEqual(v3(-1.5, 0.25, 0));

    applyLiveSymmetricVertexEdit(
      mesh,
      new Map([[seam, v3(0, 0, 0)]]),
      new Map([[seam, v3(0.4, 1, 0)]]),
      xSettings,
    );
    expect(mesh.vertices.get(seam)?.position.x).toBeCloseTo(0);
    expect(mesh.vertices.get(seam)?.position.y).toBeCloseTo(1);
  });

  it('applies a live radial deformation to every existing counterpart', () => {
    const mesh = createEmptyMesh('Radial');
    const east = addVertex(mesh, v3(1, 0, 0));
    addVertex(mesh, v3(0, 0, -1));
    addVertex(mesh, v3(-1, 0, 0));
    const south = addVertex(mesh, v3(0, 0, 1));
    const radial = {
      ...settings(),
      radialEnabled: true,
      radialAxis: 'y' as const,
      radialCount: 4,
    };

    applyLiveSymmetricVertexEdit(
      mesh,
      new Map([[east, v3(1, 0, 0)]]),
      new Map([[east, v3(2, 0.5, 0)]]),
      radial,
    );
    expect(mesh.vertices.get(south)?.position.x).toBeCloseTo(0);
    expect(mesh.vertices.get(south)?.position.y).toBeCloseTo(0.5);
    expect(mesh.vertices.get(south)?.position.z).toBeCloseTo(2);
  });

  it('finds mirrored edge and face counterparts from their vertices', () => {
    const mesh = buildBox({ width: 2, height: 2, depth: 2 });
    const xSettings = { ...settings(), x: true };
    const positiveFace = [...mesh.faces.keys()].find((id) =>
      meshFaceX(mesh, id).every((x) => x > 0),
    )!;
    const negativeFace = [...mesh.faces.keys()].find((id) =>
      meshFaceX(mesh, id).every((x) => x < 0),
    )!;
    const positiveEdge = [...mesh.edges.keys()].find((id) => {
      const pair = meshEdgeX(mesh, id);
      return pair.length === 2 && pair.every((x) => x > 0);
    })!;
    const mirroredEdges = expandSymmetryEdgeIds(mesh, [positiveEdge], xSettings);

    expect(expandSymmetryFaceIds(mesh, [positiveFace], xSettings))
      .toEqual(new Set([positiveFace, negativeFace]));
    expect(mirroredEdges.size).toBe(2);
    expect(mirroredEdges).toContain(positiveEdge);
  });
});

function meshFaceX(mesh: ReturnType<typeof buildBox>, faceId: string): number[] {
  const face = mesh.faces.get(faceId)!;
  const values: number[] = [];
  let halfEdgeId = face.firstHalfEdgeId;
  do {
    const halfEdge = mesh.halfEdges.get(halfEdgeId)!;
    values.push(mesh.vertices.get(halfEdge.originVertexId)!.position.x);
    halfEdgeId = halfEdge.nextHalfEdgeId;
  } while (halfEdgeId !== face.firstHalfEdgeId);
  return values;
}

function meshEdgeX(mesh: ReturnType<typeof buildBox>, edgeId: string): number[] {
  const edge = mesh.edges.get(edgeId)!;
  const halfEdge = mesh.halfEdges.get(edge.halfEdgeAId)!;
  const next = mesh.halfEdges.get(halfEdge.nextHalfEdgeId)!;
  return [
    mesh.vertices.get(halfEdge.originVertexId)!.position.x,
    mesh.vertices.get(next.originVertexId)!.position.x,
  ];
}
