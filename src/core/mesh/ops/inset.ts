import { addVec3, scaleVec3 } from '@/core/math/Vec3';
import { addFace, addVertex, buildEdgeLookup, faceCornerIds, faceVertexIds, mergeTopologyChange, removeFace } from '@/core/mesh/EditableMesh';
import { computeFaceNormal } from '@/core/mesh/Normals';
import { emptyTopologyChangeResult, type EditableMesh, type FaceId, type TopologyChangeResult, type VertexId } from '@/core/mesh/types';
import type { GeometryOpResult, InsetParams } from './types';

/** Inset logical faces. Multi-face input is intentionally individual when requested. */
export function insetFaces(mesh: EditableMesh, faceIds: FaceId[], params: InsetParams): GeometryOpResult<TopologyChangeResult> {
  const change = emptyTopologyChangeResult();
  if (!faceIds.length) return { ok: false, change, warnings: [], error: { code: 'EMPTY_SELECTION', message: 'No faces to inset', affectedElementIds: [], recoverable: true } };
  const newInnerFaces: FaceId[] = [];
  for (const faceId of faceIds) {
    const face = mesh.faces.get(faceId);
    if (!face) continue;
    const verts = faceVertexIds(mesh, faceId);
    const corners = faceCornerIds(mesh, faceId);
    const uvs = corners.map((id) => {
      const uv = mesh.defaultUvLayerId ? mesh.faceCorners.get(id)?.uvs.get(mesh.defaultUvLayerId) : null;
      return uv ? { ...uv } : { x: 0, y: 0 };
    });
    const centre = verts.reduce((sum, id) => addVec3(sum, scaleVec3(mesh.vertices.get(id)!.position, 1 / verts.length)), { x: 0, y: 0, z: 0 });
    const uvCentre = uvs.reduce((sum, uv) => ({ x: sum.x + uv.x / uvs.length, y: sum.y + uv.y / uvs.length }), { x: 0, y: 0 });
    const normalOffset = scaleVec3(computeFaceNormal(mesh, faceId), params.depth ?? 0);
    const t = Math.max(0.0001, Math.min(0.9999, params.thickness));
    const inner: VertexId[] = [];
    const innerUvs = uvs.map((uv) => ({ x: uv.x + (uvCentre.x - uv.x) * t, y: uv.y + (uvCentre.y - uv.y) * t }));
    for (const id of verts) {
      const p = mesh.vertices.get(id)!.position;
      inner.push(addVertex(mesh, addVec3({ x: p.x + (centre.x - p.x) * t, y: p.y + (centre.y - p.y) * t, z: p.z + (centre.z - p.z) * t }, normalOffset)));
    }
    change.createdVertexIds.push(...inner);
    mergeTopologyChange(change, removeFace(mesh, faceId));
    const lookup = buildEdgeLookup(mesh);
    const innerAdded = addFace(mesh, inner, { uvs: innerUvs, materialSlot: face.materialSlot, flatShaded: face.flatShaded, edgeLookup: lookup });
    mergeTopologyChange(change, innerAdded.result);
    change.replacedIds.set(faceId, innerAdded.faceId);
    newInnerFaces.push(innerAdded.faceId);
    for (let i = 0; i < verts.length; i++) {
      const j = (i + 1) % verts.length;
      const ring = addFace(mesh, [verts[i]!, verts[j]!, inner[j]!, inner[i]!], {
        uvs: [uvs[i]!, uvs[j]!, innerUvs[j]!, innerUvs[i]!], materialSlot: face.materialSlot, flatShaded: face.flatShaded, edgeLookup: lookup,
      });
      mergeTopologyChange(change, ring.result);
    }
  }
  change.recommendedSelection = { mode: 'face', faceIds: newInnerFaces };
  return { ok: true, value: change, change, warnings: change.warnings };
}
