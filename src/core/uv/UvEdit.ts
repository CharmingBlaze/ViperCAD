import { cloneVec2, type Vec2 } from '@/core/math/Vec2';
import { faceCornerIds } from '@/core/mesh/EditableMesh';
import type { EditableMesh, FaceCornerId, FaceId, UvLayerId } from '@/core/mesh/types';
import type { CommandHistory } from '@/core/history/CommandHistory';
import {
  type MarqueeMode,
  pointInRect,
  pointsSatisfyMarquee,
  segmentHitsRect,
} from '@/core/selection/MarqueeSelect';

export type UvSnapshot = Map<FaceCornerId, Vec2>;

export function resolveUvLayerId(mesh: EditableMesh, layerId?: UvLayerId | null): UvLayerId | null {
  const id = layerId ?? mesh.defaultUvLayerId;
  return id && mesh.uvLayers.has(id) ? id : null;
}

export function getCornerUv(mesh: EditableMesh, cornerId: FaceCornerId, layerId: UvLayerId): Vec2 {
  return cloneVec2(mesh.faceCorners.get(cornerId)?.uvs.get(layerId) ?? { x: 0, y: 0 });
}

export function cornersForFaces(mesh: EditableMesh, faceIds: Iterable<FaceId>): FaceCornerId[] {
  const out: FaceCornerId[] = [];
  const seen = new Set<FaceCornerId>();
  for (const faceId of faceIds) {
    for (const id of faceCornerIds(mesh, faceId)) {
      if (seen.has(id)) continue;
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

/** Expand selection to every corner that shares the same UV position (welded UV verts). */
export function expandWeldedUvCorners(
  mesh: EditableMesh,
  cornerIds: Iterable<FaceCornerId>,
  layerId: UvLayerId,
  epsilon = 1e-5,
): FaceCornerId[] {
  const seeds = [...cornerIds];
  if (!seeds.length) return [];
  const targets = seeds.map((id) => getCornerUv(mesh, id, layerId));
  const out: FaceCornerId[] = [];
  for (const [id, corner] of mesh.faceCorners) {
    const uv = corner.uvs.get(layerId) ?? { x: 0, y: 0 };
    if (targets.some((t) => Math.abs(uv.x - t.x) <= epsilon && Math.abs(uv.y - t.y) <= epsilon)) {
      out.push(id);
    }
  }
  return out;
}

export function snapshotUvs(
  mesh: EditableMesh,
  cornerIds: Iterable<FaceCornerId>,
  layerId: UvLayerId,
): UvSnapshot {
  const snap: UvSnapshot = new Map();
  for (const id of cornerIds) snap.set(id, getCornerUv(mesh, id, layerId));
  return snap;
}

export function applyUvSnapshot(mesh: EditableMesh, snapshot: UvSnapshot, layerId: UvLayerId): void {
  for (const [id, uv] of snapshot) {
    const corner = mesh.faceCorners.get(id);
    if (!corner) continue;
    corner.uvs.set(layerId, cloneVec2(uv));
  }
  mesh.geometryVersion += 1;
  mesh.dirty.uvs = true;
}

export function translateUvsFromSnapshot(
  mesh: EditableMesh,
  snapshot: UvSnapshot,
  layerId: UvLayerId,
  delta: Vec2,
): void {
  for (const [id, uv] of snapshot) {
    const corner = mesh.faceCorners.get(id);
    if (!corner) continue;
    corner.uvs.set(layerId, { x: uv.x + delta.x, y: uv.y + delta.y });
  }
  mesh.geometryVersion += 1;
  mesh.dirty.uvs = true;
}

export type UvBounds = { min: Vec2; max: Vec2; center: Vec2; size: Vec2 };

export function boundsOfUvs(snapshot: UvSnapshot): UvBounds | null {
  if (!snapshot.size) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const uv of snapshot.values()) {
    minX = Math.min(minX, uv.x);
    minY = Math.min(minY, uv.y);
    maxX = Math.max(maxX, uv.x);
    maxY = Math.max(maxY, uv.y);
  }
  return {
    min: { x: minX, y: minY },
    max: { x: maxX, y: maxY },
    center: { x: (minX + maxX) / 2, y: (minY + maxY) / 2 },
    size: { x: maxX - minX, y: maxY - minY },
  };
}

/** Scale UVs around a pivot (Blockbench-style face resize). */
export function scaleUvsFromSnapshot(
  mesh: EditableMesh,
  snapshot: UvSnapshot,
  layerId: UvLayerId,
  pivot: Vec2,
  scaleU: number,
  scaleV: number,
): void {
  for (const [id, uv] of snapshot) {
    const corner = mesh.faceCorners.get(id);
    if (!corner) continue;
    corner.uvs.set(layerId, {
      x: pivot.x + (uv.x - pivot.x) * scaleU,
      y: pivot.y + (uv.y - pivot.y) * scaleV,
    });
  }
  mesh.geometryVersion += 1;
  mesh.dirty.uvs = true;
}

/** Rotate UVs around a pivot (radians, CCW in UV space). */
export function rotateUvsFromSnapshot(
  mesh: EditableMesh,
  snapshot: UvSnapshot,
  layerId: UvLayerId,
  pivot: Vec2,
  radians: number,
): void {
  const c = Math.cos(radians);
  const s = Math.sin(radians);
  for (const [id, uv] of snapshot) {
    const corner = mesh.faceCorners.get(id);
    if (!corner) continue;
    const dx = uv.x - pivot.x;
    const dy = uv.y - pivot.y;
    corner.uvs.set(layerId, {
      x: pivot.x + dx * c - dy * s,
      y: pivot.y + dx * s + dy * c,
    });
  }
  mesh.geometryVersion += 1;
  mesh.dirty.uvs = true;
}

export type UvGizmoHandle =
  | 'body'
  | 'rotate'
  | 'n'
  | 's'
  | 'e'
  | 'w'
  | 'ne'
  | 'nw'
  | 'se'
  | 'sw';

export type UvGizmoHit = { handle: UvGizmoHandle; pivot: Vec2 };

/** Shared screen-pixel sizes for UV transform gizmo draw + hit testing. */
export const UV_GIZMO_PX = {
  handle: 7,
  handleHit: 16,
  edgeHit: 12,
  rotateStem: 20,
  rotateHit: 18,
} as const;

export type UvGizmoLayout = {
  corners: { handle: UvGizmoHandle; p: Vec2; pivot: Vec2 }[];
  edges: { handle: UvGizmoHandle; p: Vec2; pivot: Vec2 }[];
  rotate: Vec2;
  center: Vec2;
  min: Vec2;
  max: Vec2;
};

export function uvGizmoLayout(bounds: UvBounds, rotateOffsetV: number): UvGizmoLayout {
  const { min, max, center } = bounds;
  return {
    min,
    max,
    center,
    corners: [
      { handle: 'sw', p: { x: min.x, y: min.y }, pivot: { x: max.x, y: max.y } },
      { handle: 'se', p: { x: max.x, y: min.y }, pivot: { x: min.x, y: max.y } },
      { handle: 'nw', p: { x: min.x, y: max.y }, pivot: { x: max.x, y: min.y } },
      { handle: 'ne', p: { x: max.x, y: max.y }, pivot: { x: min.x, y: min.y } },
    ],
    edges: [
      { handle: 'w', p: { x: min.x, y: center.y }, pivot: { x: max.x, y: center.y } },
      { handle: 'e', p: { x: max.x, y: center.y }, pivot: { x: min.x, y: center.y } },
      { handle: 's', p: { x: center.x, y: min.y }, pivot: { x: center.x, y: max.y } },
      { handle: 'n', p: { x: center.x, y: max.y }, pivot: { x: center.x, y: min.y } },
    ],
    rotate: { x: center.x, y: max.y + rotateOffsetV },
  };
}

/**
 * Screen-stable gizmo hit test.
 * `radiusU` / `radiusV` are half-sizes in UV space matching ~constant screen pixels
 * (pass pickPx/(zoom*imgW) and pickPx/(zoom*imgH)).
 * Corners and full edge strips are preferred over the body so resize stays easy.
 */
export function pickUvGizmo(
  uv: Vec2,
  bounds: UvBounds,
  radiusU: number,
  radiusV: number,
  rotateOffsetV: number,
): UvGizmoHit | null {
  const layout = uvGizmoLayout(bounds, rotateOffsetV);
  const { min, max, center } = layout;
  // Inflate degenerate/thin bounds so body remains clickable in screen space.
  const padU = Math.max(0, radiusU * 1.25 - bounds.size.x * 0.5);
  const padV = Math.max(0, radiusV * 1.25 - bounds.size.y * 0.5);
  const bodyMin = { x: min.x - padU, y: min.y - padV };
  const bodyMax = { x: max.x + padU, y: max.y + padV };

  const near = (p: Vec2, ru = radiusU, rv = radiusV) => {
    const du = (p.x - uv.x) / Math.max(1e-12, ru);
    const dv = (p.y - uv.y) / Math.max(1e-12, rv);
    return du * du + dv * dv <= 1;
  };

  // Rotate first — sits outside the box.
  if (near(layout.rotate)) return { handle: 'rotate', pivot: center };

  // Corner handles (slightly generous).
  for (const c of layout.corners) {
    if (near(c.p, radiusU * 1.15, radiusV * 1.15)) {
      return { handle: c.handle, pivot: c.pivot };
    }
  }

  const edgeBandU = radiusU;
  const edgeBandV = radiusV;
  // Skip full strips on thin axes so the body stays movable.
  const useStripN = bounds.size.y >= edgeBandV * 3;
  const useStripE = bounds.size.x >= edgeBandU * 3;

  if (
    useStripN &&
    uv.x >= min.x - edgeBandU &&
    uv.x <= max.x + edgeBandU &&
    Math.abs(uv.y - max.y) <= edgeBandV
  ) {
    return { handle: 'n', pivot: { x: center.x, y: min.y } };
  }
  if (
    useStripN &&
    uv.x >= min.x - edgeBandU &&
    uv.x <= max.x + edgeBandU &&
    Math.abs(uv.y - min.y) <= edgeBandV
  ) {
    return { handle: 's', pivot: { x: center.x, y: max.y } };
  }
  if (
    useStripE &&
    uv.y >= min.y - edgeBandV &&
    uv.y <= max.y + edgeBandV &&
    Math.abs(uv.x - max.x) <= edgeBandU
  ) {
    return { handle: 'e', pivot: { x: min.x, y: center.y } };
  }
  if (
    useStripE &&
    uv.y >= min.y - edgeBandV &&
    uv.y <= max.y + edgeBandV &&
    Math.abs(uv.x - min.x) <= edgeBandU
  ) {
    return { handle: 'w', pivot: { x: max.x, y: center.y } };
  }

  // Midpoint knobs when strips are disabled (thin islands).
  for (const e of layout.edges) {
    const stripOn =
      e.handle === 'n' || e.handle === 's' ? useStripN : useStripE;
    if (!stripOn && near(e.p)) return { handle: e.handle, pivot: e.pivot };
  }

  if (uv.x >= bodyMin.x && uv.x <= bodyMax.x && uv.y >= bodyMin.y && uv.y <= bodyMax.y) {
    return { handle: 'body', pivot: center };
  }

  return null;
}

export function isScaleHandle(handle: UvGizmoHandle): boolean {
  return handle !== 'body' && handle !== 'rotate';
}

export function uvGizmoCursor(handle: UvGizmoHandle | null): string {
  switch (handle) {
    case 'n':
    case 's':
      return 'ns-resize';
    case 'e':
    case 'w':
      return 'ew-resize';
    case 'ne':
    case 'sw':
      return 'nesw-resize';
    case 'nw':
    case 'se':
      return 'nwse-resize';
    case 'rotate':
      return 'grab';
    case 'body':
      return 'move';
    default:
      return 'crosshair';
  }
}

const SCALE_MIN = 0.05;
const SCALE_MAX = 20;

function clampScale(s: number): number {
  if (!Number.isFinite(s) || Math.abs(s) < 1e-8) return 1;
  const sign = s < 0 ? -1 : 1;
  return sign * Math.min(SCALE_MAX, Math.max(SCALE_MIN, Math.abs(s)));
}

/**
 * Compute scale factors from a gizmo drag (pointer UV vs start UV).
 * `minAxis` avoids divide-by-near-zero on razor-thin UV islands (common on tiny textures).
 */
export function scaleFactorsFromDrag(
  handle: UvGizmoHandle,
  pivot: Vec2,
  startUv: Vec2,
  currentUv: Vec2,
  uniform: boolean,
  minAxis = 1e-4,
): { scaleU: number; scaleV: number } {
  const startDu = startUv.x - pivot.x;
  const startDv = startUv.y - pivot.y;
  const curDu = currentUv.x - pivot.x;
  const curDv = currentUv.y - pivot.y;
  const startLen = Math.hypot(startDu, startDv);
  const curLen = Math.hypot(curDu, curDv);

  // Uniform scale from centre: require a usable start radius or stay at 1.
  if (uniform && (handle === 'ne' || handle === 'nw' || handle === 'se' || handle === 'sw' || handle === 'body')) {
    if (startLen < minAxis) return { scaleU: 1, scaleV: 1 };
    return { scaleU: clampScale(curLen / startLen), scaleV: clampScale(curLen / startLen) };
  }

  let scaleU = 1;
  let scaleV = 1;
  if (handle === 'e' || handle === 'w' || handle === 'ne' || handle === 'nw' || handle === 'se' || handle === 'sw') {
    scaleU = Math.abs(startDu) >= minAxis ? curDu / startDu : 1;
  }
  if (handle === 'n' || handle === 's' || handle === 'ne' || handle === 'nw' || handle === 'se' || handle === 'sw') {
    scaleV = Math.abs(startDv) >= minAxis ? curDv / startDv : 1;
  }
  if (uniform) {
    const s = Math.abs(scaleU) >= Math.abs(scaleV) ? scaleU : scaleV;
    const c = clampScale(s);
    scaleU = Math.sign(scaleU || 1) * Math.abs(c);
    scaleV = Math.sign(scaleV || 1) * Math.abs(c);
  } else {
    scaleU = clampScale(scaleU);
    scaleV = clampScale(scaleV);
  }
  return { scaleU, scaleV };
}

/** Commit a UV edit with undo (before = start of drag, after = final). */
export function commitUvEdit(
  history: CommandHistory,
  mesh: EditableMesh,
  layerId: UvLayerId,
  before: UvSnapshot,
  after: UvSnapshot,
  name = 'Move UVs',
  onChange?: () => void,
): void {
  let applied = true;
  history.execute({
    name,
    execute: () => {
      if (applied) return;
      applyUvSnapshot(mesh, after, layerId);
      applied = true;
      onChange?.();
    },
    undo: () => {
      applyUvSnapshot(mesh, before, layerId);
      applied = false;
      onChange?.();
    },
  });
}

export type UvPickHit =
  | { kind: 'corner'; cornerId: FaceCornerId; faceId: FaceId; uv: Vec2; distSq: number }
  | { kind: 'face'; faceId: FaceId; uv: Vec2 };

/**
 * Pick nearest UV corner within screen-pixel radius, else face under cursor.
 * `uv` is in UV space [typically 0–1]; `pixelRadius` is in image-pixel units.
 */
export function pickUvElement(
  mesh: EditableMesh,
  layerId: UvLayerId,
  uv: Vec2,
  pixelRadius: number,
  imgW: number,
  imgH: number,
): UvPickHit | null {
  const radU = pixelRadius / Math.max(1, imgW);
  const radV = pixelRadius / Math.max(1, imgH);
  const radSq = Math.max(radU, radV) ** 2;

  let best: Extract<UvPickHit, { kind: 'corner' }> | null = null;
  for (const face of mesh.faces.values()) {
    for (const cornerId of faceCornerIds(mesh, face.id)) {
      const cUv = getCornerUv(mesh, cornerId, layerId);
      const du = cUv.x - uv.x;
      const dv = cUv.y - uv.y;
      const distSq = du * du + dv * dv;
      if (distSq > radSq) continue;
      if (!best || distSq < best.distSq) {
        best = { kind: 'corner', cornerId, faceId: face.id, uv: cUv, distSq };
      }
    }
  }
  if (best) return best;

  // Prefer the smallest containing face so stacked/overlapping islands pick uniquely.
  let bestFace: { faceId: FaceId; uv: Vec2; area: number } | null = null;
  for (const face of mesh.faces.values()) {
    const corners = faceCornerIds(mesh, face.id);
    const poly = corners.map((id) => getCornerUv(mesh, id, layerId));
    if (!pointInPoly(uv.x, uv.y, poly)) continue;
    let area = 0;
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i]!;
      const b = poly[(i + 1) % poly.length]!;
      area += a.x * b.y - b.x * a.y;
    }
    area = Math.abs(area) * 0.5;
    if (!bestFace || area < bestFace.area) {
      bestFace = { faceId: face.id, uv, area };
    }
  }
  return bestFace ? { kind: 'face', faceId: bestFace.faceId, uv: bestFace.uv } : null;
}

function pointInPoly(x: number, y: number, poly: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i]!.x;
    const yi = poly[i]!.y;
    const xj = poly[j]!.x;
    const yj = poly[j]!.y;
    const intersect = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi + 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

export function flipUvs(
  mesh: EditableMesh,
  snapshot: UvSnapshot,
  layerId: UvLayerId,
  axis: 'u' | 'v',
): void {
  const bounds = boundsOfUvs(snapshot);
  if (!bounds) return;
  scaleUvsFromSnapshot(
    mesh,
    snapshot,
    layerId,
    bounds.center,
    axis === 'u' ? -1 : 1,
    axis === 'v' ? -1 : 1,
  );
}

/** Average selected corners that share a UV into one welded position. */
export function weldSelectedUvs(
  mesh: EditableMesh,
  cornerIds: Iterable<FaceCornerId>,
  layerId: UvLayerId,
  epsilon = 1e-5,
): UvSnapshot {
  const ids = [...cornerIds];
  const before = snapshotUvs(mesh, ids, layerId);
  const remaining = new Set(ids);
  while (remaining.size) {
    const seed = remaining.values().next().value as FaceCornerId;
    const group = expandWeldedUvCorners(mesh, [seed], layerId, epsilon).filter((id) =>
      remaining.has(id),
    );
    for (const id of group) remaining.delete(id);
    if (group.length < 2) continue;
    let ax = 0;
    let ay = 0;
    for (const id of group) {
      const uv = getCornerUv(mesh, id, layerId);
      ax += uv.x;
      ay += uv.y;
    }
    const avg = { x: ax / group.length, y: ay / group.length };
    for (const id of group) {
      mesh.faceCorners.get(id)?.uvs.set(layerId, { ...avg });
    }
  }
  mesh.geometryVersion += 1;
  mesh.dirty.uvs = true;
  return before;
}

/**
 * Split welded UV verts: corners that shared a position get tiny unique offsets
 * so they can be edited independently.
 */
export function splitSelectedUvs(
  mesh: EditableMesh,
  cornerIds: Iterable<FaceCornerId>,
  layerId: UvLayerId,
  epsilon = 1e-5,
): UvSnapshot {
  const ids = [...cornerIds];
  const before = snapshotUvs(mesh, ids, layerId);
  const remaining = new Set(ids);
  const nudge = 1e-4;
  while (remaining.size) {
    const seed = remaining.values().next().value as FaceCornerId;
    const group = expandWeldedUvCorners(mesh, [seed], layerId, epsilon).filter((id) =>
      remaining.has(id),
    );
    for (const id of group) remaining.delete(id);
    if (group.length < 2) continue;
    const base = getCornerUv(mesh, group[0]!, layerId);
    group.forEach((id, i) => {
      if (i === 0) return;
      mesh.faceCorners.get(id)?.uvs.set(layerId, {
        x: base.x + nudge * i,
        y: base.y + nudge * ((i * 3) % 5),
      });
    });
  }
  mesh.geometryVersion += 1;
  mesh.dirty.uvs = true;
  return before;
}

/** Align selected UV points to their dominant U or V axis. */
export function straightenSelectedUvs(
  mesh: EditableMesh,
  cornerIds: Iterable<FaceCornerId>,
  layerId: UvLayerId,
  axis: 'auto' | 'u' | 'v' = 'auto',
): UvSnapshot {
  const ids = [...new Set(cornerIds)];
  const before = snapshotUvs(mesh, ids, layerId);
  const bounds = boundsOfUvs(before);
  if (!bounds || ids.length < 2) return before;
  const resolved = axis === 'auto' ? (bounds.size.x >= bounds.size.y ? 'u' : 'v') : axis;
  const average = ids.reduce((sum, id) => {
    const uv = getCornerUv(mesh, id, layerId);
    return sum + (resolved === 'u' ? uv.y : uv.x) / ids.length;
  }, 0);
  for (const id of ids) {
    const corner = mesh.faceCorners.get(id);
    if (!corner) continue;
    const uv = getCornerUv(mesh, id, layerId);
    corner.uvs.set(layerId, resolved === 'u' ? { x: uv.x, y: average } : { x: average, y: uv.y });
  }
  mesh.geometryVersion += 1;
  mesh.dirty.uvs = true;
  return before;
}

/** Rotate the longest selected UV edge to the horizontal axis. */
export function rotateSelectedUvsToEdge(
  mesh: EditableMesh,
  cornerIds: Iterable<FaceCornerId>,
  layerId: UvLayerId,
): UvSnapshot {
  const ids = [...new Set(cornerIds)];
  const selected = new Set(ids);
  const before = snapshotUvs(mesh, ids, layerId);
  const bounds = boundsOfUvs(before);
  if (!bounds || ids.length < 2) return before;
  let best: { a: Vec2; b: Vec2; lengthSq: number } | null = null;
  for (const face of mesh.faces.values()) {
    const corners = faceCornerIds(mesh, face.id);
    for (let i = 0; i < corners.length; i++) {
      const aId = corners[i]!;
      const bId = corners[(i + 1) % corners.length]!;
      if (!selected.has(aId) || !selected.has(bId)) continue;
      const a = getCornerUv(mesh, aId, layerId);
      const b = getCornerUv(mesh, bId, layerId);
      const lengthSq = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
      if (!best || lengthSq > best.lengthSq) best = { a, b, lengthSq };
    }
  }
  if (!best || best.lengthSq < 1e-16) return before;
  rotateUvsFromSnapshot(
    mesh,
    before,
    layerId,
    bounds.center,
    -Math.atan2(best.b.y - best.a.y, best.b.x - best.a.x),
  );
  return before;
}

/** Laplacian relax for selected UV points; repeated passes progressively remove distortion. */
export function relaxSelectedUvs(
  mesh: EditableMesh,
  cornerIds: Iterable<FaceCornerId>,
  layerId: UvLayerId,
  iterations = 8,
  strength = 0.5,
): UvSnapshot {
  const ids = [...new Set(cornerIds)];
  const selected = new Set(ids);
  const before = snapshotUvs(mesh, ids, layerId);
  const neighbours = new Map<FaceCornerId, Set<FaceCornerId>>();
  for (const face of mesh.faces.values()) {
    const corners = faceCornerIds(mesh, face.id);
    for (let i = 0; i < corners.length; i++) {
      const id = corners[i]!;
      if (!selected.has(id)) continue;
      const set = neighbours.get(id) ?? new Set<FaceCornerId>();
      const prev = corners[(i - 1 + corners.length) % corners.length]!;
      const next = corners[(i + 1) % corners.length]!;
      if (selected.has(prev)) set.add(prev);
      if (selected.has(next)) set.add(next);
      neighbours.set(id, set);
    }
  }
  const blend = Math.max(0, Math.min(1, strength));
  for (let pass = 0; pass < Math.max(1, Math.min(100, Math.round(iterations))); pass++) {
    const next = new Map<FaceCornerId, Vec2>();
    for (const id of ids) {
      const adjacent = neighbours.get(id);
      if (!adjacent?.size) continue;
      const uv = getCornerUv(mesh, id, layerId);
      let x = 0;
      let y = 0;
      for (const other of adjacent) {
        const p = getCornerUv(mesh, other, layerId);
        x += p.x / adjacent.size;
        y += p.y / adjacent.size;
      }
      next.set(id, { x: uv.x + (x - uv.x) * blend, y: uv.y + (y - uv.y) * blend });
    }
    for (const [id, uv] of next) mesh.faceCorners.get(id)?.uvs.set(layerId, uv);
  }
  mesh.geometryVersion += 1;
  mesh.dirty.uvs = true;
  return before;
}

/** Corners whose UV lies inside an axis-aligned UV rect (inclusive). */
export function cornersInUvRect(
  mesh: EditableMesh,
  layerId: UvLayerId,
  min: Vec2,
  max: Vec2,
): FaceCornerId[] {
  const rect = {
    minX: Math.min(min.x, max.x),
    minY: Math.min(min.y, max.y),
    maxX: Math.max(min.x, max.x),
    maxY: Math.max(min.y, max.y),
  };
  const out: FaceCornerId[] = [];
  for (const [id, corner] of mesh.faceCorners) {
    const uv = corner.uvs.get(layerId) ?? { x: 0, y: 0 };
    if (pointInRect(uv.x, uv.y, rect)) out.push(id);
  }
  return out;
}

/**
 * Faces intersecting a UV marquee.
 * `window` = all corners inside; `crossing` = any corner inside or UV edge hits the rect.
 */
export function facesInUvRect(
  mesh: EditableMesh,
  layerId: UvLayerId,
  min: Vec2,
  max: Vec2,
  mode: MarqueeMode = 'crossing',
): FaceId[] {
  const rect = {
    minX: Math.min(min.x, max.x),
    minY: Math.min(min.y, max.y),
    maxX: Math.max(min.x, max.x),
    maxY: Math.max(min.y, max.y),
  };
  const out: FaceId[] = [];
  for (const face of mesh.faces.values()) {
    const corners = faceCornerIds(mesh, face.id);
    if (!corners.length) continue;
    const uvs = corners.map((id) => getCornerUv(mesh, id, layerId));
    if (mode === 'window') {
      if (pointsSatisfyMarquee(uvs, rect, 'window')) out.push(face.id);
      continue;
    }
    if (pointsSatisfyMarquee(uvs, rect, 'crossing')) {
      out.push(face.id);
      continue;
    }
    for (let i = 0; i < uvs.length; i++) {
      const a = uvs[i]!;
      const b = uvs[(i + 1) % uvs.length]!;
      if (segmentHitsRect(a.x, a.y, b.x, b.y, rect)) {
        out.push(face.id);
        break;
      }
    }
  }
  return out;
}

/** Fit selection into the unit square (0–1), preserving aspect. */
export function normalizeUvsToUnit(
  mesh: EditableMesh,
  snapshot: UvSnapshot,
  layerId: UvLayerId,
  padding = 0.01,
): void {
  const bounds = boundsOfUvs(snapshot);
  if (!bounds) return;
  const span = Math.max(bounds.size.x, bounds.size.y, 1e-8);
  const target = 1 - padding * 2;
  const scale = target / span;
  for (const [id, uv] of snapshot) {
    const corner = mesh.faceCorners.get(id);
    if (!corner) continue;
    corner.uvs.set(layerId, {
      x: padding + (uv.x - bounds.min.x) * scale,
      y: padding + (uv.y - bounds.min.y) * scale,
    });
  }
  mesh.geometryVersion += 1;
  mesh.dirty.uvs = true;
}

/**
 * Resize selection to a target UV size (0–1 units), anchored at centre.
 * Zero-span axes are left unchanged (caller should avoid 0×0 targets).
 */
export function resizeUvsToSize(
  mesh: EditableMesh,
  snapshot: UvSnapshot,
  layerId: UvLayerId,
  targetSizeU: number,
  targetSizeV: number,
): void {
  const bounds = boundsOfUvs(snapshot);
  if (!bounds) return;
  const tu = Math.max(1e-8, targetSizeU);
  const tv = Math.max(1e-8, targetSizeV);
  const scaleU = bounds.size.x >= 1e-12 ? tu / bounds.size.x : 1;
  const scaleV = bounds.size.y >= 1e-12 ? tv / bounds.size.y : 1;
  if (scaleU === 1 && scaleV === 1) return;
  scaleUvsFromSnapshot(mesh, snapshot, layerId, bounds.center, scaleU, scaleV);
}

export type UvCameraFrame = { panX: number; panY: number; zoom: number };

/** Camera that frames UV bounds inside a canvas (CSS px), with padding. */
export function cameraToFrameUvBounds(
  bounds: UvBounds,
  imgW: number,
  imgH: number,
  canvasW: number,
  canvasH: number,
  paddingPx = 32,
): UvCameraFrame {
  const left = bounds.min.x * imgW;
  const right = bounds.max.x * imgW;
  const top = (1 - bounds.max.y) * imgH;
  const bottom = (1 - bounds.min.y) * imgH;
  const bw = Math.max(1, right - left);
  const bh = Math.max(1, bottom - top);
  const zoom = Math.max(
    0.0625,
    Math.min(32, Math.min((canvasW - paddingPx * 2) / bw, (canvasH - paddingPx * 2) / bh)),
  );
  const cx = (left + right) / 2;
  const cy = (top + bottom) / 2;
  return {
    zoom,
    panX: canvasW / 2 - cx * zoom,
    panY: canvasH / 2 - cy * zoom,
  };
}
