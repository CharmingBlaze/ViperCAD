import type { ImageAsset } from '@/core/document/types';
import type { EditableMesh } from '@/core/mesh/types';
import { terrainHeightRange } from '@/core/terrain/Terrain';

export type AutoBiomeOptions = {
  waterLevel?: number;
  snowLevel?: number;
  cliffSlopeThreshold?: number; // 0 to 1
};

export const COLOR_GRASS: [number, number, number, number] = [104, 132, 82, 255];
export const COLOR_SAND: [number, number, number, number] = [210, 190, 140, 255];
export const COLOR_ROCK: [number, number, number, number] = [120, 115, 110, 255];
export const COLOR_SNOW: [number, number, number, number] = [240, 245, 255, 255];

function lerpColor(
  c1: [number, number, number, number],
  c2: [number, number, number, number],
  t: number,
): [number, number, number, number] {
  const clampT = Math.max(0, Math.min(1, t));
  return [
    Math.round(c1[0] + (c2[0] - c1[0]) * clampT),
    Math.round(c1[1] + (c2[1] - c1[1]) * clampT),
    Math.round(c1[2] + (c2[2] - c1[2]) * clampT),
    255,
  ];
}

/** Automatically paint terrain image asset based on slope angle and elevation */
export function applyAutoBiomeColors(
  mesh: EditableMesh,
  image: ImageAsset,
  options: AutoBiomeOptions = {},
): boolean {
  if (!image.pixels || !image.width || !image.height) return false;

  const width = image.width;
  const height = image.height;
  const range = terrainHeightRange(mesh);
  const waterLevel = options.waterLevel ?? range.min + (range.max - range.min) * 0.15;
  const snowLevel = options.snowLevel ?? range.min + (range.max - range.min) * 0.85;
  const cliffSlope = options.cliffSlopeThreshold ?? 0.45;

  const xs = [...mesh.vertices.values()].map((v) => v.position.x);
  const zs = [...mesh.vertices.values()].map((v) => v.position.z);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minZ = Math.min(...zs);
  const maxZ = Math.max(...zs);
  const spanX = Math.max(1e-5, maxX - minX);
  const spanZ = Math.max(1e-5, maxZ - minZ);

  // Compute heights grid from mesh vertices
  const grid = new Float32Array(width * height);
  for (let py = 0; py < height; py++) {
    for (let px = 0; px < width; px++) {
      const u = px / width;
      const v = py / height;
      const vx = minX + u * spanX;
      const vz = minZ + v * spanZ;

      // Find nearest vertex height
      let nearestDist = Infinity;
      let heightVal = 0;
      for (const vert of mesh.vertices.values()) {
        const d = Math.hypot(vert.position.x - vx, vert.position.z - vz);
        if (d < nearestDist) {
          nearestDist = d;
          heightVal = vert.position.y;
        }
      }
      grid[py * width + px] = heightVal;
    }
  }

  // Paint pixels according to elevation and slope gradient
  for (let py = 0; py < height; py++) {
    for (let px = 0; px < width; px++) {
      const idx = (py * width + px) * 4;
      const h = grid[py * width + px]!;

      // Estimate slope from neighboring pixels
      const hLeft = grid[py * width + Math.max(0, px - 1)]!;
      const hRight = grid[py * width + Math.min(width - 1, px + 1)]!;
      const hUp = grid[Math.max(0, py - 1) * width + px]!;
      const hDown = grid[Math.min(height - 1, py + 1) * width + px]!;
      const slope = Math.hypot((hRight - hLeft) * 0.5, (hDown - hUp) * 0.5);

      let finalColor: [number, number, number, number] = COLOR_GRASS;

      if (h <= waterLevel + 0.3) {
        // Sand near water line
        const tSand = Math.max(0, 1 - (h - waterLevel) / 0.5);
        finalColor = lerpColor(COLOR_GRASS, COLOR_SAND, tSand);
      } else if (h >= snowLevel) {
        // Snow at high peaks
        const tSnow = Math.min(1, (h - snowLevel) / 1.5);
        finalColor = lerpColor(COLOR_GRASS, COLOR_SNOW, tSnow);
      }

      if (slope > cliffSlope) {
        // Rock on steep cliffs
        const tRock = Math.min(1, (slope - cliffSlope) / 0.4);
        finalColor = lerpColor(finalColor, COLOR_ROCK, tRock);
      }

      image.pixels[idx] = finalColor[0];
      image.pixels[idx + 1] = finalColor[1];
      image.pixels[idx + 2] = finalColor[2];
      image.pixels[idx + 3] = 255;
    }
  }

  image.revision += 1;
  return true;
}
