import { faceCornerIds } from '@/core/mesh/EditableMesh';
import type { EditableMesh, FaceId, UvLayerId } from '@/core/mesh/types';

export type UvFaceDiagnostic = {
  density: number;
  distortion: number;
  flipped: boolean;
  degenerate: boolean;
};

export type UvDiagnostics = {
  faces: Map<FaceId, UvFaceDiagnostic>;
  averageDensity: number;
  densityVariation: number;
  maximumDistortion: number;
  flippedFaces: number;
  degenerateFaces: number;
};

/** Measures pixels-per-model-unit and edge stretch for every UV-mapped face. */
export function analyseUvs(
  mesh: EditableMesh,
  layerId: UvLayerId,
  imageWidth: number,
  imageHeight: number,
): UvDiagnostics {
  const faces = new Map<FaceId, UvFaceDiagnostic>();
  const densitySamples: number[] = [];
  let maximumDistortion = 1;
  let flippedFaces = 0;
  let degenerateFaces = 0;

  for (const face of mesh.faces.values()) {
    const corners = faceCornerIds(mesh, face.id);
    let worldArea = 0;
    let pixelArea = 0;
    let signedUvArea = 0;
    const edgeRatios: number[] = [];

    for (let i = 1; i + 1 < corners.length; i++) {
      const tri = [corners[0]!, corners[i]!, corners[i + 1]!] as const;
      const p = tri.map((id) => mesh.vertices.get(mesh.faceCorners.get(id)!.vertexId)!.position);
      const uv = tri.map((id) => mesh.faceCorners.get(id)!.uvs.get(layerId) ?? { x: 0, y: 0 });
      const ab = { x: p[1]!.x - p[0]!.x, y: p[1]!.y - p[0]!.y, z: p[1]!.z - p[0]!.z };
      const ac = { x: p[2]!.x - p[0]!.x, y: p[2]!.y - p[0]!.y, z: p[2]!.z - p[0]!.z };
      const cross = {
        x: ab.y * ac.z - ab.z * ac.y,
        y: ab.z * ac.x - ab.x * ac.z,
        z: ab.x * ac.y - ab.y * ac.x,
      };
      worldArea += Math.hypot(cross.x, cross.y, cross.z) * 0.5;
      const signed =
        ((uv[1]!.x - uv[0]!.x) * (uv[2]!.y - uv[0]!.y) -
          (uv[1]!.y - uv[0]!.y) * (uv[2]!.x - uv[0]!.x)) * 0.5;
      signedUvArea += signed;
      pixelArea += Math.abs(signed) * imageWidth * imageHeight;

      for (const [a, b] of [[0, 1], [1, 2], [2, 0]] as const) {
        const worldLength = Math.hypot(
          p[b]!.x - p[a]!.x,
          p[b]!.y - p[a]!.y,
          p[b]!.z - p[a]!.z,
        );
        const pixelLength = Math.hypot(
          (uv[b]!.x - uv[a]!.x) * imageWidth,
          (uv[b]!.y - uv[a]!.y) * imageHeight,
        );
        if (worldLength > 1e-8 && pixelLength > 1e-8) edgeRatios.push(pixelLength / worldLength);
      }
    }

    const degenerate = worldArea <= 1e-10 || pixelArea <= 1e-10 || edgeRatios.length === 0;
    const density = degenerate ? 0 : Math.sqrt(pixelArea / worldArea);
    const minRatio = edgeRatios.length ? Math.min(...edgeRatios) : 0;
    const maxRatio = edgeRatios.length ? Math.max(...edgeRatios) : 0;
    const distortion = minRatio > 1e-8 ? maxRatio / minRatio : Number.POSITIVE_INFINITY;
    const flipped = signedUvArea < -1e-10;
    faces.set(face.id, { density, distortion, flipped, degenerate });
    if (!degenerate) densitySamples.push(density);
    maximumDistortion = Math.max(maximumDistortion, distortion);
    if (flipped) flippedFaces += 1;
    if (degenerate) degenerateFaces += 1;
  }

  const averageDensity = densitySamples.length
    ? densitySamples.reduce((sum, value) => sum + value, 0) / densitySamples.length
    : 0;
  const variance = densitySamples.length
    ? densitySamples.reduce((sum, value) => sum + (value - averageDensity) ** 2, 0) /
      densitySamples.length
    : 0;
  return {
    faces,
    averageDensity,
    densityVariation: averageDensity > 1e-8 ? Math.sqrt(variance) / averageDensity : 0,
    maximumDistortion,
    flippedFaces,
    degenerateFaces,
  };
}
