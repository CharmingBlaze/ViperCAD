import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import type { EditorSession } from '@/core/editor/EditorSession';
import type { SceneObject } from '@/core/document/types';
import type { EditableMesh } from '@/core/mesh/types';
import {
  curveOperationLabel,
  evaluateCurveOperation,
  isWorkflowOperation,
  readCurveOperation,
  serializeCurveOperation,
  type CurveOperation,
} from '@/core/curves/CurveOperation';
import { CapButtons } from '@/app/inspector/PathSettingsControls';
import type { WorkspaceController } from '@/workspace/WorkspaceController';

type Props = {
  session: EditorSession;
  workspace: WorkspaceController;
  object: SceneObject | null;
  mesh: EditableMesh | null;
  onRefresh: () => void;
  /** When true, panel stays visible even if selection mode is face/edge/vert. */
  allowAnySelectionMode?: boolean;
};

type WorkflowHistoryMeta = {
  kind: 'workflow-operation';
  objectId: string;
  name: string;
  afterMesh: EditableMesh;
  afterMetadata: string;
};

type ScrubState = {
  beforeMesh: EditableMesh;
  beforeMetadata: string;
  name: string;
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function WorkflowOperationPanel({
  session,
  object,
  mesh,
  onRefresh,
  allowAnySelectionMode = false,
}: Props) {
  const operation = readCurveOperation(object?.metadata.curveOperation);
  const scrubRef = useRef<ScrubState | null>(null);
  const [radiusDraft, setRadiusDraft] = useState(operation ? String(Number(operation.radius.toFixed(3))) : '');

  useEffect(() => {
    setRadiusDraft(operation ? String(Number(operation.radius.toFixed(3))) : '');
  }, [object?.id, operation?.radius]);

  const selectionOk =
    allowAnySelectionMode || session.selection.state.mode === 'object';

  if (!object || !mesh || !operation || !selectionOk) return null;
  if (!isWorkflowOperation(operation)) return null;
  if (!object.meshId) return null;

  const meshId = object.meshId;

  const applyLive = (next: CurveOperation) => {
    const afterMesh = evaluateCurveOperation(next);
    afterMesh.id = meshId;
    const afterMetadata = serializeCurveOperation(next);
    session.document.meshes.set(meshId, afterMesh);
    object.metadata.curveOperation = afterMetadata;
    session.document.dirty = true;
    session.requestRedraw();
    onRefresh();
    return { afterMesh, afterMetadata };
  };

  const commitHistory = (
    name: string,
    beforeMesh: EditableMesh,
    beforeMetadata: string,
    afterMesh: EditableMesh,
    afterMetadata: string,
  ) => {
    let applied = true;
    session.history.execute({
      name,
      execute: () => {
        if (applied) return;
        session.document.meshes.set(meshId, afterMesh);
        object.metadata.curveOperation = afterMetadata;
        session.document.dirty = true;
        applied = true;
      },
      undo: () => {
        session.document.meshes.set(meshId, beforeMesh);
        object.metadata.curveOperation = beforeMetadata;
        session.document.dirty = true;
        applied = false;
      },
      meta: {
        kind: 'workflow-operation',
        objectId: object.id,
        name,
        afterMesh,
        afterMetadata,
      } satisfies WorkflowHistoryMeta,
    });
  };

  const update = (name: string, patch: Partial<CurveOperation>) => {
    const current = readCurveOperation(object.metadata.curveOperation) ?? operation;
    const next: CurveOperation = { ...current, ...patch, workflowKind: current.workflowKind ?? 'profile-solid' };
    const beforeMesh = session.document.meshes.get(meshId) ?? mesh;
    const beforeMetadata = object.metadata.curveOperation!;
    const { afterMesh, afterMetadata } = applyLive(next);
    commitHistory(name, beforeMesh, beforeMetadata, afterMesh, afterMetadata);
  };

  const beginScrub = (name: string) => {
    if (scrubRef.current) return;
    const liveMesh = session.document.meshes.get(meshId) ?? mesh;
    scrubRef.current = {
      beforeMesh: liveMesh,
      beforeMetadata: object.metadata.curveOperation!,
      name,
    };
  };

  const scrub = (patch: Partial<CurveOperation>) => {
    const current = readCurveOperation(object.metadata.curveOperation) ?? operation;
    const next: CurveOperation = { ...current, ...patch, workflowKind: current.workflowKind ?? 'profile-solid' };
    applyLive(next);
  };

  const endScrub = () => {
    const scrubState = scrubRef.current;
    if (!scrubState) return;
    scrubRef.current = null;
    const afterMesh = session.document.meshes.get(meshId);
    const afterMetadata = object.metadata.curveOperation;
    if (!afterMesh || !afterMetadata) return;
    if (afterMetadata === scrubState.beforeMetadata) return;
    commitHistory(scrubState.name, scrubState.beforeMesh, scrubState.beforeMetadata, afterMesh, afterMetadata);
  };

  const scrubHandlers = (name: string, patchFromValue: (value: number) => Partial<CurveOperation>) => ({
    onPointerDown: () => beginScrub(name),
    onChange: (event: ChangeEvent<HTMLInputElement>) => {
      beginScrub(name);
      scrub(patchFromValue(Number(event.target.value)));
    },
    onPointerUp: endScrub,
    onPointerCancel: endScrub,
  });

  const commitRadius = () => {
    const radius = Number(radiusDraft);
    if (!Number.isFinite(radius)) {
      setRadiusDraft(String(Number(operation.radius.toFixed(3))));
      return;
    }
    const clamped = clamp(radius, 0.01, 2);
    setRadiusDraft(String(Number(clamped.toFixed(3))));
    if (clamped !== operation.radius) update('Resize Blockout', { radius: clamped });
  };

  const isVolume = operation.style === 'profile-solid';
  const depthSlices = clamp(Math.round(operation.pathCount / 2), 1, 6);
  const roundnessPct = Math.round(operation.blobInflation * 100);

  return (
    <section className="uv-section curve-operation-panel">
      <h3 className="uv-section-title">
        Selected · {curveOperationLabel(operation)}
      </h3>
      <p className="uv-meta">
        {object.name} · {operation.points.length} points · live mesh
      </p>

      <div className="path-settings-panel capsule-settings-panel">
        <div className="simple-texture-card-heading">
          <strong>SIZE</strong>
          <span>Drag to reshape the selected mesh</span>
        </div>

        <label className="uv-field">
          <span>Thickness · {operation.radius.toFixed(2)}</span>
          <input
            aria-label="Selected thickness"
            type="range"
            min={0.02}
            max={1.2}
            step={0.01}
            value={operation.radius}
            {...scrubHandlers('Change Thickness', (radius) => ({ radius: clamp(radius, 0.01, 2) }))}
          />
        </label>

        <label className="uv-field">
          <span>Width · {operation.profileWidth.toFixed(2)}</span>
          <input
            aria-label="Selected width scale"
            type="range"
            min={0.25}
            max={2.5}
            step={0.01}
            value={operation.profileWidth}
            {...scrubHandlers('Change Width', (profileWidth) => ({
              profileWidth: clamp(profileWidth, 0.05, 4),
            }))}
          />
        </label>

        <label className="uv-field">
          <span>Height · {operation.profileHeight.toFixed(2)}</span>
          <input
            aria-label="Selected height scale"
            type="range"
            min={0.25}
            max={2.5}
            step={0.01}
            value={operation.profileHeight}
            {...scrubHandlers('Change Height', (profileHeight) => ({
              profileHeight: clamp(profileHeight, 0.05, 4),
            }))}
          />
        </label>

        <label className="uv-field">
          <span>Scale · {operation.startScale.toFixed(2)}</span>
          <input
            aria-label="Selected overall scale"
            type="range"
            min={0.25}
            max={2.5}
            step={0.01}
            value={operation.startScale}
            {...scrubHandlers('Change Scale', (startScale) => {
              const scale = clamp(startScale, 0.05, 4);
              return { startScale: scale };
            })}
          />
        </label>

        {!isVolume && (
          <label className="uv-field">
            <span>Middle scale · {operation.midScale.toFixed(2)}</span>
            <input
              aria-label="Selected middle scale"
              type="range"
              min={0.1}
              max={2.5}
              step={0.01}
              value={operation.midScale}
              {...scrubHandlers('Change Middle Scale', (midScale) => ({
                midScale: clamp(midScale, 0.05, 4),
              }))}
            />
          </label>
        )}

        {!isVolume && (
          <label className="uv-field">
            <span>End scale · {operation.endScale.toFixed(2)}</span>
            <input
              aria-label="Selected end scale"
              type="range"
              min={0.25}
              max={2.5}
              step={0.01}
              value={operation.endScale}
              {...scrubHandlers('Change End Scale', (endScale) => ({
                endScale: clamp(endScale, 0.05, 4),
              }))}
            />
          </label>
        )}

        <label className="uv-field">
          <span>Thickness (exact)</span>
          <input
            className="uv-text"
            aria-label="Selected thickness number"
            type="number"
            min={0.01}
            max={2}
            step={0.01}
            value={radiusDraft}
            onChange={(event) => setRadiusDraft(event.target.value)}
            onBlur={commitRadius}
            onKeyDown={(event) => {
              if (event.key === 'Enter') event.currentTarget.blur();
            }}
          />
        </label>
      </div>

      {isVolume && (
        <div className="path-settings-panel capsule-settings-panel">
          <div className="simple-texture-card-heading">
            <strong>VOLUME</strong>
            <span>Silhouette · quad depth loops</span>
          </div>
          <label className="uv-field">
            <span>Roundness · {roundnessPct}%</span>
            <input
              aria-label="Selected roundness"
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={operation.blobInflation}
              {...scrubHandlers('Change Roundness', (blobInflation) => ({
                blobInflation: clamp(blobInflation, 0, 1),
              }))}
            />
          </label>
          <label className="uv-field">
            <span>Depth slices · {depthSlices}</span>
            <input
              aria-label="Selected depth slices"
              type="range"
              min={1}
              max={6}
              step={1}
              value={depthSlices}
              {...scrubHandlers('Change Depth Slices', (slices) => ({
                pathCount: clamp(Math.round(slices), 1, 6) * 2,
              }))}
            />
          </label>
          <label className="uv-field">
            <span>Outline corners · {Math.max(8, operation.pathRadialSegments * 2)}</span>
            <input
              aria-label="Selected outline corners"
              type="range"
              min={4}
              max={24}
              step={1}
              value={operation.pathRadialSegments}
              {...scrubHandlers('Change Outline Corners', (pathRadialSegments) => ({
                pathRadialSegments: clamp(Math.round(pathRadialSegments), 3, 24),
              }))}
            />
          </label>
        </div>
      )}

      {!isVolume && (
        <div className="path-settings-panel capsule-settings-panel">
          <div className="simple-texture-card-heading">
            <strong>FLOW</strong>
            <span>Continuous cross-section rings</span>
          </div>
          <label className="uv-field">
            <span>Sections · {operation.pathCount}</span>
            <input
              aria-label="Selected flow sections"
              type="range"
              min={2}
              max={12}
              step={1}
              value={operation.pathCount}
              {...scrubHandlers('Change Flow Sections', (pathCount) => ({
                pathCount: clamp(Math.round(pathCount), 2, 12),
              }))}
            />
          </label>
          <label className="uv-field">
            <span>Box sides · {Math.max(4, Math.min(8, Math.round(operation.pathRadialSegments / 2)))}</span>
            <input
              aria-label="Selected flow sides"
              type="range"
              min={8}
              max={16}
              step={2}
              value={operation.pathRadialSegments}
              {...scrubHandlers('Change Flow Sides', (pathRadialSegments) => ({
                pathRadialSegments: clamp(Math.round(pathRadialSegments), 3, 24),
              }))}
            />
          </label>
          <label className="uv-field">
            <span>Twist · {Math.round(operation.twist)}°</span>
            <input
              aria-label="Selected flow twist"
              type="range"
              min={-180}
              max={180}
              step={5}
              value={operation.twist}
              {...scrubHandlers('Change Flow Twist', (twist) => ({
                twist: clamp(twist, -2160, 2160),
              }))}
            />
          </label>
          <CapButtons
            label="Start cap"
            selected={operation.pathStartCap}
            onChange={(pathStartCap) => update('Change Start Cap', { pathStartCap })}
          />
          <CapButtons
            label="End cap"
            selected={operation.pathEndCap}
            onChange={(pathEndCap) => update('Change End Cap', { pathEndCap })}
          />
        </div>
      )}

      <label className="uv-field">
        <span>Resolution</span>
        <select
          className="uv-select"
          aria-label="Selected resolution"
          value={operation.resolution}
          onChange={(event) =>
            update('Change Blockout Resolution', {
              resolution: event.target.value as CurveOperation['resolution'],
            })
          }
        >
          <option value="low">Low-poly</option>
          <option value="medium">Medium</option>
        </select>
      </label>
    </section>
  );
}
