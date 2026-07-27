import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  Points,
  PointsMaterial,
  Vector3,
} from 'three';
import type { ObjectId } from '@/core/document/types';
import { faceVertexIds, getEdgeVertices } from '@/core/mesh/EditableMesh';
import { triangulateFace } from '@/core/mesh/Triangulation';
import type { EditableMesh, EdgeId, FaceId } from '@/core/mesh/types';
import type { SelectionState } from '@/core/selection/SelectionManager';
import type { ObjectRenderHandle } from './MeshRenderAdapter';

/** Blender-like selection palette — overlays only; never replaces materials. */
export const SELECTION_COLORS = {
  hover: new Color(0xff9a3c),
  selected: new Color(0xff7a18),
  active: new Color(0xffcc66),
  topology: new Color(0x2a3140),
  objectOutline: new Color(0xff8c28),
  objectHover: new Color(0xffb060),
  faceTintSelected: new Color(0xff7a18),
  faceTintHover: new Color(0xffb060),
  faceTintActive: new Color(0xffcc66),
};

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
  private faceFill: Mesh;
  private outlinePool = new Map<ObjectId, LineSegments>();

  constructor() {
    this.root.name = 'SelectionOverlays';
    this.root.renderOrder = 10;

    this.selectedEdges = makeLines(SELECTION_COLORS.selected, 0.95);
    this.hoverEdge = makeLines(SELECTION_COLORS.hover, 1);
    this.activeEdge = makeLines(SELECTION_COLORS.active, 1);
    this.vertices = makePoints(6);
    this.faceFill = new Mesh(
      new BufferGeometry(),
      new MeshBasicMaterial({
        color: SELECTION_COLORS.faceTintSelected,
        transparent: true,
        opacity: 0.22,
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
  ): void {
    const mode = selection.mode;
    const activeObjectId = selection.activeObjectId;
    const xRay = selection.xRay;

    for (const [objectId, handle] of handles) {
      const mat = handle.edgeOverlay.material as LineBasicMaterial;
      if (mode === 'object') {
        handle.edgeOverlay.visible = false;
      } else if (objectId === activeObjectId) {
        handle.edgeOverlay.visible = true;
        mat.color.copy(SELECTION_COLORS.topology);
        mat.opacity = mode === 'edge' ? 0.45 : mode === 'face' ? 0.32 : 0.28;
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
    this.selectedEdges.visible = !hideComponents && selection.mode === 'edge';
    this.hoverEdge.visible = !hideComponents && selection.mode === 'edge';
    this.activeEdge.visible = !hideComponents && selection.mode === 'edge';
    this.vertices.visible = !hideComponents && selection.mode === 'vertex';
    this.faceFill.visible = !hideComponents && selection.mode === 'face';

    if (hideComponents || !selection.activeObjectId) {
      clearGeometry(this.selectedEdges.geometry);
      clearGeometry(this.hoverEdge.geometry);
      clearGeometry(this.activeEdge.geometry);
      clearGeometry(this.vertices.geometry);
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
      clearGeometry(this.faceFill.geometry);
    } else if (selection.mode === 'face') {
      this.buildFaceFill(mesh, selection, toWorld);
      clearGeometry(this.vertices.geometry);
      clearGeometry(this.selectedEdges.geometry);
      clearGeometry(this.hoverEdge.geometry);
      clearGeometry(this.activeEdge.geometry);
    }
  }

  private buildVertexPoints(
    mesh: EditableMesh,
    selection: SelectionState,
    toWorld: (p: { x: number; y: number; z: number }) => Vector3,
  ): void {
    const positions: number[] = [];
    const colors: number[] = [];

    for (const v of mesh.vertices.values()) {
      const w = toWorld(v.position);
      positions.push(w.x, w.y, w.z);

      let color = SELECTION_COLORS.topology;
      if (selection.activeVertexId === v.id) {
        color = SELECTION_COLORS.active;
      } else if (selection.selectedVertexIds.has(v.id)) {
        color = SELECTION_COLORS.selected;
      } else if (selection.hoveredVertexId === v.id) {
        color = SELECTION_COLORS.hover;
      }
      colors.push(color.r, color.g, color.b);
    }

    const geo = this.vertices.geometry;
    geo.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
    geo.setAttribute('color', new BufferAttribute(new Float32Array(colors), 3));
    const mat = this.vertices.material as PointsMaterial;
    mat.size =
      selection.activeVertexId || selection.hoveredVertexId
        ? selection.activeVertexId
          ? 9
          : 8
        : 6;
    mat.vertexColors = true;
    mat.depthTest = !selection.xRay;
    mat.opacity = selection.xRay ? 0.85 : 1;
    geo.computeBoundingSphere();
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
    mat.opacity = selection.xRay ? 0.14 : 0.22;
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

function makePoints(size: number): Points {
  const points = new Points(
    new BufferGeometry(),
    new PointsMaterial({
      size,
      sizeAttenuation: false,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      depthTest: true,
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
