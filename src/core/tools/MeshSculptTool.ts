import { cloneVec3, subVec3, type Vec3 } from '@/core/math/Vec3';
import { bumpPositions } from '@/core/mesh/EditableMesh';
import type { EditableMesh, VertexId } from '@/core/mesh/types';
import {
  applyMeshBrush,
  restoreVertexPositions,
  snapshotVertexPositions,
  type MeshBrushMode,
} from '@/core/sculpt/BrushOps';
import { clampSculpt, type SculptFalloff } from '@/core/sculpt/BrushFalloff';
import { raycastSculptTarget } from '@/core/sculpt/MeshSculptTarget';
import { applyLiveSymmetricVertexEdit } from '@/core/symmetry/Symmetry';
import type { ModellingContext, Tool, ToolPointerInput } from '@/core/tools/Tool';

export type { MeshBrushMode, SculptFalloff };

export class MeshSculptTool implements Tool {
  id = 'mesh-sculpt' as const;
  label = 'Mesh Sculpt';
  mode: MeshBrushMode = 'inflate';
  falloff: SculptFalloff = 'smooth';
  radius = 0.35;
  strength = 0.08;
  flattenPlanePoint: Vec3 = { x: 0, y: 0, z: 0 };
  flattenPlaneNormal: Vec3 = { x: 0, y: 1, z: 0 };
  dragging = false;
  revision = 0;
  /** Last surface hit for brush preview. */
  previewHit: { position: Vec3; normal: Vec3 } | null = null;

  private before: Map<VertexId, Vec3> | null = null;
  private strokeBase: Map<VertexId, Vec3> | null = null;
  private targetMesh: EditableMesh | null = null;
  private targetObjectId: string | null = null;
  private grabAnchor: Vec3 | null = null;
  private lastPoint: Vec3 | null = null;

  activate(context: ModellingContext): void {
    this.dragging = false;
    this.lastPoint = null;
    this.previewHit = null;
    context.requestRedraw();
  }

  deactivate(context: ModellingContext): void {
    if (this.dragging) this.cancel(context);
  }

  setMode(mode: MeshBrushMode, context: ModellingContext): void {
    this.mode = mode;
    this.revision += 1;
    context.requestRedraw();
  }

  setRadius(radius: number, context: ModellingContext): void {
    this.radius = clampSculpt(radius, 0.02, 20);
    this.revision += 1;
    context.requestRedraw();
  }

  setStrength(strength: number, context: ModellingContext): void {
    this.strength = clampSculpt(strength, 0.001, 2);
    this.revision += 1;
    context.requestRedraw();
  }

  updatePreview(input: ToolPointerInput, context: ModellingContext): void {
    const hit = raycastSculptTarget(
      context.document,
      context.selection.state.activeObjectId,
      input.rayOrigin,
      input.rayDirection,
    );
    this.previewHit = hit
      ? { position: hit.worldPosition, normal: hit.worldNormal }
      : null;
  }

  begin(input: ToolPointerInput, context: ModellingContext): void {
    if (input.button !== 'left') return;
    const hit = raycastSculptTarget(
      context.document,
      context.selection.state.activeObjectId,
      input.rayOrigin,
      input.rayDirection,
    );
    if (!hit) return;
    this.previewHit = { position: hit.worldPosition, normal: hit.worldNormal };

    if (this.mode === 'flatten' && input.altKey) {
      this.flattenPlanePoint = cloneVec3(hit.localPosition);
      this.flattenPlaneNormal = cloneVec3(hit.localNormal);
      this.revision += 1;
      context.requestRedraw();
      return;
    }

    this.targetMesh = hit.mesh;
    this.targetObjectId = hit.object.id;
    this.before = snapshotVertexPositions(hit.mesh);
    this.strokeBase = snapshotVertexPositions(hit.mesh);
    this.grabAnchor = cloneVec3(hit.localPosition);
    this.dragging = true;
    this.lastPoint = null;
    this.applyAt(input, context, hit.localPosition);
  }

  update(input: ToolPointerInput, context: ModellingContext): void {
    this.updatePreview(input, context);
    if (!this.dragging || !this.targetMesh) return;
    const hit = raycastSculptTarget(
      context.document,
      this.targetObjectId,
      input.rayOrigin,
      input.rayDirection,
    );
    if (!hit || hit.mesh !== this.targetMesh) return;
    this.applyAt(input, context, hit.localPosition);
  }

  endStroke(context: ModellingContext): boolean {
    if (!this.dragging || !this.before || !this.targetMesh) return false;
    const mesh = this.targetMesh;
    const before = this.before;
    const after = snapshotVertexPositions(mesh);
    let applied = true;
    context.history.execute({
      name: `Sculpt ${this.mode[0]!.toUpperCase()}${this.mode.slice(1)}`,
      execute: () => {
        if (applied) return;
        restoreVertexPositions(mesh, after);
        bumpPositions(mesh);
        context.document.dirty = true;
        context.requestRedraw();
        applied = true;
      },
      undo: () => {
        restoreVertexPositions(mesh, before);
        bumpPositions(mesh);
        context.document.dirty = true;
        context.requestRedraw();
        applied = false;
      },
    });
    this.dragging = false;
    this.before = null;
    this.strokeBase = null;
    this.targetMesh = null;
    this.targetObjectId = null;
    this.grabAnchor = null;
    this.lastPoint = null;
    this.revision += 1;
    context.requestRedraw();
    return true;
  }

  preview(_context: ModellingContext): void {}
  confirm(context: ModellingContext): void { this.endStroke(context); }

  cancel(context: ModellingContext): void {
    if (this.before && this.targetMesh) {
      restoreVertexPositions(this.targetMesh, this.before);
      bumpPositions(this.targetMesh);
    }
    this.dragging = false;
    this.before = null;
    this.strokeBase = null;
    this.targetMesh = null;
    this.targetObjectId = null;
    this.grabAnchor = null;
    this.lastPoint = null;
    this.revision += 1;
    context.requestRedraw();
  }

  statusLine(): string {
    const flattenHint = this.mode === 'flatten' ? ' · Alt+click sample plane' : '';
    return `${this.mode} · radius ${this.radius.toFixed(2)} · strength ${this.strength.toFixed(2)} · Shift invert${flattenHint}`;
  }

  getAllowedSelectionModes() { return ['object'] as const; }
  getSnapPolicy() { return [] as const; }

  private applyAt(
    input: ToolPointerInput,
    context: ModellingContext,
    point: Vec3,
  ): void {
    const mesh = this.targetMesh;
    const strokeBase = this.strokeBase;
    if (!mesh || !strokeBase) return;

    const applyPoint = (localPoint: Vec3) => {
      const primaryBefore = snapshotVertexPositions(mesh);
      const grabDelta =
        this.mode === 'grab' && this.grabAnchor
          ? subVec3(localPoint, this.grabAnchor)
          : undefined;
      applyMeshBrush(mesh, this.mode, localPoint, this.radius, this.strength, this.falloff, input.shiftKey, {
        grabDelta,
        strokeBase,
        flattenPlanePoint: this.flattenPlanePoint,
        flattenPlaneNormal: this.flattenPlaneNormal,
      });

      if (context.document.settings.symmetry.liveMirror) {
        const primaryAfter = new Map<VertexId, Vec3>();
        for (const [id, beforePos] of primaryBefore) {
          const vertex = mesh.vertices.get(id);
          if (!vertex) continue;
          if (
            beforePos.x !== vertex.position.x ||
            beforePos.y !== vertex.position.y ||
            beforePos.z !== vertex.position.z
          ) {
            primaryAfter.set(id, cloneVec3(vertex.position));
          }
        }
        if (primaryAfter.size) {
          applyLiveSymmetricVertexEdit(
            mesh,
            primaryBefore,
            primaryAfter,
            context.document.settings.symmetry,
          );
        }
      }
    };

    const previous = this.lastPoint;
    if (!previous) {
      applyPoint(point);
      this.lastPoint = cloneVec3(point);
    } else {
      const distance = Math.hypot(
        point.x - previous.x,
        point.y - previous.y,
        point.z - previous.z,
      );
      if (distance < this.radius * 0.06) return;
      const steps = Math.max(1, Math.ceil(distance / Math.max(0.01, this.radius * 0.18)));
      for (let step = 1; step <= steps; step++) {
        const t = step / steps;
        applyPoint({
          x: previous.x + (point.x - previous.x) * t,
          y: previous.y + (point.y - previous.y) * t,
          z: previous.z + (point.z - previous.z) * t,
        });
      }
      this.lastPoint = cloneVec3(point);
    }
    bumpPositions(mesh);
    context.document.dirty = true;
    this.revision += 1;
    context.requestRedraw();
  }
}
