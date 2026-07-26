import type { ObjectId, TextureId } from '@/core/document/types';
import type { EditorSession } from '@/core/editor/EditorSession';
import type { Vec3 } from '@/core/math/Vec3';
import {
  commitRibbonWithCarve,
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
  opacity = 0.78;
  animated = true;
  flowSpeed = 0.14;
  carveTerrain = true;
  carveDepth = 0.9;
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
    this.opacity = kind === 'river' ? 0.78 : 1;
    this.surfaceOffset = kind === 'river' ? 0.03 : 0.04;
    this.revision += 1;
    context.requestRedraw();
  }

  begin(input: ToolPointerInput, context: ModellingContext): void {
    if (input.button !== 'left' || !input.worldPosition || !this.terrainObjectId) return;
    this.dragging = true;
    this.points = [{ ...input.worldPosition }];
    context.requestRedraw();
  }

  update(input: ToolPointerInput, context: ModellingContext): void {
    if (!this.dragging || !input.worldPosition) return;
    const point = { ...input.worldPosition };
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

    const defaultDepth = this.kind === 'path'
      ? Math.max(0.12, this.width * 0.2)
      : Math.max(0.35, this.width * 0.45);
    const created = commitRibbonWithCarve(
      session,
      this.terrainObjectId,
      this.kind,
      points,
      this.width,
      {
        textureId: this.textureId,
        opacity: this.opacity,
        animated: this.kind === 'river' && this.animated,
        flowSpeed: this.flowSpeed,
        textureScale: this.textureScale,
        surfaceOffset: this.surfaceOffset,
        carve: this.carveTerrain,
        carveDepth: this.carveDepth > 0 ? this.carveDepth : defaultDepth,
      },
    );
    this.revision += 1;
    return !!created;
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
    if (this.dragging) {
      return this.carveTerrain
        ? `drawing ${this.kind} · carve on release · drag over terrain`
        : `drawing ${this.kind} · drag over terrain · release to finish`;
    }
    return this.carveTerrain
      ? `${this.kind} brush · width ${this.width.toFixed(1)} · depth ${this.carveDepth.toFixed(1)} · carves terrain`
      : `${this.kind} brush · width ${this.width.toFixed(1)} · drag over terrain`;
  }

  getAllowedSelectionModes() { return ['object'] as const; }
  getSnapPolicy() { return [] as const; }
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
