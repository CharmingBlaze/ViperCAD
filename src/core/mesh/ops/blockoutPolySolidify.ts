import {
  addFace,
  addVertex,
  faceVertexIds,
  mergeTopologyChange,
  removeFace,
} from '@/core/mesh/EditableMesh';
import { buildOutlineBlockout } from '@/core/mesh/builders/WorkflowBlockoutBuilder';
import {
  emptyTopologyChangeResult,
  type EditableMesh,
  type FaceId,
  type TopologyChangeResult,
  type VertexId,
} from '@/core/mesh/types';
import type { GeometryOpResult } from '@/core/mesh/ops/types';
import { faceVertexIds as sourceFaceVerts } from '@/core/mesh/EditableMesh';

export type BlockoutPolySolidifyOptions = {
  /** Solid depth. 0 keeps a flat face (optionally with soft pillow if roundness > 0). */
  thickness: number;
  /** 0 = sharp slab, 1 = soft pillow depth. */
  roundness: number;
  /** Extra depth rings / density (0–3). */
  subdivideCuts: number;
};

/**
 * Replace a drawn face with a proper Blockout solid:
 * exact silhouette + soft depth rings + optional density.
 * Much closer to character blockout volumes than a flat extrude.
 */
export function solidifyBlockoutPolyFace(
  mesh: EditableMesh,
  faceIds: FaceId[],
  options: BlockoutPolySolidifyOptions,
): GeometryOpResult<TopologyChangeResult> {
  const change = emptyTopologyChangeResult();
  const unique = [...new Set(faceIds)].filter((id) => mesh.faces.has(id));
  if (unique.length === 0) {
    return {
      ok: false,
      change,
      warnings: [],
      error: {
        code: 'EMPTY_SELECTION',
        message: 'No faces to solidify',
        affectedElementIds: [],
        recoverable: true,
      },
    };
  }

  const thickness = Math.max(0.02, options.thickness);
  const roundness = Math.max(0, Math.min(0.45, options.roundness * 0.45));
  const depthSegments = Math.max(2, Math.min(6, 2 + Math.round(options.subdivideCuts)));
  const createdFaces: FaceId[] = [];

  for (const faceId of unique) {
    if (!mesh.faces.has(faceId)) continue;
    const loop = faceVertexIds(mesh, faceId);
    if (loop.length < 3) continue;

    const points = loop.map((id) => {
      const position = mesh.vertices.get(id)?.position;
      if (!position) throw new Error(`Missing vertex ${id}`);
      return { ...position };
    });

    mergeTopologyChange(change, removeFace(mesh, faceId));
    removeOrphanVertices(mesh, loop, change);

    const solid = buildOutlineBlockout({
      points,
      depth: thickness,
      depthSegments,
      roundness,
      exactOutline: true,
      name: 'Blockout Poly Solid',
    });

    if (solid.faces.size === 0) {
      return {
        ok: false,
        change,
        warnings: [],
        error: {
          code: 'SOLIDIFY_FAILED',
          message: 'Could not build a solid from that outline',
          affectedElementIds: [faceId],
          recoverable: true,
        },
      };
    }

    const appended = appendMeshGeometry(mesh, solid);
    mergeTopologyChange(change, appended.change);
    createdFaces.push(...appended.faceIds);
  }

  change.recommendedSelection = { mode: 'face', faceIds: createdFaces };
  return { ok: true, value: change, change, warnings: [] };
}

function removeOrphanVertices(
  mesh: EditableMesh,
  candidates: VertexId[],
  change: TopologyChangeResult,
): void {
  for (const id of candidates) {
    const used = [...mesh.halfEdges.values()].some((he) => he.originVertexId === id);
    if (used) continue;
    if (!mesh.vertices.has(id)) continue;
    mesh.vertices.delete(id);
    change.removedVertexIds.push(id);
  }
}

function appendMeshGeometry(
  target: EditableMesh,
  source: EditableMesh,
): { faceIds: FaceId[]; change: TopologyChangeResult } {
  const change = emptyTopologyChangeResult();
  const map = new Map<VertexId, VertexId>();
  for (const vertex of source.vertices.values()) {
    const id = addVertex(target, { ...vertex.position });
    map.set(vertex.id, id);
    change.createdVertexIds.push(id);
  }

  const faceIds: FaceId[] = [];
  for (const face of source.faces.values()) {
    const verts = sourceFaceVerts(source, face.id)
      .map((id) => map.get(id)!)
      .filter(Boolean);
    if (verts.length < 3) continue;
    const added = addFace(target, verts, {
      materialSlot: face.materialSlot,
      flatShaded: face.flatShaded,
    });
    mergeTopologyChange(change, added.result);
    faceIds.push(added.faceId);
  }
  return { faceIds, change };
}
