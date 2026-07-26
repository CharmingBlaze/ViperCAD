import { buildEdgeLookup, edgeKey, faceHalfEdgeIds, faceVertexIds, getEdgeVertices, mergeTopologyChange } from '@/core/mesh/EditableMesh';
import { emptyTopologyChangeResult, type EditableMesh, type EdgeId, type FaceId, type TopologyChangeResult, type VertexId } from '@/core/mesh/types';
import { dotVec3, lengthSqVec3, lerpVec3, subVec3, type Vec3 } from '@/core/math/Vec3';
import { splitEdge, splitFace } from './basic';
import type { GeometryOpResult } from './types';

export type FaceEdgeHit = {
  edgeId: EdgeId;
  factor: number;
  point: Vec3;
};

/** Closest boundary edge of a face to a point in mesh-local space. */
export function closestBoundaryEdgeToPoint(
  mesh: EditableMesh,
  faceId: FaceId,
  point: Vec3,
  options?: { excludeEdgeId?: EdgeId },
): FaceEdgeHit | null {
  const halfEdges = faceHalfEdgeIds(mesh, faceId);
  if (!halfEdges.length) return null;
  let best: FaceEdgeHit | null = null;
  let bestDist = Infinity;
  for (const heId of halfEdges) {
    const he = mesh.halfEdges.get(heId);
    if (!he) continue;
    const edgeId = he.edgeId;
    if (options?.excludeEdgeId && edgeId === options.excludeEdgeId) continue;
    const ends = getEdgeVertices(mesh, edgeId);
    if (!ends) continue;
    const a = mesh.vertices.get(ends[0])!.position;
    const b = mesh.vertices.get(ends[1])!.position;
    const ab = subVec3(b, a);
    const ap = subVec3(point, a);
    const abLenSq = lengthSqVec3(ab);
    const factor = abLenSq < 1e-20 ? 0.5 : Math.max(0, Math.min(1, dotVec3(ap, ab) / abLenSq));
    const projected = lerpVec3(a, b, factor);
    const dist = lengthSqVec3(subVec3(point, projected));
    if (dist < bestDist) {
      bestDist = dist;
      best = { edgeId, factor, point: projected };
    }
  }
  return best;
}

/** Knife chord across one face, entering and leaving through two logical edges. */
export function knifeFace(mesh: EditableMesh, faceId: FaceId, edgeA: EdgeId, edgeB: EdgeId, factorA = 0.5, factorB = 0.5): GeometryOpResult<TopologyChangeResult> {
  const change = emptyTopologyChangeResult();
  if (edgeA === edgeB) return fail(change, 'SAME_EDGE', 'Knife must enter and leave through different edges', [edgeA]);
  const edgeBVertices = getEdgeVertices(mesh, edgeB); if (!edgeBVertices) return fail(change, 'MISSING_EDGE', `Edge ${edgeB} not found`, [edgeB]);
  const first = splitEdge(mesh, edgeA, factorA); if (!first.ok) return first;
  mergeTopologyChange(change, first.change); const vertexA = first.change.createdVertexIds[0]!;
  let currentFace = resolveReplacement(first.change, faceId);
  const currentEdgeB = buildEdgeLookup(mesh).get(edgeKey(edgeBVertices[0], edgeBVertices[1])); if (!currentEdgeB) return fail(change, 'MISSING_EDGE', 'Second knife edge was removed by the first cut', [edgeB]);
  const second = splitEdge(mesh, currentEdgeB, factorB); if (!second.ok) return second;
  mergeTopologyChange(change, second.change); const vertexB = second.change.createdVertexIds[0]!;
  currentFace = resolveReplacement(second.change, currentFace);
  const cut = splitFace(mesh, currentFace, vertexA, vertexB); if (!cut.ok) return cut;
  mergeTopologyChange(change, cut.change); change.recommendedSelection = cut.change.recommendedSelection;
  return { ok: true, value: change, change, warnings: change.warnings };
}

export type LoopCutRing = {
  /** Ordered crossed edges. Open rings have one more edge than face. */
  edgeIds: EdgeId[];
  /** Ordered quad strip faces between adjacent crossed edges. */
  faceIds: FaceId[];
  closed: boolean;
};

type RingWalk = LoopCutRing;

/** Discover the complete quad ring in both directions from a hovered edge. */
export function findLoopCutRing(mesh: EditableMesh, startEdgeId: EdgeId): LoopCutRing | null {
  if (!mesh.edges.has(startEdgeId)) return null;
  const adjacent = incidentFaces(mesh, startEdgeId);
  const walks = adjacent
    .filter((faceId) => faceVertexIds(mesh, faceId).length === 4)
    .map((faceId) => walkQuadRing(mesh, startEdgeId, faceId));
  if (!walks.length) return null;

  const closed = walks.find((walk) => walk.closed);
  if (closed) return closed;

  const forward = walks[0]!;
  const backward = walks[1];
  if (!backward) return forward;
  return {
    edgeIds: [...backward.edgeIds.slice(1).reverse(), ...forward.edgeIds],
    faceIds: [...backward.faceIds.reverse(), ...forward.faceIds],
    closed: false,
  };
}

/**
 * Insert one or more cuts through a contiguous quad ring.
 * Factors are measured on the starting edge and must be in the 0..1 range.
 */
export function loopCutMulti(
  mesh: EditableMesh,
  startEdgeId: EdgeId,
  factors: number[],
): GeometryOpResult<TopologyChangeResult> {
  const change = emptyTopologyChangeResult();
  const ring = findLoopCutRing(mesh, startEdgeId);
  if (!ring) {
    return fail(change, 'NO_QUAD_RING', 'Selected edge does not lead through a quad ring', [startEdgeId]);
  }
  const cuts = [...new Set(factors.map((factor) => Math.max(0.0001, Math.min(0.9999, factor))))]
    .sort((a, b) => a - b);
  if (!cuts.length) return fail(change, 'NO_CUTS', 'Loop cut requires at least one cut', [startEdgeId]);

  const endpoints = new Map<EdgeId, [VertexId, VertexId]>();
  for (const edgeId of ring.edgeIds) {
    const pair = getEdgeVertices(mesh, edgeId);
    if (!pair) return fail(change, 'MISSING_EDGE', `Edge ${edgeId} not found`, [edgeId]);
    endpoints.set(edgeId, pair);
  }
  const originalFaceVertices = new Map(
    ring.faceIds.map((faceId) => [faceId, faceVertexIds(mesh, faceId)] as const),
  );
  const faceMap = new Map<FaceId, FaceId>(ring.faceIds.map((faceId) => [faceId, faceId]));
  const cutVertices = new Map<EdgeId, VertexId[]>();

  // Split every crossed edge at all requested factors, preserving global order.
  for (const edgeId of ring.edgeIds) {
    const pair = endpoints.get(edgeId)!;
    let segmentStart = pair[0];
    let previousFactor = 0;
    const created: VertexId[] = [];
    for (const factor of cuts) {
      const currentEdge = buildEdgeLookup(mesh).get(edgeKey(segmentStart, pair[1]));
      if (!currentEdge) {
        return fail(change, 'MISSING_EDGE', 'Loop edge changed during multi-cut', [edgeId]);
      }
      const localFactor = (factor - previousFactor) / Math.max(1e-8, 1 - previousFactor);
      const split = splitEdge(mesh, currentEdge, localFactor);
      if (!split.ok) return split;
      mergeTopologyChange(change, split.change);
      const vertexId = split.change.createdVertexIds[0]!;
      created.push(vertexId);
      segmentStart = vertexId;
      previousFactor = factor;
      for (const [original, current] of faceMap) {
        faceMap.set(original, resolveReplacement(split.change, current));
      }
    }
    cutVertices.set(edgeId, created);
  }

  const selectedLoopEdges: EdgeId[] = [];
  for (let faceIndex = 0; faceIndex < ring.faceIds.length; faceIndex++) {
    const originalFaceId = ring.faceIds[faceIndex]!;
    const edgeA = ring.edgeIds[faceIndex]!;
    const edgeB = ring.edgeIds[faceIndex + 1] ?? ring.edgeIds[0]!;
    const faceVertices = originalFaceVertices.get(originalFaceId)!;
    const cutsA = orientCutVertices(faceVertices, endpoints.get(edgeA)!, cutVertices.get(edgeA)!);
    const cutsB = orientCutVertices(faceVertices, endpoints.get(edgeB)!, cutVertices.get(edgeB)!);
    const pairs = cutsA.map((vertexA, index) => ({
      vertexA,
      vertexB: cutsB[cutsB.length - 1 - index]!,
    }));
    let currentFace = faceMap.get(originalFaceId)!;

    for (let cutIndex = 0; cutIndex < pairs.length; cutIndex++) {
      const pair = pairs[cutIndex]!;
      const cut = splitFace(mesh, currentFace, pair.vertexA, pair.vertexB);
      if (!cut.ok) return cut;
      mergeTopologyChange(change, cut.change);
      const loopEdge = buildEdgeLookup(mesh).get(edgeKey(pair.vertexA, pair.vertexB));
      if (loopEdge) selectedLoopEdges.push(loopEdge);

      const next = pairs[cutIndex + 1];
      if (next) {
        const candidates = cut.change.recommendedSelection.faceIds ?? [];
        const remainder = candidates.find((faceId) => {
          const vertices = faceVertexIds(mesh, faceId);
          return vertices.includes(next.vertexA) && vertices.includes(next.vertexB);
        });
        if (!remainder) {
          return fail(change, 'LOOP_SPLIT_FAILED', 'Could not continue the multi-cut through a face', [
            originalFaceId,
          ]);
        }
        currentFace = remainder;
      }
    }
  }

  change.recommendedSelection = { mode: 'edge', edgeIds: selectedLoopEdges };
  return { ok: true, value: change, change, warnings: change.warnings };
}

/** Backwards-compatible one-cut operation. */
export function loopCut(
  mesh: EditableMesh,
  startEdgeId: EdgeId,
  factor = 0.5,
): GeometryOpResult<TopologyChangeResult> {
  return loopCutMulti(mesh, startEdgeId, [factor]);
}

/** Local-space line segments used by the interactive loop-cut preview. */
export function loopCutPreviewSegments(
  mesh: EditableMesh,
  ring: LoopCutRing,
  factors: number[],
): Array<[Vec3, Vec3]> {
  const cuts = [...factors].sort((a, b) => a - b);
  const segments: Array<[Vec3, Vec3]> = [];
  for (let faceIndex = 0; faceIndex < ring.faceIds.length; faceIndex++) {
    const faceVertices = faceVertexIds(mesh, ring.faceIds[faceIndex]!);
    const edgeA = ring.edgeIds[faceIndex]!;
    const edgeB = ring.edgeIds[faceIndex + 1] ?? ring.edgeIds[0]!;
    const endpointsA = getEdgeVertices(mesh, edgeA);
    const endpointsB = getEdgeVertices(mesh, edgeB);
    if (!endpointsA || !endpointsB) continue;
    const followsA = edgeFollowsFace(faceVertices, endpointsA);
    const followsB = edgeFollowsFace(faceVertices, endpointsB);
    for (let index = 0; index < cuts.length; index++) {
      const factorA = followsA ? cuts[index]! : cuts[cuts.length - 1 - index]!;
      const factorB = followsB ? cuts[cuts.length - 1 - index]! : cuts[index]!;
      const a0 = mesh.vertices.get(endpointsA[0])!.position;
      const a1 = mesh.vertices.get(endpointsA[1])!.position;
      const b0 = mesh.vertices.get(endpointsB[0])!.position;
      const b1 = mesh.vertices.get(endpointsB[1])!.position;
      segments.push([lerpVec3(a0, a1, factorA), lerpVec3(b0, b1, factorB)]);
    }
  }
  return segments;
}

function walkQuadRing(mesh: EditableMesh, startEdgeId: EdgeId, firstFaceId: FaceId): RingWalk {
  const edgeIds: EdgeId[] = [startEdgeId];
  const faceIds: FaceId[] = [];
  const seenFaces = new Set<FaceId>();
  let edgeId = startEdgeId;
  let faceId: FaceId | null = firstFaceId;

  while (faceId && !seenFaces.has(faceId) && faceVertexIds(mesh, faceId).length === 4) {
    seenFaces.add(faceId);
    faceIds.push(faceId);
    const halfEdges = faceHalfEdgeIds(mesh, faceId);
    const index = halfEdges.findIndex((id) => mesh.halfEdges.get(id)?.edgeId === edgeId);
    if (index < 0) break;
    const opposite = mesh.halfEdges.get(halfEdges[(index + 2) % 4]!)!.edgeId;
    if (opposite === startEdgeId) return { edgeIds, faceIds, closed: true };
    edgeIds.push(opposite);
    const next = incidentFaces(mesh, opposite).find((candidate) => candidate !== faceId) ?? null;
    edgeId = opposite;
    faceId = next;
  }
  return { edgeIds, faceIds, closed: false };
}

function incidentFaces(mesh: EditableMesh, edgeId: EdgeId): FaceId[] {
  const edge = mesh.edges.get(edgeId);
  if (!edge) return [];
  return [edge.halfEdgeAId, edge.halfEdgeBId]
    .filter((id): id is string => !!id)
    .map((id) => mesh.halfEdges.get(id)?.faceId)
    .filter((id): id is FaceId => !!id);
}

function orientCutVertices(
  faceVertices: VertexId[],
  endpoints: [VertexId, VertexId],
  vertices: VertexId[],
): VertexId[] {
  const followsFace = edgeFollowsFace(faceVertices, endpoints);
  return followsFace ? [...vertices] : [...vertices].reverse();
}

function edgeFollowsFace(
  faceVertices: VertexId[],
  endpoints: [VertexId, VertexId],
): boolean {
  const index = faceVertices.indexOf(endpoints[0]);
  return index >= 0 && faceVertices[(index + 1) % faceVertices.length] === endpoints[1];
}

function resolveReplacement(change: TopologyChangeResult, id: FaceId): FaceId { return (change.replacedIds.get(id) as FaceId | undefined) ?? id; }
function fail(change: TopologyChangeResult, code: string, message: string, ids: string[]): GeometryOpResult<TopologyChangeResult> { return { ok: false, change, warnings: [], error: { code, message, affectedElementIds: ids, recoverable: true } }; }
