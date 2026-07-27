import type { DocumentId, ObjectId, ViperProject } from '@/core/document/types';
import {
  addDocumentToProject,
  buildModelDocumentView,
  createViperDocument,
  getViperDocument,
  removeDocumentFromProject,
} from '@/core/document/ViperProject';
import type { ConstructionPlane } from '@/core/snap/SnapEngine';
import { WORLD_XZ_PLANE } from '@/core/snap/SnapEngine';
import { CommandHistory } from '@/core/history/CommandHistory';
import type { ToolId } from '@/core/tools/Tool';
import { SelectionManager } from '@/core/selection/SelectionManager';
import { UvSelection } from '@/core/uv/UvSelection';

export type OpenDocumentSession = {
  documentId: DocumentId;
  selection: SelectionManager;
  history: CommandHistory;
  focusGroupId: ObjectId | null;
  constructionPlane: ConstructionPlane;
  constructionPlaneId: string;
  uvSelection: UvSelection;
  selectionSource: 'viewport' | 'uv' | 'system';
  activeToolId: ToolId;
};

export class ProjectEditor {
  project: ViperProject;
  openDocuments = new Map<DocumentId, OpenDocumentSession>();
  activeDocumentId: DocumentId | null;

  constructor(project: ViperProject) {
    this.project = project;
    this.activeDocumentId = project.activeDocumentId;
    if (this.activeDocumentId) this.openDocument(this.activeDocumentId);
  }

  openDocument(documentId: DocumentId): OpenDocumentSession {
    if (!this.project.documents.has(documentId)) throw new Error(`Document ${documentId} not found`);
    let session = this.openDocuments.get(documentId);
    if (!session) {
      session = createOpenDocumentSession(documentId);
      this.openDocuments.set(documentId, session);
    }
    this.activeDocumentId = documentId;
    this.project.activeDocumentId = documentId;
    return session;
  }

  closeDocument(documentId: DocumentId): void {
    this.openDocuments.delete(documentId);
    if (this.activeDocumentId === documentId) {
      const remaining = [...this.openDocuments.keys()];
      this.activeDocumentId = remaining[0] ?? null;
      this.project.activeDocumentId = this.activeDocumentId;
    }
  }

  activeSession(): OpenDocumentSession {
    const id = this.activeDocumentId;
    if (!id) throw new Error('No active document');
    const session = this.openDocuments.get(id);
    if (!session) throw new Error(`Document ${id} is not open`);
    return session;
  }

  activeDocumentView() {
    const id = this.activeDocumentId;
    if (!id) throw new Error('No active document');
    return buildModelDocumentView(this.project, id);
  }

  newModel(name = 'Untitled Model'): DocumentId {
    const doc = createViperDocument(name, 'model');
    addDocumentToProject(this.project, doc);
    return doc.id;
  }

  newLevel(name = 'Untitled Level'): DocumentId {
    const doc = createViperDocument(name, 'level');
    addDocumentToProject(this.project, doc);
    return doc.id;
  }

  renameDocument(documentId: DocumentId, name: string): void {
    getViperDocument(this.project, documentId).name = name;
    getViperDocument(this.project, documentId).dirty = true;
    this.project.dirty = true;
  }

  deleteDocument(documentId: DocumentId): boolean {
    const doc = getViperDocument(this.project, documentId);
    const list = doc.kind === 'model' ? this.project.modelDocumentIds : this.project.levelDocumentIds;
    if (list.length <= 1) return false;
    this.closeDocument(documentId);
    removeDocumentFromProject(this.project, documentId);
    return true;
  }
}

export function createOpenDocumentSession(documentId: DocumentId): OpenDocumentSession {
  return {
    documentId,
    selection: new SelectionManager(),
    history: new CommandHistory(),
    focusGroupId: null,
    constructionPlane: WORLD_XZ_PLANE,
    constructionPlaneId: 'top',
    uvSelection: new UvSelection(),
    selectionSource: 'system',
    activeToolId: 'select',
  };
}
