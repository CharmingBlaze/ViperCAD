import type { EditorSession } from '@/core/editor/EditorSession';
import type { WorkspaceController } from '@/workspace/WorkspaceController';
import { BlenderIcon } from '@/components/BlenderIcon';
import {
  applyTileDrawToolConfig,
  nudgeTileDrawPlane,
  prepareTileDraw,
  prepareTilePaint,
  setTileDrawMode,
  setTileDrawPlane,
  snapTileDrawToNearestVertex,
  tileDrawDepthLabel,
  tileDrawPlaneLabel,
  toggleTileDrawSurfaceLock,
  toggleTilesetPopup,
} from '@/app/tilesetWorkspace';
import type { TileDrawMode, TileDrawShape } from '@/core/tools/TileDrawTool';

export function TileDrawHud({
  session,
  workspace,
}: {
  session: EditorSession;
  workspace: WorkspaceController;
}) {
  const tex = workspace.texture;
  const building = session.tools.getActive()?.id === 'tile-draw';
  const painting = !building && tex.atlasPaintMode && tex.uvPanelTab === 'tiles';
  if (tex.uvPanelTab !== 'tiles') return null;

  const patchAndSync = (patch: Parameters<WorkspaceController['patchTexture']>[0]) => {
    workspace.patchTexture(patch);
    if (building) applyTileDrawToolConfig(session, workspace);
    session.requestRedraw();
  };

  const tileCol = Math.floor((tex.atlasTileX - tex.atlasOffsetX) / Math.max(1, tex.atlasTileWidth + tex.atlasMarginX));
  const tileRow = Math.floor((tex.atlasTileY - tex.atlasOffsetY) / Math.max(1, tex.atlasTileHeight + tex.atlasMarginY));
  const toolLabel = tex.atlasDrawMode === 'paint' ? 'Draw' : tex.atlasDrawMode === 'erase' ? 'Delete' : tex.atlasDrawMode[0]!.toUpperCase() + tex.atlasDrawMode.slice(1);
  const shapeLabel = tex.atlasDrawShape[0]!.toUpperCase() + tex.atlasDrawShape.slice(1);
  const hint = building
    ? tex.atlasDrawMode === 'fill'
      ? `Fill ${tex.atlasFillColumns}×${tex.atlasFillRows} · Click place · Shift+click flood · Esc cancel`
      : tex.atlasDrawMode === 'pick'
        ? 'Pick · Click a painted tile · I'
        : tex.atlasDrawShape === 'rectangle'
          ? 'Rectangle · Drag corners · Shift+Wheel plane · Esc cancel'
          : tex.atlasDrawShape === 'line'
            ? 'Line · Drag start to end · Alt pick tile · Esc cancel'
            : tex.atlasUseFacePlane
              ? 'Surface · Hover face · L lock · V snap vertex · Alt pick tile'
              : `${toolLabel} · LMB place · Drag ${shapeLabel.toLowerCase()} · Alt pick tile · Q rotate · Esc cancel`
    : painting
      ? 'Paint · Drag across faces · Alt pick tile'
      : 'Choose a tile, then Build to draw in the 3D view';

  return (
    <div className="tile-draw-hud" aria-label="3D tile tools">
      <div className="tile-draw-hud-group" role="group" aria-label="Workflow">
        <button
          type="button"
          className={`tile-draw-hud-btn${building ? ' is-active' : ''}`}
          title="Build new tile geometry in the 3D view"
          onClick={() => prepareTileDraw(session, workspace)}
        >
          <BlenderIcon name="mesh_grid" size={12} />
          Build
        </button>
        <button
          type="button"
          className={`tile-draw-hud-btn${painting ? ' is-active' : ''}`}
          title="Paint tiles onto existing faces"
          onClick={() => prepareTilePaint(session, workspace)}
        >
          <BlenderIcon name="greasepencil" size={12} />
          Paint
        </button>
        <button
          type="button"
          className={`tile-draw-hud-btn${tex.atlasPanelOpen ? ' is-active' : ''}`}
          title={tex.atlasPanelOpen ? 'Hide tileset palette' : 'Show tileset palette'}
          onClick={() => toggleTilesetPopup(workspace)}
          aria-pressed={tex.atlasPanelOpen}
        >
          <BlenderIcon name="image" size={12} />
          Palette
        </button>
      </div>
      {building && (
        <>
          <div className="tile-draw-hud-group" role="group" aria-label="Tool">
            {([
              ['paint', 'Draw', 'B'],
              ['erase', 'Delete', 'X'],
              ['replace', 'Replace', 'R'],
              ['fill', 'Fill', 'F'],
              ['pick', 'Pick', 'I'],
            ] as [TileDrawMode, string, string][]).map(([mode, label, key]) => (
              <button
                key={mode}
                type="button"
                className={`tile-draw-hud-btn${tex.atlasDrawMode === mode ? ' is-active' : ''}`}
                title={`${label} (${key})`}
                onClick={() => setTileDrawMode(session, workspace, mode)}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="tile-draw-hud-group" role="group" aria-label="Shape">
            {([
              ['single', 'Single'],
              ['stroke', 'Stroke'],
              ['line', 'Line'],
              ['rectangle', 'Rect'],
            ] as [TileDrawShape, string][]).map(([shape, label]) => (
              <button
                key={shape}
                type="button"
                className={`tile-draw-hud-btn${tex.atlasDrawShape === shape ? ' is-active' : ''}`}
                title={`${label} (Shift+${shape === 'single' ? '1' : shape === 'stroke' ? '2' : shape === 'line' ? '3' : '4'})`}
                onClick={() => patchAndSync({ atlasDrawShape: shape })}
              >
                {label}
              </button>
            ))}
          </div>
          {tex.atlasDrawMode === 'fill' && (
            <div className="tile-draw-hud-group" role="group" aria-label="Fill size">
              <span className="tile-draw-hud-depth">{tex.atlasFillColumns}×{tex.atlasFillRows}</span>
              <button type="button" className="tile-draw-hud-btn" title="Fewer fill columns" onClick={() => patchAndSync({ atlasFillColumns: Math.max(1, tex.atlasFillColumns - 1) })}>−W</button>
              <button type="button" className="tile-draw-hud-btn" title="More fill columns" onClick={() => patchAndSync({ atlasFillColumns: Math.min(64, tex.atlasFillColumns + 1) })}>+W</button>
              <button type="button" className="tile-draw-hud-btn" title="Fewer fill rows" onClick={() => patchAndSync({ atlasFillRows: Math.max(1, tex.atlasFillRows - 1) })}>−H</button>
              <button type="button" className="tile-draw-hud-btn" title="More fill rows" onClick={() => patchAndSync({ atlasFillRows: Math.min(64, tex.atlasFillRows + 1) })}>+H</button>
            </div>
          )}
        </>
      )}
      {painting && (
        <div className="tile-draw-hud-group" role="group" aria-label="Paint fit">
          <button
            type="button"
            className={`tile-draw-hud-btn${tex.atlasStretchU ? ' is-active' : ''}`}
            title="Stretch the tile across the face width"
            onClick={() => patchAndSync({ atlasStretchU: !tex.atlasStretchU })}
          >
            Stretch U
          </button>
          <button
            type="button"
            className={`tile-draw-hud-btn${tex.atlasStretchV ? ' is-active' : ''}`}
            title="Stretch the tile across the face height"
            onClick={() => patchAndSync({ atlasStretchV: !tex.atlasStretchV })}
          >
            Stretch V
          </button>
          <button
            type="button"
            className={`tile-draw-hud-btn${tex.atlasHintDown ? ' is-active' : ''}`}
            title="Lowest or selected edge is the tile bottom"
            onClick={() => patchAndSync({ atlasHintDown: !tex.atlasHintDown })}
          >
            Hint down
          </button>
        </div>
      )}
      <div className="tile-draw-hud-group tile-draw-hud-plane" role="group" aria-label="Build plane">
        {([
          ['floor', 'Floor', '1'],
          ['wall-x', 'Front', '2'],
          ['wall-z', 'Side', '3'],
        ] as const).map(([id, label, key]) => (
          <button
            key={id}
            type="button"
            className={`tile-draw-hud-btn${tex.atlasPlaneOrientation === id && !tex.atlasUseFacePlane ? ' is-active' : ''}`}
            title={`${label} (${key})`}
            onClick={() => setTileDrawPlane(session, workspace, id)}
          >
            {label}
          </button>
        ))}
        <button
          type="button"
          className={`tile-draw-hud-btn${tex.atlasUseFacePlane ? ' is-active' : ''}`}
          title="Use the hovered surface as the work plane (4)"
          onClick={() => setTileDrawPlane(session, workspace, 'surface')}
        >
          Surface
        </button>
        {building && (
          <>
            <span className="tile-draw-hud-depth">{tileDrawDepthLabel(tex)}</span>
            <button type="button" className="tile-draw-hud-btn" title="Move plane back ([ or Shift+Wheel)" onClick={() => nudgeTileDrawPlane(session, workspace, -1)}>−</button>
            <button type="button" className="tile-draw-hud-btn" title="Move plane forward (] or Shift+Wheel)" onClick={() => nudgeTileDrawPlane(session, workspace, 1)}>+</button>
            {tex.atlasUseFacePlane && (
              <button
                type="button"
                className={`tile-draw-hud-btn${tex.atlasSurfaceLocked ? ' is-active' : ''}`}
                title="Lock the current surface (L)"
                onClick={() => toggleTileDrawSurfaceLock(session, workspace)}
              >
                {tex.atlasSurfaceLocked ? 'Locked' : 'Lock'}
              </button>
            )}
            <button
              type="button"
              className="tile-draw-hud-btn"
              title="Snap the work plane to the nearest vertex (V)"
              onClick={() => snapTileDrawToNearestVertex(session, workspace)}
            >
              Snap V
            </button>
          </>
        )}
      </div>
      <div className="tile-draw-hud-group" role="group" aria-label="Stamp">
        <button
          type="button"
          className="tile-draw-hud-btn"
          title="Rotate stamp (Q / E)"
          onClick={() => patchAndSync({ atlasQuarterTurns: ((tex.atlasQuarterTurns + 1) % 4) as 0 | 1 | 2 | 3 })}
        >
          Rot {tex.atlasQuarterTurns * 90}°
        </button>
        <button
          type="button"
          className={`tile-draw-hud-btn${tex.atlasFlipU ? ' is-active' : ''}`}
          title="Flip U (Shift+E)"
          onClick={() => patchAndSync({ atlasFlipU: !tex.atlasFlipU })}
        >
          Flip U
        </button>
        <button
          type="button"
          className={`tile-draw-hud-btn${tex.atlasFlipV ? ' is-active' : ''}`}
          title="Flip V (Shift+Q)"
          onClick={() => patchAndSync({ atlasFlipV: !tex.atlasFlipV })}
        >
          Flip V
        </button>
        <button
          type="button"
          className={`tile-draw-hud-btn${tex.atlasJoinMulti ? ' is-active' : ''}`}
          title="Join a multi-tile pick into one face"
          onClick={() => patchAndSync({ atlasJoinMulti: !tex.atlasJoinMulti })}
        >
          Join Multi
        </button>
      </div>
      <span className="tile-draw-hud-status">
        {toolLabel} · {tileDrawPlaneLabel(tex)} · Tile {tileCol},{tileRow} · Rot {tex.atlasQuarterTurns * 90}°
      </span>
      <span className="tile-draw-hud-hint">{hint}</span>
    </div>
  );
}
