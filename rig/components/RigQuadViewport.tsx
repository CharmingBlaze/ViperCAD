import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Box3,
  BufferAttribute,
  BufferGeometry,
  Color,
  DirectionalLight,
  GridHelper,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  OrthographicCamera,
  PerspectiveCamera,
  Plane,
  Raycaster,
  Scene,
  SpotLight,
  SphereGeometry,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { ViewportNavToolbar, viewportNavToolbarRightInset } from '@/app/ViewportNavToolbar';
import { getObjectWorldMatrix } from '@/core/editor/Hierarchy';
import type { ModelDocument } from '@/core/document/types';
import { getActiveClip, getSkinBindingsForRig, readRigDocumentSettings } from '@/core/rig/RigDocument';
import {
  buildSkinnedMesh,
  updateSkinnedMeshPose,
  type RigSkinnedMesh,
} from '@/core/rig/SkinnedMeshBuilder';
import {
  applyRigMeshDisplayMode,
  applyStaticMeshDisplayMode,
  disposeRigMeshMaterials,
  disposeStaticRenderHandle,
  resolveObjectMaterials,
} from '@/core/rig/rigMeshDisplay';
import { createObjectRenderHandle, type ObjectRenderHandle } from '@/renderer/MeshRenderAdapter';
import { boneHeadTailWorld, boneWorldMatrix, orderedBoneIds } from '@/core/rig/boneMatrices';
import { sampledLocalTransforms } from '@/core/rig/keyframes';
import type { ViewId } from '@/workspace/types';
import type { ViewportRect } from '../RigWorkspace';
import {
  applySceneCameraTransform,
  createDefaultRigFillLights,
  createThreeLightForObject,
  listSceneCameras,
  readCameraFov,
} from '../scene/RigSceneAssets';
import {
  createRigPaneCameraState,
  syncOrthoProjection,
  type RigPaneCameraState,
} from '../viewport/rigPaneCameras';
import type { RigSession } from '../RigSession';
import {
  RIG_CAMERA_PANE,
  RIG_PANE_IDS,
  RIG_PERSP_PANE,
  RIG_VIEW_LABELS,
  type RigWorkspace,
} from '../RigWorkspace';

type Props = {
  session: RigSession;
  workspace: RigWorkspace;
  onLayoutChange?: () => void;
};

type MeshEntry = { rigMesh: RigSkinnedMesh; objectId: string; bindingId: string };
type StaticMeshEntry = { handle: ObjectRenderHandle; objectId: string };

const VIEW_IDS = RIG_PANE_IDS;

function createCameraGizmoGeometry(): BufferGeometry {
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

export function RigQuadViewport({ session, workspace, onLayoutChange }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const sessionRef = useRef(session);
  const workspaceRef = useRef(workspace);
  sessionRef.current = session;
  workspaceRef.current = workspace;

  const [rects, setRects] = useState<ViewportRect[]>([]);
  const [hovered, setHovered] = useState<ViewId | null>(null);
  const [mode, setMode] = useState(workspace.layoutMode);
  const [splits, setSplits] = useState({ ...workspace.splitsState });
  const [openViewMenu, setOpenViewMenu] = useState<ViewId | null>(null);
  const dividerDrag = useRef<{ startX: number; origin: number } | null>(null);
  const onLayoutChangeRef = useRef(onLayoutChange);
  onLayoutChangeRef.current = onLayoutChange;
  const syncUiRef = useRef<() => void>(() => {});

  const syncUi = useCallback(() => {
    const host = hostRef.current;
    if (host) {
      const bounds = host.getBoundingClientRect();
      setRects(workspace.computeViewportRects(Math.max(1, bounds.width), Math.max(1, bounds.height)));
    }
    setHovered(workspace.hoveredViewportId);
    setMode(workspace.layoutMode);
    setSplits({ ...workspace.splitsState });
    onLayoutChangeRef.current?.();
  }, [workspace]);
  syncUiRef.current = syncUi;

  useEffect(() => workspace.subscribe(syncUi), [workspace, syncUi]);

  useEffect(() => {
    if (!openViewMenu) return;
    const close = (event: PointerEvent) => {
      const target = event.target as HTMLElement;
      if (target.closest('.viewport-view-menu') || target.closest('.viewport-label')) return;
      setOpenViewMenu(null);
    };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [openViewMenu]);

  useEffect(() => {
    const mount = hostRef.current;
    if (!mount) return;

    const scene = new Scene();
    scene.background = new Color(0x0e1118);
    const renderer = new WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = 'srgb';
    mount.appendChild(renderer.domElement);

    for (const light of createDefaultRigFillLights()) scene.add(light);
    const grid = new GridHelper(8, 32, 0x3a4558, 0x222a38);
    scene.add(grid);

    const sceneLights = new Group();
    scene.add(sceneLights);

    const content = new Scene();
    scene.add(content);

    const paneStates = new Map<ViewId, RigPaneCameraState>();
    for (const id of VIEW_IDS) paneStates.set(id, createRigPaneCameraState(id));

    let activePane: ViewId = RIG_PERSP_PANE;
    const controls = new Map<ViewId, OrbitControls>();

    const syncControlEnabled = (viewId: ViewId) => {
      const ctrl = controls.get(viewId);
      if (!ctrl) return;
      ctrl.enabled = viewId === activePane
        && viewId === RIG_PERSP_PANE
        && !workspaceRef.current.getLookThroughCamera(viewId);
    };

    const rebindControls = (viewId: ViewId) => {
      controls.get(viewId)?.dispose();
      const state = paneStates.get(viewId)!;
      const ctrl = new OrbitControls(state.camera, renderer.domElement);
      ctrl.enableDamping = true;
      ctrl.dampingFactor = 0.08;
      ctrl.target.copy(state.target);
      controls.set(viewId, ctrl);
      syncControlEnabled(viewId);
    };
    for (const id of VIEW_IDS) rebindControls(id);

    const skinnedMeshes: MeshEntry[] = [];
    const staticMeshes: StaticMeshEntry[] = [];
    const boneLines: LineSegments[] = [];
    const gizmoMeshes: Mesh[] = [];
    const cameraGizmos: LineSegments[] = [];
    const cameraGizmoGeometry = createCameraGizmoGeometry();
    const raycaster = new Raycaster();
    const pointer = new Vector2();
    let painting = false;
    let draggingPose = false;
    let lastPoseX = 0;
    let lastPoseY = 0;
    let draggingGizmo: 'head' | 'tail' | null = null;
    const dragPlane = new Plane();
    const dragOffset = new Vector3();
    let lastDragHit: Vector3 | null = null;
    let needsFrame = true;
    let lastBindingCount = -1;

    const getCamera = (viewId: ViewId) => paneStates.get(viewId)!.camera;

    const syncPaneViewsFromWorkspace = () => {
      // Dual layout: camera pane is always look-through; persp stays perspective.
    };

    const ensureCameraPane = () => {
      const source = sessionRef.current.getSourceModel();
      if (!source) return;
      const cameras = listSceneCameras(source);
      if (cameras.length === 0) return;
      const current = workspaceRef.current.getLookThroughCamera(RIG_CAMERA_PANE);
      if (current && source.objects.get(current)?.kind === 'camera') return;
      const selected = sessionRef.current.selectedObjectId;
      const selectedCam = selected && source.objects.get(selected)?.kind === 'camera' ? selected : null;
      workspaceRef.current.setCameraPaneLookThrough(selectedCam ?? cameras[0]!.id);
    };

    const syncSceneLights = () => {
      while (sceneLights.children.length) {
        const child = sceneLights.children[0]!;
        sceneLights.remove(child);
      }
      const source = sessionRef.current.getSourceModel();
      if (!source) return;
      for (const object of source.objects.values()) {
        if (object.kind !== 'light') continue;
        const light = createThreeLightForObject(object, source);
        if (!light) continue;
        light.userData.rigSceneLight = object.id;
        sceneLights.add(light);
        if (light instanceof DirectionalLight || light instanceof SpotLight) {
          sceneLights.add(light.target);
        }
      }
    };

    const paneAtEvent = (event: PointerEvent): ViewId | null => {
      const hostRect = mount.getBoundingClientRect();
      const x = event.clientX - hostRect.left;
      const y = event.clientY - hostRect.top;
      return workspaceRef.current.hitTest(x, y, hostRect.width, hostRect.height);
    };

    const setPointerForPane = (event: PointerEvent, rect: ViewportRect) => {
      const hostRect = mount.getBoundingClientRect();
      const localX = event.clientX - hostRect.left - rect.x;
      const localY = event.clientY - hostRect.top - rect.y;
      pointer.x = (localX / Math.max(rect.width, 1)) * 2 - 1;
      pointer.y = -(localY / Math.max(rect.height, 1)) * 2 + 1;
    };

    const activeRect = (): ViewportRect | undefined => {
      const hostRect = mount.getBoundingClientRect();
      const all = workspaceRef.current.computeViewportRects(hostRect.width, hostRect.height);
      return all.find((rect) => rect.id === activePane) ?? all[0];
    };

    const frameToContent = (current: typeof session, viewId: ViewId = activePane) => {
      const box = new Box3();
      let hasContent = false;
      for (const entry of skinnedMeshes) {
        entry.rigMesh.mesh.updateMatrixWorld(true);
        box.expandByObject(entry.rigMesh.mesh);
        hasContent = true;
      }
      for (const entry of staticMeshes) {
        entry.handle.group.updateMatrixWorld(true);
        box.expandByObject(entry.handle.group);
        hasContent = true;
      }
      const settings = readRigDocumentSettings(current.rigDocument);
      const armature = settings.armatureId ? current.project.armatures.get(settings.armatureId) : null;
      if (armature) {
        const clip = getActiveClip(current.project, current.rigDocument);
        const locals = sampledLocalTransforms(armature, clip, current.playbackTime);
        const cache = new Map();
        for (const boneId of orderedBoneIds(armature)) {
          const bone = armature.bones.get(boneId);
          if (!bone) continue;
          const world = boneWorldMatrix(armature, boneId, locals, cache);
          const { head, tail } = boneHeadTailWorld(bone, world);
          box.expandByPoint(head);
          box.expandByPoint(tail);
          hasContent = true;
        }
      }
      if (!hasContent) return;
      const center = box.getCenter(new Vector3());
      const size = box.getSize(new Vector3());
      const radius = Math.max(size.x, size.y, size.z, 0.5) * 0.65;
      const state = paneStates.get(viewId)!;
      const cam = state.camera;
      const ctrl = controls.get(viewId)!;
      state.target.copy(center);
      ctrl.target.copy(center);
      cam.matrixAutoUpdate = true;
      if (cam instanceof PerspectiveCamera) {
        const distance = radius / Math.sin((cam.fov * Math.PI) / 360);
        cam.position.set(center.x + distance * 0.85, center.y + distance * 0.55, center.z + distance * 0.85);
      } else if (cam instanceof OrthographicCamera) {
        syncOrthoProjection(cam, 1, Math.max(radius * 2.2, 2));
        state.orthoHeight = Math.max(radius * 2.2, 2);
        const dir = new Vector3().subVectors(cam.position, ctrl.target).normalize();
        cam.position.copy(center.clone().add(dir.multiplyScalar(Math.max(radius * 2.5, 5))));
      }
      workspaceRef.current.setLookThroughCamera(viewId, null);
      syncControlEnabled(viewId);
      ctrl.update();
    };

    const rebuild = () => {
      for (const entry of skinnedMeshes) disposeRigMeshMaterials(entry.rigMesh);
      for (const entry of staticMeshes) disposeStaticRenderHandle(entry.handle);

      while (content.children.length) {
        const child = content.children[0]!;
        content.remove(child);
        disposeObject(child);
      }
      skinnedMeshes.length = 0;
      staticMeshes.length = 0;
      boneLines.length = 0;
      gizmoMeshes.length = 0;
      cameraGizmos.length = 0;

      syncSceneLights();
      ensureCameraPane();

      const current = sessionRef.current;
      current.ensureSetup();
      const doc = current.rigDocument;
      const settings = readRigDocumentSettings(doc);
      const armature = settings.armatureId ? current.project.armatures.get(settings.armatureId) : null;
      const source = current.getSourceModel();
      if (!armature) return;

      const bindings = getSkinBindingsForRig(current.project, doc);
      const boundObjectIds = new Set(bindings.map((binding) => binding.objectId));
      const displayMode = current.viewportDisplayMode;
      const weightPaint = current.editMode === 'weight' && !!current.selectedBoneId;

      for (const binding of bindings) {
        const mesh = current.project.meshes.get(binding.meshId);
        if (!mesh) continue;
        const materialContext = source
          ? resolveObjectMaterials(current.project, source, binding.objectId)
          : { materials: [], assets: { textures: current.project.textures, images: current.project.images } };
        const rigMesh = buildSkinnedMesh(mesh, binding, armature, materialContext);
        applyRigMeshDisplayMode(rigMesh, displayMode, {
          weightPaint,
          binding,
          boneId: current.selectedBoneId,
        });
        skinnedMeshes.push({ rigMesh, objectId: binding.objectId, bindingId: binding.id });
        content.add(rigMesh.mesh);
      }

      if (source) {
        for (const object of source.objects.values()) {
          if (!object.meshId || !object.visible || boundObjectIds.has(object.id)) continue;
          const mesh = current.project.meshes.get(object.meshId);
          if (!mesh) continue;
          const materialContext = resolveObjectMaterials(current.project, source, object.id);
          const handle = createObjectRenderHandle(
            object.id,
            mesh,
            materialContext.materials,
            materialContext.assets,
          );
          handle.mesh.material = applyStaticMeshDisplayMode(handle.materials, displayMode);
          const world = getObjectWorldMatrix(source, object.id);
          handle.group.matrixAutoUpdate = false;
          handle.group.matrix.copy(world);
          handle.group.matrixWorld.copy(world);
          staticMeshes.push({ handle, objectId: object.id });
          content.add(handle.group);
        }
      }

      for (const boneId of orderedBoneIds(armature)) {
        const geometry = new BufferGeometry();
        geometry.setAttribute('position', new BufferAttribute(new Float32Array(6), 3));
        const line = new LineSegments(geometry, new LineBasicMaterial({ color: 0xffcc66 }));
        line.userData.boneId = boneId;
        boneLines.push(line);
        content.add(line);
      }

      if (source) {
        for (const object of source.objects.values()) {
          if (object.kind !== 'camera' || !object.visible) continue;
          const world = getObjectWorldMatrix(source, object.id);
          const selected = current.selectedObjectId === object.id;
          const gizmo = new LineSegments(
            cameraGizmoGeometry,
            new LineBasicMaterial({ color: selected ? 0x66ccff : 0x4488aa }),
          );
          gizmo.matrixAutoUpdate = false;
          gizmo.matrix.copy(world);
          gizmo.matrixWorld.copy(world);
          gizmo.userData.objectId = object.id;
          cameraGizmos.push(gizmo);
          content.add(gizmo);
        }
      }

      if (current.editMode === 'edit' && current.selectedBoneId) {
        const headMesh = new Mesh(new SphereGeometry(0.035, 10, 10), new MeshBasicMaterial({ color: 0xff8844 }));
        const tailMesh = new Mesh(new SphereGeometry(0.03, 10, 10), new MeshBasicMaterial({ color: 0xffdd44 }));
        headMesh.userData.gizmo = 'head';
        tailMesh.userData.gizmo = 'tail';
        gizmoMeshes.push(headMesh, tailMesh);
        content.add(headMesh, tailMesh);
      }

      updatePose(current);
      const bindingCount = bindings.length;
      if ((needsFrame || (lastBindingCount === 0 && bindingCount > 0)) && (skinnedMeshes.length || staticMeshes.length || boneLines.length)) {
        frameToContent(current);
        needsFrame = false;
      }
      lastBindingCount = bindingCount;
    };

    const updatePose = (current: typeof session) => {
      const doc = current.rigDocument;
      const settings = readRigDocumentSettings(doc);
      const armature = settings.armatureId ? current.project.armatures.get(settings.armatureId) : null;
      if (!armature) return;
      const clip = getActiveClip(current.project, doc);
      const sourceDoc = settings.sourceModelDocumentId ? current.project.documents.get(settings.sourceModelDocumentId) : null;

      const applyMeshes = () => {
        if (sourceDoc) {
          const modelDoc = sourceDoc as ModelDocument;
          for (const entry of skinnedMeshes) {
            updateSkinnedMeshPose(entry.rigMesh, armature, clip, current.playbackTime);
            const world = getObjectWorldMatrix(modelDoc, entry.objectId);
            entry.rigMesh.mesh.matrixAutoUpdate = false;
            entry.rigMesh.mesh.matrix.copy(world);
            entry.rigMesh.mesh.updateMatrixWorld(true);
          }
        } else {
          for (const entry of skinnedMeshes) {
            updateSkinnedMeshPose(entry.rigMesh, armature, clip, current.playbackTime);
          }
        }
      };
      applyMeshes();

      const locals = sampledLocalTransforms(armature, clip, current.playbackTime);
      const cache = new Map();
      let selectedHead: Vector3 | null = null;
      let selectedTail: Vector3 | null = null;
      for (const line of boneLines) {
        const boneId = line.userData.boneId as string;
        const world = boneWorldMatrix(armature, boneId, locals, cache);
        const bone = armature.bones.get(boneId);
        if (!bone) continue;
        const { head, tail } = boneHeadTailWorld(bone, world);
        const positions = line.geometry.getAttribute('position') as BufferAttribute;
        positions.setXYZ(0, head.x, head.y, head.z);
        positions.setXYZ(1, tail.x, tail.y, tail.z);
        positions.needsUpdate = true;
        (line.material as LineBasicMaterial).color.set(current.selectedBoneId === boneId ? 0xff8844 : 0xffcc66);
        if (current.selectedBoneId === boneId) {
          selectedHead = new Vector3(head.x, head.y, head.z);
          selectedTail = new Vector3(tail.x, tail.y, tail.z);
        }
      }
      if (gizmoMeshes.length === 2 && selectedHead && selectedTail) {
        gizmoMeshes[0]!.position.copy(selectedHead);
        gizmoMeshes[1]!.position.copy(selectedTail);
      }

      if (sourceDoc) {
        const modelDoc = sourceDoc as ModelDocument;
        for (const gizmo of cameraGizmos) {
          const objectId = gizmo.userData.objectId as string;
          const world = getObjectWorldMatrix(modelDoc, objectId);
          gizmo.matrix.copy(world);
          gizmo.matrixWorld.copy(world);
          (gizmo.material as LineBasicMaterial).color.set(
            current.selectedObjectId === objectId ? 0x66ccff : 0x4488aa,
          );
        }
      }
    };

    let frameId = 0;
    const renderFrame = () => {
      frameId = requestAnimationFrame(renderFrame);
      updatePose(sessionRef.current);
      const width = mount.clientWidth;
      const height = mount.clientHeight;
      if (width < 1 || height < 1) return;
      renderer.setSize(width, height, false);
      const paneRects = workspaceRef.current.computeViewportRects(width, height);
      const source = sessionRef.current.getSourceModel();
      renderer.setScissorTest(true);
      renderer.clear();
      for (const rect of paneRects) {
        if (rect.width < 2 || rect.height < 2) continue;
        const state = paneStates.get(rect.id)!;
        const camera = state.camera;
        const ctrl = controls.get(rect.id)!;
        const lookThroughId = rect.id === RIG_CAMERA_PANE
          ? workspaceRef.current.getLookThroughCamera(RIG_CAMERA_PANE)
          : workspaceRef.current.getLookThroughCamera(rect.id);
        const lookThroughObject = lookThroughId ? source?.objects.get(lookThroughId) : null;

        if (lookThroughObject?.kind === 'camera' && source) {
          ctrl.enabled = false;
          applySceneCameraTransform(camera, getObjectWorldMatrix(source, lookThroughId!));
          if (camera instanceof PerspectiveCamera) {
            camera.fov = readCameraFov(lookThroughObject);
            camera.aspect = rect.width / rect.height;
            camera.updateProjectionMatrix();
          }
        } else if (rect.id === RIG_CAMERA_PANE) {
          ctrl.enabled = false;
        } else {
          camera.matrixAutoUpdate = true;
          ctrl.enabled = rect.id === activePane;
          ctrl.update();
          if (camera instanceof PerspectiveCamera) {
            camera.aspect = rect.width / rect.height;
            camera.updateProjectionMatrix();
          } else if (camera instanceof OrthographicCamera) {
            syncOrthoProjection(camera, rect.width / rect.height, state.orthoHeight);
          }
        }

        renderer.setViewport(rect.x, rect.webglY, rect.width, rect.height);
        renderer.setScissor(rect.x, rect.webglY, rect.width, rect.height);
        renderer.render(scene, camera);
      }
      renderer.setScissorTest(false);
    };

    const pickBone = (event: PointerEvent, current: typeof session) => {
      const rect = activeRect();
      if (!rect) return;
      setPointerForPane(event, rect);
      raycaster.setFromCamera(pointer, getCamera(activePane));
      raycaster.params.Line.threshold = 0.04;
      const cameraHit = raycaster.intersectObjects(cameraGizmos, false)[0];
      if (cameraHit?.object.userData.objectId) {
        current.selectObject(cameraHit.object.userData.objectId as string);
        return;
      }
      const hit = raycaster.intersectObjects(boneLines, false)[0];
      if (hit?.object.userData.boneId) current.selectBone(hit.object.userData.boneId as string);
    };

    const paintAt = (event: PointerEvent, current: typeof session) => {
      const rect = activeRect();
      if (!rect) return;
      setPointerForPane(event, rect);
      raycaster.setFromCamera(pointer, getCamera(activePane));
      const hit = raycaster.intersectObjects(skinnedMeshes.map((e) => e.rigMesh.mesh), false)[0];
      if (!hit) return;
      current.paintWeightsAt(hit.point);
      rebuild();
    };

    const onPointerDown = (event: PointerEvent) => {
      const pane = paneAtEvent(event);
      if (pane) {
        activePane = pane;
        workspaceRef.current.setActive(pane);
        for (const [id, ctrl] of controls) {
          ctrl.enabled = id === pane && id === RIG_PERSP_PANE && !workspaceRef.current.getLookThroughCamera(id);
        }
      }
      const current = sessionRef.current;
      if (current.editMode === 'weight' && current.selectedBoneId) {
        painting = true;
        paintAt(event, current);
        return;
      }
      if (current.editMode === 'edit' && gizmoMeshes.length) {
        const rect = activeRect();
        if (!rect) return;
        setPointerForPane(event, rect);
        raycaster.setFromCamera(pointer, getCamera(activePane));
        const gizmoHit = raycaster.intersectObjects(gizmoMeshes, false)[0];
        if (gizmoHit?.object.userData.gizmo) {
          draggingGizmo = gizmoHit.object.userData.gizmo as 'head' | 'tail';
          const normal = new Vector3();
          getCamera(activePane).getWorldDirection(normal);
          dragPlane.setFromNormalAndCoplanarPoint(normal, gizmoHit.point);
          dragOffset.copy(gizmoHit.point).sub(gizmoHit.object.position);
          lastDragHit = gizmoHit.point.clone();
          controls.get(activePane)!.enabled = false;
          return;
        }
      }
      if (current.editMode === 'pose' || current.editMode === 'edit') {
        pickBone(event, current);
        if (current.editMode === 'pose' && current.selectedBoneId) {
          draggingPose = true;
          lastPoseX = event.clientX;
          lastPoseY = event.clientY;
          controls.get(activePane)!.enabled = false;
        }
      }
    };

    const onPointerMove = (event: PointerEvent) => {
      const pane = paneAtEvent(event);
      if (pane) workspaceRef.current.setHovered(pane);
      if (draggingPose) {
        const deltaX = event.clientX - lastPoseX;
        const deltaY = event.clientY - lastPoseY;
        lastPoseX = event.clientX;
        lastPoseY = event.clientY;
        sessionRef.current.rotateSelectedBoneInPose(deltaX * 0.008, deltaY * 0.008);
        return;
      }
      if (draggingGizmo) {
        const rect = activeRect();
        if (!rect) return;
        setPointerForPane(event, rect);
        raycaster.setFromCamera(pointer, getCamera(activePane));
        const hit = new Vector3();
        if (!raycaster.ray.intersectPlane(dragPlane, hit)) return;
        hit.sub(dragOffset);
        const current = sessionRef.current;
        if (draggingGizmo === 'tail') {
          current.setSelectedBoneTailFromWorld({ x: hit.x, y: hit.y, z: hit.z });
        } else if (lastDragHit) {
          current.nudgeSelectedBoneHead({ x: hit.x - lastDragHit.x, y: hit.y - lastDragHit.y, z: hit.z - lastDragHit.z });
          lastDragHit.copy(hit);
        }
        return;
      }
      if (painting) paintAt(event, sessionRef.current);
    };

    const onPointerUp = () => {
      painting = false;
      if (draggingPose) {
        draggingPose = false;
        controls.get(activePane)!.enabled = activePane === RIG_PERSP_PANE
          && !workspaceRef.current.getLookThroughCamera(activePane);
      }
      if (draggingGizmo) {
        draggingGizmo = null;
        lastDragHit = null;
        controls.get(activePane)!.enabled = activePane === RIG_PERSP_PANE
          && !workspaceRef.current.getLookThroughCamera(activePane);
      }
    };

    rebuild();
    renderFrame();
    syncUiRef.current();
    syncPaneViewsFromWorkspace();
    const unsubSession = session.subscribe(rebuild);
    const unsubWorkspace = workspace.subscribe(() => {
      syncPaneViewsFromWorkspace();
      syncUiRef.current();
    });

    renderer.domElement.addEventListener('pointerdown', onPointerDown);
    renderer.domElement.addEventListener('dblclick', () => frameToContent(sessionRef.current));
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);

    const resize = new ResizeObserver(() => syncUiRef.current());
    resize.observe(mount);

    return () => {
      unsubSession();
      unsubWorkspace();
      cancelAnimationFrame(frameId);
      resize.disconnect();
      for (const ctrl of controls.values()) ctrl.dispose();
      renderer.domElement.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      renderer.dispose();
      grid.geometry.dispose();
      (grid.material as { dispose(): void }).dispose();
      cameraGizmoGeometry.dispose();
      mount.removeChild(renderer.domElement);
      while (content.children.length) {
        const child = content.children[0]!;
        content.remove(child);
        disposeObject(child);
      }
    };
  }, [session, workspace]);

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const drag = dividerDrag.current;
      const host = hostRef.current;
      if (!drag || !host) return;
      const rect = host.getBoundingClientRect();
      workspace.setVerticalSplit((e.clientX - rect.left) / Math.max(rect.width, 1));
      syncUi();
    };
    const onUp = () => { dividerDrag.current = null; };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [workspace, syncUi]);

  const sceneCameras = session.getSourceModel() ? listSceneCameras(session.getSourceModel()!) : [];

  const cameraPaneName = (): string => {
    const id = workspace.getLookThroughCamera(RIG_CAMERA_PANE);
    if (!id) return 'No camera';
    return session.getSourceModel()?.objects.get(id)?.name ?? 'Camera';
  };

  const showDivider = mode === 'dual';

  return (
    <div className="modelling-region rig-dual-viewport">
      <div ref={hostRef} className="modelling-canvas" />
      <div className={`viewport-chrome${openViewMenu ? ' is-menu-open' : ''}`}>
        {rects.map((r) => {
          const isCameraPane = r.id === RIG_CAMERA_PANE;
          const paneLabel = isCameraPane ? cameraPaneName() : RIG_VIEW_LABELS[RIG_PERSP_PANE];
          const projLabel = isCameraPane ? 'Camera View' : 'Perspective';
          return (
            <div
              key={r.id}
              className="viewport-chrome-pane"
              style={{ left: r.x, top: r.y, width: r.width, height: r.height }}
              onPointerEnter={() => workspace.setHovered(r.id)}
            >
              {isCameraPane ? (
                <button
                  type="button"
                  className={`viewport-label${hovered === r.id ? ' is-hover' : ''}${workspace.activeViewportId === r.id || mode === 'maximized' ? ' is-active' : ''}`}
                  style={{ left: 4, top: 7 }}
                  aria-haspopup="menu"
                  aria-expanded={openViewMenu === r.id}
                  aria-label="Select scene camera"
                  onPointerDown={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                  }}
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    setOpenViewMenu((current) => (current === r.id ? null : r.id));
                  }}
                >
                  <span className="viewport-name">{paneLabel}</span>
                  <span className="viewport-proj">{projLabel}</span>
                </button>
              ) : (
                <div
                  className={`viewport-label${hovered === r.id ? ' is-hover' : ''}${workspace.activeViewportId === r.id || mode === 'maximized' ? ' is-active' : ''}`}
                  style={{ left: 4, top: 7 }}
                >
                  <span className="viewport-name">{paneLabel}</span>
                  <span className="viewport-proj">{projLabel}</span>
                </div>
              )}
              {openViewMenu === r.id && isCameraPane && (
                <div
                  className="viewport-view-menu"
                  role="menu"
                  aria-label="Scene cameras"
                  style={{ left: 4, top: 29 }}
                  onPointerDown={(event) => event.stopPropagation()}
                >
                  {sceneCameras.length === 0 ? (
                    <p className="viewport-view-menu-empty">Add a camera from the Outliner</p>
                  ) : (
                    sceneCameras.map((camera) => (
                      <button
                        key={camera.id}
                        type="button"
                        role="menuitemradio"
                        aria-checked={workspace.getLookThroughCamera(RIG_CAMERA_PANE) === camera.id}
                        className={workspace.getLookThroughCamera(RIG_CAMERA_PANE) === camera.id ? 'is-selected' : ''}
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          workspace.setCameraPaneLookThrough(camera.id);
                          session.selectObject(camera.id);
                          setOpenViewMenu(null);
                          syncUi();
                        }}
                      >
                        <span>{camera.name}</span>
                        {workspace.getLookThroughCamera(RIG_CAMERA_PANE) === camera.id && <span aria-hidden>✓</span>}
                      </button>
                    ))
                  )}
                </div>
              )}
              <ViewportNavToolbar
                viewId={r.id}
                right={viewportNavToolbarRightInset(r.id, mode === 'maximized' ? 'maximized' : 'quad')}
                top={8}
                isPerspective={!isCameraPane}
                isMaximized={mode === 'maximized' && workspace.maximizedViewportId === r.id}
                navMode="none"
                navViewId={null}
                onSetNav={() => {}}
                onFrame={() => workspace.setActive(r.id)}
                onMaximize={(viewId) => workspace.toggleViewportMaximize(viewId)}
                onDrag={() => {}}
              />
            </div>
          );
        })}
      </div>
      {showDivider && (
        <div
          className="divider divider-v rig-viewport-divider"
          style={{ left: `${splits.vertical * 100}%`, top: 0, height: '100%' }}
          onPointerDown={(e) => {
            dividerDrag.current = { startX: e.clientX, origin: splits.vertical };
          }}
        />
      )}
    </div>
  );
}

function disposeObject(object: { geometry?: BufferGeometry; material?: unknown; children?: unknown[] }): void {
  object.geometry?.dispose();
  if (object.material) {
    const material = object.material;
    if (Array.isArray(material)) material.forEach((m) => (m as { dispose(): void }).dispose());
    else (material as { dispose(): void }).dispose();
  }
  if (object.children) {
    for (const child of object.children as typeof object[]) disposeObject(child);
  }
}
