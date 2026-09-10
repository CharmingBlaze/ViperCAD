import {
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  OrthographicCamera,
  PerspectiveCamera,
  RingGeometry,
  SphereGeometry,
  Vector3,
  type Camera,
} from "three";

const COLOR_CENTER = new Color(0xffaa00); // Golden amber
const COLOR_X = new Color(0xe74c3c);      // Red
const COLOR_Y = new Color(0x2ecc71);      // Green
const COLOR_Z = new Color(0x3498db);      // Blue

const TARGET_SCREEN_PIXELS = 28;

/**
 * 3D Origin (Pivot) visualizer.
 *
 * Rendered ONLY when the user is actively working on the origin (in Origin mode / Pivot tool).
 * Kept hidden during regular modeling to prevent viewport clutter.
 */
export class OriginOverlay {
  readonly root = new Group();
  private visible = false;

  constructor() {
    this.root.name = "OriginOverlay";
    // Keep the pivot marker readable above the transform gizmo's centre handle.
    this.root.renderOrder = 1001;
    this.root.visible = false;
    this.build();
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    this.root.visible = visible;
  }

  isVisible(): boolean {
    return this.visible;
  }

  /**
   * Synchronize position and screen-space size with the active camera.
   */
  sync(
    pivot: { x: number; y: number; z: number },
    camera: Camera,
    viewportHeight = 600,
    show = true,
  ): void {
    if (!show) {
      this.setVisible(false);
      return;
    }

    this.setVisible(true);
    this.root.position.set(pivot.x, pivot.y, pivot.z);

    // Compute screen-stable scale factor
    let worldUnitsPerPixel = 0.002;
    if (camera instanceof PerspectiveCamera) {
      const toPivot = new Vector3(pivot.x, pivot.y, pivot.z).sub(camera.position);
      const camForward = new Vector3();
      camera.getWorldDirection(camForward);
      const depth = Math.max(0.1, toPivot.dot(camForward));
      const vFovRad = (camera.fov * Math.PI) / 180;
      const frustumHeightAtDepth = 2 * depth * Math.tan(vFovRad / 2);
      worldUnitsPerPixel = frustumHeightAtDepth / Math.max(1, viewportHeight);
    } else if (camera instanceof OrthographicCamera) {
      const frustumHeight = (camera.top - camera.bottom) / Math.max(0.001, camera.zoom);
      worldUnitsPerPixel = frustumHeight / Math.max(1, viewportHeight);
    }

    const scale = worldUnitsPerPixel * TARGET_SCREEN_PIXELS;
    this.root.scale.set(scale, scale, scale);
    this.root.updateMatrixWorld(true);
  }

  dispose(): void {
    this.root.traverse((obj) => {
      const mesh = obj as Mesh;
      mesh.geometry?.dispose?.();
      const mat = mesh.material as MeshBasicMaterial | undefined;
      if (mat && !Array.isArray(mat)) mat.dispose();
    });
  }

  private build(): void {
    // 1. Center glowing pivot orb (golden amber)
    const centerMat = new MeshBasicMaterial({
      color: COLOR_CENTER,
      depthTest: false,
      transparent: true,
      opacity: 0.95,
    });
    const centerMesh = new Mesh(new SphereGeometry(0.18, 16, 16), centerMat);
    this.root.add(centerMesh);

    // 2. Mini X axis prong (red)
    this.addProng(COLOR_X, new Vector3(1, 0, 0));

    // 3. Mini Y axis prong (green)
    this.addProng(COLOR_Y, new Vector3(0, 1, 0));

    // 4. Mini Z axis prong (blue)
    this.addProng(COLOR_Z, new Vector3(0, 0, 1));

    // 5. Origin ring (faint amber outer boundary indicator)
    const ringMat = new MeshBasicMaterial({
      color: COLOR_CENTER,
      depthTest: false,
      transparent: true,
      opacity: 0.45,
      side: DoubleSide,
    });
    const ringMesh = new Mesh(new RingGeometry(0.48, 0.54, 32), ringMat);
    // Face the ring slightly up/diagonal
    ringMesh.rotation.x = -Math.PI / 2;
    this.root.add(ringMesh);
  }

  private addProng(color: Color, dir: Vector3): void {
    const mat = new MeshBasicMaterial({
      color,
      depthTest: false,
      transparent: true,
      opacity: 0.9,
    });

    const prongGroup = new Group();

    // Shaft
    const shaft = new Mesh(new CylinderGeometry(0.024, 0.024, 0.38, 8), mat);
    shaft.position.y = 0.19;
    prongGroup.add(shaft);

    // Tip
    const tip = new Mesh(new ConeGeometry(0.06, 0.14, 8), mat);
    tip.position.y = 0.38 + 0.07;
    prongGroup.add(tip);

    // Align Y up to direction
    if (dir.x !== 0) {
      prongGroup.rotation.z = -Math.sign(dir.x) * (Math.PI / 2);
    } else if (dir.z !== 0) {
      prongGroup.rotation.x = Math.sign(dir.z) * (Math.PI / 2);
    }

    this.root.add(prongGroup);
  }
}
