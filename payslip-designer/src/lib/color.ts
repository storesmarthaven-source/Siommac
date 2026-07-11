/** Pure colour maths for the picker. Values: hex (#rgb/#rgba/#rrggbb/#rrggbbaa) or 'transparent'. */

import { clamp } from './geometry';

export interface RGBA {
  r: number;
  g: number;
  b: number;
  a: number;
}

export interface HSV {
  h: number; // 0..360
  s: number; // 0..1
  v: number; // 0..1
}

const TRANSPARENT = 'transparent';

export function parseColor(input: string | undefined | null): RGBA | null {
  if (!input || input === TRANSPARENT) return { r: 255, g: 255, b: 255, a: 0 };
  let hex = input.trim().replace('#', '');
  if (/^[0-9a-f]{3}$/i.test(hex) || /^[0-9a-f]{4}$/i.test(hex)) {
    hex = hex
      .split('')
      .map((c) => c + c)
      .join('');
  }
  if (!/^[0-9a-f]{6}([0-9a-f]{2})?$/i.test(hex)) return null;
  return {
    r: parseInt(hex.slice(0, 2), 16),
    g: parseInt(hex.slice(2, 4), 16),
    b: parseInt(hex.slice(4, 6), 16),
    a: hex.length >= 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1,
  };
}

export function isTransparent(input: string | undefined | null): boolean {
  if (!input || input === TRANSPARENT) return true;
  const c = parseColor(input);
  return !!c && c.a === 0;
}

const hh = (n: number): string => clamp(Math.round(n), 0, 255).toString(16).padStart(2, '0');

export function rgbaToHex({ r, g, b, a }: RGBA, withAlpha: boolean): string {
  let out = '#' + hh(r) + hh(g) + hh(b);
  if (withAlpha && a < 1) out += hh(a * 255);
  return out;
}

export function rgbToHsv(r: number, g: number, b: number): HSV {
  const rr = r / 255;
  const gg = g / 255;
  const bb = b / 255;
  const max = Math.max(rr, gg, bb);
  const min = Math.min(rr, gg, bb);
  const d = max - min;
  let h = 0;
  if (d) {
    if (max === rr) h = ((gg - bb) / d) % 6;
    else if (max === gg) h = (bb - rr) / d + 2;
    else h = (rr - gg) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: max ? d / max : 0, v: max };
}

export function hsvToRgb(h: number, s: number, v: number): RGBA {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  let r = 0;
  let g = 0;
  let b = 0;
  if (h < 60) [r, g] = [c, x];
  else if (h < 120) [r, g] = [x, c];
  else if (h < 180) [g, b] = [c, x];
  else if (h < 240) [g, b] = [x, c];
  else if (h < 300) [r, b] = [x, c];
  else [r, b] = [c, x];
  return { r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255, a: 1 };
}

export const CSS_EYE_DROPPER_SUPPORTED = typeof (globalThis as { EyeDropper?: unknown }).EyeDropper !== 'undefined';
