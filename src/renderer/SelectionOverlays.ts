import {
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  NearestFilter,
  DoubleSide,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  Points,
  PointsMaterial,
  Vector3,
  type Texture,
} from 'three';
import type { ObjectId } from '@/core/document/types';
import { faceHalfEdgeIds, faceVertexIds, getEdgeVertices } from '@/core/mesh/EditableMesh';
import { triangulateFace } from '@/core/mesh/Triangulation';
import type { EditableMesh, EdgeId, FaceId } from '@/core/mesh/types';
import type { SelectionState } from '@/core/selection/SelectionManager';
import type { ShadingMode } from '@/workspace/types';
import {
  edgeOverlayStyleForRenderMode,
  renderStyleHidesEdgeOverlay,
  renderStyleShowsAllEdges,
} from '@/renderer/ViewportRenderStyle';
import type { ObjectRenderHandle } from './MeshRenderAdapter';

/**
 * Edit-mode palette: idle stays bright on dark clay, hover is cyan,
 * selection is amber. Overlays only — never replaces materials.
 */
export const SELECTION_COLORS = {
  hover: new Color(0x3ee8ff),
  selected: new Color(0xffb020),
  active: new Color(0xfff36a),
  topology: new Color(0xd8ecff),
  topologyWire: new Color(0x9eb6d0),
  objectOutline: new Color(0xffc14d),
  objectHover: new Color(0x5cefff),
  faceTintSelected: new Color(0xffb020),
  faceTintHover: new Color(0x3ee8ff),
  faceTintActive: new Color(0xfff36a),
};

/** CSS-pixel sizes. Three.js point size is device pixels, so we multiply by DPR. */
export const VERTEX_MARKER_CSS = {
  idle: 16,
  hover: 19,
  selected: 20,
  active: 22,
};

let vertexMarkerTexture: Texture | null | undefined;

export function vertexMarkerDeviceSize(cssPx: number): number {
  const dpr = typeof window === 'undefined' ? 1 : Math.min(window.devicePixelRatio || 1, 2);
  return cssPx * dpr;
}

/**
 * GPU overlay layer for object / vertex / edge / face feedback.
 * Base materials and textures stay on the mesh; this draws on top.
 */
export class SelectionOverlaySystem {
  readonly root = new Group();
  private selectedEdges: LineSegments;
  private hoverEdge: LineSegments;
  private activeEdge: LineSegments;
  private vertices: Points;
  private topologyVertices: Points;
  private faceFill: Mesh;
  private outlinePool = new Map<ObjectId, LineSegments>();

  constructor() {
    this.root.name = 'SelectionOverlays';
    this.root.renderOrder = 10;

    this.selectedEdges = makeLines(SELECTION_COLORS.selected, 0.95);
    this.hoverEdge = makeLines(SELECTION_COLORS.hover, 1);
    this.activeEdge = makeLines(SELECTION_COLORS.active, 1);
    this.topologyVertices = makePoints(vertexMarkerDeviceSize(VERTEX_MARKER_CSS.idle));
    this.vertices = makePoints(vertexMarkerDeviceSize(VERTEX_MARKER_CSS.selected));
    this.topologyVertices.renderOrder = 13;
    this.vertices.renderOrder = 15;
    this.faceFill = new Mesh(
      new BufferGeometry(),
      new MeshBasicMaterial({
        color: SELECTION_COLORS.faceTintSelected,
        transparent: true,
        opacity: 0.34,
        depthWrite: false,
        depthTest: true,
        side: DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1,
        vertexColors: true,
      }),
    );
    this.faceFill.renderOrder = 11;
    this.faceFill.raycast = () => {};

    this.root.add(this.selectedEdges);
    this.root.add(this.hoverEdge);
    this.root.add(this.activeEdge);
    this.root.add(this.topologyVertices);
    this.root.add(this.vertices);
    this.root.add(this.faceFill);
  }

  /**
   * Sync overlays from selection + scene handles.
   * Does not mutate mesh materials or textures.
   */
  sync(
    selection: SelectionState,
    handles: Map<string, ObjectRenderHandle>,
    getMesh: (objectId: ObjectId) => EditableMesh | null,
    expandObjectIds?: (ids: Iterable<ObjectId>) => ObjectId[],
    shadingMode: ShadingMode = 'material',
  ): void {
    const mode = selection.mode;
    const activeObjectId = selection.activeObjectId;
    const xRay = selection.xRay;
    const showAllEdges = renderStyleShowsAllEdges(shadingMode);
    const hideEdges = renderStyleHidesEdgeOverlay(shadingMode);
    const edgeStyle = edgeOverlayStyleForRenderMode(shadingMode);

    for (const [objectId, handle] of handles) {
      const mat = handle.edgeOverlay.material as LineBasicMaterial;
      if (hideEdges) {
        handle.edgeOverlay.visible = false;
      } else if (showAllEdges) {
        handle.edgeOverlay.visible = true;
        mat.color.copy(edgeStyle.color);
        mat.opacity = edgeStyle.opacity;
        mat.depthTest = !xRay;
      } else if (mode === 'object') {
        handle.edgeOverlay.visible = false;
      } else if (objectId === activeObjectId) {
        handle.edgeOverlay.visible = true;
        mat.color.copy(SELECTION_COLORS.topologyWire);
        mat.opacity = mode === 'edge' ? 0.72 : mode === 'face' ? 0.55 : 0.5;
        mat.depthTest = !xRay;
      } else {
        handle.edgeOverlay.visible = false;
      }
    }

    this.syncObjectOutlines(selection, handles, expandObjectIds);
    this.syncComponentOverlays(selection, handles, getMesh);
  }

  private syncObjectOutlines(
    selection: SelectionState,
    handles: Map<string, ObjectRenderHandle>,
    expandIds?: (ids: Iterable<ObjectId>) => ObjectId[],
  ): void {
    const needed = new Set<ObjectId>();
    if (selection.mode === 'object') {
      const selected = expandIds
        ? expandIds(selection.selectedObjectIds)
        : [...selection.selectedObjectIds];
      const selectedSet = new Set(selected);
      for (const id of selected) needed.add(id);
      if (selection.hoveredObjectId) {
        const hovered = expandIds
          ? expandIds([selection.hoveredObjectId])
          : [selection.hoveredObjectId];
        for (const id of hovered) {
          if (!selectedSet.has(id)) needed.add(id);
        }
      }
    }

    for (const [id, line] of [...this.outlinePool]) {
      if (!needed.has(id)) {
        line.parent?.remove(line);
        line.geometry.dispose();
        (line.material as LineBasicMaterial).dispose();
        this.outlinePool.delete(id);
      }
    }

    for (const id of needed) {
      const matchingHandles = [...handles.values()].filter((handle) => handle.objectId === id);
      if (!matchingHandles.length) continue;

      for (const handle of matchingHandles) {
        const poolKey = matchingHandles.length > 1 ? `${id}::${handle.meshId}` : id;
        let line = this.outlinePool.get(poolKey);
        if (!line) {
          line = new LineSegments(
            handle.edgeOverlay.geometry.clone(),
            new LineBasicMaterial({
              color: SELECTION_COLORS.objectOutline,
              depthTest: true,
              depthWrite: false,
              transparent: true,
              opacity: 0.95,
            }),
          );
          line.renderOrder = 12;
          line.raycast = () => {};
          this.outlinePool.set(poolKey, line);
        } else {
          line.geometry.dispose();
          line.geometry = handle.edgeOverlay.geometry.clone();
        }

        if (line.parent !== handle.group) {
          handle.group.add(line);
        }

        const mat = line.material as LineBasicMaterial;
        const isActive = selection.activeObjectId === id;
        const isHover =
          selection.hoveredObjectId === id && !selection.selectedObjectIds.has(id);
        if (isHover) {
          mat.color.copy(SELECTION_COLORS.objectHover);
          mat.opacity = 0.75;
        } else if (isActive) {
          mat.color.copy(SELECTION_COLORS.active);
          mat.opacity = 1;
        } else {
          mat.color.copy(SELECTION_COLORS.objectOutline);
          mat.opacity = 0.9;
        }
        line.visible = true;
      }
    }
  }

  private syncComponentOverlays(
    selection: SelectionState,
    handles: Map<string, ObjectRenderHandle>,
    getMesh: (objectId: ObjectId) => EditableMesh | null,
  ): void {
    const hideComponents = selection.mode === 'object';
    const showFaceOutlines = !hideComponents && selection.mode === 'face';
    this.selectedEdges.visible = (!hideComponents && selection.mode === 'edge') || showFaceOutlines;
    this.hoverEdge.visible = (!hideComponents && selection.mode === 'edge') || showFaceOutlines;
    this.activeEdge.visible = (!hideComponents && selection.mode === 'edge') || showFaceOutlines;
    this.vertices.visible = !hideComponents && selection.mode === 'vertex';
    this.topologyVertices.visible = !hideComponents && selection.mode === 'vertex';
    this.faceFill.visible = !hideComponents && selection.mode === 'face';

    if (hideComponents || !selection.activeObjectId) {
      clearGeometry(this.selectedEdges.geometry);
      clearGeometry(this.hoverEdge.geometry);
      clearGeometry(this.activeEdge.geometry);
      clearGeometry(this.vertices.geometry);
      clearGeometry(this.topologyVertices.geometry);
      clearGeometry(this.faceFill.geometry);
      return;
    }

    const objectId = selection.activeObjectId;
    const mesh = getMesh(objectId);
    const handle = handles.get(objectId);
    if (!mesh || !handle) return;

    const toWorld = (local: { x: number; y: number; z: number }) => {
      const v = new Vector3(local.x, local.y, local.z);
      handle.group.localToWorld(v);
      return v;
    };

    if (selection.mode === 'vertex') {
      this.buildVertexPoints(mesh, selection, toWorld);
      clearGeometry(this.selectedEdges.geometry);
      clearGeometry(this.hoverEdge.geometry);
      clearGeometry(this.activeEdge.geometry);
      clearGeometry(this.faceFill.geometry);
    } else if (selection.mode === 'edge') {
      this.buildEdgeLines(mesh, selection, toWorld);
      clearGeometry(this.vertices.geometry);
      clearGeometry(this.topologyVertices.geometry);
      clearGeometry(this.faceFill.geometry);
    } else if (selection.mode === 'face') {
      this.buildFaceFill(mesh, selection, toWorld);
      this.buildFaceBoundaryLines(mesh, selection, toWorld);
      clearGeometry(this.vertices.geometry);
      clearGeometry(this.topologyVertices.geometry);
    }
  }

  private buildVertexPoints(
    mesh: EditableMesh,
    selection: SelectionState,
    toWorld: (p: { x: number; y: number; z: number }) => Vector3,
  ): void {
    const highlighted = new Set(selection.selectedVertexIds);
    if (selection.hoveredVertexId) highlighted.add(selection.hoveredVertexId);
    if (selection.activeVertexId) highlighted.add(selection.activeVertexId);

    const selectedPos: number[] = [];
    const selectedCol: number[] = [];
    for (const id of highlighted) {
      const v = mesh.vertices.get(id);
      if (!v) continue;
      const w = toWorld(v.position);
      selectedPos.push(w.x, w.y, w.z);
      let color = SELECTION_COLORS.selected;
      if (selection.activeVertexId === id) color = SELECTION_COLORS.active;
      else if (selection.hoveredVertexId === id && !selection.selectedVertexIds.has(id)) {
        color = SELECTION_COLORS.hover;
      }
      selectedCol.push(color.r, color.g, color.b);
    }

    const topoPos: number[] = [];
    const topoCol: number[] = [];
    const drawTopology = mesh.vertices.size <= 8000;
    if (drawTopology) {
      const dim = SELECTION_COLORS.topology;
      for (const v of mesh.vertices.values()) {
        if (highlighted.has(v.id)) continue;
        const w = toWorld(v.position);
        topoPos.push(w.x, w.y, w.z);
        topoCol.push(dim.r, dim.g, dim.b);
      }
    }

    const selGeo = this.vertices.geometry;
    selGeo.setAttribute('position', new BufferAttribute(new Float32Array(selectedPos), 3));
    selGeo.setAttribute('color', new BufferAttribute(new Float32Array(selectedCol), 3));
    const selMat = this.vertices.material as PointsMaterial;
    selMat.size = vertexMarkerDeviceSize(
      selection.activeVertexId
        ? VERTEX_MARKER_CSS.active
        : selection.hoveredVertexId
          ? VERTEX_MARKER_CSS.hover
          : VERTEX_MARKER_CSS.selected,
    );
    selMat.vertexColors = true;
    selMat.depthTest = false;
    selMat.opacity = 1;
    selGeo.computeBoundingSphere();

    const topoGeo = this.topologyVertices.geometry;
    topoGeo.setAttribute('position', new BufferAttribute(new Float32Array(topoPos), 3));
    topoGeo.setAttribute('color', new BufferAttribute(new Float32Array(topoCol), 3));
    const topoMat = this.topologyVertices.material as PointsMaterial;
    topoMat.size = vertexMarkerDeviceSize(VERTEX_MARKER_CSS.idle);
    topoMat.vertexColors = true;
    topoMat.depthTest = !selection.xRay;
    topoMat.opacity = selection.xRay ? 0.55 : 0.95;
    topoGeo.computeBoundingSphere();
  }

  private buildEdgeLines(
    mesh: EditableMesh,
    selection: SelectionState,
    toWorld: (p: { x: number; y: number; z: number }) => Vector3,
  ): void {
    const selected: number[] = [];
    const hover: number[] = [];
    const active: number[] = [];

    const pushEdge = (edgeId: EdgeId, into: number[]) => {
      const pair = getEdgeVertices(mesh, edgeId);
      if (!pair) return;
      const a = toWorld(mesh.vertices.get(pair[0])!.position);
      const b = toWorld(mesh.vertices.get(pair[1])!.position);
      into.push(a.x, a.y, a.z, b.x, b.y, b.z);
    };

    for (const id of selection.selectedEdgeIds) {
      if (id === selection.activeEdgeId) continue;
      pushEdge(id, selected);
    }
    if (selection.activeEdgeId) pushEdge(selection.activeEdgeId, active);
    if (
      selection.hoveredEdgeId &&
      !selection.selectedEdgeIds.has(selection.hoveredEdgeId)
    ) {
      pushEdge(selection.hoveredEdgeId, hover);
    }

    setLinePositions(this.selectedEdges, selected);
    setLinePositions(this.hoverEdge, hover);
    setLinePositions(this.activeEdge, active);

    for (const line of [this.selectedEdges, this.hoverEdge, this.activeEdge]) {
      const mat = line.material as LineBasicMaterial;
      mat.depthTest = !selection.xRay;
      mat.opacity = selection.xRay ? 0.7 : 0.95;
    }
  }

  private buildFaceBoundaryLines(
    mesh: EditableMesh,
    selection: SelectionState,
    toWorld: (p: { x: number; y: number; z: number }) => Vector3,
  ): void {
    const selected: number[] = [];
    const hover: number[] = [];
    const active: number[] = [];

    const pushFace = (faceId: FaceId, into: number[]) => {
      for (const heId of faceHalfEdgeIds(mesh, faceId)) {
        const edgeId = mesh.halfEdges.get(heId)?.edgeId;
        if (!edgeId) continue;
        const pair = getEdgeVertices(mesh, edgeId);
        if (!pair) continue;
        const a = toWorld(mesh.vertices.get(pair[0])!.position);
        const b = toWorld(mesh.vertices.get(pair[1])!.position);
        into.push(a.x, a.y, a.z, b.x, b.y, b.z);
      }
    };

    for (const id of selection.selectedFaceIds) {
      if (id === selection.activeFaceId) continue;
      pushFace(id, selected);
    }
    if (selection.activeFaceId) pushFace(selection.activeFaceId, active);
    if (
      selection.hoveredFaceId &&
      !selection.selectedFaceIds.has(selection.hoveredFaceId)
    ) {
      pushFace(selection.hoveredFaceId, hover);
    }

    setLinePositions(this.selectedEdges, selected);
    setLinePositions(this.hoverEdge, hover);
    setLinePositions(this.activeEdge, active);

    for (const line of [this.selectedEdges, this.hoverEdge, this.activeEdge]) {
      const mat = line.material as LineBasicMaterial;
      mat.depthTest = !selection.xRay;
      mat.opacity = selection.xRay ? 0.75 : 1;
    }
  }

  private buildFaceFill(
    mesh: EditableMesh,
    selection: SelectionState,
    toWorld: (p: { x: number; y: number; z: number }) => Vector3,
  ): void {
    const positions: number[] = [];
    const colors: number[] = [];

    const addFace = (faceId: FaceId, color: Color) => {
      const verts = faceVertexIds(mesh, faceId);
      const tri = triangulateFace(mesh, faceId);
      for (const [a, b, c] of tri.triangles) {
        const pa = toWorld(mesh.vertices.get(verts[a]!)!.position);
        const pb = toWorld(mesh.vertices.get(verts[b]!)!.position);
        const pc = toWorld(mesh.vertices.get(verts[c]!)!.position);
        positions.push(pa.x, pa.y, pa.z, pb.x, pb.y, pb.z, pc.x, pc.y, pc.z);
        for (let i = 0; i < 3; i++) colors.push(color.r, color.g, color.b);
      }
    };

    for (const id of selection.selectedFaceIds) {
      if (id === selection.activeFaceId) continue;
      addFace(id, SELECTION_COLORS.faceTintSelected);
    }
    if (selection.activeFaceId) addFace(selection.activeFaceId, SELECTION_COLORS.faceTintActive);
    if (
      selection.hoveredFaceId &&
      !selection.selectedFaceIds.has(selection.hoveredFaceId)
    ) {
      addFace(selection.hoveredFaceId, SELECTION_COLORS.faceTintHover);
    }

    const geo = this.faceFill.geometry;
    geo.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
    geo.setAttribute('color', new BufferAttribute(new Float32Array(colors), 3));
    const mat = this.faceFill.material as MeshBasicMaterial;
    mat.vertexColors = true;
    mat.depthTest = !selection.xRay;
    mat.opacity = selection.xRay ? 0.2 : 0.34;
    geo.computeBoundingSphere();
  }

  dispose(): void {
    for (const line of this.outlinePool.values()) {
      line.parent?.remove(line);
      line.geometry.dispose();
      (line.material as LineBasicMaterial).dispose();
    }
    this.outlinePool.clear();
    for (const obj of [
      this.selectedEdges,
      this.hoverEdge,
      this.activeEdge,
      this.vertices,
      this.topologyVertices,
      this.faceFill,
    ]) {
      obj.geometry.dispose();
      const m = (obj as Mesh).material;
      if (Array.isArray(m)) m.forEach((x) => x.dispose());
      else m.dispose();
    }
  }
}

function makeLines(color: Color, opacity: number): LineSegments {
  const line = new LineSegments(
    new BufferGeometry(),
    new LineBasicMaterial({
      color,
      transparent: true,
      opacity,
      depthWrite: false,
      depthTest: true,
    }),
  );
  line.renderOrder = 13;
  line.raycast = () => {};
  return line;
}

function getVertexMarkerTexture(): Texture | null {
  if (vertexMarkerTexture !== undefined) return vertexMarkerTexture;
  if (typeof document === 'undefined') {
    vertexMarkerTexture = null;
    return null;
  }
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    vertexMarkerTexture = null;
    return null;
  }
  ctx.clearRect(0, 0, size, size);
  ctx.fillStyle = 'rgba(8, 12, 20, 0.96)';
  ctx.fillRect(2, 2, size - 4, size - 4);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(8, 8, size - 16, size - 16);
  const texture = new CanvasTexture(canvas);
  texture.needsUpdate = true;
  texture.magFilter = NearestFilter;
  texture.minFilter = NearestFilter;
  vertexMarkerTexture = texture;
  return texture;
}

function makePoints(size: number): Points {
  const map = getVertexMarkerTexture();
  const points = new Points(
    new BufferGeometry(),
    new PointsMaterial({
      size,
      sizeAttenuation: false,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      map: map ?? undefined,
      alphaTest: map ? 0.12 : 0,
    }),
  );
  points.renderOrder = 14;
  points.raycast = () => {};
  return points;
}

function setLinePositions(line: LineSegments, positions: number[]): void {
  line.geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  line.geometry.computeBoundingSphere();
  line.visible = positions.length > 0;
}

function clearGeometry(geometry: BufferGeometry): void {
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(0), 3));
}
