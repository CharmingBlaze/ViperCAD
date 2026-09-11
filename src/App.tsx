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
import { exportDocumentGlb, exportRigGlb, documentHasSkinnedExport, validateGlbRoundTrip } from '@/app/GameExport';
import { EditorSession } from '@/core/editor/EditorSession';
import { preloadDefaultPlaceholderImage } from '@/core/image/DefaultPlaceholderImage';
import { beginBlenderOperator } from '@/app/blender/BlenderControlEngine';
import { applyFillHotkey, applyMergeHotkey } from '@/app/ModelingEditHotkeys';
import { masterInputEngine } from '@/app/input/MasterInputEngine';
import { PRIMITIVE_LABELS } from '@/core/primitives/PrimitiveFactory';
import { CreateDoodleTool } from '@/core/tools/CreateDoodleTool';
import { CreatePrimitiveTool } from '@/core/tools/CreatePrimitiveTool';
import { DrawPolyTool } from '@/core/tools/DrawPolyTool';
import { TerrainSculptTool } from '@/core/tools/TerrainSculptTool';
import { MeshSculptTool } from '@/core/tools/MeshSculptTool';
import { TerrainObjectTool } from '@/core/tools/TerrainObjectTool';
import { TerrainFeatureTool } from '@/core/tools/TerrainFeatureTool';
import { TerrainStructureTool } from '@/core/tools/TerrainStructureTool';
import { activateTerrainWorkspaceTool } from '@/app/terrainWorkspace';
import { openTerrainTilesetWorkspace, openTilesetWorkspace, openUvPixelWorkspace, prepareTileDraw, prepareTilePaint, tileEditorJob, toggleTilesetPopup } from '@/app/tilesetWorkspace';
import {
  readSculptPanelOpen,
  resetSculptPanelLayout,
  writeSculptPanelOpen,
} from '@/app/sculptWorkspace';
import { resolveTerrainAsset } from '@/core/terrain/Terrain';
import { sculptableObjects } from '@/core/sculpt/MeshSculptTarget';
import type { GizmoMode, TransformOrientation, TransformPivotMode } from '@/core/transform/types';
import { WorkspaceController } from '@/workspace/WorkspaceController';
import { VIEW_LABELS, SHADING_MODE_LABELS, type ShadingMode } from '@/workspace/types';
import { APP_VERSION } from '@/app/appVersion';
import { registerProjectCapture } from '@/app/crashRecovery';
import { serializeProject, serializeViperProject } from '@/core/persistence/ProjectSerializer';
import { firstMeshValidationError, inspectDocumentHealth, inspectProjectHealth, openViperProjectText } from '@/core/persistence/projectHealth';
import { validateMeshFull } from '@/core/mesh/Validation';
import { exportObj, importObj } from '@/core/io/ObjAdapter';
import { commitMeshObject } from '@/core/document/ModelDocument';
import { createEmptyProject, clearProjectDirty, projectIsDirty } from '@/core/document/ViperProject';
import { DocumentTabs } from '@/app/DocumentTabs';
import { enterGroupFocus, exitGroupFocus, exitToDocumentRoot } from '@/core/editor/GroupFocus';
import { placeModelQuick } from '@/app/outliner/placeModelWorkflow';
import { renameProjectDocument, deleteProjectDocument } from '@/app/outliner/documentActions';
import { modelHasPlaceableGeometry } from '@/core/editor/ModelInstances';
import { getViperDocument } from '@/core/document/ViperProject';
import { isGroupObject } from '@/core/editor/Hierarchy';
import { ensurePaintableUvs } from '@/core/uv/EnsurePaintableUvs';
import { commitCopySelection, commitPasteClipboard } from '@/core/editor/Clipboard';
import {
  commitGroupSelection,
  commitUngroupSelection,
} from '@/core/editor/HierarchyCommands';
import { FloatingModelToolsPanel } from '@/app/modelTools/FloatingModelToolsPanel';
import {
  flipObjectScale,
  mirrorObjectAcrossWorld,
  duplicateAndMirrorObjects,
  rotateObjectsDegrees,
  centerObjectsOnAxis,
  snapObjectsToGround,
  duplicateAndMirrorFaces,
  flipFaces,
} from '@/core/editor/ModelTransformTools';
import { runMeshTransaction } from '@/core/history/Transaction';
import {
  readObjectModifierStack,
  writeObjectModifierStack,
} from '@/core/modifiers/serialize';
import { createDefaultMirrorModifier, MODIFIER_STACK_METADATA_KEY } from '@/core/modifiers/types';
import { AutosaveRecoveryDialog } from '@/app/AutosaveRecoveryDialog';
import { AppPropertiesDialog } from '@/app/AppPropertiesDialog';
import { AppDialogHost } from '@/app/AppDialogHost';
import { confirmAction, promptText } from '@/app/platform/appDialogs';
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
  PROMPT_RECOVERY_KEY,
  readAutosaves,
  readRecoveryDismissedAt,
  rememberRecoveryDismissed,
  shouldOfferRecoveryPrompt,
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
import {
  getAppPreferences,
  renderQualityScale,
  subscribeAppPreferences,
  type RenderQualityId,
} from '@/app/preferences/appPreferences';
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
  const [outlinerTab, setOutlinerTab] = useState<'scene' | 'assets' | 'models' | 'levels'>('scene');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [zenMode, setZenMode] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [modelQuickToolsOpen, setModelQuickToolsOpen] = useState(false);
  const [themeId, setThemeId] = useState<WorkspaceThemeId>(() => readStoredTheme());
  const [terrainObjectsOpen, setTerrainObjectsOpen] = useState(false);
  const [terrainFocusTab, setTerrainFocusTab] = useState<TerrainPanelTab | null>(null);
  const [sculptBrushesOpen, setSculptBrushesOpen] = useState(() => readSculptPanelOpen('brushes'));
  const [sculptSettingsOpen, setSculptSettingsOpen] = useState(() => readSculptPanelOpen('settings'));
  const [sculptMeshOpen, setSculptMeshOpen] = useState(() => readSculptPanelOpen('mesh'));
  const [sculptLayoutKey, setSculptLayoutKey] = useState(0);
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
      const stored = localStorage.getItem(PROMPT_RECOVERY_KEY);
      return stored === null ? true : stored === 'true';
    } catch {
      return false;
    }
  });
  const [recoveryModalOpen, setRecoveryModalOpen] = useState(false);
  const [propertiesOpen, setPropertiesOpen] = useState(false);
  const [hotkeysOpen, setHotkeysOpen] = useState(false);
  const [exportProfileId, setExportProfileId] = useState<ExportProfile['id']>('godot');
  const projectFileToken = useRef<FileToken | null>(null);
  const toasts = useToasts();
  const refresh = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    const applyQuality = (prefs: { renderQuality: RenderQualityId }) => {
      viewportEngine.setRenderQuality(renderQualityScale(prefs.renderQuality));
    };
    applyQuality(getAppPreferences());
    return subscribeAppPreferences(applyQuality);
  }, []);

  useEffect(() => session.onRedraw(refresh), [session, refresh]);
  useEffect(() => workspace.subscribe(refresh), [workspace, refresh]);
  useEffect(() => animation.subscribe(refresh), [animation, refresh]);
  useEffect(() => {
    writeSculptPanelOpen({
      brushes: sculptBrushesOpen,
      settings: sculptSettingsOpen,
      mesh: sculptMeshOpen,
    });
  }, [sculptBrushesOpen, sculptSettingsOpen, sculptMeshOpen]);
  useEffect(() => {
    viewportEngine.setAnimationSession(animation);
    return () => viewportEngine.setAnimationSession(null);
  }, [animation]);

  useEffect(() => {
    if (!animation.playing) return;
    let frame = 0;
    let last = performance.now();
    const loop = (now: number) => {
      frame = requestAnimationFrame(loop);
      animation.advancePlayback((now - last) / 1000);
      last = now;
    };
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, [animation, animation.playing]);

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
  }, [session, workspace, refresh]);

  useEffect(() => {
    let active = true;
    void readAutosaves().then((existing) => {
      if (active) {
        setAutosaveOffers(existing);
        if (
          shouldOfferRecoveryPrompt(existing, {
            promptOnStartup: promptRecoveryOnStartup,
            dismissedAt: readRecoveryDismissedAt(),
          })
        ) {
          setRecoveryModalOpen(true);
        }
      }
    });
    return () => { active = false; };
  }, [promptRecoveryOnStartup]);

  useEffect(() => {
    const snapshot = () => {
      try {
        animation.flushToProject();
        return serializeViperProject(session.project, APP_VERSION);
      } catch {
        return serializeProject(session.document, APP_VERSION);
      }
    };
    registerProjectCapture(snapshot, () => projectIsDirty(session.project));
    const timer = window.setInterval(() => {
      if (!projectIsDirty(session.project)) return;
      void writeAutosave(snapshot(), session.project.name || 'Autosave');
    }, 5000);
    const onHide = () => {
      if (document.visibilityState !== 'hidden') return;
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
  }, [session, animation]);

  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!projectIsDirty(session.project)) return;
      event.preventDefault();
      event.returnValue = '';
    };
    const blockBrowserFileNav = (event: DragEvent) => {
      event.preventDefault();
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    window.addEventListener('dragover', blockBrowserFileNav);
    window.addEventListener('drop', blockBrowserFileNav);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      window.removeEventListener('dragover', blockBrowserFileNav);
      window.removeEventListener('drop', blockBrowserFileNav);
    };
  }, [session]);

  useEffect(() => {
    masterInputEngine.attach(window);
    return () => masterInputEngine.detach();
  }, []);

  const confirmReplaceDirtyProject = useCallback(async () => {
    if (!projectIsDirty(session.project)) return true;
    return confirmAction({
      title: 'Unsaved changes',
      message: 'This project has unsaved changes. Discard them and continue?',
      confirmLabel: 'Discard',
      danger: true,
    });
  }, [session]);

  const newProject = useCallback(async () => {
    if (!(await confirmReplaceDirtyProject())) return;
    session.loadProject(createEmptyProject());
    animation.syncFromProject();
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
  }, [confirmReplaceDirtyProject, refresh, session, workspace, animation]);

  const toggleOutliner = () => {
    setOutlinerOpen((open) => !open);
    refresh();
  };

  const saveProject = useCallback(async (saveAs = false) => {
    try {
      animation.flushToProject();
      const health = inspectProjectHealth(session.project);
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
  }, [refresh, session, animation]);

  const openProjectDialog = useCallback(async () => {
    if (!(await confirmReplaceDirtyProject())) return;
    try {
      const selected = await openNativeFile({ types: [VIPER_PROJECT_FILE] });
      if (!selected) return;
      const { project, activeDocumentId } = openViperProjectText(await selected.file.text());
      session.loadProject(project, activeDocumentId);
      animation.syncFromProject();
      session.project.name = selected.file.name.replace(/\.(?:viper|json)$/i, '') || session.project.name;
      projectFileToken.current = selected.token;
      void clearAutomaticAutosaves();
      pushToast(`Opened ${selected.file.name}`, 'success');
      refresh();
    } catch (error) {
      pushToast(error instanceof Error ? error.message : 'Failed to open project', 'error');
    }
  }, [confirmReplaceDirtyProject, refresh, session, animation]);

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
        setPropertiesOpen,
        setZenMode,
        setSidebarCollapsed,
        newProject: () => void newProject(),
        saveProject: (saveAs) => void saveProject(saveAs),
        openProject: () => void openProjectDialog(),
        hotkeysOpen,
        zenMode,
        modelQuickToolsOpen,
        setModelQuickToolsOpen,
        animation,
      },
    });
  }, [session, workspace, refresh, hotkeysOpen, zenMode, modelQuickToolsOpen, animation, newProject, saveProject, openProjectDialog]);

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
    animation.flushToProject();
    const saved = await writeNamedAutosave(name, serializeViperProject(session.project, APP_VERSION));
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
      const skinned = documentHasSkinnedExport(session.project, session.document);
      const buffer = skinned
        ? await exportRigGlb(animation, profile)
        : await exportDocumentGlb(session.document, profile);
      const roundTrip = await validateGlbRoundTrip(buffer);
      if (roundTrip.errors.length) {
        pushToast(roundTrip.errors[0]!, 'error');
        return;
      }
      await writeNativeFile(target, buffer, 'model/gltf-binary');
      pushToast(
        skinned
          ? `Exported ${target.name} for ${profile.label} · verified ${roundTrip.triangles} triangles, ${roundTrip.skeletons} skeleton${roundTrip.skeletons === 1 ? '' : 's'}`
          : `Exported ${target.name} for ${profile.label} · verified ${roundTrip.triangles} triangles`,
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
  const terrainStructureTool = session.tools.get('terrain-structure') as TerrainStructureTool;
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
      animation.syncFromProject();
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
    rememberRecoveryDismissed();
    void clearAutosave();
    setAutosaveOffers([]);
    pushToast('Recovery history cleared', 'info');
  };

  const handleTogglePromptRecovery = (val?: boolean) => {
    setPromptRecoveryOnStartup((prev) => {
      const next = typeof val === 'boolean' ? val : !prev;
      try {
        localStorage.setItem(PROMPT_RECOVERY_KEY, String(next));
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
    viewportEngine.invalidate();
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

  const setDisplayTexturesEnabled = (enabled: boolean) => {
    workspace.setDisplayTextures(enabled);
    session.requestRedraw();
    refresh();
  };

  const setDrawOnSurfacesEnabled = (enabled: boolean) => {
    workspace.setDrawOnSurfaces(enabled);
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
      openUvPixelWorkspace(session, workspace);
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

  const handleModelFlipHorizontal = (acrossWorld = false) => {
    const isEditMode = session.selection.state.mode !== 'object';
    const activeObj = session.selection.state.activeObjectId
      ? session.document.objects.get(session.selection.state.activeObjectId)
      : null;
    const mesh = activeObj?.meshId ? session.document.meshes.get(activeObj.meshId) : null;

    if (isEditMode && mesh && session.selection.state.mode === 'face' && session.selection.state.selectedFaceIds.size > 0) {
      const faceIds = [...session.selection.state.selectedFaceIds];
      const result = runMeshTransaction(
        session.history,
        mesh,
        `Flip ${faceIds.length} Face UVs Horizontal`,
        () => {
          for (const fId of faceIds) {
            const face = mesh.faces.get(fId);
            if (!face) continue;
            for (const cId of face.cornerIds) {
              const corner = mesh.faceCorners.get(cId);
              if (!corner || !mesh.defaultUvLayerId) continue;
              const uv = corner.uvs.get(mesh.defaultUvLayerId);
              if (uv) uv.x = 1 - uv.x;
            }
          }
          mesh.geometryVersion++;
          mesh.dirty.uvs = true;
          return faceIds.length;
        },
        { fullValidation: false, selection: session.selection },
      );
      if (result.ok) {
        pushToast(`Flipped UVs for ${faceIds.length} face(s)`, 'success');
        session.requestRedraw();
        refresh();
      }
      return;
    }

    const targetIds = session.selection.state.selectedObjectIds.size > 0
      ? [...session.selection.state.selectedObjectIds]
      : session.selection.state.activeObjectId
        ? [session.selection.state.activeObjectId]
        : [];

    if (!targetIds.length) {
      pushToast('Select an object or faces to flip', 'error');
      return;
    }

    const prevTransforms = new Map(
      targetIds.map((id) => {
        const obj = session.document.objects.get(id)!;
        return [id, { pos: { ...obj.transform.position }, scale: { ...obj.transform.scale } }];
      }),
    );

    let applied = false;
    const action = () => {
      if (acrossWorld) mirrorObjectAcrossWorld(session.document, targetIds, 'x');
      else flipObjectScale(session.document, targetIds, 'x');
    };
    action();
    applied = true;

    session.history.execute({
      name: acrossWorld ? 'Mirror Objects Across World X' : 'Flip Objects Horizontal (X)',
      execute: () => {
        if (!applied) {
          action();
          applied = true;
          session.document.dirty = true;
          session.requestRedraw();
        }
      },
      undo: () => {
        if (applied) {
          for (const [id, t] of prevTransforms) {
            const obj = session.document.objects.get(id);
            if (obj) {
              obj.transform.position = { ...t.pos };
              obj.transform.scale = { ...t.scale };
            }
          }
          applied = false;
          session.document.dirty = true;
          session.requestRedraw();
        }
      },
    });

    session.requestRedraw();
    refresh();
    pushToast(
      acrossWorld
        ? `Mirrored ${targetIds.length} object(s) across world X=0`
        : `Flipped ${targetIds.length} object(s) along X`,
      'success',
    );
  };

  const handleModelFlipVertical = () => {
    const targetIds = session.selection.state.selectedObjectIds.size > 0
      ? [...session.selection.state.selectedObjectIds]
      : session.selection.state.activeObjectId
        ? [session.selection.state.activeObjectId]
        : [];

    if (!targetIds.length) {
      pushToast('Select an object to flip', 'error');
      return;
    }

    const prevTransforms = new Map(
      targetIds.map((id) => {
        const obj = session.document.objects.get(id)!;
        return [id, { scale: { ...obj.transform.scale } }];
      }),
    );

    flipObjectScale(session.document, targetIds, 'y');
    let applied = true;

    session.history.execute({
      name: 'Flip Objects Vertical (Y)',
      execute: () => {
        if (!applied) {
          flipObjectScale(session.document, targetIds, 'y');
          applied = true;
          session.document.dirty = true;
          session.requestRedraw();
        }
      },
      undo: () => {
        if (applied) {
          for (const [id, t] of prevTransforms) {
            const obj = session.document.objects.get(id);
            if (obj) obj.transform.scale = { ...t.scale };
          }
          applied = false;
          session.document.dirty = true;
          session.requestRedraw();
        }
      },
    });

    session.requestRedraw();
    refresh();
    pushToast(`Flipped ${targetIds.length} object(s) vertically along Y`, 'success');
  };

  const handleModelFlipDepth = () => {
    const targetIds = session.selection.state.selectedObjectIds.size > 0
      ? [...session.selection.state.selectedObjectIds]
      : session.selection.state.activeObjectId
        ? [session.selection.state.activeObjectId]
        : [];

    if (!targetIds.length) {
      pushToast('Select an object to flip', 'error');
      return;
    }

    const prevTransforms = new Map(
      targetIds.map((id) => {
        const obj = session.document.objects.get(id)!;
        return [id, { scale: { ...obj.transform.scale } }];
      }),
    );

    flipObjectScale(session.document, targetIds, 'z');
    let applied = true;

    session.history.execute({
      name: 'Flip Objects Depth (Z)',
      execute: () => {
        if (!applied) {
          flipObjectScale(session.document, targetIds, 'z');
          applied = true;
          session.document.dirty = true;
          session.requestRedraw();
        }
      },
      undo: () => {
        if (applied) {
          for (const [id, t] of prevTransforms) {
            const obj = session.document.objects.get(id);
            if (obj) obj.transform.scale = { ...t.scale };
          }
          applied = false;
          session.document.dirty = true;
          session.requestRedraw();
        }
      },
    });

    session.requestRedraw();
    refresh();
    pushToast(`Flipped ${targetIds.length} object(s) along Z (depth)`, 'success');
  };

  const handleModelFlipNormals = () => {
    const activeObj = session.selection.state.activeObjectId
      ? session.document.objects.get(session.selection.state.activeObjectId)
      : null;
    const mesh = activeObj?.meshId ? session.document.meshes.get(activeObj.meshId) : null;
    if (!mesh) {
      pushToast('Select a mesh object to flip normals', 'error');
      return;
    }

    const isEditMode = session.selection.state.mode !== 'object';
    const targetFaceIds = isEditMode && session.selection.state.selectedFaceIds.size > 0
      ? [...session.selection.state.selectedFaceIds]
      : [...mesh.faces.keys()];

    if (!targetFaceFaceCount(targetFaceIds)) {
      pushToast('No faces to flip', 'error');
      return;
    }

    const result = runMeshTransaction(
      session.history,
      mesh,
      `Flip Normals (${targetFaceIds.length} faces)`,
      (m) => flipFaces(m, targetFaceIds),
      { fullValidation: true, selection: session.selection },
    );

    if (result.ok) {
      pushToast(`Flipped normals of ${targetFaceIds.length} face(s)`, 'success');
      session.requestRedraw();
      refresh();
    } else {
      pushToast(result.error ?? 'Failed to flip normals', 'error');
    }
  };

  function targetFaceFaceCount(faces: unknown[]): boolean {
    return faces.length > 0;
  }

  const handleModelDuplicateAndMirror = (linked = false) => {
    const isEditMode = session.selection.state.mode !== 'object';
    const activeObj = session.selection.state.activeObjectId
      ? session.document.objects.get(session.selection.state.activeObjectId)
      : null;
    const mesh = activeObj?.meshId ? session.document.meshes.get(activeObj.meshId) : null;

    if (isEditMode && mesh && session.selection.state.selectedFaceIds.size > 0) {
      const faceIds = [...session.selection.state.selectedFaceIds];
      let newCreatedIds: string[] = [];

      const result = runMeshTransaction(
        session.history,
        mesh,
        `Duplicate & Mirror ${faceIds.length} Faces across X`,
        (m) => {
          const res = duplicateAndMirrorFaces(m, faceIds, 'x');
          newCreatedIds = res.newFaceIds;
          return res;
        },
        { fullValidation: true, selection: session.selection },
      );

      if (result.ok) {
        session.selection.selectFaces(newCreatedIds, 'replace');
        pushToast(`Duplicated & mirrored ${faceIds.length} face(s) across X=0`, 'success');
        session.requestRedraw();
        refresh();
      } else {
        pushToast(result.error ?? 'Failed to mirror faces', 'error');
      }
      return;
    }

    const targetIds = session.selection.state.selectedObjectIds.size > 0
      ? [...session.selection.state.selectedObjectIds]
      : session.selection.state.activeObjectId
        ? [session.selection.state.activeObjectId]
        : [];

    if (!targetIds.length) {
      pushToast('Select objects or faces to duplicate & mirror', 'error');
      return;
    }

    const createdIds = duplicateAndMirrorObjects(session.document, targetIds, 'x', linked);
    if (!createdIds.length) {
      pushToast('Failed to duplicate & mirror objects', 'error');
      return;
    }

    let applied = true;
    session.history.execute({
      name: linked ? 'Duplicate & Mirror Objects (Linked)' : 'Duplicate & Mirror Objects',
      execute: () => {
        if (!applied) {
          duplicateAndMirrorObjects(session.document, targetIds, 'x', linked);
          applied = true;
          session.document.dirty = true;
          session.requestRedraw();
        }
      },
      undo: () => {
        if (applied) {
          for (const id of createdIds) {
            session.document.objects.delete(id);
          }
          applied = false;
          session.selection.selectObjects(targetIds, 'replace');
          session.document.dirty = true;
          session.requestRedraw();
        }
      },
    });

    session.selection.setMode('object');
    session.selection.selectObjects(createdIds, 'replace');
    session.requestRedraw();
    refresh();
    pushToast(
      linked
        ? `Created ${createdIds.length} linked mirror object(s) across X=0`
        : `Duplicated & mirrored ${createdIds.length} object(s) across X=0`,
      'success',
    );
  };

  const handleModelAddMirrorModifier = () => {
    const activeObj = session.selection.state.activeObjectId
      ? session.document.objects.get(session.selection.state.activeObjectId)
      : null;
    if (!activeObj) {
      pushToast('Select an object to add Mirror modifier', 'error');
      return;
    }

    const currentStack = readObjectModifierStack(activeObj) ?? {
      version: 1,
      modifiers: [],
    };
    const hasMirror = currentStack.modifiers.some((m) => m.kind === 'mirror');
    if (hasMirror) {
      pushToast('Object already has a Mirror modifier in its stack', 'info');
      return;
    }

    const previousStackJson = activeObj.metadata[MODIFIER_STACK_METADATA_KEY];
    const newStack = {
      ...currentStack,
      modifiers: [...currentStack.modifiers, createDefaultMirrorModifier('x')],
    };
    writeObjectModifierStack(activeObj, newStack);
    session.document.dirty = true;

    let applied = true;
    session.history.execute({
      name: 'Add Mirror Modifier (X)',
      execute: () => {
        if (!applied) {
          writeObjectModifierStack(activeObj, newStack);
          applied = true;
          session.document.dirty = true;
          session.requestRedraw();
        }
      },
      undo: () => {
        if (applied) {
          if (previousStackJson) activeObj.metadata[MODIFIER_STACK_METADATA_KEY] = previousStackJson;
          else delete activeObj.metadata[MODIFIER_STACK_METADATA_KEY];
          applied = false;
          session.document.dirty = true;
          session.requestRedraw();
        }
      },
    });

    session.requestRedraw();
    refresh();
    pushToast('Added live Mirror modifier (X axis)', 'success');
  };

  const handleModelRotateDegrees = (axis: 'x' | 'y' | 'z', degrees: number) => {
    const targetIds = session.selection.state.selectedObjectIds.size > 0
      ? [...session.selection.state.selectedObjectIds]
      : session.selection.state.activeObjectId
        ? [session.selection.state.activeObjectId]
        : [];

    if (!targetIds.length) {
      pushToast('Select an object to rotate', 'error');
      return;
    }

    const prevRots = new Map(
      targetIds.map((id) => {
        const obj = session.document.objects.get(id)!;
        return [id, { ...obj.transform.rotation }];
      }),
    );

    rotateObjectsDegrees(session.document, targetIds, axis, degrees);
    let applied = true;

    session.history.execute({
      name: `Rotate Objects ${degrees}° (${axis.toUpperCase()})`,
      execute: () => {
        if (!applied) {
          rotateObjectsDegrees(session.document, targetIds, axis, degrees);
          applied = true;
          session.document.dirty = true;
          session.requestRedraw();
        }
      },
      undo: () => {
        if (applied) {
          for (const [id, rot] of prevRots) {
            const obj = session.document.objects.get(id);
            if (obj) obj.transform.rotation = { ...rot };
          }
          applied = false;
          session.document.dirty = true;
          session.requestRedraw();
        }
      },
    });

    session.requestRedraw();
    refresh();
    pushToast(`Rotated ${targetIds.length} object(s) by ${degrees}° on ${axis.toUpperCase()}`, 'info');
  };

  const handleModelCenterAxis = (axis: 'x' | 'y' | 'z') => {
    const targetIds = session.selection.state.selectedObjectIds.size > 0
      ? [...session.selection.state.selectedObjectIds]
      : session.selection.state.activeObjectId
        ? [session.selection.state.activeObjectId]
        : [];

    if (!targetIds.length) {
      pushToast('Select an object to center', 'error');
      return;
    }

    const prevPositions = new Map(
      targetIds.map((id) => {
        const obj = session.document.objects.get(id)!;
        return [id, { ...obj.transform.position }];
      }),
    );

    centerObjectsOnAxis(session.document, targetIds, axis);
    let applied = true;

    session.history.execute({
      name: `Center Objects on ${axis.toUpperCase()}=0`,
      execute: () => {
        if (!applied) {
          centerObjectsOnAxis(session.document, targetIds, axis);
          applied = true;
          session.document.dirty = true;
          session.requestRedraw();
        }
      },
      undo: () => {
        if (applied) {
          for (const [id, pos] of prevPositions) {
            const obj = session.document.objects.get(id);
            if (obj) obj.transform.position = { ...pos };
          }
          applied = false;
          session.document.dirty = true;
          session.requestRedraw();
        }
      },
    });

    session.requestRedraw();
    refresh();
    pushToast(`Centered ${targetIds.length} object(s) on ${axis.toUpperCase()}=0`, 'success');
  };

  const handleModelSnapToGround = () => {
    const targetIds = session.selection.state.selectedObjectIds.size > 0
      ? [...session.selection.state.selectedObjectIds]
      : session.selection.state.activeObjectId
        ? [session.selection.state.activeObjectId]
        : [];

    if (!targetIds.length) {
      pushToast('Select an object to snap to ground', 'error');
      return;
    }

    const prevPositions = new Map(
      targetIds.map((id) => {
        const obj = session.document.objects.get(id)!;
        return [id, { ...obj.transform.position }];
      }),
    );

    snapObjectsToGround(session.document, targetIds);
    let applied = true;

    session.history.execute({
      name: 'Snap Objects to Ground Y=0',
      execute: () => {
        if (!applied) {
          snapObjectsToGround(session.document, targetIds);
          applied = true;
          session.document.dirty = true;
          session.requestRedraw();
        }
      },
      undo: () => {
        if (applied) {
          for (const [id, pos] of prevPositions) {
            const obj = session.document.objects.get(id);
            if (obj) obj.transform.position = { ...pos };
          }
          applied = false;
          session.document.dirty = true;
          session.requestRedraw();
        }
      },
    });

    session.requestRedraw();
    refresh();
    pushToast(`Snapped ${targetIds.length} object(s) to ground level (Y=0)`, 'success');
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
          label: 'Recovery…',
          action: () => setRecoveryModalOpen(true),
        },
        {
          kind: 'command',
          label: 'Properties…',
          shortcut: 'Ctrl+,',
          action: () => setPropertiesOpen(true),
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
          label: 'Copy',
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
        { kind: 'separator' },
        {
          kind: 'command',
          label: 'Fill',
          shortcut: 'F',
          action: () => {
            if (!applyFillHotkey(session)) pushToast('Select vertices or a hole to fill', 'error');
            refresh();
          },
        },
        {
          kind: 'command',
          label: 'Merge',
          shortcut: 'M',
          action: () => {
            if (!applyMergeHotkey(session)) pushToast('Select vertices, edges, or faces to merge', 'error');
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
            session.openDocument(id);
            refresh();
            pushToast('New Model — edit reusable assets here', 'success');
          },
        },
        {
          kind: 'command',
          label: 'New Level',
          action: () => {
            const id = session.projectEditor.newLevel(`Level ${session.project.levelDocumentIds.length + 1}`);
            session.openDocument(id);
            refresh();
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
                  label: `Place ${modelDoc.name}`,
                  disabled: !modelHasPlaceableGeometry(modelDoc, session.project),
                  action: () => placeModelInActiveLevel(modelId),
                };
              }),
            ]
          : []),
        { kind: 'separator' },
        {
          kind: 'command',
          label: 'Rename',
          action: () => {
            void (async () => {
              const docId = session.documentId;
              const doc = session.project.documents.get(docId);
              if (!doc) return;
              const next = await promptText({
                title: 'Rename',
                message: `Rename this ${doc.kind === 'model' ? 'model' : 'level'}.`,
                value: doc.name,
                confirmLabel: 'Rename',
              });
              if (!next) return;
              renameProjectDocument(session, docId, next, refresh);
            })();
          },
        },
        {
          kind: 'command',
          label: 'Delete',
          action: () => {
            void deleteProjectDocument(session, session.documentId, session.document.kind, refresh);
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
          label: 'Exit to Root',
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
          disabled:
            workspace.shellMode !== 'model' &&
            workspace.shellMode !== 'blockout' &&
            workspace.shellMode !== 'terrain',
          action: toggleOutliner,
        },
        {
          kind: 'command',
          label: 'Object Library',
          checked: workspace.shellMode === 'terrain' && terrainObjectsOpen,
          disabled: workspace.shellMode !== 'terrain',
          action: () => setTerrainObjectsOpen((open) => !open),
        },
        {
          kind: 'command',
          label: 'Flip & Mirror Tools',
          shortcut: 'Shift+M',
          checked: modelQuickToolsOpen,
          action: () => setModelQuickToolsOpen((open) => !open),
        },
        {
          kind: 'command',
          label: 'Navigation Tools',
          checked: workspace.viewportNavToolsVisible,
          action: () => {
            workspace.toggleViewportNavToolsVisible();
            refresh();
          },
        },
        { kind: 'separator' },
        {
          kind: 'command',
          label: 'Frame Selection',
          shortcut: 'Numpad .',
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
          label: 'Reset View',
          shortcut: 'Shift+Home',
          action: () => viewportEngine.resetView(),
        },
        {
          kind: 'command',
          label: workspace.layoutMode === 'maximized' ? 'Restore Quad View' : 'Maximize View',
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
          label: 'Textures',
          checked: displayTextures,
          action: toggleDisplayTextures,
        },
        {
          kind: 'command',
          label: 'X-Ray',
          shortcut: 'Alt+Z',
          checked: sel.xRay,
          action: toggleXRay,
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
          label: 'Help & Shortcuts',
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
    <div
      className={`app${zenMode ? ' is-zen' : ''}`}
      onContextMenu={(event) => {
        const target = event.target;
        if (!(target instanceof HTMLElement)) return;
        if (target.closest('input, textarea, [contenteditable="true"]')) return;
        event.preventDefault();
      }}
    >
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
              className={`tool${workspace.shellMode === 'texture' && workspace.texture.uvPanelTab !== 'tiles' ? ' is-active' : ''}`}
              onClick={() => setShell('texture')}
              aria-pressed={workspace.shellMode === 'texture' && workspace.texture.uvPanelTab !== 'tiles'}
              title="UV and pixel workspace"
            >
              UV / Pixel
            </button>
          </div>
          {(workspace.shellMode === 'model' || workspace.shellMode === 'texture' || workspace.shellMode === 'blockout') && (
            <>
              <span className="bar-sep" aria-hidden />
              <div className="shell-switch selection-switch" role="group" aria-label="Tileset workflow">
                <button
                  type="button"
                  className={`tool${workspace.shellMode === 'texture' && workspace.texture.uvPanelTab === 'tiles' && tileEditorJob(session, workspace) === 'tileset' ? ' is-active' : ''}`}
                  onClick={() => {
                    if (
                      workspace.shellMode === 'texture' &&
                      workspace.texture.uvPanelTab === 'tiles' &&
                      tileEditorJob(session, workspace) === 'tileset'
                    ) {
                      toggleTilesetPopup(workspace);
                      refresh();
                      return;
                    }
                    if (openTilesetWorkspace(session, workspace)) refresh();
                  }}
                  title={
                    workspace.shellMode === 'texture' && workspace.texture.uvPanelTab === 'tiles'
                      ? workspace.texture.atlasPanelOpen
                        ? 'Hide the tileset palette'
                        : 'Show the tileset palette'
                      : 'Manage the tileset atlas and tile selection'
                  }
                >
                  Tileset
                </button>
                <button
                  type="button"
                  className={`tool${tileEditorJob(session, workspace) === 'build' ? ' is-active' : ''}`}
                  onClick={() => {
                    if (prepareTileDraw(session, workspace)) refresh();
                  }}
                  title="Build tiles directly in the 3D viewport"
                >
                  Build
                </button>
                <button
                  type="button"
                  className={`tool${workspace.shellMode === 'texture' && tileEditorJob(session, workspace) === 'paint' ? ' is-active' : ''}`}
                  onClick={() => {
                    if (prepareTilePaint(session, workspace)) refresh();
                  }}
                  title="Paint tiles onto existing faces"
                >
                  Paint
                </button>
              </div>
              <span className="bar-sep" aria-hidden />
              <div className="shell-switch selection-switch" role="group" aria-label="Model quick tools">
                <button
                  type="button"
                  className={`tool${modelQuickToolsOpen ? ' is-active' : ''}`}
                  onClick={() => {
                    setModelQuickToolsOpen((open) => !open);
                    refresh();
                  }}
                  aria-pressed={modelQuickToolsOpen}
                  title="Open Flip, Mirror & Symmetry floating panel for 3D models (Shift+M)"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}
                >
                  <BlenderIcon name="mod_mirror" size={13} />
                  <span>Flip &amp; Mirror</span>
                </button>
              </div>
            </>
          )}
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
                className={`tool${activeTool === terrainTool && terrainTool.mode !== 'paint' ? ' is-active' : ''}`}
                onClick={() => {
                  activateTerrainWorkspaceTool(session, 'sculpt');
                  setTerrainFocusTab('sculpt');
                  refresh();
                }}
                aria-pressed={activeTool === terrainTool && terrainTool.mode !== 'paint'}
                title="Sculpt height (1)"
              >
                Sculpt
              </button>
              <button
                type="button"
                className={`tool${activeTool === terrainTool && terrainTool.mode === 'paint' ? ' is-active' : ''}`}
                onClick={() => {
                  activateTerrainWorkspaceTool(session, 'paint');
                  setTerrainFocusTab('surface');
                  refresh();
                }}
                aria-pressed={activeTool === terrainTool && terrainTool.mode === 'paint'}
                title="Paint material layers"
              >
                Paint
              </button>
              <button
                type="button"
                className="tool"
                onClick={() => {
                  if (openTerrainTilesetWorkspace(session, workspace)) refresh();
                }}
                title="Open UV/Paint tileset tools"
              >
                Tiles
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
                className={`tool${activeTool === terrainStructureTool ? ' is-active' : ''}`}
                onClick={() => {
                  activateTerrainWorkspaceTool(session, 'structure');
                  setTerrainFocusTab('objects');
                  refresh();
                }}
                aria-pressed={activeTool === terrainStructureTool}
                title="Buildings, roads, bridges (4)"
              >
                Build
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
          {workspace.shellMode === 'sculpt' && (
            <div className="shell-switch selection-switch" role="group" aria-label="Sculpt panels">
              <button
                type="button"
                className={`tool${sculptBrushesOpen ? ' is-active' : ''}`}
                onClick={() => setSculptBrushesOpen((open) => !open)}
                aria-pressed={sculptBrushesOpen}
                title="Brush shelf"
              >
                Brushes
              </button>
              <button
                type="button"
                className={`tool${sculptSettingsOpen ? ' is-active' : ''}`}
                onClick={() => setSculptSettingsOpen((open) => !open)}
                aria-pressed={sculptSettingsOpen}
                title="Size, strength, and falloff"
              >
                Settings
              </button>
              <button
                type="button"
                className={`tool${sculptMeshOpen ? ' is-active' : ''}`}
                onClick={() => setSculptMeshOpen((open) => !open)}
                aria-pressed={sculptMeshOpen}
                title="Mesh, symmetry, and mask"
              >
                Mesh
              </button>
              <button
                type="button"
                className={`tool${outlinerOpen ? ' is-active' : ''}`}
                onClick={() => {
                  setOutlinerTab('scene');
                  setOutlinerOpen((open) => !open);
                }}
                aria-pressed={outlinerOpen}
                title="Scene outliner"
              >
                Outliner
              </button>
              <button
                type="button"
                className="tool"
                onClick={() => {
                  resetSculptPanelLayout();
                  setSculptBrushesOpen(true);
                  setSculptSettingsOpen(true);
                  setSculptMeshOpen(true);
                  setSculptLayoutKey((key) => key + 1);
                }}
                title="Reset floating panel layout"
              >
                Reset
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

      <main className={`workspace${workspace.shellMode === 'animate' ? ' is-animate' : ''}${workspace.shellMode === 'rig' ? ' is-rig' : ''}${workspace.shellMode === 'blockout' ? ' is-blockout' : ''}${workspace.shellMode === 'terrain' ? ' is-terrain' : ''}${workspace.shellMode === 'sculpt' ? ' is-sculpt' : ''}`}>
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
            {workspace.shellMode === 'terrain' && (
              <TerrainPanel
                session={session}
                workspace={workspace}
                onRefresh={refresh}
                onOpenSceneObjects={() => setTerrainObjectsOpen(true)}
                onOpenOutliner={() => {
                  setOutlinerTab('models');
                  setOutlinerOpen(true);
                }}
                sceneObjectsOpen={terrainObjectsOpen}
                outlinerOpen={outlinerOpen}
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

      {workspace.shellMode === 'sculpt' && (
        <SculptPanel
          session={session}
          onRefresh={refresh}
          brushesOpen={sculptBrushesOpen}
          settingsOpen={sculptSettingsOpen}
          meshOpen={sculptMeshOpen}
          layoutKey={sculptLayoutKey}
          onToggleBrushes={() => setSculptBrushesOpen((open) => !open)}
          onToggleSettings={() => setSculptSettingsOpen((open) => !open)}
          onToggleMesh={() => setSculptMeshOpen((open) => !open)}
        />
      )}
      {(workspace.shellMode === 'model' || workspace.shellMode === 'blockout' || workspace.shellMode === 'terrain' || workspace.shellMode === 'sculpt') && outlinerOpen && (
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
          onOpenOutliner={() => {
            setOutlinerTab('models');
            setOutlinerOpen(true);
          }}
          onRefresh={refresh}
        />
      )}
      {modelQuickToolsOpen && (
        <FloatingModelToolsPanel
          hasSelection={
            session.selection.state.mode === 'object'
              ? session.selection.state.selectedObjectIds.size > 0 || !!session.selection.state.activeObjectId
              : session.selection.state.selectedFaceIds.size > 0 || session.selection.state.selectedVertexIds.size > 0 || session.selection.state.selectedEdgeIds.size > 0
          }
          selectedObjectCount={session.selection.state.selectedObjectIds.size || (session.selection.state.activeObjectId ? 1 : 0)}
          selectedFaceCount={session.selection.state.selectedFaceIds.size}
          isEditMode={session.selection.state.mode !== 'object'}
          onFlipHorizontal={handleModelFlipHorizontal}
          onFlipVertical={handleModelFlipVertical}
          onFlipDepth={handleModelFlipDepth}
          onFlipNormals={handleModelFlipNormals}
          onDuplicateAndMirror={handleModelDuplicateAndMirror}
          onAddMirrorModifier={handleModelAddMirrorModifier}
          onRotateDegrees={handleModelRotateDegrees}
          onCenterAxis={handleModelCenterAxis}
          onSnapToGround={handleModelSnapToGround}
          onClose={() => setModelQuickToolsOpen(false)}
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
                  : activeTool === terrainStructureTool
                    ? terrainStructureTool.statusLine()
                  : activeTool === terrainTool
                    ? terrainTool.statusLine()
                    : 'Select · G/R/S transform props · 1 sculpt · 2 objects · 3 water · 4 build'
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
                    ? 'LMB sculpt · Shift smooth · Ctrl invert · D/C/G brushes · [ ] / wheel size · drag panels · close/reopen from header'
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
                    ? session.tools.getActive()?.id === 'tile-draw'
                      ? workspace.texture.atlasDrawShape === 'rectangle'
                        ? 'Rectangle · Drag corners · Shift constrain · Alt + Click: Pick tile · Esc cancel'
                        : workspace.texture.atlasDrawShape === 'line'
                          ? 'Line · Drag start to end · Alt + Click: Pick tile · Q rotate · Esc cancel'
                          : workspace.texture.atlasUseFacePlane
                            ? 'Surface · Hover face to set plane · L lock plane · Alt + Click: Pick tile'
                            : `Draw · LMB place · Drag ${workspace.texture.atlasDrawShape} · Alt + Click: Pick tile · Q rotate · Esc cancel`
                      : workspace.texture.atlasPaintMode
                        ? 'Paint · click faces to stamp · Alt + Click: Pick tile'
                        : workspace.texture.uvPanelTab === 'tiles'
                          ? 'Tileset · select a tile · Build to draw in 3D · Paint to stamp faces'
                          : '3D · LightWave Alt orbit · UV · Alt pan · Ctrl+Alt zoom · N inspector · Tab hides pane'
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

      {propertiesOpen && (
        <AppPropertiesDialog
          themeId={themeId}
          onThemeId={setThemeId}
          promptRecoveryOnStartup={promptRecoveryOnStartup}
          onTogglePromptRecovery={handleTogglePromptRecovery}
          displayTextures={displayTextures}
          onToggleDisplayTextures={setDisplayTexturesEnabled}
          drawOnSurfaces={workspace.getDrawOnSurfaces()}
          onToggleDrawOnSurfaces={setDrawOnSurfacesEnabled}
          onOpenRecovery={() => {
            setPropertiesOpen(false);
            setRecoveryModalOpen(true);
          }}
          onClose={() => setPropertiesOpen(false)}
        />
      )}
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
          onClose={() => {
            rememberRecoveryDismissed();
            setRecoveryModalOpen(false);
          }}
          onCreateCheckpoint={() => void createRecoveryPoint()}
        />
      )}
      <HotkeyHelpOverlay open={hotkeysOpen} onClose={() => setHotkeysOpen(false)} />
      <AppDialogHost />
      <ToastStack toasts={toasts} />
    </div>
  );
}
