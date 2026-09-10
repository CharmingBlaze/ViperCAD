import { useState } from 'react';
import type { EditorSession } from '@/core/editor/EditorSession';
import {
  assignMaterialToObject,
  countMaterialUsers,
  createMaterial,
} from '@/core/document/ModelDocument';
import { getViperDocument } from '@/core/document/ViperProject';
import { modelHasPlaceableGeometry } from '@/core/editor/ModelInstances';
import { placeModelQuick } from '@/app/outliner/placeModelWorkflow';
import { writeModelDrag } from '@/app/outliner/modelDrag';

type AssetKind = 'all' | 'model' | 'material' | 'texture' | 'image' | 'level';

type Props = {
  session: EditorSession;
  onRefresh: () => void;
  onPlaced?: () => void;
};

type AssetRow = {
  id: string;
  kind: Exclude<AssetKind, 'all'>;
  name: string;
  detail: string;
  broken?: boolean;
};

function brokenModelLinkCount(session: EditorSession, documentId: string): number {
  const document = session.project.documents.get(documentId);
  if (!document) return 0;
  return [...document.objects.values()].filter(
    (object) =>
      object.kind === 'instance' &&
      (!object.instanceSourceModelId || !session.project.documents.has(object.instanceSourceModelId)),
  ).length;
}

const FILTERS: { id: AssetKind; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'model', label: 'Models' },
  { id: 'material', label: 'Materials' },
  { id: 'texture', label: 'Textures' },
  { id: 'image', label: 'Images' },
  { id: 'level', label: 'Levels' },
];

export function AssetBrowser({ session, onRefresh, onPlaced }: Props) {
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<AssetKind>('all');
  const { project } = session;
  const activeObjectId = session.selection.state.activeObjectId;

  const rows = (() => {
    const assets: AssetRow[] = [];
    for (const id of project.modelDocumentIds) {
      const document = getViperDocument(project, id);
      const brokenLinks = brokenModelLinkCount(session, id);
      const placeable = modelHasPlaceableGeometry(document, project);
      assets.push({
        id,
        kind: 'model',
        name: document.name,
        detail: brokenLinks
          ? `${document.objects.size} objects · ${brokenLinks} broken model link${brokenLinks === 1 ? '' : 's'}`
          : placeable
            ? `${document.objects.size} object${document.objects.size === 1 ? '' : 's'}`
            : 'Empty model · add geometry or nested models',
        broken: !placeable || brokenLinks > 0,
      });
    }
    for (const material of project.materials.values()) {
      const textureIds = [
        material.baseColourTextureId,
        material.normalTextureId,
        material.roughnessTextureId,
        material.metallicTextureId,
        material.emissiveTextureId,
      ].filter((id): id is string => !!id);
      assets.push({
        id: material.id,
        kind: 'material',
        name: material.name,
        detail: `${countMaterialUsers(session.document, material.id)} users · ${textureIds.length} maps`,
        broken: textureIds.some((id) => !project.textures.has(id)),
      });
    }
    for (const texture of project.textures.values()) {
      const users = [...project.materials.values()].filter((material) =>
        [
          material.baseColourTextureId,
          material.normalTextureId,
          material.roughnessTextureId,
          material.metallicTextureId,
          material.emissiveTextureId,
        ].includes(texture.id),
      ).length;
      assets.push({
        id: texture.id,
        kind: 'texture',
        name: texture.name,
        detail: `${users} material${users === 1 ? '' : 's'} · ${texture.filtering}`,
        broken: !project.images.has(texture.imageAssetId),
      });
    }
    for (const image of project.images.values()) {
      const users = [...project.textures.values()].filter(
        (texture) => texture.imageAssetId === image.id,
      ).length;
      assets.push({
        id: image.id,
        kind: 'image',
        name: image.name,
        detail: `${image.width}×${image.height} · ${users} texture${users === 1 ? '' : 's'}`,
      });
    }
    for (const id of project.levelDocumentIds) {
      const document = getViperDocument(project, id);
      const brokenLinks = brokenModelLinkCount(session, id);
      assets.push({
        id,
        kind: 'level',
        name: document.name,
        detail: brokenLinks
          ? `${document.objects.size} scene objects · ${brokenLinks} broken model link${brokenLinks === 1 ? '' : 's'}`
          : `${document.objects.size} scene object${document.objects.size === 1 ? '' : 's'}`,
        broken: brokenLinks > 0,
      });
    }
    return assets;
  })();

  const visibleRows = rows.filter((row) => {
    if (kind !== 'all' && row.kind !== kind) return false;
    const needle = query.trim().toLocaleLowerCase();
    return !needle || `${row.name} ${row.kind} ${row.detail}`.toLocaleLowerCase().includes(needle);
  });
  const brokenCount = rows.filter((row) => row.broken).length;
  const repairableCount =
    [...project.materials.values()].reduce((count, material) =>
      count + [
        material.baseColourTextureId,
        material.normalTextureId,
        material.roughnessTextureId,
        material.metallicTextureId,
        material.emissiveTextureId,
      ].filter((id) => id && !project.textures.has(id)).length, 0)
    + [...project.textures.values()].filter((texture) => !project.images.has(texture.imageAssetId)).length;

  const repairDependencies = () => {
    const fallbackImageId = project.images.keys().next().value as string | undefined;
    let repaired = 0;
    for (const material of project.materials.values()) {
      const keys = [
        'baseColourTextureId',
        'normalTextureId',
        'roughnessTextureId',
        'metallicTextureId',
        'emissiveTextureId',
      ] as const;
      for (const key of keys) {
        const textureId = material[key];
        if (textureId && !project.textures.has(textureId)) {
          material[key] = null;
          repaired += 1;
        }
      }
    }
    if (fallbackImageId) {
      for (const texture of project.textures.values()) {
        if (!project.images.has(texture.imageAssetId)) {
          texture.imageAssetId = fallbackImageId;
          repaired += 1;
        }
      }
    }
    if (repaired) {
      project.dirty = true;
      session.requestRedraw();
      onRefresh();
    }
  };

  const activate = (row: AssetRow) => {
    if (row.kind === 'model' || row.kind === 'level') {
      session.openDocument(row.id);
      onRefresh();
      return;
    }
    if (row.kind === 'material' && activeObjectId) {
      assignMaterialToObject(session.document, activeObjectId, row.id);
      session.document.dirty = true;
      session.requestRedraw();
      onRefresh();
    }
  };

  return (
    <div className="asset-browser">
      <div className="asset-browser-toolbar">
        <input
          type="search"
          className="outliner-doc-search"
          placeholder="Search every project asset…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          aria-label="Search project assets"
        />
        <button
          type="button"
          className="outliner-doc-create"
          onClick={() => {
            createMaterial(session.document, {
              name: `Material ${session.document.materials.size + 1}`,
            });
            session.requestRedraw();
            onRefresh();
          }}
        >
          + Material
        </button>
      </div>
      <div className="asset-browser-filters" role="group" aria-label="Asset type">
        {FILTERS.map((filter) => (
          <button
            key={filter.id}
            type="button"
            className={kind === filter.id ? 'is-active' : ''}
            aria-pressed={kind === filter.id}
            onClick={() => setKind(filter.id)}
          >
            {filter.label}
          </button>
        ))}
      </div>
      <div className={`asset-browser-health${brokenCount ? ' is-error' : ''}`}>
        <span>{rows.length} assets · {brokenCount ? `${brokenCount} need attention` : 'dependencies healthy'}</span>
        {repairableCount ? (
          <button type="button" onClick={repairDependencies}>Repair links</button>
        ) : null}
      </div>
      <div className="asset-browser-list">
        {visibleRows.map((row) => (
          <article
            key={`${row.kind}:${row.id}`}
            className={`asset-browser-row${row.broken ? ' is-broken' : ''}`}
            draggable={row.kind === 'model' && !row.broken}
            onDragStart={(event) => {
              if (row.kind === 'model' && !row.broken) {
                writeModelDrag(event.dataTransfer, row.id, row.name);
              }
            }}
          >
            <button
              type="button"
              className="asset-browser-main"
              onClick={() => activate(row)}
              title={
                row.kind === 'material' && !activeObjectId
                  ? 'Select an object to assign this material'
                  : row.kind === 'model'
                    ? 'Open model · drag into a Level to place'
                    : undefined
              }
            >
              <span className={`asset-browser-kind is-${row.kind}`}>
                {row.kind.slice(0, 3).toUpperCase()}
              </span>
              <span>
                <strong>{row.name}</strong>
                <small>{row.detail}</small>
              </span>
              {row.broken ? <b className="asset-browser-warning">!</b> : null}
            </button>
            {row.kind === 'model' && session.document.kind === 'level' && !row.broken ? (
              <button
                type="button"
                className="asset-browser-action"
                onClick={() =>
                  placeModelQuick(session, row.id, {
                    onRefresh,
                    onPlaced,
                  })
                }
              >
                Place
              </button>
            ) : null}
          </article>
        ))}
        {!visibleRows.length ? (
          <p className="outliner-doc-empty">No assets match this filter.</p>
        ) : null}
      </div>
    </div>
  );
}
