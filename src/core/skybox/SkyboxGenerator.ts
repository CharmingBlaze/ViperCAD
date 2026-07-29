import { v3 } from '@/core/math/Vec3';
import { v2 as uv } from '@/core/math/Vec2';
import { MeshBuilder } from '@/core/mesh/MeshBuilder';
import type { EditableMesh } from '@/core/mesh/types';

export type SkyPreset = 'sunny' | 'sunset' | 'night' | 'overcast' | 'scifi';

export type SkyboxParams = {
  sunAzimuth: number; // 0..360 deg
  sunElevation: number; // -90..90 deg
  sunSize: number; // 1..20
  sunIntensity: number; // 0..5
  zenithColor: string;
  horizonColor: string;
  groundColor: string;
  cloudDensity: number; // 0..1
  cloudSpeed: number; // 0..5
  starIntensity: number; // 0..1
  preset: SkyPreset;
};

export const DEFAULT_SKY_PARAMS: SkyboxParams = {
  sunAzimuth: 145,
  sunElevation: 35,
  sunSize: 6,
  sunIntensity: 1.8,
  zenithColor: '#1a4b8c',
  horizonColor: '#8ca7d1',
  groundColor: '#4a5d4e',
  cloudDensity: 0.3,
  cloudSpeed: 1.0,
  starIntensity: 0,
  preset: 'sunny',
};

export const SKY_PRESETS: Record<SkyPreset, Partial<SkyboxParams>> = {
  sunny: {
    sunAzimuth: 145,
    sunElevation: 42,
    sunSize: 6,
    sunIntensity: 2.0,
    zenithColor: '#1e529e',
    horizonColor: '#96c2ec',
    groundColor: '#3a5a40',
    cloudDensity: 0.25,
    starIntensity: 0,
  },
  sunset: {
    sunAzimuth: 240,
    sunElevation: 8,
    sunSize: 10,
    sunIntensity: 2.5,
    zenithColor: '#2b1b4d',
    horizonColor: '#ff7b36',
    groundColor: '#3d1c1c',
    cloudDensity: 0.4,
    starIntensity: 0.1,
  },
  night: {
    sunAzimuth: 0,
    sunElevation: -45,
    sunSize: 4,
    sunIntensity: 0,
    zenithColor: '#050a1a',
    horizonColor: '#0c1a38',
    groundColor: '#040810',
    cloudDensity: 0.2,
    starIntensity: 0.9,
  },
  overcast: {
    sunAzimuth: 180,
    sunElevation: 30,
    sunSize: 12,
    sunIntensity: 0.8,
    zenithColor: '#4a525d',
    horizonColor: '#8a94a0',
    groundColor: '#2f353d',
    cloudDensity: 0.8,
    starIntensity: 0,
  },
  scifi: {
    sunAzimuth: 120,
    sunElevation: 25,
    sunSize: 14,
    sunIntensity: 3.0,
    zenithColor: '#3b0066',
    horizonColor: '#00e5ff',
    groundColor: '#120024',
    cloudDensity: 0.5,
    starIntensity: 0.8,
  },
};

/** Generates an inverted Skysphere mesh with 360° equirectangular UV mapping. */
export function generateSkysphereMesh(radius = 500, segments = 48): EditableMesh {
  const b = new MeshBuilder('Skysphere', true);
  const rings = segments;
  const sectors = segments * 2;

  const grid: string[][] = [];

  for (let r = 0; r <= rings; r++) {
    const v = r / rings;
    const phi = v * Math.PI; // 0 to PI
    const ringVerts: string[] = [];

    for (let s = 0; s <= sectors; s++) {
      const u = s / sectors;
      const theta = u * Math.PI * 2; // 0 to 2PI

      const x = -radius * Math.sin(phi) * Math.cos(theta);
      const y = radius * Math.cos(phi);
      const z = radius * Math.sin(phi) * Math.sin(theta);

      const vertId = b.vertex(v3(x, y, z));
      ringVerts.push(vertId);
    }
    grid.push(ringVerts);
  }

  // Inverted quad faces so sky faces inside toward camera
  for (let r = 0; r < rings; r++) {
    for (let s = 0; s < sectors; s++) {
      const v00 = grid[r]![s]!;
      const v10 = grid[r + 1]![s]!;
      const v11 = grid[r + 1]![s + 1]!;
      const v01 = grid[r]![s + 1]!;

      const u0 = s / sectors;
      const u1 = (s + 1) / sectors;
      const v0 = 1 - (r / rings);
      const v1 = 1 - ((r + 1) / rings);

      // Inverted winding order so interior of sphere is visible, with correct upright V mapping
      b.quad(v00, v01, v11, v10, [uv(u0, v0), uv(u1, v0), uv(u1, v1), uv(u0, v1)]);
    }
  }

  const mesh = b.build();
  for (const face of mesh.faces.values()) {
    face.flatShaded = false;
    face.smoothingGroup = 1;
  }
  return mesh;
}

/** Generates an inverted 6-sided Skybox Cube Mesh. */
export function generateSkyboxCubeMesh(size = 500): EditableMesh {
  const b = new MeshBuilder('Skybox Cube', true);
  const hs = size * 0.5;

  const v0 = b.vertex(v3(-hs, -hs, -hs));
  const v1 = b.vertex(v3(hs, -hs, -hs));
  const v2 = b.vertex(v3(hs, -hs, hs));
  const v3Pt = b.vertex(v3(-hs, -hs, hs));
  const v4 = b.vertex(v3(-hs, hs, -hs));
  const v5 = b.vertex(v3(hs, hs, -hs));
  const v6 = b.vertex(v3(hs, hs, hs));
  const v7 = b.vertex(v3(-hs, hs, hs));

  // Inverted quads for interior viewing
  b.quad(v0, v4, v5, v1, [uv(0, 0), uv(0, 1), uv(1, 1), uv(1, 0)]); // Front
  b.quad(v1, v5, v6, v2, [uv(0, 0), uv(0, 1), uv(1, 1), uv(1, 0)]); // Right
  b.quad(v2, v6, v7, v3Pt, [uv(0, 0), uv(0, 1), uv(1, 1), uv(1, 0)]); // Back
  b.quad(v3Pt, v7, v4, v0, [uv(0, 0), uv(0, 1), uv(1, 1), uv(1, 0)]); // Left
  b.quad(v4, v7, v6, v5, [uv(0, 0), uv(0, 1), uv(1, 1), uv(1, 0)]); // Top
  b.quad(v3Pt, v0, v1, v2, [uv(0, 0), uv(0, 1), uv(1, 1), uv(1, 0)]); // Bottom

  const mesh = b.build();
  for (const face of mesh.faces.values()) {
    face.flatShaded = false;
    face.smoothingGroup = 1;
  }
  return mesh;
}

/** Renders a procedural sky panorama texture onto an HTML5 canvas. */
export function renderProceduralSkyCanvas(
  canvas: HTMLCanvasElement,
  params: SkyboxParams,
  customImageElement?: HTMLImageElement | null,
): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const w = canvas.width;
  const h = canvas.height;

  if (customImageElement && customImageElement.complete && customImageElement.naturalWidth > 0) {
    // Draw imported 360° Panorama Image onto Sky Canvas
    ctx.drawImage(customImageElement, 0, 0, w, h);
    return;
  }

  // Background Sky Gradient (Zenith to Horizon to Ground)
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0.0, params.zenithColor);
  grad.addColorStop(0.45, params.horizonColor);
  grad.addColorStop(0.55, params.horizonColor);
  grad.addColorStop(1.0, params.groundColor);

  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  // Stars rendering for night/sci-fi skies
  if (params.starIntensity > 0.05) {
    ctx.fillStyle = `rgba(255, 255, 255, ${params.starIntensity * 0.8})`;
    const starCount = Math.floor(params.starIntensity * 200);
    // Pseudo-random deterministic stars
    for (let i = 0; i < starCount; i++) {
      const sx = (Math.sin(i * 12.9898) * 43758.5453) % 1 * w;
      const sy = Math.abs((Math.cos(i * 78.233) * 43758.5453) % 1) * (h * 0.5);
      const size = (i % 3 === 0) ? 1.5 : 1.0;
      ctx.beginPath();
      ctx.arc(Math.abs(sx), sy, size, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Sun Disk & Atmospheric Halo
  if (params.sunElevation > -15) {
    const sunX = ((params.sunAzimuth % 360) / 360) * w;
    const sunY = (0.5 - (params.sunElevation / 180)) * h;
    const sunRadius = params.sunSize * 2.5;

    // Glow Halo
    const haloGrad = ctx.createRadialGradient(sunX, sunY, 0, sunX, sunY, sunRadius * 4);
    haloGrad.addColorStop(0.0, `rgba(255, 255, 240, ${0.9 * params.sunIntensity})`);
    haloGrad.addColorStop(0.2, `rgba(255, 200, 120, ${0.5 * params.sunIntensity})`);
    haloGrad.addColorStop(1.0, 'rgba(255, 180, 100, 0.0)');

    ctx.fillStyle = haloGrad;
    ctx.beginPath();
    ctx.arc(sunX, sunY, sunRadius * 4, 0, Math.PI * 2);
    ctx.fill();

    // Sun Center Disk
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(sunX, sunY, sunRadius, 0, Math.PI * 2);
    ctx.fill();
  }

  // Clouds overlay
  if (params.cloudDensity > 0.05) {
    ctx.fillStyle = `rgba(255, 255, 255, ${params.cloudDensity * 0.35})`;
    const cloudBands = 8;
    for (let i = 0; i < cloudBands; i++) {
      const cy = h * 0.2 + (i / cloudBands) * h * 0.25;
      const rx = w * 0.15 + (i % 3) * 40;
      const ry = 15 + (i % 2) * 10;
      const cx = (i * 180) % w;
      ctx.beginPath();
      ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}
