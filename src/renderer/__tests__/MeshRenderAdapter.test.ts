import { describe, expect, it } from 'vitest';
import { createDefaultMaterial } from '@/core/document/ModelDocument';
import { faceCornerIds } from '@/core/mesh/EditableMesh';
import { buildPlane } from '@/core/mesh/builders/PlaneBuilder';
import { createObjectRenderHandle, updateObjectRenderHandle } from '@/renderer/MeshRenderAdapter';
import { evaluateMeshAsync } from '@/renderer/workers/MeshEvaluationWorkerClient';
import type { BufferAttribute } from 'three';

describe('MeshRenderAdapter live updates', () => {
  it('updates the Three.js UV buffer when editable UV coordinates change', () => {
    const mesh = buildPlane({ width: 1, depth: 1 });
    const material = createDefaultMaterial();
    const handle = createObjectRenderHandle('object', mesh, [material]);
    const faceId = [...mesh.faces.keys()][0]!;
    const cornerId = faceCornerIds(mesh, faceId)[0]!;
    const renderIndex = handle.renderData.renderCornerIds.indexOf(cornerId);
    expect(renderIndex).toBeGreaterThanOrEqual(0);

    const layerId = mesh.defaultUvLayerId!;
    mesh.faceCorners.get(cornerId)!.uvs.set(layerId, { x: 0.37, y: 0.61 });
    mesh.geometryVersion += 1;
    mesh.dirty.uvs = true;
    updateObjectRenderHandle(handle, mesh, [material]);

    const uv = handle.mesh.geometry.getAttribute('uv') as BufferAttribute;
    expect(uv.getX(renderIndex)).toBeCloseTo(0.37);
    expect(uv.getY(renderIndex)).toBeCloseTo(0.61);
    expect(uv.updateRanges).toEqual([{ start: renderIndex * 2, count: 2 }]);
  });

  it('uploads only the changed position span when topology is stable', () => {
    const mesh = buildPlane({ width: 1, depth: 1 });
    const material = createDefaultMaterial();
    const handle = createObjectRenderHandle('object', mesh, [material]);
    const vertexId = [...mesh.vertices.keys()][0]!;
    const renderIndices = handle.renderData.renderVertexIds
      .map((id, index) => id === vertexId ? index : -1)
      .filter((index) => index >= 0);
    mesh.vertices.get(vertexId)!.position.y = 2;
    mesh.geometryVersion += 1;
    updateObjectRenderHandle(handle, mesh, [material]);
    const position = handle.mesh.geometry.getAttribute('position') as BufferAttribute;
    const range = position.updateRanges[0]!;
    expect(range.start).toBe(Math.min(...renderIndices) * 3);
    expect(range.start + range.count).toBe(Math.max(...renderIndices) * 3 + 3);
  });

  it('evaluates transferable mesh buffers through the worker fallback', async () => {
    const mesh = buildPlane({ width: 2, depth: 3 });
    const result = await evaluateMeshAsync(mesh);
    expect(result.positions).toBeInstanceOf(Float32Array);
    expect(result.indices).toBeInstanceOf(Uint32Array);
    expect(result.triangleMap).toHaveLength(2);
    expect(result.topologyVersion).toBe(mesh.topologyVersion);
  });
});
