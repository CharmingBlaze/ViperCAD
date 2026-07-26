import type { ModelDocument } from '@/core/document/types';
import { hasLightmapUv } from '@/core/editor/GameAssetTools';
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
  if (stats.unappliedScales) warnings.push(`${stats.unappliedScales} object scale${stats.unappliedScales === 1 ? '' : 's'} will be exported as transforms.`);
  if (stats.missingLightmapUvs && (profile.id === 'unity' || profile.id === 'unreal')) warnings.push(`${stats.missingLightmapUvs} render mesh${stats.missingLightmapUvs === 1 ? '' : 'es'} have no lightmap UV channel.`);
  if (stats.oversizedMeshes) warnings.push(`${stats.oversizedMeshes} mesh${stats.oversizedMeshes === 1 ? '' : 'es'} exceed 100k triangles.`);
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
};

export function gameReadiness(document: ModelDocument): GameReadiness {
  let vertices = 0, polygons = 0, triangles = 0, collisionObjects = 0;
  let missingLightmapUvs = 0, invalidMeshes = 0, drawCalls = 0, unappliedScales = 0, oversizedMeshes = 0;
  for (const object of document.objects.values()) {
    if (object.metadata.gameRole === 'collision') collisionObjects += 1;
    const mesh = object.meshId ? document.meshes.get(object.meshId) : null;
    if (!mesh) continue;
    if (Math.abs(object.transform.scale.x - 1) > 1e-6 || Math.abs(object.transform.scale.y - 1) > 1e-6 || Math.abs(object.transform.scale.z - 1) > 1e-6) unappliedScales += 1;
    if (object.metadata.gameRole !== 'collision' && !hasLightmapUv(mesh)) missingLightmapUvs += 1;
    if (validateMeshFull(mesh).issues.some((issue) => issue.severity === 'error')) invalidMeshes += 1;
    vertices += mesh.vertices.size;
    polygons += mesh.faces.size;
    drawCalls += Math.max(1, new Set([...mesh.faces.values()].map((face) => face.materialSlot)).size);
    let objectTriangles = 0;
    for (const face of mesh.faces.values()) {
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
  return { objects: document.objects.size, vertices, polygons, triangles, collisionObjects, missingLightmapUvs, invalidMeshes, drawCalls, unappliedScales, oversizedMeshes };
}
