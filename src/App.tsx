import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { viewportEngine } from '@/app/viewportEngine';
import { TerrainPanel, type TerrainPanelTab } from '@/app/TerrainPanel';
import { SculptPanel } from '@/app/SculptPanel';
import { LeftToolbar } from '@/app/LeftToolbar';
import { RightSidebar } from '@/app/RightSidebar';
import { UvInspectorHostProvider } from '@/app/UvInspectorHost';
import { BlenderIcon } from '@/components/BlenderIcon';
import { FloatingTerrainObjects } from '@/app/FloatingTerrainObjects';
import { Viewport } from '@/app/Viewport';
import { FloatingOutliner } from '@/app/FloatingOutliner';
import {
  EXPORT_PROFILES,
  exportDiagnostics,
  type ExportProfile,
} from '@/app/GameExportProfiles';
import { EditorSession } from '@/core/editor/EditorSession';
import { preloadDefaultPlaceholderImage } from '@/core/image/DefaultPlaceholderImage';
import { beginBlenderOperator } from '@/app/blender/BlenderControlEngine';
import { masterInputEngine } from '@/app/input/MasterInputEngine';
import { PRIMITIVE_LABELS } from '@/core/primitives/PrimitiveFactory';
import { CreateDoodleTool } from '@/core/tools/CreateDoodleTool';
import { CreatePrimitiveTool } from '@/core/tools/CreatePrimitiveTool';
import { DrawPolyTool } from '@/core/tools/DrawPolyTool';
import { TerrainSculptTool } from '@/core/tools/TerrainSculptTool';
import { MeshSculptTool } from '@/core/tools/MeshSculptTool';
import { TerrainObjectTool } from '@/core/tools/TerrainObjectTool';
import { TerrainFeatureTool } from '@/core/tools/TerrainFeatureTool';
import { activateTerrainWorkspaceTool } from '@/app/terrainWorkspace';
import { resolveTerrainAsset } from '@/core/terrain/Terrain';
import { sculptableObjects } from '@/core/sculpt/MeshSculptTarget';
import type { GizmoMode, TransformOrientation, TransformPivotMode } from '@/core/transform/types';
import { WorkspaceController } from '@/workspace/WorkspaceController';
import { VIEW_LABELS, SHADING_MODE_LABELS, type ShadingMode } from '@/workspace/types';
import { APP_VERSION } from '@/app/appVersion';
import { registerProjectCapture } from '@/app/crashRecovery';
import { serializeProject, serializeViperProject } from '@/core/persistence/ProjectSerializer';
import { firstMeshValidationError, inspectDocumentHealth, openViperProjectText } from '@/core/persistence/projectHealth';
import { validateMeshFull } from '@/core/mesh/Validation';
import { exportObj, importObj } from '@/core/io/ObjAdapter';
import { commitMeshObject } from '@/core/document/ModelDocument';
import { createEmptyProject, clearProjectDirty, projectIsDirty } from '@/core/document/ViperProject';
import { DocumentTabs } from '@/app/DocumentTabs';
import { enterGroupFocus, exitGroupFocus, exitToDocumentRoot } from '@/core/editor/GroupFocus';
import { placeModelQuick } from '@/app/outliner/placeModelWorkflow';
import { modelHasPlaceableGeometry } from '@/core/editor/ModelInstances';
import { getViperDocument } from '@/core/document/ViperProject';
import { isGroupObject } from '@/core/editor/Hierarchy';
import { ensurePaintableUvs } from '@/core/uv/EnsurePaintableUvs';
import { commitCopySelection, commitPasteClipboard } from '@/core/editor/Clipboard';
import {
  commitGroupSelection,
  commitUngroupSelection,
} from '@/core/editor/HierarchyCommands';
import { AutosaveRecoveryDialog } from '@/app/AutosaveRecoveryDialog';
import { type RecoveryControlsState } from '@/app/AppInspectorPanel';
import { HotkeyHelpOverlay } from '@/app/HotkeyHelpOverlay';
import { ToastStack, pushToast, useToasts } from '@/app/Toast';
import { usePanelResizer } from '@/app/usePanelResizer';
import { AnimationSession } from '@/app/animation/AnimationSession';
import { AnimationClipsPanel } from '@/app/animation/AnimationClipsPanel';
import { AnimationInspectorPanel } from '@/app/animation/AnimationInspectorPanel';
import { RiggingPanel } from '@/app/animation/RiggingPanel';
import { BlockoutPanel } from '@/app/blockout/BlockoutPanel';
import { lockBlockoutReferences } from '@/core/blockout/BlockoutReferenceObject';
import type { BlockoutVectorTool } from '@/core/tools/BlockoutVectorTool';
import type { BlockoutSolidTool } from '@/core/tools/BlockoutSolidTool';
import type { BlockoutRoundTool } from '@/core/tools/BlockoutRoundTool';
import { DopeSheet } from '@/app/animation/DopeSheet';
import { AnimationBar } from '@/app/animation/AnimationBar';
import { getActiveClip } from '@/core/rig/RigDocument';
import {
  clearAutomaticAutosaves,
  clearAutosave,
  readAutosaves,
  writeAutosave,
  writeEmergencyAutosave,
  writeNamedAutosave,
  type AutosavePayload,
} from '@/app/autosave';
import {
  chooseNativeSaveTarget,
  MODEL_IMPORT_FILES,
  openNativeFile,
  VIPER_PROJECT_FILE,
  writeNativeFile,
  type FileDialogType,
  type FileToken,
} from '@/app/platform/FileDialogs';
import {
  DesktopMenuBar,
  type DesktopMenuDefinition,
} from '@/app/DesktopMenuBar';
import { CommandPalette } from '@/app/CommandPalette';
import { flattenMenuCommands } from '@/app/paletteCommands';
import {
  applyWorkspaceTheme,
  readStoredTheme,
  WORKSPACE_THEMES,
  type WorkspaceThemeId,
} from '@/app/theme/themeTokens';
import './App.css';
import '@/app/animation/animation.css';

const TIMELINE_HEIGHT_MIN = 120;
const TIMELINE_HEIGHT_DEFAULT = 220;
const TIMELINE_HEIGHT_MAX_RATIO = 0.55;

function clampTimelineHeight(height: number, containerHeight: number): number {
  const max = Math.max(TIMELINE_HEIGHT_MIN, containerHeight * TIMELINE_HEIGHT_MAX_RATIO);
  return Math.min(max, Math.max(TIMELINE_HEIGHT_MIN, height));
}

preloadDefaultPlaceholderImage();

export default function App() {
  const session = useMemo(() => new EditorSession(), []);
  const workspace = useMemo(() => new WorkspaceController(), []);
  const animation = useMemo(() => new AnimationSession(session), [session]);
  const [, setTick] = useState(0);
  const [outlinerOpen, setOutlinerOpen] = useState(false);
  const [outlinerTab, setOutlinerTab] = useState<'scene' | 'models' | 'levels'>('scene');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [zenMode, setZenMode] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [themeId, setThemeId] = useState<WorkspaceThemeId>(() => readStoredTheme());
  const [terrainObjectsOpen, setTerrainObjectsOpen] = useState(false);
  const [terrainFocusTab, setTerrainFocusTab] = useState<TerrainPanelTab | null>(null);
  const [timelineOpen, setTimelineOpen] = useState(true);
  const [timelineHeight, setTimelineHeight] = useState(TIMELINE_HEIGHT_DEFAULT);
  const workspaceStackRef = useRef<HTMLDivElement>(null);
  const timelineDragRef = useRef(false);

  const [animClipsOpen, setAnimClipsOpen] = useState(() => {
    try {
      const stored = localStorage.getItem('vipercad:anim-clips-open');
      return stored !== null ? stored === 'true' : true;
    } catch {
      return true;
    }
  });
  const [animInspectorOpen, setAnimInspectorOpen] = useState(() => {
    try {
      const stored = localStorage.getItem('vipercad:anim-inspector-open');
      return stored !== null ? stored === 'true' : true;
    } catch {
      return true;
    }
  });
  const [rigPanelOpen, setRigPanelOpen] = useState(() => {
    try {
      const stored = localStorage.getItem('vipercad:rig-panel-open');
      return stored !== null ? stored === 'true' : true;
    } catch {
      return true;
    }
  });

  const toggleAnimClips = useCallback(() => {
    setAnimClipsOpen((open) => {
      const next = !open;
      try {
        localStorage.setItem('vipercad:anim-clips-open', String(next));
      } catch {}
      return next;
    });
  }, []);

  const toggleAnimInspector = useCallback(() => {
    setAnimInspectorOpen((open) => {
      const next = !open;
      try {
        localStorage.setItem('vipercad:anim-inspector-open', String(next));
      } catch {}
      return next;
    });
  }, []);

  const toggleRigPanel = useCallback(() => {
    setRigPanelOpen((open) => {
      const next = !open;
      try {
        localStorage.setItem('vipercad:rig-panel-open', String(next));
      } catch {}
      return next;
    });
  }, []);

  const animClipsResizer = usePanelResizer({
    storageKey: 'vipercad:anim-clips-width',
    defaultWidth: 260,
    minWidth: 180,
    maxWidth: 520,
    side: 'left',
  });

  const animInspectorResizer = usePanelResizer({
    storageKey: 'vipercad:anim-inspector-width',
    defaultWidth: 280,
    minWidth: 200,
    maxWidth: 560,
    side: 'right',
  });

  const rigPanelResizer = usePanelResizer({
    storageKey: 'vipercad:rig-panel-width',
    defaultWidth: 320,
    minWidth: 240,
    maxWidth: 600,
    side: 'right',
  });

  const [autosaveOffers, setAutosaveOffers] = useState<AutosavePayload[]>([]);
  const [promptRecoveryOnStartup, setPromptRecoveryOnStartup] = useState<boolean>(() => {
    try {
      const stored = localStorage.getItem('vipercad:prompt-recovery-on-startup');
      return stored === null ? true : stored === 'true';
    } catch {
      return false;
    }
  });
  const [recoveryModalOpen, setRecoveryModalOpen] = useState(false);
  const [hotkeysOpen, setHotkeysOpen] = useState(false);
  const [exportProfileId, setExportProfileId] = useState<ExportProfile['id']>('godot');
  const projectFileToken = useRef<FileToken | null>(null);
  const toasts = useToasts();
  const refresh = () => setTick((t) => t + 1);

  useEffect(() => session.onRedraw(refresh), [session]);
  useEffect(() => workspace.subscribe(refresh), [workspace]);
  useEffect(() => animation.subscribe(refresh), [animation]);
  useEffect(() => {
    viewportEngine.setAnimationSession(animation);
    return () => viewportEngine.setAnimationSession(null);
  }, [animation]);

  useEffect(() => {
    let frame = 0;
    let last = performance.now();
    const loop = (now: number) => {
      frame = requestAnimationFrame(loop);
      if (!animation.playing) {
        last = now;
        return;
      }
      animation.advancePlayback((now - last) / 1000);
      last = now;
    };
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, [animation]);

  useEffect(() => {
    if (!timelineOpen || workspace.shellMode !== 'animate') return;
    const onMove = (event: PointerEvent) => {
      if (!timelineDragRef.current) return;
      const stack = workspaceStackRef.current;
      if (!stack) return;
      const rect = stack.getBoundingClientRect();
      setTimelineHeight(clampTimelineHeight(rect.bottom - event.clientY, rect.height));
    };
    const onUp = () => { timelineDragRef.current = false; };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [timelineOpen, workspace.shellMode]);

  useEffect(() => {
    if (workspace.shellMode === 'model') session.ensureDocumentKind('model');
    else if (workspace.shellMode === 'terrain') session.ensureDocumentKind('level');
    refresh();
  }, [session, workspace]);

  useEffect(() => {
    let active = true;
    void readAutosaves().then((existing) => {
      if (active) {
        setAutosaveOffers(existing);
        if (promptRecoveryOnStartup && existing.length > 0) {
          setRecoveryModalOpen(true);
        }
      }
    });
    return () => { active = false; };
  }, [promptRecoveryOnStartup]);

  useEffect(() => {
    const snapshot = () => {
      try {
        return serializeViperProject(session.project, APP_VERSION);
      } catch {
        return serializeProject(session.document, APP_VERSION);
      }
    };
    registerProjectCapture(snapshot);
    const timer = window.setInterval(() => {
      if (!projectIsDirty(session.project)) return;
      void writeAutosave(snapshot(), session.project.name || 'Autosave');
    }, 5000);
    const onHide = () => {
      if (!projectIsDirty(session.project)) return;
      try {
        writeEmergencyAutosave(snapshot(), 'Hidden tab');
      } catch {
        /* ignore */
      }
    };
    document.addEventListener('visibilitychange', onHide);
    return () => {
      registerProjectCapture(null);
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onHide);
    };
  }, [session]);

  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!projectIsDirty(session.project)) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [session]);

  useEffect(() => {
    masterInputEngine.attach(window);
    return () => masterInputEngine.detach();
  }, []);

  const confirmReplaceDirtyProject = () =>
    !projectIsDirty(session.project) ||
    window.confirm('Discard unsaved changes and replace the current project?');

  const newProject = () => {
    if (!confirmReplaceDirtyProject()) return;
    session.loadProject(createEmptyProject());
    if (workspace.shellMode === 'model') session.ensureDocumentKind('model');
    else if (workspace.shellMode === 'terrain') session.ensureDocumentKind('level');
    projectFileToken.current = null;
    void clearAutomaticAutosaves();
    pushToast(
      workspace.shellMode === 'model'
        ? 'New project — Untitled Model is active'
        : 'New project — Main Level is active',
      'success',
    );
    refresh();
  };

  const toggleOutliner = () => {
    setOutlinerOpen((open) => !open);
    refresh();
  };

  const saveProject = async (saveAs = false) => {
    try {
      const health = inspectDocumentHealth(session.document);
      if (!health.ok) {
        pushToast(health.errors[0] ?? 'Project failed validation', 'error');
        return;
      }
      const target = await chooseNativeSaveTarget({
        suggestedName: `${session.document.name || 'Untitled'}.viper`,
        types: [VIPER_PROJECT_FILE],
        existing: saveAs ? null : projectFileToken.current,
      });
      if (!target) return;
      await writeNativeFile(
        target,
        serializeViperProject(session.project, APP_VERSION),
        'application/json',
      );
      projectFileToken.current = target.token;
      session.project.name = target.name.replace(/\.viper$/i, '') || session.project.name;
      clearProjectDirty(session.project);
      void clearAutomaticAutosaves();
      pushToast(`Saved ${target.name}`, 'success');
      refresh();
    } catch (error) {
      pushToast(error instanceof Error ? error.message : 'Could not save project', 'error');
    }
  };

  const openProjectDialog = async () => {
    if (!confirmReplaceDirtyProject()) return;
    try {
      const selected = await openNativeFile({ types: [VIPER_PROJECT_FILE] });
      if (!selected) return;
      const { project, activeDocumentId } = openViperProjectText(await selected.file.text());
      session.loadProject(project, activeDocumentId);
      session.project.name = selected.file.name.replace(/\.(?:viper|json)$/i, '') || session.project.name;
      projectFileToken.current = selected.token;
      void clearAutomaticAutosaves();
      pushToast(`Opened ${selected.file.name}`, 'success');
      refresh();
    } catch (error) {
      pushToast(error instanceof Error ? error.message : 'Failed to open project', 'error');
    }
  };

  useEffect(() => {
    masterInputEngine.setContext({
      session,
      workspace,
      viewport: {
        getCameraAxes: (id) => viewportEngine.getCameraAxes(id),
        getLastPointerSample: (id) => viewportEngine.getLastPointerSample(id),
        syncTransformInteractionState: () => viewportEngine.syncTransformInteractionState(),
        syncLiveTransform: () => viewportEngine.syncLiveTransform(),
        syncGizmo: () => viewportEngine.syncGizmo(),
        invalidate: () => viewportEngine.invalidate(),
        frameSelection: () => viewportEngine.frameSelection(),
        frameAll: () => viewportEngine.frameAll(),
        resetView: () => viewportEngine.resetView(),
        getModelPlacement: () => viewportEngine.getModelPlacement(),
        cancelModelPlacement: () => viewportEngine.cancelModelPlacement(),
        syncInputControls: () => viewportEngine.syncInputControls(),
      },
      actions: {
        refresh,
        pushToast,
        setHotkeysOpen,
        setPaletteOpen,
        setZenMode,
        setSidebarCollapsed,
        newProject,
        saveProject: (saveAs) => void saveProject(saveAs),
        openProject: () => void openProjectDialog(),
        hotkeysOpen,
        zenMode,
        animation,
      },
    });
  }, [
    session,
    workspace,
    refresh,
    pushToast,
    hotkeysOpen,
    zenMode,
    animation,
    newProject,
    saveProject,
    openProjectDialog,
  ]);

  const importModelDialog = async () => {
    try {
      const selected = await openNativeFile({ types: MODEL_IMPORT_FILES });
      if (!selected) return;
      const file = selected.file;
      if (file.name.toLowerCase().endsWith('.obj')) {
        const text = await file.text();
        const mesh = importObj(text, file.name.replace(/\.obj$/i, ''));
        const importError = firstMeshValidationError(mesh);
        if (importError) throw new Error(importError);
        const { objectId } = commitMeshObject(session.document, mesh, { name: mesh.name });
        session.selection.setMode('object');
        session.selection.selectObjects([objectId], 'replace');
        session.requestRedraw();
      } else if (/\.gl(?:tf|b)$/i.test(file.name)) {
        const { importGltf } = await import('@/core/io/GltfAdapter');
        const meshes = await importGltf(await file.arrayBuffer());
        if (meshes.length === 0) throw new Error('glTF file contained no mesh geometry');
        for (const mesh of meshes) {
          const importError = firstMeshValidationError(mesh);
          if (importError) throw new Error(importError);
        }
        const objectIds = meshes.map((mesh) =>
          commitMeshObject(session.document, mesh, { name: mesh.name }).objectId,
        );
        session.selection.setMode('object');
        session.selection.selectObjects(objectIds, 'replace');
        session.requestRedraw();
      } else {
        throw new Error('Choose an OBJ, glTF, or GLB model file');
      }
      pushToast(`Imported ${file.name}`, 'success');
      refresh();
    } catch (error) {
      pushToast(error instanceof Error ? error.message : 'Failed to import model', 'error');
    }
  };

  const OBJ_FILE: FileDialogType = {
    description: 'Wavefront OBJ',
    accept: { 'text/plain': ['.obj'] },
  };
  const GLB_FILE: FileDialogType = {
    description: 'glTF Binary',
    accept: { 'model/gltf-binary': ['.glb'] },
  };

  const exportSelectedObj = async () => {
    const objectId = session.selection.state.activeObjectId;
    const object = objectId ? session.document.objects.get(objectId) : null;
    const mesh = object?.meshId ? session.document.meshes.get(object.meshId) : null;
    if (!mesh) {
      pushToast('Select a mesh object to export', 'error');
      return;
    }
    const report = validateMeshFull(mesh);
    if (!report.ok) {
      const first = report.issues.find((issue) => issue.severity === 'error');
      pushToast(first?.message ?? 'Mesh failed validation', 'error');
      return;
    }
    try {
      const target = await chooseNativeSaveTarget({
        suggestedName: `${object?.name || mesh.name}.obj`,
        types: [OBJ_FILE],
      });
      if (!target) return;
      await writeNativeFile(target, exportObj(mesh), 'text/plain');
      pushToast(`Exported ${target.name}`, 'success');
    } catch (error) {
      pushToast(error instanceof Error ? error.message : 'OBJ export failed', 'error');
    }
  };

  const createRecoveryPoint = async () => {
    const timestamp = new Date().toLocaleTimeString();
    const name = `${session.document.name || 'Project'} · ${timestamp}`;
    const saved = await writeNamedAutosave(name, serializeProject(session.document));
    if (saved) {
      const existing = await readAutosaves();
      setAutosaveOffers(existing);
    }
    pushToast(saved ? 'Named recovery point created' : 'Could not create recovery point', saved ? 'success' : 'error');
  };

  const exportGlb = async () => {
    const profile = EXPORT_PROFILES[exportProfileId];
    const diagnostics = exportDiagnostics(session.document, profile);
    const health = inspectDocumentHealth(session.document);
    if (!health.ok) {
      pushToast(health.errors[0] ?? 'Project failed validation', 'error');
      return;
    }
    if (diagnostics.errors.length) {
      pushToast(diagnostics.errors[0]!, 'error');
      return;
    }
    if (diagnostics.warnings.length) pushToast(diagnostics.warnings[0]!, 'info');
    try {
      const target = await chooseNativeSaveTarget({
        suggestedName: `${session.document.name || 'level'}-${profile.id}.glb`,
        types: [GLB_FILE],
      });
      if (!target) return;
      const { exportDocumentGlb, validateGlbRoundTrip } = await import('@/app/GameExport');
      const buffer = await exportDocumentGlb(session.document, profile);
      const roundTrip = await validateGlbRoundTrip(buffer);
      if (roundTrip.errors.length) {
        pushToast(roundTrip.errors[0]!, 'error');
        return;
      }
      await writeNativeFile(target, buffer, 'model/gltf-binary');
      pushToast(
        `Exported ${target.name} for ${profile.label} · verified ${roundTrip.triangles} triangles`,
        'success',
      );
    } catch (error) {
      pushToast(error instanceof Error ? error.message : 'GLB export failed', 'error');
    }
  };

  const primitiveTool = session.tools.get('create-primitive') as CreatePrimitiveTool;
  const doodleTool = session.tools.get('create-doodle') as CreateDoodleTool;
  const drawTool = session.tools.get('draw-poly') as DrawPolyTool;
  const terrainTool = session.tools.get('terrain-sculpt') as TerrainSculptTool;
  const meshSculptTool = session.tools.get('mesh-sculpt') as MeshSculptTool;
  const terrainObjectTool = session.tools.get('terrain-object') as TerrainObjectTool;
  const terrainFeatureTool = session.tools.get('terrain-feature') as TerrainFeatureTool;
  const blockoutVectorTool = session.tools.get('blockout-vector') as BlockoutVectorTool | undefined;
  const blockoutSolidTool = session.tools.get('blockout-solid') as BlockoutSolidTool | undefined;
  const blockoutRoundTool = session.tools.get('blockout-round') as BlockoutRoundTool | undefined;
  const activeTool = session.tools.getActive();
  const isCreating = activeTool === primitiveTool;
  const isDoodling = activeTool === doodleTool;
  const isDrawing = activeTool === drawTool;
  const isSculptingTerrain = activeTool === terrainTool;
  const isSculptingMesh = activeTool === meshSculptTool;
  const isPaintingObjects = activeTool === terrainObjectTool;
  const isBlockoutVector = activeTool === blockoutVectorTool;
  const isBlockoutSolid = activeTool === blockoutSolidTool;
  const isBlockoutRound = activeTool === blockoutRoundTool;
  const isBlockoutDraw = isBlockoutVector || isBlockoutSolid || isBlockoutRound;
  const dimensions = primitiveTool.getDimensions();
  const activeObject = session.selection.state.activeObjectId
    ? session.document.objects.get(session.selection.state.activeObjectId)
    : null;
  const activeMesh = activeObject?.meshId
    ? session.document.meshes.get(activeObject.meshId)
    : null;

  const editFaces = (kind: 'extrude' | 'inset' | 'knife' | 'bevel') => {
    const ctx = {
      session,
      workspace,
      getCameraAxes: (id: Parameters<typeof viewportEngine.getCameraAxes>[0]) =>
        viewportEngine.getCameraAxes(id),
      getPointerSample: (id: Parameters<typeof viewportEngine.getLastPointerSample>[0]) =>
        viewportEngine.getLastPointerSample(id),
    };
    if (kind === 'knife' && !beginBlenderOperator('knife', ctx)) {
      pushToast('Knife tool unavailable', 'error');
    } else if (kind === 'bevel' && !beginBlenderOperator('bevel', ctx)) {
      pushToast('Select edges to bevel', 'error');
    } else if (kind === 'extrude' && !beginBlenderOperator('extrude', ctx)) {
      pushToast('Select faces or edges to extrude', 'error');
    } else if (kind === 'inset') {
      beginBlenderOperator('inset', ctx);
    }
    refresh();
  };

  const restoreAutosave = (autosave: AutosavePayload) => {
    try {
      const loaded = openViperProjectText(autosave.project);
      session.loadProject(loaded.project, loaded.activeDocumentId);
      session.project.dirty = true;
      void clearAutosave(autosave.id);
      setAutosaveOffers((items) => items.filter((item) => item.id !== autosave.id));
      pushToast('Autosave restored', 'success');
      refresh();
    } catch (error) {
      pushToast(error instanceof Error ? error.message : 'Autosave restore failed', 'error');
    }
  };

  const discardAutosave = (id: string) => {
    void clearAutosave(id);
    setAutosaveOffers((items) => items.filter((item) => item.id !== id));
    pushToast('Recovery snapshot removed', 'info');
  };

  const discardAllAutosaves = () => {
    void clearAutosave();
    setAutosaveOffers([]);
    pushToast('Recovery history cleared', 'info');
  };

  const handleTogglePromptRecovery = (val?: boolean) => {
    setPromptRecoveryOnStartup((prev) => {
      const next = typeof val === 'boolean' ? val : !prev;
      try {
        localStorage.setItem('vipercad:prompt-recovery-on-startup', String(next));
      } catch {}
      pushToast(`Startup recovery prompt ${next ? 'enabled' : 'disabled'}`, 'info');
      return next;
    });
  };

  const recoveryState: RecoveryControlsState = {
    autosaves: autosaveOffers,
    promptRecoveryOnStartup,
    onTogglePromptRecoveryOnStartup: handleTogglePromptRecovery,
    onOpenRecoveryDialog: () => setRecoveryModalOpen(true),
    onCreateCheckpoint: () => void createRecoveryPoint(),
    onClearAllSnapshots: discardAllAutosaves,
    onRestoreSnapshot: (autosave) => {
      restoreAutosave(autosave);
      setRecoveryModalOpen(false);
    },
    onDiscardSnapshot: discardAutosave,
  };

  const chooseMode = (mode: 'object' | 'vertex' | 'edge' | 'face') => {
    session.tools.setActive('select', session.context());
    const object = session.selection.state.activeObjectId
      ? session.document.objects.get(session.selection.state.activeObjectId)
      : null;
    const mesh = object?.meshId ? session.document.meshes.get(object.meshId) : null;
    session.selection.switchEditMode(mode, mesh);
    if (mode !== 'object' && session.transform.prefs.gizmoMode === 'select') {
      session.transform.setGizmoMode('combined');
    }
    session.requestRedraw();
    viewportEngine.invalidate();
    refresh();
  };

  const toggleXRay = () => {
    session.selection.setXRay(!session.selection.state.xRay);
    session.requestRedraw();
    refresh();
  };

  const setRenderMode = (mode: ShadingMode) => {
    workspace.setShadingMode(mode);
    session.requestRedraw();
    refresh();
  };

  const toggleDisplayTextures = () => {
    workspace.setDisplayTextures(!workspace.getDisplayTextures());
    session.requestRedraw();
    refresh();
  };

  const shadingMode = workspace.getShadingMode();
  const displayTextures = workspace.getDisplayTextures();

  const setGizmoMode = (mode: GizmoMode) => {
    session.tools.setActive('select', session.context());
    session.transform.setGizmoMode(mode);
    session.requestRedraw();
    refresh();
  };

  const setOrientation = (orientation: TransformOrientation) => {
    session.transform.setOrientation(orientation);
    session.requestRedraw();
    refresh();
  };

  const setPivot = (mode: TransformPivotMode) => {
    session.transform.setPivotMode(mode);
    session.requestRedraw();
    refresh();
  };

  const transformActive = session.transform.active;
  const gizmoMode = session.transform.prefs.gizmoMode;
  const transformStatus = transformActive ? session.transform.statusLine() : '';
  const viewHint =
    workspace.shellMode === 'terrain'
      ? 'Terrain · single view'
      : workspace.shellMode === 'sculpt'
        ? 'Sculpt · single view'
      : workspace.shellMode === 'rig'
        ? 'Rig · bones and weights'
      : workspace.shellMode === 'blockout'
        ? 'Blockout · 3 views (Front, Side, Persp)'
      : workspace.shellMode === 'animate'
        ? 'Animate · clips and timing'
      : workspace.layoutMode === 'maximized'
      ? `${VIEW_LABELS[workspace.splits.state.maximizedViewportId ?? 'persp']} · Tab restore`
      : 'Tab maximize';

  const sel = session.selection.state;
  const selectionSummary = (() => {
    if (sel.mode === 'object') {
      const n = sel.selectedObjectIds.size;
      return n ? `${n} object${n === 1 ? '' : 's'}` : 'none';
    }
    if (sel.mode === 'vertex') {
      const n = sel.selectedVertexIds.size;
      return n ? `${n} vert${n === 1 ? '' : 's'}` : 'none';
    }
    if (sel.mode === 'edge') {
      const n = sel.selectedEdgeIds.size;
      return n ? `${n} edge${n === 1 ? '' : 's'}` : 'none';
    }
    const n = sel.selectedFaceIds.size;
    return n ? `${n} face${n === 1 ? '' : 's'}` : 'none';
  })();
  const hoverSummary = sel.hoveredVertexId
    ? 'hover vert'
    : sel.hoveredEdgeId
      ? 'hover edge'
      : sel.hoveredFaceId
        ? 'hover face'
        : sel.hoveredObjectId
          ? 'hover object'
          : '';

  const applyAnimationEditMode = (mode: 'pose' | 'edit' | 'weight') => {
    if (mode === 'weight') animation.ensureSkinForWeightPaint();
    animation.setEditMode(mode);
    refresh();
  };

  const setShell = (mode: 'model' | 'sculpt' | 'terrain' | 'texture' | 'rig' | 'animate' | 'blockout') => {
    if (mode !== 'animate') animation.playing = false;
    if (mode === 'texture') {
      session.tools.setActive('select', session.context());
      const objectId = session.selection.state.activeObjectId;
      const object = objectId ? session.document.objects.get(objectId) : null;
      const mesh = object?.meshId ? session.document.meshes.get(object.meshId) : null;
      if (mesh) {
        const prepared = ensurePaintableUvs(mesh);
        if (prepared.changed) {
          session.document.dirty = true;
          session.requestRedraw();
          pushToast(
            prepared.mode === 'auto-unwrapped'
              ? 'UVs prepared automatically — the model is ready to paint'
              : `${prepared.repairedFaceIds.length} unmapped face${prepared.repairedFaceIds.length === 1 ? '' : 's'} repaired for painting`,
            'success',
          );
        }
      }
      // UV shell uses 3D face picks to drive UV selection.
      session.selection.setMode('face');
    } else if (mode === 'terrain') {
      session.selection.setMode('object');
      const terrain = resolveTerrainAsset(session);
      if (terrain) session.selection.selectObjects([terrain.object.id], 'replace');
      session.tools.setActive('terrain-sculpt', session.context());
      setTerrainFocusTab(terrain ? 'sculpt' : 'terrain');
      if (terrain) session.requestRedraw();
    } else if (mode === 'sculpt') {
      session.selection.setMode('object');
      const targets = sculptableObjects(session.document);
      if (targets.length && !targets.some((object) => object.id === session.selection.state.activeObjectId)) {
        session.selection.selectObjects([targets[0]!.id], 'replace');
      }
      session.tools.setActive('mesh-sculpt', session.context());
      session.requestRedraw();
    } else if (mode === 'rig') {
      session.ensureDocumentKind('model');
      session.selection.setMode('object');
      session.tools.setActive('select', session.context());
      animation.enterForModel(session.documentId);
      animation.setEditMode('edit');
      const rigStatus = animation.getSetupStatus();
      if (rigStatus.meshObjectCount > 0 && rigStatus.skinBindingCount === 0) {
        animation.runQuickSetup();
      }
      session.requestRedraw();
      requestAnimationFrame(() => viewportEngine.frameAll());
    } else if (mode === 'animate') {
      session.ensureDocumentKind('model');
      session.selection.setMode('object');
      session.tools.setActive('select', session.context());
      animation.enterForModel(session.documentId);
      animation.setEditMode('pose');
      const status = animation.getSetupStatus();
      if (status.meshObjectCount > 0 && status.skinBindingCount === 0) {
        animation.runQuickSetup();
      }
      session.requestRedraw();
    } else if (mode === 'blockout') {
      session.ensureDocumentKind('model');
      session.selection.setMode('object');
      session.tools.setActive('blockout-vector', session.context());
      setOutlinerTab('scene');
      setOutlinerOpen(true);
      session.requestRedraw();
    } else {
      session.tools.setActive('select', session.context());
    }
    const switchedDoc = mode === 'model' || mode === 'animate' || mode === 'rig' || mode === 'blockout'
      ? session.ensureDocumentKind('model')
      : mode === 'terrain'
        ? session.ensureDocumentKind('level')
        : false;
    workspace.setShellMode(mode);
    if (mode === 'terrain') {
      const terrain = resolveTerrainAsset(session);
      if (terrain) {
        session.selection.setMode('object');
        session.selection.selectObjects([terrain.object.id], 'replace');
      }
      session.tools.setActive('terrain-sculpt', session.context());
      setTerrainFocusTab(terrain ? 'sculpt' : 'terrain');
    }
    if (switchedDoc && mode !== 'animate' && mode !== 'rig' && mode !== 'blockout') {
      pushToast(
        mode === 'model'
          ? `Switched to model "${session.document.name}" — model edits stay in model documents`
          : `Switched to level "${session.document.name}"`,
        'info',
      );
    }
    refresh();
  };

  const openDocumentById = (documentId: string) => {
    session.openDocument(documentId);
    refresh();
  };

  useEffect(() => {
    document.title = `${projectIsDirty(session.project) ? '● ' : ''}${session.document.name} — Viper CAD`;
  });

  const focusGroupTargetId = (): string | null => {
    for (const id of session.selection.state.selectedObjectIds) {
      const object = session.document.objects.get(id);
      if (object && isGroupObject(object)) return id;
    }
    const active = session.selection.state.activeObjectId;
    if (active && isGroupObject(session.document.objects.get(active)!)) return active;
    return null;
  };

  const placeModelInActiveLevel = (modelDocumentId: string) => {
    placeModelQuick(session, modelDocumentId, {
      onRefresh: refresh,
      onPlaced: () => setOutlinerTab('scene'),
    });
  };

  const menus: DesktopMenuDefinition[] = [
    {
      label: 'File',
      entries: [
        { kind: 'command', label: 'New Project', shortcut: 'Ctrl+N', action: newProject },
        {
          kind: 'command',
          label: 'Open Project…',
          shortcut: 'Ctrl+O',
          action: () => void openProjectDialog(),
        },
        {
          kind: 'command',
          label: 'Save',
          shortcut: 'Ctrl+S',
          action: () => void saveProject(false),
        },
        {
          kind: 'command',
          label: 'Save As…',
          shortcut: 'Ctrl+Shift+S',
          action: () => void saveProject(true),
        },
        { kind: 'separator' },
        {
          kind: 'command',
          label: 'New Model',
          action: () => {
            const id = session.projectEditor.newModel(`Model ${session.project.modelDocumentIds.length + 1}`);
            openDocumentById(id);
            pushToast('New Model — edit reusable assets here', 'success');
          },
        },
        {
          kind: 'command',
          label: 'New Level',
          action: () => {
            const id = session.projectEditor.newLevel(`Level ${session.project.levelDocumentIds.length + 1}`);
            openDocumentById(id);
            pushToast('New Level — place content in the environment', 'success');
          },
        },
        { kind: 'separator' },
        {
          kind: 'command',
          label: 'Extrude',
          shortcut: 'E',
          action: () => editFaces('extrude'),
        },
        {
          kind: 'command',
          label: 'Inset Faces',
          shortcut: 'I',
          action: () => editFaces('inset'),
        },
        {
          kind: 'command',
          label: 'Bevel Edges',
          shortcut: 'Ctrl+B',
          action: () => editFaces('bevel'),
        },
        {
          kind: 'command',
          label: 'Loop Cut',
          shortcut: 'Ctrl+R',
          action: () => {
            beginBlenderOperator('loop-cut', {
              session,
              workspace,
              getCameraAxes: (id) => viewportEngine.getCameraAxes(id),
              getPointerSample: (id) => viewportEngine.getLastPointerSample(id),
            });
            refresh();
          },
        },
        { kind: 'separator' },
        {
          kind: 'command',
          label: 'Import Model…',
          action: () => void importModelDialog(),
        },
        {
          kind: 'command',
          label: 'Export Selected OBJ…',
          disabled: !activeMesh,
          action: () => void exportSelectedObj(),
        },
        {
          kind: 'command',
          label: 'Export Scene GLB…',
          disabled: session.document.objects.size === 0,
          action: () => void exportGlb(),
        },
        {
          kind: 'custom',
          content: (
            <label>
              Export target
              <select
                className="export-profile"
                aria-label="GLB export profile"
                value={exportProfileId}
                onChange={(event) =>
                  setExportProfileId(event.target.value as ExportProfile['id'])
                }
              >
                {Object.values(EXPORT_PROFILES).map((profile) => (
                  <option key={profile.id} value={profile.id}>{profile.label}</option>
                ))}
              </select>
            </label>
          ),
        },
        { kind: 'separator' },
        {
          kind: 'command',
          label: 'Create Recovery Checkpoint',
          action: () => void createRecoveryPoint(),
        },
        {
          kind: 'command',
          label: 'Autosave Recovery History…',
          action: () => setRecoveryModalOpen(true),
        },
        {
          kind: 'command',
          label: 'Prompt Recovery on Startup',
          checked: promptRecoveryOnStartup,
          action: () => handleTogglePromptRecovery(),
        },
      ],
    },
    {
      label: 'Edit',
      entries: [
        {
          kind: 'command',
          label: 'Undo',
          shortcut: 'Ctrl+Z',
          disabled: !(session.tools.getActive() instanceof DrawPolyTool
            ? (session.tools.getActive() as DrawPolyTool).canUndoDraw(session.history.canUndo())
            : session.history.canUndo()),
          action: () => {
            const tool = session.tools.getActive();
            if (tool instanceof DrawPolyTool && tool.undoDraw(session.context())) {
              refresh();
              return;
            }
            if (session.undo()) {
              if (tool instanceof DrawPolyTool) tool.syncAfterHistory(session.context());
            }
            refresh();
          },
        },
        {
          kind: 'command',
          label: 'Redo',
          shortcut: 'Ctrl+Y',
          disabled: !(session.tools.getActive() instanceof DrawPolyTool
            ? (session.tools.getActive() as DrawPolyTool).canRedoDraw(session.history.canRedo())
            : session.history.canRedo()),
          action: () => {
            const tool = session.tools.getActive();
            if (tool instanceof DrawPolyTool && tool.redoDraw(session.context())) {
              refresh();
              return;
            }
            if (session.redo()) {
              if (tool instanceof DrawPolyTool) tool.syncAfterHistory(session.context());
            }
            refresh();
          },
        },
        { kind: 'separator' },
        {
          kind: 'command',
          label: 'Copy Selection',
          shortcut: 'Ctrl+C',
          action: () => {
            if (commitCopySelection(session)) pushToast('Copied selection', 'success');
            else pushToast('Nothing to copy', 'error');
            refresh();
          },
        },
        {
          kind: 'command',
          label: 'Paste',
          shortcut: 'Ctrl+V',
          action: () => {
            if (commitPasteClipboard(session)) pushToast('Pasted', 'success');
            else pushToast('Clipboard is empty', 'error');
            refresh();
          },
        },
      ],
    },
    {
      label: 'Documents',
      entries: [
        {
          kind: 'command',
          label: 'New Model',
          action: () => {
            const id = session.projectEditor.newModel(`Model ${session.project.modelDocumentIds.length + 1}`);
            openDocumentById(id);
            pushToast('New Model — edit reusable assets here', 'success');
          },
        },
        {
          kind: 'command',
          label: 'New Level',
          action: () => {
            const id = session.projectEditor.newLevel(`Level ${session.project.levelDocumentIds.length + 1}`);
            openDocumentById(id);
            pushToast('New Level — place content in the environment', 'success');
          },
        },
        ...(session.document.kind === 'level'
          ? [
              { kind: 'separator' as const },
              ...session.project.modelDocumentIds.map((modelId) => {
                const modelDoc = getViperDocument(session.project, modelId);
                return {
                  kind: 'command' as const,
                  label: `Place ${modelDoc.name} in Level`,
                  disabled: !modelHasPlaceableGeometry(modelDoc),
                  action: () => placeModelInActiveLevel(modelId),
                };
              }),
            ]
          : []),
        { kind: 'separator' },
        {
          kind: 'command',
          label: 'Rename Active Document',
          action: () => {
            const docId = session.documentId;
            const doc = session.project.documents.get(docId);
            if (!doc) return;
            const next = window.prompt('Rename', doc.name);
            if (!next?.trim()) return;
            session.projectEditor.renameDocument(docId, next.trim());
            refresh();
          },
        },
        {
          kind: 'command',
          label: 'Delete Active Document',
          action: () => {
            const docId = session.documentId;
            const doc = session.project.documents.get(docId);
            if (!doc) return;
            const list = doc.kind === 'model' ? session.project.modelDocumentIds : session.project.levelDocumentIds;
            if (list.length <= 1) {
              pushToast(`Cannot delete the last ${doc.kind === 'model' ? 'Model' : 'Level'}`, 'error');
              return;
            }
            if (!window.confirm(`Delete ${doc.kind} "${doc.name}"?`)) return;
            if (!session.projectEditor.deleteDocument(docId)) return;
            if (session.projectEditor.activeDocumentId) session.openDocument(session.projectEditor.activeDocumentId);
            pushToast(`Deleted ${doc.name}`, 'info');
            refresh();
          },
        },
        { kind: 'separator' },
        {
          kind: 'command',
          label: 'Browse Models in Outliner',
          action: () => {
            setOutlinerTab('models');
            setOutlinerOpen(true);
          },
        },
        {
          kind: 'command',
          label: 'Browse Levels in Outliner',
          action: () => {
            setOutlinerTab('levels');
            setOutlinerOpen(true);
          },
        },
      ],
    },
    {
      label: 'Object',
      entries: [
        {
          kind: 'command',
          label: 'Group',
          shortcut: 'Ctrl+G',
          action: () => {
            if (!commitGroupSelection(session)) pushToast('Select objects to group', 'error');
            refresh();
          },
        },
        {
          kind: 'command',
          label: 'Ungroup',
          shortcut: 'Ctrl+Shift+G',
          action: () => {
            if (!commitUngroupSelection(session)) pushToast('Select a group to ungroup', 'error');
            refresh();
          },
        },
        { kind: 'separator' },
        {
          kind: 'command',
          label: 'Enter Group',
          disabled: !focusGroupTargetId(),
          action: () => {
            const id = focusGroupTargetId();
            if (!id || !enterGroupFocus(session, id)) pushToast('Select a group to focus', 'error');
            else pushToast(`Focused Group: ${session.document.objects.get(id)?.name}`, 'info');
            refresh();
          },
        },
        {
          kind: 'command',
          label: 'Exit Group',
          disabled: !session.focusGroupId,
          action: () => {
            if (exitGroupFocus(session)) refresh();
          },
        },
        {
          kind: 'command',
          label: 'Exit to Document Root',
          disabled: !session.focusGroupId,
          action: () => {
            if (exitToDocumentRoot(session)) refresh();
          },
        },
      ],
    },
    {
      label: 'View',
      entries: [
        {
          kind: 'command',
          label: 'Outliner',
          checked: outlinerOpen,
          disabled: workspace.shellMode !== 'model' && workspace.shellMode !== 'blockout',
          action: toggleOutliner,
        },
        { kind: 'separator' },
        {
          kind: 'command',
          label: 'Scene Outliner',
          checked: outlinerOpen && outlinerTab === 'scene',
          action: () => {
            setOutlinerTab('scene');
            setOutlinerOpen(true);
          },
        },
        {
          kind: 'command',
          label: 'Models in Outliner',
          checked: outlinerOpen && outlinerTab === 'models',
          action: () => {
            setOutlinerTab('models');
            setOutlinerOpen(true);
          },
        },
        {
          kind: 'command',
          label: 'Levels in Outliner',
          checked: outlinerOpen && outlinerTab === 'levels',
          action: () => {
            setOutlinerTab('levels');
            setOutlinerOpen(true);
          },
        },
        {
          kind: 'command',
          label: 'Level object library',
          checked: workspace.shellMode === 'terrain' && terrainObjectsOpen,
          disabled: workspace.shellMode !== 'terrain',
          action: () => setTerrainObjectsOpen((open) => !open),
        },
        {
          kind: 'command',
          label: 'Model Workspace',
          checked: workspace.shellMode === 'model',
          action: () => setShell('model'),
        },
        {
          kind: 'command',
          label: 'Sculpt Workspace',
          checked: workspace.shellMode === 'sculpt',
          action: () => setShell('sculpt'),
        },
        {
          kind: 'command',
          label: 'Terrain Workspace',
          checked: workspace.shellMode === 'terrain',
          action: () => setShell('terrain'),
        },
        {
          kind: 'command',
          label: 'Rigging Workspace',
          checked: workspace.shellMode === 'rig',
          action: () => setShell('rig'),
        },
        {
          kind: 'command',
          label: 'Animation Workspace',
          checked: workspace.shellMode === 'animate',
          action: () => setShell('animate'),
        },
        {
          kind: 'command',
          label: 'Blockout Workspace',
          checked: workspace.shellMode === 'blockout',
          action: () => setShell('blockout'),
        },
        {
          kind: 'command',
          label: 'UV / Pixel Workspace',
          checked: workspace.shellMode === 'texture',
          action: () => setShell('texture'),
        },
        { kind: 'separator' },
        {
          kind: 'command',
          label: 'Navigation Tools',
          checked: workspace.viewportNavToolsVisible,
          action: () => {
            workspace.toggleViewportNavToolsVisible();
            refresh();
          },
        },
        {
          kind: 'command',
          label: 'Draw on Surfaces',
          checked: workspace.getDrawOnSurfaces(),
          action: () => {
            workspace.setDrawOnSurfaces(!workspace.getDrawOnSurfaces());
            refresh();
          },
        },
        {
          kind: 'command',
          label: 'Frame Selection',
          shortcut: 'F',
          action: () => viewportEngine.frameSelection(),
        },
        {
          kind: 'command',
          label: 'Frame All',
          shortcut: 'Home',
          action: () => viewportEngine.frameAll(),
        },
        {
          kind: 'command',
          label: 'Reset Active View',
          shortcut: 'Shift+Home',
          action: () => viewportEngine.resetView(),
        },
        {
          kind: 'command',
          label: workspace.layoutMode === 'maximized' ? 'Restore Quad View' : 'Maximize Active View',
          shortcut: 'Tab',
          action: () => {
            workspace.handleTab();
            viewportEngine.invalidate();
            refresh();
          },
        },
        {
          kind: 'command',
          label: zenMode ? 'Exit Zen Mode' : 'Zen Mode',
          shortcut: 'Shift+Space',
          checked: zenMode,
          action: () => setZenMode((open) => !open),
        },
        { kind: 'separator' },
        ...WORKSPACE_THEMES.map((theme) => ({
          kind: 'command' as const,
          label: theme.label,
          checked: themeId === theme.id,
          action: () => setThemeId(applyWorkspaceTheme(theme.id)),
        })),
      ],
    },
    {
      label: 'Render',
      entries: [
        {
          kind: 'command',
          label: 'Material',
          checked: shadingMode === 'material',
          action: () => setRenderMode('material'),
        },
        {
          kind: 'command',
          label: 'Display Textures',
          checked: displayTextures,
          action: toggleDisplayTextures,
        },
        {
          kind: 'command',
          label: 'Wireframe',
          checked: shadingMode === 'wireframe',
          action: () => setRenderMode('wireframe'),
        },
        {
          kind: 'command',
          label: 'Outlines',
          checked: shadingMode === 'outlines',
          action: () => setRenderMode('outlines'),
        },
        {
          kind: 'command',
          label: 'Studio',
          checked: shadingMode === 'game',
          action: () => setRenderMode('game'),
        },
        {
          kind: 'command',
          label: 'Silhouette',
          checked: shadingMode === 'silhouette',
          action: () => setRenderMode('silhouette'),
        },
        { kind: 'separator' },
        {
          kind: 'command',
          label: 'X-Ray',
          checked: sel.xRay,
          action: toggleXRay,
        },
      ],
    },
    {
      label: 'Create',
      entries: [
        {
          kind: 'command',
          label: 'Primitive Builder',
          action: () => {
            workspace.setInspectorTab('create');
            session.tools.setActive('create-primitive', session.context());
            refresh();
          },
        },
        {
          kind: 'command',
          label: 'Draw Mesh Surface',
          action: () => {
            workspace.setInspectorTab('create');
            session.tools.setActive('draw-poly', session.context());
            refresh();
          },
        },
        { kind: 'separator' },
        {
          kind: 'command',
          label: 'Curve Sketch · Tube Sweep',
          action: () => {
            workspace.setInspectorTab('create');
            doodleTool.setInputMode('sketch', session.context());
            doodleTool.setStyle('tube', session.context());
            session.tools.setActive('create-doodle', session.context());
            refresh();
          },
        },
        {
          kind: 'command',
          label: 'Vector Pen · Tube Sweep',
          action: () => {
            workspace.setInspectorTab('create');
            doodleTool.setInputMode('pen', session.context());
            doodleTool.setStyle('tube', session.context());
            session.tools.setActive('create-doodle', session.context());
            refresh();
          },
        },
        {
          kind: 'command',
          label: 'Stroke Shape · Ribbon / Hair',
          action: () => {
            workspace.setInspectorTab('create');
            doodleTool.setStyle('hair', session.context());
            session.tools.setActive('create-doodle', session.context());
            refresh();
          },
        },
        {
          kind: 'command',
          label: 'Stroke Shape · Braided Rope',
          action: () => {
            workspace.setInspectorTab('create');
            doodleTool.setStyle('rope', session.context());
            session.tools.setActive('create-doodle', session.context());
            refresh();
          },
        },
        {
          kind: 'command',
          label: 'Profile · Soft Volume',
          action: () => {
            workspace.setInspectorTab('create');
            doodleTool.setStyle('soft', session.context());
            session.tools.setActive('create-doodle', session.context());
            refresh();
          },
        },
        {
          kind: 'command',
          label: 'Sweep · Square / Rail',
          action: () => {
            workspace.setInspectorTab('create');
            doodleTool.setStyle('square-sweep', session.context());
            session.tools.setActive('create-doodle', session.context());
            refresh();
          },
        },
      ],
    },
    {
      label: 'Model',
      entries: [
        {
          kind: 'command',
          label: 'Select & Objects Tools',
          checked: workspace.inspectorTab === 'edit' && workspace.inspectorSection === 'select',
          action: () => workspace.setInspectorSection('select'),
        },
        {
          kind: 'command',
          label: 'Transform Tools',
          checked: workspace.inspectorTab === 'edit' && workspace.inspectorSection === 'transform',
          action: () => workspace.setInspectorSection('transform'),
        },
        {
          kind: 'command',
          label: 'Mesh Geometry Tools',
          checked: workspace.inspectorTab === 'edit' && workspace.inspectorSection === 'geometry',
          action: () => workspace.setInspectorSection('geometry'),
        },
        {
          kind: 'command',
          label: 'Symmetry Tools',
          checked: workspace.inspectorTab === 'edit' && workspace.inspectorSection === 'symmetry',
          action: () => workspace.setInspectorSection('symmetry'),
        },
        {
          kind: 'command',
          label: 'Construct & Game Tools',
          checked: workspace.inspectorTab === 'edit' && workspace.inspectorSection === 'scene',
          action: () => workspace.setInspectorSection('scene'),
        },
        {
          kind: 'command',
          label: 'Material Tools',
          checked: workspace.inspectorTab === 'material',
          action: () => workspace.setInspectorTab('material'),
        },
        { kind: 'separator' },
        {
          kind: 'command',
          label: 'Object Selection',
          checked: sel.mode === 'object',
          action: () => chooseMode('object'),
        },
        {
          kind: 'command',
          label: 'Vertex Selection',
          shortcut: '1',
          checked: sel.mode === 'vertex',
          action: () => chooseMode('vertex'),
        },
        {
          kind: 'command',
          label: 'Edge Selection',
          shortcut: '2',
          checked: sel.mode === 'edge',
          action: () => chooseMode('edge'),
        },
        {
          kind: 'command',
          label: 'Face Selection',
          shortcut: '3',
          checked: sel.mode === 'face',
          action: () => chooseMode('face'),
        },
        { kind: 'separator' },
        {
          kind: 'command',
          label: 'Move Gizmo',
          shortcut: 'G',
          checked: session.transform.prefs.gizmoMode === 'move',
          action: () => setGizmoMode('move'),
        },
        {
          kind: 'command',
          label: 'Rotate Gizmo',
          shortcut: 'R',
          checked: session.transform.prefs.gizmoMode === 'rotate',
          action: () => setGizmoMode('rotate'),
        },
        {
          kind: 'command',
          label: 'Scale Gizmo',
          shortcut: 'S',
          checked: session.transform.prefs.gizmoMode === 'scale',
          action: () => setGizmoMode('scale'),
        },
        {
          kind: 'command',
          label: 'Transform Gizmo',
          checked: session.transform.prefs.gizmoMode === 'combined',
          action: () => setGizmoMode('combined'),
        },
        {
          kind: 'command',
          label: 'Edit Origin Gizmo',
          shortcut: 'P',
          checked: session.transform.prefs.gizmoMode === 'origin',
          action: () => setGizmoMode(session.transform.prefs.gizmoMode === 'origin' ? 'combined' : 'origin'),
        },
      ],
    },
    {
      label: 'Help',
      entries: [
        {
          kind: 'command',
          label: 'Command Palette',
          shortcut: 'Ctrl+K',
          action: () => setPaletteOpen(true),
        },
        {
          kind: 'command',
          label: 'Keyboard Shortcuts',
          shortcut: '?',
          action: () => setHotkeysOpen(true),
        },
        {
          kind: 'command',
          label: 'About Viper CAD',
          action: () =>
            pushToast('Viper CAD · game-ready 3D and pixel modelling', 'info'),
        },
      ],
    },
  ];

  const paletteCommands = flattenMenuCommands(menus);

  return (
    <div className={`app${zenMode ? ' is-zen' : ''}`}>
      <CommandPalette
        open={paletteOpen}
        commands={paletteCommands}
        onClose={() => setPaletteOpen(false)}
      />
      <header className="bar bar-slim">
        <div className="bar-left">
          <span className="mark">Viper</span>
          <DesktopMenuBar menus={menus} />
          <span className="bar-sep" aria-hidden />
          <div className="shell-switch" role="group" aria-label="Workspace">
            <button
              type="button"
              className={`tool${workspace.shellMode === 'model' ? ' is-active' : ''}`}
              onClick={() => setShell('model')}
              aria-pressed={workspace.shellMode === 'model'}
            >
              Model
            </button>
            <button
              type="button"
              className={`tool${workspace.shellMode === 'sculpt' ? ' is-active' : ''}`}
              onClick={() => setShell('sculpt')}
              aria-pressed={workspace.shellMode === 'sculpt'}
              title="Sculpt mesh objects with brushes"
            >
              Sculpt
            </button>
            <button
              type="button"
              className={`tool${workspace.shellMode === 'terrain' ? ' is-active' : ''}`}
              onClick={() => setShell('terrain')}
              aria-pressed={workspace.shellMode === 'terrain'}
              title="Create and sculpt game terrain"
            >
              Terrain
            </button>
            <button
              type="button"
              className={`tool${workspace.shellMode === 'rig' ? ' is-active' : ''}`}
              onClick={() => setShell('rig')}
              aria-pressed={workspace.shellMode === 'rig'}
              title="Rig bones, skinning, and weight painting"
            >
              Rig
            </button>
            <button
              type="button"
              className={`tool${workspace.shellMode === 'animate' ? ' is-active' : ''}`}
              onClick={() => setShell('animate')}
              aria-pressed={workspace.shellMode === 'animate'}
              title="Action clips, keyframes, events, and game animation"
            >
              Animate
            </button>
            <button
              type="button"
              className={`tool${workspace.shellMode === 'blockout' ? ' is-active' : ''}`}
              onClick={() => setShell('blockout')}
              aria-pressed={workspace.shellMode === 'blockout'}
              title="Blockout with Flat and Square tools in any view"
            >
              Block
            </button>
            <button
              type="button"
              className={`tool${workspace.shellMode === 'texture' ? ' is-active' : ''}`}
              onClick={() => setShell('texture')}
              aria-pressed={workspace.shellMode === 'texture'}
              title="UV and pixel workspace"
            >
              UV / Pixel
            </button>
          </div>
          {(workspace.shellMode === 'rig' || workspace.shellMode === 'animate' || workspace.shellMode === 'blockout' || workspace.shellMode === 'terrain') && (
            <span className="bar-sep" aria-hidden />
          )}
          {workspace.shellMode === 'blockout' && (
            <div className="shell-switch selection-switch" role="group" aria-label="Blockout tool">
              <button
                type="button"
                className={`tool${isBlockoutVector ? ' is-active' : ''}`}
                onClick={() => {
                  lockBlockoutReferences(session.document, true);
                  workspace.setViewportNav('none', null);
                  session.tools.setActive('blockout-vector', session.context());
                  session.requestRedraw();
                  refresh();
                }}
                aria-pressed={isBlockoutVector}
                title="Flat silhouette in any view, then Extrude (V)"
              >
                Flat
              </button>
              <button
                type="button"
                className={`tool${isBlockoutSolid ? ' is-active' : ''}`}
                onClick={() => {
                  lockBlockoutReferences(session.document, true);
                  workspace.setViewportNav('none', null);
                  session.tools.setActive('blockout-solid', session.context());
                  session.requestRedraw();
                  refresh();
                }}
                aria-pressed={isBlockoutSolid}
                title="Square solid with live thickness in any view (Q)"
              >
                Square
              </button>
              <button
                type="button"
                className={`tool${isBlockoutRound ? ' is-active' : ''}`}
                onClick={() => {
                  lockBlockoutReferences(session.document, true);
                  workspace.setViewportNav('none', null);
                  session.tools.setActive('blockout-round', session.context());
                  session.requestRedraw();
                  refresh();
                }}
                aria-pressed={isBlockoutRound}
                title="Low-poly round (8-sided ellipse), then Extrude (O)"
              >
                Round
              </button>
              <button
                type="button"
                className={`tool${!isBlockoutDraw ? ' is-active' : ''}`}
                onClick={() => setGizmoMode('move')}
                aria-pressed={!isBlockoutDraw}
                title="Select and transform (G/R/S · 1/2/3 for vertex/edge/face)"
              >
                Move
              </button>
            </div>
          )}
          {workspace.shellMode === 'terrain' && (
            <div className="shell-switch selection-switch" role="group" aria-label="Terrain tool">
              <button
                type="button"
                className={`tool${activeTool === terrainTool ? ' is-active' : ''}`}
                onClick={() => {
                  activateTerrainWorkspaceTool(session, 'sculpt');
                  setTerrainFocusTab('sculpt');
                  refresh();
                }}
                aria-pressed={activeTool === terrainTool}
                title="Sculpt height (1)"
              >
                Sculpt
              </button>
              <button
                type="button"
                className={`tool${activeTool === terrainObjectTool ? ' is-active' : ''}`}
                onClick={() => {
                  activateTerrainWorkspaceTool(session, 'objects');
                  setTerrainFocusTab('objects');
                  setTerrainObjectsOpen(true);
                  refresh();
                }}
                aria-pressed={activeTool === terrainObjectTool}
                title="Place and scatter objects (2)"
              >
                Objects
              </button>
              <button
                type="button"
                className={`tool${activeTool === terrainFeatureTool ? ' is-active' : ''}`}
                onClick={() => {
                  activateTerrainWorkspaceTool(session, 'water');
                  setTerrainFocusTab('water');
                  refresh();
                }}
                aria-pressed={activeTool === terrainFeatureTool}
                title="Rivers and paths (3)"
              >
                Water
              </button>
              <button
                type="button"
                className={`tool${activeTool?.id === 'select' ? ' is-active' : ''}`}
                onClick={() => {
                  activateTerrainWorkspaceTool(session, 'select');
                  refresh();
                }}
                aria-pressed={activeTool?.id === 'select'}
                title="Select and transform props (G/R/S)"
              >
                Select
              </button>
            </div>
          )}
          {workspace.shellMode === 'rig' && (
            <div className="shell-switch selection-switch" role="group" aria-label="Rigging edit mode">
              {(['edit', 'weight'] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  className={`tool${animation.editMode === mode ? ' is-active' : ''}`}
                  onClick={() => applyAnimationEditMode(mode)}
                  aria-pressed={animation.editMode === mode}
                >
                  {mode === 'edit' ? 'Bones' : 'Weights'}
                </button>
              ))}
            </div>
          )}
          {workspace.shellMode === 'animate' && (
            <div className="shell-switch selection-switch" role="group" aria-label="Animation edit mode">
              {(['pose', 'edit', 'weight'] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  className={`tool${animation.editMode === mode ? ' is-active' : ''}`}
                  onClick={() => applyAnimationEditMode(mode)}
                  aria-pressed={animation.editMode === mode}
                >
                  {mode === 'pose' ? 'Pose' : mode === 'edit' ? 'Bones' : 'Weights'}
                </button>
              ))}
            </div>
          )}
        </div>
        <DocumentTabs
          session={session}
          onRefresh={refresh}
          onBrowseOutliner={(tab) => {
            setOutlinerTab(tab);
            setSidebarCollapsed(false);
          }}
        />
        <div className="bar-right">
          <button
            type="button"
            className="tool theme-swatch-btn"
            title={`${WORKSPACE_THEMES.find((theme) => theme.id === themeId)?.label ?? 'Theme'} — click to cycle`}
            aria-label="Cycle workspace theme"
            onClick={() => {
              const index = WORKSPACE_THEMES.findIndex((theme) => theme.id === themeId);
              const next = WORKSPACE_THEMES[(index + 1) % WORKSPACE_THEMES.length]!;
              setThemeId(applyWorkspaceTheme(next.id));
            }}
          >
            <span className="theme-swatch" aria-hidden />
          </button>
          {workspace.shellMode !== 'animate' && workspace.shellMode !== 'rig' && workspace.shellMode !== 'blockout' && (
            <span className="meta dim">{viewHint}</span>
          )}
          {workspace.shellMode === 'model' && (
            <button
              type="button"
              className={`tool sidebar-header-toggle${!sidebarCollapsed ? ' is-active' : ''}`}
              onClick={() => setSidebarCollapsed((prev) => !prev)}
              title={sidebarCollapsed ? "Expand Inspector & Outliner (N)" : "Collapse Inspector & Outliner (N)"}
              aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            >
              <BlenderIcon name={sidebarCollapsed ? "tria_left_bar" : "tria_right_bar"} size={13} />
            </button>
          )}
          {workspace.shellMode === 'texture' && (
            <button
              type="button"
              className={`tool sidebar-header-toggle${workspace.texture.uvInspectorOpen ? ' is-active' : ''}`}
              onClick={() => workspace.patchTexture({ uvInspectorOpen: !workspace.texture.uvInspectorOpen })}
              title={workspace.texture.uvInspectorOpen ? 'Hide inspector (N)' : 'Show inspector (N)'}
              aria-label={workspace.texture.uvInspectorOpen ? 'Hide inspector' : 'Show inspector'}
            >
              <BlenderIcon name={workspace.texture.uvInspectorOpen ? 'tria_right_bar' : 'tria_left_bar'} size={13} />
            </button>
          )}
        </div>
      </header>

      <main className={`workspace${workspace.shellMode === 'animate' ? ' is-animate' : ''}${workspace.shellMode === 'rig' ? ' is-rig' : ''}${workspace.shellMode === 'blockout' ? ' is-blockout' : ''}${workspace.shellMode === 'terrain' ? ' is-terrain' : ''}`}>
        {(workspace.shellMode === 'model' || workspace.shellMode === 'blockout') && !zenMode && (
          <LeftToolbar
            session={session}
            workspace={workspace}
            gizmoMode={gizmoMode}
            setGizmoMode={setGizmoMode}
            onRefresh={refresh}
            layoutMode={workspace.layoutMode}
            selectionMode={sel.mode}
            onChooseSelectionMode={chooseMode}
            onToggleLayout={() => {
              workspace.toggleViewportMaximize(workspace.activeViewportId || 'persp');
              viewportEngine.invalidate();
              refresh();
            }}
          />
        )}
        {workspace.shellMode === 'rig' ? (
          <div className="rig-workspace-upper">
            <div className="workspace-main">
              <Viewport session={session} workspace={workspace} />
            </div>
            {rigPanelOpen ? (
              <>
                <div
                  className={`rig-panel-divider-v${rigPanelResizer.isResizing ? ' is-active' : ''}`}
                  {...rigPanelResizer.resizerProps}
                  title="Drag to resize Rigging panel (Double-click to reset)"
                />
                <div
                  ref={rigPanelResizer.containerRef}
                  style={{
                    width: rigPanelResizer.width,
                    minWidth: rigPanelResizer.width,
                    maxWidth: rigPanelResizer.width,
                    height: '100%',
                    minHeight: 0,
                    display: 'flex',
                    flexDirection: 'column',
                  }}
                >
                  <RiggingPanel
                    session={animation}
                    onRefresh={refresh}
                    onSwitchToAnimate={() => setShell('animate')}
                    onSwitchToModel={() => setShell('model')}
                    onToggleCollapse={toggleRigPanel}
                  />
                </div>
              </>
            ) : (
              <button
                type="button"
                className="rig-sidebar-collapsed is-right"
                onClick={toggleRigPanel}
                title="Show Rigging panel"
              >
                <BlenderIcon name="tria_left" size={12} />
                <span>Rigging</span>
              </button>
            )}
          </div>
        ) : workspace.shellMode === 'animate' ? (
          <div className="rig-workspace-stack" ref={workspaceStackRef}>
            <div className="rig-workspace-upper">
              {animClipsOpen ? (
                <>
                  <div
                    ref={animClipsResizer.containerRef}
                    style={{
                      width: animClipsResizer.width,
                      minWidth: animClipsResizer.width,
                      maxWidth: animClipsResizer.width,
                      height: '100%',
                      minHeight: 0,
                      display: 'flex',
                      flexDirection: 'column',
                    }}
                  >
                    <AnimationClipsPanel
                      session={animation}
                      onRefresh={refresh}
                      onSwitchToRig={() => setShell('rig')}
                      onToggleCollapse={toggleAnimClips}
                    />
                  </div>
                  <div
                    className={`rig-panel-divider-v${animClipsResizer.isResizing ? ' is-active' : ''}`}
                    {...animClipsResizer.resizerProps}
                    title="Drag to resize Animations panel (Double-click to reset)"
                  />
                </>
              ) : (
                <button
                  type="button"
                  className="rig-sidebar-collapsed is-left"
                  onClick={toggleAnimClips}
                  title="Show Animations panel"
                >
                  <BlenderIcon name="tria_right" size={12} />
                  <span>Animations</span>
                </button>
              )}
              <div className="workspace-main">
                <Viewport session={session} workspace={workspace} />
              </div>
              {animInspectorOpen ? (
                <>
                  <div
                    className={`rig-panel-divider-v${animInspectorResizer.isResizing ? ' is-active' : ''}`}
                    {...animInspectorResizer.resizerProps}
                    title="Drag to resize Inspector panel (Double-click to reset)"
                  />
                  <div
                    ref={animInspectorResizer.containerRef}
                    style={{
                      width: animInspectorResizer.width,
                      minWidth: animInspectorResizer.width,
                      maxWidth: animInspectorResizer.width,
                      height: '100%',
                      minHeight: 0,
                      display: 'flex',
                      flexDirection: 'column',
                    }}
                  >
                    <AnimationInspectorPanel
                      session={animation}
                      onRefresh={refresh}
                      onToggleCollapse={toggleAnimInspector}
                    />
                  </div>
                </>
              ) : (
                <button
                  type="button"
                  className="rig-sidebar-collapsed is-right"
                  onClick={toggleAnimInspector}
                  title="Show Inspector panel"
                >
                  <BlenderIcon name="tria_left" size={12} />
                  <span>Inspector</span>
                </button>
              )}
            </div>
            <div className="rig-anim-bar-dock">
              <AnimationBar
                session={animation}
                onRefresh={refresh}
                onRequestTimeline={() => setTimelineOpen(true)}
                timelineOpen={timelineOpen}
                onToggleTimeline={() => setTimelineOpen((open) => !open)}
                clipsOpen={animClipsOpen}
                onToggleClips={toggleAnimClips}
                inspectorOpen={animInspectorOpen}
                onToggleInspector={toggleAnimInspector}
              />
            </div>
            {timelineOpen && (
              <>
                <div
                  className="divider divider-h rig-timeline-divider"
                  role="separator"
                  aria-orientation="horizontal"
                  aria-label="Resize dope sheet"
                  onPointerDown={() => { timelineDragRef.current = true; }}
                  onDoubleClick={() => setTimelineHeight(TIMELINE_HEIGHT_DEFAULT)}
                  title="Drag to resize dope sheet (Double-click to reset)"
                />
                <section className="rig-timeline-dock" style={{ height: timelineHeight }} aria-label="Dope sheet">
                  <DopeSheet session={animation} onRefresh={refresh} showToolbar={false} />
                </section>
              </>
            )}
          </div>
        ) : (
          <>
            <UvInspectorHostProvider>
            <div className="workspace-main">
              <Viewport session={session} workspace={workspace} />
              {zenMode && (
                <>
                  <button
                    type="button"
                    className="zen-edge-hit is-left"
                    title="Exit Zen Mode (Shift+Space)"
                    aria-label="Exit Zen Mode"
                    onClick={() => setZenMode(false)}
                  />
                  <button
                    type="button"
                    className="zen-edge-hit is-right"
                    title="Exit Zen Mode (Shift+Space)"
                    aria-label="Show inspector"
                    onClick={() => {
                      setZenMode(false);
                      setSidebarCollapsed(false);
                    }}
                  />
                </>
              )}
              {((workspace.shellMode === 'model' && sidebarCollapsed) ||
                (workspace.shellMode === 'texture' && !workspace.texture.uvInspectorOpen)) && (
                <button
                  type="button"
                  className="viewport-edge-expand-handle"
                  onClick={() => {
                    if (workspace.shellMode === 'texture') {
                      workspace.patchTexture({ uvInspectorOpen: true });
                    } else {
                      setSidebarCollapsed(false);
                    }
                  }}
                  title="Expand Inspector & Outliner (N)"
                  aria-label="Expand inspector sidebar"
                >
                  <BlenderIcon name="tria_left_bar" size={13} />
                </button>
              )}
            </div>
            {(workspace.shellMode === 'model' || workspace.shellMode === 'texture') && !zenMode && (
              <RightSidebar
                session={session}
                workspace={workspace}
                onRefresh={refresh}
                editFaces={editFaces}
                chooseMode={chooseMode}
                toggleXRay={toggleXRay}
                setGizmoMode={setGizmoMode}
                setOrientation={setOrientation}
                setPivot={setPivot}
                outlinerTab={outlinerTab}
                setOutlinerTab={setOutlinerTab}
                isCollapsed={
                  workspace.shellMode === 'texture'
                    ? !workspace.texture.uvInspectorOpen
                    : sidebarCollapsed
                }
                onToggleCollapse={() => {
                  if (workspace.shellMode === 'texture') {
                    workspace.patchTexture({ uvInspectorOpen: !workspace.texture.uvInspectorOpen });
                  } else {
                    setSidebarCollapsed((prev) => !prev);
                  }
                }}
                recoveryState={recoveryState}
                textureInspector={workspace.shellMode === 'texture'}
              />
            )}
            {workspace.shellMode === 'sculpt' && (
              <SculptPanel
                session={session}
                onRefresh={refresh}
              />
            )}
            {workspace.shellMode === 'terrain' && (
              <TerrainPanel
                session={session}
                workspace={workspace}
                onRefresh={refresh}
                onOpenSceneObjects={() => setTerrainObjectsOpen(true)}
                sceneObjectsOpen={terrainObjectsOpen}
                focusTab={terrainFocusTab}
              />
            )}
            {workspace.shellMode === 'blockout' && (
              <BlockoutPanel
                session={session}
                workspace={workspace}
                onRefresh={refresh}
                onSwitchToModel={() => setShell('model')}
                gizmoMode={gizmoMode}
                setGizmoMode={setGizmoMode}
                chooseMode={chooseMode}
              />
            )}
            </UvInspectorHostProvider>
          </>
        )}
      </main>

      {(workspace.shellMode === 'model' || workspace.shellMode === 'blockout') && outlinerOpen && (
        <FloatingOutliner
          session={session}
          activeTab={outlinerTab}
          onTabChange={setOutlinerTab}
          onClose={() => setOutlinerOpen(false)}
          onRefresh={refresh}
        />
      )}
      {workspace.shellMode === 'terrain' && terrainObjectsOpen && (
        <FloatingTerrainObjects
          session={session}
          workspace={workspace}
          onClose={() => setTerrainObjectsOpen(false)}
          onRefresh={refresh}
        />
      )}

      <footer className="status">
        <div className="status-left">
        <span>
          {workspace.hoveredViewportId
            ? VIEW_LABELS[workspace.hoveredViewportId]
            : VIEW_LABELS[workspace.activeViewportId]}
        </span>
        {!isCreating && !isDoodling && !isDrawing && !isSculptingTerrain && !isSculptingMesh && !isPaintingObjects && !isBlockoutDraw && !transformActive && workspace.shellMode !== 'animate' && workspace.shellMode !== 'rig' && workspace.shellMode !== 'blockout' && workspace.shellMode !== 'terrain' && (
          <span>
            {sel.mode}
            {sel.xRay ? ' · x-ray' : ' · visible'}
            {' · '}
            {SHADING_MODE_LABELS[shadingMode]}
            {displayTextures ? ' · textures' : ''}
            {' · '}
            {selectionSummary}
            {hoverSummary ? ` · ${hoverSummary}` : ''}
          </span>
        )}
        {transformActive && <span className="transform-status">{transformStatus}</span>}
        {(isDrawing || isDoodling) && (
          <span className="transform-status">
            {isDrawing
              ? drawTool.statusLine()
              : doodleTool.state.strokeLocked
                ? workspace.curveNodeEditMode
                  ? `Point Edit · ${doodleTool.state.points.length} points · ${doodleTool.style.replace('-', ' ')}`
                  : `Curve Review · ${doodleTool.state.points.length} points`
                : doodleTool.inputMode === 'pen'
                  ? `Vector Pen · ${doodleTool.style.replace('-', ' ')} · ${doodleTool.state.points.length} points`
                  : doodleTool.state.stage === 'drawing'
                    ? `Curve Sketch · ${doodleTool.style.replace('-', ' ')} · drawing`
                    : `Curve Sketch · ${doodleTool.style.replace('-', ' ')} · ready`}
          </span>
        )}
        {workspace.shellMode === 'terrain' && (
          <span className="transform-status">
            {[...session.document.objects.values()].some((object) => object.metadata.terrain === 'true')
              ? activeTool === terrainObjectTool
                ? terrainObjectTool.statusLine()
                : activeTool === terrainFeatureTool
                  ? terrainFeatureTool.statusLine()
                  : activeTool === terrainTool
                    ? terrainTool.statusLine()
                    : 'Select · G/R/S transform props · 1 sculpt · 2 objects · 3 water'
              : 'Create a terrain from the panel on the right'}
          </span>
        )}
        {workspace.shellMode === 'rig' && (
          <span className="transform-status">
            {animation.editMode === 'weight' ? 'Weights' : 'Bones'}
            {' · '}
            {animation.getSelectedBoneName() ?? 'no bone'}
          </span>
        )}
        {workspace.shellMode === 'animate' && (
          <span className="transform-status">
            {animation.editMode === 'pose' ? 'Pose' : animation.editMode === 'weight' ? 'Weights' : 'Bones'}
            {' · '}
            {animation.selectedBoneId ? 'bone selected' : 'no bone'}
            {' · '}
            F{Math.round(animation.playbackTime * (getActiveClip(animation.project, animation.rigDocument)?.fps ?? 24))}
          </span>
        )}
        {workspace.shellMode === 'blockout' && (
          <span className="transform-status">
            {isBlockoutVector
              ? `Flat · ${blockoutVectorTool?.state.points.length ?? 0} pts`
              : isBlockoutSolid
                ? `Square · ${blockoutSolidTool?.state.points.length ?? 0} pts · T ${blockoutSolidTool?.thickness.toFixed(2)}`
                : isBlockoutRound
                  ? `Round · ${blockoutRoundTool?.sides ?? 8} sides · T ${blockoutRoundTool?.thickness.toFixed(2)}`
                  : `${sel.mode}${sel.xRay ? ' · x-ray' : ''} · ${selectionSummary || 'Move'}`}
          </span>
        )}
        </div>
        <div className="status-right">
        <span className="dim">
          {isCreating
            ? `${PRIMITIVE_LABELS[primitiveTool.state.kind]} · ${primitiveTool.state.stage} · W ${dimensions.width.toFixed(2)} H ${dimensions.height.toFixed(2)} D ${dimensions.depth.toFixed(2)} · ${primitiveTool.state.constructionPlaneId} plane · snap ${primitiveTool.state.snapLabel}`
            : isDrawing
              ? drawTool.buildMode === 'vertices'
                ? 'Click place · orange = new · Enter commit batch · Ctrl+Z/Y undo redo · Esc clear'
                : 'Click place · orange = new · green = close · Enter finish · Ctrl+Z/Y undo redo · Esc clear'
              : isDoodling
                ? doodleTool.inputMode === 'pen'
                  ? doodleTool.state.stage === 'drawing'
                    ? 'LMB place point · drag nodes · Enter finish · Backspace delete node · Esc cancel'
                    : 'Select curve objects · G/R/S transform · LMB place points on empty space for next curve · Esc exit'
                  : doodleTool.state.strokeLocked
                    ? workspace.curveNodeEditMode
                      ? 'Drag points · Done Editing Points to use G/R/S · Finish Curve when ready · Esc cancel'
                      : 'Edit Points to reshape · Finish Curve · Esc cancel'
                    : doodleTool.state.stage === 'drawing'
                      ? 'LMB drag to sketch · release to review stroke'
                      : 'Select curve objects · G/R/S transform · LMB drag empty space for next curve · Esc exit'
                : transformActive
                  ? 'Enter/LMB confirm · Esc/RMB cancel · X/Y/Z · Shift+axis · Ctrl toggle snap'
                  : workspace.shellMode === 'sculpt'
                    ? 'LMB sculpt · Alt+drag orbit · Shift+Alt pan · Ctrl+Alt zoom · wheel brush size · Shift-wheel pan · Alt sample flatten · RMB pan'
                  : workspace.shellMode === 'terrain'
                    ? activeTool === terrainObjectTool
                      ? terrainObjectTool.mode === 'place'
                        ? 'LMB place · Alt+drag orbit · Shift+Alt pan · Ctrl+Alt zoom · RMB pan · wheel/[ ] size'
                        : 'LMB drag brush · Alt+drag orbit · Shift+Alt pan · Ctrl+Alt zoom · wheel/[ ] size · RMB pan'
                      : activeTool === terrainFeatureTool
                        ? 'LMB drag river/path · Alt+drag orbit · wheel/[ ] width · RMB pan · release to commit'
                        : activeTool === terrainTool
                          ? terrainTool.mode === 'flatten'
                            ? 'LMB flatten · Ctrl+click sample height · Alt+drag orbit · wheel/[ ] size · RMB pan'
                            : 'LMB sculpt · Alt+drag orbit · Shift+Alt pan · Ctrl+Alt zoom · wheel/[ ] size · RMB pan'
                          : 'LMB select · LMB drag orbit · Alt+drag orbit · RMB pan · G/R/S transform'
                  : workspace.shellMode === 'texture'
                    ? '3D · LightWave Alt orbit · UV · Alt pan · Ctrl+Alt zoom · N inspector · Tab hides pane'
                  : workspace.shellMode === 'rig'
                    ? animation.editMode === 'weight'
                      ? 'LMB paint · Ctrl subtract · wheel/[ ] radius · ↑↓ bone · M mirror'
                      : 'LMB select · drag head/tail · E extrude · ↑↓ bone · M mirror'
                  : workspace.shellMode === 'animate'
                    ? 'LMB pick bone · G/R/U pose · I key · Shift+I all · Space play · Delete key · Alt+drag orbit'
                  : workspace.shellMode === 'blockout'
                    ? isBlockoutVector
                      ? blockoutVectorTool?.state.stage === 'width'
                        ? 'Move for width · slider / wheel · click or Enter commit · Esc back'
                        : 'Flat · outline only · click start to close · Enter set width'
                      : isBlockoutSolid
                        ? blockoutSolidTool?.state.stage === 'width'
                          ? 'Move for width · slider / wheel · click or Enter commit · Esc back'
                          : 'Square · any view · Enter set width · Alt+drag orbit'
                        : isBlockoutRound
                          ? blockoutRoundTool?.state.stage === 'width'
                            ? 'Move for width · slider / wheel · click or Enter commit · Esc back'
                            : 'Round · drag a box for an 8-sided ellipse · Alt+drag orbit'
                          : 'G/R/S transform · Delete · V Flat · Q Square · O Round · drop image on Front/Side'
                    : 'LMB drag orbit · RMB pan · wheel zoom · G/R/S · E extrude · F frame · ? help'}
        </span>
        <span className="dim">v{APP_VERSION} alpha</span>
        </div>
      </footer>

      {recoveryModalOpen && (
        <AutosaveRecoveryDialog
          autosaves={autosaveOffers}
          promptOnStartup={promptRecoveryOnStartup}
          onTogglePromptOnStartup={handleTogglePromptRecovery}
          onRestore={(payload) => {
            restoreAutosave(payload);
            setRecoveryModalOpen(false);
          }}
          onDiscard={discardAutosave}
          onDiscardAll={discardAllAutosaves}
          onClose={() => setRecoveryModalOpen(false)}
          onCreateCheckpoint={() => void createRecoveryPoint()}
        />
      )}
      <HotkeyHelpOverlay open={hotkeysOpen} onClose={() => setHotkeysOpen(false)} />
      <ToastStack toasts={toasts} />
    </div>
  );
}
