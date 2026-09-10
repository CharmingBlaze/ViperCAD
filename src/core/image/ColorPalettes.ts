export type ColorPaletteGroup =
  | 'Pixel'
  | 'Nintendo'
  | 'Sega'
  | 'Sony'
  | 'Computer'
  | 'Arcade'
  | 'Custom';

export type ColorPalette = {
  id: string;
  name: string;
  group: ColorPaletteGroup;
  colors: string[];
  custom?: boolean;
};

function sms64(): string[] {
  const steps = [0x00, 0x55, 0xaa, 0xff];
  const colors: string[] = [];
  for (const r of steps) for (const g of steps) for (const b of steps) {
    colors.push(`#${[r, g, b].map((n) => n.toString(16).padStart(2, '0')).join('')}`);
  }
  return colors;
}

export const BUILTIN_PALETTES: ColorPalette[] = [
  {
    id: 'pico8',
    name: 'PICO-8',
    group: 'Pixel',
    colors: [
      '#000000', '#1d2b53', '#7e2553', '#008751', '#ab5236', '#5f574f', '#c2c3c7', '#fff1e8',
      '#ff004d', '#ffa300', '#ffec27', '#00e436', '#29adff', '#83769c', '#ff77a8', '#ffccaa',
    ],
  },
  {
    id: 'sweetie16',
    name: 'Sweetie 16',
    group: 'Pixel',
    colors: [
      '#1a1c2c', '#5d275d', '#b13e53', '#ef7d57', '#ffcd75', '#a7f070', '#38b764', '#257179',
      '#29366f', '#3b5dc9', '#41a6f6', '#73eff7', '#f4f4f4', '#94b0c2', '#566c86', '#333c57',
    ],
  },
  {
    id: 'db16',
    name: 'DawnBringer 16',
    group: 'Pixel',
    colors: [
      '#140c1c', '#442434', '#30346d', '#4e4a4e', '#854c30', '#346524', '#d04648', '#757161',
      '#597dce', '#d27d2c', '#8595a1', '#6daa2c', '#d2aa99', '#6dc2ca', '#dad45e', '#deeed6',
    ],
  },
  {
    id: 'db32',
    name: 'DawnBringer 32',
    group: 'Pixel',
    colors: [
      '#000000', '#222034', '#45283c', '#663931', '#8f563b', '#df7126', '#d9a066', '#eec39a',
      '#fbf236', '#99e550', '#6abe30', '#37946e', '#4b692f', '#524b24', '#323c39', '#3f3f74',
      '#306082', '#5b6ee1', '#639bff', '#5fcde4', '#cbdbfc', '#ffffff', '#9badb7', '#847e87',
      '#696a6a', '#595652', '#76428a', '#ac3232', '#d95763', '#d77bba', '#8f974a', '#8a6f30',
    ],
  },
  {
    id: 'endesga32',
    name: 'Endesga 32',
    group: 'Pixel',
    colors: [
      '#be4a2f', '#d77643', '#ead4aa', '#e4a672', '#b86f50', '#733e39', '#3e2731', '#a22633',
      '#e43b44', '#f77622', '#feae34', '#fee761', '#63c74d', '#3e8948', '#265c42', '#193c3e',
      '#124e89', '#0099db', '#2ce8f5', '#ffffff', '#c0cbdc', '#8b9bb4', '#5a6988', '#3a4466',
      '#262b44', '#181425', '#ff0044', '#68386c', '#b55088', '#f6757a', '#e8b796', '#c28569',
    ],
  },
  {
    id: 'modern12',
    name: 'Modern 12',
    group: 'Pixel',
    colors: ['#1d1f21', '#f5f5f5', '#e64b45', '#f2a43a', '#f4d35e', '#62c370', '#42a5f5', '#8267c9', '#e76f9f', '#8d5a3b', '#607d8b', '#35c7be'],
  },
  {
    id: 'mono',
    name: '1-bit',
    group: 'Pixel',
    colors: ['#000000', '#ffffff'],
  },
  {
    id: 'gameboy',
    name: 'Game Boy',
    group: 'Nintendo',
    colors: ['#0f380f', '#306230', '#8bac0f', '#9bbc0f'],
  },
  {
    id: 'gameboy-pocket',
    name: 'Game Boy Pocket',
    group: 'Nintendo',
    colors: ['#0c380c', '#306230', '#8bac0f', '#9bbc0f'],
  },
  {
    id: 'virtualboy',
    name: 'Virtual Boy',
    group: 'Nintendo',
    colors: ['#000000', '#550000', '#aa0000', '#ff0000'],
  },
  {
    id: 'nes',
    name: 'NES',
    group: 'Nintendo',
    colors: [
      '#7c7c7c', '#0000fc', '#0000bc', '#4428bc', '#940084', '#a80020', '#a81000', '#881400',
      '#503000', '#007800', '#006800', '#005800', '#004058', '#000000', '#bcbcbc', '#0078f8',
      '#0058f8', '#6844fc', '#d800cc', '#e40058', '#f83800', '#e45c10', '#ac7c00', '#00b800',
      '#00a800', '#00a844', '#008888', '#f8f8f8', '#3cbcfc', '#6888fc', '#9878f8', '#f878f8',
      '#f85898', '#f87858', '#fca044', '#f8b800', '#b8f818', '#58d854', '#58f898', '#00e8d8',
      '#787878', '#fcfcfc', '#a4e4fc', '#b8b8f8', '#d8b8f8', '#f8b8f8', '#f8a4c0', '#f0d0b0',
      '#fce0a8', '#f8d878', '#d8f878', '#b8f8b8', '#b8f8d8', '#00fcfc', '#f8d8f8',
    ],
  },
  {
    id: 'snes',
    name: 'SNES / Super Famicom',
    group: 'Nintendo',
    colors: [
      '#1b1b2a', '#3e3546', '#6d5a4e', '#c4a484', '#f6e8c3', '#8fbc8f', '#2e8b57', '#1a535c',
      '#2b6cb0', '#63b3ed', '#f6ad55', '#dd6b20', '#c53030', '#9b2c2c', '#805ad5', '#ffffff',
    ],
  },
  {
    id: 'gba',
    name: 'Game Boy Advance',
    group: 'Nintendo',
    colors: [
      '#181818', '#3c3c50', '#687080', '#b0b8b8', '#f8f8f8', '#f8c0a8', '#e07050', '#a83030',
      '#f8e070', '#88c070', '#289060', '#206070', '#48a0d8', '#2860b0', '#803090', '#d060a0',
    ],
  },
  {
    id: 'n64',
    name: 'Nintendo 64',
    group: 'Nintendo',
    colors: [
      '#101820', '#203040', '#3a5f7a', '#78c8e8', '#f0f0e8', '#e0a848', '#c04020', '#702018',
      '#388040', '#80c050', '#a8d8f0', '#4060b0', '#903090', '#d070a8', '#705040', '#c0a080',
    ],
  },
  {
    id: 'mastersystem',
    name: 'Master System',
    group: 'Sega',
    colors: sms64(),
  },
  {
    id: 'genesis',
    name: 'Mega Drive / Genesis',
    group: 'Sega',
    colors: [
      '#000000', '#0000aa', '#0020ee', '#2040ee', '#006000', '#00aa00', '#20ee20', '#60ee60',
      '#600000', '#aa0000', '#ee2020', '#ee6060', '#604000', '#aa6000', '#eeaa20', '#eeee60',
      '#0060aa', '#20aaee', '#60eeee', '#eeeeee', '#404040', '#808080', '#aa00aa', '#ee20ee',
      '#200040', '#600080', '#aa2060', '#ee60aa', '#204000', '#408000', '#80aa20', '#c0ee80',
    ],
  },
  {
    id: 'dreamcast',
    name: 'Dreamcast',
    group: 'Sega',
    colors: [
      '#1a1a1a', '#4a4a4a', '#8a8a8a', '#dcdcdc', '#ffffff', '#e85d04', '#f48c06', '#ffba08',
      '#2a9d8f', '#264653', '#3a86ff', '#8338ec', '#ff006e', '#8d0801', '#6c584c', '#a98467',
    ],
  },
  {
    id: 'ps1',
    name: 'PlayStation',
    group: 'Sony',
    colors: [
      '#0b0b0f', '#222233', '#445566', '#8899aa', '#ddeeff', '#1144aa', '#2288ee', '#55ccee',
      '#228833', '#66cc44', '#eeee55', '#ee8822', '#cc2222', '#aa2266', '#6622aa', '#ffffff',
    ],
  },
  {
    id: 'psp',
    name: 'PlayStation Portable',
    group: 'Sony',
    colors: [
      '#101018', '#2a2a38', '#4c5160', '#8b93a0', '#d8dde4', '#1b4f72', '#2e86ab', '#a3d5ff',
      '#1e8449', '#58d68d', '#f4d03f', '#e67e22', '#c0392b', '#af7ac5', '#7d3c98', '#fdfefe',
    ],
  },
  {
    id: 'cga',
    name: 'CGA',
    group: 'Computer',
    colors: [
      '#000000', '#0000aa', '#00aa00', '#00aaaa', '#aa0000', '#aa00aa', '#aa5500', '#aaaaaa',
      '#555555', '#5555ff', '#55ff55', '#55ffff', '#ff5555', '#ff55ff', '#ffff55', '#ffffff',
    ],
  },
  {
    id: 'ega',
    name: 'EGA',
    group: 'Computer',
    colors: [
      '#000000', '#0000aa', '#00aa00', '#00aaaa', '#aa0000', '#aa00aa', '#aaaa00', '#aaaaaa',
      '#555555', '#5555ff', '#55ff55', '#55ffff', '#ff5555', '#ff55ff', '#ffff55', '#ffffff',
    ],
  },
  {
    id: 'vga16',
    name: 'VGA 16',
    group: 'Computer',
    colors: [
      '#000000', '#000080', '#008000', '#008080', '#800000', '#800080', '#808000', '#c0c0c0',
      '#808080', '#0000ff', '#00ff00', '#00ffff', '#ff0000', '#ff00ff', '#ffff00', '#ffffff',
    ],
  },
  {
    id: 'c64',
    name: 'Commodore 64',
    group: 'Computer',
    colors: [
      '#000000', '#ffffff', '#813338', '#75cec8', '#8e3c97', '#56ac4d', '#2e2c9b', '#edf171',
      '#8e5029', '#553800', '#c46c71', '#4a4a4a', '#7b7b7b', '#a9ff9f', '#706deb', '#b2b2b2',
    ],
  },
  {
    id: 'vic20',
    name: 'VIC-20',
    group: 'Computer',
    colors: [
      '#000000', '#ffffff', '#782922', '#87d6dd', '#aa5fb6', '#55a049', '#40318d', '#bfce72',
      '#aa7449', '#eab489', '#b86962', '#c7ffff', '#ea9ff6', '#94e089', '#8071cc', '#ffffb2',
    ],
  },
  {
    id: 'zx',
    name: 'ZX Spectrum',
    group: 'Computer',
    colors: [
      '#000000', '#0000d7', '#d70000', '#d700d7', '#00d700', '#00d7d7', '#d7d700', '#d7d7d7',
      '#0000ff', '#ff0000', '#ff00ff', '#00ff00', '#00ffff', '#ffff00', '#ffffff',
    ],
  },
  {
    id: 'msx',
    name: 'MSX',
    group: 'Computer',
    colors: [
      '#000000', '#3eb849', '#74d07d', '#5955e0', '#8076f1', '#b95e51', '#65dbef', '#db6559',
      '#ff897d', '#ccc35e', '#ded087', '#3aa241', '#b766b5', '#cccccc', '#ffffff',
    ],
  },
  {
    id: 'cpc',
    name: 'Amstrad CPC',
    group: 'Computer',
    colors: [
      '#000000', '#000080', '#0000ff', '#800000', '#800080', '#8000ff', '#ff0000', '#ff0080', '#ff00ff',
      '#008000', '#008080', '#0080ff', '#808000', '#808080', '#8080ff', '#ff8000', '#ff8080', '#ff80ff',
      '#00ff00', '#00ff80', '#00ffff', '#80ff00', '#80ff80', '#80ffff', '#ffff00', '#ffff80', '#ffffff',
    ],
  },
  {
    id: 'apple2',
    name: 'Apple II',
    group: 'Computer',
    colors: [
      '#000000', '#772807', '#4c34b6', '#e434fe', '#0d730c', '#808080', '#2cb1d3', '#b0c7ff',
      '#4f4400', '#e35d12', '#808080', '#e39ff5', '#1bcb01', '#aee10d', '#5ef8f4', '#ffffff',
    ],
  },
  {
    id: 'amiga',
    name: 'Amiga Workbench',
    group: 'Computer',
    colors: ['#0055aa', '#ffffff', '#000000', '#ff8800', '#000000', '#ffffff', '#55aaff', '#ffcc00'],
  },
  {
    id: 'mac16',
    name: 'Macintosh System 16',
    group: 'Computer',
    colors: [
      '#ffffff', '#ffff00', '#ff6600', '#dd0000', '#ff0099', '#330099', '#0000cc', '#0099ff',
      '#00aa00', '#006600', '#663300', '#996633', '#bbbbbb', '#888888', '#444444', '#000000',
    ],
  },
  {
    id: 'atari2600',
    name: 'Atari 2600',
    group: 'Arcade',
    colors: [
      '#000000', '#404040', '#6c6c6c', '#909090', '#b0b0b0', '#c8c8c8', '#dcdcdc', '#ececec',
      '#444400', '#646410', '#848424', '#a0a034', '#b8b840', '#d0d050', '#e8e85c', '#fcfc68',
      '#702800', '#844414', '#985c28', '#ac783c', '#bc8c4c', '#cca05c', '#dcb468', '#ecc878',
      '#841800', '#983418', '#ac5030', '#c06c48', '#d0805c', '#e09470', '#eca880', '#fcbc94',
    ],
  },
  {
    id: 'neogeo',
    name: 'Neo Geo',
    group: 'Arcade',
    colors: [
      '#080808', '#202020', '#484848', '#787878', '#b0b0b0', '#e8e8e8', '#f8f8f8', '#f8d020',
      '#f86018', '#c01818', '#681010', '#183878', '#2070c8', '#38b8f0', '#20a048', '#80e040',
    ],
  },
];

const PALETTE_MAP = new Map(BUILTIN_PALETTES.map((palette) => [palette.id, palette]));

export function listPalettes(custom: ColorPalette[] = []): ColorPalette[] {
  return [...BUILTIN_PALETTES, ...custom.filter((palette) => palette.custom)];
}

export function findPalette(id: string, custom: ColorPalette[] = []): ColorPalette {
  return custom.find((palette) => palette.id === id) ?? PALETTE_MAP.get(id) ?? BUILTIN_PALETTES[0]!;
}

export function paletteGroups(custom: ColorPalette[] = []): ColorPaletteGroup[] {
  const seen = new Set<ColorPaletteGroup>();
  for (const palette of listPalettes(custom)) seen.add(palette.group);
  return [...seen];
}

export function createCustomPalette(name: string, colors: string[]): ColorPalette {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'custom';
  return {
    id: `custom-${slug}-${Date.now().toString(36)}`,
    name,
    group: 'Custom',
    colors: colors.length ? [...colors] : ['#000000', '#ffffff'],
    custom: true,
  };
}

export function clampPaletteColor(hex: string): string | null {
  const match = hex.trim().toLowerCase().match(/^#?([0-9a-f]{6})$/);
  return match ? `#${match[1]}` : null;
}
