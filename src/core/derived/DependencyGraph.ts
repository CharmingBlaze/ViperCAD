import type { EditableMesh, FaceId, VertexId } from '@/core/mesh/types';

export type MeshChange =
  | { kind: 'positions'; vertexIds?: VertexId[]; faceIds?: FaceId[] }
  | { kind: 'topology'; faceIds?: FaceId[] }
  | { kind: 'uv'; faceIds?: FaceId[] }
  | { kind: 'material'; faceIds?: FaceId[] }
  | { kind: 'selection' };

/** Central dependency rules for selective derived-data invalidation. */
export function invalidateMeshDependencies(mesh: EditableMesh, change: MeshChange): void {
  if (change.kind === 'topology') {
    mesh.topologyVersion += 1; mesh.geometryVersion += 1;
    Object.assign(mesh.dirty, { topology: true, positions: true, normals: true, uvs: true, materials: true, bounds: true, triangulation: true, bvh: true });
  } else if (change.kind === 'positions') {
    mesh.geometryVersion += 1;
    Object.assign(mesh.dirty, { positions: true, normals: true, bounds: true, triangulation: true, bvh: true });
  } else if (change.kind === 'uv') {
    mesh.geometryVersion += 1; mesh.dirty.uvs = true;
  } else if (change.kind === 'material') {
    mesh.geometryVersion += 1; mesh.dirty.materials = true;
  }
}
