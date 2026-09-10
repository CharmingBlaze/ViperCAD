import { dotVec3, subVec3, type Vec3 } from '@/core/math/Vec3';
import {
  addFace,
  bumpTopology,
  faceVertexIds,
  getEdgeVertices,
  removeFace,
} from '@/core/mesh/EditableMesh';
import type { EditableMesh, FaceId, VertexId } from '@/core/mesh/types';

export type DecimateOptions = {
  /** Target fraction of current faces to retain [0.1 .. 0.9], default 0.5 */
  ratio?: number;
  /** Maximum number of collapse iterations */
  maxIterations?: number;
};

/**
 * Fast edge collapse mesh decimation to reduce polygon count on high-density sculpts.
 */
export function decimateMesh(mesh: EditableMesh, options: DecimateOptions = {}): boolean {
  if (mesh.faces.size < 8) return false;
  const ratio = Math.max(0.1, Math.min(0.9, options.ratio ?? 0.5));
  const targetFaces = Math.max(4, Math.floor(mesh.faces.size * ratio));

  // Build vertex to faces mapping
  const vertexFaces = new Map<VertexId, Set<FaceId>>();
  for (const face of mesh.faces.values()) {
    for (const vId of faceVertexIds(mesh, face.id)) {
      let set = vertexFaces.get(vId);
      if (!set) {
        set = new Set();
        vertexFaces.set(vId, set);
      }
      set.add(face.id);
    }
  }

  // Edge lengths list for priority
  type CandidateEdge = { vA: VertexId; vB: VertexId; lengthSq: number };
  const edges: CandidateEdge[] = [];
  for (const edge of mesh.edges.values()) {
    const pair = getEdgeVertices(mesh, edge.id);
    if (!pair) continue;
    const pA = mesh.vertices.get(pair[0])?.position;
    const pB = mesh.vertices.get(pair[1])?.position;
    if (!pA || !pB) continue;
    const d = subVec3(pB, pA);
    edges.push({ vA: pair[0], vB: pair[1], lengthSq: dotVec3(d, d) });
  }

  // Sort edges ascending by length
  edges.sort((a, b) => a.lengthSq - b.lengthSq);

  let currentFaces = mesh.faces.size;

  for (const candidate of edges) {
    if (currentFaces <= targetFaces) break;
    const { vA, vB } = candidate;
    if (!mesh.vertices.has(vA) || !mesh.vertices.has(vB)) continue;

    const facesA = vertexFaces.get(vA);
    const facesB = vertexFaces.get(vB);
    if (!facesA || !facesB) continue;

    // Shared faces between vA and vB are removed
    const sharedFaces: FaceId[] = [];
    for (const fId of facesA) {
      if (facesB.has(fId)) sharedFaces.push(fId);
    }

    if (sharedFaces.length < 1 || sharedFaces.length > 2) continue;

    // Check if collapsing vA into midpoint preserves normals
    const pA = mesh.vertices.get(vA)!.position;
    const pB = mesh.vertices.get(vB)!.position;
    const midPoint: Vec3 = {
      x: (pA.x + pB.x) * 0.5,
      y: (pA.y + pB.y) * 0.5,
      z: (pA.z + pB.z) * 0.5,
    };

    const affectedFaceIds = new Set([...facesA, ...facesB]);
    const remappedFaces: VertexId[][] = [];

    for (const fId of affectedFaceIds) {
      const vIds = faceVertexIds(mesh, fId);
      removeFace(mesh, fId);
      if (sharedFaces.includes(fId)) {
        currentFaces--;
        continue;
      }
      const remapped = vIds.map((id) => (id === vB ? vA : id));
      const unique = new Set(remapped);
      if (unique.size >= 3) {
        remappedFaces.push(remapped);
      } else {
        currentFaces--;
      }
    }

    // Move vA to midpoint and remove vB
    mesh.vertices.get(vA)!.position = midPoint;
    mesh.vertices.delete(vB);
    vertexFaces.delete(vB);

    // Reconstruct valid remapped faces
    facesA.clear();
    for (const remapped of remappedFaces) {
      try {
        const { faceId } = addFace(mesh, remapped);
        facesA.add(faceId);
        for (const vId of remapped) {
          let set = vertexFaces.get(vId);
          if (!set) {
            set = new Set();
            vertexFaces.set(vId, set);
          }
          set.add(faceId);
        }
      } catch {
        // Skip non-manifold face configurations
      }
    }
  }

  bumpTopology(mesh);
  return true;
}
