import { faceCornerIds } from '@/core/mesh/EditableMesh';
import type { EditableMesh, FaceId, UvLayerId } from '@/core/mesh/types';
import { MeshBuilder } from '@/core/mesh/MeshBuilder';
import { v3 } from '@/core/math/Vec3';
import { addVec3, scaleVec3, type Vec3 } from '@/core/math/Vec3';

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
    const current = cornerIds.map((id) => mesh.faceCorners.get(id)!.uvs.get(layerId) ?? { x: 0, y: 0 });
    const minCurrentU = Math.min(...current.map((uv) => uv.x));
    const maxCurrentU = Math.max(...current.map((uv) => uv.x));
    const minCurrentV = Math.min(...current.map((uv) => uv.y));
    const maxCurrentV = Math.max(...current.map((uv) => uv.y));
    const currentSpanU = maxCurrentU - minCurrentU;
    const currentSpanV = maxCurrentV - minCurrentV;
    const fallback = fallbackFaceUvs(cornerIds.length);

    for (let index = 0; index < cornerIds.length; index++) {
      let u = currentSpanU > 1e-9 ? (current[index]!.x - minCurrentU) / currentSpanU : fallback[index]!.x;
      let v = currentSpanV > 1e-9 ? (current[index]!.y - minCurrentV) / currentSpanV : fallback[index]!.y;
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
      corner.atlasTile = repeatU > 1 || repeatV > 1 ? atlasTile : null;
    }
    applied.push(faceId);
  }
  mesh.geometryVersion += 1;
  mesh.dirty.uvs = true;
  return applied;
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
    builder.quad(
      vertex(cell.column, cell.row),
      vertex(cell.column + 1, cell.row),
      vertex(cell.column + 1, cell.row + 1),
      vertex(cell.column, cell.row + 1),
    );
  }
  const mesh = builder.build();
  const faces = [...mesh.faces.keys()];
  options.cells.forEach((cell, index) => {
    const patternIndex = options.pattern === 'random'
      ? seededTileIndex(index, options.randomSeed ?? 1, selectionColumns * selectionRows)
      : positiveModulo(cell.row, selectionRows) * selectionColumns + positiveModulo(cell.column, selectionColumns);
    applyAtlasTileToFaces(mesh, [faces[index]!], mesh.defaultUvLayerId!, {
      imageWidth: options.imageWidth,
      imageHeight: options.imageHeight,
      x: cell.tileX ?? options.tileX + (patternIndex % selectionColumns) * stepX,
      y: cell.tileY ?? options.tileY + Math.floor(patternIndex / selectionColumns) * stepY,
      width: options.tileWidth,
      height: options.tileHeight,
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
