import type { FaceCornerId, FaceId, VertexId } from '@/core/mesh/types';

export type MeshEvaluationResult = {
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  atlasTileRects: Float32Array;
  secondaryUvs: Float32Array | null;
  indices: Uint32Array;
  triangleMap: Array<{
    faceId: FaceId;
    cornerIds: [FaceCornerId, FaceCornerId, FaceCornerId];
    vertexIds: [VertexId, VertexId, VertexId];
  }>;
  renderVertexIds: VertexId[];
  renderCornerIds: FaceCornerId[];
  materialGroups: { start: number; count: number; materialSlot: number }[];
  geometryVersion: number;
  topologyVersion: number;
};
