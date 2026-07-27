import { useEffect, useRef } from 'react';
import {
  AmbientLight,
  Box3,
  BufferAttribute,
  BufferGeometry,
  Color,
  DirectionalLight,
  GridHelper,
  HemisphereLight,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  Plane,
  Raycaster,
  Scene,
  SphereGeometry,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
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
import {
  boneHeadTailWorld,
  boneWorldMatrix,
  orderedBoneIds,
} from '@/core/rig/boneMatrices';
import { sampledLocalTransforms } from '@/core/rig/keyframes';
import type { RigSession } from '../RigSession';

type Props = {
  session: RigSession;
};

type MeshEntry = {
  rigMesh: RigSkinnedMesh;
  objectId: string;
  bindingId: string;
};

type StaticMeshEntry = {
  handle: ObjectRenderHandle;
  objectId: string;
};

export function RigViewport({ session }: Props) {
  const mountRef = useRef<HTMLDivElement>(null);
  const sessionRef = useRef(session);
  sessionRef.current = session;

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const scene = new Scene();
    scene.background = new Color(0x0e1118);
    scene.fog = null;

    const camera = new PerspectiveCamera(45, 1, 0.01, 500);
    camera.position.set(2.4, 1.8, 2.6);

    const renderer = new WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = 'srgb';
    mount.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.target.set(0, 0.95, 0);
    controls.update();

    scene.add(new HemisphereLight(0xdde8ff, 0x1a2030, 0.65));
    scene.add(new AmbientLight(0xffffff, 0.18));
    const key = new DirectionalLight(0xfff4e8, 1.05);
    key.position.set(4, 6, 3);
    scene.add(key);
    const fill = new DirectionalLight(0xa8c4ff, 0.35);
    fill.position.set(-3, 2, -2);
    scene.add(fill);

    const grid = new GridHelper(8, 32, 0x3a4558, 0x222a38);
    grid.position.y = 0;
    scene.add(grid);

    const content = new Scene();
    scene.add(content);

    const skinnedMeshes: MeshEntry[] = [];
    const staticMeshes: StaticMeshEntry[] = [];
    const boneLines: LineSegments[] = [];
    const gizmoMeshes: Mesh[] = [];
    const raycaster = new Raycaster();
    const pointer = new Vector2();
    let painting = false;
    let draggingGizmo: 'head' | 'tail' | null = null;
    let dragPlane = new Plane();
    let dragOffset = new Vector3();
    let lastDragHit: Vector3 | null = null;
    let needsFrame = true;
    let lastBindingCount = -1;

    const frameToContent = (current: typeof session) => {
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

      const doc = current.rigDocument;
      const settings = readRigDocumentSettings(doc);
      const armature = settings.armatureId ? current.project.armatures.get(settings.armatureId) : null;
      if (armature) {
        const clip = getActiveClip(current.project, doc);
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
      const distance = radius / Math.sin((camera.fov * Math.PI) / 360);

      controls.target.copy(center);
      camera.position.set(
        center.x + distance * 0.85,
        center.y + distance * 0.55,
        center.z + distance * 0.85,
      );
      controls.update();
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

      const current = sessionRef.current;
      current.ensureSetup();
      const doc = current.rigDocument;
      const settings = readRigDocumentSettings(doc);
      const armature = settings.armatureId ? current.project.armatures.get(settings.armatureId) : null;
      if (!armature) return;

      const source = current.getSourceModel();
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
        const line = new LineSegments(
          geometry,
          new LineBasicMaterial({ color: 0xffcc66, transparent: true, opacity: 0.95 }),
        );
        line.userData.boneId = boneId;
        boneLines.push(line);
        content.add(line);
      }

      if (current.editMode === 'edit' && current.selectedBoneId) {
        const headGeo = new SphereGeometry(0.035, 10, 10);
        const tailGeo = new SphereGeometry(0.03, 10, 10);
        const headMat = new MeshBasicMaterial({ color: 0xff8844, depthTest: true });
        const tailMat = new MeshBasicMaterial({ color: 0xffdd44, depthTest: true });
        const headMesh = new Mesh(headGeo, headMat);
        const tailMesh = new Mesh(tailGeo, tailMat);
        headMesh.userData.gizmo = 'head';
        tailMesh.userData.gizmo = 'tail';
        gizmoMeshes.push(headMesh, tailMesh);
        content.add(headMesh);
        content.add(tailMesh);
      }

      updatePose(current);
      const bindingCount = bindings.length;
      const shouldFrame =
        needsFrame || (lastBindingCount === 0 && bindingCount > 0);
      lastBindingCount = bindingCount;
      if (shouldFrame && (skinnedMeshes.length > 0 || staticMeshes.length > 0 || boneLines.length > 0)) {
        frameToContent(current);
        needsFrame = false;
      }
    };

    const updatePose = (current: typeof session) => {
      const doc = current.rigDocument;
      const settings = readRigDocumentSettings(doc);
      const armature = settings.armatureId ? current.project.armatures.get(settings.armatureId) : null;
      if (!armature) return;
      const clip = getActiveClip(current.project, doc);
      const sourceDoc = settings.sourceModelDocumentId
        ? current.project.documents.get(settings.sourceModelDocumentId)
        : null;

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
        const selected = current.selectedBoneId === boneId;
        (line.material as LineBasicMaterial).color.set(selected ? 0xff8844 : 0xffcc66);
        if (selected) {
          selectedHead = new Vector3(head.x, head.y, head.z);
          selectedTail = new Vector3(tail.x, tail.y, tail.z);
        }
      }

      if (gizmoMeshes.length === 2 && selectedHead && selectedTail) {
        gizmoMeshes[0]!.position.copy(selectedHead);
        gizmoMeshes[1]!.position.copy(selectedTail);
      }
    };

    let frameId = 0;
    const renderFrame = () => {
      frameId = requestAnimationFrame(renderFrame);
      controls.update();
      updatePose(sessionRef.current);
      const width = mount.clientWidth;
      const height = mount.clientHeight;
      if (width > 0 && height > 0) {
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
        renderer.setSize(width, height, false);
      }
      renderer.render(scene, camera);
    };

    const setPointer = (event: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    };

    const intersectPlane = (event: PointerEvent): Vector3 | null => {
      setPointer(event);
      raycaster.setFromCamera(pointer, camera);
      const hit = new Vector3();
      return raycaster.ray.intersectPlane(dragPlane, hit) ? hit : null;
    };

    const pickBone = (event: PointerEvent, current: typeof session) => {
      setPointer(event);
      raycaster.params.Line.threshold = 0.04;
      raycaster.setFromCamera(pointer, camera);
      const hits = raycaster.intersectObjects(boneLines, false);
      const hit = hits[0];
      if (hit?.object.userData.boneId) {
        current.selectBone(hit.object.userData.boneId as string);
      }
    };

    const paintAt = (event: PointerEvent, current: typeof session) => {
      setPointer(event);
      raycaster.setFromCamera(pointer, camera);
      const hits = raycaster.intersectObjects(skinnedMeshes.map((entry) => entry.rigMesh.mesh), false);
      const hit = hits[0];
      if (!hit) return;
      current.paintWeightsAt(hit.point);
      rebuild();
    };

    const onPointerDown = (event: PointerEvent) => {
      const current = sessionRef.current;
      if (current.editMode === 'weight' && current.selectedBoneId) {
        painting = true;
        paintAt(event, current);
        return;
      }

      if (current.editMode === 'edit' && gizmoMeshes.length) {
        setPointer(event);
        raycaster.setFromCamera(pointer, camera);
        const gizmoHits = raycaster.intersectObjects(gizmoMeshes, false);
        const gizmoHit = gizmoHits[0];
        if (gizmoHit?.object.userData.gizmo) {
          draggingGizmo = gizmoHit.object.userData.gizmo as 'head' | 'tail';
          const normal = new Vector3();
          camera.getWorldDirection(normal);
          dragPlane.setFromNormalAndCoplanarPoint(normal, gizmoHit.point);
          dragOffset.copy(gizmoHit.point).sub(gizmoHit.object.position);
          lastDragHit = gizmoHit.point.clone();
          controls.enabled = false;
          return;
        }
      }

      if (current.editMode === 'pose' || current.editMode === 'edit') {
        pickBone(event, current);
      }
    };

    const onPointerMove = (event: PointerEvent) => {
      if (draggingGizmo) {
        const current = sessionRef.current;
        const hit = intersectPlane(event);
        if (!hit) return;
        hit.sub(dragOffset);
        if (draggingGizmo === 'tail') {
          current.setSelectedBoneTailFromWorld({ x: hit.x, y: hit.y, z: hit.z });
        } else if (lastDragHit) {
          current.nudgeSelectedBoneHead({
            x: hit.x - lastDragHit.x,
            y: hit.y - lastDragHit.y,
            z: hit.z - lastDragHit.z,
          });
          lastDragHit.copy(hit);
        }
        return;
      }
      if (!painting) return;
      paintAt(event, sessionRef.current);
    };

    const onPointerUp = () => {
      painting = false;
      if (draggingGizmo) {
        draggingGizmo = null;
        lastDragHit = null;
        controls.enabled = true;
      }
    };

    const onDoubleClick = () => {
      frameToContent(sessionRef.current);
    };

    rebuild();
    renderFrame();
    const unsubscribe = session.subscribe(rebuild);

    renderer.domElement.addEventListener('pointerdown', onPointerDown);
    renderer.domElement.addEventListener('dblclick', onDoubleClick);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);

    const resize = new ResizeObserver(() => {
      const width = mount.clientWidth;
      const height = mount.clientHeight;
      if (width > 0 && height > 0) {
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
        renderer.setSize(width, height, false);
      }
    });
    resize.observe(mount);

    return () => {
      unsubscribe();
      cancelAnimationFrame(frameId);
      resize.disconnect();
      controls.dispose();
      renderer.domElement.removeEventListener('pointerdown', onPointerDown);
      renderer.domElement.removeEventListener('dblclick', onDoubleClick);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      renderer.dispose();
      scene.remove(grid);
      grid.geometry.dispose();
      (grid.material as { dispose(): void }).dispose();
      mount.removeChild(renderer.domElement);
      while (content.children.length) {
        const child = content.children[0]!;
        content.remove(child);
        disposeObject(child);
      }
    };
  }, [session]);

  return <div className="rig-viewport" ref={mountRef} />;
}

function disposeObject(object: { geometry?: BufferGeometry; material?: unknown; children?: unknown[] }): void {
  object.geometry?.dispose();
  if (object.material) {
    const material = object.material;
    if (Array.isArray(material)) material.forEach((entry) => (entry as { dispose(): void }).dispose());
    else (material as { dispose(): void }).dispose();
  }
  if (object.children) {
    for (const child of object.children as typeof object[]) disposeObject(child);
  }
}
