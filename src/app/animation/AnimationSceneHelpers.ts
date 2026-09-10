import {
  BufferAttribute,
  BufferGeometry,
  DirectionalLight,
  Group,
  LineBasicMaterial,
  LineSegments,
  Raycaster,
  SpotLight,
} from 'three';
import { getObjectWorldMatrix } from '@/core/editor/Hierarchy';
import {
  createThreeLightForObject,
  listSceneCameras,
  listSceneLights,
} from '@/core/rig/RigSceneAssets';
import type { ObjectId } from '@/core/document/types';
import type { AnimationSession } from './AnimationSession';

function cameraGizmoGeometry(): BufferGeometry {
  const s = 0.1;
  const d = 0.28;
  const positions = new Float32Array([
    0, 0, 0, -s, -s * 0.7, -d,
    0, 0, 0, s, -s * 0.7, -d,
    0, 0, 0, s, s * 0.7, -d,
    0, 0, 0, -s, s * 0.7, -d,
    -s, -s * 0.7, -d, s, -s * 0.7, -d,
    s, -s * 0.7, -d, s, s * 0.7, -d,
    s, s * 0.7, -d, -s, s * 0.7, -d,
    -s, s * 0.7, -d, -s, -s * 0.7, -d,
  ]);
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  return geometry;
}

function lightGizmoGeometry(): BufferGeometry {
  const s = 0.14;
  const positions = new Float32Array([
    -s, 0, 0, s, 0, 0,
    0, -s, 0, 0, s, 0,
    0, 0, -s, 0, 0, s,
  ]);
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  return geometry;
}

/** Camera/light gizmos and live scene lights for Rig and Animate. */
export class AnimationSceneHelpers {
  readonly group = new Group();
  private gizmos = new Group();
  private lights = new Group();

  constructor() {
    this.group.name = 'animation-scene-helpers';
    this.group.add(this.gizmos, this.lights);
  }

  reset(): void {
    this.clearGroups();
  }

  clear(): void {
    this.group.visible = false;
    this.clearGroups();
  }

  sync(animation: AnimationSession): void {
    this.group.visible = true;
    this.clearGroups();
    const source = animation.getSourceModel();
    if (!source) return;

    for (const object of listSceneCameras(source)) {
      if (!object.visible) continue;
      const selected = animation.selectedObjectId === object.id;
      const line = new LineSegments(
        cameraGizmoGeometry(),
        new LineBasicMaterial({
          color: selected ? 0x1473e6 : 0x9c9c9c,
          transparent: true,
          opacity: 0.95,
          depthTest: false,
        }),
      );
      line.userData.objectId = object.id;
      line.matrixAutoUpdate = false;
      line.matrix.copy(getObjectWorldMatrix(source, object.id));
      line.renderOrder = 11;
      this.gizmos.add(line);
    }

    for (const object of listSceneLights(source)) {
      if (!object.visible) continue;
      const selected = animation.selectedObjectId === object.id;
      const line = new LineSegments(
        lightGizmoGeometry(),
        new LineBasicMaterial({
          color: selected ? 0x1473e6 : 0xe6c35c,
          transparent: true,
          opacity: 0.95,
          depthTest: false,
        }),
      );
      line.userData.objectId = object.id;
      line.matrixAutoUpdate = false;
      line.matrix.copy(getObjectWorldMatrix(source, object.id));
      line.renderOrder = 11;
      this.gizmos.add(line);

      const light = createThreeLightForObject(object, source);
      if (!light) continue;
      this.lights.add(light);
      if (light instanceof DirectionalLight || light instanceof SpotLight) {
        this.lights.add(light.target);
      }
    }
  }

  pick(raycaster: Raycaster): ObjectId | null {
    raycaster.params.Line ??= { threshold: 0.16 };
    raycaster.params.Line.threshold = 0.16;
    const hits = raycaster.intersectObjects(this.gizmos.children, false);
    const objectId = hits[0]?.object.userData.objectId;
    return typeof objectId === 'string' ? objectId : null;
  }

  private clearGroups(): void {
    this.clearLineGroup(this.gizmos);
    while (this.lights.children.length) {
      this.lights.remove(this.lights.children[0]!);
    }
  }

  private clearLineGroup(group: Group): void {
    while (group.children.length) {
      const child = group.children[0]!;
      group.remove(child);
      if (child instanceof LineSegments) {
        child.geometry.dispose();
        (child.material as LineBasicMaterial).dispose();
      }
    }
  }
}
