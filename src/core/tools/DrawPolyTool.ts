import type { ObjectId } from '@/core/document/types';
import {
  assignMaterialToObject,
  ensureDefaultPlaceholderMaterial,
} from '@/core/document/ModelDocument';
import {
  captureOriginSnapshot,
  centerObjectOrigin,
  restoreOriginSnapshot,
} from '@/core/editor/OriginTools';
import { unwrapUvAuto } from '@/core/uv/UvOperations';
import {
  getEdgeVertices,
  bumpTopology,
  cloneMeshPreserveIds,
  restoreMeshFromSnapshot,
} from '@/core/mesh/EditableMesh';
import {
  addVec3,
  cloneVec3,
  dotVec3,
  lengthSqVec3,
  lengthVec3,
  normalizeVec3,
  scaleVec3,
  subVec3,
  type Vec3,
} from '@/core/math/Vec3';
import { inverseTransformPointApprox, transformPoint, type Transform } from '@/core/math/Transform';
import { mergeVertices } from '@/core/mesh/ops/basic';
import {
  addVertexAt,
  ensureDrawMesh,
  makeFaceFromVertices,
  type MakeFaceMode,
} from '@/core/mesh/ops/draw';
import { solidifyBlockoutPolyFace } from '@/core/mesh/ops/blockoutPolySolidify';
import type { EditableMesh, EdgeId, VertexId } from '@/core/mesh/types';
import { cloneSelection, type SelectionState } from '@/core/selection/SelectionManager';
import { SNAP_TARGET_LABELS, rayPlaneIntersection, resolveSnap, type ConstructionPlane } from '@/core/snap/SnapEngine';
import type { ModellingContext, Tool, ToolPointerInput } from './Tool';

export type DrawTopologyMode = 'quad' | 'tri' | 'ngon' | 'points';
export type DrawBuildMode = 'faces' | 'vertices';
export type DrawPlaneLock = 'view' | 'top' | 'front' | 'right';
export type DrawHoverKind = 'none' | 'continue' | 'merge' | 'close';

export type DrawVertexPick = {
  objectId: ObjectId;
  vertexId: VertexId;
  position: Vec3;
};

export type DrawPolyToolState = {
  chain: VertexId[];
  /** Vertices created during the current staged chain (not yet in history). */
  createdInChain: VertexId[];
  previewPoint: Vec3 | null;
  hoverVertexId: VertexId | null;
  hoverKind: DrawHoverKind;
  /** True when cursor is on a closable chain vert. */
  canClose: boolean;
  /** Shift axis-lock active on the rubber-band. */
  axisLocked: boolean;
  /** Human-readable winning snap target for viewport feedback. */
  snapLabel: string;
  meshObjectId: ObjectId | null;
  lastError: string | null;
  revision: number;
};

export type BlockoutPolySettings = {
  enabled: boolean;
  thickness: number;
  roundness: number;
  subdivideCuts: number;
};

export type DrawPreviewInfo = {
  points: Vec3[];
  chainCount: number;
  canClose: boolean;
  axisLocked: boolean;
  /** Every target-mesh vertex, kept visible throughout Draw mode. */
  allVertexPoints: Vec3[];
  /** Every target-mesh edge, kept visible as reusable topology. */
  allEdgeSegments: Array<[Vec3, Vec3]>;
  /** World positions of committed chain verts only (for ghost face). */
  chainPoints: Vec3[];
  createdPoints: Vec3[];
  hoverPoint: Vec3 | null;
  hoverKind: DrawHoverKind;
  showFaceGhost: boolean;
  topologyMode: DrawTopologyMode;
  targetCount: number;
};

/**
 * 3D Poly & Surface draw tool: click to place points in 3D or select/snap to old vertices.
 * Automatically forms Quad faces (default at 4 points) or Tri faces (at 3 points),
 * with full support for N-gons and loose 3D vertices.
 * SketchUp-like close via click start / Enter / Close. Staged verts undo as one "Draw Face".
 * Blockout Poly mode can extrude + round + subdivide on close.
 */
export class DrawPolyTool implements Tool {
  id = 'draw-poly' as const;
  label = 'Draw Poly';
  /** Single = one face; Double = front + back (both sides). */
  faceMode: MakeFaceMode = 'single';
  topologyMode: DrawTopologyMode = 'quad';
  autoCommitOnTargetCount = true;
  /** `view` follows the clicked viewport (including perspective). Axis locks stay on that world plane. */
  planeLock: DrawPlaneLock = 'view';
  /** When enabled (Blockout → Poly), closing a face solidifies it. */
  blockoutPoly: BlockoutPolySettings = {
    enabled: false,
    thickness: 0.35,
    roundness: 0.35,
    subdivideCuts: 2,
  };
  state: DrawPolyToolState = this.emptyState();
  private previousSelection: SelectionState | null = null;
  /** Mesh snapshot before the current chain — restored on Esc / used for single undo. */
  private meshBeforeChain: EditableMesh | null = null;
  private selectionBeforeChain: SelectionState | null = null;
  private lastClickMs = 0;
  private lastClickScreen = { x: -999, y: -999 };
  private viewportVertexPick: DrawVertexPick | null = null;
  private pointRedoStack: Array<{ position: Vec3; vertexId: VertexId | null }> = [];
  private placingFromRedo = false;

  /** Screen-space vertex pick from the viewport (hover + click). */
  setViewportVertexPick(pick: DrawVertexPick | null): void {
    this.viewportVertexPick = pick;
  }

  get buildMode(): DrawBuildMode {
    return this.topologyMode === 'points' ? 'vertices' : 'faces';
  }

  set buildMode(mode: DrawBuildMode) {
    if (mode === 'vertices') {
      this.topologyMode = 'points';
    } else if (this.topologyMode === 'points') {
      this.topologyMode = 'quad';
    }
  }

  activate(context: ModellingContext): void {
    this.abortChain(context, false);
    // Start from currently selected verts so old geometry can finish a new face.
    this.seedFromSelection(context);
    context.requestRedraw();
  }

  deactivate(context: ModellingContext): void {
    this.abortChain(context, false);
    this.blockoutPoly.enabled = false;
  }

  setFaceMode(mode: MakeFaceMode, context: ModellingContext): void {
    this.faceMode = mode;
    this.state.revision += 1;
    context.requestRedraw();
  }

  setTopologyMode(mode: DrawTopologyMode, context: ModellingContext): void {
    if (this.topologyMode === mode) return;
    this.abortChain(context, true);
    this.topologyMode = mode;
    this.state.lastError = null;
    this.state.revision += 1;
    context.requestRedraw();
  }

  setAutoCommit(auto: boolean, context?: ModellingContext): void {
    this.autoCommitOnTargetCount = auto;
    this.state.revision += 1;
    context?.requestRedraw();
  }

  setPlaneLock(lock: DrawPlaneLock, context?: ModellingContext): void {
    if (this.planeLock === lock) return;
    this.planeLock = lock;
    this.state.revision += 1;
    context?.requestRedraw();
  }

  /** World position of the last chain vertex, used to keep the draw plane on the mesh. */
  getAnchorWorldPosition(context: ModellingContext): Vec3 | null {
    const target = this.getTarget(context);
    const lastId = this.state.chain[this.state.chain.length - 1];
    if (!target || !lastId) return null;
    const vertex = target.mesh.vertices.get(lastId);
    if (!vertex) return null;
    return transformPoint(vertex.position, target.object.transform);
  }

  setBuildMode(mode: DrawBuildMode, context: ModellingContext): void {
    if (this.buildMode === mode) return;
    this.abortChain(context, true);
    if (mode === 'vertices') {
      this.topologyMode = 'points';
    } else if (this.topologyMode === 'points') {
      this.topologyMode = 'quad';
    }
    this.state.lastError = null;
    this.state.revision += 1;
    context.requestRedraw();
  }

  setBlockoutPolySettings(
    settings: Partial<BlockoutPolySettings>,
    context: ModellingContext,
  ): void {
    if (settings.enabled != null) this.blockoutPoly.enabled = settings.enabled;
    if (settings.thickness != null) {
      this.blockoutPoly.thickness = Math.max(0, Math.min(4, settings.thickness));
    }
    if (settings.roundness != null) {
      this.blockoutPoly.roundness = Math.max(0, Math.min(1, settings.roundness));
    }
    if (settings.subdivideCuts != null) {
      this.blockoutPoly.subdivideCuts = Math.max(0, Math.min(3, Math.round(settings.subdivideCuts)));
    }
    this.state.revision += 1;
    context.requestRedraw();
  }

  /** Enter Blockout Poly: SketchUp face draw with solidify on close. */
  enableBlockoutPoly(context: ModellingContext): void {
    this.blockoutPoly.enabled = true;
    this.buildMode = 'faces';
    // Two-sided so flat faces aren't invisible from the back before solidify.
    this.faceMode = 'double';
    this.abortChain(context, true);
    this.state.meshObjectId = null;
    context.selection.clear();
    this.previousSelection = cloneSelection(context.selection.state);
    const target = this.ensureTarget(context);
    if (target) {
      const object = context.document.objects.get(target.objectId);
      if (object) object.name = 'Blockout Poly';
      if (target.created) target.mesh.name = 'Blockout Poly';
    }
    this.state.lastError = null;
    this.state.revision += 1;
    context.requestRedraw();
  }

  /** Lock drawing to the currently selected mesh, with selected components as anchors. */
  useSelectedObject(context: ModellingContext): boolean {
    if (this.state.chain.length) this.abortChain(context, true);
    const objectId =
      context.selection.state.activeObjectId ??
      [...context.selection.state.selectedObjectIds][0] ??
      null;
    const object = objectId ? context.document.objects.get(objectId) : null;
    if (!objectId || !object?.meshId || !context.document.meshes.has(object.meshId)) {
      this.setError('Select a mesh object or some of its vertices/edges first.', context);
      return false;
    }
    this.state.meshObjectId = objectId;
    this.state.lastError = null;
    this.seedFromSelection(context);
    this.state.revision += 1;
    context.requestRedraw();
    return true;
  }

  /** Start a separate Draw object rather than accidentally modifying the selection. */
  startNewMesh(context: ModellingContext): void {
    this.abortChain(context, true);
    this.state.meshObjectId = null;
    context.selection.clear();
    this.previousSelection = cloneSelection(context.selection.state);
    this.ensureTarget(context);
    this.state.lastError = null;
    this.state.revision += 1;
    context.requestRedraw();
  }

  /** Append current vertex selection or an ordered edge chain as existing anchors. */
  seedFromSelection(context: ModellingContext): boolean {
    const selection = context.selection.state;
    let ids: VertexId[] = [];
    if (selection.mode === 'vertex') {
      ids = [...selection.selectedVertexIds];
    } else if (selection.mode === 'edge') {
      const target = this.ensureTarget(context);
      if (!target) return false;
      ids = this.orderSelectedEdges(target.mesh, [...selection.selectedEdgeIds]);
      // A new face sharing selected boundary edges must traverse them in reverse.
      if (ids.length >= 2) ids.reverse();
    }
    if (!ids.length) return false;
    const target = this.ensureTarget(context);
    if (!target) return false;

    if (!this.previousSelection) {
      this.previousSelection = cloneSelection(context.selection.state);
    }
    // Don't stage a mesh snapshot for existing verts alone — only when we mutate.
    let added = 0;
    for (const id of ids) {
      if (!target.mesh.vertices.has(id)) continue;
      if (this.state.chain[this.state.chain.length - 1] === id) continue;
      if (this.state.chain.includes(id)) continue;
      this.state.chain.push(id);
      added += 1;
    }
    if (!added && this.state.chain.length === 0) return false;
    this.state.revision += 1;
    this.state.lastError = null;
    context.selection.setMode('vertex');
    context.selection.selectVertices([...this.state.chain], 'replace');
    
    // Check if seeding already completes the target count
    if (this.autoCommitOnTargetCount) {
      if (this.topologyMode === 'quad' && this.state.chain.length >= 4) {
        this.closeFace(context);
        return true;
      }
      if (this.topologyMode === 'tri' && this.state.chain.length >= 3) {
        this.closeFace(context);
        return true;
      }
    }
    
    context.requestRedraw();
    return true;
  }

  begin(input: ToolPointerInput, context: ModellingContext): void {
    if (input.button !== 'left') return;

    const now =
      typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
    const screenDist = Math.hypot(
      input.screenX - this.lastClickScreen.x,
      input.screenY - this.lastClickScreen.y,
    );
    const isDouble = now - this.lastClickMs < 300 && screenDist < 8;
    this.lastClickMs = now;
    this.lastClickScreen = { x: input.screenX, y: input.screenY };

    // Ngon double-click close only. Rapid corner clicks in Blockout Poly must
    // not close a square into a triangle — use an earlier chain vert, Enter, or Finish.
    if (this.topologyMode === 'ngon' && !this.blockoutPoly.enabled && isDouble && this.state.chain.length >= 3) {
      this.closeFace(context);
      return;
    }

    const hit = this.resolveHit(input, context);
    if (!hit) return;
    this.placeHit(hit, context);
  }

  /** Place a point at an exact world coordinate from the precision UI. */
  placeExactPoint(position: Vec3, context: ModellingContext): boolean {
    if (![position.x, position.y, position.z].every(Number.isFinite)) {
      this.setError('Enter a valid X, Y and Z coordinate.', context);
      return false;
    }
    this.placeHit({ position: cloneVec3(position), vertexId: null, label: 'exact' }, context);
    return true;
  }

  private placeHit(
    hit: { position: Vec3; vertexId: VertexId | null; label: string },
    context: ModellingContext,
  ): void {
    if (!this.placingFromRedo) this.pointRedoStack = [];
    if (!this.previousSelection) {
      this.previousSelection = cloneSelection(context.selection.state);
    }

    const target = this.ensureTarget(context);
    if (!target) return;
    const { mesh, object } = target;

    // Snap / pick existing vertex on target mesh — merge a near-miss, close, or continue.
    if (hit.vertexId && mesh.vertices.has(hit.vertexId)) {
      const last = this.state.chain[this.state.chain.length - 1];
      if (hit.vertexId === last) return;
      if (
        last &&
        this.state.createdInChain.includes(last) &&
        this.mergeChainVertexInto(last, hit.vertexId, mesh, context)
      ) {
        return;
      }
      if (this.topologyMode !== 'points' && this.tryCloseOnChainVertex(hit.vertexId, context)) {
        return;
      }
      this.state.chain.push(hit.vertexId);
      this.touch(context);
      context.selection.setMode('vertex');
      context.selection.selectVertices([...this.state.chain], 'replace');
      context.selection.setHoverVertex(hit.vertexId);
      this.checkAutoCommit(context);
      return;
    }

    const coincident = this.findCoincidentVertex(mesh, object, hit.position, 1e-4);
    if (coincident && coincident !== this.state.chain[this.state.chain.length - 1]) {
      this.placeHit({ position: hit.position, vertexId: coincident, label: 'merge' }, context);
      return;
    }

    // Place a new staged vertex in 3D (no history until the face closes).
    this.beginStagingIfNeeded(mesh, context);
    const local = inverseTransformPointApprox(hit.position, object.transform);
    const vertexId = addVertexAt(mesh, local);
    this.state.chain.push(vertexId);
    this.state.createdInChain.push(vertexId);
    this.touch(context);
    context.selection.setMode('vertex');
    context.selection.selectVertices([...this.state.chain], 'replace');
    this.checkAutoCommit(context);
  }

  private checkAutoCommit(context: ModellingContext): void {
    if (!this.autoCommitOnTargetCount) {
      context.requestRedraw();
      return;
    }
    if (this.topologyMode === 'quad' && this.state.chain.length === 4) {
      this.closeFace(context);
      return;
    }
    if (this.topologyMode === 'tri' && this.state.chain.length === 3) {
      this.closeFace(context);
      return;
    }
    context.requestRedraw();
  }

  update(input: ToolPointerInput, context: ModellingContext): void {
    const hit = this.resolveHit(input, context);
    const nextPreview = hit?.position ?? null;
    const nextHover = hit?.vertexId ?? null;
    const nextKind: DrawHoverKind = nextHover
      ? this.hoverKindFor(nextHover)
      : hit?.label === 'merge' || hit?.label === 'continue' || hit?.label === 'close'
        ? hit.label
        : 'none';
    const nextClose = nextKind === 'close';
    const nextLocked = !!(input.shiftKey && this.state.chain.length > 0 && !nextClose);
    const previewChanged =
      (nextPreview?.x !== this.state.previewPoint?.x ||
        nextPreview?.y !== this.state.previewPoint?.y ||
        nextPreview?.z !== this.state.previewPoint?.z) ||
      nextHover !== this.state.hoverVertexId ||
      nextKind !== this.state.hoverKind ||
      nextClose !== this.state.canClose ||
      nextLocked !== this.state.axisLocked ||
      (hit?.label ?? 'none') !== this.state.snapLabel;
    if (!previewChanged) return;

    this.state.previewPoint = nextPreview ? cloneVec3(nextPreview) : null;
    this.state.hoverVertexId = nextHover;
    this.state.hoverKind = nextKind;
    this.state.canClose = nextClose;
    this.state.axisLocked = nextLocked;
    this.state.snapLabel = hit?.label ?? 'none';
    this.state.revision += 1;
    if (nextHover) context.selection.setHoverVertex(nextHover);
    else context.selection.clearHover();
    context.requestRedraw();
  }

  preview(_context: ModellingContext): void {}

  /** Enter commits a face or a batch of loose vertices, depending on workflow. */
  confirm(context: ModellingContext): void {
    if (this.topologyMode === 'points') {
      if (this.state.createdInChain.length) this.commitVertices(context);
    } else if (this.state.chain.length >= 3) {
      this.closeFace(context);
    }
  }

  /** Apply default texture + centered origin, then return the draw object (for Finish / idle Enter). */
  finishDraw(context: ModellingContext): ObjectId | null {
    this.confirm(context);
    const objectId =
      this.state.meshObjectId ??
      context.selection.state.activeObjectId ??
      [...context.selection.state.selectedObjectIds][0] ??
      null;
    if (objectId) this.applyCommittedLook(context, objectId);
    return objectId;
  }

  /** Undo a staged point, or report that history undo should run. */
  undoDraw(context: ModellingContext): boolean {
    if (!this.state.chain.length) return false;
    return this.popLast(context);
  }

  /** Redo a staged point popped by undo / Backspace. */
  redoDraw(context: ModellingContext): boolean {
    const step = this.pointRedoStack.pop();
    if (!step) return false;
    this.placingFromRedo = true;
    this.placeHit(
      { position: cloneVec3(step.position), vertexId: step.vertexId, label: 'redo' },
      context,
    );
    this.placingFromRedo = false;
    return true;
  }

  canUndoDraw(historyCanUndo: boolean): boolean {
    return this.state.chain.length > 0 || historyCanUndo;
  }

  canRedoDraw(historyCanRedo: boolean): boolean {
    return this.pointRedoStack.length > 0 || (this.state.chain.length === 0 && historyCanRedo);
  }

  /** Keep the draw target in sync after document history undo/redo. */
  syncAfterHistory(context: ModellingContext): void {
    if (this.state.meshObjectId && !context.document.objects.has(this.state.meshObjectId)) {
      this.state.meshObjectId = null;
    }
    this.meshBeforeChain = null;
    this.selectionBeforeChain = null;
    this.pointRedoStack = [];
    this.state.chain = [];
    this.state.createdInChain = [];
    this.state.previewPoint = null;
    this.state.hoverVertexId = null;
    this.state.hoverKind = 'none';
    this.state.canClose = false;
    this.state.axisLocked = false;
    this.touch(context);
  }

  /** Esc — discard staged chain (caller may exit tool if already empty). */
  cancel(context: ModellingContext): void {
    this.abortChain(context, true);
  }

  /** Backspace — pop last chain point. */
  popLast(context: ModellingContext): boolean {
    if (!this.state.chain.length) return false;
    const removed = this.state.chain[this.state.chain.length - 1]!;
    const target = this.getTarget(context);
    const vertex = target?.mesh.vertices.get(removed);
    const world = vertex && target
      ? transformPoint(vertex.position, target.object.transform)
      : null;
    const wasCreated = this.state.createdInChain.includes(removed);
    if (world) {
      this.pointRedoStack.push({
        position: cloneVec3(world),
        vertexId: wasCreated ? null : removed,
      });
    }

    this.state.chain.pop();
    const createdIdx = this.state.createdInChain.lastIndexOf(removed);
    if (wasCreated) this.state.createdInChain.splice(createdIdx, 1);

    if (target && wasCreated && !this.state.chain.includes(removed)) {
      const used = [...target.mesh.halfEdges.values()].some((he) => he.originVertexId === removed);
      if (!used && target.mesh.vertices.has(removed)) {
        target.mesh.vertices.delete(removed);
        bumpTopology(target.mesh);
      }
    }

    if (this.state.chain.length === 0 && this.meshBeforeChain && target) {
      restoreMeshFromSnapshot(target.mesh, this.meshBeforeChain);
      this.meshBeforeChain = null;
      this.selectionBeforeChain = null;
      this.state.createdInChain = [];
    }

    this.touch(context);
    if (this.state.chain.length) {
      context.selection.selectVertices([...this.state.chain], 'replace');
    } else {
      context.selection.selectVertices([], 'replace');
    }
    context.requestRedraw();
    return true;
  }

  statusLine(): string {
    if (this.state.lastError) return this.state.lastError;
    const n = this.state.chain.length;
    if (n === 0 && this.state.hoverKind === 'continue') {
      return 'Click to continue from that vertex';
    }
    if (this.state.hoverKind === 'merge') {
      return 'Click to merge with that vertex';
    }
    if (this.state.hoverKind === 'close') {
      return 'Click to close the face';
    }
    if (this.topologyMode === 'points') {
      const created = this.state.createdInChain.length;
      if (!n) return 'Points (3D) · click to place loose vertices · Enter commits';
      return `Points (3D) · ${created} new · Enter commits · Backspace undo`;
    }
    if (this.blockoutPoly.enabled) {
      const solid =
        this.blockoutPoly.thickness > 0
          ? `thickness ${this.blockoutPoly.thickness.toFixed(2)}`
          : 'flat';
      if (n === 0) {
        return `Blockout Poly · click corners · close to solidify (${solid})`;
      }
      if (this.state.canClose || n >= 3) {
        return `Blockout Poly · ${n} pts · click start / Enter to solidify`;
      }
      if (this.state.axisLocked) return `Blockout Poly · ${n} pts · axis locked`;
      return `Blockout Poly · ${n} pts · click next · Shift axis · Esc cancel`;
    }
    const sides = this.faceMode === 'double' ? 'double' : 'single';
    if (this.topologyMode === 'quad') {
      if (n === 0) return `Quad (0/4) · ${sides} · click 3D point or pick old vertex`;
      if (n === 1) return `Quad (1/4) · ${sides} · click 2nd point`;
      if (n === 2) return `Quad (2/4) · ${sides} · click 3rd point`;
      if (n === 3) return `Quad (3/4) · ${sides} · click 4th point to create Quad Face`;
      return `Quad (4/4) · creating face...`;
    }
    if (this.topologyMode === 'tri') {
      if (n === 0) return `Tri (0/3) · ${sides} · click 3D point or pick old vertex`;
      if (n === 1) return `Tri (1/3) · ${sides} · click 2nd point`;
      if (n === 2) return `Tri (2/3) · ${sides} · click 3rd point to create Tri Face`;
      return `Tri (3/3) · creating face...`;
    }
    // 'ngon' mode:
    if (n === 0) return `Polygon · ${sides} · click 3D points or select old verts`;
    if (this.state.canClose) return `Polygon · ${sides} · ${n} pts · click start vert or Enter to close`;
    if (n >= 3) return `Polygon · ${sides} · ${n} pts · click next / start to close · Enter`;
    return `Polygon · ${sides} · ${n} pts · click next point`;
  }

  getPreviewInfo(context: ModellingContext): DrawPreviewInfo {
    const target = this.getTarget(context);
    const chainPoints: Vec3[] = [];
    if (target) {
      for (const id of this.state.chain) {
        const v = target.mesh.vertices.get(id);
        if (v) chainPoints.push(transformPoint(v.position, target.object.transform));
      }
    }
    const points = [...chainPoints];
    if (this.state.canClose && this.state.hoverVertexId) {
      const idx = this.closableChainIndex(this.state.hoverVertexId);
      const closePt = idx >= 0 ? chainPoints[idx] : chainPoints[0];
      if (closePt) points.push(closePt);
    } else if (this.state.previewPoint) {
      points.push(this.state.previewPoint);
    }
    return {
      points,
      chainCount: this.state.chain.length,
      canClose: this.state.canClose,
      axisLocked: this.state.axisLocked,
      allVertexPoints: this.collectVisibleVertexPoints(context),
      allEdgeSegments: target
        ? [...target.mesh.edges.keys()].flatMap((edgeId) => {
            const pair = getEdgeVertices(target.mesh, edgeId);
            if (!pair) return [];
            const a = target.mesh.vertices.get(pair[0]);
            const b = target.mesh.vertices.get(pair[1]);
            return a && b
              ? [[
                  transformPoint(a.position, target.object.transform),
                  transformPoint(b.position, target.object.transform),
                ] as [Vec3, Vec3]]
              : [];
          })
        : [],
      chainPoints,
      createdPoints: this.state.createdInChain.flatMap((id) => {
        const v = target?.mesh.vertices.get(id);
        return v && target ? [transformPoint(v.position, target.object.transform)] : [];
      }),
      hoverPoint: this.state.previewPoint && this.state.hoverKind !== 'none'
        ? cloneVec3(this.state.previewPoint)
        : null,
      hoverKind: this.state.hoverKind,
      showFaceGhost: this.topologyMode !== 'points' && !this.blockoutPoly.enabled,
      topologyMode: this.topologyMode,
      targetCount: this.topologyMode === 'quad' ? 4 : this.topologyMode === 'tri' ? 3 : 0,
    };
  }

  getAllowedSelectionModes() {
    return ['vertex', 'edge', 'face', 'object'] as const;
  }

  getSnapPolicy() {
    return ['grid', 'vertex', 'edge', 'edgeMid', 'face', 'origin'] as const;
  }

  private tryCloseOnChainVertex(vertexId: VertexId, context: ModellingContext): boolean {
    const idx = this.closableChainIndex(vertexId);
    if (idx < 0) return false;
    if (idx > 0) {
      // Close the loop starting at this earlier (often old) vertex.
      this.state.chain = this.state.chain.slice(idx);
      this.state.createdInChain = this.state.createdInChain.filter((id) =>
        this.state.chain.includes(id),
      );
    }
    this.closeFace(context);
    return true;
  }

  /**
   * Index of a chain vert that can close a face.
   * Blockout Poly needs ≥4 corners before click-to-close (squares); triangles use Enter / Finish.
   * Regular Draw still allows closing at ≥3.
   */
  private closableChainIndex(vertexId: VertexId): number {
    const minLoop = this.blockoutPoly.enabled ? 4 : 3;
    if (this.state.chain.length < minLoop) return -1;
    const idx = this.state.chain.indexOf(vertexId);
    if (idx < 0) return -1;
    if (idx === this.state.chain.length - 1) return -1;
    if (this.state.chain.length - idx < minLoop) return -1;
    return idx;
  }

  private closeFace(context: ModellingContext): void {
    if (this.state.chain.length < 3) return;
    const target = this.getTarget(context);
    if (!target) return;

    const chain = [...this.state.chain];
    // Closing with only existing verts still needs an undo snapshot.
    if (!this.meshBeforeChain) {
      this.meshBeforeChain = cloneMeshPreserveIds(target.mesh);
      this.selectionBeforeChain = cloneSelection(context.selection.state);
    }
    const before = this.meshBeforeChain;
    const selectionBefore =
      this.selectionBeforeChain ??
      (this.previousSelection
        ? cloneSelection(this.previousSelection)
        : cloneSelection(context.selection.state));
    const originBefore = captureOriginSnapshot(context.document, target.objectId);

    const result = makeFaceFromVertices(target.mesh, chain, {
      // Always double-sided in Blockout Poly so paper-thin faces aren't see-through from behind.
      mode: this.blockoutPoly.enabled ? 'double' : this.faceMode,
    });
    if (!result.ok) {
      this.setError(result.error?.message ?? 'Could not create that face.', context);
      return;
    }

    context.selection.applyTopologyChange(result.change);
    this.applyCommittedLook(context, target.objectId);
    const createdFaces = result.value?.faceIds ?? [];

    if (this.blockoutPoly.enabled && createdFaces.length > 0) {
      const solid = solidifyBlockoutPolyFace(target.mesh, createdFaces, {
        thickness: this.blockoutPoly.thickness,
        roundness: this.blockoutPoly.roundness,
        subdivideCuts: this.blockoutPoly.subdivideCuts,
      });
      if (!solid.ok) {
        this.setError(solid.error?.message ?? 'Could not solidify that face.', context);
        // Keep the flat face — still useful.
      } else {
        context.selection.applyTopologyChange(solid.change);
      }
    }

    const originAfter = captureOriginSnapshot(context.document, target.objectId);
    const after = cloneMeshPreserveIds(target.mesh);
    const selectionAfter = cloneSelection(context.selection.state);
    let applied = true;
    const faceType = chain.length === 4 ? 'Quad' : chain.length === 3 ? 'Tri' : 'Poly';
    const name = this.blockoutPoly.enabled
      ? 'Blockout Poly'
      : this.faceMode === 'double'
        ? `Draw Double ${faceType} Face`
        : `Draw ${faceType} Face`;

    context.history.execute({
      name,
      execute: () => {
        if (applied) return;
        restoreMeshFromSnapshot(target.mesh, after);
        if (originAfter) restoreOriginSnapshot(context.document, originAfter);
        context.selection.state = cloneSelection(selectionAfter);
        context.document.dirty = true;
        applied = true;
      },
      undo: () => {
        if (originBefore) restoreOriginSnapshot(context.document, originBefore);
        restoreMeshFromSnapshot(target.mesh, before);
        context.selection.state = cloneSelection(selectionBefore);
        context.document.dirty = true;
        applied = false;
      },
    });

    this.meshBeforeChain = null;
    this.selectionBeforeChain = null;
    this.pointRedoStack = [];
    this.state.chain = [];
    this.state.createdInChain = [];
    this.state.previewPoint = null;
    this.state.hoverVertexId = null;
    this.state.hoverKind = 'none';
    this.state.canClose = false;
    this.state.axisLocked = false;
    this.state.lastError = null;
    this.state.revision += 1;
    context.selection.clearHover();
    context.requestRedraw();
  }

  private abortChain(context: ModellingContext, restoreSelection: boolean): void {
    const target = this.getTarget(context);
    if (this.meshBeforeChain && target) {
      restoreMeshFromSnapshot(target.mesh, this.meshBeforeChain);
    }
    this.meshBeforeChain = null;
    this.selectionBeforeChain = null;
    this.pointRedoStack = [];
    this.state.chain = [];
    this.state.createdInChain = [];
    this.state.previewPoint = null;
    this.state.hoverVertexId = null;
    this.state.hoverKind = 'none';
    this.state.canClose = false;
    this.state.axisLocked = false;
    this.state.revision += 1;
    context.selection.clearHover();
    if (restoreSelection && this.previousSelection) {
      context.selection.state = cloneSelection(this.previousSelection);
      this.previousSelection = null;
    }
    context.requestRedraw();
  }

  private beginStagingIfNeeded(mesh: EditableMesh, context: ModellingContext): void {
    if (this.meshBeforeChain) return;
    this.meshBeforeChain = cloneMeshPreserveIds(mesh);
    this.selectionBeforeChain = cloneSelection(context.selection.state);
  }

  private touch(context: ModellingContext): void {
    this.state.revision += 1;
    this.state.canClose = false;
    this.state.lastError = null;
    context.requestRedraw();
  }

  private emptyState(): DrawPolyToolState {
    return {
      chain: [],
      createdInChain: [],
      previewPoint: null,
      hoverVertexId: null,
      hoverKind: 'none',
      canClose: false,
      axisLocked: false,
      snapLabel: 'none',
      meshObjectId: null,
      lastError: null,
      revision: 0,
    };
  }

  private ensureTarget(context: ModellingContext) {
    const locked = this.getTarget(context);
    if (this.state.meshObjectId && locked) return { ...locked, created: false };
    const ensured = ensureDrawMesh(context.document, context.selection);
    if (ensured.created) {
      const object = context.document.objects.get(ensured.objectId)!;
      const meshRef = ensured.mesh;
      const meshSnap = cloneMeshPreserveIds(meshRef);
      const beforeSelection = this.previousSelection
        ? cloneSelection(this.previousSelection)
        : cloneSelection(context.selection.state);
      const afterSelection = cloneSelection(context.selection.state);
      let applied = true;
      context.history.execute({
        name: 'Create Draw Mesh',
        execute: () => {
          if (applied) return;
          context.document.objects.set(object.id, object);
          context.document.meshes.set(meshSnap.id, meshRef);
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
          if (![...context.document.objects.values()].some((o) => o.meshId === meshSnap.id)) {
            context.document.meshes.delete(meshSnap.id);
          }
          context.selection.state = cloneSelection(beforeSelection);
          context.document.dirty = true;
          applied = false;
          if (this.state.meshObjectId === object.id) {
            this.state.meshObjectId = null;
            this.state.chain = [];
            this.state.createdInChain = [];
            this.meshBeforeChain = null;
            this.selectionBeforeChain = null;
          }
        },
      });
    }
    this.state.meshObjectId = ensured.objectId;
    const object = context.document.objects.get(ensured.objectId);
    if (!object) return null;
    return { mesh: ensured.mesh, object, objectId: ensured.objectId, created: ensured.created };
  }

  private getTarget(context: ModellingContext) {
    const objectId =
      this.state.meshObjectId ??
      context.selection.state.activeObjectId ??
      [...context.selection.state.selectedObjectIds][0] ??
      null;
    if (!objectId) return null;
    const object = context.document.objects.get(objectId);
    if (!object?.meshId) return null;
    const mesh = context.document.meshes.get(object.meshId);
    if (!mesh) return null;
    return { mesh, object, objectId };
  }

  private hoverKindFor(vertexId: VertexId | null): DrawHoverKind {
    if (!vertexId) return 'none';
    if (this.topologyMode !== 'points' && this.closableChainIndex(vertexId) >= 0) return 'close';
    if (this.state.chain.length === 0) return 'continue';
    return this.state.chain.includes(vertexId) ? 'continue' : 'merge';
  }

  private collectVisibleVertexPoints(context: ModellingContext): Vec3[] {
    const points: Vec3[] = [];
    for (const object of context.document.objects.values()) {
      if (!object.visible || !object.meshId) continue;
      const mesh = context.document.meshes.get(object.meshId);
      if (!mesh) continue;
      for (const vertex of mesh.vertices.values()) {
        points.push(transformPoint(vertex.position, object.transform));
      }
    }
    return points;
  }

  private findCoincidentVertex(
    mesh: EditableMesh,
    object: { transform: Transform },
    world: Vec3,
    eps: number,
  ): VertexId | null {
    const maxSq = eps * eps;
    for (const [id, vertex] of mesh.vertices) {
      const pos = transformPoint(vertex.position, object.transform);
      if (lengthSqVec3(subVec3(pos, world)) <= maxSq) return id;
    }
    return null;
  }

  private mergeChainVertexInto(
    fromId: VertexId,
    intoId: VertexId,
    mesh: EditableMesh,
    context: ModellingContext,
  ): boolean {
    const from = mesh.vertices.get(fromId);
    const into = mesh.vertices.get(intoId);
    if (!from || !into || fromId === intoId) return false;
    if (lengthVec3(subVec3(from.position, into.position)) > 0.08) return false;
    this.beginStagingIfNeeded(mesh, context);
    const result = mergeVertices(mesh, [intoId, fromId], cloneVec3(into.position));
    if (!result.ok) return false;
    const replaced = result.change.replacedIds;
    this.state.chain = this.state.chain.map((id) => replaced.get(id) ?? id);
    const deduped: VertexId[] = [];
    for (const id of this.state.chain) {
      if (deduped[deduped.length - 1] !== id) deduped.push(id);
    }
    this.state.chain = deduped;
    this.state.createdInChain = this.state.createdInChain.filter(
      (id) => mesh.vertices.has(id) && !replaced.has(id),
    );
    if (this.state.chain[this.state.chain.length - 1] !== intoId) {
      this.state.chain.push(intoId);
    }
    this.touch(context);
    context.selection.setMode('vertex');
    context.selection.selectVertices([...this.state.chain], 'replace');
    context.selection.setHoverVertex(intoId);
    this.checkAutoCommit(context);
    return true;
  }

  private hitFromViewportPick(
    context: ModellingContext,
  ): { position: Vec3; vertexId: VertexId | null; label: string } | null {
    const pick = this.viewportVertexPick;
    if (!pick) return null;
    const target = this.getTarget(context);
    if (target && pick.objectId === target.objectId && target.mesh.vertices.has(pick.vertexId)) {
      return { position: pick.position, vertexId: pick.vertexId, label: this.hoverKindFor(pick.vertexId) };
    }
    if (target) {
      const coincident = this.findCoincidentVertex(target.mesh, target.object, pick.position, 1e-4);
      if (coincident) {
        return { position: pick.position, vertexId: coincident, label: 'merge' };
      }
    }
    return { position: pick.position, vertexId: null, label: 'merge' };
  }

  /**
   * Screen-style vertex pick: closest point to the click ray, not the construction-plane hit.
   * Lets Draw weld to existing verts (this mesh first, then other objects) while looking from any angle.
   */
  private pickVertexAlongRay(
    input: ToolPointerInput,
    context: ModellingContext,
  ): { position: Vec3; vertexId: VertexId | null; label: string } | null {
    const dirLen = lengthVec3(input.rayDirection);
    if (dirLen < 1e-10) return null;
    const dir = scaleVec3(input.rayDirection, 1 / dirLen);
    const px = input.worldUnitsPerPixel ?? 0.01;
    const maxPerp = Math.max(px * 22, 0.05);
    const target = this.getTarget(context);

    let best: {
      perp: number;
      along: number;
      sameMesh: boolean;
      position: Vec3;
      vertexId: VertexId | null;
    } | null = null;

    for (const object of context.document.objects.values()) {
      if (!object.visible || !object.meshId) continue;
      const mesh = context.document.meshes.get(object.meshId);
      if (!mesh) continue;
      const sameMesh = !!target && object.id === target.objectId;
      for (const [id, vertex] of mesh.vertices) {
        const world = transformPoint(vertex.position, object.transform);
        const toPoint = subVec3(world, input.rayOrigin);
        const along = dotVec3(toPoint, dir);
        if (along < 0.02) continue;
        const closest = addVec3(input.rayOrigin, scaleVec3(dir, along));
        const perp = lengthVec3(subVec3(world, closest));
        if (perp > maxPerp) continue;
        const candidate = {
          perp,
          along,
          sameMesh,
          position: world,
          vertexId: sameMesh ? id : null,
        };
        if (
          !best ||
          candidate.perp < best.perp - 1e-6 ||
          (Math.abs(candidate.perp - best.perp) < 1e-6 &&
            (candidate.sameMesh !== best.sameMesh
              ? candidate.sameMesh
              : candidate.along < best.along))
        ) {
          best = candidate;
        }
      }
    }

    if (!best) return null;

    if (!best.vertexId && target) {
      const eps = 1e-8;
      for (const [id, vertex] of target.mesh.vertices) {
        const world = transformPoint(vertex.position, target.object.transform);
        if (lengthSqVec3(subVec3(world, best.position)) <= eps) {
          best.vertexId = id;
          break;
        }
      }
    }

    return { position: best.position, vertexId: best.vertexId, label: 'vertex' };
  }

  private resolveHit(
    input: ToolPointerInput,
    context: ModellingContext,
  ): { position: Vec3; vertexId: VertexId | null; label: string } | null {
    const snapEnabled = context.snapEnabled !== input.ctrlKey;
    if (snapEnabled) {
      const fromView = this.hitFromViewportPick(context);
      if (fromView) return fromView;
      const rayVert = this.pickVertexAlongRay(input, context);
      if (rayVert) {
        return {
          ...rayVert,
          label: rayVert.vertexId ? this.hoverKindFor(rayVert.vertexId) : rayVert.label,
        };
      }
    }

    const plane: ConstructionPlane = context.constructionPlane;

    // Get position of current chain anchor (last placed vertex in 3D) if available
    const target = this.getTarget(context);
    let anchorPos: Vec3 | null = null;
    if (target && this.state.chain.length > 0) {
      const lastId = this.state.chain[this.state.chain.length - 1];
      const v = target.mesh.vertices.get(lastId);
      if (v) {
        anchorPos = transformPoint(v.position, target.object.transform);
      }
    }

    const planeHit = rayPlaneIntersection(input.rayOrigin, input.rayDirection, plane);
    const planeDenom = Math.abs(
      input.rayDirection.x * plane.normal.x +
        input.rayDirection.y * plane.normal.y +
        input.rayDirection.z * plane.normal.z,
    );
    const isGrazing = planeDenom < 0.08;
    const hitDistToAnchor =
      planeHit && anchorPos ? lengthVec3(subVec3(planeHit, anchorPos)) : Infinity;
    const hitDistToCam = planeHit ? lengthVec3(subVec3(planeHit, input.rayOrigin)) : Infinity;

    let raw: Vec3 | null = null;

    // In perspective view, grazing angles or pointing towards the horizon cause planeHit to shoot miles into the distance.
    // Anchor to the active 3D polygon depth when this happens:
    if (anchorPos && (!planeHit || isGrazing || hitDistToAnchor > 25)) {
      const viewNormal = normalizeVec3(scaleVec3(input.rayDirection, -1));
      const anchorPlane: ConstructionPlane = {
        origin: anchorPos,
        normal: viewNormal,
        xAxis: plane.xAxis,
        yAxis: plane.yAxis,
      };
      raw = rayPlaneIntersection(input.rayOrigin, input.rayDirection, anchorPlane) ?? planeHit;
    } else if (!anchorPos && (!planeHit || isGrazing || hitDistToCam > 60)) {
      const defaultDist = Math.min(20, Math.max(5, hitDistToCam));
      const viewNormal = normalizeVec3(scaleVec3(input.rayDirection, -1));
      const focalOrigin = addVec3(input.rayOrigin, scaleVec3(input.rayDirection, defaultDist));
      const depthPlane: ConstructionPlane = {
        origin: focalOrigin,
        normal: viewNormal,
        xAxis: plane.xAxis,
        yAxis: plane.yAxis,
      };
      raw = rayPlaneIntersection(input.rayOrigin, input.rayDirection, depthPlane) ?? planeHit;
    } else {
      raw = planeHit ?? input.worldPosition;
    }

    if (!raw) return null;

    const px = input.worldUnitsPerPixel ?? 0.01;
    // Generous vertex pick so old verts are easy to click when finishing a face in 3D.
    const vertexTol = px * (this.state.chain.length >= 2 ? 26 : 20);

    // Prefer vertices over grid so connecting / closing is easy.
    if (snapEnabled) {
      const vertexSnap = context.resolveSnap({
        rawPosition: raw,
        pointerRayOrigin: input.rayOrigin,
        pointerRayDirection: input.rayDirection,
        plane,
        allowed: ['vertex', 'edgeMid', 'edge', 'face'],
        gridSize: context.gridSize,
        maxWorldDistance: vertexTol,
      });
      if (vertexSnap.targetType === 'vertex' && vertexSnap.targetElementId) {
        return {
          position: vertexSnap.position,
          vertexId: vertexSnap.targetElementId as VertexId,
          label: 'vertex',
        };
      }
      if (vertexSnap.targetType === 'edge' || vertexSnap.targetType === 'edgeMid' || vertexSnap.targetType === 'face') {
        return {
          position: vertexSnap.position,
          vertexId: null,
          label: SNAP_TARGET_LABELS[vertexSnap.targetType],
        };
      }
    }

    // Explicit closable-chain proximity (start or earlier old vert).
    if (this.topologyMode !== 'points') {
      const closeHit = this.hitClosableChainVert(context, raw, px * 28);
      if (closeHit) return closeHit;
    }

    let position = raw;
    let label = 'none';
    if (snapEnabled) {
      const snap = context.resolveSnap({
        rawPosition: raw,
        pointerRayOrigin: input.rayOrigin,
        pointerRayDirection: input.rayDirection,
        plane,
        allowed: ['grid', 'origin'],
        gridSize: context.gridSize,
        maxWorldDistance: px * 14,
      });
      position = snap.position;
      label = SNAP_TARGET_LABELS[snap.targetType];
    } else {
      const plain = resolveSnap({ rawPosition: raw, plane, allowed: [] });
      position = plain.position;
    }

    if (input.shiftKey && this.state.chain.length > 0) {
      position = this.axisLock(position, context, plane);
      label = 'axis';
    }

    return { position, vertexId: null, label };
  }

  private commitVertices(context: ModellingContext): void {
    const target = this.getTarget(context);
    if (!target || !this.meshBeforeChain || !this.state.createdInChain.length) return;
    const before = this.meshBeforeChain;
    const originBefore = captureOriginSnapshot(context.document, target.objectId);
    this.applyCommittedLook(context, target.objectId);
    const originAfter = captureOriginSnapshot(context.document, target.objectId);
    const after = cloneMeshPreserveIds(target.mesh);
    const selectionBefore = cloneSelection(
      this.selectionBeforeChain ?? this.previousSelection ?? context.selection.state,
    );
    context.selection.setMode('vertex');
    context.selection.selectVertices([...this.state.createdInChain], 'replace');
    const selectionAfter = cloneSelection(context.selection.state);
    let applied = true;
    context.history.execute({
      name: 'Draw Vertices',
      execute: () => {
        if (applied) return;
        restoreMeshFromSnapshot(target.mesh, after);
        if (originAfter) restoreOriginSnapshot(context.document, originAfter);
        context.selection.state = cloneSelection(selectionAfter);
        context.document.dirty = true;
        applied = true;
      },
      undo: () => {
        if (originBefore) restoreOriginSnapshot(context.document, originBefore);
        restoreMeshFromSnapshot(target.mesh, before);
        context.selection.state = cloneSelection(selectionBefore);
        context.document.dirty = true;
        applied = false;
      },
    });
    this.meshBeforeChain = null;
    this.selectionBeforeChain = null;
    this.pointRedoStack = [];
    this.state.chain = [];
    this.state.createdInChain = [];
    this.state.previewPoint = null;
    this.state.hoverVertexId = null;
    this.state.lastError = null;
    this.touch(context);
    context.selection.clearHover();
  }

  /** Default placeholder texture, UVs, and origin at the mesh centre. */
  private applyCommittedLook(context: ModellingContext, objectId: ObjectId): void {
    const object = context.document.objects.get(objectId);
    if (!object) return;
    const materialId = ensureDefaultPlaceholderMaterial(context.document);
    assignMaterialToObject(context.document, objectId, materialId, 0);
    const mesh = object.meshId ? context.document.meshes.get(object.meshId) : null;
    if (mesh?.faces.size && mesh.defaultUvLayerId) {
      try {
        unwrapUvAuto(mesh, [...mesh.faces.keys()], mesh.defaultUvLayerId);
      } catch {
        /* degenerate faces can skip unwrap */
      }
    }
    if (mesh && mesh.vertices.size > 0) {
      centerObjectOrigin(context.document, objectId);
    }
  }

  private orderSelectedEdges(mesh: EditableMesh, edgeIds: EdgeId[]): VertexId[] {
    const ids = [...new Set(edgeIds)].filter((id) => mesh.edges.has(id));
    if (!ids.length) return [];
    const adjacency = new Map<VertexId, { vertex: VertexId; edge: EdgeId }[]>();
    for (const edge of ids) {
      const pair = getEdgeVertices(mesh, edge);
      if (!pair) return [];
      const [a, b] = pair;
      adjacency.set(a, [...(adjacency.get(a) ?? []), { vertex: b, edge }]);
      adjacency.set(b, [...(adjacency.get(b) ?? []), { vertex: a, edge }]);
    }
    if ([...adjacency.values()].some((links) => links.length > 2)) return [];
    const start = [...adjacency.entries()].find(([, links]) => links.length === 1)?.[0] ??
      getEdgeVertices(mesh, ids[0]!)?.[0];
    if (!start) return [];
    const result = [start];
    const used = new Set<EdgeId>();
    let current = start;
    while (used.size < ids.length) {
      const next = adjacency.get(current)?.find((link) => !used.has(link.edge));
      if (!next) return [];
      used.add(next.edge);
      current = next.vertex;
      if (current !== result[0]) result.push(current);
    }
    return result;
  }

  private setError(message: string, context: ModellingContext): void {
    this.state.lastError = message;
    this.state.revision += 1;
    context.requestRedraw();
  }

  private hitClosableChainVert(
    context: ModellingContext,
    raw: Vec3,
    tol: number,
  ): { position: Vec3; vertexId: VertexId; label: string } | null {
    const target = this.getTarget(context);
    if (!target || this.state.chain.length < 3) return null;
    let best: { position: Vec3; vertexId: VertexId; dist: number } | null = null;
    for (let i = 0; i < this.state.chain.length - 1; i++) {
      if (this.state.chain.length - i < 3) break;
      const id = this.state.chain[i]!;
      const v = target.mesh.vertices.get(id);
      if (!v) continue;
      const world = transformPoint(v.position, target.object.transform);
      const dist = lengthSqVec3(subVec3(world, raw));
      if (dist <= tol * tol && (!best || dist < best.dist)) {
        best = { position: world, vertexId: id, dist };
      }
    }
    return best ? { position: best.position, vertexId: best.vertexId, label: 'vertex' } : null;
  }

  private axisLock(point: Vec3, context: ModellingContext, plane: ConstructionPlane): Vec3 {
    const target = this.getTarget(context);
    const lastId = this.state.chain[this.state.chain.length - 1];
    if (!target || !lastId) return point;
    const last = target.mesh.vertices.get(lastId);
    if (!last) return point;
    const origin = transformPoint(last.position, target.object.transform);
    const d = subVec3(point, origin);
    const u = dotVec3(d, plane.xAxis);
    const v = dotVec3(d, plane.yAxis);
    if (Math.abs(u) >= Math.abs(v)) {
      return addVec3(origin, scaleVec3(plane.xAxis, u));
    }
    return addVec3(origin, scaleVec3(plane.yAxis, v));
  }
}
