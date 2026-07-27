import type { EditorSession } from '@/core/editor/EditorSession';
import type { DocumentId } from '@/core/document/types';
import { getViperDocument } from '@/core/document/ViperProject';
import { openDocumentTab } from '@/app/DocumentTabs';
import { pushToast } from '@/app/Toast';

export function openProjectDocument(
  session: EditorSession,
  documentId: DocumentId,
  onRefresh: () => void,
): void {
  openDocumentTab(session, documentId);
  onRefresh();
}

export function createProjectDocument(
  session: EditorSession,
  kind: 'model' | 'level',
  onRefresh: () => void,
): DocumentId {
  const { project, projectEditor } = session;
  const id = kind === 'model'
    ? projectEditor.newModel(`Model ${project.modelDocumentIds.length + 1}`)
    : projectEditor.newLevel(`Level ${project.levelDocumentIds.length + 1}`);
  openDocumentTab(session, id);
  onRefresh();
  pushToast(`New ${kind === 'model' ? 'Model' : 'Level'} created`, 'success');
  return id;
}

export function renameProjectDocument(
  session: EditorSession,
  documentId: DocumentId,
  onRefresh: () => void,
): void {
  const doc = getViperDocument(session.project, documentId);
  const next = window.prompt('Rename', doc.name);
  if (!next?.trim()) return;
  session.projectEditor.renameDocument(documentId, next.trim());
  onRefresh();
}

export function deleteProjectDocument(
  session: EditorSession,
  documentId: DocumentId,
  kind: 'model' | 'level',
  onRefresh: () => void,
): void {
  const { project, projectEditor } = session;
  const doc = getViperDocument(project, documentId);
  const documentIds = kind === 'model' ? project.modelDocumentIds : project.levelDocumentIds;
  const kindLabel = kind === 'model' ? 'Model' : 'Level';
  if (documentIds.length <= 1) {
    pushToast(`Cannot delete the last ${kindLabel}`, 'error');
    return;
  }
  if (!window.confirm(`Delete ${kind} "${doc.name}"?`)) return;
  if (!projectEditor.deleteDocument(documentId)) return;
  if (projectEditor.activeDocumentId) session.openDocument(projectEditor.activeDocumentId);
  pushToast(`Deleted ${doc.name}`, 'info');
  onRefresh();
}
