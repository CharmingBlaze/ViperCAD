import { useState, useRef, useEffect } from 'react';
import type { EditorSession } from '@/core/editor/EditorSession';
import type { WorkspaceController } from '@/workspace/WorkspaceController';
import type { OutlinerTab } from '@/app/FloatingOutliner';
import type { GizmoMode, TransformOrientation, TransformPivotMode } from '@/core/transform/types';
import { FloatingOutliner } from '@/app/FloatingOutliner';
import { AppInspectorPanel, type RecoveryControlsState } from '@/app/AppInspectorPanel';
import { BlenderIcon } from '@/components/BlenderIcon';
import { UvInspectorHost } from '@/app/UvInspectorHost';
import { usePanelResizer } from '@/app/usePanelResizer';

type SidebarTab = 'split' | 'outliner' | 'inspector';

type Props = {
  session: EditorSession;
  workspace: WorkspaceController;
  onRefresh: () => void;
  editFaces: (kind: 'extrude' | 'inset' | 'knife' | 'bevel') => void;
  chooseMode: (mode: 'object' | 'vertex' | 'edge' | 'face') => void;
  toggleXRay: () => void;
  setGizmoMode: (mode: GizmoMode) => void;
  setOrientation: (o: TransformOrientation) => void;
  setPivot: (p: TransformPivotMode) => void;
  outlinerTab: OutlinerTab;
  setOutlinerTab: (tab: OutlinerTab) => void;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  recoveryState?: RecoveryControlsState;
  textureInspector?: boolean;
};

export function RightSidebar({
  session,
  workspace,
  onRefresh,
  editFaces,
  chooseMode,
  toggleXRay,
  setGizmoMode,
  setOrientation,
  setPivot,
  outlinerTab,
  setOutlinerTab,
  isCollapsed,
  onToggleCollapse,
  recoveryState,
  textureInspector = false,
}: Props) {
  const [activeTab, setActiveTab] = useState<SidebarTab>('inspector');
  const [splitRatio, setSplitRatio] = useState<number>(0.42);
  const isDraggingSplit = useRef(false);

  const resizer = usePanelResizer({
    storageKey: textureInspector ? undefined : 'vipercad.sidebar.width.model',
    defaultWidth: textureInspector ? 280 : 320,
    minWidth: textureInspector ? 240 : 220,
    maxWidth: textureInspector ? 520 : 760,
    externalWidth: textureInspector ? workspace.texture.uvInspectorWidth : undefined,
    onWidthCommit: (w) => {
      if (textureInspector) {
        workspace.patchTexture({ uvInspectorWidth: w });
      }
    },
    onBeginResize: () => workspace.input.begin('divider'),
    onEndResize: () => workspace.input.end('divider'),
  });

  useEffect(() => {
    if (textureInspector && activeTab === 'split') setActiveTab('inspector');
  }, [textureInspector, activeTab]);

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (!isDraggingSplit.current || !resizer.containerRef.current) return;
      const rect = resizer.containerRef.current.getBoundingClientRect();
      const relativeY = e.clientY - rect.top;
      const ratio = Math.max(0.20, Math.min(0.80, relativeY / rect.height));
      setSplitRatio(ratio);
    };

    const onUp = () => {
      isDraggingSplit.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [resizer.containerRef]);

  // When collapsed, render a vertical icon dock
  if (isCollapsed) {
    return (
      <aside
        className={`right-sidebar is-collapsed${textureInspector ? ' is-texture' : ''}`}
        aria-label="Right Sidebar (Collapsed)"
      >
        <div className="sidebar-dock-header">
          <button
            type="button"
            className="sidebar-dock-action-btn"
            onClick={onToggleCollapse}
            title="Expand Sidebar (N) — Show Outliner & Inspector"
            aria-label="Expand sidebar"
          >
            <BlenderIcon name="tria_left_bar" size={15} />
          </button>
        </div>

        <div className="sidebar-dock-quick-tabs">
          <button
            type="button"
            className={`sidebar-dock-quick-btn${activeTab === 'outliner' ? ' is-active' : ''}`}
            onClick={() => {
              setActiveTab('outliner');
              onToggleCollapse();
            }}
            title="Open Outliner (Scene Hierarchy)"
            aria-label="Open Outliner"
          >
            <BlenderIcon name="outliner" size={15} />
          </button>
          <button
            type="button"
            className={`sidebar-dock-quick-btn${activeTab === 'inspector' ? ' is-active' : ''}`}
            onClick={() => {
              setActiveTab('inspector');
              onToggleCollapse();
            }}
            title="Open Inspector"
            aria-label="Open Inspector"
          >
            <BlenderIcon name="properties" size={15} />
          </button>
          {!textureInspector && (
            <button
              type="button"
              className={`sidebar-dock-quick-btn${activeTab === 'split' ? ' is-active' : ''}`}
              onClick={() => {
                setActiveTab('split');
                onToggleCollapse();
              }}
              title="Open Split View (Outliner + Inspector)"
              aria-label="Open Split View"
            >
              <BlenderIcon name="window" size={15} />
            </button>
          )}
        </div>

        <div
          className="sidebar-dock-label-strip"
          onClick={onToggleCollapse}
          title="Click to expand sidebar (N)"
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') onToggleCollapse();
          }}
        >
          <span className="edge-btn-label">INSPECTOR</span>
        </div>
      </aside>
    );
  }

  return (
    <aside
      className={`right-sidebar${textureInspector ? ' is-texture' : ''}${resizer.isResizing ? ' is-resizing' : ''}`}
      ref={resizer.containerRef}
      aria-label="Inspector and Hierarchy"
      style={{ width: resizer.width, flexBasis: resizer.width }}
    >
      <div
        className="right-sidebar-width-resizer"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize right sidebar"
        title={
          textureInspector
            ? 'Drag to resize UV inspector · Double-click resets (280px)'
            : 'Drag to resize sidebar · Double-click resets (320px)'
        }
        {...resizer.resizerProps}
      />
      {/* Top Header Bar */}
      <div className="right-sidebar-header">
        <div className="sidebar-tab-strip" role="tablist" aria-label="Sidebar view panes">
          {!textureInspector && (
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'split'}
              className={`sidebar-tab-btn${activeTab === 'split' ? ' is-active' : ''}`}
              onClick={() => setActiveTab('split')}
              title="Split — Outliner & Inspector"
            >
              <BlenderIcon name="window" size={13} style={{ marginRight: 5 }} />
              Split
            </button>
          )}
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'outliner'}
            className={`sidebar-tab-btn${activeTab === 'outliner' ? ' is-active' : ''}`}
            onClick={() => setActiveTab('outliner')}
            title="Outliner — Full height scene hierarchy"
          >
            <BlenderIcon name="outliner" size={13} style={{ marginRight: 5 }} />
            Outliner
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'inspector'}
            className={`sidebar-tab-btn${activeTab === 'inspector' ? ' is-active' : ''}`}
            onClick={() => setActiveTab('inspector')}
            title="Inspector — Full height tools"
          >
            <BlenderIcon name="properties" size={13} style={{ marginRight: 5 }} />
            Inspector
          </button>
        </div>

        <div className="sidebar-header-actions">
          {!textureInspector && (
            <button
              type="button"
              className={`sidebar-xray-button${session.selection.state.xRay ? ' is-active' : ''}`}
              onClick={toggleXRay}
              aria-pressed={session.selection.state.xRay}
              title={`X-Ray (Alt+Z): ${session.selection.state.xRay ? 'On' : 'Off'}`}
            >
              <BlenderIcon name="x_ray" size={13} />
              <span>X-Ray</span>
            </button>
          )}
          <button
            type="button"
            className="sidebar-collapse-toggle"
            onClick={onToggleCollapse}
            title="Collapse sidebar (N) — Maximize canvas"
            aria-label="Collapse sidebar"
          >
            <BlenderIcon name="tria_right_bar" size={15} />
          </button>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="right-sidebar-body">
        {activeTab === 'split' && !textureInspector && (
          <div className="sidebar-split-container">
            {/* Top: Scene Outliner */}
            <div className="sidebar-split-top" style={{ height: `${splitRatio * 100}%` }}>
              <FloatingOutliner
                session={session}
                docked
                activeTab={outlinerTab}
                onTabChange={setOutlinerTab}
                onClose={() => setActiveTab('inspector')}
                onRefresh={onRefresh}
              />
            </div>

            {/* Draggable Splitter Divider */}
            <div
              className="sidebar-resizer"
              onPointerDown={(e) => {
                e.preventDefault();
                isDraggingSplit.current = true;
                document.body.style.cursor = 'row-resize';
                document.body.style.userSelect = 'none';
              }}
              title="Drag up or down to resize Outliner and Inspector"
            >
              <div className="resizer-handle" />
            </div>

            {/* Bottom: Inspector */}
            <div className="sidebar-split-bottom" style={{ height: `${(1 - splitRatio) * 100}%` }}>
              <AppInspectorPanel
                session={session}
                workspace={workspace}
                docked
                onRefresh={onRefresh}
                editFaces={editFaces}
                chooseMode={chooseMode}
                setGizmoMode={setGizmoMode}
                setOrientation={setOrientation}
                setPivot={setPivot}
                recoveryState={recoveryState}
              />
            </div>
          </div>
        )}

        {activeTab === 'outliner' && (
          <div className="sidebar-full-pane">
            <FloatingOutliner
              session={session}
              docked
              activeTab={outlinerTab}
              onTabChange={setOutlinerTab}
              onClose={() => setActiveTab('inspector')}
              onRefresh={onRefresh}
            />
          </div>
        )}

        {textureInspector ? (
          <div className="sidebar-full-pane" hidden={activeTab !== 'inspector'}>
            <UvInspectorHost className="uv-inspector-host" />
          </div>
        ) : (
          activeTab === 'inspector' && (
            <div className="sidebar-full-pane">
              <AppInspectorPanel
                session={session}
                workspace={workspace}
                docked
                onRefresh={onRefresh}
                editFaces={editFaces}
                chooseMode={chooseMode}
                setGizmoMode={setGizmoMode}
                setOrientation={setOrientation}
                setPivot={setPivot}
                recoveryState={recoveryState}
              />
            </div>
          )
        )}
      </div>
    </aside>
  );
}
