import type { EditorSession } from '@/core/editor/EditorSession';
import type { WorkspaceController } from '@/workspace/WorkspaceController';
import { beginBlenderOperator } from '@/app/blender/BlenderControlEngine';
import { pushToast } from '@/app/Toast';
import { BlenderIcon } from '@/components/BlenderIcon';
import { viewportEngine } from '@/app/viewportEngine';
import type { GizmoMode } from '@/core/transform/types';

type SelectionMode = 'object' | 'vertex' | 'edge' | 'face';

type Props = {
  session: EditorSession;
  workspace: WorkspaceController;
  gizmoMode: GizmoMode;
  setGizmoMode: (mode: GizmoMode) => void;
  onRefresh: () => void;
  layoutMode: 'maximized' | 'quad';
  onToggleLayout: () => void;
  selectionMode: SelectionMode;
  onChooseSelectionMode: (mode: SelectionMode) => void;
};

export function LeftToolbar({
  session,
  workspace,
  gizmoMode,
  setGizmoMode,
  onRefresh,
  layoutMode,
  onToggleLayout,
  selectionMode,
  onChooseSelectionMode,
}: Props) {
  const isEditMode = selectionMode !== 'object';
  const hasSelection = session.selection.state.activeObjectId !== null;

  const blenderCtx = {
    session,
    workspace,
    getCameraAxes: (viewId: Parameters<typeof viewportEngine.getCameraAxes>[0]) =>
      viewportEngine.getCameraAxes(viewId),
    getPointerSample: (viewId: Parameters<typeof viewportEngine.getLastPointerSample>[0]) =>
      viewportEngine.getLastPointerSample(viewId),
  };

  const handleExtrude = () => {
    if (!beginBlenderOperator('extrude', blenderCtx)) {
      pushToast('Select faces or edges to extrude (E)', 'info');
    }
    onRefresh();
  };

  const handleInset = () => {
    if (!beginBlenderOperator('inset', blenderCtx)) {
      pushToast('Select faces to inset (I)', 'info');
    }
    onRefresh();
  };

  const handleBevel = () => {
    if (!beginBlenderOperator('bevel', blenderCtx)) {
      pushToast('Select edges to bevel (Ctrl+B)', 'info');
    }
    onRefresh();
  };

  const handleLoopCut = () => {
    if (!beginBlenderOperator('loop-cut', blenderCtx)) {
      pushToast('Select a mesh to loop cut (Ctrl+R)', 'info');
    }
    onRefresh();
  };

  const handleKnife = () => {
    if (!beginBlenderOperator('knife', blenderCtx)) {
      pushToast('Select a mesh to cut (K)', 'info');
    }
    onRefresh();
  };

  return (
    <aside className="left-toolbar" aria-label="3D Modeling Tools">
      {/* 1. 3D Selection Modes: Object, Vertex, Edge, Face */}
      <div className="left-toolbar-group" role="group" aria-label="Selection Modes">
        <button
          type="button"
          className={`left-tool-btn${selectionMode === 'object' ? ' is-active' : ''}`}
          data-edit-mode="object"
          onClick={() => onChooseSelectionMode('object')}
          title="Object Mode (Tab / 1) — Select and transform entire objects"
          aria-label="Object Mode"
          aria-pressed={selectionMode === 'object'}
        >
          <BlenderIcon name="object_datamode" size={19} />
        </button>

        <button
          type="button"
          className={`left-tool-btn${selectionMode === 'vertex' ? ' is-active' : ''}`}
          data-edit-mode="vertex"
          onClick={() => onChooseSelectionMode('vertex')}
          title="Vertex Select (1) — Edit individual mesh vertices"
          aria-label="Vertex Select"
          aria-pressed={selectionMode === 'vertex'}
        >
          <BlenderIcon name="vertex_select" size={19} />
        </button>

        <button
          type="button"
          className={`left-tool-btn${selectionMode === 'edge' ? ' is-active' : ''}`}
          data-edit-mode="edge"
          onClick={() => onChooseSelectionMode('edge')}
          title="Edge Select (2) — Edit mesh edges and loops"
          aria-label="Edge Select"
          aria-pressed={selectionMode === 'edge'}
        >
          <BlenderIcon name="edge_select" size={19} />
        </button>

        <button
          type="button"
          className={`left-tool-btn${selectionMode === 'face' ? ' is-active' : ''}`}
          data-edit-mode="face"
          onClick={() => onChooseSelectionMode('face')}
          title="Face Select (3) — Edit polygons and surface faces"
          aria-label="Face Select"
          aria-pressed={selectionMode === 'face'}
        >
          <BlenderIcon name="face_select" size={19} />
        </button>
      </div>

      <div className="left-toolbar-divider" />

      {/* 2. Primary 3D Transforms: Select, Move, Rotate, Scale, Transform, Origin */}
      <div className="left-toolbar-group" role="group" aria-label="Transform Tools">
        <button
          type="button"
          className={`left-tool-btn${gizmoMode === 'select' ? ' is-active' : ''}`}
          onClick={() => setGizmoMode('select')}
          title="Select Box (Q) — Marquee box or click to select geometry"
          aria-label="Select tool"
          aria-pressed={gizmoMode === 'select'}
        >
          <BlenderIcon name="tool_select" size={19} />
        </button>

        <button
          type="button"
          className={`left-tool-btn${gizmoMode === 'move' ? ' is-active' : ''}`}
          onClick={() => setGizmoMode('move')}
          title="Move / Translate (G / W) — Translate along XYZ axes"
          aria-label="Move tool"
          aria-pressed={gizmoMode === 'move'}
        >
          <BlenderIcon name="tool_move" size={19} />
        </button>

        <button
          type="button"
          className={`left-tool-btn${gizmoMode === 'rotate' ? ' is-active' : ''}`}
          onClick={() => setGizmoMode('rotate')}
          title="Rotate (R / E) — Orbit / angular rotation along axes"
          aria-label="Rotate tool"
          aria-pressed={gizmoMode === 'rotate'}
        >
          <BlenderIcon name="tool_rotate" size={19} />
        </button>

        <button
          type="button"
          className={`left-tool-btn${gizmoMode === 'scale' ? ' is-active' : ''}`}
          onClick={() => setGizmoMode('scale')}
          title="Scale (S) — Resize geometry proportionally or along axes"
          aria-label="Scale tool"
          aria-pressed={gizmoMode === 'scale'}
        >
          <BlenderIcon name="tool_scale" size={19} />
        </button>

        <button
          type="button"
          className={`left-tool-btn${gizmoMode === 'combined' ? ' is-active' : ''}`}
          onClick={() => setGizmoMode('combined')}
          title="Transform Gizmo — All-in-one Translate, Rotate, and Scale handles"
          aria-label="Transform tool"
          aria-pressed={gizmoMode === 'combined'}
        >
          <BlenderIcon name="tool_transform" size={19} />
        </button>

        <button
          type="button"
          className={`left-tool-btn${gizmoMode === 'origin' ? ' is-active' : ''}`}
          onClick={() => setGizmoMode(gizmoMode === 'origin' ? 'combined' : 'origin')}
          title="Edit Origin / Pivot (P) — Move object origin without moving geometry"
          aria-label="Origin tool"
          aria-pressed={gizmoMode === 'origin'}
        >
          <BlenderIcon name="tool_origin" size={19} />
        </button>
      </div>

      {/* 3. Mesh Modeling Operations: Extrude, Inset, Bevel, Loop Cut, Knife */}
      {isEditMode && (
        <>
          <div className="left-toolbar-divider" />
          <div className="left-toolbar-group" role="group" aria-label="Mesh Operations">
            <button
              type="button"
              className="left-tool-btn"
              onClick={handleExtrude}
              title="Extrude Region (E) — Extrude selected faces/edges outward"
              aria-label="Extrude"
              disabled={!hasSelection}
            >
              <BlenderIcon name="tool_extrude" size={19} />
            </button>

            <button
              type="button"
              className="left-tool-btn"
              onClick={handleInset}
              title="Inset Faces (I) — Create inset polygon border"
              aria-label="Inset"
              disabled={!hasSelection}
            >
              <BlenderIcon name="tool_inset" size={19} />
            </button>

            <button
              type="button"
              className="left-tool-btn"
              onClick={handleBevel}
              title="Bevel (Ctrl+B) — Chamfer and round selected edges"
              aria-label="Bevel"
              disabled={!hasSelection}
            >
              <BlenderIcon name="mod_bevel" size={19} />
            </button>

            <button
              type="button"
              className="left-tool-btn"
              onClick={handleLoopCut}
              title="Loop Cut & Slide (Ctrl+R) — Insert edge loops around mesh"
              aria-label="Loop Cut"
              disabled={!hasSelection}
            >
              <BlenderIcon name="tool_loopcut" size={19} />
            </button>

            <button
              type="button"
              className="left-tool-btn"
              onClick={handleKnife}
              title="Knife Topology Tool (K) — Interactive polygon slicing"
              aria-label="Knife"
              disabled={!hasSelection}
            >
              <BlenderIcon name="tool_knife" size={19} />
            </button>
          </div>
        </>
      )}

      <div className="left-toolbar-spacer" />

      {/* 4. Viewport Layout Toggle */}
      <div className="left-toolbar-group" role="group" aria-label="Viewport display">
        <button
          type="button"
          className={`left-tool-btn${layoutMode === 'quad' ? ' is-active' : ''}`}
          onClick={onToggleLayout}
          title={layoutMode === 'quad' ? 'Single Maximize Viewport (Space)' : 'Quad 4-Viewport Layout (Space)'}
          aria-label="Toggle viewport layout"
        >
          <BlenderIcon name={layoutMode === 'quad' ? 'fullscreen_exit' : 'fullscreen_enter'} size={16} />
        </button>
      </div>
    </aside>
  );
}
