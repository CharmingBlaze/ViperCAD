import { buildLowPolyEllipseContour } from '@/core/blockout/BlockoutExtrude';
import { rayPlaneIntersection } from '@/core/snap/SnapEngine';
import type { Vec3 } from '@/core/math/Vec3';
import { BlockoutVectorTool } from './BlockoutVectorTool';
import type { ModellingContext, ToolPointerInput } from './Tool';

/** Click-drag a low-poly ellipse (8 sides), then the same width/extrude flow as Square. */
export class BlockoutRoundTool extends BlockoutVectorTool {
  id = 'blockout-round' as const;
  label = 'Round';
  sides = 8;
  private cornerA: Vec3 | null = null;
  private cornerB: Vec3 | null = null;
  private boxing = false;

  setSides(value: number, context?: ModellingContext): void {
    this.sides = Math.max(6, Math.min(12, Math.round(value)));
    this.rebuildEllipse();
    this.state.revision += 1;
    if (context) context.requestRedraw();
  }

  override clear(context?: ModellingContext): void {
    this.cornerA = null;
    this.cornerB = null;
    this.boxing = false;
    super.clear(context);
  }

  override onPointerDown(input: ToolPointerInput, context: ModellingContext): void {
    if (input.button !== 'left') return;
    if (this.state.stage === 'width') {
      super.onPointerDown(input, context);
      return;
    }

    const resolved = this.resolveDrawPlane(input.viewportId, context);
    if (!resolved) return;
    const { plane, type } = resolved;
    this.state.activePlane = type;
    const hit = rayPlaneIntersection(input.rayOrigin, input.rayDirection, plane);
    if (!hit) return;

    this.boxing = true;
    this.cornerA = hit;
    this.cornerB = hit;
    this.state.points = [];
    this.state.closed = false;
    this.state.canClose = false;
    this.state.previewPoint = null;
    this.state.revision += 1;
    context.requestRedraw();
  }

  override onPointerMove(input: ToolPointerInput, context: ModellingContext): void {
    if (this.state.stage === 'width') {
      super.onPointerMove(input, context);
      return;
    }
    if (!this.boxing || !this.cornerA) return;

    const resolved = this.resolveDrawPlane(input.viewportId, context);
    if (!resolved) return;
    const hit = rayPlaneIntersection(input.rayOrigin, input.rayDirection, resolved.plane);
    if (!hit) return;
    this.cornerB = hit;
    this.rebuildEllipse();
    this.state.revision += 1;
    context.requestRedraw();
  }

  override onPointerUp(input: ToolPointerInput, context: ModellingContext): void {
    if (this.state.stage === 'width') {
      super.onPointerUp(input, context);
      return;
    }
    if (!this.boxing) return;
    this.boxing = false;
    if (this.state.points.length >= 3) {
      this.beginWidthStage(context);
      return;
    }
    this.cornerA = null;
    this.cornerB = null;
    this.state.points = [];
    this.state.revision += 1;
    context.requestRedraw();
  }

  private rebuildEllipse(): void {
    if (!this.cornerA || !this.cornerB) return;
    const pts = buildLowPolyEllipseContour(this.cornerA, this.cornerB, this.state.activePlane, this.sides);
    this.state.points = pts;
    this.state.closed = pts.length >= 3;
    this.state.previewPoint = null;
    this.state.canClose = false;
  }
}
