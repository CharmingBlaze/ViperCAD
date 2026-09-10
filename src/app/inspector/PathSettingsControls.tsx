import type { ModelDocument } from '@/core/document/types';
import type { CurveOperation } from '@/core/curves/CurveOperation';
import type { CurveSweepCapStyle } from '@/core/mesh/builders/CurveSweepBuilder';

export type PathSettingsValue = Pick<
  CurveOperation,
  | 'pathOutput'
  | 'pathStartCap'
  | 'pathEndCap'
  | 'pathRadiusScale'
  | 'pathRadialSegments'
  | 'startScale'
  | 'endScale'
  | 'pathOffset'
  | 'twist'
  | 'pathSpacing'
  | 'pathProfile'
  | 'profileWidth'
  | 'profileHeight'
  | 'pathChainAlternating'
  | 'pathCardCrossed'
  | 'pathDistributionMode'
  | 'pathCount'
  | 'pathStartPadding'
  | 'pathEndPadding'
  | 'pathRandomScale'
  | 'pathRotation'
  | 'pathRandomRotation'
  | 'pathAlternateRotation'
  | 'pathMirrorAlternate'
  | 'pathSeed'
  | 'pathKeepInstances'
  | 'pathSourceObjectId'
>;

type Props = {
  value: PathSettingsValue;
  document: ModelDocument;
  currentObjectId?: string | null;
  onChange: (patch: Partial<PathSettingsValue>) => void;
  /** Arms the curve tool after the user has chosen an output/settings preset. */
  onStartDrawing?: () => void;
};

const CAPS: CurveSweepCapStyle[] = ['flat', 'round', 'pointed', 'open'];

export function PathSettingsControls({
  value,
  document,
  currentObjectId,
  onChange,
  onStartDrawing,
}: Props) {
  const capOutput =
    value.pathOutput === 'tube' ||
    value.pathOutput === 'vine' ||
    value.pathOutput === 'rope' ||
    value.pathOutput === 'profile-sweep';
  const distributed =
    value.pathOutput === 'cards' || value.pathOutput === 'object-array';
  const repeated =
    value.pathOutput === 'chain' || value.pathOutput === 'cards' || value.pathOutput === 'object-array';
  const sourceObjects = [...document.objects.values()].filter(
    (object) => object.id !== currentObjectId && object.meshId,
  );

  return (
    <div className="path-settings-panel">
      <div className="simple-texture-card-heading">
        <strong>PATH SETTINGS</strong>
        <span>Live procedural output</span>
      </div>
      <PathOutputPreview output={value.pathOutput} />
      <label className="uv-field">
        <span>Path output</span>
        <select
          className="uv-select"
          aria-label="Path output"
          value={value.pathOutput}
          onChange={(event) => {
            const pathOutput = event.target.value as PathSettingsValue['pathOutput'];
            if (pathOutput === 'rope' && value.twist === 0) {
              onChange({ pathOutput, twist: 360 });
              return;
            }
            if (pathOutput === 'cards') {
              onChange({
                pathOutput,
                pathCardCrossed: true,
                profileWidth: value.profileWidth === 1 ? 0.75 : value.profileWidth,
                profileHeight: value.profileHeight === 1 ? 1.6 : value.profileHeight,
                pathSpacing: value.pathSpacing > 1.2 ? 0.65 : value.pathSpacing,
                pathRadialSegments: Math.max(value.pathRadialSegments, 6),
              });
              return;
            }
            onChange({ pathOutput });
          }}
        >
          <option value="tube">Tube</option>
          <option value="ribbon">Ribbon</option>
          <option value="chain">Chain</option>
          <option value="vine">Vine</option>
          <option value="rope">Rope</option>
          <option value="cards">2D Cards</option>
          <option value="object-array">Object Array</option>
          <option value="profile-sweep">Profile Sweep</option>
        </select>
      </label>
      {onStartDrawing && (
        <button
          type="button"
          className="tool primary path-start-draw"
          onClick={onStartDrawing}
        >
          Start drawing {pathOutputLabel(value.pathOutput)}
        </button>
      )}

      {capOutput && (
        <>
          <CapButtons label="Start cap" selected={value.pathStartCap} onChange={(pathStartCap) => onChange({ pathStartCap })} />
          <CapButtons label="End cap" selected={value.pathEndCap} onChange={(pathEndCap) => onChange({ pathEndCap })} />
          <Range label="Radius" display={`${Math.round(value.pathRadiusScale * 100)}%`} value={value.pathRadiusScale} min={0.25} max={3} step={0.05} onChange={(pathRadiusScale) => onChange({ pathRadiusScale })} />
          <Range label="Round sides" display={String(value.pathRadialSegments)} value={value.pathRadialSegments} min={3} max={24} step={1} onChange={(pathRadialSegments) => onChange({ pathRadialSegments })} />
        </>
      )}

      <Range label="Start width" display={`${Math.round(value.startScale * 100)}%`} value={value.startScale} min={0.05} max={3} step={0.05} onChange={(startScale) => onChange({ startScale })} />
      <Range label="End width" display={`${Math.round(value.endScale * 100)}%`} value={value.endScale} min={0.05} max={3} step={0.05} onChange={(endScale) => onChange({ endScale })} />
      <Range label="Offset" display={value.pathOffset.toFixed(2)} value={value.pathOffset} min={-4} max={4} step={0.05} onChange={(pathOffset) => onChange({ pathOffset })} />

      {(value.pathOutput === 'rope' || value.pathOutput === 'profile-sweep') && (
        <Range label="Twist" display={`${Math.round(value.twist)}°`} value={value.twist} min={-1080} max={1080} step={5} onChange={(twist) => onChange({ twist })} />
      )}
      {repeated && (
        <Range label="Spacing" display={`${value.pathSpacing.toFixed(2)} units`} value={value.pathSpacing} min={0.1} max={8} step={0.1} onChange={(pathSpacing) => onChange({ pathSpacing })} />
      )}

      {distributed && (
        <section className="path-settings-subsection">
          <div className="simple-texture-card-heading">
            <strong>DISTRIBUTION</strong><span>Deterministic</span>
          </div>
          <div className="uv-btn-grid uv-btn-grid-3">
            {(['spacing', 'count', 'fit'] as const).map((mode) => (
              <button
                type="button"
                key={mode}
                className={`tool${value.pathDistributionMode === mode ? ' is-active' : ''}`}
                onClick={() => onChange({ pathDistributionMode: mode })}
              >
                {mode[0]!.toUpperCase() + mode.slice(1)}
              </button>
            ))}
          </div>
          {value.pathDistributionMode === 'count' && (
            <Range label="Count" display={String(value.pathCount)} value={value.pathCount} min={1} max={200} step={1} onChange={(pathCount) => onChange({ pathCount })} />
          )}
          <Range label="Start padding" display={value.pathStartPadding.toFixed(2)} value={value.pathStartPadding} min={0} max={8} step={0.1} onChange={(pathStartPadding) => onChange({ pathStartPadding })} />
          <Range label="End padding" display={value.pathEndPadding.toFixed(2)} value={value.pathEndPadding} min={0} max={8} step={0.1} onChange={(pathEndPadding) => onChange({ pathEndPadding })} />
          <Range label="Rotation" display={`${Math.round(value.pathRotation)}°`} value={value.pathRotation} min={-180} max={180} step={1} onChange={(pathRotation) => onChange({ pathRotation })} />
          <Range label="Random rotation" display={`±${Math.round(value.pathRandomRotation)}°`} value={value.pathRandomRotation} min={0} max={180} step={1} onChange={(pathRandomRotation) => onChange({ pathRandomRotation })} />
          <Range label="Random scale" display={`±${Math.round(value.pathRandomScale * 100)}%`} value={value.pathRandomScale} min={0} max={1} step={0.01} onChange={(pathRandomScale) => onChange({ pathRandomScale })} />
          <Range label="Seed" display={String(value.pathSeed)} value={value.pathSeed} min={1} max={9999} step={1} onChange={(pathSeed) => onChange({ pathSeed })} />
          <Check label="Alternate rotation 90°" checked={value.pathAlternateRotation} onChange={(pathAlternateRotation) => onChange({ pathAlternateRotation })} />
          <Check label="Mirror alternating pieces" checked={value.pathMirrorAlternate} onChange={(pathMirrorAlternate) => onChange({ pathMirrorAlternate })} />
          <Check label="Keep procedural layout" checked={value.pathKeepInstances} onChange={(pathKeepInstances) => onChange({ pathKeepInstances })} />
        </section>
      )}

      {value.pathOutput === 'chain' && (
        <Check label="Alternate links 90°" checked={value.pathChainAlternating} onChange={(pathChainAlternating) => onChange({ pathChainAlternating })} />
      )}
      {value.pathOutput === 'cards' && (
        <>
          <Check label="Crossed foliage cards" checked={value.pathCardCrossed} onChange={(pathCardCrossed) => onChange({ pathCardCrossed })} />
          <Range label="Card width" display={`${Math.round(value.profileWidth * 100)}%`} value={value.profileWidth} min={0.25} max={4} step={0.05} onChange={(profileWidth) => onChange({ profileWidth })} />
          <Range label="Card height" display={`${Math.round(value.profileHeight * 100)}%`} value={value.profileHeight} min={0.25} max={4} step={0.05} onChange={(profileHeight) => onChange({ profileHeight })} />
          <Range label="Vertical detail" display={String(Math.max(1, Math.round(value.pathRadialSegments / 2)))} value={value.pathRadialSegments} min={2} max={12} step={1} onChange={(pathRadialSegments) => onChange({ pathRadialSegments })} />
          <p className="uv-hint">
            Upright tapered cards follow the path with pinched tips. Cards are built two-sided for reliable visibility; crossed mode makes an X-shaped foliage cluster at each point.
          </p>
        </>
      )}
      {value.pathOutput === 'object-array' && (
        <>
          <label className="uv-field">
            <span>Array source</span>
            <select
              className="uv-select"
              aria-label="Path array source"
              value={value.pathSourceObjectId ?? ''}
              onChange={(event) => onChange({ pathSourceObjectId: event.target.value || null })}
            >
              <option value="">Built-in box</option>
              {sourceObjects.map((object) => (
                <option key={object.id} value={object.id}>{object.name}</option>
              ))}
            </select>
          </label>
          <p className="uv-hint">
            Copies follow the curve’s direction. Rotation rolls them around the path; mirrored alternating copies keep correct lighting.
          </p>
        </>
      )}
      {value.pathOutput === 'profile-sweep' && (
        <>
          <div className="path-settings-label">Profile</div>
          <div className="uv-btn-grid uv-btn-grid-4">
            {(['round', 'square', 'rectangle', 'rail'] as const).map((profile) => (
              <button
                key={profile}
                type="button"
                className={`tool${value.pathProfile === profile ? ' is-active' : ''}`}
                onClick={() => onChange({ pathProfile: profile })}
              >
                {profile[0]!.toUpperCase() + profile.slice(1)}
              </button>
            ))}
          </div>
          <Range label="Profile width" display={`${Math.round(value.profileWidth * 100)}%`} value={value.profileWidth} min={0.1} max={4} step={0.05} onChange={(profileWidth) => onChange({ profileWidth })} />
          <Range label="Profile height" display={`${Math.round(value.profileHeight * 100)}%`} value={value.profileHeight} min={0.1} max={4} step={0.05} onChange={(profileHeight) => onChange({ profileHeight })} />
        </>
      )}
      <p className="uv-hint">
        All settings stay editable after creation and rebuild immediately when the source curve changes.
      </p>
    </div>
  );
}

function PathOutputPreview({ output }: { output: PathSettingsValue['pathOutput'] }) {
  return (
    <div className="path-output-preview" aria-label={`${pathOutputLabel(output)} preview`}>
      <svg viewBox="0 0 180 42" role="img" aria-hidden="true">
        <path className="path-preview-guide" d="M8 29 C38 5 62 37 91 20 S140 7 172 24" />
        {output === 'chain' && [28, 52, 77, 103, 129, 154].map((x, index) => (
          <ellipse key={x} className="path-preview-chain" cx={x} cy={index % 2 ? 18 : 22} rx="10" ry="5" transform={`rotate(${index % 2 ? -32 : 32} ${x} ${index % 2 ? 18 : 22})`} />
        ))}
        {output === 'rope' && [-3, 0, 3].map((offset) => (
          <path key={offset} className="path-preview-rope" d={`M8 ${29 + offset} C38 ${5 + offset} 62 ${37 + offset} 91 ${20 + offset} S140 ${7 + offset} 172 ${24 + offset}`} />
        ))}
        {output === 'cards' && [32, 68, 104, 140].map((x, index) => (
          <path key={x} className="path-preview-card" d={`M${x - 5} ${index % 2 ? 27 : 25} L${x} ${index % 2 ? 8 : 10} L${x + 5} ${index % 2 ? 27 : 25} Z`} />
        ))}
        {output === 'object-array' && [28, 61, 96, 132, 160].map((x, index) => (
          <rect
            key={x}
            className="path-preview-solid"
            x={x - 6}
            y={index % 2 ? 16 : 18}
            width="12"
            height="8"
            rx="1"
            transform={`rotate(${index % 2 ? -24 : 24} ${x} ${index % 2 ? 20 : 22})`}
          />
        ))}
        {output === 'vine' && [45, 82, 121, 153].map((x, index) => (
          <ellipse key={x} className="path-preview-leaf" cx={x} cy={index % 2 ? 13 : 28} rx="5" ry="2.5" transform={`rotate(${index % 2 ? -28 : 28} ${x} ${index % 2 ? 13 : 28})`} />
        ))}
        {output === 'ribbon' && <path className="path-preview-ribbon" d="M8 25 C38 1 62 33 91 16 S140 3 172 20 L172 29 C140 12 118 36 91 25 S38 10 8 34 Z" />}
        {(output === 'tube' || output === 'profile-sweep') && <path className="path-preview-solid" d="M8 29 C38 5 62 37 91 20 S140 7 172 24" />}
      </svg>
      <span>{pathOutputLabel(output)} · choose settings, then draw</span>
    </div>
  );
}

function pathOutputLabel(output: PathSettingsValue['pathOutput']): string {
  return output === 'cards' ? '2D Cards' : output === 'object-array' ? 'Object Array' : output === 'profile-sweep' ? 'Profile Sweep' : `${output[0]!.toUpperCase()}${output.slice(1)}`;
}

function CapButtons({
  label,
  selected,
  onChange,
}: {
  label: string;
  selected: CurveSweepCapStyle;
  onChange: (value: CurveSweepCapStyle) => void;
}) {
  return (
    <>
      <div className="path-settings-label">{label}</div>
      <div className="uv-btn-grid uv-btn-grid-4">
        {CAPS.map((cap) => (
          <button
            type="button"
            key={cap}
            className={`tool${selected === cap ? ' is-active' : ''}`}
            onClick={() => onChange(cap)}
          >
            {cap}
          </button>
        ))}
      </div>
    </>
  );
}

function Range({
  label,
  display,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  display: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="uv-field path-setting-range">
      <span>{label}<output>{display}</output></span>
      <input className="uv-range" type="range" min={min} max={max} step={step} value={value} onChange={(event) => onChange(Number(event.target.value))} />
    </label>
  );
}

function Check({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="uv-check">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      {label}
    </label>
  );
}
