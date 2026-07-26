import type { EditableMesh } from '@/core/mesh/types';
import { editableMeshToRenderData } from '@/renderer/MeshRenderAdapter';
import type { MeshEvaluationResult } from './MeshEvaluationTypes';

let worker: Worker | null = null;
let nextJobId = 1;
const jobs = new Map<number, { resolve: (result: MeshEvaluationResult) => void; reject: (error: Error) => void }>();

export function evaluateMeshAsync(mesh: EditableMesh): Promise<MeshEvaluationResult> {
  if (typeof Worker === 'undefined') return Promise.resolve(evaluateOnMainThread(mesh));
  if (!worker) {
    worker = new Worker(new URL('./MeshEvaluation.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (event: MessageEvent<{ id: number; result?: MeshEvaluationResult; error?: string }>) => {
      const job = jobs.get(event.data.id);
      if (!job) return;
      jobs.delete(event.data.id);
      if (event.data.result) job.resolve(event.data.result);
      else job.reject(new Error(event.data.error ?? 'Mesh evaluation failed'));
    };
    worker.onerror = (event) => {
      const error = new Error(event.message || 'Mesh evaluation worker failed');
      for (const job of jobs.values()) job.reject(error);
      jobs.clear();
      worker?.terminate();
      worker = null;
    };
  }
  const id = nextJobId++;
  return new Promise((resolve, reject) => {
    jobs.set(id, { resolve, reject });
    worker!.postMessage({ id, mesh });
  });
}

function evaluateOnMainThread(mesh: EditableMesh): MeshEvaluationResult {
  const evaluated = editableMeshToRenderData(mesh);
  const geometry = evaluated.geometry;
  return {
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
}
