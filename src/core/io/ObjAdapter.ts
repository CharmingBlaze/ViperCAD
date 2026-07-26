import { MeshBuilder } from '@/core/mesh/MeshBuilder';
import { faceCornerIds, faceVertexIds } from '@/core/mesh/EditableMesh';
import { triangulateFace } from '@/core/mesh/Triangulation';
import type { EditableMesh, VertexId } from '@/core/mesh/types';
import { v2 } from '@/core/math/Vec2';
import { v3 } from '@/core/math/Vec3';

/** OBJ import preserving polygon faces and independent per-corner UV indices. */
export function importObj(text: string, name = 'OBJ Import'): EditableMesh {
  const positions: { x: number; y: number; z: number }[] = [];
  const texcoords: { x: number; y: number }[] = [];
  const faces: { refs: { v: number; vt: number | null }[]; material: number }[] = [];
  const materials = new Map<string, number>();
  let material = 0;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const parts = line.split(/\s+/);
    if (parts[0] === 'v' && parts.length >= 4) positions.push(v3(Number(parts[1]), Number(parts[2]), Number(parts[3])));
    else if (parts[0] === 'vt' && parts.length >= 3) texcoords.push(v2(Number(parts[1]), Number(parts[2])));
    else if (parts[0] === 'usemtl') {
      const key = parts.slice(1).join(' ');
      if (!materials.has(key)) materials.set(key, materials.size);
      material = materials.get(key)!;
    } else if (parts[0] === 'f' && parts.length >= 4) {
      const refs = parts.slice(1).map((token) => {
        const [vi, ti] = token.split('/');
        return { v: resolveIndex(Number(vi), positions.length), vt: ti ? resolveIndex(Number(ti), texcoords.length) : null };
      });
      faces.push({ refs, material });
    }
  }
  const builder = new MeshBuilder(name, false);
  const vertices: VertexId[] = positions.map((p) => builder.vertex(p));
  builder.setMaterialSlotCount(Math.max(1, materials.size));
  for (const face of faces) builder.ngon(face.refs.map((r) => vertices[r.v]!), face.refs.map((r) => r.vt == null ? v2(0, 0) : texcoords[r.vt]!), face.material);
  return builder.build();
}

export function exportObj(mesh: EditableMesh, options: { triangulate?: boolean } = {}): string {
  const lines = [`# ViperCAD OBJ`, `o ${mesh.name}`];
  const vertexIndex = new Map<VertexId, number>();
  let vi = 1;
  for (const vertex of mesh.vertices.values()) { vertexIndex.set(vertex.id, vi++); lines.push(`v ${fmt(vertex.position.x)} ${fmt(vertex.position.y)} ${fmt(vertex.position.z)}`); }
  const cornerIndex = new Map<string, number>();
  let ti = 1;
  for (const corner of mesh.faceCorners.values()) {
    const uv = mesh.defaultUvLayerId ? corner.uvs.get(mesh.defaultUvLayerId) : null;
    cornerIndex.set(corner.id, ti++); lines.push(`vt ${fmt(uv?.x ?? 0)} ${fmt(uv?.y ?? 0)}`);
  }
  let activeSlot = -1;
  for (const face of mesh.faces.values()) {
    if (face.materialSlot !== activeSlot) { activeSlot = face.materialSlot; lines.push(`usemtl material_${activeSlot}`); }
    const verts = faceVertexIds(mesh, face.id); const corners = faceCornerIds(mesh, face.id);
    const emit = (indices: number[]) => lines.push(`f ${indices.map((i) => `${vertexIndex.get(verts[i]!)}/${cornerIndex.get(corners[i]!)}`).join(' ')}`);
    if (options.triangulate) for (const tri of triangulateFace(mesh, face.id).triangles) emit(tri);
    else emit(verts.map((_, i) => i));
  }
  return `${lines.join('\n')}\n`;
}

function resolveIndex(index: number, length: number): number { const resolved = index < 0 ? length + index : index - 1; if (resolved < 0 || resolved >= length) throw new Error(`OBJ index ${index} is out of range`); return resolved; }
function fmt(value: number): string { return Number.isFinite(value) ? Number(value.toFixed(9)).toString() : '0'; }
