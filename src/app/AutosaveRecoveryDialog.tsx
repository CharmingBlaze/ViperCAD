import { formatAutosaveTime, type AutosavePayload } from '@/app/autosave';

type Props = {
  autosaves: AutosavePayload[];
  onRestore: (autosave: AutosavePayload) => void;
  onDiscard: (id: string) => void;
  onDiscardAll: () => void;
};

export function AutosaveRecoveryDialog({ autosaves, onRestore, onDiscard, onDiscardAll }: Props) {
  return (
    <div className="app-modal-backdrop" role="presentation">
      <div className="app-modal" role="dialog" aria-labelledby="autosave-title">
        <h2 id="autosave-title">Recovery history</h2>
        <p>Choose a local recovery snapshot. Newest snapshots appear first.</p>
        <div className="recovery-list">
          {autosaves.map((autosave) => (
            <div className="recovery-row" key={autosave.id}>
              <div>
                <strong>{autosave.name}</strong>
                <span>{formatAutosaveTime(autosave.savedAt)} · {autosave.kind}</span>
              </div>
              <button type="button" className="tool" onClick={() => onDiscard(autosave.id)}>Remove</button>
              <button type="button" className="tool primary" onClick={() => onRestore(autosave)}>Restore</button>
            </div>
          ))}
        </div>
        <div className="app-modal-actions">
          <button type="button" className="tool" onClick={onDiscardAll}>
            Discard all
          </button>
        </div>
      </div>
    </div>
  );
}
