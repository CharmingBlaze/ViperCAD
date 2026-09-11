export const THEME_STORAGE_KEY = 'vipercad.theme';

export const WORKSPACE_THEME_IDS = [
  'obsidian',
  'venom',
  'amber',
  'nordic',
  'amiga',
  'macintosh',
  'c64',
  'vga',
  'phosphor',
  'nextcube',
  'beos',
  'nes',
  'snes',
  'gameboy',
  'genesis',
  'playstation',
  'n64',
  'dreamcast',
  'synthwave',
  'ice',
] as const;

export type WorkspaceThemeId = (typeof WORKSPACE_THEME_IDS)[number];

export type ThemeCategory = 'studio' | 'computers' | 'consoles' | 'color';

export const THEME_CATEGORIES: ReadonlyArray<{ id: ThemeCategory; label: string }> = [
  { id: 'studio', label: 'Studio' },
  { id: 'computers', label: 'Computers' },
  { id: 'consoles', label: 'Game systems' },
  { id: 'color', label: 'Color' },
];

/** 3D viewport, grid, gizmo, and overlay colours. */
export type ViewportTheme = {
  zenith: string;
  horizon: string;
  ground: string;
  sun: string;
  fog: string;
  gridMinor: string;
  gridMajor: string;
  gridFloor: string;
  gizmoX: string;
  gizmoY: string;
  gizmoZ: string;
  gizmoView: string;
  gizmoCentre: string;
  overlaySelected: string;
  overlayHover: string;
  overlayActive: string;
};

export type ThemePalette = ViewportTheme & {
  bg: string;
  bar: string;
  line: string;
  text: string;
  textSecondary: string;
  muted: string;
  accent: string;
  accentHover: string;
  accentMuted: string;
  accentContrast: string;
  accentSelected: string;
  creative: string;
  success: string;
  warning: string;
  danger: string;
  panel: string;
  panelSecondary: string;
  raised: string;
  control: string;
  viewport: string;
  btn: string;
  btnHover: string;
  divider: string;
  scrollbarTrack: string;
  scrollbarThumb: string;
  scrollbarThumbHover: string;
  scrollbarThumbActive: string;
};

export type WorkspaceTheme = {
  id: WorkspaceThemeId;
  label: string;
  category: ThemeCategory;
  accent: string;
  palette: ThemePalette;
};

type ThemeSeed = {
  id: WorkspaceThemeId;
  label: string;
  category: ThemeCategory;
  bg: string;
  line: string;
  text: string;
  textSecondary?: string;
  muted?: string;
  accent: string;
  accentHover?: string;
  accentMuted?: string;
  accentSelected?: string;
  creative?: string;
  success?: string;
  warning?: string;
  danger?: string;
  panel: string;
  panelSecondary?: string;
  raised?: string;
  control?: string;
  btnHover?: string;
  scrollbarThumb?: string;
  scrollbarThumbHover?: string;
  scrollbarThumbActive?: string;
  zenith: string;
  horizon: string;
  ground: string;
  sun?: string;
  gridMinor?: string;
  gridMajor?: string;
  gizmoX: string;
  gizmoY: string;
  gizmoZ: string;
  gizmoView?: string;
  gizmoCentre?: string;
  overlaySelected?: string;
  overlayHover?: string;
  overlayActive?: string;
};

export function parseHexColor(hex: string): number {
  const raw = hex.replace('#', '').trim();
  const full = raw.length === 3 ? raw.split('').map((ch) => ch + ch).join('') : raw;
  return Number.parseInt(full, 16) || 0;
}

function rgb(hex: string): [number, number, number] {
  const n = parseHexColor(hex);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function toHex(r: number, g: number, b: number): string {
  const h = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}

function mixHex(a: string, b: string, t: number): string {
  const [ar, ag, ab] = rgb(a);
  const [br, bg, bb] = rgb(b);
  return toHex(ar + (br - ar) * t, ag + (bg - ag) * t, ab + (bb - ab) * t);
}

function lighten(hex: string, t: number): string {
  return mixHex(hex, '#ffffff', t);
}

function rgba(hex: string, alpha: number): string {
  const [r, g, b] = rgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function defineTheme(seed: ThemeSeed): WorkspaceTheme {
  const textSecondary = seed.textSecondary ?? mixHex(seed.text, seed.bg, 0.32);
  const muted = seed.muted ?? mixHex(seed.text, seed.bg, 0.55);
  const panelSecondary = seed.panelSecondary ?? mixHex(seed.panel, seed.bg, 0.4);
  const raised = seed.raised ?? mixHex(seed.panel, seed.text, 0.06);
  const control = seed.control ?? mixHex(seed.panel, seed.text, 0.1);
  const btnHover = seed.btnHover ?? mixHex(control, seed.text, 0.1);
  const thumb = seed.scrollbarThumb ?? mixHex(control, seed.text, 0.18);
  const creative = seed.creative ?? '#e3a23b';
  const overlaySelected = seed.overlaySelected ?? creative;
  const palette: ThemePalette = {
    bg: seed.bg,
    bar: seed.bg,
    line: seed.line,
    text: seed.text,
    textSecondary,
    muted,
    accent: seed.accent,
    accentHover: seed.accentHover ?? lighten(seed.accent, 0.12),
    accentMuted: seed.accentMuted ?? mixHex(seed.accent, seed.text, 0.35),
    accentContrast: seed.text,
    accentSelected: seed.accentSelected ?? mixHex(seed.accent, seed.bg, 0.62),
    creative,
    success: seed.success ?? '#4cae75',
    warning: seed.warning ?? '#d59a42',
    danger: seed.danger ?? '#d75b5b',
    panel: seed.panel,
    panelSecondary,
    raised,
    control,
    viewport: seed.horizon,
    btn: control,
    btnHover,
    divider: seed.line,
    scrollbarTrack: seed.bg,
    scrollbarThumb: thumb,
    scrollbarThumbHover: seed.scrollbarThumbHover ?? mixHex(thumb, seed.text, 0.14),
    scrollbarThumbActive: seed.scrollbarThumbActive ?? mixHex(thumb, seed.text, 0.24),
    zenith: seed.zenith,
    horizon: seed.horizon,
    ground: seed.ground,
    sun: seed.sun ?? mixHex(seed.text, '#fff4d0', 0.28),
    fog: seed.horizon,
    gridMinor: seed.gridMinor ?? mixHex(seed.horizon, seed.text, 0.12),
    gridMajor: seed.gridMajor ?? mixHex(seed.horizon, seed.text, 0.28),
    gridFloor: seed.horizon,
    gizmoX: seed.gizmoX,
    gizmoY: seed.gizmoY,
    gizmoZ: seed.gizmoZ,
    gizmoView: seed.gizmoView ?? creative,
    gizmoCentre: seed.gizmoCentre ?? seed.text,
    overlaySelected,
    overlayHover: seed.overlayHover ?? lighten(seed.accent, 0.22),
    overlayActive: seed.overlayActive ?? lighten(overlaySelected, 0.28),
  };
  return {
    id: seed.id,
    label: seed.label,
    category: seed.category,
    accent: palette.accent,
    palette,
  };
}

export const WORKSPACE_THEMES: readonly WorkspaceTheme[] = [
  defineTheme({
    id: 'obsidian',
    label: 'Dark',
    category: 'studio',
    bg: '#17191c',
    line: '#2a2e33',
    text: '#e4e8ed',
    textSecondary: '#aeb6bf',
    muted: '#747e89',
    accent: '#2787e8',
    accentHover: '#3598f4',
    accentMuted: '#7eb6f0',
    accentSelected: '#183b5c',
    creative: '#e3a23b',
    success: '#4cae75',
    warning: '#d59a42',
    danger: '#d75b5b',
    panel: '#202327',
    panelSecondary: '#1b1d20',
    raised: '#25292e',
    control: '#2b3036',
    btnHover: '#343a41',
    scrollbarThumb: '#3a4048',
    scrollbarThumbHover: '#4a515a',
    scrollbarThumbActive: '#5a626c',
    zenith: '#22262b',
    horizon: '#1b1d20',
    ground: '#15171a',
    sun: '#c8cdd3',
    gridMinor: '#2a2e33',
    gridMajor: '#4a5058',
    gizmoX: '#e74c3c',
    gizmoY: '#2ecc71',
    gizmoZ: '#3498db',
    gizmoView: '#f0c040',
    gizmoCentre: '#e8ebf0',
    overlaySelected: '#ffb020',
    overlayHover: '#3ee8ff',
    overlayActive: '#fff36a',
  }),
  defineTheme({
    id: 'venom',
    label: 'Deep Dark',
    category: 'studio',
    bg: '#121417',
    line: '#262a2f',
    text: '#e4e8ed',
    textSecondary: '#aeb6bf',
    muted: '#747e89',
    accent: '#2787e8',
    accentHover: '#3598f4',
    accentMuted: '#7eb6f0',
    accentSelected: '#15324e',
    panel: '#1b1e22',
    panelSecondary: '#16181b',
    raised: '#22262b',
    control: '#292e34',
    btnHover: '#32383f',
    scrollbarThumb: '#353b42',
    scrollbarThumbHover: '#454c55',
    scrollbarThumbActive: '#555d67',
    zenith: '#1a1e24',
    horizon: '#121417',
    ground: '#0c0e10',
    sun: '#b8c0c8',
    gridMinor: '#24282e',
    gridMajor: '#3e444c',
    gizmoX: '#e0564a',
    gizmoY: '#3ad07a',
    gizmoZ: '#4aa3e0',
    gizmoView: '#e8b84a',
    overlaySelected: '#ffb020',
    overlayHover: '#3ee8ff',
    overlayActive: '#fff36a',
  }),
  defineTheme({
    id: 'amber',
    label: 'Medium Dark',
    category: 'studio',
    bg: '#1c1a17',
    line: '#332f2a',
    text: '#eee6dc',
    textSecondary: '#b8b0a6',
    muted: '#837a70',
    accent: '#2787e8',
    accentHover: '#3598f4',
    accentMuted: '#7eb6f0',
    accentSelected: '#183b5c',
    panel: '#25221e',
    panelSecondary: '#1e1c19',
    raised: '#2c2924',
    control: '#35312b',
    btnHover: '#403b34',
    scrollbarThumb: '#403b34',
    scrollbarThumbHover: '#514b43',
    scrollbarThumbActive: '#625b51',
    zenith: '#2c2620',
    horizon: '#1e1b17',
    ground: '#14110e',
    sun: '#e8d4b0',
    gridMinor: '#3a342c',
    gridMajor: '#5a5044',
    gizmoX: '#e07050',
    gizmoY: '#7cba68',
    gizmoZ: '#5a92c4',
    gizmoView: '#e3a23b',
    overlaySelected: '#e3a23b',
    overlayHover: '#7ecbff',
    overlayActive: '#f0d080',
  }),
  defineTheme({
    id: 'nordic',
    label: 'Slate',
    category: 'studio',
    bg: '#1a1d22',
    line: '#2d333b',
    text: '#e4e8ed',
    textSecondary: '#aeb6bf',
    muted: '#747e89',
    accent: '#2787e8',
    accentHover: '#3598f4',
    accentMuted: '#7eb6f0',
    accentSelected: '#183b5c',
    panel: '#22262c',
    panelSecondary: '#1c2025',
    raised: '#282d34',
    control: '#30363e',
    btnHover: '#3a414a',
    scrollbarThumb: '#3a414a',
    scrollbarThumbHover: '#4a525c',
    scrollbarThumbActive: '#5a636e',
    zenith: '#243040',
    horizon: '#1a222c',
    ground: '#121820',
    sun: '#d0dce8',
    gridMinor: '#2e3844',
    gridMajor: '#4a5868',
    gizmoX: '#d07070',
    gizmoY: '#5cb88a',
    gizmoZ: '#5a9ad4',
    gizmoView: '#c8d0d8',
    overlaySelected: '#7eb6f0',
    overlayHover: '#a8e0ff',
    overlayActive: '#e4eef8',
  }),
  defineTheme({
    id: 'amiga',
    label: 'Amiga',
    category: 'computers',
    bg: '#0d0d2a',
    line: '#2a2a5c',
    text: '#e8e8ff',
    textSecondary: '#b0b0d8',
    muted: '#7878a8',
    accent: '#ff9900',
    accentSelected: '#4a2a08',
    creative: '#ffcc00',
    success: '#44aa88',
    warning: '#ff9900',
    danger: '#ee5555',
    panel: '#161640',
    panelSecondary: '#101032',
    raised: '#1c1c4a',
    control: '#22225a',
    zenith: '#22225a',
    horizon: '#12123a',
    ground: '#080820',
    sun: '#ffe8c0',
    gridMinor: '#2a2a62',
    gridMajor: '#4a4a90',
    gizmoX: '#ff8800',
    gizmoY: '#f4f4ff',
    gizmoZ: '#4488ff',
    gizmoView: '#ffcc44',
    overlaySelected: '#ff9900',
    overlayHover: '#66ccff',
    overlayActive: '#ffe080',
  }),
  defineTheme({
    id: 'macintosh',
    label: 'Macintosh',
    category: 'computers',
    bg: '#1a1a1a',
    line: '#3a3a3a',
    text: '#f2f2f2',
    textSecondary: '#b8b8b8',
    muted: '#808080',
    accent: '#0b80ff',
    accentSelected: '#0a2a4a',
    creative: '#f5d327',
    success: '#7ac143',
    warning: '#f5d327',
    danger: '#ed1c24',
    panel: '#242424',
    panelSecondary: '#1e1e1e',
    raised: '#2c2c2c',
    control: '#333333',
    zenith: '#2c2c2c',
    horizon: '#1c1c1c',
    ground: '#101010',
    sun: '#f0f0f0',
    gridMinor: '#333333',
    gridMajor: '#555555',
    gizmoX: '#ed1c24',
    gizmoY: '#7ac143',
    gizmoZ: '#00a4e4',
    gizmoView: '#f5d327',
    gizmoCentre: '#f2f2f2',
    overlaySelected: '#f5d327',
    overlayHover: '#7ec8ff',
    overlayActive: '#ffe878',
  }),
  defineTheme({
    id: 'c64',
    label: 'Commodore 64',
    category: 'computers',
    bg: '#0c0820',
    line: '#3c3480',
    text: '#c8c8ff',
    textSecondary: '#9890c8',
    muted: '#6860a0',
    accent: '#6c5eb5',
    accentSelected: '#241858',
    creative: '#b8c76f',
    success: '#6eb8a7',
    warning: '#b8c76f',
    danger: '#cb7e75',
    panel: '#18143a',
    panelSecondary: '#120e30',
    raised: '#201c48',
    control: '#28245a',
    zenith: '#40318d',
    horizon: '#201060',
    ground: '#100830',
    sun: '#c8b8ff',
    gridMinor: '#3c2c78',
    gridMajor: '#6c5eb5',
    gizmoX: '#cb7e75',
    gizmoY: '#6eb8a7',
    gizmoZ: '#6c5eb5',
    gizmoView: '#b8c76f',
    overlaySelected: '#b8c76f',
    overlayHover: '#98d0ff',
    overlayActive: '#e0f090',
  }),
  defineTheme({
    id: 'vga',
    label: 'VGA',
    category: 'computers',
    bg: '#000000',
    line: '#555555',
    text: '#e0e0e0',
    textSecondary: '#aaaaaa',
    muted: '#888888',
    accent: '#00aaaa',
    accentSelected: '#003838',
    creative: '#aa5500',
    success: '#00aa00',
    warning: '#aa5500',
    danger: '#aa0000',
    panel: '#111111',
    panelSecondary: '#0a0a0a',
    raised: '#1a1a1a',
    control: '#222222',
    zenith: '#000055',
    horizon: '#000000',
    ground: '#000000',
    sun: '#aaaaaa',
    gridMinor: '#222222',
    gridMajor: '#555555',
    gizmoX: '#aa0000',
    gizmoY: '#00aa00',
    gizmoZ: '#5555ff',
    gizmoView: '#aa5500',
    gizmoCentre: '#aaaaaa',
    overlaySelected: '#ffff55',
    overlayHover: '#55ffff',
    overlayActive: '#ffffff',
  }),
  defineTheme({
    id: 'phosphor',
    label: 'Phosphor',
    category: 'computers',
    bg: '#031208',
    line: '#1a3a1a',
    text: '#b8ffc8',
    textSecondary: '#70c888',
    muted: '#4a8860',
    accent: '#33ff66',
    accentSelected: '#0a3a18',
    creative: '#ffb000',
    success: '#33ff66',
    warning: '#ffb000',
    danger: '#ff6644',
    panel: '#0a1a0c',
    panelSecondary: '#061208',
    raised: '#102414',
    control: '#16301a',
    zenith: '#042018',
    horizon: '#031208',
    ground: '#020a04',
    sun: '#88ffaa',
    gridMinor: '#0e3018',
    gridMajor: '#1a5830',
    gizmoX: '#ffb000',
    gizmoY: '#33ff66',
    gizmoZ: '#66cc88',
    gizmoView: '#ccff66',
    overlaySelected: '#ffb000',
    overlayHover: '#66ffaa',
    overlayActive: '#e8ff90',
  }),
  defineTheme({
    id: 'nextcube',
    label: 'NeXT',
    category: 'computers',
    bg: '#0a0a0a',
    line: '#2a2a2a',
    text: '#d8d8d8',
    textSecondary: '#a0a0a0',
    muted: '#707070',
    accent: '#6a8aaa',
    accentSelected: '#1a2838',
    creative: '#c0a060',
    success: '#70a070',
    warning: '#c0a060',
    danger: '#c04040',
    panel: '#161616',
    panelSecondary: '#101010',
    raised: '#1e1e1e',
    control: '#262626',
    zenith: '#18181c',
    horizon: '#0c0c0c',
    ground: '#050505',
    sun: '#c8c8d0',
    gridMinor: '#222226',
    gridMajor: '#3a3a40',
    gizmoX: '#c04040',
    gizmoY: '#70a070',
    gizmoZ: '#6080b0',
    gizmoView: '#c0a060',
    overlaySelected: '#c0a060',
    overlayHover: '#90c0e0',
    overlayActive: '#e8d090',
  }),
  defineTheme({
    id: 'beos',
    label: 'BeOS',
    category: 'computers',
    bg: '#141820',
    line: '#3a4048',
    text: '#e8e4d8',
    textSecondary: '#b0b0a8',
    muted: '#7a7a74',
    accent: '#f5c400',
    accentSelected: '#3a3008',
    creative: '#f5c400',
    success: '#3aa0a0',
    warning: '#f5c400',
    danger: '#e85840',
    panel: '#1c2430',
    panelSecondary: '#161e28',
    raised: '#243040',
    control: '#2c3848',
    zenith: '#243040',
    horizon: '#181e28',
    ground: '#101418',
    sun: '#ffe8a0',
    gridMinor: '#2c3848',
    gridMajor: '#4a5868',
    gizmoX: '#e85840',
    gizmoY: '#3aa0a0',
    gizmoZ: '#4080c8',
    gizmoView: '#f5c400',
    overlaySelected: '#f5c400',
    overlayHover: '#70d0e0',
    overlayActive: '#ffe878',
  }),
  defineTheme({
    id: 'nes',
    label: 'NES',
    category: 'consoles',
    bg: '#14101c',
    line: '#3a3048',
    text: '#f0e8d8',
    textSecondary: '#b8b0a8',
    muted: '#807870',
    accent: '#e4002b',
    accentSelected: '#4a0810',
    creative: '#f8d878',
    success: '#58a848',
    warning: '#f8d878',
    danger: '#e4002b',
    panel: '#1c1828',
    panelSecondary: '#161220',
    raised: '#242030',
    control: '#2c2838',
    zenith: '#203848',
    horizon: '#181428',
    ground: '#100c18',
    sun: '#f8e0b0',
    gridMinor: '#2c3048',
    gridMajor: '#485868',
    gizmoX: '#e4002b',
    gizmoY: '#58d854',
    gizmoZ: '#3cbcfc',
    gizmoView: '#f8d878',
    overlaySelected: '#f8d878',
    overlayHover: '#3cbcfc',
    overlayActive: '#fff0a0',
  }),
  defineTheme({
    id: 'snes',
    label: 'Super NES',
    category: 'consoles',
    bg: '#160e1c',
    line: '#3c2a4a',
    text: '#ece4f4',
    textSecondary: '#b8a8c8',
    muted: '#807090',
    accent: '#b070e0',
    accentSelected: '#301848',
    creative: '#e8c040',
    success: '#48c8a0',
    warning: '#e8c040',
    danger: '#e07070',
    panel: '#221628',
    panelSecondary: '#1a1020',
    raised: '#2a1c34',
    control: '#322440',
    zenith: '#2a1840',
    horizon: '#1a1028',
    ground: '#100818',
    sun: '#e8c8ff',
    gridMinor: '#3a2460',
    gridMajor: '#5a4088',
    gizmoX: '#e07070',
    gizmoY: '#50d0a0',
    gizmoZ: '#6090e8',
    gizmoView: '#e8c040',
    overlaySelected: '#e8c040',
    overlayHover: '#c090ff',
    overlayActive: '#ffe080',
  }),
  defineTheme({
    id: 'gameboy',
    label: 'Game Boy',
    category: 'consoles',
    bg: '#0c1408',
    line: '#2a4020',
    text: '#c4d0a0',
    textSecondary: '#8bac0f',
    muted: '#4a6a30',
    accent: '#8bac0f',
    accentSelected: '#1a2808',
    creative: '#9bbc0f',
    success: '#8bac0f',
    warning: '#9bbc0f',
    danger: '#306230',
    panel: '#142010',
    panelSecondary: '#0e180c',
    raised: '#1a2814',
    control: '#203018',
    zenith: '#0f380f',
    horizon: '#0c200c',
    ground: '#081408',
    sun: '#9bbc0f',
    gridMinor: '#1a3818',
    gridMajor: '#306230',
    gizmoX: '#e0c040',
    gizmoY: '#8bac0f',
    gizmoZ: '#4a7a30',
    gizmoView: '#9bbc0f',
    gizmoCentre: '#d0e8a0',
    overlaySelected: '#9bbc0f',
    overlayHover: '#c4e038',
    overlayActive: '#e8f090',
  }),
  defineTheme({
    id: 'genesis',
    label: 'Genesis',
    category: 'consoles',
    bg: '#0a1020',
    line: '#283050',
    text: '#e0e8f0',
    textSecondary: '#98a8c0',
    muted: '#687890',
    accent: '#d00020',
    accentSelected: '#3a0810',
    creative: '#f0c000',
    success: '#20a070',
    warning: '#f0c000',
    danger: '#d00020',
    panel: '#121830',
    panelSecondary: '#0c1228',
    raised: '#1a2440',
    control: '#222c48',
    zenith: '#1a2850',
    horizon: '#101828',
    ground: '#080c18',
    sun: '#c0d0f0',
    gridMinor: '#243048',
    gridMajor: '#3a5080',
    gizmoX: '#e02030',
    gizmoY: '#20c070',
    gizmoZ: '#3080e0',
    gizmoView: '#f0c000',
    overlaySelected: '#f0c000',
    overlayHover: '#60b0ff',
    overlayActive: '#ffe070',
  }),
  defineTheme({
    id: 'playstation',
    label: 'PlayStation',
    category: 'consoles',
    bg: '#121214',
    line: '#2c2c30',
    text: '#e4e4e8',
    textSecondary: '#a8a8b0',
    muted: '#747480',
    accent: '#3a7bd5',
    accentSelected: '#102848',
    creative: '#ffed00',
    success: '#00a651',
    warning: '#ffed00',
    danger: '#ed1c24',
    panel: '#1a1a1e',
    panelSecondary: '#141418',
    raised: '#222226',
    control: '#2a2a30',
    zenith: '#1c1c22',
    horizon: '#121214',
    ground: '#0a0a0c',
    sun: '#d8d8e0',
    gridMinor: '#2a2a32',
    gridMajor: '#44444e',
    gizmoX: '#ed1c24',
    gizmoY: '#00a651',
    gizmoZ: '#0072bc',
    gizmoView: '#ee2d96',
    gizmoCentre: '#f0f0f0',
    overlaySelected: '#ee2d96',
    overlayHover: '#40b0ff',
    overlayActive: '#ffed00',
  }),
  defineTheme({
    id: 'n64',
    label: 'Nintendo 64',
    category: 'consoles',
    bg: '#161616',
    line: '#323232',
    text: '#ececec',
    textSecondary: '#b0b0b0',
    muted: '#7a7a7a',
    accent: '#e60012',
    accentSelected: '#3a080c',
    creative: '#ffd200',
    success: '#009a3d',
    warning: '#ffd200',
    danger: '#e60012',
    panel: '#1e1e1e',
    panelSecondary: '#181818',
    raised: '#262626',
    control: '#2e2e2e',
    zenith: '#202428',
    horizon: '#161616',
    ground: '#0e0e0e',
    sun: '#e0e0e0',
    gridMinor: '#2c2c2c',
    gridMajor: '#4a4a4a',
    gizmoX: '#e60012',
    gizmoY: '#009a3d',
    gizmoZ: '#0055b8',
    gizmoView: '#ffd200',
    overlaySelected: '#ffd200',
    overlayHover: '#40a0ff',
    overlayActive: '#ffe878',
  }),
  defineTheme({
    id: 'dreamcast',
    label: 'Dreamcast',
    category: 'consoles',
    bg: '#16120e',
    line: '#3a3028',
    text: '#f0e8dc',
    textSecondary: '#c0b0a0',
    muted: '#887868',
    accent: '#ff6a00',
    accentSelected: '#3a1808',
    creative: '#ff8a20',
    success: '#40a090',
    warning: '#ff8a20',
    danger: '#ff6a00',
    panel: '#221c16',
    panelSecondary: '#1a1610',
    raised: '#2a241c',
    control: '#322c24',
    zenith: '#2a2218',
    horizon: '#1a1610',
    ground: '#100c08',
    sun: '#ffd0a0',
    gridMinor: '#3a3024',
    gridMajor: '#5a4a38',
    gizmoX: '#ff6a00',
    gizmoY: '#40c8a0',
    gizmoZ: '#4080c8',
    gizmoView: '#ffc040',
    overlaySelected: '#ff8a20',
    overlayHover: '#70d0ff',
    overlayActive: '#ffd080',
  }),
  defineTheme({
    id: 'synthwave',
    label: 'Synthwave',
    category: 'color',
    bg: '#12081c',
    line: '#3a1850',
    text: '#f0e0ff',
    textSecondary: '#c090d8',
    muted: '#8860a0',
    accent: '#ff2bd6',
    accentSelected: '#3a0840',
    creative: '#ff9e2c',
    success: '#2ee6c6',
    warning: '#ff9e2c',
    danger: '#ff4d6a',
    panel: '#1c0e2a',
    panelSecondary: '#140820',
    raised: '#261438',
    control: '#301c48',
    zenith: '#3a1560',
    horizon: '#1a0828',
    ground: '#0c0414',
    sun: '#ff6ec7',
    gridMinor: '#3a1860',
    gridMajor: '#6a30a0',
    gizmoX: '#ff4d8d',
    gizmoY: '#2ee6c6',
    gizmoZ: '#7c5cff',
    gizmoView: '#ff9e2c',
    gizmoCentre: '#ffe0ff',
    overlaySelected: '#ff2bd6',
    overlayHover: '#2ee6c6',
    overlayActive: '#ffc070',
  }),
  defineTheme({
    id: 'ice',
    label: 'Ice',
    category: 'color',
    bg: '#0c141c',
    line: '#2a3a48',
    text: '#e4eef4',
    textSecondary: '#9cb4c4',
    muted: '#6a8494',
    accent: '#5ec8e8',
    accentSelected: '#103848',
    creative: '#a8d8f0',
    success: '#6ad0c0',
    warning: '#d0c090',
    danger: '#e07070',
    panel: '#141e28',
    panelSecondary: '#101820',
    raised: '#1a2834',
    control: '#223040',
    zenith: '#1a3848',
    horizon: '#102028',
    ground: '#0a1418',
    sun: '#d0e8f8',
    gridMinor: '#243848',
    gridMajor: '#3a5870',
    gizmoX: '#e07070',
    gizmoY: '#70d0b8',
    gizmoZ: '#5ec8e8',
    gizmoView: '#c0e0f0',
    gizmoCentre: '#f0f8fc',
    overlaySelected: '#7ec8e8',
    overlayHover: '#a0f0ff',
    overlayActive: '#e8f8ff',
  }),
] as const;

export const DEFAULT_WORKSPACE_THEME: WorkspaceThemeId = 'obsidian';

const themeListeners = new Set<() => void>();
let activeThemeId: WorkspaceThemeId = DEFAULT_WORKSPACE_THEME;

export function isWorkspaceThemeId(value: unknown): value is WorkspaceThemeId {
  return WORKSPACE_THEMES.some((theme) => theme.id === value);
}

export function themeById(id: WorkspaceThemeId): WorkspaceTheme {
  return WORKSPACE_THEMES.find((theme) => theme.id === id) ?? WORKSPACE_THEMES[0]!;
}

export function getActiveThemeId(): WorkspaceThemeId {
  return activeThemeId;
}

export function getActiveTheme(): WorkspaceTheme {
  return themeById(activeThemeId);
}

export function subscribeWorkspaceTheme(listener: () => void): () => void {
  themeListeners.add(listener);
  return () => {
    themeListeners.delete(listener);
  };
}

export function readStoredTheme(): WorkspaceThemeId {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    if (isWorkspaceThemeId(stored)) return stored;
  } catch {
    /* private mode / SSR */
  }
  return DEFAULT_WORKSPACE_THEME;
}

function applyCssVariables(palette: ThemePalette): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement.style;
  root.setProperty('--bg', palette.bg);
  root.setProperty('--bar', palette.bar);
  root.setProperty('--line', palette.line);
  root.setProperty('--text', palette.text);
  root.setProperty('--text-secondary', palette.textSecondary);
  root.setProperty('--muted', palette.muted);
  root.setProperty('--accent', palette.accent);
  root.setProperty('--accent-hover', palette.accentHover);
  root.setProperty('--accent-muted', palette.accentMuted);
  root.setProperty('--accent-contrast', palette.accentContrast);
  root.setProperty('--accent-selected', palette.accentSelected);
  root.setProperty('--accent-glow', rgba(palette.accent, 0.18));
  root.setProperty('--highlight', rgba(palette.accent, 0.12));
  root.setProperty('--highlight-border', rgba(palette.accent, 0.4));
  root.setProperty('--creative', palette.creative);
  root.setProperty('--success', palette.success);
  root.setProperty('--warning', palette.warning);
  root.setProperty('--danger', palette.danger);
  root.setProperty('--panel', palette.panel);
  root.setProperty('--panel-secondary', palette.panelSecondary);
  root.setProperty('--raised', palette.raised);
  root.setProperty('--control', palette.control);
  root.setProperty('--viewport', palette.viewport);
  root.setProperty('--btn', palette.btn);
  root.setProperty('--btn-hover', palette.btnHover);
  root.setProperty('--divider', palette.divider);
  root.setProperty('--scrollbar-track', palette.scrollbarTrack);
  root.setProperty('--scrollbar-thumb', palette.scrollbarThumb);
  root.setProperty('--scrollbar-thumb-hover', palette.scrollbarThumbHover);
  root.setProperty('--scrollbar-thumb-active', palette.scrollbarThumbActive);
  root.setProperty('--gizmo-x', palette.gizmoX);
  root.setProperty('--gizmo-y', palette.gizmoY);
  root.setProperty('--gizmo-z', palette.gizmoZ);
  root.setProperty('--gizmo-view', palette.gizmoView);
  root.setProperty('--gizmo-centre', palette.gizmoCentre);
  root.setProperty('--overlay-selected', palette.overlaySelected);
  root.setProperty('--overlay-hover', palette.overlayHover);
  root.setProperty('--overlay-active', palette.overlayActive);
}

export function applyWorkspaceTheme(id: WorkspaceThemeId): WorkspaceThemeId {
  const next = isWorkspaceThemeId(id) ? id : DEFAULT_WORKSPACE_THEME;
  activeThemeId = next;
  const theme = themeById(next);
  if (typeof document !== 'undefined') {
    document.documentElement.dataset.theme = next;
    applyCssVariables(theme.palette);
  }
  try {
    localStorage.setItem(THEME_STORAGE_KEY, next);
  } catch {
    /* ignore quota / missing storage */
  }
  for (const listener of themeListeners) listener();
  return next;
}
