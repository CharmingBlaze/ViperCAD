import type { AnimationSession } from './AnimationSession';

type Props = {
  session: AnimationSession;
  onRefresh: () => void;
};

export function WeightBrushPanel({ session, onRefresh }: Props) {
  if (session.editMode !== 'weight') return null;
  return (
    <section className="rig-panel">
      <h3 className="rig-panel-title">Weight Brush</h3>
      <p className="rig-hint">
        Painting {session.getSelectedBoneName() ?? 'no bone'}
        {' · '}
        Ctrl/Alt subtract · wheel size
      </p>
      <label className="rig-field">
        <span>Radius {session.weightBrushRadius.toFixed(2)}</span>
        <input
          className="rig-input"
          type="range"
          min={0.02}
          max={0.8}
          step={0.01}
          value={session.weightBrushRadius}
          onChange={(event) => {
            session.weightBrushRadius = Number(event.target.value);
            onRefresh();
          }}
        />
      </label>
      <label className="rig-field">
        <span>Strength {session.weightBrushStrength.toFixed(2)}</span>
        <input
          className="rig-input"
          type="range"
          min={0.05}
          max={1}
          step={0.05}
          value={session.weightBrushStrength}
          onChange={(event) => {
            session.weightBrushStrength = Number(event.target.value);
            onRefresh();
          }}
        />
      </label>
      <div className="rig-btn-row rig-btn-row-2">
        <button
          type="button"
          className={`rig-btn${session.weightBrushAdd ? ' rig-btn-primary' : ''}`}
          onClick={() => { session.weightBrushAdd = true; onRefresh(); }}
        >
          Add
        </button>
        <button
          type="button"
          className={`rig-btn${!session.weightBrushAdd ? ' rig-btn-primary' : ''}`}
          onClick={() => { session.weightBrushAdd = false; onRefresh(); }}
        >
          Subtract
        </button>
      </div>
      <button
        type="button"
        className={`rig-btn rig-btn-block${session.weightXray ? ' rig-btn-primary' : ''}`}
        onClick={() => { session.weightXray = !session.weightXray; session.notify(); onRefresh(); }}
      >
        X-Ray
      </button>
      <button
        type="button"
        className="rig-btn rig-btn-block"
        title="Mirror skin weights across X axis"
        onClick={() => { session.mirrorSkinWeightsXForRig(); onRefresh(); }}
      >
        Mirror X
      </button>
    </section>
  );
}
