import { v2 } from '@/core/math/Vec2';
import {
  addVec3,
  crossVec3,
  dotVec3,
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

type PathFrames = {
  path: Vec3[];
  tangents: Vec3[];
  normals: Vec3[];
  binormals: Vec3[];
};

type CardFrame = {
  up: Vec3;
  side: Vec3;
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
      const cardHeight = radius * 3.4 * options.profileHeight * scale;
      const cardWidth = radius * 1.5 * options.profileWidth * scale;
      const verticalSegments = Math.max(1, Math.min(6, Math.round(options.radialSegments / 2)));
      appendCard(
        builder,
        sample,
        cardHeight,
        cardWidth,
        roll,
        mirror,
        verticalSegments,
      );
      if (options.cardCrossed) {
        appendCard(
          builder,
          sample,
          cardHeight,
          cardWidth,
          roll + Math.PI / 2,
          mirror,
          verticalSegments,
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
  const frames = buildPathFrames(points);
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
    const sample = interpolatePathSample(frames, lengths, distance, total, options.offset);
    if (sample) samples.push(sample);
  }
  return samples;
}

function interpolatePathSample(
  frames: PathFrames,
  lengths: number[],
  distance: number,
  total: number,
  offset: number,
): PathSample | null {
  if (frames.path.length < 2) return null;
  let segment = 1;
  while (segment < lengths.length - 1 && lengths[segment]! < distance) segment++;
  const span = Math.max(1e-8, lengths[segment]! - lengths[segment - 1]!);
  const t = Math.max(0, Math.min(1, (distance - lengths[segment - 1]!) / span));
  const index = segment - 1;
  const next = Math.min(index + 1, frames.path.length - 1);
  const position = addVec3(
    addVec3(frames.path[index]!, scaleVec3(subVec3(frames.path[next]!, frames.path[index]!), t)),
    scaleVec3(
      normalizeVec3(addVec3(
        scaleVec3(frames.normals[index]!, 1 - t),
        scaleVec3(frames.normals[next]!, t),
      )),
      offset,
    ),
  );
  let tangent = normalizeVec3(addVec3(
    scaleVec3(frames.tangents[index]!, 1 - t),
    scaleVec3(frames.tangents[next]!, t),
  ));
  if (lengthVec3(tangent) < 1e-8) tangent = frames.tangents[index]!;
  let normal = normalizeVec3(addVec3(
    scaleVec3(frames.normals[index]!, 1 - t),
    scaleVec3(frames.normals[next]!, t),
  ));
  normal = normalizeVec3(subVec3(normal, scaleVec3(tangent, dotVec3(normal, tangent))));
  if (lengthVec3(normal) < 1e-8) normal = frames.normals[index]!;
  const binormal = normalizeVec3(crossVec3(tangent, normal));
  return {
    position,
    tangent,
    normal,
    binormal,
    t: total > 0 ? distance / total : 0,
  };
}

function buildPathFrames(path: Vec3[]): PathFrames {
  const tangents = path.map((_point, index) => {
    const tangent =
      index === 0
        ? subVec3(path[1]!, path[0]!)
        : index === path.length - 1
          ? subVec3(path[index]!, path[index - 1]!)
          : subVec3(path[index + 1]!, path[index - 1]!);
    return lengthVec3(tangent) > 1e-8 ? normalizeVec3(tangent) : v3(0, 1, 0);
  });
  const normals: Vec3[] = [];
  const binormals: Vec3[] = [];
  const tangent0 = tangents[0]!;
  let firstNormal =
    Math.abs(dotVec3(tangent0, v3(0, 1, 0))) < 0.9
      ? normalizeVec3(crossVec3(tangent0, v3(0, 1, 0)))
      : normalizeVec3(crossVec3(tangent0, v3(1, 0, 0)));
  if (lengthVec3(firstNormal) < 1e-8) firstNormal = v3(1, 0, 0);
  normals.push(firstNormal);
  binormals.push(normalizeVec3(crossVec3(tangent0, firstNormal)));
  for (let index = 1; index < path.length; index++) {
    const tangent = tangents[index]!;
    let normal = normals[index - 1]!;
    const axis = crossVec3(tangents[index - 1]!, tangent);
    const axisLength = lengthVec3(axis);
    if (axisLength > 1e-8) {
      normal = rotateAroundAxis(
        normal,
        normalizeVec3(axis),
        Math.atan2(axisLength, Math.max(-1, Math.min(1, dotVec3(tangents[index - 1]!, tangent)))),
      );
    }
    normal = normalizeVec3(subVec3(normal, scaleVec3(tangent, dotVec3(normal, tangent))));
    if (lengthVec3(normal) < 1e-8) normal = normals[index - 1]!;
    normals.push(normal);
    binormals.push(normalizeVec3(crossVec3(tangent, normal)));
  }
  return { path, tangents, normals, binormals };
}

function appendCard(
  builder: MeshBuilder,
  sample: PathSample,
  height: number,
  width: number,
  roll: number,
  mirror: boolean,
  verticalSegments: number,
): void {
  const frame = computeVerticalCardFrame(sample, roll, mirror);
  const { up, side } = frame;
  const base = addVec3(sample.position, scaleVec3(up, -height * 0.08));
  const leanAxis = normalizeVec3(addVec3(
    scaleVec3(sample.normal, 0.65),
    scaleVec3(sample.binormal, 0.35),
  ));
  const rows: VertexId[][] = [];

  for (let row = 0; row <= verticalSegments; row++) {
    const t = row / verticalSegments;
    const ease = t * t;
    const widthScale = 1 - ease * 0.42;
    const topPinch = t > 0.72 ? 1 - (t - 0.72) / 0.28 * 0.55 : 1;
    const halfW = width * widthScale * topPinch * 0.5;
    const centre = addVec3(
      base,
      addVec3(scaleVec3(up, height * t), scaleVec3(leanAxis, ease * width * 0.12)),
    );
    rows.push([
      builder.vertex(addVec3(centre, scaleVec3(side, -halfW))),
      builder.vertex(addVec3(centre, scaleVec3(side, halfW))),
    ]);
  }

  for (let row = 0; row < verticalSegments; row++) {
    const v0 = row / verticalSegments;
    const v1 = (row + 1) / verticalSegments;
    const bl = rows[row]![0]!;
    const br = rows[row]![1]!;
    const tl = rows[row + 1]![0]!;
    const tr = rows[row + 1]![1]!;
    builder.quad(bl, br, tr, tl, [v2(0, v0), v2(1, v0), v2(1, v1), v2(0, v1)]);
  }
}

function computeVerticalCardFrame(sample: PathSample, roll: number, mirror: boolean): CardFrame {
  const worldUp = v3(0, 1, 0);
  let up = subVec3(worldUp, scaleVec3(sample.tangent, dotVec3(worldUp, sample.tangent)));
  if (lengthVec3(up) < 1e-6) up = normalizeVec3(sample.normal);
  else up = normalizeVec3(up);
  let side = normalizeVec3(crossVec3(up, sample.tangent));
  if (lengthVec3(side) < 1e-6) side = normalizeVec3(sample.binormal);
  if (mirror) side = scaleVec3(side, -1);
  const rotated = rotateAroundAxis(side, up, roll);
  return { up, side: normalizeVec3(rotated) };
}

function rotateAroundAxis(value: Vec3, axis: Vec3, angle: number): Vec3 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return addVec3(
    addVec3(scaleVec3(value, c), scaleVec3(crossVec3(axis, value), s)),
    scaleVec3(axis, dotVec3(axis, value) * (1 - c)),
  );
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
