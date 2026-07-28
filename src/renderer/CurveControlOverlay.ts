import {
  BufferAttribute,
  BufferGeometry,
  Group,
  LineBasicMaterial,
  LineSegments,
  Points,
  PointsMaterial,
  Raycaster,
  type Object3D,
} from 'three';
import {
  evaluateCurvePath,
  type CurveOperation,
} from '@/core/curves/CurveOperation';
import type { ObjectRenderHandle } from '@/renderer/MeshRenderAdapter';

export type CurveControlTarget = {
  kind: 'anchor' | 'handle-in' | 'handle-out' | 'scale-start' | 'scale-mid' | 'scale-end';
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
  private path = makeSegments(0x5de7ff, 1);
  private handles = makeSegments(0xffbd66, 0.72);
  private anchors = makePoints(0xff8f24, 11);
  private anchorHighlight = makePoints(0xfff1d0, 14);
  private tangentPoints = makePoints(0xffd58a, 8);
  private crossSectionPoints = makePoints(0x61f0b5, 12);
  private operation: CurveOperation | null = null;

  constructor() {
    this.root.name = 'CurveControlOverlay';
    this.root.userData.nonSelectable = true;
    this.root.renderOrder = 120;
    this.root.add(
      this.path,
      this.handles,
      this.anchors,
      this.anchorHighlight,
      this.tangentPoints,
      this.crossSectionPoints,
    );
    this.root.visible = false;
  }

  sync(
    handle: ObjectRenderHandle | null,
    operation: CurveOperation | null,
    options: CurveControlSyncOptions = {},
  ): void {
    if (!handle || !operation || !options.editNodes) {
      this.hide();
      return;
    }
    if (this.root.parent !== handle.group) handle.group.add(this.root);
    this.syncOperation(operation, null, options);
  }

  /** Draft curve points already live in world space, so attach directly to the scene. */
  syncDraft(
    parent: Object3D | null,
    operation: CurveOperation | null,
    previewPoint: { x: number; y: number; z: number } | null = null,
    options: CurveControlSyncOptions = {},
  ): void {
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
    const showHandles =
      editNodes && operation.curveType === 'bezier';

    const evaluated = evaluateCurvePath(operation);
    (this.path.material as LineBasicMaterial).color.setHex(
      operation.cyclic ? 0xa8d34f : 0x5de7ff,
    );
    setSegmentPath(this.path.geometry, evaluated, operation.cyclic, previewPoint);
    this.path.visible = showDraftPath || editNodes;
    setPoints(this.anchors.geometry, operation.points);
    this.anchors.visible = showAnchors;
    (this.anchors.material as PointsMaterial).size = operation.inputMode === 'sketch' ? 9 : 11;

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
    const showCrossSections =
      editNodes &&
      operation.style === 'segmented-sweep' &&
      operation.points.length >= 2;
    if (showCrossSections) {
      const indices = [
        0,
        Math.floor((operation.points.length - 1) / 2),
        operation.points.length - 1,
      ];
      const scales = [operation.startScale, operation.midScale, operation.endScale];
      setPoints(
        this.crossSectionPoints.geometry,
        indices.map((index, scaleIndex) => ({
          x:
            operation.points[index]!.x +
            operation.radius * operation.profileWidth * scales[scaleIndex]!,
          y: operation.points[index]!.y,
          z: operation.points[index]!.z,
        })),
      );
      this.crossSectionPoints.visible = true;
    } else {
      this.crossSectionPoints.visible = false;
    }
  }

  private hide(): void {
    this.operation = null;
    this.root.visible = false;
    this.root.parent?.remove(this.root);
  }

  pick(raycaster: Raycaster, threshold: number): CurveControlTarget | null {
    if (!this.root.visible || !this.operation) return null;
    raycaster.params.Points = { threshold: Math.max(0.025, threshold) };
    const anchorHit = this.anchors.visible
      ? raycaster.intersectObject(this.anchors, false)[0]
      : undefined;
    const highlightHit = this.anchorHighlight.visible
      ? raycaster.intersectObject(this.anchorHighlight, false)[0]
      : undefined;
    const tangentHit =
      this.operation.curveType === 'bezier' && this.tangentPoints.visible
        ? raycaster.intersectObject(this.tangentPoints, false)[0]
        : undefined;
    const scaleHit = this.crossSectionPoints.visible
      ? raycaster.intersectObject(this.crossSectionPoints, false)[0]
      : undefined;
    if (scaleHit && (!anchorHit || scaleHit.distance < anchorHit.distance)) {
      const index = scaleHit.index ?? 0;
      return {
        kind: index === 0 ? 'scale-start' : index === 1 ? 'scale-mid' : 'scale-end',
        index,
      };
    }
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
    return {
      kind: targetIndex % 2 === 0 ? 'handle-in' : 'handle-out',
      index: Math.floor(targetIndex / 2),
    };
  }

  dispose(): void {
    this.root.parent?.remove(this.root);
    for (const object of [
      this.path,
      this.handles,
      this.anchors,
      this.anchorHighlight,
      this.tangentPoints,
      this.crossSectionPoints,
    ]) {
      object.geometry.dispose();
      disposeMaterial(object);
    }
  }
}

function makeSegments(color: number, opacity: number): LineSegments {
  const result = new LineSegments(
    new BufferGeometry(),
    new LineBasicMaterial({
      color,
      opacity,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    }),
  );
  result.renderOrder = 121;
  result.raycast = () => {};
  return result;
}

function makePoints(color: number, size: number): Points {
  const result = new Points(
    new BufferGeometry(),
    new PointsMaterial({
      color,
      size,
      sizeAttenuation: false,
      depthTest: false,
      depthWrite: false,
    }),
  );
  result.renderOrder = 122;
  return result;
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
