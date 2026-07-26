import { addVec3, scaleVec3, type Vec3 } from '@/core/math/Vec3';
import { faceVertexIds } from '@/core/mesh/EditableMesh';
import type { EditableMesh, VertexId } from '@/core/mesh/types';

export function buildVertexNeighborMap(mesh: EditableMesh): Map<VertexId, VertexId[]> {
  const neighbors = new Map<VertexId, Set<VertexId>>();
  for (const vertex of mesh.vertices.values()) {
    neighbors.set(vertex.id, new Set());
  }
  for (const face of mesh.faces.values()) {
    const ids = faceVertexIds(mesh, face.id);
    for (let index = 0; index < ids.length; index++) {
      const current = ids[index]!;
      const next = ids[(index + 1) % ids.length]!;
      neighbors.get(current)!.add(next);
      neighbors.get(next)!.add(current);
    }
  }
  return new Map([...neighbors].map(([id, set]) => [id, [...set]]));
}

export function neighborAverage(
  mesh: EditableMesh,
  vertexId: VertexId,
  neighborMap: Map<VertexId, VertexId[]>,
): Vec3 | null {
  const ids = neighborMap.get(vertexId);
  if (!ids?.length) return null;
  let sum = { x: 0, y: 0, z: 0 };
  for (const id of ids) {
    const vertex = mesh.vertices.get(id);
    if (!vertex) continue;
    sum = addVec3(sum, vertex.position);
  }
  return scaleVec3(sum, 1 / ids.length);
}
