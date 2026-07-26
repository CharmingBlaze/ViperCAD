import { createId } from '@/core/ids/IdService';
import {
  crossVec3,
  dotVec3,
  lengthVec3,
  normalizeVec3,
  subVec3,
  v3,
  type Vec3,
} from '@/core/math/Vec3';
import { faceCornerIds, faceHalfEdgeIds, faceVertexIds } from '@/core/mesh/EditableMesh';
import { computeFaceNormal } from '@/core/mesh/Normals';
import type { EditableMesh, FaceId, UvLayerId } from '@/core/mesh/types';

export type UvIsland = { id: string; faceIds: FaceId[]; cornerIds: string[] };

/** Blockbench-style unwrap modes. */
export type UvUnwrapMode =
  | 'auto'
  | 'box'
  | 'cubic'
  | 'cylinder'
  | 'sphere'
  | 'view'
  | 'planar';

export type UvViewAxes = {
  /** Camera look direction (into the scene). */
  forward: Vec3;
  right: Vec3;
  up: Vec3;
};

export function createUvLayer(mesh: EditableMesh, name: string): UvLayerId {
  const id = createId('uv');
  mesh.uvLayers.set(id, { id, name });
  for (const corner of mesh.faceCorners.values()) corner.uvs.set(id, { x: 0, y: 0 });
  if (!mesh.defaultUvLayerId) mesh.defaultUvLayerId = id;
  mesh.geometryVersion += 1;
  mesh.dirty.uvs = true;
  return id;
}

export function markUvSeams(mesh: EditableMesh, edgeIds: string[], seam = true): void {
  for (const id of edgeIds) {
    const edge = mesh.edges.get(id);
    if (edge) edge.seam = seam;
  }
  mesh.geometryVersion += 1;
  mesh.dirty.uvs = true;
}

/** Derive UV islands by traversing face adjacency across edges not marked as seams. */
export function detectUvIslands(mesh: EditableMesh): UvIsland[] {
  const remaining = new Set(mesh.faces.keys());
  const islands: UvIsland[] = [];
  while (remaining.size) {
    const seed = remaining.values().next().value as FaceId;
    const faces: FaceId[] = [];
    const queue = [seed];
    remaining.delete(seed);
    while (queue.length) {
      const faceId = queue.shift()!;
      faces.push(faceId);
      for (const heId of faceHalfEdgeIds(mesh, faceId)) {
        const he = mesh.halfEdges.get(heId)!;
        const edge = mesh.edges.get(he.edgeId)!;
        if (edge.seam || !he.twinHalfEdgeId) continue;
        const adjacent = mesh.halfEdges.get(he.twinHalfEdgeId)?.faceId;
        if (adjacent && remaining.delete(adjacent)) queue.push(adjacent);
      }
    }
    islands.push({
      id: createId('island'),
      faceIds: faces,
      cornerIds: faces.flatMap((id) => faceCornerIds(mesh, id)),
    });
  }
  return islands;
}

/**
 * Project each face onto its own plane using the face normal so UV orientation
 * matches viewing the face from outside (CCW winding → CCW in V-up UV space).
 */
export function projectUvPlanar(
  mesh: EditableMesh,
  faceIds: FaceId[],
  layerId = mesh.defaultUvLayerId,
): void {
  if (!layerId || !mesh.uvLayers.has(layerId)) throw new Error('Invalid UV layer');
  for (const faceId of faceIds) {
    const cornerIds = faceCornerIds(mesh, faceId);
    if (cornerIds.length < 3) continue;
    const points = cornerIds.map(
      (id) => mesh.vertices.get(mesh.faceCorners.get(id)!.vertexId)!.position,
    );
    const normal = computeFaceNormal(mesh, faceId);
    const origin = points[0]!;
    let tangent = normalizeVec3(
      Math.abs(normal.y) < 0.9
        ? crossVec3(v3(0, 1, 0), normal)
        : crossVec3(v3(1, 0, 0), normal),
    );
    if (lengthVec3(tangent) < 1e-8) tangent = v3(1, 0, 0);
    let bitangent = normalizeVec3(crossVec3(normal, tangent));
    if (lengthVec3(bitangent) < 1e-8) bitangent = v3(0, 0, 1);

    let uvs = points.map((p) => {
      const d = subVec3(p, origin);
      return { x: dotVec3(d, tangent), y: dotVec3(d, bitangent) };
    });

    // Ensure UV winding matches face winding (positive area = CCW in V-up).
    let area = 0;
    for (let i = 0; i < uvs.length; i++) {
      const a = uvs[i]!;
      const b = uvs[(i + 1) % uvs.length]!;
      area += a.x * b.y - b.x * a.y;
    }
    if (area < 0) {
      uvs = uvs.map((uv) => ({ x: uv.x, y: -uv.y }));
    }

    let minU = Infinity;
    let minV = Infinity;
    let maxU = -Infinity;
    let maxV = -Infinity;
    for (const uv of uvs) {
      minU = Math.min(minU, uv.x);
      minV = Math.min(minV, uv.y);
      maxU = Math.max(maxU, uv.x);
      maxV = Math.max(maxV, uv.y);
    }
    const spanU = Math.max(1e-12, maxU - minU);
    const spanV = Math.max(1e-12, maxV - minV);
    const span = Math.max(spanU, spanV);
    for (let i = 0; i < cornerIds.length; i++) {
      const uv = uvs[i]!;
      mesh.faceCorners.get(cornerIds[i]!)!.uvs.set(layerId, {
        x: (uv.x - minU) / span,
        y: (uv.y - minV) / span,
      });
    }
  }
  mesh.geometryVersion += 1;
  mesh.dirty.uvs = true;
}

/**
 * Blockbench Auto UV / rearrange: each face keeps world-space aspect,
 * then shelf-packed into 0–1.
 */
export function unwrapUvAuto(
  mesh: EditableMesh,
  faceIds: FaceId[],
  layerId = mesh.defaultUvLayerId,
  padding = 0.01,
): void {
  if (!layerId || !mesh.uvLayers.has(layerId)) throw new Error('Invalid UV layer');
  const charts: FaceChart[] = [];
  for (const faceId of faceIds) {
    const chart = projectFaceToChart(mesh, faceId);
    if (chart) charts.push(chart);
  }
  shelfPackCharts(charts, padding);
  applyCharts(mesh, charts, layerId);
  mesh.geometryVersion += 1;
  mesh.dirty.uvs = true;
}

/**
 * Blockbench Box UV: unfold selected faces onto a Minecraft-style cube net
 * using the selection AABB and dominant face normals.
 */
export function unwrapUvBox(
  mesh: EditableMesh,
  faceIds: FaceId[],
  layerId = mesh.defaultUvLayerId,
): void {
  if (!layerId || !mesh.uvLayers.has(layerId)) throw new Error('Invalid UV layer');
  const aabb = meshAabb(mesh, faceIds);
  if (!aabb) return;
  const { min, size } = aabb;
  const sx = Math.max(1e-6, size.x);
  const sy = Math.max(1e-6, size.y);
  const sz = Math.max(1e-6, size.z);
  // Net size in world units (Blockbench face_data layout).
  const netW = 2 * (sx + sz);
  const netH = sy + sz;
  const scale = 1 / Math.max(netW, netH);

  type Side = 'up' | 'down' | 'east' | 'west' | 'north' | 'south';
  const slot = (side: Side) => {
    switch (side) {
      case 'up':
        return { x: sz, y: 0, w: sx, h: sz };
      case 'down':
        return { x: sz + sx, y: 0, w: sx, h: sz };
      case 'east':
        return { x: 0, y: sz, w: sz, h: sy };
      case 'north':
        return { x: sz, y: sz, w: sx, h: sy };
      case 'west':
        return { x: sz + sx, y: sz, w: sz, h: sy };
      case 'south':
        return { x: sz + sx + sz, y: sz, w: sx, h: sy };
    }
  };

  const localUv = (side: Side, p: Vec3): { u: number; v: number } => {
    const fx = (p.x - min.x) / sx;
    const fy = (p.y - min.y) / sy;
    const fz = (p.z - min.z) / sz;
    switch (side) {
      case 'up':
        return { u: fx, v: 1 - fz };
      case 'down':
        return { u: fx, v: fz };
      case 'north': // -Z
        return { u: 1 - fx, v: fy };
      case 'south': // +Z
        return { u: fx, v: fy };
      case 'east': // +X
        return { u: 1 - fz, v: fy };
      case 'west': // -X
        return { u: fz, v: fy };
    }
  };

  // Place net at bottom-left of UV space; V grows upward.
  for (const faceId of faceIds) {
    const n = computeFaceNormal(mesh, faceId);
    const side = dominantCubeSide(n);
    const rect = slot(side);
    for (const cornerId of faceCornerIds(mesh, faceId)) {
      const p = mesh.vertices.get(mesh.faceCorners.get(cornerId)!.vertexId)!.position;
      const local = localUv(side, p);
      mesh.faceCorners.get(cornerId)!.uvs.set(layerId, {
        x: (rect.x + local.u * rect.w) * scale,
        y: (rect.y + local.v * rect.h) * scale,
      });
    }
  }
  mesh.geometryVersion += 1;
  mesh.dirty.uvs = true;
}

/**
 * Cubic / triplanar unwrap: assign each face to ±X/±Y/±Z by normal,
 * project in world space, pack the six groups.
 */
export function unwrapUvCubic(
  mesh: EditableMesh,
  faceIds: FaceId[],
  layerId = mesh.defaultUvLayerId,
  padding = 0.01,
): void {
  if (!layerId || !mesh.uvLayers.has(layerId)) throw new Error('Invalid UV layer');
  const aabb = meshAabb(mesh, faceIds);
  if (!aabb) return;
  const { min, size } = aabb;
  const charts: FaceChart[] = [];

  for (const faceId of faceIds) {
    const n = computeFaceNormal(mesh, faceId);
    const side = dominantCubeSide(n);
    const corners = faceCornerIds(mesh, faceId);
    const points = corners.map(
      (id) => mesh.vertices.get(mesh.faceCorners.get(id)!.vertexId)!.position,
    );
    const uvs = points.map((p) => {
      const fx = size.x > 1e-12 ? (p.x - min.x) / size.x : 0;
      const fy = size.y > 1e-12 ? (p.y - min.y) / size.y : 0;
      const fz = size.z > 1e-12 ? (p.z - min.z) / size.z : 0;
      switch (side) {
        case 'up':
        case 'down':
          return { x: fx * Math.max(size.x, 1e-6), y: fz * Math.max(size.z, 1e-6) };
        case 'east':
        case 'west':
          return { x: fz * Math.max(size.z, 1e-6), y: fy * Math.max(size.y, 1e-6) };
        default:
          return { x: fx * Math.max(size.x, 1e-6), y: fy * Math.max(size.y, 1e-6) };
      }
    });
    charts.push(normalizeChart(faceId, corners, uvs));
  }
  shelfPackCharts(charts, padding);
  applyCharts(mesh, charts, layerId);
  mesh.geometryVersion += 1;
  mesh.dirty.uvs = true;
}

/** Cylindrical unwrap around the longest AABB axis (fallback Y). */
export function unwrapUvCylinder(
  mesh: EditableMesh,
  faceIds: FaceId[],
  layerId = mesh.defaultUvLayerId,
): void {
  if (!layerId || !mesh.uvLayers.has(layerId)) throw new Error('Invalid UV layer');
  const aabb = meshAabb(mesh, faceIds);
  if (!aabb) return;
  const { min, size, center } = aabb;
  const axis: 'x' | 'y' | 'z' =
    size.y >= size.x && size.y >= size.z ? 'y' : size.x >= size.z ? 'x' : 'z';

  for (const faceId of faceIds) {
    for (const cornerId of faceCornerIds(mesh, faceId)) {
      const p = mesh.vertices.get(mesh.faceCorners.get(cornerId)!.vertexId)!.position;
      let u = 0;
      let v = 0;
      if (axis === 'y') {
        u = (Math.atan2(p.x - center.x, p.z - center.z) + Math.PI) / (Math.PI * 2);
        v = size.y > 1e-12 ? (p.y - min.y) / size.y : 0;
      } else if (axis === 'x') {
        u = (Math.atan2(p.z - center.z, p.y - center.y) + Math.PI) / (Math.PI * 2);
        v = size.x > 1e-12 ? (p.x - min.x) / size.x : 0;
      } else {
        u = (Math.atan2(p.x - center.x, p.y - center.y) + Math.PI) / (Math.PI * 2);
        v = size.z > 1e-12 ? (p.z - min.z) / size.z : 0;
      }
      mesh.faceCorners.get(cornerId)!.uvs.set(layerId, { x: u, y: v });
    }
  }
  mesh.geometryVersion += 1;
  mesh.dirty.uvs = true;
}

/** Spherical (latitude/longitude) unwrap around selection centre. */
export function unwrapUvSphere(
  mesh: EditableMesh,
  faceIds: FaceId[],
  layerId = mesh.defaultUvLayerId,
): void {
  if (!layerId || !mesh.uvLayers.has(layerId)) throw new Error('Invalid UV layer');
  const aabb = meshAabb(mesh, faceIds);
  if (!aabb) return;
  const { center } = aabb;

  for (const faceId of faceIds) {
    for (const cornerId of faceCornerIds(mesh, faceId)) {
      const p = mesh.vertices.get(mesh.faceCorners.get(cornerId)!.vertexId)!.position;
      const d = subVec3(p, center);
      const r = Math.max(1e-12, lengthVec3(d));
      const u = (Math.atan2(d.x, d.z) + Math.PI) / (Math.PI * 2);
      const v = Math.acos(Math.min(1, Math.max(-1, d.y / r))) / Math.PI;
      mesh.faceCorners.get(cornerId)!.uvs.set(layerId, { x: u, y: 1 - v });
    }
  }
  mesh.geometryVersion += 1;
  mesh.dirty.uvs = true;
}

/** Project from a 3D view (Blockbench "UV Project from View"). */
export function unwrapUvFromView(
  mesh: EditableMesh,
  faceIds: FaceId[],
  view: UvViewAxes,
  layerId = mesh.defaultUvLayerId,
): void {
  if (!layerId || !mesh.uvLayers.has(layerId)) throw new Error('Invalid UV layer');
  const right = normalizeVec3(view.right);
  const up = normalizeVec3(view.up);
  const points: Vec3[] = [];
  for (const faceId of faceIds) {
    for (const vid of faceVertexIds(mesh, faceId)) {
      points.push(mesh.vertices.get(vid)!.position);
    }
  }
  if (!points.length) return;

  let minU = Infinity;
  let minV = Infinity;
  let maxU = -Infinity;
  let maxV = -Infinity;
  const projected = new Map<string, { u: number; v: number }>();
  for (const faceId of faceIds) {
    for (const cornerId of faceCornerIds(mesh, faceId)) {
      const p = mesh.vertices.get(mesh.faceCorners.get(cornerId)!.vertexId)!.position;
      const u = dotVec3(p, right);
      const v = dotVec3(p, up);
      projected.set(cornerId, { u, v });
      minU = Math.min(minU, u);
      minV = Math.min(minV, v);
      maxU = Math.max(maxU, u);
      maxV = Math.max(maxV, v);
    }
  }
  const spanU = Math.max(1e-12, maxU - minU);
  const spanV = Math.max(1e-12, maxV - minV);
  const span = Math.max(spanU, spanV);
  for (const [cornerId, uv] of projected) {
    mesh.faceCorners.get(cornerId)!.uvs.set(layerId, {
      x: (uv.u - minU) / span,
      y: (uv.v - minV) / span,
    });
  }
  mesh.geometryVersion += 1;
  mesh.dirty.uvs = true;
}

/** Run any unwrap mode. */
export function unwrapUvs(
  mesh: EditableMesh,
  faceIds: FaceId[],
  mode: UvUnwrapMode,
  layerId = mesh.defaultUvLayerId,
  options: { view?: UvViewAxes; padding?: number } = {},
): void {
  const faces = faceIds.length ? faceIds : [...mesh.faces.keys()];
  switch (mode) {
    case 'auto':
      unwrapUvAuto(mesh, faces, layerId, options.padding ?? 0.01);
      break;
    case 'box':
      unwrapUvBox(mesh, faces, layerId);
      break;
    case 'cubic':
      unwrapUvCubic(mesh, faces, layerId, options.padding ?? 0.01);
      break;
    case 'cylinder':
      unwrapUvCylinder(mesh, faces, layerId);
      break;
    case 'sphere':
      unwrapUvSphere(mesh, faces, layerId);
      break;
    case 'view':
      if (!options.view) throw new Error('View axes required for view unwrap');
      unwrapUvFromView(mesh, faces, options.view, layerId);
      break;
    case 'planar':
      projectUvPlanar(mesh, faces, layerId);
      break;
  }
}

/** Deterministic grid pack with padding; scales each derived island into one cell. */
export function packUvIslands(
  mesh: EditableMesh,
  padding = 0.01,
  layerId = mesh.defaultUvLayerId,
): UvIsland[] {
  if (!layerId) throw new Error('Mesh has no UV layer');
  return packIslandList(mesh, detectUvIslands(mesh), padding, layerId);
}

/** Pack only islands that intersect the given faces (selection-aware). */
export function packSelectedUvIslands(
  mesh: EditableMesh,
  faceIds: Iterable<FaceId>,
  padding = 0.01,
  layerId = mesh.defaultUvLayerId,
): UvIsland[] {
  if (!layerId) throw new Error('Mesh has no UV layer');
  const selected = new Set(faceIds);
  if (!selected.size) return packUvIslands(mesh, padding, layerId);
  const islands = detectUvIslands(mesh).filter((island) =>
    island.faceIds.some((id) => selected.has(id)),
  );
  return packIslandList(mesh, islands, padding, layerId);
}

/** Island containing a face, or null. */
export function islandForFace(mesh: EditableMesh, faceId: FaceId): UvIsland | null {
  return detectUvIslands(mesh).find((island) => island.faceIds.includes(faceId)) ?? null;
}

/** Build view axes from a camera position/target/up snapshot. */
export function viewAxesFromCamera(
  position: Vec3,
  target: Vec3,
  up: Vec3,
): UvViewAxes {
  const forward = normalizeVec3(subVec3(target, position));
  let right = normalizeVec3(crossVec3(forward, up));
  if (lengthVec3(right) < 1e-8) {
    right = normalizeVec3(crossVec3(forward, v3(0, 0, 1)));
  }
  if (lengthVec3(right) < 1e-8) right = v3(1, 0, 0);
  const realUp = normalizeVec3(crossVec3(right, forward));
  return { forward, right, up: realUp };
}

// --- internals ---

type FaceChart = {
  faceId: FaceId;
  cornerIds: string[];
  /** Local UVs before pack (world-scale, origin at min). */
  local: { x: number; y: number }[];
  width: number;
  height: number;
  /** Packed origin in 0–1 space. */
  ox: number;
  oy: number;
  scale: number;
};

function projectFaceToChart(mesh: EditableMesh, faceId: FaceId): FaceChart | null {
  const cornerIds = faceCornerIds(mesh, faceId);
  if (cornerIds.length < 3) return null;
  const points = cornerIds.map(
    (id) => mesh.vertices.get(mesh.faceCorners.get(id)!.vertexId)!.position,
  );
  const normal = computeFaceNormal(mesh, faceId);
  const origin = points[0]!;
  let tangent = normalizeVec3(subVec3(points[1]!, origin));
  if (lengthVec3(tangent) < 1e-8) {
    const axis =
      Math.abs(normal.y) < 0.9 ? v3(0, 1, 0) : v3(1, 0, 0);
    tangent = normalizeVec3(crossVec3(axis, normal));
  }
  let bitangent = normalizeVec3(crossVec3(normal, tangent));
  if (lengthVec3(bitangent) < 1e-8) bitangent = v3(0, 0, 1);

  let uvs = points.map((p) => {
    const d = subVec3(p, origin);
    return { x: dotVec3(d, tangent), y: dotVec3(d, bitangent) };
  });

  // Keep UV winding matching the face (outward view → CCW in V-up).
  let area = 0;
  for (let i = 0; i < uvs.length; i++) {
    const a = uvs[i]!;
    const b = uvs[(i + 1) % uvs.length]!;
    area += a.x * b.y - b.x * a.y;
  }
  if (area < 0) {
    uvs = uvs.map((uv) => ({ x: uv.x, y: -uv.y }));
  }

  // Align longest edge with +U (Blockbench-style straighten).
  let bestLen = -1;
  let bestAngle = 0;
  for (let i = 0; i < uvs.length; i++) {
    const a = uvs[i]!;
    const b = uvs[(i + 1) % uvs.length]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len > bestLen) {
      bestLen = len;
      bestAngle = -Math.atan2(dy, dx);
    }
  }
  const c = Math.cos(bestAngle);
  const s = Math.sin(bestAngle);
  uvs = uvs.map((uv) => ({ x: uv.x * c - uv.y * s, y: uv.x * s + uv.y * c }));

  return normalizeChart(faceId, cornerIds, uvs);
}

function normalizeChart(
  faceId: FaceId,
  cornerIds: string[],
  uvs: { x: number; y: number }[],
): FaceChart {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const uv of uvs) {
    minX = Math.min(minX, uv.x);
    minY = Math.min(minY, uv.y);
    maxX = Math.max(maxX, uv.x);
    maxY = Math.max(maxY, uv.y);
  }
  const local = uvs.map((uv) => ({ x: uv.x - minX, y: uv.y - minY }));
  return {
    faceId,
    cornerIds,
    local,
    width: Math.max(1e-6, maxX - minX),
    height: Math.max(1e-6, maxY - minY),
    ox: 0,
    oy: 0,
    scale: 1,
  };
}

function shelfPackCharts(charts: FaceChart[], padding: number): void {
  if (!charts.length) return;
  const sorted = [...charts].sort((a, b) => b.height - a.height || b.width - a.width);
  let cursorX = padding;
  let cursorY = padding;
  let rowH = 0;
  let maxX = padding;
  let maxY = padding;
  const shelfW = sorted.reduce((s, c) => s + c.width, 0) + padding * (sorted.length + 1);
  const targetW = Math.max(shelfW / Math.ceil(Math.sqrt(sorted.length)), sorted[0]!.width + padding * 2);

  for (const chart of sorted) {
    if (cursorX + chart.width + padding > targetW && cursorX > padding) {
      cursorX = padding;
      cursorY += rowH + padding;
      rowH = 0;
    }
    chart.ox = cursorX;
    chart.oy = cursorY;
    cursorX += chart.width + padding;
    rowH = Math.max(rowH, chart.height);
    maxX = Math.max(maxX, chart.ox + chart.width);
    maxY = Math.max(maxY, chart.oy + chart.height);
  }
  const span = Math.max(maxX + padding, maxY + padding, 1e-6);
  const scale = (1 - padding) / span;
  for (const chart of charts) {
    chart.scale = scale;
    chart.ox = padding * 0.5 + chart.ox * scale;
    chart.oy = padding * 0.5 + chart.oy * scale;
  }
}

function applyCharts(mesh: EditableMesh, charts: FaceChart[], layerId: UvLayerId): void {
  for (const chart of charts) {
    for (let i = 0; i < chart.cornerIds.length; i++) {
      const local = chart.local[i]!;
      mesh.faceCorners.get(chart.cornerIds[i]!)!.uvs.set(layerId, {
        x: chart.ox + local.x * chart.scale,
        y: chart.oy + local.y * chart.scale,
      });
    }
  }
}

function packIslandList(
  mesh: EditableMesh,
  islands: UvIsland[],
  padding: number,
  layerId: UvLayerId,
): UvIsland[] {
  if (!islands.length) return islands;
  const cols = Math.max(1, Math.ceil(Math.sqrt(islands.length)));
  const rows = Math.max(1, Math.ceil(islands.length / cols));
  islands.forEach((island, index) => {
    const uvs = island.cornerIds.map(
      (id) => mesh.faceCorners.get(id)!.uvs.get(layerId) ?? { x: 0, y: 0 },
    );
    const minX = Math.min(...uvs.map((u) => u.x));
    const maxX = Math.max(...uvs.map((u) => u.x));
    const minY = Math.min(...uvs.map((u) => u.y));
    const maxY = Math.max(...uvs.map((u) => u.y));
    const col = index % cols;
    const row = Math.floor(index / cols);
    const cellW = 1 / cols;
    const cellH = 1 / rows;
    island.cornerIds.forEach((id, i) =>
      mesh.faceCorners.get(id)!.uvs.set(layerId, {
        x: col * cellW + padding + ((uvs[i]!.x - minX) / (maxX - minX || 1)) * (cellW - padding * 2),
        y: row * cellH + padding + ((uvs[i]!.y - minY) / (maxY - minY || 1)) * (cellH - padding * 2),
      }),
    );
  });
  mesh.geometryVersion += 1;
  mesh.dirty.uvs = true;
  return islands;
}

function meshAabb(mesh: EditableMesh, faceIds: FaceId[]) {
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  let any = false;
  for (const faceId of faceIds) {
    for (const vid of faceVertexIds(mesh, faceId)) {
      const p = mesh.vertices.get(vid)!.position;
      any = true;
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      minZ = Math.min(minZ, p.z);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
      maxZ = Math.max(maxZ, p.z);
    }
  }
  if (!any) return null;
  const min = v3(minX, minY, minZ);
  const max = v3(maxX, maxY, maxZ);
  const size = v3(maxX - minX, maxY - minY, maxZ - minZ);
  const center = v3((minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2);
  return { min, max, size, center };
}

function dominantCubeSide(n: Vec3): 'up' | 'down' | 'east' | 'west' | 'north' | 'south' {
  const ax = Math.abs(n.x);
  const ay = Math.abs(n.y);
  const az = Math.abs(n.z);
  if (ay >= ax && ay >= az) return n.y >= 0 ? 'up' : 'down';
  if (ax >= az) return n.x >= 0 ? 'east' : 'west';
  return n.z >= 0 ? 'south' : 'north';
}

