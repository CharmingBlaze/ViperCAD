import { useEffect, useRef, useState } from 'react';
import { BlenderIcon } from '@/components/BlenderIcon';
import { MaterialEditor } from '@/app/MaterialEditor';
import { IMAGE_FILES, openNativeFile } from '@/app/platform/FileDialogs';
import { createMaterial } from '@/core/document/ModelDocument';
import type { EditorSession } from '@/core/editor/EditorSession';
import { importImageFile } from '@/core/image/ImageImport';
import type { ImageAsset } from '@/core/document/types';
import {
  clampPaletteColor,
  createCustomPalette,
  findPalette,
  listPalettes,
  paletteGroups,
} from '@/core/image/ColorPalettes';
import {
  addPaintLayer,
  applyPaintStack,
  clonePaintStack,
  duplicatePaintLayer,
  movePaintLayer,
  patchPaintLayer,
  removePaintLayer,
  setActivePaintLayer,
} from '@/core/image/PaintLayers';
import { resolveActiveTexture } from '@/core/texture/resolveActiveTexture';
import { boundsOfUvs, cornersForFaces, resolveUvLayerId, snapshotUvs } from '@/core/uv/UvEdit';
import type { UvUnwrapMode } from '@/core/uv/UvOperations';
import type { WorkspaceController } from '@/workspace/WorkspaceController';
import type { UvDiagnostics } from '@/core/uv/UvDiagnostics';
import type {
  RightEditorMode,
  UvEditMode,
  UvPanelTab,
  UvTransformTool,
} from '@/workspace/TextureWorkspace';
import {
  DITHER_MODES,
  PIXEL_TOOL_HOTKEYS,
  PIXEL_TOOL_ICONS,
  PIXEL_TOOL_LABELS,
  PIXEL_TOOLS,
  shiftShadeColor,
} from '@/app/uvEditor/uvEditorUtils';

export type UvEditorSidePanelProps = {
  session: EditorSession;
  workspace: WorkspaceController;
  uvPointerActive: boolean;
  imageLabel: string | null;
  selectionSummary: string | null;
  uvDiagnostics: UvDiagnostics | null;
  onSelectAll: () => void;
  onFocusSelectedFace: () => void;
  onRotate: (degrees: number) => void;
  onResizePixels: (widthPx: number, heightPx: number) => void;
  onScaleFactor: (factor: number) => void;
  onFlip: (axis: 'u' | 'v') => void;
  onUnwrap: (mode: UvUnwrapMode) => void;
  onPack: () => void;
  onNormalize: () => void;
  onWeld: () => void;
  onSplit: () => void;
  onStraighten: () => void;
  onRelax: () => void;
  onRotateToEdge: () => void;
  onFlipFaces: () => void;
  onToggleSeams: (seam: boolean) => void;
  onFrame: () => void;
  onArmUv: (patch?: {
    uvEditMode?: UvEditMode;
    uvTransformTool?: UvTransformTool;
    uvPanelTab?: UvPanelTab;
    activeRightEditor?: RightEditorMode;
  }) => void;
  onRefresh?: () => void;
  embedded?: boolean;
};

const TABS: { id: UvPanelTab; label: string }[] = [
  { id: 'edit', label: 'Edit' },
  { id: 'tiles', label: 'Tiles' },
  { id: 'paint', label: 'Paint' },
  { id: 'material', label: 'Mat' },
  { id: 'view', label: 'View' },
];

const BRUSH_SIZE_PRESETS = [1, 2, 3, 4, 8, 16, 32];

/**
 * Right-side UV / Pixel inspector: tabbed sections + dropdown controls.
 */
export function UvEditorSidePanel({
  session,
  workspace,
  uvPointerActive,
  imageLabel,
  selectionSummary,
  uvDiagnostics,
  onSelectAll,
  onFocusSelectedFace,
  onRotate,
  onResizePixels,
  onScaleFactor,
  onFlip,
  onUnwrap,
  onPack,
  onNormalize,
  onWeld,
  onSplit,
  onStraighten,
  onRelax,
  onRotateToEdge,
  onFlipFaces,
  onToggleSeams,
  onFrame,
  onArmUv,
  onRefresh,
  embedded = false,
}: UvEditorSidePanelProps) {
  const tex = workspace.texture;
  const tab = tex.uvPanelTab;
  const edgeCount = session.selection.state.selectedEdgeIds.size;
  const hasUvSelection = session.uvSelection.size > 0 || session.selection.state.selectedFaceIds.size > 0;
  const [resizeW, setResizeW] = useState(16);
  const [resizeH, setResizeH] = useState(16);
  const palettes = listPalettes(tex.customPalettes);
  const activePalette = findPalette(tex.activePaletteId, tex.customPalettes);
  const textureCtx = resolveActiveTexture(session.document, session.selection.state);
  const paintImage = textureCtx.imageId ? session.document.images.get(textureCtx.imageId) ?? null : null;

  useEffect(() => {
    const size = selectionPixelSize(
      session,
      workspace.texture.activeImageId,
      workspace.texture.activeUvLayerId,
    );
    if (!size) return;
    setResizeW(size.w);
    setResizeH(size.h);
  }, [
    session,
    workspace.texture.activeImageId,
    workspace.texture.activeUvLayerId,
    tex.uvEditMode,
  ]);

  const setTab = (next: UvPanelTab) => {
    workspace.patchTexture({ uvPanelTab: next, ...(next === 'tiles' ? { atlasPanelOpen: true } : {}) });
    if (next === 'paint') {
      workspace.patchTexture({
        uvPointerMode: false,
        paintMode3D: tex.paintMode3D,
        activeRightEditor: tex.activeRightEditor === 'uv' ? 'combined' : tex.activeRightEditor,
      });
    } else if (next === 'edit' || next === 'tiles') {
      onArmUv({ uvPanelTab: next });
    }
  };

  const setWorkspaceMode = (mode: RightEditorMode) => {
    workspace.patchTexture({
      activeRightEditor: mode,
      uvPointerMode: mode === 'uv' ? true : mode === 'pixel' ? false : tex.uvPointerMode,
      uvPanelTab: mode === 'pixel' ? 'paint' : mode === 'uv' ? 'edit' : tex.uvPanelTab,
    });
  };

  const bumpPaint = () => {
    session.document.dirty = true;
    session.requestRedraw();
    onRefresh?.();
  };

  const runPaintStack = (image: ImageAsset, name: string, mutate: () => boolean) => {
    const before = clonePaintStack(image);
    if (!mutate()) return;
    const after = clonePaintStack(image);
    let applied = true;
    session.history.execute({
      name,
      execute: () => {
        if (applied) return;
        applyPaintStack(image, after);
        applied = true;
        bumpPaint();
      },
      undo: () => {
        applyPaintStack(image, before);
        applied = false;
        bumpPaint();
      },
    });
    bumpPaint();
  };

  const updateCustomPalette = (next: typeof activePalette) => {
    workspace.patchTexture({
      customPalettes: tex.customPalettes.map((palette) => (palette.id === next.id ? next : palette)),
      activePaletteId: next.id,
    });
  };

  const setInspectorOpen = (open: boolean) => {
    workspace.patchTexture({ uvInspectorOpen: open });
  };

  if (!embedded && !tex.uvInspectorOpen) {
    return (
      <aside className="uv-side-panel is-collapsed" aria-label="UV inspector (hidden)">
        <div className="sidebar-dock-header">
          <button
            type="button"
            className="sidebar-dock-action-btn"
            onClick={() => setInspectorOpen(true)}
            title="Show inspector (N)"
            aria-label="Show inspector"
          >
            <BlenderIcon name="tria_left_bar" size={15} />
          </button>
        </div>
        <div
          className="sidebar-dock-label-strip"
          onClick={() => setInspectorOpen(true)}
          title="Show inspector (N)"
          role="button"
          tabIndex={0}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              setInspectorOpen(true);
            }
          }}
        >
          <span className="edge-btn-label">INSPECTOR</span>
        </div>
      </aside>
    );
  }

  return (
    <aside className="uv-side-panel" aria-label="UV and pixel inspector">
      <header className="uv-panel-header">
        <div className="uv-panel-header-top">
          <div className="uv-panel-title">
            <span className="uv-panel-kicker">Inspector</span>
            <div className="uv-panel-heading-row">
              <strong>UV / Pixel</strong>
              <span className={`uv-panel-mode${uvPointerActive ? ' is-uv' : ' is-paint'}`}>
                {uvPointerActive ? 'UV EDIT' : 'PAINT'}
              </span>
            </div>
          </div>
          {!embedded && (
            <button
              type="button"
              className="uv-panel-collapse"
              onClick={() => setInspectorOpen(false)}
              title="Hide inspector (N)"
              aria-label="Hide inspector"
            >
              <BlenderIcon name="tria_right_bar" size={15} />
            </button>
          )}
        </div>
      </header>

      <nav className="uv-panel-tabs" aria-label="Inspector tabs">
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

      <div className="uv-panel-body">
        {tab === 'edit' && (
          <>
            <section className="uv-section">
              <h3 className="uv-section-title">Selection</h3>
              <button type="button" className="tool uv-btn-block" onClick={onSelectAll}>
                Select all points
              </button>
              <button
                type="button"
                className="tool primary uv-btn-block"
                disabled={!session.selection.state.selectedFaceIds.size}
                onClick={onFocusSelectedFace}
              >
                Edit selected 3D face
              </button>
              <label className="uv-check">
                <input
                  type="checkbox"
                  checked={tex.uvSelectionSync !== 'off'}
                  onChange={(event) => workspace.patchTexture({ uvSelectionSync: event.target.checked ? 'face' : 'off' })}
                />
                Follow 3D face selection
              </label>
              <label className="uv-check">
                <input
                  type="checkbox"
                  checked={tex.uvAutoFrame3dSelection}
                  onChange={(event) => workspace.patchTexture({ uvAutoFrame3dSelection: event.target.checked })}
                />
                Frame newly picked 3D face
              </label>
              <p className="uv-meta">{selectionSummary ?? 'Nothing selected'}</p>
              <p className="uv-hint">
                Click faces in 3D or UV · Ctrl+drag box (right=inside, left=crossing) · Shift adds ·
                Esc clears · double-click expands island
              </p>
            </section>

            <section className="uv-section">
              <h3 className="uv-section-title">Size</h3>
              <div className="material-size-row">
                <label className="uv-field">
                  <span>Width px</span>
                  <input
                    className="uv-text"
                    type="number"
                    min={1}
                    max={4096}
                    disabled={!hasUvSelection}
                    aria-label="Selection width in pixels"
                    value={resizeW}
                    onChange={(e) => setResizeW(Math.max(1, Math.round(Number(e.target.value) || 1)))}
                  />
                </label>
                <label className="uv-field">
                  <span>Height px</span>
                  <input
                    className="uv-text"
                    type="number"
                    min={1}
                    max={4096}
                    disabled={!hasUvSelection}
                    aria-label="Selection height in pixels"
                    value={resizeH}
                    onChange={(e) => setResizeH(Math.max(1, Math.round(Number(e.target.value) || 1)))}
                  />
                </label>
              </div>
              <button
                type="button"
                className="tool primary uv-btn-block"
                disabled={!hasUvSelection}
                onClick={() => {
                  onArmUv({ uvPanelTab: 'edit' });
                  onResizePixels(resizeW, resizeH);
                }}
              >
                Apply size
              </button>
              <div className="uv-btn-grid uv-btn-grid-2">
                <button
                  type="button"
                  className="tool"
                  disabled={!hasUvSelection}
                  onClick={() => {
                    onArmUv({ uvPanelTab: 'edit' });
                    onScaleFactor(2);
                  }}
                >
                  ×2
                </button>
                <button
                  type="button"
                  className="tool"
                  disabled={!hasUvSelection}
                  onClick={() => {
                    onArmUv({ uvPanelTab: 'edit' });
                    onScaleFactor(0.5);
                  }}
                >
                  ÷2
                </button>
                <button type="button" className="tool" disabled={!hasUvSelection} onClick={() => onRotate(90)}>
                  +90°
                </button>
                <button type="button" className="tool" disabled={!hasUvSelection} onClick={() => onRotate(-90)}>
                  −90°
                </button>
                <button type="button" className="tool" disabled={!hasUvSelection} onClick={() => onFlip('u')}>
                  Flip U
                </button>
                <button type="button" className="tool" disabled={!hasUvSelection} onClick={() => onFlip('v')}>
                  Flip V
                </button>
              </div>
              <p className="uv-hint">
                Yellow handles resize · blue rotates · G/S/R on the canvas
              </p>
            </section>

            <section className="uv-section">
              <h3 className="uv-section-title">Unwrap</h3>
              <div className="uv-btn-grid uv-btn-grid-3">
                <button
                  type="button"
                  className="tool"
                  title="Per-face Auto UV · keeps world size, then packs"
                  onClick={() => onUnwrap('auto')}
                >
                  Auto
                </button>
                <button
                  type="button"
                  className="tool"
                  title="Angle-based unwrap · keeps smooth faces together and splits sharp turns"
                  onClick={() => onUnwrap('angle')}
                >
                  Angle
                </button>
                <button
                  type="button"
                  className="tool"
                  title="Box UV · Minecraft-style cube net"
                  onClick={() => onUnwrap('box')}
                >
                  Box
                </button>
                <button
                  type="button"
                  className="tool"
                  title="Cubic · project by face normal onto ±X/Y/Z"
                  onClick={() => onUnwrap('cubic')}
                >
                  Cubic
                </button>
                <button
                  type="button"
                  className="tool"
                  title="Cylindrical unwrap around longest axis"
                  onClick={() => onUnwrap('cylinder')}
                >
                  Cylinder
                </button>
                <button
                  type="button"
                  className="tool"
                  title="Spherical lat/long unwrap"
                  onClick={() => onUnwrap('sphere')}
                >
                  Sphere
                </button>
                <button
                  type="button"
                  className="tool"
                  title="Project from active 3D view"
                  onClick={() => onUnwrap('view')}
                >
                  View
                </button>
              </div>
              <div className="uv-btn-grid uv-btn-grid-3">
                <button
                  type="button"
                  className="tool"
                  title="Simple planar project per face"
                  onClick={() => onUnwrap('planar')}
                >
                  Planar
                </button>
                <button type="button" className="tool" onClick={onPack}>
                  Pack
                </button>
                <button type="button" className="tool" disabled={!hasUvSelection} onClick={onNormalize}>
                  Fit
                </button>
              </div>
              <p className="uv-hint">
                Select faces in either view, then unwrap. Angle keeps smooth faces together and cuts at 66° turns; Box ≈ entity net.
              </p>
            </section>

            <section className="uv-section">
              <h3 className="uv-section-title">Topology</h3>
              <div className="uv-btn-grid uv-btn-grid-2">
                <button type="button" className="tool" disabled={!hasUvSelection} onClick={onWeld}>
                  Weld
                </button>
                <button type="button" className="tool" disabled={!hasUvSelection} onClick={onSplit}>
                  Split
                </button>
                <button type="button" className="tool" disabled={!hasUvSelection} onClick={onStraighten}>
                  Straighten
                </button>
                <button type="button" className="tool" disabled={!hasUvSelection} onClick={onRelax}>
                  Relax
                </button>
                <button type="button" className="tool" disabled={!hasUvSelection} onClick={onRotateToEdge}>
                  Edge → U
                </button>
                <button
                  type="button"
                  className="tool"
                  disabled={!session.selection.state.selectedFaceIds.size}
                  title="Reverse the winding and normals of selected faces"
                  onClick={onFlipFaces}
                >
                  Flip faces
                </button>
                <button
                  type="button"
                  className="tool"
                  disabled={edgeCount === 0}
                  onClick={() => onToggleSeams(true)}
                >
                  Mark seam
                </button>
                <button
                  type="button"
                  className="tool"
                  disabled={edgeCount === 0}
                  onClick={() => onToggleSeams(false)}
                >
                  Clear seam
                </button>
              </div>
              <div className="uv-btn-grid uv-btn-grid-2">
                <button
                  type="button"
                  className={`tool${tex.seamPaintMode === 'mark' ? ' is-active' : ''}`}
                  onClick={() => workspace.patchTexture({
                    seamPaintMode: tex.seamPaintMode === 'mark' ? 'off' : 'mark',
                    paintMode3D: false,
                    uvPointerMode: true,
                  })}
                >
                  Paint seams
                </button>
                <button
                  type="button"
                  className={`tool${tex.seamPaintMode === 'clear' ? ' is-active' : ''}`}
                  onClick={() => workspace.patchTexture({
                    seamPaintMode: tex.seamPaintMode === 'clear' ? 'off' : 'clear',
                    paintMode3D: false,
                    uvPointerMode: true,
                  })}
                >
                  Erase seams
                </button>
              </div>
              <p className="uv-hint">
                {edgeCount
                  ? `${edgeCount} edge${edgeCount === 1 ? '' : 's'} for seams`
                  : 'Select 3D edges to mark seams'}
              </p>
            </section>
          </>
        )}

        {tab === 'paint' && (
          <>
            <section className="uv-section uv-paint-section uv-workspace-tools">
              <h3 className="uv-section-title">UV workspace</h3>
              <div className="uv-workspace-tool-grid" role="toolbar" aria-label="UV workspace tools">
                <button
                  type="button"
                  className="uv-workspace-tool"
                  title="Select UV faces, points, or islands"
                  onClick={() => {
                    workspace.patchTexture({ uvPanelTab: 'edit' });
                    onArmUv({ uvEditMode: 'face', uvTransformTool: 'move', uvPanelTab: 'edit' });
                  }}
                >
                  <BlenderIcon name="face_select" size={15} />
                  <span>Select UVs</span>
                </button>
                <button
                  type="button"
                  className="uv-workspace-tool"
                  title="Move the current UV selection"
                  onClick={() => {
                    workspace.patchTexture({ uvPanelTab: 'edit' });
                    onArmUv({ uvTransformTool: 'move', uvPanelTab: 'edit' });
                  }}
                >
                  <BlenderIcon name="empty_arrows" size={15} />
                  <span>Move UVs</span>
                </button>
                <button
                  type="button"
                  className="uv-workspace-tool"
                  title="Frame the selected UVs"
                  onClick={onFrame}
                >
                  <BlenderIcon name="view_selected" size={15} />
                  <span>Frame</span>
                </button>
              </div>
              <p className="uv-hint">Select in 3D or UV view · Shift adds · Ctrl/Cmd-drag boxes · MMB or Alt-drag pans</p>
            </section>
            <section className="uv-section uv-paint-section">
              <div className="uv-section-header-row">
                <h3 className="uv-section-title">Texture tools</h3>
                <span className="uv-section-badge">B · E · I · F</span>
              </div>
              <div className="uv-paint-tool-grid" role="toolbar" aria-label="Paint tools">
                {PIXEL_TOOLS.map((tool) => (
                  <button
                    key={tool}
                    type="button"
                    className={`uv-paint-tool${tex.pixelTool === tool ? ' is-active' : ''}`}
                    title={`${PIXEL_TOOL_LABELS[tool]} (${PIXEL_TOOL_HOTKEYS[tool]})`}
                    aria-label={`${PIXEL_TOOL_LABELS[tool]} (${PIXEL_TOOL_HOTKEYS[tool]})`}
                    aria-pressed={tex.pixelTool === tool}
                    onClick={() =>
                      workspace.patchTexture({
                        pixelTool: tool,
                        uvPointerMode: false,
                        paintMode3D: !['line', 'rectangle', 'ellipse', 'replace'].includes(tool),
                        activeRightEditor: tex.activeRightEditor === 'uv' ? 'combined' : tex.activeRightEditor,
                        uvPanelTab: 'paint',
                      })
                    }
                  >
                    <BlenderIcon name={PIXEL_TOOL_ICONS[tool]} size={15} />
                    <span>{PIXEL_TOOL_LABELS[tool]}</span>
                  </button>
                ))}
              </div>
              <div className="uv-paint-mode-row">
                <button
                  type="button"
                  className={`uv-chip${tex.paintMode3D ? ' is-active' : ''}`}
                  aria-pressed={tex.paintMode3D}
                  title="Paint on the 3D mesh"
                  onClick={() => workspace.patchTexture({ paintMode3D: !tex.paintMode3D })}
                >
                  <BlenderIcon name="view3d" size={13} />
                  3D
                </button>
                <button
                  type="button"
                  className={`uv-chip${tex.paintMirrorX ? ' is-active' : ''}`}
                  aria-pressed={tex.paintMirrorX}
                  title="Mirror paint across X"
                  onClick={() => workspace.patchTexture({ paintMirrorX: !tex.paintMirrorX })}
                >
                  <BlenderIcon name="mod_mirror" size={13} />
                  X
                </button>
                <button
                  type="button"
                  className={`uv-chip${tex.paintMirrorY ? ' is-active' : ''}`}
                  aria-pressed={tex.paintMirrorY}
                  title="Mirror paint across Y"
                  onClick={() => workspace.patchTexture({ paintMirrorY: !tex.paintMirrorY })}
                >
                  <BlenderIcon name="mod_mirror" size={13} />
                  Y
                </button>
              </div>
              <p className="uv-hint">
                {tex.pixelTool === 'fill'
                  ? 'Click to fill · RMB uses background'
                  : tex.pixelTool === 'eyedropper'
                    ? 'Click the canvas or mesh to pick a colour'
                    : tex.pixelTool === 'line' || tex.pixelTool === 'rectangle' || tex.pixelTool === 'ellipse'
                      ? 'Drag on the canvas · RMB uses background'
                      : tex.pixelTool === 'replace'
                        ? 'Click a colour to replace it · RMB uses background'
                        : 'LMB foreground · RMB background · Alt picks 3D background'}
              </p>
              {(tex.pixelTool === 'fill' || tex.pixelTool === 'replace') && (
                <div className="paint-fill-options">
                  <label className="uv-slider-row">
                    <span>Tolerance</span>
                    <input
                      className="uv-range"
                      type="range"
                      min={0}
                      max={255}
                      value={tex.fillTolerance}
                      onChange={(e) => workspace.patchTexture({ fillTolerance: Number(e.target.value) })}
                    />
                    <span className="uv-field-value">{tex.fillTolerance}</span>
                  </label>
                  <label className="uv-check">
                    <input
                      type="checkbox"
                      checked={tex.fillContiguous}
                      onChange={(e) => workspace.patchTexture({ fillContiguous: e.target.checked })}
                    />
                    Contiguous
                  </label>
                </div>
              )}
            </section>

            <section className="uv-section uv-paint-section">
              <div className="uv-section-header-row">
                <h3 className="uv-section-title">Colour & Shading</h3>
                <select
                  className="uv-palette-select"
                  value={activePalette.id}
                  onChange={(e) => workspace.patchTexture({ activePaletteId: e.target.value })}
                  title="Select colour palette"
                  aria-label="Colour palette"
                >
                  {paletteGroups(tex.customPalettes).map((group) => (
                    <optgroup key={group} label={group}>
                      {palettes.filter((palette) => palette.group === group).map((palette) => (
                        <option key={palette.id} value={palette.id}>
                          {palette.name} ({palette.colors.length})
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </div>

              <div className="uv-paint-colors">
                <label className="uv-paint-swatch" title="Foreground colour">
                  <span
                    className="uv-paint-swatch-chip"
                    style={{ backgroundColor: rgbaToHex(tex.foreground) }}
                  />
                  <input
                    type="color"
                    value={rgbaToHex(tex.foreground)}
                    onChange={(e) =>
                      workspace.patchTexture({
                        foreground: hexToRgba(e.target.value, tex.foreground[3]),
                      })
                    }
                  />
                  <span className="uv-paint-swatch-meta">
                    <strong>FG</strong>
                    <em>{rgbaToHex(tex.foreground)}</em>
                  </span>
                </label>
                <div className="uv-paint-color-actions">
                  <button
                    type="button"
                    className="uv-icon-btn"
                    title="Swap foreground and background (X)"
                    aria-label="Swap colours"
                    onClick={() =>
                      workspace.patchTexture({
                        foreground: tex.background,
                        background: tex.foreground,
                      })
                    }
                  >
                    <BlenderIcon name="arrow_leftright" size={14} />
                  </button>
                  <button
                    type="button"
                    className="uv-icon-btn"
                    title="Shade darker / cooler ([)"
                    aria-label="Shade darker"
                    onClick={() =>
                      workspace.patchTexture({
                        foreground: shiftShadeColor(tex.foreground, 'darker'),
                      })
                    }
                  >
                    <BlenderIcon name="sort_down" size={14} />
                  </button>
                  <button
                    type="button"
                    className="uv-icon-btn"
                    title="Shade lighter / warmer (])"
                    aria-label="Shade lighter"
                    onClick={() =>
                      workspace.patchTexture({
                        foreground: shiftShadeColor(tex.foreground, 'lighter'),
                      })
                    }
                  >
                    <BlenderIcon name="sort_up" size={14} />
                  </button>
                  <button
                    type="button"
                    className="uv-icon-btn"
                    title="Reset to black and white (D)"
                    aria-label="Reset colours"
                    onClick={() =>
                      workspace.patchTexture({
                        foreground: [0, 0, 0, 255],
                        background: [255, 255, 255, 255],
                      })
                    }
                  >
                    <BlenderIcon name="file_refresh" size={14} />
                  </button>
                </div>
                <label className="uv-paint-swatch" title="Background colour">
                  <span
                    className="uv-paint-swatch-chip"
                    style={{
                      backgroundColor: rgbaToHex([tex.background[0], tex.background[1], tex.background[2], 255]),
                    }}
                  />
                  <input
                    type="color"
                    value={rgbaToHex([tex.background[0], tex.background[1], tex.background[2], 255])}
                    onChange={(e) =>
                      workspace.patchTexture({
                        background: hexToRgba(e.target.value, tex.background[3]),
                      })
                    }
                  />
                  <span className="uv-paint-swatch-meta">
                    <strong>BG</strong>
                    <em>{rgbaToHex([tex.background[0], tex.background[1], tex.background[2], 255])}</em>
                  </span>
                </label>
              </div>

              <div className="uv-palette-grid" role="group" aria-label="Colour palette">
                {activePalette.colors.map((colour, index) => {
                  const fgHex = rgbaToHex(tex.foreground).toLowerCase();
                  const bgHex = rgbaToHex(tex.background).toLowerCase();
                  const curHex = colour.toLowerCase();
                  const isFg = fgHex === curHex;
                  const isBg = bgHex === curHex;
                  return (
                    <button
                      key={`${colour}-${index}`}
                      type="button"
                      className={`uv-palette-cell${isFg ? ' is-fg' : ''}${isBg ? ' is-bg' : ''}`}
                      style={{ backgroundColor: colour }}
                      title={`${colour} · LMB foreground · RMB background${activePalette.custom ? ' · Shift+click remove' : ''}`}
                      aria-label={`${colour} (LMB: FG, RMB: BG)`}
                      onClick={(event) => {
                        if (event.shiftKey && activePalette.custom && activePalette.colors.length > 1) {
                          updateCustomPalette({
                            ...activePalette,
                            colors: activePalette.colors.filter((_, i) => i !== index),
                          });
                          return;
                        }
                        workspace.patchTexture({
                          foreground: hexToRgba(colour, tex.foreground[3]),
                        });
                      }}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        workspace.patchTexture({
                          background: hexToRgba(colour, tex.background[3]),
                        });
                      }}
                    />
                  );
                })}
              </div>
              <div className="uv-palette-actions">
                <button
                  type="button"
                  className="tool"
                  onClick={() => {
                    const created = createCustomPalette(
                      `${activePalette.name} copy`,
                      activePalette.colors,
                    );
                    workspace.patchTexture({
                      customPalettes: [...tex.customPalettes, created],
                      activePaletteId: created.id,
                    });
                  }}
                >
                  New
                </button>
                {activePalette.custom && (
                  <>
                    <input
                      className="uv-text uv-palette-name"
                      aria-label="Palette name"
                      value={activePalette.name}
                      onChange={(event) =>
                        updateCustomPalette({ ...activePalette, name: event.target.value })
                      }
                    />
                    <button
                      type="button"
                      className="tool"
                      title="Add foreground colour"
                      onClick={() => {
                        const hex = clampPaletteColor(rgbaToHex(tex.foreground));
                        if (!hex || activePalette.colors.includes(hex)) return;
                        updateCustomPalette({
                          ...activePalette,
                          colors: [...activePalette.colors, hex],
                        });
                      }}
                    >
                      Add FG
                    </button>
                    <button
                      type="button"
                      className="tool"
                      onClick={() => {
                        const remaining = tex.customPalettes.filter((palette) => palette.id !== activePalette.id);
                        workspace.patchTexture({
                          customPalettes: remaining,
                          activePaletteId: remaining[0]?.id ?? 'pico8',
                        });
                      }}
                    >
                      Delete
                    </button>
                  </>
                )}
              </div>
              {activePalette.custom && (
                <p className="uv-hint">Add FG to grow the palette. Shift-click a swatch to remove it.</p>
              )}
            </section>

            <section className="uv-section uv-paint-section">
              <div className="uv-section-header-row">
                <h3 className="uv-section-title">Brush</h3>
                <span className="uv-section-badge">{tex.brushSize}px · {tex.brushShape}</span>
              </div>
              <div className="uv-brush-preset-row">
                {BRUSH_SIZE_PRESETS.map((sz) => (
                  <button
                    key={sz}
                    type="button"
                    className={`uv-preset-btn${tex.brushSize === sz ? ' is-active' : ''}`}
                    onClick={() => workspace.patchTexture({ brushSize: sz })}
                    title={`${sz}px brush`}
                  >
                    {sz}
                  </button>
                ))}
              </div>
              <label className="uv-slider-row">
                <span>Size</span>
                <input
                  className="uv-range"
                  type="range"
                  min={1}
                  max={64}
                  value={tex.brushSize}
                  onChange={(e) => workspace.patchTexture({ brushSize: Number(e.target.value) })}
                />
                <span className="uv-field-value">{tex.brushSize}px</span>
              </label>
              <label className="uv-slider-row">
                <span>Opacity</span>
                <input
                  className="uv-range"
                  type="range"
                  min={1}
                  max={100}
                  value={Math.max(1, Math.round((tex.foreground[3] / 255) * 100))}
                  onChange={(e) => {
                    const alpha = Math.round((Number(e.target.value) / 100) * 255);
                    workspace.patchTexture({
                      foreground: [tex.foreground[0], tex.foreground[1], tex.foreground[2], alpha],
                    });
                  }}
                />
                <span className="uv-field-value">
                  {Math.max(1, Math.round((tex.foreground[3] / 255) * 100))}%
                </span>
              </label>
              <div className="uv-segmented" role="group" aria-label="Brush shape">
                <button
                  type="button"
                  className={tex.brushShape === 'square' ? 'is-active' : ''}
                  onClick={() => workspace.patchTexture({ brushShape: 'square' })}
                  title="Square brush (C)"
                >
                  Square
                </button>
                <button
                  type="button"
                  className={tex.brushShape === 'circle' ? 'is-active' : ''}
                  onClick={() => workspace.patchTexture({ brushShape: 'circle' })}
                  title="Circle brush (C)"
                >
                  Circle
                </button>
              </div>

              <div className="uv-section-header-row" style={{ marginTop: '6px' }}>
                <span className="uv-field-label" style={{ fontSize: '0.64rem', color: '#aaa' }}>Dither Pattern</span>
                <span className="uv-section-badge">{tex.ditherMode}</span>
              </div>
              <div className="uv-segmented" role="group" aria-label="Dither pattern">
                {DITHER_MODES.map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    className={tex.ditherMode === mode ? 'is-active' : ''}
                    onClick={() => workspace.patchTexture({ ditherMode: mode })}
                    title={`Dither: ${mode}`}
                  >
                    {mode === 'none' ? 'Off' : mode === 'checker' ? 'Checker' : 'Bayer 4×4'}
                  </button>
                ))}
              </div>
              <label className="uv-check" style={{ marginTop: '4px' }}>
                <input
                  type="checkbox"
                  checked={tex.recolorOnlyBg}
                  onChange={(e) => workspace.patchTexture({ recolorOnlyBg: e.target.checked })}
                />
                Recolor mode (replaces BG only)
              </label>
            </section>

            <section className="uv-section uv-paint-section">
              <div className="uv-section-header-row">
                <h3 className="uv-section-title">Layers</h3>
                <span className="uv-section-badge">{paintImage?.paintLayers?.length ?? 1}</span>
              </div>
              {!paintImage ? (
                <p className="uv-hint">Select a textured object to edit paint layers.</p>
              ) : (
                <>
                  <div className="uv-layer-list" role="listbox" aria-label="Paint layers">
                    {[...(paintImage.paintLayers ?? [{
                      id: paintImage.id,
                      name: 'Background',
                      visible: true,
                      opacity: 1,
                      locked: false,
                    }])].reverse().map((layer) => {
                      const active = (paintImage.activePaintLayerId ?? paintImage.id) === layer.id;
                      return (
                        <div
                          key={layer.id}
                          className={`uv-layer-row${active ? ' is-active' : ''}`}
                          role="option"
                          aria-selected={active}
                          onClick={() => {
                            if (!paintImage.paintLayers) return;
                            setActivePaintLayer(paintImage, layer.id);
                            bumpPaint();
                          }}
                        >
                          <button
                            type="button"
                            className={`uv-layer-icon${layer.visible ? ' is-on' : ''}`}
                            title={layer.visible ? 'Hide layer' : 'Show layer'}
                            disabled={!paintImage.paintLayers}
                            onClick={(event) => {
                              event.stopPropagation();
                              if (!paintImage.paintLayers) return;
                              runPaintStack(paintImage, layer.visible ? 'Hide Layer' : 'Show Layer', () =>
                                patchPaintLayer(paintImage, layer.id, { visible: !layer.visible }),
                              );
                            }}
                          >
                            <BlenderIcon name={layer.visible ? 'hide_off' : 'hide_on'} size={12} />
                          </button>
                          <button
                            type="button"
                            className={`uv-layer-icon${layer.locked ? ' is-on' : ''}`}
                            title={layer.locked ? 'Unlock layer' : 'Lock layer'}
                            disabled={!paintImage.paintLayers}
                            onClick={(event) => {
                              event.stopPropagation();
                              if (!paintImage.paintLayers) return;
                              runPaintStack(paintImage, layer.locked ? 'Unlock Layer' : 'Lock Layer', () =>
                                patchPaintLayer(paintImage, layer.id, { locked: !layer.locked }),
                              );
                            }}
                          >
                            <BlenderIcon name={layer.locked ? 'locked' : 'unlocked'} size={12} />
                          </button>
                          <span className="uv-layer-name">{layer.name}</span>
                        </div>
                      );
                    })}
                  </div>
                  {paintImage.paintLayers && (
                    <label className="uv-slider-row">
                      <span>Opacity</span>
                      <input
                        className="uv-range"
                        type="range"
                        min={0}
                        max={100}
                        value={Math.round((paintImage.paintLayers.find((layer) => layer.id === paintImage.activePaintLayerId)?.opacity ?? 1) * 100)}
                        onChange={(event) => {
                          const layerId = paintImage.activePaintLayerId;
                          if (!layerId) return;
                          patchPaintLayer(paintImage, layerId, { opacity: Number(event.target.value) / 100 });
                          bumpPaint();
                        }}
                      />
                    </label>
                  )}
                  <div className="uv-palette-actions">
                    <button
                      type="button"
                      className="tool"
                      onClick={() => runPaintStack(paintImage, 'Add Paint Layer', () => {
                        addPaintLayer(paintImage);
                        return true;
                      })}
                    >
                      Add
                    </button>
                    <button
                      type="button"
                      className="tool"
                      disabled={!paintImage.paintLayers || !paintImage.activePaintLayerId}
                      onClick={() => {
                        const id = paintImage.activePaintLayerId;
                        if (!id) return;
                        runPaintStack(paintImage, 'Duplicate Paint Layer', () => !!duplicatePaintLayer(paintImage, id));
                      }}
                    >
                      Dup
                    </button>
                    <button
                      type="button"
                      className="tool"
                      disabled={!paintImage.paintLayers || (paintImage.paintLayers.length ?? 0) <= 1}
                      onClick={() => {
                        const id = paintImage.activePaintLayerId;
                        if (!id) return;
                        runPaintStack(paintImage, 'Delete Paint Layer', () => removePaintLayer(paintImage, id));
                      }}
                    >
                      Del
                    </button>
                    <button
                      type="button"
                      className="tool"
                      disabled={!paintImage.paintLayers}
                      onClick={() => {
                        const id = paintImage.activePaintLayerId;
                        if (!id) return;
                        runPaintStack(paintImage, 'Raise Paint Layer', () => movePaintLayer(paintImage, id, 1));
                      }}
                    >
                      Up
                    </button>
                    <button
                      type="button"
                      className="tool"
                      disabled={!paintImage.paintLayers}
                      onClick={() => {
                        const id = paintImage.activePaintLayerId;
                        if (!id) return;
                        runPaintStack(paintImage, 'Lower Paint Layer', () => movePaintLayer(paintImage, id, -1));
                      }}
                    >
                      Down
                    </button>
                  </div>
                </>
              )}
            </section>
          </>
        )}

        {tab === 'tiles' && (
          <section className="uv-section tile-panel-launcher">
            <h3 className="uv-section-title">Tile Palette</h3>
            <p className="uv-hint">The atlas board and 3D tile tools now open in a movable window so they stay visible while you work.</p>
            <button type="button" className="tool primary uv-btn-block" onClick={() => workspace.patchTexture({ atlasPanelOpen: true, atlasPanelMinimized: false })}>
              {tex.atlasPanelOpen ? 'Show Tile Palette' : 'Open Tile Palette'}
            </button>
          </section>
        )}

        {tab === 'material' && <MaterialEditor session={session} workspace={workspace} compact />}

        {tab === 'view' && (
          <>
            <section className="uv-section">
              <h3 className="uv-section-title">Workspace</h3>
              <label className="uv-field">
                <span>Canvas</span>
                <select
                  className="uv-select"
                  aria-label="Workspace mode"
                  value={tex.activeRightEditor}
                  onChange={(e) => setWorkspaceMode(e.target.value as RightEditorMode)}
                >
                  <option value="combined">UV + Paint</option>
                  <option value="uv">UV only</option>
                  <option value="pixel">Paint only</option>
                </select>
              </label>
            </section>
            <section className="uv-section">
              <h3 className="uv-section-title">Display</h3>
              <label className="uv-check">
                <input
                  type="checkbox"
                  checked={tex.showUvOverlay}
                  onChange={(e) => workspace.patchTexture({ showUvOverlay: e.target.checked })}
                />
                UV overlay
              </label>
              <label className="uv-check">
                <input
                  type="checkbox"
                  checked={tex.showUvGrid}
                  onChange={(e) => workspace.patchTexture({ showUvGrid: e.target.checked })}
                />
                16×16 UV guide
              </label>
              <label className="uv-check">
                <input
                  type="checkbox"
                  checked={tex.showPixelGrid}
                  onChange={(e) => workspace.patchTexture({ showPixelGrid: e.target.checked })}
                />
                Pixel grid
              </label>
              <label className="uv-check">
                <input
                  type="checkbox"
                  checked={tex.uvSnapToPixels}
                  onChange={(e) => workspace.patchTexture({ uvSnapToPixels: e.target.checked })}
                />
                Snap UV moves to pixels
              </label>
              <label className="uv-field">
                <span>UV diagnostics</span>
                <select
                  className="uv-select"
                  value={tex.uvDiagnosticMode}
                  onChange={(event) => workspace.patchTexture({
                    uvDiagnosticMode: event.target.value as 'off' | 'distortion' | 'density',
                  })}
                >
                  <option value="off">Off</option>
                  <option value="distortion">Distortion heatmap</option>
                  <option value="density">Texel-density heatmap</option>
                </select>
              </label>
              {uvDiagnostics && (
                <div className="uv-meta">
                  <div>{uvDiagnostics.averageDensity.toFixed(1)} px/unit average</div>
                  <div>{Math.round(uvDiagnostics.densityVariation * 100)}% density variation</div>
                  <div>{uvDiagnostics.maximumDistortion.toFixed(2)}× worst stretch</div>
                  <div>{uvDiagnostics.flippedFaces} flipped · {uvDiagnostics.degenerateFaces} degenerate</div>
                </div>
              )}
              <button type="button" className="tool uv-btn-block" onClick={onFrame}>
                Frame selection
              </button>
            </section>
            <section className="uv-section">
              <h3 className="uv-section-title">Asset</h3>
              <p className="uv-meta">{imageLabel ?? 'No active texture'}</p>
              <p className="uv-hint">
                Hover the window title for LightWave pan/zoom · ⧉ detaches a pane
              </p>
            </section>
          </>
        )}
      </div>
    </aside>
  );
}

export type AtlasTilePanelProps = {
  session: EditorSession;
  workspace: WorkspaceController;
  hasUvSelection: boolean;
  onApply: () => void;
  onCreatePlane: () => void;
  onCreateGrid: () => void;
  onPickTile: () => void;
  onToggleDraw: () => void;
  onEraseFaces: () => void;
  onFillConnected: () => void;
};

export function AtlasTilePanel({
  session,
  workspace,
  hasUvSelection,
  onApply,
  onCreatePlane,
  onCreateGrid,
  onPickTile,
  onToggleDraw,
  onEraseFaces,
  onFillConnected,
}: AtlasTilePanelProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const atlasViewportRef = useRef<HTMLDivElement>(null);
  const atlasPan = useRef<{ pointerId: number; startX: number; startY: number; panX: number; panY: number } | null>(null);
  const [atlasView, setAtlasView] = useState({ zoom: 1, panX: 8, panY: 8 });
  const [atlasPanMode, setAtlasPanMode] = useState(false);
  const [importBusy, setImportBusy] = useState(false);
  const [importNote, setImportNote] = useState<string | null>(null);
  const tex = workspace.texture;
  const image = tex.activeImageId ? session.document.images.get(tex.activeImageId) : null;
  const tileWidth = Math.min(image?.width ?? tex.atlasTileWidth, tex.atlasTileWidth);
  const tileHeight = Math.min(image?.height ?? tex.atlasTileHeight, tex.atlasTileHeight);
  const marginX = Math.max(0, tex.atlasMarginX);
  const marginY = Math.max(0, tex.atlasMarginY);
  const offsetX = Math.max(0, tex.atlasOffsetX);
  const offsetY = Math.max(0, tex.atlasOffsetY);
  const stepX = tileWidth + marginX;
  const stepY = tileHeight + marginY;
  const columns = image ? Math.max(1, Math.floor((image.width - offsetX + marginX) / stepX)) : 0;
  const rows = image ? Math.max(1, Math.floor((image.height - offsetY + marginY) / stepY)) : 0;
  const activeTexture = tex.activeTextureId ? session.document.textures.get(tex.activeTextureId) : null;
  const activeMaterial = tex.activeMaterialId ? session.document.materials.get(tex.activeMaterialId) : null;
  const tileDrawActive = session.tools.getActive()?.id === 'tile-draw';
  const applyGridPreset = (id: string) => {
    const preset = tex.atlasGridPresets.find((item) => item.id === id);
    if (!preset) return;
    workspace.patchTexture({
      activeAtlasGridPresetId: id,
      atlasTileWidth: preset.tileWidth,
      atlasTileHeight: preset.tileHeight,
      atlasMarginX: preset.marginX,
      atlasMarginY: preset.marginY,
      atlasOffsetX: preset.offsetX,
      atlasOffsetY: preset.offsetY,
      atlasPadding: preset.padding,
      atlasTileX: preset.offsetX,
      atlasTileY: preset.offsetY,
    });
  };
  const presetFromCurrent = (id: string, name: string) => ({
    id,
    name,
    tileWidth: tex.atlasTileWidth,
    tileHeight: tex.atlasTileHeight,
    marginX: tex.atlasMarginX,
    marginY: tex.atlasMarginY,
    offsetX: tex.atlasOffsetX,
    offsetY: tex.atlasOffsetY,
    padding: tex.atlasPadding,
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !image) return;
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext('2d');
    if (!context) return;
    context.imageSmoothingEnabled = false;
    context.putImageData(new ImageData(new Uint8ClampedArray(image.pixels), image.width, image.height), 0, 0);
    context.strokeStyle = 'rgba(180, 205, 235, 0.35)';
    context.lineWidth = Math.max(0.5, 1 / Math.max(1, image.width / 256));
    for (let x = offsetX; x <= image.width; x += stepX) {
      context.beginPath(); context.moveTo(x, 0); context.lineTo(x, image.height); context.stroke();
    }
    for (let y = offsetY; y <= image.height; y += stepY) {
      context.beginPath(); context.moveTo(0, y); context.lineTo(image.width, y); context.stroke();
    }
    context.strokeStyle = '#ff9b38';
    context.lineWidth = Math.max(1, 2 / Math.max(1, image.width / 256));
    context.strokeRect(
      tex.atlasTileX + context.lineWidth / 2,
      tex.atlasTileY + context.lineWidth / 2,
      tileWidth * tex.atlasSelectionColumns + marginX * (tex.atlasSelectionColumns - 1) - context.lineWidth,
      tileHeight * tex.atlasSelectionRows + marginY * (tex.atlasSelectionRows - 1) - context.lineWidth,
    );
  }, [image, marginX, marginY, offsetX, offsetY, stepX, stepY, tex.atlasSelectionColumns, tex.atlasSelectionRows, tex.atlasTileX, tex.atlasTileY, tileHeight, tileWidth]);

  const fitAtlas = () => {
    const viewport = atlasViewportRef.current;
    if (!viewport || !image) return;
    const zoom = Math.max(0.05, Math.min(16, Math.min((viewport.clientWidth - 16) / image.width, (viewport.clientHeight - 16) / image.height)));
    setAtlasView({
      zoom,
      panX: (viewport.clientWidth - image.width * zoom) / 2,
      panY: (viewport.clientHeight - image.height * zoom) / 2,
    });
  };

  useEffect(() => {
    if (!image) return;
    const frame = requestAnimationFrame(fitAtlas);
    return () => cancelAnimationFrame(frame);
    // Fit once for each atlas; later pan and zoom remain user-owned.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [image?.id]);

  const zoomAtlasAt = (clientX: number, clientY: number, factor: number) => {
    const viewport = atlasViewportRef.current;
    if (!viewport) return;
    const rect = viewport.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    setAtlasView((view) => {
      const zoom = Math.max(0.05, Math.min(32, view.zoom * factor));
      const imageX = (x - view.panX) / view.zoom;
      const imageY = (y - view.panY) / view.zoom;
      return { zoom, panX: x - imageX * zoom, panY: y - imageY * zoom };
    });
  };

  const zoomAtlasCentre = (factor: number) => {
    const viewport = atlasViewportRef.current;
    if (!viewport) return;
    const rect = viewport.getBoundingClientRect();
    zoomAtlasAt(rect.left + rect.width / 2, rect.top + rect.height / 2, factor);
  };

  useEffect(() => {
    const viewport = atlasViewportRef.current;
    if (!viewport) return;
    const consumeWheel = (event: WheelEvent) => {
      event.preventDefault();
      event.stopPropagation();
      const rect = viewport.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      const factor = event.deltaY < 0 ? 1.18 : 1 / 1.18;
      setAtlasView((view) => {
        const zoom = Math.max(0.05, Math.min(32, view.zoom * factor));
        const imageX = (x - view.panX) / view.zoom;
        const imageY = (y - view.panY) / view.zoom;
        return { zoom, panX: x - imageX * zoom, panY: y - imageY * zoom };
      });
    };
    viewport.addEventListener('wheel', consumeWheel, { passive: false });
    return () => viewport.removeEventListener('wheel', consumeWheel);
  }, [image?.id]);

  const selectTile = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!image) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const px = (event.clientX - rect.left - atlasView.panX) / atlasView.zoom;
    const py = (event.clientY - rect.top - atlasView.panY) / atlasView.zoom;
    if (px < 0 || py < 0 || px >= image.width || py >= image.height) return;
    workspace.patchTexture({
      atlasTileX: Math.min(image.width - tileWidth, Math.max(offsetX, offsetX + Math.floor(Math.max(0, px - offsetX) / stepX) * stepX)),
      atlasTileY: Math.min(image.height - tileHeight, Math.max(offsetY, offsetY + Math.floor(Math.max(0, py - offsetY) / stepY) * stepY)),
      uvPanelTab: 'tiles',
      uvPointerMode: true,
    });
    event.currentTarget.focus();
  };

  const moveTile = (dx: number, dy: number) => {
    if (!image) return;
    const nextX = Math.max(offsetX, Math.min(image.width - tileWidth, tex.atlasTileX + dx * stepX));
    const nextY = Math.max(offsetY, Math.min(image.height - tileHeight, tex.atlasTileY + dy * stepY));
    workspace.patchTexture({ atlasTileX: nextX, atlasTileY: nextY });
  };

  const importAtlasImage = async (file: File) => {
    const doc = session.document;
    const selection = session.selection.state;
    setImportBusy(true);
    setImportNote(null);
    try {
      const result = await importImageFile(doc, file);
      let materialId = tex.activeMaterialId ?? resolveActiveTexture(doc, selection).materialId;
      let material = materialId ? doc.materials.get(materialId) : null;
      if (!material) {
        const created = createMaterial(doc, {
          name: 'Atlas Material',
          assignToObjectId: selection.activeObjectId ?? undefined,
        });
        materialId = created.id;
        material = created;
      }
      const texture = doc.textures.get(result.textureId);
      if (texture) {
        texture.filtering = 'nearest';
        texture.wrapping = 'clamp';
        texture.generateMipmaps = false;
      }
      material.baseColourTextureId = result.textureId;
      material.textureFiltering = 'nearest';
      material.textureWrapping = 'clamp';
      material.presetId = null;
      workspace.patchTexture({
        activeImageId: result.imageId,
        activeTextureId: result.textureId,
        activeMaterialId: materialId,
        atlasTileX: tex.atlasOffsetX,
        atlasTileY: tex.atlasOffsetY,
      });
      doc.dirty = true;
      session.requestRedraw();
      setImportNote(
        result.scaled
          ? `Imported ${result.sourceWidth}×${result.sourceHeight} → ${result.width}×${result.height}`
          : `Imported ${result.width}×${result.height}`,
      );
    } catch (err) {
      setImportNote(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setImportBusy(false);
    }
  };

  const chooseAtlasImage = async () => {
    try {
      const selected = await openNativeFile({ types: IMAGE_FILES });
      if (selected) await importAtlasImage(selected.file);
    } catch (error) {
      setImportNote(error instanceof Error ? error.message : 'Could not open image');
    }
  };

  return (
    <>
      <section className="uv-section">
        <h3 className="uv-section-title">Sprite Atlas</h3>
        <label className="uv-field">
          <span>Grid preset</span>
          <select className="uv-select" value={tex.activeAtlasGridPresetId} onChange={(event) => applyGridPreset(event.target.value)}>
            {tex.atlasGridPresets.map((preset) => <option key={preset.id} value={preset.id}>{preset.name}</option>)}
          </select>
        </label>
        <label className="uv-field">
          <span>Preset name</span>
          <input
            className="uv-text"
            value={tex.atlasGridPresets.find((preset) => preset.id === tex.activeAtlasGridPresetId)?.name ?? ''}
            onChange={(event) => workspace.patchTexture({
              atlasGridPresets: tex.atlasGridPresets.map((preset) => preset.id === tex.activeAtlasGridPresetId ? { ...preset, name: event.target.value } : preset),
            })}
          />
        </label>
        <div className="uv-btn-grid uv-btn-grid-3">
          <button type="button" className="tool" onClick={() => {
            const active = tex.atlasGridPresets.find((preset) => preset.id === tex.activeAtlasGridPresetId);
            if (!active) return;
            workspace.patchTexture({ atlasGridPresets: tex.atlasGridPresets.map((preset) => preset.id === active.id ? presetFromCurrent(active.id, active.name) : preset) });
          }}>Update</button>
          <button type="button" className="tool" onClick={() => {
            const id = `atlas-grid-${Date.now()}`;
            const preset = presetFromCurrent(id, `Grid ${tex.atlasGridPresets.length + 1}`);
            workspace.patchTexture({ atlasGridPresets: [...tex.atlasGridPresets, preset], activeAtlasGridPresetId: id });
          }}>Duplicate</button>
          <button type="button" className="tool" disabled={tex.atlasGridPresets.length <= 1} onClick={() => {
            const remaining = tex.atlasGridPresets.filter((preset) => preset.id !== tex.activeAtlasGridPresetId);
            workspace.patchTexture({ atlasGridPresets: remaining });
            applyGridPreset(remaining[0]!.id);
          }}>Delete</button>
        </div>
        <button type="button" className="tool primary uv-btn-block" disabled={importBusy} onClick={chooseAtlasImage}>
          {importBusy ? 'Importing…' : image ? 'Replace atlas image…' : 'Import atlas image…'}
        </button>
        {importNote && <p className="uv-meta">{importNote}</p>}
        {image ? (
          <div className="atlas-navigator">
            <div className="atlas-navigator-toolbar">
              <button type="button" className={`tool${atlasPanMode ? ' is-active' : ''}`} onClick={() => setAtlasPanMode((value) => !value)}>Pan</button>
              <button type="button" className="tool" onClick={() => zoomAtlasCentre(1 / 1.25)}>−</button>
              <span>{Math.round(atlasView.zoom * 100)}%</span>
              <button type="button" className="tool" onClick={() => zoomAtlasCentre(1.25)}>+</button>
              <button type="button" className="tool" onClick={() => setAtlasView((view) => ({ zoom: 1, panX: view.panX, panY: view.panY }))}>1:1</button>
              <button type="button" className="tool" onClick={fitAtlas}>Fit</button>
            </div>
            <div
              ref={atlasViewportRef}
              className={`atlas-viewport${atlasPanMode ? ' is-panning' : ''}`}
              tabIndex={0}
              onPointerDown={(event) => {
                const wantsPan = event.button === 1 || (event.button === 0 && (event.altKey || atlasPanMode));
                if (!wantsPan) {
                  if (event.button === 0) selectTile(event);
                  return;
                }
                event.preventDefault();
                event.currentTarget.setPointerCapture(event.pointerId);
                atlasPan.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, panX: atlasView.panX, panY: atlasView.panY };
              }}
              onPointerMove={(event) => {
                const pan = atlasPan.current;
                if (!pan || pan.pointerId !== event.pointerId) return;
                setAtlasView((view) => ({ ...view, panX: pan.panX + event.clientX - pan.startX, panY: pan.panY + event.clientY - pan.startY }));
              }}
              onPointerUp={(event) => {
                if (atlasPan.current?.pointerId === event.pointerId) atlasPan.current = null;
              }}
              onPointerCancel={() => { atlasPan.current = null; }}
              onDoubleClick={(event) => { if (!atlasPanMode && !event.altKey) onApply(); }}
            onKeyDown={(event) => {
              if (event.key === 'ArrowLeft') moveTile(-1, 0);
              else if (event.key === 'ArrowRight') moveTile(1, 0);
              else if (event.key === 'ArrowUp') moveTile(0, -1);
              else if (event.key === 'ArrowDown') moveTile(0, 1);
              else if (event.key === 'Enter') onApply();
              else if (event.key === '0') fitAtlas();
              else if (event.key === '+' || event.key === '=') zoomAtlasCentre(1.25);
              else if (event.key === '-') zoomAtlasCentre(1 / 1.25);
              else return;
              event.preventDefault();
            }}
              title="Wheel zoom · MMB / Alt+drag pan · click tile · double-click apply"
            >
              <canvas
                ref={canvasRef}
                className="atlas-tile-canvas"
                style={{ transform: `translate(${atlasView.panX}px, ${atlasView.panY}px) scale(${atlasView.zoom})` }}
              />
            </div>
          </div>
        ) : <p className="uv-meta">Import an image to use as the sprite atlas, or add a texture via the Material tab.</p>}
        <p className="uv-meta">
          {image ? `${columns} × ${rows} tiles · selected ${Math.floor((tex.atlasTileX - offsetX) / stepX) + 1}, ${Math.floor((tex.atlasTileY - offsetY) / stepY) + 1} · wheel zoom · MMB / Alt drag pan` : 'No atlas'}
        </p>
      </section>
      <section className="uv-section">
        <h3 className="uv-section-title">Tile Grid</h3>
        <div className="uv-btn-grid uv-btn-grid-2">
          <label className="uv-field"><span>Tile width</span><input className="uv-text" type="number" min={1} max={image?.width ?? 4096} value={tex.atlasTileWidth} onChange={(event) => workspace.patchTexture({ atlasTileWidth: Math.min(image?.width ?? 4096, Math.max(1, Math.round(Number(event.target.value)))) })} /></label>
          <label className="uv-field"><span>Tile height</span><input className="uv-text" type="number" min={1} max={image?.height ?? 4096} value={tex.atlasTileHeight} onChange={(event) => workspace.patchTexture({ atlasTileHeight: Math.min(image?.height ?? 4096, Math.max(1, Math.round(Number(event.target.value)))) })} /></label>
        </div>
        <div className="uv-btn-grid uv-btn-grid-2">
          <label className="uv-field"><span>Selection wide</span><input className="uv-text" type="number" min={1} max={32} value={tex.atlasSelectionColumns} onChange={(event) => workspace.patchTexture({ atlasSelectionColumns: Math.max(1, Math.round(Number(event.target.value))) })} /></label>
          <label className="uv-field"><span>Selection high</span><input className="uv-text" type="number" min={1} max={32} value={tex.atlasSelectionRows} onChange={(event) => workspace.patchTexture({ atlasSelectionRows: Math.max(1, Math.round(Number(event.target.value))) })} /></label>
          <label className="uv-field"><span>Margin X</span><input className="uv-text" type="number" min={0} value={tex.atlasMarginX} onChange={(event) => workspace.patchTexture({ atlasMarginX: Math.max(0, Number(event.target.value)) })} /></label>
          <label className="uv-field"><span>Margin Y</span><input className="uv-text" type="number" min={0} value={tex.atlasMarginY} onChange={(event) => workspace.patchTexture({ atlasMarginY: Math.max(0, Number(event.target.value)) })} /></label>
          <label className="uv-field"><span>Offset X</span><input className="uv-text" type="number" min={0} value={tex.atlasOffsetX} onChange={(event) => workspace.patchTexture({ atlasOffsetX: Math.max(0, Number(event.target.value)) })} /></label>
          <label className="uv-field"><span>Offset Y</span><input className="uv-text" type="number" min={0} value={tex.atlasOffsetY} onChange={(event) => workspace.patchTexture({ atlasOffsetY: Math.max(0, Number(event.target.value)) })} /></label>
        </div>
        <label className="uv-field"><span>Inset pixels</span><input className="uv-text" type="number" min={0} step={0.25} value={tex.atlasPadding} onChange={(event) => workspace.patchTexture({ atlasPadding: Math.max(0, Number(event.target.value)) })} /></label>
        <div className="uv-btn-grid uv-btn-grid-2">
          <label className="uv-field"><span>Repeat U</span><input className="uv-text" type="number" min={1} max={64} value={tex.atlasRepeatU} onChange={(event) => workspace.patchTexture({ atlasRepeatU: Math.max(1, Math.min(64, Math.round(Number(event.target.value)))) })} /></label>
          <label className="uv-field"><span>Repeat V</span><input className="uv-text" type="number" min={1} max={64} value={tex.atlasRepeatV} onChange={(event) => workspace.patchTexture({ atlasRepeatV: Math.max(1, Math.min(64, Math.round(Number(event.target.value)))) })} /></label>
        </div>
        <div className="uv-btn-grid uv-btn-grid-3">
          <button type="button" className="tool" onClick={() => workspace.patchTexture({ atlasQuarterTurns: ((tex.atlasQuarterTurns + 3) % 4) as 0 | 1 | 2 | 3 })}>Rotate −90°</button>
          <button type="button" className={`tool${tex.atlasFlipU ? ' is-active' : ''}`} onClick={() => workspace.patchTexture({ atlasFlipU: !tex.atlasFlipU })}>Flip U</button>
          <button type="button" className={`tool${tex.atlasFlipV ? ' is-active' : ''}`} onClick={() => workspace.patchTexture({ atlasFlipV: !tex.atlasFlipV })}>Flip V</button>
        </div>
        <button type="button" className="tool primary uv-btn-block" disabled={!image || !hasUvSelection} onClick={onApply}>Apply Tile to Faces</button>
        <button type="button" className="tool uv-btn-block" disabled={!image || !session.selection.state.activeFaceId} onClick={onPickTile}>Pick Tile from Active Face</button>
        <div className="uv-btn-grid uv-btn-grid-2">
          <button type="button" className="tool" disabled={!session.selection.state.selectedFaceIds.size} onClick={onEraseFaces}>Erase Faces</button>
          <button type="button" className="tool" disabled={!session.selection.state.activeFaceId} onClick={onFillConnected}>Fill Connected</button>
        </div>
        <label className="uv-check"><input type="checkbox" checked={tex.atlasPaintMode} onChange={(event) => workspace.patchTexture({ atlasPaintMode: event.target.checked, uvPointerMode: true })} />Tile Brush on 3D faces</label>
        <label className="uv-check"><input type="checkbox" checked={tex.atlasAutoAdvance} onChange={(event) => workspace.patchTexture({ atlasAutoAdvance: event.target.checked })} />Advance tile after brush</label>
        <p className="uv-hint">Select faces, then change tile / Repeat U/V — updates live (UV wrap, no subdivision). Apply commits undo. Inset by 0.5 px to reduce atlas bleeding.</p>
      </section>
      <section className="uv-section">
        <h3 className="uv-section-title">Tile Geometry</h3>
        <div className="uv-btn-grid uv-btn-grid-3">
          {(['paint', 'erase', 'replace', 'pick', 'fill'] as const).map((mode) => <button key={mode} type="button" className={`tool${tex.atlasDrawMode === mode ? ' is-active' : ''}`} onClick={() => workspace.patchTexture({ atlasDrawMode: mode })}>{mode[0]!.toUpperCase() + mode.slice(1)}</button>)}
        </div>
        <div className="uv-btn-grid uv-btn-grid-2">
          <button type="button" className={`tool${tex.atlasDrawShape === 'stroke' ? ' is-active' : ''}`} onClick={() => workspace.patchTexture({ atlasDrawShape: 'stroke' })}>Stroke shape</button>
          <button type="button" className={`tool${tex.atlasDrawShape === 'rectangle' ? ' is-active' : ''}`} onClick={() => workspace.patchTexture({ atlasDrawShape: 'rectangle' })}>Rectangle shape</button>
        </div>
        <label className="uv-check"><input type="checkbox" checked={tex.atlasAutoTile} onChange={(event) => workspace.patchTexture({ atlasAutoTile: event.target.checked })} />Autotile from 4 × 4 rule block</label>
        {tex.atlasAutoTile && <p className="uv-hint">Select the top-left tile of a 4 × 4 ruleset. Viper chooses all 16 edge, corner, junction, and centre states as neighbours change.</p>}
        <label className="uv-field"><span>Layer</span><select className="uv-select" value={tex.atlasTileLayer} onChange={(event) => workspace.patchTexture({ atlasTileLayer: event.target.value as 'Geometry' | 'Decoration' | 'Collision' | 'Decal' })}><option value="Geometry">Geometry</option><option value="Decoration">Decoration</option><option value="Decal">Decal</option><option value="Collision">Collision</option></select></label>
        <button type="button" className={`tool primary uv-btn-block${tileDrawActive ? ' is-active' : ''}`} disabled={!image || !activeMaterial} onClick={onToggleDraw}>{tileDrawActive ? 'Stop 3D Tile Draw' : 'Start 3D Tile Draw'}</button>
        <label className="uv-check"><input type="checkbox" checked={tex.atlasUsePixelDensity} onChange={(event) => workspace.patchTexture({ atlasUsePixelDensity: event.target.checked })} />Use pixels-per-unit scale</label>
        <div className="uv-btn-grid uv-btn-grid-2">
          <label className="uv-field"><span>{tex.atlasUsePixelDensity ? 'Pixels / unit' : 'Cell size'}</span><input className="uv-text" type="number" min={0.01} step={tex.atlasUsePixelDensity ? 1 : 0.25} value={tex.atlasUsePixelDensity ? tex.atlasPixelsPerUnit : tex.atlasPlaneSize} onChange={(event) => tex.atlasUsePixelDensity ? workspace.patchTexture({ atlasPixelsPerUnit: Math.max(1, Number(event.target.value)) }) : workspace.patchTexture({ atlasPlaneSize: Math.max(0.01, Number(event.target.value)) })} /></label>
          <label className="uv-field"><span>Plane</span><select className="uv-select" value={tex.atlasPlaneOrientation} onChange={(event) => workspace.patchTexture({ atlasPlaneOrientation: event.target.value as 'floor' | 'wall-x' | 'wall-z' })}><option value="wall-x">Front wall</option><option value="wall-z">Side wall</option><option value="floor">Floor</option></select></label>
        </div>
        <button type="button" className="tool uv-btn-block" disabled={!image} onClick={onCreatePlane}>Create Tile Plane</button>
        <div className="uv-btn-grid uv-btn-grid-2">
          <label className="uv-field"><span>Grid columns</span><input className="uv-text" type="number" min={1} max={256} value={tex.atlasFillColumns} onChange={(event) => workspace.patchTexture({ atlasFillColumns: Math.max(1, Math.round(Number(event.target.value))) })} /></label>
          <label className="uv-field"><span>Grid rows</span><input className="uv-text" type="number" min={1} max={256} value={tex.atlasFillRows} onChange={(event) => workspace.patchTexture({ atlasFillRows: Math.max(1, Math.round(Number(event.target.value))) })} /></label>
        </div>
        <div className="uv-btn-grid uv-btn-grid-2">
          <label className="uv-field"><span>Pattern</span><select className="uv-select" value={tex.atlasFillPattern} onChange={(event) => workspace.patchTexture({ atlasFillPattern: event.target.value as 'repeat' | 'random' })}><option value="repeat">Repeat stamp</option><option value="random">Seeded random</option></select></label>
          <label className="uv-field"><span>Random seed</span><input className="uv-text" type="number" value={tex.atlasRandomSeed} disabled={tex.atlasFillPattern !== 'random'} onChange={(event) => workspace.patchTexture({ atlasRandomSeed: Math.round(Number(event.target.value)) })} /></label>
        </div>
        <button type="button" className="tool primary uv-btn-block" disabled={!image} onClick={onCreateGrid}>Build Auto-joined Tile Grid</button>
        <button
          type="button"
          className="tool uv-btn-block"
          disabled={!activeTexture || !activeMaterial}
          onClick={() => {
            if (!activeTexture || !activeMaterial) return;
            activeTexture.filtering = 'nearest';
            activeTexture.wrapping = 'clamp';
            activeTexture.generateMipmaps = false;
            activeMaterial.textureFiltering = 'nearest';
            activeMaterial.textureWrapping = 'clamp';
            activeMaterial.alphaMode = 'mask';
            activeMaterial.alphaCutoff = 0.5;
            activeMaterial.doubleSided = true;
            activeMaterial.shadingModel = 'unlit';
            activeMaterial.unlit = true;
            activeMaterial.roughness = 1;
            activeMaterial.metallic = 0;
            session.document.dirty = true;
            session.requestRedraw();
          }}
        >
          Pixel-art Material Preset
        </button>
        <p className="uv-hint">Creates a tiled mesh using the active material and Repeat U/V. Ready to move, rotate, extrude, or duplicate.</p>
      </section>
    </>
  );
}

function selectionPixelSize(
  session: EditorSession,
  activeImageId: string | null,
  activeUvLayerId: string | null,
): { w: number; h: number } | null {
  const objectId = session.selection.state.activeObjectId;
  const object = objectId ? session.document.objects.get(objectId) : null;
  const mesh = object?.meshId ? session.document.meshes.get(object.meshId) : null;
  if (!mesh) return null;
  const layerId = resolveUvLayerId(mesh, activeUvLayerId ?? mesh.defaultUvLayerId);
  if (!layerId) return null;

  let corners = [...session.uvSelection.state.selectedCornerIds];
  if (!corners.length && session.selection.state.selectedFaceIds.size) {
    corners = cornersForFaces(mesh, session.selection.state.selectedFaceIds);
  }
  if (!corners.length) return null;

  const image =
    (activeImageId ? session.document.images.get(activeImageId) : null) ??
    [...session.document.images.values()][0] ??
    null;
  if (!image) return null;

  const bounds = boundsOfUvs(snapshotUvs(mesh, corners, layerId));
  if (!bounds) return null;
  return {
    w: Math.max(1, Math.round(bounds.size.x * image.width)),
    h: Math.max(1, Math.round(bounds.size.y * image.height)),
  };
}

function rgbaToHex(c: readonly [number, number, number, number]): string {
  return '#' + [c[0], c[1], c[2]].map((n) => n.toString(16).padStart(2, '0')).join('');
}

function hexToRgba(hex: string, alpha: number): [number, number, number, number] {
  const h = hex.replace('#', '');
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
    alpha,
  ];
}
