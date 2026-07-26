import {
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  Quaternion,
  Vector3,
} from 'three';
import type { ObjectRenderHandle } from '@/renderer/MeshRenderAdapter';
import { buildLogicalEdgeGeometry, editableMeshToRenderData } from '@/renderer/MeshRenderAdapter';
import type { EditableMesh } from '@/core/mesh/types';

export type ModifierPreview =
  | { kind: 'mirror'; axis: 'x' | 'y' | 'z' }
  | { kind: 'array'; axis: 'x' | 'y' | 'z'; count: number; spacing: number };

/** Transient, non-exported modifier ghosts sharing source GPU geometry. */
export class ModifierPreviewOverlay {
  readonly root = new Group();
  private ownedGeometry = new Set<{ dispose(): void }>();

  constructor() {
    this.root.name = '__modifier_preview__';
    this.root.renderOrder = 8;
  }

  clear(): void {
    this.ownedGeometry.forEach((geometry) => geometry.dispose());
    this.ownedGeometry.clear();
    for (const child of [...this.root.children]) {
      child.traverse((object) => {
        const material = (object as Mesh).material;
        if (Array.isArray(material)) material.forEach((item) => item.dispose());
        else material?.dispose?.();
      });
      this.root.remove(child);
    }
  }

  update(handle: ObjectRenderHandle | null, previews: ModifierPreview[], previewMesh: EditableMesh | null = null): void {
    this.clear();
    if (!handle) return;
    const position = new Vector3();
    const rotation = new Quaternion();
    const scale = new Vector3();
    handle.group.matrix.decompose(position, rotation, scale);
    if (previewMesh) this.addMeshGhost(previewMesh, position, rotation, scale);
    for (const preview of previews) {
      if (preview.kind === 'mirror') {
        const mirroredScale = scale.clone();
        mirroredScale[preview.axis] *= -1;
        this.addGhost(handle, position, rotation, mirroredScale);
      } else {
        const count = Math.max(2, Math.min(100, Math.round(preview.count)));
        for (let index = 1; index < count; index++) {
          const offset = position.clone();
          offset[preview.axis] += preview.spacing * index;
          this.addGhost(handle, offset, rotation, scale);
        }
      }
    }
  }

  dispose(): void {
    this.clear();
  }

  private addGhost(handle: ObjectRenderHandle, position: Vector3, rotation: Quaternion, scale: Vector3): void {
    const group = new Group();
    group.position.copy(position);
    group.quaternion.copy(rotation);
    group.scale.copy(scale);
    const mesh = new Mesh(
      handle.mesh.geometry,
      new MeshBasicMaterial({ color: 0xffa654, transparent: true, opacity: 0.2, depthWrite: false }),
    );
    mesh.raycast = () => {};
    const edges = new LineSegments(
      handle.edgeOverlay.geometry,
      new LineBasicMaterial({ color: 0xffbd79, transparent: true, opacity: 0.8, depthWrite: false }),
    );
    edges.raycast = () => {};
    group.add(mesh, edges);
    this.root.add(group);
  }

  private addMeshGhost(mesh: EditableMesh, position: Vector3, rotation: Quaternion, scale: Vector3): void {
    const render = editableMeshToRenderData(mesh);
    const edgeGeometry = buildLogicalEdgeGeometry(mesh);
    this.ownedGeometry.add(render.geometry);
    this.ownedGeometry.add(edgeGeometry);
    const group = new Group();
    group.position.copy(position);
    group.quaternion.copy(rotation);
    group.scale.copy(scale);
    const surface = new Mesh(
      render.geometry,
      new MeshBasicMaterial({ color: 0x75d5ff, transparent: true, opacity: 0.28, depthWrite: false }),
    );
    surface.raycast = () => {};
    const edges = new LineSegments(
      edgeGeometry,
      new LineBasicMaterial({ color: 0xbcecff, transparent: true, opacity: 0.9, depthWrite: false }),
    );
    edges.raycast = () => {};
    group.add(surface, edges);
    this.root.add(group);
  }
}
