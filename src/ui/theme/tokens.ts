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

export const TOKEN_GROUPS: TokenGroup[] = [
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
];

/** Flat list of every editable token name. */
export const ALL_TOKEN_NAMES: string[] = TOKEN_GROUPS.flatMap(g => g.tokens.map(t => t.name));
