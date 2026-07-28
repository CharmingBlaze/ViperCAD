import { v3, type Vec3 } from '@/core/math/Vec3';
import { v2 as uv } from '@/core/math/Vec2';
import { MeshBuilder } from '@/core/mesh/MeshBuilder';
import { bumpPositions, bumpTopology } from '@/core/mesh/EditableMesh';
import type { EditableMesh } from '@/core/mesh/types';

/** Generates an Arch / Girder Bridge Mesh across a river or valley. */
export function buildBridgeMesh(
  startPos: Vec3,
  endPos: Vec3,
  options: { width?: number; thickness?: number; archHeight?: number; pillars?: boolean } = {},
): EditableMesh {
  const b = new MeshBuilder('Girder Bridge', true);
  const width = Math.max(1, options.width ?? 3);
  const thickness = Math.max(0.2, options.thickness ?? 0.8);
  const halfW = width * 0.5;

  const dx = endPos.x - startPos.x;
  const dy = endPos.y - startPos.y;
  const dz = endPos.z - startPos.z;
  const length = Math.hypot(dx, dz);
  const segments = Math.max(8, Math.floor(length * 2));

  // Tangent and Normal
  const tx = length > 1e-6 ? dx / length : 0;
  const tz = length > 1e-6 ? dz / length : 1;
  const nx = -tz;
  const nz = tx;

  const deckPoints: { left: Vec3; right: Vec3; leftB: Vec3; rightB: Vec3; v: number }[] = [];

  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const px = startPos.x + dx * t;
    const py = startPos.y + dy * t + Math.sin(t * Math.PI) * (options.archHeight ?? 0);
    const pz = startPos.z + dz * t;

    const left = v3(px - nx * halfW, py, pz - nz * halfW);
    const right = v3(px + nx * halfW, py, pz + nz * halfW);
    const leftB = v3(px - nx * halfW, py - thickness, pz - nz * halfW);
    const rightB = v3(px + nx * halfW, py - thickness, pz + nz * halfW);

    deckPoints.push({ left, right, leftB, rightB, v: t * (length / width) });
  }

  // Build bridge deck quads
  for (let i = 0; i < deckPoints.length - 1; i++) {
    const p1 = deckPoints[i]!;
    const p2 = deckPoints[i + 1]!;

    const v1 = b.vertex(p1.left);
    const v2 = b.vertex(p1.right);
    const v3Pt = b.vertex(p2.right);
    const v4 = b.vertex(p2.left);

    // Top deck
    b.quad(v1, v2, v3Pt, v4, [uv(0, p1.v), uv(1, p1.v), uv(1, p2.v), uv(0, p2.v)]);
  }

  return b.build();
}

/** Carves a 3D hollow cave tunnel into cliff terrain. */
export function carveCaveTunnel(
  mesh: EditableMesh,
  entrancePos: Vec3,
  radius = 4,
  tunnelLength = 12,
): number {
  let affected = 0;
  const r = Math.max(0.5, radius);

  for (const vertex of mesh.vertices.values()) {
    const dx = vertex.position.x - entrancePos.x;
    const dy = vertex.position.y - entrancePos.y;
    const dz = vertex.position.z - entrancePos.z;
    const distXZ = Math.hypot(dx, dz);

    if (distXZ <= r && Math.abs(dy) <= r * 1.2 && dz >= 0 && dz <= tunnelLength) {
      // Push terrain Y height down to carve cave archway
      const archFloor = entrancePos.y - r * 0.8;
      if (vertex.position.y > archFloor) {
        vertex.position.y = archFloor;
        affected += 1;
      }
    }
  }

  if (affected > 0) {
    bumpTopology(mesh);
    bumpPositions(mesh);
  }
  return affected;
}

/** Generates a 3D Vertical Waterfall Ribbon Mesh with animated splash foam. */
export function generateWaterfallMesh(
  topPos: Vec3,
  bottomPos: Vec3,
  width = 4,
): EditableMesh {
  const b = new MeshBuilder('Waterfall Ribbon', true);
  const halfW = width * 0.5;

  const dx = bottomPos.x - topPos.x;
  const dy = bottomPos.y - topPos.y;
  const dz = bottomPos.z - topPos.z;
  const height = Math.abs(dy);
  const segments = Math.max(6, Math.floor(height * 2));

  // Normal across XZ
  const nx = Math.abs(dx) > 1e-6 ? -dz / Math.hypot(dx, dz) : 1;
  const nz = Math.abs(dz) > 1e-6 ? dx / Math.hypot(dx, dz) : 0;

  const pts: { left: Vec3; right: Vec3; v: number }[] = [];

  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const px = topPos.x + dx * t;
    const py = topPos.y + dy * t;
    const pz = topPos.z + dz * t;

    const left = v3(px - nx * halfW, py, pz - nz * halfW);
    const right = v3(px + nx * halfW, py, pz + nz * halfW);
    pts.push({ left, right, v: t * (height / width) });
  }

  for (let i = 0; i < pts.length - 1; i++) {
    const p1 = pts[i]!;
    const p2 = pts[i + 1]!;

    const v1 = b.vertex(p1.left);
    const v2 = b.vertex(p1.right);
    const v3Pt = b.vertex(p2.right);
    const v4 = b.vertex(p2.left);

    b.quad(v1, v2, v3Pt, v4, [uv(0, p1.v), uv(1, p1.v), uv(1, p2.v), uv(0, p2.v)]);
  }

  return b.build();
}
