import type { ObjectId } from '@/core/document/types';
import { getObjectWorldTransform } from '@/core/editor/Hierarchy';
import { runMeshTransaction } from '@/core/history/Transaction';
import { transformPoint } from '@/core/math/Transform';
import type { Vec3 } from '@/core/math/Vec3';
import {
  findLoopCutRing,
  loopCutMulti,
  loopCutPreviewSegments,
  type LoopCutRing,
} from '@/core/mesh/ops/cut';
import type { EdgeId } from '@/core/mesh/types';
import type { ModellingContext, Tool, ToolPointerInput } from './Tool';

export type LoopCutViewportPick = {
  objectId: ObjectId;
  edgeId: EdgeId;
};

type Phase = 'hover' | 'slide';

const MAX_CUTS = 32;

/**
 * Blender-style Ctrl+R workflow:
 * hover ring → click → slide → click/Enter, RMB centres, Esc cancels.
 */
export class LoopCutTool implements Tool {
  id = 'loop-cut' as const;
  label = 'Loop Cut';

  state = {
    phase: 'hover' as Phase,
    cutCount: 1,
    slide: 0,
    revision: 0,
    lastError: null as string | null,
  };

  private viewportPick: LoopCutViewportPick | null = null;
  private lockedPick: LoopCutViewportPick | null = null;
  private ring: LoopCutRing | null = null;
  private slideStartX = 0;
  private previewSegments: Array<[Vec3, Vec3]> = [];

  setViewportPick(pick: LoopCutViewportPick | null): void {
    this.viewportPick = pick;
  }

  getPreviewSegments(): Array<[Vec3, Vec3]> {
    return this.previewSegments;
  }

  getStatusLine(): string {
    if (this.state.lastError) return `Loop Cut · ${this.state.lastError}`;
    const count = `${this.state.cutCount} cut${this.state.cutCount === 1 ? '' : 's'}`;
    if (this.state.phase === 'hover') {
      return this.ring ? `Loop Cut · ${count} · click to choose ring` : 'Loop Cut · hover a quad edge ring';
    }
    return `Loop Cut · ${count} · slide ${Math.round(this.state.slide * 100)}%`;
  }

  activate(context: ModellingContext): void {
    this.reset();
    context.requestRedraw();
  }

  deactivate(context: ModellingContext): void {
    this.reset();
    context.requestRedraw();
  }

  begin(input: ToolPointerInput, context: ModellingContext): void {
    if (input.button !== 'left') return;
    if (this.state.phase === 'slide') {
      this.confirm(context);
      return;
    }
    if (!this.viewportPick || !this.ring) {
      this.state.lastError = 'Hover an edge in a continuous quad ring';
      this.touch(context);
      return;
    }
    this.lockedPick = { ...this.viewportPick };
    this.state.phase = 'slide';
    this.state.slide = 0;
    this.slideStartX = input.screenX;
    context.selection.setMode('edge');
    context.selection.selectObjects([this.lockedPick.objectId], 'replace');
    context.selection.selectEdges([this.lockedPick.edgeId], 'replace');
    this.refreshPreview(context);
  }

  update(input: ToolPointerInput, context: ModellingContext): void {
    if (this.state.phase === 'slide') {
      this.state.slide = clamp((input.screenX - this.slideStartX) * 0.01, -1, 1);
      this.refreshPreview(context);
      return;
    }

    const pick = this.viewportPick;
    if (!pick) {
      if (this.ring || this.previewSegments.length) {
        this.ring = null;
        this.previewSegments = [];
        this.state.lastError = null;
        this.touch(context);
      }
      return;
    }
    const mesh = meshFor(context, pick.objectId);
    const nextRing = mesh ? findLoopCutRing(mesh, pick.edgeId) : null;
    const changed =
      pick.objectId !== this.lockedPick?.objectId ||
      pick.edgeId !== this.lockedPick?.edgeId ||
      ringKey(nextRing) !== ringKey(this.ring);
    this.lockedPick = { ...pick };
    this.ring = nextRing;
    this.state.lastError = nextRing ? null : 'Loop Cut requires a continuous quad ring';
    if (changed) this.refreshPreview(context);
  }

  adjustCutCount(delta: number, context: ModellingContext): void {
    const next = Math.max(1, Math.min(MAX_CUTS, this.state.cutCount + delta));
    if (next === this.state.cutCount) return;
    this.state.cutCount = next;
    this.refreshPreview(context);
  }

  centreAndConfirm(context: ModellingContext): boolean {
    if (this.state.phase !== 'slide') {
      this.cancel(context);
      return true;
    }
    this.state.slide = 0;
    return this.confirm(context);
  }

  preview(_context: ModellingContext): void {}

  confirm(context: ModellingContext): boolean {
    const pick = this.lockedPick;
    const mesh = pick ? meshFor(context, pick.objectId) : null;
    if (!pick || !mesh || !this.ring) {
      this.state.lastError = 'No loop selected';
      this.touch(context);
      return false;
    }
    const count = this.state.cutCount;
    const result = runMeshTransaction(
      context.history,
      mesh,
      count === 1 ? 'Loop Cut' : `Loop Cut (${count})`,
      (target) => {
        const cut = loopCutMulti(target, pick.edgeId, this.factors());
        if (!cut.ok) throw new Error(cut.error?.message ?? 'Loop cut failed');
        context.selection.applyTopologyChange(cut.change);
        return cut;
      },
      { fullValidation: true, selection: context.selection },
    );
    if (!result.ok) {
      this.state.lastError = result.error ?? 'Loop cut failed';
      this.touch(context);
      return false;
    }
    this.reset();
    context.requestRedraw();
    return true;
  }

  cancel(context: ModellingContext): void {
    this.reset();
    context.requestRedraw();
  }

  getAllowedSelectionModes() {
    return ['edge', 'object', 'face'] as const;
  }

  getSnapPolicy() {
    return ['edge'] as const;
  }

  private factors(): number[] {
    const spacing = 1 / (this.state.cutCount + 1);
    const offset = this.state.slide * spacing * 0.999;
    return Array.from(
      { length: this.state.cutCount },
      (_, index) => (index + 1) * spacing + offset,
    );
  }

  private refreshPreview(context: ModellingContext): void {
    const pick = this.lockedPick ?? this.viewportPick;
    const mesh = pick ? meshFor(context, pick.objectId) : null;
    if (!pick || !mesh || !this.ring) {
      this.previewSegments = [];
      this.touch(context);
      return;
    }
    const world = getObjectWorldTransform(context.document, pick.objectId);
    this.previewSegments = loopCutPreviewSegments(mesh, this.ring, this.factors()).map(
      ([a, b]) => [transformPoint(a, world), transformPoint(b, world)],
    );
    this.touch(context);
  }

  private reset(): void {
    this.state.phase = 'hover';
    this.state.cutCount = 1;
    this.state.slide = 0;
    this.state.lastError = null;
    this.viewportPick = null;
    this.lockedPick = null;
    this.ring = null;
    this.slideStartX = 0;
    this.previewSegments = [];
    this.state.revision += 1;
  }

  private touch(context: ModellingContext): void {
    this.state.revision += 1;
    context.requestRedraw();
  }
}

function meshFor(context: ModellingContext, objectId: ObjectId) {
  const object = context.document.objects.get(objectId);
  return object?.meshId ? context.document.meshes.get(object.meshId) ?? null : null;
}

function ringKey(ring: LoopCutRing | null): string {
  return ring ? `${ring.closed ? 'c' : 'o'}:${ring.edgeIds.join(',')}` : '';
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
