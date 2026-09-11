import { useEffect } from 'react';
import { formatAutosaveTime, type AutosavePayload } from '@/app/autosave';
import { BlenderIcon } from '@/components/BlenderIcon';

type Props = {
  autosaves: AutosavePayload[];
  promptOnStartup: boolean;
  onTogglePromptOnStartup: (val: boolean) => void;
  onRestore: (autosave: AutosavePayload) => void;
  onDiscard: (id: string) => void;
  onDiscardAll: () => void;
  onClose: () => void;
  onCreateCheckpoint?: () => void;
};

export function AutosaveRecoveryDialog({
  autosaves,
  promptOnStartup,
  onTogglePromptOnStartup,
  onRestore,
  onDiscard,
  onDiscardAll,
  onClose,
  onCreateCheckpoint,
}: Props) {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <div
      className="app-modal-backdrop"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="app-modal recovery-modal" role="dialog" aria-labelledby="autosave-title">
        <div className="app-modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <BlenderIcon name="recover_last" size={17} />
            <h2 id="autosave-title" style={{ margin: 0, fontSize: '1rem', fontWeight: 600 }}>
              Recovery &amp; Autosave
            </h2>
          </div>
          <button
            type="button"
            className="tool recovery-close-btn"
            onClick={onClose}
            aria-label="Close dialog"
            title="Close"
          >
            <BlenderIcon name="panel_close" size={12} />
          </button>
        </div>

        <div className="recovery-properties-panel">
          <label className="recovery-toggle-label">
            <input
              type="checkbox"
              checked={promptOnStartup}
              onChange={(e) => onTogglePromptOnStartup(e.target.checked)}
            />
            <span className="recovery-toggle-title">Prompt for recovery on startup</span>
          </label>
          <p className="recovery-toggle-desc">
            When enabled, ViperCAD automatically offers to restore autosaved sessions upon launch.
          </p>

          <div className="recovery-quick-stats">
            <span>{autosaves.length} snapshot{autosaves.length === 1 ? '' : 's'} in storage</span>
            {onCreateCheckpoint && (
              <button
                type="button"
                className="tool recovery-checkpoint-btn"
                onClick={onCreateCheckpoint}
                title="Create a named recovery point right now"
              >
                Snapshot now
              </button>
            )}
          </div>
        </div>

        <div className="recovery-list-header">
          <span>Saved Snapshots</span>
          <span>{autosaves.length} total</span>
        </div>

        <div className="recovery-list">
          {autosaves.length === 0 ? (
            <div className="recovery-empty">
              No recovery snapshots saved yet. Autosaves run every 5s when modifications are made.
            </div>
          ) : (
            autosaves.map((autosave) => (
              <div className="recovery-row" key={autosave.id}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span className={`recovery-badge recovery-badge-${autosave.kind}`}>
                      {autosave.kind === 'named' ? 'Checkpoint' : 'Autosave'}
                    </span>
                    <strong>{autosave.name}</strong>
                  </div>
                  <span>{formatAutosaveTime(autosave.savedAt)}</span>
                </div>
                <button
                  type="button"
                  className="tool"
                  onClick={() => onDiscard(autosave.id)}
                  title="Remove this snapshot"
                >
                  Remove
                </button>
                <button
                  type="button"
                  className="tool primary"
                  onClick={() => onRestore(autosave)}
                  title="Restore this project snapshot"
                >
                  Restore
                </button>
              </div>
            ))
          )}
        </div>

        <div className="app-modal-actions">
          {autosaves.length > 0 && (
            <button type="button" className="tool" onClick={onDiscardAll}>
              Discard all
            </button>
          )}
          <button type="button" className="tool" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
