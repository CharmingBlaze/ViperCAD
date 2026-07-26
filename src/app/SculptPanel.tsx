import type { EditorSession } from '@/core/editor/EditorSession';
import { commitMeshObject } from '@/core/document/ModelDocument';
import { buildSphere } from '@/core/mesh/builders/SphereBuilder';
import { bumpTopology } from '@/core/mesh/EditableMesh';
import { subdivideFaces } from '@/core/mesh/ops/subdivide';
import { validateMeshFull } from '@/core/mesh/Validation';
import { sculptableObjects } from '@/core/sculpt/MeshSculptTarget';
import {
  MeshSculptTool,
  type MeshBrushMode,
  type SculptFalloff,
} from '@/core/tools/MeshSculptTool';

type Props = {
  session: EditorSession;
  onRefresh: () => void;
};

const BRUSHES: { mode: MeshBrushMode; label: string; hint: string }[] = [
  { mode: 'grab', label: 'Grab', hint: 'Pull surface' },
  { mode: 'inflate', label: 'Inflate', hint: 'Push / pull volume' },
  { mode: 'smooth', label: 'Smooth', hint: 'Blend detail' },
  { mode: 'flatten', label: 'Flatten', hint: 'Level to plane' },
  { mode: 'pinch', label: 'Pinch', hint: 'Tighten forms' },
  { mode: 'crease', label: 'Crease', hint: 'Sharpen edges' },
  { mode: 'noise', label: 'Noise', hint: 'Break up surface' },
];

function BrushIcon({ mode }: { mode: MeshBrushMode }) {
  switch (mode) {
    case 'grab':
      return (
        <svg viewBox="0 0 20 20" aria-hidden>
          <path d="M7 4.5 5.5 6v4.8c0 2.2 1.8 4 4 4h1.5" />
          <path d="M9.5 3.5 12 6l-1.2 1.2M12 6l2.2-1.1M12 6v3.2" />
        </svg>
      );
    case 'inflate':
      return (
        <svg viewBox="0 0 20 20" aria-hidden>
          <circle cx="10" cy="10" r="4.5" />
          <path d="M10 3.5v3M10 13.5v3M3.5 10h3M13.5 10h3" />
        </svg>
      );
    case 'smooth':
      return (
        <svg viewBox="0 0 20 20" aria-hidden>
          <path d="M4 11c2.2-3.5 4.8-3.5 6.8 0s4.6 3.5 6.7 0" />
          <path d="M4 8.5c2.2-3.5 4.8-3.5 6.8 0s4.6 3.5 6.7 0" />
        </svg>
      );
    case 'flatten':
      return (
        <svg viewBox="0 0 20 20" aria-hidden>
          <path d="M3.5 12.5h13" />
          <path d="M6 8.5 10 5l4 3.5" />
        </svg>
      );
    case 'pinch':
      return (
        <svg viewBox="0 0 20 20" aria-hidden>
          <path d="M4.5 10h4M11.5 10h4" />
          <path d="M10 6.5v7" />
          <circle cx="10" cy="10" r="2.2" />
        </svg>
      );
    case 'crease':
      return (
        <svg viewBox="0 0 20 20" aria-hidden>
          <path d="M4 13 10 7l6 6" />
          <path d="M7.5 9.5 10 7l2.5 2.5" />
        </svg>
      );
    default:
      return (
        <svg viewBox="0 0 20 20" aria-hidden>
          <path d="M4 8.5c1.5-2 3.2-2 4.8 0M11.2 8.5c1.6-2 3.3-2 4.8 0" />
          <path d="M5 12.5c1.2-1.5 2.6-1.5 3.8 0M11.2 12.5c1.2-1.5 2.6-1.5 3.8 0" />
        </svg>
      );
  }
}

export function SculptPanel({ session, onRefresh }: Props) {
  const tool = session.tools.get('mesh-sculpt') as MeshSculptTool;
  const objects = sculptableObjects(session.document);
  const activeId = session.selection.state.activeObjectId;
  const activeObject = activeId ? session.document.objects.get(activeId) : null;
  const activeMesh = activeObject?.meshId ? session.document.meshes.get(activeObject.meshId) : null;
  const activeBrush = BRUSHES.find((brush) => brush.mode === tool.mode) ?? BRUSHES[0]!;

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
    const result = subdivideFaces(activeMesh, [...activeMesh.faces.keys()], 1);
    if (!result.ok) return;
    bumpTopology(activeMesh);
    session.document.dirty = true;
    session.requestRedraw();
    onRefresh();
  };

  const setBrush = (mode: MeshBrushMode) => {
    tool.setMode(mode, session.context());
    session.tools.setActive('mesh-sculpt', session.context());
    onRefresh();
  };

  return (
    <aside className="sculpt-panel" aria-label="Sculpt tools">
      <header className="sculpt-panel-header">
        <span className="sculpt-panel-kicker">Workspace</span>
        <strong>Sculpt</strong>
        <p>Shape mesh surfaces with pressure-friendly brushes.</p>
      </header>

      <div className="sculpt-panel-body">
        <section className="sculpt-object-card">
          <div className="sculpt-object-card-head">
            <span className="sculpt-section-label">Target</span>
            {activeMesh && (
              <span className="sculpt-stat-pill">
                {activeMesh.vertices.size.toLocaleString()}v · {activeMesh.faces.size.toLocaleString()}f
              </span>
            )}
          </div>

          {objects.length ? (
            <label className="sculpt-field">
              <select
                className="sculpt-select"
                aria-label="Sculpt target object"
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
            <p className="sculpt-empty-note">No mesh objects yet. Start with a sphere below.</p>
          )}

          <div className="sculpt-quick-actions">
            <button type="button" className="sculpt-action-btn sculpt-action-primary" onClick={createSphere}>
              New Sphere
            </button>
            <button
              type="button"
              className="sculpt-action-btn"
              disabled={!activeMesh}
              onClick={subdivideActive}
              title="Add geometry density for finer brush detail"
            >
              Subdivide
            </button>
          </div>
        </section>

        <section className="sculpt-brush-section">
          <div className="sculpt-section-head">
            <span className="sculpt-section-label">Brush</span>
            <span className="sculpt-active-brush">{activeBrush.label}</span>
          </div>
          <p className="sculpt-brush-hint">{activeBrush.hint}</p>

          <div className="sculpt-brush-grid" role="group" aria-label="Sculpt brushes">
            {BRUSHES.map(({ mode, label }) => {
              const active = session.tools.getActive() === tool && tool.mode === mode;
              return (
                <button
                  key={mode}
                  type="button"
                  className={`sculpt-brush-btn${active ? ' is-active' : ''}`}
                  aria-pressed={active}
                  title={label}
                  onClick={() => setBrush(mode)}
                >
                  <span className="sculpt-brush-icon">
                    <BrushIcon mode={mode} />
                  </span>
                  <span>{label}</span>
                </button>
              );
            })}
          </div>
        </section>

        <section className="sculpt-controls">
          <label className="sculpt-slider">
            <span className="sculpt-slider-label">
              Radius
              <b>{tool.radius.toFixed(2)}</b>
            </span>
            <input
              className="sculpt-range"
              aria-label="Brush radius"
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

          <div className="sculpt-falloff">
            <span className="sculpt-slider-label">Falloff</span>
            <div className="sculpt-falloff-toggle" role="group" aria-label="Brush falloff">
              {(['smooth', 'linear', 'sharp'] as SculptFalloff[]).map((falloff) => (
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

          {tool.mode === 'flatten' && (
            <p className="sculpt-tip">Alt+click the surface to sample the flatten plane.</p>
          )}
        </section>

        <footer className="sculpt-shortcuts">
          <span>LMB sculpt</span>
          <span>Shift invert</span>
          <span>Wheel size</span>
          <span>RMB orbit</span>
        </footer>
      </div>
    </aside>
  );
}
