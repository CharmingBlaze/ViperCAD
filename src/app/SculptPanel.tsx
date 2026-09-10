import { useState } from 'react';
import type { EditorSession } from '@/core/editor/EditorSession';
import { commitMeshObject } from '@/core/document/ModelDocument';
import { buildSphere } from '@/core/mesh/builders/SphereBuilder';
import { bumpTopology } from '@/core/mesh/EditableMesh';
import { runMeshTransaction } from '@/core/history/Transaction';
import { subdivideFaces } from '@/core/mesh/ops/subdivide';
import { validateMeshFull } from '@/core/mesh/Validation';
import { sculptableObjects } from '@/core/sculpt/MeshSculptTarget';
import {
  MeshSculptTool,
  type MeshBrushMode,
  type SculptFalloff,
} from '@/core/tools/MeshSculptTool';
import {
  blurMeshMask,
  clearMeshMask,
  extractMaskedGeometry,
  hasMask,
  invertMeshMask,
} from '@/core/sculpt/SculptMask';
import { remeshUniform } from '@/core/sculpt/MeshRemesher';
import { decimateMesh } from '@/core/sculpt/MeshDecimate';
import { symmetrizeMesh } from '@/core/symmetry/Symmetry';
import { pushToast } from '@/app/Toast';
import { usePanelResizer } from '@/app/usePanelResizer';

type Props = {
  session: EditorSession;
  onRefresh: () => void;
};

type BrushDef = {
  mode: MeshBrushMode;
  label: string;
  hint: string;
  tooltip: string;
  shortcut: string;
  category: 'form' | 'volume' | 'surface' | 'mask';
};

const BRUSHES: BrushDef[] = [
  { mode: 'draw', label: 'Draw', hint: 'Add or subtract along the surface', shortcut: 'D', category: 'form', tooltip: 'Draw\nPushes the surface along its normal.\nHold Ctrl to invert. Shortcut D.' },
  { mode: 'clay', label: 'Clay', hint: 'Build form and volume', shortcut: 'C', category: 'form', tooltip: 'Clay\nBuilds flat layers of volume, like pressing clay.\nHold Ctrl to carve. Shortcut C.' },
  { mode: 'grab', label: 'Grab', hint: 'Pull and stretch the surface', shortcut: 'G', category: 'form', tooltip: 'Grab\nDrags a region of the mesh with the stroke.\nUse for large silhouette changes. Shortcut G.' },
  { mode: 'snake_hook', label: 'Snake Hook', hint: 'Stretch the mesh like soft clay', shortcut: 'K', category: 'form', tooltip: 'Snake Hook\nPulls the surface outward like soft clay.\nDrag to stretch horns, tails, and tendrils. Shortcut K.' },
  { mode: 'inflate', label: 'Inflate', hint: 'Expand or deflate volume', shortcut: 'I', category: 'volume', tooltip: 'Inflate\nPushes vertices outward from the surface.\nHold Ctrl to deflate. Shortcut I.' },
  { mode: 'pinch', label: 'Pinch', hint: 'Tighten form toward the brush', shortcut: 'P', category: 'volume', tooltip: 'Pinch\nDraws a wide form into a narrower crease.\nUseful for eyelids, lips, and folds. Shortcut P.' },
  { mode: 'flatten', label: 'Flatten', hint: 'Level the surface to a plane', shortcut: 'F', category: 'volume', tooltip: 'Flatten\nLevels an uneven surface toward a plane.\nAlt-click to sample the reference plane. Shortcut F.' },
  { mode: 'scrape', label: 'Scrape', hint: 'Trim peaks down to a plane', shortcut: 'T', category: 'volume', tooltip: 'Scrape\nShaves high spots down to a plane without filling lows.\nAlt-click to sample the plane. Shortcut T.' },
  { mode: 'smooth', label: 'Smooth', hint: 'Relax and blend surface detail', shortcut: 'Shift', category: 'surface', tooltip: 'Smooth\nRelaxes vertices to blend detail.\nHold Shift while using any other brush. Shortcut Shift.' },
  { mode: 'crease', label: 'Crease', hint: 'Sharpen valleys and ridges', shortcut: 'R', category: 'surface', tooltip: 'Crease\nPinches a sharp valley or ridge along the stroke.\nShortcut R.' },
  { mode: 'twist', label: 'Twist', hint: 'Rotate around the contact normal', shortcut: 'W', category: 'surface', tooltip: 'Twist\nRotates the surface around the contact normal.\nUseful for muscle and cloth turns. Shortcut W.' },
  { mode: 'nudge', label: 'Nudge', hint: 'Slide the surface tangentially', shortcut: 'N', category: 'surface', tooltip: 'Nudge\nSlides vertices along the surface without adding volume.\nShortcut N.' },
  { mode: 'noise', label: 'Noise', hint: 'Break up the surface with texture', shortcut: 'O', category: 'surface', tooltip: 'Noise\nAdds procedural breakup to an otherwise smooth surface.\nShortcut O.' },
  { mode: 'mask', label: 'Mask', hint: 'Protect vertices from sculpting', shortcut: 'M', category: 'mask', tooltip: 'Mask\nPaints a protected region that other brushes skip.\nHold Ctrl on Mask to unmask. Shortcut M.' },
  { mode: 'unmask', label: 'Unmask', hint: 'Erase protection from vertices', shortcut: 'U', category: 'mask', tooltip: 'Unmask\nRemoves mask so the surface can be sculpted again.\nShortcut U.' },
];

const CATEGORIES = [
  { id: 'all', label: 'All' },
  { id: 'form', label: 'Form' },
  { id: 'volume', label: 'Volume' },
  { id: 'surface', label: 'Surface' },
  { id: 'mask', label: 'Mask' },
] as const;

function formatCount(n: number): string {
  if (n >= 10_000) return `${(n / 1000).toFixed(1)}K`;
  return n.toLocaleString();
}

function PressureIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.4">
      <path d="M10.8 2.6 4.2 12.4c-.3.5.1 1.1.7 1.1h2.2" />
      <path d="M8.4 3.8 12.6 9" />
    </svg>
  );
}

function FalloffPreview({ kind }: { kind: SculptFalloff }) {
  const paths: Record<SculptFalloff, string> = {
    smooth: 'M1 13C4 13 5 3 8 3s4 10 7 10',
    linear: 'M2 13 14 3',
    sharp: 'M2 13c3 0 4-9 6-9s3 9 6 9',
    spherical: 'M2 13c0-8 4-10 6-10s6 2 6 10',
    root: 'M2 13C6 4 8 3 14 3',
    constant: 'M2 5h12',
  };
  return (
    <svg className="sculpt-falloff-preview" viewBox="0 0 16 16" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.4">
      <path d={paths[kind]} />
    </svg>
  );
}

function BrushPreview({ mode }: { mode: MeshBrushMode }) {
  if (mode === 'inflate') {
    return (
      <svg viewBox="0 0 48 18" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.2">
        <path d="M2 12h14" />
        <path d="M28 12c3-7 9-7 12 0" />
      </svg>
    );
  }
  if (mode === 'pinch') {
    return (
      <svg viewBox="0 0 48 18" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.2">
        <path d="M2 6h14M2 12h14" />
        <path d="M28 5 34 9l6-4M28 13l6-4 6 4" />
      </svg>
    );
  }
  if (mode === 'flatten') {
    return (
      <svg viewBox="0 0 48 18" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.2">
        <path d="M2 13 6 7l5 5 5-8" />
        <path d="M28 11h16" />
      </svg>
    );
  }
  if (mode === 'clay') {
    return (
      <svg viewBox="0 0 48 18" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.2">
        <path d="M2 13h14" />
        <path d="M28 13h16M31 13V8h10v5" />
      </svg>
    );
  }
  if (mode === 'grab') {
    return (
      <svg viewBox="0 0 48 18" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.2">
        <path d="M2 12h14" />
        <path d="M28 14c4-9 10-9 14 0" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 48 18" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.2">
      <path d="M2 12c3-5 7-5 10 0" />
      <path d="M28 12c3-5 7-5 10 0" />
    </svg>
  );
}

function BrushIcon({ mode }: { mode: MeshBrushMode }) {
  switch (mode) {
    case 'draw':
      return (
        <svg viewBox="0 0 20 20" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.5">
          <circle cx="10" cy="10" r="4" />
          <path d="M10 2v4M10 14v4M2 10h4M14 10h4" />
        </svg>
      );
    case 'clay':
      return (
        <svg viewBox="0 0 20 20" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.5">
          <rect x="4" y="6" width="12" height="4" rx="1" />
          <rect x="5.5" y="11" width="9" height="4" rx="1" />
        </svg>
      );
    case 'grab':
      return (
        <svg viewBox="0 0 20 20" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M7 4.5 5.5 6v4.8c0 2.2 1.8 4 4 4h1.5" />
          <path d="M9.5 3.5 12 6l-1.2 1.2M12 6l2.2-1.1M12 6v3.2" />
        </svg>
      );
    case 'snake_hook':
      return (
        <svg viewBox="0 0 20 20" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M5 16c2-5 2-9 6-10s5 3 2 5-6 1-4 4" />
        </svg>
      );
    case 'inflate':
      return (
        <svg viewBox="0 0 20 20" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.5">
          <circle cx="10" cy="10" r="5" />
          <path d="M10 7v6M7 10h6" />
        </svg>
      );
    case 'pinch':
      return (
        <svg viewBox="0 0 20 20" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M4.5 10h4M11.5 10h4" />
          <path d="M10 6.5v7" />
          <circle cx="10" cy="10" r="2.2" />
        </svg>
      );
    case 'flatten':
      return (
        <svg viewBox="0 0 20 20" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M3.5 12.5h13" />
          <path d="M6 8.5 10 5l4 3.5" />
        </svg>
      );
    case 'scrape':
      return (
        <svg viewBox="0 0 20 20" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M4 14 16 6M7 14h9v-9" />
        </svg>
      );
    case 'smooth':
      return (
        <svg viewBox="0 0 20 20" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M4 11c2.2-3.5 4.8-3.5 6.8 0s4.6 3.5 6.7 0" />
          <path d="M4 8.5c2.2-3.5 4.8-3.5 6.8 0s4.6 3.5 6.7 0" />
        </svg>
      );
    case 'crease':
      return (
        <svg viewBox="0 0 20 20" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M4 13 10 7l6 6" />
          <path d="M7.5 9.5 10 7l2.5 2.5" />
        </svg>
      );
    case 'twist':
      return (
        <svg viewBox="0 0 20 20" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M14 6.5A6 6 0 1 0 16 10" />
          <path d="M14 3v3.5h3.5" />
        </svg>
      );
    case 'nudge':
      return (
        <svg viewBox="0 0 20 20" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M4 10h12M12 6l4 4-4 4" />
        </svg>
      );
    case 'noise':
      return (
        <svg viewBox="0 0 20 20" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M4 8.5c1.5-2 3.2-2 4.8 0M11.2 8.5c1.6-2 3.3-2 4.8 0" />
          <path d="M5 12.5c1.2-1.5 2.6-1.5 3.8 0M11.2 12.5c1.2-1.5 2.6-1.5 3.8 0" />
        </svg>
      );
    case 'mask':
      return (
        <svg viewBox="0 0 20 20" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M10 3s6 2 6 7c0 4-3 7-6 7s-6-3-6-7c0-5 6-7 6-7z" />
          <path d="M8 9h4M8 12h4" />
        </svg>
      );
    case 'unmask':
      return (
        <svg viewBox="0 0 20 20" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M10 3s6 2 6 7c0 4-3 7-6 7s-6-3-6-7c0-5 6-7 6-7z" />
          <path d="M4 4l12 12" />
        </svg>
      );
    default:
      return null;
  }
}

export function SculptPanel({ session, onRefresh }: Props) {
  const tool = session.tools.get('mesh-sculpt') as MeshSculptTool;
  const objects = sculptableObjects(session.document);
  const activeId = session.selection.state.activeObjectId;
  const activeObject = activeId ? session.document.objects.get(activeId) : null;
  const activeMesh = activeObject?.meshId ? session.document.meshes.get(activeObject.meshId) : null;
  const activeBrush = BRUSHES.find((brush) => brush.mode === tool.mode) ?? BRUSHES[0]!;

  const [activeCategory, setActiveCategory] = useState<'all' | 'form' | 'volume' | 'surface' | 'mask'>('all');
  const [mirrorDirection, setMirrorDirection] = useState<'both' | 'pos' | 'neg'>('pos');
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [recentModes, setRecentModes] = useState<MeshBrushMode[]>(['clay', 'smooth', 'grab']);

  const symmetry = session.document.settings.symmetry;

  const selectObject = (objectId: string) => {
    session.selection.selectObjects([objectId], 'replace');
    session.tools.setActive('mesh-sculpt', session.context());
    onRefresh();
  };

  const createSphere = () => {
    const mesh = buildSphere({
      radius: 1,
      widthSegments: 32,
      heightSegments: 24,
      name: 'Sculpt Sphere',
    });
    const report = validateMeshFull(mesh);
    if (!report.ok) return;
    const { objectId } = commitMeshObject(session.document, mesh, { name: 'Sculpt Sphere' });
    session.selection.selectObjects([objectId], 'replace');
    session.tools.setActive('mesh-sculpt', session.context());
    session.document.dirty = true;
    session.requestRedraw();
    onRefresh();
  };

  const subdivideActive = () => {
    if (!activeMesh) return;
    const tx = runMeshTransaction(session.history, activeMesh, 'Subdivide', (mesh) => {
      const result = subdivideFaces(mesh, [...mesh.faces.keys()], 1);
      if (!result.ok) throw new Error(result.error?.message ?? 'Could not subdivide');
      bumpTopology(mesh);
    }, { fullValidation: true, selection: session.selection });
    if (!tx.ok) {
      pushToast(tx.error ?? 'Could not subdivide', 'error');
      return;
    }
    session.document.dirty = true;
    session.requestRedraw();
    pushToast('Mesh subdivided for higher sculpt density', 'info');
    onRefresh();
  };

  const remeshActive = () => {
    if (!activeMesh) return;
    const tx = runMeshTransaction(session.history, activeMesh, 'Remesh', (mesh) => {
      if (!remeshUniform(mesh)) throw new Error('Mesh is too small to remesh');
      bumpTopology(mesh);
    }, { fullValidation: true, selection: session.selection });
    if (!tx.ok) {
      pushToast(tx.error ?? 'Could not remesh', 'error');
      return;
    }
    session.document.dirty = true;
    session.requestRedraw();
    pushToast('Mesh uniformly remeshed', 'success');
    onRefresh();
  };

  const decimateActive = () => {
    if (!activeMesh) return;
    const tx = runMeshTransaction(session.history, activeMesh, 'Decimate', (mesh) => {
      if (!decimateMesh(mesh, { ratio: 0.5 })) throw new Error('Mesh is too small to decimate');
      bumpTopology(mesh);
    }, { fullValidation: true, selection: session.selection });
    if (!tx.ok) {
      pushToast(tx.error ?? 'Could not decimate', 'error');
      return;
    }
    session.document.dirty = true;
    session.requestRedraw();
    pushToast('Mesh decimated by 50%', 'info');
    onRefresh();
  };

  const onSymmetrize = (direction = mirrorDirection) => {
    if (!activeMesh) return;
    const passes = direction === 'both' ? [true, false] : [direction !== 'neg'];
    let count = 0;
    for (const positiveToNegative of passes) {
      count += symmetrizeMesh(activeMesh, 'x', positiveToNegative);
    }
    if (count > 0) {
      session.document.dirty = true;
      session.requestRedraw();
      pushToast(`Symmetrized mesh (${count} vertices mirrored)`, 'success');
      onRefresh();
    } else {
      pushToast('Mesh is already symmetric', 'info');
    }
  };

  const onInvertMask = () => {
    if (!activeMesh) return;
    invertMeshMask(activeMesh);
    session.document.dirty = true;
    session.requestRedraw();
    pushToast('Mask inverted', 'info');
    onRefresh();
  };

  const onClearMask = () => {
    if (!activeMesh) return;
    clearMeshMask(activeMesh.id);
    session.document.dirty = true;
    session.requestRedraw();
    pushToast('Mask cleared', 'info');
    onRefresh();
  };

  const onBlurMask = () => {
    if (!activeMesh) return;
    blurMeshMask(activeMesh);
    session.document.dirty = true;
    session.requestRedraw();
    pushToast('Mask smoothed', 'info');
    onRefresh();
  };

  const onExtractMask = () => {
    if (!activeMesh || !activeObject) return;
    const newId = extractMaskedGeometry(session.document, activeObject, activeMesh);
    if (newId) {
      session.document.dirty = true;
      session.requestRedraw();
      pushToast('Extracted masked geometry to new object', 'success');
      onRefresh();
    } else {
      pushToast('No masked vertices found to extract', 'error');
    }
  };

  const setBrush = (mode: MeshBrushMode) => {
    tool.setMode(mode, session.context());
    session.tools.setActive('mesh-sculpt', session.context());
    setRecentModes((current) => [mode, ...current.filter((item) => item !== mode)].slice(0, 4));
    onRefresh();
  };

  const hasSculptMesh = objects.length > 0 && Boolean(activeMesh);
  const recentBrushes = recentModes
    .map((mode) => BRUSHES.find((brush) => brush.mode === mode))
    .filter((brush): brush is BrushDef => Boolean(brush));

  const filteredBrushes = activeCategory === 'all'
    ? BRUSHES
    : BRUSHES.filter((b) => b.category === activeCategory);

  const resizer = usePanelResizer({
    storageKey: 'vipercad.sidebar.width.sculpt',
    defaultWidth: 240,
    minWidth: 200,
    maxWidth: 520,
  });

  return (
    <aside
      className={`sculpt-panel${resizer.isResizing ? ' is-resizing' : ''}`}
      ref={resizer.containerRef}
      aria-label="Sculpt tools"
      style={{ width: resizer.width, flex: `0 0 ${resizer.width}px` }}
    >
      <div
        className="panel-width-resizer"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize sculpt panel"
        title="Drag to resize sculpt panel · Double-click resets (240px)"
        {...resizer.resizerProps}
      />
      <header className="sculpt-panel-header">
        <strong>Sculpt</strong>
        <p>Shape and sculpt mesh surfaces.</p>
      </header>

      <div className="sculpt-panel-body">
        <section className="sculpt-section sculpt-section-quiet">
          <div className="sculpt-section-head">
            <span className="sculpt-section-label">Mesh</span>
            {activeMesh && (
              <span className="sculpt-stat-line">
                {formatCount(activeMesh.vertices.size)} verts · {formatCount(activeMesh.faces.size)} faces
              </span>
            )}
          </div>

          {objects.length ? (
            <label className="sculpt-field">
              <span className="sculpt-field-label">Active Mesh</span>
              <select
                className="sculpt-select"
                aria-label="Active sculpt mesh"
                value={activeId ?? ''}
                onChange={(event) => selectObject(event.target.value)}
              >
                {objects.map((object) => (
                  <option key={object.id} value={object.id}>
                    {object.name}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <p className="sculpt-empty-note">No sculpt mesh. Create a starting sphere or select a mesh.</p>
          )}

          <div className="sculpt-quick-actions">
            <button
              type="button"
              className="sculpt-action-btn sculpt-action-primary"
              onClick={createSphere}
              title="Sculpt Sphere&#10;Create a high-density starting mesh for sculpting."
            >
              {hasSculptMesh ? 'New Sculpt Sphere' : 'Create Sculpt Sphere'}
            </button>
            <button
              type="button"
              className="sculpt-action-btn"
              disabled={!activeMesh}
              onClick={subdivideActive}
              title="Subdivide&#10;Add geometry density for finer brush detail."
            >
              Subdivide
            </button>
            <button
              type="button"
              className="sculpt-action-btn"
              disabled={!activeMesh}
              onClick={remeshActive}
              title="Remesh&#10;Rebuild even polygon density for sculpting."
            >
              Remesh
            </button>
            <button
              type="button"
              className="sculpt-action-btn sculpt-action-quiet"
              disabled={!activeMesh}
              onClick={decimateActive}
              title="Decimate&#10;Reduce polygon density. Permanently removes detail."
            >
              Decimate
            </button>
          </div>
        </section>

        <section className="sculpt-section sculpt-section-quiet">
          <div className="sculpt-section-head">
            <span className="sculpt-section-label">Symmetry</span>
            <button
              type="button"
              className={`sculpt-toggle${symmetry.liveMirror ? ' is-on' : ''}`}
              aria-pressed={symmetry.liveMirror}
              onClick={() => {
                symmetry.liveMirror = !symmetry.liveMirror;
                session.document.dirty = true;
                onRefresh();
              }}
            >
              <span>Mirror</span>
              <b>{symmetry.liveMirror ? 'On' : 'Off'}</b>
            </button>
          </div>

          <div className="sculpt-mirror-row">
            <span className="sculpt-field-label">Axis</span>
            <div className="sculpt-axis-group">
              {(['x', 'y', 'z'] as const).map((axis) => (
                <button
                  key={axis}
                  type="button"
                  className={`sculpt-axis-btn sculpt-axis-${axis}${symmetry[axis] ? ' is-active' : ''}`}
                  onClick={() => {
                    symmetry[axis] = !symmetry[axis];
                    session.document.dirty = true;
                    onRefresh();
                  }}
                >
                  {axis.toUpperCase()}
                </button>
              ))}
            </div>
          </div>

          <div className="sculpt-direction-row">
            <label className="sculpt-field">
              <span className="sculpt-field-label">Direction</span>
              <select
                className="sculpt-select"
                aria-label="Symmetry direction"
                value={mirrorDirection}
                onChange={(event) => setMirrorDirection(event.target.value as 'both' | 'pos' | 'neg')}
              >
                <option value="both">Both</option>
                <option value="pos">+X → -X</option>
                <option value="neg">-X → +X</option>
              </select>
            </label>
            <button
              type="button"
              className="sculpt-action-btn"
              disabled={!activeMesh}
              onClick={() => onSymmetrize()}
              title="Apply the selected symmetry direction to the mesh"
            >
              Apply
            </button>
          </div>
        </section>

        <section className="sculpt-section sculpt-section-quiet">
          <div className="sculpt-section-head">
            <span className="sculpt-section-label">Mask</span>
            {activeMesh && hasMask(activeMesh.id) && (
              <span className="sculpt-stat-line">Active</span>
            )}
          </div>

          <div className="sculpt-btn-row">
            <button type="button" className="sculpt-action-btn" disabled={!activeMesh} onClick={onInvertMask} title="Invert the painted mask">
              Invert
            </button>
            <button type="button" className="sculpt-action-btn" disabled={!activeMesh} onClick={onBlurMask} title="Smooth mask edges">
              Smooth
            </button>
            <button type="button" className="sculpt-action-btn sculpt-action-quiet" disabled={!activeMesh} onClick={onClearMask} title="Clear the mask. Protected areas become sculptable again.">
              Clear
            </button>
          </div>
          <div className="sculpt-from-mask">
            <span className="sculpt-field-label">From Mask</span>
            <button type="button" className="sculpt-action-btn" disabled={!activeMesh} onClick={onExtractMask} title="Extract Mesh&#10;Creates new geometry from the masked area.">
              Extract Mesh
            </button>
          </div>
        </section>

        <section className="sculpt-brush-section">
          <div className="sculpt-brush-sticky">
            <div className="sculpt-section-head">
              <span className="sculpt-section-label sculpt-section-label-hero">Brush</span>
              <span className="sculpt-active-brush">{activeBrush.label}</span>
            </div>
            <p className="sculpt-brush-hint">{activeBrush.hint}</p>

            <label className="sculpt-slider">
              <span className="sculpt-slider-label">
                Size
                <b>{tool.radius.toFixed(2)}</b>
                <button
                  type="button"
                  className={`sculpt-pressure-btn${tool.pressureRadius ? ' is-on' : ''}`}
                  title="Pressure affects size"
                  aria-pressed={tool.pressureRadius}
                  onClick={() => {
                    tool.pressureRadius = !tool.pressureRadius;
                    tool.revision += 1;
                    onRefresh();
                  }}
                >
                  <PressureIcon />
                </button>
              </span>
              <input
                className="sculpt-range"
                aria-label="Brush size"
                type="range"
                min={0.05}
                max={4}
                step={0.05}
                value={tool.radius}
                onChange={(event) => {
                  tool.setRadius(Number(event.target.value), session.context());
                  onRefresh();
                }}
              />
            </label>

            <label className="sculpt-slider">
              <span className="sculpt-slider-label">
                Strength
                <b>{tool.strength.toFixed(2)}</b>
                <button
                  type="button"
                  className={`sculpt-pressure-btn${tool.pressureStrength ? ' is-on' : ''}`}
                  title="Pressure affects strength"
                  aria-pressed={tool.pressureStrength}
                  onClick={() => {
                    tool.pressureStrength = !tool.pressureStrength;
                    tool.revision += 1;
                    onRefresh();
                  }}
                >
                  <PressureIcon />
                </button>
              </span>
              <input
                className="sculpt-range"
                aria-label="Brush strength"
                type="range"
                min={0.005}
                max={0.5}
                step={0.005}
                value={tool.strength}
                onChange={(event) => {
                  tool.setStrength(Number(event.target.value), session.context());
                  onRefresh();
                }}
              />
            </label>

            <div className="sculpt-recent" aria-label="Recent brushes">
              <span className="sculpt-field-label">Recent</span>
              <div className="sculpt-recent-row">
                {recentBrushes.map((brush) => (
                  <button
                    key={brush.mode}
                    type="button"
                    className={`sculpt-recent-chip${tool.mode === brush.mode ? ' is-active' : ''}`}
                    onClick={() => setBrush(brush.mode)}
                  >
                    {brush.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="sculpt-category-tabs" role="tablist" aria-label="Brush categories">
              {CATEGORIES.map((cat) => (
                <button
                  key={cat.id}
                  type="button"
                  role="tab"
                  aria-selected={activeCategory === cat.id}
                  className={`sculpt-category-tab${activeCategory === cat.id ? ' is-active' : ''}`}
                  onClick={() => setActiveCategory(cat.id)}
                >
                  {cat.label}
                </button>
              ))}
            </div>
          </div>

          <div className="sculpt-brush-grid" role="group" aria-label="Sculpt brushes">
            {filteredBrushes.map((brush) => {
              const active = session.tools.getActive() === tool && tool.mode === brush.mode;
              return (
                <button
                  key={brush.mode}
                  type="button"
                  className={`sculpt-brush-btn${active ? ' is-active' : ''}`}
                  aria-pressed={active}
                  title={brush.tooltip}
                  onClick={() => setBrush(brush.mode)}
                >
                  <span className="sculpt-brush-icon">
                    <BrushIcon mode={brush.mode} />
                  </span>
                  <span>{brush.label}</span>
                  <span className="sculpt-brush-preview" aria-hidden>
                    <BrushPreview mode={brush.mode} />
                    <em>{brush.shortcut}</em>
                  </span>
                </button>
              );
            })}
          </div>

          <button
            type="button"
            className="sculpt-advanced-toggle"
            aria-expanded={advancedOpen}
            onClick={() => setAdvancedOpen((open) => !open)}
          >
            Advanced {advancedOpen ? '▾' : '▸'}
          </button>

          {advancedOpen && (
            <div className="sculpt-advanced">
              <div className="sculpt-falloff">
                <span className="sculpt-slider-label">
                  Falloff
                  <FalloffPreview kind={tool.falloff} />
                </span>
                <div className="sculpt-falloff-toggle" role="group" aria-label="Brush falloff">
                  {(['smooth', 'linear', 'sharp', 'spherical', 'root', 'constant'] as SculptFalloff[]).map((falloff) => (
                    <button
                      key={falloff}
                      type="button"
                      className={tool.falloff === falloff ? 'is-active' : ''}
                      aria-pressed={tool.falloff === falloff}
                      onClick={() => {
                        tool.falloff = falloff;
                        tool.revision += 1;
                        onRefresh();
                      }}
                    >
                      {falloff[0]!.toUpperCase() + falloff.slice(1)}
                    </button>
                  ))}
                </div>
              </div>
              <label className="sculpt-slider">
                <span className="sculpt-slider-label">
                  Hardness
                  <b>{Math.round(tool.hardness * 100)}%</b>
                </span>
                <input
                  className="sculpt-range"
                  aria-label="Brush hardness"
                  type="range"
                  min={0}
                  max={0.9}
                  step={0.05}
                  value={tool.hardness}
                  onChange={(event) => {
                    tool.hardness = Number(event.target.value);
                    tool.revision += 1;
                    session.requestRedraw();
                    onRefresh();
                  }}
                />
              </label>
              <label className="sculpt-slider">
                <span className="sculpt-slider-label">
                  Stroke spacing
                  <b>{Math.round(tool.spacing * 100)}%</b>
                </span>
                <input
                  className="sculpt-range"
                  aria-label="Stroke spacing"
                  type="range"
                  min={0.05}
                  max={0.5}
                  step={0.01}
                  value={tool.spacing}
                  onChange={(event) => {
                    tool.spacing = Number(event.target.value);
                    tool.revision += 1;
                    onRefresh();
                  }}
                />
              </label>
              {(tool.mode === 'clay' || tool.mode === 'inflate' || tool.mode === 'noise') && (
                <label className="sculpt-slider">
                  <span className="sculpt-slider-label">
                    Build-up
                    <b>{tool.buildUp.toFixed(2)}</b>
                  </span>
                  <input
                    className="sculpt-range"
                    aria-label="Brush build-up"
                    type="range"
                    min={0.2}
                    max={2}
                    step={0.05}
                    value={tool.buildUp}
                    onChange={(event) => {
                      tool.buildUp = Number(event.target.value);
                      tool.revision += 1;
                      onRefresh();
                    }}
                  />
                </label>
              )}
              {tool.mode === 'smooth' && (
                <label className="sculpt-slider">
                  <span className="sculpt-slider-label">
                    Preserve volume
                    <b>{Math.round(tool.preserveVolume * 100)}%</b>
                  </span>
                  <input
                    className="sculpt-range"
                    aria-label="Smooth preserve volume"
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={tool.preserveVolume}
                    onChange={(event) => {
                      tool.preserveVolume = Number(event.target.value);
                      tool.revision += 1;
                      onRefresh();
                    }}
                  />
                </label>
              )}
              <div className="sculpt-toggle-grid">
                <label>
                  <input
                    type="checkbox"
                    checked={tool.frontFacesOnly}
                    onChange={(event) => {
                      tool.frontFacesOnly = event.target.checked;
                      tool.revision += 1;
                      onRefresh();
                    }}
                  />
                  Front faces
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={tool.usePressure}
                    onChange={(event) => {
                      tool.usePressure = event.target.checked;
                      tool.revision += 1;
                      onRefresh();
                    }}
                  />
                  Pen pressure
                </label>
              </div>
              <label className="sculpt-checkbox-label">
                <input
                  type="checkbox"
                  checked={tool.stabilizer.enabled}
                  onChange={(e) => {
                    tool.stabilizer.enabled = e.target.checked;
                    tool.revision += 1;
                    onRefresh();
                  }}
                />
                <span>Stabilizer</span>
              </label>
              {(tool.mode === 'flatten' || tool.mode === 'scrape') && (
                <p className="sculpt-tip">Alt+click the surface to sample the reference plane.</p>
              )}
            </div>
          )}
        </section>

        <footer className="sculpt-shortcuts">
          <span><kbd>LMB</kbd> Sculpt</span>
          <span><kbd>Shift</kbd> Smooth</span>
          <span><kbd>Ctrl</kbd> Invert</span>
          <span><kbd>Wheel</kbd> Size</span>
          <span><kbd>Ctrl+Wheel</kbd> Strength</span>
          <span><kbd>Alt</kbd> Sample</span>
          <span><kbd>RMB</kbd> Orbit</span>
        </footer>
      </div>
    </aside>
  );
}
