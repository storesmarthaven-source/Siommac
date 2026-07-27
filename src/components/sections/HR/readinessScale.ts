/**
 * src/components/sections/HR/readinessScale.ts
 *
 * One percentage-derived colour for a readiness bar.
 *
 * The bar must NOT paint the whole red→amber→green ramp inside every track — that renders a
 * 10%-ready record with a green tail and reads as partly complete. Instead the percentage picks
 * a single point on the ramp, and the fill uses that one colour with a subtle tonal gradient
 * (a lighter tint over the base) purely for depth. The unfilled track stays neutral grey.
 */

export interface Rgb { r: number; g: number; b: number }

/** The red → amber → green readiness ramp. */
const READINESS_STOPS: readonly { at: number; rgb: Rgb }[] = [
  { at: 0, rgb: { r: 0xdc, g: 0x26, b: 0x26 } },   // red
  { at: 33, rgb: { r: 0xea, g: 0x58, b: 0x0c } },  // red-orange
  { at: 67, rgb: { r: 0xf5, g: 0x9e, b: 0x0b } },  // amber
  { at: 85, rgb: { r: 0xa3, g: 0xc7, b: 0x14 } },  // yellow-green
  { at: 100, rgb: { r: 0x16, g: 0xa3, b: 0x4a } }, // green
];

function clampPercent(percent: number): number {
  if (!Number.isFinite(percent)) return 0;
  return Math.min(100, Math.max(0, percent));
}

function mix(from: Rgb, to: Rgb, t: number): Rgb {
  return {
    r: Math.round(from.r + (to.r - from.r) * t),
    g: Math.round(from.g + (to.g - from.g) * t),
    b: Math.round(from.b + (to.b - from.b) * t),
  };
}

function hex({ r, g, b }: Rgb): string {
  return `#${[r, g, b].map(channel => channel.toString(16).padStart(2, '0')).join('')}`;
}

/** Lift a colour towards white — the top of the fill's tonal gradient. */
function tint(rgb: Rgb, amount: number): Rgb {
  return mix(rgb, { r: 255, g: 255, b: 255 }, amount);
}

/** The single blended ramp colour for a readiness percentage. */
export function readinessRgb(percent: number): Rgb {
  const value = clampPercent(percent);
  const first = READINESS_STOPS[0]!;
  for (let i = 1; i < READINESS_STOPS.length; i++) {
    const prev = READINESS_STOPS[i - 1]!;
    const next = READINESS_STOPS[i]!;
    if (value <= next.at) {
      const span = next.at - prev.at;
      return span === 0 ? next.rgb : mix(prev.rgb, next.rgb, (value - prev.at) / span);
    }
  }
  return READINESS_STOPS[READINESS_STOPS.length - 1]?.rgb ?? first.rgb;
}

/** `#rrggbb` for a readiness percentage — the bar's base colour. */
export function readinessColor(percent: number): string {
  return hex(readinessRgb(percent));
}

/** Inline style for the readiness fill: one percentage-derived colour, a subtle tonal
 *  gradient for depth, and the width the fill should occupy. */
export function readinessFillStyle(percent: number): string {
  const value = clampPercent(percent);
  const base = readinessRgb(value);
  return `width:${value}%;background:linear-gradient(180deg, ${hex(tint(base, 0.22))} 0%, ${hex(base)} 55%, ${hex(mix(base, { r: 0, g: 0, b: 0 }, 0.06))} 100%)`;
}
