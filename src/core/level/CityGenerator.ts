import { v3 } from '@/core/math/Vec3';
import { v2 as uv } from '@/core/math/Vec2';
import { MeshBuilder } from '@/core/mesh/MeshBuilder';
import type { EditableMesh } from '@/core/mesh/types';
import type { MaterialId, ModelDocument } from '@/core/document/types';
import { createDefaultMaterial } from '@/core/document/ModelDocument';

export type BuildingStyle = 'skyscraper' | 'office' | 'residential' | 'warehouse';

export type BuildingOptions = {
  width?: number;
  depth?: number;
  floors?: number;
  floorHeight?: number;
  style?: BuildingStyle;
  name?: string;
};

/** Get or create a dedicated clean architectural building material (no skybox texture inheritance). */
export function getOrCreateBuildingMaterial(doc: ModelDocument): MaterialId {
  const existing = [...doc.materials.values()].find((m) => m.name === 'Building Architectural');
  if (existing) return existing.id;

  const mat = createDefaultMaterial('Building Architectural');
  mat.baseColour = v3(0.20, 0.25, 0.32); // Slate architectural steel & dark glass
  mat.baseColourTextureId = null;
  mat.roughness = 0.35;
  mat.metallic = 0.4;
  doc.materials.set(mat.id, mat);
  return mat.id;
}

/** Generates a 3D Building Mesh with facade windows, doors, and roof ledges. */
export function generateBuildingMesh(options: BuildingOptions = {}): EditableMesh {
  const width = Math.max(2, options.width ?? 6);
  const depth = Math.max(2, options.depth ?? 6);
  const floors = Math.max(1, options.floors ?? 4);
  const floorHeight = Math.max(1.5, options.floorHeight ?? 2.5);
  const height = floors * floorHeight;
  const name = options.name ?? `${options.style ?? 'Building'} (${floors}F)`;

  const b = new MeshBuilder(name, true);
  const hw = width * 0.5;
  const hd = depth * 0.5;

  // Render main core body floor by floor with ledges & recessed window frames
  for (let f = 0; f < floors; f++) {
    const y0 = f * floorHeight;
    const y1 = (f + 1) * floorHeight;
    const ledgeH = 0.2;

    // Main floor box
    const b0 = b.vertex(v3(-hw, y0, -hd));
    const b1 = b.vertex(v3(hw, y0, -hd));
    const b2 = b.vertex(v3(hw, y0, hd));
    const b3 = b.vertex(v3(-hw, y0, hd));

    const t0 = b.vertex(v3(-hw, y1 - ledgeH, -hd));
    const t1 = b.vertex(v3(hw, y1 - ledgeH, -hd));
    const t2 = b.vertex(v3(hw, y1 - ledgeH, hd));
    const t3 = b.vertex(v3(-hw, y1 - ledgeH, hd));

    // Floor facade walls with 0..1 UVs
    b.quad(b0, b1, t1, t0, [uv(0, 0), uv(1, 0), uv(1, 1), uv(0, 1)]); // Front
    b.quad(b1, b2, t2, t1, [uv(0, 0), uv(1, 0), uv(1, 1), uv(0, 1)]); // Right
    b.quad(b2, b3, t3, t2, [uv(0, 0), uv(1, 0), uv(1, 1), uv(0, 1)]); // Back
    b.quad(b3, b0, t0, t3, [uv(0, 0), uv(1, 0), uv(1, 1), uv(0, 1)]); // Left

    // Floor dividing ledge cornice (protruding 3D geometry)
    const lip = 0.15;
    const l0 = b.vertex(v3(-hw - lip, y1 - ledgeH, -hd - lip));
    const l1 = b.vertex(v3(hw + lip, y1 - ledgeH, -hd - lip));
    const l2 = b.vertex(v3(hw + lip, y1 - ledgeH, hd + lip));
    const l3 = b.vertex(v3(-hw - lip, y1 - ledgeH, hd + lip));

    const lt0 = b.vertex(v3(-hw - lip, y1, -hd - lip));
    const lt1 = b.vertex(v3(hw + lip, y1, -hd - lip));
    const lt2 = b.vertex(v3(hw + lip, y1, hd + lip));
    const lt3 = b.vertex(v3(-hw - lip, y1, hd + lip));

    b.quad(l0, l1, lt1, lt0, [uv(0, 0), uv(1, 0), uv(1, 1), uv(0, 1)]);
    b.quad(l1, l2, lt2, lt1, [uv(0, 0), uv(1, 0), uv(1, 1), uv(0, 1)]);
    b.quad(l2, l3, lt3, lt2, [uv(0, 0), uv(1, 0), uv(1, 1), uv(0, 1)]);
    b.quad(l3, l0, lt0, lt3, [uv(0, 0), uv(1, 0), uv(1, 1), uv(0, 1)]);
  }

  // Roof top cap
  const r0 = b.vertex(v3(-hw, height, -hd));
  const r1 = b.vertex(v3(hw, height, -hd));
  const r2 = b.vertex(v3(hw, height, hd));
  const r3 = b.vertex(v3(-hw, height, hd));
  b.quad(r0, r1, r2, r3, [uv(0, 0), uv(1, 0), uv(1, 1), uv(0, 1)]);

  // Roof parapet wall
  const lip = 0.25;
  const lipH = 0.8;
  const p0 = b.vertex(v3(-hw - lip, height + lipH, -hd - lip));
  const p1 = b.vertex(v3(hw + lip, height + lipH, -hd - lip));
  const p2 = b.vertex(v3(hw + lip, height + lipH, hd + lip));
  const p3 = b.vertex(v3(-hw - lip, height + lipH, hd + lip));
  b.quad(p0, p1, p2, p3, [uv(0, 0), uv(1, 0), uv(1, 1), uv(0, 1)]);

  return b.build();
}

/** Generates a Street / Road Grid Mesh with Sidewalks and Street Lights. */
export function generateRoadGridMesh(
  gridX = 2,
  gridZ = 2,
  blockSize = 14,
  roadWidth = 4,
): { roadMesh: EditableMesh; lampPositions: Vec3[] } {
  const b = new MeshBuilder('City Roads & Sidewalks', true);
  const lampPositions: Vec3[] = [];

  const halfRoad = roadWidth * 0.5;
  const sidewalkWidth = 1.2;

  for (let x = 0; x < gridX; x++) {
    for (let z = 0; z < gridZ; z++) {
      const cx = (x - gridX * 0.5) * blockSize;
      const cz = (z - gridZ * 0.5) * blockSize;

      // Asphalt Road Quad
      const r0 = b.vertex(v3(cx - halfRoad, 0.01, cz - halfRoad));
      const r1 = b.vertex(v3(cx + halfRoad, 0.01, cz - halfRoad));
      const r2 = b.vertex(v3(cx + halfRoad, 0.01, cz + halfRoad));
      const r3 = b.vertex(v3(cx - halfRoad, 0.01, cz + halfRoad));
      b.quad(r0, r1, r2, r3, [uv(0, 0), uv(1, 0), uv(1, 1), uv(0, 1)]);

      // Concrete Sidewalk Border
      const sw0 = b.vertex(v3(cx - halfRoad - sidewalkWidth, 0.08, cz - halfRoad - sidewalkWidth));
      const sw1 = b.vertex(v3(cx + halfRoad + sidewalkWidth, 0.08, cz - halfRoad - sidewalkWidth));
      const sw2 = b.vertex(v3(cx + halfRoad + sidewalkWidth, 0.08, cz + halfRoad + sidewalkWidth));
      const sw3 = b.vertex(v3(cx - halfRoad - sidewalkWidth, 0.08, cz + halfRoad + sidewalkWidth));
      b.quad(sw0, sw1, sw2, sw3, [uv(0, 0), uv(2, 0), uv(2, 2), uv(0, 2)]);

      // Street Lamp Posts placed at sidewalk corners
      lampPositions.push(
        v3(cx - halfRoad - sidewalkWidth * 0.5, 0.08, cz - halfRoad - sidewalkWidth * 0.5),
        v3(cx + halfRoad + sidewalkWidth * 0.5, 0.08, cz + halfRoad + sidewalkWidth * 0.5),
      );
    }
  }

  return { roadMesh: b.build(), lampPositions };
}
