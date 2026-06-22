/**
 * src/ui/theme/tokens.ts
 *
 * The manifest of design tokens the superadmin theme editor can change. These
 * mirror the `:root` variables in assets/styles/base.css — the ONE place the
 * whole app reads its colours, spacing, radius and type from. Changing a token
 * re-themes every component (and every hover/focus state, since those reference
 * the same tokens) consistently.
 *
 * `kind`:
 *   'color' → rendered with a colour picker + hex field (solid hex tokens)
 *   'text'  → rendered with a text field (rgba tints, sizes, font stacks)
 */

export type TokenKind = 'color' | 'text';

export interface TokenDef {
  name:  string;   // CSS custom property, e.g. '--siomac-navy'
  label: string;
  kind:  TokenKind;
  hint?: string;
}

export interface TokenGroup {
  id:     string;
  label:  string;
  desc:   string;
  tokens: TokenDef[];
}

export const TOKEN_GROUPS: TokenGroup[] = [
  {
    id: 'brand', label: 'Brand', desc: 'Primary identity colours used for CTAs, headers and accents.',
    tokens: [
      { name: '--siomac-red',        label: 'Red (primary CTA)', kind: 'color' },
      { name: '--siomac-red-dark',   label: 'Red — dark/hover',  kind: 'color' },
      { name: '--siomac-navy',       label: 'Navy (primary)',    kind: 'color' },
      { name: '--siomac-navy-light', label: 'Navy — light',      kind: 'color' },
      { name: '--siomac-gold',       label: 'Gold',              kind: 'color' },
      { name: '--siomac-blue',       label: 'Blue',              kind: 'color' },
    ],
  },
  {
    id: 'surface', label: 'Surfaces', desc: 'Page, card, panel and border fills.',
    tokens: [
      { name: '--bg-app',    label: 'App background',  kind: 'color' },
      { name: '--bg-card',   label: 'Card background', kind: 'color' },
      { name: '--bg-subtle', label: 'Subtle / header', kind: 'color' },
      { name: '--border',    label: 'Border',          kind: 'color' },
    ],
  },
  {
    id: 'text', label: 'Text', desc: 'Foreground text colours.',
    tokens: [
      { name: '--text-primary', label: 'Primary text', kind: 'color' },
      { name: '--text-muted',   label: 'Muted text',   kind: 'color' },
    ],
  },
  {
    id: 'status', label: 'Status — solid', desc: 'The bright status family used for chips, deltas and signal dots.',
    tokens: [
      { name: '--st-danger',  label: 'Danger',  kind: 'color' },
      { name: '--st-warning', label: 'Warning', kind: 'color' },
      { name: '--st-success', label: 'Success', kind: 'color' },
      { name: '--st-info',    label: 'Info',    kind: 'color' },
      { name: '--st-neutral', label: 'Neutral', kind: 'color' },
      { name: '--st-purple',  label: 'Purple (workflow)', kind: 'color' },
    ],
  },
  {
    id: 'status-strong', label: 'Status — strong', desc: 'Darker text-on-light variants of each status colour.',
    tokens: [
      { name: '--st-danger-strong',  label: 'Danger — strong',  kind: 'color' },
      { name: '--st-warning-strong', label: 'Warning — strong', kind: 'color' },
      { name: '--st-success-strong', label: 'Success — strong', kind: 'color' },
      { name: '--st-info-strong',    label: 'Info — strong',    kind: 'color' },
    ],
  },
  {
    id: 'status-tint', label: 'Status — tint', desc: 'Soft fills for icon circles and chip backgrounds (rgba — edit as text).',
    tokens: [
      { name: '--st-danger-tint',  label: 'Danger — tint',  kind: 'text', hint: 'rgba(…)' },
      { name: '--st-warning-tint', label: 'Warning — tint', kind: 'text', hint: 'rgba(…)' },
      { name: '--st-success-tint', label: 'Success — tint', kind: 'text', hint: 'rgba(…)' },
      { name: '--st-info-tint',    label: 'Info — tint',    kind: 'text', hint: 'rgba(…)' },
      { name: '--st-neutral-tint', label: 'Neutral — tint', kind: 'text', hint: 'rgba(…)' },
      { name: '--st-purple-tint',  label: 'Purple — tint',  kind: 'text', hint: 'rgba(…)' },
    ],
  },
  {
    id: 'spacing', label: 'Spacing', desc: 'The 4px spacing scale used for gaps, padding and margins.',
    tokens: [
      { name: '--space-1',  label: 'space-1',  kind: 'text', hint: 'px' },
      { name: '--space-2',  label: 'space-2',  kind: 'text', hint: 'px' },
      { name: '--space-3',  label: 'space-3',  kind: 'text', hint: 'px' },
      { name: '--space-4',  label: 'space-4',  kind: 'text', hint: 'px' },
      { name: '--space-5',  label: 'space-5',  kind: 'text', hint: 'px' },
      { name: '--space-6',  label: 'space-6',  kind: 'text', hint: 'px' },
      { name: '--space-8',  label: 'space-8',  kind: 'text', hint: 'px' },
      { name: '--space-10', label: 'space-10', kind: 'text', hint: 'px' },
      { name: '--space-12', label: 'space-12', kind: 'text', hint: 'px' },
    ],
  },
  {
    id: 'radius', label: 'Radius', desc: 'Corner radii for chips, cards, panels and pills.',
    tokens: [
      { name: '--radius-xs',   label: 'radius-xs',   kind: 'text', hint: 'px' },
      { name: '--radius-sm',   label: 'radius-sm',   kind: 'text', hint: 'px' },
      { name: '--radius-md',   label: 'radius-md',   kind: 'text', hint: 'px' },
      { name: '--radius-lg',   label: 'radius-lg',   kind: 'text', hint: 'px' },
      { name: '--radius-pill', label: 'radius-pill', kind: 'text', hint: 'px' },
    ],
  },
  {
    id: 'type', label: 'Typography', desc: 'Font stacks. UI text, navigation and tabular/mono numerics.',
    tokens: [
      { name: '--font-sans', label: 'UI font',   kind: 'text' },
      { name: '--font-nav',  label: 'Nav font',  kind: 'text' },
      { name: '--font-mono', label: 'Mono font', kind: 'text' },
    ],
  },
];

/** Flat list of every editable token name. */
export const ALL_TOKEN_NAMES: string[] = TOKEN_GROUPS.flatMap(g => g.tokens.map(t => t.name));
