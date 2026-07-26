import type { ObjectId, TextureId } from '@/core/document/types';
import type { EditorSession } from '@/core/editor/EditorSession';
import type { Vec3 } from '@/core/math/Vec3';
import {
  buildTerrainRibbon,
  commitTerrainFeature,
  type TerrainFeatureKind,
} from '@/core/terrain/TerrainFeatures';
import type {
  ModellingContext,
  Tool,
  ToolPointerInput,
} from '@/core/tools/Tool';

export class TerrainFeatureTool implements Tool {
  id = 'terrain-feature' as const;
  label = 'Terrain Water & Paths';
  kind: Extract<TerrainFeatureKind, 'river' | 'path'> = 'river';
  terrainObjectId: ObjectId | null = null;
  textureId: TextureId | null = null;
  width = 2;
  surfaceOffset = 0.04;
  textureScale = 2;
  opacity = 0.72;
  animated = true;
  flowSpeed = 0.12;
  spacing = 0.25;
  dragging = false;
  revision = 0;
  private points: Vec3[] = [];

  activate(context: ModellingContext): void {
    this.dragging = false;
    this.points = [];
    context.requestRedraw();
  }

  deactivate(context: ModellingContext): void {
    if (this.dragging) this.cancel(context);
  }

  configure(
    kind: 'river' | 'path',
    terrainObjectId: ObjectId,
    context: ModellingContext,
  ): void {
    this.kind = kind;
    this.terrainObjectId = terrainObjectId;
    this.animated = kind === 'river';
    this.opacity = kind === 'river' ? 0.72 : 1;
    this.surfaceOffset = kind === 'river' ? 0.04 : 0.055;
    this.revision += 1;
    context.requestRedraw();
  }

  begin(input: ToolPointerInput, context: ModellingContext): void {
    if (input.button !== 'left' || !input.worldPosition || !this.terrainObjectId) return;
    this.dragging = true;
    this.points = [offsetPoint(input.worldPosition, this.surfaceOffset)];
    context.requestRedraw();
  }

  update(input: ToolPointerInput, context: ModellingContext): void {
    if (!this.dragging || !input.worldPosition) return;
    const point = offsetPoint(input.worldPosition, this.surfaceOffset);
    const previous = this.points[this.points.length - 1]!;
    if (Math.hypot(point.x - previous.x, point.y - previous.y, point.z - previous.z) < this.spacing) {
      return;
    }
    this.points.push(point);
    this.revision += 1;
    context.requestRedraw();
  }

  endStroke(session: EditorSession): boolean {
    if (!this.dragging || !this.terrainObjectId) return false;
    const points = simplifyStroke(this.points, Math.max(0.08, this.width * 0.08));
    this.dragging = false;
    this.points = [];
    if (points.length < 2) {
      session.requestRedraw();
      return false;
    }
    const mesh = buildTerrainRibbon(
      points,
      this.width,
      this.textureScale,
      this.kind === 'river' ? 'River' : 'Path',
    );
    commitTerrainFeature(session, this.terrainObjectId, this.kind, mesh, {
      textureId: this.textureId,
      opacity: this.opacity,
      animated: this.kind === 'river' && this.animated,
      flowSpeed: this.flowSpeed,
      textureScale: this.textureScale,
    });
    this.revision += 1;
    return true;
  }

  preview(_context: ModellingContext): void {}
  confirm(_context: ModellingContext): void {}

  cancel(context: ModellingContext): void {
    this.dragging = false;
    this.points = [];
    this.revision += 1;
    context.requestRedraw();
  }

  statusLine(): string {
    if (this.dragging) return `drawing ${this.kind} · drag over terrain · release to finish`;
    return `${this.kind} brush · width ${this.width.toFixed(1)} · drag over terrain`;
  }

  getAllowedSelectionModes() { return ['object'] as const; }
  getSnapPolicy() { return [] as const; }
}

function offsetPoint(point: Vec3, amount: number): Vec3 {
  return { x: point.x, y: point.y + amount, z: point.z };
}

function simplifyStroke(points: Vec3[], tolerance: number): Vec3[] {
  if (points.length <= 2) return [...points];
  const kept = [points[0]!];
  for (let index = 1; index < points.length - 1; index++) {
    const point = points[index]!;
    const previous = kept[kept.length - 1]!;
    if (Math.hypot(point.x - previous.x, point.y - previous.y, point.z - previous.z) >= tolerance) {
      kept.push(point);
    }
  }
  kept.push(points[points.length - 1]!);
  return kept;
}
