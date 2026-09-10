import { beforeEach, describe, expect, it } from 'vitest';
import {
  applyVertexBezierControl,
  createVertexBezierState,
  isVertexBezierPrepared,
  orderVerticesForCurve,
  prepareVertexBezierMesh,
  resolveVertexIdsForCurve,
} from '@/core/curves/BezierFromVertices';
import { resetIdCounter } from '@/core/ids/IdService';
import { faceVertexIds } from '@/core/mesh/EditableMesh';
import { buildBox, buildPlane } from '@/core/mesh/builders';
import { validateMeshFull } from '@/core/mesh/Validation';
import { lengthSqVec3, subVec3, v3 } from '@/core/math/Vec3';

beforeEach(() => resetIdCounter(1));

describe('BezierFromVertices', () => {
  it('orders a connected open vertex chain from endpoints', () => {
    const mesh = buildBox({ width: 1, height: 1, depth: 1 });
    const faceId = [...mesh.faces.keys()][0]!;
    const loop = faceVertexIds(mesh, faceId);
    const selected = loop.slice(0, 3);
    const ordered = orderVerticesForCurve(mesh, selected);
    expect(ordered.vertexIds).toHaveLength(3);
    expect(ordered.cyclic).toBe(false);
    expect(new Set(ordered.vertexIds)).toEqual(new Set(selected));
  });

  it('orders a closed face loop as a cyclic curve', () => {
    const mesh = buildPlane({ width: 2, depth: 2 });
    const ordered = orderVerticesForCurve(mesh, [...mesh.vertices.keys()]);
    expect(ordered.vertexIds).toHaveLength(4);
    expect(ordered.cyclic).toBe(true);
  });

  it('uses all mesh vertices when nothing is selected', () => {
    const mesh = buildBox({ width: 1, height: 1, depth: 1 });
    const ids = resolveVertexIdsForCurve(mesh, {
      mode: 'vertex',
      selectedVertexIds: new Set(),
      selectedEdgeIds: new Set(),
    });
    expect(ids).toHaveLength(8);
  });

  it('prepares edge samples so handles can bend the mesh without invalid topology', () => {
    const mesh = buildBox({ width: 1, height: 1, depth: 1 });
    const state = prepareVertexBezierMesh('obj', mesh, {
      mode: 'vertex',
      selectedVertexIds: new Set(),
      selectedEdgeIds: new Set(),
    });
    expect('error' in state).toBe(false);
    if ('error' in state) return;
    expect(isVertexBezierPrepared(mesh, state)).toBe(true);
    expect(state.segments.length).toBe(12);
    expect(mesh.vertices.size).toBeGreaterThan(8);
    expect(validateMeshFull(mesh).ok).toBe(true);
  });

  it('moves a handle and actually curves an edge', () => {
    const mesh = buildBox({ width: 1, height: 1, depth: 1 });
    const state = prepareVertexBezierMesh('obj', mesh, {
      mode: 'vertex',
      selectedVertexIds: new Set(),
      selectedEdgeIds: new Set(),
    });
    expect('error' in state).toBe(false);
    if ('error' in state) return;
    const segment = state.segments[0]!;
    const start = mesh.vertices.get(segment.startId)!.position;
    const end = mesh.vertices.get(segment.endId)!.position;
    const midId = segment.sampleIds[Math.floor(segment.sampleIds.length / 2)]!;
    const beforeMid = { ...mesh.vertices.get(midId)!.position };
    const handle = v3(start.x + 0.6, start.y + 0.8, start.z);
    applyVertexBezierControl(mesh, state, { kind: 'handle-out', index: 0 }, handle);
    const afterMid = mesh.vertices.get(midId)!.position;
    const chord = subVec3(end, start);
    const toMid = subVec3(afterMid, start);
    const t = (toMid.x * chord.x + toMid.y * chord.y + toMid.z * chord.z) / Math.max(1e-8, lengthSqVec3(chord));
    const onChord = v3(start.x + chord.x * t, start.y + chord.y * t, start.z + chord.z * t);
    expect(lengthSqVec3(subVec3(afterMid, onChord))).toBeGreaterThan(0.01);
    expect(lengthSqVec3(subVec3(afterMid, beforeMid))).toBeGreaterThan(0);
    expect(validateMeshFull(mesh).ok).toBe(true);
  });

  it('creates one Bézier segment per connected edge', () => {
    const mesh = buildPlane({ width: 2, depth: 2 });
    const state = createVertexBezierState('obj', mesh, {
      mode: 'vertex',
      selectedVertexIds: new Set(),
      selectedEdgeIds: new Set(),
    });
    expect('error' in state).toBe(false);
    if ('error' in state) return;
    expect(state.segments).toHaveLength(4);
  });
});
