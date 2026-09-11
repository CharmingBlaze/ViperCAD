import { useRef } from 'react';
import { BlenderIcon } from '@/components/BlenderIcon';
import type { EditorSession } from '@/core/editor/EditorSession';
import { BlockoutVectorTool } from '@/core/tools/BlockoutVectorTool';
import { BlockoutSolidTool } from '@/core/tools/BlockoutSolidTool';
import { BlockoutRoundTool } from '@/core/tools/BlockoutRoundTool';
import {
  snapReferenceToGround,
  centerReferenceHorizontally,
  type ReferenceImageConfig,
} from '@/core/blockout/ReferenceImages';
import {
  applyReferenceConfigToObject,
  importBlockoutReference,
  lockBlockoutReferences,
  removeBlockoutReference,
  setBlockoutReferenceLocked,
  setBlockoutShowInPersp,
  syncReferenceConfigFromObject,
} from '@/core/blockout/BlockoutReferenceObject';
import { IMAGE_FILES, openNativeFile } from '@/app/platform/FileDialogs';
import { pushToast } from '@/app/Toast';
import type { GizmoMode } from '@/core/transform/types';
import type { WorkspaceController } from '@/workspace/WorkspaceController';
import { usePanelResizer } from '@/app/usePanelResizer';
import './blockout.css';

const WIDTH_GAUGE_MAX = 5;

function WidthGauge({
  value,
  onChange,
  live,
}: {
  value: number;
  onChange: (next: number) => void;
  live?: boolean;
}) {
  const ticks = [0, 1, 2, 3, 4, 5];
  return (
    <div className={`blockout-width-gauge${live ? ' is-live' : ''}`}>
      <div className="blockout-row">
        <span className="blockout-label">Width</span>
        <input
          type="number"
          className="blockout-input"
          step="0.05"
          min="0.01"
          max="20"
          value={Number(value.toFixed(2))}
          onChange={(e) => onChange(parseFloat(e.target.value) || 0.1)}
        />
      </div>
      <div className="blockout-width-track">
        <input
          type="range"
          className="blockout-slider blockout-width-slider"
          min="0.05"
          max={WIDTH_GAUGE_MAX}
          step="0.05"
          value={Math.min(WIDTH_GAUGE_MAX, value)}
          onChange={(e) => onChange(parseFloat(e.target.value) || 0.1)}
        />
        <div className="blockout-width-ticks" aria-hidden>
          {ticks.map((tick) => (
            <span key={tick} className="blockout-width-tick">
              <i className={tick % 1 === 0 ? 'is-major' : ''} />
              <em>{tick}</em>
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

export type BlockoutPanelProps = {
  session: EditorSession;
  workspace?: WorkspaceController;
  onRefresh: () => void;
  onSwitchToModel?: () => void;
  gizmoMode: GizmoMode;
  setGizmoMode: (mode: GizmoMode) => void;
  chooseMode: (mode: 'object' | 'vertex' | 'edge' | 'face') => void;
};

export function BlockoutPanel({
  session,
  workspace,
  onRefresh,
  onSwitchToModel,
  gizmoMode,
  setGizmoMode,
  chooseMode,
}: BlockoutPanelProps) {
  const activeTool = session.tools.getActive();
  const isRoundTool = activeTool instanceof BlockoutRoundTool;
  const isSolidTool = activeTool instanceof BlockoutSolidTool;
  const isVectorTool = activeTool instanceof BlockoutVectorTool && !isSolidTool && !isRoundTool;
  const isMoveTool = !isVectorTool && !isSolidTool && !isRoundTool;
  const lastDrawTool = useRef<'blockout-vector' | 'blockout-solid' | 'blockout-round'>('blockout-vector');
  if (isVectorTool) lastDrawTool.current = 'blockout-vector';
  if (isSolidTool) lastDrawTool.current = 'blockout-solid';
  if (isRoundTool) lastDrawTool.current = 'blockout-round';

  const activateDrawTool = (id: 'blockout-vector' | 'blockout-solid' | 'blockout-round') => {
    lockBlockoutReferences(session.document, true);
    workspace?.setViewportNav('none', null);
    chooseMode('object');
    session.tools.setActive(id, session.context());
    session.requestRedraw();
    onRefresh();
  };
  const selectionMode = session.selection.state.mode;

  const vectorTool = session.tools.get('blockout-vector') as BlockoutVectorTool | undefined;
  const solidTool = session.tools.get('blockout-solid') as BlockoutSolidTool | undefined;
  const roundTool = session.tools.get('blockout-round') as BlockoutRoundTool | undefined;
  const refState = session.blockoutReference;
  const objectCount = session.document.objects.size;

  if (refState.front) syncReferenceConfigFromObject(session.document, refState.front);
  if (refState.side) syncReferenceConfigFromObject(session.document, refState.side);

  const handlePickReferenceImage = async (view: 'front' | 'side') => {
    try {
      const selected = await openNativeFile({ types: IMAGE_FILES });
      if (!selected) return;
      await importBlockoutReference(session, selected.file, view);
      pushToast(`Loaded ${selected.file.name} as a locked ${view} object`, 'success');
      onRefresh();
    } catch (err) {
      pushToast(err instanceof Error ? err.message : 'Could not open reference image', 'error');
    }
  };

  const updateRef = (view: 'front' | 'side', updater: (c: ReferenceImageConfig) => void) => {
    const config = view === 'front' ? refState.front : refState.side;
    if (!config) return;
    updater(config);
    if (config.objectId) applyReferenceConfigToObject(session.document, config);
    refState.revision += 1;
    session.requestRedraw();
    onRefresh();
  };

  const removeRef = (view: 'front' | 'side') => {
    removeBlockoutReference(session, view);
    onRefresh();
  };

  const toggleRefLock = (view: 'front' | 'side') => {
    const config = view === 'front' ? refState.front : refState.side;
    if (!config?.objectId) return;
    const next = !config.locked;
    setBlockoutReferenceLocked(session.document, config.objectId, next);
    config.locked = next;
    if (!next) {
      session.selection.setMode('object');
      session.selection.selectObjects([config.objectId], 'replace');
      session.tools.setActive('select', session.context());
      session.transform.setGizmoMode('combined');
    }
    refState.revision += 1;
    session.requestRedraw();
    onRefresh();
  };

  const toggleSilhouette = () => {
    if (!workspace) return;
    const current = workspace.getShadingMode();
    const next = current === 'silhouette' ? 'material' : 'silhouette';
    workspace.setShadingMode(next);
    onRefresh();
  };

  const handleSnapGround = (view: 'front' | 'side') => {
    updateRef(view, (c) => snapReferenceToGround(c));
    pushToast(`Snapped ${view} reference to ground`, 'success');
  };

  const handleCenterHorizontal = (view: 'front' | 'side') => {
    updateRef(view, (c) => centerReferenceHorizontally(c));
    pushToast(`Centered ${view} reference horizontally`, 'success');
  };

  const resizer = usePanelResizer({
    storageKey: 'vipercad.sidebar.width.blockout',
    defaultWidth: 300,
    minWidth: 240,
    maxWidth: 600,
  });

  return (
    <aside
      className={`blockout-panel${resizer.isResizing ? ' is-resizing' : ''}`}
      ref={resizer.containerRef}
      aria-label="Blockout"
      style={{ width: resizer.width, minWidth: resizer.width }}
    >
      <div
        className="panel-width-resizer"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize blockout panel"
        title="Drag to resize blockout panel · Double-click resets (300px)"
        {...resizer.resizerProps}
      />
      <header className="blockout-header">
        <div className="blockout-header-top">
          <span className="blockout-kicker">Blockout</span>
          {workspace && (
            <button
              type="button"
              className={`blockout-silhouette-btn${workspace.getShadingMode() === 'silhouette' ? ' is-active' : ''}`}
              onClick={toggleSilhouette}
              title="Toggle high-contrast silhouette mode"
            >
              <BlenderIcon name="shading_rendered" size={12} />
              <span>Silhouette</span>
            </button>
          )}
        </div>
        <strong>Flat + Square · any view</strong>
        <p>
          {objectCount === 0 ? 'No meshes yet' : `${objectCount} object${objectCount === 1 ? '' : 's'}`}
          {' · drop images onto Front or Side'}
        </p>
      </header>

      <div className="blockout-section">
        <div className="blockout-section-title">Draw</div>
        <div className="blockout-tool-switch blockout-tool-switch-4">
          <button
            type="button"
            className={`blockout-tool-btn${isVectorTool ? ' is-active' : ''}`}
            aria-pressed={isVectorTool}
            title="Flat silhouette in any view, then Extrude (V)"
            onClick={() => activateDrawTool('blockout-vector')}
          >
            Flat
          </button>
          <button
            type="button"
            className={`blockout-tool-btn${isSolidTool ? ' is-active' : ''}`}
            aria-pressed={isSolidTool}
            title="Square solid with live thickness in any view (Q)"
            onClick={() => activateDrawTool('blockout-solid')}
          >
            Square
          </button>
          <button
            type="button"
            className={`blockout-tool-btn${isRoundTool ? ' is-active' : ''}`}
            aria-pressed={isRoundTool}
            title="Low-poly round (8-sided ellipse), then Extrude (O)"
            onClick={() => activateDrawTool('blockout-round')}
          >
            Round
          </button>
          <button
            type="button"
            className={`blockout-tool-btn${isMoveTool ? ' is-active' : ''}`}
            aria-pressed={isMoveTool}
            title="Select and transform (G/R/S · 1/2/3 for vertex/edge/face)"
            onClick={() => setGizmoMode('move')}
          >
            Move
          </button>
        </div>
        {isMoveTool && (
          <button
            type="button"
            className="blockout-action-btn is-primary blockout-draw-again"
            onClick={() => activateDrawTool(lastDrawTool.current)}
            title="Turn the last draw tool back on"
          >
            Draw again
          </button>
        )}
        {isMoveTool && (
          <p className="blockout-hint">
            Drawing is off. Use Draw again, or pick Flat / Square / Round, to sketch in the viewports.
          </p>
        )}
        {workspace && (
          <label className="blockout-check">
            <input
              type="checkbox"
              aria-label="On surfaces"
              checked={workspace.getDrawOnSurfaces()}
              onChange={(e) => {
                workspace.setDrawOnSurfaces(e.target.checked);
                onRefresh();
              }}
            />
            On surfaces
          </label>
        )}
      </div>

      <div className="blockout-section">
        <div className="blockout-section-title">Edit</div>
        <div className="blockout-tool-switch blockout-tool-switch-4 blockout-tool-switch-icons" role="group" aria-label="Selection mode">
          {([
            ['object', 'Object', 'object_datamode', 'Object Mode — transform whole meshes'],
            ['vertex', 'Vertex', 'vertex_select', 'Vertex Select (1) — edit points'],
            ['edge', 'Edge', 'edge_select', 'Edge Select (2) — edit edges'],
            ['face', 'Face', 'face_select', 'Face Select (3) — edit faces'],
          ] as const).map(([mode, label, icon, title]) => (
            <button
              key={mode}
              type="button"
              className={`blockout-tool-btn${selectionMode === mode ? ' is-active' : ''}`}
              aria-pressed={selectionMode === mode}
              title={title}
              onClick={() => chooseMode(mode)}
            >
              <BlenderIcon name={icon} size={13} />
              <span>{label}</span>
            </button>
          ))}
        </div>
        <p className="blockout-hint">
          {selectionMode === 'object'
            ? 'Click a mesh, then Vertex / Edge / Face (1 / 2 / 3) to edit it. V, Q, and O return to Flat / Square / Round.'
            : `Click in Front, Side, or Perspective to select ${selectionMode === 'vertex' ? 'points' : selectionMode === 'edge' ? 'edges' : 'faces'}. G/R/S transform.`}
        </p>
      </div>

      {workspace && (
        <div className="blockout-section">
          <div className="blockout-section-title">Views</div>
          <div className="blockout-tool-switch" role="group" aria-label="Viewport layout">
            <button
              type="button"
              className={`blockout-tool-btn${workspace.splits.state.blockoutArrangement !== 'columns' ? ' is-active' : ''}`}
              aria-pressed={workspace.splits.state.blockoutArrangement !== 'columns'}
              title="Front and Side stacked, Perspective on the right"
              onClick={() => {
                workspace.setBlockoutArrangement('stack');
                onRefresh();
              }}
            >
              Stacked
            </button>
            <button
              type="button"
              className={`blockout-tool-btn${workspace.splits.state.blockoutArrangement === 'columns' ? ' is-active' : ''}`}
              aria-pressed={workspace.splits.state.blockoutArrangement === 'columns'}
              title="Three vertical 3D windows: Front, Side, Perspective"
              onClick={() => {
                workspace.setBlockoutArrangement('columns');
                onRefresh();
              }}
            >
              3 columns
            </button>
          </div>
        </div>
      )}

      {isVectorTool && vectorTool && (
        <div className="blockout-section">
          <div className="blockout-section-title">
            <span>Flat</span>
            <span className="dim">
              {vectorTool.state.stage === 'width'
                ? `Width ${vectorTool.thickness.toFixed(2)}`
                : `${vectorTool.state.points.length} pts`}
            </span>
          </div>
          <WidthGauge
            value={vectorTool.thickness}
            live={vectorTool.state.stage === 'width'}
            onChange={(next) => {
              vectorTool.setThickness(next, session.context());
              onRefresh();
            }}
          />
          <p className="blockout-hint">
            {vectorTool.state.stage === 'width'
              ? 'Move in the view to set width, or use the slider.'
              : 'Enter, then move the mouse to set width.'}
          </p>
          <label className="blockout-check">
            <input
              type="checkbox"
              checked={vectorTool.symmetric}
              onChange={(e) => {
                vectorTool.setSymmetric(e.target.checked, session.context());
                onRefresh();
              }}
            />
            Centered depth
          </label>
          <label className="blockout-check">
            <input
              type="checkbox"
              checked={vectorTool.mirrorX}
              onChange={(e) => {
                vectorTool.setMirrorX(e.target.checked, session.context());
                onRefresh();
              }}
            />
            Mirror X (C)
          </label>
          <div className="blockout-btn-row">
            <button
              type="button"
              className="blockout-action-btn is-primary"
              onClick={() => {
                if (vectorTool.state.stage === 'width') {
                  const ok = vectorTool.commitExtrude(session.context());
                  if (!ok) pushToast('Need at least 3 points', 'info');
                  else {
                    session.tools.setActive('select', session.context());
                    session.transform.setGizmoMode('combined');
                    pushToast('Extruded solid', 'success');
                  }
                } else if (!vectorTool.beginWidthStage(session.context())) {
                  pushToast('Need at least 3 points', 'info');
                }
                onRefresh();
              }}
              title={vectorTool.state.stage === 'width' ? 'Commit width (Enter)' : 'Set width (Enter)'}
            >
              {vectorTool.state.stage === 'width' ? 'Commit' : 'Extrude'}
            </button>
            <button
              type="button"
              className="blockout-action-btn"
              onClick={() => {
                vectorTool.clear(session.context());
                onRefresh();
              }}
              title="Clear silhouette (Esc)"
            >
              Clear
            </button>
          </div>
        </div>
      )}

      {isSolidTool && solidTool && (
        <div className="blockout-section">
          <div className="blockout-section-title">
            <span>Square</span>
            <span className="dim">
              {solidTool.state.stage === 'width'
                ? `Width ${solidTool.thickness.toFixed(2)}`
                : `${solidTool.state.points.length} pts · live`}
            </span>
          </div>
          <WidthGauge
            value={solidTool.thickness}
            live={solidTool.state.stage === 'width'}
            onChange={(next) => {
              solidTool.setThickness(next, session.context());
              onRefresh();
            }}
          />
          <p className="blockout-hint">
            {solidTool.state.stage === 'width'
              ? 'Move in the view to set width, or use the slider.'
              : 'Enter, then move the mouse to set width.'}
          </p>
          <label className="blockout-check">
            <input
              type="checkbox"
              checked={solidTool.symmetric}
              onChange={(e) => {
                solidTool.setSymmetric(e.target.checked, session.context());
                onRefresh();
              }}
            />
            Centered depth
          </label>
          <label className="blockout-check">
            <input
              type="checkbox"
              checked={solidTool.mirrorX}
              onChange={(e) => {
                solidTool.setMirrorX(e.target.checked, session.context());
                onRefresh();
              }}
            />
            Mirror X (C)
          </label>
          <div className="blockout-btn-row">
            <button
              type="button"
              className="blockout-action-btn is-primary"
              onClick={() => {
                if (solidTool.state.stage === 'width') {
                  const ok = solidTool.commitExtrude(session.context());
                  if (!ok) pushToast('Need at least 3 points', 'info');
                  else {
                    session.tools.setActive('select', session.context());
                    session.transform.setGizmoMode('combined');
                    pushToast('Committed solid', 'success');
                  }
                } else if (!solidTool.beginWidthStage(session.context())) {
                  pushToast('Need at least 3 points', 'info');
                }
                onRefresh();
              }}
              title={solidTool.state.stage === 'width' ? 'Commit width (Enter)' : 'Set width (Enter)'}
            >
              {solidTool.state.stage === 'width' ? 'Commit' : 'Extrude'}
            </button>
            <button
              type="button"
              className="blockout-action-btn"
              onClick={() => {
                solidTool.clear(session.context());
                onRefresh();
              }}
              title="Clear silhouette (Esc)"
            >
              Clear
            </button>
          </div>
        </div>
      )}

      {isRoundTool && roundTool && (
        <div className="blockout-section">
          <div className="blockout-section-title">
            <span>Round</span>
            <span className="dim">
              {roundTool.state.stage === 'width'
                ? `Width ${roundTool.thickness.toFixed(2)}`
                : `${roundTool.state.points.length || 0} sides · live`}
            </span>
          </div>
          <WidthGauge
            value={roundTool.thickness}
            live={roundTool.state.stage === 'width'}
            onChange={(next) => {
              roundTool.setThickness(next, session.context());
              onRefresh();
            }}
          />
          <p className="blockout-hint">
            {roundTool.state.stage === 'width'
              ? 'Move in the view to set width, or use the slider.'
              : 'Drag a box for a faceted ellipse, then set width.'}
          </p>
          <div className="blockout-tool-switch blockout-tool-switch-3">
            {([6, 8, 12] as const).map((n) => (
              <button
                key={n}
                type="button"
                className={`blockout-tool-btn${roundTool.sides === n ? ' is-active' : ''}`}
                aria-pressed={roundTool.sides === n}
                title={`${n}-sided ellipse`}
                onClick={() => {
                  roundTool.setSides(n, session.context());
                  onRefresh();
                }}
              >
                {n} sides
              </button>
            ))}
          </div>
          <label className="blockout-check">
            <input
              type="checkbox"
              checked={roundTool.symmetric}
              onChange={(e) => {
                roundTool.setSymmetric(e.target.checked, session.context());
                onRefresh();
              }}
            />
            Centered depth
          </label>
          <label className="blockout-check">
            <input
              type="checkbox"
              checked={roundTool.mirrorX}
              onChange={(e) => {
                roundTool.setMirrorX(e.target.checked, session.context());
                onRefresh();
              }}
            />
            Mirror X (C)
          </label>
          <div className="blockout-btn-row">
            <button
              type="button"
              className="blockout-action-btn is-primary"
              onClick={() => {
                if (roundTool.state.stage === 'width') {
                  const ok = roundTool.commitExtrude(session.context());
                  if (!ok) pushToast('Drag a round silhouette first', 'info');
                  else {
                    session.tools.setActive('select', session.context());
                    session.transform.setGizmoMode('combined');
                    pushToast('Committed solid', 'success');
                  }
                } else if (!roundTool.beginWidthStage(session.context())) {
                  pushToast('Drag a round silhouette first', 'info');
                }
                onRefresh();
              }}
              title={roundTool.state.stage === 'width' ? 'Commit width (Enter)' : 'Set width (Enter)'}
            >
              {roundTool.state.stage === 'width' ? 'Commit' : 'Extrude'}
            </button>
            <button
              type="button"
              className="blockout-action-btn"
              onClick={() => {
                roundTool.clear(session.context());
                onRefresh();
              }}
              title="Clear silhouette (Esc)"
            >
              Clear
            </button>
          </div>
        </div>
      )}

      {isMoveTool && (
        <div className="blockout-section">
          <div className="blockout-section-title">Transform</div>
          <div className="blockout-tool-switch blockout-tool-switch-3">
            {([
              ['move', 'Move'],
              ['rotate', 'Rotate'],
              ['scale', 'Scale'],
            ] as const).map(([mode, label]) => (
              <button
                key={mode}
                type="button"
                className={`blockout-tool-btn${gizmoMode === mode ? ' is-active' : ''}`}
                onClick={() => setGizmoMode(mode)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="blockout-section">
        <div className="blockout-section-title">References</div>
        <p className="blockout-hint">
          Drop an image onto Front or Side. Blueprints start locked so draw tools pass through them. Unlock to move or scale with gizmos.
        </p>
        <div className="blockout-btn-row">
          <button
            type="button"
            className="blockout-action-btn"
            onClick={() => {
              lockBlockoutReferences(session.document, true);
              if (refState.front) refState.front.locked = true;
              if (refState.side) refState.side.locked = true;
              refState.revision += 1;
              session.requestRedraw();
              onRefresh();
            }}
          >
            Lock both
          </button>
        </div>
        <label className="blockout-check">
          <input
            type="checkbox"
            checked={refState.showInPersp}
            onChange={(e) => {
              setBlockoutShowInPersp(session, e.target.checked);
              onRefresh();
            }}
          />
          Show in perspective
        </label>
        <ReferenceSlot
          label="Front"
          config={refState.front}
          offsetLabels={['X', 'Y']}
          onLoad={() => void handlePickReferenceImage('front')}
          onRemove={() => removeRef('front')}
          onToggleLock={() => toggleRefLock('front')}
          onToggleVisible={() => updateRef('front', (c) => { c.visible = !c.visible; })}
          onOpacity={(v) => updateRef('front', (c) => { c.opacity = v; })}
          onScale={(v) => updateRef('front', (c) => { c.scale = v; })}
          onOffsetA={(v) => updateRef('front', (c) => { c.posX = v; })}
          onOffsetB={(v) => updateRef('front', (c) => { c.posY = v; })}
          offsetA={refState.front?.posX ?? 0}
          offsetB={refState.front?.posY ?? 0}
          onFlip={() => updateRef('front', (c) => { c.flipX = !c.flipX; })}
          onCenter={() => updateRef('front', (c) => { c.posX = 0; c.posY = 1; })}
          onSnapGround={() => handleSnapGround('front')}
          onCenterHorizontal={() => handleCenterHorizontal('front')}
        />
        <ReferenceSlot
          label="Side"
          config={refState.side}
          offsetLabels={['Z', 'Y']}
          onLoad={() => void handlePickReferenceImage('side')}
          onRemove={() => removeRef('side')}
          onToggleLock={() => toggleRefLock('side')}
          onToggleVisible={() => updateRef('side', (c) => { c.visible = !c.visible; })}
          onOpacity={(v) => updateRef('side', (c) => { c.opacity = v; })}
          onScale={(v) => updateRef('side', (c) => { c.scale = v; })}
          onOffsetA={(v) => updateRef('side', (c) => { c.posZ = v; })}
          onOffsetB={(v) => updateRef('side', (c) => { c.posY = v; })}
          offsetA={refState.side?.posZ ?? 0}
          offsetB={refState.side?.posY ?? 0}
          onFlip={() => updateRef('side', (c) => { c.flipX = !c.flipX; })}
          onCenter={() => updateRef('side', (c) => { c.posZ = 0; c.posY = 1; })}
          onSnapGround={() => handleSnapGround('side')}
          onCenterHorizontal={() => handleCenterHorizontal('side')}
        />
      </div>

      {onSwitchToModel && (
        <div className="blockout-section">
          <button type="button" className="blockout-action-btn" onClick={onSwitchToModel}>
            Open Model
          </button>
        </div>
      )}
    </aside>
  );
}

type ReferenceSlotProps = {
  label: string;
  config: ReferenceImageConfig | null;
  offsetLabels: [string, string];
  offsetA: number;
  offsetB: number;
  onLoad: () => void;
  onRemove: () => void;
  onToggleLock: () => void;
  onToggleVisible: () => void;
  onOpacity: (value: number) => void;
  onScale: (value: number) => void;
  onOffsetA: (value: number) => void;
  onOffsetB: (value: number) => void;
  onFlip: () => void;
  onCenter: () => void;
  onSnapGround: () => void;
  onCenterHorizontal: () => void;
};

function ReferenceSlot({
  label,
  config,
  offsetLabels,
  offsetA,
  offsetB,
  onLoad,
  onRemove,
  onToggleLock,
  onToggleVisible,
  onOpacity,
  onScale,
  onOffsetA,
  onOffsetB,
  onFlip,
  onCenter,
  onSnapGround,
  onCenterHorizontal,
}: ReferenceSlotProps) {
  if (!config) {
    return (
      <button type="button" className="blockout-action-btn" onClick={onLoad}>
        <BlenderIcon name="image_data" size={14} />
        <span>Load {label}</span>
      </button>
    );
  }

  return (
    <div className="blockout-ref-card">
      <div className="blockout-ref-card-header">
        <span className="blockout-ref-card-title">{label} · {config.name}</span>
        <span className="blockout-ref-card-actions">
          <button
            type="button"
            className={`tool${config.locked ? ' is-active' : ''}`}
            onClick={onToggleLock}
            title={config.locked ? 'Unlock to move and scale' : 'Lock so Flat / Square ignore this'}
          >
            <BlenderIcon name={config.locked ? 'locked' : 'unlocked'} size={14} />
          </button>
          <button type="button" className="tool" onClick={onToggleVisible} title={config.visible ? 'Hide' : 'Show'}>
            <BlenderIcon name={config.visible ? 'hide_off' : 'hide_on'} size={14} />
          </button>
          <button type="button" className="tool" onClick={onRemove} title={`Remove ${label} reference`}>
            <BlenderIcon name="cancel" size={12} />
          </button>
        </span>
      </div>
      {config.url ? <img src={config.url} alt={`${label} reference`} className="blockout-ref-thumb" /> : null}
      <div className="blockout-row">
        <span className="blockout-label">Opacity</span>
        <input
          type="range"
          className="blockout-slider"
          min="0.05"
          max="1.0"
          step="0.05"
          value={config.opacity}
          onChange={(e) => onOpacity(parseFloat(e.target.value))}
        />
        <span className="dim">{Math.round(config.opacity * 100)}%</span>
      </div>
      <div className="blockout-row">
        <span className="blockout-label">Height</span>
        <input
          type="number"
          className="blockout-input"
          step="0.1"
          min="0.1"
          value={config.scale}
          onChange={(e) => onScale(parseFloat(e.target.value) || 1)}
        />
      </div>
      <div className="blockout-row">
        <span className="blockout-label">Off {offsetLabels[0]}</span>
        <input
          type="number"
          className="blockout-input"
          step="0.1"
          value={offsetA}
          onChange={(e) => onOffsetA(parseFloat(e.target.value) || 0)}
        />
      </div>
      <div className="blockout-row">
        <span className="blockout-label">Off {offsetLabels[1]}</span>
        <input
          type="number"
          className="blockout-input"
          step="0.1"
          value={offsetB}
          onChange={(e) => onOffsetB(parseFloat(e.target.value) || 0)}
        />
      </div>
      <div className="blockout-ref-actions">
        <button type="button" className="blockout-action-btn" onClick={onFlip}>Flip</button>
        <button type="button" className="blockout-action-btn" onClick={onSnapGround} title="Snap bottom to ground (Y = 0)">Ground</button>
      </div>
      <div className="blockout-action-row-3">
        <button type="button" className="blockout-action-btn" onClick={onCenterHorizontal} title="Center horizontally on origin axis">Center</button>
        <button type="button" className="blockout-action-btn" onClick={onCenter} title="Reset offset to default">Reset</button>
      </div>
    </div>
  );
}
