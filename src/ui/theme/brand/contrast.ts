/**
 * src/ui/theme/brand/contrast.ts — accessibility gate for a generated theme.
 *
 * The formula is NOT ours. `culori.wcagContrast` implements WCAG 2.1 relative
 * luminance and the (L1+0.05)/(L2+0.05) ratio. Re-deriving that by hand is how
 * a theme ends up "passing" against a subtly wrong sRGB linearisation.
 *
 * ── What is ours: which pairs must pass, and what happens when they don't ───
 * A colour system fails accessibility at PAIRS, not at colours. This module
 * declares the pairings a SIOMAC theme must satisfy, marks the ones that block
 * publication, and — where the answer is mechanical — picks the foreground
 * rather than asking a human to guess.
 *
 * Thresholds are WCAG 2.1 AA:
 *   4.5  normal text
 *   3.0  large text, and non-text UI components / graphical objects (1.4.11) —
 *        which is the right bar for a focus indicator or a selected-row edge,
 *        not 4.5. Holding UI chrome to the text bar would reject themes that
 *        are genuinely accessible and push people to disable the check.
 */

import { wcagContrast, converter, formatHex } from 'culori';

/** One shared sRGB converter — parsing and converting in a single step. */
const toRgb = converter('rgb');

export const AA_TEXT = 4.5;
export const AA_LARGE_TEXT = 3;
export const AA_NON_TEXT = 3;

/** WCAG 2.1 contrast ratio, 1–21. Unparseable input returns 0 (never a pass). */
export function contrastRatio(a: string, b: string): number {
  try {
    const ratio = wcagContrast(flatten(a), flatten(b));
    return Number.isFinite(ratio) ? ratio : 0;
  } catch {
    return 0;
  }
}

/**
 * Composite a translucent colour over an opaque backdrop.
 *
 * WCAG contrast is undefined for a colour with alpha — several SIOMAC roles are
 * translucent by design (the focus ring, the selected-row wash). Measuring them
 * raw silently produces a meaningless ratio, so they are flattened against the
 * surface they actually sit on first.
 */
export function compositeOver(fg: string, bg: string): string {
  const f = toRgb(fg);
  const b = toRgb(bg);
  if (!f || !b) return fg;
  const a = f.alpha ?? 1;
  if (a >= 1) return formatHex(f);
  return formatHex({
    mode: 'rgb',
    r: f.r * a + b.r * (1 - a),
    g: f.g * a + b.g * (1 - a),
    b: f.b * a + b.b * (1 - a),
  });
}

/** Drop alpha so a ratio is at least well-defined for opaque comparisons. */
function flatten(c: string): string {
  const p = toRgb(c);
  return p ? formatHex({ ...p, alpha: 1 }) : c;
}

export interface ForegroundChoice {
  /** The chosen foreground. */
  color: string;
  ratio: number;
  /** True when even the better candidate misses the threshold. */
  compromised: boolean;
}

/**
 * Pick the readable foreground for a filled surface.
 *
 * Candidates default to white and near-black rather than pure black: pure black
 * on a mid-tone brand fill is harsher than the near-black the rest of the app
 * uses for text, and the ratio difference is negligible.
 */
export function pickForeground(
  background: string,
  candidates: readonly string[] = ['#FFFFFF', '#1F2A44'],
  threshold: number = AA_TEXT,
): ForegroundChoice {
  let best = { color: candidates[0] ?? '#FFFFFF', ratio: 0 };
  for (const c of candidates) {
    const ratio = contrastRatio(c, background);
    if (ratio > best.ratio) best = { color: c, ratio };
  }
  return { ...best, compromised: best.ratio < threshold };
}

export type PairingKind = 'text' | 'large-text' | 'non-text';

export interface PairingDef {
  id: string;
  label: string;
  /** Semantic role providing the foreground. */
  foreground: string;
  /** Semantic role providing the background it is measured against. */
  background: string;
  kind: PairingKind;
  /**
   * The opaque role the BACKGROUND composites onto, when the background is
   * itself translucent. Defaults to the page's card surface.
   *
   * This is not a nicety. The nav's active-row fill is `rgba(99,112,141,.3)`
   * over the dark rail; flattening it over white instead measured white-on-pale
   * at 1.48:1 and reported the app's own navigation as unpublishable. A
   * translucent colour has no contrast until you say what is behind it.
   */
  over?: string;
  /** A failing critical pairing blocks Apply/Publish. */
  critical: boolean;
  /** Why this pair matters — shown next to a failure, not just a number. */
  why: string;
}

/**
 * The pairings every generated theme is measured on.
 *
 * Deliberately short. Each entry is a place where a real user reads real text
 * or has to see a real boundary; a checklist of every possible combination
 * produces noise nobody reads and hides the six that matter.
 */
export const PAIRINGS: readonly PairingDef[] = [
  {
    id: 'action-primary', label: 'Primary action label',
    foreground: '--ui-color-action-primary-text', background: '--ui-color-action-primary',
    kind: 'text', critical: true,
    why: 'The main call to action on every page. Unreadable here means unreadable everywhere.',
  },
  {
    id: 'action-secondary', label: 'Secondary action label',
    foreground: '--ui-color-action-secondary-text', background: '--ui-color-action-secondary',
    kind: 'text', critical: true,
    why: 'Second-rank buttons, wizard step markers and selected segments all use this pair.',
  },
  {
    id: 'nav-text', label: 'Navigation item',
    foreground: '--ui-color-nav-text', background: '--ui-color-nav-background',
    kind: 'text', critical: true,
    why: 'The rail is on screen constantly; low-contrast nav labels are the most-reported theming defect.',
  },
  {
    id: 'nav-active', label: 'Active navigation item',
    foreground: '--ui-color-nav-active-text', background: '--ui-color-nav-active-background',
    over: '--ui-color-nav-background',
    kind: 'text', critical: true,
    why: 'The current page must be identifiable, not merely tinted.',
  },
  {
    id: 'nav-indicator', label: 'Active-item indicator against the rail',
    foreground: '--ui-color-nav-active-indicator', background: '--ui-color-nav-background',
    kind: 'non-text', critical: true,
    why: 'The bar marking the current page is a UI component (WCAG 1.4.11, 3:1). A brand hue often fails here unlightened — most saturated colours are darker than the rail.',
  },
  {
    id: 'link', label: 'Inline link on a card',
    foreground: '--ui-color-text-link', background: '--ui-color-surface-default',
    kind: 'text', critical: true,
    why: 'Links carry the brand hue, which is where a dark-on-dark or pale-on-white theme fails first.',
  },
  {
    id: 'selection', label: 'Text on a selected row',
    foreground: '--ui-color-text-primary', background: '--ui-color-selection-background',
    over: '--ui-color-surface-default',
    kind: 'text', critical: true,
    why: 'A selection wash that darkens too far makes the row it highlights unreadable.',
  },
  {
    id: 'focus', label: 'Focus indicator against its surface',
    foreground: '--ui-color-action-secondary', background: '--ui-color-surface-default',
    kind: 'non-text', critical: true,
    why: 'Keyboard users navigate by this outline. WCAG 1.4.11 sets the bar at 3:1 for non-text.',
  },
  {
    id: 'selection-edge', label: 'Selected-row edge against its surface',
    foreground: '--ui-color-selection-border', background: '--ui-color-surface-default',
    kind: 'non-text', critical: false,
    why: 'A soft indicator is a legitimate design choice; a warning is enough.',
  },
];

export function thresholdFor(kind: PairingKind): number {
  return kind === 'text' ? AA_TEXT : kind === 'large-text' ? AA_LARGE_TEXT : AA_NON_TEXT;
}

export interface PairingResult extends PairingDef {
  fgValue: string;
  bgValue: string;
  ratio: number;
  threshold: number;
  pass: boolean;
}

/**
 * Measure every pairing against a resolved token map.
 *
 * `resolve` is passed in rather than reading the DOM so the same check runs in
 * the panel (against the live draft) and in tests (against the CSS graph). A
 * role the map cannot resolve scores 0 and fails — an unmeasurable pairing is
 * not a passing one.
 */
export function evaluatePairings(resolve: (role: string) => string | null): PairingResult[] {
  return PAIRINGS.map(p => {
    const bgRaw = resolve(p.background) ?? '';
    const fgRaw = resolve(p.foreground) ?? '';
    // Flatten in the order the pixels actually stack: the background onto
    // whatever sits behind it, then the foreground onto that result. Several
    // roles are translucent, and a raw ratio against an rgba() value is
    // meaningless.
    const behind = (p.over ? resolve(p.over) : null) ?? '#FFFFFF';
    const bgValue = compositeOver(bgRaw, behind);
    const fgValue = compositeOver(fgRaw, bgValue);
    const ratio = fgRaw && bgRaw ? contrastRatio(fgValue, bgValue) : 0;
    const threshold = thresholdFor(p.kind);
    return { ...p, fgValue, bgValue, ratio, threshold, pass: ratio >= threshold };
  });
}

/** A theme may publish only when every critical pairing passes. */
export function publishBlocked(results: readonly PairingResult[]): PairingResult[] {
  return results.filter(r => r.critical && !r.pass);
}
