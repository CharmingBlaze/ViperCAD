type HotkeyHelpOverlayProps = {
  open: boolean;
  onClose: () => void;
};

const MODEL_KEYS: ReadonlyArray<readonly [string, string]> = [
  ['G / R / S', 'Move / Rotate / Scale'],
  ['Ctrl', 'Temporarily toggle vertex, edge, surface, increment, and angle snapping'],
  ['. / ,', 'Cycle orientation / pivot'],
  ['A', 'Select / Deselect all (current mode)'],
  ['Alt+A', 'Deselect all'],
  ['Ctrl+A', 'Select all'],
  ['E', 'Extrude selection'],
  ['P', 'Push/Pull · click face · move · click finish'],
  ['I', 'Inset faces'],
  ['K', 'Knife · click start/end · Enter confirm'],
  ['Ctrl+B', 'Bevel edges'],
  ['Ctrl+R', 'Loop Cut · wheel count · click slide'],
  ['Ctrl+Shift+D', 'Subdivide faces'],
  ['Shift+Alt+S / F', 'Shade Smooth / Shade Flat'],
  ['F', 'Frame selection'],
  ['Home', 'Frame all'],
  ['Shift+Home', 'Reset view'],
  ['Delete', 'Delete selection'],
  ['Ctrl+Z / Ctrl+Y', 'Undo / Redo'],
  ['Ctrl+C / Ctrl+V', 'Copy / Paste objects, groups, or faces'],
  ['Ctrl+G / Ctrl+Shift+G', 'Group / Ungroup objects'],
  ['Double-click object', 'Select parent group'],
  ['Tab', 'Maximize viewport under cursor'],
  ['MMB / RMB', 'Pan / Orbit'],
  ['?', 'Toggle this help'],
];

const UV_KEYS: ReadonlyArray<readonly [string, string]> = [
  ['Face / Point / Island', 'UV selection modes'],
  ['G / S / R', 'Move / Scale / Rotate UVs'],
  ['Ctrl+drag', 'Box select'],
  ['Double-click tile', 'Apply tile to faces'],
  ['Repeat U/V', 'Live tile wrap on faces'],
  ['B / E / I / F', 'Pixel brush tools (paint mode)'],
  ['Ctrl+Z / Ctrl+Y', 'Undo / Redo'],
  ['?', 'Toggle this help'],
];

export function HotkeyHelpOverlay({ open, onClose }: HotkeyHelpOverlayProps) {
  if (!open) return null;
  return (
    <div className="app-modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="app-modal app-modal-wide"
        role="dialog"
        aria-labelledby="hotkeys-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="app-modal-header">
          <h2 id="hotkeys-title">Keyboard shortcuts</h2>
          <button type="button" className="outliner-icon" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>
        <div className="hotkey-columns">
          <section>
            <h3>Model</h3>
            <dl className="hotkey-list">
              {MODEL_KEYS.map(([key, label]) => (
                <div key={`${key}-${label}`}>
                  <dt>{key}</dt>
                  <dd>{label}</dd>
                </div>
              ))}
            </dl>
          </section>
          <section>
            <h3>UV / Pixel</h3>
            <dl className="hotkey-list">
              {UV_KEYS.map(([key, label]) => (
                <div key={`${key}-${label}`}>
                  <dt>{key}</dt>
                  <dd>{label}</dd>
                </div>
              ))}
            </dl>
          </section>
        </div>
      </div>
    </div>
  );
}
