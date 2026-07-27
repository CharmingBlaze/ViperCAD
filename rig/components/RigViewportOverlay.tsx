import type { RigSession } from '../RigSession';

type Props = {
  session: RigSession;
  onQuickSetup: () => void;
};

export function RigViewportOverlay({ session, onQuickSetup }: Props) {
  const status = session.getSetupStatus();

  if (status.isReady) return null;

  return (
    <div className="rig-viewport-overlay">
      <div className="rig-viewport-card">
        <h2>Ready to rig</h2>
        <p>
          {status.meshObjectCount > 0
            ? `${status.meshObjectCount} mesh object${status.meshObjectCount === 1 ? '' : 's'} found in ${status.sourceModelName ?? 'the source model'}.`
            : 'Add mesh objects to your model in ViperCAD, then sync back here.'}
        </p>
        <ol className="rig-setup-steps">
          <li className={status.sourceModelName ? 'done' : ''}>Link a source model document</li>
          <li className={status.armatureBoneCount > 0 ? 'done' : ''}>Generate armature &amp; skin weights</li>
          <li>Pose bones and set keyframes on the timeline</li>
        </ol>
        <div className="rig-viewport-actions">
          <button
            type="button"
            className="rig-btn rig-btn-primary"
            disabled={!status.sourceModelName || status.meshObjectCount === 0}
            onClick={onQuickSetup}
          >
            Quick setup — bind meshes
          </button>
        </div>
        {!status.meshObjectCount && status.sourceModelName && (
          <p className="rig-viewport-note">
            The linked model has no mesh objects yet. Model something in ViperCAD first, then click Sync or refresh this page.
          </p>
        )}
      </div>
    </div>
  );
}
