import {
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  Group,
  LineBasicMaterial,
  LineSegments,
  Points,
  PointsMaterial,
  Raycaster,
  type Object3D,
  type Texture,
} from 'three';
import {
  cubicBezier,
  curveOperationFromStroke,
  evaluateCurvePath,
  type CurveOperation,
} from '@/core/curves/CurveOperation';
import type { VertexBezierState } from '@/core/curves/BezierFromVertices';
import type { EditableMesh } from '@/core/mesh/types';
import type { ObjectRenderHandle } from '@/renderer/MeshRenderAdapter';
import { addVec3 } from '@/core/math/Vec3';

export type CurveControlTarget = {
  kind: 'anchor' | 'handle-in' | 'handle-out';
  index: number;
};

export type CurveControlSyncOptions = {
  /** Show draggable anchors and handles. */
  editNodes?: boolean;
  /** Show the curve path without point handles (active sketch stroke). */
  showDraftPath?: boolean;
  selectedIndex?: number | null;
};

/** Viewport anchors and Bézier tangents for the selected procedural curve. */
export class CurveControlOverlay {
  readonly root = new Group();
  private pathHalo = makeSegments(0x1b140c, 0.9, 2);
  private path = makeSegments(0xf4c56d, 1, 1);
  private handles = makeSegments(0xd9c29a, 0.55, 1);
  private anchors = makePoints(anchorTexture(), 15);
  private anchorHighlight = makePoints(anchorSelectedTexture(), 18);
  private tangentPoints = makePoints(handleTexture(), 10);
  private operation: CurveOperation | null = null;
  private meshBezier = false;

  constructor() {
    this.root.name = 'CurveControlOverlay';
    this.root.userData.nonSelectable = true;
    this.root.renderOrder = 120;
    this.root.add(
      this.pathHalo,
      this.path,
      this.handles,
      this.anchors,
      this.anchorHighlight,
      this.tangentPoints,
    );
    this.root.visible = false;
  }

  sync(
    handle: ObjectRenderHandle | null,
    operation: CurveOperation | null,
    options: CurveControlSyncOptions = {},
  ): void {
    this.meshBezier = false;
    if (!handle || !operation || !options.editNodes) {
      this.hide();
      return;
    }
    if (this.root.parent !== handle.group) handle.group.add(this.root);
    this.syncOperation(operation, null, options);
  }

  syncMeshBezier(
    handle: ObjectRenderHandle | null,
    mesh: EditableMesh | null,
    state: VertexBezierState | null,
    options: CurveControlSyncOptions = {},
  ): void {
    if (!handle || !mesh || !state || !options.editNodes) {
      this.hide();
      return;
    }
    this.meshBezier = true;
    if (this.root.parent !== handle.group) handle.group.add(this.root);
    this.root.visible = true;
    this.operation = curveOperationFromStroke({
      style: 'soft',
      points: state.vertexIds.flatMap((id) => {
        const vertex = mesh.vertices.get(id);
        return vertex ? [{ ...vertex.position }] : [];
      }),
      radius: 0.08,
      resolution: 'medium',
      smooth: true,
      cyclic: false,
      inputMode: 'pen',
      curveType: 'bezier',
    });

    const path: Array<{ x: number; y: number; z: number }> = [];
    const handleSegments: Array<{ x: number; y: number; z: number }> = [];
    const handlePoints: Array<{ x: number; y: number; z: number }> = [];
    for (const segment of state.segments) {
      const start = mesh.vertices.get(segment.startId)?.position;
      const end = mesh.vertices.get(segment.endId)?.position;
      if (!start || !end) continue;
      const out = addVec3(start, segment.handleOut);
      const inn = addVec3(end, segment.handleIn);
      const steps = 14;
      for (let step = 0; step <= steps; step++) {
        path.push(cubicBezier(start, out, inn, end, step / steps));
      }
      handleSegments.push(start, out, end, inn);
      handlePoints.push(out, inn);
    }

    setSegmentPath(this.path.geometry, path, false, null);
    setSegmentPath(this.pathHalo.geometry, path, false, null);
    this.path.visible = true;
    this.pathHalo.visible = true;
    setPositions(this.handles.geometry, handleSegments);
    this.handles.visible = true;
    setPoints(this.tangentPoints.geometry, handlePoints);
    this.tangentPoints.visible = true;

    const anchors = this.operation.points;
    setPoints(this.anchors.geometry, anchors);
    this.anchors.visible = true;
    const selectedIndex = options.selectedIndex ?? null;
    if (selectedIndex != null && selectedIndex >= 0 && selectedIndex < anchors.length) {
      setPoints(this.anchorHighlight.geometry, [anchors[selectedIndex]!]);
      this.anchorHighlight.visible = true;
    } else {
      this.anchorHighlight.visible = false;
    }
  }

  /** Draft curve points already live in world space, so attach directly to the scene. */
  syncDraft(
    parent: Object3D | null,
    operation: CurveOperation | null,
    previewPoint: { x: number; y: number; z: number } | null = null,
    options: CurveControlSyncOptions = {},
  ): void {
    this.meshBezier = false;
    if (!parent || !operation || (!options.editNodes && !options.showDraftPath)) {
      this.hide();
      return;
    }
    if (this.root.parent !== parent) parent.add(this.root);
    this.syncOperation(operation, previewPoint, options);
  }

  private syncOperation(
    operation: CurveOperation,
    previewPoint: { x: number; y: number; z: number } | null = null,
    options: CurveControlSyncOptions = {},
  ): void {
    this.operation = operation;
    this.root.visible = true;

    const editNodes = !!options.editNodes;
    const showDraftPath = !!options.showDraftPath;
    const showAnchors = editNodes;
    const showHandles = editNodes && operation.curveType === 'bezier';

    const evaluated = evaluateCurvePath(operation);
    setSegmentPath(this.path.geometry, evaluated, operation.cyclic, previewPoint);
    setSegmentPath(this.pathHalo.geometry, evaluated, operation.cyclic, previewPoint);
    this.path.visible = showDraftPath || editNodes;
    this.pathHalo.visible = this.path.visible;
    setPoints(this.anchors.geometry, operation.points);
    this.anchors.visible = showAnchors;

    const selectedIndex = options.selectedIndex ?? null;
    if (
      showAnchors &&
      selectedIndex != null &&
      selectedIndex >= 0 &&
      selectedIndex < operation.points.length
    ) {
      setPoints(this.anchorHighlight.geometry, [operation.points[selectedIndex]!]);
      this.anchorHighlight.visible = true;
    } else {
      this.anchorHighlight.visible = false;
    }

    if (showHandles) {
      const segments = operation.points.flatMap((point, index) => [
        point,
        operation.handlesIn[index]!,
        point,
        operation.handlesOut[index]!,
      ]);
      setPositions(this.handles.geometry, segments);
      setPoints(
        this.tangentPoints.geometry,
        operation.points.flatMap((_point, index) => [
          operation.handlesIn[index]!,
          operation.handlesOut[index]!,
        ]),
      );
      this.handles.visible = true;
      this.tangentPoints.visible = true;
    } else {
      this.handles.visible = false;
      this.tangentPoints.visible = false;
    }
  }

  private hide(): void {
    this.operation = null;
    this.meshBezier = false;
    this.root.visible = false;
    this.root.parent?.remove(this.root);
  }

  pick(raycaster: Raycaster, threshold: number): CurveControlTarget | null {
    if (!this.root.visible || !this.operation) return null;
    raycaster.params.Points = { threshold: Math.max(0.03, threshold) };
    const anchorHit = this.anchors.visible
      ? raycaster.intersectObject(this.anchors, false)[0]
      : undefined;
    const highlightHit = this.anchorHighlight.visible
      ? raycaster.intersectObject(this.anchorHighlight, false)[0]
      : undefined;
    const tangentHit = this.tangentPoints.visible
      ? raycaster.intersectObject(this.tangentPoints, false)[0]
      : undefined;
    const bestAnchor =
      anchorHit && highlightHit
        ? anchorHit.distance <= highlightHit.distance
          ? anchorHit
          : highlightHit
        : anchorHit ?? highlightHit;
    if (!bestAnchor && !tangentHit) return null;
    if (bestAnchor && (!tangentHit || bestAnchor.distance <= tangentHit.distance)) {
      return { kind: 'anchor', index: bestAnchor.index ?? 0 };
    }
    const targetIndex = tangentHit?.index ?? 0;
    if (this.meshBezier) {
      return {
        kind: targetIndex % 2 === 0 ? 'handle-out' : 'handle-in',
        index: Math.floor(targetIndex / 2),
      };
    }
    return {
      kind: targetIndex % 2 === 0 ? 'handle-in' : 'handle-out',
      index: Math.floor(targetIndex / 2),
    };
  }

  dispose(): void {
    this.root.parent?.remove(this.root);
    for (const object of [
      this.pathHalo,
      this.path,
      this.handles,
      this.anchors,
      this.anchorHighlight,
      this.tangentPoints,
    ]) {
      object.geometry.dispose();
      disposeMaterial(object);
    }
  }
}

function makeSegments(color: number, opacity: number, renderBias: number): LineSegments {
  const result = new LineSegments(
    new BufferGeometry(),
    new LineBasicMaterial({
      color: new Color(color),
      opacity,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    }),
  );
  result.renderOrder = 120 + renderBias;
  result.raycast = () => {};
  return result;
}

function makePoints(map: Texture | null, size: number): Points {
  const result = new Points(
    new BufferGeometry(),
    new PointsMaterial({
      color: 0xffffff,
      map: map ?? undefined,
      size,
      sizeAttenuation: false,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      alphaTest: 0.12,
    }),
  );
  result.renderOrder = 124;
  return result;
}

function circleTexture(fill: string, stroke: string, line = 5): Texture | null {
  if (typeof document === 'undefined') return null;
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.clearRect(0, 0, size, size);
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2 - 6, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = line;
  ctx.strokeStyle = stroke;
  ctx.stroke();
  const texture = new CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

function anchorTexture(): Texture | null {
  return circleTexture('#fff6e4', '#c47a2a', 6);
}

function anchorSelectedTexture(): Texture | null {
  return circleTexture('#ffe08a', '#ffffff', 6);
}

function handleTexture(): Texture | null {
  return circleTexture('#f0b35a', '#5c3b16', 5);
}

function setSegmentPath(
  geometry: BufferGeometry,
  points: Array<{ x: number; y: number; z: number }>,
  cyclic: boolean,
  previewPoint: { x: number; y: number; z: number } | null = null,
): void {
  const values: Array<{ x: number; y: number; z: number }> = [];
  for (let index = 1; index < points.length; index++) values.push(points[index - 1]!, points[index]!);
  if (cyclic && points.length > 2) values.push(points[points.length - 1]!, points[0]!);
  else if (previewPoint && points.length > 0) values.push(points[points.length - 1]!, previewPoint);
  setPositions(geometry, values);
}

function setPoints(geometry: BufferGeometry, points: Array<{ x: number; y: number; z: number }>): void {
  setPositions(geometry, points);
}

function setPositions(geometry: BufferGeometry, points: Array<{ x: number; y: number; z: number }>): void {
  const values = new Float32Array(points.length * 3);
  for (let index = 0; index < points.length; index++) {
    const point = points[index]!;
    values[index * 3] = point.x;
    values[index * 3 + 1] = point.y;
    values[index * 3 + 2] = point.z;
  }
  geometry.setAttribute('position', new BufferAttribute(values, 3));
  geometry.computeBoundingSphere();
}

function disposeMaterial(object: Object3D): void {
  const material = (object as LineSegments | Points).material;
  if (Array.isArray(material)) material.forEach((item) => item.dispose());
  else material.dispose();
}
