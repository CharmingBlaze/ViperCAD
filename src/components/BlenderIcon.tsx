import { memo, useMemo, type CSSProperties } from 'react';

// Official Blender UI SVGs from blender/blender release/datafiles/icons_svg
const rawIcons = import.meta.glob<string>('/src/assets/icons/*.svg', {
  query: '?raw',
  import: 'default',
  eager: true,
});

const iconSvgCache = new Map<string, string>();

function prepareSvg(rawSvg: string): string {
  let converted = rawSvg
    .replace(/fill="#ffffff"/gi, 'fill="currentColor"')
    .replace(/fill="#fff"/gi, 'fill="currentColor"')
    .replace(/stroke="#ffffff"/gi, 'stroke="currentColor"')
    .replace(/stroke="#fff"/gi, 'stroke="currentColor"');
  converted = converted.replace(/<svg\b([^>]*)>/i, (_, attrs: string) => {
    let next = attrs.replace(/\sstyle="[^"]*"/i, '');
    if (!/\swidth=/i.test(next)) next += ' width="100%"';
    if (!/\sheight=/i.test(next)) next += ' height="100%"';
    return `<svg${next} style="display:block;width:100%;height:100%">`;
  });
  return converted;
}

for (const [path, rawSvg] of Object.entries(rawIcons)) {
  const match = path.match(/\/([^/]+)\.svg$/);
  if (match && match[1]) {
    iconSvgCache.set(match[1].toLowerCase(), prepareSvg(rawSvg));
  }
}

/**
 * Common Blender icon names for rich TypeScript autocomplete in IDEs.
 */
export type KnownBlenderIcon =
  | 'action'
  | 'add'
  | 'armature_data'
  | 'auto'
  | 'axis_front'
  | 'axis_side'
  | 'axis_top'
  | 'back'
  | 'blender'
  | 'bone_data'
  | 'brush_data'
  | 'camera_data'
  | 'cancel'
  | 'checkbox_dehlt'
  | 'checkbox_hlt'
  | 'checkmark'
  | 'collapsemenu'
  | 'collection_new'
  | 'color'
  | 'cone'
  | 'constraint'
  | 'cube'
  | 'cursor'
  | 'curve_data'
  | 'curve_path'
  | 'duplicate'
  | 'edge_select'
  | 'editmode_hlt'
  | 'empty_arrows'
  | 'empty_axis'
  | 'empty_data'
  | 'error'
  | 'eyedropper'
  | 'face_select'
  | 'file'
  | 'file_3D'
  | 'file_folder'
  | 'file_image'
  | 'file_new'
  | 'file_refresh'
  | 'file_tick'
  | 'filter'
  | 'forward'
  | 'fullscreen_enter'
  | 'fullscreen_exit'
  | 'gizmo'
  | 'greasepencil'
  | 'grid'
  | 'grip'
  | 'group'
  | 'hand'
  | 'help'
  | 'hide_off'
  | 'hide_on'
  | 'home'
  | 'image'
  | 'image_data'
  | 'image_plane'
  | 'info'
  | 'keyframe'
  | 'light'
  | 'light_data'
  | 'light_point'
  | 'light_sun'
  | 'locked'
  | 'loop_forwards'
  | 'material'
  | 'material_data'
  | 'mesh_capsule'
  | 'mesh_circle'
  | 'mesh_cone'
  | 'mesh_cube'
  | 'mesh_cylinder'
  | 'mesh_data'
  | 'mesh_grid'
  | 'mesh_icosphere'
  | 'mesh_monkey'
  | 'mesh_plane'
  | 'mesh_torus'
  | 'mesh_uvsphere'
  | 'mod_armature'
  | 'mod_array'
  | 'mod_bevel'
  | 'mod_boolean'
  | 'mod_curve'
  | 'mod_edgesplit'
  | 'mod_mirror'
  | 'mod_remesh'
  | 'mod_screw'
  | 'mod_skin'
  | 'mod_smooth'
  | 'mod_solidify'
  | 'mod_subsurf'
  | 'mod_triangulate'
  | 'mod_wireframe'
  | 'modifier'
  | 'modifier_data'
  | 'monkey'
  | 'normals_face'
  | 'normals_vertex'
  | 'object_data'
  | 'object_datamode'
  | 'object_hidden'
  | 'object_origin'
  | 'options'
  | 'orientation_cursor'
  | 'orientation_global'
  | 'orientation_local'
  | 'orientation_normal'
  | 'orientation_view'
  | 'outliner'
  | 'outliner_collection'
  | 'outliner_data_mesh'
  | 'outliner_ob_mesh'
  | 'overlay'
  | 'paste_down'
  | 'pause'
  | 'physics'
  | 'pinned'
  | 'pivot_active'
  | 'pivot_cursor'
  | 'pivot_individual'
  | 'pivot_median'
  | 'play'
  | 'plus'
  | 'preferences'
  | 'properties'
  | 'proportional_off'
  | 'proportional_on'
  | 'question'
  | 'recover_last'
  | 'remove'
  | 'render_animation'
  | 'render_result'
  | 'render_still'
  | 'restrict_render_off'
  | 'restrict_render_on'
  | 'restrict_select_off'
  | 'restrict_select_on'
  | 'restrict_view_off'
  | 'restrict_view_on'
  | 'scene'
  | 'scene_data'
  | 'sculptmode_hlt'
  | 'select_difference'
  | 'select_extend'
  | 'select_intersect'
  | 'select_set'
  | 'select_subtract'
  | 'settings'
  | 'shading_bounding_box'
  | 'shading_rendered'
  | 'shading_solid'
  | 'shading_texture'
  | 'shading_wire'
  | 'snap_edge'
  | 'snap_face'
  | 'snap_grid'
  | 'snap_increment'
  | 'snap_off'
  | 'snap_on'
  | 'snap_vertex'
  | 'snap_volume'
  | 'speaker'
  | 'sphere'
  | 'statusbar'
  | 'surface_data'
  | 'text'
  | 'texture'
  | 'texture_data'
  | 'three_dots'
  | 'time'
  | 'trash'
  | 'tria_down'
  | 'tria_left'
  | 'tria_right'
  | 'tria_up'
  | 'unlocked'
  | 'unpinned'
  | 'user'
  | 'uv'
  | 'uv_data'
  | 'uv_edge_select'
  | 'uv_face_select'
  | 'uv_vertex_select'
  | 'vertex_select'
  | 'view3d'
  | 'view_camera'
  | 'view_ortho'
  | 'tool_settings'
  | 'view_pan'
  | 'view_perspective'
  | 'view_zoom'
  | 'viewzoom'
  | 'window'
  | 'workspace'
  | 'world'
  | 'world_data'
  | 'x'
  | 'x_ray'
  | 'zoom_all'
  | 'zoom_in'
  | 'zoom_out'
  | 'zoom_selected'
  | (string & {});

export type BlenderIconName = KnownBlenderIcon;

export type BlenderIconProps = {
  /** Name of the icon file (without .svg), e.g. 'cube', 'vertex_select', 'mod_bevel' */
  name: BlenderIconName;
  /** Width & height in pixels (default 16) */
  size?: number | string;
  /** Optional class name */
  className?: string;
  /** Optional inline styles */
  style?: CSSProperties;
  /** Optional accessibility title */
  title?: string;
  /** Custom color override; defaults to currentColor */
  color?: string;
};

/**
 * Renders Blender's official UI SVGs, themed with currentColor.
 */
export const BlenderIcon = memo(function BlenderIcon({
  name,
  size = 16,
  className = '',
  style,
  title,
  color,
}: BlenderIconProps) {
  const normalized = name.toLowerCase().replace(/\.svg$/, '');
  const rawSvg = iconSvgCache.get(normalized);

  const containerStyle: CSSProperties = useMemo(
    () => ({
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      width: typeof size === 'number' ? `${size}px` : size,
      height: typeof size === 'number' ? `${size}px` : size,
      flexShrink: 0,
      lineHeight: 0,
      color: color || undefined,
      ...style,
    }),
    [size, color, style],
  );

  if (!rawSvg) {
    // Fallback if an icon name is missing
    return (
      <span
        className={`blender-icon-fallback ${className}`}
        style={containerStyle}
        title={title || name}
      >
        ▪
      </span>
    );
  }

  return (
    <span
      className={`blender-icon ${className}`}
      style={containerStyle}
      title={title}
      dangerouslySetInnerHTML={{ __html: rawSvg }}
      aria-hidden={!title}
    />
  );
});

/** Check if a given icon name exists in the Blender icon library. */
export function hasBlenderIcon(name: string): boolean {
  return iconSvgCache.has(name.toLowerCase().replace(/\.svg$/, ''));
}

/** Total count of registered Blender icons. */
export const TOTAL_BLENDER_ICONS = iconSvgCache.size;
