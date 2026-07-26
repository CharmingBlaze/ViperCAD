import { cloneVec3, type Vec3 } from '@/core/math/Vec3';
import { inverseTransformPointApprox, type Transform } from '@/core/math/Transform';
import { bumpPositions } from '@/core/mesh/EditableMesh';
import type { EditableMesh, VertexId } from '@/core/mesh/types';
import type { ModellingContext, Tool, ToolPointerInput } from '@/core/tools/Tool';

export type TerrainBrushMode = 'raise' | 'lower' | 'smooth' | 'flatten' | 'noise';
export type TerrainFalloff = 'smooth' | 'linear' | 'sharp';

export class TerrainSculptTool implements Tool {
  id = 'terrain-sculpt' as const;
  label = 'Terrain Sculpt';
  mode: TerrainBrushMode = 'raise';
  falloff: TerrainFalloff = 'smooth';
  radius = 2.5;
  strength = 0.35;
  flattenHeight = 0;
  dragging = false;
  revision = 0;
  private before: Map<VertexId, Vec3> | null = null;
  private targetMesh: EditableMesh | null = null;
  private lastPoint: Vec3 | null = null;

  activate(context: ModellingContext): void {
    this.dragging = false;
    this.lastPoint = null;
    context.requestRedraw();
  }

  deactivate(context: ModellingContext): void {
    if (this.dragging) this.cancel(context);
  }

  setMode(mode: TerrainBrushMode, context: ModellingContext): void {
    this.mode = mode;
    this.revision += 1;
    context.requestRedraw();
  }

  setRadius(radius: number, context: ModellingContext): void {
    this.radius = clamp(radius, 0.1, 100);
    this.revision += 1;
    context.requestRedraw();
  }

  setStrength(strength: number, context: ModellingContext): void {
    this.strength = clamp(strength, 0.001, 10);
    this.revision += 1;
    context.requestRedraw();
  }

  begin(input: ToolPointerInput, context: ModellingContext): void {
    if (input.button !== 'left' || !input.worldPosition) return;
    const target = terrainFromContext(context);
    if (!target) return;
    this.targetMesh = target.mesh;
    this.before = snapshot(target.mesh);
    this.dragging = true;
    this.lastPoint = null;
    this.applyAt(input, context, target.object.transform);
  }

  update(input: ToolPointerInput, context: ModellingContext): void {
    if (!this.dragging || !input.worldPosition || !this.targetMesh) return;
    const target = terrainFromContext(context);
    if (!target || target.mesh !== this.targetMesh) return;
    this.applyAt(input, context, target.object.transform);
  }

  endStroke(context: ModellingContext): boolean {
    if (!this.dragging || !this.before || !this.targetMesh) return false;
    const mesh = this.targetMesh;
    const before = this.before;
    const after = snapshot(mesh);
    let applied = true;
    context.history.execute({
      name: `Terrain ${this.mode[0]!.toUpperCase()}${this.mode.slice(1)}`,
      execute: () => {
        if (applied) return;
        restore(mesh, after);
        context.document.dirty = true;
        context.requestRedraw();
        applied = true;
      },
      undo: () => {
        restore(mesh, before);
        context.document.dirty = true;
        context.requestRedraw();
        applied = false;
      },
    });
    this.dragging = false;
    this.before = null;
    this.targetMesh = null;
    this.lastPoint = null;
    this.revision += 1;
    context.requestRedraw();
    return true;
  }

  preview(_context: ModellingContext): void {}
  confirm(context: ModellingContext): void { this.endStroke(context); }

  cancel(context: ModellingContext): void {
    if (this.before && this.targetMesh) restore(this.targetMesh, this.before);
    this.dragging = false;
    this.before = null;
    this.targetMesh = null;
    this.lastPoint = null;
    this.revision += 1;
    context.requestRedraw();
  }

  statusLine(): string {
    return `${this.mode} terrain · radius ${this.radius.toFixed(1)} · strength ${this.strength.toFixed(2)} · Shift invert`;
  }

  getAllowedSelectionModes() { return ['object'] as const; }
  getSnapPolicy() { return [] as const; }

  private applyAt(
    input: ToolPointerInput,
    context: ModellingContext,
    transform: Transform,
  ): void {
    const mesh = this.targetMesh;
    if (!mesh || !input.worldPosition) return;
    const point = inverseTransformPointApprox(input.worldPosition, transform);
    const previous = this.lastPoint;
    if (!previous) {
      this.applyBrush(mesh, point, input.shiftKey);
      this.lastPoint = cloneVec3(point);
    } else {
      const distance = Math.hypot(point.x - previous.x, point.z - previous.z);
      if (distance < this.radius * 0.06) return;
      const steps = Math.max(1, Math.ceil(distance / Math.max(0.02, this.radius * 0.18)));
      for (let step = 1; step <= steps; step++) {
        const t = step / steps;
        this.applyBrush(mesh, {
          x: previous.x + (point.x - previous.x) * t,
          y: previous.y + (point.y - previous.y) * t,
          z: previous.z + (point.z - previous.z) * t,
        }, input.shiftKey);
      }
      this.lastPoint = cloneVec3(point);
    }
    bumpPositions(mesh);
    context.document.dirty = true;
    this.revision += 1;
    context.requestRedraw();
  }

  private applyBrush(mesh: EditableMesh, point: Vec3, shiftKey: boolean): void {
    const affected: Array<{ id: VertexId; weight: number }> = [];
    for (const vertex of mesh.vertices.values()) {
      const distance = Math.hypot(vertex.position.x - point.x, vertex.position.z - point.z);
      if (distance > this.radius) continue;
      affected.push({ id: vertex.id, weight: falloffWeight(distance / this.radius, this.falloff) });
    }
    if (!affected.length) return;

    const average = affected.reduce(
      (sum, item) => sum + mesh.vertices.get(item.id)!.position.y,
      0,
    ) / affected.length;
    const invert = shiftKey ? -1 : 1;
    for (const item of affected) {
      const vertex = mesh.vertices.get(item.id)!;
      const amount = this.strength * item.weight;
      if (this.mode === 'raise') vertex.position.y += amount * invert;
      else if (this.mode === 'lower') vertex.position.y -= amount * invert;
      else if (this.mode === 'smooth') vertex.position.y += (average - vertex.position.y) * Math.min(1, amount);
      else if (this.mode === 'flatten') vertex.position.y += (this.flattenHeight - vertex.position.y) * Math.min(1, amount);
      else {
        const noise = Math.sin(vertex.position.x * 12.9898 + vertex.position.z * 78.233) * 43758.5453;
        vertex.position.y += ((noise - Math.floor(noise)) * 2 - 1) * amount * invert;
      }
    }
  }
}

function terrainFromContext(context: ModellingContext) {
  const objectId = context.selection.state.activeObjectId;
  const object = objectId ? context.document.objects.get(objectId) : null;
  const mesh = object?.meshId ? context.document.meshes.get(object.meshId) : null;
  return object?.metadata.terrain === 'true' && mesh ? { object, mesh } : null;
}

function snapshot(mesh: EditableMesh): Map<VertexId, Vec3> {
  return new Map([...mesh.vertices].map(([id, vertex]) => [id, cloneVec3(vertex.position)]));
}

function restore(mesh: EditableMesh, positions: Map<VertexId, Vec3>): void {
  for (const [id, position] of positions) {
    const vertex = mesh.vertices.get(id);
    if (vertex) vertex.position = cloneVec3(position);
  }
  bumpPositions(mesh);
}

function falloffWeight(t: number, falloff: TerrainFalloff): number {
  const x = Math.max(0, Math.min(1, 1 - t));
  if (falloff === 'linear') return x;
  if (falloff === 'sharp') return x * x * x;
  return x * x * (3 - 2 * x);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Number(value) || min));
}
