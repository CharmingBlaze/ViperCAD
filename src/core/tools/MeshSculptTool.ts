import { cloneVec3, scaleVec3, subVec3, type Vec3 } from '@/core/math/Vec3';
import { bumpPositions } from '@/core/mesh/EditableMesh';
import type { EditableMesh, VertexId } from '@/core/mesh/types';
import {
  applyMeshBrush,
  restoreVertexPositions,
  snapshotVertexPositions,
  type MeshBrushMode,
} from '@/core/sculpt/BrushOps';
import { clampSculpt, type SculptFalloff } from '@/core/sculpt/BrushFalloff';
import { getMeshMask } from '@/core/sculpt/SculptMask';
import { StrokeStabilizer } from '@/core/sculpt/StrokeStabilizer';
import { raycastSculptTarget } from '@/core/sculpt/MeshSculptTarget';
import { applyLiveSymmetricVertexEdit } from '@/core/symmetry/Symmetry';
import type { ModellingContext, Tool, ToolPointerInput } from '@/core/tools/Tool';

export type { MeshBrushMode, SculptFalloff };

export class MeshSculptTool implements Tool {
  id = 'mesh-sculpt' as const;
  label = 'Mesh Sculpt';
  mode: MeshBrushMode = 'clay';
  falloff: SculptFalloff = 'smooth';
  radius = 0.35;
  strength = 0.12;
  pressureRadius = true;
  pressureStrength = true;
  flattenPlanePoint: Vec3 = { x: 0, y: 0, z: 0 };
  flattenPlaneNormal: Vec3 = { x: 0, y: 1, z: 0 };
  dragging = false;
  revision = 0;
  stabilizer = new StrokeStabilizer();

  /** Last surface hit for brush preview. */
  previewHit: { position: Vec3; normal: Vec3 } | null = null;

  private strokeInitialPositions: Map<VertexId, Vec3> | null = null;
  private touchedVertexIds = new Set<VertexId>();
  private strokeBase: Map<VertexId, Vec3> | null = null;
  private targetMesh: EditableMesh | null = null;
  private targetObjectId: string | null = null;
  private grabAnchor: Vec3 | null = null;
  private lastPoint: Vec3 | null = null;

  activate(context: ModellingContext): void {
    this.dragging = false;
    this.lastPoint = null;
    this.previewHit = null;
    this.stabilizer.reset();
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

    if ((this.mode === 'flatten' || this.mode === 'scrape') && input.altKey) {
      this.flattenPlanePoint = cloneVec3(hit.localPosition);
      this.flattenPlaneNormal = cloneVec3(hit.localNormal);
      this.revision += 1;
      context.requestRedraw();
      return;
    }

    this.targetMesh = hit.mesh;
    this.targetObjectId = hit.object.id;
    this.strokeInitialPositions = snapshotVertexPositions(hit.mesh);
    this.touchedVertexIds.clear();
    this.strokeBase = snapshotVertexPositions(hit.mesh);
    this.grabAnchor = cloneVec3(hit.localPosition);
    this.dragging = true;
    this.lastPoint = null;
    this.stabilizer.reset();
    const hitPos = this.stabilizer.enabled
      ? this.stabilizer.update(hit.localPosition).smoothed
      : hit.localPosition;
    this.applyAt(input, context, hitPos, hit.localNormal);
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
    const hitPos = this.stabilizer.enabled
      ? this.stabilizer.update(hit.localPosition).smoothed
      : hit.localPosition;
    this.applyAt(input, context, hitPos, hit.localNormal);
  }

  endStroke(context: ModellingContext): boolean {
    if (!this.dragging || !this.strokeInitialPositions || !this.targetMesh) return false;
    const mesh = this.targetMesh;

    // Sparse undo snapshot: only store vertex positions that actually changed
    const beforeSparse = new Map<VertexId, Vec3>();
    const afterSparse = new Map<VertexId, Vec3>();

    for (const id of this.touchedVertexIds) {
      const initial = this.strokeInitialPositions.get(id);
      const current = mesh.vertices.get(id)?.position;
      if (initial && current && (
        initial.x !== current.x ||
        initial.y !== current.y ||
        initial.z !== current.z
      )) {
        beforeSparse.set(id, cloneVec3(initial));
        afterSparse.set(id, cloneVec3(current));
      }
    }

    if (afterSparse.size > 0) {
      let applied = true;
      context.history.execute({
        name: `Sculpt ${this.mode[0]!.toUpperCase()}${this.mode.slice(1)}`,
        execute: () => {
          if (applied) return;
          restoreVertexPositions(mesh, afterSparse);
          bumpPositions(mesh);
          context.document.dirty = true;
          context.requestRedraw();
          applied = true;
        },
        undo: () => {
          restoreVertexPositions(mesh, beforeSparse);
          bumpPositions(mesh);
          context.document.dirty = true;
          context.requestRedraw();
          applied = false;
        },
      });
    }

    this.dragging = false;
    this.strokeInitialPositions = null;
    this.touchedVertexIds.clear();
    this.strokeBase = null;
    this.targetMesh = null;
    this.targetObjectId = null;
    this.grabAnchor = null;
    this.lastPoint = null;
    this.stabilizer.reset();
    this.revision += 1;
    context.requestRedraw();
    return true;
  }

  preview(_context: ModellingContext): void {}
  confirm(context: ModellingContext): void { this.endStroke(context); }

  cancel(context: ModellingContext): void {
    if (this.strokeInitialPositions && this.targetMesh) {
      restoreVertexPositions(this.targetMesh, this.strokeInitialPositions);
      bumpPositions(this.targetMesh);
    }
    this.dragging = false;
    this.strokeInitialPositions = null;
    this.touchedVertexIds.clear();
    this.strokeBase = null;
    this.targetMesh = null;
    this.targetObjectId = null;
    this.grabAnchor = null;
    this.lastPoint = null;
    this.stabilizer.reset();
    this.revision += 1;
    context.requestRedraw();
  }

  statusLine(): string {
    const flattenHint = this.mode === 'flatten' || this.mode === 'scrape' ? ' · Alt+click sample plane' : '';
    return `${this.mode} · radius ${this.radius.toFixed(2)} · strength ${this.strength.toFixed(2)} · Shift smooth · Ctrl invert${flattenHint}`;
  }

  getAllowedSelectionModes() { return ['object'] as const; }
  getSnapPolicy() { return [] as const; }

  private applyAt(
    input: ToolPointerInput,
    context: ModellingContext,
    point: Vec3,
    contactNormal: Vec3,
  ): void {
    const mesh = this.targetMesh;
    const strokeBase = this.strokeBase;
    if (!mesh || !strokeBase) return;

    // Shift held down: standard DCC behavior switches any active brush to Smooth
    const effectiveMode = (input.shiftKey && this.mode !== 'smooth') ? 'smooth' : this.mode;
    // Ctrl held down: inverts brush action (or shift if already in smooth)
    const invert = input.ctrlKey;

    // Stylus pressure modulation
    const pressure = input.pressure ?? 1.0;
    const effRadius = this.pressureRadius
      ? this.radius * (0.3 + 0.7 * pressure)
      : this.radius;
    const effStrength = this.pressureStrength
      ? this.strength * (0.2 + 0.8 * pressure)
      : this.strength;

    const mask = getMeshMask(mesh.id);

    const applyPoint = (localPoint: Vec3, strokeDelta?: Vec3) => {
      const primaryBefore = snapshotVertexPositions(mesh);
      const grabDelta =
        effectiveMode === 'grab' && this.grabAnchor
          ? subVec3(localPoint, this.grabAnchor)
          : undefined;

      applyMeshBrush(
        mesh,
        effectiveMode,
        localPoint,
        effRadius,
        effectiveMode === 'smooth' && input.shiftKey ? Math.min(0.4, effStrength * 1.5) : effStrength,
        this.falloff,
        invert,
        {
          grabDelta,
          strokeDelta,
          strokeBase,
          flattenPlanePoint: this.flattenPlanePoint,
          flattenPlaneNormal: this.flattenPlaneNormal,
          contactNormal,
          mask,
        },
      );

      // Track modified vertices for sparse undo
      for (const [id, beforePos] of primaryBefore) {
        const v = mesh.vertices.get(id);
        if (v && (v.position.x !== beforePos.x || v.position.y !== beforePos.y || v.position.z !== beforePos.z)) {
          this.touchedVertexIds.add(id);
        }
      }

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
          for (const id of primaryAfter.keys()) {
            this.touchedVertexIds.add(id);
          }
        }
      }
    };

    const previous = this.lastPoint;
    if (!previous) {
      applyPoint(point);
      this.lastPoint = cloneVec3(point);
    } else {
      const strokeDelta = subVec3(point, previous);
      const distance = Math.hypot(strokeDelta.x, strokeDelta.y, strokeDelta.z);
      if (distance < effRadius * 0.06) return;
      const steps = Math.max(1, Math.ceil(distance / Math.max(0.01, effRadius * 0.18)));
      for (let step = 1; step <= steps; step++) {
        const t = step / steps;
        const subDelta = scaleVec3(strokeDelta, 1 / steps);
        applyPoint({
          x: previous.x + (point.x - previous.x) * t,
          y: previous.y + (point.y - previous.y) * t,
          z: previous.z + (point.z - previous.z) * t,
        }, subDelta);
      }
      this.lastPoint = cloneVec3(point);
    }
    bumpPositions(mesh);
    context.document.dirty = true;
    this.revision += 1;
    context.requestRedraw();
  }
}
