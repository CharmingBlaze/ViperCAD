import {
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
} from 'three';
import { addVec3, scaleVec3, type Vec3 } from '@/core/math/Vec3';
import type { AtlasTileCell } from '@/core/uv/AtlasUv';

export type TileDrawOverlayInfo = {
  origin: Vec3;
  axisU: Vec3;
  axisV: Vec3;
  hoverCell: AtlasTileCell | null;
  hoverCells?: AtlasTileCell[];
  occupied?: boolean;
  valid?: boolean;
  stampColumns?: number;
  stampRows?: number;
  cellWidth: number;
  cellHeight: number;
  layer: string;
  drawing: boolean;
};

/** Tile-sized work grid and cursor rendered above the ordinary modelling grid. */
export class TileDrawOverlay {
  readonly group = new Group();
  private gridMaterial = new LineBasicMaterial({ color: 0x4f7590, transparent: true, opacity: 0.42, depthWrite: false });
  private majorMaterial = new LineBasicMaterial({ color: 0x77a7c9, transparent: true, opacity: 0.72, depthWrite: false });
  private cursorMaterial = new LineBasicMaterial({ color: 0xffa23a, transparent: true, opacity: 1, depthTest: false, depthWrite: false });
  private occupiedMaterial = new LineBasicMaterial({ color: 0xffc14d, transparent: true, opacity: 1, depthTest: false, depthWrite: false });
  private invalidMaterial = new LineBasicMaterial({ color: 0xff5f67, transparent: true, opacity: 1, depthTest: false, depthWrite: false });
  private fillMaterial = new MeshBasicMaterial({
    color: 0xffa23a,
    transparent: true,
    opacity: 0.16,
    depthWrite: false,
    depthTest: false,
    side: DoubleSide,
  });
  private originMaterial = new LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthTest: false, depthWrite: false });
  private lines: LineSegments[] = [];
  private fill: Mesh | null = null;
  private revision = -1;

  constructor() {
    this.group.name = '__tile_draw_overlay__';
    this.group.userData.nonSelectable = true;
    this.group.renderOrder = 90;
    this.group.visible = false;
  }

  update(info: TileDrawOverlayInfo | null, revision: number): void {
    if (revision === this.revision && (info || !this.group.visible)) return;
    this.clear();
    this.revision = revision;
    if (!info) {
      this.group.visible = false;
      return;
    }
    this.group.visible = true;
    const centreColumn = info.hoverCell?.column ?? 0;
    const centreRow = info.hoverCell?.row ?? 0;
    const radius = 12;
    const minColumn = centreColumn - radius;
    const maxColumn = centreColumn + radius + 1;
    const minRow = centreRow - radius;
    const maxRow = centreRow + radius + 1;
    const minor: Vec3[] = [];
    const major: Vec3[] = [];
    for (let column = minColumn; column <= maxColumn; column++) {
      const bucket = column % 4 === 0 ? major : minor;
      bucket.push(point(info, column, minRow), point(info, column, maxRow));
    }
    for (let row = minRow; row <= maxRow; row++) {
      const bucket = row % 4 === 0 ? major : minor;
      bucket.push(point(info, minColumn, row), point(info, maxColumn, row));
    }
    this.addLines(minor, this.gridMaterial, 90);
    this.addLines(major, this.majorMaterial, 91);
    const axisLen = Math.min(info.cellWidth, info.cellHeight) * 0.35;
    this.addLines([
      addVec3(info.origin, scaleVec3(info.axisU, -axisLen)),
      addVec3(info.origin, scaleVec3(info.axisU, axisLen)),
      addVec3(info.origin, scaleVec3(info.axisV, -axisLen)),
      addVec3(info.origin, scaleVec3(info.axisV, axisLen)),
    ], this.originMaterial, 93);
    const hoverCells = info.hoverCells?.length
      ? info.hoverCells
      : info.hoverCell
        ? [info.hoverCell]
        : [];
    if (hoverCells.length) {
      const outlineColor = !info.valid
        ? 0xff5f67
        : info.occupied
          ? 0xffc14d
          : layerColour(info.layer, info.drawing);
      this.cursorMaterial.color.setHex(outlineColor);
      this.fillMaterial.color.setHex(info.valid === false ? 0xff5f67 : layerColour(info.layer, info.drawing));
      this.fillMaterial.opacity = info.occupied ? 0.08 : 0.16;
      const fillPositions: number[] = [];
      const outline: Vec3[] = [];
      const minC = Math.min(...hoverCells.map((cell) => cell.column));
      const maxC = Math.max(...hoverCells.map((cell) => cell.column));
      const minR = Math.min(...hoverCells.map((cell) => cell.row));
      const maxR = Math.max(...hoverCells.map((cell) => cell.row));
      const stamp = [
        point(info, minC, minR),
        point(info, maxC + 1, minR),
        point(info, maxC + 1, maxR + 1),
        point(info, minC, maxR + 1),
      ];
      outline.push(stamp[0]!, stamp[1]!, stamp[1]!, stamp[2]!, stamp[2]!, stamp[3]!, stamp[3]!, stamp[0]!);
      for (const cell of hoverCells) {
        const corners = [
          point(info, cell.column, cell.row),
          point(info, cell.column + 1, cell.row),
          point(info, cell.column + 1, cell.row + 1),
          point(info, cell.column, cell.row + 1),
        ];
        fillPositions.push(
          corners[0]!.x, corners[0]!.y, corners[0]!.z,
          corners[1]!.x, corners[1]!.y, corners[1]!.z,
          corners[2]!.x, corners[2]!.y, corners[2]!.z,
          corners[0]!.x, corners[0]!.y, corners[0]!.z,
          corners[2]!.x, corners[2]!.y, corners[2]!.z,
          corners[3]!.x, corners[3]!.y, corners[3]!.z,
        );
      }
      this.addLines(outline, info.valid === false ? this.invalidMaterial : info.occupied ? this.occupiedMaterial : this.cursorMaterial, 92);
      const geometry = new BufferGeometry();
      geometry.setAttribute('position', new BufferAttribute(Float32Array.from(fillPositions), 3));
      this.fill = new Mesh(geometry, this.fillMaterial);
      this.fill.renderOrder = 89;
      this.fill.userData.nonSelectable = true;
      this.group.add(this.fill);
    }
  }

  private addLines(points: Vec3[], material: LineBasicMaterial, order: number): void {
    if (!points.length) return;
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(Float32Array.from(points.flatMap((p) => [p.x,p.y,p.z])), 3));
    const lines = new LineSegments(geometry, material);
    lines.renderOrder = order;
    lines.userData.nonSelectable = true;
    this.lines.push(lines);
    this.group.add(lines);
  }

  private clear(): void {
    for (const lines of this.lines) {
      this.group.remove(lines);
      lines.geometry.dispose();
    }
    this.lines = [];
    if (this.fill) {
      this.group.remove(this.fill);
      this.fill.geometry.dispose();
      this.fill = null;
    }
  }
}

function point(info: TileDrawOverlayInfo, column: number, row: number): Vec3 {
  return addVec3(
    addVec3(info.origin, scaleVec3(info.axisU, column * info.cellWidth)),
    scaleVec3(info.axisV, row * info.cellHeight),
  );
}

function layerColour(layer: string, drawing: boolean): number {
  if (drawing) return 0x7dffb0;
  if (layer === 'Collision') return 0xff5f67;
  if (layer === 'Decal') return 0xce78ff;
  if (layer === 'Decoration') return 0x67d4ff;
  return 0xffa23a;
}
