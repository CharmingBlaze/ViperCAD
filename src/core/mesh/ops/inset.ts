import { addVec3, scaleVec3 } from '@/core/math/Vec3';
import {
  addFace,
  addVertex,
  buildEdgeLookup,
  faceCornerIds,
  faceHalfEdgeIds,
  faceVertexIds,
  mergeTopologyChange,
  removeFace,
} from '@/core/mesh/EditableMesh';
import { computeFaceNormal } from '@/core/mesh/Normals';
import {
  emptyTopologyChangeResult,
  type EditableMesh,
  type FaceId,
  type TopologyChangeResult,
  type VertexId,
} from '@/core/mesh/types';
import type { GeometryOpResult, InsetParams } from './types';

type FaceSnapshot = {
  id: FaceId;
  verts: VertexId[];
  materialSlot: number;
  flatShaded: boolean;
  uvs: { x: number; y: number }[];
};

/**
 * Inset logical faces.
 * - `individual !== false` (default): each face insets toward its own centre.
 * - `individual === false`: region inset — shared interior edges stay joined; only the
 *   outer region boundary gets a ring.
 */
export function insetFaces(
  mesh: EditableMesh,
  faceIds: FaceId[],
  params: InsetParams,
): GeometryOpResult<TopologyChangeResult> {
  const change = emptyTopologyChangeResult();
  if (!faceIds.length) {
    return {
      ok: false,
      change,
      warnings: [],
      error: {
        code: 'EMPTY_SELECTION',
        message: 'No faces to inset',
        affectedElementIds: [],
        recoverable: true,
      },
    };
  }

  if (params.individual === false && faceIds.length > 1) {
    return insetFaceRegion(mesh, faceIds, params, change);
  }
  return insetFacesIndividual(mesh, faceIds, params, change);
}

function insetFacesIndividual(
  mesh: EditableMesh,
  faceIds: FaceId[],
  params: InsetParams,
  change: TopologyChangeResult,
): GeometryOpResult<TopologyChangeResult> {
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
    const centre = verts.reduce(
      (sum, id) => addVec3(sum, scaleVec3(mesh.vertices.get(id)!.position, 1 / verts.length)),
      { x: 0, y: 0, z: 0 },
    );
    const uvCentre = uvs.reduce(
      (sum, uv) => ({ x: sum.x + uv.x / uvs.length, y: sum.y + uv.y / uvs.length }),
      { x: 0, y: 0 },
    );
    const normalOffset = scaleVec3(computeFaceNormal(mesh, faceId), params.depth ?? 0);
    const t = Math.max(0.0001, Math.min(0.9999, params.thickness));
    const inner: VertexId[] = [];
    const innerUvs = uvs.map((uv) => ({
      x: uv.x + (uvCentre.x - uv.x) * t,
      y: uv.y + (uvCentre.y - uv.y) * t,
    }));
    for (const id of verts) {
      const p = mesh.vertices.get(id)!.position;
      inner.push(
        addVertex(
          mesh,
          addVec3(
            {
              x: p.x + (centre.x - p.x) * t,
              y: p.y + (centre.y - p.y) * t,
              z: p.z + (centre.z - p.z) * t,
            },
            normalOffset,
          ),
        ),
      );
    }
    change.createdVertexIds.push(...inner);
    mergeTopologyChange(change, removeFace(mesh, faceId));
    const lookup = buildEdgeLookup(mesh);
    const innerAdded = addFace(mesh, inner, {
      uvs: innerUvs,
      materialSlot: face.materialSlot,
      flatShaded: face.flatShaded,
      edgeLookup: lookup,
    });
    mergeTopologyChange(change, innerAdded.result);
    change.replacedIds.set(faceId, innerAdded.faceId);
    newInnerFaces.push(innerAdded.faceId);
    for (let i = 0; i < verts.length; i++) {
      const j = (i + 1) % verts.length;
      const ring = addFace(mesh, [verts[i]!, verts[j]!, inner[j]!, inner[i]!], {
        uvs: [uvs[i]!, uvs[j]!, innerUvs[j]!, innerUvs[i]!],
        materialSlot: face.materialSlot,
        flatShaded: face.flatShaded,
        edgeLookup: lookup,
      });
      mergeTopologyChange(change, ring.result);
    }
  }
  change.recommendedSelection = { mode: 'face', faceIds: newInnerFaces };
  return { ok: true, value: change, change, warnings: change.warnings };
}

function insetFaceRegion(
  mesh: EditableMesh,
  faceIds: FaceId[],
  params: InsetParams,
  change: TopologyChangeResult,
): GeometryOpResult<TopologyChangeResult> {
  for (const id of faceIds) {
    if (!mesh.faces.has(id)) {
      return {
        ok: false,
        change,
        warnings: [],
        error: {
          code: 'MISSING_FACE',
          message: `Face ${id} not found`,
          affectedElementIds: [id],
          recoverable: true,
        },
      };
    }
  }

  const selected = new Set(faceIds);
  const snapshots: FaceSnapshot[] = [];
  const regionVerts = new Set<VertexId>();
  const boundaryVerts = new Set<VertexId>();
  const boundaryPairs: {
    a: VertexId;
    b: VertexId;
    materialSlot: number;
    flatShaded: boolean;
    uvA: { x: number; y: number };
    uvB: { x: number; y: number };
  }[] = [];

  let regionCentre = { x: 0, y: 0, z: 0 };
  let regionNormal = { x: 0, y: 0, z: 0 };

  for (const faceId of faceIds) {
    const face = mesh.faces.get(faceId)!;
    const verts = faceVertexIds(mesh, faceId);
    const corners = faceCornerIds(mesh, faceId);
    const uvs = corners.map((id) => {
      const uv = mesh.defaultUvLayerId ? mesh.faceCorners.get(id)?.uvs.get(mesh.defaultUvLayerId) : null;
      return uv ? { ...uv } : { x: 0, y: 0 };
    });
    snapshots.push({
      id: faceId,
      verts,
      materialSlot: face.materialSlot,
      flatShaded: face.flatShaded,
      uvs,
    });
    for (const vid of verts) regionVerts.add(vid);
    regionNormal = addVec3(regionNormal, computeFaceNormal(mesh, faceId));

    const heIds = faceHalfEdgeIds(mesh, faceId);
    for (let i = 0; i < heIds.length; i++) {
      const he = mesh.halfEdges.get(heIds[i]!)!;
      const next = mesh.halfEdges.get(he.nextHalfEdgeId)!;
      const twin = he.twinHalfEdgeId ? mesh.halfEdges.get(he.twinHalfEdgeId) : null;
      const twinFace = twin?.faceId ?? null;
      if (!twinFace || !selected.has(twinFace)) {
        boundaryVerts.add(he.originVertexId);
        boundaryVerts.add(next.originVertexId);
        boundaryPairs.push({
          a: he.originVertexId,
          b: next.originVertexId,
          materialSlot: face.materialSlot,
          flatShaded: face.flatShaded,
          uvA: uvs[i]!,
          uvB: uvs[(i + 1) % uvs.length]!,
        });
      }
    }
  }

  for (const vid of regionVerts) {
    const p = mesh.vertices.get(vid)!.position;
    regionCentre = {
      x: regionCentre.x + p.x / regionVerts.size,
      y: regionCentre.y + p.y / regionVerts.size,
      z: regionCentre.z + p.z / regionVerts.size,
    };
  }

  const t = Math.max(0.0001, Math.min(0.9999, params.thickness));
  const normalOffset = scaleVec3(regionNormal, (params.depth ?? 0) / Math.max(1, faceIds.length));
  const vertMap = new Map<VertexId, VertexId>();
  const uvInsetCache = new Map<VertexId, { x: number; y: number }>();

  for (const vid of regionVerts) {
    if (!boundaryVerts.has(vid)) {
      vertMap.set(vid, vid);
      continue;
    }
    const p = mesh.vertices.get(vid)!.position;
    const newId = addVertex(
      mesh,
      addVec3(
        {
          x: p.x + (regionCentre.x - p.x) * t,
          y: p.y + (regionCentre.y - p.y) * t,
          z: p.z + (regionCentre.z - p.z) * t,
        },
        normalOffset,
      ),
    );
    vertMap.set(vid, newId);
    change.createdVertexIds.push(newId);
  }

  // Approximate inset UVs for boundary verts from first snapshot that uses them.
  for (const snap of snapshots) {
    for (let i = 0; i < snap.verts.length; i++) {
      const vid = snap.verts[i]!;
      if (!boundaryVerts.has(vid) || uvInsetCache.has(vid)) continue;
      const uv = snap.uvs[i]!;
      const uvCentre = snap.uvs.reduce(
        (sum, u) => ({ x: sum.x + u.x / snap.uvs.length, y: sum.y + u.y / snap.uvs.length }),
        { x: 0, y: 0 },
      );
      uvInsetCache.set(vid, {
        x: uv.x + (uvCentre.x - uv.x) * t,
        y: uv.y + (uvCentre.y - uv.y) * t,
      });
    }
  }

  for (const faceId of faceIds) {
    mergeTopologyChange(change, removeFace(mesh, faceId));
  }

  const lookup = buildEdgeLookup(mesh);
  const newInnerFaces: FaceId[] = [];

  for (const snap of snapshots) {
    const newVerts = snap.verts.map((id) => vertMap.get(id)!);
    const newUvs = snap.verts.map((id, i) =>
      boundaryVerts.has(id) ? (uvInsetCache.get(id) ?? snap.uvs[i]!) : snap.uvs[i]!,
    );
    const added = addFace(mesh, newVerts, {
      uvs: newUvs,
      materialSlot: snap.materialSlot,
      flatShaded: snap.flatShaded,
      edgeLookup: lookup,
    });
    mergeTopologyChange(change, added.result);
    change.replacedIds.set(snap.id, added.faceId);
    newInnerFaces.push(added.faceId);
  }

  for (const pair of boundaryPairs) {
    const a2 = vertMap.get(pair.a)!;
    const b2 = vertMap.get(pair.b)!;
    const uvA2 = uvInsetCache.get(pair.a) ?? pair.uvA;
    const uvB2 = uvInsetCache.get(pair.b) ?? pair.uvB;
    const ring = addFace(mesh, [pair.a, pair.b, b2, a2], {
      uvs: [pair.uvA, pair.uvB, uvB2, uvA2],
      materialSlot: pair.materialSlot,
      flatShaded: pair.flatShaded,
      edgeLookup: lookup,
    });
    mergeTopologyChange(change, ring.result);
  }

  change.recommendedSelection = { mode: 'face', faceIds: newInnerFaces };
  return { ok: true, value: change, change, warnings: change.warnings };
}
