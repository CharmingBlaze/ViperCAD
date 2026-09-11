import {
  faceCornerIds,
  faceHalfEdgeIds,
  faceVertexIds,
  getEdgeVertices,
} from '@/core/mesh/EditableMesh';
import { computeFaceNormal } from '@/core/mesh/Normals';
import type { EditableMesh, EdgeId, FaceId, UvLayerId } from '@/core/mesh/types';
import { MeshBuilder } from '@/core/mesh/MeshBuilder';
import {
  addVec3,
  crossVec3,
  dotVec3,
  lengthSqVec3,
  normalizeVec3,
  scaleVec3,
  subVec3,
  v3,
  type Vec3,
} from '@/core/math/Vec3';

export type AtlasUvAlign = 'min' | 'center' | 'max';

export type AtlasTilePlacement = {
  imageWidth: number;
  imageHeight: number;
  x: number;
  y: number;
  width: number;
  height: number;
  padding?: number;
  quarterTurns?: 0 | 1 | 2 | 3;
  flipU?: boolean;
  flipV?: boolean;
  /** Stamp this tile repeatU times across each face (UV wrap, no subdivision). */
  repeatU?: number;
  /** Stamp this tile repeatV times across each face (UV wrap, no subdivision). */
  repeatV?: number;
  /** Stretch the tile across the face U axis. Off keeps world aspect. */
  stretchU?: boolean;
  /** Stretch the tile across the face V axis. Off keeps world aspect. */
  stretchV?: boolean;
  /** Where an unstretched tile sits on the face. */
  alignU?: AtlasUvAlign;
  alignV?: AtlasUvAlign;
  /** World size of one unstretched tile. */
  worldTileWidth?: number;
  worldTileHeight?: number;
  /** Face edge that maps to the tile bottom (V = 0). */
  downEdgeId?: EdgeId;
};

/** Map each selected face into one sprite-atlas tile using pixel-exact UV bounds. */
export function applyAtlasTileToFaces(
  mesh: EditableMesh,
  faceIds: FaceId[],
  layerId: UvLayerId,
  placement: AtlasTilePlacement,
): FaceId[] {
  if (!mesh.uvLayers.has(layerId)) throw new Error('Invalid UV layer');
  const repeatU = Math.max(1, Math.min(64, Math.round(placement.repeatU ?? 1)));
  const repeatV = Math.max(1, Math.min(64, Math.round(placement.repeatV ?? 1)));
  const imageWidth = Math.max(1, placement.imageWidth);
  const imageHeight = Math.max(1, placement.imageHeight);
  const x = Math.max(0, Math.min(placement.x, imageWidth - 1));
  const y = Math.max(0, Math.min(placement.y, imageHeight - 1));
  const width = Math.max(1, Math.min(placement.width, imageWidth - x));
  const height = Math.max(1, Math.min(placement.height, imageHeight - y));
  const maxPadding = Math.max(0, Math.min(width, height) / 2 - 0.001);
  const padding = Math.min(maxPadding, Math.max(0, placement.padding ?? 0));
  const minU = (x + padding) / imageWidth;
  const maxU = (x + width - padding) / imageWidth;
  const minV = 1 - (y + height - padding) / imageHeight;
  const maxV = 1 - (y + padding) / imageHeight;
  const spanU = maxU - minU;
  const spanV = maxV - minV;
  const atlasTile = { minU, minV, maxU, maxV };

  const applied: FaceId[] = [];
  for (const faceId of faceIds) {
    if (!mesh.faces.has(faceId)) continue;
    const cornerIds = faceCornerIds(mesh, faceId);
    if (cornerIds.length < 3) continue;
    const stretchU = placement.stretchU !== false;
    const stretchV = placement.stretchV !== false;
    const useWorld = !stretchU || !stretchV || !!placement.downEdgeId;
    const coords = useWorld
      ? worldFaceCoords(mesh, faceId, placement)
      : bboxFaceCoords(
        cornerIds.map((id) => mesh.faceCorners.get(id)!.uvs.get(layerId) ?? { x: 0, y: 0 }),
        cornerIds.length,
      );

    for (let index = 0; index < cornerIds.length; index++) {
      let u = coords[index]!.x;
      let v = coords[index]!.y;
      if (placement.flipU) u = 1 - u;
      if (placement.flipV) v = 1 - v;
      for (let turn = 0; turn < (placement.quarterTurns ?? 0); turn++) {
        [u, v] = [1 - v, u];
      }
      const corner = mesh.faceCorners.get(cornerIds[index]!)!;
      corner.uvs.set(layerId, {
        x: minU + u * repeatU * spanU,
        y: minV + v * repeatV * spanV,
      });
      // Shader wraps these expanded UVs back into the tile rect (atlas-safe repeat).
      corner.atlasTile = repeatU > 1 || repeatV > 1 || !stretchU || !stretchV ? atlasTile : null;
    }
    applied.push(faceId);
  }
  mesh.geometryVersion += 1;
  mesh.dirty.uvs = true;
  return applied;
}

function bboxFaceCoords(
  current: { x: number; y: number }[],
  count: number,
): { x: number; y: number }[] {
  const minCurrentU = Math.min(...current.map((uv) => uv.x));
  const maxCurrentU = Math.max(...current.map((uv) => uv.x));
  const minCurrentV = Math.min(...current.map((uv) => uv.y));
  const maxCurrentV = Math.max(...current.map((uv) => uv.y));
  const currentSpanU = maxCurrentU - minCurrentU;
  const currentSpanV = maxCurrentV - minCurrentV;
  const fallback = fallbackFaceUvs(count);
  return current.map((uv, index) => ({
    x: currentSpanU > 1e-9 ? (uv.x - minCurrentU) / currentSpanU : fallback[index]!.x,
    y: currentSpanV > 1e-9 ? (uv.y - minCurrentV) / currentSpanV : fallback[index]!.y,
  }));
}

function worldFaceCoords(
  mesh: EditableMesh,
  faceId: FaceId,
  placement: AtlasTilePlacement,
): { x: number; y: number }[] {
  const projected = projectFaceCorners(mesh, faceId, placement.downEdgeId);
  if (!projected.length) return fallbackFaceUvs(3);
  const minU = Math.min(...projected.map((p) => p.u));
  const maxU = Math.max(...projected.map((p) => p.u));
  const minV = Math.min(...projected.map((p) => p.v));
  const maxV = Math.max(...projected.map((p) => p.v));
  const spanU = maxU - minU;
  const spanV = maxV - minV;
  const stretchU = placement.stretchU !== false;
  const stretchV = placement.stretchV !== false;
  const tileW = Math.max(1e-6, placement.worldTileWidth ?? spanU);
  const tileH = Math.max(1e-6, placement.worldTileHeight ?? spanV);
  return projected.map((p) => ({
    x: stretchU
      ? (spanU > 1e-9 ? (p.u - minU) / spanU : 0)
      : alignCoord(p.u, minU, spanU, tileW, placement.alignU ?? 'center'),
    y: stretchV
      ? (spanV > 1e-9 ? (p.v - minV) / spanV : 0)
      : alignCoord(p.v, minV, spanV, tileH, placement.alignV ?? 'center'),
  }));
}

function alignCoord(
  value: number,
  min: number,
  span: number,
  tile: number,
  align: AtlasUvAlign,
): number {
  const used = span / tile;
  const leftover = used - 1;
  const offset = align === 'min' ? 0 : align === 'max' ? leftover : leftover / 2;
  return (value - min) / tile - offset;
}

function projectFaceCorners(
  mesh: EditableMesh,
  faceId: FaceId,
  downEdgeId?: EdgeId,
): { u: number; v: number }[] {
  const vertIds = faceVertexIds(mesh, faceId);
  if (vertIds.length < 3) return [];
  const positions = vertIds.map((id) => mesh.vertices.get(id)!.position);
  let downIndex = 0;
  if (downEdgeId) {
    const pair = getEdgeVertices(mesh, downEdgeId);
    if (pair) {
      for (let i = 0; i < vertIds.length; i++) {
        const a = vertIds[i]!;
        const b = vertIds[(i + 1) % vertIds.length]!;
        if ((a === pair[0] && b === pair[1]) || (a === pair[1] && b === pair[0])) {
          downIndex = i;
          break;
        }
      }
    }
  }
  const origin = positions[downIndex]!;
  const along = normalizeVec3(subVec3(positions[(downIndex + 1) % positions.length]!, origin));
  const normal = computeFaceNormal(mesh, faceId);
  let across = normalizeVec3(crossVec3(normal, along));
  if (lengthSqVec3(across) < 1e-10) {
    across = normalizeVec3(crossVec3(along, { x: 0, y: 1, z: 0 }));
  }
  const projected = positions.map((point) => {
    const delta = subVec3(point, origin);
    return { u: dotVec3(delta, along), v: dotVec3(delta, across) };
  });
  const negative = projected.filter((p) => p.v < -1e-6).length;
  const positive = projected.filter((p) => p.v > 1e-6).length;
  if (negative > positive) {
    for (const point of projected) point.v = -point.v;
  }
  return projected;
}

/** Edge of the face whose midpoint is lowest in Y — used as tile-down when hinting. */
export function autoDownEdgeId(mesh: EditableMesh, faceId: FaceId): EdgeId | null {
  let best: EdgeId | null = null;
  let bestY = Number.POSITIVE_INFINITY;
  for (const heId of faceHalfEdgeIds(mesh, faceId)) {
    const he = mesh.halfEdges.get(heId);
    if (!he) continue;
    const pair = getEdgeVertices(mesh, he.edgeId);
    if (!pair) continue;
    const a = mesh.vertices.get(pair[0])?.position;
    const b = mesh.vertices.get(pair[1])?.position;
    if (!a || !b) continue;
    const midY = (a.y + b.y) * 0.5;
    if (midY < bestY) {
      bestY = midY;
      best = he.edgeId;
    }
  }
  return best;
}

/** Nearest face edge to a mesh-local point, for “this edge is down” hinting. */
export function closestFaceEdgeId(
  mesh: EditableMesh,
  faceId: FaceId,
  localPoint: Vec3,
): EdgeId | null {
  let best: EdgeId | null = null;
  let bestDist = Number.POSITIVE_INFINITY;
  for (const heId of faceHalfEdgeIds(mesh, faceId)) {
    const he = mesh.halfEdges.get(heId);
    if (!he) continue;
    const pair = getEdgeVertices(mesh, he.edgeId);
    if (!pair) continue;
    const a = mesh.vertices.get(pair[0])?.position;
    const b = mesh.vertices.get(pair[1])?.position;
    if (!a || !b) continue;
    const dist = pointToSegmentDistanceSq(localPoint, a, b);
    if (dist < bestDist) {
      bestDist = dist;
      best = he.edgeId;
    }
  }
  return best;
}

function pointToSegmentDistanceSq(point: Vec3, a: Vec3, b: Vec3): number {
  const ab = subVec3(b, a);
  const ap = subVec3(point, a);
  const denom = lengthSqVec3(ab);
  const t = denom < 1e-12 ? 0 : Math.max(0, Math.min(1, dotVec3(ap, ab) / denom));
  return lengthSqVec3(subVec3(point, addVec3(a, scaleVec3(ab, t))));
}

function fallbackFaceUvs(count: number): { x: number; y: number }[] {
  if (count === 3) return [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0.5, y: 1 }];
  if (count === 4) return [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];
  return Array.from({ length: count }, (_, index) => {
    const angle = (index / count) * Math.PI * 2 - Math.PI / 2;
    return { x: 0.5 + Math.cos(angle) * 0.5, y: 0.5 + Math.sin(angle) * 0.5 };
  });
}

export type AtlasGridBuildOptions = {
  columns: number;
  rows: number;
  cellSize: number;
  cellWidth?: number;
  cellHeight?: number;
  orientation: 'floor' | 'wall-x' | 'wall-z';
  imageWidth: number;
  imageHeight: number;
  tileX: number;
  tileY: number;
  tileWidth: number;
  tileHeight: number;
  marginX?: number;
  marginY?: number;
  selectionColumns?: number;
  selectionRows?: number;
  padding?: number;
  quarterTurns?: 0 | 1 | 2 | 3;
  flipU?: boolean;
  flipV?: boolean;
  name?: string;
  pattern?: 'repeat' | 'random';
  randomSeed?: number;
};

/** Build an auto-joined tile grid where neighbouring cells share vertices. */
export function buildAtlasTileGrid(options: AtlasGridBuildOptions): EditableMesh {
  const columns = Math.max(1, Math.min(256, Math.round(options.columns)));
  const rows = Math.max(1, Math.min(256, Math.round(options.rows)));
  const size = Math.max(0.001, options.cellSize);
  const cellWidth = Math.max(0.001, options.cellWidth ?? size);
  const cellHeight = Math.max(0.001, options.cellHeight ?? size);
  const selectionColumns = Math.max(1, Math.round(options.selectionColumns ?? 1));
  const selectionRows = Math.max(1, Math.round(options.selectionRows ?? 1));
  const stepX = options.tileWidth + Math.max(0, options.marginX ?? 0);
  const stepY = options.tileHeight + Math.max(0, options.marginY ?? 0);
  const builder = new MeshBuilder(options.name ?? 'Tile Grid', true);
  const vertices: ReturnType<typeof builder.vertex>[][] = [];
  for (let row = 0; row <= rows; row++) {
    const line: ReturnType<typeof builder.vertex>[] = [];
    for (let column = 0; column <= columns; column++) {
      const horizontal = (column - columns / 2) * cellWidth;
      const vertical = (row - rows / 2) * cellHeight;
      const point = options.orientation === 'floor'
        ? v3(horizontal, 0, vertical)
        : options.orientation === 'wall-x'
          ? v3(horizontal, vertical, 0)
          : v3(0, vertical, horizontal);
      line.push(builder.vertex(point));
    }
    vertices.push(line);
  }
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const a = vertices[row]![column]!;
      const b = vertices[row]![column + 1]!;
      const c = vertices[row + 1]![column + 1]!;
      const d = vertices[row + 1]![column]!;
      builder.quad(a, b, c, d);
    }
  }
  const mesh = builder.build();
  const faces = [...mesh.faces.keys()];
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const patternIndex = options.pattern === 'random'
        ? seededTileIndex(row * columns + column, options.randomSeed ?? 1, selectionColumns * selectionRows)
        : (row % selectionRows) * selectionColumns + (column % selectionColumns);
      const tileColumn = patternIndex % selectionColumns;
      const tileRow = Math.floor(patternIndex / selectionColumns);
      applyAtlasTileToFaces(mesh, [faces[row * columns + column]!], mesh.defaultUvLayerId!, {
        imageWidth: options.imageWidth,
        imageHeight: options.imageHeight,
        x: options.tileX + tileColumn * stepX,
        y: options.tileY + tileRow * stepY,
        width: options.tileWidth,
        height: options.tileHeight,
        padding: options.padding,
        quarterTurns: options.quarterTurns,
        flipU: options.flipU,
        flipV: options.flipV,
      });
    }
  }
  return mesh;
}

function seededTileIndex(index: number, seed: number, count: number): number {
  let value = (index + 1) ^ (Math.trunc(seed) * 0x45d9f3b);
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
  value ^= value >>> 16;
  return Math.abs(value) % Math.max(1, count);
}

export type AtlasTileCell = {
  column: number;
  row: number;
  /** Joined stamp width in cells. A 2×2 door is one face. */
  spanColumns?: number;
  spanRows?: number;
  tileX?: number;
  tileY?: number;
  quarterTurns?: 0 | 1 | 2 | 3;
  flipU?: boolean;
  flipV?: boolean;
};
export type AtlasCellBuildOptions = Omit<AtlasGridBuildOptions, 'columns' | 'rows' | 'orientation'> & {
  cells: AtlasTileCell[];
  origin: Vec3;
  axisU: Vec3;
  axisV: Vec3;
};

/** Build an arbitrary set of tile cells, sharing vertices along every adjacent edge. */
export function buildAtlasTileCells(options: AtlasCellBuildOptions): EditableMesh {
  const cellWidth = Math.max(0.001, options.cellWidth ?? options.cellSize);
  const cellHeight = Math.max(0.001, options.cellHeight ?? options.cellSize);
  const selectionColumns = Math.max(1, Math.round(options.selectionColumns ?? 1));
  const selectionRows = Math.max(1, Math.round(options.selectionRows ?? 1));
  const stepX = options.tileWidth + Math.max(0, options.marginX ?? 0);
  const stepY = options.tileHeight + Math.max(0, options.marginY ?? 0);
  const builder = new MeshBuilder(options.name ?? 'Tile Stroke', true);
  const vertices = new Map<string, ReturnType<typeof builder.vertex>>();
  const vertex = (column: number, row: number) => {
    const key = `${column},${row}`;
    let id = vertices.get(key);
    if (id) return id;
    const point = addVec3(
      options.origin,
      addVec3(scaleVec3(options.axisU, column * cellWidth), scaleVec3(options.axisV, row * cellHeight)),
    );
    id = builder.vertex(point);
    vertices.set(key, id);
    return id;
  };
  for (const cell of options.cells) {
    const spanC = Math.max(1, Math.round(cell.spanColumns ?? 1));
    const spanR = Math.max(1, Math.round(cell.spanRows ?? 1));
    builder.quad(
      vertex(cell.column, cell.row),
      vertex(cell.column + spanC, cell.row),
      vertex(cell.column + spanC, cell.row + spanR),
      vertex(cell.column, cell.row + spanR),
    );
  }
  const mesh = builder.build();
  const faces = [...mesh.faces.keys()];
  options.cells.forEach((cell, index) => {
    const spanC = Math.max(1, Math.round(cell.spanColumns ?? 1));
    const spanR = Math.max(1, Math.round(cell.spanRows ?? 1));
    const patternIndex = options.pattern === 'random'
      ? seededTileIndex(index, options.randomSeed ?? 1, selectionColumns * selectionRows)
      : positiveModulo(cell.row, selectionRows) * selectionColumns + positiveModulo(cell.column, selectionColumns);
    applyAtlasTileToFaces(mesh, [faces[index]!], mesh.defaultUvLayerId!, {
      imageWidth: options.imageWidth,
      imageHeight: options.imageHeight,
      x: cell.tileX ?? options.tileX + (patternIndex % selectionColumns) * stepX,
      y: cell.tileY ?? options.tileY + Math.floor(patternIndex / selectionColumns) * stepY,
      width: options.tileWidth * spanC + Math.max(0, options.marginX ?? 0) * (spanC - 1),
      height: options.tileHeight * spanR + Math.max(0, options.marginY ?? 0) * (spanR - 1),
      padding: options.padding,
      quarterTurns: cell.quarterTurns ?? options.quarterTurns,
      flipU: cell.flipU ?? options.flipU,
      flipV: cell.flipV ?? options.flipV,
    });
  });
  return mesh;
}

function positiveModulo(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor;
}
