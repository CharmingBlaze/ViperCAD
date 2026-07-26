/// <reference lib="webworker" />
import type { EditableMesh, FaceId, UvLayerId } from '@/core/mesh/types';
import { packSelectedUvIslands } from '@/core/uv/UvOperations';

type Request = { id: number; mesh: EditableMesh; faceIds: FaceId[]; padding: number; layerId: UvLayerId };

self.onmessage = (event: MessageEvent<Request>) => {
  const { id, mesh, faceIds, padding, layerId } = event.data;
  try {
    packSelectedUvIslands(mesh, faceIds, padding, layerId);
    const updates = [...mesh.faceCorners.values()].map((corner) => {
      const uv = corner.uvs.get(layerId) ?? { x: 0, y: 0 };
      return [corner.id, uv.x, uv.y] as const;
    });
    self.postMessage({ id, updates });
  } catch (error) {
    self.postMessage({ id, error: error instanceof Error ? error.message : String(error) });
  }
};
