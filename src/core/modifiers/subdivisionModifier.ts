import { addVec3, scaleVec3 } from '@/core/math/Vec3';
import type { Vec3 } from '@/core/math/Vec3';
import {
  addFace,
  addVertex,
  buildEdgeLookup,
  createEmptyMesh,
  edgeKey,
  faceVertexIds,
  getEdgeVertices,
} from '@/core/mesh/EditableMesh';
import type { EditableMesh, EdgeId, FaceId, VertexId } from '@/core/mesh/types';

function averagePositions(positions: Vec3[]): Vec3 {
  if (!positions.length) return { x: 0, y: 0, z: 0 };
  const sum = positions.reduce((acc, position) => addVec3(acc, position), { x: 0, y: 0, z: 0 });
  return scaleVec3(sum, 1 / positions.length);
}

function edgeIsSharp(mesh: EditableMesh, edgeId: EdgeId, useCrease: boolean): boolean {
  if (!useCrease) return false;
  const edge = mesh.edges.get(edgeId);
  if (!edge) return false;
  return edge.sharpness >= 0.999 || edge.crease >= 0.999;
}

function buildEdgeFaceMap(mesh: EditableMesh): Map<EdgeId, FaceId[]> {
  const map = new Map<EdgeId, FaceId[]>();
  for (const faceId of mesh.faces.keys()) {
    const loop = faceVertexIds(mesh, faceId);
    for (let index = 0; index < loop.length; index += 1) {
      const a = loop[index]!;
      const b = loop[(index + 1) % loop.length]!;
      const key = edgeKey(a, b);
      for (const edge of mesh.edges.values()) {
        const pair = getEdgeVertices(mesh, edge.id);
        if (!pair) continue;
        if (edgeKey(pair[0], pair[1]) !== key) continue;
        const list = map.get(edge.id) ?? [];
        list.push(faceId);
        map.set(edge.id, list);
        break;
      }
    }
  }
  return map;
}

function buildVertexFaceEdgeMap(mesh: EditableMesh): Map<VertexId, { faces: FaceId[]; edges: EdgeId[] }> {
  const map = new Map<VertexId, { faces: FaceId[]; edges: EdgeId[] }>();
  const ensure = (vertexId: VertexId) => {
    if (!map.has(vertexId)) map.set(vertexId, { faces: [], edges: [] });
    return map.get(vertexId)!;
  };

  for (const faceId of mesh.faces.keys()) {
    const loop = faceVertexIds(mesh, faceId);
    for (const vertexId of loop) ensure(vertexId).faces.push(faceId);
    for (let index = 0; index < loop.length; index += 1) {
      const a = loop[index]!;
      const b = loop[(index + 1) % loop.length]!;
      const key = edgeKey(a, b);
      for (const edge of mesh.edges.values()) {
        const pair = getEdgeVertices(mesh, edge.id);
        if (!pair || edgeKey(pair[0], pair[1]) !== key) continue;
        ensure(a).edges.push(edge.id);
        ensure(b).edges.push(edge.id);
        break;
      }
    }
  }
  return map;
}

function computeFacePoints(mesh: EditableMesh): Map<FaceId, Vec3> {
  const points = new Map<FaceId, Vec3>();
  for (const faceId of mesh.faces.keys()) {
    const positions = faceVertexIds(mesh, faceId).map((id) => mesh.vertices.get(id)!.position);
    points.set(faceId, averagePositions(positions));
  }
  return points;
}

function computeEdgePoints(
  mesh: EditableMesh,
  facePoints: Map<FaceId, Vec3>,
  edgeFaces: Map<EdgeId, FaceId[]>,
  useCrease: boolean,
): Map<EdgeId, Vec3> {
  const points = new Map<EdgeId, Vec3>();
  for (const edge of mesh.edges.values()) {
    const pair = getEdgeVertices(mesh, edge.id);
    if (!pair) continue;
    const [a, b] = pair;
    const pa = mesh.vertices.get(a)!.position;
    const pb = mesh.vertices.get(b)!.position;
    if (edgeIsSharp(mesh, edge.id, useCrease)) {
      points.set(edge.id, averagePositions([pa, pb]));
      continue;
    }
    const faces = edgeFaces.get(edge.id) ?? [];
    if (faces.length >= 2) {
      points.set(
        edge.id,
        averagePositions([pa, pb, facePoints.get(faces[0]!)!, facePoints.get(faces[1]!)!]),
      );
    } else if (faces.length === 1) {
      points.set(edge.id, averagePositions([pa, pb, facePoints.get(faces[0]!)!]));
    } else {
      points.set(edge.id, averagePositions([pa, pb]));
    }
  }
  return points;
}

function computeVertexPoints(
  mesh: EditableMesh,
  facePoints: Map<FaceId, Vec3>,
  edgePoints: Map<EdgeId, Vec3>,
  vertexAdjacency: Map<VertexId, { faces: FaceId[]; edges: EdgeId[] }>,
  useCrease: boolean,
): Map<VertexId, Vec3> {
  const points = new Map<VertexId, Vec3>();
  for (const vertex of mesh.vertices.values()) {
    const adjacency = vertexAdjacency.get(vertex.id) ?? { faces: [], edges: [] };
    const sharpEdges = adjacency.edges.filter((edgeId) => edgeIsSharp(mesh, edgeId, useCrease));
    if (useCrease && sharpEdges.length >= 2) {
      points.set(vertex.id, { ...vertex.position });
      continue;
    }

    const faceAvg = averagePositions(
      adjacency.faces.map((faceId) => facePoints.get(faceId)!).filter(Boolean),
    );
    const edgeAvg = averagePositions(
      adjacency.edges.map((edgeId) => edgePoints.get(edgeId)!).filter(Boolean),
    );
    const n = adjacency.faces.length || 1;
    const scaledFace = scaleVec3(faceAvg, 1);
    const scaledEdges = scaleVec3(edgeAvg, 2);
    const scaledOriginal = scaleVec3(vertex.position, n - 3);
    points.set(
      vertex.id,
      scaleVec3(addVec3(addVec3(scaledFace, scaledEdges), scaledOriginal), 1 / n),
    );
  }
  return points;
}

function findEdgeBetween(mesh: EditableMesh, a: VertexId, b: VertexId): EdgeId | null {
  const key = edgeKey(a, b);
  for (const edge of mesh.edges.values()) {
    const pair = getEdgeVertices(mesh, edge.id);
    if (pair && edgeKey(pair[0], pair[1]) === key) return edge.id;
  }
  return null;
}

export function catmullClarkSubdivideOnce(mesh: EditableMesh, useCrease: boolean): EditableMesh {
  if (!mesh.faces.size) return mesh;

  const facePoints = computeFacePoints(mesh);
  const edgeFaces = buildEdgeFaceMap(mesh);
  const edgePoints = computeEdgePoints(mesh, facePoints, edgeFaces, useCrease);
  const vertexAdjacency = buildVertexFaceEdgeMap(mesh);
  const vertexPoints = computeVertexPoints(mesh, facePoints, edgePoints, vertexAdjacency, useCrease);

  const target = createEmptyMesh(`${mesh.name}_subd`);
  target.materialSlotCount = mesh.materialSlotCount;
  const edgeLookup = buildEdgeLookup(target);

  const facePointVerts = new Map<FaceId, VertexId>();
  const edgePointVerts = new Map<EdgeId, VertexId>();
  const vertexPointVerts = new Map<VertexId, VertexId>();

  const faceVert = (faceId: FaceId) => {
    let id = facePointVerts.get(faceId);
    if (!id) {
      id = addVertex(target, facePoints.get(faceId)!);
      facePointVerts.set(faceId, id);
    }
    return id;
  };
  const edgeVert = (edgeId: EdgeId) => {
    let id = edgePointVerts.get(edgeId);
    if (!id) {
      id = addVertex(target, edgePoints.get(edgeId)!);
      edgePointVerts.set(edgeId, id);
    }
    return id;
  };
  const originalVert = (vertexId: VertexId) => {
    let id = vertexPointVerts.get(vertexId);
    if (!id) {
      id = addVertex(target, vertexPoints.get(vertexId)!);
      vertexPointVerts.set(vertexId, id);
    }
    return id;
  };

  for (const faceId of mesh.faces.keys()) {
    const loop = faceVertexIds(mesh, faceId);
    const materialSlot = mesh.faces.get(faceId)?.materialSlot ?? 0;
    const f = faceVert(faceId);
    for (let index = 0; index < loop.length; index += 1) {
      const v0 = loop[index]!;
      const v1 = loop[(index + 1) % loop.length]!;
      const vPrev = loop[(index + loop.length - 1) % loop.length]!;
      const edgeNext = findEdgeBetween(mesh, v0, v1);
      const edgePrev = findEdgeBetween(mesh, vPrev, v0);
      if (!edgeNext || !edgePrev) continue;
      addFace(
        target,
        [originalVert(v0), edgeVert(edgeNext), f, edgeVert(edgePrev)],
        { materialSlot, edgeLookup },
      );
    }
  }

  return target;
}

export function catmullClarkSubdivide(mesh: EditableMesh, levels: number, useCrease: boolean): EditableMesh {
  const count = Math.max(1, Math.min(6, Math.round(levels)));
  let current = mesh;
  for (let level = 0; level < count; level += 1) {
    current = catmullClarkSubdivideOnce(current, useCrease);
  }
  return current;
}
