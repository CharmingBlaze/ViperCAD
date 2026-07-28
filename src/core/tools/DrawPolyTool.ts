import type { ObjectId } from '@/core/document/types';
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
  scaleVec3,
  subVec3,
  type Vec3,
} from '@/core/math/Vec3';
import { inverseTransformPointApprox, transformPoint } from '@/core/math/Transform';
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

export type DrawPolyToolState = {
  chain: VertexId[];
  /** Vertices created during the current staged chain (not yet in history). */
  createdInChain: VertexId[];
  previewPoint: Vec3 | null;
  hoverVertexId: VertexId | null;
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

export type DrawBuildMode = 'faces' | 'vertices';

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
  showFaceGhost: boolean;
};

/**
 * SketchUp-like poly draw: click to place/connect verts, click start / Enter /
 * double-click / Close to make a face. Staged verts undo as one "Draw Face".
 * Blockout Poly mode can extrude + round + subdivide on close.
 */
export class DrawPolyTool implements Tool {
  id = 'draw-poly' as const;
  label = 'Draw Poly';
  /** Single = one face; Double = front + back (both sides). */
  faceMode: MakeFaceMode = 'single';
  buildMode: DrawBuildMode = 'faces';
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

  setBuildMode(mode: DrawBuildMode, context: ModellingContext): void {
    if (this.buildMode === mode) return;
    this.abortChain(context, true);
    this.buildMode = mode;
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
    context.requestRedraw();
    return true;
  }

  begin(input: ToolPointerInput, context: ModellingContext): void {
    if (input.button !== 'left') return;

    // Do not treat rapid corner clicks as "double-click to close" — that
    // turned squares into triangles when the 4th click landed within 350ms.
    // Close by clicking an earlier chain vert, Enter, or the Finish button.

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
    if (!this.previousSelection) {
      this.previousSelection = cloneSelection(context.selection.state);
    }

    const target = this.ensureTarget(context);
    if (!target) return;
    const { mesh, object } = target;

    // Click an earlier chain vert (including old verts) to close that loop.
    if (this.buildMode === 'faces' && hit.vertexId && this.tryCloseOnChainVertex(hit.vertexId, context)) {
      return;
    }

    // Snap / pick existing vertex — append without duplicating.
    if (hit.vertexId && mesh.vertices.has(hit.vertexId)) {
      const last = this.state.chain[this.state.chain.length - 1];
      if (hit.vertexId === last) return;
      // Existing verts are not staged mutations by themselves.
      this.state.chain.push(hit.vertexId);
      this.touch(context);
      context.selection.setMode('vertex');
      context.selection.selectVertices([...this.state.chain], 'replace');
      context.selection.setHoverVertex(hit.vertexId);
      context.requestRedraw();
      return;
    }

    // Place a new staged vertex (no history until the face closes).
    this.beginStagingIfNeeded(mesh, context);
    const local = inverseTransformPointApprox(hit.position, object.transform);
    const vertexId = addVertexAt(mesh, local);
    this.state.chain.push(vertexId);
    this.state.createdInChain.push(vertexId);
    this.touch(context);
    context.selection.setMode('vertex');
    context.selection.selectVertices([...this.state.chain], 'replace');
    context.requestRedraw();
  }

  update(input: ToolPointerInput, context: ModellingContext): void {
    const hit = this.resolveHit(input, context);
    const nextPreview = hit?.position ?? null;
    const nextHover = hit?.vertexId ?? null;
    const nextClose =
      this.buildMode === 'faces' && !!(nextHover && this.closableChainIndex(nextHover) >= 0);
    const nextLocked = !!(input.shiftKey && this.state.chain.length > 0 && !nextClose);
    const previewChanged =
      (nextPreview?.x !== this.state.previewPoint?.x ||
        nextPreview?.y !== this.state.previewPoint?.y ||
        nextPreview?.z !== this.state.previewPoint?.z) ||
      nextHover !== this.state.hoverVertexId ||
      nextClose !== this.state.canClose ||
      nextLocked !== this.state.axisLocked ||
      (hit?.label ?? 'none') !== this.state.snapLabel;
    if (!previewChanged) return;

    this.state.previewPoint = nextPreview ? cloneVec3(nextPreview) : null;
    this.state.hoverVertexId = nextHover;
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
    if (this.buildMode === 'vertices') {
      if (this.state.createdInChain.length) this.commitVertices(context);
    } else if (this.state.chain.length >= 3) {
      this.closeFace(context);
    }
  }

  /** Esc — discard staged chain (caller may exit tool if already empty). */
  cancel(context: ModellingContext): void {
    this.abortChain(context, true);
  }

  /** Backspace — pop last chain point. */
  popLast(context: ModellingContext): boolean {
    if (!this.state.chain.length) return false;
    const removed = this.state.chain.pop()!;
    const createdIdx = this.state.createdInChain.lastIndexOf(removed);
    const wasCreated = createdIdx >= 0;
    if (wasCreated) this.state.createdInChain.splice(createdIdx, 1);

    const target = this.getTarget(context);
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
    const n = this.state.chain.length;
    if (this.state.lastError) return this.state.lastError;
    if (this.buildMode === 'vertices') {
      const created = this.state.createdInChain.length;
      if (!n) return 'Vertices · click to place · Enter commits a batch';
      return `Vertices · ${created} new · click to continue · Enter commit · Backspace undo`;
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
    if (n === 0) return `Draw · ${sides} · click or select old verts`;
    if (this.state.canClose) {
      return `Draw · ${sides} · close (${n}) · click earlier vert / Enter`;
    }
    if (n >= 3) {
      return `Draw · ${sides} · ${n} pts · click start/old vert to close · Enter`;
    }
    if (this.state.axisLocked) return `Draw · ${sides} · ${n} pts · axis locked`;
    return `Draw · ${sides} · ${n} pts · click next / old vert · Shift axis`;
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
      allVertexPoints: target
        ? [...target.mesh.vertices.values()].map((vertex) =>
            transformPoint(vertex.position, target.object.transform),
          )
        : [],
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
      showFaceGhost: this.buildMode === 'faces' && !this.blockoutPoly.enabled,
    };
  }

  getAllowedSelectionModes() {
    return ['vertex', 'edge', 'face', 'object'] as const;
  }

  getSnapPolicy() {
    return ['grid', 'vertex', 'origin'] as const;
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

    const result = makeFaceFromVertices(target.mesh, chain, {
      // Always double-sided in Blockout Poly so paper-thin faces aren't see-through from behind.
      mode: this.blockoutPoly.enabled ? 'double' : this.faceMode,
    });
    if (!result.ok) {
      this.setError(result.error?.message ?? 'Could not create that face.', context);
      return;
    }

    context.selection.applyTopologyChange(result.change);
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

    const after = cloneMeshPreserveIds(target.mesh);
    const selectionAfter = cloneSelection(context.selection.state);
    let applied = true;
    const name = this.blockoutPoly.enabled
      ? 'Blockout Poly'
      : this.faceMode === 'double'
        ? 'Draw Double Face'
        : 'Draw Face';

    context.history.execute({
      name,
      execute: () => {
        if (applied) return;
        restoreMeshFromSnapshot(target.mesh, after);
        context.selection.state = cloneSelection(selectionAfter);
        context.document.dirty = true;
        applied = true;
      },
      undo: () => {
        restoreMeshFromSnapshot(target.mesh, before);
        context.selection.state = cloneSelection(selectionBefore);
        context.document.dirty = true;
        applied = false;
      },
    });

    this.meshBeforeChain = null;
    this.selectionBeforeChain = null;
    this.state.chain = [];
    this.state.createdInChain = [];
    this.state.previewPoint = null;
    this.state.hoverVertexId = null;
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
    this.state.chain = [];
    this.state.createdInChain = [];
    this.state.previewPoint = null;
    this.state.hoverVertexId = null;
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

  private resolveHit(
    input: ToolPointerInput,
    context: ModellingContext,
  ): { position: Vec3; vertexId: VertexId | null; label: string } | null {
    const plane: ConstructionPlane = context.constructionPlane;
    const raw =
      rayPlaneIntersection(input.rayOrigin, input.rayDirection, plane) ?? input.worldPosition;
    if (!raw) return null;

    const px = input.worldUnitsPerPixel ?? 0.01;
    // Generous vertex pick so old verts are easy to click when finishing a face.
    const vertexTol = px * (this.state.chain.length >= 2 ? 24 : 18);

    // Prefer vertices over grid so connecting / closing is easy.
    const snapEnabled = context.snapEnabled !== input.ctrlKey;
    if (snapEnabled) {
      const vertexSnap = context.resolveSnap({
        rawPosition: raw,
        pointerRayOrigin: input.rayOrigin,
        pointerRayDirection: input.rayDirection,
        plane,
        allowed: ['vertex'],
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
    }

    // Explicit closable-chain proximity (start or earlier old vert).
    if (this.buildMode === 'faces') {
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
        context.selection.state = cloneSelection(selectionAfter);
        context.document.dirty = true;
        applied = true;
      },
      undo: () => {
        restoreMeshFromSnapshot(target.mesh, before);
        context.selection.state = cloneSelection(selectionBefore);
        context.document.dirty = true;
        applied = false;
      },
    });
    this.meshBeforeChain = null;
    this.selectionBeforeChain = null;
    this.state.chain = [];
    this.state.createdInChain = [];
    this.state.previewPoint = null;
    this.state.hoverVertexId = null;
    this.state.lastError = null;
    this.touch(context);
    context.selection.clearHover();
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
