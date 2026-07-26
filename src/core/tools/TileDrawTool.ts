import { commitMeshObject } from '@/core/document/ModelDocument';
import type { MaterialId, SceneObject } from '@/core/document/types';
import { cloneSelection } from '@/core/selection/SelectionManager';
import { addVec3, dotVec3, scaleVec3, subVec3 } from '@/core/math/Vec3';
import type { EditableMesh } from '@/core/mesh/types';
import { rayPlaneIntersection, type ConstructionPlane } from '@/core/snap/SnapEngine';
import { buildAtlasTileCells, type AtlasTileCell } from '@/core/uv/AtlasUv';
import type { ModellingContext, Tool, ToolPointerInput } from './Tool';

export type TileDrawMode = 'paint' | 'erase' | 'replace' | 'pick' | 'fill';
export type TileDrawConfig = {
  mode: TileDrawMode;
  shape: 'stroke' | 'rectangle';
  autoTile: boolean;
  materialId: MaterialId | null;
  imageName: string;
  imageWidth: number;
  imageHeight: number;
  tileX: number;
  tileY: number;
  tileWidth: number;
  tileHeight: number;
  marginX: number;
  marginY: number;
  selectionColumns: number;
  selectionRows: number;
  padding: number;
  quarterTurns: 0 | 1 | 2 | 3;
  flipU: boolean;
  flipV: boolean;
  cellWidth: number;
  cellHeight: number;
  pattern: 'repeat' | 'random';
  randomSeed: number;
  layer: string;
};

export class TileDrawTool implements Tool {
  id = 'tile-draw' as const;
  label = '3D Tile Draw';
  config: TileDrawConfig = {
    mode: 'paint', shape: 'stroke', autoTile: false, materialId: null, imageName: '', imageWidth: 16, imageHeight: 16,
    tileX: 0, tileY: 0, tileWidth: 16, tileHeight: 16, marginX: 0, marginY: 0,
    selectionColumns: 1, selectionRows: 1, padding: 0, quarterTurns: 0,
    flipU: false, flipV: false, cellWidth: 1, cellHeight: 1,
    pattern: 'repeat', randomSeed: 1, layer: 'Geometry',
  };
  state = {
    drawing: false,
    revision: 0,
    hoverCell: null as AtlasTileCell | null,
    pickedTile: null as Pick<TileDrawConfig, 'tileX' | 'tileY' | 'quarterTurns' | 'flipU' | 'flipV'> | null,
  };
  private plane: ConstructionPlane | null = null;
  private cells = new Map<string, AtlasTileCell>();
  private startCell: AtlasTileCell | null = null;
  private lastCell: AtlasTileCell | null = null;

  setConfig(config: Partial<TileDrawConfig>, context: ModellingContext): void {
    this.config = { ...this.config, ...config };
    this.state.revision += 1;
    context.requestRedraw();
  }

  consumePickedTile(): typeof this.state.pickedTile {
    const picked = this.state.pickedTile;
    this.state.pickedTile = null;
    return picked;
  }

  activate(context: ModellingContext): void {
    this.cancel(context);
    this.plane = { ...context.constructionPlane };
    this.touch(context);
  }
  deactivate(context: ModellingContext): void { this.cancel(context); }

  begin(input: ToolPointerInput, context: ModellingContext): void {
    if (input.button !== 'left') return;
    this.plane = { ...context.constructionPlane };
    const cell = this.cellFromInput(input);
    if (!cell) return;
    if (this.config.mode === 'pick') {
      const target = this.findTarget(context);
      const record = target
        ? parseCells(target.object.metadata.tileDrawCells).find((item) => item.column === cell.column && item.row === cell.row) ?? null
        : null;
      const storedBaseX = Number(target?.object.metadata.tileAutoBaseX);
      const storedBaseY = Number(target?.object.metadata.tileAutoBaseY);
      const isAutoTile = target?.object.metadata.tileAutoRule === 'cardinal-4x4';
      this.state.pickedTile = record ? {
        tileX: isAutoTile && Number.isFinite(storedBaseX) ? storedBaseX : record.tileX ?? this.config.tileX,
        tileY: isAutoTile && Number.isFinite(storedBaseY) ? storedBaseY : record.tileY ?? this.config.tileY,
        quarterTurns: record.quarterTurns ?? 0,
        flipU: record.flipU ?? false,
        flipV: record.flipV ?? false,
      } : null;
      this.touch(context);
      return;
    }
    this.state.drawing = true;
    this.startCell = cell;
    this.lastCell = cell;
    this.cells.clear();
    if (this.config.mode === 'fill') {
      for (const filled of this.floodCells(context, cell)) this.addCell(filled);
    } else {
      this.addCell(cell);
    }
    this.touch(context);
  }

  update(input: ToolPointerInput, context: ModellingContext): void {
    const cell = this.cellFromInput(input);
    this.state.hoverCell = cell;
    if (!cell) return this.touch(context);
    if (!this.state.drawing) return this.touch(context);
    if (this.config.mode === 'fill') return;
    if (this.config.shape === 'rectangle' && this.startCell) {
      this.cells.clear();
      const minX = Math.min(this.startCell.column, cell.column);
      const maxX = Math.max(this.startCell.column, cell.column);
      const minY = Math.min(this.startCell.row, cell.row);
      const maxY = Math.max(this.startCell.row, cell.row);
      for (let row = minY; row <= maxY; row++) for (let column = minX; column <= maxX; column++) this.addCell({ column, row });
    } else if (this.lastCell) {
      for (const next of gridLine(this.lastCell, cell)) this.addCell(next);
    }
    this.lastCell = cell;
    this.touch(context);
  }

  preview(_context: ModellingContext): void {}

  confirm(context: ModellingContext): void {
    if (!this.state.drawing || !this.cells.size) return;
    const target = this.findTarget(context);
    const beforeRecords = target ? parseCells(target.object.metadata.tileDrawCells) : [];
    const next = new Map(beforeRecords.map((cell) => [`${cell.column},${cell.row}`, cell]));
    let index = 0;
    for (const cell of this.cells.values()) {
      const key = `${cell.column},${cell.row}`;
      if (this.config.mode === 'erase') next.delete(key);
      else if (this.config.mode !== 'replace' || next.has(key)) next.set(key, this.paintRecord(cell, index++));
    }
    const records = this.config.autoTile ? this.applyAutoTiles([...next.values()]) : [...next.values()];
    if (sameCells(beforeRecords, records)) { this.clearStroke(context, true); return; }
    const beforeSelection = cloneSelection(context.selection.state);
    if (target) this.commitExisting(context, target.object, target.mesh, beforeRecords, records, beforeSelection);
    else if (records.length) this.commitNew(context, records, beforeSelection);
    this.clearStroke(context, true);
  }

  cancel(context: ModellingContext): void { this.clearStroke(context); }
  getAllowedSelectionModes() { return ['object'] as const; }
  getSnapPolicy() { return ['grid'] as const; }

  syncWorkPlane(plane: ConstructionPlane, context: ModellingContext): void {
    this.plane = { ...plane };
    this.touch(context);
  }

  getOverlayInfo() {
    if (!this.plane) return null;
    return {
      origin: this.tileOrigin(),
      axisU: this.plane.xAxis,
      axisV: this.plane.yAxis,
      hoverCell: this.state.hoverCell,
      cellWidth: this.config.cellWidth,
      cellHeight: this.config.cellHeight,
      layer: this.config.layer,
      drawing: this.state.drawing,
    };
  }

  getPreviewMesh(): EditableMesh | null {
    if (!this.plane || !this.cells.size) return null;
    const cells = this.config.autoTile
      ? this.applyAutoTiles([...this.cells.values()].map((cell, index) => this.paintRecord(cell, index)))
      : [...this.cells.values()];
    return buildAtlasTileCells({
      cells, origin: this.tileOrigin(),
      axisU: this.plane.xAxis, axisV: this.plane.yAxis,
      cellSize: 1, cellWidth: this.config.cellWidth, cellHeight: this.config.cellHeight,
      imageWidth: this.config.imageWidth, imageHeight: this.config.imageHeight,
      tileX: this.config.tileX, tileY: this.config.tileY,
      tileWidth: this.config.tileWidth, tileHeight: this.config.tileHeight,
      marginX: this.config.marginX, marginY: this.config.marginY,
      selectionColumns: this.config.selectionColumns, selectionRows: this.config.selectionRows,
      padding: this.config.padding, quarterTurns: this.config.quarterTurns,
      flipU: this.config.flipU, flipV: this.config.flipV,
      pattern: this.config.pattern, randomSeed: this.config.randomSeed,
      name: 'Tile Stroke Preview',
    });
  }

  private buildMesh(cells: AtlasTileCell[]): EditableMesh {
    return buildAtlasTileCells({
      cells, origin: this.tileOrigin(), axisU: this.plane!.xAxis, axisV: this.plane!.yAxis,
      cellSize: 1, cellWidth: this.config.cellWidth, cellHeight: this.config.cellHeight,
      imageWidth: this.config.imageWidth, imageHeight: this.config.imageHeight,
      tileX: this.config.tileX, tileY: this.config.tileY, tileWidth: this.config.tileWidth,
      tileHeight: this.config.tileHeight, marginX: this.config.marginX, marginY: this.config.marginY,
      selectionColumns: this.config.selectionColumns, selectionRows: this.config.selectionRows,
      padding: this.config.padding, quarterTurns: this.config.quarterTurns,
      flipU: this.config.flipU, flipV: this.config.flipV,
      pattern: this.config.pattern, randomSeed: this.config.randomSeed,
      name: `Tile ${this.config.layer} Layer`,
    });
  }

  private paintRecord(cell: AtlasTileCell, index: number): AtlasTileCell {
    const count = Math.max(1, this.config.selectionColumns * this.config.selectionRows);
    const pattern = this.config.pattern === 'random'
      ? seededIndex(index, this.config.randomSeed, count)
      : positiveModulo(cell.row, this.config.selectionRows) * this.config.selectionColumns + positiveModulo(cell.column, this.config.selectionColumns);
    return {
      column: cell.column, row: cell.row,
      tileX: this.config.tileX + (pattern % this.config.selectionColumns) * (this.config.tileWidth + this.config.marginX),
      tileY: this.config.tileY + Math.floor(pattern / this.config.selectionColumns) * (this.config.tileHeight + this.config.marginY),
      quarterTurns: this.config.quarterTurns, flipU: this.config.flipU, flipV: this.config.flipV,
    };
  }

  private applyAutoTiles(cells: AtlasTileCell[]): AtlasTileCell[] {
    const occupied = new Set(cells.map((cell) => `${cell.column},${cell.row}`));
    const stepX = this.config.tileWidth + this.config.marginX;
    const stepY = this.config.tileHeight + this.config.marginY;
    const maxX = Math.max(0, this.config.imageWidth - this.config.tileWidth);
    const maxY = Math.max(0, this.config.imageHeight - this.config.tileHeight);
    return cells.map((cell) => {
      let mask = 0;
      if (occupied.has(`${cell.column},${cell.row - 1}`)) mask |= 1;
      if (occupied.has(`${cell.column + 1},${cell.row}`)) mask |= 2;
      if (occupied.has(`${cell.column},${cell.row + 1}`)) mask |= 4;
      if (occupied.has(`${cell.column - 1},${cell.row}`)) mask |= 8;
      return {
        ...cell,
        tileX: Math.min(maxX, Math.max(0, this.config.tileX + (mask % 4) * stepX)),
        tileY: Math.min(maxY, Math.max(0, this.config.tileY + Math.floor(mask / 4) * stepY)),
        quarterTurns: this.config.quarterTurns,
        flipU: this.config.flipU,
        flipV: this.config.flipV,
      };
    });
  }

  private planeKey(): string {
    const p = this.plane!;
    const values = [p.origin.x,p.origin.y,p.origin.z,p.xAxis.x,p.xAxis.y,p.xAxis.z,p.yAxis.x,p.yAxis.y,p.yAxis.z];
    return values.map((value) => value.toFixed(4)).join(',');
  }

  private findTarget(context: ModellingContext) {
    const object = [...context.document.objects.values()].find((candidate) =>
      candidate.metadata.tileLayer === this.config.layer &&
      candidate.metadata.tilePlaneKey === this.planeKey() &&
      candidate.materialSlotIds[0] === (this.config.materialId ?? candidate.materialSlotIds[0]),
    );
    const mesh = object?.meshId ? context.document.meshes.get(object.meshId) : null;
    return object && mesh ? { object, mesh } : null;
  }

  private floodCells(context: ModellingContext, seed: AtlasTileCell): AtlasTileCell[] {
    const target = this.findTarget(context);
    if (!target) return [];
    const records = parseCells(target.object.metadata.tileDrawCells);
    const byKey = new Map(records.map((cell) => [`${cell.column},${cell.row}`, cell]));
    const start = byKey.get(`${seed.column},${seed.row}`);
    if (!start) return [];
    const signature = tileSignature(start);
    const result: AtlasTileCell[] = [];
    const queue = [start];
    const visited = new Set<string>();
    while (queue.length) {
      const cell = queue.shift()!;
      const key = `${cell.column},${cell.row}`;
      if (visited.has(key) || (!this.config.autoTile && tileSignature(cell) !== signature)) continue;
      visited.add(key); result.push(cell);
      for (const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
        const neighbour = byKey.get(`${cell.column + dx!},${cell.row + dy!}`);
        if (neighbour) queue.push(neighbour);
      }
    }
    return result;
  }

  private commitNew(context: ModellingContext, records: AtlasTileCell[], beforeSelection: ReturnType<typeof cloneSelection>): void {
    const mesh = this.buildMesh(records);
    const committed = commitMeshObject(context.document, mesh, { name: `Tile ${this.config.layer} Layer`, materialId: this.config.materialId ?? undefined });
    const object = context.document.objects.get(committed.objectId)!;
    object.metadata = {
      atlasImage: this.config.imageName,
      tileLayer: this.config.layer,
      tilePlaneKey: this.planeKey(),
      tileDrawCells: JSON.stringify(records),
      tileAutoRule: this.config.autoTile ? 'cardinal-4x4' : 'none',
      tileAutoBaseX: String(this.config.tileX),
      tileAutoBaseY: String(this.config.tileY),
      gameRole: this.config.layer === 'Collision' ? 'collision' : 'geometry',
    };
    const meshRef = context.document.meshes.get(committed.meshId)!;
    context.selection.setMode('object'); context.selection.selectObjects([object.id], 'replace');
    const afterSelection = cloneSelection(context.selection.state); let applied = true;
    context.history.execute({ name: 'Draw 3D Tiles', execute: () => { if(applied)return;context.document.meshes.set(meshRef.id,meshRef);context.document.objects.set(object.id,object);if(!context.document.rootObjectIds.includes(object.id))context.document.rootObjectIds.push(object.id);context.selection.state=cloneSelection(afterSelection);context.document.dirty=true;applied=true; }, undo: () => {context.document.objects.delete(object.id);context.document.rootObjectIds=context.document.rootObjectIds.filter((id)=>id!==object.id);context.document.meshes.delete(meshRef.id);context.selection.state=cloneSelection(beforeSelection);context.document.dirty=true;applied=false;} });
  }

  private commitExisting(context: ModellingContext, object: SceneObject, oldMesh: EditableMesh, beforeRecords: AtlasTileCell[], records: AtlasTileCell[], beforeSelection: ReturnType<typeof cloneSelection>): void {
    const beforeMetadata = object.metadata.tileDrawCells;
    if (!records.length) {
      const rootIndex = context.document.rootObjectIds.indexOf(object.id); let applied = true;
      context.document.objects.delete(object.id); context.document.rootObjectIds = context.document.rootObjectIds.filter((id)=>id!==object.id); context.document.meshes.delete(oldMesh.id);
      context.history.execute({ name:'Erase 3D Tiles',execute:()=>{if(applied)return;context.document.objects.delete(object.id);context.document.rootObjectIds=context.document.rootObjectIds.filter((id)=>id!==object.id);context.document.meshes.delete(oldMesh.id);applied=true;},undo:()=>{context.document.objects.set(object.id,object);context.document.meshes.set(oldMesh.id,oldMesh);context.document.rootObjectIds.splice(Math.max(0,rootIndex),0,object.id);object.metadata.tileDrawCells=beforeMetadata;context.selection.state=cloneSelection(beforeSelection);applied=false;} });
      return;
    }
    const beforeAutoRule = object.metadata.tileAutoRule;
    const beforeAutoBaseX = object.metadata.tileAutoBaseX;
    const beforeAutoBaseY = object.metadata.tileAutoBaseY;
    const afterAutoRule = this.config.autoTile ? 'cardinal-4x4' : 'none';
    const afterAutoBaseX = String(this.config.tileX);
    const afterAutoBaseY = String(this.config.tileY);
    const applyAutoMetadata = () => {
      object.metadata.tileAutoRule = afterAutoRule;
      object.metadata.tileAutoBaseX = afterAutoBaseX;
      object.metadata.tileAutoBaseY = afterAutoBaseY;
    };
    const restoreAutoMetadata = () => {
      if (beforeAutoRule === undefined) delete object.metadata.tileAutoRule; else object.metadata.tileAutoRule = beforeAutoRule;
      if (beforeAutoBaseX === undefined) delete object.metadata.tileAutoBaseX; else object.metadata.tileAutoBaseX = beforeAutoBaseX;
      if (beforeAutoBaseY === undefined) delete object.metadata.tileAutoBaseY; else object.metadata.tileAutoBaseY = beforeAutoBaseY;
    };
    const newMesh = this.buildMesh(records); context.document.meshes.set(newMesh.id,newMesh); object.meshId=newMesh.id; object.metadata.tileDrawCells=JSON.stringify(records); applyAutoMetadata(); context.document.meshes.delete(oldMesh.id); const afterSelection=cloneSelection(context.selection.state); let applied=true;
    context.history.execute({name:this.config.mode==='erase'?'Erase 3D Tiles':'Edit 3D Tiles',execute:()=>{if(applied)return;context.document.meshes.set(newMesh.id,newMesh);object.meshId=newMesh.id;object.metadata.tileDrawCells=JSON.stringify(records);applyAutoMetadata();context.document.meshes.delete(oldMesh.id);context.selection.state=cloneSelection(afterSelection);context.document.dirty=true;applied=true;},undo:()=>{context.document.meshes.set(oldMesh.id,oldMesh);object.meshId=oldMesh.id;object.metadata.tileDrawCells=JSON.stringify(beforeRecords);restoreAutoMetadata();context.document.meshes.delete(newMesh.id);context.selection.state=cloneSelection(beforeSelection);context.document.dirty=true;applied=false;}});
  }

  private cellFromInput(input: ToolPointerInput): AtlasTileCell | null {
    if (!this.plane) return null;
    const hit = rayPlaneIntersection(input.rayOrigin, input.rayDirection, this.plane);
    if (!hit) return null;
    const delta = subVec3(hit, this.plane.origin);
    return {
      column: Math.floor(dotVec3(delta, this.plane.xAxis) / this.config.cellWidth),
      row: Math.floor(dotVec3(delta, this.plane.yAxis) / this.config.cellHeight),
    };
  }
  private tileOrigin() {
    const layerSteps: Record<string, number> = { Geometry: 0, Decoration: 1, Decal: 2, Collision: 3 };
    const step = layerSteps[this.config.layer] ?? 0;
    const offset = Math.min(this.config.cellWidth, this.config.cellHeight) * step * 0.002;
    return addVec3(this.plane!.origin, scaleVec3(this.plane!.normal, offset));
  }
  private addCell(cell: AtlasTileCell): void { this.cells.set(`${cell.column},${cell.row}`, cell); }
  private clearStroke(context: ModellingContext, keepPlane = false): void {
    this.state.drawing = false; this.state.hoverCell = null; this.cells.clear();
    this.startCell = null; this.lastCell = null;
    if (!keepPlane) this.plane = null;
    this.touch(context);
  }
  private touch(context: ModellingContext): void { this.state.revision += 1; context.requestRedraw(); }
}

function gridLine(from: AtlasTileCell, to: AtlasTileCell): AtlasTileCell[] {
  const result: AtlasTileCell[] = [];
  let x = from.column, y = from.row;
  const dx = Math.abs(to.column - x), sx = x < to.column ? 1 : -1;
  const dy = -Math.abs(to.row - y), sy = y < to.row ? 1 : -1;
  let error = dx + dy;
  for (;;) {
    result.push({ column: x, row: y });
    if (x === to.column && y === to.row) break;
    const twice = 2 * error;
    if (twice >= dy) { error += dy; x += sx; }
    if (twice <= dx) { error += dx; y += sy; }
  }
  return result;
}

function parseCells(value: string | undefined): AtlasTileCell[] {
  try {
    const parsed = JSON.parse(value ?? '[]') as AtlasTileCell[];
    return Array.isArray(parsed) ? parsed.filter((cell) => Number.isFinite(cell.column) && Number.isFinite(cell.row)) : [];
  } catch {
    return [];
  }
}

function sameCells(a: AtlasTileCell[], b: AtlasTileCell[]): boolean {
  const normalize = (cells: AtlasTileCell[]) => [...cells]
    .sort((left, right) => left.row - right.row || left.column - right.column)
    .map((cell) => JSON.stringify(cell));
  return JSON.stringify(normalize(a)) === JSON.stringify(normalize(b));
}

function tileSignature(cell: AtlasTileCell): string {
  return `${cell.tileX ?? 0},${cell.tileY ?? 0},${cell.quarterTurns ?? 0},${cell.flipU ? 1 : 0},${cell.flipV ? 1 : 0}`;
}

function positiveModulo(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor;
}

function seededIndex(index: number, seed: number, count: number): number {
  let value = (index + 1) ^ (Math.trunc(seed) * 0x45d9f3b);
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
  value ^= value >>> 16;
  return Math.abs(value) % Math.max(1, count);
}
