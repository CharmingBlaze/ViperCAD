import type { EditorSession } from '@/core/editor/EditorSession';
import { faceCornerIds } from '@/core/mesh/EditableMesh';
import {
  boundsOfUvs,
  cornersForFaces,
  resolveUvLayerId,
  snapshotUvs,
  UV_GIZMO_PX,
} from '@/core/uv/UvEdit';
import type { UvEditMode } from '@/workspace/TextureWorkspace';
import type { UvDiagnostics } from '@/core/uv/UvDiagnostics';

export function drawUvOverlay(
  ctx: CanvasRenderingContext2D,
  session: EditorSession,
  imgW: number,
  imgH: number,
  zoom: number,
  uvEditMode: UvEditMode,
  showGizmo: boolean,
  layerIdOverride?: string,
  diagnosticMode: 'off' | 'distortion' | 'density' = 'off',
  diagnostics?: UvDiagnostics | null,
): void {
  const sel = session.selection.state;
  const objectId = sel.activeObjectId;
  const object = objectId ? session.document.objects.get(objectId) : null;
  const mesh = object?.meshId ? session.document.meshes.get(object.meshId) : null;
  if (!mesh) return;
  const layerId = resolveUvLayerId(mesh, layerIdOverride ?? mesh.defaultUvLayerId);
  if (!layerId) return;

  const selectedFaces = sel.selectedFaceIds;
  const active = sel.activeFaceId;
  const selectedCorners = session.uvSelection.state.selectedCornerIds;
  const activeCorner = session.uvSelection.state.activeCornerId;
  // Face selection alone should still show the resize/rotate gizmo.
  const gizmoCornerIds =
    selectedCorners.size > 0
      ? selectedCorners
      : selectedFaces.size > 0
        ? new Set(cornersForFaces(mesh, selectedFaces))
        : selectedCorners;
  const toPx = (uv: { x: number; y: number }) => ({ x: uv.x * imgW, y: (1 - uv.y) * imgH });

  for (const face of mesh.faces.values()) {
    const corners = faceCornerIds(mesh, face.id);
    const uvs = corners.map((id) => mesh.faceCorners.get(id)!.uvs.get(layerId) ?? { x: 0, y: 0 });
    const pts = uvs.map(toPx);
    const isSel = selectedFaces.has(face.id);
    const isActive = active === face.id;

    const diagnostic = diagnostics?.faces.get(face.id);
    if (diagnosticMode !== 'off' && diagnostic) {
      let amount = 0;
      if (diagnosticMode === 'distortion') {
        amount = Math.min(1, Math.max(0, (diagnostic.distortion - 1) / 2));
      } else if (diagnostics && diagnostics.averageDensity > 1e-8) {
        amount = Math.min(1, Math.abs(diagnostic.density / diagnostics.averageDensity - 1));
      }
      ctx.beginPath();
      pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
      ctx.closePath();
      ctx.fillStyle = diagnostic.degenerate
        ? 'rgba(190,70,255,0.58)'
        : diagnostic.flipped
          ? 'rgba(255,70,90,0.62)'
          : `rgba(${Math.round(70 + amount * 185)},${Math.round(205 - amount * 130)},75,0.48)`;
      ctx.fill();
    }

    if (isSel || isActive) {
      ctx.beginPath();
      pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
      ctx.closePath();
      ctx.fillStyle = isActive ? 'rgba(255,204,102,0.28)' : 'rgba(255,122,24,0.2)';
      ctx.fill();
    }

    // Seam edges thicker
    const halfEdges = corners.map((id) => mesh.faceCorners.get(id)!.halfEdgeId);
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i]!;
      const b = pts[(i + 1) % pts.length]!;
      const he = mesh.halfEdges.get(halfEdges[i]!);
      const edge = he ? mesh.edges.get(he.edgeId) : null;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.strokeStyle = edge?.seam
        ? '#ff5a7a'
        : isActive
          ? '#ffcc66'
          : isSel
            ? '#ff7a18'
            : 'rgba(200,220,255,0.45)';
      ctx.lineWidth = ((edge?.seam ? 2.4 : isActive ? 2.2 : isSel ? 1.6 : 1)) / zoom;
      ctx.stroke();
    }

    for (let i = 0; i < corners.length; i++) {
      const cornerId = corners[i]!;
      const p = pts[i]!;
      const cornerSel = selectedCorners.has(cornerId);
      const cornerActive = activeCorner === cornerId;
      const showPoint =
        uvEditMode === 'point' || isSel || cornerSel || selectedCorners.size > 0;
      if (!showPoint) continue;
      const r = (cornerActive ? 4.5 : cornerSel ? 3.8 : 2.2) / zoom;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fillStyle = cornerActive
        ? '#ffe08a'
        : cornerSel
          ? '#ff9a3c'
          : isSel
            ? '#ffb060'
            : 'rgba(230,240,255,0.8)';
      ctx.fill();
      if (cornerSel || cornerActive) {
        ctx.strokeStyle = '#1a1208';
        ctx.lineWidth = 1 / zoom;
        ctx.stroke();
      }
    }
  }

  if (showGizmo && gizmoCornerIds.size > 0) {
    const snap = snapshotUvs(mesh, gizmoCornerIds, layerId);
    const bounds = boundsOfUvs(snap);
    if (bounds && (bounds.size.x > 1e-8 || bounds.size.y > 1e-8 || gizmoCornerIds.size === 1)) {
      const pad = gizmoCornerIds.size === 1 ? 4 / zoom / imgW : 0;
      const min = toPx({ x: bounds.min.x - pad, y: bounds.min.y - pad });
      const max = toPx({ x: bounds.max.x + pad, y: bounds.max.y + pad });
      const left = Math.min(min.x, max.x);
      const right = Math.max(min.x, max.x);
      const top = Math.min(min.y, max.y);
      const bottom = Math.max(min.y, max.y);
      const cx = (left + right) / 2;
      const cy = (top + bottom) / 2;

      ctx.strokeStyle = 'rgba(255,200,80,0.95)';
      ctx.lineWidth = 1.35 / zoom;
      ctx.setLineDash([4 / zoom, 3 / zoom]);
      ctx.strokeRect(left, top, right - left, bottom - top);
      ctx.setLineDash([]);

      const hs = UV_GIZMO_PX.handle / zoom;
      for (const h of [
        { x: left, y: bottom },
        { x: right, y: bottom },
        { x: left, y: top },
        { x: right, y: top },
        { x: left, y: cy },
        { x: right, y: cy },
        { x: cx, y: bottom },
        { x: cx, y: top },
      ]) {
        ctx.fillStyle = '#ffcc66';
        ctx.fillRect(h.x - hs, h.y - hs, hs * 2, hs * 2);
        ctx.strokeStyle = '#1a1208';
        ctx.lineWidth = 1.1 / zoom;
        ctx.strokeRect(h.x - hs, h.y - hs, hs * 2, hs * 2);
      }

      const rotY = top - UV_GIZMO_PX.rotateStem / zoom;
      const rotR = (UV_GIZMO_PX.rotateHit * 0.35) / zoom;
      ctx.beginPath();
      ctx.moveTo(cx, top);
      ctx.lineTo(cx, rotY);
      ctx.strokeStyle = '#ffcc66';
      ctx.lineWidth = 1.5 / zoom;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cx, rotY, rotR, 0, Math.PI * 2);
      ctx.fillStyle = '#7ec8ff';
      ctx.fill();
      ctx.strokeStyle = '#1a1208';
      ctx.lineWidth = 1.1 / zoom;
      ctx.stroke();
    }
  }
}
