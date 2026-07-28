import type { ModelDocument, ObjectId } from '@/core/document/types';
import { faceHalfEdgeIds, faceVertexIds, getEdgeVertices } from '@/core/mesh/EditableMesh';
import type { EditableMesh, EdgeId, FaceId, TopologyChangeResult, VertexId } from '@/core/mesh/types';

export type SelectionMode = 'object' | 'vertex' | 'edge' | 'face';
export type SelectionOp = 'replace' | 'add' | 'remove' | 'toggle';

export type SelectionState = {
  mode: SelectionMode;
  selectedObjectIds: Set<ObjectId>;
  selectedVertexIds: Set<VertexId>;
  selectedEdgeIds: Set<EdgeId>;
  selectedFaceIds: Set<FaceId>;
  activeObjectId: ObjectId | null;
  activeVertexId: VertexId | null;
  activeEdgeId: EdgeId | null;
  activeFaceId: FaceId | null;
  hoveredObjectId: ObjectId | null;
  hoveredVertexId: VertexId | null;
  hoveredEdgeId: EdgeId | null;
  hoveredFaceId: FaceId | null;
  /** When true, occluded components are selectable and shown with reduced opacity. */
  xRay: boolean;
  /** When true, face picking accepts the reverse side of one-sided faces. */
  selectBackfaces: boolean;
};

/** Cached component selections per mode so switching modes can restore. */
type ModeCache = {
  vertexIds: Set<VertexId>;
  edgeIds: Set<EdgeId>;
  faceIds: Set<FaceId>;
  activeVertexId: VertexId | null;
  activeEdgeId: EdgeId | null;
  activeFaceId: FaceId | null;
};

export function createEmptySelection(mode: SelectionMode = 'object'): SelectionState {
  return {
    mode,
    selectedObjectIds: new Set(),
    selectedVertexIds: new Set(),
    selectedEdgeIds: new Set(),
    selectedFaceIds: new Set(),
    activeObjectId: null,
    activeVertexId: null,
    activeEdgeId: null,
    activeFaceId: null,
    hoveredObjectId: null,
    hoveredVertexId: null,
    hoveredEdgeId: null,
    hoveredFaceId: null,
    xRay: false,
    selectBackfaces: false,
  };
}

export function cloneSelection(state: SelectionState): SelectionState {
  return {
    mode: state.mode,
    selectedObjectIds: new Set(state.selectedObjectIds),
    selectedVertexIds: new Set(state.selectedVertexIds),
    selectedEdgeIds: new Set(state.selectedEdgeIds),
    selectedFaceIds: new Set(state.selectedFaceIds),
    activeObjectId: state.activeObjectId,
    activeVertexId: state.activeVertexId,
    activeEdgeId: state.activeEdgeId,
    activeFaceId: state.activeFaceId,
    hoveredObjectId: state.hoveredObjectId,
    hoveredVertexId: state.hoveredVertexId,
    hoveredEdgeId: state.hoveredEdgeId,
    hoveredFaceId: state.hoveredFaceId,
    xRay: state.xRay,
    selectBackfaces: state.selectBackfaces,
  };
}

function applySetOp<T>(set: Set<T>, ids: Iterable<T>, op: SelectionOp): void {
  if (op === 'replace') {
    set.clear();
    for (const id of ids) set.add(id);
    return;
  }
  for (const id of ids) {
    if (op === 'add') set.add(id);
    else if (op === 'remove') set.delete(id);
    else if (set.has(id)) set.delete(id);
    else set.add(id);
  }
}

export class SelectionManager {
  /** When set, object selection ignores ids that fail this predicate. */
  objectScopeFilter: ((objectId: ObjectId) => boolean) | null = null;
  state: SelectionState;
  private modeCache: ModeCache = {
    vertexIds: new Set(),
    edgeIds: new Set(),
    faceIds: new Set(),
    activeVertexId: null,
    activeEdgeId: null,
    activeFaceId: null,
  };

  constructor(initial?: SelectionState) {
    this.state = initial ?? createEmptySelection();
  }

  setXRay(enabled: boolean): void {
    this.state.xRay = enabled;
  }

  setSelectBackfaces(enabled: boolean): void {
    this.state.selectBackfaces = enabled;
  }

  clearHover(): void {
    this.state.hoveredObjectId = null;
    this.state.hoveredVertexId = null;
    this.state.hoveredEdgeId = null;
    this.state.hoveredFaceId = null;
  }

  setHoverObject(id: ObjectId | null): void {
    this.state.hoveredObjectId = id;
    this.state.hoveredVertexId = null;
    this.state.hoveredEdgeId = null;
    this.state.hoveredFaceId = null;
  }

  setHoverVertex(id: VertexId | null): void {
    this.state.hoveredVertexId = id;
    this.state.hoveredEdgeId = null;
    this.state.hoveredFaceId = null;
    this.state.hoveredObjectId = null;
  }

  setHoverEdge(id: EdgeId | null): void {
    this.state.hoveredEdgeId = id;
    this.state.hoveredVertexId = null;
    this.state.hoveredFaceId = null;
    this.state.hoveredObjectId = null;
  }

  setHoverFace(id: FaceId | null): void {
    this.state.hoveredFaceId = id;
    this.state.hoveredVertexId = null;
    this.state.hoveredEdgeId = null;
    this.state.hoveredObjectId = null;
  }

  private stashMode(): void {
    const s = this.state;
    if (s.mode === 'vertex') {
      this.modeCache.vertexIds = new Set(s.selectedVertexIds);
      this.modeCache.activeVertexId = s.activeVertexId;
    } else if (s.mode === 'edge') {
      this.modeCache.edgeIds = new Set(s.selectedEdgeIds);
      this.modeCache.activeEdgeId = s.activeEdgeId;
    } else if (s.mode === 'face') {
      this.modeCache.faceIds = new Set(s.selectedFaceIds);
      this.modeCache.activeFaceId = s.activeFaceId;
    }
  }

  setMode(mode: SelectionMode, options?: { convert?: boolean; mesh?: EditableMesh }): void {
    if (this.state.mode === mode) return;
    this.stashMode();
    const prev = this.state.mode;
    this.clearHover();

    if (options?.convert && options.mesh && prev !== 'object' && mode !== 'object') {
      this.convert(options.mesh, mode);
      return;
    }

    this.state.mode = mode;
    this.state.selectedVertexIds.clear();
    this.state.selectedEdgeIds.clear();
    this.state.selectedFaceIds.clear();
    this.state.activeVertexId = null;
    this.state.activeEdgeId = null;
    this.state.activeFaceId = null;

    if (mode === 'vertex') {
      this.selectVertices([...this.modeCache.vertexIds], 'replace');
      this.state.activeVertexId = this.modeCache.activeVertexId;
    } else if (mode === 'edge') {
      this.selectEdges([...this.modeCache.edgeIds], 'replace');
      this.state.activeEdgeId = this.modeCache.activeEdgeId;
    } else if (mode === 'face') {
      this.selectFaces([...this.modeCache.faceIds], 'replace');
      this.state.activeFaceId = this.modeCache.activeFaceId;
    }
  }

  clear(): void {
    this.state.selectedObjectIds.clear();
    this.state.selectedVertexIds.clear();
    this.state.selectedEdgeIds.clear();
    this.state.selectedFaceIds.clear();
    this.state.activeObjectId = null;
    this.state.activeVertexId = null;
    this.state.activeEdgeId = null;
    this.state.activeFaceId = null;
    this.clearHover();
  }

  /** True when the current selection mode has anything selected. */
  hasModeSelection(): boolean {
    if (this.state.mode === 'object') return this.state.selectedObjectIds.size > 0;
    if (this.state.mode === 'vertex') return this.state.selectedVertexIds.size > 0;
    if (this.state.mode === 'edge') return this.state.selectedEdgeIds.size > 0;
    return this.state.selectedFaceIds.size > 0;
  }

  /** Clear only the current mode's selection (keeps other mode caches). */
  deselectAll(): void {
    if (this.state.mode === 'object') {
      this.state.selectedObjectIds.clear();
      this.state.activeObjectId = null;
    } else if (this.state.mode === 'vertex') {
      this.state.selectedVertexIds.clear();
      this.state.activeVertexId = null;
      this.modeCache.vertexIds.clear();
      this.modeCache.activeVertexId = null;
    } else if (this.state.mode === 'edge') {
      this.state.selectedEdgeIds.clear();
      this.state.activeEdgeId = null;
      this.modeCache.edgeIds.clear();
      this.modeCache.activeEdgeId = null;
    } else {
      this.state.selectedFaceIds.clear();
      this.state.activeFaceId = null;
      this.modeCache.faceIds.clear();
      this.modeCache.activeFaceId = null;
    }
    this.clearHover();
  }

  selectObjects(ids: ObjectId[], op: SelectionOp = 'replace'): void {
    const scoped = this.objectScopeFilter
      ? ids.filter((id) => this.objectScopeFilter!(id))
      : ids;
    if (!scoped.length) {
      if (op === 'replace') {
        this.state.selectedObjectIds.clear();
        this.state.activeObjectId = null;
      }
      return;
    }
    applySetOp(this.state.selectedObjectIds, scoped, op);
    this.state.activeObjectId = scoped[scoped.length - 1] ?? [...this.state.selectedObjectIds][0] ?? null;
  }

  selectVertices(ids: VertexId[], op: SelectionOp = 'replace'): void {
    applySetOp(this.state.selectedVertexIds, ids, op);
    this.state.activeVertexId = ids[ids.length - 1] ?? [...this.state.selectedVertexIds][0] ?? null;
  }

  selectEdges(ids: EdgeId[], op: SelectionOp = 'replace'): void {
    applySetOp(this.state.selectedEdgeIds, ids, op);
    this.state.activeEdgeId = ids[ids.length - 1] ?? [...this.state.selectedEdgeIds][0] ?? null;
  }

  selectFaces(ids: FaceId[], op: SelectionOp = 'replace'): void {
    applySetOp(this.state.selectedFaceIds, ids, op);
    this.state.activeFaceId = ids[ids.length - 1] ?? [...this.state.selectedFaceIds][0] ?? null;
  }

  applyTopologyChange(result: TopologyChangeResult): void {
    for (const id of result.removedVertexIds) {
      this.state.selectedVertexIds.delete(id);
      this.modeCache.vertexIds.delete(id);
    }
    for (const id of result.removedEdgeIds) {
      this.state.selectedEdgeIds.delete(id);
      this.modeCache.edgeIds.delete(id);
    }
    for (const id of result.removedFaceIds) {
      this.state.selectedFaceIds.delete(id);
      this.modeCache.faceIds.delete(id);
    }

    for (const [from, to] of result.replacedIds) {
      if (this.state.selectedVertexIds.delete(from as VertexId)) this.state.selectedVertexIds.add(to as VertexId);
      if (this.state.selectedEdgeIds.delete(from as EdgeId)) this.state.selectedEdgeIds.add(to as EdgeId);
      if (this.state.selectedFaceIds.delete(from as FaceId)) this.state.selectedFaceIds.add(to as FaceId);
    }

    const rec = result.recommendedSelection;
    if (rec.mode) this.state.mode = rec.mode;
    if (rec.vertexIds) this.selectVertices(rec.vertexIds, 'replace');
    if (rec.edgeIds) this.selectEdges(rec.edgeIds, 'replace');
    if (rec.faceIds) this.selectFaces(rec.faceIds, 'replace');

    if (this.state.activeVertexId && !this.state.selectedVertexIds.has(this.state.activeVertexId)) {
      this.state.activeVertexId = [...this.state.selectedVertexIds][0] ?? null;
    }
    if (this.state.activeEdgeId && !this.state.selectedEdgeIds.has(this.state.activeEdgeId)) {
      this.state.activeEdgeId = [...this.state.selectedEdgeIds][0] ?? null;
    }
    if (this.state.activeFaceId && !this.state.selectedFaceIds.has(this.state.activeFaceId)) {
      this.state.activeFaceId = [...this.state.selectedFaceIds][0] ?? null;
    }
    this.clearHover();
  }

  selectAll(mesh?: EditableMesh, document?: ModelDocument): void {
    if (this.state.mode === 'object') {
      if (!document) return;
      this.selectObjects([...document.objects.keys()], 'replace');
      return;
    }
    if (this.state.mode === 'vertex' && mesh) this.selectVertices([...mesh.vertices.keys()]);
    else if (this.state.mode === 'edge' && mesh) this.selectEdges([...mesh.edges.keys()]);
    else if (this.state.mode === 'face' && mesh) this.selectFaces([...mesh.faces.keys()]);
  }

  /**
   * Blender-style A: if anything is selected in the current mode, deselect all;
   * otherwise select all. Returns whether the selection changed.
   */
  toggleSelectAll(mesh?: EditableMesh, document?: ModelDocument): boolean {
    if (this.hasModeSelection()) {
      this.deselectAll();
      return true;
    }
    if (this.state.mode === 'object') {
      if (!document || document.objects.size === 0) return false;
      this.selectAll(undefined, document);
      return this.hasModeSelection();
    }
    if (!mesh) return false;
    const before = this.currentComponentCount();
    this.selectAll(mesh);
    return this.currentComponentCount() !== before || this.hasModeSelection();
  }

  invert(mesh?: EditableMesh, document?: ModelDocument): void {
    if (this.state.mode === 'object') {
      if (!document) return;
      this.selectObjects(
        [...document.objects.keys()].filter((id) => !this.state.selectedObjectIds.has(id)),
        'replace',
      );
      return;
    }
    if (!mesh) return;
    if (this.state.mode === 'vertex') {
      this.selectVertices([...mesh.vertices.keys()].filter((id) => !this.state.selectedVertexIds.has(id)));
    } else if (this.state.mode === 'edge') {
      this.selectEdges([...mesh.edges.keys()].filter((id) => !this.state.selectedEdgeIds.has(id)));
    } else if (this.state.mode === 'face') {
      this.selectFaces([...mesh.faces.keys()].filter((id) => !this.state.selectedFaceIds.has(id)));
    }
  }

  /** Vertex→Edge: fully contained. Edge→Face: all boundary edges selected. */
  convert(mesh: EditableMesh, target: Exclude<SelectionMode, 'object'>): void {
    const vertices = new Set<VertexId>();
    if (this.state.mode === 'vertex') for (const id of this.state.selectedVertexIds) vertices.add(id);
    if (this.state.mode === 'edge') {
      for (const id of this.state.selectedEdgeIds) for (const v of getEdgeVertices(mesh, id) ?? []) vertices.add(v);
    }
    if (this.state.mode === 'face') {
      for (const id of this.state.selectedFaceIds) for (const v of faceVertexIds(mesh, id)) vertices.add(v);
    }
    this.state.mode = target;
    this.state.selectedVertexIds.clear();
    this.state.selectedEdgeIds.clear();
    this.state.selectedFaceIds.clear();
    this.state.activeVertexId = null;
    this.state.activeEdgeId = null;
    this.state.activeFaceId = null;

    if (target === 'vertex') this.selectVertices([...vertices]);
    else if (target === 'edge') {
      this.selectEdges(
        [...mesh.edges.values()]
          .filter((e) => (getEdgeVertices(mesh, e.id) ?? []).every((v) => vertices.has(v)))
          .map((e) => e.id),
      );
    } else {
      this.selectFaces(
        [...mesh.faces.values()]
          .filter((f) => faceVertexIds(mesh, f.id).every((v) => vertices.has(v)))
          .map((f) => f.id),
      );
    }
  }

  grow(mesh: EditableMesh): void {
    if (this.state.mode === 'vertex') {
      const next = new Set(this.state.selectedVertexIds);
      for (const edge of mesh.edges.values()) {
        const pair = getEdgeVertices(mesh, edge.id);
        if (pair && (next.has(pair[0]) || next.has(pair[1]))) {
          next.add(pair[0]);
          next.add(pair[1]);
        }
      }
      this.selectVertices([...next]);
    } else if (this.state.mode === 'edge') {
      const vertices = new Set(
        [...this.state.selectedEdgeIds].flatMap((id) => getEdgeVertices(mesh, id) ?? []),
      );
      this.selectEdges(
        [...mesh.edges.values()]
          .filter((e) => (getEdgeVertices(mesh, e.id) ?? []).some((v) => vertices.has(v)))
          .map((e) => e.id),
      );
    } else if (this.state.mode === 'face') {
      const next = new Set(this.state.selectedFaceIds);
      for (const id of this.state.selectedFaceIds) {
        for (const heId of faceHalfEdgeIds(mesh, id)) {
          const he = mesh.halfEdges.get(heId)!;
          const adjacent = he.twinHalfEdgeId
            ? mesh.halfEdges.get(he.twinHalfEdgeId)?.faceId
            : null;
          if (adjacent) next.add(adjacent);
        }
      }
      this.selectFaces([...next]);
    }
  }

  selectConnected(mesh: EditableMesh): void {
    for (;;) {
      const previous = this.currentComponentCount();
      this.grow(mesh);
      if (this.currentComponentCount() === previous) break;
    }
  }

  private currentComponentCount(): number {
    return this.state.mode === 'vertex'
      ? this.state.selectedVertexIds.size
      : this.state.mode === 'edge'
        ? this.state.selectedEdgeIds.size
        : this.state.selectedFaceIds.size;
  }

  prune(document: ModelDocument): void {
    for (const id of this.state.selectedObjectIds) {
      if (!document.objects.has(id)) this.state.selectedObjectIds.delete(id);
    }
    if (this.state.activeObjectId && !document.objects.has(this.state.activeObjectId)) {
      this.state.activeObjectId = [...this.state.selectedObjectIds][0] ?? null;
    }
    const object = this.state.activeObjectId
      ? document.objects.get(this.state.activeObjectId)
      : null;
    const mesh = object?.meshId ? document.meshes.get(object.meshId) : null;
    if (!mesh) {
      this.state.selectedVertexIds.clear();
      this.state.selectedEdgeIds.clear();
      this.state.selectedFaceIds.clear();
      this.state.activeVertexId = this.state.activeEdgeId = this.state.activeFaceId = null;
      this.clearHover();
      return;
    }
    for (const id of this.state.selectedVertexIds) {
      if (!mesh.vertices.has(id)) this.state.selectedVertexIds.delete(id);
    }
    for (const id of this.state.selectedEdgeIds) {
      if (!mesh.edges.has(id)) this.state.selectedEdgeIds.delete(id);
    }
    for (const id of this.state.selectedFaceIds) {
      if (!mesh.faces.has(id)) this.state.selectedFaceIds.delete(id);
    }
    if (this.state.activeVertexId && !mesh.vertices.has(this.state.activeVertexId)) {
      this.state.activeVertexId = [...this.state.selectedVertexIds][0] ?? null;
    }
    if (this.state.activeEdgeId && !mesh.edges.has(this.state.activeEdgeId)) {
      this.state.activeEdgeId = [...this.state.selectedEdgeIds][0] ?? null;
    }
    if (this.state.activeFaceId && !mesh.faces.has(this.state.activeFaceId)) {
      this.state.activeFaceId = [...this.state.selectedFaceIds][0] ?? null;
    }
  }
}
