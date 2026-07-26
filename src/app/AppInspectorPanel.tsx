import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { MaterialEditor } from '@/app/MaterialEditor';
import { SimpleTextureDialog } from '@/app/SimpleTextureDialog';
import type { EditorSession } from '@/core/editor/EditorSession';
import { runMeshTransaction } from '@/core/history/Transaction';
import { pushToast } from '@/app/Toast';
import { beginInteractiveLoopCut } from '@/app/LoopCutHotkey';
import { fillHoles, makeFaceFromVertices } from '@/core/mesh/ops/draw';
import {
  bridgeEdgeLoops,
  dissolveEdges,
  dissolveFaces,
  flipFaces,
  mergeVertices,
  splitEdge,
  triangulateFaces,
  weldVerticesByDistance,
} from '@/core/mesh/ops/basic';
import { knifeFace } from '@/core/mesh/ops/cut';
import {
  resolveEditFaceIds,
  resolveShadingFaceIds,
  resolveSharpEdgeIds,
  setEdgeSharpness,
  setFacesShading,
} from '@/core/mesh/ops/shading';
import { pokeFaces, subdivideFaces } from '@/core/mesh/ops/subdivide';
import { validateMeshFull } from '@/core/mesh/Validation';
import { duplicateObject } from '@/core/document/ModelDocument';
import { cloneMeshPreserveIds, isBoundaryEdge } from '@/core/mesh/EditableMesh';
import { bevelEdges } from '@/core/mesh/ops/bevel';
import { solidifyMesh } from '@/core/mesh/ops/solidify';
import { applyObjectTransform } from '@/core/document/ObjectTransforms';
import {
  generateBoxCollider,
  generateConvexCollider,
  generateLightmapUv,
  generateMeshCollider,
  groupObjects,
  hasLightmapUv,
  createMirroredInstance,
  createRadialInstances,
  centreObjectOrigin,
  joinMeshObjects,
  separateFacesToObject,
  ungroupObject,
} from '@/core/editor/GameAssetTools';
import {
  expandSymmetryEdgeIds,
  expandSymmetryFaceIds,
  setModellingProfile,
} from '@/core/symmetry/Symmetry';
import { gameReadiness } from '@/app/GameExportProfiles';
import { PRIMITIVE_KINDS, PRIMITIVE_LABELS, type PrimitiveKind } from '@/core/primitives/PrimitiveFactory';
import { PrimitiveOperationPanel } from '@/app/inspector/PrimitiveOperationPanel';
import { CurveOperationPanel } from '@/app/inspector/CurveOperationPanel';
import { ExactCoordinateInput } from '@/app/inspector/ExactCoordinateInput';
import {
  PathSettingsControls,
  type PathSettingsValue,
} from '@/app/inspector/PathSettingsControls';
import {
  curveOperationLabel,
  evaluateCurveOperation,
  isPathStyle,
  readCurveOperation,
  serializeCurveOperation,
  type CurveOperation,
  type CurveStyle,
} from '@/core/curves/CurveOperation';
import {
  applySimpleTextureToObject,
  readSimpleTextureSettings,
  type SimpleTextureSettings,
} from '@/core/curves/SimpleTexture';
import { viewportEngine } from '@/app/viewportEngine';
import {
  CreateDoodleTool,
  type DoodlePolyPreset,
  type DoodleStyle,
} from '@/core/tools/CreateDoodleTool';
import { CreatePrimitiveTool } from '@/core/tools/CreatePrimitiveTool';
import { DrawPolyTool } from '@/core/tools/DrawPolyTool';
import type { GizmoMode, TransformOrientation, TransformPivotMode } from '@/core/transform/types';
import type {
  InspectorSection,
  InspectorTab,
  WorkspaceController,
} from '@/workspace/WorkspaceController';

type CreateMode = 'primitive' | 'doodle' | 'draw';
type SceneToolMode = 'construct' | 'modifiers' | 'output';

type Props = {
  session: EditorSession;
  workspace: WorkspaceController;
  onRefresh: () => void;
  editFaces: (kind: 'extrude' | 'inset' | 'knife' | 'bevel') => void;
  chooseMode: (mode: 'object' | 'vertex' | 'edge' | 'face') => void;
  toggleXRay: () => void;
  setGizmoMode: (mode: GizmoMode) => void;
  setOrientation: (orientation: TransformOrientation) => void;
  setPivot: (mode: TransformPivotMode) => void;
};

const TABS: { id: InspectorTab; label: string }[] = [
  { id: 'create', label: 'Build' },
  { id: 'edit', label: 'Model' },
  { id: 'material', label: 'Material' },
];

const EDIT_SECTIONS: { id: InspectorSection; label: string; short: string }[] = [
  { id: 'select', label: 'Select & Objects', short: 'Select' },
  { id: 'transform', label: 'Transform', short: 'Xform' },
  { id: 'geometry', label: 'Mesh Geometry', short: 'Mesh' },
  { id: 'symmetry', label: 'Symmetry', short: 'Sym' },
  { id: 'scene', label: 'Construct & Game', short: 'Game' },
];

/**
 * Model-shell right inspector — replaces the crowded top toolbar with
 * tabbed sections and dropdown menus.
 */
export function AppInspectorPanel({
  session,
  workspace,
  onRefresh,
  editFaces,
  chooseMode,
  toggleXRay,
  setGizmoMode,
  setOrientation,
  setPivot,
}: Props) {
  const tab = workspace.inspectorTab;
  const editSection = workspace.inspectorSection;
  const sel = session.selection.state;
  const primitiveTool = session.tools.get('create-primitive') as CreatePrimitiveTool;
  const doodleTool = session.tools.get('create-doodle') as CreateDoodleTool;
  const drawTool = session.tools.get('draw-poly') as DrawPolyTool;
  const activeTool = session.tools.getActive();
  const isCreatingPrimitive = activeTool === primitiveTool;
  const isDoodling = activeTool === doodleTool;
  const isDrawing = activeTool === drawTool;
  const [createModePref, setCreateModePref] = useState<CreateMode>('primitive');
  const [arrayCount, setArrayCount] = useState(4);
  const [arraySpacing, setArraySpacing] = useState(2);
  const [arrayAxis, setArrayAxis] = useState<'x' | 'y' | 'z'>('x');
  const [mirrorAxis, setMirrorAxis] = useState<'x' | 'y' | 'z'>('x');
  const [previewMirror, setPreviewMirror] = useState(false);
  const [previewArray, setPreviewArray] = useState(false);
  const [previewBevel, setPreviewBevel] = useState(false);
  const [previewSolidify, setPreviewSolidify] = useState(false);
  const [bevelWidth, setBevelWidth] = useState(0.05);
  const [bevelSegments, setBevelSegments] = useState(1);
  const [solidifyThickness, setSolidifyThickness] = useState(0.1);
  const [subdivideCuts, setSubdivideCuts] = useState(1);
  const [weldDistance, setWeldDistance] = useState(0.001);
  const [constructionOffset, setConstructionOffset] = useState(0);
  const [exactPoint, setExactPoint] = useState({ x: 0, y: 0, z: 0 });
  const [drawAdvancedOpen, setDrawAdvancedOpen] = useState(false);
  const [sceneToolMode, setSceneToolMode] = useState<SceneToolMode>('construct');
  const [simpleTextureOpen, setSimpleTextureOpen] = useState(false);
  const [draftCurvePoint, setDraftCurvePoint] = useState(0);
  const [simpleTextureSettings, setSimpleTextureSettings] =
    useState<SimpleTextureSettings>(() => doodleTool.simpleTextureSettings);
  const createMode: CreateMode = isDrawing
    ? 'draw'
    : isDoodling
      ? 'doodle'
      : isCreatingPrimitive
        ? 'primitive'
        : createModePref;
  const dimensions = primitiveTool.getDimensions();
  const chainLen = drawTool.state.chain.length;
  const canCloseChain = chainLen >= 3;
  const canCommitDraw =
    drawTool.buildMode === 'faces' ? canCloseChain : drawTool.state.createdInChain.length > 0;
  const gizmoMode = session.transform.prefs.gizmoMode;
  const faceEditReady = sel.mode === 'face' && sel.selectedFaceIds.size > 0;
  const objectCount = session.document.objects.size;
  const activeObject = sel.activeObjectId
    ? session.document.objects.get(sel.activeObjectId)
    : null;
  const drawTarget = drawTool.state.meshObjectId
    ? session.document.objects.get(drawTool.state.meshObjectId)
    : activeObject;
  const activeMesh = activeObject?.meshId
    ? session.document.meshes.get(activeObject.meshId)
    : null;
  const makeFaceReady = !!activeMesh && sel.mode === 'vertex' && sel.selectedVertexIds.size >= 3;
  const fillReady =
    !!activeMesh &&
    sel.mode === 'edge' &&
    sel.selectedEdgeIds.size >= 1 &&
    [...sel.selectedEdgeIds].some((id) => isBoundaryEdge(activeMesh, id));
  const dissolveReady =
    !!activeMesh &&
    ((sel.mode === 'edge' && sel.selectedEdgeIds.size > 0) ||
      (sel.mode === 'face' && sel.selectedFaceIds.size > 1));
  const splitReady = !!activeMesh && sel.mode === 'edge' && sel.selectedEdgeIds.size > 0;
  const mergeReady = !!activeMesh && sel.mode === 'vertex' && sel.selectedVertexIds.size >= 2;
  const separateReady = !!activeMesh && faceEditReady && sel.selectedFaceIds.size < activeMesh.faces.size;
  const selectedEdgeKey = [...sel.selectedEdgeIds].sort().join('|');
  const solidifyReady = !!activeMesh && activeMesh.faces.size > 0;
  const gameStats = gameReadiness(session.document);
  const symmetry = session.document.settings.symmetry;
  const selectedSimpleTexture = activeObject?.metadata.simpleTexture;

  useEffect(() => {
    if (!selectedSimpleTexture) return;
    const settings = readSimpleTextureSettings(selectedSimpleTexture);
    setSimpleTextureSettings(settings);
    doodleTool.simpleTextureSettings = settings;
  }, [activeObject?.id, doodleTool, selectedSimpleTexture]);

  const rebuildSelectedCurve = (patch: Partial<CurveOperation>) => {
    if (!activeObject || !activeMesh) return;
    const operation = readCurveOperation(activeObject.metadata.curveOperation);
    if (!operation) return;
    const next = { ...operation, ...patch };
    const sourceObject = next.pathSourceObjectId
      ? session.document.objects.get(next.pathSourceObjectId)
      : null;
    const sourceMesh = sourceObject?.meshId
      ? session.document.meshes.get(sourceObject.meshId) ?? null
      : null;
    const rebuilt = evaluateCurveOperation(next, sourceMesh);
    rebuilt.id = activeMesh.id;
    session.document.meshes.set(activeMesh.id, rebuilt);
    activeObject.metadata.curveOperation = serializeCurveOperation(next);
    session.document.dirty = true;
  };

  const applySimpleTexture = (settings: SimpleTextureSettings) => {
    setSimpleTextureSettings(settings);
    doodleTool.setSimpleTextureSettings(settings, session.context());
    if (activeObject && readCurveOperation(activeObject.metadata.curveOperation)) {
      applySimpleTextureToObject(session.document, activeObject, settings);
      rebuildSelectedCurve({ tipStyle: settings.tipStyle });
    }
    session.requestRedraw();
    onRefresh();
  };

  const applyCurveStyle = (style: CurveStyle) => {
    doodleTool.setStyle(style, session.context());
    rebuildSelectedCurve({ style });
    session.requestRedraw();
    onRefresh();
  };

  const applyNewPathSettings = (patch: Partial<PathSettingsValue>) => {
    const sourceId =
      patch.pathSourceObjectId !== undefined
        ? patch.pathSourceObjectId
        : doodleTool.pathSourceObjectId;
    const sourceObject = sourceId ? session.document.objects.get(sourceId) : null;
    const sourceMesh = sourceObject?.meshId
      ? session.document.meshes.get(sourceObject.meshId) ?? null
      : null;
    doodleTool.setPathSettings({
      output: patch.pathOutput,
      startCap: patch.pathStartCap,
      endCap: patch.pathEndCap,
      radiusScale: patch.pathRadiusScale,
      radialSegments: patch.pathRadialSegments,
      startScale: patch.startScale,
      endScale: patch.endScale,
      offset: patch.pathOffset,
      twist: patch.twist,
      spacing: patch.pathSpacing,
      profile: patch.pathProfile,
      profileWidth: patch.profileWidth,
      profileHeight: patch.profileHeight,
      chainAlternating: patch.pathChainAlternating,
      cardCrossed: patch.pathCardCrossed,
      distributionMode: patch.pathDistributionMode,
      count: patch.pathCount,
      startPadding: patch.pathStartPadding,
      endPadding: patch.pathEndPadding,
      randomScale: patch.pathRandomScale,
      rotation: patch.pathRotation,
      randomRotation: patch.pathRandomRotation,
      alternateRotation: patch.pathAlternateRotation,
      mirrorAlternate: patch.pathMirrorAlternate,
      seed: patch.pathSeed,
      keepInstances: patch.pathKeepInstances,
      sourceObjectId: sourceId,
      sourceMesh,
    }, session.context());
    onRefresh();
  };

  useEffect(() => {
    viewportEngine.setModifierPreview(activeObject?.id ?? null, [
      ...(previewMirror ? [{ kind: 'mirror' as const, axis: mirrorAxis }] : []),
      ...(previewArray
        ? [{ kind: 'array' as const, axis: arrayAxis, count: arrayCount, spacing: arraySpacing }]
        : []),
    ]);
    return () => viewportEngine.setModifierPreview(null, []);
  }, [activeObject?.id, arrayAxis, arrayCount, arraySpacing, mirrorAxis, previewArray, previewMirror]);

  useEffect(() => {
    let preview = null;
    if (activeMesh && previewBevel && sel.mode === 'edge' && selectedEdgeKey) {
      const clone = cloneMeshPreserveIds(activeMesh);
      const ids = [...expandSymmetryEdgeIds(
        clone,
        selectedEdgeKey.split('|'),
        symmetry,
      )];
      if (bevelEdges(clone, ids, { width: bevelWidth, segments: bevelSegments }).ok) preview = clone;
    } else if (activeMesh && previewSolidify && activeMesh.faces.size > 0) {
      const clone = cloneMeshPreserveIds(activeMesh);
      if (solidifyMesh(clone, { thickness: solidifyThickness }).ok) preview = clone;
    }
    viewportEngine.setMeshModifierPreview(activeObject?.id ?? null, preview);
    return () => viewportEngine.setMeshModifierPreview(null, null);
  }, [
    activeMesh,
    activeObject?.id,
    bevelWidth,
    bevelSegments,
    previewBevel,
    previewSolidify,
    sel.mode,
    selectedEdgeKey,
    solidifyThickness,
    symmetry,
  ]);

  const updateSymmetry = (patch: Partial<typeof symmetry>) => {
    session.document.settings.symmetry = { ...symmetry, ...patch };
    session.document.dirty = true;
    session.requestRedraw();
    onRefresh();
  };

  const chooseModellingProfile = (profile: 'general' | 'character') => {
    setModellingProfile(session.document, profile);
    session.requestRedraw();
    onRefresh();
  };

  const cancelCreateTools = () => {
    primitiveTool.cancel(session.context());
    doodleTool.cancel(session.context());
    drawTool.cancel(session.context());
  };

  const setTab = (next: InspectorTab) => {
    if (next !== 'create') {
      cancelCreateTools();
      session.tools.setActive('select', session.context());
    }
    workspace.setInspectorTab(next);
    session.requestRedraw();
    onRefresh();
  };

  const runDrawOp = (name: string, mutate: (mesh: NonNullable<typeof activeMesh>) => void) => {
    if (!activeMesh) return;
    const tx = runMeshTransaction(
      session.history,
      activeMesh,
      name,
      (mesh) => {
        mutate(mesh);
      },
      { fullValidation: true, selection: session.selection },
    );
    if (!tx.ok) {
      pushToast(tx.error ?? `${name} failed`, 'error');
      return;
    }
    session.requestRedraw();
    onRefresh();
  };

  const makeFace = () => {
    if (!activeMesh || !makeFaceReady) return;
    const verts = [...sel.selectedVertexIds];
    const mode = drawTool.faceMode;
    runDrawOp(mode === 'double' ? 'Make Double Face' : 'Make Face', (mesh) => {
      const result = makeFaceFromVertices(mesh, verts, { mode });
      if (!result.ok) throw new Error(result.error?.message ?? 'Make face failed');
      session.selection.applyTopologyChange(result.change);
    });
  };

  const fillBoundary = () => {
    if (!activeMesh || !fillReady) return;
    const edges = [...sel.selectedEdgeIds];
    runDrawOp('Fill Boundary', (mesh) => {
      const result = fillHoles(mesh, edges);
      if (!result.ok) throw new Error(result.error?.message ?? 'Fill failed');
      session.selection.applyTopologyChange(result.change);
    });
  };

  const flipSelectedFaces = () => {
    if (!activeMesh || !faceEditReady) return;
    const ids = [...expandSymmetryFaceIds(activeMesh, sel.selectedFaceIds, symmetry)];
    runDrawOp('Flip Faces', (mesh) => {
      const result = flipFaces(mesh, ids);
      if (!result.ok) throw new Error(result.error?.message ?? 'Flip faces failed');
      session.selection.applyTopologyChange(result.change);
    });
  };

  const splitEdges = () => {
    if (!activeMesh || !splitReady) return;
    const edges = [...expandSymmetryEdgeIds(activeMesh, sel.selectedEdgeIds, symmetry)];
    runDrawOp('Split Edges', (mesh) => {
      for (const edgeId of edges) {
        if (!mesh.edges.has(edgeId)) continue;
        const result = splitEdge(mesh, edgeId, 0.5);
        if (!result.ok) throw new Error(result.error?.message ?? 'Split failed');
        session.selection.applyTopologyChange(result.change);
      }
    });
  };

  const mergeVerts = () => {
    if (!activeMesh || !mergeReady) return;
    const verts = [...sel.selectedVertexIds];
    runDrawOp('Merge Vertices', (mesh) => {
      const result = mergeVertices(mesh, verts);
      if (!result.ok) throw new Error(result.error?.message ?? 'Merge failed');
      session.selection.applyTopologyChange(result.change);
    });
  };

  const addLoopCut = () => {
    if (!beginInteractiveLoopCut(session, workspace)) {
      pushToast('Loop Cut tool unavailable', 'error');
    }
    onRefresh();
  };

  const knifeSelectedEdges = () => {
    if (!activeMesh || sel.mode !== 'edge' || sel.selectedEdgeIds.size !== 2) return;
    const [edgeA, edgeB] = [...sel.selectedEdgeIds];
    const facesFor = (edgeId: string) => {
      const edge = activeMesh.edges.get(edgeId);
      return [edge?.halfEdgeAId, edge?.halfEdgeBId]
        .filter((id): id is string => !!id)
        .map((id) => activeMesh.halfEdges.get(id)?.faceId)
        .filter((id): id is string => !!id);
    };
    const faceId = facesFor(edgeA!).find((id) => facesFor(edgeB!).includes(id));
    if (!faceId) return;
    runDrawOp('Knife Face', (mesh) => {
      const result = knifeFace(mesh, faceId, edgeA!, edgeB!, 0.5, 0.5);
      if (!result.ok) throw new Error(result.error?.message ?? 'Knife failed');
      session.selection.applyTopologyChange(result.change);
    });
  };

  const bridgeSelectedLoops = () => {
    if (!activeMesh || sel.mode !== 'edge') return;
    const edges = [...sel.selectedEdgeIds];
    runDrawOp('Bridge Edge Loops', (mesh) => {
      const result = bridgeEdgeLoops(mesh, edges);
      if (!result.ok) throw new Error(result.error?.message ?? 'Bridge loops failed');
      session.selection.applyTopologyChange(result.change);
    });
  };

  const dissolveSelection = () => {
    if (!activeMesh || !dissolveReady) return;
    if (sel.mode === 'edge') {
      const edges = [...expandSymmetryEdgeIds(activeMesh, sel.selectedEdgeIds, symmetry)];
      runDrawOp('Dissolve Edges', (mesh) => {
        const result = dissolveEdges(mesh, edges);
        if (!result.ok) throw new Error(result.error?.message ?? 'Dissolve failed');
        session.selection.applyTopologyChange(result.change);
      });
      return;
    }
    if (sel.mode === 'face') {
      const faces = [...expandSymmetryFaceIds(activeMesh, sel.selectedFaceIds, symmetry)];
      runDrawOp('Dissolve Faces', (mesh) => {
        const result = dissolveFaces(mesh, faces);
        if (!result.ok) throw new Error(result.error?.message ?? 'Dissolve failed');
        session.selection.applyTopologyChange(result.change);
      });
    }
  };

  const weldSelectedVertices = () => {
    if (!activeMesh || sel.mode !== 'vertex' || sel.selectedVertexIds.size < 2) return;
    const vertices = [...sel.selectedVertexIds];
    runDrawOp('Weld by Distance', (mesh) => {
      const result = weldVerticesByDistance(mesh, vertices, weldDistance);
      if (!result.ok) throw new Error(result.error?.message ?? 'Weld failed');
      session.selection.applyTopologyChange(result.change);
    });
  };

  const triangulateSelectedFaces = () => {
    if (!activeMesh || !faceEditReady) return;
    const ids = [...expandSymmetryFaceIds(activeMesh, sel.selectedFaceIds, symmetry)];
    runDrawOp('Triangulate Faces', (mesh) => {
      const result = triangulateFaces(mesh, ids);
      if (!result.ok) throw new Error(result.error?.message ?? 'Triangulate failed');
      session.selection.applyTopologyChange(result.change);
    });
  };

  const selectionForOps = () => ({
    mode: sel.mode,
    selectedFaceIds: sel.selectedFaceIds,
    selectedEdgeIds: sel.selectedEdgeIds,
    selectedVertexIds: sel.selectedVertexIds,
  });

  const subdivideSelectedFaces = () => {
    if (!activeMesh) return;
    const ids = [...expandSymmetryFaceIds(
      activeMesh,
      resolveEditFaceIds(activeMesh, selectionForOps()),
      symmetry,
    )];
    runDrawOp('Subdivide', (mesh) => {
      const result = subdivideFaces(mesh, ids, subdivideCuts);
      if (!result.ok) throw new Error(result.error?.message ?? 'Subdivide failed');
      session.selection.applyTopologyChange(result.change);
    });
  };

  const pokeSelectedFaces = () => {
    if (!activeMesh) return;
    const ids = [...expandSymmetryFaceIds(
      activeMesh,
      resolveEditFaceIds(activeMesh, selectionForOps()),
      symmetry,
    )];
    runDrawOp('Poke Faces', (mesh) => {
      const result = pokeFaces(mesh, ids);
      if (!result.ok) throw new Error(result.error?.message ?? 'Poke failed');
      session.selection.applyTopologyChange(result.change);
    });
  };

  const shadeSelection = (mode: 'smooth' | 'flat') => {
    if (!activeMesh) return;
    const ids = [...expandSymmetryFaceIds(
      activeMesh,
      resolveShadingFaceIds(activeMesh, selectionForOps()),
      symmetry,
    )];
    runDrawOp(mode === 'smooth' ? 'Shade Smooth' : 'Shade Flat', (mesh) => {
      const result = setFacesShading(mesh, ids, mode);
      if (!result.ok) throw new Error(result.error?.message ?? 'Shading failed');
    });
  };

  const sharpSelection = (sharpness: number) => {
    if (!activeMesh) return;
    const ids = [...expandSymmetryEdgeIds(
      activeMesh,
      resolveSharpEdgeIds(activeMesh, selectionForOps()),
      symmetry,
    )];
    runDrawOp(sharpness > 0 ? 'Mark Sharp' : 'Clear Sharp', (mesh) => {
      const result = setEdgeSharpness(mesh, ids, sharpness);
      if (!result.ok) throw new Error(result.error?.message ?? 'Sharpness failed');
    });
  };

  const separateSelectedFaces = () => {
    if (!activeObject || !separateReady) return;
    const id = separateFacesToObject(
      session.document,
      activeObject.id,
      [...expandSymmetryFaceIds(activeMesh!, sel.selectedFaceIds, symmetry)],
      `${activeObject.name}_Part`,
    );
    chooseMode('object');
    session.selection.selectObjects([id], 'replace');
    session.requestRedraw();
    onRefresh();
  };

  const topologyActions = (
    <div className="uv-btn-grid uv-btn-grid-2">
      <button type="button" className="tool" disabled={!makeFaceReady} onClick={makeFace}>
        {drawTool.faceMode === 'double' ? 'Make Double' : 'Make Face'}
      </button>
      <button type="button" className="tool" disabled={!fillReady} onClick={fillBoundary}>
        Fill
      </button>
      <button type="button" className="tool" disabled={!dissolveReady} onClick={dissolveSelection}>
        Dissolve
      </button>
      <button type="button" className="tool" disabled={!splitReady} onClick={splitEdges}>
        Split Edges
      </button>
      <button type="button" className="tool" disabled={!mergeReady} onClick={mergeVerts}>
        Merge Verts
      </button>
      <button
        type="button"
        className="tool"
        onClick={addLoopCut}
      >
        Loop Cut
      </button>
      <button
        type="button"
        className="tool"
        disabled={!activeMesh || sel.mode !== 'edge' || sel.selectedEdgeIds.size === 0}
        onClick={() => editFaces('bevel')}
      >
        Bevel
      </button>
      <button
        type="button"
        className="tool"
        onClick={() => editFaces('knife')}
      >
        Knife Tool
      </button>
      <button
        type="button"
        className="tool"
        disabled={!activeMesh || sel.mode !== 'edge' || sel.selectedEdgeIds.size !== 2}
        onClick={knifeSelectedEdges}
      >
        Knife Midpoints
      </button>
      <button type="button" className="tool" disabled={!faceEditReady} onClick={triangulateSelectedFaces}>
        Triangulate
      </button>
      <button type="button" className="tool" disabled={!activeMesh} onClick={subdivideSelectedFaces}>
        Subdivide
      </button>
      <button type="button" className="tool" disabled={!activeMesh} onClick={pokeSelectedFaces}>
        Poke Faces
      </button>
      <button type="button" className="tool" disabled={!separateReady} onClick={separateSelectedFaces}>
        Separate Faces
      </button>
      <button
        type="button"
        className="tool"
        disabled={!activeMesh || sel.mode !== 'edge' || sel.selectedEdgeIds.size < 6}
        onClick={bridgeSelectedLoops}
      >
        Bridge Loops
      </button>
      <button
        type="button"
        className="tool"
        disabled={!activeMesh || sel.mode !== 'vertex' || sel.selectedVertexIds.size < 2}
        onClick={weldSelectedVertices}
      >
        Weld Distance
      </button>
    </div>
  );

  return (
    <aside className="app-inspector" aria-label="Modelling inspector">
      <header className="app-inspector-header">
        <div className="uv-panel-title">
          <span className="uv-panel-kicker">Inspector</span>
          <strong>Model</strong>
        </div>
        <p className="uv-meta">
          {objectCount === 0 ? 'Empty scene' : `${objectCount} object${objectCount === 1 ? '' : 's'}`}
          {' · '}
          {sel.mode}
          {sel.xRay ? ' · x-ray' : ''}
        </p>
      </header>

      <nav className="app-inspector-tabs" aria-label="Inspector tabs">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`uv-tab${tab === t.id ? ' is-active' : ''}`}
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {tab === 'edit' && (
        <div className="inspector-workflow-nav">
          <label>
            <span>Tool family</span>
            <select
              aria-label="Model tool family"
              value={editSection}
              onChange={(event) =>
                workspace.setInspectorSection(event.target.value as InspectorSection)
              }
            >
              {EDIT_SECTIONS.map((item) => (
                <option key={item.id} value={item.id}>{item.label}</option>
              ))}
            </select>
          </label>
          <nav className="inspector-subtabs" aria-label="Model tool categories">
            {EDIT_SECTIONS.map((item) => (
              <button
                type="button"
                key={item.id}
                className={editSection === item.id ? 'is-active' : ''}
                aria-selected={editSection === item.id}
                title={item.label}
                onClick={() => workspace.setInspectorSection(item.id)}
              >
                {item.short}
              </button>
            ))}
          </nav>
        </div>
      )}

      <div className="uv-panel-body">
        {tab === 'create' && (
          <>
            <section className="uv-section">
              <h3 className="uv-section-title">Mode</h3>
              <div className="uv-btn-grid uv-btn-grid-3">
                <button
                  type="button"
                  className={`tool${createMode === 'primitive' ? ' is-active' : ''}`}
                  aria-pressed={createMode === 'primitive'}
                  onClick={() => {
                    cancelCreateTools();
                    setCreateModePref('primitive');
                    session.tools.setActive('create-primitive', session.context());
                    onRefresh();
                  }}
                >
                  Primitive
                </button>
                <button
                  type="button"
                  className={`tool${createMode === 'doodle' ? ' is-active' : ''}`}
                  aria-pressed={createMode === 'doodle'}
                  onClick={() => {
                    cancelCreateTools();
                    setCreateModePref('doodle');
                    session.tools.setActive('create-doodle', session.context());
                    onRefresh();
                  }}
                >
                  Curves
                </button>
                <button
                  type="button"
                  className={`tool${createMode === 'draw' ? ' is-active' : ''}`}
                  aria-pressed={createMode === 'draw'}
                  onClick={() => {
                    cancelCreateTools();
                    setCreateModePref('draw');
                    session.tools.setActive('draw-poly', session.context());
                    onRefresh();
                  }}
                >
                  Draw
                </button>
              </div>
            </section>

            {createMode === 'doodle' && (
              <>
                <section className="uv-section">
                  <h3 className="uv-section-title">Curve Input</h3>
                  <div className="uv-btn-grid uv-btn-grid-2">
                    <button
                      type="button"
                      className={`tool${doodleTool.inputMode === 'sketch' ? ' is-active' : ''}`}
                      aria-pressed={doodleTool.inputMode === 'sketch'}
                      onClick={() => {
                        doodleTool.setInputMode('sketch', session.context());
                        onRefresh();
                      }}
                    >
                      Sketch · Freehand
                    </button>
                    <button
                      type="button"
                      className={`tool${doodleTool.inputMode === 'pen' ? ' is-active' : ''}`}
                      aria-pressed={doodleTool.inputMode === 'pen'}
                      onClick={() => {
                        doodleTool.setInputMode('pen', session.context());
                        onRefresh();
                      }}
                    >
                      Vector Pen
                    </button>
                  </div>
                  <p className="uv-hint">
                    {doodleTool.inputMode === 'sketch'
                      ? 'Press and draw a fluid path · release to create'
                      : 'Click precise control points · Enter or Finish Curve to create'}
                  </p>
                </section>

                <section className="uv-section">
                  <h3 className="uv-section-title">Stroke Shapes</h3>
                  <div className="uv-btn-grid uv-btn-grid-4">
                    {(
                      [
                        ['sharp', 'Outline'],
                        ['tube', 'Path'],
                        ['soft', 'Blob'],
                        ['capsule', 'Capsule'],
                      ] as [DoodleStyle, string][]
                    ).map(([style, label]) => (
                      <button
                        key={style}
                        type="button"
                        className={`tool${doodleTool.style === style && doodleTool.solidMode === 'extrude' ? ' is-active' : ''}`}
                        aria-pressed={doodleTool.style === style && doodleTool.solidMode === 'extrude'}
                        onClick={() => {
                          doodleTool.setSolidMode('extrude', session.context());
                          doodleTool.setStyle(style, session.context());
                          onRefresh();
                        }}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  <h3 className="uv-section-title">Hair</h3>
                  <div className="uv-btn-grid uv-btn-grid-3">
                    {(
                      [
                        ['hair', 'Hair Paths'],
                        ['hair-strip', 'Hair Strips'],
                        ['rounded-hair', 'Rounded Hair'],
                      ] as [DoodleStyle, string][]
                    ).map(([style, label]) => (
                      <button
                        key={style}
                        type="button"
                        className={`tool${doodleTool.style === style && doodleTool.solidMode === 'extrude' ? ' is-active' : ''}`}
                        aria-pressed={doodleTool.style === style && doodleTool.solidMode === 'extrude'}
                        onClick={() => {
                          doodleTool.setSolidMode('extrude', session.context());
                          doodleTool.setStyle(style, session.context());
                          onRefresh();
                        }}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  <h3 className="uv-section-title">Sweeps</h3>
                  <div className="uv-btn-grid uv-btn-grid-2">
                    {(
                      [
                        ['ribbon', 'Ribbon'],
                        ['tapered-tube', 'Tapered Tube'],
                        ['rope', 'Rope'],
                        ['square-sweep', 'Profile Sweep'],
                      ] as [DoodleStyle, string][]
                    ).map(([style, label]) => (
                      <button
                        key={style}
                        type="button"
                        className={`tool${doodleTool.style === style && doodleTool.solidMode === 'extrude' ? ' is-active' : ''}`}
                        aria-pressed={doodleTool.style === style && doodleTool.solidMode === 'extrude'}
                        onClick={() => {
                          doodleTool.setSolidMode('extrude', session.context());
                          doodleTool.setStyle(style, session.context());
                          onRefresh();
                        }}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  {doodleTool.style === 'tube' && doodleTool.solidMode === 'extrude' && (
                    <PathSettingsControls
                      document={session.document}
                      value={{
                        pathOutput: doodleTool.pathOutput,
                        pathStartCap: doodleTool.pathStartCap,
                        pathEndCap: doodleTool.pathEndCap,
                        pathRadiusScale: doodleTool.pathRadiusScale,
                        pathRadialSegments: doodleTool.pathRadialSegments,
                        startScale: doodleTool.startScale,
                        endScale: doodleTool.endScale,
                        pathOffset: doodleTool.pathOffset,
                        twist: doodleTool.twist,
                        pathSpacing: doodleTool.pathSpacing,
                        pathProfile: doodleTool.pathProfile,
                        profileWidth: doodleTool.profileWidth,
                        profileHeight: doodleTool.profileHeight,
                        pathChainAlternating: doodleTool.pathChainAlternating,
                        pathCardCrossed: doodleTool.pathCardCrossed,
                        pathDistributionMode: doodleTool.pathDistributionMode,
                        pathCount: doodleTool.pathCount,
                        pathStartPadding: doodleTool.pathStartPadding,
                        pathEndPadding: doodleTool.pathEndPadding,
                        pathRandomScale: doodleTool.pathRandomScale,
                        pathRotation: doodleTool.pathRotation,
                        pathRandomRotation: doodleTool.pathRandomRotation,
                        pathAlternateRotation: doodleTool.pathAlternateRotation,
                        pathMirrorAlternate: doodleTool.pathMirrorAlternate,
                        pathSeed: doodleTool.pathSeed,
                        pathKeepInstances: doodleTool.pathKeepInstances,
                        pathSourceObjectId: doodleTool.pathSourceObjectId,
                      }}
                      onChange={applyNewPathSettings}
                    />
                  )}
                  {doodleTool.style === 'capsule' && doodleTool.solidMode === 'extrude' && (
                    <div className="path-settings-panel capsule-settings-panel">
                      <div className="simple-texture-card-heading">
                        <strong>CAPSULE SETTINGS</strong>
                        <span>True rounded ends</span>
                      </div>
                      <label className="uv-field">
                        <span>Round sides · {doodleTool.pathRadialSegments}</span>
                        <input
                          aria-label="Capsule round sides"
                          type="range"
                          min={12}
                          max={24}
                          step={1}
                          value={doodleTool.pathRadialSegments}
                          onChange={(event) => {
                            doodleTool.setPathSettings(
                              { radialSegments: Number(event.target.value) },
                              session.context(),
                            );
                            onRefresh();
                          }}
                        />
                      </label>
                      <p className="uv-hint">
                        Open strokes receive hemispherical ends. Connected strokes become one seamless rounded loop.
                      </p>
                    </div>
                  )}
                  <label className="uv-field">
                    <span>Curve type</span>
                    <select
                      className="uv-select"
                      aria-label="New curve type"
                      value={doodleTool.curveType}
                      onChange={(event) => {
                        doodleTool.setCurveType(
                          event.target.value as 'polyline' | 'catmull-rom' | 'bezier',
                          session.context(),
                        );
                        onRefresh();
                      }}
                    >
                      <option value="polyline">Linear / Polyline</option>
                      <option value="catmull-rom">Smooth Spline</option>
                      <option value="bezier">Cubic Bézier</option>
                    </select>
                  </label>
                  {doodleTool.solidMode === 'extrude' && isPathStyle(doodleTool.style) && (
                    <label className="curve-option-toggle">
                      <input
                        type="checkbox"
                        checked={doodleTool.autoConnect}
                        onChange={(event) => {
                          doodleTool.setAutoConnect(event.target.checked, session.context());
                          onRefresh();
                        }}
                      />
                      <span>
                        <strong>Auto Connect</strong>
                        Snap the finish exactly to the first point
                      </span>
                    </label>
                  )}
                  <label className="uv-field">
                    <span>Radius / width</span>
                    <input
                      className="uv-text"
                      type="number"
                      min={0.01}
                      max={2}
                      step={0.01}
                      value={Number(doodleTool.radius.toFixed(3))}
                      onChange={(e) => {
                        doodleTool.setRadius(Number(e.target.value), session.context());
                        onRefresh();
                      }}
                    />
                  </label>
                  <label className="uv-field">
                    <span>Resolution</span>
                    <select
                      className="uv-select"
                      aria-label="Curve resolution preset"
                      value={doodleTool.preset}
                      onChange={(e) => {
                        doodleTool.setPreset(e.target.value as DoodlePolyPreset, session.context());
                        onRefresh();
                      }}
                    >
                      <option value="low">Low-poly</option>
                      <option value="medium">Medium</option>
                    </select>
                  </label>
                  <section className="simple-texture-card">
                    <div className="simple-texture-card-heading">
                      <strong>APPEARANCE</strong>
                      <span>New strokes</span>
                    </div>
                    <button
                      type="button"
                      className="simple-texture-open"
                      onClick={() => setSimpleTextureOpen(true)}
                    >
                      Simple Texture · {
                        simpleTextureSettings.mode === 'color'
                          ? 'Use current color'
                          : simpleTextureSettings.mode === 'gradient'
                            ? 'Gradient'
                            : 'Image'
                      }
                    </button>
                    <div className="simple-texture-card-tips">
                      {(['pointed', 'square'] as const).map((tip) => (
                        <label key={tip}>
                          <input
                            type="radio"
                            name="curve-tip-style"
                            checked={simpleTextureSettings.tipStyle === tip}
                            onChange={() => applySimpleTexture({ ...simpleTextureSettings, tipStyle: tip })}
                          />
                          <span>{tip === 'pointed' ? 'Pointed tips' : 'Square tips'}</span>
                        </label>
                      ))}
                    </div>
                    <p>Draw in a viewport to create the stroke. Texture mapping and tip settings are saved on the new object.</p>
                  </section>
                  <h3 className="uv-section-title">3D Operation</h3>
                  <div className="uv-btn-grid uv-btn-grid-2">
                    <button
                      type="button"
                      className={`tool${doodleTool.solidMode === 'extrude' ? ' is-active' : ''}`}
                      aria-pressed={doodleTool.solidMode === 'extrude'}
                      onClick={() => {
                        doodleTool.setSolidMode('extrude', session.context());
                        onRefresh();
                      }}
                    >
                      Extrude / Sweep
                    </button>
                    <button
                      type="button"
                      className={`tool${doodleTool.solidMode === 'lathe' ? ' is-active' : ''}`}
                      aria-pressed={doodleTool.solidMode === 'lathe'}
                      onClick={() => {
                        doodleTool.setSolidMode('lathe', session.context());
                        onRefresh();
                      }}
                    >
                      Lathe
                    </button>
                  </div>
                  {doodleTool.solidMode === 'lathe' && (
                    <div className="curve-lathe-settings">
                      <label className="uv-field">
                        <span>Revolution axis</span>
                        <select
                          className="uv-select"
                          aria-label="New lathe axis"
                          value={doodleTool.latheAxis}
                          onChange={(event) => {
                            doodleTool.setLatheSettings(
                              { axis: event.target.value as 'x' | 'y' | 'z' },
                              session.context(),
                            );
                            onRefresh();
                          }}
                        >
                          <option value="x">X axis</option>
                          <option value="y">Y axis</option>
                          <option value="z">Z axis</option>
                        </select>
                      </label>
                      <label className="uv-field">
                        <span>Round sides · {doodleTool.latheSegments}</span>
                        <input
                          className="uv-range"
                          type="range"
                          min={8}
                          max={64}
                          step={1}
                          value={doodleTool.latheSegments}
                          onChange={(event) => {
                            doodleTool.setLatheSettings(
                              { segments: Number(event.target.value) },
                              session.context(),
                            );
                            onRefresh();
                          }}
                        />
                      </label>
                      <label className="uv-field">
                        <span>Profile detail · {doodleTool.latheProfileRings}</span>
                        <input
                          className="uv-range"
                          type="range"
                          min={4}
                          max={64}
                          step={1}
                          value={doodleTool.latheProfileRings}
                          onChange={(event) => {
                            doodleTool.setLatheSettings(
                              { profileRings: Number(event.target.value) },
                              session.context(),
                            );
                            onRefresh();
                          }}
                        />
                      </label>
                      <label className="uv-field">
                        <span>Profile smoothing · {Math.round(doodleTool.latheSmoothing * 100)}%</span>
                        <input
                          className="uv-range"
                          type="range"
                          min={0}
                          max={1}
                          step={0.05}
                          value={doodleTool.latheSmoothing}
                          onChange={(event) => {
                            doodleTool.setLatheSettings(
                              { smoothing: Number(event.target.value) },
                              session.context(),
                            );
                            onRefresh();
                          }}
                        />
                      </label>
                      <label className="uv-field">
                        <span>Revolution · {Math.round(doodleTool.latheAngle)}°</span>
                        <input
                          className="uv-range"
                          type="range"
                          min={15}
                          max={360}
                          step={5}
                          value={doodleTool.latheAngle}
                          onChange={(event) => {
                            doodleTool.setLatheSettings(
                              { angle: Number(event.target.value) },
                              session.context(),
                            );
                            onRefresh();
                          }}
                        />
                      </label>
                      <label className="uv-check">
                        <input
                          type="checkbox"
                          checked={doodleTool.latheCaps}
                          onChange={(event) => {
                            doodleTool.setLatheSettings(
                              { caps: event.target.checked },
                              session.context(),
                            );
                            onRefresh();
                          }}
                        />
                        Cap profile ends
                      </label>
                      <p className="uv-hint">
                        Draw one side of the profile from bottom to top. The nearest profile edge becomes the revolution axis.
                      </p>
                    </div>
                  )}
                  {doodleTool.inputMode === 'pen' && doodleTool.state.stage === 'drawing' ? (
                    <>
                      <div className="curve-draft-editor">
                        <div className="simple-texture-card-heading">
                          <strong>LIVE CURVE NODES</strong>
                          <span>Editable before finish</span>
                        </div>
                        <label className="uv-field">
                          <span>Active node</span>
                          <select
                            className="uv-select"
                            aria-label="Draft curve node"
                            value={Math.min(draftCurvePoint, doodleTool.state.points.length - 1)}
                            onChange={(event) => setDraftCurvePoint(Number(event.target.value))}
                          >
                            {doodleTool.state.points.map((_point, index) => (
                              <option key={index} value={index}>Node {index + 1}</option>
                            ))}
                          </select>
                        </label>
                        <div className="uv-btn-grid uv-btn-grid-3">
                          {(['x', 'y', 'z'] as const).map((axis) => {
                            const index = Math.min(
                              draftCurvePoint,
                              doodleTool.state.points.length - 1,
                            );
                            const point = doodleTool.state.points[index]!;
                            return (
                              <label className="uv-field" key={`${index}-${axis}`}>
                                <span>{axis.toUpperCase()}</span>
                                <ExactCoordinateInput
                                  ariaLabel={`Draft node ${axis.toUpperCase()}`}
                                  value={point[axis]}
                                  onValueChange={(value) => {
                                    doodleTool.setDraftPointCoordinate(
                                      index,
                                      axis,
                                      value,
                                      session.context(),
                                    );
                                    onRefresh();
                                  }}
                                />
                              </label>
                            );
                          })}
                        </div>
                        <p className="uv-hint">
                          Drag orange nodes and Bézier handles directly in any viewport. The curve and 3D result rebuild immediately.
                        </p>
                      </div>
                      <div className="uv-btn-grid uv-btn-grid-2">
                        <button
                          type="button"
                          className="tool"
                          onClick={() => {
                            doodleTool.popPoint(session.context());
                            setDraftCurvePoint((index) =>
                              Math.max(0, Math.min(index, doodleTool.state.points.length - 1)),
                            );
                            onRefresh();
                          }}
                        >
                          Undo Point
                        </button>
                        <button
                          type="button"
                          className="tool primary"
                          disabled={doodleTool.state.points.length < 2}
                          onClick={() => {
                            doodleTool.confirm(session.context());
                            onRefresh();
                          }}
                        >
                          Finish Curve
                        </button>
                      </div>
                    </>
                  ) : (
                    <button
                      type="button"
                      className={`tool uv-btn-block${isDoodling ? '' : ' primary'}`}
                      onClick={() => {
                        cancelCreateTools();
                        session.tools.setActive('create-doodle', session.context());
                        onRefresh();
                      }}
                    >
                      {doodleTool.inputMode === 'pen' ? 'Start Vector Pen' : 'Start Sketch'}
                    </button>
                  )}
                  <p className="uv-meta">
                    {doodleTool.state.stage === 'drawing'
                      ? `${doodleTool.state.points.length} control points${doodleTool.state.closed ? ' · closed' : ''}`
                      : `${doodleTool.style.replace('-', ' ')} · ready`}
                  </p>
                  <p className="uv-hint">
                    Every result stays procedural: switch output, taper, twist, resize, or convert to mesh later.
                  </p>
                </section>
                <CurveOperationPanel
                  session={session}
                  object={activeObject ?? null}
                  mesh={activeMesh ?? null}
                  onRefresh={onRefresh}
                />
              </>
            )}

            {createMode === 'draw' && (
              <section className="uv-section draw-workflow">
                <div className="draw-heading">
                  <div>
                    <h3 className="uv-section-title">Model from scratch</h3>
                    <p className="uv-meta">Draw connected geometry with smart snapping and exact control.</p>
                  </div>
                  {isDrawing && <span className="draw-live-badge">Drawing</span>}
                </div>

                {!isDrawing ? (
                  <div className="draw-start">
                    <button
                      type="button"
                      className="draw-choice primary"
                      onClick={() => {
                        cancelCreateTools();
                        setCreateModePref('draw');
                        session.tools.setActive('draw-poly', session.context());
                        drawTool.startNewMesh(session.context());
                        onRefresh();
                      }}
                    >
                      <strong>Start a new model</strong>
                      <span>Create a clean mesh and draw its first surface</span>
                    </button>
                    <button
                      type="button"
                      className="draw-choice"
                      disabled={!activeMesh}
                      onClick={() => {
                        cancelCreateTools();
                        setCreateModePref('draw');
                        session.tools.setActive('draw-poly', session.context());
                        drawTool.useSelectedObject(session.context());
                        onRefresh();
                      }}
                    >
                      <strong>Continue selected mesh</strong>
                      <span>{activeMesh ? `Add geometry to ${activeObject?.name}` : 'Select a mesh first'}</span>
                    </button>
                    <p className="uv-hint">
                      Tip: select vertices or an edge before continuing to grow directly from them.
                    </p>
                  </div>
                ) : (
                  <>
                    <div className="draw-steps" aria-label="Draw workflow progress">
                      <span className="is-done"><b>1</b> Target</span>
                      <span className={chainLen ? 'is-done' : 'is-active'}><b>2</b> Draw</span>
                      <span className={canCommitDraw ? 'is-active' : ''}><b>3</b> Finish</span>
                    </div>

                    <div className="draw-target-card">
                      <div>
                        <span className="draw-label">Editing</span>
                        <strong>{drawTarget?.name ?? 'New mesh'}</strong>
                      </div>
                      <div className="draw-target-actions">
                        <button
                          type="button"
                          className="tool"
                          disabled={chainLen > 0}
                          onClick={() => {
                            drawTool.startNewMesh(session.context());
                            onRefresh();
                          }}
                        >
                          New
                        </button>
                        <button
                          type="button"
                          className="tool"
                          disabled={chainLen > 0 || !activeMesh}
                          onClick={() => {
                            drawTool.useSelectedObject(session.context());
                            onRefresh();
                          }}
                        >
                          Selected
                        </button>
                      </div>
                    </div>

                    <div className="uv-field">
                      <span>What are you drawing?</span>
                      <div className="draw-mode-grid">
                        <button
                          type="button"
                          className={`draw-mode${drawTool.buildMode === 'faces' ? ' is-active' : ''}`}
                          aria-pressed={drawTool.buildMode === 'faces'}
                          onClick={() => {
                            drawTool.setBuildMode('faces', session.context());
                            onRefresh();
                          }}
                        >
                          <strong>Surface</strong>
                          <span>3+ points become a face</span>
                        </button>
                        <button
                          type="button"
                          className={`draw-mode${drawTool.buildMode === 'vertices' ? ' is-active' : ''}`}
                          aria-pressed={drawTool.buildMode === 'vertices'}
                          onClick={() => {
                            drawTool.setBuildMode('vertices', session.context());
                            onRefresh();
                          }}
                        >
                          <strong>Points</strong>
                          <span>Place loose vertices precisely</span>
                        </button>
                      </div>
                    </div>

                    {drawTool.buildMode === 'faces' && (
                      <div className="uv-field">
                        <span>Surface sides</span>
                        <div className="uv-btn-grid uv-btn-grid-2">
                          <button
                            type="button"
                            className={`tool${drawTool.faceMode === 'single' ? ' is-active' : ''}`}
                            aria-pressed={drawTool.faceMode === 'single'}
                            onClick={() => {
                              drawTool.setFaceMode('single', session.context());
                              onRefresh();
                            }}
                          >
                            One-sided
                          </button>
                          <button
                            type="button"
                            className={`tool${drawTool.faceMode === 'double' ? ' is-active' : ''}`}
                            aria-pressed={drawTool.faceMode === 'double'}
                            onClick={() => {
                              drawTool.setFaceMode('double', session.context());
                              onRefresh();
                            }}
                          >
                            Two-sided
                          </button>
                        </div>
                      </div>
                    )}

                    <div className="uv-field">
                      <span>Draw plane</span>
                      <div className="uv-btn-grid uv-btn-grid-3">
                        {(['top', 'front', 'right'] as const).map((plane) => (
                          <button
                            key={plane}
                            type="button"
                            className={`tool${session.constructionPlaneId.startsWith(plane) ? ' is-active' : ''}`}
                            onClick={() => {
                              session.setConstructionPlanePreset(plane);
                              setConstructionOffset(0);
                              onRefresh();
                            }}
                          >
                            {plane[0]!.toUpperCase() + plane.slice(1)}
                          </button>
                        ))}
                      </div>
                      <button
                        type="button"
                        className={`tool${session.constructionPlaneId.startsWith('face:') ? ' is-active' : ''}`}
                        disabled={!session.selection.state.activeFaceId}
                        onClick={() => {
                          if (session.setConstructionPlaneFromSelection()) {
                            setConstructionOffset(0);
                            onRefresh();
                          }
                        }}
                      >
                        Draw on selected face
                      </button>
                    </div>

                    <div className={`draw-status${drawTool.state.lastError ? ' is-error' : ''}`}>
                      <span className="draw-count">{chainLen}</span>
                      <div>
                        <strong>
                          {drawTool.state.lastError
                            ? 'Needs attention'
                            : drawTool.buildMode === 'faces'
                              ? chainLen < 3
                                ? `${3 - chainLen} more point${3 - chainLen === 1 ? '' : 's'} to make a surface`
                                : 'Surface is ready'
                              : chainLen
                                ? `${drawTool.state.createdInChain.length} new point${drawTool.state.createdInChain.length === 1 ? '' : 's'}`
                                : 'Click in a viewport to place the first point'}
                        </strong>
                        <span>{drawTool.statusLine()}</span>
                      </div>
                    </div>

                    <button
                      type="button"
                      className="tool primary uv-btn-block draw-finish"
                      disabled={!canCommitDraw}
                      onClick={() => {
                        drawTool.confirm(session.context());
                        onRefresh();
                      }}
                    >
                      {drawTool.buildMode === 'faces' ? 'Create surface' : 'Commit points'}
                      <kbd>Enter</kbd>
                    </button>
                    <div className="uv-btn-grid uv-btn-grid-3">
                      <button
                        type="button"
                        className="tool"
                        disabled={chainLen === 0}
                        onClick={() => {
                          drawTool.popLast(session.context());
                          onRefresh();
                        }}
                      >
                        Undo point
                      </button>
                      <button
                        type="button"
                        className="tool"
                        disabled={chainLen === 0}
                        onClick={() => {
                          drawTool.cancel(session.context());
                          onRefresh();
                        }}
                      >
                        Clear
                      </button>
                      <button
                        type="button"
                        className="tool"
                        disabled={
                          !(
                            (sel.mode === 'vertex' && sel.selectedVertexIds.size > 0) ||
                            (sel.mode === 'edge' && sel.selectedEdgeIds.size > 0)
                          )
                        }
                        onClick={() => {
                          drawTool.seedFromSelection(session.context());
                          onRefresh();
                        }}
                      >
                        Use selection
                      </button>
                    </div>

                    <details className="draw-details">
                      <summary>Precision &amp; snapping</summary>
                      <label className="uv-check">
                        <input
                          type="checkbox"
                          checked={session.document.settings.snapEnabled}
                          onChange={(event) => {
                            session.document.settings.snapEnabled = event.target.checked;
                            session.document.dirty = true;
                            session.requestRedraw();
                            onRefresh();
                          }}
                        />
                        Smart snapping
                      </label>
                      <label className="uv-field">
                        <span>Grid increment</span>
                        <input
                          className="uv-text"
                          type="number"
                          min={0.000001}
                          step={0.01}
                          value={session.document.settings.snapIncrement}
                          onChange={(event) => {
                            session.document.settings.snapIncrement = Math.max(0.000001, Number(event.target.value));
                            session.document.dirty = true;
                            session.requestRedraw();
                            onRefresh();
                          }}
                        />
                      </label>
                      <label className="uv-field">
                        <span>Plane offset</span>
                        <input
                          className="uv-text"
                          type="number"
                          step={session.document.settings.snapIncrement}
                          value={constructionOffset}
                          onChange={(event) => {
                            const value = Number(event.target.value);
                            setConstructionOffset(value);
                            session.offsetConstructionPlane(value);
                            onRefresh();
                          }}
                        />
                      </label>
                      <span className="draw-label">Place exact world coordinate</span>
                      <div className="draw-coordinates">
                        {(['x', 'y', 'z'] as const).map((axis) => (
                          <label key={axis}>
                            <span>{axis.toUpperCase()}</span>
                            <input
                              className="uv-text"
                              type="number"
                              step={session.document.settings.snapIncrement}
                              value={exactPoint[axis]}
                              onChange={(event) => setExactPoint({
                                ...exactPoint,
                                [axis]: Number(event.target.value),
                              })}
                            />
                          </label>
                        ))}
                      </div>
                      <button
                        type="button"
                        className="tool"
                        onClick={() => {
                          drawTool.placeExactPoint(exactPoint, session.context());
                          onRefresh();
                        }}
                      >
                        Place exact point
                      </button>
                    </details>

                    <p className="uv-hint">
                      Click to place · click an old vertex to reuse it · Shift locks an axis · Ctrl temporarily
                      toggles snapping · Backspace removes the last point.
                    </p>

                    <button
                      type="button"
                      className="tool primary uv-btn-block"
                      onClick={() => {
                        if (canCommitDraw) drawTool.confirm(session.context());
                        else if (chainLen) drawTool.cancel(session.context());
                        session.tools.setActive('select', session.context());
                        setTab('edit');
                        chooseMode(drawTool.buildMode === 'faces' ? 'face' : 'vertex');
                        onRefresh();
                      }}
                    >
                      Finish drawing and refine model
                    </button>

                    <details
                      className="draw-details"
                      open={drawAdvancedOpen}
                      onToggle={(event) => setDrawAdvancedOpen(event.currentTarget.open)}
                    >
                      <summary>Advanced topology tools</summary>
                      {topologyActions}
                      <p className="uv-hint">
                        Select mesh components to unlock the relevant operation. These tools remain
                        available in the Edit tab.
                      </p>
                    </details>
                  </>
                )}
              </section>
            )}

            {createMode === 'primitive' && (
            <section className="uv-section">
              <h3 className="uv-section-title">Primitive</h3>
              <label className="uv-field">
                <span>Type</span>
                <select
                  className="uv-select"
                  aria-label="Primitive"
                  value={primitiveTool.state.kind}
                  onChange={(e) => {
                    session.tools.setActive('create-primitive', session.context());
                    primitiveTool.selectPrimitive(e.target.value as PrimitiveKind, session.context());
                    onRefresh();
                  }}
                >
                  {PRIMITIVE_KINDS.map((kind) => (
                    <option key={kind} value={kind}>
                      {PRIMITIVE_LABELS[kind]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="uv-field">
                <span>Complexity</span>
                <select
                  className="uv-select"
                  aria-label="Complexity"
                  value={primitiveTool.parameters.preset}
                  onChange={(e) => {
                    primitiveTool.setPreset(
                      e.target.value as 'low' | 'medium' | 'custom',
                      session.context(),
                    );
                    onRefresh();
                  }}
                >
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="custom">Custom</option>
                </select>
              </label>
              {!isCreatingPrimitive ? (
                <button
                  type="button"
                  className="tool primary uv-btn-block"
                  onClick={() => {
                    session.tools.setActive('create-primitive', session.context());
                    onRefresh();
                  }}
                >
                  Start create
                </button>
              ) : (
                <button
                  type="button"
                  className="tool uv-btn-block"
                  onClick={() => {
                    primitiveTool.cancel(session.context());
                    session.tools.setActive('select', session.context());
                    onRefresh();
                  }}
                >
                  Cancel create
                </button>
              )}
            </section>
            )}

            {createMode === 'primitive' && isCreatingPrimitive && (
              <section className="uv-section">
                <h3 className="uv-section-title">
                  Draw · {primitiveTool.state.stage}
                </h3>
                {(['width', 'height', 'depth'] as const).map((key) => (
                  <label key={key} className="uv-field">
                    <span>{key[0]!.toUpperCase() + key.slice(1)}</span>
                    <input
                      className="uv-text"
                      aria-label={key}
                      type="number"
                      min={0}
                      step={session.document.settings.snapIncrement}
                      value={Number(dimensions[key].toFixed(4))}
                      onChange={(e) => {
                        primitiveTool.setDimensions(
                          { [key]: Math.max(0, Number(e.target.value)) },
                          session.context(),
                        );
                        onRefresh();
                      }}
                    />
                  </label>
                ))}
                {['cylinder', 'cone', 'sphere', 'capsule', 'column', 'tube'].includes(
                  primitiveTool.state.kind,
                ) && (
                  <label className="uv-field">
                    <span>Sides</span>
                    <input
                      className="uv-text"
                      type="number"
                      min={3}
                      max={32}
                      value={primitiveTool.parameters.radialSegments}
                      onChange={(e) => {
                        primitiveTool.setParameters(
                          { radialSegments: Number(e.target.value) },
                          session.context(),
                        );
                        onRefresh();
                      }}
                    />
                  </label>
                )}
                {primitiveTool.state.kind === 'stairs' && (
                  <label className="uv-field">
                    <span>Steps</span>
                    <input
                      className="uv-text"
                      type="number"
                      min={1}
                      max={64}
                      value={primitiveTool.parameters.stairCount}
                      onChange={(e) => {
                        primitiveTool.setParameters(
                          { stairCount: Number(e.target.value) },
                          session.context(),
                        );
                        onRefresh();
                      }}
                    />
                  </label>
                )}
                {primitiveTool.state.kind === 'arch' && (
                  <label className="uv-field">
                    <span>Curve</span>
                    <input
                      className="uv-text"
                      type="number"
                      min={3}
                      max={32}
                      value={primitiveTool.parameters.archSegments}
                      onChange={(e) => {
                        primitiveTool.setParameters(
                          { archSegments: Number(e.target.value) },
                          session.context(),
                        );
                        onRefresh();
                      }}
                    />
                  </label>
                )}
                {primitiveTool.state.kind === 'torus' && (
                  <>
                    <label className="uv-field">
                      <span>Major</span>
                      <input
                        className="uv-text"
                        type="number"
                        min={6}
                        max={32}
                        value={primitiveTool.parameters.torusMajorSegments}
                        onChange={(e) => {
                          primitiveTool.setParameters(
                            { torusMajorSegments: Number(e.target.value) },
                            session.context(),
                          );
                          onRefresh();
                        }}
                      />
                    </label>
                    <label className="uv-field">
                      <span>Tube</span>
                      <input
                        className="uv-text"
                        type="number"
                        min={3}
                        max={16}
                        value={primitiveTool.parameters.torusTubeSegments}
                        onChange={(e) => {
                          primitiveTool.setParameters(
                            { torusTubeSegments: Number(e.target.value) },
                            session.context(),
                          );
                          onRefresh();
                        }}
                      />
                    </label>
                  </>
                )}
                {primitiveTool.state.stage !== 'idle' && (
                  <button
                    type="button"
                    className="tool primary uv-btn-block"
                    onClick={() => {
                      primitiveTool.confirm(session.context());
                      onRefresh();
                    }}
                  >
                    Finish
                  </button>
                )}
                <p className="uv-hint">
                  Click-drag base · height · confirm · Shift proportional · Alt centre · Esc cancel
                </p>
              </section>
            )}
          </>
        )}

        {tab === 'edit' && (
          <>
            {editSection === 'select' && <section className="uv-section">
              <h3 className="uv-section-title">Mode</h3>
              <label className="uv-field">
                <span>Selection</span>
                <select
                  className="uv-select"
                  aria-label="Selection mode"
                  value={sel.mode}
                  onChange={(e) =>
                    chooseMode(e.target.value as 'object' | 'vertex' | 'edge' | 'face')
                  }
                >
                  <option value="object">Object</option>
                  <option value="vertex">Vertex</option>
                  <option value="edge">Edge</option>
                  <option value="face">Face</option>
                </select>
              </label>
              <div className="uv-btn-grid uv-btn-grid-2">
                {(['object', 'vertex', 'edge', 'face'] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    className={`tool${sel.mode === mode ? ' is-active' : ''}`}
                    onClick={() => chooseMode(mode)}
                    aria-pressed={sel.mode === mode}
                  >
                    {mode[0]!.toUpperCase() + mode.slice(1)}
                  </button>
                ))}
              </div>
              <button
                type="button"
                className={`tool uv-btn-block${sel.xRay ? ' is-active' : ''}`}
                onClick={toggleXRay}
                aria-pressed={sel.xRay}
              >
                X-Ray {sel.xRay ? 'on' : 'off'}
              </button>
              <div className="uv-btn-grid uv-btn-grid-2">
                <button
                  type="button"
                  className="tool"
                  disabled={sel.mode !== 'object' && !activeMesh}
                  onClick={() => {
                    if (sel.mode === 'object') {
                      session.selection.selectObjects([...session.document.objects.keys()], 'replace');
                    } else {
                      session.selection.selectAll(activeMesh!);
                    }
                    session.requestRedraw();
                    onRefresh();
                  }}
                >
                  Select All
                </button>
                <button
                  type="button"
                  className="tool"
                  disabled={sel.mode !== 'object' && !activeMesh}
                  onClick={() => {
                    if (sel.mode === 'object') {
                      session.selection.selectObjects(
                        [...session.document.objects.keys()].filter((id) => !sel.selectedObjectIds.has(id)),
                        'replace',
                      );
                    } else {
                      session.selection.invert(activeMesh!);
                    }
                    session.requestRedraw();
                    onRefresh();
                  }}
                >
                  Invert
                </button>
                <button
                  type="button"
                  className="tool"
                  disabled={!activeMesh || sel.mode === 'object'}
                  onClick={() => {
                    session.selection.grow(activeMesh!);
                    session.requestRedraw();
                    onRefresh();
                  }}
                >
                  Grow
                </button>
                <button
                  type="button"
                  className="tool"
                  disabled={!activeMesh || sel.mode === 'object'}
                  onClick={() => {
                    session.selection.selectConnected(activeMesh!);
                    session.requestRedraw();
                    onRefresh();
                  }}
                >
                  Connected
                </button>
              </div>
              <div className="uv-btn-grid uv-btn-grid-2">
                <button
                  type="button"
                  className="tool"
                  disabled={!activeObject || !!activeObject.meshId || activeObject.childIds.length === 0}
                  onClick={() => {
                    if (!activeObject) return;
                    const ids = ungroupObject(session.document, activeObject.id);
                    session.selection.selectObjects(ids, 'replace');
                    session.requestRedraw();
                    onRefresh();
                  }}
                >
                  Ungroup
                </button>
                <button
                  type="button"
                  className="tool"
                  disabled={!activeObject?.meshId}
                  onClick={() => {
                    if (!activeObject?.meshId) return;
                    const id = createMirroredInstance(session.document, activeObject.id, mirrorAxis);
                    session.selection.selectObjects([id], 'replace');
                    setPreviewMirror(false);
                    session.requestRedraw();
                    onRefresh();
                  }}
                >
                  Linked Mirror {mirrorAxis.toUpperCase()}
                </button>
              </div>
              <label className="uv-field">
                <span>Mirror axis</span>
                <select
                  className="uv-select"
                  value={mirrorAxis}
                  onChange={(event) => setMirrorAxis(event.target.value as 'x' | 'y' | 'z')}
                >
                  <option value="x">X axis</option>
                  <option value="y">Y axis</option>
                  <option value="z">Z axis</option>
                </select>
              </label>
              <div className="uv-btn-grid uv-btn-grid-2">
                <button
                  type="button"
                  className="tool"
                  disabled={[...sel.selectedObjectIds].filter((id) => session.document.objects.get(id)?.meshId).length < 2}
                  onClick={() => {
                    const id = joinMeshObjects(session.document, [...sel.selectedObjectIds], 'Joined Level Chunk');
                    session.selection.selectObjects([id], 'replace');
                    session.requestRedraw();
                    onRefresh();
                  }}
                >
                  Join Selection
                </button>
                <button
                  type="button"
                  className="tool"
                  disabled={!activeObject?.meshId}
                  onClick={() => {
                    if (!activeObject?.meshId) return;
                    centreObjectOrigin(session.document, activeObject.id);
                    session.requestRedraw();
                    onRefresh();
                  }}
                >
                  Centre Origin
                </button>
              </div>
              <p className="uv-hint">
                LMB pick · Shift add · Alt toggle · Ctrl+drag box (right=inside, left=crossing)
              </p>
            </section>}

            {editSection === 'geometry' && <PrimitiveOperationPanel
              session={session}
              object={activeObject ?? null}
              mesh={activeMesh ?? null}
              onRefresh={onRefresh}
            />}
            {editSection === 'geometry' && <CurveOperationPanel
              session={session}
              object={activeObject ?? null}
              mesh={activeMesh ?? null}
              onRefresh={onRefresh}
            />}

            {editSection === 'transform' && activeObject && sel.mode === 'object' && (
              <section className="uv-section">
                <h3 className="uv-section-title">
                  {session.transform.lastCompleted
                    ? `Last Transform · ${session.transform.lastCompleted.label}`
                    : 'Exact Transform'}
                </h3>
                {(['position', 'rotation', 'scale'] as const).map((group) => (
                  <div key={group} className="exact-transform-row">
                    <span>{group[0]!.toUpperCase()}</span>
                    {(['x', 'y', 'z'] as const).map((axis) => {
                      const raw = activeObject.transform[group][axis];
                      const shown = group === 'rotation' ? (raw * 180) / Math.PI : raw;
                      return (
                        <input
                          key={axis}
                          className="uv-text"
                          aria-label={`${group} ${axis}`}
                          type="number"
                          step={group === 'rotation' ? 1 : session.document.settings.snapIncrement}
                          value={Number(shown.toFixed(4))}
                          onChange={(event) => {
                            const value = Number(event.target.value);
                            activeObject.transform[group][axis] =
                              group === 'rotation' ? (value * Math.PI) / 180 : value;
                            session.document.dirty = true;
                            session.requestRedraw();
                            onRefresh();
                          }}
                        />
                      );
                    })}
                  </div>
                ))}
                <p className="uv-hint">
                  Parameters remain editable after every move · position and scale use project units · rotation uses degrees
                </p>
              </section>
            )}

            {editSection === 'transform' && <section className="uv-section">
              <h3 className="uv-section-title">Gizmo</h3>
              <label className="uv-field">
                <span>Tool</span>
                <select
                  className="uv-select"
                  aria-label="Gizmo mode"
                  value={gizmoMode}
                  onChange={(e) => setGizmoMode(e.target.value as GizmoMode)}
                >
                  <option value="select">Select</option>
                  <option value="move">Move (G)</option>
                  <option value="rotate">Rotate (R)</option>
                  <option value="scale">Scale (S)</option>
                  <option value="combined">Combined</option>
                </select>
              </label>
              <div className="uv-btn-grid uv-btn-grid-2">
                {([
                  ['select', 'Select'],
                  ['move', 'Move'],
                  ['rotate', 'Rotate'],
                  ['scale', 'Scale'],
                  ['combined', 'Combo'],
                ] as const).map(([mode, label]) => (
                  <button
                    key={mode}
                    type="button"
                    className={`tool${gizmoMode === mode ? ' is-active' : ''}`}
                    onClick={() => setGizmoMode(mode)}
                    aria-pressed={gizmoMode === mode}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <p className="uv-hint">
                Move: drag selection freely · Select: drag selection to tweak · Gizmo axes constrain
              </p>
            </section>}

            {editSection === 'transform' && <section className="uv-section">
              <h3 className="uv-section-title">Space</h3>
              <div className="uv-field">
                <span>Orientation</span>
                <div className="uv-btn-grid uv-btn-grid-2">
                  {([
                    ['local', 'Local'],
                    ['global', 'Global'],
                    ['normal', 'Normal'],
                    ['view', 'View'],
                  ] as const).map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      className={`tool${session.transform.prefs.orientation === value ? ' is-active' : ''}`}
                      onClick={() => setOrientation(value)}
                      aria-pressed={session.transform.prefs.orientation === value}
                      title={
                        value === 'local'
                          ? 'Object axes (default for rotate)'
                          : value === 'global'
                            ? 'World axes'
                            : value === 'normal'
                              ? 'Face normal in edit mode · object axes in object mode'
                              : 'Camera / view axes'
                      }
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="uv-field">
                <span>Pivot</span>
                <div className="uv-btn-grid uv-btn-grid-2">
                  {([
                    ['object-origin', 'Origin'],
                    ['median', 'Median'],
                    ['bounding-box', 'Bounds'],
                    ['active', 'Active'],
                  ] as const).map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      className={`tool${session.transform.prefs.pivotMode === value ? ' is-active' : ''}`}
                      onClick={() => setPivot(value)}
                      aria-pressed={session.transform.prefs.pivotMode === value}
                      title={
                        value === 'object-origin'
                          ? 'Object origin (default)'
                          : value === 'median'
                            ? 'Average of selection'
                            : value === 'bounding-box'
                              ? 'Bounding-box centre'
                              : 'Active element origin'
                      }
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <p className="uv-hint">
                Default: Local + Origin — rotate on the object&apos;s own axes ·{' '}
                <kbd>,</kbd> cycle pivot · <kbd>.</kbd> cycle orientation · Esc cancel
              </p>
            </section>}

            {editSection === 'symmetry' && <section className="uv-section">
              <h3 className="uv-section-title">Symmetry</h3>
              <div className="uv-field">
                <span>Profile</span>
                <div className="uv-btn-grid uv-btn-grid-2">
                  {(['general', 'character'] as const).map((profile) => (
                    <button
                      key={profile}
                      type="button"
                      className={`tool${session.document.settings.modellingProfile === profile ? ' is-active' : ''}`}
                      aria-pressed={session.document.settings.modellingProfile === profile}
                      onClick={() => chooseModellingProfile(profile)}
                      title={profile === 'character' ? 'Starts character modelling with X symmetry enabled' : 'Keep the current symmetry choices'}
                    >
                      {profile === 'character' ? 'Character' : 'General'}
                    </button>
                  ))}
                </div>
              </div>
              <div className="uv-field">
                <span>Mirror axes</span>
                <div className="uv-btn-grid">
                  {(['x', 'y', 'z'] as const).map((axis) => (
                    <button
                      key={axis}
                      type="button"
                      className={`tool${symmetry[axis] ? ' is-active' : ''}`}
                      aria-pressed={symmetry[axis]}
                      onClick={() => updateSymmetry({ [axis]: !symmetry[axis] })}
                      title={`Live ${axis.toUpperCase()} symmetry`}
                    >
                      {axis.toUpperCase()}
                    </button>
                  ))}
                </div>
              </div>
              <button
                type="button"
                className={`tool${symmetry.liveMirror ? ' is-active' : ''}`}
                aria-pressed={symmetry.liveMirror}
                onClick={() => updateSymmetry({ liveMirror: !symmetry.liveMirror })}
                title="Mirror vertex movement and sculpt-style deformation while you work"
              >
                Live mirrored edit / sculpt
              </button>
              <div className="uv-field">
                <span>Radial symmetry</span>
                <div className="uv-btn-grid uv-btn-grid-2">
                  <button
                    type="button"
                    className={`tool${symmetry.radialEnabled ? ' is-active' : ''}`}
                    aria-pressed={symmetry.radialEnabled}
                    onClick={() => updateSymmetry({ radialEnabled: !symmetry.radialEnabled })}
                  >
                    {symmetry.radialEnabled ? 'Enabled' : 'Disabled'}
                  </button>
                  <select
                    className="uv-select"
                    aria-label="Radial symmetry axis"
                    value={symmetry.radialAxis}
                    onChange={(event) => updateSymmetry({
                      radialAxis: event.target.value as 'x' | 'y' | 'z',
                    })}
                  >
                    <option value="x">Around X</option>
                    <option value="y">Around Y</option>
                    <option value="z">Around Z</option>
                  </select>
                </div>
              </div>
              <label className="uv-field">
                <span>Radial count</span>
                <input
                  type="number"
                  min={2}
                  max={32}
                  step={1}
                  value={symmetry.radialCount}
                  onChange={(event) => updateSymmetry({
                    radialCount: Math.max(2, Math.min(32, Math.round(Number(event.target.value) || 2))),
                  })}
                />
              </label>
              <div className="uv-field">
                <span>Linked duplication</span>
                <div className="uv-btn-grid">
                  {(['x', 'y', 'z'] as const).map((axis) => (
                    <button
                      key={axis}
                      type="button"
                      className="tool"
                      disabled={!activeObject?.meshId}
                      onClick={() => {
                        if (!activeObject?.meshId) return;
                        const id = createMirroredInstance(session.document, activeObject.id, axis);
                        session.selection.selectObjects([id], 'replace');
                        session.requestRedraw();
                        onRefresh();
                      }}
                    >
                      Mirror {axis.toUpperCase()}
                    </button>
                  ))}
                </div>
              </div>
              <button
                type="button"
                className="tool"
                disabled={!activeObject?.meshId}
                onClick={() => {
                  if (!activeObject?.meshId) return;
                  const ids = createRadialInstances(
                    session.document,
                    activeObject.id,
                    symmetry.radialAxis,
                    symmetry.radialCount,
                  );
                  session.selection.selectObjects([activeObject.id, ...ids], 'replace');
                  session.requestRedraw();
                  onRefresh();
                }}
              >
                Radial Duplicate × {symmetry.radialCount}
              </button>
              <p className="uv-hint">
                Character profile starts with X symmetry. Live symmetry follows component moves and
                sculpt-style vertex edits; duplication creates linked copies.
              </p>
            </section>}

            {editSection === 'geometry' && <section className="uv-section">
              <h3 className="uv-section-title">Faces</h3>
              <label className="uv-field">
                <span>Operation</span>
                <select
                  className="uv-select"
                  aria-label="Face operations"
                  defaultValue=""
                  disabled={!faceEditReady}
                  onChange={(e) => {
                    const v = e.target.value;
                    e.target.value = '';
                    if (v === 'extrude') editFaces('extrude');
                    if (v === 'inset') editFaces('inset');
                  }}
                >
                  <option value="" disabled>
                    {faceEditReady ? 'Choose action…' : 'Select faces first'}
                  </option>
                  <option value="extrude">Extrude</option>
                  <option value="inset">Inset</option>
                </select>
              </label>
              <div className="uv-btn-grid uv-btn-grid-2">
                <button
                  type="button"
                  className="tool"
                  disabled={!faceEditReady}
                  onClick={() => editFaces('extrude')}
                >
                  Extrude
                </button>
                <button
                  type="button"
                  className="tool"
                  disabled={!faceEditReady}
                  onClick={() => editFaces('inset')}
                >
                  Inset
                </button>
                <button
                  type="button"
                  className="tool"
                  disabled={!faceEditReady}
                  onClick={flipSelectedFaces}
                >
                  Flip faces
                </button>
                <button
                  type="button"
                  className={`tool${sel.selectBackfaces ? ' is-active' : ''}`}
                  aria-pressed={sel.selectBackfaces}
                  onClick={() => {
                    session.selection.setSelectBackfaces(!sel.selectBackfaces);
                    session.requestRedraw();
                    onRefresh();
                  }}
                >
                  Select back faces
                </button>
              </div>
              <p className="uv-hint">
                {faceEditReady
                  ? `${sel.selectedFaceIds.size} face${sel.selectedFaceIds.size === 1 ? '' : 's'} · E extrude · Flip reverses normals`
                  : `Face mode + pick faces${sel.selectBackfaces ? ' · back-face picking on' : ''}`}
              </p>
            </section>}

            {editSection === 'geometry' && <section className="uv-section">
              <h3 className="uv-section-title">Shading</h3>
              <div className="uv-btn-grid uv-btn-grid-2">
                <button type="button" className="tool" disabled={!activeMesh} onClick={() => shadeSelection('smooth')}>
                  Shade Smooth
                </button>
                <button type="button" className="tool" disabled={!activeMesh} onClick={() => shadeSelection('flat')}>
                  Shade Flat
                </button>
                <button type="button" className="tool" disabled={!activeMesh} onClick={() => sharpSelection(1)}>
                  Mark Sharp
                </button>
                <button type="button" className="tool" disabled={!activeMesh} onClick={() => sharpSelection(0)}>
                  Clear Sharp
                </button>
              </div>
              <p className="uv-hint">
                Smooth/Flat uses faces · Sharp uses edges · empty selection applies to the whole mesh · Shift+Alt+S / F
              </p>
            </section>}

            {editSection === 'geometry' && <section className="uv-section">
              <h3 className="uv-section-title">Topology</h3>
              {topologyActions}
              <label className="uv-field">
                <span>Subdivide cuts <b className="uv-field-value">{subdivideCuts}</b></span>
                <input
                  className="uv-range"
                  type="range"
                  min={1}
                  max={3}
                  step={1}
                  value={subdivideCuts}
                  onChange={(event) => setSubdivideCuts(Number(event.target.value))}
                />
              </label>
              <label className="uv-field">
                <span>Weld distance</span>
                <input
                  className="uv-text"
                  type="number"
                  min={0.000001}
                  step={0.001}
                  value={weldDistance}
                  onChange={(event) => setWeldDistance(Math.max(0.000001, Number(event.target.value)))}
                />
              </label>
              <p className="uv-hint">
                Subdivide · Poke · Make Face · Fill · Bridge · Loop Cut · Knife · Ctrl+Shift+D
              </p>
              {activeMesh && (() => {
                const report = validateMeshFull(activeMesh);
                const errors = report.issues.filter((issue) => issue.severity === 'error').length;
                const warnings = report.issues.filter((issue) => issue.severity === 'warning').length;
                return (
                  <p className={`uv-meta${errors ? ' is-error' : ''}`}>
                    {errors ? `${errors} topology error${errors === 1 ? '' : 's'}` : 'Mesh valid'}
                    {warnings ? ` · ${warnings} warning${warnings === 1 ? '' : 's'}` : ''}
                  </p>
                );
              })()}
            </section>}

            {editSection === 'scene' && <section className="uv-section">
              <h3 className="uv-section-title">Construct &amp; Game</h3>
              <div className="inspector-segmented" role="tablist" aria-label="Construct and game tools">
                {([
                  ['construct', 'Construct'],
                  ['modifiers', 'Modifiers'],
                  ['output', 'Game Output'],
                ] as const).map(([mode, label]) => (
                  <button
                    type="button"
                    role="tab"
                    key={mode}
                    className={sceneToolMode === mode ? 'is-active' : ''}
                    aria-selected={sceneToolMode === mode}
                    onClick={() => setSceneToolMode(mode)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {sceneToolMode === 'construct' && <>
              <div className="uv-btn-grid uv-btn-grid-2">
                {(['top', 'front', 'right'] as const).map((plane) => (
                  <button
                    key={plane}
                    type="button"
                    className={`tool${session.constructionPlaneId.startsWith(plane) ? ' is-active' : ''}`}
                    onClick={() => {
                      session.setConstructionPlanePreset(plane);
                      setConstructionOffset(0);
                      onRefresh();
                    }}
                  >
                    {plane[0]!.toUpperCase() + plane.slice(1)} plane
                  </button>
                ))}
                <button
                  type="button"
                  className={`tool${session.constructionPlaneId.startsWith('face:') ? ' is-active' : ''}`}
                  disabled={!session.selection.state.activeFaceId}
                  onClick={() => {
                    if (session.setConstructionPlaneFromSelection()) {
                      setConstructionOffset(0);
                      pushToast('Construction plane set from active face', 'success');
                      onRefresh();
                    }
                  }}
                >
                  Active face
                </button>
              </div>
              <label className="uv-field">
                <span>Plane offset</span>
                <input
                  className="uv-text"
                  type="number"
                  step={session.document.settings.snapIncrement}
                  value={constructionOffset}
                  onChange={(event) => {
                    const value = Number(event.target.value);
                    setConstructionOffset(value);
                    session.offsetConstructionPlane(value);
                    onRefresh();
                  }}
                />
              </label>
              <p className="uv-hint">Active plane: {session.constructionPlaneId.replace(/@.*$/, '')}</p>
              <label className="uv-field">
                <span>Units</span>
                <select
                  className="uv-select"
                  value={session.document.settings.units}
                  onChange={(event) => {
                    session.document.settings.units = event.target.value as 'meters' | 'centimeters' | 'unitless';
                    session.document.dirty = true;
                    session.requestRedraw();
                    onRefresh();
                  }}
                >
                  <option value="meters">Meters</option>
                  <option value="centimeters">Centimeters</option>
                  <option value="unitless">Unitless</option>
                </select>
              </label>
              <label className="uv-field">
                <span>Grid snap</span>
                <input
                  className="uv-text"
                  type="number"
                  min={0.001}
                  step={0.05}
                  value={session.document.settings.snapIncrement}
                  onChange={(event) => {
                    session.document.settings.snapIncrement = Math.max(0.001, Number(event.target.value));
                    session.document.dirty = true;
                    session.requestRedraw();
                    onRefresh();
                  }}
                />
              </label>
              <label className="uv-field">
                <span>Angle snap</span>
                <input
                  className="uv-text"
                  type="number"
                  min={0.1}
                  max={180}
                  step={1}
                  value={session.document.settings.angleSnapDegrees}
                  onChange={(event) => {
                    session.document.settings.angleSnapDegrees = Math.max(
                      0.1,
                      Math.min(180, Number(event.target.value)),
                    );
                    session.document.dirty = true;
                    session.requestRedraw();
                    onRefresh();
                  }}
                />
              </label>
              <label className="uv-check">
                <input
                  type="checkbox"
                  checked={session.document.settings.snapEnabled}
                  onChange={(event) => {
                    session.document.settings.snapEnabled = event.target.checked;
                    session.document.dirty = true;
                    session.requestRedraw();
                    onRefresh();
                  }}
                />
                Enable snapping · Ctrl temporarily toggles
              </label>
              </>}
              {sceneToolMode === 'modifiers' && <>
              <h3 className="uv-section-title">Live Modifiers</h3>
              <div className="uv-btn-grid uv-btn-grid-2">
                <label className="uv-check">
                  <input
                    type="checkbox"
                    checked={previewMirror}
                    disabled={!activeObject}
                    onChange={(event) => setPreviewMirror(event.target.checked)}
                  />
                  Mirror preview
                </label>
                <label className="uv-check">
                  <input
                    type="checkbox"
                    checked={previewArray}
                    disabled={!activeObject}
                    onChange={(event) => setPreviewArray(event.target.checked)}
                  />
                  Array preview
                </label>
              </div>
              <div className="uv-btn-grid uv-btn-grid-2">
                <label className="uv-field">
                  <span>Bevel width</span>
                  <input
                    className="uv-text"
                    type="number"
                    min={0.0001}
                    step={session.document.settings.snapIncrement * 0.1}
                    value={bevelWidth}
                    onChange={(event) => setBevelWidth(Math.max(0.0001, Number(event.target.value)))}
                  />
                </label>
                <label className="uv-field">
                  <span>Bevel segments</span>
                  <input
                    className="uv-text"
                    type="number"
                    min={1}
                    max={16}
                    step={1}
                    value={bevelSegments}
                    onChange={(event) => {
                      const next = Math.floor(Number(event.target.value) || 1);
                      setBevelSegments(Math.max(1, Math.min(16, next)));
                    }}
                  />
                </label>
                <label className="uv-check">
                  <input
                    type="checkbox"
                    checked={previewBevel}
                    disabled={!activeMesh || sel.mode !== 'edge' || sel.selectedEdgeIds.size === 0}
                    onChange={(event) => {
                      setPreviewBevel(event.target.checked);
                      if (event.target.checked) setPreviewSolidify(false);
                    }}
                  />
                  Bevel preview
                </label>
                <label className="uv-field">
                  <span>Solidify</span>
                  <input
                    className="uv-text"
                    type="number"
                    step={session.document.settings.snapIncrement * 0.1}
                    value={solidifyThickness}
                    onChange={(event) => setSolidifyThickness(Number(event.target.value))}
                  />
                </label>
                <label className="uv-check">
                  <input
                    type="checkbox"
                    checked={previewSolidify}
                    disabled={!solidifyReady}
                    onChange={(event) => {
                      setPreviewSolidify(event.target.checked);
                      if (event.target.checked) setPreviewBevel(false);
                    }}
                  />
                  Solidify preview
                </label>
              </div>
              <div className="uv-btn-grid uv-btn-grid-2">
                <button
                  type="button"
                  className="tool"
                  disabled={!activeMesh || sel.mode !== 'edge' || sel.selectedEdgeIds.size === 0}
                  onClick={() => {
                    if (!activeMesh) return;
                    const ids = [...expandSymmetryEdgeIds(
                      activeMesh,
                      sel.selectedEdgeIds,
                      symmetry,
                    )];
                    const tx = runMeshTransaction(session.history, activeMesh, 'Bevel', (mesh) => {
                      const result = bevelEdges(mesh, ids, { width: bevelWidth, segments: bevelSegments });
                      if (!result.ok) throw new Error(result.error?.message ?? 'Bevel failed');
                      session.selection.applyTopologyChange(result.change);
                    }, { fullValidation: true, selection: session.selection });
                    if (!tx.ok) pushToast(tx.error ?? 'Bevel failed', 'error');
                    setPreviewBevel(false);
                    session.requestRedraw();
                    onRefresh();
                  }}
                >
                  Apply Bevel
                </button>
                <button
                  type="button"
                  className="tool"
                  disabled={!solidifyReady || !activeMesh}
                  onClick={() => {
                    if (!activeMesh) return;
                    const tx = runMeshTransaction(session.history, activeMesh, 'Solidify', (mesh) => {
                      const result = solidifyMesh(mesh, { thickness: solidifyThickness });
                      if (!result.ok) throw new Error(result.error?.message ?? 'Solidify failed');
                      session.selection.applyTopologyChange(result.change);
                    }, { fullValidation: true, selection: session.selection });
                    if (!tx.ok) pushToast(tx.error ?? 'Solidify failed', 'error');
                    setPreviewSolidify(false);
                    session.requestRedraw();
                    onRefresh();
                  }}
                >
                  Apply Solidify
                </button>
              </div>
              <div className="uv-btn-grid uv-btn-grid-2">
                <label className="uv-field">
                  <span>Copies</span>
                  <input className="uv-text" type="number" min={2} max={100} value={arrayCount} onChange={(event) => setArrayCount(Math.max(2, Number(event.target.value)))} />
                </label>
                <label className="uv-field">
                  <span>Spacing {arrayAxis.toUpperCase()}</span>
                  <input className="uv-text" type="number" step={session.document.settings.snapIncrement} value={arraySpacing} onChange={(event) => setArraySpacing(Number(event.target.value))} />
                </label>
              </div>
              <label className="uv-field">
                <span>Array axis</span>
                <select
                  className="uv-select"
                  value={arrayAxis}
                  onChange={(event) => setArrayAxis(event.target.value as 'x' | 'y' | 'z')}
                >
                  <option value="x">X axis</option>
                  <option value="y">Y axis</option>
                  <option value="z">Z axis</option>
                </select>
              </label>
              <div className="uv-btn-grid uv-btn-grid-2">
                <button
                  type="button"
                  className="tool"
                  disabled={!activeObject}
                  onClick={() => {
                    if (!activeObject) return;
                    const ids = [activeObject.id];
                    for (let index = 1; index < arrayCount; index++) {
                      const id = duplicateObject(session.document, activeObject.id, false);
                      const copy = session.document.objects.get(id)!;
                      copy.name = `${activeObject.name}_${index + 1}`;
                      copy.transform.position[arrayAxis] += arraySpacing * index;
                      copy.metadata.prefabSource = activeObject.id;
                      ids.push(id);
                    }
                    session.selection.selectObjects(ids, 'replace');
                    setPreviewArray(false);
                    session.document.dirty = true;
                    session.requestRedraw();
                    onRefresh();
                  }}
                >
                  Create {arrayAxis.toUpperCase()} Array
                </button>
                <button
                  type="button"
                  className="tool"
                  disabled={!activeObject}
                  onClick={() => {
                    if (!activeObject) return;
                    activeObject.transform.position.y = 0;
                    session.document.dirty = true;
                    session.requestRedraw();
                    onRefresh();
                  }}
                >
                  Place on Ground
                </button>
              </div>
              </>}
              {sceneToolMode === 'output' && <>
              <h3 className="uv-section-title">Game Output</h3>
              <div className="uv-btn-grid uv-btn-grid-2">
                <button
                  type="button"
                  className="tool"
                  disabled={sel.selectedObjectIds.size === 0}
                  onClick={() => {
                    const groupId = groupObjects(
                      session.document,
                      [...sel.selectedObjectIds],
                      'Group',
                    );
                    session.selection.selectObjects([groupId], 'replace');
                    session.requestRedraw();
                    onRefresh();
                  }}
                >
                  Group
                </button>
                <button
                  type="button"
                  className="tool"
                  disabled={!activeObject}
                  onClick={() => {
                    if (!activeObject) return;
                    applyObjectTransform(session.document, activeObject.id);
                    session.requestRedraw();
                    onRefresh();
                  }}
                >
                  Apply Transform
                </button>
              </div>
              <div className="uv-btn-grid uv-btn-grid-2">
                <button
                  type="button"
                  className="tool"
                  disabled={!activeMesh}
                  onClick={() => {
                    if (!activeMesh) return;
                    generateLightmapUv(activeMesh);
                    session.document.dirty = true;
                    session.requestRedraw();
                    onRefresh();
                  }}
                >
                  {activeMesh && hasLightmapUv(activeMesh) ? 'Rebuild Lightmap UV' : 'Generate Lightmap UV'}
                </button>
                <button
                  type="button"
                  className="tool"
                  disabled={!activeObject?.meshId}
                  onClick={() => {
                    if (!activeObject?.meshId) return;
                    const id = generateBoxCollider(session.document, activeObject.id);
                    session.selection.selectObjects([id], 'replace');
                    session.requestRedraw();
                    onRefresh();
                  }}
                >
                  Box Collider
                </button>
              </div>
              <div className="uv-btn-grid uv-btn-grid-2">
                <button
                  type="button"
                  className="tool"
                  disabled={!activeObject?.meshId}
                  onClick={() => {
                    if (!activeObject?.meshId) return;
                    const id = generateConvexCollider(session.document, activeObject.id);
                    session.selection.selectObjects([id], 'replace');
                    session.requestRedraw();
                    onRefresh();
                  }}
                >
                  Convex Collider
                </button>
                <button
                  type="button"
                  className="tool"
                  disabled={!activeObject?.meshId}
                  onClick={() => {
                    if (!activeObject?.meshId) return;
                    const id = generateMeshCollider(session.document, activeObject.id);
                    session.selection.selectObjects([id], 'replace');
                    session.requestRedraw();
                    onRefresh();
                  }}
                >
                  Exact Collider
                </button>
              </div>
              {activeObject && (
                <>
                  <label className="uv-field">
                    <span>Game role</span>
                    <select
                      className="uv-select"
                      value={activeObject.metadata.gameRole ?? 'geometry'}
                      onChange={(event) => {
                        activeObject.metadata.gameRole = event.target.value;
                        session.document.dirty = true;
                        onRefresh();
                      }}
                    >
                      <option value="geometry">Geometry</option>
                      <option value="terrain">Terrain</option>
                      <option value="collision">Collision</option>
                      <option value="spawn">Spawn</option>
                      <option value="marker">Marker</option>
                    </select>
                  </label>
                  <label className="uv-field">
                    <span>Collision</span>
                    <select
                      className="uv-select"
                      value={activeObject.metadata.collision ?? 'none'}
                      onChange={(event) => {
                        activeObject.metadata.collision = event.target.value;
                        session.document.dirty = true;
                        onRefresh();
                      }}
                    >
                      <option value="none">None</option>
                      <option value="box">Box</option>
                      <option value="convex">Convex Hull</option>
                      <option value="mesh">Mesh</option>
                    </select>
                  </label>
                </>
              )}
              <p className="uv-meta">
                {gameStats.objects} objects · {gameStats.vertices} verts · {gameStats.triangles} tris
                {` · ${gameStats.drawCalls} draw calls`}
                {gameStats.collisionObjects ? ` · ${gameStats.collisionObjects} collision` : ''}
              </p>
              <p className={`uv-meta${gameStats.invalidMeshes ? ' is-error' : ''}`}>
                {gameStats.invalidMeshes
                  ? `${gameStats.invalidMeshes} invalid mesh${gameStats.invalidMeshes === 1 ? '' : 'es'}`
                  : 'Topology ready'}
                {gameStats.missingLightmapUvs
                  ? ` · ${gameStats.missingLightmapUvs} need lightmap UV`
                  : ' · lightmap UVs ready'}
              </p>
              {(gameStats.unappliedScales > 0 || gameStats.oversizedMeshes > 0) && (
                <p className="uv-meta is-error">
                  {gameStats.unappliedScales
                    ? `${gameStats.unappliedScales} unapplied scale${gameStats.unappliedScales === 1 ? '' : 's'}`
                    : ''}
                  {gameStats.unappliedScales && gameStats.oversizedMeshes ? ' · ' : ''}
                  {gameStats.oversizedMeshes
                    ? `${gameStats.oversizedMeshes} mesh${gameStats.oversizedMeshes === 1 ? '' : 'es'} above 100k tris`
                    : ''}
                </p>
              )}
              <p className="uv-hint">Prefab groups and arrays preserve hierarchy · GLB exports UV2, transforms, collision roles, and game metadata</p>
              </>}
            </section>}

            <section className="uv-section">
              <h3 className="uv-section-title">History</h3>
              <div className="uv-btn-grid uv-btn-grid-2">
                <button
                  type="button"
                  className="tool"
                  disabled={!session.history.canUndo()}
                  onClick={() => {
                    session.undo();
                    onRefresh();
                  }}
                >
                  Undo
                </button>
                <button
                  type="button"
                  className="tool"
                  disabled={!session.history.canRedo()}
                  onClick={() => {
                    session.redo();
                    onRefresh();
                  }}
                >
                  Redo
                </button>
              </div>
            </section>
          </>
        )}

        {tab === 'material' && <MaterialEditor session={session} compact />}
      </div>
      {simpleTextureOpen && createPortal(
        <SimpleTextureDialog
          session={session}
          settings={simpleTextureSettings}
          activeStyle={
            readCurveOperation(activeObject?.metadata.curveOperation)?.style ?? doodleTool.style
          }
          selectionLabel={(() => {
            const operation = readCurveOperation(activeObject?.metadata.curveOperation);
            return operation ? curveOperationLabel(operation) : undefined;
          })()}
          onChange={applySimpleTexture}
          onStyleChange={applyCurveStyle}
          onClose={() => setSimpleTextureOpen(false)}
        />,
        document.body,
      )}
    </aside>
  );
}
