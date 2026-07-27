import { useEffect, useMemo, useRef, useState } from 'react';
import { viewportEngine } from '@/app/viewportEngine';
import { AppInspectorPanel } from '@/app/AppInspectorPanel';
import { TerrainPanel } from '@/app/TerrainPanel';
import { SculptPanel } from '@/app/SculptPanel';
import { FloatingTerrainObjects } from '@/app/FloatingTerrainObjects';
import { Viewport } from '@/app/Viewport';
import { FloatingOutliner } from '@/app/FloatingOutliner';
import {
  EXPORT_PROFILES,
  exportDiagnostics,
  type ExportProfile,
} from '@/app/GameExportProfiles';
import { EditorSession } from '@/core/editor/EditorSession';
import { beginInteractiveExtrude } from '@/app/ExtrudeHotkey';
import { beginInteractiveInset } from '@/app/InsetHotkey';
import { beginInteractiveKnife } from '@/app/KnifeHotkey';
import { beginInteractiveBevel } from '@/app/BevelHotkey';
import { beginInteractiveLoopCut } from '@/app/LoopCutHotkey';
import { PRIMITIVE_LABELS } from '@/core/primitives/PrimitiveFactory';
import { CreateDoodleTool } from '@/core/tools/CreateDoodleTool';
import { CreatePrimitiveTool } from '@/core/tools/CreatePrimitiveTool';
import { DrawPolyTool } from '@/core/tools/DrawPolyTool';
import { TerrainSculptTool } from '@/core/tools/TerrainSculptTool';
import { MeshSculptTool } from '@/core/tools/MeshSculptTool';
import { TerrainObjectTool } from '@/core/tools/TerrainObjectTool';
import { activeTerrain } from '@/core/terrain/Terrain';
import { sculptableObjects } from '@/core/sculpt/MeshSculptTarget';
import type { GizmoMode, TransformOrientation, TransformPivotMode } from '@/core/transform/types';
import { WorkspaceController } from '@/workspace/WorkspaceController';
import { VIEW_LABELS } from '@/workspace/types';
import { deserializeViperProject, serializeProject } from '@/core/persistence/ProjectSerializer';
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
import { isTypingTarget } from '@/workspace/InputRouter';
import { AutosaveRecoveryDialog } from '@/app/AutosaveRecoveryDialog';
import { HotkeyHelpOverlay } from '@/app/HotkeyHelpOverlay';
import { ToastStack, pushToast, useToasts } from '@/app/Toast';
import {
  clearAutomaticAutosaves,
  clearAutosave,
  readAutosaves,
  writeAutosave,
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
import './App.css';

export default function App() {
  const session = useMemo(() => new EditorSession(), []);
  const workspace = useMemo(() => new WorkspaceController(), []);
  const [, setTick] = useState(0);
  const [outlinerOpen, setOutlinerOpen] = useState(true);
  const [outlinerTab, setOutlinerTab] = useState<'scene' | 'models' | 'levels'>('scene');
  const [terrainObjectsOpen, setTerrainObjectsOpen] = useState(true);
  const [autosaveOffers, setAutosaveOffers] = useState<AutosavePayload[]>([]);
  const [hotkeysOpen, setHotkeysOpen] = useState(false);
  const [exportProfileId, setExportProfileId] = useState<ExportProfile['id']>('godot');
  const projectFileToken = useRef<FileToken | null>(null);
  const toasts = useToasts();
  const refresh = () => setTick((t) => t + 1);

  useEffect(() => session.onRedraw(refresh), [session]);
  useEffect(() => workspace.subscribe(refresh), [workspace]);

  useEffect(() => {
    let active = true;
    void readAutosaves().then((existing) => {
      if (active) setAutosaveOffers(existing);
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (!projectIsDirty(session.project)) return;
      void writeAutosave(serializeProject(session.document), session.project.name || 'Autosave');
    }, 5000);
    return () => window.clearInterval(timer);
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
    const onKeyDown = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target)) return;
      if (workspace.input.owner === 'transform' || workspace.input.owner === 'text') return;

      if (event.key === '?' || (event.key === '/' && event.shiftKey)) {
        event.preventDefault();
        setHotkeysOpen((open) => !open);
        return;
      }
      if (event.key === 'Escape' && hotkeysOpen) {
        event.preventDefault();
        setHotkeysOpen(false);
        return;
      }

      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;

      const key = event.key.toLowerCase();
      if (key === 'n') {
        event.preventDefault();
        newProject();
        return;
      }
      if (key === 'o') {
        event.preventDefault();
        void openProjectDialog();
        return;
      }
      if (key === 's') {
        event.preventDefault();
        void saveProject(event.shiftKey);
        return;
      }
      if (key === 'z' && !event.shiftKey) {
        event.preventDefault();
        if (session.undo()) {
          refresh();
          pushToast('Undo', 'info');
        }
        return;
      }
      if (key === 'y' || (key === 'z' && event.shiftKey)) {
        event.preventDefault();
        if (session.redo()) {
          refresh();
          pushToast('Redo', 'info');
        }
        return;
      }
      if (key === 'c') {
        event.preventDefault();
        if (commitCopySelection(session)) {
          refresh();
          pushToast('Copied selection', 'success');
        } else {
          pushToast('Nothing to copy', 'error');
        }
        return;
      }
      if (key === 'v') {
        event.preventDefault();
        if (commitPasteClipboard(session)) {
          refresh();
          pushToast('Pasted', 'success');
        } else {
          pushToast('Clipboard is empty', 'error');
        }
        return;
      }
      if (key === 'g') {
        event.preventDefault();
        if (event.shiftKey) {
          if (commitUngroupSelection(session)) {
            refresh();
            pushToast('Ungrouped', 'success');
          } else {
            pushToast('Select a group to ungroup', 'error');
          }
        } else if (commitGroupSelection(session)) {
          refresh();
          pushToast('Grouped', 'success');
        } else {
          pushToast('Select objects to group', 'error');
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  const confirmReplaceDirtyProject = () =>
    !projectIsDirty(session.project) ||
    window.confirm('Discard unsaved changes and replace the current project?');

  const newProject = () => {
    if (!confirmReplaceDirtyProject()) return;
    session.loadProject(createEmptyProject());
    projectFileToken.current = null;
    void clearAutomaticAutosaves();
    pushToast('New project — Main Level is active', 'success');
    refresh();
  };

  const openDocumentById = (documentId: string) => {
    session.openDocument(documentId);
    refresh();
  };

  const saveProject = async (saveAs = false) => {
    try {
      const target = await chooseNativeSaveTarget({
        suggestedName: `${session.document.name || 'Untitled'}.viper`,
        types: [VIPER_PROJECT_FILE],
        existing: saveAs ? null : projectFileToken.current,
      });
      if (!target) return;
      await writeNativeFile(
        target,
        serializeProject(session.document),
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
      const { project, activeDocumentId } = deserializeViperProject(await selected.file.text());
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

  const importModelDialog = async () => {
    try {
      const selected = await openNativeFile({ types: MODEL_IMPORT_FILES });
      if (!selected) return;
      const file = selected.file;
      if (file.name.toLowerCase().endsWith('.obj')) {
        const text = await file.text();
        const mesh = importObj(text, file.name.replace(/\.obj$/i, ''));
        const { objectId } = commitMeshObject(session.document, mesh, { name: mesh.name });
        session.selection.setMode('object');
        session.selection.selectObjects([objectId], 'replace');
        session.requestRedraw();
      } else if (/\.gl(?:tf|b)$/i.test(file.name)) {
        const { importGltf } = await import('@/core/io/GltfAdapter');
        const meshes = await importGltf(await file.arrayBuffer());
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
    const timestamp = new Date().toLocaleString();
    const name = `${session.document.name || 'Project'} · ${timestamp}`;
    const saved = await writeNamedAutosave(name, serializeProject(session.document));
    pushToast(saved ? 'Named recovery point created' : 'Could not create recovery point', saved ? 'success' : 'error');
  };

  const exportGlb = async () => {
    const profile = EXPORT_PROFILES[exportProfileId];
    const diagnostics = exportDiagnostics(session.document, profile);
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
  const activeTool = session.tools.getActive();
  const isCreating = activeTool === primitiveTool;
  const isDoodling = activeTool === doodleTool;
  const isDrawing = activeTool === drawTool;
  const isSculptingTerrain = activeTool === terrainTool;
  const isSculptingMesh = activeTool === meshSculptTool;
  const isPaintingObjects = activeTool === terrainObjectTool;
  const dimensions = primitiveTool.getDimensions();
  const activeObject = session.selection.state.activeObjectId
    ? session.document.objects.get(session.selection.state.activeObjectId)
    : null;
  const activeMesh = activeObject?.meshId
    ? session.document.meshes.get(activeObject.meshId)
    : null;

  const editFaces = (kind: 'extrude' | 'inset' | 'knife' | 'bevel') => {
    const getAxes = (id: Parameters<typeof viewportEngine.getCameraAxes>[0]) =>
      viewportEngine.getCameraAxes(id);
    const getPointer = (id: Parameters<typeof viewportEngine.getLastPointerSample>[0]) =>
      viewportEngine.getLastPointerSample(id);
    if (kind === 'knife') {
      if (!beginInteractiveKnife(session, workspace)) {
        pushToast('Knife tool unavailable', 'error');
      }
      refresh();
      return;
    }
    if (kind === 'bevel') {
      if (!beginInteractiveBevel(session, workspace, getAxes, getPointer)) {
        pushToast('Select edges to bevel', 'error');
      }
      refresh();
      return;
    }
    if (kind === 'extrude') {
      if (!beginInteractiveExtrude(session, workspace, getAxes, getPointer)) {
        pushToast('Select faces or edges to extrude', 'error');
      }
      refresh();
      return;
    }
    if (!beginInteractiveInset(session, workspace, getAxes, getPointer)) {
      // beginInteractiveInset already toasts on empty selection / failure
    }
    refresh();
  };

  const restoreAutosave = (autosave: AutosavePayload) => {
    try {
      const loaded = deserializeViperProject(autosave.project);
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

  const chooseMode = (mode: 'object' | 'vertex' | 'edge' | 'face') => {
    session.tools.setActive('select', session.context());
    session.selection.setMode(mode);
    session.requestRedraw();
    refresh();
  };

  const toggleXRay = () => {
    session.selection.setXRay(!session.selection.state.xRay);
    session.requestRedraw();
    refresh();
  };

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

  const setShell = (mode: 'model' | 'sculpt' | 'terrain' | 'texture') => {
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
      let terrain = activeTerrain(session);
      if (!terrain) {
        const firstTerrain = [...session.document.objects.values()].find(
          (object) => object.metadata.terrain === 'true',
        );
        if (firstTerrain) {
          session.selection.selectObjects([firstTerrain.id], 'replace');
          terrain = activeTerrain(session);
        }
      }
      session.tools.setActive('terrain-sculpt', session.context());
      if (terrain) session.requestRedraw();
    } else if (mode === 'sculpt') {
      session.selection.setMode('object');
      const targets = sculptableObjects(session.document);
      if (targets.length && !targets.some((object) => object.id === session.selection.state.activeObjectId)) {
        session.selection.selectObjects([targets[0]!.id], 'replace');
      }
      session.tools.setActive('mesh-sculpt', session.context());
      session.requestRedraw();
    } else {
      session.tools.setActive('select', session.context());
    }
    workspace.setShellMode(mode);
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
            beginInteractiveLoopCut(session, workspace);
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
      ],
    },
    {
      label: 'Edit',
      entries: [
        {
          kind: 'command',
          label: 'Undo',
          shortcut: 'Ctrl+Z',
          disabled: !session.history.canUndo(),
          action: () => {
            session.undo();
            refresh();
          },
        },
        {
          kind: 'command',
          label: 'Redo',
          shortcut: 'Ctrl+Y',
          disabled: !session.history.canRedo(),
          action: () => {
            session.redo();
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
          label: 'Hide Outliner',
          checked: !outlinerOpen,
          action: () => setOutlinerOpen(false),
        },
        {
          kind: 'command',
          label: 'Terrain Scene Objects',
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
          checked: sel.mode === 'vertex',
          action: () => chooseMode('vertex'),
        },
        {
          kind: 'command',
          label: 'Edge Selection',
          checked: sel.mode === 'edge',
          action: () => chooseMode('edge'),
        },
        {
          kind: 'command',
          label: 'Face Selection',
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
      ],
    },
    {
      label: 'Help',
      entries: [
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

  const leftMenus = menus.slice(0, 6);
  const rightMenus = menus.slice(5);

  return (
    <div className="app">
      <header className="bar bar-slim">
        <div className="bar-left">
          <span className="mark">Viper</span>
          <DesktopMenuBar menus={leftMenus} />
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
              className={`tool${workspace.shellMode === 'texture' ? ' is-active' : ''}`}
              onClick={() => setShell('texture')}
              aria-pressed={workspace.shellMode === 'texture'}
              title="UV and pixel workspace"
            >
              UV / Pixel
            </button>
          </div>
          <span className="bar-sep" aria-hidden />
          <div className="shell-switch selection-switch" role="group" aria-label="Selection mode">
            {(['object', 'vertex', 'edge', 'face'] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                className={`tool${sel.mode === mode ? ' is-active' : ''}`}
                onClick={() => chooseMode(mode)}
                aria-pressed={sel.mode === mode}
                title={`${mode[0]!.toUpperCase() + mode.slice(1)} selection`}
              >
                {mode === 'object'
                  ? 'Object'
                  : mode === 'vertex'
                    ? 'Vertex'
                    : mode === 'edge'
                      ? 'Edge'
                      : 'Face'}
              </button>
            ))}
          </div>
          <span className="bar-sep" aria-hidden />
          <div className="shell-switch gizmo-switch" role="group" aria-label="Transform gizmo">
            {([
              ['select', 'Select'],
              ['move', 'Move'],
              ['rotate', 'Rotate'],
              ['scale', 'Scale'],
            ] as const).map(([mode, label]) => (
              <button
                key={mode}
                type="button"
                className={`tool${gizmoMode === mode ? ' is-active' : ''}`}
                onClick={() => setGizmoMode(mode)}
                aria-pressed={gizmoMode === mode}
                title={
                  mode === 'select'
                    ? 'Select tool'
                    : mode === 'move'
                      ? 'Move gizmo (G)'
                      : mode === 'rotate'
                        ? 'Rotate gizmo (R)'
                        : 'Scale gizmo (S)'
                }
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <DocumentTabs
          session={session}
          onRefresh={refresh}
          onBrowseOutliner={(tab) => {
            setOutlinerTab(tab);
            setOutlinerOpen(true);
          }}
        />
        <div className="bar-right">
          <DesktopMenuBar menus={rightMenus} align="end" />
          <span className="meta dim">{viewHint}</span>
        </div>
      </header>

      <main className="workspace">
        <div className="workspace-main">
          <Viewport session={session} workspace={workspace} />
        </div>
        {workspace.shellMode === 'model' && (
          <AppInspectorPanel
            session={session}
            workspace={workspace}
            onRefresh={refresh}
            editFaces={editFaces}
            chooseMode={chooseMode}
            toggleXRay={toggleXRay}
            setGizmoMode={setGizmoMode}
            setOrientation={setOrientation}
            setPivot={setPivot}
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
          />
        )}
      </main>

      {workspace.shellMode === 'model' && outlinerOpen && (
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
        <span>
          {workspace.hoveredViewportId
            ? VIEW_LABELS[workspace.hoveredViewportId]
            : VIEW_LABELS[workspace.activeViewportId]}
        </span>
        {!isCreating && !isDoodling && !isDrawing && !isSculptingTerrain && !isSculptingMesh && !isPaintingObjects && !transformActive && (
          <span>
            {sel.mode}
            {sel.xRay ? ' · x-ray' : ' · visible'}
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
                : activeTool === terrainTool
                  ? terrainTool.statusLine()
                  : 'Select and edit level objects'
              : 'Create a terrain from the panel on the right'}
          </span>
        )}
        <span className="dim">
          {isCreating
            ? `${PRIMITIVE_LABELS[primitiveTool.state.kind]} · ${primitiveTool.state.stage} · W ${dimensions.width.toFixed(2)} H ${dimensions.height.toFixed(2)} D ${dimensions.depth.toFixed(2)} · ${primitiveTool.state.constructionPlaneId} plane · snap ${primitiveTool.state.snapLabel}`
            : isDrawing
              ? drawTool.buildMode === 'vertices'
                ? 'Click place · orange = new · Enter commit batch · Backspace undo · Esc clear'
                : 'Click place · orange = new · green = close · Enter finish · Shift axis · Esc clear'
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
                    ? 'LMB sculpt · Shift invert · wheel brush size · Alt sample flatten plane · RMB orbit · Ctrl+Z undo'
                  : workspace.shellMode === 'terrain'
                    ? activeTool === terrainObjectTool
                      ? terrainObjectTool.mode === 'place'
                        ? 'LMB place · RMB orbit · Select/edit to transform · Ctrl+Z undo'
                        : 'LMB drag brush · wheel brush size · RMB orbit · Ctrl+Z undo'
                      : activeTool === terrainTool
                        ? 'LMB sculpt · Shift invert · wheel brush size · RMB orbit · Ctrl+Z undo'
                        : 'Click an object to select · G/R/S transform · RMB orbit'
                  : workspace.shellMode === 'texture'
                    ? 'UV inspector on the right · Face/Point/Island · Move/Scale/Rotate · ? help'
                    : 'G/R/S · E extrude · F frame · ? help · Ctrl+Z undo · Ctrl+C/V copy/paste'}
        </span>
      </footer>

      {autosaveOffers.length > 0 && (
        <AutosaveRecoveryDialog
          autosaves={autosaveOffers}
          onRestore={restoreAutosave}
          onDiscard={discardAutosave}
          onDiscardAll={discardAllAutosaves}
        />
      )}
      <HotkeyHelpOverlay open={hotkeysOpen} onClose={() => setHotkeysOpen(false)} />
      <ToastStack toasts={toasts} />
    </div>
  );
}
