import { commitMeshObject } from '@/core/document/ModelDocument';
import type { ObjectId, SceneObject } from '@/core/document/types';
import { transformPoint } from '@/core/math/Transform';
import {
  addVec3,
  lengthSqVec3,
  scaleVec3,
  subVec3,
  v3,
  type Vec3,
} from '@/core/math/Vec3';
import { getEdgeVertices, setVertexPosition } from '@/core/mesh/EditableMesh';
import { splitEdge } from '@/core/mesh/ops/basic';
import { pokeFaces } from '@/core/mesh/ops/subdivide';
import { setFacesShading } from '@/core/mesh/ops/shading';
import type { EditableMesh, VertexId } from '@/core/mesh/types';
import { validateMeshFull } from '@/core/mesh/Validation';
import { cloneSelection, type SelectionState } from '@/core/selection/SelectionManager';
import type { ModellingContext } from '@/core/tools/Tool';
import {
  cubicBezier,
  curveOperationFromStroke,
  evaluateCurveOperation,
  localizeCurveOperationToMeshCenter,
  readCurveOperation,
  serializeCurveOperation,
  type CurveOperation,
} from '@/core/curves/CurveOperation';

export const VERTEX_BEZIER_META = 'vertexBezier';

export type VertexBezierHandleTarget = {
  kind: 'anchor' | 'handle-in' | 'handle-out';
  index: number;
};

export type VertexBezierSegment = {
  startId: VertexId;
  endId: VertexId;
  handleOut: Vec3;
  handleIn: Vec3;
  sampleIds: VertexId[];
};

export type VertexBezierState = {
  version: 2;
  objectId: string;
  vertexIds: VertexId[];
  cyclic: boolean;
  segments: VertexBezierSegment[];
};

export const VERTEX_BEZIER_SAMPLES = 6;

export type VertexCurveOrder = {
  vertexIds: VertexId[];
  cyclic: boolean;
};

export function resolveVertexIdsForCurve(
  mesh: EditableMesh,
  selection: Pick<SelectionState, 'mode' | 'selectedVertexIds' | 'selectedEdgeIds'>,
): VertexId[] {
  if (selection.mode === 'vertex') {
    const selected = [...selection.selectedVertexIds].filter((id) => mesh.vertices.has(id));
    if (selected.length >= 2) return selected;
  }
  if (selection.mode === 'edge') {
    const fromEdges: VertexId[] = [];
    const seen = new Set<VertexId>();
    for (const edgeId of selection.selectedEdgeIds) {
      const pair = getEdgeVertices(mesh, edgeId);
      if (!pair) continue;
      for (const id of pair) {
        if (seen.has(id) || !mesh.vertices.has(id)) continue;
        seen.add(id);
        fromEdges.push(id);
      }
    }
    if (fromEdges.length >= 2) return fromEdges;
  }
  return [...mesh.vertices.keys()];
}

export function orderVerticesForCurve(
  mesh: EditableMesh,
  vertexIds: readonly VertexId[],
): VertexCurveOrder {
  const ids = [...new Set(vertexIds)].filter((id) => mesh.vertices.has(id));
  if (ids.length <= 1) return { vertexIds: ids, cyclic: false };

  const adjacency = buildVertexAdjacency(mesh, ids);
  const unused = new Set(ids);
  const chains: VertexCurveOrder[] = [];

  while (unused.size > 0) {
    const start = pickChainStart(mesh, adjacency, unused);
    const chain = [start];
    unused.delete(start);
    let current = start;
    while (true) {
      const candidates = (adjacency.get(current) ?? []).filter((id) => unused.has(id));
      if (candidates.length === 0) break;
      const next = nearestVertex(mesh, current, candidates);
      unused.delete(next);
      chain.push(next);
      current = next;
    }
    const neighbors = adjacency.get(start) ?? [];
    const cyclic = chain.length >= 3 && neighbors.includes(chain[chain.length - 1]!);
    chains.push({ vertexIds: chain, cyclic });
  }

  if (chains.length === 1) {
    const only = chains[0]!;
    return { vertexIds: only.vertexIds, cyclic: only.cyclic && only.vertexIds.length >= 3 };
  }

  return { vertexIds: stitchChains(mesh, chains), cyclic: false };
}

export function curvePointsFromOrderedVertices(
  mesh: EditableMesh,
  object: SceneObject,
  vertexIds: readonly VertexId[],
): Vec3[] {
  const points: Vec3[] = [];
  for (const id of vertexIds) {
    const vertex = mesh.vertices.get(id);
    if (!vertex) continue;
    const point = transformPoint(vertex.position, object.transform);
    const previous = points[points.length - 1];
    if (previous && lengthSqVec3(subVec3(point, previous)) < 1e-12) continue;
    points.push(point);
  }
  if (points.length >= 2) {
    const first = points[0]!;
    const last = points[points.length - 1]!;
    if (lengthSqVec3(subVec3(first, last)) < 1e-12) points.pop();
  }
  return points;
}

export function defaultBezierCurvePoints(): Vec3[] {
  return [v3(-1, 0, 0), v3(0, 0.75, 0), v3(1, 0, 0)];
}

export function createBezierCurveFromPoints(
  context: ModellingContext,
  points: Vec3[],
  options: { cyclic?: boolean; name?: string; radius?: number } = {},
): { ok: true; objectId: ObjectId } | { ok: false; error: string } {
  const anchors = points.length >= 2 ? points.map((point) => ({ ...point })) : defaultBezierCurvePoints();
  const radius = clampCurveRadius(options.radius ?? estimateCurveRadius(anchors));
  const operation = curveOperationFromStroke({
    style: 'tube',
    points: anchors,
    radius,
    resolution: 'medium',
    smooth: true,
    cyclic: options.cyclic === true && anchors.length >= 3,
    inputMode: 'pen',
    curveType: 'bezier',
  });
  const mesh = evaluateCurveOperation(operation);
  const errors = validateMeshFull(mesh).issues.filter((issue) => issue.severity === 'error');
  if (errors.length) {
    return { ok: false, error: errors.map((issue) => issue.message).join('; ') };
  }

  const beforeSelection = cloneSelection(context.selection.state);
  const localized = localizeCurveOperationToMeshCenter(mesh, operation);
  const { objectId, meshId } = commitMeshObject(context.document, mesh, {
    name: options.name ?? '3D Bézier Curve',
  });
  const object = context.document.objects.get(objectId)!;
  object.transform.position = localized.origin;
  object.kind = 'mesh';
  object.metadata.curveOperation = serializeCurveOperation(localized.operation);
  const meshRef = context.document.meshes.get(meshId)!;
  context.selection.setMode('object');
  context.selection.selectObjects([objectId], 'replace');
  const afterSelection = cloneSelection(context.selection.state);
  let applied = true;
  context.history.execute({
    name: 'Create 3D Bézier Curve',
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
      context.document.rootObjectIds = context.document.rootObjectIds.filter((id) => id !== object.id);
      if (![...context.document.objects.values()].some((item) => item.meshId === meshRef.id)) {
        context.document.meshes.delete(meshRef.id);
      }
      context.selection.state = cloneSelection(beforeSelection);
      context.document.dirty = true;
      applied = false;
    },
  });
  context.setGizmoMode?.('combined');
  context.setActiveTool?.('select');
  context.requestRedraw();
  return { ok: true, objectId };
}

export function createBezierCurveFromMeshVertices(
  context: ModellingContext,
  object: SceneObject,
  mesh: EditableMesh,
  vertexIds?: readonly VertexId[],
): { ok: true; objectId: ObjectId } | { ok: false; error: string } {
  const ids = vertexIds ?? resolveVertexIdsForCurve(mesh, context.selection.state);
  const ordered = orderVerticesForCurve(mesh, ids);
  const points = curvePointsFromOrderedVertices(mesh, object, ordered.vertexIds);
  if (points.length < 2) {
    return { ok: false, error: 'Need at least two vertices for a 3D Bézier curve' };
  }
  return createBezierCurveFromPoints(context, points, {
    cyclic: ordered.cyclic,
    name: `${object.name} Bézier`,
  });
}

export function enableBezierCurveGizmo(
  context: ModellingContext,
  object: SceneObject,
  mesh: EditableMesh,
): boolean {
  const operation = readCurveOperation(object.metadata.curveOperation);
  if (!operation) return false;
  if (operation.curveType !== 'bezier') {
    applyCurveOperation(context, object, mesh, { ...operation, curveType: 'bezier' }, 'Set Cubic Bézier');
  }
  context.selection.setMode('object');
  context.selection.selectObjects([object.id], 'replace');
  context.setGizmoMode?.('combined');
  context.setActiveTool?.('select');
  context.requestRedraw();
  return true;
}

function applyCurveOperation(
  context: ModellingContext,
  object: SceneObject,
  mesh: EditableMesh,
  next: CurveOperation,
  name: string,
): void {
  const beforeMesh = mesh;
  const beforeMetadata = object.metadata.curveOperation!;
  let afterMesh = evaluateCurveOperation(next);
  afterMesh.id = beforeMesh.id;
  let afterMetadata = serializeCurveOperation(next);
  let applied = true;
  context.document.meshes.set(beforeMesh.id, afterMesh);
  object.metadata.curveOperation = afterMetadata;
  context.document.dirty = true;
  context.history.execute({
    name,
    execute: () => {
      if (applied) return;
      context.document.meshes.set(beforeMesh.id, afterMesh);
      object.metadata.curveOperation = afterMetadata;
      context.document.dirty = true;
      applied = true;
    },
    undo: () => {
      context.document.meshes.set(beforeMesh.id, beforeMesh);
      object.metadata.curveOperation = beforeMetadata;
      context.document.dirty = true;
      applied = false;
    },
  });
}

function buildVertexAdjacency(
  mesh: EditableMesh,
  vertexIds: readonly VertexId[],
): Map<VertexId, VertexId[]> {
  const idSet = new Set(vertexIds);
  const adjacency = new Map<VertexId, VertexId[]>();
  for (const id of vertexIds) adjacency.set(id, []);
  for (const edge of mesh.edges.values()) {
    const pair = getEdgeVertices(mesh, edge.id);
    if (!pair) continue;
    const [a, b] = pair;
    if (!idSet.has(a) || !idSet.has(b) || a === b) continue;
    const aLinks = adjacency.get(a)!;
    const bLinks = adjacency.get(b)!;
    if (!aLinks.includes(b)) aLinks.push(b);
    if (!bLinks.includes(a)) bLinks.push(a);
  }
  return adjacency;
}

function pickChainStart(
  mesh: EditableMesh,
  adjacency: Map<VertexId, VertexId[]>,
  unused: Set<VertexId>,
): VertexId {
  let best: VertexId | null = null;
  let bestDegree = Infinity;
  let bestScore = Infinity;
  for (const id of unused) {
    const degree = (adjacency.get(id) ?? []).filter((other) => unused.has(other)).length;
    const position = mesh.vertices.get(id)!.position;
    const score = position.x + position.y * 0.01 + position.z * 0.001;
    if (degree < bestDegree || (degree === bestDegree && score < bestScore)) {
      best = id;
      bestDegree = degree;
      bestScore = score;
    }
    if (degree <= 1 && bestDegree <= 1) {
      /* keep scanning for a spatially earlier endpoint */
    }
  }
  return best ?? unused.values().next().value!;
}

function nearestVertex(mesh: EditableMesh, fromId: VertexId, candidates: VertexId[]): VertexId {
  const from = mesh.vertices.get(fromId)!.position;
  let best = candidates[0]!;
  let bestDist = Infinity;
  for (const id of candidates) {
    const dist = lengthSqVec3(subVec3(mesh.vertices.get(id)!.position, from));
    if (dist < bestDist) {
      best = id;
      bestDist = dist;
    }
  }
  return best;
}

function stitchChains(mesh: EditableMesh, chains: VertexCurveOrder[]): VertexId[] {
  const remaining = chains.map((chain) => [...chain.vertexIds]);
  remaining.sort((a, b) => b.length - a.length);
  const ordered = remaining.shift() ?? [];
  while (remaining.length > 0) {
    const end = mesh.vertices.get(ordered[ordered.length - 1]!)!.position;
    let bestIndex = 0;
    let bestFlip = false;
    let bestDist = Infinity;
    for (let index = 0; index < remaining.length; index++) {
      const chain = remaining[index]!;
      const startPos = mesh.vertices.get(chain[0]!)!.position;
      const endPos = mesh.vertices.get(chain[chain.length - 1]!)!.position;
      const startDist = lengthSqVec3(subVec3(startPos, end));
      const endDist = lengthSqVec3(subVec3(endPos, end));
      if (startDist < bestDist) {
        bestIndex = index;
        bestFlip = false;
        bestDist = startDist;
      }
      if (endDist < bestDist) {
        bestIndex = index;
        bestFlip = true;
        bestDist = endDist;
      }
    }
    const next = remaining.splice(bestIndex, 1)[0]!;
    if (bestFlip) next.reverse();
    ordered.push(...next);
  }
  return ordered;
}

function estimateCurveRadius(points: Vec3[]): number {
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (const point of points) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    minZ = Math.min(minZ, point.z);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
    maxZ = Math.max(maxZ, point.z);
  }
  const diagonal = Math.hypot(maxX - minX, maxY - minY, maxZ - minZ);
  return clampCurveRadius(diagonal * 0.035);
}

function clampCurveRadius(radius: number): number {
  if (!Number.isFinite(radius)) return 0.08;
  return Math.min(0.24, Math.max(0.02, radius));
}

export function createVertexBezierState(
  objectId: string,
  mesh: EditableMesh,
  selection: Pick<SelectionState, 'mode' | 'selectedVertexIds' | 'selectedEdgeIds'>,
): VertexBezierState | { error: string } {
  const anchors = resolveVertexIdsForCurve(mesh, selection);
  if (anchors.length < 2) {
    return { error: 'Need at least two vertices for Bézier handles' };
  }
  const ordered = orderVerticesForCurve(mesh, anchors);
  const segments = meshBezierSegments(mesh, new Set(anchors));
  if (segments.length === 0) {
    return { error: 'Need connected mesh edges between the chosen vertices' };
  }
  return {
    version: 2,
    objectId,
    vertexIds: ordered.vertexIds.length >= 2 ? ordered.vertexIds : anchors,
    cyclic: ordered.cyclic,
    segments,
  };
}

export function readVertexBezierState(
  metadata: Record<string, string> | undefined,
): VertexBezierState | null {
  const raw = metadata?.[VERTEX_BEZIER_META];
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as VertexBezierState;
    if (
      parsed?.version !== 2 ||
      typeof parsed.objectId !== 'string' ||
      !Array.isArray(parsed.vertexIds) ||
      !Array.isArray(parsed.segments) ||
      parsed.vertexIds.length < 2
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function serializeVertexBezierState(state: VertexBezierState): string {
  return JSON.stringify(state);
}

export function vertexBezierOverlayOperation(
  mesh: EditableMesh,
  state: VertexBezierState,
): CurveOperation | null {
  const points = localVertexPoints(mesh, state.vertexIds);
  if (points.length < 2) return null;
  const first = state.segments[0];
  const start = first ? mesh.vertices.get(first.startId)?.position : points[0];
  const end = first ? mesh.vertices.get(first.endId)?.position : points[1];
  if (!start || !end) return null;
  return curveOperationFromStroke({
    style: 'soft',
    points,
    radius: 0.08,
    resolution: 'medium',
    smooth: true,
    cyclic: state.cyclic,
    inputMode: 'pen',
    curveType: 'bezier',
    handlesIn: points.map((point, index) =>
      index === 1 && first ? addVec3(end, first.handleIn) : point,
    ),
    handlesOut: points.map((point, index) =>
      index === 0 && first ? addVec3(start, first.handleOut) : point,
    ),
  });
}

export function vertexBezierControlPoint(
  mesh: EditableMesh,
  state: VertexBezierState,
  target: VertexBezierHandleTarget,
): Vec3 | null {
  if (target.kind === 'anchor') {
    const id = state.vertexIds[target.index];
    return id ? mesh.vertices.get(id)?.position ?? null : null;
  }
  const segment = state.segments[target.index];
  if (!segment) return null;
  const start = mesh.vertices.get(segment.startId)?.position;
  const end = mesh.vertices.get(segment.endId)?.position;
  if (!start || !end) return null;
  return target.kind === 'handle-out' ? addVec3(start, segment.handleOut) : addVec3(end, segment.handleIn);
}

export function isVertexBezierPrepared(mesh: EditableMesh, state: VertexBezierState): boolean {
  if (state.version !== 2 || state.segments.length === 0) return false;
  return state.segments.every(
    (segment) =>
      mesh.vertices.has(segment.startId) &&
      mesh.vertices.has(segment.endId) &&
      segment.sampleIds.length >= 2 &&
      segment.sampleIds.every((id) => mesh.vertices.has(id)),
  );
}

export function prepareVertexBezierMesh(
  objectId: string,
  mesh: EditableMesh,
  selection: Pick<SelectionState, 'mode' | 'selectedVertexIds' | 'selectedEdgeIds'>,
  samples = VERTEX_BEZIER_SAMPLES,
): VertexBezierState | { error: string } {
  const created = createVertexBezierState(objectId, mesh, selection);
  if ('error' in created) return created;
  for (const segment of created.segments) {
    const ensured = ensureSegmentSamples(mesh, segment, samples, new Set(created.vertexIds));
    if ('error' in ensured) return ensured;
    segment.sampleIds = ensured.sampleIds;
  }
  if (mesh.faces.size > 0) {
    pokeFaces(mesh, [...mesh.faces.keys()]);
    setFacesShading(mesh, [...mesh.faces.keys()], 'smooth');
  }
  applyVertexBezierDeform(mesh, created);
  return created;
}

export function applyVertexBezierControl(
  mesh: EditableMesh,
  state: VertexBezierState,
  target: VertexBezierHandleTarget,
  localPoint: Vec3,
  _options: { alignOpposite?: boolean } = {},
): VertexBezierState {
  const next: VertexBezierState = {
    ...state,
    vertexIds: [...state.vertexIds],
    segments: state.segments.map((segment) => ({
      ...segment,
      handleIn: { ...segment.handleIn },
      handleOut: { ...segment.handleOut },
      sampleIds: [...segment.sampleIds],
    })),
  };

  if (target.kind === 'anchor') {
    const vertexId = next.vertexIds[target.index];
    if (vertexId && mesh.vertices.has(vertexId)) setVertexPosition(mesh, vertexId, localPoint);
  } else {
    const segment = next.segments[target.index];
    if (segment) {
      const vertexId = target.kind === 'handle-out' ? segment.startId : segment.endId;
      const vertex = mesh.vertices.get(vertexId);
      if (vertex) {
        const offset = subVec3(localPoint, vertex.position);
        if (target.kind === 'handle-out') segment.handleOut = offset;
        else segment.handleIn = offset;
      }
    }
  }

  applyVertexBezierDeform(mesh, next);
  return next;
}

export function applyVertexBezierDeform(mesh: EditableMesh, state: VertexBezierState): void {
  const reserved = new Set<VertexId>(state.vertexIds);
  for (const segment of state.segments) {
    const start = mesh.vertices.get(segment.startId)?.position;
    const end = mesh.vertices.get(segment.endId)?.position;
    if (!start || !end) continue;
    const handleOut = addVec3(start, segment.handleOut);
    const handleIn = addVec3(end, segment.handleIn);
    const samples = segment.sampleIds.filter((id) => mesh.vertices.has(id));
    for (let index = 0; index < samples.length; index++) {
      const id = samples[index]!;
      reserved.add(id);
      const t = (index + 1) / (samples.length + 1);
      setVertexPosition(mesh, id, cubicBezier(start, handleOut, handleIn, end, t));
    }
  }
  relaxInteriorVertices(mesh, reserved);
}

export function snapshotVertexPositions(
  mesh: EditableMesh,
  vertexIds: readonly VertexId[],
): Map<VertexId, Vec3> {
  const positions = new Map<VertexId, Vec3>();
  for (const id of vertexIds) {
    const vertex = mesh.vertices.get(id);
    if (vertex) positions.set(id, { ...vertex.position });
  }
  return positions;
}

export function restoreVertexPositions(mesh: EditableMesh, positions: Map<VertexId, Vec3>): void {
  for (const [id, position] of positions) {
    if (mesh.vertices.has(id)) setVertexPosition(mesh, id, position);
  }
}

function localVertexPoints(mesh: EditableMesh, vertexIds: readonly VertexId[]): Vec3[] {
  const points: Vec3[] = [];
  for (const id of vertexIds) {
    const vertex = mesh.vertices.get(id);
    if (!vertex) continue;
    points.push({ ...vertex.position });
  }
  return points;
}

function meshBezierSegments(mesh: EditableMesh, anchors: Set<VertexId>): VertexBezierSegment[] {
  const segments: VertexBezierSegment[] = [];
  const seen = new Set<string>();
  for (const edge of mesh.edges.values()) {
    const pair = getEdgeVertices(mesh, edge.id);
    if (!pair) continue;
    const [a, b] = pair;
    if (!anchors.has(a) || !anchors.has(b) || a === b) continue;
    const key = a < b ? `${a}|${b}` : `${b}|${a}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const start = mesh.vertices.get(a)!.position;
    const end = mesh.vertices.get(b)!.position;
    const chord = subVec3(end, start);
    segments.push({
      startId: a,
      endId: b,
      handleOut: scaleVec3(chord, 1 / 3),
      handleIn: scaleVec3(chord, -1 / 3),
      sampleIds: [],
    });
  }
  return segments;
}

function ensureSegmentSamples(
  mesh: EditableMesh,
  segment: VertexBezierSegment,
  samples: number,
  anchors: Set<VertexId>,
): { sampleIds: VertexId[] } | { error: string } {
  const needed = Math.max(2, Math.min(12, Math.round(samples)));
  const avoid = new Set(anchors);
  for (let guard = 0; guard < 24; guard++) {
    const path = shortestPathBetweenAnchors(mesh, segment.startId, segment.endId, avoid);
    const chain =
      path && path[0] === segment.startId && path[path.length - 1] === segment.endId
        ? path
        : [segment.startId, segment.endId];
    if (chain.length >= needed + 2) {
      return { sampleIds: chain.slice(1, -1) };
    }
    let longest = 0;
    let splitFrom = chain[0]!;
    let splitTo = chain[1] ?? segment.endId;
    for (let index = 0; index < chain.length - 1; index++) {
      const a = chain[index]!;
      const b = chain[index + 1]!;
      const va = mesh.vertices.get(a)?.position;
      const vb = mesh.vertices.get(b)?.position;
      if (!va || !vb) continue;
      const dist = lengthSqVec3(subVec3(vb, va));
      if (dist > longest) {
        longest = dist;
        splitFrom = a;
        splitTo = b;
      }
    }
    const edgeId = findEdgeId(mesh, splitFrom, splitTo);
    if (!edgeId) return { error: 'Could not split a mesh edge for Bézier samples' };
    const result = splitEdge(mesh, edgeId, 0.5);
    if (!result.ok) return { error: result.error?.message ?? 'Edge split failed' };
  }
  return { error: 'Could not add enough Bézier samples without breaking the mesh' };
}

function findEdgeId(mesh: EditableMesh, a: VertexId, b: VertexId): string | null {
  for (const edge of mesh.edges.values()) {
    const pair = getEdgeVertices(mesh, edge.id);
    if (!pair) continue;
    if ((pair[0] === a && pair[1] === b) || (pair[0] === b && pair[1] === a)) return edge.id;
  }
  return null;
}

function relaxInteriorVertices(mesh: EditableMesh, reserved: Set<VertexId>): void {
  const interiors = [...mesh.vertices.keys()].filter((id) => !reserved.has(id));
  if (interiors.length === 0) return;
  const adjacency = buildFullVertexAdjacency(mesh);
  for (let pass = 0; pass < 6; pass++) {
    const next = new Map<VertexId, Vec3>();
    for (const id of interiors) {
      const neighbors = adjacency.get(id) ?? [];
      if (neighbors.length === 0) continue;
      let x = 0;
      let y = 0;
      let z = 0;
      let count = 0;
      for (const neighborId of neighbors) {
        const position = mesh.vertices.get(neighborId)?.position;
        if (!position) continue;
        x += position.x;
        y += position.y;
        z += position.z;
        count += 1;
      }
      if (count > 0) next.set(id, v3(x / count, y / count, z / count));
    }
    for (const [id, position] of next) setVertexPosition(mesh, id, position);
  }
}

function shortestPathBetweenAnchors(
  mesh: EditableMesh,
  startId: VertexId,
  endId: VertexId,
  anchors: Set<VertexId>,
): VertexId[] | null {
  if (startId === endId) return [startId];
  const adjacency = buildFullVertexAdjacency(mesh);
  const queue: VertexId[] = [startId];
  const previous = new Map<VertexId, VertexId | null>([[startId, null]]);
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current === endId) break;
    for (const next of adjacency.get(current) ?? []) {
      if (previous.has(next)) continue;
      if (next !== endId && anchors.has(next)) continue;
      previous.set(next, current);
      queue.push(next);
    }
  }
  if (!previous.has(endId)) return null;
  const path: VertexId[] = [endId];
  let cursor: VertexId | null = endId;
  while (cursor && cursor !== startId) {
    cursor = previous.get(cursor) ?? null;
    if (cursor) path.push(cursor);
  }
  path.reverse();
  return path[0] === startId ? path : null;
}

function buildFullVertexAdjacency(mesh: EditableMesh): Map<VertexId, VertexId[]> {
  const adjacency = new Map<VertexId, VertexId[]>();
  for (const id of mesh.vertices.keys()) adjacency.set(id, []);
  for (const edge of mesh.edges.values()) {
    const pair = getEdgeVertices(mesh, edge.id);
    if (!pair || pair[0] === pair[1]) continue;
    const [a, b] = pair;
    const aLinks = adjacency.get(a);
    const bLinks = adjacency.get(b);
    if (aLinks && !aLinks.includes(b)) aLinks.push(b);
    if (bLinks && !bLinks.includes(a)) bLinks.push(a);
  }
  return adjacency;
}
