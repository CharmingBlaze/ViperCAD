import type { DocumentId, ViperProject } from '@/core/document/types';
import type { ViperDocument } from '@/core/document/types';
import { readRigDocumentSettings } from '@/core/rig/RigDocument';

/** Find rig documents that use the given model as their skin mesh source. */
export function findRigDocumentsForModel(project: ViperProject, modelDocumentId: DocumentId): ViperDocument[] {
  return project.rigDocumentIds
    .map((id) => project.documents.get(id))
    .filter((doc): doc is ViperDocument => {
      if (!doc || doc.kind !== 'rig') return false;
      return readRigDocumentSettings(doc).sourceModelDocumentId === modelDocumentId;
    });
}

export function findPrimaryRigForModel(project: ViperProject, modelDocumentId: DocumentId): ViperDocument | null {
  return findRigDocumentsForModel(project, modelDocumentId)[0] ?? null;
}
