import type { EditableMesh, FaceCornerId, FaceId, UvLayerId } from '@/core/mesh/types';
import { packSelectedUvIslands } from '@/core/uv/UvOperations';

type UvUpdate = readonly [FaceCornerId, number, number];
let worker: Worker | null = null;
let nextJobId = 1;
const jobs = new Map<number, { resolve: (updates: UvUpdate[]) => void; reject: (error: Error) => void }>();

export async function packUvsAsync(
  mesh: EditableMesh,
  faceIds: FaceId[],
  padding: number,
  layerId: UvLayerId,
): Promise<void> {
  const topologyVersion = mesh.topologyVersion;
  const geometryVersion = mesh.geometryVersion;
  const updates = typeof Worker === 'undefined'
    ? packOnMainThread(mesh, faceIds, padding, layerId)
    : await packInWorker(mesh, faceIds, padding, layerId);
  if (mesh.topologyVersion !== topologyVersion || mesh.geometryVersion !== geometryVersion) {
    throw new Error('Mesh changed while UV packing was running; pack again.');
  }
  for (const [cornerId, x, y] of updates) mesh.faceCorners.get(cornerId)?.uvs.set(layerId, { x, y });
  mesh.geometryVersion += 1;
  mesh.dirty.uvs = true;
}

function packInWorker(mesh: EditableMesh, faceIds: FaceId[], padding: number, layerId: UvLayerId): Promise<UvUpdate[]> {
  if (!worker) {
    worker = new Worker(new URL('./UvPacking.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (event: MessageEvent<{ id: number; updates?: UvUpdate[]; error?: string }>) => {
      const job = jobs.get(event.data.id);
      if (!job) return;
      jobs.delete(event.data.id);
      if (event.data.updates) job.resolve(event.data.updates);
      else job.reject(new Error(event.data.error ?? 'UV packing failed'));
    };
    worker.onerror = (event) => {
      const error = new Error(event.message || 'UV packing worker failed');
      for (const job of jobs.values()) job.reject(error);
      jobs.clear();
      worker?.terminate();
      worker = null;
    };
  }
  const id = nextJobId++;
  return new Promise((resolve, reject) => {
    jobs.set(id, { resolve, reject });
    worker!.postMessage({ id, mesh, faceIds, padding, layerId });
  });
}

function packOnMainThread(mesh: EditableMesh, faceIds: FaceId[], padding: number, layerId: UvLayerId): UvUpdate[] {
  const copy = structuredClone(mesh);
  packSelectedUvIslands(copy, faceIds, padding, layerId);
  return [...copy.faceCorners.values()].map((corner) => {
    const uv = corner.uvs.get(layerId) ?? { x: 0, y: 0 };
    return [corner.id, uv.x, uv.y] as const;
  });
}
