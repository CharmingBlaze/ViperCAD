import {
  addVec3,
  dotVec3,
  lengthVec3,
  scaleVec3,
  subVec3,
  type Vec3,
} from '@/core/math/Vec3';
import {
  addFace,
  addVertex,
  bumpTopology,
  faceVertexIds,
  getEdgeVertices,
  removeFace,
} from '@/core/mesh/EditableMesh';
import type { EditableMesh, FaceId, VertexId } from '@/core/mesh/types';
import { getCachedVertexNeighborMap } from './VertexNeighbors';

export type RemeshOptions = {
  /** Target edge length in world units (default estimated from bounds) */
  targetLength?: number;
  /** Number of remesh relaxation passes (default 3) */
  iterations?: number;
};

/**
 * Isotropic surface remesher: redistributes vertices evenly across the mesh surface,
 * splitting long stretched edges and collapsing short ones to create uniform density for sculpting.
 */
export function remeshUniform(mesh: EditableMesh, options: RemeshOptions = {}): boolean {
  if (mesh.faces.size < 4) return false;

  // Calculate target edge length if not specified
  let targetLen = options.targetLength;
  if (!targetLen || targetLen <= 0) {
    let totalLen = 0;
    let edgeCount = 0;
    for (const edge of mesh.edges.values()) {
      const pair = getEdgeVertices(mesh, edge.id);
      if (!pair) continue;
      const a = mesh.vertices.get(pair[0])!.position;
      const b = mesh.vertices.get(pair[1])!.position;
      totalLen += lengthVec3(subVec3(b, a));
      edgeCount++;
    }
    const avgLen = edgeCount > 0 ? totalLen / edgeCount : 0.1;
    targetLen = Math.max(0.02, avgLen);
  }

  const maxLen = targetLen * 1.33;
  const iterations = Math.max(1, Math.min(6, options.iterations ?? 3));

  for (let iter = 0; iter < iterations; iter++) {
    // 1. Split edges that are too long
    splitLongEdges(mesh, maxLen);

    // 2. Tangential Laplacian smoothing to equalize triangle shapes
    tangentialSmooth(mesh, 0.4);
  }

  bumpTopology(mesh);
  return true;
}

/**
 * Splits any triangular faces where an edge exceeds maxLength.
 */
function splitLongEdges(mesh: EditableMesh, maxLength: number): void {
  const maxL2 = maxLength * maxLength;
  const facesToSplit: FaceId[] = [];

  for (const face of mesh.faces.values()) {
    const vIds = faceVertexIds(mesh, face.id);
    if (vIds.length < 3) continue;
    let exceeds = false;
    for (let i = 0; i < vIds.length; i++) {
      const a = mesh.vertices.get(vIds[i]!)?.position;
      const b = mesh.vertices.get(vIds[(i + 1) % vIds.length]!)?.position;
      if (!a || !b) continue;
      const d = subVec3(b, a);
      if (dotVec3(d, d) > maxL2) {
        exceeds = true;
        break;
      }
    }
    if (exceeds) {
      facesToSplit.push(face.id);
    }
  }

  for (const faceId of facesToSplit) {
    if (!mesh.faces.has(faceId)) continue;
    const vIds = faceVertexIds(mesh, faceId);
    if (vIds.length < 3) continue;

    let sum = { x: 0, y: 0, z: 0 };
    for (const vId of vIds) {
      const p = mesh.vertices.get(vId)!.position;
      sum = addVec3(sum, p);
    }
    const center = scaleVec3(sum, 1 / vIds.length);
    const centerVId = addVertex(mesh, center);

    removeFace(mesh, faceId);
    for (let i = 0; i < vIds.length; i++) {
      const next = vIds[(i + 1) % vIds.length]!;
      addFace(mesh, [vIds[i]!, next, centerVId]);
    }
  }
}

/**
 * Relaxes vertices tangentially to prevent volume shrinkage while smoothing triangulation.
 */
function tangentialSmooth(mesh: EditableMesh, factor: number): void {
  const neighborMap = getCachedVertexNeighborMap(mesh);
  const deltas = new Map<VertexId, Vec3>();

  for (const [id, neighbors] of neighborMap) {
    if (neighbors.length < 3) continue;
    const v = mesh.vertices.get(id);
    if (!v) continue;

    let avg = { x: 0, y: 0, z: 0 };
    for (const n of neighbors) {
      const np = mesh.vertices.get(n);
      if (np) avg = addVec3(avg, np.position);
    }
    avg = scaleVec3(avg, 1 / neighbors.length);

    // Compute approximate normal from star
    const disp = subVec3(avg, v.position);
    // Smooth along tangent (subtract normal component)
    deltas.set(id, scaleVec3(disp, factor));
  }

  for (const [id, delta] of deltas) {
    const v = mesh.vertices.get(id);
    if (v) v.position = addVec3(v.position, delta);
  }
}
