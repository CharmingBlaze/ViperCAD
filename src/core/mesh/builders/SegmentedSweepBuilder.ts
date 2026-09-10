import {
  addVec3,
  lengthVec3,
  normalizeVec3,
  scaleVec3,
  subVec3,
  v3,
  type Vec3,
} from '@/core/math/Vec3';
import { faceVertexIds } from '@/core/mesh/EditableMesh';
import { MeshBuilder } from '@/core/mesh/MeshBuilder';
import type { EditableMesh, VertexId } from '@/core/mesh/types';
import {
  buildStyledCurveCapsule,
  type CurveSweepCapStyle,
} from '@/core/mesh/builders/CurveSweepBuilder';
import { resampleStrokePoints } from '@/core/mesh/builders/StrokeTubeBuilder';

export type SegmentedCapsuleSweepOptions = {
  points: Vec3[];
  radius: number;
  radialSegments?: number;
  segmentCount?: number;
  pathSpacingScale?: number;
  startCapStyle?: CurveSweepCapStyle;
  endCapStyle?: CurveSweepCapStyle;
  name?: string;
};

/** Open path → evenly spaced low-poly capsule sections (puffy sleeves, struts, segmented limbs). */
export function buildSegmentedCapsuleSweep(options: SegmentedCapsuleSweepOptions): EditableMesh {
  const radius = Math.max(1e-4, options.radius);
  const radialSegments = Math.max(8, Math.min(16, options.radialSegments ?? 10));
  const segmentCount = Math.max(2, Math.min(16, Math.round(options.segmentCount ?? 4)));
  const spacingScale = Math.max(0.25, options.pathSpacingScale ?? 1);
  const spacing = radius * 0.58 * spacingScale;
  let path = resampleStrokePoints(options.points, spacing);
  if (path.length < 2) {
    path.push(addVec3(path[0] ?? v3(), v3(radius * 2, 0, 0)));
  }

  const startCap = options.startCapStyle ?? 'round';
  const endCap = options.endCapStyle ?? 'round';
  const samples = samplePathByArc(path, segmentCount);
  const overlap = radius * 0.55;
  const builder = new MeshBuilder(options.name ?? 'Segmented Sweep', false);
  for (let index = 0; index < segmentCount; index++) {
    const segment = segmentEndpoints(samples, index, segmentCount, overlap);
    if (segment.length < 2) continue;
    const isFirst = index === 0;
    const isLast = index === segmentCount - 1;
    appendMesh(builder, buildStyledCurveCapsule({
      points: segment,
      radius,
      radialSegments,
      profile: 'round',
      cyclic: false,
      pathSpacingScale: 1.6 * spacingScale,
      startCapStyle: isFirst ? startCap : 'round',
      endCapStyle: isLast ? endCap : 'round',
      name: 'Segment',
    }));
  }
  return builder.build();
}

function segmentEndpoints(
  samples: Vec3[],
  index: number,
  _segmentCount: number,
  overlap: number,
): Vec3[] {
  let start = samples[index]!;
  let end = samples[index + 1]!;
  if (index > 0) {
    const back = normalizeVec3(subVec3(start, samples[index - 1]!));
    start = addVec3(start, scaleVec3(back, -overlap));
  }
  if (index + 1 < samples.length - 1) {
    const forward = normalizeVec3(subVec3(samples[index + 2]!, end));
    end = addVec3(end, scaleVec3(forward, overlap));
  }
  return [start, end];
}

function samplePathByArc(path: Vec3[], segmentCount: number): Vec3[] {
  const lengths: number[] = [0];
  for (let index = 1; index < path.length; index++) {
    lengths.push(lengths[index - 1]! + lengthVec3(subVec3(path[index]!, path[index - 1]!)));
  }
  const total = lengths[lengths.length - 1] ?? 0;
  if (total < 1e-6) return [path[0]!, path[path.length - 1]!];

  const samples: Vec3[] = [];
  for (let sample = 0; sample <= segmentCount; sample++) {
    const target = (total * sample) / segmentCount;
    let segmentIndex = 1;
    while (segmentIndex < lengths.length && lengths[segmentIndex]! < target) segmentIndex += 1;
    const start = path[Math.max(0, segmentIndex - 1)]!;
    const end = path[Math.min(path.length - 1, segmentIndex)]!;
    const span = Math.max(1e-8, (lengths[segmentIndex] ?? total) - (lengths[segmentIndex - 1] ?? 0));
    const t = Math.max(0, Math.min(1, (target - (lengths[segmentIndex - 1] ?? 0)) / span));
    samples.push(addVec3(start, scaleLike(start, end, t)));
  }
  return samples;
}

function scaleLike(from: Vec3, to: Vec3, t: number): Vec3 {
  return {
    x: (to.x - from.x) * t,
    y: (to.y - from.y) * t,
    z: (to.z - from.z) * t,
  };
}

function appendMesh(builder: MeshBuilder, source: EditableMesh): void {
  const vertexMap = new Map<VertexId, VertexId>();
  for (const vertex of source.vertices.values()) {
    vertexMap.set(vertex.id, builder.vertex(vertex.position));
  }
  for (const face of source.faces.values()) {
    const verts = faceVertexIds(source, face.id).map((id) => vertexMap.get(id)!);
    if (verts.length === 3) {
      builder.tri(verts[0]!, verts[1]!, verts[2]!);
    } else if (verts.length === 4) {
      builder.quad(verts[0]!, verts[1]!, verts[2]!, verts[3]!);
    } else if (verts.length > 4) {
      builder.ngon(verts);
    }
  }
}
