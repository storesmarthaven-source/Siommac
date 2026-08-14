/**
 * src/ui/registry/navigation.defs.tsx — Navigation.
 *
 * Tabs lives here; Wizard has its own file (`wizard.def.tsx`) because its entry
 * is as long as this one and a single unreadable file is how the registry stops
 * being maintained.
 *
 * ONE Tabs card. Orientation, appearance, size, icons, count badges, the
 * disabled state and the "More" overflow are props and examples inside this one
 * entry — `VerticalTabs` as a sibling card would rebuild, in a nicer Gallery,
 * exactly the five-implementation split this component exists to remove.
 */

import { LucideIcon } from '../LucideIcon';
import { Button } from '../primitives/Button';
import { Tabs, TabPanel, type TabItem } from '../navigation/Tabs';
import { TreeView, type TreeNode } from '../navigation/TreeView';
import {
  type TabsOrientation, type TabsVariant, type TabsSize, type TabsActivation,
} from '../navigation/Tabs';
import { wizardDef } from './wizard.def';
import { pageActionBarDef, pageHeaderDef } from './page-header.def';
import { type ComponentDef, type PropValues } from './types';

const s = (v: PropValues[string] | undefined, f = ''): string => (typeof v === 'string' ? v : f);
const b = (v: PropValues[string] | undefined): boolean => v === true;
const noop = (): void => { /* preview */ };

const FILE_TREE: readonly TreeNode[] = [{
  id: 'src', label: 'src', kind: 'folder', children: [
    { id: 'app', label: 'app', kind: 'folder', children: [
      { id: 'layout', label: 'layout.tsx', kind: 'file' },
      { id: 'page', label: 'page.tsx', kind: 'file' },
    ] },
    { id: 'components', label: 'components', kind: 'folder', children: [
      { id: 'ui', label: 'ui', kind: 'folder', children: [
        { id: 'button', label: 'button.tsx', kind: 'file' },
      ] },
      { id: 'header', label: 'header.tsx', kind: 'file' },
      { id: 'footer', label: 'footer.tsx', kind: 'file' },
    ] },
    { id: 'lib', label: 'lib', kind: 'folder', children: [
      { id: 'utils', label: 'utils.ts', kind: 'file' },
    ] },
  ],
}];

export const treeViewDef: ComponentDef = {
  id: 'tree-view',
  name: 'TreeView',
  category: 'navigation',
  description: 'Hierarchical navigation and selection with expandable branches, connector lines and a complete keyboard tree model.',
  status: 'stable',
  componentPath: 'src/ui/navigation/TreeView.tsx',
  importFrom: '@ui',
  props: {
    expanded: { type: 'boolean', label: 'Start expanded', default: true },
    selected: { type: 'select', label: 'Selected item', options: ['button', 'page', 'header', 'utils'], default: 'button' },
  },
  style: [
    { label: 'Tree surface', controls: [
      { name: '--ui-tree-width', label: 'Width', kind: 'size' },
      { name: '--ui-tree-padding', label: 'Padding', kind: 'size' },
      { name: '--ui-tree-bg', label: 'Background', kind: 'color', linkedTo: 'var(--ui-color-surface-default)' },
      { name: '--ui-tree-border', label: 'Border', kind: 'color', linkedTo: 'var(--ui-color-border-default)' },
    ] },
    { label: 'Rows and hierarchy', controls: [
      { name: '--ui-tree-indent', label: 'Indent', kind: 'size' },
      { name: '--ui-tree-row-height', label: 'Row height', kind: 'size' },
      { name: '--ui-tree-row-radius', label: 'Row radius', kind: 'size' },
      { name: '--ui-tree-fg', label: 'Text', kind: 'color', linkedTo: 'var(--ui-color-text-primary)' },
      { name: '--ui-tree-icon', label: 'Icons', kind: 'color', linkedTo: 'var(--ui-color-text-muted)' },
      { name: '--ui-tree-connector', label: 'Connector lines', kind: 'color', linkedTo: 'var(--ui-color-border-default)' },
      { name: '--ui-tree-hover-bg', label: 'Hover background', kind: 'color-alpha' },
      { name: '--ui-tree-selected-bg', label: 'Selected background', kind: 'color-alpha' },
    ] },
  ],
  states: ['default', 'focus'],
  a11y: {
    role: 'tree',
    name: 'The tree requires a concise label describing the hierarchy.',
    keyboard: [
      { keys: '↑ / ↓', does: 'Moves focus through visible items.' },
      { keys: '→', does: 'Expands a closed folder or moves to its first child.' },
      { keys: '←', does: 'Collapses an open folder or moves to its parent.' },
      { keys: 'Home / End', does: 'Moves to the first or last visible item.' },
      { keys: 'Enter / Space', does: 'Selects the item and toggles folders.' },
    ],
    focus: 'Uses one roving tab stop; collapsed descendants leave the focus and accessibility sequences.',
  },
  render: (p, state) => (
    <TreeView
      key={`${b(p.expanded)}-${s(p.selected, 'button')}`}
      nodes={FILE_TREE}
      defaultSelectedId={s(p.selected, 'button')}
      defaultExpandedIds={b(p.expanded) ? ['src', 'app', 'components', 'ui', 'lib'] : []}
      label="Project files"
      class={state === 'focus' ? 'is-force-focus' : undefined}
    />
  ),
  code: () => `<TreeView
  nodes={projectTree}
  selectedId={selectedId}
  onSelect={node => setSelectedId(node.id)}
  expandedIds={expandedIds}
  onExpandedChange={setExpandedIds}
  label="Project files"
/>`,
};

/* Realistic tabs, because "Tab 1 / Tab 2" hides every layout problem a nine-word
   label with a four-digit count causes. */
const CASE_TABS: TabItem[] = [
  { id: 'overview',      label: 'Overview',      icon: <LucideIcon name="LayoutGrid" /> },
  { id: 'requirements',  label: 'Requirements',  icon: <LucideIcon name="ListChecks" />, badge: 12 },
  { id: 'documents',     label: 'Documents',     icon: <LucideIcon name="FileText" />,   badge: 3 },
  { id: 'provisioning',  label: 'Provisioning',  icon: <LucideIcon name="Server" />,     badge: 0 },
  { id: 'audit',         label: 'Audit',         icon: <LucideIcon name="ShieldCheck" />, disabled: true, disabledReason: 'Requires hr.onboarding.audit' },
];

const PLAIN_TABS: TabItem[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'tasks',    label: 'Tasks', badge: 4 },
  { id: 'files',    label: 'Files' },
];

const MANY_TABS: TabItem[] = [
  { id: 'summary',    label: 'Summary' },
  { id: 'paye',       label: 'PAYE Bands' },
  { id: 'nis',        label: 'NIS Classes' },
  { id: 'hs',         label: 'Health Surcharge' },
  { id: 'components', label: 'Pay Components' },
  { id: 'runs',       label: 'Linked Runs' },
  { id: 'history',    label: 'Approval History' },
  { id: 'timeline',   label: 'Timeline' },
  { id: 'audit',      label: 'Audit' },
];

export const tabsDef: ComponentDef = {
  id: 'tabs',
  name: 'Tabs',
  category: 'navigation',
  description: 'ONE tab component. Orientation, appearance, size, icons, count badges and the "More" overflow are configuration. It also owns the accessibility contract — tablist/tab/tabpanel, roving tabindex and arrow-key navigation — which three of the five implementations it replaces did not have at all.',
  status: 'stable',
  componentPath: 'src/ui/navigation/Tabs/Tabs.tsx',
  importFrom: '@ui',
  migration: {
    replaces: ['.inv-tab-bar', '.inv-tab-btn', '.hse-tabs-bar', '.hse-tab', '.ui-panel-tab', '.record-tabs', '.run-tabs'],
    deprecatedImports: ['LegacyTabs', 'ModuleTabs', 'TabBar', 'AreaTabs', 'PanelTabs', 'VerticalTabs'],
    nextSurface: 'Dialog',
    notes: [
      'The clean overview family is migrated: Environmental, Emergency Response, Documents, Contractors, Workflows, Training, Legal Compliance, Toolbox and Notification Centre now use canonical Tabs + TabPanel. HR Organization Structure and the clean Worker Profile drawer moved in the same batch.',
      'The pre-v2 generic Tabs runtime is DELETED. Four TabBar pages and nine old-signature drawer/detail call sites remain exact debt because their files have unrelated lint blockers; the unused ModulePageLayout composition is not a live application surface.',
      'A migration is not finished when <Tabs> appears in the JSX: the superseded tab CSS must be deleted in the same change, because a recipe can never out-rank a legacy rule (RECIPES.md §4). `.ui-panel-tab*` was removed with the Statutory drawer, and the dark-drawer skin now re-points --ui-tab-* variables instead of overriding rules.',
      'Wrap each tab body in <TabPanel>. Every tab emits aria-controls pointing at the panel it renders; a bare `{tab === "x" && …}` conditional leaves those references dangling, which is worse than having none.',
      'Use activation="manual" when a panel fires a network request — under the default, arrowing past four tabs selects four tabs.',
    ],
  },
  props: {
    orientation: { type: 'segmented', label: 'Orientation', options: ['horizontal', 'vertical'], default: 'horizontal' },
    variant:     { type: 'segmented', label: 'Variant', options: ['underline', 'contained', 'subtle'], default: 'underline' },
    size:        { type: 'segmented', label: 'Size', options: ['sm', 'md', 'lg'], default: 'md' },
    activation:  { type: 'segmented', label: 'Activation', options: ['automatic', 'manual'], default: 'automatic', help: 'Automatic selects as focus moves (the WAI-ARIA default). Manual waits for Enter/Space — use it when a panel costs a request.' },
    icons:       { type: 'boolean',   label: 'Icons', default: true },
    badges:      { type: 'boolean',   label: 'Count badges', default: true },
    descriptions:{ type: 'boolean',   label: 'Sub-labels', default: false, help: 'ModuleTabs\' `sublabel`.' },
    disabledTab: { type: 'boolean',   label: 'Include a disabled tab', default: true },
    overflow:    { type: 'boolean',   label: 'Overflow ("More" menu)', default: false, help: 'maxVisible collapses the rest into the canonical menu.' },
    actions:     { type: 'boolean',   label: 'Right-aligned actions', default: false },
    panel:       { type: 'boolean',   label: 'Show the panel', default: true },
  },

  style: [
    { label: 'Bar', controls: [
      { name: '--ui-tabs-gap',        label: 'Gap between tabs', kind: 'size' },
      { name: '--ui-tabs-rail',       label: 'Rail colour', kind: 'color' },
      { name: '--ui-tabs-rail-width', label: 'Rail width', kind: 'size' },
    ] },
    { label: 'Tab', controls: [
      { name: '--ui-tab-pad-x',       label: 'Padding X', kind: 'size' },
      { name: '--ui-tab-pad-y',       label: 'Padding Y', kind: 'size' },
      { name: '--ui-tab-gap',         label: 'Icon/label gap', kind: 'size' },
      { name: '--ui-tab-radius',      label: 'Corner radius', kind: 'size' },
      { name: '--ui-tab-font-size',   label: 'Font size', kind: 'size' },
      { name: '--ui-tab-font-weight', label: 'Font weight', kind: 'text' },
      { name: '--ui-tab-icon-size',   label: 'Icon size', kind: 'size' },
    ] },
    { label: 'Colour & state', controls: [
      { name: '--ui-tab-fg',              label: 'Text', kind: 'color' },
      { name: '--ui-tab-fg-hover',        label: 'Text — hover', kind: 'color' },
      { name: '--ui-tab-fg-selected',     label: 'Text — selected', kind: 'color' },
      { name: '--ui-tab-bg-hover',        label: 'Background — hover', kind: 'color' },
      { name: '--ui-tab-indicator',       label: 'Indicator', kind: 'color' },
      { name: '--ui-tab-indicator-size',  label: 'Indicator thickness', kind: 'size' },
      { name: '--ui-tab-disabled-fg',     label: 'Text — disabled', kind: 'color' },
    ] },
    { label: 'Badge', controls: [
      { name: '--ui-tab-badge-bg',          label: 'Background', kind: 'color-alpha' },
      { name: '--ui-tab-badge-fg',          label: 'Text', kind: 'color' },
      { name: '--ui-tab-badge-bg-selected', label: 'Background — selected', kind: 'color' },
      { name: '--ui-tab-badge-fg-selected', label: 'Text — selected', kind: 'color' },
    ] },
  ],

  states: ['default', 'hover', 'focus', 'selected', 'disabled'],
  compare: ['default', 'hover', 'focus', 'disabled'],

  a11y: {
    role: 'role="tablist" on the bar, role="tab" on each tab, role="tabpanel" on the panel TabPanel renders.',
    name: 'The required `label` prop names the tablist. Each tab is named by its label — plus its sub-label and count, joined explicitly, because adjacent inline spans otherwise announce as "Tasks4".',
    keyboard: [
      { keys: 'Tab',           does: 'Reaches the SET once — the selected tab — then moves past it. Roving tabindex; a nine-tab drawer is one stop, not nine.' },
      { keys: '← / →',         does: 'Move between tabs when horizontal, skipping disabled ones and wrapping at both ends.' },
      { keys: '↑ / ↓',         does: 'The same, when orientation is vertical. The other axis is deliberately ignored.' },
      { keys: 'Home / End',    does: 'First / last ENABLED tab.' },
      { keys: 'Enter / Space', does: 'Selects the focused tab under manual activation. Under automatic it is already selected.' },
    ],
    focus: 'Focus moves with the arrow keys and stays inside the visible set; collapsed "More" items are reached through the menu, which has its own keyboard model. The panel is tabIndex=0 so content with no focusable element is still reachable.',
    notes: [
      'A disabled tab stays IN the list with aria-disabled. Removing it changes the "tab 3 of 5" a screen reader announces, and hides the fact that the section exists but is not available to you.',
      'The "More" trigger is NOT role="tab" — it opens a menu and selects nothing. Labelling it as a tab makes a screen reader announce a selection state for a control that has none.',
      'TabPanel unmounts rather than hides. SIOMAC panels hold live queries; keeping seven mounted behind display:none is how one tab switch fires seven requests.',
      'Every tab emits aria-controls. Swapping content with a bare conditional instead of TabPanel leaves those pointing at nothing.',
    ],
  },

  render: (p, st) => {
    const source = b(p.overflow) ? MANY_TABS : b(p.icons) || b(p.badges) || b(p.descriptions) ? CASE_TABS : PLAIN_TABS;
    const items: TabItem[] = source.map((t, i) => ({
      ...t,
      icon: b(p.icons) ? t.icon : undefined,
      badge: b(p.badges) ? t.badge : undefined,
      description: b(p.descriptions) ? ['Case summary', 'Blocking + optional', 'Evidence on file', 'Accounts & access', 'Immutable trail'][i] : undefined,
      disabled: (b(p.disabledTab) && t.disabled === true) || (st === 'disabled' && i === 1),
    }));
    const value = items[0]?.id ?? '';

    return (
      <div style={{ width: '100%' }}>
        <Tabs
          id="gallery-tabs"
          label="Onboarding case sections"
          items={items}
          value={value}
          onChange={noop}
          orientation={s(p.orientation, 'horizontal') as TabsOrientation}
          variant={s(p.variant, 'underline') as TabsVariant}
          size={s(p.size, 'md') as TabsSize}
          activation={s(p.activation, 'automatic') as TabsActivation}
          maxVisible={b(p.overflow) ? 4 : undefined}
          actions={b(p.actions)
            ? <Button variant="secondary" size="sm" iconLeft={<LucideIcon name="Download" />}>Export</Button>
            : undefined}
          forceState={st}
        />
        {b(p.panel) && (
          <TabPanel tabsId="gallery-tabs" tabId={value} value={value}>
            <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-muted)' }}>
              The panel TabPanel renders. Every tab’s <code>aria-controls</code> points here.
            </p>
          </TabPanel>
        )}
      </div>
    );
  },

  code: p => `<Tabs
  id="onboarding-case"
  label="Onboarding case sections"
  value={tab}
  onChange={setTab}${s(p.orientation, 'horizontal') !== 'horizontal' ? `\n  orientation="${s(p.orientation)}"` : ''}${s(p.variant, 'underline') !== 'underline' ? `\n  variant="${s(p.variant)}"` : ''}${s(p.size, 'md') !== 'md' ? `\n  size="${s(p.size)}"` : ''}${s(p.activation, 'automatic') !== 'automatic' ? `\n  activation="${s(p.activation)}"` : ''}${b(p.overflow) ? '\n  maxVisible={4}' : ''}${b(p.actions) ? '\n  actions={<Button variant="secondary" size="sm">Export</Button>}' : ''}
  items={[
    { id: 'overview', label: 'Overview'${b(p.icons) ? ', icon: <LayoutGrid />' : ''} },
    { id: 'requirements', label: 'Requirements'${b(p.icons) ? ', icon: <ListChecks />' : ''}${b(p.badges) ? ', badge: blocking.length' : ''} },${b(p.disabledTab) ? `
    { id: 'audit', label: 'Audit', disabled: !can('hr.onboarding.audit'),
      disabledReason: 'Requires hr.onboarding.audit' },` : ''}
  ]}
/>

{/* One TabPanel per tab — this is what aria-controls points at. */}
<TabPanel tabsId="onboarding-case" tabId="overview" value={tab}>
  <CaseOverview caseId={id} />
</TabPanel>`,

  presets: [
    { label: 'Page tabs',        props: { orientation: 'horizontal', variant: 'underline', size: 'md', activation: 'automatic', icons: false, badges: true, descriptions: false, disabledTab: false, overflow: false, actions: false, panel: true } },
    { label: 'Icons + counts',   props: { orientation: 'horizontal', variant: 'underline', size: 'md', activation: 'automatic', icons: true, badges: true, descriptions: false, disabledTab: true, overflow: false, actions: false, panel: true } },
    { label: 'Module bar (sub-labels)', props: { orientation: 'horizontal', variant: 'underline', size: 'lg', activation: 'automatic', icons: true, badges: true, descriptions: true, disabledTab: false, overflow: false, actions: true, panel: false } },
    { label: 'Contained',        props: { orientation: 'horizontal', variant: 'contained', size: 'sm', activation: 'automatic', icons: false, badges: false, descriptions: false, disabledTab: false, overflow: false, actions: false, panel: true } },
    { label: 'Vertical',         props: { orientation: 'vertical', variant: 'underline', size: 'md', activation: 'automatic', icons: true, badges: true, descriptions: false, disabledTab: true, overflow: false, actions: false, panel: false } },
    { label: 'Subtle (in a drawer)', props: { orientation: 'horizontal', variant: 'subtle', size: 'sm', activation: 'manual', icons: false, badges: true, descriptions: false, disabledTab: false, overflow: false, actions: false, panel: true } },
    { label: 'Overflow ("More")', props: { orientation: 'horizontal', variant: 'contained', size: 'sm', activation: 'automatic', icons: false, badges: false, descriptions: false, disabledTab: false, overflow: true, actions: false, panel: false } },
  ],

  examples: [
    {
      id: 'one-component',
      title: 'One component, three appearances',
      description: 'Underline for a page, contained for a dense drawer, subtle for tabs inside an already-bordered surface. Five implementations existed to express exactly this.',
      render: () => (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
          <Tabs id="ex-underline" label="Underline" items={PLAIN_TABS} value="overview" onChange={noop} />
          <Tabs id="ex-contained" label="Contained" variant="contained" size="sm" items={PLAIN_TABS} value="tasks" onChange={noop} />
          <Tabs id="ex-subtle" label="Subtle" variant="subtle" size="sm" items={PLAIN_TABS} value="files" onChange={noop} />
        </div>
      ),
    },
    {
      id: 'vertical',
      title: 'Vertical is an orientation, not a component',
      description: 'The same props. Only the arrow-key axis changes with it — ↑/↓ move, ←/→ are ignored.',
      render: () => (
        <div style={{ display: 'flex', gap: '20px', alignItems: 'flex-start' }}>
          <Tabs
            id="ex-vertical"
            label="Settings sections"
            orientation="vertical"
            items={[
              { id: 'general', label: 'General', icon: <LucideIcon name="Settings" /> },
              { id: 'security', label: 'Security', icon: <LucideIcon name="ShieldCheck" />, badge: 2 },
              { id: 'notifications', label: 'Notifications', icon: <LucideIcon name="Bell" /> },
            ]}
            value="security"
            onChange={noop}
          />
          <TabPanel tabsId="ex-vertical" tabId="security" value="security">
            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Two security settings need review.</span>
          </TabPanel>
        </div>
      ),
    },
    {
      id: 'overflow',
      title: 'Nine tabs in a drawer',
      description: '`maxVisible={4}` collapses the rest into the canonical menu, and the trigger shows the active tab when it is one of the hidden ones — otherwise the strip claims nothing is selected while a panel is open.',
      render: () => (
        <Tabs
          id="ex-overflow"
          label="Rate version sections"
          variant="contained"
          size="sm"
          items={MANY_TABS}
          maxVisible={4}
          value="timeline"
          onChange={noop}
        />
      ),
    },
  ],
};

export const NAVIGATION_DEFS: readonly ComponentDef[] = [
  tabsDef,
  treeViewDef,
  wizardDef,
  pageHeaderDef,
  pageActionBarDef,
];
