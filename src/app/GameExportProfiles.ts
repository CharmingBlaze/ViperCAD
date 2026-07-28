import type { ModelDocument } from '@/core/document/types';
import { resolveDocumentView } from '@/core/document/ViperProject';
import { hasLightmapUv } from '@/core/editor/GameAssetTools';
import { faceVertexIds } from '@/core/mesh/EditableMesh';
import { validateMeshFull } from '@/core/mesh/Validation';

export type ExportProfile = {
  id: 'godot' | 'unity' | 'unreal' | 'roblox' | 'minecraft';
  label: string;
  scale: number;
  upAxis: 'y' | 'z';
  includeColliders: boolean;
  onlyVisible: boolean;
  textureFiltering: 'nearest' | 'linear' | 'material';
};

export const EXPORT_PROFILES: Record<ExportProfile['id'], ExportProfile> = {
  godot: { id: 'godot', label: 'Godot', scale: 1, upAxis: 'y', includeColliders: true, onlyVisible: false, textureFiltering: 'material' },
  unity: { id: 'unity', label: 'Unity', scale: 1, upAxis: 'y', includeColliders: true, onlyVisible: false, textureFiltering: 'material' },
  unreal: { id: 'unreal', label: 'Unreal', scale: 100, upAxis: 'z', includeColliders: true, onlyVisible: false, textureFiltering: 'linear' },
  roblox: { id: 'roblox', label: 'Roblox', scale: 3.5714286, upAxis: 'y', includeColliders: false, onlyVisible: true, textureFiltering: 'linear' },
  minecraft: { id: 'minecraft', label: 'Minecraft-style', scale: 16, upAxis: 'y', includeColliders: false, onlyVisible: true, textureFiltering: 'nearest' },
};

export type ExportDiagnostics = { errors: string[]; warnings: string[]; stats: GameReadiness };

export function exportDiagnostics(document: ModelDocument, profile: ExportProfile): ExportDiagnostics {
  const stats = gameReadiness(document);
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!stats.objects) errors.push('Scene has no objects to export.');
  if (stats.invalidMeshes) errors.push(`${stats.invalidMeshes} mesh${stats.invalidMeshes === 1 ? '' : 'es'} failed topology validation.`);
  if (stats.brokenModelLinks) errors.push(`${stats.brokenModelLinks} linked model instance${stats.brokenModelLinks === 1 ? '' : 's'} have a missing source.`);
  if (stats.unappliedScales) warnings.push(`${stats.unappliedScales} object scale${stats.unappliedScales === 1 ? '' : 's'} will be exported as transforms.`);
  if (stats.missingLightmapUvs && (profile.id === 'unity' || profile.id === 'unreal')) warnings.push(`${stats.missingLightmapUvs} render mesh${stats.missingLightmapUvs === 1 ? '' : 'es'} have no lightmap UV channel.`);
  if (stats.oversizedMeshes) warnings.push(`${stats.oversizedMeshes} mesh${stats.oversizedMeshes === 1 ? '' : 'es'} exceed 100k triangles.`);
  if (stats.missingUvMeshes) warnings.push(`${stats.missingUvMeshes} render mesh${stats.missingUvMeshes === 1 ? '' : 'es'} have no primary UV channel.`);
  if (stats.ngons) warnings.push(`${stats.ngons} n-gon${stats.ngons === 1 ? '' : 's'} will be triangulated at export.`);
  if (stats.missingColliderMeshes) warnings.push('No collision object or collision setting is assigned to render geometry.');
  if (stats.invalidLodObjects) warnings.push(`${stats.invalidLodObjects} LOD object${stats.invalidLodObjects === 1 ? '' : 's'} need a valid level and screen threshold.`);
  if (stats.orphanRigMarkers) warnings.push(`${stats.orphanRigMarkers} rig marker${stats.orphanRigMarkers === 1 ? '' : 's'} are not parented to an object.`);
  if (stats.hiddenLibraryObjects) {
    warnings.push(
      `${stats.hiddenLibraryObjects} terrain library/palette source${stats.hiddenLibraryObjects === 1 ? '' : 's'} will be omitted from export.`,
    );
  }
  return { errors, warnings, stats };
}

export type GameReadiness = {
  objects: number;
  vertices: number;
  polygons: number;
  triangles: number;
  collisionObjects: number;
  missingLightmapUvs: number;
  invalidMeshes: number;
  drawCalls: number;
  unappliedScales: number;
  oversizedMeshes: number;
  ngons: number;
  missingUvMeshes: number;
  missingColliderMeshes: number;
  brokenModelLinks: number;
  /** Palette / library brush sources omitted from engine export. */
  hiddenLibraryObjects: number;
  lodObjects: number;
  invalidLodObjects: number;
  rigMarkers: number;
  orphanRigMarkers: number;
};

export function isExportExcludedObject(metadata: Record<string, string>): boolean {
  return (
    metadata.terrainPaletteSource === 'true' ||
    metadata.terrainLibrarySource === 'true' ||
    metadata.excludeFromExport === 'true'
  );
}

export function gameReadiness(document: ModelDocument): GameReadiness {
  let vertices = 0, polygons = 0, triangles = 0, collisionObjects = 0;
  let missingLightmapUvs = 0, invalidMeshes = 0, drawCalls = 0, unappliedScales = 0, oversizedMeshes = 0;
  let ngons = 0, missingUvMeshes = 0, renderMeshes = 0, brokenModelLinks = 0;
  let hiddenLibraryObjects = 0;
  let lodObjects = 0, invalidLodObjects = 0, rigMarkers = 0, orphanRigMarkers = 0;
  const binding = resolveDocumentView(document);
  for (const object of document.objects.values()) {
    if (isExportExcludedObject(object.metadata)) {
      hiddenLibraryObjects += 1;
      continue;
    }
    if (
      object.kind === 'instance' &&
      (
        !object.instanceSourceModelId ||
        (binding != null && !binding.project.documents.has(object.instanceSourceModelId))
      )
    ) {
      brokenModelLinks += 1;
    }
    if (object.metadata.gameRole === 'collision') collisionObjects += 1;
    if (object.metadata.lodLevel != null) {
      lodObjects += 1;
      const level = Number(object.metadata.lodLevel);
      const threshold = Number(object.metadata.lodScreenSize);
      if (
        !Number.isInteger(level) ||
        level < 0 ||
        level > 3 ||
        !Number.isFinite(threshold) ||
        threshold < 0 ||
        threshold > 1
      ) {
        invalidLodObjects += 1;
      }
    }
    if (object.metadata.gameRole === 'joint' || object.metadata.gameRole === 'socket') {
      rigMarkers += 1;
      if (!object.parentId || !document.objects.has(object.parentId)) orphanRigMarkers += 1;
    }
    const mesh = object.meshId ? document.meshes.get(object.meshId) : null;
    if (!mesh) continue;
    if (object.metadata.gameRole !== 'collision') {
      renderMeshes += 1;
      if (!mesh.defaultUvLayerId || !mesh.uvLayers.has(mesh.defaultUvLayerId)) missingUvMeshes += 1;
    }
    if (Math.abs(object.transform.scale.x - 1) > 1e-6 || Math.abs(object.transform.scale.y - 1) > 1e-6 || Math.abs(object.transform.scale.z - 1) > 1e-6) unappliedScales += 1;
    if (object.metadata.gameRole !== 'collision' && !hasLightmapUv(mesh)) missingLightmapUvs += 1;
    if (validateMeshFull(mesh).issues.some((issue) => issue.severity === 'error')) invalidMeshes += 1;
    vertices += mesh.vertices.size;
    polygons += mesh.faces.size;
    drawCalls += Math.max(1, new Set([...mesh.faces.values()].map((face) => face.materialSlot)).size);
    let objectTriangles = 0;
    for (const face of mesh.faces.values()) {
      const vertexCount = faceVertexIds(mesh, face.id).length;
      if (vertexCount > 4) ngons += 1;
      let corners = 0, halfEdgeId = face.firstHalfEdgeId;
      do {
        corners += 1;
        halfEdgeId = mesh.halfEdges.get(halfEdgeId)?.nextHalfEdgeId ?? face.firstHalfEdgeId;
      } while (halfEdgeId !== face.firstHalfEdgeId && corners <= mesh.halfEdges.size);
      const faceTriangles = Math.max(1, corners - 2);
      triangles += faceTriangles;
      objectTriangles += faceTriangles;
    }
    if (objectTriangles > 100_000) oversizedMeshes += 1;
  }
  return {
    objects: document.objects.size - hiddenLibraryObjects,
    vertices,
    polygons,
    triangles,
    collisionObjects,
    missingLightmapUvs,
    invalidMeshes,
    drawCalls,
    unappliedScales,
    oversizedMeshes,
    ngons,
    missingUvMeshes,
    missingColliderMeshes:
      renderMeshes > 0 &&
      collisionObjects === 0 &&
      ![...document.objects.values()].some((object) => object.metadata.collision && object.metadata.collision !== 'none')
        ? renderMeshes
        : 0,
    brokenModelLinks,
    hiddenLibraryObjects,
    lodObjects,
    invalidLodObjects,
    rigMarkers,
    orphanRigMarkers,
  };
}
