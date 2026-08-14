/**
 * src/ui/registry/actions.defs.tsx — Actions.
 *
 * THREE entries, not eight. An earlier pass registered IconButton, LinkButton,
 * ToggleButton, DropdownButton and SplitButton as siblings of
 * Button, which made the Gallery look like the fragmentation this kit exists to
 * remove — six cards for one component's variants.
 *
 * The rule now: an entry is a component with its own INTERACTION MODEL.
 *   • Button          — icon-only, link, toggle, loading, destructive are PROPS
 *   • SegmentedControl— radiogroup semantics + roving focus: genuinely different
 *   • Menu            — the menu pattern; its triggers are shown as examples
 *
 * Anything that is "Button with these props" belongs in Button's variants,
 * states or examples — never as its own card.
 */

import { type VNode } from 'preact';
import { LucideIcon } from '../LucideIcon';
import { Button } from '../primitives/Button';
import { SegmentedControl, DropdownButton, SplitButton } from '../primitives/actions';
import { type MenuItems } from '../overlays/DropdownMenu';
import { type ComponentDef, type PropValues, type StyleGroup } from './types';
import { type ControlSize } from '../tokens';

const s = (v: PropValues[string] | undefined, f = ''): string => (typeof v === 'string' ? v : f);
const b = (v: PropValues[string] | undefined): boolean => v === true;
const size = (v: PropValues[string] | undefined): ControlSize => (v === 'sm' || v === 'lg' ? v : 'md');

const DEMO_MENU: MenuItems = [
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

const SAVE_MENU: MenuItems = [
  { id: 'save-close', label: 'Save and close',   icon: <LucideIcon name="CheckCheck" /> },
  { id: 'save-draft', label: 'Save as draft',    icon: <LucideIcon name="FileText" /> },
  { id: 'save-new',   label: 'Save and add new', icon: <LucideIcon name="Plus" /> },
];

const noop = (): void => { /* preview */ };

/** Action Button's variant list, per the approved mockup. */
const VARIANTS = ['primary', 'secondary', 'outline', 'ghost', 'danger', 'link'] as const;

const VARIANT_GEOMETRY: StyleGroup[] = VARIANTS.map(variant => ({
  label: 'Size and shape',
  controls: [
    ...(variant === 'link' ? [] : [
      { name: `--ui-button-${variant}-height-md`, label: 'Button height', kind: 'size' as const, scope: 'variant' as const, variant, linkedTo: 'var(--ui-button-height-md)' },
      { name: `--ui-button-${variant}-pad-x-md`, label: 'Horizontal padding', kind: 'size' as const, scope: 'variant' as const, variant, linkedTo: 'var(--ui-button-pad-x-md)' },
      { name: `--ui-button-${variant}-radius`, label: 'Corner roundness', kind: 'size' as const, scope: 'variant' as const, variant, linkedTo: 'var(--ui-button-radius)' },
      { name: `--ui-button-${variant}-border-width`, label: 'Border thickness', kind: 'size' as const, scope: 'variant' as const, variant, linkedTo: 'var(--ui-button-border-width)' },
    ]),
    { name: `--ui-button-${variant}-gap`, label: 'Icon spacing', kind: 'size' as const, scope: 'variant' as const, variant, linkedTo: 'var(--ui-button-gap)' },
    { name: `--ui-button-${variant}-icon-size`, label: 'Icon size', kind: 'size' as const, scope: 'variant' as const, variant, linkedTo: 'var(--ui-button-icon-size)' },
    { name: `--ui-button-${variant}-font-size-md`, label: 'Text size', kind: 'size' as const, scope: 'variant' as const, variant, linkedTo: 'var(--ui-button-font-size-md)' },
  ],
}));

const VARIANT_STATES: StyleGroup[] = VARIANTS.flatMap(variant => [
  { label: 'Focus', controls: [
    { name: `--ui-button-${variant}-focus-ring-color`, label: 'Focus ring', kind: 'color-alpha' as const, scope: 'state' as const, variant, state: 'focus' as const, linkedTo: 'var(--ui-button-focus-ring-color)' },
    { name: `--ui-button-${variant}-focus-ring-width`, label: 'Focus ring width', kind: 'size' as const, scope: 'state' as const, variant, state: 'focus' as const, linkedTo: 'var(--ui-button-focus-ring-width)' },
  ] },
  { label: 'Disabled', controls: [
    ...(variant === 'link' ? [] : [
      { name: `--ui-button-${variant}-disabled-bg`, label: 'Disabled background', kind: 'color' as const, scope: 'state' as const, variant, state: 'disabled' as const, linkedTo: 'var(--ui-button-disabled-bg)' },
      { name: `--ui-button-${variant}-disabled-border`, label: 'Disabled border', kind: 'color' as const, scope: 'state' as const, variant, state: 'disabled' as const, linkedTo: 'var(--ui-button-disabled-border)' },
    ]),
    { name: `--ui-button-${variant}-disabled-fg`, label: 'Disabled text', kind: 'color' as const, scope: 'state' as const, variant, state: 'disabled' as const, linkedTo: 'var(--ui-button-disabled-fg)' },
    { name: `--ui-button-${variant}-disabled-icon`, label: 'Disabled icon', kind: 'color' as const, scope: 'state' as const, variant, state: 'disabled' as const, linkedTo: 'var(--ui-button-disabled-icon)' },
  ] },
  { label: 'Loading', controls: [
    { name: `--ui-button-${variant}-loading-spinner`, label: 'Loading spinner', kind: 'color' as const, scope: 'state' as const, variant, state: 'loading' as const, linkedTo: 'var(--ui-button-loading-spinner)' },
  ] },
]);

/* ── Button ────────────────────────────────────────────────────────────────*/

export const buttonDef: ComponentDef = {
  id: 'button',
  /* Shown as "Action Button" so it reads as a sibling of Dropdown and Split
     Button rather than the generic they are variants of. The exported symbol is
     still `Button`, and the Code tab shows that — the catalogue name cannot
     mislead about what to import. */
  name: 'Action Button',
  previewAxis: 'variant',
  category: 'actions',
  description: 'Choose and style the six button types used for actions such as Next, Save, Cancel and Delete.',
  status: 'stable',
  componentPath: 'src/ui/primitives/Button.tsx',
  importFrom: '@ui',
  migration: {
    replaces: [
      '.inc-action-btn', '.hse-btn', '.obx-btn', '.sfp-btn', '.stg-btn-outline',
      '.btn-danger-primary', '.text-btn', '.tfa-text-btn',
      '.hse-btn-icon-remove', '.ui-mini-btn', '.card-overlay-btn', '.acx-hdr-btn',
      '.obx-rowbtns', '.rowbtns',
    ],
    deprecatedImports: ['@ui/components/Button', 'IconButton', 'LinkButton', 'ToggleButton'],
    rawPatterns: ['<button'],
    nextSurface: 'Settings',
    notes: [
      'A call site is only migrated once the module CSS that restyled its old class is deleted — see RECIPES.md §4.',
      '151 distinct *btn* class families exist across the app; every one of them is this component with different props.',
    ],
  },
  /*
    The option set is the approved Studio mockup's, backed 1:1 by real props.
    The earlier definition modelled icons as `icon` + `iconSide`, which could
    not express a button with BOTH a leading and a trailing icon, and omitted
    `tone` entirely — so the panel under-reported the component's own API.

    `action` is the one control that is not a prop: it is the discriminator the
    mockup uses, and `render` honours it by passing `href` only for the link
    case. Without that mapping it would be a control that changes nothing.
  */
  props: {
    variant:   { type: 'select',    label: 'Variant', options: [...VARIANTS], default: 'primary',
                 help: 'How loud the action is. `danger` is the filled destructive treatment.' },
    tone:      { type: 'select',    label: 'Tone', options: ['default', 'danger'], default: 'default',
                 help: 'What KIND of action it is, kept separate from emphasis. Composes with the quiet variants for a low-emphasis destructive action; redundant on variant="danger".' },
    size:      { type: 'segmented', label: 'Size', options: ['sm', 'md', 'lg'], default: 'md' },

    label:     { type: 'text',      label: 'Label', default: 'Button' },
    iconLeft:  { type: 'select',    label: 'Leading icon', options: ['None', 'Save', 'Plus', 'Trash2', 'Download', 'Check', 'Pencil'], default: 'Save' },
    iconRight: { type: 'select',    label: 'Trailing icon', options: ['None', 'ArrowRight', 'ChevronRight'], default: 'None' },

    disabled:  { type: 'boolean',   label: 'Disabled', default: false },
    loading:   { type: 'boolean',   label: 'Loading', default: false,
                 help: 'Blocks activation and sets aria-busy, but does NOT disable — a disabled button leaves the tab order and throws focus to the top of the page.' },
    pressed:   { type: 'boolean',   label: 'Pressed', default: false,
                 help: 'Makes it a toggle. Emits aria-pressed ("pressed"), not aria-checked ("selected").' },

    action:    { type: 'select',    label: 'Action', options: ['Button action', 'Link / href'], default: 'Button action',
                 help: 'A link renders a real <a>, so middle-click and open-in-new-tab work.' },
  },

  style: [
    ...VARIANT_GEOMETRY,
    { label: 'Primary', controls: [
      { name: '--ui-button-primary-bg',        label: 'Background', kind: 'color' },
      { name: '--ui-button-primary-fg',        label: 'Text', kind: 'color' },
      { name: '--ui-button-primary-bg-hover',  label: 'Background — hover', kind: 'color' },
      { name: '--ui-button-primary-bg-active', label: 'Background — pressed', kind: 'color' },
    ] },
    { label: 'Secondary', controls: [
      { name: '--ui-button-secondary-bg',       label: 'Background', kind: 'color' },
      { name: '--ui-button-secondary-fg',       label: 'Text', kind: 'color' },
      { name: '--ui-button-secondary-bg-hover', label: 'Background — hover', kind: 'color' },
    ] },
    { label: 'Outline & ghost', controls: [
      { name: '--ui-button-outline-border',       label: 'Outline — border', kind: 'color' },
      { name: '--ui-button-outline-bg-hover',     label: 'Outline — hover fill', kind: 'color' },
      { name: '--ui-button-outline-border-hover', label: 'Outline — hover border', kind: 'color' },
      { name: '--ui-button-ghost-fg',             label: 'Ghost — text', kind: 'color' },
      { name: '--ui-button-ghost-bg-hover',       label: 'Ghost — hover fill', kind: 'color-alpha' },
    ] },
    { label: 'Danger, link & toggle', controls: [
      { name: '--ui-button-danger-bg',       label: 'Danger — background', kind: 'color' },
      { name: '--ui-button-danger-bg-hover', label: 'Danger — hover', kind: 'color' },
      { name: '--ui-button-link-fg',         label: 'Link — colour', kind: 'color' },
      { name: '--ui-button-link-fg-hover',   label: 'Link — hover', kind: 'color' },
      { name: '--ui-toggle-bg-on',           label: 'Toggle — pressed fill', kind: 'color-alpha' },
      { name: '--ui-toggle-fg-on',           label: 'Toggle — pressed text', kind: 'color' },
    ] },
    ...VARIANT_STATES,
  ],

  states: ['default', 'hover', 'focus', 'active', 'selected', 'disabled', 'loading'],
  compare: ['default', 'hover', 'focus', 'active', 'selected', 'disabled', 'loading'],

  a11y: {
    role: null,
    name: 'The button text. `iconOnly` makes `aria-label` REQUIRED at the type level.',
    keyboard: [
      { keys: 'Enter / Space', does: 'Activates. Native <button> behaviour — not reimplemented.' },
      { keys: 'Tab',           does: 'Moves focus. A loading button stays in the tab order.' },
    ],
    focus: 'Visible ring on :focus-visible only, so a mouse click leaves no ring behind.',
    notes: [
      'Loading sets aria-busy and swallows clicks, but does NOT set disabled — a disabled button leaves the tab order, which would throw a submitting user\'s focus to the top of the page.',
      'Disabled is a real treatment (background, border, text, cursor), never opacity: .5.',
      '`pressed` emits aria-pressed ("pressed"), not aria-checked ("selected") — the latter would tell the user they are in a single-choice group.',
      'With `href` it renders <a>; a disabled href falls back to a <button> that cannot be followed.',
    ],
  },

  render: (p, state) => {
    const iconTreatment = s(p.iconTreatment, 'outline');
    const iconColor = s(p.iconColor, 'currentColor');
    const icon = (n: string): VNode | undefined =>
      n !== 'None' ? <span class={`sds-preview-icon sds-preview-icon--${iconTreatment}`} style={{ color: iconColor }}><LucideIcon name={n as never} /></span> : undefined;
    const isLink = s(p.action, 'Button action') === 'Link / href';
    return (
      <Button
        variant={s(p.variant, 'primary') as never}
        tone={s(p.tone, 'default') as never}
        size={size(p.size)}
        iconLeft={icon(s(p.iconLeft, 'None'))}
        iconRight={icon(s(p.iconRight, 'None'))}
        loading={b(p.loading) || state === 'loading'}
        disabled={b(p.disabled) || state === 'disabled'}
        pressed={b(p.pressed) || state === 'selected' ? true : undefined}
        href={isLink ? '/audit' : undefined}
        forceState={state}
      >
        {s(p.label, 'Button')}
      </Button>
    );
  },

  code: (p, state) => {
    const jsx = (n: string): string | undefined =>
      n !== 'None' ? `<LucideIcon name="${n}" />` : undefined;
    const isLink = s(p.action, 'Button action') === 'Link / href';
    const left = jsx(s(p.iconLeft, 'None'));
    const right = jsx(s(p.iconRight, 'None'));
    const lines = [
      `  variant="${s(p.variant, 'primary')}"`,
      s(p.tone, 'default') !== 'default' ? `  tone="${s(p.tone)}"` : '',
      size(p.size) !== 'md' ? `  size="${size(p.size)}"` : '',
      left ? `  iconLeft={${left}}` : '',
      right ? `  iconRight={${right}}` : '',
      isLink ? '  href="/audit"' : '',
      b(p.pressed) || state === 'selected' ? '  pressed={isOn}' : '',
      b(p.loading) || state === 'loading' ? '  loading={saving}' : '',
      b(p.disabled) || state === 'disabled' ? '  disabled' : '',
      isLink ? '' : '  onClick={handleSave}',
    ].filter(Boolean);
    return `<Button\n${lines.join('\n')}\n>\n  ${s(p.label, 'Button')}\n</Button>`;
  },

  /* The mockup's "Common application use" cards. Context owns the action; the
     Button still owns its visual and interaction contract. */
  examples: [
    {
      id: 'dialog-footer',
      title: 'Dialog footer',
      render: () => (
        <>
          <Button variant="secondary">Cancel</Button>
          <Button variant="primary">Save</Button>
        </>
      ),
    },
    {
      id: 'wizard-nav',
      title: 'Wizard navigation',
      render: () => (
        <>
          <Button variant="ghost">Back</Button>
          <Button variant="primary" iconRight={<LucideIcon name="ArrowRight" />}>Continue</Button>
        </>
      ),
    },
    {
      id: 'page-action',
      title: 'Page action',
      render: () => <Button variant="primary" iconLeft={<LucideIcon name="Plus" />}>Add employee</Button>,
    },
  ],
  variantSamples: [
    { value: 'primary', title: 'Primary', description: 'Main action', props: { label: 'Next', iconLeft: 'None', iconRight: 'ArrowRight', iconTreatment: 'outline', iconColor: '#ffffff' } },
    { value: 'secondary', title: 'Secondary', description: 'Supporting action', props: { label: 'Cancel', iconLeft: 'None', iconTreatment: 'outline', iconColor: '#334155' } },
    { value: 'outline', title: 'Outline', description: 'Alternative action', props: { label: 'Preview', iconLeft: 'None', iconTreatment: 'outline', iconColor: '#1b2d54' } },
    { value: 'ghost', title: 'Ghost', description: 'Quiet navigation', props: { label: 'Back', iconLeft: 'None', iconTreatment: 'outline', iconColor: '#5e6f8d' } },
    { value: 'danger', title: 'Danger', description: 'Destructive action', props: { label: 'Delete', iconLeft: 'Trash2', iconTreatment: 'outline', iconColor: '#ffffff' } },
    { value: 'link', title: 'Link', description: 'Inline navigation', props: { label: 'View record', iconLeft: 'None', iconRight: 'ArrowRight', iconTreatment: 'outline', iconColor: '#1b2d54' } },
  ],
};

/* ── SegmentedControl ──────────────────────────────────────────────────────*/

export const segmentedDef: ComponentDef = {
  id: 'segmented-control',
  name: 'SegmentedControl',
  previewAxis: 'variant',
  category: 'actions',
  description: 'ONE value, several options. Separate from Button because the interaction genuinely differs: radiogroup semantics, roving focus and arrow-key movement.',
  status: 'stable',
  componentPath: 'src/ui/primitives/actions.tsx',
  importFrom: '@ui',
  migration: { replaces: ['.inc-view-chip', '.device-switch'] },

  props: {
    value:     { type: 'select',  label: 'Selected', options: ['grid', 'list', 'board'], default: 'grid' },
    fullWidth: { type: 'boolean', label: 'Full width', default: false },
    withIcons: { type: 'boolean', label: 'Show icons', default: true },
    disabled:  { type: 'boolean', label: 'Disabled', default: false },
  },

  style: [
    { label: 'Track', controls: [
      { name: '--ui-segmented-bg',     label: 'Track fill', kind: 'color' },
      { name: '--ui-segmented-border', label: 'Track border', kind: 'color' },
      { name: '--ui-segmented-radius', label: 'Corner radius', kind: 'size' },
      { name: '--ui-segmented-pad',    label: 'Track padding', kind: 'size' },
    ] },
    { label: 'Options', controls: [
      { name: '--ui-segmented-item-fg',          label: 'Text', kind: 'color' },
      { name: '--ui-segmented-item-bg-selected', label: 'Selected fill', kind: 'color' },
      { name: '--ui-segmented-item-fg-selected', label: 'Selected text', kind: 'color' },
      { name: '--ui-segmented-item-bg-hover',    label: 'Hover fill', kind: 'color-alpha' },
    ] },
  ],

  states: ['default', 'hover', 'focus', 'disabled'],

  a11y: {
    role: 'radiogroup + radio',
    name: 'The mandatory `label` prop.',
    keyboard: [
      { keys: '→ / ↓', does: 'Selects the next option, skipping disabled ones and wrapping.' },
      { keys: '← / ↑', does: 'Selects the previous option.' },
      { keys: 'Tab',   does: 'Skips the WHOLE control — roving focus means only the selected option is tabbable.' },
    ],
    focus: 'Roving tabindex: exactly one option is tabbable, and arrows move both selection and focus.',
    notes: ['aria-checked, not aria-pressed — this is single-choice. A row of plain Buttons would announce three unrelated actions.'],
  },

  render: (p, state) => (
    <SegmentedControl
      label="View mode"
      value={s(p.value, 'grid')}
      onChange={noop}
      fullWidth={b(p.fullWidth)}
      disabled={b(p.disabled) || state === 'disabled'}
      forceState={state}
      options={[
        { value: 'grid',  label: 'Grid',  icon: b(p.withIcons) ? <LucideIcon name="LayoutGrid" /> : undefined },
        { value: 'list',  label: 'List',  icon: b(p.withIcons) ? <LucideIcon name="List" /> : undefined },
        { value: 'board', label: 'Board', icon: b(p.withIcons) ? <LucideIcon name="Columns3" /> : undefined },
      ]}
    />
  ),
  code: () => `<SegmentedControl
  label="View mode"
  value={view}
  onChange={setView}
  options={[
    { value: 'grid', label: 'Grid', icon: <LucideIcon name="LayoutGrid" /> },
    { value: 'list', label: 'List', icon: <LucideIcon name="List" /> },
  ]}
/>`,
};

/* ── Menu ──────────────────────────────────────────────────────────────────*/

export const menuDef: ComponentDef = {
  id: 'menu',
  name: 'Menu',
  category: 'overlays',
  description: 'The action-menu SURFACE — grouping, icons, shortcuts, destructive items, keyboard and focus. Its triggers are their own components: see Dropdown Button and Split Button under Buttons.',
  status: 'stable',
  componentPath: 'src/ui/overlays/DropdownMenu.tsx',
  importFrom: '@ui',
  migration: {
    deprecatedImports: ['NewMenu', 'RowActionMenu', '@ui/components/Menu'],
    nextSurface: 'UI Kit Studio',
    notes: [
      'Canonical Menu now supports a real supporting description; the clean Training and Statutory Configuration action menus migrated without dropping their guidance.',
      'The unused pre-v2 Menu runtime and its outside-click overlay CSS are deleted.',
      'RiskJsa.tsx, Incidents.tsx, Inspections.tsx and Permits.tsx retain NewMenu as exact dirty-file debt. RowActionMenu consumers remain natural-touch debt.',
    ],
  },

  props: {
    trigger:    { type: 'select',    label: 'Trigger', options: ['Dropdown button', 'Split button', 'Icon only'], default: 'Dropdown button',
                  help: 'All three are the same Menu with a different Button composition in front of it.' },
    label:      { type: 'text',      label: 'Trigger label', default: 'Actions' },
    variant:    { type: 'select',    label: 'Trigger variant', options: ['outline', 'secondary', 'primary', 'ghost'], default: 'outline' },
    size:       { type: 'segmented', label: 'Size', options: ['sm', 'md', 'lg'], default: 'md' },
    matchWidth: { type: 'boolean',   label: 'Menu matches trigger width', default: false, help: 'Right for filter menus, wrong for action menus.' },
    disabled:   { type: 'boolean',   label: 'Disabled', default: false },
  },

  style: [
    { label: 'Menu surface', controls: [
      { name: '--ui-menu-bg',        label: 'Background', kind: 'color' },
      { name: '--ui-menu-border',    label: 'Border', kind: 'color' },
      { name: '--ui-menu-radius',    label: 'Corner radius', kind: 'size' },
      { name: '--ui-menu-min-width', label: 'Minimum width', kind: 'size' },
      { name: '--ui-menu-pad',       label: 'Padding', kind: 'size' },
    ] },
    { label: 'Menu items', controls: [
      { name: '--ui-menu-item-height',    label: 'Row height', kind: 'size' },
      { name: '--ui-menu-item-pad-x',     label: 'Row padding X', kind: 'size' },
      { name: '--ui-menu-item-bg-active', label: 'Cursor fill', kind: 'color' },
      { name: '--ui-menu-item-fg-danger', label: 'Destructive text', kind: 'color' },
    ] },
  ],

  states: ['default', 'hover', 'focus', 'open', 'disabled'],

  a11y: {
    role: 'button[aria-haspopup=menu] + menu + menuitem',
    name: 'The trigger label; the menu takes the same name.',
    keyboard: [
      { keys: 'Enter / Space', does: 'Opens the menu and focuses its first enabled item.' },
      { keys: '↓ / ↑',         does: 'Moves through items, skipping disabled ones and wrapping.' },
      { keys: 'Home / End',    does: 'First / last item.' },
      { keys: 'a–z',           does: 'Typeahead.' },
      { keys: 'Escape',        does: 'Closes and returns focus to the trigger. Does NOT bubble to a parent dialog.' },
      { keys: 'Tab',           does: 'Closes and lets focus continue.' },
    ],
    focus: 'A menu moves REAL focus onto its items (unlike a listbox), and returns it to the trigger on close.',
    notes: [
      'Portalled to <body> — a fixed surface inside a transformed ancestor (any board tile) would be clipped by it.',
      'The menu closes BEFORE the item handler runs, so an action that opens a dialog does not fight this menu\'s focus management.',
      'A split button is TWO real buttons. One element that inspects click coordinates cannot be operated by keyboard and has an invisible split point on touch.',
    ],
  },

  render: (p, state) => {
    const trigger = s(p.trigger, 'Dropdown button');
    if (trigger === 'Split button') {
      return (
        <SplitButton
          action={{ label: 'Save', icon: <LucideIcon name="Save" /> }}
          items={SAVE_MENU}
          variant={s(p.variant) === 'outline' ? 'primary' : (s(p.variant, 'primary') as never)}
          size={size(p.size)}
          disabled={b(p.disabled) || state === 'disabled'}
          forceState={state}
        />
      );
    }
    if (trigger === 'Icon only') {
      return (
        <DropdownButton
          label={s(p.label, 'Actions')}
          items={DEMO_MENU}
          variant="ghost"
          size={size(p.size)}
          disabled={b(p.disabled) || state === 'disabled'}
          forceState={state}
        />
      );
    }
    return (
      <DropdownButton
        label={s(p.label, 'Actions')}
        items={DEMO_MENU}
        variant={s(p.variant, 'outline') as never}
        size={size(p.size)}
        matchWidth={b(p.matchWidth)}
        disabled={b(p.disabled) || state === 'disabled'}
        forceState={state}
      />
    );
  },

  code: p => s(p.trigger) === 'Split button'
    ? `<SplitButton
  action={{ label: 'Save', icon: <LucideIcon name="Save" />, onSelect: save }}
  items={[
    { id: 'save-close', label: 'Save and close', onSelect: saveAndClose },
    { id: 'save-draft', label: 'Save as draft',  onSelect: saveDraft },
  ]}
/>`
    : `<DropdownButton
  label="${s(p.label, 'Actions')}"
  variant="${s(p.variant, 'outline')}"
  items={[
    { label: 'Record', items: [
      { id: 'edit', label: 'Edit details', icon: <LucideIcon name="Pencil" />, onSelect: edit },
    ] },
    { label: 'Danger zone', items: [
      { id: 'delete', label: 'Delete', icon: <LucideIcon name="Trash2" />, danger: true, onSelect: remove },
    ] },
  ]}
/>`,
};

export const ACTION_DEFS: readonly ComponentDef[] = [
  buttonDef,
  segmentedDef,
  menuDef,
];
