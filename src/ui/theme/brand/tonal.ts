/**
 * src/ui/theme/brand/tonal.ts — seed colour → tonal scale.
 *
 * The maths is NOT ours. Tonal scales are generated with Google's
 * `@material/material-color-utilities`, which builds the ramp in HCT — a space
 * whose L* axis is perceptually uniform, so every step is an equal perceived
 * lightness change and the hue does not drift as the colour darkens. Hand-rolled
 * "mix with white / mix with black" ramps look fine on blue and fall apart on
 * yellow and red, which is exactly the case a customer logo will hit.
 *
 * ── Step 500 is the SEED, not a fixed tone ──────────────────────────────────
 * The ramp is two straight lines in tone-space, hinged at step 500:
 *
 *     step  50 → tone 95   (near white, fixed)
 *     step 500 → the SEED's own tone
 *     step 950 → tone  5   (near black, fixed)
 *
 * The obvious version — `tone = 100 − step/10`, so 500 is always tone 50 — is
 * what shipped first, and it was wrong in a way that only showed on real
 * brands. SIOMAC red `#E40C0C` is tone 48 and carries white text at 4.82:1.
 * Normalising it to tone 50 LIGHTENED it to `#ec1712` = 4.47:1, a hair under
 * AA, at which point the accessibility search stepped the fill a whole stop
 * darker to `#c00004`. An accessible brand colour was lightened into failure
 * and then over-corrected into a maroon button. Anchoring on the seed means
 * a customer's colour comes back as their colour.
 *
 * With an anchor of exactly 50 this reduces to the old linear ramp, so the
 * change is a strict generalisation rather than a different scheme. The anchor
 * is clamped to 30…70 so a near-white or near-black logo still yields a ramp
 * with usable light and dark ends.
 *
 * Step 600 is the hover — one step darker, the direction every hover in the app
 * already moves.
 */

import { TonalPalette, argbFromHex, hexFromArgb, Hct } from '@material/material-color-utilities';

/** The scale steps, light → dark. */
export const TONAL_STEPS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950] as const;
export type TonalStep = typeof TONAL_STEPS[number];

/** The step the semantic mapping treats as the brand colour, and its hover. */
export const BRAND_STEP = 500;
export const BRAND_HOVER_STEP = 600;

export type TonalScale = Record<TonalStep, string>;

/** Fixed ends of the ramp. Only the hinge at step 500 moves. */
const LIGHT_END_TONE = 95;
const DARK_END_TONE  = 5;

/** A seed lighter/darker than this still has to produce a usable full ramp. */
export const ANCHOR_MIN_TONE = 30;
export const ANCHOR_MAX_TONE = 70;

export function clampAnchor(tone: number): number {
  return Math.min(ANCHOR_MAX_TONE, Math.max(ANCHOR_MIN_TONE, tone));
}

/**
 * HCT tone for a scale step, hinged at the anchor. See the module comment.
 * `anchor = 50` reproduces the plain `100 − step/10` ramp exactly.
 */
export function toneForStep(step: TonalStep, anchor = 50): number {
  if (step === BRAND_STEP) return anchor;
  if (step < BRAND_STEP) {
    const t = (step - TONAL_STEPS[0]) / (BRAND_STEP - TONAL_STEPS[0]);
    return LIGHT_END_TONE + t * (anchor - LIGHT_END_TONE);
  }
  const last = TONAL_STEPS[TONAL_STEPS.length - 1]!;
  const t = (step - BRAND_STEP) / (last - BRAND_STEP);
  return anchor + t * (DARK_END_TONE - anchor);
}

/**
 * Build the eleven-step scale for a seed colour.
 *
 * Hue and chroma come from the seed; tone moves along the hinged ramp, so step
 * 500 IS the seed (to within HCT's gamut mapping) rather than a normalised
 * stand-in for it.
 */
export function tonalScale(seedHex: string): TonalScale {
  const seed = Hct.fromInt(argbFromHex(seedHex));
  const anchor = clampAnchor(seed.tone);
  const palette = TonalPalette.fromInt(argbFromHex(seedHex));
  const out = {} as TonalScale;
  for (const step of TONAL_STEPS) out[step] = hexFromArgb(palette.tone(toneForStep(step, anchor)));
  return out;
}

/** The seed's own HCT tone — how light or dark the customer's colour already is. */
export function toneOf(hex: string): number {
  return Hct.fromInt(argbFromHex(hex)).tone;
}

/** The seed's HCT chroma — how saturated it is. Near-zero means grey. */
export function chromaOf(hex: string): number {
  return Hct.fromInt(argbFromHex(hex)).chroma;
}

/** The seed's HCT hue in degrees. */
export function hueOf(hex: string): number {
  return Hct.fromInt(argbFromHex(hex)).hue;
}

/**
 * The same colour at a different lightness — hue and chroma held.
 *
 * This is the move the whole brand policy is built on: when a brand colour
 * cannot carry a label or clear 3:1 against the rail, it is nudged along ITS
 * OWN tone axis rather than replaced by a step from a generated ramp. HCT gamut-
 * maps the result, so an out-of-gamut request comes back as the closest
 * printable colour instead of clipping to something off-hue.
 */
export function toneAdjusted(hex: string, tone: number): string {
  const c = Hct.fromInt(argbFromHex(hex));
  return hexFromArgb(Hct.from(c.hue, c.chroma, Math.min(100, Math.max(0, tone))).toInt());
}

/**
 * Emit a scale as `--ui-brand-<role>-<step>` custom properties.
 *
 * These are published alongside the semantic tokens so the generated family is
 * inspectable in devtools and reusable by later work (charts, illustrations)
 * without re-running the generator. Components never read them directly — they
 * read semantic roles, which is the whole point of the layer.
 */
export function scaleToTokens(role: 'primary' | 'accent', scale: TonalScale): Record<string, string> {
  const out: Record<string, string> = {};
  for (const step of TONAL_STEPS) out[`--ui-brand-${role}-${step}`] = scale[step];
  return out;
}
