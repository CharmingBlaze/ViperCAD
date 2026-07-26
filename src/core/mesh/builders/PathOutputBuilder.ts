import { v2 } from '@/core/math/Vec2';
import {
  addVec3,
  crossVec3,
  lengthVec3,
  normalizeVec3,
  scaleVec3,
  subVec3,
  v3,
  type Vec3,
} from '@/core/math/Vec3';
import { faceCornerIds, faceVertexIds } from '@/core/mesh/EditableMesh';
import { MeshBuilder } from '@/core/mesh/MeshBuilder';
import type { EditableMesh, VertexId } from '@/core/mesh/types';
import { validateMeshFull } from '@/core/mesh/Validation';
import { flipFaces } from '@/core/mesh/ops/basic';
import {
  buildCurveRope,
  buildCurveSweep,
  type CurveSweepCapStyle,
  type CurveSweepProfile,
} from '@/core/mesh/builders/CurveSweepBuilder';

export type PathOutput =
  | 'tube'
  | 'ribbon'
  | 'chain'
  | 'vine'
  | 'rope'
  | 'cards'
  | 'object-array'
  | 'profile-sweep';
export type PathProfile = 'round' | 'square' | 'rectangle' | 'rail';
export type PathDistributionMode = 'spacing' | 'count' | 'fit';

export type PathOutputOptions = {
  points: Vec3[];
  output: PathOutput;
  radius: number;
  radialSegments: number;
  startCap: CurveSweepCapStyle;
  endCap: CurveSweepCapStyle;
  startScale: number;
  endScale: number;
  offset: number;
  twist: number;
  spacing: number;
  profile: PathProfile;
  profileWidth: number;
  profileHeight: number;
  chainAlternating: boolean;
  cardCrossed: boolean;
  distributionMode: PathDistributionMode;
  count: number;
  startPadding: number;
  endPadding: number;
  randomScale: number;
  rotation: number;
  randomRotation: number;
  alternateRotation: boolean;
  mirrorAlternate: boolean;
  seed: number;
  cyclic: boolean;
  sourceMesh?: EditableMesh | null;
  name?: string;
};

type PathSample = {
  position: Vec3;
  tangent: Vec3;
  normal: Vec3;
  binormal: Vec3;
  t: number;
};

export function buildPathOutput(options: PathOutputOptions): EditableMesh {
  const radius = Math.max(0.001, options.radius);
  const common = {
    points: options.points,
    radius,
    radialSegments: Math.max(3, Math.round(options.radialSegments)),
    profileWidth: options.profileWidth,
    profileHeight: options.profileHeight,
    startScale: options.startScale,
    endScale: options.endScale,
    twistDegrees: options.twist,
    cyclic: options.cyclic,
    capStart: options.startCap !== 'open',
    capEnd: options.endCap !== 'open',
    startCapStyle: options.startCap,
    endCapStyle: options.endCap,
    pathOffset: options.offset,
    name: options.name,
  } as const;
  if (options.output === 'tube') return ensureOutward(buildCurveSweep({ ...common, profile: 'round' }));
  if (options.output === 'ribbon') return ensureOutward(buildCurveSweep({ ...common, profile: 'ribbon' }));
  if (options.output === 'vine') {
    return ensureOutward(buildCurveSweep({
      ...common,
      profile: 'round',
      startCapStyle: options.startCap === 'flat' ? 'round' : options.startCap,
      endCapStyle: options.endCap === 'flat' ? 'pointed' : options.endCap,
      pathSpacingScale: 0.7,
    }));
  }
  if (options.output === 'rope') return ensureOutward(buildCurveRope({ ...common, profile: 'round' }));
  if (options.output === 'profile-sweep') {
    return ensureOutward(buildCurveSweep({
      ...common,
      profile: profileName(options.profile),
    }));
  }

  const samples = samplePath(options);
  const builder = new MeshBuilder(options.name ?? pathOutputLabel(options.output), false);
  const random = seededRandom(options.seed);
  samples.forEach((sample, index) => {
    const baseScale =
      options.startScale + (options.endScale - options.startScale) * sample.t;
    const scale = Math.max(
      0.01,
      baseScale * (1 + (random() * 2 - 1) * options.randomScale),
    );
    const randomRotation = (random() * 2 - 1) * options.randomRotation;
    const alternate = options.alternateRotation && index % 2 ? 90 : 0;
    const roll = (options.rotation + randomRotation + alternate) * Math.PI / 180;
    const mirror = options.mirrorAlternate && index % 2 === 1;
    if (options.output === 'chain') {
      appendChainLink(
        builder,
        sample,
        radius * 1.35 * scale,
        radius * 0.34 * scale,
        options.radialSegments,
        options.chainAlternating && index % 2 === 1 ? Math.PI / 2 : 0,
      );
    } else if (options.output === 'cards') {
      appendCard(
        builder,
        sample,
        radius * 4 * options.profileHeight * scale,
        radius * 2 * options.profileWidth * scale,
        roll,
        mirror,
      );
      if (options.cardCrossed) {
        appendCard(
          builder,
          sample,
          radius * 4 * options.profileHeight * scale,
          radius * 2 * options.profileWidth * scale,
          roll + Math.PI / 2,
          mirror,
        );
      }
    } else if (options.sourceMesh) {
      appendSourceMesh(builder, options.sourceMesh, sample, scale, roll, mirror);
    } else {
      appendBox(builder, sample, radius * 1.3 * scale, roll, mirror);
    }
  });
  return ensureOutward(builder.build());
}

function samplePath(options: PathOutputOptions): PathSample[] {
  const points = options.points;
  if (points.length < 2) return [];
  const lengths = [0];
  for (let index = 1; index < points.length; index++) {
    lengths.push(lengths[index - 1]! + lengthVec3(subVec3(points[index]!, points[index - 1]!)));
  }
  const total = lengths[lengths.length - 1]!;
  const start = Math.min(total, Math.max(0, options.startPadding));
  const end = Math.max(start, total - Math.max(0, options.endPadding));
  const usable = end - start;
  const bySpacing = Math.max(1, Math.floor(usable / Math.max(0.01, options.spacing)) + 1);
  const count =
    options.distributionMode === 'count'
      ? Math.max(1, Math.round(options.count))
      : options.distributionMode === 'fit'
        ? Math.max(1, Math.round(usable / Math.max(0.01, options.spacing)))
        : bySpacing;
  const samples: PathSample[] = [];
  for (let sampleIndex = 0; sampleIndex < count; sampleIndex++) {
    const distance =
      count === 1 ? start + usable * 0.5 : start + usable * sampleIndex / (count - 1);
    let segment = 1;
    while (segment < lengths.length - 1 && lengths[segment]! < distance) segment++;
    const a = points[segment - 1]!;
    const b = points[segment]!;
    const span = Math.max(1e-8, lengths[segment]! - lengths[segment - 1]!);
    const t = Math.max(0, Math.min(1, (distance - lengths[segment - 1]!) / span));
    const tangent = normalizeVec3(subVec3(b, a));
    let normal = normalizeVec3(crossVec3(tangent, v3(0, 1, 0)));
    if (lengthVec3(normal) < 1e-6) normal = normalizeVec3(crossVec3(tangent, v3(1, 0, 0)));
    const binormal = normalizeVec3(crossVec3(tangent, normal));
    samples.push({
      position: addVec3(
        addVec3(a, scaleVec3(subVec3(b, a), t)),
        scaleVec3(normal, options.offset),
      ),
      tangent,
      normal,
      binormal,
      t: total > 0 ? distance / total : 0,
    });
  }
  return samples;
}

function appendCard(
  builder: MeshBuilder,
  sample: PathSample,
  length: number,
  width: number,
  roll: number,
  mirror: boolean,
): void {
  const side = rotatedSide(sample, roll, mirror);
  const along = sample.tangent;
  const corners = [
    addVec3(sample.position, addVec3(scaleVec3(along, -length / 2), scaleVec3(side, -width / 2))),
    addVec3(sample.position, addVec3(scaleVec3(along, length / 2), scaleVec3(side, -width / 2))),
    addVec3(sample.position, addVec3(scaleVec3(along, length / 2), scaleVec3(side, width / 2))),
    addVec3(sample.position, addVec3(scaleVec3(along, -length / 2), scaleVec3(side, width / 2))),
  ].map((point) => builder.vertex(point));
  builder.quad(corners[0]!, corners[1]!, corners[2]!, corners[3]!, [
    v2(0, 0), v2(1, 0), v2(1, 1), v2(0, 1),
  ]);
}

function appendBox(
  builder: MeshBuilder,
  sample: PathSample,
  size: number,
  roll: number,
  mirror: boolean,
): void {
  const y = rotatedSide(sample, roll, mirror);
  const z = normalizeVec3(crossVec3(sample.tangent, y));
  const local = [
    [-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1],
    [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1],
  ].map(([x0, y0, z0]) => builder.vertex(addVec3(
    sample.position,
    addVec3(
      scaleVec3(sample.tangent, x0! * size * 0.5),
      addVec3(scaleVec3(y, y0! * size * 0.5), scaleVec3(z, z0! * size * 0.5)),
    ),
  )));
  const faces = [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]];
  faces.forEach((face) => builder.ngon(face.map((index) => local[index]!), [
    v2(0, 0), v2(1, 0), v2(1, 1), v2(0, 1),
  ]));
}

function appendChainLink(
  builder: MeshBuilder,
  sample: PathSample,
  major: number,
  minor: number,
  detail: number,
  roll: number,
): void {
  const around = Math.max(12, Math.min(24, Math.round(detail) * 2));
  const tube = Math.max(5, Math.min(10, Math.round(detail)));
  const side = rotatedSide(sample, roll, false);
  const depth = normalizeVec3(crossVec3(sample.tangent, side));
  const rings: VertexId[][] = [];
  for (let ring = 0; ring < around; ring++) {
    const a = ring / around * Math.PI * 2;
    const centre = addVec3(
      sample.position,
      addVec3(
        scaleVec3(sample.tangent, Math.cos(a) * major),
        scaleVec3(side, Math.sin(a) * major * 0.72),
      ),
    );
    const radial = normalizeVec3(addVec3(
      scaleVec3(sample.tangent, Math.cos(a)),
      scaleVec3(side, Math.sin(a)),
    ));
    rings.push(Array.from({ length: tube }, (_unused, sideIndex) => {
      const b = sideIndex / tube * Math.PI * 2;
      return builder.vertex(addVec3(
        centre,
        addVec3(scaleVec3(radial, Math.cos(b) * minor), scaleVec3(depth, Math.sin(b) * minor)),
      ));
    }));
  }
  for (let ring = 0; ring < around; ring++) {
    const nextRing = (ring + 1) % around;
    for (let sideIndex = 0; sideIndex < tube; sideIndex++) {
      const nextSide = (sideIndex + 1) % tube;
      builder.quad(
        rings[ring]![sideIndex]!,
        rings[nextRing]![sideIndex]!,
        rings[nextRing]![nextSide]!,
        rings[ring]![nextSide]!,
        [
          v2(ring / around, sideIndex / tube),
          v2((ring + 1) / around, sideIndex / tube),
          v2((ring + 1) / around, (sideIndex + 1) / tube),
          v2(ring / around, (sideIndex + 1) / tube),
        ],
      );
    }
  }
}

function appendSourceMesh(
  builder: MeshBuilder,
  source: EditableMesh,
  sample: PathSample,
  scale: number,
  roll: number,
  mirror: boolean,
): void {
  const positions = [...source.vertices.values()].map((vertex) => vertex.position);
  const centre = positions.reduce((sum, point) => addVec3(sum, point), v3());
  const origin = scaleVec3(centre, 1 / Math.max(1, positions.length));
  const side = rotatedSide(sample, roll, mirror);
  const depth = normalizeVec3(crossVec3(sample.tangent, side));
  const ids = new Map<string, VertexId>();
  for (const vertex of source.vertices.values()) {
    const local = subVec3(vertex.position, origin);
    ids.set(vertex.id, builder.vertex(addVec3(
      sample.position,
      addVec3(
        scaleVec3(sample.tangent, local.x * scale),
        addVec3(scaleVec3(side, local.y * scale), scaleVec3(depth, local.z * scale)),
      ),
    )));
  }
  for (const face of source.faces.values()) {
    const vertexIds = faceVertexIds(source, face.id).map((id) => ids.get(id)!);
    const uvs = faceCornerIds(source, face.id).map((cornerId) =>
      source.faceCorners.get(cornerId)?.uvs.get(source.defaultUvLayerId ?? '') ?? v2(),
    );
    builder.ngon(vertexIds, uvs.length === vertexIds.length ? uvs : undefined, face.materialSlot);
  }
}

function rotatedSide(sample: PathSample, roll: number, mirror: boolean): Vec3 {
  const sign = mirror ? -1 : 1;
  return normalizeVec3(addVec3(
    scaleVec3(sample.normal, Math.cos(roll) * sign),
    scaleVec3(sample.binormal, Math.sin(roll)),
  ));
}

function profileName(profile: PathProfile): CurveSweepProfile {
  if (profile === 'round') return 'round';
  if (profile === 'rail') return 'rail';
  return 'square';
}

function seededRandom(seed: number): () => number {
  let state = (Math.floor(seed) || 1) >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function pathOutputLabel(output: PathOutput): string {
  if (output === 'object-array') return 'Path Object Array';
  if (output === 'profile-sweep') return 'Path Profile Sweep';
  return `Path ${output[0]!.toUpperCase()}${output.slice(1)}`;
}

function ensureOutward(mesh: EditableMesh): EditableMesh {
  if (validateMeshFull(mesh).issues.some((issue) => issue.code === 'INWARD_WINDING')) {
    const result = flipFaces(mesh, [...mesh.faces.keys()]);
    if (!result.ok) throw new Error(result.error?.message ?? 'Could not correct path output winding');
  }
  return mesh;
}
