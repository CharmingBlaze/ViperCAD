import { bumpPositions } from '@/core/mesh/EditableMesh';
import type { EditableMesh, VertexId } from '@/core/mesh/types';

export type HydraulicErosionOptions = {
  iterations?: number;
  rainAmount?: number;
  evaporation?: number;
  capacity?: number;
  solubility?: number;
};

export type ThermalErosionOptions = {
  iterations?: number;
  talusAngle?: number; // radians or factor
  strength?: number;
};

export type NoiseSculptOptions = {
  scale?: number;
  strength?: number;
  seed?: number;
};

/** Simulate rainfall hydraulic erosion over terrain vertices */
export function applyHydraulicErosion(
  mesh: EditableMesh,
  options: HydraulicErosionOptions = {},
): number {
  const iterations = Math.max(1, options.iterations ?? 3);
  const rainAmount = options.rainAmount ?? 0.05;
  const evaporation = options.evaporation ?? 0.02;
  const solubility = options.solubility ?? 0.1;

  const vertices = [...mesh.vertices.values()];
  if (vertices.length < 4) return 0;

  // Build spatial grid lookup for neighbor height comparisons
  const heightMap = new Map<VertexId, number>();
  for (const v of vertices) {
    heightMap.set(v.id, v.position.y);
  }

  let modified = 0;

  for (let iter = 0; iter < iterations; iter++) {
    for (const vertex of vertices) {
      // Find neighbors with lower height
      let minNeighbor: typeof vertex | null = null;
      let minHeight = vertex.position.y;

      for (const other of vertices) {
        if (other.id === vertex.id) continue;
        const dx = other.position.x - vertex.position.x;
        const dz = other.position.z - vertex.position.z;
        const distSq = dx * dx + dz * dz;
        if (distSq > 0 && distSq <= 4.5) {
          if (other.position.y < minHeight) {
            minHeight = other.position.y;
            minNeighbor = other;
          }
        }
      }

      if (minNeighbor) {
        const heightDiff = vertex.position.y - minNeighbor.position.y;
        if (heightDiff > 0.01) {
          const erode = heightDiff * solubility * rainAmount;
          vertex.position.y -= erode;
          minNeighbor.position.y += erode * (1 - evaporation);
          modified++;
        }
      }
    }
  }

  if (modified > 0) {
    bumpPositions(mesh);
  }
  return modified;
}

/** Simulate thermal erosion (rock crumbling on steep slopes) */
export function applyThermalErosion(
  mesh: EditableMesh,
  options: ThermalErosionOptions = {},
): number {
  const iterations = Math.max(1, options.iterations ?? 2);
  const strength = options.strength ?? 0.15;
  const talusAngleThreshold = options.talusAngle ?? 0.4; // height delta threshold

  const vertices = [...mesh.vertices.values()];
  if (vertices.length < 4) return 0;

  let modified = 0;

  for (let iter = 0; iter < iterations; iter++) {
    for (const vertex of vertices) {
      for (const other of vertices) {
        if (other.id === vertex.id) continue;
        const dx = other.position.x - vertex.position.x;
        const dz = other.position.z - vertex.position.z;
        const dist = Math.hypot(dx, dz);
        if (dist > 0 && dist <= 2.0) {
          const slope = (vertex.position.y - other.position.y) / dist;
          if (slope > talusAngleThreshold) {
            const transfer = (slope - talusAngleThreshold) * dist * strength * 0.5;
            vertex.position.y -= transfer;
            other.position.y += transfer;
            modified++;
          }
        }
      }
    }
  }

  if (modified > 0) {
    bumpPositions(mesh);
  }
  return modified;
}

/** Apply organic fractal noise roughness to terrain */
export function applyNoiseSculpt(
  mesh: EditableMesh,
  options: NoiseSculptOptions = {},
): number {
  const scale = options.scale ?? 0.2;
  const strength = options.strength ?? 0.3;
  const seed = options.seed ?? 42;

  let modified = 0;
  for (const vertex of mesh.vertices.values()) {
    const x = vertex.position.x * scale + seed;
    const z = vertex.position.z * scale + seed;

    // Simple multi-octave pseudo noise
    const n1 = Math.sin(x) * Math.cos(z);
    const n2 = Math.sin(x * 2.3 + 1.2) * Math.cos(z * 2.1 + 0.8) * 0.5;
    const n3 = Math.sin(x * 4.7 + 2.4) * Math.cos(z * 4.5 + 1.9) * 0.25;
    const noise = (n1 + n2 + n3) * strength;

    vertex.position.y += noise;
    modified++;
  }

  if (modified > 0) {
    bumpPositions(mesh);
  }
  return modified;
}
