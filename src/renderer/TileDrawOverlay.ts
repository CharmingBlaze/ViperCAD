import { BufferAttribute, BufferGeometry, Group, LineBasicMaterial, LineSegments } from 'three';
import { addVec3, scaleVec3, type Vec3 } from '@/core/math/Vec3';
import type { AtlasTileCell } from '@/core/uv/AtlasUv';

export type TileDrawOverlayInfo = {
  origin: Vec3;
  axisU: Vec3;
  axisV: Vec3;
  hoverCell: AtlasTileCell | null;
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
  private lines: LineSegments[] = [];
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
    if (info.hoverCell) {
      const c = info.hoverCell.column;
      const r = info.hoverCell.row;
      const corners = [point(info,c,r), point(info,c+1,r), point(info,c+1,r+1), point(info,c,r+1)];
      this.cursorMaterial.color.setHex(layerColour(info.layer, info.drawing));
      this.addLines([corners[0]!,corners[1]!, corners[1]!,corners[2]!, corners[2]!,corners[3]!, corners[3]!,corners[0]!], this.cursorMaterial, 92);
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
