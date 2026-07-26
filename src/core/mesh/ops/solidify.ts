import { addVec3, scaleVec3 } from '@/core/math/Vec3';
import {
  addFace,
  addVertex,
  buildEdgeLookup,
  faceCornerIds,
  faceVertexIds,
  getEdgeVertices,
  isBoundaryEdge,
  mergeTopologyChange,
  removeFace,
} from '@/core/mesh/EditableMesh';
import { computeVertexNormals } from '@/core/mesh/Normals';
import {
  emptyTopologyChangeResult,
  type EditableMesh,
  type FaceId,
  type TopologyChangeResult,
  type VertexId,
} from '@/core/mesh/types';
import type { GeometryOpResult, SolidifyParams } from './types';

type FaceSnapshot = {
  id: FaceId;
  verts: VertexId[];
  uvs: { x: number; y: number }[];
  materialSlot: number;
  flatShaded: boolean;
  smoothingGroup: number;
};

/**
 * Create a solid shell: outer surface, offset inner surface, and rim caps on
 * every boundary edge. Closed meshes get inner+outer with no rim.
 */
export function solidifyMesh(
  mesh: EditableMesh,
  params: SolidifyParams,
): GeometryOpResult<TopologyChangeResult> {
  const change = emptyTopologyChangeResult();
  if (!mesh.faces.size) {
    return fail(change, 'EMPTY_MESH', 'No faces to solidify', []);
  }

  const thickness = params.thickness;
  if (!Number.isFinite(thickness) || Math.abs(thickness) < 1e-8) {
    return fail(change, 'INVALID_THICKNESS', 'Solidify thickness must be non-zero', []);
  }

  const offset = Math.max(-1, Math.min(1, params.offset ?? -1));
  const outerOffset = thickness * ((offset + 1) * 0.5);
  const innerOffset = thickness * ((offset - 1) * 0.5);
  const rebuildOuter = Math.abs(outerOffset) >= 1e-12;
  const rebuildInner = Math.abs(innerOffset) >= 1e-12;

  const snapshots: FaceSnapshot[] = [...mesh.faces.values()].map((face) => ({
    id: face.id,
    verts: faceVertexIds(mesh, face.id),
    uvs: faceCornerIds(mesh, face.id).map((id) => {
      const uv = mesh.defaultUvLayerId
        ? mesh.faceCorners.get(id)?.uvs.get(mesh.defaultUvLayerId)
        : null;
      return uv ? { ...uv } : { x: 0, y: 0 };
    }),
    materialSlot: face.materialSlot,
    flatShaded: face.flatShaded,
    smoothingGroup: face.smoothingGroup,
  }));

  const boundaryEdgeIds = [...mesh.edges.keys()].filter((id) => isBoundaryEdge(mesh, id));
  const normals = computeVertexNormals(mesh);
  const originalVerts = [...mesh.vertices.keys()];
  const outerMap = new Map<VertexId, VertexId>();
  const innerMap = new Map<VertexId, VertexId>();

  for (const vid of originalVerts) {
    const pos = mesh.vertices.get(vid)!.position;
    const n = normals.get(vid) ?? { x: 0, y: 1, z: 0 };
    if (rebuildOuter) {
      const id = addVertex(mesh, addVec3(pos, scaleVec3(n, outerOffset)));
      outerMap.set(vid, id);
      change.createdVertexIds.push(id);
    } else {
      outerMap.set(vid, vid);
    }
    if (rebuildInner) {
      const id = addVertex(mesh, addVec3(pos, scaleVec3(n, innerOffset)));
      innerMap.set(vid, id);
      change.createdVertexIds.push(id);
    } else {
      innerMap.set(vid, vid);
    }
  }

  // When outer moves, rebuild outer faces; otherwise keep originals as the outer shell.
  if (rebuildOuter) {
    for (const snap of snapshots) {
      mergeTopologyChange(change, removeFace(mesh, snap.id));
    }
  }

  const lookup = buildEdgeLookup(mesh);
  const outerFaces: FaceId[] = [];

  if (rebuildOuter) {
    for (const snap of snapshots) {
      const added = addFace(
        mesh,
        snap.verts.map((id) => outerMap.get(id)!),
        {
          uvs: snap.uvs,
          materialSlot: snap.materialSlot,
          flatShaded: snap.flatShaded,
          edgeLookup: lookup,
        },
      );
      mesh.faces.get(added.faceId)!.smoothingGroup = snap.smoothingGroup;
      mergeTopologyChange(change, added.result);
      change.replacedIds.set(snap.id, added.faceId);
      outerFaces.push(added.faceId);
    }
  } else {
    outerFaces.push(...snapshots.map((s) => s.id));
  }

  for (const snap of snapshots) {
    const added = addFace(
      mesh,
      [...snap.verts].reverse().map((id) => innerMap.get(id)!),
      {
        uvs: [...snap.uvs].reverse(),
        materialSlot: snap.materialSlot,
        flatShaded: snap.flatShaded,
        edgeLookup: lookup,
      },
    );
    mesh.faces.get(added.faceId)!.smoothingGroup = snap.smoothingGroup;
    mergeTopologyChange(change, added.result);
  }

  for (const edgeId of boundaryEdgeIds) {
    const pair = getEdgeVertices(mesh, edgeId);
    if (!pair) continue;
    const [a, b] = pair;
    // Outer face owns a→b; rim must wind b→a on that edge.
    const rim = addFace(
      mesh,
      [outerMap.get(b)!, outerMap.get(a)!, innerMap.get(a)!, innerMap.get(b)!],
      {
        materialSlot: snapshots[0]?.materialSlot ?? 0,
        flatShaded: true,
        uvs: [
          { x: 1, y: 1 },
          { x: 0, y: 1 },
          { x: 0, y: 0 },
          { x: 1, y: 0 },
        ],
        edgeLookup: buildEdgeLookup(mesh),
      },
    );
    mergeTopologyChange(change, rim.result);
  }

  if (rebuildOuter) {
    for (const vid of originalVerts) {
      if (outerMap.get(vid) === vid || innerMap.get(vid) === vid) continue;
      let used = false;
      for (const he of mesh.halfEdges.values()) {
        if (he.originVertexId === vid) {
          used = true;
          break;
        }
      }
      if (!used && mesh.vertices.has(vid)) {
        mesh.vertices.delete(vid);
        change.removedVertexIds.push(vid);
      }
    }
  }

  change.recommendedSelection = { mode: 'face', faceIds: outerFaces };
  return { ok: true, value: change, change, warnings: change.warnings };
}

function fail(
  change: TopologyChangeResult,
  code: string,
  message: string,
  ids: string[],
): GeometryOpResult<TopologyChangeResult> {
  return {
    ok: false,
    change,
    warnings: [],
    error: { code, message, affectedElementIds: ids, recoverable: true },
  };
}
