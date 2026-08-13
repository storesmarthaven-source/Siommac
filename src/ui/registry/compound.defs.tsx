/**
 * src/ui/registry/compound.defs.tsx — the compound action controls.
 *
 * DropdownButton and SplitButton get their own definitions because their
 * INTERACTION genuinely differs, which is the design system's only justification
 * for a separate component:
 *
 *   Button          performs one action
 *   DropdownButton  reveals a set of actions
 *   SplitButton     performs a default action AND reveals alternatives
 *
 * That is not "Finance Button / HR Button" proliferation — those would differ
 * only by appearance, which is what props are for. These differ by what happens
 * when you press them, and by what a screen reader must announce.
 *
 * ⭐ Neither is a second visual implementation. They COMPOSE the canonical
 * primitives — Button's appearance plus Menu's behaviour — so a change to
 * Button.recipe.css moves them too and they cannot drift into a third button
 * look. They were previously demonstrated inside the `menu` definition behind a
 * `trigger` switch, which meant selecting one showed Menu's property panel
 * rather than its own.
 */

import { LucideIcon } from '../LucideIcon';
import { DropdownButton, SplitButton } from '../primitives/actions';
import { type MenuItems } from '../overlays/DropdownMenu';
import { type ControlSize } from '../tokens';
import { type ComponentDef, type PropValues } from './types';

const s = (v: PropValues[string] | undefined, fallback = ''): string =>
  typeof v === 'string' && v !== '' ? v : fallback;
const b = (v: PropValues[string] | undefined): boolean => v === true;
const size = (v: PropValues[string] | undefined): ControlSize => (v === 'sm' || v === 'lg' ? v : 'md');

const RECORD_MENU: MenuItems = [
  { label: 'Record', items: [
    { id: 'edit',      label: 'Edit details',  icon: <LucideIcon name="Pencil" />, shortcut: '⌘E' },
    { id: 'duplicate', label: 'Duplicate',     icon: <LucideIcon name="Copy" /> },
    { id: 'export',    label: 'Export to CSV', icon: <LucideIcon name="Download" /> },
  ] },
  { label: 'Danger zone', items: [
    { id: 'archive', label: 'Archive', icon: <LucideIcon name="Archive" />, disabled: true },
    { id: 'delete',  label: 'Delete',  icon: <LucideIcon name="Trash2" />, danger: true },
  ] },
];

const SAVE_ALTERNATIVES: MenuItems = [
  { id: 'save-close', label: 'Save and close',   icon: <LucideIcon name="CheckCheck" /> },
  { id: 'save-draft', label: 'Save as draft',    icon: <LucideIcon name="FileText" /> },
  { id: 'save-new',   label: 'Save and add new', icon: <LucideIcon name="Plus" /> },
];

const VARIANTS = ['primary', 'secondary', 'outline', 'ghost', 'danger'] as const;

/* ── DropdownButton ────────────────────────────────────────────────────────*/

const dropdownButtonDef: ComponentDef = {
  id: 'dropdown-button',
  name: 'DropdownButton',
  category: 'actions',
  description:
    'Compound control — Button appearance + Menu behaviour. Pressing it does not perform the ' +
    'action; it reveals a set of them. Use when several related actions share one place in the ' +
    'layout, like Export ▾ offering PDF, Excel and CSV.',
  status: 'stable',
  componentPath: 'src/ui/primitives/actions.tsx',
  importFrom: '@ui',

  props: {
    label:      { type: 'text',      label: 'Trigger label', default: 'Actions' },
    variant:    { type: 'select',    label: 'Variant', options: [...VARIANTS], default: 'outline',
                  help: 'The trigger borrows Button\'s appearance, so it can never drift into a third button look.' },
    size:       { type: 'segmented', label: 'Size', options: ['sm', 'md', 'lg'], default: 'md' },
    matchWidth: { type: 'boolean',   label: 'Match menu to trigger width', default: false,
                  help: 'Right for filter pickers, wrong for action menus — an action list should be as wide as its longest action.' },
    disabled:   { type: 'boolean',   label: 'Disabled', default: false },
  },

  states: ['default', 'hover', 'focus', 'disabled'],

  a11y: {
    role: 'button with aria-haspopup="menu"',
    name: 'The trigger label. An icon-only trigger REQUIRES an accessible name.',
    keyboard: [
      { keys: 'Enter / Space / ↓', does: 'Opens the menu and moves focus to the first item.' },
      { keys: '↑ / ↓',             does: 'Moves between items while open.' },
      { keys: 'Escape',            does: 'Closes and returns focus to the trigger.' },
    ],
    focus: 'Focus moves INTO the menu on open and returns to the trigger on close — losing it to the page is the defect this component exists to prevent.',
    notes: [
      'aria-haspopup and aria-expanded are what tell a screen-reader user this reveals actions rather than performing one. That announcement is the reason this is not a Button prop.',
    ],
  },

  render: (p, state) => (
    <DropdownButton
      label={s(p.label, 'Actions')}
      items={RECORD_MENU}
      variant={s(p.variant, 'outline') as never}
      size={size(p.size)}
      matchWidth={b(p.matchWidth)}
      disabled={b(p.disabled) || state === 'disabled'}
      forceState={state}
    />
  ),

  code: (p) => `<DropdownButton
  label="${s(p.label, 'Actions')}"
  variant="${s(p.variant, 'outline')}"${b(p.matchWidth) ? '\n  matchWidth' : ''}${b(p.disabled) ? '\n  disabled' : ''}
  items={[
    { id: 'edit', label: 'Edit details' },
    { id: 'export', label: 'Export to CSV' },
  ]}
/>`,

  presets: [
    { label: 'Row actions',  props: { label: 'Actions', variant: 'ghost', size: 'sm', matchWidth: false, disabled: false } },
    { label: 'Export menu',  props: { label: 'Export', variant: 'outline', size: 'md', matchWidth: false, disabled: false } },
    { label: 'Filter picker', props: { label: 'Department', variant: 'outline', size: 'md', matchWidth: true, disabled: false } },
  ],
};

/* ── SplitButton ───────────────────────────────────────────────────────────*/

const splitButtonDef: ComponentDef = {
  id: 'split-button',
  name: 'SplitButton',
  category: 'actions',
  description:
    'Compound control — a default action plus its alternatives. The left half performs the action ' +
    'immediately; the arrow reveals the variations. Use when one choice is right most of the time ' +
    'but not always, like Save with Save and close.',
  status: 'stable',
  componentPath: 'src/ui/primitives/actions.tsx',
  importFrom: '@ui',

  props: {
    label:     { type: 'text',      label: 'Primary action', default: 'Save changes',
                 help: 'The action the left half performs immediately — not a menu heading.' },
    variant:   { type: 'select',    label: 'Variant', options: [...VARIANTS], default: 'primary' },
    size:      { type: 'segmented', label: 'Size', options: ['sm', 'md', 'lg'], default: 'md' },
    menuLabel: { type: 'text',      label: 'Menu accessible name', default: 'More save options',
                 help: 'The arrow half is its own control and needs its own name — "More save options", not "Save".' },
    loading:   { type: 'boolean',   label: 'Loading', default: false },
    disabled:  { type: 'boolean',   label: 'Disabled', default: false },
  },

  states: ['default', 'hover', 'focus', 'disabled', 'loading'],

  a11y: {
    role: 'two controls: a button, and a button with aria-haspopup="menu"',
    name: 'The primary half is named by its label; the menu half needs its own accessible name.',
    keyboard: [
      { keys: 'Tab',     does: 'Reaches BOTH halves — they are two separate controls, not one.' },
      { keys: 'Enter',   does: 'On the primary half, performs the default action immediately.' },
      { keys: '↓',       does: 'On the menu half, opens the alternatives.' },
      { keys: 'Escape',  does: 'Closes the menu and returns focus to the arrow.' },
    ],
    focus: 'Two tab stops by design. Collapsing them into one would make the alternatives unreachable by keyboard.',
    notes: [
      'The menu half MUST have its own accessible name. Two adjacent controls both announced "Save" is unusable — that is what `menuLabel` is for.',
      'Both halves render canonical Button, so they share one recipe and cannot drift apart visually.',
    ],
  },

  render: (p, state) => (
    <SplitButton
      action={{ label: s(p.label, 'Save changes'), icon: <LucideIcon name="Save" /> }}
      items={SAVE_ALTERNATIVES}
      variant={s(p.variant, 'primary') as never}
      size={size(p.size)}
      menuLabel={s(p.menuLabel, 'More save options')}
      loading={b(p.loading) || state === 'loading'}
      disabled={b(p.disabled) || state === 'disabled'}
      forceState={state}
    />
  ),

  code: (p) => `<SplitButton
  action={{ label: '${s(p.label, 'Save changes')}', onSelect: save }}
  menuLabel="${s(p.menuLabel, 'More save options')}"
  variant="${s(p.variant, 'primary')}"${b(p.loading) ? '\n  loading' : ''}${b(p.disabled) ? '\n  disabled' : ''}
  items={[
    { id: 'save-close', label: 'Save and close' },
    { id: 'save-draft', label: 'Save as draft' },
  ]}
/>`,

  presets: [
    { label: 'Save with options', props: { label: 'Save changes', variant: 'primary', size: 'md', menuLabel: 'More save options', loading: false, disabled: false } },
    { label: 'Submitting',        props: { label: 'Save changes', variant: 'primary', size: 'md', menuLabel: 'More save options', loading: true,  disabled: false } },
  ],
};

export const COMPOUND_DEFS: readonly ComponentDef[] = [dropdownButtonDef, splitButtonDef];

/** Ownership, for the Studio's identity header. */
export const COMPOUND_OF: Record<string, string> = {
  'dropdown-button': 'Button + Menu',
  'split-button': 'Button + Menu',
};

