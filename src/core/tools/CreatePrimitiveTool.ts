import { commitMeshObject } from '@/core/document/ModelDocument';
import {
  addVec3,
  crossVec3,
  dotVec3,
  lengthSqVec3,
  normalizeVec3,
  scaleVec3,
  subVec3,
  type Vec3,
} from '@/core/math/Vec3';
import { validateMeshFull } from '@/core/mesh/Validation';
import { buildPrimitiveInCage, clampPrimitiveParameters, defaultPrimitiveParameters, localizePrimitiveMesh, PRIMITIVE_LABELS, type ComplexityPreset, type PrimitiveConstructionCage, type PrimitiveKind, type PrimitiveParameters } from '@/core/primitives/PrimitiveFactory';
import { cloneSelection, type SelectionState } from '@/core/selection/SelectionManager';
import { SNAP_TARGET_LABELS, rayPlaneIntersection, resolveSnap, type ConstructionPlane } from '@/core/snap/SnapEngine';
import type { ModellingContext, Tool, ToolPointerInput } from './Tool';

export type PrimitiveDrawStage = 'idle' | 'base' | 'height';
export type PrimitiveDimensions = { width: number; height: number; depth: number };
export type PrimitivePreviewState = { stage: PrimitiveDrawStage; kind: PrimitiveKind; cornerA: Vec3 | null; cornerB: Vec3 | null; normalDistance: number; plane: ConstructionPlane | null; constructionPlaneId: string; fromCentre: boolean; proportional: boolean; snapLabel: string; revision: number };

export class CreatePrimitiveTool implements Tool {
  id = 'create-primitive' as const;
  label = 'Create Primitive';
  parameters: PrimitiveParameters = defaultPrimitiveParameters('box');
  state: PrimitivePreviewState = this.emptyState('box');
  private previousSelection: SelectionState | null = null;
  /** Screen anchor for height drag when the camera looks along the extrusion axis. */
  private heightScreenAnchor: { screenY: number; startHeight: number } | null = null;

  activate(context: ModellingContext): void { this.cancel(context); }
  deactivate(context: ModellingContext): void { this.cancel(context); }

  selectPrimitive(kind: PrimitiveKind, context: ModellingContext): void {
    this.cancel(context); this.parameters = defaultPrimitiveParameters(kind, this.parameters.preset); this.state = this.emptyState(kind); context.requestRedraw();
  }

  setPreset(preset: ComplexityPreset, context: ModellingContext): void { this.parameters = defaultPrimitiveParameters(this.state.kind, preset); this.touch(context); }
  setParameters(patch: Partial<PrimitiveParameters>, context: ModellingContext): void { this.parameters = clampPrimitiveParameters({ ...this.parameters, ...patch, preset: patch.preset ?? 'custom' }); this.touch(context); }

  begin(input: ToolPointerInput, context: ModellingContext): void {
    if (input.button !== 'left') return;
    if (this.state.stage === 'idle') {
      const hit = this.hitOnPlane(input, context.constructionPlane, context); if (!hit) return;
      this.previousSelection = cloneSelection(context.selection.state);
      this.state = { ...this.state, stage: 'base', cornerA: hit.position, cornerB: hit.position, plane: { ...context.constructionPlane }, constructionPlaneId: context.constructionPlaneId ?? 'custom', fromCentre: input.altKey, proportional: input.shiftKey, snapLabel: hit.label, revision: this.state.revision + 1 };
      context.requestRedraw(); return;
    }
    if (this.state.stage === 'base') {
      const hit = this.hitOnPlane(input, this.state.plane!, context); if (hit) this.state.cornerB = this.constrainBase(hit.position, input.shiftKey);
      if (!this.validBase(context)) return;
      if (this.state.kind === 'plane') { this.confirm(context); return; }
      this.state.stage = 'height';
      this.heightScreenAnchor = null;
      // Seed a visible default height so ortho views show extrusion immediately.
      const base = this.getCage();
      if (base && Math.abs(this.state.normalDistance) < this.tolerance(context)) {
        this.state.normalDistance = Math.max(base.sizeU, base.sizeV, context.gridSize || 1);
      }
      this.touch(context);
      return;
    }
    this.state.normalDistance = this.computeNormalDistance(input, context);
    this.confirm(context);
  }

  update(input: ToolPointerInput, context: ModellingContext): void {
    if (this.state.stage === 'base') {
      const hit = this.hitOnPlane(input, this.state.plane!, context);
      if (hit) {
        this.state.cornerB = this.constrainBase(hit.position, input.shiftKey);
        this.state.fromCentre = input.altKey;
        this.state.proportional = input.shiftKey;
        this.state.snapLabel = hit.label;
        this.touch(context);
      }
    } else if (this.state.stage === 'height') {
      this.state.normalDistance = this.computeNormalDistance(input, context);
      if (input.shiftKey) this.applyProportionalHeight();
      this.touch(context);
    }
  }

  preview(_context: ModellingContext): void {}

  confirm(context: ModellingContext): void {
    if (!this.state.cornerA || !this.state.cornerB || !this.state.plane) return;
    if (!this.validBase(context)) return;

    // Ortho views often leave height at 0; Enter / third-click must still finalize.
    if (this.state.kind !== 'plane') {
      const tolerance = this.tolerance(context);
      if (Math.abs(this.state.normalDistance) < tolerance) {
        const base = this.getCage();
        const fallback = Math.max(
          base?.sizeU ?? 0,
          base?.sizeV ?? 0,
          context.gridSize || 1,
        );
        this.state.normalDistance = Math.sign(this.state.normalDistance || 1) * fallback;
      }
    }

    const cage = this.getCage();
    if (!cage) return;
    const tolerance = this.tolerance(context);
    if (
      cage.sizeU < tolerance ||
      cage.sizeV < tolerance ||
      (this.state.kind !== 'plane' && cage.sizeNormal < tolerance)
    ) {
      return;
    }
    const mesh = buildPrimitiveInCage(this.state.kind, cage, this.parameters); const validation = validateMeshFull(mesh);
    if (!validation.ok) throw new Error(`Cannot create ${PRIMITIVE_LABELS[this.state.kind]}: ${validation.issues.filter((i) => i.severity === 'error').map((i) => i.message).join('; ')}`);
    const beforeSelection = this.previousSelection ? cloneSelection(this.previousSelection) : cloneSelection(context.selection.state);
    const localized = localizePrimitiveMesh(mesh, cage);
    const { objectId, meshId } = commitMeshObject(context.document, mesh, { name: PRIMITIVE_LABELS[this.state.kind] }); const object = context.document.objects.get(objectId)!; const meshRef = context.document.meshes.get(meshId)!;
    object.transform.position = localized.position;
    object.metadata.primitiveOperation = JSON.stringify({
      kind: this.state.kind,
      cage: localized.cage,
      parameters: this.parameters,
    });
    context.selection.setMode('object'); context.selection.selectObjects([objectId], 'replace'); const afterSelection = cloneSelection(context.selection.state); let applied = true;
    context.history.execute({ name: `Create ${PRIMITIVE_LABELS[this.state.kind]}`, execute: () => { if (applied) return; context.document.objects.set(object.id, object); context.document.meshes.set(meshRef.id, meshRef); if (!context.document.rootObjectIds.includes(object.id)) context.document.rootObjectIds.push(object.id); context.selection.state = cloneSelection(afterSelection); context.document.dirty = true; applied = true; }, undo: () => { context.document.objects.delete(object.id); context.document.rootObjectIds = context.document.rootObjectIds.filter((id) => id !== object.id); if (![...context.document.objects.values()].some((o) => o.meshId === meshRef.id)) context.document.meshes.delete(meshRef.id); context.selection.state = cloneSelection(beforeSelection); context.document.dirty = true; applied = false; } });
    const kind = this.state.kind;
    this.previousSelection = null;
    this.heightScreenAnchor = null;
    this.state = this.emptyState(kind);
    context.requestRedraw();
  }

  cancel(context: ModellingContext): void {
    const kind = this.state.kind;
    if (this.previousSelection) context.selection.state = cloneSelection(this.previousSelection);
    this.previousSelection = null;
    this.heightScreenAnchor = null;
    this.state = this.emptyState(kind);
    context.requestRedraw();
  }
  getAllowedSelectionModes() { return ['object'] as const; }
  getSnapPolicy() { return ['grid', 'vertex', 'edge', 'edgeMid', 'face', 'faceCentre', 'origin'] as const; }

  getCage(previewStability = false): PrimitiveConstructionCage | null {
    const { cornerA, cornerB, plane } = this.state; if (!cornerA || !cornerB || !plane) return null;
    const d = subVec3(cornerB, cornerA); let u = dotVec3(d, plane.xAxis), v = dotVec3(d, plane.yAxis); if (this.state.proportional) { const s = Math.max(Math.abs(u), Math.abs(v)); u = Math.sign(u || 1) * s; v = Math.sign(v || 1) * s; }
    let origin: Vec3, sizeU: number, sizeV: number;
    if (this.state.fromCentre) { sizeU = Math.abs(u) * 2; sizeV = Math.abs(v) * 2; origin = addVec3(cornerA, addVec3(scaleVec3(plane.xAxis, -Math.abs(u)), scaleVec3(plane.yAxis, -Math.abs(v)))); }
    else { sizeU = Math.abs(u); sizeV = Math.abs(v); origin = addVec3(cornerA, addVec3(scaleVec3(plane.xAxis, Math.min(0, u)), scaleVec3(plane.yAxis, Math.min(0, v)))); }
    let normal = this.state.kind === 'plane' ? 0 : Math.abs(this.state.normalDistance); const direction: 1 | -1 = this.state.normalDistance < 0 ? -1 : 1;
    if (this.state.normalDistance < 0) origin = addVec3(origin, scaleVec3(plane.normal, -normal));
    if (previewStability && normal === 0) normal = Math.max(0.0001, Math.min(sizeU, sizeV) * 0.015);
    return { origin, axisU: plane.xAxis, axisV: plane.yAxis, axisNormal: plane.normal, sizeU, sizeV, sizeNormal: normal, minLocal: { x: 0, y: 0, z: 0 }, maxLocal: { x: sizeU, y: normal, z: sizeV }, constructionPlaneId: this.state.constructionPlaneId, creationDirection: direction };
  }

  getPreviewMesh() { const cage = this.getCage(true); return cage && this.validBaseRaw() ? buildPrimitiveInCage(this.state.kind, cage, this.parameters) : null; }

  getDimensions(): PrimitiveDimensions {
    const c = this.getCage(); if (!c) return { width: 0, height: 0, depth: 0 };
    if (c.constructionPlaneId === 'front') return { width: c.sizeU, height: c.sizeV, depth: c.sizeNormal };
    if (c.constructionPlaneId === 'right') return { width: c.sizeNormal, height: c.sizeV, depth: c.sizeU };
    return { width: c.sizeU, height: c.sizeNormal, depth: c.sizeV };
  }

  setDimensions(dimensions: Partial<PrimitiveDimensions>, context: ModellingContext): void {
    if (!this.state.cornerA || !this.state.plane) return; const current = this.getDimensions(); const d = { ...current, ...dimensions }; let u=d.width,v=d.depth,h=d.height;
    if(this.state.constructionPlaneId==='front'){u=d.width;v=d.height;h=d.depth;}else if(this.state.constructionPlaneId==='right'){u=d.depth;v=d.height;h=d.width;}
    this.state.cornerB=addVec3(this.state.cornerA,addVec3(scaleVec3(this.state.plane.xAxis,u),scaleVec3(this.state.plane.yAxis,v)));this.state.normalDistance=Math.sign(this.state.normalDistance||1)*h;this.touch(context);
  }

  private constrainBase(point: Vec3, proportional: boolean): Vec3 { if (!proportional || !this.state.cornerA || !this.state.plane) return point; const d=subVec3(point,this.state.cornerA),u=dotVec3(d,this.state.plane.xAxis),v=dotVec3(d,this.state.plane.yAxis),s=Math.max(Math.abs(u),Math.abs(v));return addVec3(this.state.cornerA,addVec3(scaleVec3(this.state.plane.xAxis,Math.sign(u||1)*s),scaleVec3(this.state.plane.yAxis,Math.sign(v||1)*s))); }
  private hitOnPlane(input: ToolPointerInput, plane: ConstructionPlane, context: ModellingContext) { const raw=rayPlaneIntersection(input.rayOrigin,input.rayDirection,plane)??input.worldPosition;if(!raw)return null;const snap=(context.snapEnabled!==input.ctrlKey)?context.resolveSnap({rawPosition:raw,pointerRayOrigin:input.rayOrigin,pointerRayDirection:input.rayDirection,plane,allowed:[...this.getSnapPolicy()],gridSize:context.gridSize}):resolveSnap({rawPosition:raw,plane,allowed:[]});return{position:snap.position,label:SNAP_TARGET_LABELS[snap.targetType]}; }
  /**
   * Extrusion height along the construction-plane normal.
   * Perspective / angled views: intersect a camera-facing plane containing the normal.
   * Top/Front/Right (ray ≈ along normal): map vertical screen drag to world height.
   */
  private computeNormalDistance(input: ToolPointerInput, context: ModellingContext): number {
    if (!this.state.cornerB || !this.state.plane) return 0;
    const n = this.state.plane.normal;
    const origin = this.state.cornerB;
    const view = normalizeVec3(input.rayDirection);
    const alongNormal = Math.abs(dotVec3(view, n)) > 0.92;

    let h: number;
    if (alongNormal) {
      // Screen-space height — the only reliable signal when looking along the axis.
      if (!this.heightScreenAnchor) {
        this.heightScreenAnchor = {
          screenY: input.screenY,
          startHeight: this.state.normalDistance || 0,
        };
      }
      const units = input.worldUnitsPerPixel ?? 0.01;
      const delta = (this.heightScreenAnchor.screenY - input.screenY) * units;
      h = this.heightScreenAnchor.startHeight + delta;
    } else {
      this.heightScreenAnchor = null;
      let side = crossVec3(n, view);
      if (lengthSqVec3(side) < 1e-10) {
        side =
          Math.abs(n.y) < 0.9
            ? crossVec3(n, { x: 0, y: 1, z: 0 })
            : crossVec3(n, { x: 1, y: 0, z: 0 });
      }
      side = normalizeVec3(side);
      const faceCamera = normalizeVec3(crossVec3(side, n));
      const hit = rayPlaneIntersection(input.rayOrigin, input.rayDirection, {
        origin,
        normal: faceCamera,
        xAxis: side,
        yAxis: n,
      });
      h = hit ? dotVec3(subVec3(hit, origin), n) : this.state.normalDistance;
    }

    if (context.snapEnabled !== input.ctrlKey) {
      const g = context.gridSize || 1;
      h = Math.round(h / g) * g;
    }
    return h;
  }
  private applyProportionalHeight(){const cage=this.getCage();if(!cage)return;this.state.normalDistance=Math.sign(this.state.normalDistance||1)*Math.max(cage.sizeU,cage.sizeV);}
  private validBase(context:ModellingContext){const c=this.getCage();return !!c&&c.sizeU>=this.tolerance(context)&&c.sizeV>=this.tolerance(context);}
  private validBaseRaw(){const c=this.getCage();return !!c&&c.sizeU>1e-8&&c.sizeV>1e-8;}
  private tolerance(context:ModellingContext){return Math.max(1e-6,context.gridSize*1e-4);}
  private touch(context:ModellingContext){this.state.revision+=1;context.requestRedraw();}
  private emptyState(kind:PrimitiveKind):PrimitivePreviewState{return{stage:'idle',kind,cornerA:null,cornerB:null,normalDistance:0,plane:null,constructionPlaneId:'top',fromCentre:false,proportional:false,snapLabel:'none',revision:0};}
}
