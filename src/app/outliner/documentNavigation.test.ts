import { describe, expect, it } from 'vitest';
import { filterDocumentIds, matchesDocumentFilter } from '@/app/outliner/documentNavigation';
import { createEmptyProject } from '@/core/document/ViperProject';

describe('documentNavigation', () => {
  it('matchesDocumentFilter is case-insensitive and ignores empty query', () => {
    expect(matchesDocumentFilter('Main Level', '')).toBe(true);
    expect(matchesDocumentFilter('Main Level', 'main')).toBe(true);
    expect(matchesDocumentFilter('Main Level', 'kitchen')).toBe(false);
  });

  it('filterDocumentIds filters by document name', () => {
    const project = createEmptyProject('Test');
    const levelId = project.levelDocumentIds[0]!;
    project.documents.get(levelId)!.name = 'Kitchen Level';
    const modelId = project.modelDocumentIds[0]!;
    project.documents.get(modelId)!.name = 'Chair Model';

    expect(filterDocumentIds(project, project.levelDocumentIds, 'kitchen')).toEqual([levelId]);
    expect(filterDocumentIds(project, project.modelDocumentIds, 'chair')).toEqual([modelId]);
  });
});
