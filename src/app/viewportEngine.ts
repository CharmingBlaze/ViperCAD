import {
  ACESFilmicToneMapping,
  AmbientLight,
  BufferGeometry,
  Color,
  DirectionalLight,
  DoubleSide,
  Group,
  HemisphereLight,
  MOUSE,
  Mesh,
  MeshBasicMaterial,
  LineBasicMaterial,
  LineLoop,
  OrthographicCamera,
  PerspectiveCamera,
  Raycaster,
  Scene,
  Vector2,
  Vector3,
  SRGBColorSpace,
  WebGLRenderer,
  type Camera,
  type Material,
  type Texture,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { EditorSession } from '@/core/editor/EditorSession';
import { enterGroupFocusFromPick, isObjectInFocusScope } from '@/core/editor/GroupFocus';
import { expandGroupsToDescendants, getObjectWorldMatrix } from '@/core/editor/Hierarchy';
import {
  editableMeshToRenderData,
  pickLogicalFace,
  type ObjectRenderHandle,
} from '@/renderer/MeshRenderAdapter';
import { SelectionOverlaySystem } from '@/renderer/SelectionOverlays';
import { applyViewportRenderStyle } from '@/renderer/ViewportRenderStyle';
import { TransformGizmo } from '@/renderer/TransformGizmo';
import {
  ORBIT_MAX_DISTANCE,
  ORBIT_MIN_DISTANCE,
  PERSP_FAR,
  PERSP_NEAR,
  absorbOrthoZoom,
  clampOrthoHeight,
  syncCameraClipPlanes,
} from '@/renderer/ViewportClip';
import { createViewportGrid, syncViewportGrid } from '@/renderer/ViewportGrid';
import type { ViewportGrid } from '@/renderer/ViewportGrid';
import { faceVertexIds, getEdgeVertices } from '@/core/mesh/EditableMesh';
import type { ObjectId } from '@/core/document/types';
import type { EditableMesh, EdgeId, FaceId, VertexId } from '@/core/mesh/types';
import { addVec3, dotVec3, scaleVec3, subVec3, v3, type Vec3 } from '@/core/math/Vec3';
import { computePivot } from '@/core/transform/Pivot';
import { buildOrientationBasis, type CameraAxes } from '@/core/transform/Orientation';
import { selectionHasTransformTarget } from '@/core/transform/Targets';
import type { PointerSample } from '@/core/transform/TransformSystem';
import type { ViewportRect } from '@/workspace/SplitLayoutManager';
import type { WorkspaceController } from '@/workspace/WorkspaceController';
import { sanitizeOrthoCamera, ORTHO_MIN_DISTANCE } from '@/workspace/orthoCameras';
import { DEFAULT_CAMERAS } from '@/workspace/WorkspacePersistence';
import {
  DEFAULT_VIEW_PRESETS,
  type ViewId,
  type ViewPreset,
} from '@/workspace/types';
import { CreateDoodleTool } from '@/core/tools/CreateDoodleTool';
import { CreatePrimitiveTool } from '@/core/tools/CreatePrimitiveTool';
import { DrawPolyTool } from '@/core/tools/DrawPolyTool';
import { KnifeTool } from '@/core/tools/KnifeTool';
import { LoopCutTool } from '@/core/tools/LoopCutTool';
import { PushPullTool } from '@/core/tools/PushPullTool';
import { TileDrawTool } from '@/core/tools/TileDrawTool';
import { TerrainSculptTool } from '@/core/tools/TerrainSculptTool';
import { MeshSculptTool } from '@/core/tools/MeshSculptTool';
import { raycastSculptTarget } from '@/core/sculpt/MeshSculptTarget';
import { TerrainObjectTool } from '@/core/tools/TerrainObjectTool';
import { TerrainFeatureTool } from '@/core/tools/TerrainFeatureTool';
import { terrainPlacedObjects } from '@/core/terrain/TerrainProps';
import type { ToolPointerInput } from '@/core/tools/Tool';
import { WORLD_XY_PLANE, WORLD_XZ_PLANE, WORLD_YZ_PLANE, rayPlaneIntersection } from '@/core/snap/SnapEngine';
import {
  commitPlaceModelInLevel,
  modelDocumentBaseOffset,
  modelDocumentPlacementRadius,
} from '@/core/editor/ModelInstances';
import { buildModelDocumentView } from '@/core/document/ViperProject';
import type { DocumentId } from '@/core/document/types';
import { inverseTransformPointApprox, cloneTransform } from '@/core/math/Transform';
import { PrimitivePreviewHandle } from '@/renderer/PrimitivePreviewAdapter';
import { TileDrawOverlay } from '@/renderer/TileDrawOverlay';
import { floodFill, getPixel } from '@/core/image/PixelEditor';
import { PixelStrokeRecorder } from '@/core/image/PixelStroke';
import {
  brushColourForTool,
  stampBrushLine,
  stampBrushUv,
} from '@/core/image/paintBrush';
import {
  resolveImageForFace,
  uvFromTriangleHit,
  uvToPixel,
} from '@/core/texture/uvFromMeshHit';
import {
  MARQUEE_MIN_DRAG_PX,
  marqueeModeFromDrag,
  normalizeScreenRect,
  pointInRect,
  pointsSatisfyMarquee,
  segmentHitsRect,
  type MarqueeMode,
  type ScreenRect,
} from '@/core/selection/MarqueeSelect';
import {
  boundsForView,
  documentViewPoints,
  orthographicFrameHeight,
  perspectiveFrameDistance,
} from '@/app/ViewportFraming';
import { markUvSeams } from '@/core/uv/UvOperations';
import { ViewportInteractionOverlay } from '@/app/viewport/ViewportInteractionOverlay';
import { ViewportSceneSynchronizer } from '@/app/viewport/ViewportSceneSynchronizer';
import { ModifierPreviewOverlay, type ModifierPreview } from '@/renderer/ModifierPreviewOverlay';
import {
  CurveControlOverlay,
  type CurveControlTarget,
} from '@/renderer/CurveControlOverlay';
import {
  evaluateCurveOperation,
  readCurveOperation,
  serializeCurveOperation,
  type CurveOperation,
} from '@/core/curves/CurveOperation';

const PICK_TOLERANCE_PX = 12;

type MarqueeState = {
  paneId: ViewId;
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
  shiftKey: boolean;
};

type Pane = {
  id: ViewId;
  view: ViewPreset;
  camera: Camera;
  controls: OrbitControls | null;
  /** Persistent orthographic view height in world units. */
  orthoHeight: number;
  grid: ViewportGrid;
};

/**
 * Single WebGL context, shared scene, four cameras.
 * Layout rectangles come from SplitLayoutManager — this never owns split ratios.
 */
export class ViewportEngine {
  private renderer: WebGLRenderer | null = null;
  private scene: Scene | null = null;
  private panes = new Map<ViewId, Pane>();
  private host: HTMLElement | null = null;
  private session: EditorSession | null = null;
  private workspace: WorkspaceController | null = null;
  private handles = new Map<string, ObjectRenderHandle>();
  private sceneSynchronizer = new ViewportSceneSynchronizer({
    handles: this.handles,
    getSession: () => this.session,
    isAttached: () => this.attached,
    onApplied: () => {
      this.syncOverlays();
      this.invalidate();
    },
  });
  private frame = 0;
  private resizeObserver: ResizeObserver | null = null;
  private unsubRedraw: (() => void) | null = null;
  private unsubWorkspace: (() => void) | null = null;
  private contextLost = false;
  private attached = false;
  private needsRender = true;
  private interacting = false;
  private lastRects: ViewportRect[] = [];
  private onLayoutChange: (() => void) | null = null;
  private onCameraChange: ((id: ViewId, axes: CameraAxes) => void) | null = null;
  private lastPixelRatio = 0;
  private renderQualityScale = 1;
  private primitivePreview = new PrimitivePreviewHandle();
  private tileDrawOverlay = new TileDrawOverlay();
  private overlays = new SelectionOverlaySystem();
  private gizmo = new TransformGizmo();
  private terrainBrushPreview = createTerrainBrushPreview();
  private sculptHardnessPreview = createTerrainBrushPreview();
  private terrainObjectGhost: Group | null = null;
  private terrainObjectGhostKey = '';
  private modifierPreview = new ModifierPreviewOverlay();
  private curveControls = new CurveControlOverlay();
  private curvePointDrag: {
    paneId: ViewId;
    pointerId: number;
    objectId: ObjectId;
    target: CurveControlTarget;
    planeOrigin: Vec3;
    planeNormal: Vec3;
    beforeMesh: EditableMesh;
    beforeMetadata: string;
    operation: CurveOperation;
  } | null = null;
  private draftCurvePointDrag: {
    paneId: ViewId;
    pointerId: number;
    target: { kind: 'anchor' | 'handle-in' | 'handle-out'; index: number };
    planeOrigin: Vec3;
    planeNormal: Vec3;
  } | null = null;
  private modifierObjectId: ObjectId | null = null;
  private modifierSpecs: ModifierPreview[] = [];
  private modifierMesh: EditableMesh | null = null;
  private lastHoverKey = '';
  private gizmoDragging = false;
  /** Latest cursor ray per pane, used to anchor keyboard G/R/S immediately. */
  private lastPointerSamples = new Map<ViewId, PointerSample>();
  private pendingTransformMove: { event: PointerEvent; paneId: ViewId } | null = null;
  private pendingPrimitiveMove: { event: PointerEvent; paneId: ViewId } | null = null;
  private pendingPaintMove: { event: PointerEvent; paneId: ViewId } | null = null;
  private painting3D = false;
  private seamStroke: Map<string, { mesh: EditableMesh; edgeId: EdgeId; before: boolean; after: boolean }> | null = null;
  private paintStroke = new PixelStrokeRecorder();
  private lastPaintPixel: { x: number; y: number; imageId: string } | null = null;
  private marquee: MarqueeState | null = null;
  private interactionOverlay = new ViewportInteractionOverlay();
  /** Select-mode tweak: press on selection, drag past threshold → free move. */
  private pendingTweak: {
    paneId: ViewId;
    startX: number;
    startY: number;
    pointerId: number;
  } | null = null;
  /** Active LightWave-style viewport navigation drag. */
  private viewportNavDrag: {
    paneId: ViewId;
    mode: 'pan' | 'orbit' | 'zoom';
    lastX: number;
    lastY: number;
  } | null = null;
  /** Double-click a grouped mesh to select its parent group. */
  private lastObjectPick: { objectId: ObjectId; time: number } | null = null;
  private modelPlacement: {
    modelDocumentId: DocumentId;
    modelName: string;
    onPlaced?: () => void;
  } | null = null;

  attach(
    host: HTMLElement,
    session: EditorSession,
    workspace: WorkspaceController,
    options?: {
      onLayoutChange?: () => void;
      onCameraChange?: (id: ViewId, axes: CameraAxes) => void;
    },
  ): void {
    this.host = host;
    this.session = session;
    this.workspace = workspace;
    this.onLayoutChange = options?.onLayoutChange ?? null;
    this.onCameraChange = options?.onCameraChange ?? null;

    if (!this.renderer) {
      if (!this.createRenderer(host, workspace)) {
        throw new Error(
          'WebGL is blocked after too many context losses. Close other tabs, then hard-refresh (Ctrl+Shift+R).',
        );
      }
    } else if (this.renderer.domElement.parentElement !== host) {
      host.replaceChildren();
      host.appendChild(this.renderer.domElement);
    }
    this.interactionOverlay.attach(host);

    this.attached = true;
    this.bindSession(session);
    this.unsubWorkspace?.();
    this.unsubWorkspace = workspace.subscribe(() => {
      // Recompute scissor rects before UI chrome reads them (Tab maximize/restore).
      this.resize();
      this.syncScene();
      this.invalidate();
      this.onLayoutChange?.();
      this.rebindActiveControls();
    });
    this.resize();
    this.syncScene();
    this.rebindActiveControls();
    this.startLoop();
    this.invalidate();
  }

  detach(): void {
    this.attached = false;
    this.stopLoop();
    this.unsubRedraw?.();
    this.unsubRedraw = null;
    this.unsubWorkspace?.();
    this.unsubWorkspace = null;
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.unbindPointer();
    this.sceneSynchronizer.reset();
    this.clearMarquee(false);
    this.seamStroke = null;
    this.painting3D = false;
    this.workspace?.input.end('tool');
    this.pendingTweak = null;
    this.lastPointerSamples.clear();
    this.pendingTransformMove = null;
    this.pendingPrimitiveMove = null;
    this.pendingPaintMove = null;
    this.curvePointDrag = null;
    this.draftCurvePointDrag = null;
    this.interactionOverlay.detach();
    this.clearTerrainObjectGhost();
    for (const pane of this.panes.values()) {
      pane.controls?.dispose();
      pane.controls = null;
    }

    if (this.renderer && this.host && this.renderer.domElement.parentElement === this.host) {
      this.host.removeChild(this.renderer.domElement);
    }
    this.host = null;
    this.session = null;
    this.workspace = null;
    this.onLayoutChange = null;
    this.onCameraChange = null;
  }

  getRects(): ViewportRect[] {
    return this.lastRects;
  }

  getLastPointerSample(viewId: ViewId): PointerSample | null {
    const sample = this.lastPointerSamples.get(viewId);
    if (!sample) return null;
    return {
      ...sample,
      rayOrigin: { ...sample.rayOrigin },
      rayDirection: { ...sample.rayDirection },
      camera: {
        right: { ...sample.camera.right },
        up: { ...sample.camera.up },
        forward: { ...sample.camera.forward },
      },
    };
  }

  invalidate(): void {
    this.needsRender = true;
  }

  setRenderQuality(scale: number): void {
    this.renderQualityScale = Math.max(0.5, Math.min(1.5, scale));
    if (this.renderer) {
      const ratio = Math.min((window.devicePixelRatio || 1) * this.renderQualityScale, 2);
      this.renderer.setPixelRatio(ratio);
      this.lastPixelRatio = ratio;
      this.resize();
      this.invalidate();
    }
  }

  setModifierPreview(objectId: ObjectId | null, previews: ModifierPreview[]): void {
    this.modifierObjectId = objectId;
    this.modifierSpecs = previews;
    this.refreshModifierPreview();
  }

  setMeshModifierPreview(objectId: ObjectId | null, mesh: EditableMesh | null): void {
    this.modifierObjectId = objectId;
    this.modifierMesh = mesh;
    this.refreshModifierPreview();
  }

  private refreshModifierPreview(): void {
    const handle = this.modifierObjectId ? this.handles.get(this.modifierObjectId) ?? null : null;
    this.modifierPreview.update(handle, this.modifierSpecs, this.modifierMesh);
    this.invalidate();
  }

  private createRenderer(host: HTMLElement, workspace: WorkspaceController): boolean {
    host.replaceChildren();
    const scene = new Scene();
    // Viper CAD's deep navy modelling surface.
    scene.background = new Color(0x090d12);

    let renderer: WebGLRenderer;
    try {
      renderer = new WebGLRenderer({
        antialias: true,
        powerPreference: 'default',
        failIfMajorPerformanceCaveat: false,
      });
    } catch {
      return false;
    }

    // Pixel ratio is for sharpness only. Layout/viewport/scissor stay in CSS pixels.
    renderer.setPixelRatio(Math.min((window.devicePixelRatio || 1) * this.renderQualityScale, 2));
    renderer.toneMapping = ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.outputColorSpace = SRGBColorSpace;
    host.appendChild(renderer.domElement);
    renderer.domElement.style.display = 'block';
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';

    renderer.domElement.addEventListener(
      'webglcontextlost',
      (e) => {
        e.preventDefault();
        this.contextLost = true;
      },
      false,
    );
    renderer.domElement.addEventListener(
      'webglcontextrestored',
      () => {
        this.contextLost = false;
        this.resize();
        this.invalidate();
      },
      false,
    );

    scene.add(new HemisphereLight(0xd8e4f8, 0x282830, 0.42));
    scene.add(new AmbientLight(0xffffff, 0.28));
    const key = new DirectionalLight(0xffffff, 0.95);
    key.position.set(6, 10, 4);
    scene.add(key);
    const fill = new DirectionalLight(0xc8d4ff, 0.42);
    fill.position.set(-5, 4, -7);
    scene.add(fill);
    const rim = new DirectionalLight(0xffe8cc, 0.28);
    rim.position.set(-2, 3, 8);
    scene.add(rim);

    const ids: ViewId[] = ['persp', 'top', 'front', 'right'];
    for (const id of ids) {
      const raw = workspace.getCamera(id);
      const snap = id === 'persp' ? raw : sanitizeOrthoCamera(id, raw);
      if (id !== 'persp') workspace.updateCameraState(id, snap);

      let camera: Camera;
      if (id === 'persp') {
        const persp = new PerspectiveCamera(snap.fov, 1, PERSP_NEAR, PERSP_FAR);
        const target = new Vector3().fromArray(snap.target);
        const position = new Vector3().fromArray(snap.position);
        const offset = position.clone().sub(target);
        if (offset.length() > ORBIT_MAX_DISTANCE) {
          position.copy(target).add(offset.setLength(ORBIT_MAX_DISTANCE));
          workspace.updateCameraState(id, {
            ...snap,
            position: position.toArray() as [number, number, number],
          });
        }
        persp.position.copy(position);
        persp.up.fromArray(snap.up);
        persp.lookAt(target);
        camera = persp;
      } else {
        // Positive near — negative near breaks ray picking with OrthographicCamera.
        const ortho = new OrthographicCamera(-1, 1, 1, -1, 0.01, 2000);
        ortho.position.fromArray(snap.position);
        ortho.up.fromArray(snap.up);
        ortho.zoom = snap.zoom || 1;
        ortho.lookAt(new Vector3().fromArray(snap.target));
        camera = ortho;
      }

      const grid = createViewportGrid(id);
      scene.add(grid);

      let orthoHeight = clampOrthoHeight(snap.orthoHeight || 10);
      if (camera instanceof OrthographicCamera) {
        const baked = absorbOrthoZoom(orthoHeight, camera.zoom);
        orthoHeight = baked.orthoHeight;
        camera.zoom = baked.zoom;
      }

      this.panes.set(id, {
        id,
        view: DEFAULT_VIEW_PRESETS[id],
        camera,
        controls: null,
        orthoHeight,
        grid,
      });
    }

    this.scene = scene;
    scene.add(this.primitivePreview.group);
    scene.add(this.tileDrawOverlay.group);
    scene.add(this.overlays.root);
    scene.add(this.gizmo.root);
    scene.add(this.terrainBrushPreview);
    scene.add(this.sculptHardnessPreview);
    (this.sculptHardnessPreview.material as LineBasicMaterial).opacity = 0.48;
    this.sculptHardnessPreview.name = 'Sculpt Hardness';
    scene.add(this.modifierPreview.root);
    this.renderer = renderer;
    return true;
  }

  getCameraAxes(viewId: ViewId): CameraAxes | null {
    const pane = this.panes.get(viewId);
    if (!pane) return null;
    const camera = pane.camera;
    camera.updateMatrixWorld(true);
    const right = new Vector3();
    const up = new Vector3();
    const forward = new Vector3();
    camera.matrixWorld.extractBasis(right, up, forward);
    forward.negate();
    return {
      right: v3(right.x, right.y, right.z),
      up: v3(up.x, up.y, up.z),
      forward: v3(forward.x, forward.y, forward.z),
    };
  }

  getPaneView(viewId: ViewId): ViewPreset {
    return this.panes.get(viewId)?.view ?? DEFAULT_VIEW_PRESETS[viewId];
  }

  setPaneView(viewId: ViewId, view: ViewPreset): void {
    const pane = this.panes.get(viewId);
    if (!pane || !this.workspace || pane.view === view) return;

    const currentTarget =
      pane.controls?.target.clone() ??
      new Vector3().fromArray(this.workspace.getCamera(viewId).target);
    const previousFov =
      pane.camera instanceof PerspectiveCamera ? pane.camera.fov : DEFAULT_CAMERAS.persp.fov;

    pane.controls?.dispose();
    pane.controls = null;
    pane.view = view;

    if (view === 'perspective') {
      const camera = new PerspectiveCamera(previousFov, 1, PERSP_NEAR, PERSP_FAR);
      const defaultOffset = new Vector3().fromArray(DEFAULT_CAMERAS.persp.position);
      camera.position.copy(currentTarget).add(defaultOffset);
      camera.up.fromArray(DEFAULT_CAMERAS.persp.up);
      camera.lookAt(currentTarget);
      pane.camera = camera;
    } else {
      const camera = new OrthographicCamera(-1, 1, 1, -1, 0.01, 2000);
      const snap = sanitizeOrthoCamera(view, {
        ...this.workspace.getCamera(viewId),
        position: pane.camera.position.toArray() as [number, number, number],
        target: currentTarget.toArray() as [number, number, number],
        up: pane.camera.up.toArray() as [number, number, number],
        orthoHeight: pane.orthoHeight,
        zoom: 1,
      });
      camera.position.fromArray(snap.position);
      camera.up.fromArray(snap.up);
      camera.lookAt(currentTarget);
      pane.camera = camera;
      pane.orthoHeight = clampOrthoHeight(snap.orthoHeight);
    }

    pane.camera.updateMatrixWorld(true);
    this.applyCameraProjections(this.lastRects);
    this.persistCameras();
    this.rebindActiveControls();
    this.notifyCameraChange(viewId);
    this.invalidate();
    this.onLayoutChange?.();
  }

  frameSelection(viewId?: ViewId): boolean {
    if (!this.session) return false;
    const points = documentViewPoints(this.session.document, this.session.selection.state);
    return this.framePoints(points, viewId);
  }

  frameAll(viewId?: ViewId): boolean {
    if (!this.session) return false;
    return this.framePoints(documentViewPoints(this.session.document), viewId);
  }

  resetView(viewId?: ViewId): void {
    if (!this.workspace) return;
    const id = viewId ?? this.workspace.hoveredViewportId ?? this.workspace.activeViewportId;
    const pane = this.panes.get(id);
    if (!pane) return;
    const snap =
      pane.view === 'perspective'
        ? DEFAULT_CAMERAS.persp
        : sanitizeOrthoCamera(pane.view, {
            ...DEFAULT_CAMERAS.top,
            position: [...DEFAULT_CAMERAS.top.position],
            target: [...DEFAULT_CAMERAS.top.target],
            up: [...DEFAULT_CAMERAS.top.up],
          });
    pane.camera.position.fromArray(snap.position);
    pane.camera.up.fromArray(snap.up);
    pane.orthoHeight = clampOrthoHeight(snap.orthoHeight);
    if (pane.camera instanceof PerspectiveCamera) pane.camera.fov = snap.fov;
    pane.controls?.target.fromArray(snap.target);
    pane.camera.lookAt(new Vector3().fromArray(snap.target));
    pane.camera.updateMatrixWorld(true);
    this.applyCameraProjections(this.lastRects);
    this.persistCameras();
    this.notifyCameraChange(id);
    this.invalidate();
  }

  /** Align a Perspective camera to a world axis without changing projection mode. */
  orientPerspective(
    axis: 'x' | 'y' | 'z',
    sign: 1 | -1 = 1,
    viewId: ViewId = 'persp',
  ): void {
    const pane = this.panes.get(viewId);
    if (!pane || !(pane.camera instanceof PerspectiveCamera) || !this.workspace) return;
    this.rebindActiveControls();
    const target =
      pane.controls?.target ??
      new Vector3().fromArray(this.workspace.getCamera(viewId).target);
    const distance = Math.max(
      ORBIT_MIN_DISTANCE,
      pane.camera.position.distanceTo(target),
    );
    const direction = new Vector3(
      axis === 'x' ? sign : 0,
      axis === 'y' ? sign : 0,
      axis === 'z' ? sign : 0,
    );
    pane.camera.position.copy(target).addScaledVector(direction, distance);
    pane.camera.up.set(
      0,
      axis === 'y' ? 0 : 1,
      axis === 'y' ? (sign > 0 ? -1 : 1) : 0,
    );
    pane.camera.lookAt(target);
    pane.camera.updateMatrixWorld(true);
    pane.controls?.target.copy(target);
    pane.controls?.update();
    this.persistCameras();
    this.notifyCameraChange(viewId);
    this.invalidate();
  }

  /** Orbit Perspective from the on-screen orientation widget (CSS-pixel deltas). */
  orbitPerspective(deltaX: number, deltaY: number, viewId: ViewId = 'persp'): void {
    this.applyViewportOrbit(deltaX, deltaY, viewId);
  }

  /** Pan the viewport by screen-pixel deltas (LightWave nav toolbar / pen-friendly). */
  panViewportByPixels(deltaX: number, deltaY: number, viewId: ViewId): void {
    const pane = this.ensurePaneControls(viewId);
    if (!pane?.controls) return;
    if (pane.camera instanceof OrthographicCamera) {
      // Ortho views: match OrbitControls / RMB pan (drag right → view moves right).
      pane.controls.pan(deltaX, deltaY);
    } else {
      // Perspective nav: same pixel convention as ortho (OrbitControls pan sign).
      pane.controls.pan(deltaX, deltaY);
    }
    pane.controls.update();
    if (pane.camera instanceof OrthographicCamera) {
      this.lockOrthoPane(pane);
      this.absorbPaneOrthoZoom(pane);
    }
    this.persistCameras();
    this.notifyCameraChange(viewId);
    this.invalidate();
  }

  /** Zoom the viewport by vertical screen-pixel delta. */
  zoomViewportByPixels(deltaY: number, viewId: ViewId): void {
    const pane = this.ensurePaneControls(viewId);
    if (!pane?.controls) return;
    if (pane.camera instanceof OrthographicCamera) {
      // Ortho views: drag down zooms out, drag up zooms in.
      const factor = Math.exp(deltaY * 0.008);
      pane.orthoHeight = clampOrthoHeight(pane.orthoHeight * factor);
      this.lockOrthoPane(pane);
      this.absorbPaneOrthoZoom(pane);
    } else {
      // Perspective magnifier — same delta sign as ortho, inverted dolly (drag up zooms in).
      const factor = Math.exp(deltaY * 0.008);
      if (factor >= 1) pane.controls.dollyIn(factor);
      else pane.controls.dollyOut(1 / factor);
      pane.controls.update();
    }
    this.persistCameras();
    this.notifyCameraChange(viewId);
    this.invalidate();
  }

  applyViewportNavDrag(
    mode: 'pan' | 'orbit' | 'zoom',
    deltaX: number,
    deltaY: number,
    viewId: ViewId,
  ): void {
    if (mode === 'pan') this.panViewportByPixels(deltaX, deltaY, viewId);
    else if (mode === 'orbit') this.applyViewportOrbit(deltaX, deltaY, viewId);
    else this.zoomViewportByPixels(deltaY, viewId);
  }

  private applyViewportOrbit(deltaX: number, deltaY: number, viewId: ViewId): void {
    const pane = this.panes.get(viewId);
    if (!pane || !(pane.camera instanceof PerspectiveCamera) || !this.workspace) return;
    if (!pane.controls) {
      this.workspace.setActiveViewport(viewId);
      this.rebindActiveControls();
    }
    const controls = pane.controls;
    if (!controls) return;
    const radiansPerPixel = 0.012;
    controls.rotateLeft(deltaX * radiansPerPixel);
    controls.rotateUp(deltaY * radiansPerPixel);
    controls.update();
    this.persistCameras();
    this.notifyCameraChange(viewId);
    this.invalidate();
  }

  private ensurePaneControls(viewId: ViewId): Pane | null {
    if (!this.workspace) return null;
    this.workspace.setActiveViewport(viewId);
    this.rebindActiveControls();
    return this.panes.get(viewId) ?? null;
  }

  private tryBeginViewportNav(e: PointerEvent, paneId: ViewId): boolean {
    if (!this.workspace || e.button !== 0) return false;
    const { viewportNavMode, viewportNavViewId } = this.workspace;
    if (viewportNavMode === 'none' || viewportNavViewId !== paneId) return false;
    if (viewportNavMode === 'orbit' && !(this.panes.get(paneId)?.camera instanceof PerspectiveCamera)) {
      return false;
    }
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    this.viewportNavDrag = {
      paneId,
      mode: viewportNavMode,
      lastX: e.clientX,
      lastY: e.clientY,
    };
    this.rebindActiveControls();
    return true;
  }

  private framePoints(points: ReturnType<typeof documentViewPoints>, viewId?: ViewId): boolean {
    if (!this.workspace) return false;
    const bounds = boundsForView(points);
    if (!bounds) return false;
    const id = viewId ?? this.workspace.hoveredViewportId ?? this.workspace.activeViewportId;
    const pane = this.panes.get(id);
    const rect = this.lastRects.find((candidate) => candidate.id === id);
    if (!pane) return false;
    this.rebindActiveControls();
    const target = new Vector3(bounds.center.x, bounds.center.y, bounds.center.z);
    const currentTarget = pane.controls?.target ?? new Vector3().fromArray(this.workspace.getCamera(id).target);
    const outward = pane.camera.position.clone().sub(currentTarget).normalize();
    if (outward.lengthSq() < 1e-8) outward.set(1, 1, 1).normalize();
    const aspect = rect ? rect.width / Math.max(1, rect.height) : 1;

    if (pane.camera instanceof PerspectiveCamera) {
      const distance = perspectiveFrameDistance(bounds.radius, pane.camera.fov, aspect);
      pane.camera.position.copy(target).addScaledVector(outward, distance);
    } else {
      pane.orthoHeight = clampOrthoHeight(orthographicFrameHeight(bounds.radius, aspect));
      const distance = Math.max(ORTHO_MIN_DISTANCE, pane.camera.position.distanceTo(currentTarget));
      pane.camera.position.copy(target).addScaledVector(outward, distance);
    }
    pane.controls?.target.copy(target);
    pane.camera.lookAt(target);
    pane.camera.updateMatrixWorld(true);
    if (pane.camera instanceof OrthographicCamera) this.lockOrthoPane(pane);
    this.applyCameraProjections(this.lastRects);
    this.persistCameras();
    this.notifyCameraChange(id);
    this.invalidate();
    return true;
  }

  private rebindActiveControls(): void {
    if (!this.renderer || !this.workspace) return;
    const activeTool = this.session?.tools.getActive();
    const doodleDrawing =
      activeTool instanceof CreateDoodleTool &&
      activeTool.state.stage === 'drawing' &&
      ((activeTool.inputMode === 'sketch' && !activeTool.state.strokeLocked) ||
        activeTool.inputMode === 'pen' ||
        (activeTool.inputMode === 'sketch' &&
          activeTool.state.strokeLocked &&
          this.workspace.curveNodeEditMode));
    const modalMeshTool =
      (activeTool instanceof KnifeTool && activeTool.state.dragging) ||
      activeTool instanceof LoopCutTool ||
      activeTool instanceof PushPullTool ||
      (activeTool instanceof TerrainSculptTool && activeTool.dragging) ||
      (activeTool instanceof MeshSculptTool && activeTool.dragging) ||
      (activeTool instanceof TerrainObjectTool && activeTool.dragging) ||
      (activeTool instanceof TerrainFeatureTool && activeTool.dragging);
    const blockTransform =
      !!this.session?.transform.active ||
      this.gizmoDragging ||
      !!this.curvePointDrag ||
      !!this.draftCurvePointDrag ||
      !!this.marquee ||
      this.painting3D ||
      !!doodleDrawing ||
      modalMeshTool ||
      this.workspace.input.isTransformOwned();

    const activeId =
      this.workspace.layoutMode === 'maximized'
        ? (this.workspace.splits.state.maximizedViewportId ?? this.workspace.activeViewportId)
        : this.workspace.activeViewportId;

    for (const pane of this.panes.values()) {
      if (pane.id !== activeId && pane.controls) {
        pane.controls.enabled = false;
      }
    }

    const pane = this.panes.get(activeId);
    if (!pane) return;

    if (!pane.controls) {
      const controls = new OrbitControls(pane.camera, this.renderer.domElement);
      controls.enableDamping = true;
      controls.dampingFactor = 0.08;
      controls.screenSpacePanning = true;
      controls.minDistance = ORBIT_MIN_DISTANCE;
      controls.maxDistance = ORBIT_MAX_DISTANCE;
      if (pane.camera instanceof OrthographicCamera) {
        // Ortho must stay back from the focus plane or solids get near-clipped.
        controls.minDistance = ORTHO_MIN_DISTANCE;
      }
      // Ortho zoom is absorbed into orthoHeight — leave zoom unbounded.
      controls.minZoom = 0;
      controls.maxZoom = Infinity;
      const target = this.workspace.getCamera(pane.id).target;
      controls.target.fromArray(target);
      controls.addEventListener('start', () => {
        if (this.workspace?.input.isTransformOwned()) return;
        this.interacting = true;
        this.invalidate();
      });
      controls.addEventListener('end', () => {
        if (pane.camera instanceof OrthographicCamera) {
          this.lockOrthoPane(pane);
          this.absorbPaneOrthoZoom(pane);
        }
        this.interacting = false;
        this.persistCameras();
        this.invalidate();
      });
      controls.addEventListener('change', () => {
        if (pane.camera instanceof OrthographicCamera) {
          this.lockOrthoPane(pane);
          this.absorbPaneOrthoZoom(pane);
        }
        this.notifyCameraChange(pane.id);
        this.invalidate();
      });
      pane.controls = controls;
      if (pane.camera instanceof OrthographicCamera) this.lockOrthoPane(pane);
    } else {
      pane.controls.maxDistance = ORBIT_MAX_DISTANCE;
      pane.controls.minDistance =
        pane.camera instanceof PerspectiveCamera ? ORBIT_MIN_DISTANCE : ORTHO_MIN_DISTANCE;
    }

    if (pane.controls) {
      // Reapply navigation whenever a pane becomes active. This also updates
      // controls that survived a hot reload or workspace rebind.
      pane.controls.mouseButtons.LEFT = -1 as unknown as typeof MOUSE.PAN;
      pane.controls.mouseButtons.MIDDLE = MOUSE.ROTATE;
      // RMB drags/pans the camera in every viewport; MMB remains perspective orbit.
      pane.controls.mouseButtons.RIGHT = MOUSE.PAN;
      pane.controls.enableRotate = pane.camera instanceof PerspectiveCamera;
      pane.controls.enablePan = true;
    }

    const activeRect = this.lastRects.find((rect) => rect.id === activeId);
    const hostHeight = this.host?.getBoundingClientRect().height ?? activeRect?.height ?? 1;
    const paneScale = activeRect ? hostHeight / Math.max(1, activeRect.height) : 1;
    if (pane.controls) {
      // OrbitControls measures deltas against its DOM element (the full shared canvas).
      // Compensate so navigation feels identical in quad and maximized layouts.
      pane.controls.panSpeed = paneScale;
      pane.controls.rotateSpeed = paneScale;
    }

    for (const p of this.panes.values()) {
      if (p.controls) p.controls.enabled = !blockTransform && p.id === activeId;
    }
  }

  private persistCameras(): void {
    if (!this.workspace) return;
    for (const pane of this.panes.values()) {
      if (pane.camera instanceof OrthographicCamera) {
        this.lockOrthoPane(pane);
        this.absorbPaneOrthoZoom(pane);
      }
      const target = pane.controls?.target ?? new Vector3(0, 0, 0);
      const prev = this.workspace.getCamera(pane.id);
      const raw = {
        position: pane.camera.position.toArray() as [number, number, number],
        target: target.toArray() as [number, number, number],
        up: pane.camera.up.toArray() as [number, number, number],
        fov: pane.camera instanceof PerspectiveCamera ? pane.camera.fov : prev.fov,
        orthoHeight: clampOrthoHeight(pane.orthoHeight),
        zoom: pane.camera instanceof OrthographicCamera ? pane.camera.zoom : 1,
      };
      this.workspace.updateCameraState(
        pane.id,
        pane.camera instanceof PerspectiveCamera ? raw : sanitizeOrthoCamera(pane.view, raw),
      );
    }
  }

  private notifyCameraChange(id: ViewId): void {
    const axes = this.getCameraAxes(id);
    if (axes) this.onCameraChange?.(id, axes);
  }

  /** Keep orthographic cameras on their canonical axis (pan/zoom only). */
  private lockingOrtho = false;
  private lockOrthoPane(pane: Pane): void {
    if (!(pane.camera instanceof OrthographicCamera) || !this.workspace || this.lockingOrtho) return;
    this.lockingOrtho = true;
    try {
      const target =
        pane.controls?.target ??
        new Vector3().fromArray(this.workspace.getCamera(pane.id).target);
      const snap = sanitizeOrthoCamera(pane.view, {
        position: pane.camera.position.toArray() as [number, number, number],
        target: target.toArray() as [number, number, number],
        up: pane.camera.up.toArray() as [number, number, number],
        fov: 45,
        orthoHeight: pane.orthoHeight,
        zoom: pane.camera instanceof OrthographicCamera ? pane.camera.zoom : 1,
      });
      pane.camera.position.fromArray(snap.position);
      pane.camera.up.fromArray(snap.up);
      const look = new Vector3(snap.target[0], snap.target[1], snap.target[2]);
      pane.camera.lookAt(look);
      pane.camera.updateMatrixWorld(true);
      if (pane.controls) pane.controls.target.copy(look);
    } finally {
      this.lockingOrtho = false;
    }
  }

  /** Bake OrbitControls zoom into orthoHeight so zoom-out isn't capped by minZoom. */
  private absorbPaneOrthoZoom(pane: Pane): void {
    if (!(pane.camera instanceof OrthographicCamera)) return;
    const next = absorbOrthoZoom(pane.orthoHeight, pane.camera.zoom);
    if (next.orthoHeight === pane.orthoHeight && next.zoom === pane.camera.zoom) return;
    pane.orthoHeight = next.orthoHeight;
    pane.camera.zoom = next.zoom;
    const rect = this.lastRects.find((r) => r.id === pane.id);
    if (rect && rect.width >= 1 && rect.height >= 1) {
      this.applyCameraProjections([rect]);
    } else {
      const target =
        pane.controls?.target ??
        new Vector3().fromArray(this.workspace!.getCamera(pane.id).target);
      syncCameraClipPlanes(pane.camera, target);
    }
  }

  private bindSession(session: EditorSession): void {
    this.unsubRedraw?.();
    this.unsubRedraw = session.onRedraw(() => {
      this.syncScene();
      this.invalidate();
    });
    this.resizeObserver?.disconnect();
    if (this.host) {
      this.resizeObserver = new ResizeObserver(() => {
        this.resize();
        this.invalidate();
        this.onLayoutChange?.();
      });
      this.resizeObserver.observe(this.host);
    }
    this.bindPointer();
  }

  private onPointerMove = (e: PointerEvent): void => {
    if (!this.host || !this.workspace || this.workspace.input.owner === 'divider') return;
    const rect = this.host.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const id = this.workspace.hitTestViewport(x, y, rect.width, rect.height);
    if (id) {
      this.workspace.setHoveredViewport(id);
      this.lastPointerSamples.set(id, this.toPointerSample(e, id));
    }
    if (this.viewportNavDrag && (e.buttons & 1)) {
      e.preventDefault();
      const drag = this.viewportNavDrag;
      const deltaX = e.clientX - drag.lastX;
      const deltaY = e.clientY - drag.lastY;
      drag.lastX = e.clientX;
      drag.lastY = e.clientY;
      if (deltaX !== 0 || deltaY !== 0) {
        this.applyViewportNavDrag(drag.mode, deltaX, deltaY, drag.paneId);
      }
      if (this.renderer) {
        this.renderer.domElement.style.cursor =
          drag.mode === 'pan' ? 'move' : drag.mode === 'zoom' ? 'zoom-in' : 'grab';
      }
      this.invalidate();
      return;
    }
    if (!this.session?.transform.active) this.interactionOverlay.updateSnap(null, 'none');

    if (this.curvePointDrag && (e.buttons & 1)) {
      this.updateCurvePointDrag(e);
      return;
    }
    if (this.draftCurvePointDrag && (e.buttons & 1)) {
      this.updateDraftCurvePointDrag(e);
      return;
    }

    if (this.marquee) {
      this.marquee.currentX = x;
      this.marquee.currentY = y;
      this.marquee.shiftKey = e.shiftKey;
      this.interactionOverlay.updateMarquee(this.marquee);
      return;
    }

    if (this.pendingTweak && (e.buttons & 1)) {
      const dx = x - this.pendingTweak.startX;
      const dy = y - this.pendingTweak.startY;
      if (Math.hypot(dx, dy) >= MARQUEE_MIN_DRAG_PX) {
        const paneId = this.pendingTweak.paneId;
        this.pendingTweak = null;
        this.beginFreeMove(e, paneId);
      }
      return;
    }

    if (this.painting3D && id && (e.buttons & 1)) {
      this.pendingPaintMove = { event: e, paneId: id };
      this.invalidate();
      return;
    }
    if (this.seamStroke && id && (e.buttons & 1)) {
      this.paintSeamAtPointer(e, id);
      return;
    }

    const transform = this.session?.transform;
    if (transform?.active) {
      // Pointer devices can emit substantially faster than the display refresh.
      // Keep only the newest sample and apply it immediately before the next frame.
      // A modal transform stays in the pane where it began. Crossing a quad-view
      // divider must not suddenly swap perspective/orthographic projection math.
      const paneId = transform.session?.activeViewportId ?? id;
      if (!paneId) return;
      this.pendingTransformMove = { event: e, paneId };
      this.invalidate();
      return;
    }

    const tool = this.session?.tools.getActive();
    if (
      !(tool instanceof TerrainSculptTool) &&
      !(tool instanceof MeshSculptTool) &&
      !(tool instanceof TerrainObjectTool) &&
      !(tool instanceof TerrainFeatureTool)
    ) {
      this.terrainBrushPreview.visible = false;
    }
    if (!(tool instanceof MeshSculptTool)) {
      this.sculptHardnessPreview.visible = false;
    }
    if (id && tool instanceof CreatePrimitiveTool && tool.state.stage !== 'idle') {
      this.pendingPrimitiveMove = { event: e, paneId: id };
      this.invalidate();
      return;
    }
    if (id && tool instanceof CreateDoodleTool && tool.state.stage === 'drawing') {
      tool.update(this.pointerInput(e, id), this.session!.context());
      this.invalidate();
      return;
    }
    if (id && tool instanceof DrawPolyTool) {
      if (tool.state.chain.length === 0 && this.session) {
        const gizmoHit = this.isTextureFaceEditing() ? null : this.pickGizmo(e, id);
        if (gizmoHit) {
          if (this.renderer) this.renderer.domElement.style.cursor = 'grab';
          this.gizmo.setHovered(gizmoHit.handleId);
          this.session.selection.clearHover();
          this.syncGizmo();
          this.invalidate();
          return;
        }
        if (this.renderer) this.renderer.domElement.style.cursor = '';
        this.gizmo.setHovered(null);
      }
      tool.update(this.pointerInput(e, id), this.session!.context());
      this.interactionOverlay.updateSnap(e, tool.state.snapLabel);
      this.invalidate();
      return;
    }
    if (id && tool instanceof KnifeTool) {
      tool.setViewportPick(this.resolveKnifePick(e, id));
      tool.update(this.pointerInput(e, id), this.session!.context());
      this.invalidate();
      return;
    }
    if (id && tool instanceof PushPullTool) {
      if (tool.state.phase === 'hover') {
        tool.setViewportPick(this.resolveKnifePick(e, id));
      }
      tool.update(this.pointerInput(e, id), this.session!.context());
      this.interactionOverlay.updateTransform(e, tool.getStatusLine());
      if (this.renderer) this.renderer.domElement.style.cursor = 'crosshair';
      this.invalidate();
      return;
    }
    if (id && tool instanceof LoopCutTool) {
      tool.setViewportPick(this.resolveLoopCutPick(e, id));
      tool.update(this.pointerInput(e, id), this.session!.context());
      this.interactionOverlay.updateTransform(e, tool.getStatusLine());
      this.invalidate();
      return;
    }
    if (id && tool instanceof TileDrawTool) {
      tool.update(this.pointerInput(e, id), this.session!.context());
      this.invalidate();
      return;
    }
    if (id && tool instanceof TerrainSculptTool) {
      const input = this.terrainPointerInput(e, id);
      if (tool.dragging && (e.buttons & 1)) {
        tool.update(input, this.session!.context());
      }
      this.updateTerrainBrushPreview(input, tool);
      this.interactionOverlay.updateTransform(e, tool.statusLine());
      if (this.renderer) this.renderer.domElement.style.cursor = 'crosshair';
      this.invalidate();
      return;
    }
    if (id && tool instanceof MeshSculptTool) {
      const input = this.meshSculptPointerInput(e, id);
      tool.updatePreview(input, this.session!.context());
      if (tool.dragging && (e.buttons & 1)) {
        tool.update(input, this.session!.context());
      }
      this.updateMeshSculptBrushPreview(tool);
      this.interactionOverlay.updateTransform(e, tool.statusLine());
      if (this.renderer) this.renderer.domElement.style.cursor = 'crosshair';
      this.invalidate();
      return;
    }
    if (id && tool instanceof TerrainObjectTool) {
      const input = this.terrainPointerInput(e, id);
      if (tool.dragging && (e.buttons & 1)) {
        tool.update(input, this.session!.context());
      }
      this.updateTerrainObjectBrushPreview(input, tool);
      this.interactionOverlay.updateTransform(e, tool.statusLine());
      if (this.renderer) this.renderer.domElement.style.cursor = 'crosshair';
      this.invalidate();
      return;
    }
    if (id && tool instanceof TerrainFeatureTool) {
      const input = this.terrainPointerInput(e, id);
      if (tool.dragging && (e.buttons & 1)) {
        tool.update(input, this.session!.context());
      }
      this.updateTerrainFeatureBrushPreview(input, tool);
      this.interactionOverlay.updateTransform(e, tool.statusLine());
      if (this.renderer) this.renderer.domElement.style.cursor = 'crosshair';
      this.invalidate();
      return;
    }

    const doodleTool = tool instanceof CreateDoodleTool ? tool : null;
    const doodleBlocksHover =
      doodleTool &&
      doodleTool.state.stage === 'drawing' &&
      (doodleTool.inputMode === 'pen' ||
        (doodleTool.inputMode === 'sketch' && !doodleTool.state.strokeLocked) ||
        (doodleTool.isSketchStrokeLocked() && this.workspace.curveNodeEditMode));

    if (
      id &&
      this.session &&
      !(tool instanceof CreatePrimitiveTool) &&
      !doodleBlocksHover &&
      !(tool instanceof DrawPolyTool)
      && !(tool instanceof TileDrawTool)
      && !(tool instanceof KnifeTool)
      && !(tool instanceof LoopCutTool)
      && !(tool instanceof PushPullTool)
      && !(tool instanceof TerrainSculptTool)
      && !(tool instanceof MeshSculptTool)
      && !(tool instanceof TerrainObjectTool)
      && !(tool instanceof TerrainFeatureTool)
    ) {
      const gizmoHit = this.isTextureFaceEditing() ? null : this.pickGizmo(e, id);
      if (gizmoHit) {
        if (this.renderer) this.renderer.domElement.style.cursor = 'grab';
        this.gizmo.setHovered(gizmoHit.handleId);
        this.session.selection.clearHover();
        this.syncGizmo();
        this.invalidate();
        return;
      }
      if (this.renderer) this.renderer.domElement.style.cursor = '';
      this.gizmo.setHovered(null);
      this.updateHover(e, id);
      this.syncGizmo();
    }
  };

  private onPointerDown = (e: PointerEvent): void => {
    if (!this.host || !this.workspace) return;
    if (this.workspace.input.owner === 'divider') return;

    this.activateNavigationPane(e.clientX, e.clientY);

    const transform = this.session?.transform;

    // RMB cancels active modal / gizmo transform
    if (e.button === 2 && transform?.active) {
      e.preventDefault();
      transform.cancel();
      this.workspace.input.end('transform');
      this.gizmoDragging = false;
      this.gizmo.setActiveHandle(null);
      this.syncTransformInteractionState();
      return;
    }

    const modalTool = this.session?.tools.getActive();
    if (e.button === 2 && modalTool instanceof LoopCutTool && this.session) {
      e.preventDefault();
      const completed = modalTool.centreAndConfirm(this.session.context());
      if (completed) {
        this.workspace.input.end('tool');
        this.session.tools.setActive('select', this.session.context());
        this.interactionOverlay.updateTransform(null, '');
        this.syncInputControls();
      }
      return;
    }

    if (e.button !== 0) return;

    const rect = this.host.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const id = this.workspace.hitTestViewport(x, y, rect.width, rect.height);
    if (!id) return;

    this.workspace.setActiveViewport(id);

    if (this.modelPlacement && this.tryPlaceModelAtPointer(e, id)) return;

    if (this.tryBeginViewportNav(e, id)) return;

    const tool = this.session?.tools.getActive();
    const vectorPenDrawing =
      tool instanceof CreateDoodleTool &&
      tool.inputMode === 'pen' &&
      tool.state.stage === 'drawing';
    const vectorPenIdle =
      tool instanceof CreateDoodleTool &&
      tool.inputMode === 'pen' &&
      tool.state.stage === 'idle';
    if (
      !this.workspace.curveNodeEditMode &&
      !vectorPenDrawing &&
      this.tryStartGizmoTransform(e, id)
    ) {
      this.invalidate();
      return;
    }
    const curveTarget =
      this.workspace.curveNodeEditMode && !vectorPenIdle
        ? this.pickCurveControl(e, id)
        : null;
    if (curveTarget && this.beginCurvePointDrag(e, id, curveTarget)) return;

    if (this.workspace.texture.seamPaintMode !== 'off') {
      e.preventDefault();
      (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
      this.seamStroke = new Map();
      this.workspace.input.begin('tool');
      this.syncOrbitEnabled();
      this.paintSeamAtPointer(e, id);
      return;
    }

    // Ctrl/Cmd+LMB = screen marquee (anywhere, including over paint / gizmo).
    if (
      (e.ctrlKey || e.metaKey) &&
      !(tool instanceof CreatePrimitiveTool) &&
      !(tool instanceof CreateDoodleTool) &&
      !(tool instanceof DrawPolyTool) &&
      !(tool instanceof TileDrawTool) &&
      !(tool instanceof KnifeTool) &&
      !(tool instanceof LoopCutTool) &&
      !(tool instanceof PushPullTool) &&
      !(tool instanceof TerrainSculptTool) &&
      !(tool instanceof MeshSculptTool) &&
      !(tool instanceof TerrainObjectTool) &&
      !(tool instanceof TerrainFeatureTool) &&
      !transform?.active
    ) {
      this.beginMarquee(e, id);
      return;
    }

    if (this.canPaint3D()) {
      e.preventDefault();
      (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
      this.painting3D = true;
      this.lastPaintPixel = null;
      this.workspace.input.begin('tool');
      this.syncOrbitEnabled();
      this.paintAtPointer(e, id, true);
      return;
    }

    if (transform?.active) {
      e.preventDefault();
      transform.confirm();
      this.workspace.input.end('transform');
      this.gizmo.setActiveHandle(null);
      this.syncTransformInteractionState();
      return;
    }

    if (tool instanceof CreatePrimitiveTool) {
      this.rebindActiveControls();
      if (tool.state.stage === 'idle') {
        const facePlane = this.faceConstructionPlane(e, id);
        this.session!.constructionPlane =
          facePlane?.plane ??
          (id === 'front' ? WORLD_XY_PLANE : id === 'right' ? WORLD_YZ_PLANE : WORLD_XZ_PLANE);
        this.session!.constructionPlaneId = facePlane?.id ?? id;
      }
      tool.begin(this.pointerInput(e, id), this.session!.context());
      this.invalidate();
      return;
    }

    if (tool instanceof CreateDoodleTool) {
      const sketching =
        tool.inputMode === 'sketch' &&
        tool.state.stage === 'drawing' &&
        !tool.state.strokeLocked;
      const penDrawing = tool.inputMode === 'pen' && tool.state.stage === 'drawing';
      const strokeLocked = tool.isSketchStrokeLocked();

      if (strokeLocked && !this.workspace.curveNodeEditMode) {
        if (this.tryStartGizmoTransform(e, id)) {
          this.invalidate();
          return;
        }
      } else if (sketching || penDrawing) {
        e.preventDefault();
        if (tool.inputMode === 'sketch') {
          (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
        }
        this.rebindActiveControls();
        const pane = this.panes.get(id);
        if (pane?.controls) {
          const depth = pane.camera.position.distanceTo(pane.controls.target);
          tool.setDepthHint(depth);
        }
        this.workspace.input.begin('tool');
        this.syncOrbitEnabled();
        tool.begin(this.pointerInput(e, id), this.session!.context());
        if (tool.inputMode === 'pen') {
          this.workspace.input.end('tool');
          this.syncOrbitEnabled();
        }
        this.invalidate();
        return;
      } else if (tool.state.stage === 'idle') {
        if (tool.inputMode === 'pen') {
          this.workspace.setCurveNodeEditMode(false);
          this.workspace.setSelectedCurvePointIndex(0);
        }
        if (tool.inputMode !== 'pen') {
          if (this.tryStartGizmoTransform(e, id)) {
            this.invalidate();
            return;
          }
          const hit = this.resolvePointerHit(e, id);
          if (hit) {
            this.pickSelection(e, id);
            if (this.workspace.curveNodeEditMode) {
              this.workspace.setCurveNodeEditMode(false);
            }
            this.syncGizmo();
            this.invalidate();
            return;
          }
        }
        e.preventDefault();
        if (tool.inputMode === 'sketch') {
          (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
        }
        this.rebindActiveControls();
        const pane = this.panes.get(id);
        if (pane?.controls) {
          const depth = pane.camera.position.distanceTo(pane.controls.target);
          tool.setDepthHint(depth);
        }
        this.workspace.input.begin('tool');
        this.syncOrbitEnabled();
        tool.begin(this.pointerInput(e, id), this.session!.context());
        this.syncOrbitEnabled();
        this.invalidate();
        return;
      }
      this.invalidate();
      return;
    }

    if (tool instanceof DrawPolyTool) {
      if (this.tryStartGizmoTransform(e, id)) {
        this.invalidate();
        return;
      }
      e.preventDefault();
      this.rebindActiveControls();
      if (tool.state.createdInChain.length === 0) {
        const facePlane = this.faceConstructionPlane(e, id);
        this.session!.constructionPlane =
          facePlane?.plane ??
          (id === 'front' ? WORLD_XY_PLANE : id === 'right' ? WORLD_YZ_PLANE : WORLD_XZ_PLANE);
        this.session!.constructionPlaneId = facePlane?.id ?? id;
      }
      this.workspace.input.begin('tool');
      this.syncOrbitEnabled();
      tool.begin(this.pointerInput(e, id), this.session!.context());
      this.workspace.input.end('tool');
      this.syncOrbitEnabled();
      this.invalidate();
      return;
    }

    if (tool instanceof KnifeTool) {
      e.preventDefault();
      (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
      this.rebindActiveControls();
      tool.setViewportPick(this.resolveKnifePick(e, id));
      this.workspace.input.begin('tool');
      this.syncOrbitEnabled();
      tool.begin(this.pointerInput(e, id), this.session!.context());
      if (!tool.state.dragging) {
        this.workspace.input.end('tool');
        this.syncOrbitEnabled();
      }
      this.invalidate();
      return;
    }

    if (tool instanceof PushPullTool) {
      e.preventDefault();
      (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
      this.rebindActiveControls();
      if (tool.state.phase === 'hover') {
        tool.setViewportPick(this.resolveKnifePick(e, id));
      }
      const wasDragging = tool.state.phase === 'dragging';
      this.workspace.input.begin('tool');
      this.syncOrbitEnabled();
      tool.begin(this.pointerInput(e, id), this.session!.context());
      if (wasDragging && tool.state.phase === 'hover') {
        this.workspace.input.end('tool');
        this.interactionOverlay.updateTransform(null, '');
        this.syncOrbitEnabled();
      }
      this.interactionOverlay.updateTransform(e, tool.getStatusLine());
      this.invalidate();
      return;
    }

    if (tool instanceof LoopCutTool) {
      e.preventDefault();
      (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
      tool.setViewportPick(this.resolveLoopCutPick(e, id));
      const wasSliding = tool.state.phase === 'slide';
      tool.begin(this.pointerInput(e, id), this.session!.context());
      if (wasSliding && tool.state.phase === 'hover') {
        this.workspace.input.end('tool');
        this.session!.tools.setActive('select', this.session!.context());
        this.interactionOverlay.updateTransform(null, '');
        this.syncInputControls();
      }
      this.invalidate();
      return;
    }

    if (tool instanceof TileDrawTool) {
      e.preventDefault();
      (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
      this.rebindActiveControls();
      this.workspace.input.begin('tool');
      this.syncOrbitEnabled();
      tool.begin(this.pointerInput(e, id), this.session!.context());
      this.invalidate();
      return;
    }

    if (tool instanceof TerrainSculptTool) {
      const input = this.terrainPointerInput(e, id);
      if (!input.worldPosition) return;
      e.preventDefault();
      (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
      this.rebindActiveControls();
      this.workspace.input.begin('tool');
      this.syncOrbitEnabled();
      tool.begin(input, this.session!.context());
      this.updateTerrainBrushPreview(input, tool);
      this.interactionOverlay.updateTransform(e, tool.statusLine());
      this.invalidate();
      return;
    }

    if (tool instanceof MeshSculptTool) {
      const input = this.meshSculptPointerInput(e, id);
      e.preventDefault();
      (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
      this.rebindActiveControls();
      this.workspace.input.begin('tool');
      this.syncOrbitEnabled();
      tool.updatePreview(input, this.session!.context());
      tool.begin(input, this.session!.context());
      this.updateMeshSculptBrushPreview(tool);
      this.interactionOverlay.updateTransform(e, tool.statusLine());
      this.invalidate();
      return;
    }

    if (tool instanceof TerrainObjectTool) {
      const input = this.terrainPointerInput(e, id);
      if (!input.worldPosition) return;
      e.preventDefault();
      (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
      this.rebindActiveControls();
      this.workspace.input.begin('tool');
      this.syncOrbitEnabled();
      tool.begin(input, this.session!.context());
      this.updateTerrainObjectBrushPreview(input, tool);
      this.interactionOverlay.updateTransform(e, tool.statusLine());
      this.invalidate();
      return;
    }
    if (tool instanceof TerrainFeatureTool) {
      const input = this.terrainPointerInput(e, id);
      if (!input.worldPosition) return;
      e.preventDefault();
      (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
      this.rebindActiveControls();
      this.workspace.input.begin('tool');
      this.syncOrbitEnabled();
      tool.begin(input, this.session!.context());
      this.updateTerrainFeatureBrushPreview(input, tool);
      this.interactionOverlay.updateTransform(e, tool.statusLine());
      this.invalidate();
      return;
    }

    // UV Edit owns LMB in the 3D pane: always pick a face immediately.
    // Do this before gizmo and tweak-move handling so the previous face cannot trap input.
    if (this.isTextureFaceEditing()) {
      e.preventDefault();
      this.rebindActiveControls();
      this.pickSelection(e, id);
      this.syncGizmo();
      this.invalidate();
      return;
    }

    if (this.tryStartGizmoTransform(e, id)) {
      this.invalidate();
      return;
    }

    // Move tool: drag only via gizmo handles (axis = constrained, centre = view plane).
    // Select tool: press on *already-selected* component then drag to tweak-move.
    // Clicks on other faces/edges/verts must pick immediately (not get trapped by tweak).
    const gizmoMode = this.session?.transform.prefs.gizmoMode;
    const hit = this.resolvePointerHit(e, id);
    if (
      this.session &&
      gizmoMode === 'select' &&
      this.hitAllowsFreeMove(hit, e, id)
    ) {
      e.preventDefault();
      (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
      const hostRect = this.host.getBoundingClientRect();
      this.pendingTweak = {
        paneId: id,
        startX: e.clientX - hostRect.left,
        startY: e.clientY - hostRect.top,
        pointerId: e.pointerId,
      };
      return;
    }

    this.rebindActiveControls();
    this.pickSelection(e, id);
    this.syncGizmo();
    this.invalidate();
  };

  private onPointerUp = (e: PointerEvent): void => {
    if (!this.session || !this.workspace) return;
    if (this.viewportNavDrag && e.button === 0) {
      this.viewportNavDrag = null;
      if (this.renderer) this.renderer.domElement.style.cursor = '';
      this.invalidate();
      return;
    }
    if (this.curvePointDrag && e.button === 0) {
      this.finishCurvePointDrag();
      return;
    }
    if (this.draftCurvePointDrag && e.button === 0) {
      this.finishDraftCurvePointDrag();
      return;
    }
    if (this.seamStroke && e.button === 0) {
      this.finishSeamStroke();
      return;
    }
    if (this.pendingTweak && e.button === 0) {
      const paneId = this.pendingTweak.paneId;
      this.pendingTweak = null;
      // No drag → normal pick (replace / shift-add / alt-toggle).
      this.pickSelection(e, paneId);
      this.syncGizmo();
      this.invalidate();
      return;
    }
    if (this.marquee && e.button === 0) {
      this.finishMarquee(e);
      return;
    }
    const doodle = this.session.tools.getActive();
    if (
      doodle instanceof CreateDoodleTool &&
      doodle.inputMode === 'sketch' &&
      doodle.state.stage === 'drawing' &&
      !doodle.state.strokeLocked &&
      e.button === 0
    ) {
      const paneId = this.workspace.hoveredViewportId ?? this.workspace.activeViewportId;
      if (paneId) {
        doodle.update(this.pointerInput(e, paneId), this.session.context());
      }
      doodle.lockSketchStroke(this.session.context());
      this.workspace.input.end('tool');
      this.syncOrbitEnabled();
      this.invalidate();
      return;
    }
    if (doodle instanceof TileDrawTool && doodle.state.drawing && e.button === 0) {
      doodle.confirm(this.session.context());
      this.workspace.input.end('tool');
      this.syncOrbitEnabled();
      this.invalidate();
      return;
    }
    if (doodle instanceof TerrainSculptTool && doodle.dragging && e.button === 0) {
      doodle.endStroke(this.session.context());
      this.workspace.input.end('tool');
      this.interactionOverlay.updateTransform(null, '');
      this.syncOrbitEnabled();
      this.invalidate();
      return;
    }
    if (doodle instanceof MeshSculptTool && doodle.dragging && e.button === 0) {
      doodle.endStroke(this.session.context());
      this.workspace.input.end('tool');
      this.interactionOverlay.updateTransform(null, '');
      this.syncOrbitEnabled();
      this.invalidate();
      return;
    }
    if (doodle instanceof TerrainObjectTool && doodle.dragging && e.button === 0) {
      doodle.endStroke(this.session.context());
      this.workspace.input.end('tool');
      this.syncOrbitEnabled();
      this.invalidate();
      return;
    }
    if (doodle instanceof TerrainFeatureTool && doodle.dragging && e.button === 0) {
      doodle.endStroke(this.session);
      this.workspace.input.end('tool');
      this.interactionOverlay.updateTransform(null, '');
      this.syncOrbitEnabled();
      this.invalidate();
      return;
    }
    if (this.painting3D && e.button === 0) {
      this.flushPendingPaintMove();
      this.endPaint3D();
      return;
    }
    if (this.gizmoDragging && e.button === 0) {
      this.flushPendingTransformMove();
      this.session.transform.confirm();
      this.workspace.input.end('transform');
      this.gizmoDragging = false;
      this.pendingTransformMove = null;
      this.modifierPreview.root.visible = true;
      this.refreshModifierPreview();
      this.interactionOverlay.updateTransform(null, '');
      if (this.renderer) this.renderer.domElement.style.cursor = '';
      this.gizmo.setActiveHandle(null);
      this.syncOrbitEnabled();
      this.syncGizmo();
      this.invalidate();
    }
  };

  private onPointerCancel = (): void => {
    if (this.viewportNavDrag) {
      this.viewportNavDrag = null;
      if (this.renderer) this.renderer.domElement.style.cursor = '';
    }
    if (this.curvePointDrag) this.finishCurvePointDrag();
    if (this.draftCurvePointDrag) this.finishDraftCurvePointDrag();
    if (this.seamStroke) this.finishSeamStroke();
    if (this.painting3D) this.endPaint3D();
    const terrain = this.session?.tools.getActive();
    if (terrain instanceof TerrainSculptTool && terrain.dragging && this.session && this.workspace) {
      terrain.cancel(this.session.context());
      this.workspace.input.end('tool');
      this.interactionOverlay.updateTransform(null, '');
      this.syncOrbitEnabled();
    }
    if (terrain instanceof MeshSculptTool && terrain.dragging && this.session && this.workspace) {
      terrain.cancel(this.session.context());
      this.workspace.input.end('tool');
      this.interactionOverlay.updateTransform(null, '');
      this.syncOrbitEnabled();
    }
    if (terrain instanceof TerrainObjectTool && terrain.dragging && this.session && this.workspace) {
      terrain.cancel(this.session.context());
      this.workspace.input.end('tool');
      this.interactionOverlay.updateTransform(null, '');
      this.syncOrbitEnabled();
    }
    if (terrain instanceof TerrainFeatureTool && terrain.dragging && this.session && this.workspace) {
      terrain.cancel(this.session.context());
      this.workspace.input.end('tool');
      this.interactionOverlay.updateTransform(null, '');
      this.syncOrbitEnabled();
    }
    if (this.gizmoDragging && this.session && this.workspace) {
      this.pendingTransformMove = null;
      this.session.transform.cancel();
      this.workspace.input.end('transform');
      this.gizmoDragging = false;
      this.modifierPreview.root.visible = true;
      this.refreshModifierPreview();
      this.interactionOverlay.updateTransform(null, '');
      if (this.renderer) this.renderer.domElement.style.cursor = '';
      this.gizmo.setActiveHandle(null);
      this.syncOrbitEnabled();
      this.syncGizmo();
      this.invalidate();
    }
  };

  /** True when the pointer is on the active selection and it can be transformed. */
  private hitAllowsFreeMove(
    hit: PointerHit | null,
    e?: PointerEvent,
    paneId?: ViewId,
  ): boolean {
    if (!hit || !this.session) return false;
    if (!selectionHasTransformTarget(this.session.selection.state)) return false;
    const sel = this.session.selection.state;
    if (sel.mode === 'object') return sel.selectedObjectIds.has(hit.objectId);
    if (sel.activeObjectId !== hit.objectId) return false;

    // Component modes: only tweak when pressing an already-selected element.
    // Otherwise a click on a different face/edge/vert must re-pick, not drag.
    if (sel.mode === 'face') {
      return !!hit.faceId && sel.selectedFaceIds.has(hit.faceId);
    }

    if (!e || !paneId || !this.host) return false;
    const target = this.resolveEditTarget(e, paneId, hit);
    if (!target) return false;
    const xRay = sel.xRay;
    if (sel.mode === 'vertex') {
      const best = this.pickBestVertex(
        target.mesh,
        target.handle,
        target.pane,
        target.viewport,
        target.pointer,
        target.faceId,
        xRay,
      );
      return !!best && sel.selectedVertexIds.has(best);
    }
    if (sel.mode === 'edge') {
      const best = this.pickBestEdge(
        target.mesh,
        target.handle,
        target.pane,
        target.viewport,
        target.pointer,
        target.faceId,
        xRay,
      );
      return !!best && sel.selectedEdgeIds.has(best);
    }
    return false;
  }

  private beginFreeMove(e: PointerEvent, paneId: ViewId): void {
    if (!this.session || !this.workspace) return;
    this.pendingTweak = null;
    const started = this.session.transform.begin({
      type: 'translate',
      source: 'gizmo',
      viewportId: paneId,
      pointer: this.toPointerSample(e, paneId),
      constraint: 'none',
      camera: this.getCameraAxes(paneId),
    });
    if (!started) return;
    this.gizmoDragging = true;
    this.modifierPreview.root.visible = false;
    this.gizmo.setActiveHandle('move-view');
    this.workspace.input.begin('transform');
    this.syncOrbitEnabled();
    this.syncGizmo();
    this.invalidate();
  }

  private canPaint3D(): boolean {
    const tex = this.workspace?.texture;
    if (!this.workspace || !tex) return false;
    // Texture shell + 3D paint armed + not in UV-pointer edit mode.
    return (
      this.workspace.shellMode === 'texture' &&
      tex.paintMode3D &&
      !tex.uvPointerMode
    );
  }

  private paintSeamAtPointer(e: PointerEvent, paneId: ViewId): void {
    if (!this.session || !this.workspace || !this.seamStroke) return;
    const hit = this.resolvePointerHit(e, paneId);
    const target = this.resolveEditTarget(e, paneId, hit);
    if (!target) return;
    const edgeId = this.pickBestEdge(
      target.mesh,
      target.handle,
      target.pane,
      target.viewport,
      target.pointer,
      target.faceId,
      false,
    );
    if (!edgeId) return;
    const edge = target.mesh.edges.get(edgeId);
    if (!edge) return;
    const after = this.workspace.texture.seamPaintMode === 'mark';
    const key = `${target.mesh.id}:${edgeId}`;
    if (!this.seamStroke.has(key)) {
      this.seamStroke.set(key, { mesh: target.mesh, edgeId, before: edge.seam, after });
    } else {
      this.seamStroke.get(key)!.after = after;
    }
    if (edge.seam !== after) markUvSeams(target.mesh, [edgeId], after);
    this.session.selection.setMode('edge');
    this.session.selection.selectObjects([target.objectId], 'replace');
    this.session.selection.selectEdges([edgeId], 'replace');
    this.session.requestRedraw();
    this.syncOverlays();
    this.invalidate();
  }

  private finishSeamStroke(): void {
    if (!this.session || !this.workspace || !this.seamStroke) return;
    const changes = [...this.seamStroke.values()].filter((item) => item.before !== item.after);
    this.seamStroke = null;
    this.workspace.input.end('tool');
    this.syncOrbitEnabled();
    if (changes.length) {
      let applied = true;
      this.session.history.execute({
        name: changes[0]!.after ? 'Paint UV Seams' : 'Erase UV Seams',
        execute: () => {
          if (applied) return;
          for (const item of changes) markUvSeams(item.mesh, [item.edgeId], item.after);
          applied = true;
          this.session!.requestRedraw();
        },
        undo: () => {
          for (const item of changes) markUvSeams(item.mesh, [item.edgeId], item.before);
          applied = false;
          this.session!.requestRedraw();
        },
      });
    }
    this.session.requestRedraw();
    this.invalidate();
  }

  private isTextureFaceEditing(): boolean {
    return this.workspace?.shellMode === 'texture' && !!this.workspace.texture.uvPointerMode;
  }

  private beginMarquee(e: PointerEvent, paneId: ViewId): void {
    if (!this.host || !this.workspace) return;
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    const hostRect = this.host.getBoundingClientRect();
    const x = e.clientX - hostRect.left;
    const y = e.clientY - hostRect.top;
    this.marquee = {
      paneId,
      startX: x,
      startY: y,
      currentX: x,
      currentY: y,
      shiftKey: e.shiftKey,
    };
    this.session?.selection.clearHover();
    this.workspace.input.begin('tool');
    this.syncOrbitEnabled();
    this.interactionOverlay.updateMarquee(this.marquee);
  }

  private clearMarquee(endInput: boolean): void {
    this.marquee = null;
    this.interactionOverlay.updateMarquee(this.marquee);
    if (endInput) this.workspace?.input.end('tool');
    this.syncOrbitEnabled();
  }

  private finishMarquee(e: PointerEvent): void {
    if (!this.session || !this.workspace || !this.marquee) return;
    const state = this.marquee;
    this.clearMarquee(true);

    const drag = Math.hypot(state.currentX - state.startX, state.currentY - state.startY);
    if (drag < MARQUEE_MIN_DRAG_PX) {
      // Tiny drag → single pick under cursor (Alt toggles).
      this.pickSelection(e, state.paneId);
      this.syncGizmo();
      this.invalidate();
      return;
    }

    const rect = normalizeScreenRect(state.startX, state.startY, state.currentX, state.currentY);
    const mode = marqueeModeFromDrag(state.startX, state.currentX);
    const op = state.shiftKey ? 'add' : 'replace';
    this.session.selectionSource = 'viewport';
    if (this.workspace.shellMode === 'texture' && this.session.selection.state.mode !== 'face') {
      this.session.selection.setMode('face');
    }
    this.applyMarqueeSelection(state.paneId, rect, mode, op);
    this.syncGizmo();
    this.session.requestRedraw();
    this.invalidate();
  }

  private applyMarqueeSelection(
    paneId: ViewId,
    rect: ScreenRect,
    mode: MarqueeMode,
    op: 'add' | 'replace',
  ): void {
    if (!this.session) return;
    const pane = this.panes.get(paneId);
    const viewport = this.lastRects.find((r) => r.id === paneId);
    if (!pane || !viewport) return;

    const selMode =
      this.workspace?.shellMode === 'texture' ? 'face' : this.session.selection.state.mode;

    if (selMode === 'object') {
      const ids: ObjectId[] = [];
      const focusId = this.session.focusGroupId;
      for (const [, handle] of this.handles) {
        const objectId = handle.objectId;
        if (!isObjectInFocusScope(this.session.document, objectId, focusId)) continue;
        const object = this.session.document.objects.get(objectId);
        const mesh = object?.meshId
          ? this.session.document.meshes.get(object.meshId)
          : this.session.document.meshes.get(handle.meshId);
        if (!mesh) continue;
        const pts: { x: number; y: number }[] = [];
        for (const vid of mesh.vertices.keys()) {
          const p = projectVertex(mesh, handle, pane.camera, viewport, vid);
          if (p) pts.push(p);
        }
        if (pointsSatisfyMarquee(pts, rect, mode) && !ids.includes(objectId)) ids.push(objectId);
      }
      this.session.selection.selectObjects(ids, op);
      return;
    }

    // Component modes: prefer active object, else every mesh under the box.
    let targets = [...this.handles.entries()];
    const activeId = this.session.selection.state.activeObjectId;
    if (activeId && this.handles.has(activeId)) {
      targets = targets.filter(([id]) => id === activeId);
    }

    const faceIds: FaceId[] = [];
    const vertIds: VertexId[] = [];
    const edgeIds: EdgeId[] = [];
    let targetObjectId: ObjectId | null = activeId;

    for (const [objectId, handle] of targets) {
      const object = this.session.document.objects.get(objectId);
      const mesh = object?.meshId ? this.session.document.meshes.get(object.meshId) : null;
      if (!mesh) continue;

      if (selMode === 'vertex') {
        for (const vid of mesh.vertices.keys()) {
          const p = projectVertex(mesh, handle, pane.camera, viewport, vid);
          if (p && pointInRect(p.x, p.y, rect)) {
            vertIds.push(vid);
            targetObjectId = objectId;
          }
        }
      } else if (selMode === 'edge') {
        for (const edge of mesh.edges.values()) {
          const pair = getEdgeVertices(mesh, edge.id);
          if (!pair) continue;
          const pa = projectVertex(mesh, handle, pane.camera, viewport, pair[0]);
          const pb = projectVertex(mesh, handle, pane.camera, viewport, pair[1]);
          if (!pa || !pb) continue;
          const hit =
            mode === 'window'
              ? pointInRect(pa.x, pa.y, rect) && pointInRect(pb.x, pb.y, rect)
              : segmentHitsRect(pa.x, pa.y, pb.x, pb.y, rect);
          if (hit) {
            edgeIds.push(edge.id);
            targetObjectId = objectId;
          }
        }
      } else {
        for (const faceId of mesh.faces.keys()) {
          const vids = faceVertexIds(mesh, faceId);
          const pts: { x: number; y: number }[] = [];
          for (const vid of vids) {
            const p = projectVertex(mesh, handle, pane.camera, viewport, vid);
            if (p) pts.push(p);
          }
          if (!pts.length) continue;
          let hit = pointsSatisfyMarquee(pts, rect, mode);
          if (!hit && mode === 'crossing') {
            for (let i = 0; i < pts.length; i++) {
              const a = pts[i]!;
              const b = pts[(i + 1) % pts.length]!;
              if (segmentHitsRect(a.x, a.y, b.x, b.y, rect)) {
                hit = true;
                break;
              }
            }
          }
          if (hit) {
            faceIds.push(faceId);
            targetObjectId = objectId;
          }
        }
      }
    }

    if (targetObjectId) this.session.selection.selectObjects([targetObjectId], 'replace');
    if (selMode === 'vertex') this.session.selection.selectVertices(vertIds, op);
    else if (selMode === 'edge') this.session.selection.selectEdges(edgeIds, op);
    else this.session.selection.selectFaces(faceIds, op);
  }

  private endPaint3D(): void {
    if (!this.session || !this.workspace) return;
    this.paintStroke.commit(this.session.history, () => this.session!.requestRedraw());
    this.painting3D = false;
    this.lastPaintPixel = null;
    this.workspace.input.end('tool');
    this.syncOrbitEnabled();
    this.session.requestRedraw();
    this.invalidate();
  }

  private paintAtPointer(e: PointerEvent, paneId: ViewId, isDown: boolean): void {
    if (!this.session || !this.workspace) return;
    const tex = this.workspace.texture;
    const hit = this.resolvePaintHit(e, paneId);
    if (!hit) return;

    const tool = tex.pixelTool;
    const colour = brushColourForTool(tool, tex.foreground, tex.background, e.altKey);
    const shape = tex.brushShape;

    if (tool === 'eyedropper') {
      const p = uvToPixel(hit.image, hit.uv);
      const sampled = getPixel(hit.image, p.x, p.y);
      if (sampled) {
        this.workspace.patchTexture({
          foreground: [...sampled] as [number, number, number, number],
          pixelTool: 'pencil',
        });
      }
      if (isDown) this.endPaint3D();
      return;
    }

    if (tool === 'fill') {
      const p = uvToPixel(hit.image, hit.uv);
      const before = new Uint8ClampedArray(hit.image.pixels);
      const count = floodFill(hit.image, p.x, p.y, colour);
      if (count) {
        const after = new Uint8ClampedArray(hit.image.pixels);
        let applied = true;
        const image = hit.image;
        this.session.history.execute({
          name: 'Fill Pixels',
          execute: () => {
            if (applied) return;
            image.pixels.set(after);
            image.revision += 1;
            applied = true;
            this.session!.requestRedraw();
          },
          undo: () => {
            image.pixels.set(before);
            image.revision += 1;
            applied = false;
            this.session!.requestRedraw();
          },
        });
        this.session.requestRedraw();
      }
      if (isDown) this.endPaint3D();
      return;
    }

    if (!this.paintStroke.isActive) this.paintStroke.begin(hit.image);
    // Switch image mid-stroke: commit previous and start new.
    if (this.lastPaintPixel && this.lastPaintPixel.imageId !== hit.image.id) {
      this.paintStroke.commit(this.session.history, () => this.session!.requestRedraw());
      this.paintStroke.begin(hit.image);
      this.lastPaintPixel = null;
    }

    const pixel = uvToPixel(hit.image, hit.uv);
    if (this.lastPaintPixel && this.lastPaintPixel.imageId === hit.image.id) {
      stampBrushLine(
        hit.image,
        this.lastPaintPixel.x,
        this.lastPaintPixel.y,
        pixel.x,
        pixel.y,
        tex.brushSize,
        colour,
        this.paintStroke,
        shape,
      );
    } else {
      stampBrushUv(hit.image, hit.uv, tex.brushSize, colour, this.paintStroke, shape);
    }
    this.lastPaintPixel = { x: pixel.x, y: pixel.y, imageId: hit.image.id };
    this.session.requestRedraw();
    this.invalidate();
  }

  private resolvePaintHit(e: PointerEvent, paneId: ViewId) {
    if (!this.session || !this.host) return null;
    const pane = this.panes.get(paneId);
    const viewport = this.lastRects.find((r) => r.id === paneId);
    if (!pane || !viewport) return null;

    const hostRect = this.host.getBoundingClientRect();
    const localX = e.clientX - hostRect.left - viewport.x;
    const localY = e.clientY - hostRect.top - viewport.y;
    const ndc = new Vector2(
      (localX / Math.max(1, viewport.width)) * 2 - 1,
      -(localY / Math.max(1, viewport.height)) * 2 + 1,
    );
    pane.camera.updateMatrixWorld(true);
    const raycaster = new Raycaster();
    raycaster.setFromCamera(ndc, pane.camera);
    const intersection = raycaster.intersectObjects(
      [...this.handles.values()].map((h) => h.mesh),
      false,
    )[0];
    if (!intersection) return null;

    const objectId = intersection.object.userData.objectId as ObjectId;
    const handle = this.handles.get(objectId);
    if (!handle) return null;
    const object = this.session.document.objects.get(objectId);
    const mesh = object?.meshId ? this.session.document.meshes.get(object.meshId) : null;
    if (!mesh) return null;

    const bary = intersection.barycoord
      ? { x: intersection.barycoord.x, y: intersection.barycoord.y, z: intersection.barycoord.z }
      : null;
    const threeUv = intersection.uv ? { x: intersection.uv.x, y: intersection.uv.y } : null;
    const uvHit = uvFromTriangleHit(
      mesh,
      handle.renderData.triangleMap,
      intersection.faceIndex ?? undefined,
      bary,
      threeUv,
    );
    if (!uvHit) return null;
    const image = resolveImageForFace(this.session.document, objectId, uvHit.faceId);
    if (!image) return null;
    return { objectId, mesh, image, uv: uvHit.uv, faceId: uvHit.faceId };
  }

  private pointerInput(e: PointerEvent, paneId: ViewId): ToolPointerInput {
    const pane = this.panes.get(paneId)!;
    const viewport = this.lastRects.find((r) => r.id === paneId)!;
    const hostRect = this.host!.getBoundingClientRect();
    const localX = e.clientX - hostRect.left - viewport.x;
    const localY = e.clientY - hostRect.top - viewport.y;
    pane.camera.updateMatrixWorld(true);
    const raycaster = new Raycaster();
    raycaster.setFromCamera(
      new Vector2(
        (localX / Math.max(1, viewport.width)) * 2 - 1,
        -(localY / Math.max(1, viewport.height)) * 2 + 1,
      ),
      pane.camera,
    );

    let worldUnitsPerPixel = 0.01;
    if (pane.camera instanceof OrthographicCamera) {
      const viewH = (pane.camera.top - pane.camera.bottom) / Math.max(1e-6, pane.camera.zoom);
      worldUnitsPerPixel = viewH / Math.max(1, viewport.height);
    } else if (pane.camera instanceof PerspectiveCamera) {
      const dist = pane.camera.position.length();
      const viewH = 2 * Math.tan((pane.camera.fov * Math.PI) / 360) * Math.max(0.5, dist);
      worldUnitsPerPixel = viewH / Math.max(1, viewport.height);
    }

    return {
      button: (e.button === 0 ? 'left' : e.button === 1 ? 'middle' : 'right') as
        | 'left'
        | 'middle'
        | 'right',
      screenX: e.clientX,
      screenY: e.clientY,
      worldPosition: null,
      rayOrigin: v3(raycaster.ray.origin.x, raycaster.ray.origin.y, raycaster.ray.origin.z),
      rayDirection: v3(
        raycaster.ray.direction.x,
        raycaster.ray.direction.y,
        raycaster.ray.direction.z,
      ),
      shiftKey: e.shiftKey,
      ctrlKey: e.ctrlKey,
      altKey: e.altKey,
      pressure:
        e.pointerType === 'pen'
          ? Math.max(0.05, Math.min(1, e.pressure || 0.5))
          : 1,
      worldUnitsPerPixel,
    };
  }

  private terrainPointerInput(e: PointerEvent, paneId: ViewId) {
    const input = this.pointerInput(e, paneId);
    if (!this.session) return input;
    const activeTool = this.session.tools.getActive();
    const objectId =
      activeTool instanceof TerrainObjectTool && activeTool.terrainObjectId
        ? activeTool.terrainObjectId
        : activeTool instanceof TerrainFeatureTool && activeTool.terrainObjectId
          ? activeTool.terrainObjectId
        : this.session.selection.state.activeObjectId;
    const object = objectId ? this.session.document.objects.get(objectId) : null;
    if (!object || object.metadata.terrain !== 'true') return input;
    const handle = this.handles.get(object.id);
    if (!handle) return input;
    const raycaster = new Raycaster(
      new Vector3(input.rayOrigin.x, input.rayOrigin.y, input.rayOrigin.z),
      new Vector3(input.rayDirection.x, input.rayDirection.y, input.rayDirection.z),
    );
    if (
      activeTool instanceof TerrainObjectTool &&
      activeTool.mode === 'place' &&
      activeTool.stackModels
    ) {
      const placedIds = new Set(
        terrainPlacedObjects(this.session.document, object.id).map((placed) => placed.id),
      );
      const stackTargets: Mesh[] = [];
      const objectIdByMesh = new Map<Mesh, ObjectId>();
      for (const [handleKey, candidate] of this.handles) {
        const candidateObjectId = handleKey.split('::')[0] as ObjectId;
        if (!placedIds.has(candidateObjectId)) continue;
        const placed = this.session.document.objects.get(candidateObjectId);
        if (!placed?.visible) continue;
        stackTargets.push(candidate.mesh);
        objectIdByMesh.set(candidate.mesh, candidateObjectId);
      }
      this.scene?.updateMatrixWorld(true);
      const stackedHit = raycaster.intersectObjects(stackTargets, false)[0];
      if (stackedHit) {
        return {
          ...input,
          worldPosition: v3(stackedHit.point.x, stackedHit.point.y, stackedHit.point.z),
          surfaceObjectId: objectIdByMesh.get(stackedHit.object as Mesh) ?? null,
        };
      }
    }
    const hit = raycaster.intersectObject(handle.mesh, false)[0];
    return {
      ...input,
      worldPosition: hit ? v3(hit.point.x, hit.point.y, hit.point.z) : null,
      surfaceObjectId: hit ? object.id : null,
    };
  }

  private meshSculptPointerInput(e: PointerEvent, paneId: ViewId) {
    const input = this.pointerInput(e, paneId);
    if (!this.session) return input;
    const hit = raycastSculptTarget(
      this.session.document,
      this.session.selection.state.activeObjectId,
      input.rayOrigin,
      input.rayDirection,
    );
    return {
      ...input,
      worldPosition: hit?.worldPosition ?? null,
    };
  }

  private updateMeshSculptBrushPreview(tool: MeshSculptTool): void {
    const hit = tool.previewHit;
    if (!hit) {
      this.terrainBrushPreview.visible = false;
      this.sculptHardnessPreview.visible = false;
      return;
    }
    this.terrainBrushPreview.visible = true;
    const offset = 0.01;
    this.terrainBrushPreview.position.set(
      hit.position.x + hit.normal.x * offset,
      hit.position.y + hit.normal.y * offset,
      hit.position.z + hit.normal.z * offset,
    );
    this.terrainBrushPreview.scale.setScalar(tool.radius);
    const up = new Vector3(0, 1, 0);
    const normal = new Vector3(hit.normal.x, hit.normal.y, hit.normal.z);
    this.terrainBrushPreview.quaternion.setFromUnitVectors(up, normal.normalize());
    this.sculptHardnessPreview.visible = true;
    this.sculptHardnessPreview.position.copy(this.terrainBrushPreview.position);
    this.sculptHardnessPreview.quaternion.copy(this.terrainBrushPreview.quaternion);
    this.sculptHardnessPreview.scale.setScalar(
      tool.radius * Math.max(0.04, tool.hardness),
    );
    const material = this.terrainBrushPreview.material as LineBasicMaterial;
    material.color.setHex(
      tool.mode === 'grab' ? 0x6eb5ff
        : tool.mode === 'smooth' ? 0x74d68b
          : tool.mode === 'flatten' ? 0xffc45c
            : tool.mode === 'pinch' ? 0xff7eb6
              : tool.mode === 'crease' ? 0xd9a066
                : tool.mode === 'noise' ? 0xb18cff
                  : 0xff8c28,
    );
    (this.sculptHardnessPreview.material as LineBasicMaterial).color.copy(material.color);
  }

  private updateTerrainBrushPreview(
    input: ReturnType<ViewportEngine['pointerInput']>,
    tool: TerrainSculptTool,
  ): void {
    if (!input.worldPosition) {
      this.terrainBrushPreview.visible = false;
      return;
    }
    this.terrainBrushPreview.visible = true;
    this.terrainBrushPreview.position.set(
      input.worldPosition.x,
      input.worldPosition.y + 0.025,
      input.worldPosition.z,
    );
    this.terrainBrushPreview.scale.setScalar(tool.radius);
    const material = this.terrainBrushPreview.material as LineBasicMaterial;
    material.color.setHex(
      tool.mode === 'lower' ? 0x4b9fff
        : tool.mode === 'smooth' ? 0x74d68b
          : tool.mode === 'flatten' ? 0xffc45c
            : tool.mode === 'noise' ? 0xb18cff
              : 0xff8c28,
    );
  }

  private updateTerrainObjectBrushPreview(
    input: ToolPointerInput,
    tool: TerrainObjectTool,
  ): void {
    if (!input.worldPosition) {
      this.terrainBrushPreview.visible = false;
      if (this.terrainObjectGhost) this.terrainObjectGhost.visible = false;
      return;
    }
    this.terrainBrushPreview.visible = true;
    this.terrainBrushPreview.position.set(
      input.worldPosition.x,
      input.worldPosition.y + 0.03,
      input.worldPosition.z,
    );
    this.terrainBrushPreview.scale.setScalar(tool.mode === 'place' ? 0.45 : tool.radius);
    const material = this.terrainBrushPreview.material as LineBasicMaterial;
    material.color.setHex(
      tool.mode === 'erase'
        ? 0xff5c58
        : tool.mode === 'scatter'
          ? 0x79d26b
          : 0xffa33b,
    );
    this.syncTerrainObjectGhost(input, tool);
  }

  private syncTerrainObjectGhost(input: ToolPointerInput, tool: TerrainObjectTool): void {
    if (
      !this.scene ||
      !this.session ||
      !input.worldPosition ||
      !tool.sourceModelDocumentId ||
      tool.mode === 'erase'
    ) {
      if (this.terrainObjectGhost) this.terrainObjectGhost.visible = false;
      return;
    }
    const model = this.session.project.documents.get(tool.sourceModelDocumentId);
    if (!model || model.kind !== 'model') {
      if (this.terrainObjectGhost) this.terrainObjectGhost.visible = false;
      return;
    }
    const modelView = buildModelDocumentView(this.session.project, model.id);
    const parts: {
      objectId: ObjectId;
      mesh: EditableMesh;
      matrix: ReturnType<typeof getObjectWorldMatrix>;
    }[] = [];
    const walk = (objectId: ObjectId, ancestorsVisible: boolean) => {
      const object = model.objects.get(objectId);
      if (!object) return;
      const visible = ancestorsVisible && object.visible;
      if (visible && object.meshId) {
        const mesh = this.session!.project.meshes.get(object.meshId);
        if (mesh) {
          parts.push({
            objectId,
            mesh,
            matrix: getObjectWorldMatrix(modelView, objectId),
          });
        }
      }
      for (const childId of object.childIds) walk(childId, visible);
    };
    const roots = model.rootObjectIds.length
      ? model.rootObjectIds
      : [...model.objects.values()].filter((object) => !object.parentId).map((object) => object.id);
    for (const rootId of roots) walk(rootId, true);
    if (!parts.length) {
      if (this.terrainObjectGhost) this.terrainObjectGhost.visible = false;
      return;
    }
    const key = [
      tool.sourceModelDocumentId,
      ...parts.map(({ objectId, mesh, matrix }) =>
        `${objectId}:${mesh.id}:${mesh.topologyVersion}:${mesh.geometryVersion}:${matrix.elements.join(',')}`),
    ].join('|');
    if (!this.terrainObjectGhost || this.terrainObjectGhostKey !== key) {
      this.clearTerrainObjectGhost();
      const material = new MeshBasicMaterial({
        color: 0xffa33b,
        transparent: true,
        opacity: 0.34,
        depthWrite: false,
        wireframe: false,
        side: DoubleSide,
      });
      this.terrainObjectGhost = new Group();
      this.terrainObjectGhost.name = 'Terrain Model Ghost';
      this.terrainObjectGhost.renderOrder = 115;
      this.terrainObjectGhost.userData.nonSelectable = true;
      for (const part of parts) {
        const renderData = editableMeshToRenderData(part.mesh);
        const child = new Mesh(renderData.geometry, material);
        child.name = `Terrain Model Ghost · ${part.objectId}`;
        child.matrixAutoUpdate = false;
        child.matrix.copy(part.matrix);
        child.renderOrder = 115;
        child.userData.nonSelectable = true;
        this.terrainObjectGhost.add(child);
      }
      this.scene.add(this.terrainObjectGhost);
      this.terrainObjectGhostKey = key;
    }
    const ghost = this.terrainObjectGhost;
    ghost.visible = true;
    ghost.position.set(
      input.worldPosition.x,
      input.worldPosition.y +
        tool.sourceModelBaseOffset * tool.placementScale +
        tool.groundClearance +
        tool.heightOffset,
      input.worldPosition.z,
    );
    ghost.rotation.set(0, tool.placementYaw, 0);
    ghost.scale.setScalar(tool.placementScale);
  }

  private clearTerrainObjectGhost(): void {
    if (!this.terrainObjectGhost) return;
    this.terrainObjectGhost.parent?.remove(this.terrainObjectGhost);
    const materials = new Set<Material>();
    this.terrainObjectGhost.traverse((child) => {
      if (!(child instanceof Mesh)) return;
      child.geometry.dispose();
      const material = child.material;
      if (Array.isArray(material)) material.forEach((item) => materials.add(item));
      else materials.add(material);
    });
    materials.forEach((material) => material.dispose());
    this.terrainObjectGhost = null;
    this.terrainObjectGhostKey = '';
  }

  private updateTerrainFeatureBrushPreview(
    input: ToolPointerInput,
    tool: TerrainFeatureTool,
  ): void {
    if (!input.worldPosition) {
      this.terrainBrushPreview.visible = false;
      return;
    }
    this.terrainBrushPreview.visible = true;
    this.terrainBrushPreview.position.set(
      input.worldPosition.x,
      input.worldPosition.y + tool.surfaceOffset,
      input.worldPosition.z,
    );
    this.terrainBrushPreview.scale.setScalar(Math.max(0.1, tool.width / 2));
    const material = this.terrainBrushPreview.material as LineBasicMaterial;
    material.color.setHex(tool.kind === 'river' ? 0x55bde9 : 0xd39a5a);
  }

  private faceConstructionPlane(e: PointerEvent, paneId: ViewId): { plane: { origin: { x:number;y:number;z:number }; normal: { x:number;y:number;z:number }; xAxis: { x:number;y:number;z:number }; yAxis: { x:number;y:number;z:number } }; id: string } | null {
    if (!this.host) return null;
    const pane = this.panes.get(paneId);
    const viewport = this.lastRects.find((r) => r.id === paneId);
    if (!pane || !viewport) return null;
    const host = this.host.getBoundingClientRect();
    const x = e.clientX - host.left - viewport.x;
    const y = e.clientY - host.top - viewport.y;
    pane.camera.updateMatrixWorld(true);
    const ray = new Raycaster();
    ray.setFromCamera(
      new Vector2(
        (x / Math.max(1, viewport.width)) * 2 - 1,
        (-y / Math.max(1, viewport.height)) * 2 + 1,
      ),
      pane.camera,
    );
    const hit = ray.intersectObjects(
      [...this.handles.values()].map((h) => h.mesh),
      false,
    )[0];
    if (!hit?.face) return null;
    const objectId = hit.object.userData.objectId as string;
    const handle = this.handles.get(objectId);
    if (!handle) return null;
    const faceId = pickLogicalFace(handle.renderData.triangleMap, hit.faceIndex ?? undefined);
    const n = hit.face.normal.clone().transformDirection(handle.group.matrixWorld).normalize();
    const reference = Math.abs(n.y) < 0.9 ? new Vector3(0, 1, 0) : new Vector3(1, 0, 0);
    const u = reference.clone().cross(n).normalize();
    const v = n.clone().cross(u).normalize();
    return {
      plane: {
        origin: v3(hit.point.x, hit.point.y, hit.point.z),
        normal: v3(n.x, n.y, n.z),
        xAxis: v3(u.x, u.y, u.z),
        yAxis: v3(v.x, v.y, v.z),
      },
      id: `face:${faceId ?? 'surface'}`,
    };
  }

  private pickSelection(e: PointerEvent, paneId: ViewId): void {
    if (!this.session) return;
    this.session.selectionSource = 'viewport';
    const hit = this.resolvePointerHit(e, paneId);
    // Shift adds · Alt toggles · Ctrl+drag is marquee (handled elsewhere).
    const textureFacePick = this.workspace?.shellMode === 'texture';
    const op = e.shiftKey ? 'add' : e.altKey ? 'toggle' : 'replace';
    if (textureFacePick && this.session.selection.state.mode !== 'face') {
      this.session.selection.setMode('face');
    }
    const mode = this.session.selection.state.mode;
    const xRay = this.session.selection.state.xRay;

    if (mode === 'object' && !textureFacePick) {
      if (!hit) {
        if (op === 'replace') this.session.selection.clear();
        this.lastObjectPick = null;
      } else {
        let targetId = hit.objectId;
        const now = performance.now();
        const isDouble =
          !!this.lastObjectPick &&
          this.lastObjectPick.objectId === hit.objectId &&
          now - this.lastObjectPick.time < 400;
        if (isDouble && op === 'replace') {
          if (enterGroupFocusFromPick(this.session, hit.objectId)) {
            this.lastObjectPick = null;
            this.session.requestRedraw();
            return;
          }
        }
        if (
          this.session.focusGroupId &&
          !isObjectInFocusScope(this.session.document, targetId, this.session.focusGroupId)
        ) {
          if (op === 'replace') this.session.selection.clear();
          this.lastObjectPick = null;
          this.session.requestRedraw();
          return;
        }
        this.lastObjectPick = { objectId: hit.objectId, time: now };
        this.session.selection.selectObjects([targetId], op);
      }
      this.session.requestRedraw();
      return;
    }

    const target = this.resolveEditTarget(e, paneId, hit);
    if (!target) {
      if (op === 'replace') {
        // Keep active object; only clear component selection.
        this.session.selection.selectVertices([], 'replace');
        this.session.selection.selectEdges([], 'replace');
        this.session.selection.selectFaces([], 'replace');
      }
      this.session.requestRedraw();
      return;
    }

    this.session.selection.selectObjects([target.objectId], 'replace');

    if (mode === 'face' || textureFacePick) {
      if (target.faceId) this.session.selection.selectFaces([target.faceId], op);
      else if (op === 'replace') this.session.selection.selectFaces([], 'replace');
    } else if (mode === 'vertex') {
      const best = this.pickBestVertex(
        target.mesh,
        target.handle,
        target.pane,
        target.viewport,
        target.pointer,
        target.faceId,
        xRay,
      );
      if (best) this.session.selection.selectVertices([best], op);
      else if (op === 'replace') this.session.selection.selectVertices([], 'replace');
    } else if (mode === 'edge') {
      const best = this.pickBestEdge(
        target.mesh,
        target.handle,
        target.pane,
        target.viewport,
        target.pointer,
        target.faceId,
        xRay,
      );
      if (best) this.session.selection.selectEdges([best], op);
      else if (op === 'replace') this.session.selection.selectEdges([], 'replace');
    }
    this.session.requestRedraw();
  }

  private updateHover(e: PointerEvent, paneId: ViewId): void {
    if (!this.session || this.interacting) return;
    const selection = this.session.selection;
    const textureFacePick = this.workspace?.shellMode === 'texture';
    const mode = textureFacePick ? 'face' : selection.state.mode;
    const hit = this.resolvePointerHit(e, paneId);

    if (mode === 'object') {
      selection.setHoverObject(hit?.objectId ?? null);
    } else {
      const target = this.resolveEditTarget(e, paneId, hit);
      if (!target) {
        selection.clearHover();
      } else if (mode === 'face') {
        selection.setHoverFace(target.faceId);
      } else if (mode === 'vertex') {
        selection.setHoverVertex(
          this.pickBestVertex(
            target.mesh,
            target.handle,
            target.pane,
            target.viewport,
            target.pointer,
            target.faceId,
            selection.state.xRay,
          ),
        );
      } else {
        selection.setHoverEdge(
          this.pickBestEdge(
            target.mesh,
            target.handle,
            target.pane,
            target.viewport,
            target.pointer,
            target.faceId,
            selection.state.xRay,
          ),
        );
      }
    }

    const s = selection.state;
    const key = `${s.mode}|${s.hoveredObjectId}|${s.hoveredVertexId}|${s.hoveredEdgeId}|${s.hoveredFaceId}|${s.xRay}`;
    if (key === this.lastHoverKey) return;
    this.lastHoverKey = key;
    this.syncOverlays();
    this.invalidate();
    this.session.requestRedraw();
  }

  /** Prefer ray hit; fall back to active edit object for screen-space vertex/edge picks (incl. X-ray). */
  private resolveEditTarget(
    e: PointerEvent,
    paneId: ViewId,
    hit: PointerHit | null,
  ): PointerHit | null {
    if (hit) {
      const active = this.session?.selection.state.activeObjectId;
      if (!active || active === hit.objectId) return hit;
      // Clicking another object in component mode switches the edit target.
      return hit;
    }

    const activeId = this.session?.selection.state.activeObjectId;
    if (!activeId || !this.session || !this.host) return null;
    const pane = this.panes.get(paneId);
    const viewport = this.lastRects.find((r) => r.id === paneId);
    const handle = this.handles.get(activeId);
    const object = this.session.document.objects.get(activeId);
    const mesh = object?.meshId ? this.session.document.meshes.get(object.meshId) : null;
    if (!pane || !viewport || !handle || !mesh) return null;
    const hostRect = this.host.getBoundingClientRect();
    return {
      objectId: activeId,
      handle,
      mesh,
      faceId: null,
      pane,
      viewport,
      pointer: { x: e.clientX - hostRect.left, y: e.clientY - hostRect.top },
    };
  }

  private resolvePointerHit(e: PointerEvent, paneId: ViewId): PointerHit | null {
    if (!this.session || !this.host) return null;
    const pane = this.panes.get(paneId);
    const viewport = this.lastRects.find((r) => r.id === paneId);
    if (!pane || !viewport) return null;

    const hostRect = this.host.getBoundingClientRect();
    const localX = e.clientX - hostRect.left - viewport.x;
    const localY = e.clientY - hostRect.top - viewport.y;
    const ndc = new Vector2(
      (localX / Math.max(1, viewport.width)) * 2 - 1,
      -(localY / Math.max(1, viewport.height)) * 2 + 1,
    );
    // lockOrthoPane / OrbitControls may dirty local transform without a render pass.
    pane.camera.updateMatrixWorld(true);
    const raycaster = new Raycaster();
    raycaster.setFromCamera(ndc, pane.camera);
    const focusId = this.session.focusGroupId;
    const pickHandles = [...this.handles.entries()].filter(([objectId]) =>
      isObjectInFocusScope(this.session!.document, objectId, focusId),
    );
    const meshes = pickHandles.map(([, h]) => h.mesh);
    const allowBackfaces =
      this.session.selection.state.mode === 'face' &&
      this.session.selection.state.selectBackfaces;
    const materials = allowBackfaces
      ? pickHandles.flatMap(([, handle]) => handle.materials)
      : [];
    const originalSides = materials.map((material) => material.side);
    if (allowBackfaces) materials.forEach((material) => (material.side = DoubleSide));
    let intersection;
    try {
      intersection = raycaster.intersectObjects(meshes, false)[0];
    } finally {
      materials.forEach((material, index) => (material.side = originalSides[index]!));
    }
    if (!intersection) return null;

    const objectId = intersection.object.userData.objectId as ObjectId;
    const handle = this.handles.get(objectId);
    if (!handle) return null;
    const object = this.session.document.objects.get(objectId);
    const mesh = object?.meshId ? this.session.document.meshes.get(object.meshId) ?? null : null;
    if (!mesh) return null;
    const faceId = pickLogicalFace(handle.renderData.triangleMap, intersection.faceIndex ?? undefined);
    return {
      objectId,
      handle,
      mesh,
      faceId,
      pane,
      viewport,
      pointer: { x: e.clientX - hostRect.left, y: e.clientY - hostRect.top },
    };
  }

  private resolveKnifePick(e: PointerEvent, paneId: ViewId) {
    if (!this.session || !this.host) return null;
    const pane = this.panes.get(paneId);
    const viewport = this.lastRects.find((r) => r.id === paneId);
    if (!pane || !viewport) return null;

    const hostRect = this.host.getBoundingClientRect();
    const localX = e.clientX - hostRect.left - viewport.x;
    const localY = e.clientY - hostRect.top - viewport.y;
    const ndc = new Vector2(
      (localX / Math.max(1, viewport.width)) * 2 - 1,
      -(localY / Math.max(1, viewport.height)) * 2 + 1,
    );
    pane.camera.updateMatrixWorld(true);
    const raycaster = new Raycaster();
    raycaster.setFromCamera(ndc, pane.camera);
    const meshes = [...this.handles.values()].map((h) => h.mesh);
    const intersection = raycaster.intersectObjects(meshes, false)[0];
    if (!intersection) return null;

    const objectId = intersection.object.userData.objectId as ObjectId;
    const handle = this.handles.get(objectId);
    if (!handle) return null;
    const object = this.session.document.objects.get(objectId);
    if (!object?.meshId) return null;
    const faceId = pickLogicalFace(handle.renderData.triangleMap, intersection.faceIndex ?? undefined);
    if (!faceId) return null;
    const world = v3(intersection.point.x, intersection.point.y, intersection.point.z);
    return {
      objectId: object.id,
      faceId,
      localPoint: inverseTransformPointApprox(world, object.transform),
      transform: cloneTransform(object.transform),
    };
  }

  private resolveLoopCutPick(e: PointerEvent, paneId: ViewId) {
    const hit = this.resolvePointerHit(e, paneId);
    if (!hit) return null;
    const edgeId = this.pickBestEdge(
      hit.mesh,
      hit.handle,
      hit.pane,
      hit.viewport,
      hit.pointer,
      hit.faceId,
      false,
    );
    return edgeId ? { objectId: hit.objectId, edgeId } : null;
  }

  private pickBestVertex(
    mesh: EditableMesh,
    handle: ObjectRenderHandle,
    pane: Pane,
    viewport: ViewportRect,
    pointer: { x: number; y: number },
    faceId: FaceId | null,
    xRay: boolean,
  ): VertexId | null {
    // Prefer verts on the hit face in visible-only mode; X-ray searches all logical verts.
    const candidates =
      !xRay && faceId
        ? new Set(
            handle.renderData.triangleMap
              .filter((t) => t.faceId === faceId)
              .flatMap((t) => t.vertexIds),
          )
        : new Set(mesh.vertices.keys());
    let best: VertexId | null = null;
    let distance = PICK_TOLERANCE_PX;
    for (const id of candidates) {
      const p = projectVertex(mesh, handle, pane.camera, viewport, id);
      if (!p) continue;
      const d = Math.hypot(pointer.x - p.x, pointer.y - p.y);
      if (d >= distance && !(Math.abs(d - distance) < 0.25 && best && id < best)) continue;
      if (!xRay && this.isWorldPointOccluded(mesh, handle, pane, id)) continue;
      distance = d;
      best = id;
    }
    return best;
  }

  private pickBestEdge(
    mesh: EditableMesh,
    handle: ObjectRenderHandle,
    pane: Pane,
    viewport: ViewportRect,
    pointer: { x: number; y: number },
    faceId: FaceId | null,
    xRay: boolean,
  ): EdgeId | null {
    const candidateVertices =
      !xRay && faceId
        ? new Set(
            handle.renderData.triangleMap
              .filter((t) => t.faceId === faceId)
              .flatMap((t) => t.vertexIds),
          )
        : null;
    let best: EdgeId | null = null;
    let distance = PICK_TOLERANCE_PX;
    for (const edge of mesh.edges.values()) {
      const pair = getEdgeVertices(mesh, edge.id);
      if (!pair) continue;
      if (candidateVertices && !pair.some((id) => candidateVertices.has(id))) continue;
      const a = projectVertex(mesh, handle, pane.camera, viewport, pair[0]!);
      const b = projectVertex(mesh, handle, pane.camera, viewport, pair[1]!);
      if (!a || !b) continue;
      const d = pointSegmentDistance(pointer, a, b);
      if (d >= distance && !(Math.abs(d - distance) < 0.25 && best && edge.id < best)) continue;
      if (!xRay) {
        const midOccluded =
          this.isWorldPointOccluded(mesh, handle, pane, pair[0]!) &&
          this.isWorldPointOccluded(mesh, handle, pane, pair[1]!);
        if (midOccluded) continue;
      }
      distance = d;
      best = edge.id;
    }
    return best;
  }

  /** Visible-only occlusion: reject points clearly behind the front surface. */
  private isWorldPointOccluded(
    mesh: EditableMesh,
    handle: ObjectRenderHandle,
    pane: Pane,
    vertexId: VertexId,
  ): boolean {
    const pos = mesh.vertices.get(vertexId)?.position;
    if (!pos) return true;
    const world = handle.group.localToWorld(new Vector3(pos.x, pos.y, pos.z));
    const projected = world.clone().project(pane.camera);
    pane.camera.updateMatrixWorld(true);
    const raycaster = new Raycaster();
    raycaster.setFromCamera(new Vector2(projected.x, projected.y), pane.camera);
    const hits = raycaster.intersectObject(handle.mesh, false);
    if (!hits.length) return false;
    const pointDist = raycaster.ray.origin.distanceTo(world);
    return hits[0]!.distance + 0.02 < pointDist;
  }

  private onPointerLeave = (): void => {
    this.interactionOverlay.updateSnap(null, 'none');
    const terrain = this.session?.tools.getActive();
    if (
      (
        !(terrain instanceof TerrainSculptTool) &&
        !(terrain instanceof MeshSculptTool) &&
        !(terrain instanceof TerrainObjectTool) &&
        !(terrain instanceof TerrainFeatureTool)
      ) ||
      !terrain.dragging
    ) {
      this.terrainBrushPreview.visible = false;
    }
    if (!(terrain instanceof MeshSculptTool) || !terrain.dragging) {
      this.sculptHardnessPreview.visible = false;
    }
    if (!this.session || this.interacting) return;
    this.session.selection.clearHover();
    if (this.lastHoverKey !== '') {
      this.lastHoverKey = '';
      this.syncOverlays();
      this.invalidate();
      this.session.requestRedraw();
    }
  };

  private syncOverlays(): void {
    if (!this.session || !this.workspace) return;
    const doc = this.session.document;
    const shadingMode = this.workspace.getShadingMode();
    this.overlays.sync(
      this.session.selection.state,
      this.handles,
      (objectId) => {
        const object = doc.objects.get(objectId);
        return object?.meshId ? doc.meshes.get(object.meshId) ?? null : null;
      },
      (ids) => expandGroupsToDescendants(doc, ids),
      shadingMode,
    );
    const activeTool = this.session.tools.getActive();
    const draft =
      activeTool instanceof CreateDoodleTool
        ? activeTool.getDraftOperation()
        : null;
    const doodle =
      activeTool instanceof CreateDoodleTool ? activeTool : null;
    const penDrawing = doodle?.inputMode === 'pen' && doodle.state.stage === 'drawing';
    const sketchDrawing =
      doodle?.inputMode === 'sketch' &&
      doodle.state.stage === 'drawing' &&
      !doodle.state.strokeLocked;
    const sketchLocked = doodle?.isSketchStrokeLocked() ?? false;
    const pointEditMode = this.workspace.curveNodeEditMode;
    const activeId = this.session.selection.state.activeObjectId;
    const object = activeId ? doc.objects.get(activeId) ?? null : null;
    const hasCommittedCurve = !!object && !!readCurveOperation(object.metadata.curveOperation);
    const editNodes =
      penDrawing || (pointEditMode && (sketchLocked || hasCommittedCurve));
    const showDraftPath = sketchDrawing || penDrawing || (pointEditMode && sketchLocked);
    const curveOptions = {
      editNodes,
      showDraftPath,
      selectedIndex: this.workspace.selectedCurvePointIndex,
    };
    if (draft) {
      this.curveControls.syncDraft(
        this.scene,
        draft,
        doodle?.state.previewPoint ?? null,
        curveOptions,
      );
      return;
    }
    const operation = readCurveOperation(object?.metadata.curveOperation);
    this.curveControls.sync(
      activeId ? this.handles.get(activeId) ?? null : null,
      operation,
      curveOptions,
    );
  }

  private bindPointer(): void {
    this.unbindPointer();
    const el = this.renderer?.domElement;
    if (!el) return;
    el.addEventListener('pointermove', this.onPointerMove);
    el.addEventListener('pointerdown', this.onPointerDown, true);
    el.addEventListener('pointerup', this.onPointerUp);
    el.addEventListener('pointercancel', this.onPointerCancel);
    el.addEventListener('pointerleave', this.onPointerLeave);
    el.addEventListener('contextmenu', this.onContextMenu);
    el.addEventListener('wheel', this.onWheel, { capture: true, passive: false });
  }

  private unbindPointer(): void {
    const el = this.renderer?.domElement;
    if (!el) return;
    el.removeEventListener('pointermove', this.onPointerMove);
    el.removeEventListener('pointerdown', this.onPointerDown, true);
    el.removeEventListener('pointerup', this.onPointerUp);
    el.removeEventListener('pointercancel', this.onPointerCancel);
    el.removeEventListener('pointerleave', this.onPointerLeave);
    el.removeEventListener('contextmenu', this.onContextMenu);
    el.removeEventListener('wheel', this.onWheel, true);
  }

  private onContextMenu = (e: Event): void => {
    e.preventDefault();
  };

  private onWheel = (e: WheelEvent): void => {
    const tool = this.session?.tools.getActive();
    if (tool instanceof TerrainObjectTool && this.session && tool.mode === 'place') {
      e.preventDefault();
      if (e.shiftKey) {
        tool.placementScale = Math.max(
          0.1,
          Math.min(4, tool.placementScale * (e.deltaY < 0 ? 1.08 : 0.92)),
        );
      } else {
        tool.placementYaw += (e.deltaY < 0 ? 1 : -1) * Math.PI / 12;
      }
      tool.revision += 1;
      this.interactionOverlay.updateTransform(e, tool.statusLine());
      this.session.requestRedraw();
      this.invalidate();
      return;
    }
    if (tool instanceof LoopCutTool && this.session) {
      e.preventDefault();
      tool.adjustCutCount(e.deltaY < 0 ? 1 : -1, this.session.context());
      this.interactionOverlay.updateTransform(e, tool.getStatusLine());
      this.invalidate();
      return;
    }
    if (tool instanceof TerrainSculptTool && this.session) {
      e.preventDefault();
      tool.setRadius(tool.radius * (e.deltaY < 0 ? 1.12 : 0.89), this.session.context());
      this.interactionOverlay.updateTransform(e, tool.statusLine());
      this.invalidate();
      return;
    }
    if (tool instanceof MeshSculptTool && this.session) {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        tool.setStrength(
          tool.strength * (e.deltaY < 0 ? 1.12 : 0.89),
          this.session.context(),
        );
      } else {
        tool.setRadius(tool.radius * (e.deltaY < 0 ? 1.12 : 0.89), this.session.context());
      }
      this.interactionOverlay.updateTransform(e, tool.statusLine());
      this.invalidate();
      return;
    }
    if (tool instanceof TerrainObjectTool && this.session && tool.mode !== 'place') {
      e.preventDefault();
      tool.setRadius(tool.radius * (e.deltaY < 0 ? 1.12 : 0.89), this.session.context());
      this.interactionOverlay.updateTransform(e, tool.statusLine());
      this.invalidate();
      return;
    }
    if (tool instanceof TerrainFeatureTool && this.session) {
      e.preventDefault();
      tool.width = Math.max(0.1, Math.min(100, tool.width * (e.deltaY < 0 ? 1.12 : 0.89)));
      tool.revision += 1;
      this.interactionOverlay.updateTransform(e, tool.statusLine());
      this.invalidate();
      return;
    }
    this.activateNavigationPane(e.clientX, e.clientY);
  };

  private activateNavigationPane(clientX: number, clientY: number): void {
    if (!this.host || !this.workspace) return;
    const rect = this.host.getBoundingClientRect();
    const id = this.workspace.hitTestViewport(
      clientX - rect.left,
      clientY - rect.top,
      rect.width,
      rect.height,
    );
    if (!id) return;
    this.workspace.setHoveredViewport(id);
    this.workspace.setActiveViewport(id);
    this.rebindActiveControls();
  }

  private toPointerSample(e: PointerEvent, paneId: ViewId): PointerSample {
    const input = this.pointerInput(e, paneId);
    return {
      screenX: e.clientX,
      screenY: e.clientY,
      rayOrigin: input.rayOrigin,
      rayDirection: input.rayDirection,
      viewportId: paneId,
      shiftKey: e.shiftKey,
      ctrlKey: e.ctrlKey,
      camera: this.getCameraAxes(paneId)!,
    };
  }

  private pickCurveControl(e: PointerEvent, paneId: ViewId): CurveControlTarget | null {
    if (!this.host || !this.session || !this.workspace) return null;
    const tool = this.session.tools.getActive();
    const doodle = tool instanceof CreateDoodleTool ? tool : null;
    const penDrawing = doodle?.inputMode === 'pen' && doodle.state.stage === 'drawing';
    const sketchLocked = doodle?.isSketchStrokeLocked() ?? false;
    const canEditDraft =
      penDrawing || (this.workspace.curveNodeEditMode && sketchLocked);
    const activeId = this.session.selection.state.activeObjectId;
    const object = activeId ? this.session.document.objects.get(activeId) : null;
    const hasCommittedCurve = !!object && !!readCurveOperation(object.metadata.curveOperation);
    const canEditCommitted =
      this.workspace.curveNodeEditMode &&
      this.session.selection.state.mode === 'object' &&
      hasCommittedCurve;
    if (!canEditDraft && !canEditCommitted) return null;
    const pane = this.panes.get(paneId);
    const viewport = this.lastRects.find((rect) => rect.id === paneId);
    if (!pane || !viewport) return null;
    const hostRect = this.host.getBoundingClientRect();
    const localX = e.clientX - hostRect.left - viewport.x;
    const localY = e.clientY - hostRect.top - viewport.y;
    const ndc = new Vector2(
      localX / Math.max(1, viewport.width) * 2 - 1,
      -(localY / Math.max(1, viewport.height)) * 2 + 1,
    );
    pane.camera.updateMatrixWorld(true);
    this.curveControls.root.updateWorldMatrix(true, true);
    const raycaster = new Raycaster();
    raycaster.setFromCamera(ndc, pane.camera);
    const threshold = (this.pointerInput(e, paneId).worldUnitsPerPixel ?? 0.01) * 12;
    return this.curveControls.pick(raycaster, threshold);
  }

  private beginCurvePointDrag(
    e: PointerEvent,
    paneId: ViewId,
    target: CurveControlTarget,
  ): boolean {
    if (!this.session || !this.workspace) return false;
    const tool = this.session.tools.getActive();
    const draft = tool instanceof CreateDoodleTool ? tool.getDraftOperation() : null;
    if (draft && tool instanceof CreateDoodleTool) {
      if (
        target.kind === 'scale-start' ||
        target.kind === 'scale-mid' ||
        target.kind === 'scale-end'
      ) return false;
      const point =
        target.kind === 'anchor'
          ? tool.state.points[target.index]
          : target.kind === 'handle-in'
            ? tool.state.handlesIn[target.index]
            : tool.state.handlesOut[target.index];
      const axes = this.getCameraAxes(paneId);
      if (!point || !axes) return false;
      this.workspace.setSelectedCurvePointIndex(target.index);
      this.draftCurvePointDrag = {
        paneId,
        pointerId: e.pointerId,
        target: { kind: target.kind, index: target.index },
        planeOrigin: { ...point },
        planeNormal: { ...axes.forward },
      };
      tool.state.previewPoint = null;
      tool.state.revision += 1;
      e.preventDefault();
      (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
      this.workspace.input.begin('tool');
      this.syncOrbitEnabled();
      if (this.renderer) this.renderer.domElement.style.cursor = 'move';
      return true;
    }
    const objectId = this.session.selection.state.activeObjectId;
    const object = objectId ? this.session.document.objects.get(objectId) : null;
    const mesh = object?.meshId ? this.session.document.meshes.get(object.meshId) : null;
    const operation = readCurveOperation(object?.metadata.curveOperation);
    const handle = objectId ? this.handles.get(objectId) : null;
    if (!object || !mesh || !operation || !handle) return false;
    const localPoint =
      target.kind === 'anchor'
        ? operation.points[target.index]
        : target.kind === 'handle-in'
          ? operation.handlesIn[target.index]
          : target.kind === 'handle-out'
            ? operation.handlesOut[target.index]
            : crossSectionHandlePoint(operation, target.kind);
    const axes = this.getCameraAxes(paneId);
    if (!localPoint || !axes) return false;
    const world = handle.group.localToWorld(new Vector3(localPoint.x, localPoint.y, localPoint.z));
    this.workspace.setSelectedCurvePointIndex(target.index);
    this.curvePointDrag = {
      paneId,
      pointerId: e.pointerId,
      objectId: object.id,
      target,
      planeOrigin: v3(world.x, world.y, world.z),
      planeNormal: { ...axes.forward },
      beforeMesh: mesh,
      beforeMetadata: object.metadata.curveOperation!,
      operation,
    };
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    this.workspace.input.begin('tool');
    this.syncOrbitEnabled();
    if (this.renderer) this.renderer.domElement.style.cursor = 'move';
    return true;
  }

  private updateDraftCurvePointDrag(e: PointerEvent): void {
    const drag = this.draftCurvePointDrag;
    const tool = this.session?.tools.getActive();
    if (!drag || !this.session || !(tool instanceof CreateDoodleTool)) return;
    const input = this.pointerInput(e, drag.paneId);
    const denominator = dotVec3(input.rayDirection, drag.planeNormal);
    if (Math.abs(denominator) < 1e-7) return;
    const distance =
      dotVec3(subVec3(drag.planeOrigin, input.rayOrigin), drag.planeNormal) / denominator;
    if (!Number.isFinite(distance)) return;
    const next = addVec3(input.rayOrigin, scaleVec3(input.rayDirection, distance));
    tool.updateDraftControl(drag.target, next, this.session.context());
    this.invalidate();
  }

  private finishDraftCurvePointDrag(): void {
    if (!this.draftCurvePointDrag || !this.workspace) return;
    this.draftCurvePointDrag = null;
    this.workspace.input.end('tool');
    this.syncOrbitEnabled();
    if (this.renderer) this.renderer.domElement.style.cursor = '';
    this.session?.requestRedraw();
  }

  private updateCurvePointDrag(e: PointerEvent): void {
    const drag = this.curvePointDrag;
    if (!drag || !this.session) return;
    const object = this.session.document.objects.get(drag.objectId);
    const handle = this.handles.get(drag.objectId);
    if (!object?.meshId || !handle) return;
    const input = this.pointerInput(e, drag.paneId);
    const denominator = dotVec3(input.rayDirection, drag.planeNormal);
    if (Math.abs(denominator) < 1e-7) return;
    const distance =
      dotVec3(subVec3(drag.planeOrigin, input.rayOrigin), drag.planeNormal) / denominator;
    if (!Number.isFinite(distance)) return;
    const world = addVec3(input.rayOrigin, scaleVec3(input.rayDirection, distance));
    const local = handle.group.worldToLocal(new Vector3(world.x, world.y, world.z));
    const next = v3(local.x, local.y, local.z);
    const target = drag.target;
    if (target.kind === 'anchor') {
      const previous = drag.operation.points[target.index]!;
      const delta = subVec3(next, previous);
      drag.operation.points[target.index] = next;
      drag.operation.handlesIn[target.index] = addVec3(
        drag.operation.handlesIn[target.index]!,
        delta,
      );
      drag.operation.handlesOut[target.index] = addVec3(
        drag.operation.handlesOut[target.index]!,
        delta,
      );
    } else if (target.kind === 'handle-in') {
      drag.operation.handlesIn[target.index] = next;
    } else if (target.kind === 'handle-out') {
      drag.operation.handlesOut[target.index] = next;
    } else {
      const anchorIndex =
        target.kind === 'scale-start'
          ? 0
          : target.kind === 'scale-mid'
            ? Math.floor((drag.operation.points.length - 1) / 2)
            : drag.operation.points.length - 1;
      const anchor = drag.operation.points[anchorIndex]!;
      const scale = Math.max(
        0.05,
        Math.min(
          4,
          Math.hypot(next.x - anchor.x, next.y - anchor.y, next.z - anchor.z) /
            Math.max(1e-4, drag.operation.radius * drag.operation.profileWidth),
        ),
      );
      if (target.kind === 'scale-start') drag.operation.startScale = scale;
      else if (target.kind === 'scale-mid') drag.operation.midScale = scale;
      else drag.operation.endScale = scale;
    }
    const sourceObject = drag.operation.pathSourceObjectId
      ? this.session.document.objects.get(drag.operation.pathSourceObjectId)
      : null;
    const sourceMesh = sourceObject?.meshId
      ? this.session.document.meshes.get(sourceObject.meshId) ?? null
      : null;
    const mesh = evaluateCurveOperation(drag.operation, sourceMesh);
    mesh.id = object.meshId;
    this.session.document.meshes.set(mesh.id, mesh);
    object.metadata.curveOperation = serializeCurveOperation(drag.operation);
    this.session.document.dirty = true;
    this.session.requestRedraw();
  }

  private finishCurvePointDrag(): void {
    const drag = this.curvePointDrag;
    if (!drag || !this.session || !this.workspace) return;
    const object = this.session.document.objects.get(drag.objectId);
    const afterMesh = object?.meshId ? this.session.document.meshes.get(object.meshId) : null;
    const afterMetadata = object?.metadata.curveOperation;
    this.curvePointDrag = null;
    this.workspace.input.end('tool');
    this.syncOrbitEnabled();
    if (this.renderer) this.renderer.domElement.style.cursor = '';
    if (!object || !afterMesh || !afterMetadata) return;
    let applied = true;
    this.session.history.execute({
      name:
        drag.target.kind === 'anchor'
          ? 'Move Curve Point'
          : drag.target.kind.startsWith('scale-')
            ? 'Resize Flow Cross-section'
            : 'Move Bézier Handle',
      execute: () => {
        if (applied) return;
        this.session!.document.meshes.set(afterMesh.id, afterMesh);
        object.metadata.curveOperation = afterMetadata;
        this.session!.document.dirty = true;
        applied = true;
      },
      undo: () => {
        this.session!.document.meshes.set(drag.beforeMesh.id, drag.beforeMesh);
        object.metadata.curveOperation = drag.beforeMetadata;
        this.session!.document.dirty = true;
        applied = false;
      },
    });
    this.session.requestRedraw();
  }

  private tryStartGizmoTransform(e: PointerEvent, paneId: ViewId): boolean {
    if (!this.host || !this.session || !this.workspace || this.isTextureFaceEditing()) return false;
    const gizmoHit = this.pickGizmo(e, paneId);
    if (!gizmoHit) return false;
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    const started =
      this.session.transform.begin({
        type: gizmoHit.type,
        source: 'gizmo',
        viewportId: paneId,
        pointer: this.toPointerSample(e, paneId),
        constraint: gizmoHit.constraint,
        camera: this.getCameraAxes(paneId),
      }) ?? false;
    if (!started) {
      this.gizmoDragging = false;
      this.gizmo.setActiveHandle(null);
      this.workspace.input.end('transform');
      this.syncOrbitEnabled();
      this.syncGizmo();
      return false;
    }
    this.gizmoDragging = true;
    this.modifierPreview.root.visible = false;
    if (this.renderer) this.renderer.domElement.style.cursor = 'grabbing';
    this.gizmo.setActiveHandle(gizmoHit.handleId);
    this.workspace.input.begin('transform');
    this.syncOrbitEnabled();
    return true;
  }

  private pickGizmo(e: PointerEvent, paneId: ViewId) {
    if (!this.host || !this.session) return null;
    if (this.session.transform.prefs.gizmoMode === 'select') return null;
    if (!selectionHasTransformTarget(this.session.selection.state)) return null;
    const pane = this.panes.get(paneId);
    const viewport = this.lastRects.find((r) => r.id === paneId);
    if (!pane || !viewport) return null;
    const hostRect = this.host.getBoundingClientRect();
    const localX = e.clientX - hostRect.left - viewport.x;
    const localY = e.clientY - hostRect.top - viewport.y;
    const ndc = new Vector2(
      (localX / Math.max(1, viewport.width)) * 2 - 1,
      -(localY / Math.max(1, viewport.height)) * 2 + 1,
    );
    pane.camera.updateMatrixWorld(true);
    this.gizmo.root.updateWorldMatrix(true, true);
    return this.gizmo.pick(new Raycaster(), ndc, pane.camera, {
      x: localX,
      y: localY,
      width: viewport.width,
      height: viewport.height,
      thresholdPx: 16,
    });
  }

  private syncOrbitEnabled(): void {
    this.rebindActiveControls();
  }

  /**
   * Lightweight sync while a gizmo/modal transform is live.
   * Updates object transforms + mesh positions without React redraw.
   */
  syncLiveTransform(): void {
    if (!this.session) return;
    if (this.session.selection.state.mode === 'object') {
      this.sceneSynchronizer.syncTransforms();
    } else {
      if (this.scene) this.sceneSynchronizer.sync(this.scene);
      this.syncOverlays();
    }
    this.syncGizmo();
    this.invalidate();
  }

  /**
   * Keeps camera controls and transient previews in step with keyboard modal
   * transforms. G/R/S can begin and end without a gizmo pointer-down/up pair.
   */
  syncTransformInteractionState(): void {
    const active = !!this.session?.transform.active;
    this.modifierPreview.root.visible = !active;
    if (!active) {
      this.pendingTransformMove = null;
      this.refreshModifierPreview();
      this.interactionOverlay.updateTransform(null, '');
      if (this.renderer) this.renderer.domElement.style.cursor = '';
    }
    this.syncOrbitEnabled();
    this.syncGizmo();
    this.invalidate();
  }

  /** Re-evaluate camera ownership after a keyboard-driven tool ends. */
  syncInputControls(): void {
    this.interactionOverlay.updateTransform(null, '');
    this.syncOrbitEnabled();
    this.invalidate();
  }

  private flushPendingTransformMove(): void {
    const pending = this.pendingTransformMove;
    const transform = this.session?.transform;
    this.pendingTransformMove = null;
    if (!pending || !transform?.active) return;
    transform.updatePointer(this.toPointerSample(pending.event, pending.paneId));
    this.interactionOverlay.updateTransform(pending.event, transform.statusLine());
    this.syncLiveTransform();
  }

  private flushPendingPrimitiveMove(): void {
    const pending = this.pendingPrimitiveMove;
    this.pendingPrimitiveMove = null;
    const tool = this.session?.tools.getActive();
    if (!pending || !this.session || !(tool instanceof CreatePrimitiveTool) || tool.state.stage === 'idle') return;
    tool.update(this.pointerInput(pending.event, pending.paneId), this.session.context());
    this.interactionOverlay.updateSnap(pending.event, tool.state.snapLabel);
    this.invalidate();
  }

  private flushPendingPaintMove(): void {
    const pending = this.pendingPaintMove;
    this.pendingPaintMove = null;
    if (!pending || !this.painting3D) return;
    // paintAtPointer interpolates from the previous texel, so coalescing preserves a continuous stroke.
    this.paintAtPointer(pending.event, pending.paneId, false);
  }

  syncGizmo(): void {
    if (!this.workspace) return;
    const viewId = this.workspace.hoveredViewportId ?? this.workspace.activeViewportId;
    const pane = this.panes.get(viewId);
    if (pane) this.syncGizmoForCamera(pane.camera, viewId);
  }

  private syncGizmoForCamera(camera: Camera, viewId: ViewId): void {
    if (!this.session) return;
    const sel = this.session.selection.state;
    const activeTool = this.session.tools.getActive();
    const terrainEditing =
      activeTool instanceof TerrainSculptTool ||
      activeTool instanceof MeshSculptTool ||
      activeTool instanceof TerrainObjectTool ||
      activeTool instanceof TerrainFeatureTool;
    const vectorPenDrawing =
      activeTool instanceof CreateDoodleTool &&
      activeTool.inputMode === 'pen' &&
      activeTool.state.stage === 'drawing';
    const show =
      !terrainEditing &&
      !vectorPenDrawing &&
      !this.isTextureFaceEditing() &&
      selectionHasTransformTarget(sel);

    // Translation follows the selection; rotation and scale keep a stable pivot.
    const live = this.session.transform.session;
    const pivot = live?.status === 'active'
      ? live.type === 'translate'
        ? {
            x: live.pivotPosition.x + live.currentDelta.translation.x,
            y: live.pivotPosition.y + live.currentDelta.translation.y,
            z: live.pivotPosition.z + live.currentDelta.translation.z,
          }
        : live.pivotPosition
      : show
        ? computePivot(this.session.document, sel, this.session.transform.prefs.pivotMode)
        : { x: 0, y: 0, z: 0 };
    const session = this.session.transform.session;
    const basis = session
      ? session.orientationBasis
      : buildOrientationBasis(
          this.session.document,
          sel,
          this.session.transform.prefs.orientation,
          this.getCameraAxes(viewId),
          false,
        );

    this.gizmo.sync(
      pivot,
      basis,
      camera,
      this.session.transform.prefs.gizmoMode,
      show,
    );

    if (session) {
      this.gizmo.setConstraintHighlight(session.axisConstraint, session.type);
    } else if (!this.gizmoDragging) {
      this.gizmo.setActiveHandle(null);
    }
  }

  private syncScene(): void {
    if (!this.attached || !this.session || !this.scene) return;
    const session = this.session;
    this.sceneSynchronizer.sync(this.scene);
    const shadingMode = this.workspace?.getShadingMode() ?? 'material';
    for (const handle of this.handles.values()) {
      applyViewportRenderStyle(handle, shadingMode);
    }
    const tool = session.tools.getActive();
    if (!(tool instanceof TileDrawTool) && this.tileDrawOverlay.group.visible) {
      this.tileDrawOverlay.update(null, this.primitivePreview.revision);
    }
    if (tool instanceof CreatePrimitiveTool) {
      if (this.primitivePreview.revision !== tool.state.revision) {
        this.primitivePreview.update(tool.getPreviewMesh(), tool.getCage(true), tool.state.revision);
      }
    } else if (tool instanceof CreateDoodleTool) {
      if (this.primitivePreview.revision !== tool.state.revision) {
        this.primitivePreview.update(tool.getPreviewMesh(), null, tool.state.revision);
      }
    } else if (tool instanceof DrawPolyTool) {
      if (this.primitivePreview.revision !== tool.state.revision) {
        const info = tool.getPreviewInfo(session.context());
        this.primitivePreview.updatePolyline(info.points, tool.state.revision, {
          chainCount: info.chainCount,
          canClose: info.canClose,
          allVertexPoints: info.allVertexPoints,
          allEdgeSegments: info.allEdgeSegments,
          chainPoints: info.chainPoints,
          createdPoints: info.createdPoints,
          showFaceGhost: info.showFaceGhost,
        });
      }
    } else if (tool instanceof KnifeTool) {
      if (this.primitivePreview.revision !== tool.state.revision) {
        this.primitivePreview.updatePolyline(tool.getPreviewPoints(), tool.state.revision);
      }
    } else if (tool instanceof LoopCutTool) {
      if (this.primitivePreview.revision !== tool.state.revision) {
        this.primitivePreview.updateSegments(tool.getPreviewSegments(), tool.state.revision);
      }
    } else if (tool instanceof TileDrawTool) {
      if (this.primitivePreview.revision !== tool.state.revision) {
        this.primitivePreview.update(tool.getPreviewMesh(), null, tool.state.revision);
      }
      this.tileDrawOverlay.update(tool.getOverlayInfo(), tool.state.revision);
    } else if (this.primitivePreview.group.visible) {
      this.primitivePreview.update(null, null, this.primitivePreview.revision + 1);
    }

    this.syncOverlays();
    this.syncGizmo();
    this.syncOrbitEnabled();
  }

  private resize(): void {
    if (!this.host || !this.renderer || !this.workspace) return;
    const bounds = this.host.getBoundingClientRect();
    const w = Math.max(1, Math.floor(bounds.width));
    const h = Math.max(1, Math.floor(bounds.height));
    if (w < 2 || h < 2) return;

    const nextRatio = Math.min((window.devicePixelRatio || 1) * this.renderQualityScale, 2);
    if (nextRatio !== this.lastPixelRatio) {
      this.renderer.setPixelRatio(nextRatio);
      this.lastPixelRatio = nextRatio;
    }

    // CSS pixel size only — drawing buffer may be larger (DPR). Never layout from canvas.width.
    this.renderer.setSize(w, h, false);
    this.lastRects = this.workspace.computeViewportRects(w, h);
    this.applyCameraProjections(this.lastRects);
  }

  private applyCameraProjections(rects: ViewportRect[]): void {
    for (const rect of rects) {
      const pane = this.panes.get(rect.id);
      if (!pane || rect.width < 1 || rect.height < 1) continue;
      const aspect = rect.width / rect.height;
      const target =
        pane.controls?.target ??
        new Vector3().fromArray(this.workspace!.getCamera(pane.id).target);

      if (pane.camera instanceof PerspectiveCamera) {
        pane.camera.aspect = aspect;
        syncCameraClipPlanes(pane.camera, target);
      } else if (pane.camera instanceof OrthographicCamera) {
        const viewHeight = clampOrthoHeight(pane.orthoHeight);
        pane.orthoHeight = viewHeight;
        const viewWidth = viewHeight * aspect;
        pane.camera.left = -viewWidth / 2;
        pane.camera.right = viewWidth / 2;
        pane.camera.top = viewHeight / 2;
        pane.camera.bottom = -viewHeight / 2;
        syncCameraClipPlanes(pane.camera, target);
      }
    }
  }

  private syncPaneGrid(pane: Pane): void {
    if (!this.workspace) return;
    const target =
      pane.controls?.target ??
      new Vector3().fromArray(this.workspace.getCamera(pane.id).target);
    syncViewportGrid(pane.grid, pane.view, pane.camera, target);
  }

  /** Sync orthoHeight from OrbitControls zoom changes on orthographic cameras. */
  private syncOrthoHeights(): void {
    for (const pane of this.panes.values()) {
      if (!(pane.camera instanceof OrthographicCamera) || !pane.controls) continue;
      // OrbitControls modifies zoom; keep orthoHeight as base, zoom stacks on top.
      // When user dollies, three updates camera.zoom — that is enough.
    }
  }

  private startLoop(): void {
    this.stopLoop();
    const tick = () => {
      if (!this.attached) return;
      this.frame = requestAnimationFrame(tick);

      for (const pane of this.panes.values()) {
        if (pane.controls?.enabled) {
          pane.controls.update();
          if (pane.camera instanceof OrthographicCamera) this.lockOrthoPane(pane);
        }
      }
      this.syncOrthoHeights();

      this.flushPendingTransformMove();
      this.flushPendingPrimitiveMove();
      this.flushPendingPaintMove();

      if (this.updateTerrainWaterRendering(performance.now() / 1000)) {
        this.needsRender = true;
      }
      if (!this.needsRender && !this.interacting) return;
      if (this.contextLost || !this.renderer || !this.scene || !this.workspace) return;

      // Refresh rects from CSS workspace size (never drawing-buffer size).
      if (this.host) {
        const bounds = this.host.getBoundingClientRect();
        const w = Math.max(1, Math.floor(bounds.width));
        const h = Math.max(1, Math.floor(bounds.height));
        this.lastRects = this.workspace.computeViewportRects(w, h);
        this.applyCameraProjections(this.lastRects);
      }

      this.renderer.setScissorTest(true);
      this.renderer.setClearColor(0x0e1116, 1);
      this.renderer.clear(true, true, true);

      const visibleIds = new Set(this.lastRects.map((r) => r.id));

      for (const rect of this.lastRects) {
        const pane = this.panes.get(rect.id);
        if (!pane || rect.width < 1 || rect.height < 1) continue;

        // CSS pixels only. Three.js multiplies by pixelRatio internally.
        this.renderer.setViewport(rect.x, rect.webglY, rect.width, rect.height);
        this.renderer.setScissor(rect.x, rect.webglY, rect.width, rect.height);

        const hovered = this.workspace.hoveredViewportId === rect.id;
        const active = this.workspace.activeViewportId === rect.id;
        this.renderer.setClearColor(hovered || active ? 0x121820 : 0x0e1116, 1);
        this.renderer.clear(true, true, true);

        for (const p of this.panes.values()) {
          p.grid.visible =
            p.id === rect.id &&
            visibleIds.has(p.id) &&
            this.workspace.preferences.viewports[p.id].gridVisible;
        }
        this.syncPaneGrid(pane);

        this.syncGizmoForCamera(pane.camera, rect.id);
        this.renderer.render(this.scene, pane.camera);
      }

      this.needsRender = this.interacting;
    };
    tick();
  }

  private updateTerrainWaterRendering(timeSeconds: number): boolean {
    if (!this.session) return false;
    let active = false;
    for (const object of this.session.document.objects.values()) {
      const kind = object.metadata.terrainFeature;
      if (kind !== 'river' && kind !== 'lake' && kind !== 'ocean') continue;
      const handle = this.handles.get(object.id);
      if (!handle) continue;
      const isAnimated = object.metadata.waterAnimated === 'true';
      const speed = Number(object.metadata.waterFlowSpeed) || 0.12;
      const asset = object.materialSlotIds[0]
        ? this.session.document.materials.get(object.materialSlotIds[0]!)
        : null;
      for (const material of handle.materials) {
        const animated = material as Material & {
          map?: Texture | null;
          opacity: number;
          depthWrite: boolean;
          polygonOffset: boolean;
          polygonOffsetFactor: number;
          polygonOffsetUnits: number;
        };
        // Transparent water should never fight with the terrain depth buffer.
        animated.depthWrite = false;
        animated.polygonOffset = true;
        animated.polygonOffsetFactor = -1;
        animated.polygonOffsetUnits = -1;
        if (isAnimated && animated.map) {
          animated.map.offset.y = (timeSeconds * speed) % 1;
          animated.map.offset.x = (timeSeconds * speed * 0.22 + Math.sin(timeSeconds * 0.35) * 0.02) % 1;
          animated.map.repeat.set(
            kind === 'ocean' ? 4 : kind === 'lake' ? 2.2 : 1.6,
            kind === 'ocean' ? 4 : kind === 'lake' ? 2.2 : 1.6,
          );
        }
        if (isAnimated && asset) {
          const shimmer = 0.97 + Math.sin(timeSeconds * 1.55) * 0.03;
          animated.opacity = asset.opacity * shimmer;
          const lit = material as Material & { emissive?: { setRGB: (r: number, g: number, b: number) => void } };
          if (lit.emissive) {
            const pulse = 0.85 + Math.sin(timeSeconds * 2.1) * 0.15;
            lit.emissive.setRGB(0.01 * pulse, 0.045 * pulse, 0.07 * pulse);
          }
        }
      }
      active ||= isAnimated;
    }
    return active;
  }

  private stopLoop(): void {
    cancelAnimationFrame(this.frame);
    this.frame = 0;
  }

  getModelPlacement() {
    return this.modelPlacement;
  }

  setModelPlacement(request: {
    modelDocumentId: DocumentId;
    modelName: string;
    onPlaced?: () => void;
  } | null): void {
    this.modelPlacement = request;
    this.interactionOverlay.updateTransform(
      null,
      request ? `Click to place ${request.modelName} · Esc cancel` : '',
    );
    this.invalidate();
  }

  cancelModelPlacement(): void {
    if (!this.modelPlacement) return;
    this.setModelPlacement(null);
  }

  placeModelAtScreen(
    modelDocumentId: DocumentId,
    clientX: number,
    clientY: number,
  ): ObjectId | null {
    if (!this.host || !this.session || this.session.document.kind !== 'level') return null;
    const host = this.host.getBoundingClientRect();
    const localX = clientX - host.left;
    const localY = clientY - host.top;
    const paneId = this.lastRects.find(
      (rect) =>
        localX >= rect.x &&
        localX <= rect.x + rect.width &&
        localY >= rect.y &&
        localY <= rect.y + rect.height,
    )?.id;
    if (!paneId) return null;
    const pointer = new PointerEvent('pointermove', { clientX, clientY });
    const input = this.pointerInput(pointer, paneId);
    const surface = this.modelPlacementSurface(input);
    if (!surface) return null;
    const point = { ...surface.point };
    point.y += modelDocumentBaseOffset(this.session.project, modelDocumentId);
    const objectId = commitPlaceModelInLevel(this.session, modelDocumentId, { position: point });
    if (objectId) {
      this.markPlacedModelTerrainMetadata(objectId, modelDocumentId, surface.terrainObjectId);
      this.session.requestRedraw();
      this.invalidate();
    }
    return objectId;
  }

  private modelPlacementSurface(
    input: ToolPointerInput,
  ): { point: Vec3; terrainObjectId: ObjectId | null } | null {
    if (!this.session) return null;
    let point: Vec3 | null = null;
    let terrainObjectId: ObjectId | null = null;
    let nearest = Infinity;
    const raycaster = new Raycaster(
      new Vector3(input.rayOrigin.x, input.rayOrigin.y, input.rayOrigin.z),
      new Vector3(input.rayDirection.x, input.rayDirection.y, input.rayDirection.z),
    );
    for (const object of this.session.document.objects.values()) {
      if (object.metadata.terrain !== 'true') continue;
      const handle = this.handles.get(object.id);
      const hit = handle ? raycaster.intersectObject(handle.mesh, false)[0] : null;
      if (hit && hit.distance < nearest) {
        nearest = hit.distance;
        point = v3(hit.point.x, hit.point.y, hit.point.z);
        terrainObjectId = object.id;
      }
    }
    point ??= rayPlaneIntersection(input.rayOrigin, input.rayDirection, WORLD_XZ_PLANE);
    return point ? { point, terrainObjectId } : null;
  }

  private markPlacedModelTerrainMetadata(
    objectId: ObjectId,
    modelDocumentId: DocumentId,
    terrainObjectId: ObjectId | null,
  ): void {
    if (!this.session || !terrainObjectId) return;
    const object = this.session.document.objects.get(objectId);
    if (!object) return;
    object.metadata = {
      ...object.metadata,
      terrainPlaced: 'true',
      terrainOwnerId: terrainObjectId,
      terrainSourceModelId: modelDocumentId,
      terrainBaseOffset: String(modelDocumentBaseOffset(this.session.project, modelDocumentId)),
      terrainGroundClearance: '0',
      terrainHeightOffset: '0',
      terrainAlignToSlope: 'false',
      terrainCollisionRadius: String(
        modelDocumentPlacementRadius(this.session.project, modelDocumentId),
      ),
    };
    this.session.document.dirty = true;
  }

  private tryPlaceModelAtPointer(e: PointerEvent, paneId: ViewId): boolean {
    if (!this.modelPlacement || !this.session || this.session.document.kind !== 'level') return false;
    if (e.button !== 0 || e.ctrlKey || e.metaKey || e.altKey) return false;

    const input = this.pointerInput(e, paneId);
    const surface = this.modelPlacementSurface(input);
    if (!surface) return false;
    const point = { ...surface.point };

    const snap = this.session.document.settings.snapIncrement ?? 0.25;
    if (snap > 0 && !surface.terrainObjectId) {
      point.x = Math.round(point.x / snap) * snap;
      point.y = Math.round(point.y / snap) * snap;
      point.z = Math.round(point.z / snap) * snap;
    }

    const request = this.modelPlacement;
    point.y += modelDocumentBaseOffset(this.session.project, request.modelDocumentId);
    const objectId = commitPlaceModelInLevel(this.session, request.modelDocumentId, { position: point });
    if (!objectId) return false;
    this.markPlacedModelTerrainMetadata(
      objectId,
      request.modelDocumentId,
      surface.terrainObjectId,
    );

    this.session.tools.setActive('select', this.session.context());
    this.setModelPlacement(null);
    request.onPlaced?.();
    this.session.requestRedraw();
    this.invalidate();
    return true;
  }
}

/** App-wide viewport singleton. */
export const viewportEngine = new ViewportEngine();

function crossSectionHandlePoint(
  operation: CurveOperation,
  kind: Extract<CurveControlTarget['kind'], 'scale-start' | 'scale-mid' | 'scale-end'>,
): Vec3 {
  const index =
    kind === 'scale-start'
      ? 0
      : kind === 'scale-mid'
        ? Math.floor((operation.points.length - 1) / 2)
        : operation.points.length - 1;
  const scale =
    kind === 'scale-start'
      ? operation.startScale
      : kind === 'scale-mid'
        ? operation.midScale
        : operation.endScale;
  const point = operation.points[index]!;
  return v3(
    point.x + operation.radius * operation.profileWidth * scale,
    point.y,
    point.z,
  );
}

function createTerrainBrushPreview(): LineLoop {
  const points: Vector3[] = [];
  const segments = 64;
  for (let index = 0; index < segments; index++) {
    const angle = (index / segments) * Math.PI * 2;
    points.push(new Vector3(Math.cos(angle), 0, Math.sin(angle)));
  }
  const geometry = new BufferGeometry().setFromPoints(points);
  const material = new LineBasicMaterial({
    color: 0xff8c28,
    depthTest: false,
    depthWrite: false,
    transparent: true,
    opacity: 0.95,
  });
  const preview = new LineLoop(geometry, material);
  preview.name = 'Terrain Brush';
  preview.renderOrder = 1000;
  preview.visible = false;
  return preview;
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    viewportEngine.detach();
  });
}

type PointerHit = {
  objectId: ObjectId;
  handle: ObjectRenderHandle;
  mesh: EditableMesh;
  faceId: FaceId | null;
  pane: Pane;
  viewport: ViewportRect;
  pointer: { x: number; y: number };
};

function projectVertex(
  mesh: EditableMesh,
  handle: ObjectRenderHandle,
  camera: Camera,
  viewport: ViewportRect,
  vertexId: VertexId,
): { x: number; y: number } | null {
  const p = mesh.vertices.get(vertexId)?.position;
  if (!p) return null;
  const q = handle.group.localToWorld(new Vector3(p.x, p.y, p.z)).project(camera);
  if (q.z < -1 || q.z > 1) return null;
  return {
    x: viewport.x + ((q.x + 1) * viewport.width) / 2,
    y: viewport.y + ((1 - q.y) * viewport.height) / 2,
  };
}

function pointSegmentDistance(
  p: { x: number; y: number },
  a: { x: number; y: number },
  b: { x: number; y: number },
): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0;
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}
