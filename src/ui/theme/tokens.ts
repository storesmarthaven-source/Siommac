/**
 * src/ui/theme/tokens.ts
 *
 * The manifest of design tokens the superadmin theme editor can change. These
 * mirror the `:root` variables in assets/styles/base.css — the ONE place the
 * whole app reads its colours, spacing, radius, type and interaction states
 * from. Changing a token re-themes every component (and every hover/focus
 * state, since those reference the same tokens) consistently.
 *
 * `kind`:
 *   'color'       → colour picker (opaque hex)
 *   'color-alpha' → colour picker WITH an opacity slider (rgba output)
 *   'select'      → fixed set of options (e.g. font weights)
 *   'text'        → free text (sizes, font stacks)
 */

import { SEMANTIC_GROUPS, semanticRolesIn } from './semanticTokens';

export type TokenKind = 'color' | 'color-alpha' | 'select' | 'text';

export interface TokenDef {
  name:     string;   // CSS custom property, e.g. '--siomac-navy'
  label:    string;   // descriptive, says what it controls
  kind:     TokenKind;
  hint?:    string;
  options?: readonly { value: string; label: string }[];
}

export interface TokenGroup {
  id:     string;
  label:  string;
  desc:   string;
  tokens: TokenDef[];
}

const WEIGHT_OPTIONS = [
  { value: '400', label: '400 — Regular' },
  { value: '500', label: '500 — Medium' },
  { value: '600', label: '600 — Semibold' },
  { value: '700', label: '700 — Bold' },
] as const;

/* ── Semantic colour roles (src/ui/tokens/semantic.css) ──────────────────────
   Generated from the ONE manifest in ./semanticTokens.ts rather than retyped,
   so a role can never exist in the editor and not in the CSS (or the reverse).
   They lead the list because they are the layer you re-theme from: editing a
   ROLE changes every canonical component that plays that role, while editing a
   brand colour below changes only what still reads the palette directly. */
const SEMANTIC_TOKEN_GROUPS: TokenGroup[] = SEMANTIC_GROUPS.map(g => ({
  id:     `semantic-${g.id}`,
  label:  `Semantic — ${g.label}`,
  desc:   g.desc,
  tokens: semanticRolesIn(g.id).map<TokenDef>(r => ({
    name:  r.name,
    label: r.label,
    kind:  r.alpha ? 'color-alpha' : 'color',
    hint:  `defaults from ${r.defaultsFrom}${r.brandDriven ? '' : ' · not brand-driven'}`,
  })),
}));

export const TOKEN_GROUPS: TokenGroup[] = [
  ...SEMANTIC_TOKEN_GROUPS,
  {
    id: 'brand', label: 'Brand colours', desc: 'Primary identity colours for buttons, headers, links and accents.',
    tokens: [
      { name: '--siomac-red',        label: 'Primary action (buttons, key CTAs)', kind: 'color' },
      { name: '--siomac-red-dark',   label: 'Primary action — hover/pressed',     kind: 'color' },
      { name: '--siomac-navy',       label: 'Primary brand (sidebar, headings, icons)', kind: 'color' },
      { name: '--siomac-navy-light', label: 'Brand — lighter accent',             kind: 'color' },
      { name: '--siomac-gold',       label: 'Gold accent (highlights, badges)',   kind: 'color' },
      { name: '--siomac-blue',       label: 'Secondary blue accent',              kind: 'color' },
    ],
  },
  {
    id: 'surface', label: 'Surfaces & borders', desc: 'The page, card and panel fills, and the divider/border colour.',
    tokens: [
      { name: '--bg-app',    label: 'App background (behind everything)', kind: 'color' },
      { name: '--bg-card',   label: 'Card / panel background',            kind: 'color' },
      { name: '--bg-subtle', label: 'Subtle fill (headers, footers, wells)', kind: 'color' },
      { name: '--border',    label: 'Borders & dividers',                 kind: 'color' },
    ],
  },
  {
    id: 'text', label: 'Text colours', desc: 'Foreground colours for primary and secondary text.',
    tokens: [
      { name: '--text-primary', label: 'Primary text (body, headings)',         kind: 'color' },
      { name: '--text-muted',   label: 'Muted text (labels, captions, hints)',  kind: 'color' },
    ],
  },
  {
    id: 'status', label: 'Status colours', desc: 'The bright status family used for chips, KPI deltas and signal dots.',
    tokens: [
      { name: '--st-danger',  label: 'Danger / critical (red)',      kind: 'color' },
      { name: '--st-warning', label: 'Warning / caution (amber)',    kind: 'color' },
      { name: '--st-success', label: 'Success / positive (green)',   kind: 'color' },
      { name: '--st-info',    label: 'Info / neutral-positive (blue)', kind: 'color' },
      { name: '--st-neutral', label: 'Neutral (grey)',               kind: 'color' },
      { name: '--st-purple',  label: 'Workflow / in-review (purple)', kind: 'color' },
    ],
  },
  {
    id: 'status-strong', label: 'Status — strong text', desc: 'Darker variants used when status colour is text on a light fill.',
    tokens: [
      { name: '--st-danger-strong',  label: 'Danger — strong text',  kind: 'color' },
      { name: '--st-warning-strong', label: 'Warning — strong text', kind: 'color' },
      { name: '--st-success-strong', label: 'Success — strong text', kind: 'color' },
      { name: '--st-info-strong',    label: 'Info — strong text',    kind: 'color' },
    ],
  },
  {
    id: 'status-tint', label: 'Status — soft fills', desc: 'Translucent fills behind status icons and chip backgrounds. Adjust the colour and its opacity.',
    tokens: [
      { name: '--st-danger-tint',  label: 'Danger — chip/icon fill',  kind: 'color-alpha' },
      { name: '--st-warning-tint', label: 'Warning — chip/icon fill', kind: 'color-alpha' },
      { name: '--st-success-tint', label: 'Success — chip/icon fill', kind: 'color-alpha' },
      { name: '--st-info-tint',    label: 'Info — chip/icon fill',    kind: 'color-alpha' },
      { name: '--st-neutral-tint', label: 'Neutral — chip/icon fill', kind: 'color-alpha' },
      { name: '--st-purple-tint',  label: 'Workflow — chip/icon fill', kind: 'color-alpha' },
    ],
  },
  {
    id: 'interaction', label: 'Interaction states', desc: 'Hover and focus feedback. These cascade to every table, list and input in the app.',
    tokens: [
      { name: '--row-hover',  label: 'Table / list row hover fill', kind: 'color' },
      { name: '--focus-ring', label: 'Input focus ring (colour + opacity)', kind: 'color-alpha' },
    ],
  },
  {
    id: 'weight', label: 'Font weights', desc: 'The emphasis ramp used by labels, titles and bold text.',
    tokens: [
      { name: '--font-weight-normal',   label: 'Body / regular text',       kind: 'select', options: WEIGHT_OPTIONS },
      { name: '--font-weight-medium',   label: 'Medium emphasis',           kind: 'select', options: WEIGHT_OPTIONS },
      { name: '--font-weight-semibold', label: 'Field labels / sub-headers', kind: 'select', options: WEIGHT_OPTIONS },
      { name: '--font-weight-bold',     label: 'Titles / strong emphasis',  kind: 'select', options: WEIGHT_OPTIONS },
    ],
  },
  {
    id: 'spacing', label: 'Spacing scale', desc: 'The 4px rhythm used for gaps, padding and margins. Larger values loosen the whole UI.',
    tokens: [
      { name: '--space-1',  label: 'Tightest — inline icon gaps (4px)',     kind: 'text', hint: 'px' },
      { name: '--space-2',  label: 'Tight — chip/button padding (8px)',     kind: 'text', hint: 'px' },
      { name: '--space-3',  label: 'Snug — control gaps (12px)',            kind: 'text', hint: 'px' },
      { name: '--space-4',  label: 'Base — card padding (16px)',            kind: 'text', hint: 'px' },
      { name: '--space-5',  label: 'Comfortable — section padding (20px)',  kind: 'text', hint: 'px' },
      { name: '--space-6',  label: 'Roomy — between sections (24px)',       kind: 'text', hint: 'px' },
      { name: '--space-8',  label: 'Large — block separation (32px)',       kind: 'text', hint: 'px' },
      { name: '--space-10', label: 'X-large — major groups (40px)',         kind: 'text', hint: 'px' },
      { name: '--space-12', label: 'Largest — page-level gaps (48px)',      kind: 'text', hint: 'px' },
    ],
  },
  {
    id: 'radius', label: 'Corner radius', desc: 'How rounded each element is, from small controls up to large panels.',
    tokens: [
      { name: '--radius-xs',   label: 'Extra-small — swatches, mini chips', kind: 'text', hint: 'px' },
      { name: '--radius-sm',   label: 'Small — inputs, buttons, chips',     kind: 'text', hint: 'px' },
      { name: '--radius-md',   label: 'Medium — cards, modals',            kind: 'text', hint: 'px' },
      { name: '--radius-lg',   label: 'Large — hero panels',               kind: 'text', hint: 'px' },
      { name: '--radius-pill', label: 'Pill — fully rounded (tabs, dots)',  kind: 'text', hint: 'px' },
    ],
  },
  {
    id: 'type', label: 'Typography', desc: 'Font stacks for UI text, the navigation rail and tabular/mono numerics.',
    tokens: [
      { name: '--font-sans', label: 'UI font (body & headings)',   kind: 'text' },
      { name: '--font-nav',  label: 'Navigation rail font',        kind: 'text' },
      { name: '--font-mono', label: 'Mono font (IDs, figures)',    kind: 'text' },
    ],
  },

  /* ── UI Kit v2 foundations (src/ui/tokens/tokens.css) ──────────────────────
     Added by the v2 programme. base.css never owned control heights or type
     SIZES, which is why those values ended up hardcoded in ~4,000 inline
     styles. Editing them here re-scales every canonical component at once. */
  {
    id: 'control', label: 'Control sizing', desc: 'The three canonical interactive heights and their paired horizontal padding. Every button, input, select and combobox sizes from these.',
    tokens: [
      { name: '--ui-control-sm',     label: 'Small control height',   kind: 'text', hint: 'px' },
      { name: '--ui-control-md',     label: 'Medium control height (default)', kind: 'text', hint: 'px' },
      { name: '--ui-control-lg',     label: 'Large control height',   kind: 'text', hint: 'px' },
      { name: '--ui-control-pad-sm', label: 'Small — horizontal padding',  kind: 'text', hint: 'px' },
      { name: '--ui-control-pad-md', label: 'Medium — horizontal padding', kind: 'text', hint: 'px' },
      { name: '--ui-control-pad-lg', label: 'Large — horizontal padding',  kind: 'text', hint: 'px' },
    ],
  },
  {
    id: 'typescale', label: 'Type scale', desc: 'Font sizes for each role. The font FAMILIES and WEIGHTS are set above; these are the sizes.',
    tokens: [
      { name: '--ui-font-size-caption', label: 'Caption — micro-labels, table meta', kind: 'text', hint: 'rem' },
      { name: '--ui-font-size-label',   label: 'Label — field labels, chips',        kind: 'text', hint: 'rem' },
      { name: '--ui-font-size-button',  label: 'Button text',                        kind: 'text', hint: 'rem' },
      { name: '--ui-font-size-body-sm', label: 'Body small — dense text, table cells', kind: 'text', hint: 'rem' },
      { name: '--ui-font-size-body',    label: 'Body — inputs, standard text',       kind: 'text', hint: 'rem' },
      { name: '--ui-font-size-section', label: 'Section heading',                    kind: 'text', hint: 'rem' },
      { name: '--ui-font-size-title',   label: 'Title — dialogs, page headers',      kind: 'text', hint: 'rem' },
      { name: '--ui-line-height-tight', label: 'Line height — tight (headings)',     kind: 'text' },
      { name: '--ui-line-height-base',  label: 'Line height — base (body)',          kind: 'text' },
    ],
  },
  {
    id: 'icon', label: 'Icons', desc: 'Icon geometry for the Lucide set. Kit components take icon nodes, so these are the only place icon size is decided.',
    tokens: [
      { name: '--ui-icon-sm',     label: 'Small icon',   kind: 'text', hint: 'px' },
      { name: '--ui-icon-md',     label: 'Medium icon',  kind: 'text', hint: 'px' },
      { name: '--ui-icon-lg',     label: 'Large icon',   kind: 'text', hint: 'px' },
      { name: '--ui-icon-stroke', label: 'Stroke weight', kind: 'text' },
    ],
  },
  {
    id: 'focus', label: 'Focus & borders', desc: 'Keyboard-focus geometry and the default border width. The focus COLOUR is under Interaction states above.',
    tokens: [
      { name: '--ui-focus-ring-width',    label: 'Soft focus ring width',    kind: 'text', hint: 'px' },
      { name: '--ui-focus-outline-width', label: 'Keyboard outline width',   kind: 'text', hint: 'px' },
      { name: '--ui-focus-outline-color', label: 'Keyboard outline colour',  kind: 'color' },
      { name: '--ui-border-width',        label: 'Default border width',     kind: 'text', hint: 'px' },
      { name: '--ui-border-width-thick',  label: 'Emphasis border width',    kind: 'text', hint: 'px' },
    ],
  },
  {
    id: 'motion', label: 'Motion', desc: 'Transition durations and easing. All are forced to 0ms when the OS requests reduced motion.',
    tokens: [
      { name: '--ui-motion-fast',      label: 'Fast — hover/colour changes', kind: 'text', hint: 'ms' },
      { name: '--ui-motion-base',      label: 'Base — most transitions',     kind: 'text', hint: 'ms' },
      { name: '--ui-motion-slow',      label: 'Slow — overlays, panels',     kind: 'text', hint: 'ms' },
      { name: '--ui-ease-standard',    label: 'Standard easing',             kind: 'text' },
      { name: '--ui-ease-emphasized',  label: 'Emphasized easing',           kind: 'text' },
    ],
  },
  {
    id: 'inert', label: 'Disabled & read-only', desc: 'Two DIFFERENT states with two different token sets. Neither is an opacity fade — that dims real data the user is still meant to read.',
    tokens: [
      { name: '--ui-disabled-bg',     label: 'Disabled — background', kind: 'color' },
      { name: '--ui-disabled-border', label: 'Disabled — border',     kind: 'color' },
      { name: '--ui-disabled-fg',     label: 'Disabled — text',       kind: 'color' },
      { name: '--ui-disabled-icon',   label: 'Disabled — icon',       kind: 'color' },
      { name: '--ui-readonly-bg',     label: 'Read-only — background', kind: 'color' },
      { name: '--ui-readonly-border', label: 'Read-only — border',    kind: 'color' },
      { name: '--ui-readonly-fg',     label: 'Read-only — text (stays legible)', kind: 'color' },
    ],
  },
  {
    id: 'validation', label: 'Validation', desc: 'ONE visual language for error, warning and success across every module. Nothing may define its own error red.',
    tokens: [
      { name: '--ui-validation-error-border',   label: 'Error — border',   kind: 'color' },
      { name: '--ui-validation-error-fg',       label: 'Error — text/icon', kind: 'color' },
      { name: '--ui-validation-error-ring',     label: 'Error — focus ring', kind: 'color-alpha' },
      { name: '--ui-validation-warning-border', label: 'Warning — border',  kind: 'color' },
      { name: '--ui-validation-warning-fg',     label: 'Warning — text/icon', kind: 'color' },
      { name: '--ui-validation-warning-ring',   label: 'Warning — focus ring', kind: 'color-alpha' },
      { name: '--ui-validation-success-border', label: 'Success — border',  kind: 'color' },
      { name: '--ui-validation-success-fg',     label: 'Success — text/icon', kind: 'color' },
      { name: '--ui-validation-success-ring',   label: 'Success — focus ring', kind: 'color-alpha' },
    ],
  },
];

/** Flat list of every editable token name. */
export const ALL_TOKEN_NAMES: string[] = TOKEN_GROUPS.flatMap(g => g.tokens.map(t => t.name));
