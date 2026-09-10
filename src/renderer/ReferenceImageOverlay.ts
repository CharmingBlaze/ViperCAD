import {
  DoubleSide,
  EdgesGeometry,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  SRGBColorSpace,
  Texture,
  TextureLoader,
} from 'three';
import {
  getReferenceImageDimensions,
  referencePlanesForPane,
  type BlockoutReferenceState,
  type ReferenceImageConfig,
} from '@/core/blockout/ReferenceImages';
import type { ViewId } from '@/workspace/types';

/**
 * Blueprint planes for Front / Side. Drawn as overlays (no depth) so a solid
 * that fills the view cannot hide them.
 */
export class ReferenceImageOverlayHandle {
  readonly group = new Group();
  private textureLoader = new TextureLoader();
  private textureCache = new Map<string, Texture>();
  private onInvalidate: (() => void) | null = null;

  private frontMesh: Mesh;
  private frontPaper: Mesh;
  private frontBorder: LineSegments;
  private frontMaterial: MeshBasicMaterial;
  private frontPaperMaterial: MeshBasicMaterial;

  private sideMesh: Mesh;
  private sidePaper: Mesh;
  private sideBorder: LineSegments;
  private sideMaterial: MeshBasicMaterial;
  private sidePaperMaterial: MeshBasicMaterial;

  private borderMaterial = new LineBasicMaterial({
    color: 0x1473e6,
    transparent: true,
    opacity: 0.45,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
    fog: false,
  });

  private lastState: BlockoutReferenceState | null = null;
  private currentPaneId: ViewId | null = null;

  constructor() {
    this.group.name = '__reference_images__';
    this.group.userData.nonSelectable = true;
    this.group.renderOrder = 80;
    this.group.frustumCulled = false;

    this.frontMaterial = this.createImageMaterial();
    this.frontPaperMaterial = this.createPaperMaterial();
    this.frontMesh = this.createImageMesh(this.frontMaterial);
    this.frontPaper = this.createPaperMesh(this.frontPaperMaterial);
    this.frontBorder = this.createBorder(this.frontMesh);
    this.group.add(this.frontPaper, this.frontMesh);

    this.sideMaterial = this.createImageMaterial();
    this.sidePaperMaterial = this.createPaperMaterial();
    this.sideMesh = this.createImageMesh(this.sideMaterial);
    this.sidePaper = this.createPaperMesh(this.sidePaperMaterial);
    this.sideBorder = this.createBorder(this.sideMesh);
    this.group.add(this.sidePaper, this.sideMesh);
  }

  setOnInvalidate(callback: (() => void) | null): void {
    this.onInvalidate = callback;
  }

  private createImageMaterial(): MeshBasicMaterial {
    return new MeshBasicMaterial({
      transparent: true,
      opacity: 0.65,
      side: DoubleSide,
      depthWrite: false,
      depthTest: false,
      toneMapped: false,
      fog: false,
    });
  }

  private createPaperMaterial(): MeshBasicMaterial {
    return new MeshBasicMaterial({
      color: 0xd8d2c6,
      transparent: true,
      opacity: 0.28,
      side: DoubleSide,
      depthWrite: false,
      depthTest: false,
      toneMapped: false,
      fog: false,
    });
  }

  private createImageMesh(material: MeshBasicMaterial): Mesh {
    const mesh = new Mesh(new PlaneGeometry(1, 1), material);
    mesh.renderOrder = 82;
    mesh.frustumCulled = false;
    mesh.userData.nonSelectable = true;
    mesh.visible = false;
    return mesh;
  }

  private createPaperMesh(material: MeshBasicMaterial): Mesh {
    const mesh = new Mesh(new PlaneGeometry(1, 1), material);
    mesh.renderOrder = 81;
    mesh.frustumCulled = false;
    mesh.userData.nonSelectable = true;
    mesh.visible = false;
    return mesh;
  }

  private createBorder(parent: Mesh): LineSegments {
    const border = new LineSegments(new EdgesGeometry(parent.geometry), this.borderMaterial);
    border.renderOrder = 83;
    border.frustumCulled = false;
    parent.add(border);
    return border;
  }

  private loadTexture(url: string, onLoaded?: (tex: Texture) => void): Texture {
    const existing = this.textureCache.get(url);
    if (existing) {
      if (onLoaded && existing.image) onLoaded(existing);
      return existing;
    }
    const tex = this.textureLoader.load(
      url,
      (loaded) => {
        loaded.colorSpace = SRGBColorSpace;
        loaded.needsUpdate = true;
        if (onLoaded) onLoaded(loaded);
        this.onInvalidate?.();
      },
      undefined,
      () => {
        this.textureCache.delete(url);
        this.onInvalidate?.();
      },
    );
    tex.colorSpace = SRGBColorSpace;
    this.textureCache.set(url, tex);
    return tex;
  }

  private updateImageMesh(
    mesh: Mesh,
    paper: Mesh,
    mat: MeshBasicMaterial,
    config: ReferenceImageConfig | null,
    isSide: boolean,
    onAspectCalculated?: (aspect: number) => void,
  ): void {
    if (!config || !config.visible || !config.url) {
      mesh.visible = false;
      paper.visible = false;
      return;
    }

    mesh.visible = true;
    paper.visible = true;
    mat.opacity = Math.max(0.01, Math.min(1.0, config.opacity));

    if (!mat.map || mat.map.userData?.url !== config.url) {
      const tex = this.loadTexture(config.url, (loaded) => {
        const img = loaded.image as { width?: number; height?: number } | undefined;
        if (img && img.width && img.height) {
          const aspect = img.width / img.height;
          if (onAspectCalculated && Math.abs(config.aspectRatio - aspect) > 0.01) {
            onAspectCalculated(aspect);
          }
        }
      });
      tex.userData = { url: config.url };
      mat.map = tex;
      mat.needsUpdate = true;
    }

    const { width, height } = getReferenceImageDimensions(config);
    const signX = config.flipX ? -1 : 1;
    const signY = config.flipY ? -1 : 1;

    mesh.scale.set(width * signX, height * signY, 1);
    paper.scale.set(Math.abs(width) * 1.02, Math.abs(height) * 1.02, 1);

    if (isSide) {
      mesh.position.set(config.posX || 0, config.posY, config.posZ);
      mesh.rotation.set(0, Math.PI / 2, 0);
      paper.position.copy(mesh.position);
      paper.rotation.copy(mesh.rotation);
    } else {
      mesh.position.set(config.posX, config.posY, config.posZ || 0);
      mesh.rotation.set(0, 0, 0);
      paper.position.copy(mesh.position);
      paper.rotation.copy(mesh.rotation);
    }
  }

  update(state: BlockoutReferenceState | null, onAspectUpdate?: (view: 'front' | 'side', aspect: number) => void): void {
    this.lastState = state;
    if (!state) {
      this.frontMesh.visible = false;
      this.frontPaper.visible = false;
      this.sideMesh.visible = false;
      this.sidePaper.visible = false;
      return;
    }

    this.updateImageMesh(this.frontMesh, this.frontPaper, this.frontMaterial, state.front, false, (aspect) => {
      if (onAspectUpdate) onAspectUpdate('front', aspect);
    });

    this.updateImageMesh(this.sideMesh, this.sidePaper, this.sideMaterial, state.side, true, (aspect) => {
      if (onAspectUpdate) onAspectUpdate('side', aspect);
    });

    this.applyVisibilityForPane(this.currentPaneId);
  }

  /** Filter which planes are visible depending on which camera pane is rendering. */
  applyVisibilityForPane(paneId: ViewId | null): void {
    this.currentPaneId = paneId;
    if (!this.lastState) {
      this.setFrontVisible(false);
      this.setSideVisible(false);
      return;
    }

    if (paneId === null) return;
    const planes = referencePlanesForPane(paneId, this.lastState);
    this.setFrontVisible(planes.front);
    this.setSideVisible(planes.side);
  }

  private setFrontVisible(visible: boolean): void {
    const active = visible && Boolean(this.lastState?.front?.visible && this.lastState.front.url);
    this.frontMesh.visible = active;
    this.frontPaper.visible = active;
  }

  private setSideVisible(visible: boolean): void {
    const active = visible && Boolean(this.lastState?.side?.visible && this.lastState.side.url);
    this.sideMesh.visible = active;
    this.sidePaper.visible = active;
  }

  dispose(): void {
    this.frontMaterial.dispose();
    this.frontPaperMaterial.dispose();
    this.sideMaterial.dispose();
    this.sidePaperMaterial.dispose();
    this.borderMaterial.dispose();
    this.frontMesh.geometry.dispose();
    this.frontPaper.geometry.dispose();
    this.sideMesh.geometry.dispose();
    this.sidePaper.geometry.dispose();
    this.frontBorder.geometry.dispose();
    this.sideBorder.geometry.dispose();
    for (const tex of this.textureCache.values()) {
      tex.dispose();
    }
    this.textureCache.clear();
  }
}
