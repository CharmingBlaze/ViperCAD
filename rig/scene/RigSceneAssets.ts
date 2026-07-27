import { getObjectWorldMatrix } from '@/core/editor/Hierarchy';
import { addObjectToDocument, createSceneObject } from '@/core/document/ModelDocument';
import type { ModelDocument, ObjectId, SceneObject } from '@/core/document/types';
import { v3 } from '@/core/math/Vec3';
import {
  AmbientLight,
  Color,
  DirectionalLight,
  HemisphereLight,
  Matrix4,
  PointLight,
  SpotLight,
  Vector3,
  type Light,
} from 'three';

export type RigLightType = 'directional' | 'point' | 'spot';

const DEFAULT_FOV = '50';
const DEFAULT_CLIP_NEAR = '0.01';
const DEFAULT_CLIP_FAR = '500';

export function readCameraFov(object: SceneObject): number {
  const raw = Number(object.metadata.fov ?? DEFAULT_FOV);
  return Number.isFinite(raw) && raw > 1 ? raw : 50;
}

export function readLightType(object: SceneObject): RigLightType {
  const value = object.metadata.lightType;
  if (value === 'point' || value === 'spot') return value;
  return 'directional';
}

export function readLightIntensity(object: SceneObject): number {
  const raw = Number(object.metadata.intensity ?? '1');
  return Number.isFinite(raw) && raw >= 0 ? raw : 1;
}

export function readLightColor(object: SceneObject): Color {
  const hex = object.metadata.color ?? '#ffffff';
  try {
    return new Color(hex);
  } catch {
    return new Color(0xffffff);
  }
}

export function sceneObjectKindLabel(object: SceneObject): string {
  switch (object.kind) {
    case 'camera':
      return 'Cam';
    case 'light':
      return 'Lit';
    case 'group':
      return 'Grp';
    case 'mesh':
      return '◈';
    case 'empty':
      return '∅';
    default:
      return '·';
  }
}

export function listSceneCameras(document: ModelDocument): SceneObject[] {
  return [...document.objects.values()].filter((object) => object.kind === 'camera');
}

export function listSceneLights(document: ModelDocument): SceneObject[] {
  return [...document.objects.values()].filter((object) => object.kind === 'light');
}

export function createRigCameraObject(name = 'Camera'): SceneObject {
  const object = createSceneObject(name, null, [], { kind: 'camera' });
  object.metadata = {
    fov: DEFAULT_FOV,
    clipNear: DEFAULT_CLIP_NEAR,
    clipFar: DEFAULT_CLIP_FAR,
  };
  object.transform.position = v3(2.5, 1.8, 3.2);
  object.transform.rotation = v3(-0.45, 0.65, 0);
  return object;
}

export function createRigLightObject(
  lightType: RigLightType = 'directional',
  name?: string,
): SceneObject {
  const object = createSceneObject(name ?? defaultLightName(lightType), null, [], { kind: 'light' });
  object.metadata = {
    lightType,
    intensity: '1.2',
    color: lightType === 'directional' ? '#fff4e8' : '#ffffff',
  };
  if (lightType === 'directional') {
    object.transform.rotation = v3(-0.85, 0.4, 0);
  } else {
    object.transform.position = v3(1.5, 2.5, 1.2);
  }
  return object;
}

function defaultLightName(lightType: RigLightType): string {
  if (lightType === 'point') return 'Point Light';
  if (lightType === 'spot') return 'Spot Light';
  return 'Sun Light';
}

export function addSceneObject(document: ModelDocument, object: SceneObject): ObjectId {
  addObjectToDocument(document, object);
  document.dirty = true;
  return object.id;
}

/** Apply a scene camera object's world transform to a Three.js camera (Y-up, looks down −Z). */
export function applySceneCameraTransform(
  camera: {
    matrix: Matrix4;
    matrixWorld: Matrix4;
    matrixAutoUpdate: boolean;
    updateMatrixWorld(force?: boolean): void;
    updateProjectionMatrix?(): void;
  },
  worldMatrix: Matrix4,
): void {
  camera.matrixAutoUpdate = false;
  camera.matrix.copy(worldMatrix);
  camera.matrixWorld.copy(worldMatrix);
  camera.updateMatrixWorld(true);
  camera.updateProjectionMatrix?.();
}

export function cameraForwardFromWorld(worldMatrix: Matrix4): Vector3 {
  const forward = new Vector3(0, 0, -1);
  forward.applyMatrix4(worldMatrix);
  const origin = new Vector3();
  origin.setFromMatrixPosition(worldMatrix);
  forward.sub(origin).normalize();
  return forward;
}

export function createThreeLightForObject(object: SceneObject, document: ModelDocument): Light | null {
  if (object.kind !== 'light' || !object.visible) return null;
  const world = getObjectWorldMatrix(document, object.id);
  const color = readLightColor(object);
  const intensity = readLightIntensity(object);
  const type = readLightType(object);

  if (type === 'point') {
    const light = new PointLight(color, intensity, 30, 2);
    light.position.setFromMatrixPosition(world);
    return light;
  }

  if (type === 'spot') {
    const light = new SpotLight(color, intensity, 25, Math.PI / 5, 0.35, 1.5);
    light.position.setFromMatrixPosition(world);
    const target = cameraForwardFromWorld(world).multiplyScalar(4).add(light.position);
    light.target.position.copy(target);
    return light;
  }

  const light = new DirectionalLight(color, intensity);
  light.position.setFromMatrixPosition(world);
  const target = cameraForwardFromWorld(world).multiplyScalar(6).add(light.position);
  light.target.position.copy(target);
  return light;
}

export function createDefaultRigFillLights(): Light[] {
  return [
    new HemisphereLight(0xdde8ff, 0x1a2030, 0.35),
    new AmbientLight(0xffffff, 0.12),
  ];
}
