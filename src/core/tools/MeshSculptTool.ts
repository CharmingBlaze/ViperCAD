import { cloneVec3, normalizeVec3, scaleVec3, subVec3, type Vec3 } from '@/core/math/Vec3';
import { bumpPositions } from '@/core/mesh/EditableMesh';
import type { EditableMesh, VertexId } from '@/core/mesh/types';
import {
  applyMeshBrush,
  collectBrushVertices,
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

const MAX_STAMP_STEPS = 16;

export class MeshSculptTool implements Tool {
  id = 'mesh-sculpt' as const;
  label = 'Mesh Sculpt';
  mode: MeshBrushMode = 'clay';
  falloff: SculptFalloff = 'smooth';
  radius = 0.35;
  strength = 0.12;
  hardness = 0.28;
  spacing = 0.14;
  buildUp = 1;
  preserveVolume = 0.75;
  pressureRadius = true;
  pressureStrength = true;
  usePressure = true;
  frontFacesOnly = true;
  flattenPlanePoint: Vec3 = { x: 0, y: 0, z: 0 };
  flattenPlaneNormal: Vec3 = { x: 0, y: 1, z: 0 };
  flattenPlaneSampled = false;
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
  private lastNormal: Vec3 | null = null;

  activate(context: ModellingContext): void {
    this.dragging = false;
    this.lastPoint = null;
    this.lastNormal = null;
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
      this.flattenPlaneSampled = true;
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
    if (this.mode === 'flatten' && !this.flattenPlaneSampled) {
      this.flattenPlanePoint = cloneVec3(hit.localPosition);
      this.flattenPlaneNormal = cloneVec3(hit.localNormal);
    }
    this.dragging = true;
    this.lastPoint = null;
    this.lastNormal = null;
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

    this.resetStroke();
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
    this.resetStroke();
    this.revision += 1;
    context.requestRedraw();
  }

  statusLine(): string {
    const flattenHint = this.mode === 'flatten' || this.mode === 'scrape'
      ? ' · Alt+click sample plane'
      : '';
    return `${this.mode} · radius ${this.radius.toFixed(2)} · strength ${this.strength.toFixed(2)} · Shift smooth · Ctrl invert · wheel size · Ctrl+wheel strength${flattenHint}`;
  }

  getAllowedSelectionModes() { return ['object'] as const; }
  getSnapPolicy() { return [] as const; }

  private resetStroke(): void {
    this.dragging = false;
    this.strokeInitialPositions = null;
    this.touchedVertexIds.clear();
    this.strokeBase = null;
    this.targetMesh = null;
    this.targetObjectId = null;
    this.grabAnchor = null;
    this.lastPoint = null;
    this.lastNormal = null;
    this.stabilizer.reset();
  }

  private stylusPressure(input: ToolPointerInput): number {
    if (!this.usePressure) return 1;
    return Math.max(0.05, Math.min(1, input.pressure ?? 1));
  }

  private applyAt(
    input: ToolPointerInput,
    context: ModellingContext,
    point: Vec3,
    normal: Vec3,
  ): void {
    const mesh = this.targetMesh;
    const strokeBase = this.strokeBase;
    if (!mesh || !strokeBase) return;

    const effectiveMode = (input.shiftKey && this.mode !== 'smooth') ? 'smooth' : this.mode;
    const invert = input.ctrlKey;
    const stylus = this.stylusPressure(input);
    const effRadius = this.pressureRadius
      ? this.radius * (0.3 + 0.7 * stylus)
      : this.radius;
    const effStrength = this.pressureStrength
      ? this.strength * (0.2 + 0.8 * stylus)
      : this.strength;
    const mask = getMeshMask(mesh.id);

    const applyPoint = (localPoint: Vec3, localNormal: Vec3, strokeDelta?: Vec3) => {
      const nearby = collectBrushVertices(mesh, localPoint, effRadius, this.falloff, {
        hardness: this.hardness,
        frontFacesOnly: this.frontFacesOnly,
        surfaceNormal: localNormal,
      });
      const primaryBefore = new Map<VertexId, Vec3>();
      for (const item of nearby) {
        const vertex = mesh.vertices.get(item.id);
        if (vertex) primaryBefore.set(item.id, cloneVec3(vertex.position));
      }

      const grabDelta =
        effectiveMode === 'grab' && this.grabAnchor
          ? subVec3(localPoint, this.grabAnchor)
          : undefined;
      const brushCenter =
        effectiveMode === 'grab' && this.grabAnchor ? this.grabAnchor : localPoint;

      applyMeshBrush(
        mesh,
        effectiveMode,
        brushCenter,
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
          contactNormal: localNormal,
          mask,
          hardness: this.hardness,
          pressure: 1,
          buildUp: this.buildUp,
          frontFacesOnly: this.frontFacesOnly,
          surfaceNormal: localNormal,
          preserveVolume: this.preserveVolume,
        },
      );

      for (const [id, beforePos] of primaryBefore) {
        const vertex = mesh.vertices.get(id);
        if (
          vertex &&
          (vertex.position.x !== beforePos.x ||
            vertex.position.y !== beforePos.y ||
            vertex.position.z !== beforePos.z)
        ) {
          this.touchedVertexIds.add(id);
        }
      }

      if (context.document.settings.symmetry.liveMirror && primaryBefore.size) {
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
      applyPoint(point, normal);
      this.lastPoint = cloneVec3(point);
      this.lastNormal = cloneVec3(normal);
    } else {
      const strokeDelta = subVec3(point, previous);
      const distance = Math.hypot(strokeDelta.x, strokeDelta.y, strokeDelta.z);
      const stampSpacing = Math.max(0.005, effRadius * this.spacing);
      if (distance < stampSpacing * 0.25) return;
      const steps = Math.min(MAX_STAMP_STEPS, Math.max(1, Math.ceil(distance / stampSpacing)));
      const previousNormal = this.lastNormal ?? normal;
      for (let step = 1; step <= steps; step++) {
        const t = step / steps;
        applyPoint(
          {
            x: previous.x + (point.x - previous.x) * t,
            y: previous.y + (point.y - previous.y) * t,
            z: previous.z + (point.z - previous.z) * t,
          },
          normalizeVec3({
            x: previousNormal.x + (normal.x - previousNormal.x) * t,
            y: previousNormal.y + (normal.y - previousNormal.y) * t,
            z: previousNormal.z + (normal.z - previousNormal.z) * t,
          }),
          scaleVec3(strokeDelta, 1 / steps),
        );
      }
      this.lastPoint = cloneVec3(point);
      this.lastNormal = cloneVec3(normal);
    }
    bumpPositions(mesh);
    context.document.dirty = true;
    this.revision += 1;
    context.requestRedraw();
  }
}
