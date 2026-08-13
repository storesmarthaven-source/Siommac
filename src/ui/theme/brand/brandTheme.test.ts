/**
 * src/ui/theme/brand/brandTheme.test.ts
 *
 * The Brand Theme engine, end to end minus the DOM: extraction ranking, tonal
 * generation, semantic mapping, the locked-role guard, and the accessibility
 * gate — including the case that matters most, a brand whose own colour cannot
 * carry white text.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { TONAL_STEPS, tonalScale, toneForStep, toneOf, chromaOf, hueOf, clampAnchor, toneAdjusted } from './tonal';
import { extractSeeds } from './palette';
import {
  brandThemeToTokens, brandThemeFromTokens, brandTokenNames, withAlpha,
  isDistinctAccent, nearestAccessible, NEUTRAL_BY_POLICY,
  SEED_PRIMARY_TOKEN, SEED_ACCENT_TOKEN,
} from './brandTheme';
import {
  contrastRatio, compositeOver, pickForeground, evaluatePairings,
  publishBlocked, PAIRINGS, AA_TEXT, AA_NON_TEXT,
} from './contrast';
import { BRAND_LOCKED_ROLES, SEMANTIC_TOKEN_NAMES } from '../semanticTokens';
import { collectDecls, resolveToken } from '../cssTokenGraph';

const SIOMAC = { primary: '#E40C0C', accent: '#1b2d54' };

/** Un-themed defaults for every role the policy leaves neutral. */
const NEUTRAL_DEFAULTS: Record<string, string> = {
  '--ui-color-surface-default': '#FFFFFF',
  '--ui-color-surface-page': '#F0F4F8',
  '--ui-color-surface-raised': '#FFFFFF',
  '--ui-color-text-primary': '#1F2A44',
  '--ui-color-action-secondary': '#1b2d54',
  '--ui-color-action-secondary-text': '#ffffff',
  '--ui-color-nav-background': '#1b2d54',
  '--ui-color-nav-text': '#8d9cb7',
};

/* ── Tonal scale ────────────────────────────────────────────────────────────*/

describe('tonal scale', () => {
  it('reduces to the plain 100 − step/10 ramp when the anchor is 50', () => {
    expect(toneForStep(50)).toBe(95);
    expect(toneForStep(500)).toBe(50);
    expect(toneForStep(950)).toBe(5);
    expect(toneForStep(100)).toBeCloseTo(90, 6);
    expect(toneForStep(900)).toBeCloseTo(10, 6);
  });

  it('hinges step 500 on the anchor while pinning both ends', () => {
    expect(toneForStep(500, 38)).toBe(38);
    expect(toneForStep(50, 38)).toBe(95);
    expect(toneForStep(950, 38)).toBe(5);
  });

  it('clamps an extreme anchor so a near-white seed still ramps to a dark end', () => {
    expect(clampAnchor(2)).toBe(30);
    expect(clampAnchor(99)).toBe(70);
    const pale = tonalScale('#FFF9E6');
    expect(toneOf(pale[950])).toBeLessThan(20);
    expect(toneOf(pale[50])).toBeGreaterThan(80);
  });

  it('puts the SEED at step 500 rather than a normalised stand-in', () => {
    /* Step 500 used to be a fixed tone 50, which LIGHTENED `#E40C0C` (tone 48,
       4.82:1 on white) to `#ec1712` (4.47:1) — just under AA — whereupon the
       fill search stepped it down to a maroon `#c00004`. An accessible brand
       colour was normalised into failure and then over-corrected. */
    expect(tonalScale('#E40C0C')[500]).toBe('#e40c0c');
    expect(toneOf(tonalScale('#0F766E')[500])).toBeCloseTo(toneOf('#0F766E'), 0);
  });

  it('toneAdjusted moves lightness while holding hue', () => {
    const lighter = toneAdjusted('#E40C0C', toneOf('#E40C0C') + 15);
    expect(toneOf(lighter)).toBeGreaterThan(toneOf('#E40C0C'));
    expect(hueOf(lighter)).toBeCloseTo(hueOf('#E40C0C'), -1);
  });

  it('produces every step as a hex colour', () => {
    const scale = tonalScale(SIOMAC.primary);
    for (const step of TONAL_STEPS) expect(scale[step]).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it('darkens monotonically from 50 to 950', () => {
    const scale = tonalScale(SIOMAC.accent);
    const tones = TONAL_STEPS.map(s => toneOf(scale[s]));
    for (let i = 1; i < tones.length; i++) {
      expect(tones[i]!, `step ${TONAL_STEPS[i]}`).toBeLessThan(tones[i - 1]!);
    }
  });

  it('holds the seed hue family rather than fading to grey', () => {
    const scale = tonalScale(SIOMAC.primary);
    expect(chromaOf(scale[500])).toBeGreaterThan(20);
  });

  it('generates a usable scale from a near-black seed', () => {
    // A logo that is almost black has almost no chroma to work with; the scale
    // must still span light to dark rather than collapsing to one value.
    const scale = tonalScale('#0A0A0A');
    expect(toneOf(scale[50])).toBeGreaterThan(80);
    expect(toneOf(scale[950])).toBeLessThan(20);
  });
});

/* ── Palette extraction ─────────────────────────────────────────────────────*/

/** Build an RGBA buffer from `[hex, count]` pairs. */
function pixels(spec: [string, number][], alpha = 255): Uint8ClampedArray {
  const out: number[] = [];
  for (const [hex, count] of spec) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    for (let i = 0; i < count; i++) out.push(r, g, b, alpha);
  }
  return new Uint8ClampedArray(out);
}

describe('palette extraction', () => {
  it('finds the identity colour behind a mostly-white logo', () => {
    const seeds = extractSeeds(pixels([['#FFFFFF', 900], ['#E40C0C', 100]]));
    expect(seeds.length).toBeGreaterThan(0);
    // Ranked by identity, not by area — white is 90% of the pixels and must not win.
    expect(chromaOf(seeds[0]!)).toBeGreaterThan(20);
  });

  it('ignores fully transparent padding', () => {
    const opaque = extractSeeds(pixels([['#1b2d54', 200]]));
    const padded = new Uint8ClampedArray([
      ...pixels([['#00FF00', 400]], 0),   // transparent green — must not count
      ...pixels([['#1b2d54', 200]]),
    ]);
    const withPadding = extractSeeds(padded);
    expect(withPadding).toEqual(opaque);
  });

  it('returns nothing for an entirely transparent image', () => {
    expect(extractSeeds(pixels([['#123456', 100]], 0))).toEqual([]);
  });

  it('returns several distinct candidates for a multi-colour mark', () => {
    const seeds = extractSeeds(pixels([['#E40C0C', 300], ['#1b2d54', 300], ['#FFB712', 300]]));
    expect(seeds.length).toBeGreaterThanOrEqual(2);
    expect(new Set(seeds).size).toBe(seeds.length);
  });
});

/* ── Semantic mapping ───────────────────────────────────────────────────────*/

describe('semantic mapping', () => {
  const built = brandThemeToTokens(SIOMAC);

  it('emits both tonal scales plus the seeds, so a theme is reconstructable', () => {
    for (const step of TONAL_STEPS) {
      expect(built.tokens[`--ui-brand-primary-${step}`]).toBeTruthy();
      expect(built.tokens[`--ui-brand-accent-${step}`]).toBeTruthy();
    }
    expect(built.tokens[SEED_PRIMARY_TOKEN]).toBe(SIOMAC.primary);
    expect(brandThemeFromTokens(built.tokens)?.seeds).toEqual(SIOMAC);
  });

  it('emits no accent scale for a single-colour brand', () => {
    const mono = brandThemeToTokens({ primary: '#E40C0C' });
    expect(mono.accentScale).toBeUndefined();
    expect(mono.tokens['--ui-brand-accent-500']).toBeUndefined();
    expect(brandThemeFromTokens(mono.tokens)?.seeds).toEqual({ primary: '#E40C0C' });
  });

  it('returns null when the published map carries no brand', () => {
    expect(brandThemeFromTokens({ '--siomac-gold': '#FFB712' })).toBeNull();
  });

  it('only ever writes declared semantic roles', () => {
    const semantic = Object.keys(built.tokens).filter(k => k.startsWith('--ui-color-'));
    for (const role of semantic) expect(SEMANTIC_TOKEN_NAMES).toContain(role);
    expect(semantic.length).toBeGreaterThan(0);
  });

  it('never writes an operational state or a neutral surface', () => {
    for (const role of BRAND_LOCKED_ROLES) {
      expect(built.tokens, role.name).not.toHaveProperty(role.name);
    }
  });

  it('derives hover from the primary rather than a hand-picked hex', () => {
    // Slightly darker than whatever the primary settled on — never a constant,
    // so it can never go stale relative to the fill.
    const hover = built.tokens['--ui-color-action-primary-hover']!;
    const base  = built.tokens['--ui-color-action-primary']!;
    expect(toneOf(hover)).toBeLessThan(toneOf(base));
    expect(toneOf(base) - toneOf(hover)).toBeLessThanOrEqual(12);
    expect(hueOf(hover)).toBeCloseTo(hueOf(base), -1);
  });

  it('emits a translucent focus ring, not an opaque block', () => {
    expect(built.tokens['--ui-color-focus-ring']).toMatch(/^rgba?\(/);
  });

  it('keeps the selection wash light enough to read text on', () => {
    const wash = built.tokens['--ui-color-selection-background']!;
    expect(contrastRatio('#1F2A44', wash)).toBeGreaterThanOrEqual(AA_TEXT);
  });
});

/* ── Foreground selection ───────────────────────────────────────────────────*/

describe('accessible foreground selection', () => {
  it('puts white on a dark fill and dark text on a pale fill', () => {
    expect(pickForeground('#1b2d54').color).toBe('#FFFFFF');
    expect(pickForeground('#FFE58A').color).toBe('#1F2A44');
  });

  it('flags a fill where neither candidate reaches AA', () => {
    // A mid-tone grey is the classic case: ~4:1 either way, passing neither.
    const choice = pickForeground('#808080');
    expect(choice.compromised).toBe(true);
  });

  it.each([
    ['pale yellow',    '#FFD400', '#7FD4FF'],
    ['saturated red',  '#E40C0C', '#1b2d54'],
    ['near-black',     '#111111', '#111111'],
    ['low-chroma grey', '#8A8F98', '#8A8F98'],
  ])('gives %s brand an AA-readable primary button label', (_name, primary, accent: string | undefined) => {
    const built = brandThemeToTokens({ primary, accent });
    expect(contrastRatio(
      built.tokens['--ui-color-action-primary-text']!,
      built.tokens['--ui-color-action-primary']!,
    )).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it('uses the brand colour untouched when it is already readable', () => {
    const built = brandThemeToTokens({ primary: '#E40C0C', accent: '#1b2d54' });
    // Byte-identical to what was supplied — not a round-trip through the ramp.
    expect(built.tokens['--ui-color-action-primary']).toBe('#E40C0C');
    expect(built.movement.find(m => m.role === '--ui-color-action-primary')).toBeUndefined();
  });

  it('moves the smallest distance that works when it is not', () => {
    const built = brandThemeToTokens({ primary: '#8A8F98' });
    const moved = built.movement.find(m => m.role === '--ui-color-action-primary');
    expect(moved, 'expected the primary to be adjusted').toBeDefined();
    expect(Math.abs(moved!.toneDelta)).toBeLessThanOrEqual(12);
  });
});

/* ── Contrast gate ──────────────────────────────────────────────────────────*/

/* ── The enterprise mapping policy ──────────────────────────────────────────*/

/**
 * These fixtures are permanent. The defect they encode — an application painted
 * in progressively darker versions of the logo — passed every contrast check
 * that existed at the time, which is exactly why it needs assertions of its own.
 */
const FIXTURES: [name: string, primary: string, accent: string | undefined][] = [
  ['SIOMAC red',       '#E40C0C', undefined],
  ['red + navy',       '#E40C0C', '#1b2d54'],
  ['navy',             '#1b2d54', undefined],
  ['green',            '#2E7D32', undefined],
  ['orange',           '#F97316', undefined],
  ['purple',           '#6D28D9', undefined],
  ['monochrome black', '#111111', undefined],
  ['gold + charcoal',  '#FFB712', '#2B2B2B'],
];

describe('mapping policy — neutral enterprise shell, controlled brand accents', () => {
  it.each(FIXTURES)('%s: never writes a surface, border, text or status role', (_n, primary, accent) => {
    const { tokens } = brandThemeToTokens({ primary, accent });
    for (const role of BRAND_LOCKED_ROLES) expect(tokens, role.name).not.toHaveProperty(role.name);
  });

  it.each(FIXTURES)('%s: leaves secondary actions and the nav shell neutral', (_n, primary, accent) => {
    // The exact roles that produced `#930002` secondary buttons and a `#410000`
    // rail. The engine throws if it ever writes one; this proves it doesn't.
    const { tokens } = brandThemeToTokens({ primary, accent });
    for (const role of NEUTRAL_BY_POLICY) expect(tokens, role).not.toHaveProperty(role);
  });

  it.each(FIXTURES)('%s: every generated value stays legible', (_n, primary, accent) => {
    const built = brandThemeToTokens({ primary, accent });
    const results = evaluatePairings(role => built.tokens[role] ?? (baseline(role) || null));
    expect(publishBlocked(results).map(r => `${r.id} ${r.ratio.toFixed(2)}`)).toEqual([]);
    expect(built.compromised).toEqual([]);
  });

  it.each(FIXTURES)('%s: keeps the brand at or very near the supplied colour', (_n, primary, accent) => {
    // "Nearest acceptable tone" — a brand may be nudged for legibility, never
    // relocated. The old behaviour moved SIOMAC red a whole ramp step into maroon.
    const built = brandThemeToTokens({ primary, accent });
    const used = built.tokens['--ui-color-action-primary']!;
    expect(Math.abs(toneOf(used) - toneOf(primary))).toBeLessThanOrEqual(12);
    expect(hueOf(used)).toBeCloseTo(hueOf(primary), -1);
  });
});

describe('mapping policy — the SIOMAC red regression', () => {
  const built = brandThemeToTokens({ primary: '#E40C0C' });

  it('returns the logo colour itself as the primary action', () => {
    expect(built.tokens['--ui-color-action-primary']).toBe('#E40C0C');
    expect(built.movement.find(m => m.role === '--ui-color-action-primary')).toBeUndefined();
  });

  it('produces no dark-red secondary button', () => {
    expect(built.tokens).not.toHaveProperty('--ui-color-action-secondary');
  });

  it('produces no maroon menu, dialog, card or input surface', () => {
    for (const role of [
      '--ui-color-surface-raised', '--ui-color-surface-default',
      '--ui-color-surface-subtle', '--ui-color-surface-page',
    ]) expect(built.tokens, role).not.toHaveProperty(role);
  });

  it('produces no near-black red navigation rail', () => {
    expect(built.tokens).not.toHaveProperty('--ui-color-nav-background');
    expect(built.tokens).not.toHaveProperty('--ui-color-nav-text');
  });

  it('still puts the brand in the active indicator, links, focus and selection', () => {
    for (const role of [
      '--ui-color-nav-active-indicator', '--ui-color-text-link',
      '--ui-color-focus-ring', '--ui-color-selection-background', '--ui-color-selection-border',
    ]) expect(built.tokens[role], role).toBeTruthy();
    // The indicator has to LIGHTEN to clear 3:1 on the rail — a saturated red is
    // darker than the navy it sits on.
    expect(contrastRatio(built.tokens['--ui-color-nav-active-indicator']!, '#1b2d54'))
      .toBeGreaterThanOrEqual(AA_NON_TEXT);
  });

  it('keeps the active-nav surface a wash rather than a fill', () => {
    expect(built.tokens['--ui-color-nav-active-background']).toMatch(/^rgba?\(/);
  });
});

describe('mapping policy — an accent must be a real second colour', () => {
  it('ignores a second seed that is only another shade of the primary', () => {
    // "red + more red" must not become "red + dark maroon".
    const built = brandThemeToTokens({ primary: '#E40C0C', accent: '#930002' });
    expect(built.accentScale).toBeUndefined();
    expect(built.tokens[SEED_ACCENT_TOKEN]).toBeUndefined();
  });

  it('ignores a near-grey second seed', () => {
    expect(isDistinctAccent('#E40C0C', '#8A8F98')).toBe(false);
  });

  it('accepts a genuinely different hue', () => {
    expect(isDistinctAccent('#E40C0C', '#1b2d54')).toBe(true);
    const built = brandThemeToTokens({ primary: '#E40C0C', accent: '#FFB712' });
    expect(built.accentScale).toBeDefined();
    expect(built.tokens[SEED_ACCENT_TOKEN]).toBe('#FFB712');
  });

  it('falls back to the primary for accent roles when there is no accent', () => {
    const mono = brandThemeToTokens({ primary: '#2E7D32' });
    // Same hue family as the brand, not an invented second colour.
    expect(hueOf(mono.tokens['--ui-color-text-link']!)).toBeCloseTo(hueOf('#2E7D32'), -1);
  });
});

describe('nearestAccessible — minimum visual movement', () => {
  it('returns the colour untouched when it already passes', () => {
    const r = nearestAccessible('#E40C0C', hex => !pickForeground(hex).compromised);
    expect(r?.hex).toBe('#E40C0C');
    expect(r?.toneDelta).toBe(0);
  });

  it('moves the smallest number of tone steps that works', () => {
    const r = nearestAccessible('#8A8F98', hex => !pickForeground(hex).compromised);
    expect(r).not.toBeNull();
    expect(Math.abs(r!.toneDelta)).toBeLessThanOrEqual(12);
  });

  it('honours the tie-break direction', () => {
    const lighter = nearestAccessible('#3B0764', hex => contrastRatio(hex, '#1b2d54') >= AA_NON_TEXT, 'lighter');
    expect(lighter!.toneDelta).toBeGreaterThan(0);
  });

  it('reports failure rather than returning a value that does not pass', () => {
    expect(nearestAccessible('#E40C0C', () => false)).toBeNull();
  });
});

describe('contrast gate', () => {
  it('agrees with the WCAG reference extremes', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 1);
    expect(contrastRatio('#FFFFFF', '#FFFFFF')).toBeCloseTo(1, 5);
  });

  it('scores an unparseable colour as 0 rather than throwing', () => {
    expect(contrastRatio('not-a-colour', '#fff')).toBe(0);
  });

  it('composites a translucent colour before measuring it', () => {
    // Raw rgba() has no defined luminance; over white it must land pale.
    const flat = compositeOver('rgba(27, 45, 84, .06)', '#FFFFFF');
    expect(contrastRatio('#1F2A44', flat)).toBeGreaterThan(AA_TEXT);
  });

  it('passes every critical pairing for the generated SIOMAC brand', () => {
    const built = brandThemeToTokens(SIOMAC);
    // eslint-disable-next-line @typescript-eslint/no-unused-expressions -- readability
    const results = evaluatePairings(role => built.tokens[role] ?? baseline(role));
    const blocked = publishBlocked(results);
    expect(blocked.map(b => `${b.id} ${b.ratio.toFixed(2)}`)).toEqual([]);
  });

  it('blocks publication when a critical pairing fails', () => {
    // Force an unreadable nav: white-ish rail with the generated dim text on it.
    const built = brandThemeToTokens(SIOMAC);
    const broken: Record<string, string> = { ...built.tokens, '--ui-color-nav-background': '#FFFFFF' };
    const results = evaluatePairings(role => broken[role] ?? baseline(role));
    expect(publishBlocked(results).map(r => r.id)).toContain('nav-text');
  });

  it('measures a pairing it cannot resolve as a failure, never a pass', () => {
    const results = evaluatePairings(() => null);
    expect(results.every(r => r.ratio === 0 && !r.pass)).toBe(true);
    expect(publishBlocked(results).length).toBeGreaterThan(0);
  });

  it('names a background and a foreground role for every pairing', () => {
    for (const p of PAIRINGS) {
      expect(SEMANTIC_TOKEN_NAMES, p.id).toContain(p.foreground);
      expect(SEMANTIC_TOKEN_NAMES, p.id).toContain(p.background);
    }
  });
});

/* ── Against the real stylesheets ───────────────────────────────────────────*/

describe('a generated brand reaches the canonical components', () => {
  const root = resolvePath(__dirname, '../../../..');
  const read = (p: string): string => readFileSync(resolvePath(root, p), 'utf8');
  const decls = collectDecls([
    read('assets/styles/base.css'),
    read('src/ui/tokens/tokens.css'),
    read('src/ui/tokens/semantic.css'),
    read('src/ui/primitives/Button.recipe.css'),
    read('src/ui/containers/Card/card.recipe.css'),
    read('src/ui/primitives/control.recipe.css'),
    read('src/ui/data/DataTable/dataTable.recipe.css'),
    read('src/ui/navigation/Tabs/tabs.recipe.css'),
  ]);

  const built = brandThemeToTokens({ primary: '#0F766E', accent: '#3B0764' });

  it('repaints the primary button', () => {
    expect(resolveToken('--ui-button-primary-bg', decls, built.tokens).value)
      .toBe(built.tokens['--ui-color-action-primary']);
  });

  it('repaints Tabs through navigation, never through Button action colour', () => {
    expect(resolveToken('--ui-tab-indicator', decls, built.tokens).value)
      .toBe(built.tokens['--ui-color-navigation-active']);
    expect(built.tokens['--ui-color-navigation-active'])
      .not.toBe(built.tokens['--ui-color-action-primary']);
  });

  it('repaints the selected table row', () => {
    expect(resolveToken('--ui-dt-row-selected', decls, built.tokens).value)
      .toBe(built.tokens['--ui-color-selection-background']);
  });

  it('leaves the NEUTRAL secondary button neutral', () => {
    /* The heart of the policy: a generated theme must not reach the secondary
       button or any floating SURFACE — both resolve through roles the engine
       never writes. Since the BTN-01 restyle, `secondary` IS a neutral surface,
       so this asserts the card white rather than the old navy fill. */
    expect(resolveToken('--ui-button-secondary-bg', decls, built.tokens).value).toBe('#FFFFFF');
    expect(resolveToken('--ui-button-secondary-fg', decls, built.tokens).value).toBe('#1F2A44');
  });

  it('DOES repaint focus, which the contract says the brand controls', () => {
    /* Regression: focus was routed through `--ui-color-action-secondary`, so it
       silently stopped following the brand the moment the engine stopped writing
       that role. The contract promises focus is brand-driven; this proves it. */
    expect(resolveToken('--ui-control-border-focus', decls, built.tokens).value)
      .toBe(built.tokens['--ui-color-focus-outline']);
    expect(built.tokens['--ui-color-focus-outline']).not.toBe('#1b2d54');
  });

  it('leaves danger, neutral surfaces and body text exactly as they were', () => {
    expect(resolveToken('--ui-button-danger-bg', decls, built.tokens).value).toBe('#dc2626');
    expect(resolveToken('--ui-card-bg', decls, built.tokens).value).toBe('#FFFFFF');
    expect(resolveToken('--ui-card-fg', decls, built.tokens).value).toBe('#1F2A44');
  });

  it('lists every token it can emit, so a previous brand can be cleared', () => {
    const names = brandTokenNames();
    expect(names).toContain('--ui-color-action-primary');
    expect(names).toContain('--ui-color-navigation-active');
    expect(names).toContain('--ui-brand-primary-500');
    expect(names).toContain(SEED_ACCENT_TOKEN);
  });
});

describe('withAlpha', () => {
  it('converts a hex to an rgba string', () => {
    expect(withAlpha('#1b2d54', 0.16)).toMatch(/^rgba\(/);
  });
});

/** Un-themed defaults for roles the engine deliberately does not set. */
function baseline(role: string): string {
  return NEUTRAL_DEFAULTS[role] ?? '';
}

describe('translucent backgrounds are composited over what is really behind them', () => {
  /* Regression: the active nav fill is `rgba(99,112,141,.3)` over a DARK rail.
     Flattening it over white measured white-on-pale at 1.48:1 and declared the
     app's own navigation unpublishable — a gate failing on its own arithmetic
     is worse than no gate. Caught in the browser, not by the unit tests. */
  const TODAY: Record<string, string> = {
    '--ui-color-nav-background': '#1b2d54',
    '--ui-color-nav-active-background': 'rgba(99, 112, 141, .3)',
    '--ui-color-nav-active-text': '#ffffff',
    '--ui-color-selection-background': 'rgba(27, 45, 84, .06)',
    '--ui-color-text-primary': '#1F2A44',
    '--ui-color-surface-default': '#FFFFFF',
  };

  it('measures the active nav row against the rail, not against white', () => {
    const result = evaluatePairings(role => TODAY[role] ?? null)
      .find(r => r.id === 'nav-active');
    expect(result?.ratio).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it('still measures the selected row against the card surface', () => {
    const result = evaluatePairings(role => TODAY[role] ?? null)
      .find(r => r.id === 'selection');
    expect(result?.ratio).toBeGreaterThanOrEqual(AA_TEXT);
  });
});
