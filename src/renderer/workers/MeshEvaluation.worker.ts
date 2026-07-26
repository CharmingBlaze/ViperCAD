/// <reference lib="webworker" />
import { editableMeshToRenderData } from '@/renderer/MeshRenderAdapter';
import type { EditableMesh } from '@/core/mesh/types';
import type { MeshEvaluationResult } from './MeshEvaluationTypes';

self.onmessage = (event: MessageEvent<{ id: number; mesh: EditableMesh }>) => {
  const { id, mesh } = event.data;
  try {
    const evaluated = editableMeshToRenderData(mesh);
    const geometry = evaluated.geometry;
    const result: MeshEvaluationResult = {
      positions: geometry.getAttribute('position').array as Float32Array,
      normals: geometry.getAttribute('normal').array as Float32Array,
      uvs: geometry.getAttribute('uv').array as Float32Array,
      atlasTileRects: geometry.getAttribute('atlasTileRect').array as Float32Array,
      secondaryUvs: geometry.getAttribute('uv1')?.array as Float32Array | undefined ?? null,
      indices: new Uint32Array(geometry.index?.array ?? []),
      triangleMap: evaluated.triangleMap,
      renderVertexIds: evaluated.renderVertexIds,
      renderCornerIds: evaluated.renderCornerIds,
      materialGroups: evaluated.materialGroups,
      geometryVersion: evaluated.geometryVersion,
      topologyVersion: evaluated.topologyVersion,
    };
    const transfers: Transferable[] = [
      result.positions.buffer,
      result.normals.buffer,
      result.uvs.buffer,
      result.atlasTileRects.buffer,
      result.indices.buffer,
    ];
    if (result.secondaryUvs) transfers.push(result.secondaryUvs.buffer);
    self.postMessage({ id, result }, { transfer: transfers });
  } catch (error) {
    self.postMessage({ id, error: error instanceof Error ? error.message : String(error) });
  }
};
