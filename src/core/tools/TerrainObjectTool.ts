import {
  addObjectToDocument,
  createSceneObject,
  duplicateObject,
  removeObject,
} from '@/core/document/ModelDocument';
import type {
  DocumentId,
  ObjectId,
  SceneObject,
} from '@/core/document/types';
import {
  inverseTransformPointApprox,
  transformPoint,
} from '@/core/math/Transform';
import { cloneVec3, type Vec3 } from '@/core/math/Vec3';
import {
  ensureTerrainPresetSource,
  terrainHeightAtLocalPoint,
  terrainNormalAtLocalPoint,
  terrainPlacedObjects,
  type TerrainPropPreset,
} from '@/core/terrain/TerrainProps';
import type {
  ModellingContext,
  Tool,
  ToolPointerInput,
} from '@/core/tools/Tool';

export type TerrainObjectBrushMode = 'place' | 'scatter' | 'erase';
export type TerrainObjectPlacementMode = 'terrain' | 'base';

export class TerrainObjectTool implements Tool {
  id = 'terrain-object' as const;
  label = 'Terrain Objects';
  mode: TerrainObjectBrushMode = 'place';
  terrainObjectId: ObjectId | null = null;
  sourceObjectId: ObjectId | null = null;
  sourceModelDocumentId: DocumentId | null = null;
  sourceModelName = '';
  sourceModelBaseOffset = 0;
  sourceModelRadius = 0.5;
  preset: TerrainPropPreset = 'tree';
  usePreset = false;
  radius = 3;
  spacing = 1.5;
  density = 4;
  randomYaw = true;
  randomScale = 0.22;
  alignToSlope = false;
  placementMode: TerrainObjectPlacementMode = 'terrain';
  /** Prefer already-placed model surfaces over terrain for single placement. */
  stackModels = false;
  heightOffset = 0;
  placementYaw = 0;
  placementScale = 1;
  scatterSeed = 1;
  collisionAvoidance = true;
  collisionPadding = 0.15;
  maskEnabled = false;
  minimumHeight = -1000;
  maximumHeight = 1000;
  maximumSlopeDegrees = 55;
  /** Prevent the object's lowest face from occupying the terrain's exact depth. */
  groundClearance = 0.03;
  dragging = false;
  revision = 0;
  private created: SceneObject[] = [];
  private erased: SceneObject[] = [];
  private lastStamp: Vec3 | null = null;
  private strokeSeed = 1;

  activate(context: ModellingContext): void {
    this.dragging = false;
    this.lastStamp = null;
    context.requestRedraw();
  }

  deactivate(context: ModellingContext): void {
    if (this.dragging) this.cancel(context);
  }

  setMode(mode: TerrainObjectBrushMode, context: ModellingContext): void {
    this.mode = mode;
    this.revision += 1;
    context.requestRedraw();
  }

  setTerrain(objectId: ObjectId | null, context: ModellingContext): void {
    this.terrainObjectId = objectId;
    this.revision += 1;
    context.requestRedraw();
  }

  setPreset(preset: TerrainPropPreset, context: ModellingContext): void {
    this.preset = preset;
    this.usePreset = true;
    this.sourceObjectId = null;
    this.sourceModelDocumentId = null;
    this.revision += 1;
    context.requestRedraw();
  }

  setSourceObject(objectId: ObjectId, context: ModellingContext): void {
    this.sourceObjectId = objectId;
    this.sourceModelDocumentId = null;
    this.usePreset = false;
    this.revision += 1;
    context.requestRedraw();
  }

  setSourceModel(
    documentId: DocumentId,
    name: string,
    baseOffset: number,
    radius: number,
    context: ModellingContext,
  ): void {
    this.sourceModelDocumentId = documentId;
    this.sourceModelName = name;
    this.sourceModelBaseOffset = Math.max(0, Number(baseOffset) || 0);
    this.sourceModelRadius = Math.max(0.05, Number(radius) || 0.5);
    this.sourceObjectId = null;
    this.usePreset = false;
    this.revision += 1;
    context.requestRedraw();
  }

  clearSource(context: ModellingContext): void {
    this.sourceObjectId = null;
    this.sourceModelDocumentId = null;
    this.sourceModelName = '';
    this.sourceModelBaseOffset = 0;
    this.sourceModelRadius = 0.5;
    this.usePreset = false;
    this.revision += 1;
    context.requestRedraw();
  }

  begin(input: ToolPointerInput, context: ModellingContext): void {
    if (input.button !== 'left' || !input.worldPosition || !this.terrainObjectId) return;
    if (!terrainTarget(context, this.terrainObjectId)) return;
    this.dragging = true;
    this.created = [];
    this.erased = [];
    this.lastStamp = null;
    this.strokeSeed = this.mode === 'scatter'
      ? Math.max(1, Math.round(this.scatterSeed))
      : Math.floor(input.screenX * 73856093 + input.screenY * 19349663);
    this.applyAt(input.worldPosition, context, input.surfaceObjectId);
  }

  update(input: ToolPointerInput, context: ModellingContext): void {
    if (!this.dragging || !input.worldPosition) return;
    if (this.mode === 'place') return;
    const threshold = this.mode === 'erase'
      ? Math.max(0.2, this.radius * 0.25)
      : Math.max(0.15, this.spacing * 0.6);
    if (
      this.lastStamp &&
      Math.hypot(
        input.worldPosition.x - this.lastStamp.x,
        input.worldPosition.z - this.lastStamp.z,
      ) < threshold
    ) return;
    this.applyAt(input.worldPosition, context, input.surfaceObjectId);
  }

  endStroke(context: ModellingContext): boolean {
    if (!this.dragging) return false;
    const created = [...this.created];
    const erased = [...this.erased];
    const mode = this.mode;
    let applied = true;
    if (created.length || erased.length) {
      context.history.execute({
        name:
          mode === 'erase'
            ? `Erase ${erased.length} Level Object${erased.length === 1 ? '' : 's'}`
            : `${mode === 'scatter' ? 'Scatter' : 'Place'} ${created.length} Level Object${created.length === 1 ? '' : 's'}`,
        execute: () => {
          if (applied) return;
          for (const object of erased) removeObject(context.document, object.id, false);
          for (const object of created) restoreObject(context, object);
          context.document.dirty = true;
          context.requestRedraw();
          applied = true;
        },
        undo: () => {
          for (const object of created) removeObject(context.document, object.id, false);
          for (const object of erased) restoreObject(context, object);
          context.document.dirty = true;
          context.requestRedraw();
          applied = false;
        },
      });
    }
    this.dragging = false;
    this.created = [];
    this.erased = [];
    this.lastStamp = null;
    this.revision += 1;
    context.requestRedraw();
    return created.length > 0 || erased.length > 0;
  }

  preview(_context: ModellingContext): void {}
  confirm(context: ModellingContext): void { this.endStroke(context); }

  cancel(context: ModellingContext): void {
    for (const object of this.created) removeObject(context.document, object.id, false);
    for (const object of this.erased) restoreObject(context, object);
    this.dragging = false;
    this.created = [];
    this.erased = [];
    this.lastStamp = null;
    this.revision += 1;
    context.requestRedraw();
  }

  setRadius(radius: number, context: ModellingContext): void {
    this.radius = clamp(radius, 0.25, 50);
    this.revision += 1;
    context.requestRedraw();
  }

  statusLine(): string {
    if (this.mode === 'erase') return `erase level objects · radius ${this.radius.toFixed(1)}`;
    if (this.mode === 'scatter') {
      return `scatter on ${this.placementMode === 'terrain' ? 'terrain surface' : 'base plane'} · radius ${this.radius.toFixed(1)} · density ${this.density}`;
    }
    return `place on ${
      this.stackModels
        ? 'models or terrain'
        : this.placementMode === 'terrain'
          ? 'terrain surface'
          : 'base plane'
    } · wheel rotate · Shift+wheel scale · click`;
  }

  getAllowedSelectionModes() { return ['object'] as const; }
  getSnapPolicy() { return [] as const; }

  private applyAt(
    worldPoint: Vec3,
    context: ModellingContext,
    surfaceObjectId?: string | null,
  ): void {
    if (!this.terrainObjectId) return;
    const target = terrainTarget(context, this.terrainObjectId);
    if (!target) return;
    this.lastStamp = cloneVec3(worldPoint);

    if (this.mode === 'erase') {
      for (const object of terrainPlacedObjects(context.document, this.terrainObjectId)) {
        if (
          Math.hypot(
            object.transform.position.x - worldPoint.x,
            object.transform.position.z - worldPoint.z,
          ) > this.radius
        ) continue;
        this.erased.push(cloneSceneObject(object));
        removeObject(context.document, object.id, false);
      }
      context.requestRedraw();
      return;
    }

    const count = this.mode === 'place' ? 1 : Math.max(1, Math.round(this.density));
    for (let index = 0; index < count; index++) {
      const localCentre = inverseTransformPointApprox(worldPoint, target.object.transform);
      let x = localCentre.x;
      let z = localCentre.z;
      if (this.mode === 'scatter') {
        const angle = seededRandom(this.strokeSeed++) * Math.PI * 2;
        const distance = Math.sqrt(seededRandom(this.strokeSeed++)) * this.radius;
        x += Math.cos(angle) * distance;
        z += Math.sin(angle) * distance;
      }
      const halfSize = (Number(target.object.metadata.terrainSize) || 1) / 2;
      if (Math.abs(x) > halfSize || Math.abs(z) > halfSize) continue;
      // Every scattered point samples independently so objects remain grounded
      // when one brush stroke crosses valleys, slopes, and mountain peaks.
      const stackedPlacement =
        this.mode === 'place' &&
        this.stackModels &&
        !!surfaceObjectId &&
        surfaceObjectId !== this.terrainObjectId;
      const y = stackedPlacement
        ? localCentre.y
        : this.placementMode === 'terrain'
          ? terrainHeightAtLocalPoint(target.object, target.mesh, x, z)
          : 0;
      if (this.maskEnabled) {
        if (y < this.minimumHeight || y > this.maximumHeight) continue;
        const normal = terrainNormalAtLocalPoint(target.object, target.mesh, x, z);
        const slope = Math.acos(Math.max(-1, Math.min(1, normal.y))) * 180 / Math.PI;
        if (slope > this.maximumSlopeDegrees) continue;
      }
      const position = transformPoint({ x, y, z }, target.object.transform);
      const candidateRadius =
        this.sourceModelDocumentId
          ? this.sourceModelRadius * this.placementScale
          : Math.max(0.1, this.spacing * 0.5);
      if (
        this.collisionAvoidance &&
        !stackedPlacement &&
        terrainPlacedObjects(context.document, this.terrainObjectId).some(
          (object) => {
            const existingRadius = Number(object.metadata.terrainCollisionRadius) || 0.25;
            return Math.hypot(
              object.transform.position.x - position.x,
              object.transform.position.z - position.z,
            ) < candidateRadius + existingRadius + this.collisionPadding;
          },
        )
      ) continue;
      const placed = this.placeOne(
        position,
        context,
        stackedPlacement ? surfaceObjectId : null,
      );
      if (placed) this.created.push(cloneSceneObject(placed));
    }
    context.document.dirty = true;
    context.requestRedraw();
  }

  private placeOne(
    position: Vec3,
    context: ModellingContext,
    stackedOnId: string | null,
  ): SceneObject | null {
    if (this.sourceModelDocumentId) {
      return this.placeModelInstance(position, context, stackedOnId);
    }
    const source = this.usePreset
      ? ensureTerrainPresetSource(context.document, this.preset)
      : this.sourceObjectId
        ? context.document.objects.get(this.sourceObjectId)
        : null;
    if (!source || !source.meshId || source.metadata.terrain === 'true') return null;
    const id = duplicateObject(context.document, source.id, false);
    const copy = context.document.objects.get(id)!;
    const scaleVariation = this.placementScale * (
      this.mode === 'scatter'
        ? 1 + (seededRandom(this.strokeSeed++) * 2 - 1) * this.randomScale
        : 1
    );
    const baseOffset = Number(source.metadata.terrainBaseOffset) || meshBaseOffset(context, source);
    copy.name = `${source.name.replace(/ Brush$/, '')} ${placedCount(context) + 1}`;
    copy.visible = true;
    copy.locked = false;
    copy.parentId = null;
    copy.metadata = {
      terrainPlaced: 'true',
      terrainOwnerId: this.terrainObjectId!,
      terrainSourceId: source.id,
      terrainGroundClearance: String(
        this.placementMode === 'terrain' ? this.groundClearance : 0,
      ),
      terrainHeightOffset: String(this.heightOffset),
      terrainAlignToSlope: this.alignToSlope && this.placementMode === 'terrain' ? 'true' : 'false',
      terrainCollisionRadius: String(Math.max(0.1, this.spacing * 0.5) * scaleVariation),
      ...(stackedOnId
        ? { terrainStacked: 'true', terrainStackedOnId: stackedOnId }
        : {}),
    };
    copy.transform.position = {
      x: position.x,
      y:
        position.y +
        baseOffset * Math.abs(source.transform.scale.y) * scaleVariation +
        (this.placementMode === 'terrain' ? this.groundClearance : 0) +
        this.heightOffset,
      z: position.z,
    };
    copy.transform.rotation.y =
      this.placementYaw +
      (this.mode === 'scatter' && this.randomYaw
        ? seededRandom(this.strokeSeed++) * Math.PI * 2
        : source.transform.rotation.y);
    copy.transform.scale = {
      x: source.transform.scale.x * scaleVariation,
      y: source.transform.scale.y * scaleVariation,
      z: source.transform.scale.z * scaleVariation,
    };
    if (stackedOnId) recordStackOffset(context, copy, stackedOnId);
    if (this.alignToSlope && this.placementMode === 'terrain' && !stackedOnId && this.terrainObjectId) {
      const target = terrainTarget(context, this.terrainObjectId);
      if (target) {
        const local = inverseTransformPointApprox(copy.transform.position, target.object.transform);
        const localNormal = terrainNormalAtLocalPoint(
          target.object,
          target.mesh,
          local.x,
          local.z,
        );
        const yaw = copy.transform.rotation.y;
        copy.transform.rotation = {
          x: Math.atan2(localNormal.z, localNormal.y),
          y: yaw,
          z: -Math.atan2(localNormal.x, localNormal.y),
        };
      }
    }
    return copy;
  }

  private placeModelInstance(
    position: Vec3,
    context: ModellingContext,
    stackedOnId: string | null,
  ): SceneObject {
    const modelDocumentId = this.sourceModelDocumentId!;
    const modelName = this.sourceModelName.trim() || 'Model';
    const copy = createSceneObject(modelName, null, [], { kind: 'instance' });
    copy.kind = 'instance';
    copy.instanceSourceModelId = modelDocumentId;
    copy.name = `${modelName} ${placedCount(context) + 1}`;
    const scaleVariation = this.placementScale * (
      this.mode === 'scatter'
        ? 1 + (seededRandom(this.strokeSeed++) * 2 - 1) * this.randomScale
        : 1
    );
    copy.metadata = {
      terrainPlaced: 'true',
      terrainOwnerId: this.terrainObjectId!,
      terrainSourceModelId: modelDocumentId,
      terrainBaseOffset: String(this.sourceModelBaseOffset),
      terrainGroundClearance: String(
        this.placementMode === 'terrain' ? this.groundClearance : 0,
      ),
      terrainHeightOffset: String(this.heightOffset),
      terrainAlignToSlope: this.alignToSlope && this.placementMode === 'terrain' ? 'true' : 'false',
      terrainCollisionRadius: String(this.sourceModelRadius * scaleVariation),
      ...(stackedOnId
        ? { terrainStacked: 'true', terrainStackedOnId: stackedOnId }
        : {}),
    };
    copy.transform.position = {
      x: position.x,
      y:
        position.y +
        this.sourceModelBaseOffset * scaleVariation +
        (this.placementMode === 'terrain' ? this.groundClearance : 0) +
        this.heightOffset,
      z: position.z,
    };
    copy.transform.rotation.y =
      this.placementYaw +
      (this.mode === 'scatter' && this.randomYaw
        ? seededRandom(this.strokeSeed++) * Math.PI * 2
        : 0);
    copy.transform.scale = {
      x: scaleVariation,
      y: scaleVariation,
      z: scaleVariation,
    };
    if (stackedOnId) recordStackOffset(context, copy, stackedOnId);
    if (this.alignToSlope && this.placementMode === 'terrain' && !stackedOnId && this.terrainObjectId) {
      const target = terrainTarget(context, this.terrainObjectId);
      if (target) {
        const local = inverseTransformPointApprox(copy.transform.position, target.object.transform);
        const localNormal = terrainNormalAtLocalPoint(
          target.object,
          target.mesh,
          local.x,
          local.z,
        );
        const yaw = copy.transform.rotation.y;
        copy.transform.rotation = {
          x: Math.atan2(localNormal.z, localNormal.y),
          y: yaw,
          z: -Math.atan2(localNormal.x, localNormal.y),
        };
      }
    }
    addObjectToDocument(context.document, copy);
    return copy;
  }
}

function terrainTarget(context: ModellingContext, id: ObjectId) {
  const object = context.document.objects.get(id);
  const mesh = object?.meshId ? context.document.meshes.get(object.meshId) : null;
  return object?.metadata.terrain === 'true' && mesh ? { object, mesh } : null;
}

function recordStackOffset(
  context: ModellingContext,
  placed: SceneObject,
  stackedOnId: string,
): void {
  const base = context.document.objects.get(stackedOnId);
  if (!base) return;
  placed.metadata.terrainStackOffsetX = String(
    placed.transform.position.x - base.transform.position.x,
  );
  placed.metadata.terrainStackOffsetY = String(
    placed.transform.position.y - base.transform.position.y,
  );
  placed.metadata.terrainStackOffsetZ = String(
    placed.transform.position.z - base.transform.position.z,
  );
}

function restoreObject(context: ModellingContext, object: SceneObject): void {
  if (context.document.objects.has(object.id)) return;
  addObjectToDocument(context.document, cloneSceneObject(object));
}

function cloneSceneObject(object: SceneObject): SceneObject {
  return {
    ...object,
    childIds: [...object.childIds],
    materialSlotIds: [...object.materialSlotIds],
    transform: {
      position: { ...object.transform.position },
      rotation: { ...object.transform.rotation },
      scale: { ...object.transform.scale },
    },
    metadata: { ...object.metadata },
  };
}

function meshBaseOffset(context: ModellingContext, object: SceneObject): number {
  const mesh = object.meshId ? context.document.meshes.get(object.meshId) : null;
  if (!mesh?.vertices.size) return 0;
  const min = Math.min(...[...mesh.vertices.values()].map((vertex) => vertex.position.y));
  return -min;
}

function placedCount(context: ModellingContext): number {
  return [...context.document.objects.values()].filter(
    (object) => object.metadata.terrainPlaced === 'true',
  ).length;
}

function seededRandom(seed: number): number {
  const value = Math.sin(seed * 12.9898) * 43758.5453;
  return value - Math.floor(value);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Number(value) || min));
}
