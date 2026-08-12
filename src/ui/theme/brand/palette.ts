/**
 * src/ui/theme/brand/palette.ts — logo → candidate brand colours.
 *
 * The clustering is NOT ours. `QuantizerCelebi` (Wu + weighted k-means in L*a*b*)
 * reduces the image to a weighted colour census, and `Score` ranks those
 * clusters the way Material's own "theme from wallpaper" feature does: it
 * discards colours too grey or too close to black/white to carry identity,
 * penalises hues that are perceptually adjacent to one already chosen, and
 * weights by area. Writing that by hand is exactly the "invent dominant-colour
 * clustering" trap — a naive most-frequent-pixel pass returns the logo's white
 * background every time.
 *
 * ── Why decoding is separated from extraction ───────────────────────────────
 * `extractSeeds` takes raw RGBA bytes and is pure, so it is testable without a
 * canvas and cannot depend on the DOM. `decodeImage` is the thin browser half
 * that turns a File or URL into those bytes. jsdom has no canvas; splitting
 * here is what lets the ranking logic be tested at all.
 */

import { QuantizerCelebi, Score, hexFromArgb } from '@material/material-color-utilities';

/** Longest edge the logo is scaled to before quantizing. */
export const SAMPLE_EDGE = 128;

/** Alpha below this is treated as "not part of the mark" and skipped. */
const ALPHA_FLOOR = 128;

export interface ExtractOptions {
  /** How many candidates to return. */
  max?: number;
}

/**
 * Rank the identity colours in an RGBA buffer, most brand-like first.
 *
 * Returns hex strings. An empty array means the image carried no colour worth
 * theming from (a pure greyscale or fully transparent mark) — the caller must
 * handle that rather than being handed a fabricated colour.
 */
export function extractSeeds(rgba: Uint8ClampedArray, opts: ExtractOptions = {}): string[] {
  const max = opts.max ?? 6;

  const pixels: number[] = [];
  for (let i = 0; i < rgba.length; i += 4) {
    const a = rgba[i + 3]!;
    // Transparent padding is most of a typical logo PNG. Counting it would let
    // the mark's *background* outvote the mark.
    if (a < ALPHA_FLOOR) continue;
    pixels.push((255 << 24) | (rgba[i]! << 16) | (rgba[i + 1]! << 8) | rgba[i + 2]!);
  }
  if (pixels.length === 0) return [];

  const census = QuantizerCelebi.quantize(pixels, 128);
  return Score.score(census, { desired: max, filter: true }).map(hexFromArgb);
}

/**
 * Decode an image source to RGBA bytes, scaled down to `SAMPLE_EDGE`.
 *
 * Browser-only (canvas). Scaling first is not just speed: it averages away
 * anti-aliasing fringes and JPEG artefacts that would otherwise show up as
 * their own clusters.
 */
export async function decodeImage(src: Blob | string): Promise<Uint8ClampedArray> {
  const url = typeof src === 'string' ? src : URL.createObjectURL(src);
  try {
    const img = await loadImage(url);
    const scale = Math.min(1, SAMPLE_EDGE / Math.max(img.width, img.height));
    const w = Math.max(1, Math.round(img.width * scale));
    const h = Math.max(1, Math.round(img.height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('Canvas 2D is unavailable in this browser.');
    ctx.drawImage(img, 0, 0, w, h);
    return ctx.getImageData(0, 0, w, h).data;
  } finally {
    if (typeof src !== 'string') URL.revokeObjectURL(url);
  }
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const img = new Image();
    // A logo served from Supabase storage is cross-origin; without this the
    // canvas is tainted and getImageData throws a SecurityError instead of
    // returning pixels.
    img.crossOrigin = 'anonymous';
    img.onload = () => res(img);
    img.onerror = () => rej(new Error('Could not load that image.'));
    img.src = url;
  });
}

/** Read a File as a data URL — the shape the existing logo-upload API takes. */
export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => {
      // `result` is string | ArrayBuffer | null; readAsDataURL always yields a
      // string, but coercing blindly would stringify an ArrayBuffer to
      // "[object ArrayBuffer]" and hand it on as if it were a data URL.
      if (typeof fr.result === 'string') res(fr.result);
      else rej(new Error('Could not read that file.'));
    };
    fr.onerror = () => rej(new Error('Could not read that file.'));
    fr.readAsDataURL(file);
  });
}
