import type { DocumentId, ViperProject } from '@/core/document/types';
import { getViperDocument } from '@/core/document/ViperProject';

export function matchesDocumentFilter(name: string, query: string): boolean {
  const normalized = query.trim().toLowerCase();
  return !normalized || name.toLowerCase().includes(normalized);
}

export function filterDocumentIds(
  project: ViperProject,
  documentIds: DocumentId[],
  query: string,
): DocumentId[] {
  return documentIds.filter((documentId) => {
    const doc = getViperDocument(project, documentId);
    return matchesDocumentFilter(doc.name, query);
  });
}
