import type { DocumentId } from '@/core/document/types';

export const VIPERCAD_MODEL_DRAG_TYPE = 'application/x-vipercad-model';
const TEXT_PREFIX = 'vipercad-model:';

export function writeModelDrag(
  dataTransfer: DataTransfer,
  documentId: DocumentId,
  modelName: string,
): void {
  dataTransfer.effectAllowed = 'copy';
  dataTransfer.setData(VIPERCAD_MODEL_DRAG_TYPE, documentId);
  dataTransfer.setData('text/vipercad-model', documentId);
  dataTransfer.setData('text/plain', `${TEXT_PREFIX}${documentId}:${modelName}`);
}

export function hasModelDrag(dataTransfer: DataTransfer): boolean {
  const types = [...dataTransfer.types];
  return (
    types.includes(VIPERCAD_MODEL_DRAG_TYPE) ||
    types.includes('text/vipercad-model') ||
    types.includes('text/plain')
  );
}

export function readModelDrag(dataTransfer: DataTransfer): DocumentId | null {
  const direct =
    dataTransfer.getData(VIPERCAD_MODEL_DRAG_TYPE) ||
    dataTransfer.getData('text/vipercad-model');
  if (direct) return direct;
  const text = dataTransfer.getData('text/plain');
  if (!text.startsWith(TEXT_PREFIX)) return null;
  const documentId = text.slice(TEXT_PREFIX.length).split(':')[0];
  return documentId || null;
}
