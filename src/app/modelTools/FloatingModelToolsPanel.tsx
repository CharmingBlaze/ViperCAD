import { useState } from 'react';
import { FloatingPanel } from '@/app/FloatingPanel';
import { BlenderIcon } from '@/components/BlenderIcon';

export type FloatingModelToolsPanelProps = {
  hasSelection: boolean;
  selectedObjectCount: number;
  selectedFaceCount: number;
  isEditMode: boolean;
  onFlipHorizontal: (mirrorAcrossWorld?: boolean) => void;
  onFlipVertical: () => void;
  onFlipDepth: () => void;
  onFlipNormals: () => void;
  onDuplicateAndMirror: (linked?: boolean) => void;
  onAddMirrorModifier?: () => void;
  onRotateDegrees: (axis: 'x' | 'y' | 'z', degrees: number) => void;
  onCenterAxis: (axis: 'x' | 'y' | 'z') => void;
  onSnapToGround: () => void;
  onSolidBoolean?: (op: 'difference' | 'union' | 'intersection', keepCutters: boolean) => void;
  onClose: () => void;
};

export function FloatingModelToolsPanel({
  hasSelection,
  selectedObjectCount,
  selectedFaceCount,
  isEditMode,
  onFlipHorizontal,
  onFlipVertical,
  onFlipDepth,
  onFlipNormals,
  onDuplicateAndMirror,
  onAddMirrorModifier,
  onRotateDegrees,
  onCenterAxis,
  onSnapToGround,
  onSolidBoolean,
  onClose,
}: FloatingModelToolsPanelProps) {
  const [acrossWorld, setAcrossWorld] = useState(false);
  const [customAngle, setCustomAngle] = useState(45);
  const [rotAxis, setRotAxis] = useState<'x' | 'y' | 'z'>('y');
  const [keepCutters, setKeepCutters] = useState(false);

  const selectionLabel = isEditMode
    ? selectedFaceCount > 0
      ? `${selectedFaceCount} face${selectedFaceCount === 1 ? '' : 's'}`
      : 'Edit Mode'
    : selectedObjectCount > 0
      ? `${selectedObjectCount} object${selectedObjectCount === 1 ? '' : 's'}`
      : null;

  return (
    <FloatingPanel
      title={selectionLabel ? `Flip & Mirror (${selectionLabel})` : 'Flip & Mirror Tools'}
      storageKey="vipercad.floating_model_tools_pos"
      defaultPosition={{ x: 72, y: 92 }}
      defaultSize={{ width: 280 }}
      onClose={onClose}
    >
      <div className="model-floating-tools-content" style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
        {/* Flip Section */}
        <div className="model-quick-section">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.35rem' }}>
            <span style={{ fontSize: '0.72rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-muted, #888)' }}>
              Flip Model
            </span>
            {!isEditMode && (
              <label style={{ fontSize: '0.72rem', display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'pointer', color: 'var(--text-muted, #888)' }}>
                <input
                  type="checkbox"
                  checked={acrossWorld}
                  onChange={(e) => setAcrossWorld(e.target.checked)}
                />
                World X=0
              </label>
            )}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.35rem', marginBottom: '0.35rem' }}>
            <button
              type="button"
              className="tool primary"
              disabled={!hasSelection}
              onClick={() => onFlipHorizontal(acrossWorld)}
              title={acrossWorld ? 'Flip horizontally across world center X=0' : 'Flip horizontally in place (Scale X × -1)'}
              style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, fontWeight: 500 }}
            >
              <BlenderIcon name="arrow_leftright" size={14} />
              Flip H (X)
            </button>
            <button
              type="button"
              className="tool primary"
              disabled={!hasSelection}
              onClick={onFlipVertical}
              title="Flip vertically (Scale Y × -1)"
              style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, fontWeight: 500 }}
            >
              <span style={{ display: 'inline-flex', transform: 'rotate(90deg)' }}>
                <BlenderIcon name="arrow_leftright" size={14} />
              </span>
              Flip V (Y)
            </button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.35rem' }}>
            <button
              type="button"
              className="tool"
              disabled={!hasSelection}
              onClick={onFlipDepth}
              title="Flip front-to-back depth (Scale Z × -1)"
            >
              Flip Z (Depth)
            </button>
            <button
              type="button"
              className="tool"
              disabled={!hasSelection}
              onClick={onFlipNormals}
              title="Reverse surface face normals and winding"
            >
              Flip Normals
            </button>
          </div>
        </div>

        {/* Copy to Other Side Flipped Section */}
        <div className="model-quick-section" style={{ borderTop: '1px solid var(--border-subtle, #333)', paddingTop: '0.5rem' }}>
          <div style={{ fontSize: '0.72rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-muted, #888)', marginBottom: '0.35rem' }}>
            Copy to Next Side Flipped
          </div>

          <button
            type="button"
            className="tool primary"
            disabled={!hasSelection}
            onClick={() => onDuplicateAndMirror(false)}
            title={isEditMode ? 'Duplicate selected faces and mirror them to opposite side across X=0' : 'Duplicate selected objects and place on opposite side of world center X=0 with flipped scale'}
            style={{ width: '100%', marginBottom: '0.35rem', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, fontWeight: 600 }}
          >
            <BlenderIcon name="mod_mirror" size={14} />
            {isEditMode ? 'Copy Faces to Opposite Side (±X)' : 'Duplicate & Mirror to Other Side (±X)'}
          </button>

          {!isEditMode && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.35rem', marginBottom: '0.35rem' }}>
              <button
                type="button"
                className="tool"
                disabled={!hasSelection}
                onClick={() => onDuplicateAndMirror(true)}
                title="Create a linked mirror instance (modifying original updates both sides)"
                style={{ fontSize: '0.76rem' }}
              >
                Linked Instance
              </button>
              {onAddMirrorModifier && (
                <button
                  type="button"
                  className="tool"
                  disabled={!hasSelection}
                  onClick={onAddMirrorModifier}
                  title="Add procedural Mirror Modifier across X"
                  style={{ fontSize: '0.76rem' }}
                >
                  Mirror Modifier
                </button>
              )}
            </div>
          )}
        </div>

        {/* Rotate by Degrees Section */}
        <div className="model-quick-section" style={{ borderTop: '1px solid var(--border-subtle, #333)', paddingTop: '0.5rem' }}>
          <div style={{ fontSize: '0.72rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-muted, #888)', marginBottom: '0.35rem' }}>
            Rotate by Degrees
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.25rem', marginBottom: '0.35rem' }}>
            <button
              type="button"
              className="tool"
              disabled={!hasSelection}
              onClick={() => onRotateDegrees('y', 90)}
              title="Turn 90° clockwise around Y axis"
            >
              Turn 90°
            </button>
            <button
              type="button"
              className="tool"
              disabled={!hasSelection}
              onClick={() => onRotateDegrees('y', 180)}
              title="Turn 180° around Y axis"
            >
              Turn 180°
            </button>
            <button
              type="button"
              className="tool"
              disabled={!hasSelection}
              onClick={() => onRotateDegrees('x', 90)}
              title="Pitch 90° around X axis"
            >
              Pitch 90°
            </button>
            <button
              type="button"
              className="tool"
              disabled={!hasSelection}
              onClick={() => onRotateDegrees('z', 90)}
              title="Roll 90° around Z axis"
            >
              Roll 90°
            </button>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
            <input
              type="number"
              className="uv-text"
              value={customAngle}
              onChange={(e) => setCustomAngle(Number(e.target.value) || 0)}
              style={{ width: '56px', padding: '2px 6px', fontSize: '0.8rem' }}
              aria-label="Custom angle in degrees"
            />
            <select
              value={rotAxis}
              onChange={(e) => setRotAxis(e.target.value as 'x' | 'y' | 'z')}
              className="tool"
              style={{ padding: '2px 4px', fontSize: '0.78rem' }}
              aria-label="Rotation axis"
            >
              <option value="y">Axis Y</option>
              <option value="x">Axis X</option>
              <option value="z">Axis Z</option>
            </select>
            <button
              type="button"
              className="tool"
              disabled={!hasSelection}
              onClick={() => onRotateDegrees(rotAxis, customAngle)}
              style={{ flex: 1 }}
            >
              Rotate
            </button>
          </div>
        </div>

        {/* Center & Align Section */}
        <div className="model-quick-section" style={{ borderTop: '1px solid var(--border-subtle, #333)', paddingTop: '0.5rem' }}>
          <div style={{ fontSize: '0.72rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-muted, #888)', marginBottom: '0.35rem' }}>
            Center & Ground
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.35rem' }}>
            <button
              type="button"
              className="tool"
              disabled={!hasSelection}
              onClick={() => onCenterAxis('x')}
              title="Center model horizontally on symmetry axis X=0"
            >
              Center on X=0
            </button>
            <button
              type="button"
              className="tool"
              disabled={!hasSelection}
              onClick={onSnapToGround}
              title="Snap bottom of model to floor ground level Y=0"
            >
              Snap to Floor (Y=0)
            </button>
          </div>
        </div>

        {/* Solid / Boolean Operations (manifold-3d) */}
        {onSolidBoolean && !isEditMode && (
          <div className="model-quick-section" style={{ borderTop: '1px solid var(--border-subtle, #333)', paddingTop: '0.5rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.35rem' }}>
              <span style={{ fontSize: '0.72rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-muted, #888)' }}>
                CAD Booleans (Solid)
              </span>
              <label style={{ fontSize: '0.72rem', display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'pointer', color: 'var(--text-muted, #888)' }}>
                <input
                  type="checkbox"
                  checked={keepCutters}
                  onChange={(e) => setKeepCutters(e.target.checked)}
                />
                Keep Cutters
              </label>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.35rem' }}>
              <button
                type="button"
                className="tool primary"
                disabled={selectedObjectCount < 2}
                onClick={() => onSolidBoolean('difference', keepCutters)}
                title="Subtract secondary object(s) from target object (drill holes / carving)"
                style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 4, fontWeight: 500 }}
              >
                <BlenderIcon name="mod_boolean" size={14} />
                Cut
              </button>
              <button
                type="button"
                className="tool"
                disabled={selectedObjectCount < 2}
                onClick={() => onSolidBoolean('union', keepCutters)}
                title="Fuse objects together into a single watertight solid"
                style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 4, fontWeight: 500 }}
              >
                Union
              </button>
              <button
                type="button"
                className="tool"
                disabled={selectedObjectCount < 2}
                onClick={() => onSolidBoolean('intersection', keepCutters)}
                title="Keep only the intersecting volume"
                style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 4, fontWeight: 500 }}
              >
                Intersect
              </button>
            </div>
            {selectedObjectCount < 2 && (
              <div style={{ fontSize: '0.68rem', color: 'var(--text-muted, #777)', marginTop: '0.25rem', fontStyle: 'italic' }}>
                Select 2 or more objects to use Booleans (active object is target).
              </div>
            )}
          </div>
        )}
      </div>
    </FloatingPanel>
  );
}
