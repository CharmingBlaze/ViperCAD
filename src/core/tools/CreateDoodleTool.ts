import { commitMeshObject } from '@/core/document/ModelDocument';
import {
  applySimpleTextureToObject,
  defaultSimpleTextureSettings,
  type SimpleTextureSettings,
} from '@/core/curves/SimpleTexture';
import {
  addVec3,
  lengthSqVec3,
  normalizeVec3,
  scaleVec3,
  subVec3,
  type Vec3,
  v3,
} from '@/core/math/Vec3';
import type { EditableMesh } from '@/core/mesh/types';
import type {
  PathDistributionMode,
  PathOutput,
  PathProfile,
} from '@/core/mesh/builders/PathOutputBuilder';
import type { CurveSweepCapStyle } from '@/core/mesh/builders/CurveSweepBuilder';
import {
  doodleCloseDistance,
  isStrokeClosed,
  strokePathLength,
} from '@/core/mesh/builders/StrokeInflateBuilder';
import { validateMeshFull } from '@/core/mesh/Validation';
import { cloneSelection, type SelectionState } from '@/core/selection/SelectionManager';
import {
  curveOperationFromStroke,
  defaultBezierHandles,
  evaluateCurveOperation,
  isPathStyle,
  isWorkflowStyle,
  localizeCurveMesh,
  serializeCurveOperation,
  type CurveOperation,
  type CurveInputMode,
  type CurveSolidMode,
  type CurveStyle,
  type CurveType,
  type WorkflowKind,
} from '@/core/curves/CurveOperation';
import type { LatheAxis } from '@/core/mesh/builders/LatheBuilder';
export { smoothCurvePoints as smoothDoodlePoints } from '@/core/curves/CurveOperation';
import type { ModellingContext, Tool, ToolPointerInput } from './Tool';

export type DoodleDrawStage = 'idle' | 'drawing';
export type DoodlePolyPreset = 'low' | 'medium';
export type DoodleStyle = CurveStyle;

export type DoodleToolState = {
  stage: DoodleDrawStage;
  points: Vec3[];
  depth: number;
  revision: number;
  /** End returned near start — inflate on commit. */
  closed: boolean;
  /** Live segment endpoint for click-by-click Pen input. */
  previewPoint: Vec3 | null;
  handlesIn: Vec3[];
  handlesOut: Vec3[];
  /** Sketch stroke finished — nodes editable before commit. */
  strokeLocked: boolean;
};

const RADIAL: Record<DoodlePolyPreset, number> = { low: 6, medium: 10 };

/**
 * Free-air Paint 3D–style doodle:
 * open stroke → tube; connected loop → inflated low/mid-poly solid.
 */
export class CreateDoodleTool implements Tool {
  id = 'create-doodle' as const;
  label = '3D Doodle';
  radius = 0.08;
  preset: DoodlePolyPreset = 'low';
  style: DoodleStyle = 'soft';
  inputMode: CurveInputMode = 'sketch';
  curveType: CurveType = 'catmull-rom';
  solidMode: CurveSolidMode = 'extrude';
  latheAxis: LatheAxis = 'y';
  latheSegments = 16;
  latheProfileRings = 32;
  latheSmoothing = 0.15;
  latheAngle = 360;
  latheCaps = true;
  pathOutput: PathOutput = 'tube';
  startScale = 1;
  endScale = 1;
  twist = 0;
  profileWidth = 1;
  profileHeight = 1;
  blobInflation = 0.65;
  pathStartCap: CurveSweepCapStyle = 'flat';
  pathEndCap: CurveSweepCapStyle = 'flat';
  pathRadiusScale = 1;
  pathRadialSegments = 8;
  pathOffset = 0;
  pathSpacing = 1;
  pathProfile: PathProfile = 'round';
  pathChainAlternating = true;
  pathCardCrossed = false;
  pathDistributionMode: PathDistributionMode = 'spacing';
  pathCount = 8;
  pathStartPadding = 0;
  pathEndPadding = 0;
  pathRandomScale = 0;
  pathRotation = 0;
  pathRandomRotation = 0;
  pathAlternateRotation = false;
  pathMirrorAlternate = false;
  pathSeed = 1;
  pathKeepInstances = true;
  pathSourceObjectId: string | null = null;
  pathSourceMesh: EditableMesh | null = null;
  autoConnect = true;
  smoothDrawing = true;
  /** Blockout → Poly mode: click-corner silhouette solids. */
  blockoutPolyMode = false;
  simpleTextureSettings: SimpleTextureSettings = defaultSimpleTextureSettings();
  /** Curves vs Workflows — workflow-only styles and mesh rules stay isolated. */
  createContext: 'curves' | 'workflows' = 'curves';
  workflowKind: WorkflowKind | null = null;
  state: DoodleToolState = this.emptyState();
  private previousSelection: SelectionState | null = null;
  private strokePlaneOrigin: Vec3 | null = null;
  private strokePlaneNormal: Vec3 | null = null;
  private lastPointerPoint: Vec3 | null = null;

  activate(context: ModellingContext): void {
    this.cancel(context);
  }

  deactivate(context: ModellingContext): void {
    this.cancel(context);
  }

  setPreset(preset: DoodlePolyPreset, context: ModellingContext): void {
    this.preset = preset;
    this.touch(context);
  }

  setCreateContext(
    createContext: 'curves' | 'workflows',
    workflowKind: WorkflowKind | null,
    context: ModellingContext,
  ): void {
    this.createContext = createContext;
    this.workflowKind = createContext === 'workflows' ? workflowKind : null;
    if (createContext === 'curves') {
      this.blockoutPolyMode = false;
      if (isWorkflowStyle(this.style)) {
        this.style = 'soft';
      }
      this.pathStartCap = 'flat';
      this.pathEndCap = 'flat';
      this.pathSpacing = 1;
      this.pathCount = 8;
      this.radius = 0.08;
    } else {
      this.style =
        workflowKind === 'segmented-sweep' ? 'segmented-sweep' : 'profile-solid';
      this.solidMode = 'extrude';
      if (this.radius < 0.18) this.radius = 0.22;
      if (this.style === 'segmented-sweep') {
        this.pathStartCap = 'round';
        this.pathEndCap = 'round';
        this.pathCount = 4;
        this.pathSpacing = Math.max(this.pathSpacing, 1.5);
        this.pathRadialSegments = Math.max(8, Math.min(14, this.pathRadialSegments));
      } else if (this.pathRadialSegments < 10) {
        this.pathRadialSegments = 10;
      }
    }
    this.touch(context);
  }

  setStyle(style: DoodleStyle, context: ModellingContext): void {
    if (this.createContext === 'curves' && isWorkflowStyle(style)) return;
    if (this.createContext === 'workflows' && !isWorkflowStyle(style)) return;
    this.style = style;
    if (style === 'sharp' && this.inputMode === 'pen') {
      this.curveType = 'polyline';
      this.smoothDrawing = false;
    }
    if (style === 'capsule' && this.pathRadialSegments < 12) {
      this.pathRadialSegments = 12;
    }
    if (this.createContext === 'workflows') {
      if (style === 'profile-solid') {
        this.solidMode = 'extrude';
        if (this.pathRadialSegments < 10) this.pathRadialSegments = 10;
        this.pathCount = 6;
        this.blobInflation = 0.55;
        this.profileWidth = 1;
        this.profileHeight = 1;
        this.startScale = 1;
        this.endScale = 1;
      }
      if (style === 'segmented-sweep') {
        this.solidMode = 'extrude';
        this.pathRadialSegments = Math.max(8, Math.min(14, this.pathRadialSegments));
        this.pathCount = 4;
        this.pathSpacing = Math.max(this.pathSpacing, 1.5);
        if (this.radius < 0.18) this.radius = 0.22;
        this.pathStartCap = 'round';
        this.pathEndCap = 'round';
      }
    }
    if (this.state.stage === 'drawing') {
      this.state.closed =
        this.solidMode !== 'lathe' &&
        !isPathStyle(style) &&
        this.state.points.length >= 3;
    }
    this.touch(context);
  }

  setInputMode(mode: CurveInputMode, context: ModellingContext): void {
    if (mode === this.inputMode) return;
    this.cancel(context);
    this.inputMode = mode;
    if (mode === 'pen' && this.style === 'sharp') {
      this.curveType = 'polyline';
      this.smoothDrawing = false;
    }
    this.touch(context);
  }

  setCurveType(type: CurveType, context: ModellingContext): void {
    this.curveType = type;
    this.smoothDrawing = type !== 'polyline';
    this.touch(context);
  }

  setSolidMode(mode: CurveSolidMode, context: ModellingContext): void {
    this.solidMode = mode;
    if (mode === 'lathe') this.state.closed = false;
    this.touch(context);
  }

  setLatheSettings(
    settings: Partial<{
      axis: LatheAxis;
      segments: number;
      profileRings: number;
      smoothing: number;
      angle: number;
      caps: boolean;
    }>,
    context: ModellingContext,
  ): void {
    if (settings.axis) this.latheAxis = settings.axis;
    if (settings.segments != null) {
      this.latheSegments = Math.max(8, Math.min(64, Math.round(settings.segments)));
    }
    if (settings.profileRings != null) {
      this.latheProfileRings = Math.max(4, Math.min(128, Math.round(settings.profileRings)));
    }
    if (settings.smoothing != null) {
      this.latheSmoothing = Math.max(0, Math.min(1, settings.smoothing));
    }
    if (settings.angle != null) {
      this.latheAngle = Math.max(1, Math.min(360, settings.angle));
    }
    if (settings.caps != null) this.latheCaps = settings.caps;
    this.touch(context);
  }

  setSmoothDrawing(enabled: boolean, context: ModellingContext): void {
    this.smoothDrawing = enabled;
    this.touch(context);
  }

  setAutoConnect(enabled: boolean, context: ModellingContext): void {
    this.autoConnect = enabled;
    if (this.state.stage === 'drawing') {
      this.state.closed = this.shouldFill(this.state.points);
      if (!enabled) this.state.previewPoint = null;
    }
    this.touch(context);
  }

  setRadius(radius: number, context: ModellingContext): void {
    this.radius = Math.max(0.01, Math.min(2, radius));
    this.touch(context);
  }

  setSimpleTextureSettings(
    settings: SimpleTextureSettings,
    context: ModellingContext,
  ): void {
    this.simpleTextureSettings = { ...settings };
    this.touch(context);
  }

  setPathSettings(
    settings: Partial<{
      output: PathOutput;
      startScale: number;
      endScale: number;
      twist: number;
      profileWidth: number;
      profileHeight: number;
      blobInflation: number;
      startCap: CurveSweepCapStyle;
      endCap: CurveSweepCapStyle;
      radiusScale: number;
      radialSegments: number;
      offset: number;
      spacing: number;
      profile: PathProfile;
      chainAlternating: boolean;
      cardCrossed: boolean;
      distributionMode: PathDistributionMode;
      count: number;
      startPadding: number;
      endPadding: number;
      randomScale: number;
      rotation: number;
      randomRotation: number;
      alternateRotation: boolean;
      mirrorAlternate: boolean;
      seed: number;
      keepInstances: boolean;
      sourceObjectId: string | null;
      sourceMesh: EditableMesh | null;
    }>,
    context: ModellingContext,
  ): void {
    if (settings.output) this.pathOutput = settings.output;
    if (settings.startScale != null) this.startScale = clamp(settings.startScale, 0.02, 4);
    if (settings.endScale != null) this.endScale = clamp(settings.endScale, 0.02, 4);
    if (settings.twist != null) this.twist = clamp(settings.twist, -2160, 2160);
    if (settings.profileWidth != null) this.profileWidth = clamp(settings.profileWidth, 0.05, 4);
    if (settings.profileHeight != null) this.profileHeight = clamp(settings.profileHeight, 0.05, 4);
    if (settings.blobInflation != null) this.blobInflation = clamp(settings.blobInflation, 0, 1);
    if (settings.startCap) this.pathStartCap = settings.startCap;
    if (settings.endCap) this.pathEndCap = settings.endCap;
    if (settings.radiusScale != null) this.pathRadiusScale = clamp(settings.radiusScale, 0.1, 4);
    if (settings.radialSegments != null) {
      this.pathRadialSegments = Math.round(clamp(settings.radialSegments, 3, 24));
    }
    if (settings.offset != null) this.pathOffset = clamp(settings.offset, -64, 64);
    if (settings.spacing != null) this.pathSpacing = clamp(settings.spacing, 0.05, 128);
    if (settings.profile) this.pathProfile = settings.profile;
    if (settings.chainAlternating != null) this.pathChainAlternating = settings.chainAlternating;
    if (settings.cardCrossed != null) this.pathCardCrossed = settings.cardCrossed;
    if (settings.distributionMode) this.pathDistributionMode = settings.distributionMode;
    if (settings.count != null) this.pathCount = Math.round(clamp(settings.count, 1, 200));
    if (settings.startPadding != null) this.pathStartPadding = clamp(settings.startPadding, 0, 128);
    if (settings.endPadding != null) this.pathEndPadding = clamp(settings.endPadding, 0, 128);
    if (settings.randomScale != null) this.pathRandomScale = clamp(settings.randomScale, 0, 1);
    if (settings.rotation != null) this.pathRotation = clamp(settings.rotation, -180, 180);
    if (settings.randomRotation != null) {
      this.pathRandomRotation = clamp(settings.randomRotation, 0, 180);
    }
    if (settings.alternateRotation != null) {
      this.pathAlternateRotation = settings.alternateRotation;
    }
    if (settings.mirrorAlternate != null) this.pathMirrorAlternate = settings.mirrorAlternate;
    if (settings.seed != null) this.pathSeed = Math.round(clamp(settings.seed, 1, 9999));
    if (settings.keepInstances != null) this.pathKeepInstances = settings.keepInstances;
    if (settings.sourceObjectId !== undefined) this.pathSourceObjectId = settings.sourceObjectId;
    if (settings.sourceMesh !== undefined) this.pathSourceMesh = settings.sourceMesh;
    this.touch(context);
  }

  popPoint(context: ModellingContext): void {
    if (!this.canEditDraftPoints()) return;
    this.state.points.pop();
    this.state.handlesIn.pop();
    this.state.handlesOut.pop();
    this.state.closed = this.shouldFill(this.state.points);
    this.state.previewPoint = null;
    if (this.state.points.length === 0) {
      this.previousSelection = null;
      this.strokePlaneOrigin = null;
      this.strokePlaneNormal = null;
      this.state = this.emptyState(this.state.revision + 1);
    } else {
      this.state.revision += 1;
    }
    context.requestRedraw();
  }

  begin(input: ToolPointerInput, context: ModellingContext): void {
    if (input.button !== 'left') return;
    if (this.inputMode === 'pen' && this.state.stage === 'drawing') {
      const point = this.sampleOnStrokePlane(input);
      const first = this.state.points[0];
      const snapped = this.snapToStartIfClosing(this.state.points, point);
      const closing =
        this.autoConnect &&
        !!first &&
        this.canAutoCloseSketch() &&
        samePoint(snapped, first);
      if (closing) {
        this.state.closed = true;
        this.state.previewPoint = null;
        this.state.revision += 1;
        // Blockout Sketch: clicking the start point finishes the closed outline.
        if (this.createContext === 'workflows' && this.style === 'profile-solid') {
          this.confirm(context);
          return;
        }
        context.requestRedraw();
        return;
      }
      this.state.points.push(point);
      this.refreshDraftHandles();
      this.state.closed = false;
      this.state.previewPoint = null;
      this.state.revision += 1;
      context.requestRedraw();
      return;
    }
    if (this.state.stage !== 'idle') return;
    const depth = this.resolveDepth(input);
    const point = this.samplePoint(input, depth);
    this.strokePlaneOrigin = { ...point };
    this.strokePlaneNormal = normalizeVec3(input.rayDirection);
    this.previousSelection = cloneSelection(context.selection.state);
    if (this.inputMode === 'pen') {
      context.selection.selectObjects([], 'replace');
    }
    this.state = {
      stage: 'drawing',
      points: [point],
      depth,
      revision: this.state.revision + 1,
      closed: false,
      previewPoint: null,
      handlesIn: [{ ...point }],
      handlesOut: [{ ...point }],
      strokeLocked: false,
    };
    this.lastPointerPoint = { ...point };
    context.requestRedraw();
  }

  update(input: ToolPointerInput, context: ModellingContext): void {
    if (this.state.stage !== 'drawing') return;
    const point = this.sampleOnStrokePlane(input);
    this.lastPointerPoint = { ...point };
    if (this.inputMode === 'pen') {
      const previewPoint = this.snapToStartIfClosing(this.state.points, point);
      this.state.previewPoint = previewPoint;
      // Only show "closed" preview when snap actually latched to the start.
      this.state.closed =
        this.canAutoCloseSketch() &&
        !!this.state.points[0] &&
        samePoint(previewPoint, this.state.points[0]!);
      this.state.revision += 1;
      context.requestRedraw();
      return;
    }
    if (this.state.strokeLocked) {
      const closed = this.shouldFill([...this.state.points, point]);
      if (closed !== this.state.closed) {
        this.state.closed = closed;
        this.state.revision += 1;
        context.requestRedraw();
      }
      return;
    }
    const minSpacing = this.radius * 0.55;
    const last = this.state.points[this.state.points.length - 1];
    const closeProbe = this.snapToStartIfClosing(this.state.points, point);
    const nearStart =
      this.autoConnect &&
      this.state.points.length >= 3 &&
      samePoint(closeProbe, this.state.points[0]!);
    if (nearStart) {
      this.state.closed = this.shouldFill([...this.state.points.slice(0, -1), closeProbe]);
      this.state.revision += 1;
      context.requestRedraw();
      return;
    }
    if (!last || lengthSqVec3(subVec3(point, last)) >= minSpacing * minSpacing) {
      this.state.points.push(point);
      this.state.closed = this.shouldFill(this.closeTestPoints(this.state.points));
      this.state.revision += 1;
      context.requestRedraw();
    } else {
      const closed = this.shouldFill(this.closeTestPoints(this.state.points, point));
      if (closed !== this.state.closed) {
        this.state.closed = closed;
        this.state.revision += 1;
        context.requestRedraw();
      }
    }
  }

  /** Sketch: stop adding points and enter node-edit review. */
  lockSketchStroke(context: ModellingContext): void {
    if (this.inputMode !== 'sketch' || this.state.stage !== 'drawing' || this.state.strokeLocked) return;
    if (this.state.points.length < 2) return;
    this.state.strokeLocked = true;
    this.state.previewPoint = null;
    this.refreshDraftHandles();
    const finalized = this.isClassicCurvesCapsule()
      ? {
          points: this.state.points,
          closed: this.state.closed || this.shouldFill(this.state.points),
        }
      : this.finalizeClosedPoints(this.state.points, this.lastPointerPoint);
    this.state.points = finalized.points;
    this.state.closed = finalized.closed;
    this.lastPointerPoint = null;
    this.state.revision += 1;
    context.requestRedraw();
  }

  /** Vector pen is always in point-placement mode while drawing. */
  isDraftNodeEditing(): boolean {
    return this.state.stage === 'drawing' && this.inputMode === 'pen';
  }

  /** Sketch stroke finished; ready for point edit or commit. */
  isSketchStrokeLocked(): boolean {
    return (
      this.state.stage === 'drawing' &&
      this.inputMode === 'sketch' &&
      this.state.strokeLocked
    );
  }

  canEditDraftPoints(): boolean {
    return this.isDraftNodeEditing() || this.isSketchStrokeLocked();
  }

  preview(_context: ModellingContext): void {}

  /** Finish stroke on pointer up (or Enter). */
  confirm(context: ModellingContext): void {
    if (this.state.stage !== 'drawing') return;
    let points = [...this.state.points];
    if (points.length < 2) {
      const p = points[0] ?? v3();
      points.push(addVec3(p, v3(this.radius * 2, 0, 0)));
    }

    const stroke = this.isClassicCurvesCapsule()
      ? {
          points,
          closed: this.state.closed || this.shouldFill(points),
        }
      : this.finalizeClosedPoints(points, this.lastPointerPoint);
    let operation = curveOperationFromStroke({
      style: this.style,
      points: stroke.points,
      radius: this.radius,
      resolution: this.preset,
      smooth: this.smoothDrawing,
      cyclic: stroke.closed,
      inputMode: this.inputMode,
      curveType: this.curveType,
      handlesIn: this.state.handlesIn,
      handlesOut: this.state.handlesOut,
      tipStyle: this.simpleTextureSettings.tipStyle,
      solidMode: this.solidMode,
      latheAxis: this.latheAxis,
      latheSegments: this.latheSegments,
      latheProfileRings: this.latheProfileRings,
      latheSmoothing: this.latheSmoothing,
      latheAngle: this.latheAngle,
      latheCaps: this.latheCaps,
      ...this.pathOperationSettings(),
    });
    const mesh = evaluateCurveOperation(operation, this.pathSourceMesh);
    const validation = validateMeshFull(mesh);
    const errors = validation.issues.filter((i) => i.severity === 'error');
    if (errors.length) {
      this.cancel(context);
      throw new Error(`Cannot create doodle: ${errors.map((i) => i.message).join('; ')}`);
    }

    const localized = localizeCurveMesh(mesh, operation);
    operation = localized.operation;

    const beforeSelection = this.previousSelection
      ? cloneSelection(this.previousSelection)
      : cloneSelection(context.selection.state);
    const label = this.objectLabel();
    const { objectId, meshId } = commitMeshObject(context.document, mesh, { name: label });
    const object = context.document.objects.get(objectId)!;
    object.transform.position = localized.position;
    object.metadata.curveOperation = serializeCurveOperation(operation);
    applySimpleTextureToObject(context.document, object, this.simpleTextureSettings);
    const meshRef = context.document.meshes.get(meshId)!;
    context.selection.setMode('object');
    if (this.createContext === 'workflows' || this.inputMode !== 'pen') {
      context.selection.selectObjects([objectId], 'replace');
    } else {
      context.selection.selectObjects([], 'replace');
    }
    const afterSelection = cloneSelection(context.selection.state);
    let applied = true;
    context.history.execute({
      name:
        `Create ${label}`,
      execute: () => {
        if (applied) return;
        context.document.objects.set(object.id, object);
        context.document.meshes.set(meshRef.id, meshRef);
        if (!context.document.rootObjectIds.includes(object.id)) {
          context.document.rootObjectIds.push(object.id);
        }
        context.selection.state = cloneSelection(afterSelection);
        context.document.dirty = true;
        applied = true;
      },
      undo: () => {
        context.document.objects.delete(object.id);
        context.document.rootObjectIds = context.document.rootObjectIds.filter(
          (id) => id !== object.id,
        );
        if (![...context.document.objects.values()].some((o) => o.meshId === meshRef.id)) {
          context.document.meshes.delete(meshRef.id);
        }
        context.selection.state = cloneSelection(beforeSelection);
        context.document.dirty = true;
        applied = false;
      },
    });

    this.previousSelection = null;
    this.strokePlaneOrigin = null;
    this.strokePlaneNormal = null;
    this.lastPointerPoint = null;
    this.state = this.emptyState(this.state.revision + 1);
    context.requestRedraw();
  }

  cancel(context: ModellingContext): void {
    if (this.previousSelection) context.selection.state = cloneSelection(this.previousSelection);
    this.previousSelection = null;
    this.strokePlaneOrigin = null;
    this.strokePlaneNormal = null;
    this.lastPointerPoint = null;
    this.state = this.emptyState(this.state.revision + 1);
    context.requestRedraw();
  }

  getAllowedSelectionModes() {
    return ['object'] as const;
  }

  getSnapPolicy() {
    return [] as const;
  }

  getPreviewMesh() {
    if (this.state.stage !== 'drawing' || this.state.points.length < 1) return null;
    const sourcePoints =
      this.inputMode === 'pen' && this.state.previewPoint
        ? [...this.state.points, this.state.previewPoint]
        : this.state.points;
    const points =
      sourcePoints.length >= 2
        ? sourcePoints
        : [sourcePoints[0]!, addVec3(sourcePoints[0]!, v3(this.radius * 1.5, 0, 0))];
    const handles = this.draftHandlesFor(points);
    if (this.isClassicCurvesCapsule()) {
      return this.buildMesh(points, this.shouldFill(points), handles);
    }
    const probe =
      this.inputMode === 'pen'
        ? this.state.previewPoint
        : this.lastPointerPoint;
    const { points: finalized, closed } = this.finalizeClosedPoints(points, probe);
    return this.buildMesh(finalized, closed, handles);
  }

  /** Whether the current draft stroke should become a closed solid (not a tube). */
  isClosedStroke(points: Vec3[] = this.state.points): boolean {
    if (this.state.stage !== 'drawing' || points.length < 2) return false;
    const probe =
      this.inputMode === 'pen'
        ? this.state.previewPoint
        : this.lastPointerPoint;
    return this.shouldFill(this.closeTestPoints(points, probe));
  }

  /**
   * Force-close the current Sketch polyline onto its first point and commit.
   * Used by Blockout Sketch "Close loop".
   */
  closeLoop(context: ModellingContext): boolean {
    if (this.state.stage !== 'drawing' || this.state.points.length < 3) return false;
    if (this.createContext === 'workflows' && this.style === 'segmented-sweep') return false;
    this.autoConnect = true;
    this.state.closed = true;
    this.state.previewPoint = null;
    const first = this.state.points[0]!;
    const last = this.state.points[this.state.points.length - 1]!;
    if (!samePoint(last, first)) {
      this.state.points.push({ ...first });
      this.refreshDraftHandles();
    } else {
      this.state.points[this.state.points.length - 1] = { ...first };
    }
    this.lastPointerPoint = { ...first };
    this.state.revision += 1;
    this.confirm(context);
    return true;
  }

  /** True when Sketch has enough points to close into an outline. */
  canCloseLoop(): boolean {
    return (
      this.state.stage === 'drawing' &&
      this.state.points.length >= 3 &&
      !(this.createContext === 'workflows' && this.style === 'segmented-sweep')
    );
  }

  /** Stable procedural source shown while drawing and edited before a Vector Pen curve is committed. */
  getDraftOperation(): CurveOperation | null {
    if (
      this.state.stage !== 'drawing' ||
      this.state.points.length === 0
    ) {
      return null;
    }
    const probe =
      this.inputMode === 'pen'
        ? this.state.previewPoint
        : this.lastPointerPoint;
    const { points, closed } = this.isClassicCurvesCapsule()
      ? { points: this.state.points, closed: this.shouldFill(this.state.points) }
      : this.finalizeClosedPoints(this.state.points, probe);
    const handles = this.draftHandlesFor(points);
    return curveOperationFromStroke({
      style: this.style,
      points,
      radius: this.radius,
      resolution: this.preset,
      smooth: this.smoothDrawing,
      cyclic: closed,
      inputMode: this.inputMode,
      curveType: this.curveType,
      handlesIn: handles.handlesIn,
      handlesOut: handles.handlesOut,
      tipStyle: this.simpleTextureSettings.tipStyle,
      solidMode: this.solidMode,
      latheAxis: this.latheAxis,
      latheSegments: this.latheSegments,
      latheProfileRings: this.latheProfileRings,
      latheSmoothing: this.latheSmoothing,
      latheAngle: this.latheAngle,
      latheCaps: this.latheCaps,
      ...this.pathOperationSettings(),
    });
  }

  updateDraftControl(
    target: { kind: 'anchor' | 'handle-in' | 'handle-out'; index: number },
    point: Vec3,
    context: ModellingContext,
  ): void {
    if (!this.canEditDraftPoints()) return;
    if (!this.state.points[target.index]) return;
    if (target.kind === 'anchor') {
      const previous = this.state.points[target.index]!;
      const delta = subVec3(point, previous);
      this.state.points[target.index] = { ...point };
      this.state.handlesIn[target.index] = addVec3(this.state.handlesIn[target.index]!, delta);
      this.state.handlesOut[target.index] = addVec3(this.state.handlesOut[target.index]!, delta);
    } else if (target.kind === 'handle-in') {
      this.state.handlesIn[target.index] = { ...point };
    } else {
      this.state.handlesOut[target.index] = { ...point };
    }
    this.state.previewPoint = null;
    this.state.closed = this.shouldFill(this.state.points);
    this.state.revision += 1;
    context.requestRedraw();
  }

  setDraftPointCoordinate(
    index: number,
    axis: keyof Vec3,
    value: number,
    context: ModellingContext,
  ): void {
    const point = this.state.points[index];
    if (!point || !Number.isFinite(value)) return;
    this.updateDraftControl(
      { kind: 'anchor', index },
      { ...point, [axis]: value },
      context,
    );
  }

  radialSegments(): number {
    return RADIAL[this.preset];
  }

  isClosedPreview(): boolean {
    return this.state.closed;
  }

  samplePoint(input: ToolPointerInput, depth: number): Vec3 {
    const origin = input.rayOrigin;
    const dir = normalizeVec3(input.rayDirection);
    const along = Math.max(0.25, depth);
    return addVec3(origin, scaleVec3(dir, along));
  }

  resolveDepth(input: ToolPointerInput): number {
    if (input.worldPosition) {
      const d = Math.sqrt(lengthSqVec3(subVec3(input.worldPosition, input.rayOrigin)));
      if (Number.isFinite(d) && d > 0.1) return Math.min(80, Math.max(0.35, d));
    }
    const wupp = input.worldUnitsPerPixel;
    if (wupp && wupp > 1e-6) {
      const approx = wupp * 120;
      return Math.min(80, Math.max(0.35, approx));
    }
    return 4;
  }

  setDepthHint(depth: number): void {
    if (!Number.isFinite(depth) || depth <= 0) return;
    this.state.depth = Math.min(80, Math.max(0.35, depth));
  }

  private sampleOnStrokePlane(input: ToolPointerInput): Vec3 {
    const planeOrigin = this.strokePlaneOrigin;
    const planeNormal = this.strokePlaneNormal;
    if (!planeOrigin || !planeNormal) return this.samplePoint(input, this.state.depth);
    const direction = normalizeVec3(input.rayDirection);
    const denominator =
      direction.x * planeNormal.x + direction.y * planeNormal.y + direction.z * planeNormal.z;
    if (Math.abs(denominator) < 1e-6) return this.samplePoint(input, this.state.depth);
    const toPlane = subVec3(planeOrigin, input.rayOrigin);
    const distance =
      (toPlane.x * planeNormal.x + toPlane.y * planeNormal.y + toPlane.z * planeNormal.z) /
      denominator;
    if (!Number.isFinite(distance) || distance <= 0) {
      return this.samplePoint(input, this.state.depth);
    }
    return addVec3(input.rayOrigin, scaleVec3(direction, distance));
  }

  private detectClosed(points: Vec3[]): boolean {
    if (points.length < 3) return false;
    const first = points[0]!;
    const last = points[points.length - 1]!;
    if (
      this.createContext === 'workflows' &&
      this.inputMode === 'pen' &&
      this.style !== 'segmented-sweep'
    ) {
      // Blockout Sketch only treats as closed when last is truly on the start magnet —
      // never from path length alone (that made 3-point previews look "done").
      if (points.length < 4) return samePoint(first, last);
      const prior = points.slice(0, -1);
      const magnet = this.closeSnapDistance(prior, last);
      return lengthSqVec3(subVec3(first, last)) <= magnet * magnet;
    }
    const len = strokePathLength(points);
    return isStrokeClosed(points, doodleCloseDistance(this.radius, len));
  }

  private shouldFill(points: Vec3[]): boolean {
    if (this.solidMode === 'lathe') return false;
    if (this.createContext === 'workflows' && this.style === 'segmented-sweep') return false;
    if (isPathStyle(this.style)) return this.autoConnect && this.detectClosed(points);
    if (points.length < 3) return false;
    // Curves capsule matches GitHub: long strokes can fill; pen uses same rule.
    if (this.inputMode === 'pen' && !this.isClassicCurvesCapsule()) {
      return this.detectClosed(points);
    }
    // Shape modes close the final segment automatically, like Paint 3D's
    // soft/sharp doodles. Near-start detection is still used for live feedback.
    return this.detectClosed(points) || strokePathLength(points) > this.radius * 4;
  }

  private snapToStartIfClosing(points: Vec3[], point: Vec3): Vec3 {
    const first = points[0];
    if (!this.autoConnect || !first || !this.canAutoCloseSketch(points.length)) return point;
    const closeDistance = this.closeSnapDistance(points, point);
    const distToStartSq = lengthSqVec3(subVec3(point, first));
    if (distToStartSq > closeDistance * closeDistance) return point;

    // Prefer placing a new corner over closing: if closer to the last point, don't snap.
    const last = points[points.length - 1]!;
    const distToLastSq = lengthSqVec3(subVec3(point, last));
    if (distToLastSq <= distToStartSq) return point;

    // Also skip if clearly nearer another existing corner than the start.
    for (let index = 1; index < points.length - 1; index++) {
      if (lengthSqVec3(subVec3(point, points[index]!)) < distToStartSq) return point;
    }
    return { ...first };
  }

  /**
   * Blockout Sketch needs ≥4 corners before hover/click can auto-close.
   * Triangles still work via the Close loop button.
   */
  private canAutoCloseSketch(pointCount = this.state.points.length): boolean {
    if (this.createContext === 'workflows' && this.inputMode === 'pen') {
      return pointCount >= 4;
    }
    return pointCount >= 3;
  }

  /** Tight magnet around the first corner — not thickness-based (that closed early). */
  private closeSnapDistance(points: Vec3[], point: Vec3): number {
    const pathLen = strokePathLength([...points, point]);
    const base = doodleCloseDistance(this.radius, pathLen);
    if (this.createContext !== 'workflows' || this.inputMode !== 'pen') {
      return base;
    }
    if (this.style === 'segmented-sweep') return base;

    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const sample of points) {
      minX = Math.min(minX, sample.x);
      maxX = Math.max(maxX, sample.x);
      minY = Math.min(minY, sample.y);
      maxY = Math.max(maxY, sample.y);
      minZ = Math.min(minZ, sample.z);
      maxZ = Math.max(maxZ, sample.z);
    }
    const diagonal = Math.hypot(maxX - minX, maxY - minY, maxZ - minZ);
    // ~6% of silhouette, capped — easy to hit start without stealing the 4th corner.
    const magnet = Math.max(base * 1.15, diagonal * 0.06, pathLen * 0.035);
    return Math.min(magnet, Math.max(diagonal * 0.1, base * 1.5));
  }

  private closeTestPoints(points: Vec3[], probe?: Vec3 | null): Vec3[] {
    if (!probe || points.length < 2) return points;
    const last = points[points.length - 1]!;
    if (lengthSqVec3(subVec3(probe, last)) < 1e-10) return points;
    return [...points, this.snapToStartIfClosing(points, probe)];
  }

  private isClassicCurvesCapsule(): boolean {
    return this.createContext === 'curves' && this.style === 'capsule';
  }

  private finalizeClosedPoints(
    points: Vec3[],
    probe?: Vec3 | null,
  ): { points: Vec3[]; closed: boolean } {
    const closed = this.shouldFill(this.closeTestPoints(points, probe));
    if (!closed || points.length < 3) {
      return { points, closed };
    }
    // Append the start — never replace the last corner. Replacing turned
    // squares [A,B,C,D] into triangles [A,B,C,A] when closing by clicking start.
    const finalized = points.map((point) => ({ ...point }));
    const first = finalized[0]!;
    const last = finalized[finalized.length - 1]!;
    if (!samePoint(last, first)) {
      finalized.push({ ...first });
    } else {
      finalized[finalized.length - 1] = { ...first };
    }
    return { points: finalized, closed: true };
  }

  private buildMesh(
    points: Vec3[],
    closed: boolean,
    handles = this.draftHandlesFor(points),
  ): EditableMesh {
    return evaluateCurveOperation(curveOperationFromStroke({
      style: this.style,
      points,
      radius: this.radius,
      resolution: this.preset,
      smooth: this.smoothDrawing,
      cyclic: closed,
      inputMode: this.inputMode,
      curveType: this.curveType,
      handlesIn: handles.handlesIn,
      handlesOut: handles.handlesOut,
      tipStyle: this.simpleTextureSettings.tipStyle,
      solidMode: this.solidMode,
      latheAxis: this.latheAxis,
      latheSegments: this.latheSegments,
      latheProfileRings: this.latheProfileRings,
      latheSmoothing: this.latheSmoothing,
      latheAngle: this.latheAngle,
      latheCaps: this.latheCaps,
      ...this.pathOperationSettings(),
    }), this.pathSourceMesh);
  }

  private emptyState(revision = 0): DoodleToolState {
    return {
      stage: 'idle',
      points: [],
      depth: 4,
      revision,
      closed: false,
      previewPoint: null,
      handlesIn: [],
      handlesOut: [],
      strokeLocked: false,
    };
  }

  private refreshDraftHandles(): void {
    const defaults = defaultBezierHandles(this.state.points, false);
    this.state.handlesIn = this.state.points.map((point, index) => {
      const current = this.state.handlesIn[index];
      return current && !samePoint(current, point) ? current : defaults.handlesIn[index]!;
    });
    this.state.handlesOut = this.state.points.map((point, index) => {
      const current = this.state.handlesOut[index];
      return current && !samePoint(current, point) ? current : defaults.handlesOut[index]!;
    });
  }

  private draftHandlesFor(points: Vec3[]): { handlesIn: Vec3[]; handlesOut: Vec3[] } {
    const defaults = defaultBezierHandles(points, false);
    return {
      handlesIn: points.map((_point, index) => this.state.handlesIn[index] ?? defaults.handlesIn[index]!),
      handlesOut: points.map((_point, index) => this.state.handlesOut[index] ?? defaults.handlesOut[index]!),
    };
  }

  private objectLabel(): string {
    if (this.solidMode === 'lathe') return 'Lathe';
    if (this.style === 'soft') return 'Soft Curve';
    if (this.style === 'sharp') return 'Sharp Curve';
    if (this.style === 'tube') return 'Tube Sweep';
    if (this.style === 'capsule') return 'Capsule Path';
    if (this.style === 'profile-solid') return this.blockoutPolyMode ? 'Poly' : 'Outline';
    if (this.style === 'segmented-sweep') return 'Limb';
    if (this.style === 'ribbon') return 'Ribbon Sweep';
    if (this.style === 'hair') return 'Hair Path';
    if (this.style === 'hair-strip') return 'Hair Strip';
    if (this.style === 'rounded-hair') return 'Rounded Hair';
    if (this.style === 'tapered-tube') return 'Tapered Tube';
    if (this.style === 'rope') return 'Rope Curve';
    if (this.style === 'square-sweep') return 'Square Sweep';
    return 'Rail Sweep';
  }

  private touch(context: ModellingContext): void {
    this.state.revision += 1;
    context.requestRedraw();
  }

  private pathOperationSettings() {
    return {
      pathOutput: this.pathOutput,
      startScale: this.startScale,
      endScale: this.endScale,
      twist: this.twist,
      profileWidth: this.profileWidth,
      profileHeight: this.profileHeight,
      blobInflation: this.blobInflation,
      pathStartCap: this.pathStartCap,
      pathEndCap: this.pathEndCap,
      pathRadiusScale: this.pathRadiusScale,
      pathRadialSegments: this.pathRadialSegments,
      pathOffset: this.pathOffset,
      pathSpacing: this.pathSpacing,
      pathProfile: this.pathProfile,
      pathChainAlternating: this.pathChainAlternating,
      pathCardCrossed: this.pathCardCrossed,
      pathDistributionMode: this.pathDistributionMode,
      pathCount: this.pathCount,
      pathStartPadding: this.pathStartPadding,
      pathEndPadding: this.pathEndPadding,
      pathRandomScale: this.pathRandomScale,
      pathRotation: this.pathRotation,
      pathRandomRotation: this.pathRandomRotation,
      pathAlternateRotation: this.pathAlternateRotation,
      pathMirrorAlternate: this.pathMirrorAlternate,
      pathSeed: this.pathSeed,
      pathKeepInstances: this.pathKeepInstances,
      pathSourceObjectId: this.pathSourceObjectId,
      workflowKind: this.createContext === 'workflows' ? this.workflowKind : null,
    };
  }
}

function samePoint(a: Vec3, b: Vec3): boolean {
  return lengthSqVec3(subVec3(a, b)) < 1e-12;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));
}
