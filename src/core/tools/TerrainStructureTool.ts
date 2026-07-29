import { commitMeshObject, removeObject } from '@/core/document/ModelDocument';
import type { ObjectId } from '@/core/document/types';
import {
  generateBuildingMesh,
  generateRoadGridMesh,
  getOrCreateBuildingMaterial,
  type BuildingStyle,
} from '@/core/level/CityGenerator';
import {
  buildBridgeMesh,
  carveCaveTunnel,
  generateWaterfallMesh,
} from '@/core/level/InfrastructureBuilder';
import type { Vec3 } from '@/core/math/Vec3';
import { bumpPositions, bumpTopology } from '@/core/mesh/EditableMesh';
import type { EditableMesh, VertexId } from '@/core/mesh/types';
import { groundObjectToTerrain } from '@/core/terrain/TerrainProps';
import type { ModellingContext, Tool, ToolPointerInput } from '@/core/tools/Tool';

export type TerrainStructureKind =
  | 'building'
  | 'road_grid'
  | 'bridge'
  | 'cave'
  | 'waterfall';

export class TerrainStructureTool implements Tool {
  id = 'terrain-structure' as const;
  label = 'Terrain Structures & Level Objects';
  kind: TerrainStructureKind = 'building';
  terrainObjectId: ObjectId | null = null;

  // Building options
  buildingStyle: BuildingStyle = 'skyscraper';
  buildingFloors = 6;
  buildingWidth = 7;
  buildingDepth = 7;
  buildingYaw = 0;

  // Road grid options
  gridX = 2;
  gridZ = 2;
  blockSize = 14;
  roadWidth = 4;

  // Bridge options
  bridgeWidth = 3.5;
  bridgeArchHeight = 1.2;
  bridgeSpan = 24;

  // Cave options
  caveRadius = 4;
  caveTunnelLength = 12;

  // Waterfall options
  waterfallWidth = 4.5;
  waterfallHeight = 8;

  // Multi-step state (e.g. 2-click bridge)
  point1: Vec3 | null = null;
  dragging = false;
  revision = 0;

  activate(context: ModellingContext): void {
    this.point1 = null;
    this.dragging = false;
    context.requestRedraw();
  }

  deactivate(context: ModellingContext): void {
    this.cancel(context);
  }

  configure(
    kind: TerrainStructureKind,
    terrainObjectId: ObjectId | null,
    context: ModellingContext,
  ): void {
    this.kind = kind;
    this.terrainObjectId = terrainObjectId;
    this.point1 = null;
    this.revision += 1;
    context.requestRedraw();
  }

  begin(input: ToolPointerInput, context: ModellingContext): void {
    if (input.button !== 'left' || !input.worldPosition) return;
    const pos = input.worldPosition;

    if (this.kind === 'building') {
      this.placeBuilding(pos, context);
    } else if (this.kind === 'road_grid') {
      this.placeRoadGrid(pos, context);
    } else if (this.kind === 'bridge') {
      if (!this.point1) {
        this.point1 = { ...pos };
        this.revision += 1;
        context.requestRedraw();
      } else {
        const start = this.point1;
        const end = { ...pos };
        this.point1 = null;
        this.placeBridge(start, end, context);
      }
    } else if (this.kind === 'cave') {
      this.carveCave(pos, context);
    } else if (this.kind === 'waterfall') {
      this.placeWaterfall(pos, context);
    }
  }

  update(_input: ToolPointerInput, context: ModellingContext): void {
    context.requestRedraw();
  }

  endStroke(_context: ModellingContext): boolean {
    return true;
  }

  preview(_context: ModellingContext): void {}
  confirm(_context: ModellingContext): void {}

  cancel(context: ModellingContext): void {
    this.point1 = null;
    this.dragging = false;
    this.revision += 1;
    context.requestRedraw();
  }

  statusLine(): string {
    if (this.kind === 'bridge' && this.point1) {
      return `Bridge · click end position on terrain to complete span`;
    }
    if (this.kind === 'building') {
      return `Place ${this.buildingStyle} (${this.buildingFloors}F) · click on terrain to place`;
    }
    if (this.kind === 'road_grid') {
      return `Place ${this.gridX}x${this.gridZ} Road Grid · click on terrain to place`;
    }
    if (this.kind === 'bridge') {
      return `Place Girder Bridge · click start position on terrain`;
    }
    if (this.kind === 'cave') {
      return `Carve Cave Entrance · click slope/hillside to carve tunnel`;
    }
    if (this.kind === 'waterfall') {
      return `Place Waterfall Ribbon · click cliff face/top on terrain`;
    }
    return `Interactive terrain object placement`;
  }

  getAllowedSelectionModes() {
    return ['object'] as const;
  }
  getSnapPolicy() {
    return [] as const;
  }

  private placeBuilding(pos: Vec3, context: ModellingContext): void {
    const buildingMesh = generateBuildingMesh({
      floors: this.buildingFloors,
      style: this.buildingStyle,
      width: this.buildingWidth,
      depth: this.buildingDepth,
    });
    const matId = getOrCreateBuildingMaterial(context.document);
    const { objectId } = commitMeshObject(context.document, buildingMesh, {
      name: `Building (${this.buildingStyle})`,
      materialId: matId,
    });

    const object = context.document.objects.get(objectId);
    if (object) {
      object.transform.position = { ...pos };
      object.transform.rotation = { x: 0, y: this.buildingYaw, z: 0 };
      if (this.terrainObjectId) {
        groundObjectToTerrain(context.document, object.id, this.terrainObjectId);
      }
    }

    context.selection.selectObjects([objectId], 'replace');
    this.recordCreatedObject(context, objectId, `Place Building (${this.buildingStyle})`);
  }

  private placeRoadGrid(pos: Vec3, context: ModellingContext): void {
    const { roadMesh } = generateRoadGridMesh(
      this.gridX,
      this.gridZ,
      this.blockSize,
      this.roadWidth,
    );
    const { objectId } = commitMeshObject(context.document, roadMesh, {
      name: `City Road Grid (${this.gridX}x${this.gridZ})`,
    });

    const object = context.document.objects.get(objectId);
    if (object) {
      object.transform.position = { ...pos };
      if (this.terrainObjectId) {
        groundObjectToTerrain(context.document, object.id, this.terrainObjectId);
      }
    }

    context.selection.selectObjects([objectId], 'replace');
    this.recordCreatedObject(context, objectId, 'Place Road Grid');
  }

  private placeBridge(start: Vec3, end: Vec3, context: ModellingContext): void {
    const bridge = buildBridgeMesh(start, end, {
      width: this.bridgeWidth,
      archHeight: this.bridgeArchHeight,
    });
    const { objectId } = commitMeshObject(context.document, bridge, {
      name: 'Girder Bridge',
    });

    context.selection.selectObjects([objectId], 'replace');
    this.recordCreatedObject(context, objectId, 'Place Girder Bridge');
  }

  private carveCave(pos: Vec3, context: ModellingContext): void {
    const terrain = terrainFromContext(context, this.terrainObjectId);
    if (!terrain) return;

    const before = snapshotMesh(terrain.mesh);
    const affected = carveCaveTunnel(
      terrain.mesh,
      pos,
      this.caveRadius,
      this.caveTunnelLength,
    );
    if (affected <= 0) return;

    const after = snapshotMesh(terrain.mesh);
    let applied = true;
    const mesh = terrain.mesh;

    context.history.execute({
      name: 'Carve Cave Tunnel',
      execute: () => {
        if (applied) return;
        restoreMesh(mesh, after);
        context.document.dirty = true;
        context.requestRedraw();
        applied = true;
      },
      undo: () => {
        restoreMesh(mesh, before);
        context.document.dirty = true;
        context.requestRedraw();
        applied = false;
      },
    });

    context.document.dirty = true;
    this.revision += 1;
    context.requestRedraw();
  }

  private placeWaterfall(pos: Vec3, context: ModellingContext): void {
    const topPos = { x: pos.x, y: pos.y + this.waterfallHeight * 0.5, z: pos.z };
    const bottomPos = { x: pos.x, y: pos.y - this.waterfallHeight * 0.5, z: pos.z };
    const waterfall = generateWaterfallMesh(topPos, bottomPos, this.waterfallWidth);
    const { objectId } = commitMeshObject(context.document, waterfall, {
      name: 'Waterfall Mesh',
    });

    const object = context.document.objects.get(objectId);
    if (object) {
      object.transform.position = { ...pos };
    }

    context.selection.selectObjects([objectId], 'replace');
    this.recordCreatedObject(context, objectId, 'Place Waterfall');
  }

  private recordCreatedObject(
    context: ModellingContext,
    objectId: ObjectId,
    actionName: string,
  ): void {
    const object = context.document.objects.get(objectId);
    if (!object) return;
    let applied = true;
    context.history.execute({
      name: actionName,
      execute: () => {
        if (applied) return;
        context.document.objects.set(objectId, object);
        if (!context.document.rootObjectIds.includes(objectId)) {
          context.document.rootObjectIds.push(objectId);
        }
        context.document.dirty = true;
        context.requestRedraw();
        applied = true;
      },
      undo: () => {
        removeObject(context.document, objectId, true);
        context.document.dirty = true;
        context.requestRedraw();
        applied = false;
      },
    });
    this.revision += 1;
    context.requestRedraw();
  }
}

function terrainFromContext(context: ModellingContext, objectId: ObjectId | null) {
  const targetId = objectId ?? context.selection.state.activeObjectId;
  const object = targetId ? context.document.objects.get(targetId) : null;
  const mesh = object?.meshId ? context.document.meshes.get(object.meshId) : null;
  return object?.metadata.terrain === 'true' && mesh ? { object, mesh } : null;
}

function snapshotMesh(mesh: EditableMesh): Map<VertexId, Vec3> {
  return new Map(
    [...mesh.vertices].map(([id, vertex]) => [id, { ...vertex.position }]),
  );
}

function restoreMesh(mesh: EditableMesh, positions: Map<VertexId, Vec3>): void {
  for (const [id, position] of positions) {
    const vertex = mesh.vertices.get(id);
    if (vertex) vertex.position = { ...position };
  }
  bumpTopology(mesh);
  bumpPositions(mesh);
}
