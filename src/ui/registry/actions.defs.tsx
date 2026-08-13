/**
 * src/ui/registry/actions.defs.tsx — Actions.
 *
 * THREE entries, not eight. An earlier pass registered IconButton, LinkButton,
 * ButtonGroup, ToggleButton, DropdownButton and SplitButton as siblings of
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

import { LucideIcon } from '../LucideIcon';
import { Button, ButtonGroup } from '../primitives/Button';
import { SegmentedControl, DropdownButton, SplitButton } from '../primitives/actions';
import { type MenuItems } from '../overlays/DropdownMenu';
import { type ComponentDef, type PropValues } from './types';
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

/* ── Button ────────────────────────────────────────────────────────────────*/

export const buttonDef: ComponentDef = {
  id: 'button',
  name: 'Button',
  previewAxis: 'variant',
  category: 'actions',
  description: 'The one action control. Icon-only, link, toggle, loading and destructive are props — there is no IconButton, LinkButton or ToggleButton, because none of them changed how the control behaves.',
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
  props: {
    variant:   { type: 'select',    label: 'Variant', options: ['primary', 'secondary', 'outline', 'ghost', 'danger', 'link'], default: 'primary',
                 help: 'danger uses the status red, primary the brand red — one means "main action", the other "this destroys something".' },
    size:      { type: 'segmented', label: 'Size', options: ['sm', 'md', 'lg'], default: 'md' },
    label:     { type: 'text',      label: 'Label', default: 'Save changes' },
    icon:      { type: 'select',    label: 'Icon', options: ['none', 'Save', 'Plus', 'Trash2', 'Send', 'Download', 'Check', 'Pencil', 'EllipsisVertical'], default: 'Save' },
    iconSide:  { type: 'segmented', label: 'Icon side', options: ['left', 'right'], default: 'left' },
    iconOnly:  { type: 'boolean',   label: 'Icon only', default: false, help: 'The type then REQUIRES aria-label — an icon with no name is unusable with a screen reader.' },
    pressed:   { type: 'boolean',   label: 'Toggle (pressed)', default: false, help: 'Makes it a toggle. Emits aria-pressed, announced "pressed", not "checked".' },
    href:      { type: 'text',      label: 'href', default: '', placeholder: '/audit', help: 'Set for navigation — renders a real <a>, so middle-click and open-in-new-tab work.' },
    fullWidth: { type: 'boolean',   label: 'Full width', default: false },
    loading:   { type: 'boolean',   label: 'Loading', default: false },
    loadingText: { type: 'text',    label: 'Loading text', default: '', placeholder: 'Saving…' },
    disabled:  { type: 'boolean',   label: 'Disabled', default: false },
  },

  style: [
    { label: 'Geometry', controls: [
      { name: '--ui-button-height-md',    label: 'Height (md)', kind: 'size', help: 'Set to var(--ui-control-md) to align buttons with the 40px input rhythm.' },
      { name: '--ui-button-pad-x-md',     label: 'Padding X (md)', kind: 'size' },
      { name: '--ui-button-radius',       label: 'Corner radius', kind: 'size' },
      { name: '--ui-button-gap',          label: 'Icon gap', kind: 'size' },
      { name: '--ui-button-icon-size',    label: 'Icon size', kind: 'size' },
      { name: '--ui-button-font-size-md', label: 'Font size (md)', kind: 'size' },
      { name: '--ui-button-border-width', label: 'Border width', kind: 'size' },
    ] },
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
    const iconName = s(p.icon, 'none');
    const icon = iconName !== 'none' ? <LucideIcon name={iconName as never} /> : undefined;
    const onRight = s(p.iconSide) === 'right';
    const common = {
      variant: s(p.variant, 'primary') as never,
      size: size(p.size),
      loading: b(p.loading) || state === 'loading',
      loadingText: s(p.loadingText) || undefined,
      disabled: b(p.disabled) || state === 'disabled',
      fullWidth: b(p.fullWidth),
      pressed: b(p.pressed) || state === 'selected' ? true : undefined,
      href: s(p.href) || undefined,
      forceState: state,
    };
    if (b(p.iconOnly)) {
      return <Button {...common} iconOnly aria-label={s(p.label, 'Action')} iconLeft={icon ?? <LucideIcon name="Pencil" />} />;
    }
    return (
      <Button {...common} iconLeft={onRight ? undefined : icon} iconRight={onRight ? icon : undefined}>
        {s(p.label, 'Button')}
      </Button>
    );
  },

  code: (p, state) => {
    const iconName = s(p.icon, 'none');
    const iconJsx = iconName !== 'none' ? `<LucideIcon name="${iconName}" />` : undefined;
    const side = s(p.iconSide) === 'right' ? 'iconRight' : 'iconLeft';
    if (b(p.iconOnly)) {
      return `<Button
  iconOnly
  aria-label="${s(p.label, 'Action')}"
  variant="${s(p.variant, 'primary')}"
  iconLeft={${iconJsx ?? '<LucideIcon name="Pencil" />'}}
  onClick={handleEdit}
/>`;
    }
    const lines = [
      `  variant="${s(p.variant, 'primary')}"`,
      size(p.size) !== 'md' ? `  size="${size(p.size)}"` : '',
      iconJsx ? `  ${side}={${iconJsx}}` : '',
      s(p.href) ? `  href="${s(p.href)}"` : '',
      b(p.pressed) || state === 'selected' ? '  pressed={isOn}' : '',
      b(p.fullWidth) ? '  fullWidth' : '',
      b(p.loading) || state === 'loading' ? '  loading' : '',
      s(p.loadingText) ? `  loadingText="${s(p.loadingText)}"` : '',
      b(p.disabled) || state === 'disabled' ? '  disabled' : '',
      s(p.href) ? '' : '  onClick={handleSave}',
    ].filter(Boolean);
    return `<Button\n${lines.join('\n')}\n>\n  ${s(p.label, 'Button')}\n</Button>`;
  },

  presets: [
    { label: 'Primary CTA',   props: { variant: 'primary', size: 'md', label: 'Save changes',  icon: 'Save',   iconSide: 'left', iconOnly: false, pressed: false, href: '', fullWidth: false, loading: false, loadingText: '', disabled: false } },
    { label: 'Destructive',   props: { variant: 'danger',  size: 'md', label: 'Delete record', icon: 'Trash2', iconSide: 'left', iconOnly: false, pressed: false, href: '', fullWidth: false, loading: false, loadingText: '', disabled: false } },
    { label: 'Icon only',     props: { variant: 'ghost',   size: 'sm', label: 'Edit row',      icon: 'Pencil', iconSide: 'left', iconOnly: true,  pressed: false, href: '', fullWidth: false, loading: false, loadingText: '', disabled: false } },
    { label: 'Toggle',        props: { variant: 'outline', size: 'md', label: 'Only my cases', icon: 'none',   iconSide: 'left', iconOnly: false, pressed: true,  href: '', fullWidth: false, loading: false, loadingText: '', disabled: false } },
    { label: 'Link',          props: { variant: 'link',    size: 'md', label: 'View audit trail', icon: 'none', iconSide: 'right', iconOnly: false, pressed: false, href: '/audit', fullWidth: false, loading: false, loadingText: '', disabled: false } },
    { label: 'Submitting',    props: { variant: 'primary', size: 'md', label: 'Save changes',  icon: 'Save',   iconSide: 'left', iconOnly: false, pressed: false, href: '', fullWidth: false, loading: true,  loadingText: 'Saving…', disabled: false } },
  ],

  examples: [
    {
      id: 'row-actions',
      title: 'Icon-only row actions',
      description: 'Ghost + icon-only. A bordered button per row turns a dense table into a grid of boxes.',
      render: () => (
        <div style={{ display: 'flex', gap: '4px' }}>
          <Button variant="ghost" size="sm" iconOnly aria-label="Edit" iconLeft={<LucideIcon name="Pencil" />} />
          <Button variant="ghost" size="sm" iconOnly aria-label="Duplicate" iconLeft={<LucideIcon name="Copy" />} />
          <Button variant="ghost" size="sm" iconOnly aria-label="More actions" iconLeft={<LucideIcon name="EllipsisVertical" />} />
        </div>
      ),
      code: `<Button variant="ghost" size="sm" iconOnly aria-label="Edit" iconLeft={<LucideIcon name="Pencil" />} />`,
    },
    {
      id: 'group',
      title: 'ButtonGroup — several INDEPENDENT actions',
      description: 'A layout wrapper. For one value with options, use SegmentedControl instead: that is a radiogroup, and the difference changes what a screen reader announces.',
      render: () => (
        <ButtonGroup label="Record actions">
          <Button variant="outline" iconLeft={<LucideIcon name="Download" />}>Export</Button>
          <Button variant="outline" iconLeft={<LucideIcon name="Printer" />}>Print</Button>
          <Button variant="outline" iconLeft={<LucideIcon name="Share2" />}>Share</Button>
        </ButtonGroup>
      ),
      code: `<ButtonGroup label="Record actions">
  <Button variant="outline" iconLeft={<LucideIcon name="Download" />}>Export</Button>
  <Button variant="outline" iconLeft={<LucideIcon name="Printer" />}>Print</Button>
</ButtonGroup>`,
    },
    {
      id: 'toggle-and-link',
      title: 'Toggle and link — props, not components',
      description: 'The deleted ToggleButton and LinkButton, expressed as `pressed` and `href`.',
      render: () => (
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
          <Button variant="outline" pressed iconLeft={<LucideIcon name="Filter" />}>Only my cases</Button>
          <Button variant="link" href="#audit" iconRight={<LucideIcon name="ArrowRight" />}>View audit trail</Button>
        </div>
      ),
      code: `<Button variant="outline" pressed={onlyMine} onClick={toggle}>Only my cases</Button>
<Button variant="link" href="/audit">View audit trail</Button>`,
    },
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
    notes: ['aria-checked, not aria-pressed — this is single-choice. A ButtonGroup of Buttons would announce three unrelated actions.'],
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
  description: 'The one action menu. Its TRIGGERS — a dropdown button, a split button, a row ⋮ — are compositions over Button, shown here as examples rather than as separate components.',
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
