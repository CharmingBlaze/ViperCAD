import { addVec3, crossVec3, dotVec3, normalizeVec3, scaleVec3, subVec3, type Vec3, v3 } from '@/core/math/Vec3';
import { MeshBuilder } from '@/core/mesh/MeshBuilder';
import { buildBox, buildCone, buildCylinder, buildPlane, buildPyramid, buildRamp, buildSphere } from '@/core/mesh/builders';
import { faceCornerIds, faceHalfEdgeIds } from '@/core/mesh/EditableMesh';
import { flipFaces } from '@/core/mesh/ops/basic';
import type { EditableMesh, FaceId, UvLayerId } from '@/core/mesh/types';
import { unwrapUvAuto } from '@/core/uv/UvOperations';
import { v2 } from '@/core/math/Vec2';
import { validateMeshFull } from '@/core/mesh/Validation';

export type PrimitiveKind = 'box' | 'plane' | 'cylinder' | 'cone' | 'pyramid' | 'sphere' | 'icosphere' | 'capsule' | 'ramp' | 'stairs' | 'arch' | 'column' | 'torus' | 'tube';
export type ComplexityPreset = 'low' | 'medium' | 'custom';

export type PrimitiveConstructionCage = {
  origin: Vec3;
  axisU: Vec3;
  axisV: Vec3;
  axisNormal: Vec3;
  sizeU: number;
  sizeV: number;
  sizeNormal: number;
  minLocal: Vec3;
  maxLocal: Vec3;
  constructionPlaneId: string;
  creationDirection: 1 | -1;
};

export type PrimitiveParameters = {
  preset: ComplexityPreset;
  radialSegments: number;
  heightSegments: number;
  subdivisions: number;
  stairCount: number;
  archSegments: number;
  torusMajorSegments: number;
  torusTubeSegments: number;
  wallThickness: number;
  smooth: boolean;
  capped: boolean;
};

export const PRIMITIVE_LIMITS = {
  radialSegments: { min: 3, max: 32 }, heightSegments: { min: 1, max: 16 }, subdivisions: { min: 0, max: 2 }, stairCount: { min: 1, max: 64 }, archSegments: { min: 3, max: 32 }, torusMajorSegments: { min: 6, max: 32 }, torusTubeSegments: { min: 3, max: 16 },
} as const;

export const PRIMITIVE_LABELS: Record<PrimitiveKind, string> = { box: 'Box', plane: 'Plane', cylinder: 'Cylinder', cone: 'Cone', pyramid: 'Pyramid', sphere: 'Sphere', icosphere: 'Icosphere', capsule: 'Capsule', ramp: 'Ramp', stairs: 'Stairs', arch: 'Arch', column: 'Column', torus: 'Torus', tube: 'Tube' };
export const PRIMITIVE_KINDS = Object.keys(PRIMITIVE_LABELS) as PrimitiveKind[];

export function defaultPrimitiveParameters(kind: PrimitiveKind, preset: ComplexityPreset = 'low'): PrimitiveParameters {
  const medium = preset === 'medium';
  return { preset, radialSegments: medium ? 16 : kind === 'cone' ? 8 : 12, heightSegments: medium ? 8 : 6, subdivisions: medium ? 2 : 1, stairCount: 5, archSegments: medium ? 12 : 8, torusMajorSegments: medium ? 20 : 12, torusTubeSegments: medium ? 10 : 8, wallThickness: 0.2, smooth: !['box', 'plane', 'pyramid', 'icosphere', 'ramp', 'stairs', 'arch'].includes(kind), capped: true };
}

export function clampPrimitiveParameters(p: PrimitiveParameters): PrimitiveParameters {
  const clamp = (n: number, range: { min: number; max: number }) => Math.max(range.min, Math.min(range.max, Math.floor(n)));
  return { ...p, radialSegments: clamp(p.radialSegments, PRIMITIVE_LIMITS.radialSegments), heightSegments: clamp(p.heightSegments, PRIMITIVE_LIMITS.heightSegments), subdivisions: clamp(p.subdivisions, PRIMITIVE_LIMITS.subdivisions), stairCount: clamp(p.stairCount, PRIMITIVE_LIMITS.stairCount), archSegments: clamp(p.archSegments, PRIMITIVE_LIMITS.archSegments), torusMajorSegments: clamp(p.torusMajorSegments, PRIMITIVE_LIMITS.torusMajorSegments), torusTubeSegments: clamp(p.torusTubeSegments, PRIMITIVE_LIMITS.torusTubeSegments), wallThickness: Math.max(0.02, Math.min(0.45, p.wallThickness)) };
}

export function primitiveCageCentre(cage: PrimitiveConstructionCage): Vec3 {
  return addVec3(
    cage.origin,
    addVec3(
      scaleVec3(cage.axisU, cage.sizeU / 2),
      addVec3(
        scaleVec3(cage.axisV, cage.sizeV / 2),
        scaleVec3(cage.axisNormal, cage.sizeNormal / 2),
      ),
    ),
  );
}

/**
 * Convert a just-built world-space primitive into object-local geometry.
 * The returned position is the world-space object origin and the returned cage
 * is suitable for rebuilding the primitive around that local origin.
 */
export function localizePrimitiveMesh(
  mesh: EditableMesh,
  cage: PrimitiveConstructionCage,
): { position: Vec3; cage: PrimitiveConstructionCage } {
  const position = primitiveCageCentre(cage);
  for (const vertex of mesh.vertices.values()) {
    vertex.position = subVec3(vertex.position, position);
  }
  mesh.geometryVersion += 1;
  mesh.dirty.positions = mesh.dirty.normals = mesh.dirty.bounds = mesh.dirty.bvh = true;
  return {
    position,
    cage: {
      ...cage,
      origin: subVec3(cage.origin, position),
      axisU: { ...cage.axisU },
      axisV: { ...cage.axisV },
      axisNormal: { ...cage.axisNormal },
      minLocal: { ...cage.minLocal },
      maxLocal: { ...cage.maxLocal },
    },
  };
}

export function buildPrimitiveInCage(kind: PrimitiveKind, cage: PrimitiveConstructionCage, input: PrimitiveParameters): EditableMesh {
  const p = clampPrimitiveParameters(input);
  let mesh = buildNormalised(kind, p);
  const centre = primitiveCageCentre(cage);
  const reflectNormal = kind === 'cone' && cage.creationDirection < 0;
  // Local (x,y,z) maps to (axisU, axisNormal, axisV). Flip when that basis is left-handed
  // (e.g. Front / WORLD_XY) so closed meshes keep outward winding in every view.
  const basisSign = Math.sign(dotVec3(cage.axisU, crossVec3(cage.axisNormal, cage.axisV))) || 1;
  const flipWinding = reflectNormal !== (basisSign < 0);
  for (const vertex of mesh.vertices.values()) {
    const local = vertex.position;
    vertex.position = addVec3(centre, addVec3(scaleVec3(cage.axisU, local.x * cage.sizeU), addVec3(scaleVec3(cage.axisNormal, local.y * cage.sizeNormal * (reflectNormal ? -1 : 1)), scaleVec3(cage.axisV, local.z * cage.sizeV))));
  }
  if (flipWinding) flipFaces(mesh, [...mesh.faces.keys()]);
  mesh.name = PRIMITIVE_LABELS[kind];
  mesh.geometryVersion += 1; mesh.dirty.positions = mesh.dirty.normals = mesh.dirty.bounds = mesh.dirty.bvh = true;
  return mesh;
}

function buildNormalised(kind: PrimitiveKind, p: PrimitiveParameters): EditableMesh {
  let mesh: EditableMesh;
  if (kind === 'box') mesh = buildBox({ width: 1, height: 1, depth: 1, centered: true });
  else if (kind === 'plane') mesh = buildPlane({ width: 1, depth: 1 });
  else if (kind === 'cylinder' || kind === 'column') mesh = buildCylinder({ radius: 0.5, height: 1, radialSegments: p.radialSegments, capped: p.capped, name: PRIMITIVE_LABELS[kind] });
  else if (kind === 'cone') mesh = buildCone({ radius: 0.5, height: 1, radialSegments: p.radialSegments, capped: p.capped });
  else if (kind === 'pyramid') mesh = buildPyramid({ width: 1, height: 1, depth: 1 });
  else if (kind === 'sphere') mesh = buildSphere({ radius: 0.5, widthSegments: p.radialSegments, heightSegments: p.heightSegments });
  else if (kind === 'ramp') mesh = buildRamp({ width: 1, height: 1, depth: 1 });
  else if (kind === 'icosphere') mesh = buildIcosphere(p.subdivisions);
  else if (kind === 'capsule') mesh = buildCapsule(p.radialSegments, Math.max(2, Math.ceil(p.heightSegments / 2)));
  else if (kind === 'stairs') mesh = buildStairs(p.stairCount);
  else if (kind === 'arch') mesh = buildArch(p.archSegments, p.wallThickness);
  else if (kind === 'torus') mesh = buildTorus(p.torusMajorSegments, p.torusTubeSegments, p.wallThickness);
  else mesh = buildTube(p.radialSegments, p.wallThickness);
  let report = validateMeshFull(mesh);
  if (report.issues.some((issue) => issue.code === 'INWARD_WINDING')) {
    const flipped = flipFaces(mesh, [...mesh.faces.keys()]);
    if (!flipped.ok) throw new Error(flipped.error?.message ?? `Could not correct ${kind} winding`);
    report = validateMeshFull(mesh);
  }
  const errors = report.issues.filter((issue) => issue.severity === 'error');
  if (errors.length) throw new Error(`${PRIMITIVE_LABELS[kind]} topology is invalid: ${errors.map((issue) => issue.message).join('; ')}`);
  applyShading(mesh, kind, p);
  // Degenerate / missing UVs → Auto unwrap so each 3D face gets its own island.
  ensureUsableUvs(mesh);
  return mesh;
}

function faceUvArea(mesh: EditableMesh, faceId: FaceId, layerId: UvLayerId): number {
  const corners = faceCornerIds(mesh, faceId);
  let area = 0;
  for (let i = 0; i < corners.length; i++) {
    const a = mesh.faceCorners.get(corners[i]!)!.uvs.get(layerId) ?? { x: 0, y: 0 };
    const b =
      mesh.faceCorners.get(corners[(i + 1) % corners.length]!)!.uvs.get(layerId) ?? {
        x: 0,
        y: 0,
      };
    area += a.x * b.y - b.x * a.y;
  }
  return Math.abs(area) * 0.5;
}

function ensureUsableUvs(mesh: EditableMesh): void {
  const layerId = mesh.defaultUvLayerId;
  if (!layerId || !mesh.uvLayers.has(layerId) || mesh.faces.size === 0) return;
  const degenerate = [...mesh.faces.keys()].some(
    (faceId) => faceUvArea(mesh, faceId, layerId) < 1e-12,
  );
  if (degenerate) {
    unwrapUvAuto(mesh, [...mesh.faces.keys()], layerId);
  }
}

function applyShading(mesh: EditableMesh, kind: PrimitiveKind, p: PrimitiveParameters): void {
  if (!p.smooth) return;
  for (const face of mesh.faces.values()) face.flatShaded = false;
  if (kind === 'cylinder' || kind === 'column' || kind === 'cone') {
    for (const face of mesh.faces.values()) if (faceHalfEdgeIds(mesh, face.id).length > 4) face.flatShaded = true;
    for (const edge of mesh.edges.values()) {
      const faces = [edge.halfEdgeAId, edge.halfEdgeBId].filter((id): id is string => !!id).map((id) => mesh.halfEdges.get(id)?.faceId).filter(Boolean).map((id) => mesh.faces.get(id!));
      if (faces.some((face) => face?.flatShaded) && faces.some((face) => !face?.flatShaded)) edge.sharpness = 1;
    }
  }
}

function buildIcosphere(subdivisions: number): EditableMesh {
  const t = (1 + Math.sqrt(5)) / 2; let positions = [[-1,t,0],[1,t,0],[-1,-t,0],[1,-t,0],[0,-1,t],[0,1,t],[0,-1,-t],[0,1,-t],[t,0,-1],[t,0,1],[-t,0,-1],[-t,0,1]].map(([x,y,z]) => normalizeVec3(v3(x!,y!,z!)));
  let faces = [[0,11,5],[0,5,1],[0,1,7],[0,7,10],[0,10,11],[1,5,9],[5,11,4],[11,10,2],[10,7,6],[7,1,8],[3,9,4],[3,4,2],[3,2,6],[3,6,8],[3,8,9],[4,9,5],[2,4,11],[6,2,10],[8,6,7],[9,8,1]];
  for (let level = 0; level < subdivisions; level++) { const cache = new Map<string, number>(); const midpoint = (a: number,b: number) => { const key=a<b?`${a}|${b}`:`${b}|${a}`; const old=cache.get(key); if(old!=null)return old; const p=normalizeVec3(addVec3(positions[a]!,positions[b]!)); const id=positions.push(p)-1; cache.set(key,id); return id; }; faces=faces.flatMap(([a,b,c])=>{const ab=midpoint(a!,b!),bc=midpoint(b!,c!),ca=midpoint(c!,a!);return [[a!,ab,ca],[b!,bc,ab],[c!,ca,bc],[ab,bc,ca]];}); }
  const b = new MeshBuilder('Icosphere', true); const ids=positions.map((p)=>b.vertex(scaleVec3(p,0.5))); for(const f of faces)b.tri(ids[f[0]!]!,ids[f[1]!]!,ids[f[2]!]!); return b.build();
}

function buildCapsule(radial: number, hemiRings: number): EditableMesh {
  const b=new MeshBuilder('Capsule',false),rows:string[][]=[],south=b.vertex(v3(0,-.5,0)),north=b.vertex(v3(0,.5,0));
  const addRing=(y:number,radius:number)=>{const row:string[]=[];for(let i=0;i<radial;i++){const t=i/radial*Math.PI*2;row.push(b.vertex(v3(Math.cos(t)*radius,y,Math.sin(t)*radius)));}rows.push(row);};
  for(let k=1;k<=hemiRings;k++){const a=-Math.PI/2+k/hemiRings*Math.PI/2;addRing(-.25+Math.sin(a)*.25,Math.cos(a)*.5);}
  for(let k=0;k<hemiRings;k++){const a=k/hemiRings*Math.PI/2;addRing(.25+Math.sin(a)*.25,Math.cos(a)*.5);}
  for(let i=0;i<radial;i++){const j=(i+1)%radial;b.tri(south,rows[0]![j]!,rows[0]![i]!);}
  for(let r=0;r<rows.length-1;r++)for(let i=0;i<radial;i++){const j=(i+1)%radial;b.quad(rows[r]![i]!,rows[r]![j]!,rows[r+1]![j]!,rows[r+1]![i]!,[v2(i/radial,r/(rows.length-1)),v2((i+1)/radial,r/(rows.length-1)),v2((i+1)/radial,(r+1)/(rows.length-1)),v2(i/radial,(r+1)/(rows.length-1))]);}
  const last=rows[rows.length-1]!;for(let i=0;i<radial;i++){const j=(i+1)%radial;b.tri(north,last[i]!,last[j]!);}return b.build();
}

function buildTorus(majorSegments:number,tubeSegments:number,thickness:number):EditableMesh{const b=new MeshBuilder('Torus',false), rows:string[][]=[]; const tube=Math.min(0.24,Math.max(0.05,thickness/2)),major=0.5-tube; for(let i=0;i<majorSegments;i++){const a=i/majorSegments*Math.PI*2,row:string[]=[];for(let j=0;j<tubeSegments;j++){const q=j/tubeSegments*Math.PI*2,r=major+Math.cos(q)*tube;row.push(b.vertex(v3(Math.cos(a)*r,Math.sin(q)*0.5,Math.sin(a)*r)));}rows.push(row);}for(let i=0;i<majorSegments;i++)for(let j=0;j<tubeSegments;j++)b.quad(rows[i]![j]!,rows[(i+1)%majorSegments]![j]!,rows[(i+1)%majorSegments]![(j+1)%tubeSegments]!,rows[i]![(j+1)%tubeSegments]!);return b.build();}

function buildTube(segments:number,thickness:number):EditableMesh{const b=new MeshBuilder('Tube',false),ob:string[]=[],ot:string[]=[],ib:string[]=[],it:string[]=[];const inner=0.5*(1-Math.min(0.8,Math.max(0.1,thickness)));for(let i=0;i<segments;i++){const a=i/segments*Math.PI*2,c=Math.cos(a),s=Math.sin(a);ob.push(b.vertex(v3(c*.5,-.5,s*.5)));ot.push(b.vertex(v3(c*.5,.5,s*.5)));ib.push(b.vertex(v3(c*inner,-.5,s*inner)));it.push(b.vertex(v3(c*inner,.5,s*inner)));}for(let i=0;i<segments;i++){const j=(i+1)%segments;b.quad(ob[i]!,ob[j]!,ot[j]!,ot[i]!);b.quad(ib[j]!,ib[i]!,it[i]!,it[j]!);b.quad(ot[i]!,ot[j]!,it[j]!,it[i]!);b.quad(ob[j]!,ob[i]!,ib[i]!,ib[j]!);}return b.build();}

function buildStairs(steps:number):EditableMesh{const b=new MeshBuilder('Stairs',false),profile:{y:number;z:number}[]=[{y:-.5,z:-.5},{y:-.5,z:.5},{y:.5,z:.5}];for(let i=steps-1;i>=0;i--){profile.push({y:-.5+(i+1)/steps,z:-.5+i/steps});if(i>0)profile.push({y:-.5+i/steps,z:-.5+i/steps});}const left=profile.map(p=>b.vertex(v3(-.5,p.y,p.z))),right=profile.map(p=>b.vertex(v3(.5,p.y,p.z)));b.ngon([...left].reverse());b.ngon(right);for(let i=0;i<profile.length;i++){const j=(i+1)%profile.length;b.quad(left[i]!,left[j]!,right[j]!,right[i]!);}return b.build();}

function buildArch(segments:number,thickness:number):EditableMesh{const b=new MeshBuilder('Arch',false),p:{x:number;z:number}[]=[];const innerX=.5-thickness,innerZ=.5-thickness;p.push({x:-.5,z:-.5});for(let i=0;i<=segments;i++){const a=Math.PI-i/segments*Math.PI;p.push({x:Math.cos(a)*.5,z:Math.sin(a)*.5});}p.push({x:.5,z:-.5},{x:innerX,z:-.5});for(let i=0;i<=segments;i++){const a=i/segments*Math.PI;p.push({x:Math.cos(a)*innerX,z:Math.sin(a)*innerZ});}p.push({x:-innerX,z:-.5});const front=p.map(q=>b.vertex(v3(q.x,-.5,q.z))),back=p.map(q=>b.vertex(v3(q.x,.5,q.z)));b.ngon([...front].reverse());b.ngon(back);for(let i=0;i<p.length;i++){const j=(i+1)%p.length;b.quad(front[i]!,front[j]!,back[j]!,back[i]!);}return b.build();}
