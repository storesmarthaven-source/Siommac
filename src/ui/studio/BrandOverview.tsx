/**
 * src/ui/studio/BrandOverview.tsx — "what will this company's SIOMAC look like?"
 *
 * Presentation and composition around the EXISTING brand engine. Nothing here
 * generates a palette: `brandThemeToTokens` already does that, already refuses
 * to write the roles the enterprise policy keeps neutral, and already never
 * emits an operational colour. This file arranges its output so a non-technical
 * reader can judge it without reading a CSS variable name.
 *
 * ⭐ Specimens come from the REGISTRY, via `def.render(...)` — the same call the
 * workbench makes. That is what makes "change Button.recipe.css and both the
 * workbench and the Brand board update" structurally true rather than a promise:
 * there is one specimen source, so a bespoke Brand-page reproduction cannot
 * drift from the component it claims to preview.
 *
 * ⭐ Two UI layers. The Studio chrome is a fixed reference frame and never takes
 * the customer's colour; only `data-ui-preview-scope` surfaces do. A green logo
 * must not turn the sidebar, the direction switch or Apply & Publish green, or
 * there is nothing stable left to judge the theme against.
 */

import { type VNode } from 'preact';
import { useState, useMemo } from 'preact/hooks';
import {
  brandThemeToTokens, brandThemeFromTokens, brandTokenNames,
  SEED_PRIMARY_TOKEN, SEED_ACCENT_TOKEN,
} from '../theme/brand/brandTheme';
import { type GalleryDraft } from '../gallery/galleryStore';
import { BrandThemePanel } from '../gallery/BrandThemePanel';
import { findComponent, defaultProps } from '../registry';

/* ── Theme direction ────────────────────────────────────────────────────────
   Three MAPPING POLICIES over one generated palette — not three themes and not
   three engines. Each is a subset of what the engine already emitted, so the
   colours are identical and only their REACH changes.

   None of them can touch success/warning/danger/info (the engine never emits
   those) or card/dialog/table/input surfaces (`NEUTRAL_BY_POLICY` throws). That
   protection is structural, not a rule this file has to remember. */

const ROLE_ACTION = ['--ui-color-action-primary', '--ui-color-action-primary-hover', '--ui-color-action-primary-text'];
const ROLE_FOCUS = ['--ui-color-focus-outline', '--ui-color-focus-ring'];
const ROLE_SELECTION_EDGE = ['--ui-color-selection-border'];
const ROLE_SELECTION_FILL = ['--ui-color-selection-background'];
const ROLE_NAV_ACTIVE = ['--ui-color-nav-active-background', '--ui-color-nav-active-indicator', '--ui-color-nav-active-text'];
const ROLE_LINK = ['--ui-color-text-link'];
const SEEDS = [SEED_PRIMARY_TOKEN, SEED_ACCENT_TOKEN];

export type ThemeDirection = 'enterprise' | 'balanced' | 'forward';

export const DIRECTIONS: { id: ThemeDirection; label: string; blurb: string; roles: string[] }[] = [
  { id: 'enterprise', label: 'Enterprise', blurb: 'Most restrained. A neutral application shell, with the brand carried by key actions, focus and selection.',
    roles: [...SEEDS, ...ROLE_ACTION, ...ROLE_FOCUS, ...ROLE_SELECTION_EDGE] },
  { id: 'balanced', label: 'Balanced', blurb: 'Stronger branded indicators and more visible active states. Data and form surfaces stay neutral.',
    roles: [...SEEDS, ...ROLE_ACTION, ...ROLE_FOCUS, ...ROLE_SELECTION_EDGE, ...ROLE_SELECTION_FILL, ...ROLE_NAV_ACTIVE] },
  { id: 'forward', label: 'Brand Forward', blurb: 'The strongest professional brand presence. Still no branded dialog, card, table or input surfaces, and operational colours are untouched.',
    roles: [...SEEDS, ...ROLE_ACTION, ...ROLE_FOCUS, ...ROLE_SELECTION_EDGE, ...ROLE_SELECTION_FILL, ...ROLE_NAV_ACTIVE, ...ROLE_LINK] },
];

/* ── Component System board ─────────────────────────────────────────────────
   Registry ids per tile. A tile shows nothing rather than a fake if a component
   is not built yet — the catalogue already reports the gap honestly. */

const BOARD: { title: string; ids: string[] }[] = [
  { title: 'Buttons',          ids: ['button', 'segmented-control'] },
  { title: 'Inputs & Select',  ids: ['text-input', 'select'] },
  { title: 'Badges & Status',  ids: ['badge'] },
  { title: 'Cards',            ids: ['card'] },
  { title: 'Tabs & Stepper',   ids: ['tabs', 'wizard'] },
  { title: 'Data',             ids: ['data-table'] },
  { title: 'Menu & Dialog',    ids: ['menu', 'dialog'] },
  { title: 'Choice controls',  ids: ['checkbox', 'radio-group', 'switch'] },
];

function Specimen({ id }: { id: string }): VNode | null {
  const def = findComponent(id);
  if (!def?.render) return null;
  return (
    <div class="sds-bo__spec">
      <span class="sds-bo__specname">{def.name}</span>
      <div>{def.render(defaultProps(def), 'default')}</div>
    </div>
  );
}

/* ── Swatches ──────────────────────────────────────────────────────────────── */

function Swatch({ value, label, big }: { value: string; label: string; big?: boolean }): VNode {
  return (
    <div class={`sds-sw${big ? ' sds-sw--big' : ''}`}>
      <div class="sds-sw__chip" style={{ background: value || 'transparent' }} />
      <div class="sds-sw__meta">
        <strong>{label}</strong>
        <code>{value || '—'}</code>
      </div>
    </div>
  );
}

/* ── Brand Overview ────────────────────────────────────────────────────────── */

export function BrandOverview({ draft, logoUrl, onUploadLogo }: {
  draft: GalleryDraft;
  logoUrl?: string | null;
  onUploadLogo?: (dataUrl: string) => Promise<string>;
}): VNode {
  /* Destructured up front: the lint rule cannot tell a function-valued member
     of a PROP object from a ref callback, and these read better besides. */
  const { read, attachScope, replaceGroup, publish: publishDraft, dirtyCount } = draft;
  const [direction, setDirection] = useState<ThemeDirection>('balanced');
  const [publishing, setPublishing] = useState(false);
  const [advanced, setAdvanced] = useState(false);

  /* The seeds in force — drafted if the operator is mid-edit, published
     otherwise, so reopening shows the theme that is actually applied. */
  const theme = brandThemeFromTokens({
    [SEED_PRIMARY_TOKEN]: read(SEED_PRIMARY_TOKEN),
    [SEED_ACCENT_TOKEN]: read(SEED_ACCENT_TOKEN),
  });

  const build = useMemo(
    () => (theme ? brandThemeToTokens(theme.seeds) : null),
    [theme?.seeds.primary, theme?.seeds.accent],
  );

  /** Re-emit the generated palette through the chosen direction's role subset.
   *  `replaceGroup` hands the whole brand namespace over at once, so roles a
   *  narrower direction stops writing are DROPPED rather than left painting the
   *  preview from the previous selection. */
  const applyDirection = (id: ThemeDirection): void => {
    setDirection(id);
    if (!build) return;
    const allowed = new Set(DIRECTIONS.find(d => d.id === id)!.roles);
    const filtered: Record<string, string> = {};
    for (const [name, value] of Object.entries(build.tokens)) {
      if (allowed.has(name)) filtered[name] = value;
    }
    replaceGroup(brandTokenNames(), filtered);
  };

  const publish = async (): Promise<void> => {
    setPublishing(true);
    try { await publishDraft(); } finally { setPublishing(false); }
  };

  const primary = read('--ui-color-action-primary');
  const accent = read('--ui-color-selection-border');

  return (
    <div class="sds-bo">
      {/* ── Header: identity + status + direction + publish (NEUTRAL chrome) ── */}
      <header class="sds-bo__bar">
        <div class="sds-bo__id">
          {logoUrl
            ? <img class="sds-bo__logo" src={logoUrl} alt="Company logo" />
            : <div class="sds-bo__logo sds-bo__logo--empty">No logo</div>}
          <div>
            <strong>Brand Theme</strong>
            <span class="sds-bo__status">
              {dirtyCount > 0
                ? `Draft — ${dirtyCount} variable${dirtyCount === 1 ? '' : 's'} changed, not published`
                : 'Published'}
            </span>
          </div>
        </div>

        <div class="sds-bo__actions">
          <div class="sds-seg" role="group" aria-label="Theme direction">
            {DIRECTIONS.map(d => (
              <button type="button" key={d.id}
                class={`sds-seg__btn${d.id === direction ? ' is-on' : ''}`}
                aria-pressed={d.id === direction}
                onClick={() => applyDirection(d.id)}>{d.label}</button>
            ))}
          </div>
          <button type="button" class="sds-bo__publish"
            disabled={dirtyCount === 0 || publishing}
            onClick={() => { void publish(); }}>
            {publishing ? 'Publishing…' : 'Apply & Publish'}
          </button>
        </div>
      </header>
      <p class="sds-bo__blurb">{DIRECTIONS.find(d => d.id === direction)?.blurb}</p>

      {!theme && (
        <div class="sds-placeholder">
          <h3>No brand theme yet</h3>
          <p>Upload a company logo in <strong>Advanced Theme Details</strong> below to extract a palette. Nothing is published until you choose Apply &amp; Publish.</p>
        </div>
      )}

      {/* ── Everything below is THEMED. The chrome above is not. ── */}
      <div data-ui-preview-scope ref={attachScope}>
        <section class="sds-bo__section">
          <h3>Brand Overview</h3>
          <div class="sds-bo__three">
            <div class="sds-bo__panel">
              <h4>Company Identity</h4>
              {logoUrl
                ? <img class="sds-bo__biglogo" src={logoUrl} alt="" />
                : <div class="sds-bo__biglogo sds-bo__logo--empty">No logo</div>}
              <p class="sds-bo__hint">{dirtyCount > 0 ? 'Draft in progress' : 'Published theme'}</p>
            </div>

            <div class="sds-bo__panel">
              <h4>Brand Palette</h4>
              <Swatch big label="Primary" value={primary} />
              <Swatch big label="Selection" value={accent} />
              <div class="sds-bo__sws">
                <Swatch label="Primary hover" value={read('--ui-color-action-primary-hover')} />
                <Swatch label="Focus" value={read('--ui-color-focus-outline')} />
                <Swatch label="Link" value={read('--ui-color-text-link')} />
              </div>
            </div>

            <div class="sds-bo__panel">
              <h4>Semantic Roles</h4>
              <dl class="sds-bo__roles">
                <div><dt>Actions</dt><dd>Primary action, hover, label</dd></div>
                <div><dt>Navigation</dt><dd>Active item wash, indicator, text</dd></div>
                <div><dt>Selection</dt><dd>Selected row and control edge</dd></div>
                <div><dt>Focus</dt><dd>Keyboard focus ring</dd></div>
                <div><dt>Surfaces</dt><dd>Neutral by policy — never branded</dd></div>
                <div><dt>Operational</dt><dd>Success, warning, danger, info — never branded</dd></div>
              </dl>
            </div>
          </div>
        </section>

        <section class="sds-bo__section">
          <h3>Component System</h3>
          <p class="sds-bo__hint">Real canonical components, rendered from the registry — the same source the workbench uses.</p>
          <div class="sds-bo__board">
            {BOARD.map(tile => (
              <div class="sds-bo__tile" key={tile.title}>
                <h4>{tile.title}</h4>
                <div class="sds-bo__tilebody">
                  {tile.ids.map(id => <Specimen id={id} key={id} />)}
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>

      <section class="sds-bo__section">
        <h3>Application Preview</h3>
        <div class="sds-placeholder">
          <p>Dashboard, Forms, Data and Workflow previews arrive in Studio phase 4. Not yet implemented here, and deliberately not faked.</p>
        </div>
      </section>

      {/* ── Progressive disclosure: the existing panel, unchanged ── */}
      <section class="sds-bo__section">
        <button type="button" class="sds-bo__disclose" aria-expanded={advanced}
          onClick={() => setAdvanced(v => !v)}>
          {advanced ? '▾' : '▸'} Advanced Theme Details
        </button>
        <p class="sds-bo__hint">
          Logo extraction, HCT scales, the legibility adjustments, the full role mapping, WCAG ratios and token values.
        </p>
        {advanced && (
          <div class="sds-bo__advanced" data-ui-preview-scope>
            <BrandThemePanel draft={draft} logoUrl={logoUrl ?? null} onUploadLogo={onUploadLogo} />
          </div>
        )}
      </section>
    </div>
  );
}
