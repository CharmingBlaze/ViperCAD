import { BufferAttribute, BufferGeometry, Color, DoubleSide, Group, LineBasicMaterial, LineSegments, Mesh, MeshStandardMaterial, Points, PointsMaterial } from 'three';
import { addVec3, scaleVec3, type Vec3 } from '@/core/math/Vec3';
import { getEdgeVertices } from '@/core/mesh/EditableMesh';
import type { EditableMesh } from '@/core/mesh/types';
import type { PrimitiveConstructionCage } from '@/core/primitives/PrimitiveFactory';
import { editableMeshToRenderData } from './MeshRenderAdapter';

/** One temporary preview group rendered by every viewport camera. */
export class PrimitivePreviewHandle {
  readonly group = new Group();
  private ghostMaterial = new MeshStandardMaterial({ color: new Color(0x65b8ff), transparent: true, opacity: 0.34, depthWrite: false, side: DoubleSide, roughness: 0.72, metalness: 0 });
  private cageMaterial = new LineBasicMaterial({ color: 0x9bd4ff, transparent: true, opacity: 0.92, depthTest: false, depthWrite: false });
  private baseMaterial = new LineBasicMaterial({ color: 0xd7efff, transparent: true, opacity: 1, depthTest: false, depthWrite: false });
  private edgeMaterial = new LineBasicMaterial({ color: 0x5d9fd1, transparent: true, opacity: 0.55, depthTest: true, depthWrite: false });
  private allEdgeMaterial = new LineBasicMaterial({ color: 0x62849d, transparent: true, opacity: 0.72, depthTest: false, depthWrite: false });
  private polyMaterial = new LineBasicMaterial({ color: 0xd7efff, transparent: true, opacity: 0.95, depthTest: false, depthWrite: false });
  private closeMaterial = new LineBasicMaterial({ color: 0x7dffb0, transparent: true, opacity: 1, depthTest: false, depthWrite: false });
  private faceGhostMaterial = new MeshStandardMaterial({ color: new Color(0x7dffb0), transparent: true, opacity: 0.22, depthWrite: false, side: DoubleSide, roughness: 0.8, metalness: 0 });
  private originMaterial = new PointsMaterial({ color: 0xffffff, size: 7, sizeAttenuation: false, depthTest: false, depthWrite: false });
  private allVertexMaterial = new PointsMaterial({ color: 0x7fa7c5, size: 6, sizeAttenuation: false, transparent: true, opacity: 0.82, depthTest: false, depthWrite: false });
  private vertexMaterial = new PointsMaterial({ color: 0x9bd4ff, size: 8, sizeAttenuation: false, depthTest: false, depthWrite: false });
  private newVertexMaterial = new PointsMaterial({ color: 0xffb84d, size: 10, sizeAttenuation: false, depthTest: false, depthWrite: false });
  private startMaterial = new PointsMaterial({ color: 0x7dffb0, size: 12, sizeAttenuation: false, depthTest: false, depthWrite: false });
  private ghost: Mesh | null = null;
  private cageLines: LineSegments | null = null;
  private baseLines: LineSegments | null = null;
  private logicalEdges: LineSegments | null = null;
  private allEdgeLines: LineSegments | null = null;
  private polyLines: LineSegments | null = null;
  private closeLines: LineSegments | null = null;
  private faceGhost: Mesh | null = null;
  private originPoint: Points | null = null;
  private allVertexPoints: Points | null = null;
  private vertexPoints: Points | null = null;
  private newVertexPoints: Points | null = null;
  private startPoint: Points | null = null;
  revision = -1;

  constructor() {
    this.group.name = '__primitive_preview__';
    this.group.userData.nonSelectable = true;
    this.group.renderOrder = 100;
  }

  update(mesh: EditableMesh | null, cage: PrimitiveConstructionCage | null, revision: number): void {
    if (this.revision === revision) return;
    this.clearGeometry();
    this.revision = revision;
    if (!mesh) {
      this.group.visible = false;
      return;
    }
    this.group.visible = true;
    const render = editableMeshToRenderData(mesh);
    this.ghost = new Mesh(render.geometry, this.ghostMaterial);
    this.ghost.renderOrder = 50;
    this.ghost.userData.nonSelectable = true;
    this.group.add(this.ghost);
    this.logicalEdges = new LineSegments(edgeGeometry(mesh), this.edgeMaterial);
    this.logicalEdges.renderOrder = 51;
    this.group.add(this.logicalEdges);
    if (!cage) return;
    const corners = cageCorners(cage);
    this.cageLines = new LineSegments(
      segmentGeometry(corners, [
        [0, 1],
        [1, 2],
        [2, 3],
        [3, 0],
        [4, 5],
        [5, 6],
        [6, 7],
        [7, 4],
        [0, 4],
        [1, 5],
        [2, 6],
        [3, 7],
      ]),
      this.cageMaterial,
    );
    this.cageLines.renderOrder = 60;
    this.group.add(this.cageLines);
    this.baseLines = new LineSegments(
      segmentGeometry(corners, [
        [0, 1],
        [1, 2],
        [2, 3],
        [3, 0],
      ]),
      this.baseMaterial,
    );
    this.baseLines.renderOrder = 61;
    this.group.add(this.baseLines);
    this.originPoint = new Points(pointGeometry(cage.origin), this.originMaterial);
    this.originPoint.renderOrder = 62;
    this.group.add(this.originPoint);
  }

  /**
   * Chain segments + rubber-band + vertex markers for draw-poly.
   * When canClose, highlights the closing segment and start vertex; optional face ghost.
   */
  updatePolyline(
    points: Vec3[],
    revision: number,
    options: {
      chainCount?: number;
      canClose?: boolean;
      allVertexPoints?: Vec3[];
      allEdgeSegments?: Array<[Vec3, Vec3]>;
      chainPoints?: Vec3[];
      createdPoints?: Vec3[];
      showFaceGhost?: boolean;
    } = {},
  ): void {
    if (this.revision === revision) return;
    this.clearGeometry();
    this.revision = revision;
    const allVertexPoints = options.allVertexPoints ?? [];
    const allEdgeSegments = options.allEdgeSegments ?? [];
    if (points.length < 1 && allVertexPoints.length < 1 && allEdgeSegments.length < 1) {
      this.group.visible = false;
      return;
    }
    this.group.visible = true;
    const chainCount = options.chainCount ?? Math.max(0, points.length - 1);
    const chainPoints = options.chainPoints ?? points.slice(0, Math.min(chainCount, points.length));

    if (allEdgeSegments.length) {
      const edgePoints = allEdgeSegments.flatMap(([a, b]) => [a, b]);
      const edgePairs = allEdgeSegments.map((_, index) => [index * 2, index * 2 + 1]);
      this.allEdgeLines = new LineSegments(
        segmentGeometry(edgePoints, edgePairs),
        this.allEdgeMaterial,
      );
      this.allEdgeLines.renderOrder = 59;
      this.group.add(this.allEdgeLines);
    }

    if (allVertexPoints.length) {
      this.allVertexPoints = new Points(pointsGeometry(allVertexPoints), this.allVertexMaterial);
      this.allVertexPoints.renderOrder = 61;
      this.group.add(this.allVertexPoints);
    }

    if (points.length >= 2) {
      const pairs: number[][] = [];
      const lastSeg = points.length - 2;
      for (let i = 0; i < lastSeg; i++) pairs.push([i, i + 1]);
      if (pairs.length) {
        this.polyLines = new LineSegments(segmentGeometry(points, pairs), this.polyMaterial);
        this.polyLines.renderOrder = 60;
        this.group.add(this.polyLines);
      }
      this.closeLines = new LineSegments(
        segmentGeometry(points, [[lastSeg, lastSeg + 1]]),
        options.canClose ? this.closeMaterial : this.polyMaterial,
      );
      this.closeLines.renderOrder = 61;
      this.group.add(this.closeLines);
    }

    if (options.showFaceGhost !== false && chainPoints.length >= 3) {
      this.faceGhost = new Mesh(fanGeometry(chainPoints), this.faceGhostMaterial);
      this.faceGhost.renderOrder = 55;
      this.faceGhost.userData.nonSelectable = true;
      this.group.add(this.faceGhost);
    }

    if (chainPoints.length) {
      this.vertexPoints = new Points(pointsGeometry(chainPoints), this.vertexMaterial);
      this.vertexPoints.renderOrder = 62;
      this.group.add(this.vertexPoints);
      if (options.createdPoints?.length) {
        this.newVertexPoints = new Points(pointsGeometry(options.createdPoints), this.newVertexMaterial);
        this.newVertexPoints.renderOrder = 63;
        this.group.add(this.newVertexPoints);
      }
      this.startPoint = new Points(pointGeometry(chainPoints[0]!), this.startMaterial);
      this.startPoint.renderOrder = 64;
      this.group.add(this.startPoint);
    }
  }

  /** Disconnected world-space segments for loop/knife-style previews. */
  updateSegments(segments: Array<[Vec3, Vec3]>, revision: number): void {
    if (this.revision === revision) return;
    this.clearGeometry();
    this.revision = revision;
    if (!segments.length) {
      this.group.visible = false;
      return;
    }
    this.group.visible = true;
    const points = segments.flatMap(([a, b]) => [a, b]);
    const pairs = segments.map((_, index) => [index * 2, index * 2 + 1]);
    this.polyLines = new LineSegments(segmentGeometry(points, pairs), this.closeMaterial);
    this.polyLines.renderOrder = 61;
    this.group.add(this.polyLines);
  }

  dispose(): void {
    this.clearGeometry();
    this.ghostMaterial.dispose();
    this.cageMaterial.dispose();
    this.baseMaterial.dispose();
    this.edgeMaterial.dispose();
    this.allEdgeMaterial.dispose();
    this.polyMaterial.dispose();
    this.closeMaterial.dispose();
    this.faceGhostMaterial.dispose();
    this.originMaterial.dispose();
    this.allVertexMaterial.dispose();
    this.vertexMaterial.dispose();
    this.newVertexMaterial.dispose();
    this.startMaterial.dispose();
  }

  private clearGeometry(): void {
    for (const object of [
      this.ghost,
      this.cageLines,
      this.baseLines,
      this.logicalEdges,
      this.allEdgeLines,
      this.polyLines,
      this.closeLines,
      this.faceGhost,
      this.originPoint,
      this.allVertexPoints,
      this.vertexPoints,
      this.newVertexPoints,
      this.startPoint,
    ]) {
      if (object) {
        this.group.remove(object);
        object.geometry.dispose();
      }
    }
    this.ghost = null;
    this.cageLines = null;
    this.baseLines = null;
    this.logicalEdges = null;
    this.allEdgeLines = null;
    this.polyLines = null;
    this.closeLines = null;
    this.faceGhost = null;
    this.originPoint = null;
    this.allVertexPoints = null;
    this.vertexPoints = null;
    this.newVertexPoints = null;
    this.startPoint = null;
  }
}

function cageCorners(c: PrimitiveConstructionCage): Vec3[] {
  const u = scaleVec3(c.axisU, c.sizeU);
  const v = scaleVec3(c.axisV, c.sizeV);
  const n = scaleVec3(c.axisNormal, c.sizeNormal);
  const o = c.origin;
  return [
    o,
    addVec3(o, u),
    addVec3(addVec3(o, u), v),
    addVec3(o, v),
    addVec3(o, n),
    addVec3(addVec3(o, u), n),
    addVec3(addVec3(addVec3(o, u), v), n),
    addVec3(addVec3(o, v), n),
  ];
}

function segmentGeometry(points: Vec3[], pairs: number[][]) {
  const data: number[] = [];
  for (const [a, b] of pairs) {
    const p = points[a!]!;
    const q = points[b!]!;
    data.push(p.x, p.y, p.z, q.x, q.y, q.z);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(data), 3));
  return g;
}

function edgeGeometry(mesh: EditableMesh) {
  const data: number[] = [];
  for (const edge of mesh.edges.values()) {
    const pair = getEdgeVertices(mesh, edge.id);
    if (!pair) continue;
    const a = mesh.vertices.get(pair[0])!.position;
    const b = mesh.vertices.get(pair[1])!.position;
    data.push(a.x, a.y, a.z, b.x, b.y, b.z);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(data), 3));
  return g;
}

function pointGeometry(point: Vec3) {
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array([point.x, point.y, point.z]), 3));
  return g;
}

function pointsGeometry(points: Vec3[]) {
  const data = new Float32Array(points.length * 3);
  for (let i = 0; i < points.length; i++) {
    const p = points[i]!;
    data[i * 3] = p.x;
    data[i * 3 + 1] = p.y;
    data[i * 3 + 2] = p.z;
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(data, 3));
  return g;
}

function fanGeometry(points: Vec3[]) {
  if (points.length < 3) return new BufferGeometry();
  const data: number[] = [];
  const o = points[0]!;
  for (let i = 1; i < points.length - 1; i++) {
    const a = points[i]!;
    const b = points[i + 1]!;
    data.push(o.x, o.y, o.z, a.x, a.y, a.z, b.x, b.y, b.z);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(data), 3));
  g.computeVertexNormals();
  return g;
}
