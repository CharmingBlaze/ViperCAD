import { useEffect, useState } from 'react';
import { addVec3, scaleVec3, subVec3, type Vec3 } from '@/core/math/Vec3';
import type { EditorSession } from '@/core/editor/EditorSession';
import type { SceneObject } from '@/core/document/types';
import type { EditableMesh } from '@/core/mesh/types';
import {
  curveOperationLabel,
  defaultBezierHandles,
  evaluateCurveOperation,
  isPathStyle,
  readCurveOperation,
  serializeCurveOperation,
  type CurveOperation,
} from '@/core/curves/CurveOperation';
import { PathSettingsControls } from '@/app/inspector/PathSettingsControls';
import { ExactCoordinateInput } from '@/app/inspector/ExactCoordinateInput';

import type { WorkspaceController } from '@/workspace/WorkspaceController';

type Props = {
  session: EditorSession;
  workspace: WorkspaceController;
  object: SceneObject | null;
  mesh: EditableMesh | null;
  onRefresh: () => void;
};

type CurveHistoryMeta = {
  kind: 'curve-operation';
  objectId: string;
  name: string;
  afterMesh: EditableMesh;
  afterMetadata: string;
};

export function CurveOperationPanel({ session, workspace, object, mesh, onRefresh }: Props) {
  const operation = readCurveOperation(object?.metadata.curveOperation);
  const [radiusDraft, setRadiusDraft] = useState(operation ? String(Number(operation.radius.toFixed(3))) : '');

  useEffect(() => {
    setRadiusDraft(operation ? String(Number(operation.radius.toFixed(3))) : '');
  }, [object?.id, operation?.radius]);

  if (!object || !mesh || !operation || session.selection.state.mode !== 'object') return null;

  const update = (name: string, patch: Partial<CurveOperation>) => {
    const next: CurveOperation = { ...operation, ...patch };
    const beforeMesh = mesh;
    const beforeMetadata = object.metadata.curveOperation!;
    const sourceObject = next.pathSourceObjectId
      ? session.document.objects.get(next.pathSourceObjectId)
      : null;
    const sourceMesh = sourceObject?.meshId
      ? session.document.meshes.get(sourceObject.meshId) ?? null
      : null;
    let afterMesh = evaluateCurveOperation(next, sourceMesh);
    afterMesh.id = beforeMesh.id;
    let afterMetadata = serializeCurveOperation(next);
    let applied = true;
    session.document.meshes.set(beforeMesh.id, afterMesh);
    object.metadata.curveOperation = afterMetadata;
    session.document.dirty = true;
    session.history.execute({
      name,
      execute: () => {
        if (applied) return;
        session.document.meshes.set(beforeMesh.id, afterMesh);
        object.metadata.curveOperation = afterMetadata;
        session.document.dirty = true;
        applied = true;
      },
      undo: () => {
        session.document.meshes.set(beforeMesh.id, beforeMesh);
        object.metadata.curveOperation = beforeMetadata;
        session.document.dirty = true;
        applied = false;
      },
      meta: {
        kind: 'curve-operation',
        objectId: object.id,
        name,
        afterMesh,
        afterMetadata,
      } satisfies CurveHistoryMeta,
      canMerge: (other) => {
        const meta = other.meta as CurveHistoryMeta | undefined;
        return (
          meta?.kind === 'curve-operation' &&
          meta.objectId === object.id &&
          meta.name === name
        );
      },
      merge: (other) => {
        const meta = other.meta as CurveHistoryMeta;
        afterMesh = meta.afterMesh;
        afterMetadata = meta.afterMetadata;
        applied = true;
      },
    });
    session.requestRedraw();
    onRefresh();
  };

  const bake = () => {
    const metadata = object.metadata.curveOperation;
    if (!metadata) return;
    let applied = true;
    delete object.metadata.curveOperation;
    session.document.dirty = true;
    session.history.execute({
      name: 'Convert Curve to Mesh',
      execute: () => {
        if (applied) return;
        delete object.metadata.curveOperation;
        session.document.dirty = true;
        applied = true;
      },
      undo: () => {
        object.metadata.curveOperation = metadata;
        session.document.dirty = true;
        applied = false;
      },
    });
    session.requestRedraw();
    onRefresh();
  };

  const commitRadius = () => {
    const radius = Number(radiusDraft);
    if (!Number.isFinite(radius)) {
      setRadiusDraft(String(Number(operation.radius.toFixed(3))));
      return;
    }
    const clamped = Math.max(0.01, Math.min(2, radius));
    setRadiusDraft(String(Number(clamped.toFixed(3))));
    if (clamped !== operation.radius) update('Resize Curve', { radius: clamped });
  };
  const pathStyle = isPathStyle(operation.style);
  const isLathe = operation.solidMode === 'lathe';

  return (
    <section className="uv-section curve-operation-panel">
      <h3 className="uv-section-title">Active Tool · {curveOperationLabel(operation)}</h3>
      <p className="uv-meta">
        {operation.points.length} control points · live evaluated mesh
      </p>
      <label className="uv-field">
        <span>3D operation</span>
        <select
          className="uv-select"
          aria-label="Curve 3D operation"
          value={operation.solidMode}
          onChange={(event) =>
            update('Change Curve 3D Operation', {
              solidMode: event.target.value as CurveOperation['solidMode'],
              cyclic: event.target.value === 'lathe' ? false : operation.cyclic,
            })
          }
        >
          <option value="extrude">Extrude / Sweep</option>
          <option value="lathe">Lathe / Revolve</option>
        </select>
      </label>
      <label className="uv-field">
        <span>Shape</span>
        <select
          className="uv-select"
          aria-label="Curve shape"
          value={operation.style}
          onChange={(event) => {
            const style = event.target.value as CurveOperation['style'];
            update('Change Curve Shape', {
              style,
              cyclic: operation.cyclic,
              twist: style === 'rope' && operation.twist === 0 ? 360 : operation.twist,
            });
          }}
        >
          <option value="tube">Tube Sweep</option>
          <option value="capsule">Capsule Path</option>
          <option value="ribbon">Ribbon Sweep</option>
          <option value="hair">Hair Path</option>
          <option value="hair-strip">Low-poly Hair Strip</option>
          <option value="rounded-hair">Rounded Hair</option>
          <option value="tapered-tube">Tapered Tube</option>
          <option value="rope">Braided Rope</option>
          <option value="square-sweep">Square Sweep</option>
          <option value="rail-sweep">Rail Sweep</option>
          <option value="soft" disabled={operation.points.length < 3}>Soft Profile</option>
          <option value="sharp" disabled={operation.points.length < 3}>Sharp Profile</option>
        </select>
      </label>
      <label className="uv-field">
        <span>{operation.style === 'tube' ? 'Radius' : 'Thickness'}</span>
        <input
          className="uv-text"
          aria-label="Curve radius"
          type="number"
          min={0.01}
          max={2}
          step={0.01}
          value={radiusDraft}
          onChange={(event) => setRadiusDraft(event.target.value)}
          onBlur={commitRadius}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur();
            if (event.key === 'Escape') {
              setRadiusDraft(String(Number(operation.radius.toFixed(3))));
              event.currentTarget.blur();
            }
          }}
        />
      </label>
      <label className="uv-field">
        <span>Resolution</span>
        <select
          className="uv-select"
          aria-label="Curve resolution"
          value={operation.resolution}
          onChange={(event) =>
            update('Change Curve Resolution', {
              resolution: event.target.value as CurveOperation['resolution'],
            })
          }
        >
          <option value="low">Low-poly</option>
          <option value="medium">Medium</option>
        </select>
      </label>
      {operation.style === 'soft' && (
        <label className="uv-field">
          <span>Blob fullness · {Math.round(operation.blobInflation * 100)}%</span>
          <input
            className="uv-range"
            aria-label="Blob inflation"
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={operation.blobInflation}
            onChange={(event) =>
              update('Change Blob Inflation', {
                blobInflation: Number(event.target.value),
              })
            }
          />
        </label>
      )}
      <label className="uv-field">
        <span>Curve type</span>
        <select
          className="uv-select"
          aria-label="Curve interpolation"
          value={operation.curveType}
          onChange={(event) =>
            update('Change Curve Type', {
              curveType: event.target.value as CurveOperation['curveType'],
              smooth: event.target.value !== 'polyline',
            })
          }
        >
          <option value="polyline">Linear / Polyline</option>
          <option value="catmull-rom">Smooth Spline</option>
          <option value="bezier">Cubic Bézier</option>
        </select>
      </label>
      {isLathe && (
        <div className="curve-lathe-settings">
          <h3 className="uv-section-title">Lathe</h3>
          <label className="uv-field">
            <span>Axis</span>
            <select
              className="uv-select"
              aria-label="Lathe axis"
              value={operation.latheAxis}
              onChange={(event) =>
                update('Change Lathe Axis', {
                  latheAxis: event.target.value as CurveOperation['latheAxis'],
                })
              }
            >
              <option value="x">X axis</option>
              <option value="y">Y axis</option>
              <option value="z">Z axis</option>
            </select>
          </label>
          <label className="uv-field">
            <span>Round sides · {operation.latheSegments}</span>
            <input
              type="range"
              min={8}
              max={64}
              step={1}
              value={operation.latheSegments}
              onChange={(event) =>
                update('Change Lathe Sides', { latheSegments: Number(event.target.value) })
              }
            />
          </label>
          <label className="uv-field">
            <span>Profile detail · {operation.latheProfileRings}</span>
            <input
              type="range"
              min={4}
              max={128}
              step={1}
              value={operation.latheProfileRings}
              onChange={(event) =>
                update('Change Lathe Profile Detail', {
                  latheProfileRings: Number(event.target.value),
                })
              }
            />
          </label>
          <label className="uv-field">
            <span>Profile smoothing · {Math.round(operation.latheSmoothing * 100)}%</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={operation.latheSmoothing}
              onChange={(event) =>
                update('Smooth Lathe Profile', {
                  latheSmoothing: Number(event.target.value),
                })
              }
            />
          </label>
          <label className="uv-field">
            <span>Revolution · {Math.round(operation.latheAngle)}°</span>
            <input
              type="range"
              min={15}
              max={360}
              step={5}
              value={operation.latheAngle}
              onChange={(event) =>
                update('Change Lathe Revolution', {
                  latheAngle: Number(event.target.value),
                })
              }
            />
          </label>
          <label className="uv-check">
            <input
              type="checkbox"
              checked={operation.latheCaps}
              onChange={(event) =>
                update('Toggle Lathe Caps', { latheCaps: event.target.checked })
              }
            />
            Cap profile ends
          </label>
          <p className="uv-hint">
            Edit the source points below; the revolved solid rebuilds immediately.
          </p>
        </div>
      )}
      {pathStyle && !isLathe && (
        <label className="uv-check">
          <input
            type="checkbox"
            checked={operation.cyclic}
            onChange={(event) => update('Toggle Cyclic Curve', { cyclic: event.target.checked })}
          />
          {operation.style === 'capsule'
            ? 'Connect beginning and end'
            : 'Close sweep into a loop'}
        </label>
      )}
      {operation.style === 'capsule' && !isLathe && (
        <div className="path-settings-panel capsule-settings-panel">
          <div className="simple-texture-card-heading">
            <strong>CAPSULE PRECISION</strong>
            <span>Selected curve</span>
          </div>
          <label className="uv-field">
            <span>Round sides · {Math.max(12, operation.pathRadialSegments)}</span>
            <input
              aria-label="Selected capsule round sides"
              type="range"
              min={12}
              max={24}
              step={1}
              value={Math.max(12, operation.pathRadialSegments)}
              onChange={(event) =>
                update('Change Capsule Round Sides', {
                  pathRadialSegments: Number(event.target.value),
                })
              }
            />
          </label>
          <p className="uv-hint">
            Every anchor remains exact while the rounded solid rebuilds live.
          </p>
        </div>
      )}
      {operation.style === 'tube' && !isLathe && (
        <PathSettingsControls
          value={operation}
          document={session.document}
          currentObjectId={object.id}
          onChange={(patch) => update('Change Path Settings', patch)}
        />
      )}
      {pathStyle &&
        !isLathe &&
        operation.style !== 'tube' &&
        operation.style !== 'capsule' && (
        <>
          <h3 className="uv-section-title">Sweep Shape</h3>
          <label className="uv-field">
            <span>Start width · {Math.round(operation.startScale * 100)}%</span>
            <input
              type="range"
              min={0.02}
              max={4}
              step={0.02}
              value={operation.startScale}
              onChange={(event) =>
                update('Change Curve Start Width', { startScale: Number(event.target.value) })
              }
            />
          </label>
          <label className="uv-field">
            <span>End width · {Math.round(operation.endScale * 100)}%</span>
            <input
              type="range"
              min={0.02}
              max={4}
              step={0.02}
              value={operation.endScale}
              onChange={(event) =>
                update('Change Curve End Width', { endScale: Number(event.target.value) })
              }
            />
          </label>
          {(operation.style === 'rope' ||
            operation.style === 'square-sweep' ||
            operation.style === 'rail-sweep') && (
            <label className="uv-field">
              <span>Twist · {Math.round(operation.twist)}°</span>
              <input
                type="range"
                min={-1080}
                max={1080}
                step={5}
                value={operation.twist}
                onChange={(event) =>
                  update('Twist Curve Sweep', { twist: Number(event.target.value) })
                }
              />
            </label>
          )}
          {(operation.style === 'ribbon' ||
            operation.style === 'hair' ||
            operation.style === 'square-sweep' ||
            operation.style === 'rail-sweep') && (
            <>
              <label className="uv-field">
                <span>Profile width · {operation.profileWidth.toFixed(2)}</span>
                <input
                  type="range"
                  min={0.1}
                  max={4}
                  step={0.05}
                  value={operation.profileWidth}
                  onChange={(event) =>
                    update('Resize Curve Profile', { profileWidth: Number(event.target.value) })
                  }
                />
              </label>
              <label className="uv-field">
                <span>Profile height · {operation.profileHeight.toFixed(2)}</span>
                <input
                  type="range"
                  min={0.1}
                  max={4}
                  step={0.05}
                  value={operation.profileHeight}
                  onChange={(event) =>
                    update('Resize Curve Profile', { profileHeight: Number(event.target.value) })
                  }
                />
              </label>
            </>
          )}
        </>
      )}
      <CurvePointEditor
        operation={operation}
        update={update}
        workspace={workspace}
        session={session}
        onRefresh={onRefresh}
      />
      <div className="uv-btn-grid uv-btn-grid-2">
        <button
          type="button"
          className="tool"
          onClick={() =>
            update('Reverse Curve Direction', { points: [...operation.points].reverse() })
          }
        >
          Reverse Direction
        </button>
        <button type="button" className="tool" onClick={bake}>
          Convert to Mesh
        </button>
      </div>
      <p className="uv-hint">
        Parameters remain editable and undoable until Convert to Mesh.
      </p>
    </section>
  );
}

function CurvePointEditor({
  operation,
  update,
  workspace,
  session,
  onRefresh,
}: {
  operation: CurveOperation;
  update: (name: string, patch: Partial<CurveOperation>) => void;
  workspace: WorkspaceController;
  session: EditorSession;
  onRefresh: () => void;
}) {
  const selectedPoint = workspace.selectedCurvePointIndex;
  const setSelectedPoint = (index: number) => workspace.setSelectedCurvePointIndex(index);
  const index = Math.min(selectedPoint, operation.points.length - 1);
  const point = operation.points[index]!;
  const nodeEditActive = workspace.curveNodeEditMode;

  const enterPointEdit = () => {
    workspace.setCurveNodeEditMode(true);
    session.requestRedraw();
    onRefresh();
  };

  const exitPointEdit = () => {
    workspace.setCurveNodeEditMode(false);
    session.requestRedraw();
    onRefresh();
  };

  const setCoordinate = (axis: keyof Vec3, raw: string) => {
    const value = Number(raw);
    if (!Number.isFinite(value) || value === point[axis]) return;
    const nextPoint = { ...point, [axis]: value };
    const delta = subVec3(nextPoint, point);
    const points = operation.points.map((item, pointIndex) =>
      pointIndex === index ? nextPoint : { ...item },
    );
    const handlesIn = operation.handlesIn.map((handle, pointIndex) =>
      pointIndex === index ? addVec3(handle, delta) : { ...handle },
    );
    const handlesOut = operation.handlesOut.map((handle, pointIndex) =>
      pointIndex === index ? addVec3(handle, delta) : { ...handle },
    );
    update('Move Curve Point', { points, handlesIn, handlesOut });
  };

  const insertAfter = () => {
    const nextIndex = index + 1 < operation.points.length
      ? index + 1
      : operation.cyclic
        ? 0
        : index;
    const next = operation.points[nextIndex]!;
    const inserted = nextIndex === index
      ? addVec3(point, v3AxisOffset(operation.radius * 4))
      : addVec3(point, scaleVec3(subVec3(next, point), 0.5));
    const points = [...operation.points];
    points.splice(index + 1, 0, inserted);
    const handles = defaultBezierHandles(points, operation.cyclic);
    update('Insert Curve Point', { points, ...handles });
    setSelectedPoint(index + 1);
  };

  const deletePoint = () => {
    if (operation.points.length <= 2) return;
    const points = operation.points.filter((_point, pointIndex) => pointIndex !== index);
    const handles = defaultBezierHandles(points, operation.cyclic);
    update('Delete Curve Point', { points, ...handles });
    setSelectedPoint(Math.max(0, index - 1));
  };

  return (
    <>
      <h3 className="uv-section-title">Control Points</h3>
      <div className="uv-btn-grid uv-btn-grid-2">
        <button
          type="button"
          className={`tool${nodeEditActive ? ' is-active primary' : ''}`}
          onClick={() => (nodeEditActive ? exitPointEdit() : enterPointEdit())}
          aria-pressed={nodeEditActive}
        >
          {nodeEditActive ? 'Done Editing Points' : 'Edit Points'}
        </button>
        <button type="button" className="tool" disabled={nodeEditActive} onClick={insertAfter}>
          Insert Point
        </button>
      </div>
      <p className="uv-hint">
        {nodeEditActive
          ? 'Drag orange points in the viewport. Exit point edit mode to move, rotate, or scale the whole curve.'
          : 'Enter point edit mode to reshape the curve, or edit coordinates below.'}
      </p>
      <label className="uv-field">
        <span>Active point</span>
        <select
          className="uv-select"
          aria-label="Active curve point"
          value={index}
          onChange={(event) => setSelectedPoint(Number(event.target.value))}
        >
          {operation.points.map((_point, pointIndex) => (
            <option key={pointIndex} value={pointIndex}>Point {pointIndex + 1}</option>
          ))}
        </select>
      </label>
      <div className="uv-btn-grid uv-btn-grid-3">
        {(['x', 'y', 'z'] as const).map((axis) => (
          <label className="uv-field" key={`${index}-${axis}`}>
            <span>{axis.toUpperCase()}</span>
            <ExactCoordinateInput
              ariaLabel={`Curve point ${axis.toUpperCase()}`}
              value={point[axis]}
              onValueChange={(value) => setCoordinate(axis, String(value))}
            />
          </label>
        ))}
      </div>
      <div className="uv-btn-grid uv-btn-grid-2">
        <button
          type="button"
          className="tool"
          disabled={operation.points.length <= 2}
          onClick={deletePoint}
        >
          Delete Point
        </button>
      </div>
    </>
  );
}

function v3AxisOffset(amount: number): Vec3 {
  return { x: amount, y: 0, z: 0 };
}
