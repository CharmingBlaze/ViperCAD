import { isFiniteVec3, lengthSqVec3, subVec3 } from '@/core/math/Vec3';
import {
  faceHalfEdgeIds,
  faceVertexIds,
  getEdgeVertices,
} from './EditableMesh';
import type { EditableMesh, EdgeId, FaceId, VertexId } from './types';

export type ValidationSeverity = 'error' | 'warning';

export type ValidationIssue = {
  code: string;
  message: string;
  severity: ValidationSeverity;
  elementIds: string[];
};

export type ValidationReport = {
  ok: boolean;
  issues: ValidationIssue[];
};

function issue(
  code: string,
  message: string,
  severity: ValidationSeverity,
  elementIds: string[] = [],
): ValidationIssue {
  return { code, message, severity, elementIds };
}

/** Fast validation after ordinary edits. */
export function validateMeshFast(mesh: EditableMesh): ValidationReport {
  const issues: ValidationIssue[] = [];

  for (const [id, v] of mesh.vertices) {
    if (v.id !== id) issues.push(issue('ID_MISMATCH', `Vertex map key mismatch`, 'error', [id]));
    if (!isFiniteVec3(v.position)) {
      issues.push(issue('NON_FINITE_POSITION', `Vertex has non-finite position`, 'error', [id]));
    }
    if (v.outgoingHalfEdgeId && !mesh.halfEdges.has(v.outgoingHalfEdgeId)) {
      issues.push(issue('BAD_VERTEX_HE', `Vertex outgoing half-edge missing`, 'error', [id, v.outgoingHalfEdgeId]));
    }
  }

  for (const [id, he] of mesh.halfEdges) {
    if (he.id !== id) issues.push(issue('ID_MISMATCH', `Half-edge map key mismatch`, 'error', [id]));
    if (!mesh.vertices.has(he.originVertexId)) {
      issues.push(issue('BAD_HE_ORIGIN', `Half-edge origin missing`, 'error', [id, he.originVertexId]));
    }
    if (!mesh.edges.has(he.edgeId)) {
      issues.push(issue('BAD_HE_EDGE', `Half-edge edge missing`, 'error', [id, he.edgeId]));
    }
    if (!mesh.halfEdges.has(he.nextHalfEdgeId) || !mesh.halfEdges.has(he.previousHalfEdgeId)) {
      issues.push(issue('BAD_HE_LOOP', `Half-edge next/prev missing`, 'error', [id]));
    }
    if (he.twinHalfEdgeId && !mesh.halfEdges.has(he.twinHalfEdgeId)) {
      issues.push(issue('BAD_HE_TWIN', `Half-edge twin missing`, 'error', [id, he.twinHalfEdgeId]));
    }
    if (he.faceId && !mesh.faces.has(he.faceId)) {
      issues.push(issue('BAD_HE_FACE', `Half-edge face missing`, 'error', [id, he.faceId]));
    }
    if (he.faceCornerId && !mesh.faceCorners.has(he.faceCornerId)) {
      issues.push(issue('BAD_HE_CORNER', `Half-edge face corner missing`, 'error', [id]));
    }
    const next = mesh.halfEdges.get(he.nextHalfEdgeId);
    const previous = mesh.halfEdges.get(he.previousHalfEdgeId);
    if (next?.previousHalfEdgeId !== id || previous?.nextHalfEdgeId !== id) {
      issues.push(issue('BAD_HE_LINK_RECIPROCITY', `Half-edge next/previous links disagree`, 'error', [id]));
    }
  }

  for (const [id, corner] of mesh.faceCorners) {
    if (corner.id !== id || !mesh.faces.has(corner.faceId) || !mesh.vertices.has(corner.vertexId) || !mesh.halfEdges.has(corner.halfEdgeId)) {
      issues.push(issue('BAD_FACE_CORNER', `Face corner has an invalid reference`, 'error', [id]));
    }
    const he = mesh.halfEdges.get(corner.halfEdgeId);
    if (he && (he.faceCornerId !== id || he.faceId !== corner.faceId || he.originVertexId !== corner.vertexId)) {
      issues.push(issue('FACE_CORNER_MISMATCH', `Face corner and half-edge disagree`, 'error', [id, he.id]));
    }
    for (const [layerId, uv] of corner.uvs) {
      if (!mesh.uvLayers.has(layerId) || !Number.isFinite(uv.x) || !Number.isFinite(uv.y)) issues.push(issue('INVALID_UV', `Face corner UV is invalid`, 'error', [id, layerId]));
    }
  }

  for (const [id, edge] of mesh.edges) {
    if (!mesh.halfEdges.has(edge.halfEdgeAId)) {
      issues.push(issue('BAD_EDGE_HE', `Edge halfEdgeA missing`, 'error', [id, edge.halfEdgeAId]));
    }
    if (edge.halfEdgeBId && !mesh.halfEdges.has(edge.halfEdgeBId)) {
      issues.push(issue('BAD_EDGE_HE', `Edge halfEdgeB missing`, 'error', [id, edge.halfEdgeBId]));
    }
  }

  for (const face of mesh.faces.values()) {
    const loop = faceHalfEdgeIds(mesh, face.id);
    if (loop.length < 3) {
      issues.push(issue('FACE_TOO_SMALL', `Face has fewer than 3 half-edges`, 'error', [face.id]));
      continue;
    }
    // Closed loop check
    for (let i = 0; i < loop.length; i++) {
      const he = mesh.halfEdges.get(loop[i]!)!;
      const next = mesh.halfEdges.get(loop[(i + 1) % loop.length]!)!;
      if (he.nextHalfEdgeId !== next.id) {
        issues.push(issue('FACE_LOOP_BROKEN', `Face loop next link broken`, 'error', [face.id, he.id]));
      }
      if (he.faceId !== face.id) {
        issues.push(issue('FACE_HE_MISMATCH', `Half-edge face id mismatch`, 'error', [face.id, he.id]));
      }
    }
    // Twin agreement
    for (const heId of loop) {
      const he = mesh.halfEdges.get(heId)!;
      if (he.twinHalfEdgeId) {
        const twin = mesh.halfEdges.get(he.twinHalfEdgeId)!;
        if (twin.twinHalfEdgeId !== he.id) {
          issues.push(issue('TWIN_ASYMMETRIC', `Twin half-edges disagree`, 'error', [he.id, twin.id]));
        }
        if (twin.edgeId !== he.edgeId) {
          issues.push(issue('TWIN_EDGE_MISMATCH', `Twins reference different edges`, 'error', [he.id, twin.id]));
        }
      }
    }
    if (face.materialSlot < 0 || face.materialSlot >= mesh.materialSlotCount) {
      issues.push(issue('BAD_MATERIAL_SLOT', `Face material slot out of range`, 'warning', [face.id]));
    }
  }

  const ok = !issues.some((i) => i.severity === 'error');
  return { ok, issues };
}

/** Full validation after complex tools / import / export. */
export function validateMeshFull(mesh: EditableMesh): ValidationReport {
  const report = validateMeshFast(mesh);
  const issues = [...report.issues];

  // Duplicate undirected edges
  const seenEdges = new Map<string, EdgeId>();
  for (const edge of mesh.edges.values()) {
    const verts = getEdgeVertices(mesh, edge.id);
    if (!verts) continue;
    const key = verts[0] < verts[1] ? `${verts[0]}|${verts[1]}` : `${verts[1]}|${verts[0]}`;
    const existing = seenEdges.get(key);
    if (existing) {
      issues.push(issue('DUPLICATE_EDGE', `Duplicate edge between same vertices`, 'error', [existing, edge.id]));
    } else {
      seenEdges.set(key, edge.id);
    }
  }

  // Zero-length edges
  for (const edge of mesh.edges.values()) {
    const verts = getEdgeVertices(mesh, edge.id);
    if (!verts) continue;
    const a = mesh.vertices.get(verts[0])!;
    const b = mesh.vertices.get(verts[1])!;
    if (lengthSqVec3(subVec3(a.position, b.position)) < 1e-20) {
      issues.push(issue('ZERO_LENGTH_EDGE', `Edge has zero length`, 'warning', [edge.id]));
    }
  }

  // Isolated vertices
  const usedVerts = new Set<VertexId>();
  for (const he of mesh.halfEdges.values()) {
    usedVerts.add(he.originVertexId);
  }
  for (const id of mesh.vertices.keys()) {
    if (!usedVerts.has(id)) {
      issues.push(issue('ISOLATED_VERTEX', `Unused vertex`, 'warning', [id]));
    }
  }

  // Non-manifold: more than 2 faces per undirected edge already rejected at creation;
  // check twin consistency for open vs closed.
  for (const edge of mesh.edges.values()) {
    const heA = mesh.halfEdges.get(edge.halfEdgeAId);
    if (!heA) continue;
    if (edge.halfEdgeBId == null && heA.twinHalfEdgeId != null) {
      issues.push(issue('BOUNDARY_TWIN', `Boundary edge has twin`, 'error', [edge.id]));
    }
    if (edge.halfEdgeBId != null) {
      const heB = mesh.halfEdges.get(edge.halfEdgeBId);
      if (heA.twinHalfEdgeId !== edge.halfEdgeBId || heB?.twinHalfEdgeId !== edge.halfEdgeAId) {
        issues.push(issue('EDGE_TWIN_MISMATCH', `Edge half-edges not twinned`, 'error', [edge.id]));
      }
      const nextA = mesh.halfEdges.get(heA.nextHalfEdgeId);
      const nextB = heB ? mesh.halfEdges.get(heB.nextHalfEdgeId) : null;
      if (heB && (heA.originVertexId !== nextB?.originVertexId || heB.originVertexId !== nextA?.originVertexId)) {
        issues.push(issue('INCONSISTENT_WINDING', `Adjacent faces traverse their shared edge in the same direction`, 'error', [edge.id]));
      }
    }
  }

  // Face area approx (Newell)
  for (const face of mesh.faces.values()) {
    const ids = faceVertexIds(mesh, face.id);
    if (ids.length < 3) continue;
    let nx = 0;
    let ny = 0;
    let nz = 0;
    for (let i = 0; i < ids.length; i++) {
      const cur = mesh.vertices.get(ids[i]!)!.position;
      const next = mesh.vertices.get(ids[(i + 1) % ids.length]!)!.position;
      nx += (cur.y - next.y) * (cur.z + next.z);
      ny += (cur.z - next.z) * (cur.x + next.x);
      nz += (cur.x - next.x) * (cur.y + next.y);
    }
    const areaLike = nx * nx + ny * ny + nz * nz;
    if (areaLike < 1e-20) {
      issues.push(issue('ZERO_AREA_FACE', `Face has near-zero area`, 'warning', [face.id]));
    }
  }

  // Duplicate faces (same ordered cycle or reverse)
  const faceSignatures = new Map<string, FaceId>();
  for (const face of mesh.faces.values()) {
    const ids = faceVertexIds(mesh, face.id);
    const rotated = normalizeCycle(ids);
    const rev = normalizeCycle([...ids].reverse());
    const sig = rotated < rev ? rotated : rev;
    const existing = faceSignatures.get(sig);
    if (existing) {
      issues.push(issue('DUPLICATE_FACE', `Duplicate face topology`, 'error', [existing, face.id]));
    } else {
      faceSignatures.set(sig, face.id);
    }
  }


  // Closed meshes must have positive signed volume for outward winding.
  if (mesh.faces.size > 0 && [...mesh.edges.values()].every((edge) => edge.halfEdgeBId != null)) {
    let volume6 = 0;
    for (const face of mesh.faces.values()) {
      const ids = faceVertexIds(mesh, face.id); const a = mesh.vertices.get(ids[0]!)?.position;
      if (!a) continue;
      for (let i = 1; i < ids.length - 1; i++) {
        const b = mesh.vertices.get(ids[i]!)!.position; const c = mesh.vertices.get(ids[i + 1]!)!.position;
        volume6 += a.x * (b.y * c.z - b.z * c.y) + a.y * (b.z * c.x - b.x * c.z) + a.z * (b.x * c.y - b.y * c.x);
      }
    }
    if (volume6 < -1e-12) issues.push(issue('INWARD_WINDING', `Closed mesh has inward winding`, 'error'));
    else if (Math.abs(volume6) <= 1e-12) issues.push(issue('ZERO_VOLUME', `Closed mesh has near-zero signed volume`, 'warning'));
  }

  const ok = !issues.some((i) => i.severity === 'error');
  return { ok, issues };
}

function normalizeCycle(ids: VertexId[]): string {
  if (ids.length === 0) return '';
  let minIdx = 0;
  for (let i = 1; i < ids.length; i++) {
    if (ids[i]! < ids[minIdx]!) minIdx = i;
  }
  const rotated = [...ids.slice(minIdx), ...ids.slice(0, minIdx)];
  return rotated.join(',');
}

export function assertMeshValid(mesh: EditableMesh, full = false): void {
  const report = full ? validateMeshFull(mesh) : validateMeshFast(mesh);
  if (!report.ok) {
    const msg = report.issues
      .filter((i) => i.severity === 'error')
      .map((i) => `${i.code}: ${i.message}`)
      .join('; ');
    throw new Error(`Mesh validation failed: ${msg}`);
  }
}
