import type { EditorSession } from '@/core/editor/EditorSession';
import type { SceneObject } from '@/core/document/types';
import type { EditableMesh } from '@/core/mesh/types';
import {
  buildPrimitiveInCage,
  primitiveCageCentre,
  PRIMITIVE_KINDS,
  PRIMITIVE_LABELS,
  type PrimitiveConstructionCage,
  type PrimitiveKind,
  type PrimitiveParameters,
} from '@/core/primitives/PrimitiveFactory';

type PrimitiveOperation = {
  kind: PrimitiveKind;
  cage: PrimitiveConstructionCage;
  parameters: PrimitiveParameters;
};

type Props = {
  session: EditorSession;
  object: SceneObject | null;
  mesh: EditableMesh | null;
  onRefresh: () => void;
};

export function PrimitiveOperationPanel({ session, object, mesh, onRefresh }: Props) {
  const operation = readPrimitiveOperation(object?.metadata.primitiveOperation);
  if (!object || !mesh || !operation || session.selection.state.mode !== 'object') return null;
  const dimensions = operationDimensions(operation);

  const updateDimension = (key: 'width' | 'height' | 'depth', value: number) => {
    const beforeMesh = mesh;
    const beforeMetadata = object.metadata.primitiveOperation!;
    const cage = cloneCage(operation.cage);
    const centreBefore = primitiveCageCentre(cage);
    applyDimension(cage, key, Math.max(0.000001, value));
    const centreAfter = primitiveCageCentre(cage);
    cage.origin.x += centreBefore.x - centreAfter.x;
    cage.origin.y += centreBefore.y - centreAfter.y;
    cage.origin.z += centreBefore.z - centreAfter.z;
    cage.maxLocal = { x: cage.sizeU, y: cage.sizeNormal, z: cage.sizeV };
    const nextOperation = { ...operation, cage };
    const afterMesh = buildPrimitiveInCage(nextOperation.kind, cage, nextOperation.parameters);
    afterMesh.id = beforeMesh.id;
    const afterMetadata = JSON.stringify(nextOperation);
    let applied = true;
    session.document.meshes.set(beforeMesh.id, afterMesh);
    object.metadata.primitiveOperation = afterMetadata;
    session.document.dirty = true;
    session.history.execute({
      name: `Resize ${PRIMITIVE_LABELS[nextOperation.kind]}`,
      execute: () => {
        if (applied) return;
        session.document.meshes.set(beforeMesh.id, afterMesh);
        object.metadata.primitiveOperation = afterMetadata;
        session.document.dirty = true;
        applied = true;
      },
      undo: () => {
        session.document.meshes.set(beforeMesh.id, beforeMesh);
        object.metadata.primitiveOperation = beforeMetadata;
        session.document.dirty = true;
        applied = false;
      },
    });
    session.requestRedraw();
    onRefresh();
  };

  return (
    <section className="uv-section">
      <h3 className="uv-section-title">Last Operation · {PRIMITIVE_LABELS[operation.kind]}</h3>
      <p className="uv-meta">Live editable primitive parameters</p>
      {(['width', 'height', 'depth'] as const).map((key) => (
        <label key={key} className="uv-field">
          <span>{key[0]!.toUpperCase() + key.slice(1)}</span>
          <input
            className="uv-text"
            type="number"
            min={0.000001}
            step={session.document.settings.snapIncrement}
            value={Number(dimensions[key].toFixed(4))}
            onChange={(event) => updateDimension(key, Number(event.target.value))}
          />
        </label>
      ))}
      <p className="uv-hint">Changes rebuild the primitive immediately and remain undoable.</p>
    </section>
  );
}

function readPrimitiveOperation(raw: string | undefined): PrimitiveOperation | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as PrimitiveOperation;
    return PRIMITIVE_KINDS.includes(parsed.kind) && parsed.cage && parsed.parameters ? parsed : null;
  } catch {
    return null;
  }
}

function operationDimensions(operation: PrimitiveOperation) {
  const cage = operation.cage;
  if (cage.constructionPlaneId === 'front') return { width: cage.sizeU, height: cage.sizeV, depth: cage.sizeNormal };
  if (cage.constructionPlaneId === 'right') return { width: cage.sizeNormal, height: cage.sizeV, depth: cage.sizeU };
  return { width: cage.sizeU, height: cage.sizeNormal, depth: cage.sizeV };
}

function cloneCage(cage: PrimitiveConstructionCage): PrimitiveConstructionCage {
  return {
    ...cage,
    origin: { ...cage.origin },
    axisU: { ...cage.axisU },
    axisV: { ...cage.axisV },
    axisNormal: { ...cage.axisNormal },
    minLocal: { ...cage.minLocal },
    maxLocal: { ...cage.maxLocal },
  };
}

function applyDimension(cage: PrimitiveConstructionCage, key: 'width' | 'height' | 'depth', value: number): void {
  if (cage.constructionPlaneId === 'front') {
    if (key === 'width') cage.sizeU = value;
    if (key === 'height') cage.sizeV = value;
    if (key === 'depth') cage.sizeNormal = value;
  } else if (cage.constructionPlaneId === 'right') {
    if (key === 'width') cage.sizeNormal = value;
    if (key === 'height') cage.sizeV = value;
    if (key === 'depth') cage.sizeU = value;
  } else {
    if (key === 'width') cage.sizeU = value;
    if (key === 'height') cage.sizeNormal = value;
    if (key === 'depth') cage.sizeV = value;
  }
}
