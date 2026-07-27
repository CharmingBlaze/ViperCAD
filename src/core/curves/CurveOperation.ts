import {
  addVec3,
  lengthSqVec3,
  scaleVec3,
  subVec3,
  v3,
  type Vec3,
} from '@/core/math/Vec3';
import {
  buildInflatedDoodle,
  doodleCloseDistance,
  isStrokeClosed,
  strokePathLength,
} from '@/core/mesh/builders/StrokeInflateBuilder';
import {
  buildCurveCapsule,
  buildCurveRope,
  buildCurveSweep,
  type CurveSweepProfile,
} from '@/core/mesh/builders/CurveSweepBuilder';
import {
  buildLathe,
  type LatheAxis,
} from '@/core/mesh/builders/LatheBuilder';
import type { EditableMesh } from '@/core/mesh/types';
import type { ModelDocument, ObjectId } from '@/core/document/types';
import type { CurveTipStyle } from '@/core/curves/SimpleTexture';
import {
  buildPathOutput,
  type PathDistributionMode,
  type PathOutput,
  type PathProfile,
} from '@/core/mesh/builders/PathOutputBuilder';
import type { CurveSweepCapStyle } from '@/core/mesh/builders/CurveSweepBuilder';
import { finalizeCurveMeshUvs } from '@/core/mesh/builders/CurveMeshUv';
import { buildWorkflowProfileSolid, buildWorkflowLimbBlockout } from '@/core/mesh/builders/WorkflowProfileSolidBuilder';
import { isWorkflowOperation, isWorkflowStyle } from '@/core/curves/workflowCurve';

export { isWorkflowOperation, isWorkflowStyle } from '@/core/curves/workflowCurve';

export type CurveStyle =
  | 'soft'
  | 'sharp'
  | 'tube'
  | 'capsule'
  | 'profile-solid'
  | 'segmented-sweep'
  | 'ribbon'
  | 'hair'
  | 'hair-strip'
  | 'rounded-hair'
  | 'tapered-tube'
  | 'rope'
  | 'square-sweep'
  | 'rail-sweep';
export type CurveResolution = 'low' | 'medium';
export type CurveInputMode = 'sketch' | 'pen';
export type CurveType = 'polyline' | 'catmull-rom' | 'bezier';
export type CurveSolidMode = 'extrude' | 'lathe';
export type WorkflowKind = 'freehand' | 'sketch' | 'profile-solid' | 'segmented-sweep';

export type CurveOperation = {
  version: 1;
  style: CurveStyle;
  points: Vec3[];
  radius: number;
  resolution: CurveResolution;
  smooth: boolean;
  cyclic: boolean;
  inputMode: CurveInputMode;
  startScale: number;
  endScale: number;
  twist: number;
  profileWidth: number;
  profileHeight: number;
  curveType: CurveType;
  handlesIn: Vec3[];
  handlesOut: Vec3[];
  tipStyle: CurveTipStyle;
  solidMode: CurveSolidMode;
  latheAxis: LatheAxis;
  latheSegments: number;
  latheProfileRings: number;
  latheSmoothing: number;
  latheAngle: number;
  latheCaps: boolean;
  pathOutput: PathOutput;
  pathStartCap: CurveSweepCapStyle;
  pathEndCap: CurveSweepCapStyle;
  pathRadiusScale: number;
  pathRadialSegments: number;
  pathOffset: number;
  pathSpacing: number;
  pathProfile: PathProfile;
  pathChainAlternating: boolean;
  pathCardCrossed: boolean;
  pathDistributionMode: PathDistributionMode;
  pathCount: number;
  pathStartPadding: number;
  pathEndPadding: number;
  pathRandomScale: number;
  pathRotation: number;
  pathRandomRotation: number;
  pathAlternateRotation: boolean;
  pathMirrorAlternate: boolean;
  pathSeed: number;
  pathKeepInstances: boolean;
  pathSourceObjectId: string | null;
  /** Set when created from Workflows mode; keeps curve evaluation separate from Curves mode. */
  workflowKind?: WorkflowKind | null;
  /** Blob shoulder fullness 0–1 (blocky3D default 0.65). */
  blobInflation: number;
};

const RADIAL_SEGMENTS: Record<CurveResolution, number> = { low: 6, medium: 10 };
const OUTLINE_SEGMENTS: Record<CurveResolution, number> = { low: 16, medium: 28 };

export function curveOperationFromStroke(options: {
  style: CurveStyle;
  points: Vec3[];
  radius: number;
  resolution: CurveResolution;
  smooth: boolean;
  cyclic: boolean;
  inputMode?: CurveInputMode;
  startScale?: number;
  endScale?: number;
  twist?: number;
  profileWidth?: number;
  profileHeight?: number;
  curveType?: CurveType;
  handlesIn?: Vec3[];
  handlesOut?: Vec3[];
  tipStyle?: CurveTipStyle;
  solidMode?: CurveSolidMode;
  latheAxis?: LatheAxis;
  latheSegments?: number;
  latheProfileRings?: number;
  latheSmoothing?: number;
  latheAngle?: number;
  latheCaps?: boolean;
  pathOutput?: PathOutput;
  pathStartCap?: CurveSweepCapStyle;
  pathEndCap?: CurveSweepCapStyle;
  pathRadiusScale?: number;
  pathRadialSegments?: number;
  pathOffset?: number;
  pathSpacing?: number;
  pathProfile?: PathProfile;
  pathChainAlternating?: boolean;
  pathCardCrossed?: boolean;
  pathDistributionMode?: PathDistributionMode;
  pathCount?: number;
  pathStartPadding?: number;
  pathEndPadding?: number;
  pathRandomScale?: number;
  pathRotation?: number;
  pathRandomRotation?: number;
  pathAlternateRotation?: boolean;
  pathMirrorAlternate?: boolean;
  pathSeed?: number;
  pathKeepInstances?: boolean;
  pathSourceObjectId?: string | null;
  blobInflation?: number;
  workflowKind?: WorkflowKind | null;
}): CurveOperation {
  const radius = clampRadius(options.radius);
  let points = options.points.map((point) => ({ ...point }));
  if (
    options.cyclic &&
    points.length > 3 &&
    isStrokeClosed(points, doodleCloseDistance(radius, strokePathLength(points)))
  ) {
    points = points.slice(0, -1);
  }
  const handles = defaultBezierHandles(points, options.cyclic);
  return {
    version: 1,
    style: options.style,
    points,
    radius,
    resolution: options.resolution,
    smooth: options.smooth,
    cyclic:
      options.solidMode === 'lathe'
        ? false
        : options.cyclic,
    inputMode: options.inputMode ?? 'sketch',
    startScale: clampScale(options.startScale ?? 1),
    endScale: clampScale(options.endScale ?? 1),
    twist: clampTwist(options.twist ?? (options.style === 'rope' ? 360 : 0)),
    profileWidth: clampProfileScale(options.profileWidth ?? 1),
    profileHeight: clampProfileScale(options.profileHeight ?? 1),
    curveType: options.curveType ?? (options.smooth ? 'catmull-rom' : 'polyline'),
    handlesIn: copyHandles(options.handlesIn, handles.handlesIn),
    handlesOut: copyHandles(options.handlesOut, handles.handlesOut),
    tipStyle:
      options.tipStyle ??
      (options.style === 'hair' ||
      options.style === 'hair-strip' ||
      options.style === 'rounded-hair' ||
      options.style === 'tapered-tube'
        ? 'pointed'
        : 'square'),
    solidMode: options.solidMode === 'lathe' ? 'lathe' : 'extrude',
    latheAxis: isLatheAxis(options.latheAxis) ? options.latheAxis : 'y',
    latheSegments: clampInteger(options.latheSegments, 8, 64, 16),
    latheProfileRings: clampInteger(options.latheProfileRings, 4, 128, 32),
    latheSmoothing: clampUnit(options.latheSmoothing, 0.15),
    latheAngle: clampAngle(options.latheAngle, 360),
    latheCaps: options.latheCaps !== false,
    pathOutput: isPathOutput(options.pathOutput) ? options.pathOutput : 'tube',
    pathStartCap: isCapStyle(options.pathStartCap) ? options.pathStartCap : 'flat',
    pathEndCap: isCapStyle(options.pathEndCap) ? options.pathEndCap : 'flat',
    pathRadiusScale: clampRange(options.pathRadiusScale, 0.1, 4, 1),
    pathRadialSegments: clampInteger(options.pathRadialSegments, 3, 24, 8),
    pathOffset: clampRange(options.pathOffset, -64, 64, 0),
    pathSpacing: clampRange(options.pathSpacing, 0.05, 128, 1),
    pathProfile: isPathProfile(options.pathProfile) ? options.pathProfile : 'round',
    pathChainAlternating: options.pathChainAlternating !== false,
    pathCardCrossed: options.pathCardCrossed === true,
    pathDistributionMode:
      isDistributionMode(options.pathDistributionMode) ? options.pathDistributionMode : 'spacing',
    pathCount: clampInteger(options.pathCount, 1, 200, 8),
    pathStartPadding: clampRange(options.pathStartPadding, 0, 128, 0),
    pathEndPadding: clampRange(options.pathEndPadding, 0, 128, 0),
    pathRandomScale: clampRange(options.pathRandomScale, 0, 1, 0),
    pathRotation: clampRange(options.pathRotation, -180, 180, 0),
    pathRandomRotation: clampRange(options.pathRandomRotation, 0, 180, 0),
    pathAlternateRotation: options.pathAlternateRotation === true,
    pathMirrorAlternate: options.pathMirrorAlternate === true,
    pathSeed: clampInteger(options.pathSeed, 1, 9999, 1),
    pathKeepInstances: options.pathKeepInstances !== false,
    pathSourceObjectId:
      typeof options.pathSourceObjectId === 'string' ? options.pathSourceObjectId : null,
    blobInflation: clampRange(options.blobInflation, 0, 1, 0.65),
    workflowKind:
      isWorkflowStyle(options.style) && options.workflowKind != null
        ? options.workflowKind
        : null,
  };
}

export function evaluateCurveOperation(
  operation: CurveOperation,
  pathSourceMesh: EditableMesh | null = null,
): EditableMesh {
  const radius = clampRadius(operation.radius);
  const cyclic =
    operation.solidMode === 'lathe'
      ? false
      : operation.cyclic;
  let points = evaluateCurvePath(operation);
  if (points.length < 2) {
    const point = points[0] ?? v3();
    points = [point, addVec3(point, v3(radius * 2, 0, 0))];
  }
  const exactPenOutline = operation.inputMode === 'pen' && operation.style === 'sharp';
  if (operation.smooth && operation.curveType === 'polyline' && !exactPenOutline) {
    points = smoothCurvePoints(
      points,
      cyclic,
      operation.resolution === 'medium' ? 2 : 1,
    );
  }
  let mesh: EditableMesh;
  if (operation.solidMode === 'lathe') {
    mesh = buildLathe({
      points,
      axis: operation.latheAxis,
      radialSegments: operation.latheSegments,
      profileRings: operation.latheProfileRings,
      smoothing: operation.latheSmoothing,
      angleDegrees: operation.latheAngle,
      capStart: operation.latheCaps,
      capEnd: operation.latheCaps,
      name: curveOperationLabel(operation),
    });
  } else if (operation.style === 'tube') {
    mesh = buildPathOutput({
      points,
      output: operation.pathOutput,
      radius: radius * operation.pathRadiusScale,
      radialSegments: operation.pathRadialSegments,
      startCap: operation.pathStartCap,
      endCap: operation.pathEndCap,
      startScale: operation.startScale,
      endScale: operation.endScale,
      offset: operation.pathOffset,
      twist: operation.twist,
      spacing: operation.pathSpacing,
      profile: operation.pathProfile,
      profileWidth: operation.profileWidth,
      profileHeight: operation.profileHeight,
      chainAlternating: operation.pathChainAlternating,
      cardCrossed: operation.pathCardCrossed,
      distributionMode: operation.pathDistributionMode,
      count: operation.pathCount,
      startPadding: operation.pathStartPadding,
      endPadding: operation.pathEndPadding,
      randomScale: operation.pathRandomScale,
      rotation: operation.pathRotation,
      randomRotation: operation.pathRandomRotation,
      alternateRotation: operation.pathAlternateRotation,
      mirrorAlternate: operation.pathMirrorAlternate,
      seed: operation.pathSeed,
      cyclic,
      sourceMesh: pathSourceMesh,
      name: curveOperationLabel(operation),
    });
  } else if (operation.style === 'capsule') {
    mesh = operation.cyclic
      ? buildInflatedDoodle({
          points,
          thickness: radius,
          outlineSegments: OUTLINE_SEGMENTS[operation.resolution],
          profile: 'capsule',
          radialSegments: Math.max(12, operation.pathRadialSegments),
          name: 'Capsule Outline',
        })
      : buildCurveCapsule({
          points,
          radius,
          radialSegments: Math.max(12, operation.pathRadialSegments),
          profile: 'round',
          cyclic,
          capStart: true,
          capEnd: true,
          pathSpacingScale: operation.resolution === 'medium' ? 0.7 : 1,
          name: curveOperationLabel(operation),
        });
  } else if (operation.style === 'profile-solid' && isWorkflowOperation(operation)) {
    const maxOutlineCorners = Math.max(8, Math.min(48, operation.pathRadialSegments * 2));
    mesh = buildWorkflowProfileSolid({
      points,
      radius,
      maxOutlineCorners,
      cyclic,
      outlineSegments: OUTLINE_SEGMENTS[operation.resolution],
      exactOutline: operation.inputMode === 'pen' && operation.curveType === 'polyline',
      widthScale: operation.profileWidth,
      heightScale: operation.profileHeight,
      uniformScale: operation.startScale,
      roundness: Math.max(0, Math.min(0.45, operation.blobInflation * 0.45)),
      depthSegments: Math.max(1, Math.min(6, Math.round(operation.pathCount / 2))),
      name: operation.cyclic ? 'Outline' : 'Outline Path',
    });
  } else if (operation.style === 'segmented-sweep' && isWorkflowOperation(operation)) {
    mesh = buildWorkflowLimbBlockout({
      points,
      radius,
      segmentCount: Math.max(2, Math.min(16, operation.pathCount)),
      sides: Math.max(4, Math.min(8, Math.round(operation.pathRadialSegments / 2))),
      exactEdges: operation.inputMode === 'pen' && operation.curveType === 'polyline',
      profileWidth: operation.profileWidth,
      profileHeight: operation.profileHeight,
      startScale: operation.startScale,
      endScale: operation.endScale,
      name: 'Limb',
    });
  } else if (isSweepStyle(operation.style)) {
    const common = {
      points,
      radius,
      radialSegments: RADIAL_SEGMENTS[operation.resolution],
      profile: sweepProfile(operation.style),
      profileWidth: operation.profileWidth,
      profileHeight: operation.profileHeight,
      startScale: operation.startScale,
      endScale: operation.endScale,
      twistDegrees: operation.twist,
      cyclic,
      capStart: true,
      capEnd: true,
      taperStart: operation.tipStyle === 'pointed' && isTaperableStyle(operation.style),
      taperEnd: operation.tipStyle === 'pointed' && isTaperableStyle(operation.style),
      pathSpacingScale:
        operation.style === 'hair-strip'
          ? 2.2
          : operation.style === 'hair'
            ? 0.65
            : 1,
      name: curveOperationLabel(operation),
    } as const;
    mesh = operation.style === 'rope' ? buildCurveRope(common) : buildCurveSweep(common);
  } else {
    const isBlob = operation.style === 'soft';
    mesh = buildInflatedDoodle({
      points,
      thickness: isBlob ? radius * 2 : radius,
      outlineSegments: OUTLINE_SEGMENTS[operation.resolution],
      profile: isBlob ? 'soft' : 'sharp',
      inflation: isBlob ? operation.blobInflation : 0,
      radialSegments: Math.max(12, operation.pathRadialSegments),
      closed: cyclic,
      exactOutline: exactPenOutline,
      name:
        isBlob
          ? 'Soft Curve Profile'
          : operation.style === 'sharp'
            ? 'Sharp Curve Profile'
            : curveOperationLabel(operation),
    });
  }

  finalizeCurveMeshUvs(mesh, operation.style, cyclic);
  return mesh;
}

function meshBoundsCentre(mesh: EditableMesh): Vec3 {
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (const vertex of mesh.vertices.values()) {
    const { x, y, z } = vertex.position;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    minZ = Math.min(minZ, z);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
    maxZ = Math.max(maxZ, z);
  }
  if (!Number.isFinite(minX)) return v3();
  return v3((minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2);
}

function offsetCurveOperationPoints(operation: CurveOperation, offset: Vec3): CurveOperation {
  const localize = (point: Vec3) => subVec3(point, offset);
  return {
    ...operation,
    points: operation.points.map(localize),
    handlesIn: operation.handlesIn.map(localize),
    handlesOut: operation.handlesOut.map(localize),
  };
}

/**
 * Convert freshly evaluated world-space curve geometry into object-local space.
 * The returned position is the world-space object origin used for transform gizmos.
 */
export function localizeCurveMesh(
  mesh: EditableMesh,
  operation: CurveOperation,
): { position: Vec3; operation: CurveOperation } {
  const position = meshBoundsCentre(mesh);
  for (const vertex of mesh.vertices.values()) {
    vertex.position = subVec3(vertex.position, position);
  }
  mesh.geometryVersion += 1;
  mesh.dirty.positions = mesh.dirty.normals = mesh.dirty.bounds = mesh.dirty.bvh = true;
  return {
    position,
    operation: offsetCurveOperationPoints(operation, position),
  };
}

/** Fix legacy curve objects that baked world-space geometry at the identity transform. */
export function ensureCurveObjectLocalized(
  document: ModelDocument,
  objectId: ObjectId,
): boolean {
  const object = document.objects.get(objectId);
  const operation = readCurveOperation(object?.metadata.curveOperation);
  const mesh = object?.meshId ? document.meshes.get(object.meshId) : null;
  if (!object || !operation || !mesh || mesh.vertices.size === 0) return false;

  const meshCentre = meshBoundsCentre(mesh);
  const meshOffset = Math.hypot(meshCentre.x, meshCentre.y, meshCentre.z);
  const transformOffset = Math.hypot(
    object.transform.position.x,
    object.transform.position.y,
    object.transform.position.z,
  );
  if (meshOffset < 0.25 || transformOffset > 1e-3) return false;

  const localized = localizeCurveMesh(mesh, operation);
  object.transform.position = localized.position;
  object.metadata.curveOperation = serializeCurveOperation(localized.operation);
  document.dirty = true;
  return true;
}

export function ensureCurveObjectsLocalized(document: ModelDocument): number {
  let fixed = 0;
  for (const object of document.objects.values()) {
    if (ensureCurveObjectLocalized(document, object.id)) fixed += 1;
  }
  return fixed;
}

export function serializeCurveOperation(operation: CurveOperation): string {
  return JSON.stringify(operation);
}

export function readCurveOperation(raw: string | undefined): CurveOperation | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<CurveOperation>;
    if (
      parsed.version !== 1 ||
      !isCurveStyle(parsed.style) ||
      (parsed.resolution !== 'low' && parsed.resolution !== 'medium') ||
      !Array.isArray(parsed.points) ||
      parsed.points.length < 2 ||
      !parsed.points.every(isFinitePoint)
    ) {
      return null;
    }
    return {
      version: 1,
      style: parsed.style,
      points: parsed.points.map((point) => ({ ...point })),
      radius: clampRadius(parsed.radius ?? 0.08),
      resolution: parsed.resolution,
      smooth: parsed.smooth !== false,
      cyclic:
        parsed.solidMode === 'lathe'
          ? false
          : parsed.cyclic === true,
      inputMode: parsed.inputMode === 'pen' ? 'pen' : 'sketch',
      startScale: clampScale(parsed.startScale ?? 1),
      endScale: clampScale(parsed.endScale ?? 1),
      twist: clampTwist(parsed.twist ?? (parsed.style === 'rope' ? 360 : 0)),
      profileWidth: clampProfileScale(parsed.profileWidth ?? 1),
      profileHeight: clampProfileScale(parsed.profileHeight ?? 1),
      curveType: isCurveType(parsed.curveType)
        ? parsed.curveType
        : parsed.smooth === false
          ? 'polyline'
          : 'catmull-rom',
      tipStyle: parsed.tipStyle === 'pointed' ? 'pointed' : 'square',
      solidMode: parsed.solidMode === 'lathe' ? 'lathe' : 'extrude',
      latheAxis: isLatheAxis(parsed.latheAxis) ? parsed.latheAxis : 'y',
      latheSegments: clampInteger(parsed.latheSegments, 8, 64, 16),
      latheProfileRings: clampInteger(parsed.latheProfileRings, 4, 128, 32),
      latheSmoothing: clampUnit(parsed.latheSmoothing, 0.15),
      latheAngle: clampAngle(parsed.latheAngle, 360),
      latheCaps: parsed.latheCaps !== false,
      pathOutput: isPathOutput(parsed.pathOutput) ? parsed.pathOutput : 'tube',
      pathStartCap: isCapStyle(parsed.pathStartCap) ? parsed.pathStartCap : 'flat',
      pathEndCap: isCapStyle(parsed.pathEndCap) ? parsed.pathEndCap : 'flat',
      pathRadiusScale: clampRange(parsed.pathRadiusScale, 0.1, 4, 1),
      pathRadialSegments: clampInteger(parsed.pathRadialSegments, 3, 24, 8),
      pathOffset: clampRange(parsed.pathOffset, -64, 64, 0),
      pathSpacing: clampRange(parsed.pathSpacing, 0.05, 128, 1),
      pathProfile: isPathProfile(parsed.pathProfile) ? parsed.pathProfile : 'round',
      pathChainAlternating: parsed.pathChainAlternating !== false,
      pathCardCrossed: parsed.pathCardCrossed === true,
      pathDistributionMode:
        isDistributionMode(parsed.pathDistributionMode) ? parsed.pathDistributionMode : 'spacing',
      pathCount: clampInteger(parsed.pathCount, 1, 200, 8),
      pathStartPadding: clampRange(parsed.pathStartPadding, 0, 128, 0),
      pathEndPadding: clampRange(parsed.pathEndPadding, 0, 128, 0),
      pathRandomScale: clampRange(parsed.pathRandomScale, 0, 1, 0),
      pathRotation: clampRange(parsed.pathRotation, -180, 180, 0),
      pathRandomRotation: clampRange(parsed.pathRandomRotation, 0, 180, 0),
      pathAlternateRotation: parsed.pathAlternateRotation === true,
      pathMirrorAlternate: parsed.pathMirrorAlternate === true,
      pathSeed: clampInteger(parsed.pathSeed, 1, 9999, 1),
      pathKeepInstances: parsed.pathKeepInstances !== false,
      pathSourceObjectId:
        typeof parsed.pathSourceObjectId === 'string' ? parsed.pathSourceObjectId : null,
      blobInflation: clampRange(parsed.blobInflation, 0, 1, 0.65),
      workflowKind: isWorkflowKind(parsed.workflowKind) && isWorkflowStyle(parsed.style)
        ? parsed.workflowKind
        : null,
      ...readHandles(parsed.points, parsed.handlesIn, parsed.handlesOut, parsed.cyclic === true),
    };
  } catch {
    return null;
  }
}

export function curveOperationLabel(operation: CurveOperation): string {
  if (operation.solidMode === 'lathe') return `${operation.latheAngle < 360 ? 'Partial ' : ''}Lathe`;
  if (operation.style === 'tube') {
    const label: Record<PathOutput, string> = {
      tube: 'Path Tube',
      ribbon: 'Path Ribbon',
      chain: 'Path Chain',
      vine: 'Path Vine',
      rope: 'Path Rope',
      cards: 'Path Cards',
      'object-array': 'Path Object Array',
      'profile-sweep': 'Path Profile Sweep',
    };
    return label[operation.pathOutput];
  }
  if (operation.style === 'capsule') return 'Capsule Path';
  if (operation.style === 'profile-solid') return 'Outline';
  if (operation.style === 'segmented-sweep') return 'Limb';
  if (operation.style === 'ribbon') return 'Ribbon Sweep';
  if (operation.style === 'hair') return 'Hair Path';
  if (operation.style === 'hair-strip') return 'Low-poly Hair Strip';
  if (operation.style === 'rounded-hair') return 'Rounded Hair';
  if (operation.style === 'tapered-tube') return 'Tapered Tube';
  if (operation.style === 'rope') return 'Braided Rope';
  if (operation.style === 'square-sweep') return 'Square Profile Sweep';
  if (operation.style === 'rail-sweep') return 'Rail Profile Sweep';
  return operation.style === 'soft' ? 'Soft Profile' : 'Sharp Profile';
}

export function isPathStyle(style: CurveStyle): boolean {
  return style !== 'soft' && style !== 'sharp';
}

export function evaluateCurvePath(operation: CurveOperation): Vec3[] {
  const anchors = operation.points.map((point) => ({ ...point }));
  if (anchors.length < 2 || operation.curveType === 'polyline') return anchors;
  const cyclic =
    operation.solidMode === 'lathe'
      ? false
      : operation.cyclic;
  const steps = operation.resolution === 'medium' ? 8 : 4;
  if (operation.curveType === 'bezier') {
    const defaults = defaultBezierHandles(anchors, cyclic);
    const handlesIn = copyHandles(operation.handlesIn, defaults.handlesIn);
    const handlesOut = copyHandles(operation.handlesOut, defaults.handlesOut);
    const result: Vec3[] = [];
    const segmentCount = cyclic ? anchors.length : anchors.length - 1;
    for (let segment = 0; segment < segmentCount; segment++) {
      const next = (segment + 1) % anchors.length;
      for (let step = 0; step < steps; step++) {
        if (segment > 0 && step === 0) continue;
        result.push(cubicBezier(
          anchors[segment]!,
          handlesOut[segment]!,
          handlesIn[next]!,
          anchors[next]!,
          step / steps,
        ));
      }
      result.push({ ...anchors[next]! });
    }
    return result;
  }
  const result: Vec3[] = [];
  const segmentCount = cyclic ? anchors.length : anchors.length - 1;
  for (let segment = 0; segment < segmentCount; segment++) {
    const p0 = anchors[
      segment === 0 ? (cyclic ? anchors.length - 1 : 0) : segment - 1
    ]!;
    const p1 = anchors[segment]!;
    const p2 = anchors[(segment + 1) % anchors.length]!;
    const p3 = anchors[
      segment + 2 >= anchors.length
        ? cyclic
          ? (segment + 2) % anchors.length
          : anchors.length - 1
        : segment + 2
    ]!;
    for (let step = 0; step < steps; step++) {
      if (segment > 0 && step === 0) continue;
      result.push(catmullRom(p0, p1, p2, p3, step / steps));
    }
    result.push({ ...p2 });
  }
  return result;
}

export function defaultBezierHandles(
  points: Vec3[],
  cyclic: boolean,
): { handlesIn: Vec3[]; handlesOut: Vec3[] } {
  const handlesIn: Vec3[] = [];
  const handlesOut: Vec3[] = [];
  for (let index = 0; index < points.length; index++) {
    const point = points[index]!;
    const previous = points[index === 0 ? (cyclic ? points.length - 1 : 0) : index - 1]!;
    const next = points[index === points.length - 1 ? (cyclic ? 0 : points.length - 1) : index + 1]!;
    const tangent = scaleVec3(subVec3(next, previous), 1 / 6);
    handlesIn.push(subVec3(point, tangent));
    handlesOut.push(addVec3(point, tangent));
  }
  return { handlesIn, handlesOut };
}

export function smoothCurvePoints(points: Vec3[], cyclic: boolean, passes = 1): Vec3[] {
  if (points.length < 3 || passes < 1) return points.map((point) => ({ ...point }));
  const original = points.map((point) => ({ ...point }));
  let result = original;
  for (let pass = 0; pass < passes; pass++) {
    result = result.map((point, index) => {
      if (!cyclic && (index === 0 || index === result.length - 1)) return { ...point };
      const previous = result[(index - 1 + result.length) % result.length]!;
      const next = result[(index + 1) % result.length]!;
      return {
        x: point.x * 0.5 + (previous.x + next.x) * 0.25,
        y: point.y * 0.5 + (previous.y + next.y) * 0.25,
        z: point.z * 0.5 + (previous.z + next.z) * 0.25,
      };
    });
  }
  if (cyclic) {
    const centre = (values: Vec3[]) =>
      scaleVec3(values.reduce((sum, point) => addVec3(sum, point), v3()), 1 / values.length);
    const beforeCentre = centre(original);
    const afterCentre = centre(result);
    const averageRadius = (values: Vec3[], centrePoint: Vec3) =>
      values.reduce(
        (sum, point) => sum + Math.sqrt(lengthSqVec3(subVec3(point, centrePoint))),
        0,
      ) / values.length;
    const beforeRadius = averageRadius(original, beforeCentre);
    const afterRadius = averageRadius(result, afterCentre);
    const factor = afterRadius > 1e-8 ? beforeRadius / afterRadius : 1;
    result = result.map((point) =>
      addVec3(beforeCentre, scaleVec3(subVec3(point, afterCentre), factor)),
    );
  }
  return result;
}

function clampRadius(radius: number): number {
  return Math.max(0.01, Math.min(2, Number.isFinite(radius) ? radius : 0.08));
}

function isCurveStyle(value: unknown): value is CurveStyle {
  return (
    value === 'soft' ||
    value === 'sharp' ||
    value === 'tube' ||
    value === 'capsule' ||
    value === 'profile-solid' ||
    value === 'segmented-sweep' ||
    value === 'ribbon' ||
    value === 'hair' ||
    value === 'hair-strip' ||
    value === 'rounded-hair' ||
    value === 'tapered-tube' ||
    value === 'rope' ||
    value === 'square-sweep' ||
    value === 'rail-sweep'
  );
}

function isSweepStyle(style: CurveStyle): boolean {
  return (
    style === 'ribbon' ||
    style === 'hair' ||
    style === 'hair-strip' ||
    style === 'rounded-hair' ||
    style === 'tapered-tube' ||
    style === 'rope' ||
    style === 'square-sweep' ||
    style === 'rail-sweep'
  );
}

function sweepProfile(style: CurveStyle): CurveSweepProfile {
  if (style === 'ribbon' || style === 'hair' || style === 'hair-strip') return 'ribbon';
  if (style === 'square-sweep') return 'square';
  if (style === 'rail-sweep') return 'rail';
  return 'round';
}

function isTaperableStyle(style: CurveStyle): boolean {
  return (
    style === 'ribbon' ||
    style === 'hair' ||
    style === 'hair-strip' ||
    style === 'rounded-hair' ||
    style === 'tapered-tube'
  );
}

function clampScale(value: number): number {
  return Math.max(0.02, Math.min(4, Number.isFinite(value) ? value : 1));
}

function clampProfileScale(value: number): number {
  return Math.max(0.05, Math.min(4, Number.isFinite(value) ? value : 1));
}

function clampTwist(value: number): number {
  return Math.max(-2160, Math.min(2160, Number.isFinite(value) ? value : 0));
}

function clampInteger(
  value: number | undefined,
  min: number,
  max: number,
  fallback: number,
): number {
  return Math.max(min, Math.min(max, Math.round(Number.isFinite(value) ? value! : fallback)));
}

function clampUnit(value: number | undefined, fallback: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value! : fallback));
}

function clampRange(
  value: number | undefined,
  min: number,
  max: number,
  fallback: number,
): number {
  return Math.max(min, Math.min(max, Number.isFinite(value) ? value! : fallback));
}

function clampAngle(value: number | undefined, fallback: number): number {
  return Math.max(1, Math.min(360, Number.isFinite(value) ? value! : fallback));
}

function isLatheAxis(value: unknown): value is LatheAxis {
  return value === 'x' || value === 'y' || value === 'z';
}

function isPathOutput(value: unknown): value is PathOutput {
  return (
    value === 'tube' ||
    value === 'ribbon' ||
    value === 'chain' ||
    value === 'vine' ||
    value === 'rope' ||
    value === 'cards' ||
    value === 'object-array' ||
    value === 'profile-sweep'
  );
}

function isCapStyle(value: unknown): value is CurveSweepCapStyle {
  return value === 'flat' || value === 'round' || value === 'pointed' || value === 'open';
}

/** Workflow-only: complete open tube ends for freehand profile strokes. */
function effectiveWorkflowCaps(
  operation: CurveOperation,
  cyclic: boolean,
): { start: CurveSweepCapStyle; end: CurveSweepCapStyle } {
  let start = operation.pathStartCap;
  let end = operation.pathEndCap;
  const freehandTube =
    !cyclic &&
    operation.smooth &&
    operation.inputMode === 'sketch' &&
    (operation.style === 'profile-solid');
  if (freehandTube) {
    if (start === 'open') start = 'round';
    if (end === 'open') end = 'round';
  }
  return { start, end };
}

function workflowPathSpacingScale(operation: CurveOperation): number {
  if (operation.smooth && operation.inputMode === 'sketch') {
    return operation.resolution === 'medium' ? 0.42 : 0.5;
  }
  return operation.resolution === 'medium' ? 0.65 : 0.85;
}

function isWorkflowKind(value: unknown): value is WorkflowKind {
  return (
    value === 'freehand' ||
    value === 'sketch' ||
    value === 'profile-solid' ||
    value === 'segmented-sweep'
  );
}

function isPathProfile(value: unknown): value is PathProfile {
  return value === 'round' || value === 'square' || value === 'rectangle' || value === 'rail';
}

function isDistributionMode(value: unknown): value is PathDistributionMode {
  return value === 'spacing' || value === 'count' || value === 'fit';
}

function isCurveType(value: unknown): value is CurveType {
  return value === 'polyline' || value === 'catmull-rom' || value === 'bezier';
}

function readHandles(
  points: Vec3[],
  handlesIn: Vec3[] | undefined,
  handlesOut: Vec3[] | undefined,
  cyclic: boolean,
): Pick<CurveOperation, 'handlesIn' | 'handlesOut'> {
  const defaults = defaultBezierHandles(points, cyclic);
  return {
    handlesIn: copyHandles(handlesIn, defaults.handlesIn),
    handlesOut: copyHandles(handlesOut, defaults.handlesOut),
  };
}

function copyHandles(values: Vec3[] | undefined, fallback: Vec3[]): Vec3[] {
  if (
    !Array.isArray(values) ||
    values.length !== fallback.length ||
    !values.every(isFinitePoint)
  ) {
    return fallback.map((point) => ({ ...point }));
  }
  return values.map((point) => ({ ...point }));
}

function cubicBezier(p0: Vec3, p1: Vec3, p2: Vec3, p3: Vec3, t: number): Vec3 {
  const oneMinus = 1 - t;
  return addVec3(
    addVec3(
      scaleVec3(p0, oneMinus * oneMinus * oneMinus),
      scaleVec3(p1, 3 * oneMinus * oneMinus * t),
    ),
    addVec3(
      scaleVec3(p2, 3 * oneMinus * t * t),
      scaleVec3(p3, t * t * t),
    ),
  );
}

function catmullRom(p0: Vec3, p1: Vec3, p2: Vec3, p3: Vec3, t: number): Vec3 {
  const t2 = t * t;
  const t3 = t2 * t;
  return v3(
    0.5 * ((2 * p1.x) + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
    0.5 * ((2 * p1.y) + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
    0.5 * ((2 * p1.z) + (-p0.z + p2.z) * t + (2 * p0.z - 5 * p1.z + 4 * p2.z - p3.z) * t2 + (-p0.z + 3 * p1.z - 3 * p2.z + p3.z) * t3),
  );
}

function isFinitePoint(value: unknown): value is Vec3 {
  if (!value || typeof value !== 'object') return false;
  const point = value as Partial<Vec3>;
  return (
    Number.isFinite(point.x) &&
    Number.isFinite(point.y) &&
    Number.isFinite(point.z)
  );
}
