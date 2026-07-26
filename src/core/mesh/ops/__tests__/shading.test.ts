import { beforeEach, describe, expect, it } from 'vitest';
import { resetIdCounter } from '@/core/ids/IdService';
import { buildBox } from '@/core/mesh/builders';
import { getEdgeVertices } from '@/core/mesh/EditableMesh';
import {
  resolveEditFaceIds,
  resolveShadingFaceIds,
  resolveSharpEdgeIds,
  setEdgeSharpness,
  setFacesShading,
} from '@/core/mesh/ops/shading';
import { pokeFaces } from '@/core/mesh/ops/subdivide';
import { validateMeshFull } from '@/core/mesh/Validation';

beforeEach(() => resetIdCounter(1));

describe('setFacesShading', () => {
  it('sets flat and smooth shading on selected faces', () => {
    const mesh = buildBox({ width: 1, height: 1, depth: 1 });
    const faceId = [...mesh.faces.keys()][0]!;
    expect(setFacesShading(mesh, [faceId], 'smooth').ok).toBe(true);
    expect(mesh.faces.get(faceId)!.flatShaded).toBe(false);
    expect(setFacesShading(mesh, [faceId], 'flat').ok).toBe(true);
    expect(mesh.faces.get(faceId)!.flatShaded).toBe(true);
  });

  it('rejects empty face lists', () => {
    const mesh = buildBox({ width: 1, height: 1, depth: 1 });
    expect(setFacesShading(mesh, [], 'smooth').ok).toBe(false);
  });
});

describe('setEdgeSharpness', () => {
  it('marks and clears sharp edges', () => {
    const mesh = buildBox({ width: 1, height: 1, depth: 1 });
    const edgeId = [...mesh.edges.keys()][0]!;
    expect(setEdgeSharpness(mesh, [edgeId], 1).ok).toBe(true);
    expect(mesh.edges.get(edgeId)!.sharpness).toBe(1);
    expect(setEdgeSharpness(mesh, [edgeId], 0).ok).toBe(true);
    expect(mesh.edges.get(edgeId)!.sharpness).toBe(0);
    expect(getEdgeVertices(mesh, edgeId)).toBeTruthy();
  });
});

describe('selection resolvers', () => {
  it('falls back to the whole mesh when selection is empty', () => {
    const mesh = buildBox({ width: 1, height: 1, depth: 1 });
    const empty = {
      mode: 'face' as const,
      selectedFaceIds: [],
      selectedEdgeIds: [],
      selectedVertexIds: [],
    };
    expect(resolveShadingFaceIds(mesh, empty)).toHaveLength(mesh.faces.size);
    expect(resolveSharpEdgeIds(mesh, empty)).toHaveLength(mesh.edges.size);
    expect(resolveEditFaceIds(mesh, empty)).toHaveLength(mesh.faces.size);
  });

  it('resolves incident faces from edge selection', () => {
    const mesh = buildBox({ width: 1, height: 1, depth: 1 });
    const edgeId = [...mesh.edges.keys()][0]!;
    const faces = resolveShadingFaceIds(mesh, {
      mode: 'edge',
      selectedFaceIds: [],
      selectedEdgeIds: [edgeId],
      selectedVertexIds: [],
    });
    expect(faces.length).toBeGreaterThanOrEqual(1);
  });
});

describe('pokeFaces shading preservation', () => {
  it('keeps a valid mesh after poke', () => {
    const mesh = buildBox({ width: 1, height: 1, depth: 1 });
    const faceId = [...mesh.faces.keys()][0]!;
    mesh.faces.get(faceId)!.flatShaded = false;
    const result = pokeFaces(mesh, [faceId]);
    expect(result.ok).toBe(true);
    expect(validateMeshFull(mesh).ok).toBe(true);
    expect([...result.change.createdFaceIds].every((id) => mesh.faces.get(id)?.flatShaded === false)).toBe(true);
  });
});
