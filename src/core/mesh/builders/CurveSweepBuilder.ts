import { v2, type Vec2 } from '@/core/math/Vec2';
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
import { MeshBuilder } from '@/core/mesh/MeshBuilder';
import { resampleStrokePoints } from '@/core/mesh/builders/StrokeTubeBuilder';
import type { EditableMesh, VertexId } from '@/core/mesh/types';

export type CurveSweepProfile = 'round' | 'square' | 'ribbon' | 'rail';
export type CurveSweepCapStyle = 'flat' | 'round' | 'pointed' | 'open';

export type CurveSweepOptions = {
  points: Vec3[];
  radius: number;
  radialSegments: number;
  profile: CurveSweepProfile;
  profileWidth?: number;
  profileHeight?: number;
  startScale?: number;
  endScale?: number;
  twistDegrees?: number;
  cyclic?: boolean;
  capStart?: boolean;
  capEnd?: boolean;
  taperStart?: boolean;
  taperEnd?: boolean;
  startCapStyle?: CurveSweepCapStyle;
  endCapStyle?: CurveSweepCapStyle;
  pathOffset?: number;
  /** Larger values create fewer path rings for deliberate low-poly strips. */
  pathSpacingScale?: number;
  /** Optional scale multiplier per generated path ring. */
  ringScales?: number[];
  name?: string;
};

type PathFrames = {
  path: Vec3[];
  tangents: Vec3[];
  normals: Vec3[];
  binormals: Vec3[];
};

/** General purpose profile sweep used by Viper's editable stroke and hair tools. */
export function buildCurveSweep(options: CurveSweepOptions): EditableMesh {
  const radius = Math.max(1e-4, options.radius);
  const path = resampleStrokePoints(
    options.points,
    radius * 0.35 * Math.max(0.25, options.pathSpacingScale ?? 1),
  );
  if (path.length < 2) path.push(addVec3(path[0] ?? v3(), v3(radius * 2, 0, 0)));
  const cyclic = options.cyclic === true && path.length > 2;
  if (cyclic) path.push({ ...path[0]! });

  const frames = buildFrames(path);
  const profile = profilePoints(options.profile, Math.max(3, options.radialSegments));
  const builder = new MeshBuilder(options.name ?? 'Curve Sweep', false);
  appendSweep(builder, frames, profile, options);
  return builder.build();
}

/**
 * Rounded capsule sweep with true hemispherical start and finish ends.
 * Closed paths become a seamless round tube without overlapping end caps.
 */
export function buildCurveCapsule(options: CurveSweepOptions): EditableMesh {
  const radius = Math.max(1e-4, options.radius);
  const path = resampleStrokePoints(
    options.points,
    radius * 0.22 * Math.max(0.25, options.pathSpacingScale ?? 1),
  );
  if (path.length < 2) path.push(addVec3(path[0] ?? v3(), v3(radius * 2, 0, 0)));
  const cyclic = options.cyclic === true && path.length > 2;
  if (cyclic) {
    path.push({ ...path[0]! });
    const builder = new MeshBuilder(options.name ?? 'Curve Capsule', false);
    appendSweep(builder, buildFrames(path), profilePoints('round', Math.max(12, options.radialSegments)), {
      ...options,
      points: path,
      profile: 'round',
      cyclic: true,
      capStart: false,
      capEnd: false,
    });
    return builder.build();
  }

  const guide = buildFrames(path);
  const capRings = Math.max(3, Math.min(8, Math.ceil(options.radialSegments / 4)));
  const expandedPath: Vec3[] = [];
  const ringScales: number[] = [];
  const start = path[0]!;
  const startTangent = guide.tangents[0]!;
  for (let ring = 0; ring < capRings; ring++) {
    const angle = ring / capRings * Math.PI * 0.5;
    expandedPath.push(addVec3(start, scaleVec3(startTangent, -Math.cos(angle) * radius)));
    ringScales.push(Math.max(0.015, Math.sin(angle)));
  }
  for (const point of path) {
    expandedPath.push({ ...point });
    ringScales.push(1);
  }
  const end = path[path.length - 1]!;
  const endTangent = guide.tangents[guide.tangents.length - 1]!;
  for (let ring = 1; ring <= capRings; ring++) {
    const angle = ring / capRings * Math.PI * 0.5;
    expandedPath.push(addVec3(end, scaleVec3(endTangent, Math.sin(angle) * radius)));
    ringScales.push(Math.max(0.015, Math.cos(angle)));
  }

  const builder = new MeshBuilder(options.name ?? 'Curve Capsule', false);
  appendSweep(
    builder,
    buildFrames(expandedPath),
    profilePoints('round', Math.max(12, options.radialSegments)),
    {
      ...options,
      points: expandedPath,
      profile: 'round',
      cyclic: false,
      capStart: true,
      capEnd: true,
      startCapStyle: 'flat',
      endCapStyle: 'flat',
      startScale: 1,
      endScale: 1,
      ringScales,
    },
  );
  return builder.build();
}

/** Three true swept strands orbiting one guide path. */
export function buildCurveRope(options: CurveSweepOptions): EditableMesh {
  const radius = Math.max(1e-4, options.radius);
  const path = resampleStrokePoints(options.points, radius * 0.3);
  if (path.length < 2) path.push(addVec3(path[0] ?? v3(), v3(radius * 2, 0, 0)));
  const cyclic = options.cyclic === true && path.length > 2;
  if (cyclic) path.push({ ...path[0]! });
  const guide = buildFrames(path);
  const builder = new MeshBuilder(options.name ?? 'Curve Rope', false);
  const total = pathLength(path);
  const twists = (options.twistDegrees ?? 360) * Math.PI / 180;
  for (let strand = 0; strand < 3; strand++) {
    let travelled = 0;
    const strandPath = path.map((point, index) => {
      if (index > 0) travelled += lengthVec3(subVec3(point, path[index - 1]!));
      const t = total > 1e-8 ? travelled / total : 0;
      const phase = twists * t + strand * Math.PI * 2 / 3;
      return addVec3(
        point,
        addVec3(
          scaleVec3(guide.normals[index]!, Math.cos(phase) * radius * 0.55),
          scaleVec3(guide.binormals[index]!, Math.sin(phase) * radius * 0.55),
        ),
      );
    });
    appendSweep(
      builder,
      buildFrames(strandPath),
      profilePoints('round', Math.max(5, options.radialSegments - 2)),
      { ...options, points: strandPath, radius: radius * 0.42, profile: 'round', twistDegrees: 0 },
    );
  }
  return builder.build();
}

function appendSweep(
  builder: MeshBuilder,
  frames: PathFrames,
  profile: Vec2[],
  options: CurveSweepOptions,
): void {
  const count = profile.length;
  const rings: VertexId[][] = [];
  const startScale = clampScale(options.startScale ?? 1);
  const endScale = clampScale(options.endScale ?? 1);
  const width = Math.max(0.05, options.profileWidth ?? 1);
  const height = Math.max(0.05, options.profileHeight ?? 1);
  const twist = (options.twistDegrees ?? 0) * Math.PI / 180;
  const radius = Math.max(1e-4, options.radius);

  for (let index = 0; index < frames.path.length; index++) {
    const t = index / Math.max(1, frames.path.length - 1);
    let scale =
      (startScale + (endScale - startScale) * t) *
      (options.ringScales?.[index] ?? 1);
    const startCap = options.startCapStyle ?? (options.taperStart ? 'pointed' : 'flat');
    const endCap = options.endCapStyle ?? (options.taperEnd ? 'pointed' : 'flat');
    if (startCap === 'pointed') scale *= smoothTip(Math.min(1, t / 0.32));
    if (endCap === 'pointed') scale *= smoothTip(Math.min(1, (1 - t) / 0.32));
    if (startCap === 'round') scale *= Math.sin(Math.PI * 0.5 * Math.min(1, t / 0.18));
    if (endCap === 'round') scale *= Math.sin(Math.PI * 0.5 * Math.min(1, (1 - t) / 0.18));
    scale = Math.max(0.015, scale);
    const angle = twist * t;
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    const ring: VertexId[] = [];
    for (const point of profile) {
      const px = (point.x * c - point.y * s) * width;
      const py = (point.x * s + point.y * c) * height;
      const offset = addVec3(
        scaleVec3(frames.normals[index]!, px * radius * scale),
        scaleVec3(frames.binormals[index]!, py * radius * scale),
      );
      const centre = addVec3(
        frames.path[index]!,
        scaleVec3(frames.normals[index]!, options.pathOffset ?? 0),
      );
      ring.push(builder.vertex(addVec3(centre, offset)));
    }
    rings.push(ring);
  }

  for (let index = 0; index < rings.length - 1; index++) {
    const current = rings[index]!;
    const next = rings[index + 1]!;
    const v0 = index / Math.max(1, rings.length - 1);
    const v1 = (index + 1) / Math.max(1, rings.length - 1);
    for (let side = 0; side < count; side++) {
      const sideNext = (side + 1) % count;
      builder.quad(current[side]!, current[sideNext]!, next[sideNext]!, next[side]!, [
        v2(side / count, v0),
        v2((side + 1) / count, v0),
        v2((side + 1) / count, v1),
        v2(side / count, v1),
      ]);
    }
  }

  if (
    !options.cyclic &&
    options.capStart !== false &&
    options.startCapStyle !== 'open'
  ) {
    builder.ngon([...rings[0]!].reverse(), profileCapUvs(profile, true));
  }
  if (
    !options.cyclic &&
    options.capEnd !== false &&
    options.endCapStyle !== 'open'
  ) {
    builder.ngon([...rings[rings.length - 1]!], profileCapUvs(profile, false));
  }
}

function buildFrames(path: Vec3[]): PathFrames {
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
  const t0 = tangents[0]!;
  let firstNormal =
    Math.abs(dotVec3(t0, v3(0, 1, 0))) < 0.9
      ? normalizeVec3(crossVec3(t0, v3(0, 1, 0)))
      : normalizeVec3(crossVec3(t0, v3(1, 0, 0)));
  if (lengthVec3(firstNormal) < 1e-8) firstNormal = v3(1, 0, 0);
  normals.push(firstNormal);
  binormals.push(normalizeVec3(crossVec3(t0, firstNormal)));
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

function profilePoints(profile: CurveSweepProfile, segments: number): Vec2[] {
  if (profile === 'round') {
    return Array.from({ length: segments }, (_value, index) =>
      v2(Math.cos(index / segments * Math.PI * 2), Math.sin(index / segments * Math.PI * 2)),
    );
  }
  if (profile === 'ribbon') return [v2(-1, -0.12), v2(1, -0.12), v2(1, 0.12), v2(-1, 0.12)];
  if (profile === 'square') return [v2(-1, -1), v2(1, -1), v2(1, 1), v2(-1, 1)];
  return [
    v2(-1, -1), v2(1, -1), v2(1, -0.55), v2(0.3, -0.55),
    v2(0.3, 0.55), v2(1, 0.55), v2(1, 1), v2(-1, 1),
    v2(-1, 0.55), v2(-0.3, 0.55), v2(-0.3, -0.55), v2(-1, -0.55),
  ];
}

function profileCapUvs(profile: Vec2[], reverse: boolean): Vec2[] {
  const values = profile.map((point) => v2(0.5 + point.x * 0.25, 0.5 + point.y * 0.25));
  return reverse ? values.reverse() : values;
}

function rotateAroundAxis(value: Vec3, axis: Vec3, angle: number): Vec3 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return addVec3(
    addVec3(scaleVec3(value, c), scaleVec3(crossVec3(axis, value), s)),
    scaleVec3(axis, dotVec3(axis, value) * (1 - c)),
  );
}

function pathLength(points: Vec3[]): number {
  let total = 0;
  for (let index = 1; index < points.length; index++) {
    total += lengthVec3(subVec3(points[index]!, points[index - 1]!));
  }
  return total;
}

function clampScale(value: number): number {
  return Math.max(0.02, Math.min(4, Number.isFinite(value) ? value : 1));
}

function smoothTip(value: number): number {
  return value * value * (3 - 2 * value);
}
