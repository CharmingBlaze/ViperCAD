import {
  addFace,
  addVertex,
  buildEdgeLookup,
  cloneMeshPreserveIds,
  faceCornerIds,
  faceVertexIds,
} from '@/core/mesh/EditableMesh';
import type { EditableMesh, VertexId } from '@/core/mesh/types';
import type { ArrayModifierSpec } from '@/core/modifiers/types';

export function applyArrayModifier(
  source: EditableMesh,
  modifier: ArrayModifierSpec,
): EditableMesh {
  const target = cloneMeshPreserveIds(source);
  const count = Math.max(1, Math.min(100, Math.round(modifier.count)));
  const spacing = Number.isFinite(modifier.spacing) ? modifier.spacing : 1;
  const edgeLookup = buildEdgeLookup(target);

  for (let copy = 1; copy < count; copy++) {
    const vertexMap = new Map<VertexId, VertexId>();
    for (const vertex of source.vertices.values()) {
      const position = { ...vertex.position };
      position[modifier.axis] += spacing * copy;
      vertexMap.set(vertex.id, addVertex(target, position));
    }
    for (const face of source.faces.values()) {
      const corners = faceCornerIds(source, face.id);
      const uvs = corners.map((cornerId) => {
        const corner = source.faceCorners.get(cornerId);
        const uv = source.defaultUvLayerId
          ? corner?.uvs.get(source.defaultUvLayerId)
          : null;
        return uv ? { ...uv } : { x: 0, y: 0 };
      });
      const added = addFace(
        target,
        faceVertexIds(source, face.id).map((id) => vertexMap.get(id)!),
        {
          uvs,
          materialSlot: face.materialSlot,
          flatShaded: face.flatShaded,
          edgeLookup,
        },
      );
      target.faces.get(added.faceId)!.smoothingGroup = face.smoothingGroup;
    }
  }
  target.name = `${source.name}_array`;
  return target;
}
