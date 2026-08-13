/**
 * src/ui/theme/brand/brandTheme.ts — seeds → SEMANTIC MAPPING.
 *
 * This is the part SIOMAC owns. The clustering (palette.ts), the tonal maths
 * (tonal.ts) and the contrast formula (contrast.ts) come from maintained
 * libraries; what no library can decide is which generated tone plays which
 * ROLE in this product. Material's own schemes answer that question for a
 * Material app — SIOMAC is not one, so the answer is here.
 *
 * ── THE POLICY: neutral enterprise shell, controlled brand accents ──────────
 *
 * The brand appears in primary actions, links, focus, selection and the active
 * navigation indicator. It does NOT appear in surfaces. Menus, dialogs, cards,
 * inputs, tables, the page and the navigation rail stay neutral no matter what
 * colour the logo is, because they are the frame, not the message.
 *
 * The first version of this file did the opposite, and the result is worth
 * recording. It derived a full tonal ramp from the seed and then reached for
 * progressively darker steps whenever it needed a "strong" colour — accent 700
 * for secondary buttons, accent 900 for the rail. For a red logo that produced:
 *
 *     secondary button / segmented control / tab badge   #930002
 *     navigation rail                                    #410000
 *
 * — an application painted in progressively darker versions of the logo. Every
 * one of those values passed the contrast gate, which is the lesson: contrast
 * is a floor, not a design. The rules below are the ceiling.
 *
 * ── What the engine WRITES ─────────────────────────────────────────────────
 *     action-primary / -hover / -text     the brand, as itself
 *     text-link                           brand, darkened only if it must be
 *     focus-ring                          brand at low alpha
 *     selection-background / -border      pale brand tint + brand edge
 *     nav-active-background / -text       a SUBTLE brand wash on the rail
 *     nav-active-indicator                the brand, lightened to clear 3:1
 *
 * ── What the engine deliberately LEAVES ALONE ──────────────────────────────
 *     every surface, every border, every text role, every status colour
 *     nav-background and nav-text — the shell stays the app's neutral dark
 *     action-secondary — a secondary button is a NEUTRAL, not a dark brand fill
 *
 * Leaving a role alone is a real decision, not an omission: it means the
 * semantic default stands, and the semantic default is the approved design.
 *
 * ── ⛔ THE MAPPING CONTRACT — FROZEN (user-approved, 2026-08-11) ────────────
 *
 * This list is not a summary of the implementation; it is the specification the
 * implementation must keep satisfying. Changing it is a product decision, not a
 * refactor.
 *
 *   Brand MAY control          primary action · primary hover · links · focus ·
 *                              selection accent and tint · nav ACTIVE indicator ·
 *                              a genuinely distinct optional accent
 *
 *   Brand may NOT control      page surfaces · cards · dialogs · menus and
 *                              popovers · inputs · table surfaces · secondary
 *                              neutral actions · the nav shell background ·
 *                              success / warning / danger / info
 *
 * Two guards make that permanent and must not be softened:
 *   `assertNoLockedRoles`  — the `brandDriven: false` roles (status colours,
 *                            neutral surfaces, body text)
 *   `assertNoNeutralRoles` — `NEUTRAL_BY_POLICY`: roles a theme *could* set but
 *                            this product keeps neutral
 *
 * ⭐ And the lesson underneath all of it: PASSING WCAG DOES NOT MAKE A COLOUR
 * APPROPRIATE. `#ff4a39` nav labels cleared AA comfortably on a charcoal rail
 * and were still fluorescent red navigation in an enterprise ERP. `#930002`
 * dropdowns and a `#410000` sidebar passed every check that existed. Contrast is
 * a floor the generator must clear; it is not evidence that the result is good.
 *
 * ── Storage ────────────────────────────────────────────────────────────────
 * Seeds persist as `--ui-brand-seed-*`, so a published theme reconstructs from
 * what is already stored. Logos are not re-stored here — the app has exactly
 * one branding slot (`settings.companyLogoUrl`) and the panel writes to that.
 */

import { formatRgb, parse } from 'culori';
import { tonalScale, scaleToTokens, toneOf, chromaOf, hueOf, toneAdjusted, type TonalScale } from './tonal';
import { pickForeground, contrastRatio, compositeOver, AA_TEXT, AA_NON_TEXT } from './contrast';
import { BRAND_LOCKED_ROLES } from '../semanticTokens';

export const BRAND_THEME_VERSION = 1;

export interface BrandSeeds {
  /** The brand colour. Drives primary actions and, alone, everything else. */
  primary: string;
  /**
   * A genuinely DIFFERENT second brand colour, when the logo has one.
   *
   * Optional on purpose. The previous version always produced an accent, and
   * for a monochromatic logo that meant inventing one by darkening the primary —
   * which is how "red + more red" became "red and dark maroon". If the logo
   * offers no second hue, this stays undefined and the primary carries the
   * accent roles.
   */
  accent?: string;
}

export interface BrandTheme {
  version: typeof BRAND_THEME_VERSION;
  seeds: BrandSeeds;
  /** Provenance — which logo the seeds came from, and what else was offered. */
  source?: { logoUrl?: string; extracted?: string[] };
}

export const SEED_PRIMARY_TOKEN = '--ui-brand-seed-primary';
export const SEED_ACCENT_TOKEN  = '--ui-brand-seed-accent';

/** The surface links and page-level brand colours are judged against. */
const LIGHT_SURFACE = '#FFFFFF';

/**
 * The neutral dark the shell is built from.
 *
 * The engine does not write `--ui-color-nav-background`; this is the value it
 * ASSUMES when computing what will be legible on the rail. Keeping the two in
 * step matters, so it reads as the same navy the semantic default declares. If
 * an operator hand-edits the rail in Foundations, the panel's live contrast
 * check still measures the real drafted value.
 */
const SHELL_DARK = '#1b2d54';

/** How far the active-nav wash tints the rail. Subtle by design. */
const NAV_ACTIVE_TINT_ALPHA = 0.20;
/** The focus halo's alpha, paired with the opaque outline the recipes draw. */
const FOCUS_RING_ALPHA = 0.16;
/** How much darker `primary-hover` sits than `primary`, in HCT tone. */
const HOVER_TONE_STEP = 8;

/**
 * Minimum hue separation before a second extracted colour counts as an ACCENT.
 *
 * Below this the two colours read as the same brand, and promoting the second
 * to "accent" produces a distinction the user never asked for. 25° is roughly
 * the point where two hues stop being describable by the same colour word.
 */
export const ACCENT_MIN_HUE_DELTA = 25;
/** An accent also has to be a colour, not a near-grey. */
export const ACCENT_MIN_CHROMA = 12;

export interface BrandThemeBuild {
  theme: BrandTheme;
  primaryScale: TonalScale;
  /** Present only when the logo offered a genuinely distinct second colour. */
  accentScale?: TonalScale;
  /** The complete override map: brand scales + the semantic roles above. */
  tokens: Record<string, string>;
  /** Roles whose generated value could not reach its threshold — surfaced. */
  compromised: string[];
  /** How far each brand colour had to move from the seed to become accessible. */
  movement: { role: string; from: string; to: string; toneDelta: number }[];
}

/**
 * Is `accent` a real second brand colour, or just another shade of `primary`?
 */
export function isDistinctAccent(primary: string, accent: string | undefined): accent is string {
  if (!accent) return false;
  if (chromaOf(accent) < ACCENT_MIN_CHROMA) return false;
  const delta = Math.abs(hueOf(primary) - hueOf(accent));
  return Math.min(delta, 360 - delta) >= ACCENT_MIN_HUE_DELTA;
}

/**
 * The nearest tone to the seed that satisfies `ok` — MINIMUM visual movement.
 *
 * This is the rule the whole file turns on. A brand colour that already works
 * is used exactly as supplied; one that does not is nudged along its own HCT
 * tone axis, one step at a time, until it passes — never normalised to a fixed
 * tone and never jumped a whole ramp step. `prefer` only breaks ties when a
 * lighter and a darker candidate are equally far away.
 */
export function nearestAccessible(
  seedHex: string,
  ok: (hex: string) => boolean,
  prefer: 'darker' | 'lighter' = 'darker',
): { hex: string; toneDelta: number } | null {
  if (ok(seedHex)) return { hex: seedHex, toneDelta: 0 };
  const base = toneOf(seedHex);
  for (let delta = 1; delta <= 60; delta++) {
    const first  = prefer === 'darker' ? base - delta : base + delta;
    const second = prefer === 'darker' ? base + delta : base - delta;
    for (const tone of [first, second]) {
      if (tone < 0 || tone > 100) continue;
      const hex = toneAdjusted(seedHex, tone);
      if (ok(hex)) return { hex, toneDelta: tone - base };
    }
  }
  return null;
}

/**
 * Generate the token map for a set of seeds.
 *
 * Every value below is either the brand as supplied, or the brand moved the
 * smallest distance that makes it legible. Nothing is a "strong version of the
 * brand" invented to fill a slot.
 */
export function brandThemeToTokens(seeds: BrandSeeds): BrandThemeBuild {
  const compromised: string[] = [];
  const movement: BrandThemeBuild['movement'] = [];

  const accent = isDistinctAccent(seeds.primary, seeds.accent) ? seeds.accent : undefined;
  /* Accent roles fall back to the primary rather than to a darkened copy of it.
     One brand colour used in several places is honest; two colours where the
     logo had one is a fabrication. */
  const accentSource = accent ?? seeds.primary;

  const primaryScale = tonalScale(seeds.primary);
  const accentScale  = accent ? tonalScale(accent) : undefined;

  function resolve(
    role: string, seed: string, ok: (hex: string) => boolean,
    prefer: 'darker' | 'lighter' = 'darker',
  ): string {
    const found = nearestAccessible(seed, ok, prefer);
    if (!found) {
      // Nothing on the axis works. Report it rather than shipping the least-bad
      // value as though it passed.
      compromised.push(role);
      return seed;
    }
    if (found.toneDelta !== 0) {
      movement.push({ role, from: seed, to: found.hex, toneDelta: found.toneDelta });
    }
    return found.hex;
  }

  /* ── Primary action ──────────────────────────────────────────────────────
     The seed itself whenever a label can be read on it. SIOMAC red is tone 48
     and carries white at 4.82:1, so it comes back as `#E40C0C`. */
  const primary = resolve(
    '--ui-color-action-primary', seeds.primary,
    hex => !pickForeground(hex).compromised,
  );
  const primaryText  = pickForeground(primary).color;
  const primaryHover = toneAdjusted(primary, Math.max(0, toneOf(primary) - HOVER_TONE_STEP));

  /* ── Links ───────────────────────────────────────────────────────────────
     Read on a white card, so they need 4.5:1 there — usually a nudge darker. */
  const link = resolve(
    '--ui-color-text-link', accentSource,
    hex => contrastRatio(hex, LIGHT_SURFACE) >= AA_TEXT,
  );

  /* ── Active tab/navigation indicator ────────────────────────────────────
     Tabs live on light application surfaces, so they own a different role
     from both primary actions and the contrast-adjusted indicator on the dark
     navigation rail. A broad brand mapping may intentionally move this role;
     changing Button's role alone cannot. */
  const navigationActive = resolve(
    '--ui-color-navigation-active', accentSource,
    hex => contrastRatio(hex, LIGHT_SURFACE) >= AA_NON_TEXT,
  );

  /* ── Active navigation indicator ─────────────────────────────────────────
     A 3px bar on the dark rail: 3:1 as a UI component. Most saturated brand
     colours are DARKER than the rail, so this one usually moves lighter. */
  const navIndicator = resolve(
    '--ui-color-nav-active-indicator', accentSource,
    hex => contrastRatio(hex, SHELL_DARK) >= AA_NON_TEXT,
    'lighter',
  );

  /* ── Active navigation surface ───────────────────────────────────────────
     A wash, not a fill. At 20% the rail stays the rail and the brand reads as
     a tint behind the indicator rather than a slab of colour. */
  const navActiveBg   = withAlpha(accentSource, NAV_ACTIVE_TINT_ALPHA);
  const navActiveText = pickForeground(compositeOver(navActiveBg, SHELL_DARK)).color;

  const tokens: Record<string, string> = {
    ...scaleToTokens('primary', primaryScale),
    ...(accentScale ? scaleToTokens('accent', accentScale) : {}),
    [SEED_PRIMARY_TOKEN]: seeds.primary,
    ...(accent ? { [SEED_ACCENT_TOKEN]: accent } : {}),

    '--ui-color-action-primary':       primary,
    '--ui-color-action-primary-hover': primaryHover,
    '--ui-color-action-primary-text':  primaryText,

    '--ui-color-text-link': link,

    '--ui-color-navigation-active': navigationActive,

    '--ui-color-focus-ring':    withAlpha(accentSource, FOCUS_RING_ALPHA),
    /* The opaque outline keyboard users navigate by. Same accessible tone as
       links and the selection edge, so focus and selection read as one family. */
    '--ui-color-focus-outline': link,

    /* Pale tint + brand edge. A selected row must stay a background someone
       reads text on, so it is never a filled brand block. */
    '--ui-color-selection-background': (accentScale ?? primaryScale)[50],
    '--ui-color-selection-border':     link,

    '--ui-color-nav-active-background': navActiveBg,
    '--ui-color-nav-active-text':       navActiveText,
    '--ui-color-nav-active-indicator':  navIndicator,
  };

  assertNoLockedRoles(tokens);
  assertNoNeutralRoles(tokens);

  return {
    theme: { version: BRAND_THEME_VERSION, seeds: accent ? { primary: seeds.primary, accent } : { primary: seeds.primary } },
    primaryScale,
    ...(accentScale ? { accentScale } : {}),
    tokens,
    compromised,
    movement,
  };
}

/** `#RRGGBB` + alpha → an `rgba()` string. */
export function withAlpha(hex: string, alpha: number): string {
  const c = parse(hex);
  return c ? formatRgb({ ...c, alpha }) : hex;
}

/**
 * Hard guard: the engine may not write a role marked `brandDriven: false`.
 *
 * The most damaging thing a brand generator can do is turn `danger` into a
 * shade of the customer's logo, at which point "delete" and "saved" render
 * identically. Enforcing it here means a future edit cannot reintroduce it.
 */
function assertNoLockedRoles(tokens: Record<string, string>): void {
  const locked = BRAND_LOCKED_ROLES.map(r => r.name).filter(n => n in tokens);
  if (locked.length > 0) {
    throw new Error(`Brand theme attempted to overwrite non-brand roles: ${locked.join(', ')}`);
  }
}

/**
 * Second guard, for the roles that are brand-ELIGIBLE but that this policy
 * deliberately leaves neutral.
 *
 * `brandDriven: true` says "a theme MAY set this"; the enterprise policy says
 * these particular ones should not be set by GENERATION. Without this, the
 * regression is a one-line edit away — it is exactly how the rail became
 * `#410000` and secondary buttons became `#930002` the first time.
 */
export const NEUTRAL_BY_POLICY = [
  '--ui-color-action-secondary',
  '--ui-color-action-secondary-text',
  '--ui-color-nav-background',
  '--ui-color-nav-text',
] as const;

function assertNoNeutralRoles(tokens: Record<string, string>): void {
  const written = NEUTRAL_BY_POLICY.filter(n => n in tokens);
  if (written.length > 0) {
    throw new Error(
      `Brand theme wrote roles the enterprise policy keeps neutral: ${written.join(', ')}. ` +
      'Surfaces and secondary actions are the frame, not the brand.',
    );
  }
}

/** Reconstruct the theme from a published token map (no seed → null). */
export function brandThemeFromTokens(tokens: Record<string, string>): BrandTheme | null {
  const primary = tokens[SEED_PRIMARY_TOKEN];
  if (!primary) return null;
  const accent = tokens[SEED_ACCENT_TOKEN];
  return { version: BRAND_THEME_VERSION, seeds: accent ? { primary, accent } : { primary } };
}

/**
 * Every token name the engine can emit — used to clear a previous brand.
 *
 * Built from a two-seed sample so the accent scale and accent seed are included;
 * a single-seed build emits a subset, and Reset must clear the superset.
 */
export function brandTokenNames(): string[] {
  return Object.keys(brandThemeToTokens({ primary: '#E40C0C', accent: '#1b2d54' }).tokens);
}
