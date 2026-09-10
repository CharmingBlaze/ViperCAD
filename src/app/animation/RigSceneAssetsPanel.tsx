import { listSceneCameras, listSceneLights } from '@/core/rig/RigSceneAssets';
import type { RigLightType } from '@/core/rig/RigSceneAssets';
import type { AnimationSession } from './AnimationSession';

type Props = {
  session: AnimationSession;
  onRefresh: () => void;
  showClearKeys?: boolean;
  showOnion?: boolean;
  showSceneObjects?: boolean;
};

export function RigSceneAssetsPanel({
  session,
  onRefresh,
  showClearKeys = false,
  showOnion = false,
  showSceneObjects = true,
}: Props) {
  const source = session.getSourceModel();
  const cameras = source ? listSceneCameras(source) : [];
  const lights = source ? listSceneLights(source) : [];

  const addLight = (type: RigLightType) => {
    session.addLight(type);
    onRefresh();
  };

  return (
    <section className="rig-panel">
      <h3 className="rig-panel-title">{showSceneObjects ? 'Display & Scene' : 'Display'}</h3>
      <div className="rig-btn-row">
        {(['material', 'uv', 'wireframe'] as const).map((mode) => (
          <button
            key={mode}
            type="button"
            className={`rig-btn${session.viewportDisplayMode === mode ? ' rig-btn-primary' : ''}`}
            onClick={() => { session.setViewportDisplayMode(mode); onRefresh(); }}
          >
            {mode === 'material' ? 'Material' : mode === 'uv' ? 'UV' : 'Wire'}
          </button>
        ))}
      </div>
      {showSceneObjects && (
      <div className="rig-btn-row">
        <button type="button" className="rig-btn" onClick={() => { session.addCamera(); onRefresh(); }}>
          Camera
        </button>
        <button type="button" className="rig-btn" onClick={() => addLight('directional')}>
          Sun
        </button>
        <button type="button" className="rig-btn" onClick={() => addLight('point')}>
          Point
        </button>
        <button type="button" className="rig-btn" onClick={() => addLight('spot')}>
          Spot
        </button>
      </div>
      )}
      {showSceneObjects && (cameras.length + lights.length === 0 ? (
        <p className="rig-hint">Gizmos in the viewport. Lights illuminate the mesh.</p>
      ) : (
        <ul className="rig-event-list">
          {cameras.map((object) => (
            <li key={object.id} className="rig-event-item">
              <button
                type="button"
                className={`rig-btn-sm${session.selectedObjectId === object.id ? ' rig-btn-primary' : ''}`}
                onClick={() => { session.selectObject(object.id); onRefresh(); }}
              >
                {object.name}
              </button>
              <button
                type="button"
                className="rig-event-del"
                title="Delete camera"
                onClick={() => { session.deleteSceneObject(object.id); onRefresh(); }}
              >
                ×
              </button>
            </li>
          ))}
          {lights.map((object) => (
            <li key={object.id} className="rig-event-item">
              <button
                type="button"
                className={`rig-btn-sm${session.selectedObjectId === object.id ? ' rig-btn-primary' : ''}`}
                onClick={() => { session.selectObject(object.id); onRefresh(); }}
              >
                {object.name}
              </button>
              <button
                type="button"
                className="rig-event-del"
                title="Delete light"
                onClick={() => { session.deleteSceneObject(object.id); onRefresh(); }}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      ))}
      {showOnion && (
        <label className="rig-field" style={{ marginTop: 8 }}>
          <span>Ghost frames</span>
          <div className="rig-btn-row">
            <input
              className="rig-input"
              type="number"
              min={0}
              max={8}
              value={session.onionSkinning.framesBefore}
              onChange={(event) => {
                session.onionSkinning.framesBefore = Math.max(0, Number(event.target.value) || 0);
                session.notify();
                onRefresh();
              }}
            />
            <input
              className="rig-input"
              type="number"
              min={0}
              max={8}
              value={session.onionSkinning.framesAfter}
              onChange={(event) => {
                session.onionSkinning.framesAfter = Math.max(0, Number(event.target.value) || 0);
                session.notify();
                onRefresh();
              }}
            />
          </div>
        </label>
      )}
      {showClearKeys && (
        <div className="rig-btn-row">
          <button
            type="button"
            className="rig-btn"
            onClick={() => { session.clearPoseAnimation(); onRefresh(); }}
          >
            Clear keys
          </button>
        </div>
      )}
    </section>
  );
}
