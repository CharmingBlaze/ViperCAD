type HotkeyHelpOverlayProps = {
  open: boolean;
  onClose: () => void;
};

const MODEL_KEYS: ReadonlyArray<readonly [string, string]> = [
  ['G / R / S', 'Move / Rotate / Scale'],
  ['Ctrl', 'Hold to snap G/R/S (increment, angle, vertices)'],
  ['Alt+Z', 'X-Ray — see and select through the mesh'],
  ['1 / 2 / 3', 'Vertex / Edge / Face mode'],
  ['Ctrl+= / Ctrl+-', 'Grow / shrink component selection'],
  ['Ctrl+L', 'Select connected components'],
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
  ['F', 'Fill — make a face or fill a hole'],
  ['M', 'Merge vertices · collapse edges / faces'],
  ['Numpad .', 'Frame selection (F in Object mode)'],
  ['Home', 'Frame all'],
  ['Shift+Home', 'Reset view'],
  ['Delete', 'Delete selection'],
  ['Ctrl+Z / Ctrl+Y', 'Undo / Redo'],
  ['Ctrl+C / Ctrl+V', 'Copy / Paste objects, groups, or faces'],
  ['Ctrl+G / Ctrl+Shift+G', 'Group / Ungroup objects'],
  ['Double-click object', 'Select parent group'],
  ['Tab', 'Maximize viewport under cursor'],
  ['Shift+M', 'Flip & Mirror floating tools panel'],
  ['Shift+Space', 'Zen mode — hide side chrome'],
  ['Ctrl+K', 'Command palette'],
  ['Ctrl+,', 'Properties'],
  ['LMB drag', 'Orbit (perspective) · pan (ortho)'],
  ['RMB drag', 'Pan the view'],
  ['Wheel', 'Zoom · Shift pan · trackpad pinch / two-finger pan'],
  ['Alt+drag', 'Laptop orbit · Shift+Alt pan · Ctrl+Alt zoom'],
  ['MMB', 'Orbit · Shift pan · Ctrl zoom (ortho pans)'],
  ['LMB click', 'Select · tools · gizmo'],
  ['?', 'Toggle this help'],
];

const UV_KEYS: ReadonlyArray<readonly [string, string]> = [
  ['Tab', 'Hide 3D view / restore 3D | UV split'],
  ['N', 'Hide / show the UV inspector'],
  ['3D · LMB drag', 'Orbit · click picks a face'],
  ['3D · RMB drag', 'Pan the view'],
  ['3D · Wheel', 'Zoom · trackpad pinch / two-finger pan'],
  ['3D · Alt+drag', 'LightWave orbit · Shift+Alt pan · Ctrl+Alt zoom'],
  ['3D · MMB', 'Orbit · Shift pan · Ctrl zoom'],
  ['UV · Alt+drag', 'LightWave pan · Ctrl+Alt zoom · MMB pan'],
  ['UV · Wheel', 'Zoom · Shift pan'],
  ['Face / Point / Island', 'UV selection modes'],
  ['G / S / R', 'Move / Scale / Rotate UVs'],
  ['Shift+H / Shift+V', 'Flip UVs Horizontal / Vertical'],
  ['Ctrl+Shift+C / V', 'Copy UVs / Paste & Flip'],
  ['Ctrl+drag', 'Box select'],
  ['Double-click tile', 'Apply tile to faces'],
  ['Repeat U/V', 'Live tile wrap on faces'],
  ['B / E / I / F', 'Pixel brush tools (paint mode)'],
  ['Ctrl+Z / Ctrl+Y', 'Undo / Redo'],
  ['Ctrl+K', 'Command palette'],
  ['Ctrl+,', 'Properties'],
  ['?', 'Toggle this help'],
] as const;

const BLOCKOUT_KEYS = [
  ['V', 'Flat silhouette (any view)'],
  ['Q', 'Square solid · live thickness'],
  ['O', 'Round · low-poly ellipse (6/8/12 sides)'],
  ['1 / 2 / 3', 'Vertex / Edge / Face'],
  ['G / R / S', 'Move / Rotate / Scale'],
  ['Click start', 'Close the loop (Flat / Square)'],
  ['Enter', 'Set width, then Enter again to commit'],
  ['C', 'Toggle Mirror X'],
  ['Esc', 'Clear stroke'],
  ['Backspace', 'Pop last point'],
  ['Wheel', 'Live thickness (Shift/Ctrl still zooms)'],
  ['Delete', 'Delete selected mesh'],
  ['Drop image', 'Front or Side pane as blueprint'],
  ['F / M', 'Fill hole · merge (edit mode)'],
  ['Numpad . / Home', 'Frame selection / frame all'],
  ['?', 'Toggle this help'],
] as const;

const TERRAIN_KEYS = [
  ['1', 'Sculpt brush'],
  ['2', 'Place / scatter objects'],
  ['3', 'Rivers and paths'],
  ['G / R / S', 'Move / Rotate / Scale selected props · Ctrl snap'],
  ['LMB', 'Sculpt, place, or draw on the terrain'],
  ['Alt+drag / MMB', 'Orbit · Shift pan · Ctrl zoom'],
  ['RMB drag', 'Pan the view'],
  ['Wheel / [ / ]', 'Brush size (Shift pan · Ctrl zoom)'],
  ['Shift+LMB', 'Invert raise / lower / noise'],
  ['Ctrl+click', 'Sample flatten height'],
  ['LMB empty space', 'Orbit when the brush misses the ground'],
  ['F / Home', 'Frame selection / frame all'],
  ['?', 'Toggle this help'],
] as const;

const ANIMATE_KEYS = [
  ['Space', 'Play / pause'],
  ['G / R / U', 'Pose Move / Rotate / Universal'],
  ['I', 'Keyframe selected bone'],
  ['Shift+I', 'Keyframe all bones'],
  ['Delete', 'Remove key at playhead (Animate) · delete bone (Rig)'],
  ['← / →', 'Previous / next keyframe'],
  ['↑ / ↓', 'Previous / next bone (Rig) · step frames (Animate, Shift ×10)'],
  ['M', 'Select mirrored L/R bone (Rig)'],
  ['[ / ] / wheel', 'Weight brush smaller / larger'],
  ['LMB', 'Pick bone · drag head/tail in Rig · drag to pose · paint weights'],
  ['Ctrl+LMB', 'Subtract weight while painting'],
  ['Alt+drag / MMB', 'Orbit · Shift pan · Ctrl zoom'],
  ['RMB drag', 'Pan the view'],
  ['F / Home', 'Frame selection / frame all'],
  ['?', 'Toggle this help'],
];

const TILESET_NOTES: ReadonlyArray<string> = [
  'Tiles snap to a grid on the current work plane. You cannot grab the grid as a free 3D gizmo.',
  'Floor, Front, and Side are world-aligned. Surface uses the face under the cursor, including walls, extra storeys, and offsets.',
  'Click anywhere on the plane — the overlay follows the cursor and is not stuck at the world origin.',
  'To model more than a flat floor: draw on Floor, switch to Front or Side and nudge with + for walls, then hover a face, click Surface, and Lock (L) to keep drawing on that face.',
];

const TILESET_KEYS: ReadonlyArray<readonly [string, string]> = [
  ['Build / Paint', 'Draw new tile geometry · stamp existing faces'],
  ['Floor / Front / Side', 'World planes (1 / 2 / 3)'],
  ['Surface', 'Draw on the hovered face (4)'],
  ['Lock (L)', 'Keep Surface on the current face'],
  ['− / + · [ / ]', 'Move the plane one tile along its normal'],
  ['Shift+Wheel', 'Nudge plane depth'],
  ['B / X / R / F / I', 'Draw / Delete / Replace / Fill / Pick'],
  ['Fill click', 'Place the fill-size ghost · Shift+click floods'],
  ['Join Multi', 'One face for a multi-tile door or window'],
  ['Paint drag', 'Stamp tiles across faces · Stretch U/V · Hint down'],
  ['Single · Stroke · Line · Rect', 'Stamp shapes'],
  ['Q / E', 'Rotate stamp'],
  ['Shift+Q / Shift+E', 'Flip V / Flip U'],
  ['V', 'Snap the work plane to the nearest vertex'],
  ['Alt+click', 'Pick a tile from existing geometry'],
  ['Esc', 'Cancel the current stroke'],
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
          <h2 id="hotkeys-title">Help</h2>
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
          <section>
            <h3>Tileset / Build</h3>
            <div className="help-note">
              {TILESET_NOTES.map((note) => (
                <p key={note}>{note}</p>
              ))}
            </div>
            <dl className="hotkey-list">
              {TILESET_KEYS.map(([key, label]) => (
                <div key={`${key}-${label}`}>
                  <dt>{key}</dt>
                  <dd>{label}</dd>
                </div>
              ))}
            </dl>
          </section>
          <section>
            <h3>Animate</h3>
            <dl className="hotkey-list">
              {ANIMATE_KEYS.map(([key, label]) => (
                <div key={key}>
                  <dt>{key}</dt>
                  <dd>{label}</dd>
                </div>
              ))}
            </dl>
          </section>
          <section>
            <h3>Terrain</h3>
            <dl className="hotkey-list">
              {TERRAIN_KEYS.map(([key, label]) => (
                <div key={key}>
                  <dt>{key}</dt>
                  <dd>{label}</dd>
                </div>
              ))}
            </dl>
          </section>
          <section>
            <h3>Blockout</h3>
            <dl className="hotkey-list">
              {BLOCKOUT_KEYS.map(([key, label]) => (
                <div key={key}>
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
