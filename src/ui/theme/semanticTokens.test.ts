/**
 * src/ui/theme/semanticTokens.test.ts
 *
 * Proves the semantic layer is REAL — that it exists in CSS, matches its
 * manifest, is reachable from the editor, and actually sits between the
 * palette and the canonical component recipes.
 *
 * The load-bearing suite is "the layer conducts": it resolves recipe variables
 * against the real CSS sources with and without an override, and asserts the
 * override reaches the component. jsdom cannot compute the custom-property
 * cascade, so a rendered-component assertion would prove nothing here; this
 * reads the same files the browser loads. See cssTokenGraph.ts.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { collectDecls, collectVarRefs, resolveToken } from './cssTokenGraph';
import {
  SEMANTIC_ROLES, SEMANTIC_TOKEN_NAMES, SEMANTIC_GROUPS,
  BRAND_LOCKED_ROLES, BRAND_DRIVEN_ROLES,
} from './semanticTokens';
import { ALL_TOKEN_NAMES } from './tokens';
import { evaluatePairings, publishBlocked, contrastRatio, AA_TEXT } from './brand/contrast';

const root = resolve(__dirname, '../../..');
const read = (p: string): string => readFileSync(resolve(root, p), 'utf8');

const BASE_CSS     = 'assets/styles/base.css';
const TOKENS_CSS   = 'src/ui/tokens/tokens.css';
const SEMANTIC_CSS = 'src/ui/tokens/semantic.css';

const RECIPES = [
  'src/ui/primitives/Button.recipe.css',
  'src/ui/primitives/Badge.recipe.css',
  'src/ui/primitives/control.recipe.css',
  'src/ui/primitives/actions.recipe.css',
  'src/ui/primitives/choice.recipe.css',
  'src/ui/containers/Card/card.recipe.css',
  'src/ui/data/DataTable/dataTable.recipe.css',
  'src/ui/navigation/Tabs/tabs.recipe.css',
  'src/ui/navigation/Wizard/wizard.recipe.css',
  'src/ui/overlays/Dialog.recipe.css',
  'src/ui/forms/listbox.recipe.css',
  'src/ui/forms/multiSelect.recipe.css',
  'src/ui/forms/fileInput.recipe.css',
];

/** The whole cascade, in app load order: palette → foundation → semantic → recipes. */
const decls = collectDecls([read(BASE_CSS), read(TOKENS_CSS), read(SEMANTIC_CSS), ...RECIPES.map(read)]);

describe('semantic layer — manifest and CSS are in lockstep', () => {
  const cssRoles = [...collectDecls([read(SEMANTIC_CSS)]).keys()].filter(n => n.startsWith('--ui-color-'));

  it('declares exactly the roles the manifest lists', () => {
    expect([...cssRoles].sort()).toEqual([...SEMANTIC_TOKEN_NAMES].sort());
  });

  it('names every role --ui-color-*, so the layer is greppable', () => {
    for (const r of SEMANTIC_ROLES) expect(r.name.startsWith('--ui-color-')).toBe(true);
  });

  it('assigns every role to a declared group', () => {
    const ids = new Set(SEMANTIC_GROUPS.map(g => g.id));
    for (const r of SEMANTIC_ROLES) expect(ids.has(r.group)).toBe(true);
  });

  it('exposes every role in the Foundations editor manifest', () => {
    for (const name of SEMANTIC_TOKEN_NAMES) expect(ALL_TOKEN_NAMES).toContain(name);
  });

  it('resolves every role to a real value with no undefined reference', () => {
    for (const name of SEMANTIC_TOKEN_NAMES) {
      const { value } = resolveToken(name, decls);
      expect(value, `${name} resolved to nothing`).toBeTruthy();
    }
  });
});

describe('semantic layer — operational states stay out of the brand engine', () => {
  it('locks success / warning / danger / info', () => {
    const locked = BRAND_LOCKED_ROLES.map(r => r.name);
    expect(locked).toEqual(expect.arrayContaining([
      '--ui-color-success', '--ui-color-warning', '--ui-color-danger', '--ui-color-info',
    ]));
  });

  it('locks neutral surfaces and body text', () => {
    const locked = new Set(BRAND_LOCKED_ROLES.map(r => r.name));
    for (const n of ['--ui-color-surface-page', '--ui-color-surface-default', '--ui-color-text-primary']) {
      expect(locked.has(n), `${n} must not be brand-driven`).toBe(true);
    }
  });

  it('still lets the brand drive actions, navigation, links and selection', () => {
    const driven = new Set(BRAND_DRIVEN_ROLES.map(r => r.name));
    for (const n of [
      '--ui-color-action-primary', '--ui-color-action-secondary',
      '--ui-color-nav-background', '--ui-color-text-link',
      '--ui-color-selection-background', '--ui-color-focus-ring',
    ]) expect(driven.has(n), `${n} should be brand-driven`).toBe(true);
  });
});

describe('semantic layer — introducing it changed nothing visually', () => {
  /* Each pair is a recipe variable and the literal the app rendered BEFORE the
     repoint. If a semantic default ever drifts, this is what catches it. */
  const UNCHANGED: [string, string][] = [
    ['--ui-button-primary-bg',        '#E40C0C'],
    ['--ui-button-primary-bg-hover',  '#B20808'],
    /* `--ui-button-secondary-bg` and `--ui-button-outline-border` used to be
       pinned here. They are gone on purpose: the Button was restyled to BTN-01,
       which made `secondary` a NEUTRAL bordered button and `outline` a
       brand-bordered one. That is a deliberate design change, so pinning the old
       values would assert the opposite of what was decided. The rest of this
       list still guards the semantic layer's zero-visual-change promise. */
    ['--ui-button-danger-bg',         '#dc2626'],
    ['--ui-button-link-fg',           '#1b2d54'],
    ['--ui-card-bg',                  '#FFFFFF'],
    ['--ui-card-footer-bg',           '#F8FAFE'],
    ['--ui-dt-header-fg',             '#5E6F8D'],
    ['--ui-dt-row-selected',          'rgba(27, 45, 84, .06)'],
    ['--ui-tab-indicator',            '#E40C0C'],
    ['--ui-control-border-focus',     '#1b2d54'],
    ['--ui-control-placeholder',      '#AAB4C8'],
    ['--ui-badge-success-solid',      '#15803d'],
    ['--ui-dialog-bg',                '#FFFFFF'],
    ['--ui-wizard-complete-bg',       '#15803d'],
    ['--ui-choice-border',            '#DBE3ED'],
    ['--ui-focus-outline-color',      '#1b2d54'],
  ];

  it.each(UNCHANGED)('%s still resolves to %s', (token, expected) => {
    expect(resolveToken(token, decls).value).toBe(expected);
  });
});

describe('semantic layer — the layer actually conducts', () => {
  /**
   * The proof that matters: publish ONE semantic override and check it reaches
   * the component variables that play that role — and only those.
   */
  it('an action-primary override repaints primary buttons and the tab indicator', () => {
    const brand = { '--ui-color-action-primary': '#0F766E' };
    expect(resolveToken('--ui-button-primary-bg', decls, brand).value).toBe('#0F766E');
    expect(resolveToken('--ui-tab-indicator', decls, brand).value).toBe('#0F766E');
    expect(resolveToken('--ui-button-link-fg-hover', decls, brand).value).toBe('#0F766E');
    // …and leaves the destructive action alone. A rebrand must never make
    // "delete" and "save" the same colour.
    expect(resolveToken('--ui-button-danger-bg', decls, brand).value).toBe('#dc2626');
  });

  it('an action-secondary override no longer reaches any filled control', () => {
    /* This role was doing two jobs. It fed the filled secondary button AND every
       selected/active/focus treatment in the kit — so once the brand engine
       stopped writing it (surfaces stay neutral), selected tabs, checked boxes,
       the wizard's current step and the focus outline all silently stopped
       following the brand. They now hang off `selection-border` / `focus-outline`.

       ⚠ With Button restyled to BTN-01 the role has only FOUR consumers left,
       all hover affordances on quiet controls (sort header, chip remove, dialog
       close, clear button). Its label — "Secondary action fill" — is now wider
       than its job; renaming it is a semantic-layer change, not a Button one. */
    const brand = { '--ui-color-action-secondary': '#3B0764' };
    expect(resolveToken('--ui-button-secondary-bg', decls, brand).value).not.toBe('#3B0764');
    for (const t of [
      '--ui-control-border-focus', '--ui-choice-bg-checked', '--ui-dialog-accent-color',
      '--ui-badge-accent-solid', '--ui-wizard-current-bg', '--ui-segmented-item-bg-selected',
      '--ui-focus-outline-color', '--ui-tab-fg-selected',
    ]) expect(resolveToken(t, decls, brand).value, t).not.toBe('#3B0764');
  });

  it('a selection-border override repaints every selected / active treatment', () => {
    const brand = { '--ui-color-selection-border': '#0F766E' };
    for (const t of [
      '--ui-tab-fg-selected', '--ui-tab-badge-bg-selected', '--ui-choice-bg-checked',
      '--ui-choice-border-checked', '--ui-segmented-item-bg-selected', '--ui-toggle-fg-on',
      '--ui-wizard-current-bg', '--ui-option-fg-active', '--ui-option-fg-selected',
      '--ui-dialog-accent-color', '--ui-badge-accent-solid', '--ui-card-tone-accent',
      '--ui-file-border-active',
    ]) expect(resolveToken(t, decls, brand).value, t).toBe('#0F766E');
  });

  it('a focus-outline override repaints the focus treatment everywhere', () => {
    const brand = { '--ui-color-focus-outline': '#0F766E' };
    for (const t of ['--ui-focus-outline-color', '--ui-control-border-focus']) {
      expect(resolveToken(t, decls, brand).value, t).toBe('#0F766E');
    }
  });

  it('a border-default override repaints card, table, menu and control edges', () => {
    const brand = { '--ui-color-border-default': '#123456' };
    for (const t of [
      '--ui-card-border', '--ui-dt-border', '--ui-dt-grid-line',
      '--ui-control-border', '--ui-menu-border', '--ui-tabs-rail',
    ]) expect(resolveToken(t, decls, brand).value, t).toBe('#123456');
  });

  it('a surface override repaints card fills without touching text', () => {
    const brand = { '--ui-color-surface-default': '#101418' };
    expect(resolveToken('--ui-card-bg', decls, brand).value).toBe('#101418');
    expect(resolveToken('--ui-dt-bg', decls, brand).value).toBe('#101418');
    expect(resolveToken('--ui-card-fg', decls, brand).value).toBe('#1F2A44');
  });

  it('a danger override repaints every destructive treatment at once', () => {
    const brand = { '--ui-color-danger': '#7F1D1D' };
    for (const t of [
      '--ui-button-danger-bg', '--ui-badge-danger-solid', '--ui-menu-item-fg-danger',
      '--ui-label-required-fg', '--ui-validation-error-fg', '--ui-wizard-invalid-bg',
    ]) expect(resolveToken(t, decls, brand).value, t).toBe('#7F1D1D');
  });
});

describe('semantic layer — the DEFAULT theme passes its own accessibility gate', () => {
  /* The gate blocked publishing a generated brand while the un-themed baseline
     quietly failed it — the canonical defaults were reproducing an inaccessible
     legacy rail colour. A standard the shipped default cannot meet is not a
     standard. Measured from the real CSS, so it cannot drift back. */
  const resolveRole = (role: string): string | null => resolveToken(role, decls).value;
  const results = evaluatePairings(resolveRole);

  it.each(results.map(r => [r.id, r] as const))('%s clears its threshold', (_id, r) => {
    expect(r.ratio, `${r.label}: ${r.ratio.toFixed(2)}:1 against a ${r.threshold}:1 bar`)
      .toBeGreaterThanOrEqual(r.threshold);
  });

  it('blocks nothing — no critical pairing fails on the defaults', () => {
    expect(publishBlocked(results).map(r => `${r.id} ${r.ratio.toFixed(2)}:1`)).toEqual([]);
  });

  it('keeps navigation text accessible AND still dimmer than the active row', () => {
    const idle   = results.find(r => r.id === 'nav-text')!;
    const active = results.find(r => r.id === 'nav-active')!;
    expect(idle.ratio).toBeGreaterThanOrEqual(AA_TEXT);
    // Hierarchy: the current page must still read as the emphasised row, so the
    // fix must not simply turn every nav label white.
    expect(idle.ratio).toBeLessThan(active.ratio);
  });

  it('does NOT copy the legacy rail colour, which fails AA at 3.12:1', () => {
    const navText = resolveToken('--ui-color-nav-text', decls).value;
    expect(navText?.toLowerCase()).not.toBe('#6b7a94');
    expect(contrastRatio('#6b7a94', '#1b2d54')).toBeLessThan(AA_TEXT);   // why it was replaced
  });
});

describe('semantic layer — the preview scope is a second root', () => {
  /* A var() substitutes where the property is DECLARED. A token block selected
     by `:root` alone resolves one level ABOVE the Gallery's preview scope, so a
     drafted semantic role can never reach it — which is exactly what happened
     to the primary button until the browser showed it. Every file that declares
     derived tokens must therefore also select the scope. */
  const TOKEN_FILES = ['src/ui/tokens/tokens.css', SEMANTIC_CSS, ...RECIPES];

  it.each(TOKEN_FILES)('%s declares its tokens on the preview scope too', file => {
    const css = read(file).replace(/\/\*[\s\S]*?\*\//g, '');
    const rootBlocks = [...css.matchAll(/([^{}]*):root[^{}]*\{/g)].map(m => m[0]);
    expect(rootBlocks.length).toBeGreaterThan(0);
    // The top-level token block is the first one; later `:root` blocks are
    // inside media queries and only adjust geometry, which no draft chains off.
    expect(rootBlocks[0]).toContain('[data-ui-preview-scope]');
  });
});

describe('semantic layer — recipe drift guard', () => {
  it('every --ui-color-* a recipe references is a declared role', () => {
    for (const file of RECIPES) {
      const refs = [...collectVarRefs(read(file))].filter(n => n.startsWith('--ui-color-'));
      for (const ref of refs) {
        expect(SEMANTIC_TOKEN_NAMES, `${file} references undeclared role ${ref}`).toContain(ref);
      }
    }
  });

  it('no canonical recipe still reads a brand palette colour directly', () => {
    /* Two documented exceptions, both the same shape: a value that renders in
       brand navy but plays neither an ACTION role nor a TEXT role, so every
       available mapping would be a lie or a silent recolour.
         control.recipe.css  — `--ui-control-fg` (typed field text),
                               `--ui-control-icon` (decorative control icon)
         Dialog.recipe.css   — `.ui-dialog-title` and `.ui-dialog-section-head
                               > h4` (brand-tinted headings)
       Inventing a role to turn this list green would be conformance for its own
       sake. They are resolved by the component migration, which decides whether
       the app wants navy headings and navy field text at all. */
    const ALLOWED = new Set([
      'src/ui/primitives/control.recipe.css',
      'src/ui/overlays/Dialog.recipe.css',
    ]);
    const BRAND = ['--siomac-red', '--siomac-red-dark', '--siomac-navy', '--siomac-navy-light'];
    for (const file of RECIPES) {
      if (ALLOWED.has(file)) continue;
      const refs = collectVarRefs(read(file));
      for (const b of BRAND) {
        expect(refs.has(b), `${file} should reach the palette through a semantic role, not ${b}`).toBe(false);
      }
    }
  });
});
