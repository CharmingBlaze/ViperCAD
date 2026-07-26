import { createEmptyDocument } from '@/core/document/ModelDocument';
import type { ModelDocument, SceneObject } from '@/core/document/types';
import { CommandHistory } from '@/core/history/CommandHistory';
import { SelectionManager } from '@/core/selection/SelectionManager';
import { resolveSnap, WORLD_XY_PLANE, WORLD_XZ_PLANE, WORLD_YZ_PLANE, type ConstructionPlane } from '@/core/snap/SnapEngine';
import { CreateDoodleTool } from '@/core/tools/CreateDoodleTool';
import { CreatePrimitiveTool } from '@/core/tools/CreatePrimitiveTool';
import { DrawPolyTool } from '@/core/tools/DrawPolyTool';
import { TileDrawTool } from '@/core/tools/TileDrawTool';
import { SelectTool } from '@/core/tools/SelectTool';
import { KnifeTool } from '@/core/tools/KnifeTool';
import { LoopCutTool } from '@/core/tools/LoopCutTool';
import { TerrainSculptTool } from '@/core/tools/TerrainSculptTool';
import { MeshSculptTool } from '@/core/tools/MeshSculptTool';
import { TerrainObjectTool } from '@/core/tools/TerrainObjectTool';
import { TerrainFeatureTool } from '@/core/tools/TerrainFeatureTool';
import { ToolController } from '@/core/tools/ToolController';
import type { ModellingContext } from '@/core/tools/Tool';
import type { SnapQuery, SnapResult } from '@/core/snap/SnapEngine';
import type { EditableMesh } from '@/core/mesh/types';
import { addVec3, crossVec3, lengthVec3, normalizeVec3, scaleVec3, subVec3, type Vec3 } from '@/core/math/Vec3';
import { TransformSystem } from '@/core/transform/TransformSystem';
import { UvSelection } from '@/core/uv/UvSelection';
import { buildSnapIndex, type UniformGridIndex } from '@/core/spatial/SnapSpatialIndex';
import { MeshBvh } from '@/core/spatial/MeshBvh';
import { inverseTransformPointApprox, transformPoint } from '@/core/math/Transform';
import { computeFaceNormal } from '@/core/mesh/Normals';
import { faceVertexIds } from '@/core/mesh/EditableMesh';

type SnapIndexCache = {
  meshId: string;
  geometryVersion: number;
  topologyVersion: number;
  transformKey: string;
  index: UniformGridIndex;
};

/** Central modelling session wiring document, selection, history, and tools. */
export class EditorSession {
  document: ModelDocument;
  selection: SelectionManager;
  history: CommandHistory;
  tools: ToolController;
  transform: TransformSystem;
  /** UV face-corner selection used by the UV / Pixel editor. */
  uvSelection: UvSelection;
  /** Identifies which editor surface made the latest component selection. */
  selectionSource: 'viewport' | 'uv' | 'system' = 'system';
  constructionPlane: ConstructionPlane = WORLD_XZ_PLANE;
  constructionPlaneId = 'top';
  private redrawListeners = new Set<() => void>();
  private snapIndexCache = new Map<string, SnapIndexCache>();
  private snapBvhCache = new Map<string, MeshBvh>();

  constructor(document?: ModelDocument) {
    this.document = document ?? createEmptyDocument('ViperCAD');
    this.selection = new SelectionManager();
    this.history = new CommandHistory();
    this.tools = new ToolController();
    this.uvSelection = new UvSelection();
    this.selectionSource = 'system';
    this.transform = new TransformSystem(
      this.document,
      this.selection,
      this.history,
      () => this.requestRedraw(),
      (query) => this.resolveDocumentSnap(query),
    );
    this.tools.register(new SelectTool());
    this.tools.register(new CreatePrimitiveTool());
    this.tools.register(new CreateDoodleTool());
    this.tools.register(new DrawPolyTool());
    this.tools.register(new TileDrawTool());
    this.tools.register(new KnifeTool());
    this.tools.register(new LoopCutTool());
    this.tools.register(new TerrainSculptTool());
    this.tools.register(new MeshSculptTool());
    this.tools.register(new TerrainObjectTool());
    this.tools.register(new TerrainFeatureTool());
    this.tools.setActive('create-primitive', this.context());
  }

  context(): ModellingContext {
    return {
      document: this.document,
      selection: this.selection,
      history: this.history,
      constructionPlane: this.constructionPlane,
      constructionPlaneId: this.constructionPlaneId,
      snapEnabled: this.document.settings.snapEnabled,
      gridSize: this.document.settings.snapIncrement,
      resolveSnap: (query) => this.resolveDocumentSnap(query),
      requestRedraw: () => this.requestRedraw(),
    };
  }

  onRedraw(listener: () => void): () => void {
    this.redrawListeners.add(listener);
    return () => this.redrawListeners.delete(listener);
  }

  requestRedraw(): void {
    for (const listener of this.redrawListeners) listener();
  }

  setConstructionPlanePreset(id: 'top' | 'front' | 'right'): void {
    this.constructionPlane = id === 'front' ? WORLD_XY_PLANE : id === 'right' ? WORLD_YZ_PLANE : WORLD_XZ_PLANE;
    this.constructionPlaneId = id;
    this.requestRedraw();
  }

  offsetConstructionPlane(distance: number): void {
    if (!Number.isFinite(distance)) return;
    const previous = Number(this.constructionPlaneId.match(/@(-?[\d.]+)$/)?.[1] ?? 0);
    this.constructionPlane = {
      ...this.constructionPlane,
      origin: addVec3(
        this.constructionPlane.origin,
        scaleVec3(this.constructionPlane.normal, distance - previous),
      ),
    };
    this.constructionPlaneId = this.constructionPlaneId.replace(/@.*$/, '') + `@${distance}`;
    this.requestRedraw();
  }

  /** Use the active face as an exact user construction plane. */
  setConstructionPlaneFromSelection(): boolean {
    const objectId = this.selection.state.activeObjectId;
    const faceId = this.selection.state.activeFaceId;
    const object = objectId ? this.document.objects.get(objectId) : null;
    const mesh = object?.meshId ? this.document.meshes.get(object.meshId) : null;
    if (!object || !mesh || !faceId || !mesh.faces.has(faceId)) return false;
    const ids = faceVertexIds(mesh, faceId);
    if (!ids.length) return false;
    const localCentre = ids.reduce(
      (sum, id) => addVec3(sum, scaleVec3(mesh.vertices.get(id)!.position, 1 / ids.length)),
      { x: 0, y: 0, z: 0 },
    );
    const localNormal = computeFaceNormal(mesh, faceId);
    const worldCentre = transformPoint(localCentre, object.transform);
    const worldOrigin = transformPoint({ x: 0, y: 0, z: 0 }, object.transform);
    const worldNormal = normalizeVec3(subVec3(transformPoint(localNormal, object.transform), worldOrigin));
    const reference = Math.abs(worldNormal.y) < 0.9 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
    const xAxis = normalizeVec3(crossVec3(reference, worldNormal));
    const yAxis = normalizeVec3(crossVec3(worldNormal, xAxis));
    this.constructionPlane = { origin: worldCentre, normal: worldNormal, xAxis, yAxis };
    this.constructionPlaneId = `face:${faceId}`;
    this.requestRedraw();
    return true;
  }

  undo(): boolean {
    const ok = this.history.undo();
    if (ok) { this.selection.prune(this.document); this.requestRedraw(); }
    return ok;
  }

  redo(): boolean {
    const ok = this.history.redo();
    if (ok) { this.selection.prune(this.document); this.requestRedraw(); }
    return ok;
  }

  /** Replace the active project and rebuild systems that retain document references. */
  loadDocument(document: ModelDocument): void {
    this.tools.getActive()?.cancel?.(this.context());
    this.document = document;
    this.selection = new SelectionManager();
    this.history.clear();
    this.snapIndexCache.clear();
    this.snapBvhCache.clear();
    this.uvSelection = new UvSelection();
    this.selectionSource = 'system';
    this.transform = new TransformSystem(
      this.document,
      this.selection,
      this.history,
      () => this.requestRedraw(),
      (query) => this.resolveDocumentSnap(query),
    );
    this.tools.setActive('select', this.context());
    this.requestRedraw();
  }

  private resolveDocumentSnap(query: SnapQuery): SnapResult {
    const normalised = {
      ...query,
      gridSize: query.gridSize ?? this.document.settings.snapIncrement,
      maxWorldDistance: query.maxWorldDistance ?? this.document.settings.snapIncrement * 0.4,
    };
    return resolveSnap(normalised, this.snapCandidates(normalised));
  }

  private getSnapIndex(object: SceneObject, mesh: EditableMesh): UniformGridIndex {
    const transformKey = transformCacheKey(object);
    const cached = this.snapIndexCache.get(object.id);
    if (
      cached &&
      cached.meshId === mesh.id &&
      cached.geometryVersion === mesh.geometryVersion &&
      cached.topologyVersion === mesh.topologyVersion &&
      cached.transformKey === transformKey
    ) {
      return cached.index;
    }
    const cellSize = Math.max(this.document.settings.snapIncrement * 0.5, 0.05);
    const index = buildSnapIndex(mesh, object.transform, cellSize);
    this.snapIndexCache.set(object.id, {
      meshId: mesh.id,
      geometryVersion: mesh.geometryVersion,
      topologyVersion: mesh.topologyVersion,
      transformKey,
      index,
    });
    return index;
  }

  private snapCandidates(query: SnapQuery): SnapResult[] {
    const result: SnapResult[] = [];
    const maxDist = query.maxWorldDistance ?? this.document.settings.snapIncrement * 0.4;
    const push = (
      position: Vec3,
      targetType: SnapResult['targetType'],
      objectId?: string,
      elementId?: string,
      worldNormal?: Vec3,
      distanceOverride?: number,
    ) => {
      if (elementId && query.excludedElementIds?.includes(elementId)) return;
      const distance = distanceOverride ?? lengthVec3(subVec3(position, query.rawPosition));
      if (distance > maxDist) return;
      result.push({
        snapped: true,
        position,
        targetType,
        targetObjectId: objectId,
        targetElementId: elementId,
        distance,
        confidence: 1,
        worldNormal,
      });
    };

    if (query.allowed.includes('origin')) push({ x: 0, y: 0, z: 0 }, 'origin');

    const needsSpatial = query.allowed.some(
      (t) => t === 'vertex' || t === 'edge' || t === 'edgeMid' || t === 'faceCentre',
    );
    const needsSurface = query.allowed.includes('face') && query.pointerRayOrigin && query.pointerRayDirection;
    let surfaceBest:
      | { position: Vec3; objectId: string; faceId: string; normal: Vec3; rayDistance: number }
      | null = null;

    for (const object of this.document.objects.values()) {
      if (query.excludedObjectIds?.includes(object.id) || !object.visible || !object.meshId) continue;
      const mesh = this.document.meshes.get(object.meshId);
      if (!mesh) continue;

      if (query.allowed.includes('origin')) {
        push({ ...object.transform.position }, 'origin', object.id, object.id);
      }
      if (needsSurface) {
        let bvh = this.snapBvhCache.get(mesh.id);
        if (!bvh) {
          bvh = new MeshBvh();
          this.snapBvhCache.set(mesh.id, bvh);
        }
        const localOrigin = inverseTransformPointApprox(query.pointerRayOrigin!, object.transform);
        const rayPoint = addVec3(query.pointerRayOrigin!, query.pointerRayDirection!);
        const localRayPoint = inverseTransformPointApprox(rayPoint, object.transform);
        const localDirection = normalizeVec3(subVec3(localRayPoint, localOrigin));
        const hit = bvh.raycast(mesh, localOrigin, localDirection);
        if (hit && !query.excludedElementIds?.includes(hit.faceId)) {
          const localNormal = computeFaceNormal(mesh, hit.faceId);
          const worldOrigin = transformPoint({ x: 0, y: 0, z: 0 }, object.transform);
          const worldNormalPoint = transformPoint(localNormal, object.transform);
          const worldPosition = transformPoint(hit.position, object.transform);
          const rayDistance = lengthVec3(subVec3(worldPosition, query.pointerRayOrigin!));
          if (!surfaceBest || rayDistance < surfaceBest.rayDistance) {
            surfaceBest = {
              position: worldPosition,
              objectId: object.id,
              faceId: hit.faceId,
              normal: normalizeVec3(subVec3(worldNormalPoint, worldOrigin)),
              rayDistance,
            };
          }
        }
      }
      if (!needsSpatial) continue;

      const nearby = this.getSnapIndex(object, mesh).querySphere(query.rawPosition, maxDist);
      for (const entry of nearby) {
        if (entry.kind === 'vertex' && query.allowed.includes('vertex')) {
          push(entry.position, 'vertex', object.id, entry.id);
        } else if (entry.kind === 'edgeMid' && query.allowed.includes('edgeMid')) {
          push(entry.position, 'edgeMid', object.id, entry.id);
        } else if (entry.kind === 'edge' && query.allowed.includes('edge')) {
          push(closestPointSegment(query.rawPosition, entry.a, entry.b), 'edge', object.id, entry.id);
        } else if (entry.kind === 'faceCentre' && query.allowed.includes('faceCentre')) {
          push(entry.position, 'faceCentre', object.id, entry.id);
        }
      }
    }
    if (surfaceBest) {
      push(
        surfaceBest.position,
        'face',
        surfaceBest.objectId,
        surfaceBest.faceId,
        surfaceBest.normal,
        0,
      );
    }
    return result;
  }
}

function closestPointSegment(p: Vec3, a: Vec3, b: Vec3): Vec3 {
  const ab = subVec3(b, a);
  const ap = subVec3(p, a);
  const denom = ab.x * ab.x + ab.y * ab.y + ab.z * ab.z;
  const t = denom ? Math.max(0, Math.min(1, (ap.x * ab.x + ap.y * ab.y + ap.z * ab.z) / denom)) : 0;
  return { x: a.x + ab.x * t, y: a.y + ab.y * t, z: a.z + ab.z * t };
}

function transformCacheKey(object: SceneObject): string {
  const t = object.transform;
  return [
    t.position.x,
    t.position.y,
    t.position.z,
    t.rotation.x,
    t.rotation.y,
    t.rotation.z,
    t.scale.x,
    t.scale.y,
    t.scale.z,
  ].join(',');
}
