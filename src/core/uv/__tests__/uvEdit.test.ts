import { describe, expect, it } from 'vitest';
import { buildBox } from '@/core/mesh/builders/BoxBuilder';
import { faceCornerIds } from '@/core/mesh/EditableMesh';
import { CommandHistory } from '@/core/history/CommandHistory';
import {
  boundsOfUvs,
  commitUvEdit,
  cornersForFaces,
  cornersInUvRect,
  expandWeldedUvCorners,
  flipUvs,
  pickUvElement,
  pickUvGizmo,
  rotateUvsFromSnapshot,
  resizeUvsToSize,
  relaxSelectedUvs,
  rotateSelectedUvsToEdge,
  scaleFactorsFromDrag,
  scaleUvsFromSnapshot,
  snapshotUvs,
  straightenSelectedUvs,
  translateUvsFromSnapshot,
} from '@/core/uv/UvEdit';
import {
  packSelectedUvIslands,
  unwrapUvAuto,
  unwrapUvBox,
  unwrapUvCylinder,
  unwrapUvFromView,
  unwrapUvSphere,
  viewAxesFromCamera,
} from '@/core/uv/UvOperations';
import { v3 } from '@/core/math/Vec3';

describe('UvEdit', () => {
  it('translates selected face corners and undoes', () => {
    const mesh = buildBox({ width: 2, height: 2, depth: 2 });
    const layerId = mesh.defaultUvLayerId!;
    const faceId = [...mesh.faces.keys()][0]!;
    const corners = cornersForFaces(mesh, [faceId]);
    const before = snapshotUvs(mesh, corners, layerId);
    translateUvsFromSnapshot(mesh, before, layerId, { x: 0.25, y: -0.1 });
    const after = snapshotUvs(mesh, corners, layerId);
    expect(after.get(corners[0]!)!.x).toBeCloseTo(before.get(corners[0]!)!.x + 0.25);
    const history = new CommandHistory();
    commitUvEdit(history, mesh, layerId, before, after);
    expect(history.canUndo()).toBe(true);
    history.undo();
    expect(mesh.faceCorners.get(corners[0]!)!.uvs.get(layerId)!.x).toBeCloseTo(
      before.get(corners[0]!)!.x,
    );
  });

  it('expands welded UV points that share a position', () => {
    const mesh = buildBox({ width: 1, height: 1, depth: 1 });
    const layerId = mesh.defaultUvLayerId!;
    const first = faceCornerIds(mesh, [...mesh.faces.keys()][0]!)[0]!;
    const uv = mesh.faceCorners.get(first)!.uvs.get(layerId)!;
    // Force another corner onto the same UV
    const otherFace = [...mesh.faces.keys()][1]!;
    const other = faceCornerIds(mesh, otherFace)[0]!;
    mesh.faceCorners.get(other)!.uvs.set(layerId, { x: uv.x, y: uv.y });
    const welded = expandWeldedUvCorners(mesh, [first], layerId);
    expect(welded).toContain(first);
    expect(welded).toContain(other);
    expect(welded.length).toBeGreaterThanOrEqual(2);
  });

  it('prefers corner picks over face fills within radius', () => {
    const mesh = buildBox({ width: 1, height: 1, depth: 1 });
    const layerId = mesh.defaultUvLayerId!;
    const faceId = [...mesh.faces.keys()][0]!;
    const cornerId = faceCornerIds(mesh, faceId)[0]!;
    const uv = mesh.faceCorners.get(cornerId)!.uvs.get(layerId)!;
    const hit = pickUvElement(mesh, layerId, uv, 8, 64, 64);
    expect(hit?.kind).toBe('corner');
    if (hit?.kind === 'corner') expect(hit.cornerId).toBe(cornerId);
  });

  it('scales a face around its UV centre', () => {
    const mesh = buildBox({ width: 1, height: 1, depth: 1 });
    const layerId = mesh.defaultUvLayerId!;
    const faceId = [...mesh.faces.keys()][0]!;
    const corners = cornersForFaces(mesh, [faceId]);
    const before = snapshotUvs(mesh, corners, layerId);
    const bounds = boundsOfUvs(before)!;
    scaleUvsFromSnapshot(mesh, before, layerId, bounds.center, 2, 2);
    const after = snapshotUvs(mesh, corners, layerId);
    const next = boundsOfUvs(after)!;
    expect(next.size.x).toBeCloseTo(bounds.size.x * 2, 5);
    expect(next.size.y).toBeCloseTo(bounds.size.y * 2, 5);
    expect(next.center.x).toBeCloseTo(bounds.center.x, 5);
    expect(next.center.y).toBeCloseTo(bounds.center.y, 5);
  });

  it('resizes a face to a target UV size', () => {
    const mesh = buildBox({ width: 1, height: 1, depth: 1 });
    const layerId = mesh.defaultUvLayerId!;
    const faceId = [...mesh.faces.keys()][0]!;
    const corners = cornersForFaces(mesh, [faceId]);
    const before = snapshotUvs(mesh, corners, layerId);
    const bounds = boundsOfUvs(before)!;
    resizeUvsToSize(mesh, before, layerId, 0.25, 0.5);
    const next = boundsOfUvs(snapshotUvs(mesh, corners, layerId))!;
    expect(next.size.x).toBeCloseTo(0.25, 5);
    expect(next.size.y).toBeCloseTo(0.5, 5);
    expect(next.center.x).toBeCloseTo(bounds.center.x, 5);
    expect(next.center.y).toBeCloseTo(bounds.center.y, 5);
  });

  it('rotates a face 90° around its UV centre', () => {
    const mesh = buildBox({ width: 1, height: 1, depth: 1 });
    const layerId = mesh.defaultUvLayerId!;
    const faceId = [...mesh.faces.keys()][0]!;
    const corners = cornersForFaces(mesh, [faceId]);
    const before = snapshotUvs(mesh, corners, layerId);
    const bounds = boundsOfUvs(before)!;
    const first = corners[0]!;
    const start = before.get(first)!;
    rotateUvsFromSnapshot(mesh, before, layerId, bounds.center, Math.PI / 2);
    const end = mesh.faceCorners.get(first)!.uvs.get(layerId)!;
    const dx = start.x - bounds.center.x;
    const dy = start.y - bounds.center.y;
    expect(end.x).toBeCloseTo(bounds.center.x - dy, 5);
    expect(end.y).toBeCloseTo(bounds.center.y + dx, 5);
  });

  it('flips U around selection centre', () => {
    const mesh = buildBox({ width: 1, height: 1, depth: 1 });
    const layerId = mesh.defaultUvLayerId!;
    const faceId = [...mesh.faces.keys()][0]!;
    const corners = cornersForFaces(mesh, [faceId]);
    const before = snapshotUvs(mesh, corners, layerId);
    const bounds = boundsOfUvs(before)!;
    const first = corners[0]!;
    const start = before.get(first)!;
    flipUvs(mesh, before, layerId, 'u');
    const end = mesh.faceCorners.get(first)!.uvs.get(layerId)!;
    expect(end.x).toBeCloseTo(bounds.center.x - (start.x - bounds.center.x), 5);
    expect(end.y).toBeCloseTo(start.y, 5);
  });

  it('marquee collects corners inside a UV rect', () => {
    const mesh = buildBox({ width: 1, height: 1, depth: 1 });
    const layerId = mesh.defaultUvLayerId!;
    const all = cornersInUvRect(mesh, layerId, { x: -1, y: -1 }, { x: 2, y: 2 });
    expect(all.length).toBe(mesh.faceCorners.size);
    const none = cornersInUvRect(mesh, layerId, { x: 10, y: 10 }, { x: 11, y: 11 });
    expect(none.length).toBe(0);
  });

  it('clamps explosive scale on thin UV islands', () => {
    const { scaleU, scaleV } = scaleFactorsFromDrag(
      'e',
      { x: 0, y: 0.5 },
      { x: 0.001, y: 0.5 },
      { x: 10, y: 0.5 },
      false,
      0.01,
    );
    // startDu too small → no scale, or clamped if somehow computed
    expect(Math.abs(scaleU)).toBeLessThanOrEqual(20);
    expect(scaleV).toBe(1);
  });

  it('picks gizmo body away from handles on thin bounds', () => {
    const bounds = {
      min: { x: 0, y: 0 },
      max: { x: 0.02, y: 1 },
      center: { x: 0.01, y: 0.5 },
      size: { x: 0.02, y: 1 },
    };
    // Mid-height, slightly inside — not on N/S/E/W handle centres
    const hit = pickUvGizmo({ x: 0.01, y: 0.35 }, bounds, 0.02, 0.02, 0.05);
    expect(hit?.handle).toBe('body');
  });

  it('picks edge strip along a side for easy resize', () => {
    const bounds = {
      min: { x: 0, y: 0 },
      max: { x: 1, y: 1 },
      center: { x: 0.5, y: 0.5 },
      size: { x: 1, y: 1 },
    };
    const hit = pickUvGizmo({ x: 0.72, y: 0.99 }, bounds, 0.04, 0.04, 0.08);
    expect(hit?.handle).toBe('n');
  });

  it('picks corner handles before the body', () => {
    const bounds = {
      min: { x: 0, y: 0 },
      max: { x: 1, y: 1 },
      center: { x: 0.5, y: 0.5 },
      size: { x: 1, y: 1 },
    };
    const hit = pickUvGizmo({ x: 0.97, y: 0.97 }, bounds, 0.05, 0.05, 0.08);
    expect(hit?.handle).toBe('ne');
  });

  it('picks the rotate handle above the box', () => {
    const bounds = {
      min: { x: 0, y: 0 },
      max: { x: 1, y: 1 },
      center: { x: 0.5, y: 0.5 },
      size: { x: 1, y: 1 },
    };
    const hit = pickUvGizmo({ x: 0.5, y: 1.08 }, bounds, 0.05, 0.05, 0.08);
    expect(hit?.handle).toBe('rotate');
  });

  it('packs only selected faces without clearing other UVs size', () => {
    const mesh = buildBox({ width: 1, height: 1, depth: 1 });
    const layerId = mesh.defaultUvLayerId!;
    const faceIds = [...mesh.faces.keys()].slice(0, 2);
    const islands = packSelectedUvIslands(mesh, faceIds, 0.02, layerId);
    expect(islands.length).toBeGreaterThan(0);
    for (const corner of mesh.faceCorners.values()) {
      const uv = corner.uvs.get(layerId)!;
      expect(Number.isFinite(uv.x)).toBe(true);
      expect(Number.isFinite(uv.y)).toBe(true);
    }
  });

  it('auto-unwraps each face into a packed chart', () => {
    const mesh = buildBox({ width: 2, height: 1, depth: 1 });
    const layerId = mesh.defaultUvLayerId!;
    const faceIds = [...mesh.faces.keys()];
    unwrapUvAuto(mesh, faceIds, layerId, 0.02);
    for (const corner of mesh.faceCorners.values()) {
      const uv = corner.uvs.get(layerId)!;
      expect(uv.x).toBeGreaterThanOrEqual(-0.001);
      expect(uv.y).toBeGreaterThanOrEqual(-0.001);
      expect(uv.x).toBeLessThanOrEqual(1.001);
      expect(uv.y).toBeLessThanOrEqual(1.001);
    }
    // Faces should not all share the same UV origin after packing.
    const origins = faceIds.map((id) => {
      const c = faceCornerIds(mesh, id)[0]!;
      return mesh.faceCorners.get(c)!.uvs.get(layerId)!;
    });
    const unique = new Set(origins.map((o) => `${o.x.toFixed(3)},${o.y.toFixed(3)}`));
    expect(unique.size).toBeGreaterThan(1);
  });

  it('box-unwraps a cube into a net without NaNs', () => {
    const mesh = buildBox({ width: 1, height: 2, depth: 3 });
    const layerId = mesh.defaultUvLayerId!;
    unwrapUvBox(mesh, [...mesh.faces.keys()], layerId);
    for (const corner of mesh.faceCorners.values()) {
      const uv = corner.uvs.get(layerId)!;
      expect(Number.isFinite(uv.x)).toBe(true);
      expect(Number.isFinite(uv.y)).toBe(true);
      expect(uv.x).toBeGreaterThanOrEqual(0);
      expect(uv.y).toBeGreaterThanOrEqual(0);
      expect(uv.x).toBeLessThanOrEqual(1);
      expect(uv.y).toBeLessThanOrEqual(1);
    }
  });

  it('buildBox assigns a unique UV island per 3D face', () => {
    const mesh = buildBox({ width: 1, height: 1, depth: 1 });
    const layerId = mesh.defaultUvLayerId!;
    const centroids = [...mesh.faces.keys()].map((faceId) => {
      const corners = faceCornerIds(mesh, faceId);
      let x = 0;
      let y = 0;
      for (const id of corners) {
        const uv = mesh.faceCorners.get(id)!.uvs.get(layerId)!;
        x += uv.x;
        y += uv.y;
      }
      return { x: x / corners.length, y: y / corners.length };
    });
    const keys = new Set(centroids.map((c) => `${c.x.toFixed(3)},${c.y.toFixed(3)}`));
    expect(keys.size).toBe(mesh.faces.size);
    // UV pick at a face centroid resolves to that face (not a stacked neighbour).
    const faceIds = [...mesh.faces.keys()];
    const hit = pickUvElement(mesh, layerId, centroids[0]!, 2, 64, 64);
    expect(hit?.kind).toBe('face');
    if (hit?.kind === 'face') expect(hit.faceId).toBe(faceIds[0]!);
  });

  it('cylinder and sphere unwraps cover 0–1', () => {
    const mesh = buildBox({ width: 1, height: 1, depth: 1 });
    const layerId = mesh.defaultUvLayerId!;
    const faces = [...mesh.faces.keys()];
    unwrapUvCylinder(mesh, faces, layerId);
    for (const corner of mesh.faceCorners.values()) {
      const uv = corner.uvs.get(layerId)!;
      expect(uv.x).toBeGreaterThanOrEqual(0);
      expect(uv.x).toBeLessThanOrEqual(1);
    }
    unwrapUvSphere(mesh, faces, layerId);
    for (const corner of mesh.faceCorners.values()) {
      const uv = corner.uvs.get(layerId)!;
      expect(Number.isFinite(uv.x)).toBe(true);
      expect(Number.isFinite(uv.y)).toBe(true);
    }
  });

  it('projects from view using camera axes', () => {
    const mesh = buildBox({ width: 1, height: 1, depth: 1 });
    const layerId = mesh.defaultUvLayerId!;
    const view = viewAxesFromCamera(v3(0, 0, 4), v3(0, 0, 0), v3(0, 1, 0));
    unwrapUvFromView(mesh, [...mesh.faces.keys()], view, layerId);
    const snap = snapshotUvs(mesh, cornersForFaces(mesh, mesh.faces.keys()), layerId);
    const bounds = boundsOfUvs(snap)!;
    expect(bounds.size.x).toBeGreaterThan(0.1);
    expect(bounds.size.y).toBeGreaterThan(0.1);
  });

  it('straightens, relaxes, and aligns selected islands to an edge', () => {
    const mesh = buildBox({ width: 1, height: 1, depth: 1 });
    const layerId = mesh.defaultUvLayerId!;
    const corners = faceCornerIds(mesh, [...mesh.faces.keys()][0]!);
    const first = mesh.faceCorners.get(corners[0]!)!;
    const uv = first.uvs.get(layerId)!;
    first.uvs.set(layerId, { x: uv.x, y: uv.y + 0.17 });

    straightenSelectedUvs(mesh, corners, layerId, 'u');
    const ys = corners.map((id) => mesh.faceCorners.get(id)!.uvs.get(layerId)!.y);
    expect(Math.max(...ys) - Math.min(...ys)).toBeLessThan(1e-8);

    rotateSelectedUvsToEdge(mesh, corners, layerId);
    relaxSelectedUvs(mesh, corners, layerId, 3, 0.25);
    for (const id of corners) {
      const point = mesh.faceCorners.get(id)!.uvs.get(layerId)!;
      expect(Number.isFinite(point.x) && Number.isFinite(point.y)).toBe(true);
    }
  });
});
