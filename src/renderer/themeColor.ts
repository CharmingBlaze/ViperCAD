import { Color } from 'three';
import { parseHexColor } from '@/app/theme/themeTokens';

/** Write an sRGB theme hex onto a Three.js colour without sharing objects. */
export function applyThemeHex(color: Color, hex: string): void {
  color.setHex(parseHexColor(hex));
}
