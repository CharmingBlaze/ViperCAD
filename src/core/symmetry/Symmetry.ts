import type {
  ModelDocument,
  SymmetryAxis,
  SymmetrySettings,
} from '@/core/document/types';
import { addVec3, scaleVec3, v3, type Vec3 } from '@/core/math/Vec3';
import {
  buildEdgeLookup,
  edgeKey,
  faceVertexIds,
  getEdgeVertices,
} from '@/core/mesh/EditableMesh';
import type {
  EditableMesh,
  EdgeId,
  FaceId,
  VertexId,
} from '@/core/mesh/types';

export type SymmetryOperation = {
  key: string;
  apply(point: Vec3): Vec3;
};

export function setModellingProfile(
  document: ModelDocument,
  profile: 'general' | 'character',
): void {
  document.settings.modellingProfile = profile;
  if (profile === 'character') {
    // Character work starts with the conventional left/right X mirror.
    document.settings.symmetry.x = true;
    document.settings.symmetry.liveMirror = true;
  }
  document.dirty = true;
}

/** All enabled reflection/radial copies, excluding the identity transform. */
export function symmetryOperations(settings: SymmetrySettings): SymmetryOperation[] {
  const reflectionAxes = (['x', 'y', 'z'] as const).filter((axis) => settings[axis]);
  const reflections: SymmetryOperation[] = [{ key: 'identity', apply: clonePoint }];
  for (let mask = 1; mask < 1 << reflectionAxes.length; mask++) {
    const axes = reflectionAxes.filter((_, index) => (mask & (1 << index)) !== 0);
    reflections.push({
      key: `mirror-${axes.join('')}`,
      apply: (point) => reflectPoint(point, axes),
    });
  }

  const radialCount = settings.radialEnabled
    ? Math.max(2, Math.min(32, Math.round(settings.radialCount)))
    : 1;
  const operations: SymmetryOperation[] = [];
  for (let radialIndex = 0; radialIndex < radialCount; radialIndex++) {
    const angle = (radialIndex / radialCount) * Math.PI * 2;
    for (const reflection of reflections) {
      if (radialIndex === 0 && reflection.key === 'identity') continue;
      operations.push({
        key: radialIndex
          ? `${reflection.key}-radial-${radialIndex}`
          : reflection.key,
        apply: (point) =>
          rotateAroundAxis(reflection.apply(point), settings.radialAxis, angle),
      });
    }
  }
  return operations;
}

/** Include mirrored/radial counterparts so live preview and cancel snapshot them. */
export function expandSymmetryVertexIds(
  mesh: EditableMesh,
  primaryVertexIds: Iterable<VertexId>,
  settings: SymmetrySettings,
): Set<VertexId> {
  const primary = new Set(primaryVertexIds);
  const expanded = new Set(primary);
  if (!settings.liveMirror) return expanded;
  const operations = symmetryOperations(settings);
  if (!operations.length) return expanded;
  const index = new VertexSpatialIndex(mesh, settings.mergeTolerance);
  for (const id of primary) {
    const point = mesh.vertices.get(id)?.position;
    if (!point) continue;
    for (const operation of operations) {
      const match = index.nearest(operation.apply(point));
      if (match) expanded.add(match);
    }
  }
  return expanded;
}

/** Include existing mirrored/radial counterparts of the selected edges. */
export function expandSymmetryEdgeIds(
  mesh: EditableMesh,
  primaryEdgeIds: Iterable<EdgeId>,
  settings: SymmetrySettings,
): Set<EdgeId> {
  const primary = new Set([...primaryEdgeIds].filter((id) => mesh.edges.has(id)));
  const expanded = new Set(primary);
  if (!settings.liveMirror) return expanded;
  const operations = symmetryOperations(settings);
  if (!operations.length) return expanded;

  const vertexIndex = new VertexSpatialIndex(mesh, settings.mergeTolerance);
  const edgeLookup = buildEdgeLookup(mesh);
  for (const edgeId of primary) {
    const pair = getEdgeVertices(mesh, edgeId);
    if (!pair) continue;
    const a = mesh.vertices.get(pair[0])?.position;
    const b = mesh.vertices.get(pair[1])?.position;
    if (!a || !b) continue;
    for (const operation of operations) {
      const mirroredA = vertexIndex.nearest(operation.apply(a));
      const mirroredB = vertexIndex.nearest(operation.apply(b));
      if (!mirroredA || !mirroredB) continue;
      const match = edgeLookup.get(edgeKey(mirroredA, mirroredB));
      if (match) expanded.add(match);
    }
  }
  return expanded;
}

/** Include existing mirrored/radial counterparts of the selected faces. */
export function expandSymmetryFaceIds(
  mesh: EditableMesh,
  primaryFaceIds: Iterable<FaceId>,
  settings: SymmetrySettings,
): Set<FaceId> {
  const primary = new Set([...primaryFaceIds].filter((id) => mesh.faces.has(id)));
  const expanded = new Set(primary);
  if (!settings.liveMirror) return expanded;
  const operations = symmetryOperations(settings);
  if (!operations.length) return expanded;

  const vertexIndex = new VertexSpatialIndex(mesh, settings.mergeTolerance);
  const facesByVertices = new Map<string, FaceId>();
  for (const faceId of mesh.faces.keys()) {
    facesByVertices.set(componentKey(faceVertexIds(mesh, faceId)), faceId);
  }

  for (const faceId of primary) {
    const vertices = faceVertexIds(mesh, faceId)
      .map((id) => mesh.vertices.get(id)?.position)
      .filter((point): point is Vec3 => !!point);
    if (vertices.length < 3) continue;
    for (const operation of operations) {
      const mirroredIds: VertexId[] = [];
      for (const point of vertices) {
        const match = vertexIndex.nearest(operation.apply(point));
        if (!match) break;
        mirroredIds.push(match);
      }
      if (mirroredIds.length !== vertices.length) continue;
      const match = facesByVertices.get(componentKey(mirroredIds));
      if (match) expanded.add(match);
    }
  }
  return expanded;
}

/**
 * Apply a deformation to primary vertices and all existing symmetry
 * counterparts. This is shared by transform editing and sculpt-style brushes.
 */
export function applyLiveSymmetricVertexEdit(
  mesh: EditableMesh,
  primaryBefore: Map<VertexId, Vec3>,
  primaryAfter: Map<VertexId, Vec3>,
  settings: SymmetrySettings,
): Set<VertexId> {
  const changed = new Set<VertexId>();
  const operations = [
    { key: 'identity', apply: clonePoint },
    ...(settings.liveMirror ? symmetryOperations(settings) : []),
  ];
  const index = new VertexSpatialIndex(mesh, settings.mergeTolerance);
  const accumulated = new Map<VertexId, { sum: Vec3; count: number }>();

  for (const [sourceId, before] of primaryBefore) {
    const after = primaryAfter.get(sourceId);
    if (!after) continue;
    for (const operation of operations) {
      const targetId = index.nearest(operation.apply(before));
      if (!targetId) continue;
      const desired = operation.apply(after);
      const current = accumulated.get(targetId) ?? { sum: v3(), count: 0 };
      current.sum = addVec3(current.sum, desired);
      current.count += 1;
      accumulated.set(targetId, current);
    }
  }

  for (const [id, value] of accumulated) {
    const vertex = mesh.vertices.get(id);
    if (!vertex) continue;
    vertex.position = scaleVec3(value.sum, 1 / value.count);
    changed.add(id);
  }
  return changed;
}

export function reflectPoint(point: Vec3, axes: readonly SymmetryAxis[]): Vec3 {
  return {
    x: axes.includes('x') ? -point.x : point.x,
    y: axes.includes('y') ? -point.y : point.y,
    z: axes.includes('z') ? -point.z : point.z,
  };
}

export function rotateAroundAxis(point: Vec3, axis: SymmetryAxis, angle: number): Vec3 {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  if (axis === 'x') {
    return { x: point.x, y: point.y * cos - point.z * sin, z: point.y * sin + point.z * cos };
  }
  if (axis === 'y') {
    return { x: point.x * cos + point.z * sin, y: point.y, z: -point.x * sin + point.z * cos };
  }
  return { x: point.x * cos - point.y * sin, y: point.x * sin + point.y * cos, z: point.z };
}

class VertexSpatialIndex {
  private readonly tolerance: number;
  private readonly buckets = new Map<string, VertexId[]>();
  private readonly mesh: EditableMesh;

  constructor(mesh: EditableMesh, tolerance: number) {
    this.mesh = mesh;
    this.tolerance = Math.max(1e-7, tolerance);
    for (const vertex of mesh.vertices.values()) {
      const key = this.key(vertex.position);
      const bucket = this.buckets.get(key) ?? [];
      bucket.push(vertex.id);
      this.buckets.set(key, bucket);
    }
  }

  nearest(point: Vec3): VertexId | null {
    const base = this.cell(point);
    let best: VertexId | null = null;
    let bestDistance = this.tolerance * this.tolerance;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          const bucket = this.buckets.get(`${base.x + dx}|${base.y + dy}|${base.z + dz}`);
          if (!bucket) continue;
          for (const id of bucket) {
            const candidate = this.mesh.vertices.get(id)!.position;
            const distance =
              (candidate.x - point.x) ** 2 +
              (candidate.y - point.y) ** 2 +
              (candidate.z - point.z) ** 2;
            if (distance <= bestDistance) {
              bestDistance = distance;
              best = id;
            }
          }
        }
      }
    }
    return best;
  }

  private cell(point: Vec3) {
    return {
      x: Math.round(point.x / this.tolerance),
      y: Math.round(point.y / this.tolerance),
      z: Math.round(point.z / this.tolerance),
    };
  }

  private key(point: Vec3): string {
    const cell = this.cell(point);
    return `${cell.x}|${cell.y}|${cell.z}`;
  }
}

function clonePoint(point: Vec3): Vec3 {
  return { ...point };
}

function componentKey(ids: Iterable<string>): string {
  return [...ids].sort().join('|');
}
