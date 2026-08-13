/**
 * src/ui/studio/brandDirections.test.ts — the seed × direction matrix.
 *
 * Fifteen combinations (five seeds × three directions), asserted rather than
 * clicked. The guarantees this file exists to hold are the ones a customer's
 * brand could plausibly break:
 *
 *   • operational colours never inherit the company colour;
 *   • surfaces and secondary actions never inherit it either;
 *   • the three directions are the SAME palette at different reach, not three
 *     palettes — so "Brand Forward" cannot quietly become a different theme;
 *   • reach is strictly nested, so Brand Forward is always at least as branded
 *     as Enterprise.
 *
 * A browser walkthrough proves one combination renders. This proves all fifteen
 * behave, every time the suite runs.
 */

import { describe, it, expect } from 'vitest';
import { brandThemeToTokens } from '../theme/brand/brandTheme';
import {
  DIRECTIONS, tokensForDirection, directionById,
  LOCKED_OPERATIONAL, LOCKED_NEUTRAL, type ThemeDirection,
} from './brandDirections';

/** Deliberately spread across the hue circle, plus a near-grey edge case. */
const SEEDS: { name: string; hex: string }[] = [
  { name: 'red',        hex: '#E40C0C' },
  { name: 'green',      hex: '#1a7f37' },
  { name: 'navy',       hex: '#1b2d54' },
  { name: 'purple',     hex: '#6d28d9' },
  { name: 'monochrome', hex: '#4a4a4a' },
];

const IDS: ThemeDirection[] = ['enterprise', 'balanced', 'forward'];

describe('brand direction matrix', () => {
  for (const seed of SEEDS) {
    describe(`seed: ${seed.name} (${seed.hex})`, () => {
      const build = brandThemeToTokens({ primary: seed.hex });

      for (const id of IDS) {
        const tokens = tokensForDirection(build.tokens, id);

        it(`${id} — never emits an operational colour`, () => {
          for (const locked of LOCKED_OPERATIONAL) {
            expect(tokens[locked], `${locked} leaked into ${id}`).toBeUndefined();
          }
        });

        it(`${id} — never emits a surface or secondary-action role`, () => {
          for (const locked of LOCKED_NEUTRAL) {
            expect(tokens[locked], `${locked} leaked into ${id}`).toBeUndefined();
          }
        });

        it(`${id} — brands the primary action and focus`, () => {
          expect(tokens['--ui-color-action-primary']).toBeTruthy();
          expect(tokens['--ui-color-focus-outline']).toBeTruthy();
        });

        it(`${id} — carries the SAME generated values, only fewer of them`, () => {
          for (const [name, value] of Object.entries(tokens)) {
            expect(value, `${name} differs from the generated palette`)
              .toBe(build.tokens[name]);
          }
        });

        it(`${id} — emits nothing the engine did not generate`, () => {
          for (const name of Object.keys(tokens)) {
            expect(build.tokens, `${name} is not an engine role`).toHaveProperty(name);
          }
        });
      }

      it('reach is strictly nested: enterprise ⊂ balanced ⊂ forward', () => {
        const keys = (id: ThemeDirection): Set<string> =>
          new Set(Object.keys(tokensForDirection(build.tokens, id)));
        const ent = keys('enterprise');
        const bal = keys('balanced');
        const fwd = keys('forward');

        for (const k of ent) expect(bal.has(k), `balanced dropped ${k}`).toBe(true);
        for (const k of bal) expect(fwd.has(k), `forward dropped ${k}`).toBe(true);
        expect(bal.size).toBeGreaterThan(ent.size);
        expect(fwd.size).toBeGreaterThan(bal.size);
      });

      it('every direction actually applies the seed', () => {
        for (const id of IDS) {
          const t = tokensForDirection(build.tokens, id);
          expect(t['--ui-brand-seed-primary']).toBe(seed.hex);
        }
      });
    });
  }

  it('declares exactly three directions, each with a distinct role set', () => {
    expect(DIRECTIONS).toHaveLength(3);
    const sizes = IDS.map(id => directionById(id).roles.length);
    expect(new Set(sizes).size).toBe(3);
  });
});
