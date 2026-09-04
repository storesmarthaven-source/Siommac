import { type VNode } from 'preact';
import { Breadcrumbs } from '../navigation/Breadcrumbs';
import { Alert, type AlertPlacement, type AlertTone } from '../feedback/Alert';
import { Progress, type ProgressShape, type ProgressSize, type ProgressTone } from '../feedback/Progress';
import { ActivityGauge } from '../data/ActivityGauge';
import { Accordion } from '../containers/Accordion';
import { Button } from '../primitives/Button';
import { LucideIcon } from '../LucideIcon';
import { AppTopBarArtwork, UserPillArtwork } from '../../components/shared/AppTopBar';
import { type ComponentDef, type PropValues } from './types';

const s = (v: PropValues[string] | undefined, fallback = ''): string => typeof v === 'string' ? v : fallback;
const b = (v: PropValues[string] | undefined): boolean => v === true;
const n = (v: PropValues[string] | undefined, fallback: number): number => typeof v === 'number' ? v : fallback;
const noop = (): void => { /* preview */ };

export const breadcrumbsDef: ComponentDef = {
  id: 'breadcrumbs', name: 'Breadcrumbs', category: 'navigation', status: 'stable',
  thumbnail: 'breadcrumbs',
  componentPath: 'src/ui/navigation/Breadcrumbs.tsx', importFrom: '@ui',
  description: 'An ancestor trail that marks the current page and collapses long middle paths into a keyboard-accessible Popover.',
  props: {
    depth: { type: 'number', label: 'Trail depth', default: 4, min: 2, max: 7, step: 1 },
    maxVisible: { type: 'number', label: 'Visible items', default: 4, min: 3, max: 7, step: 1 },
  },
  style: [{ label: 'Trail', controls: [
    { name: '--ui-breadcrumb-gap', label: 'Item gap', kind: 'size' },
    { name: '--ui-breadcrumb-fg', label: 'Ancestor text', kind: 'color' },
    { name: '--ui-breadcrumb-current-fg', label: 'Current text', kind: 'color' },
    { name: '--ui-breadcrumb-hover-fg', label: 'Hover text', kind: 'color' },
    { name: '--ui-breadcrumb-font-size', label: 'Text size', kind: 'size' },
    { name: '--ui-breadcrumb-item-min-height', label: 'Item height', kind: 'size' },
    { name: '--ui-breadcrumb-link-weight', label: 'Ancestor weight', kind: 'text' },
    { name: '--ui-breadcrumb-label-weight', label: 'Structural label weight', kind: 'text' },
    { name: '--ui-breadcrumb-current-weight', label: 'Current-page weight', kind: 'text' },
    { name: '--ui-breadcrumb-surface', label: 'Surface', kind: 'color' },
    { name: '--ui-breadcrumb-border', label: 'Border', kind: 'color' },
    { name: '--ui-breadcrumb-current-bg', label: 'Current background', kind: 'color' },
    { name: '--ui-breadcrumb-radius', label: 'Corner radius', kind: 'size' },
  ] }],
  states: ['default'], compare: ['default'],
  a11y: {
    role: 'navigation with an ordered list', name: 'The label prop names the breadcrumb landmark.',
    keyboard: [{ keys: 'Tab / Enter', does: 'Visits linked ancestors or opens the collapsed ancestor Popover.' }, { keys: 'Escape', does: 'Closes the collapsed ancestor Popover.' }],
    focus: 'Only actionable ancestors and the overflow trigger enter the tab order.',
    notes: ['The final item always carries aria-current="page" and is never rendered as a link.'],
  },
  render: p => {
    const all = [
      { label: 'Home', href: '#home', icon: <LucideIcon name="Home" size={19} />, iconOnly: true },
      { label: 'Settings', href: '#settings' }, { label: 'Team members', href: '#team' },
      { label: 'Olivia Rhye' }, { label: 'Access', href: '#access' },
      { label: 'Permissions', href: '#permissions' }, { label: 'Overview' },
    ];
    return <Breadcrumbs items={all.slice(0, n(p.depth, 4))} maxVisible={n(p.maxVisible, 4)} />;
  },
  code: p => `<Breadcrumbs
  items={[{ label: 'Home', href: '/', icon: <HomeIcon />, iconOnly: true }, { label: 'Settings', href: '/settings' }, { label: 'Team members', href: '/settings/team' }, { label: 'Olivia Rhye' }]}
  maxVisible={${n(p.maxVisible, 4)}}
/>`,
};

export const alertDef: ComponentDef = {
  id: 'alert', name: 'Alert', category: 'feedback', status: 'stable',
  thumbnail: 'alert',
  componentPath: 'src/ui/feedback/Alert.tsx', importFrom: '@ui',
  description: 'One semantic message surface. Inline and page banner treatments are placement, while tone carries operational meaning.',
  props: {
    title: { type: 'text', label: 'Title', default: 'Approval required' },
    message: { type: 'text', label: 'Message', default: 'A second approver must review this payroll run before release.' },
    tone: { type: 'segmented', label: 'Tone', options: ['neutral', 'info', 'success', 'warning', 'danger'], default: 'warning' },
    placement: { type: 'segmented', label: 'Placement', options: ['inline', 'page'], default: 'inline' },
    dismissible: { type: 'boolean', label: 'Dismissible', default: true },
    action: { type: 'boolean', label: 'Action', default: true },
    announce: { type: 'boolean', label: 'Announce on insertion', default: false },
  },
  style: [{ label: 'Message surface', controls: [
    { name: '--ui-alert-radius', label: 'Corner radius', kind: 'size' },
    { name: '--ui-alert-padding', label: 'Padding', kind: 'text' },
    { name: '--ui-alert-gap', label: 'Content gap', kind: 'size' },
    { name: '--ui-alert-border', label: 'Border', kind: 'color' },
    { name: '--ui-alert-bg', label: 'Background', kind: 'color' },
    { name: '--ui-alert-accent', label: 'Accent', kind: 'color' },
  ] }],
  states: ['default'], compare: ['default'],
  a11y: {
    role: 'No live role for static content; announce opts into alert or status for content inserted after load.',
    name: 'Visible title and body.', keyboard: [{ keys: 'Tab', does: 'Reaches only composed actions and the optional dismiss button.' }],
    focus: 'The alert itself is not focusable.', notes: ['Do not set announce on a message already present at page load.'],
  },
  render: p => <Alert tone={s(p.tone, 'warning') as AlertTone} placement={s(p.placement, 'inline') as AlertPlacement} title={s(p.title)} announce={b(p.announce)} onDismiss={b(p.dismissible) ? noop : undefined} actions={b(p.action) ? <Button variant="link" size="sm">Open approval</Button> : undefined}>{s(p.message)}</Alert>,
  code: p => `<Alert tone="${s(p.tone, 'warning')}" placement="${s(p.placement, 'inline')}" title="${s(p.title)}"${b(p.dismissible) ? ' onDismiss={hide}' : ''}>${s(p.message)}</Alert>`,
};

export const progressDef: ComponentDef = {
  id: 'progress', name: 'Progress', category: 'feedback', status: 'stable',
  thumbnail: 'progress',
  componentPath: 'src/ui/feedback/Progress.tsx', importFrom: '@ui',
  description: 'Show task completion, compliance or capacity as a bar, ring, gauge or stepped meter.',
  previewAxis: 'shape',
  previewSamples: [
    { value: 'bar', title: 'Bar', description: 'Inline task completion.', props: { shape: 'bar', label: 'Uploading evidence', value: 64 } },
    { value: 'ring', title: 'Ring', description: 'Compact KPI progress.', props: { shape: 'ring', label: 'CAPA complete', value: 40 } },
    { value: 'gauge', title: 'Gauge', description: 'Directional performance.', props: { shape: 'gauge', label: 'Training compliance', value: 72 } },
    { value: 'meter', title: 'Meter', description: 'Stepped capacity bands.', props: { shape: 'meter', label: 'Evidence storage', value: 58 } },
  ],
  props: {
    label: { type: 'text', label: 'Label', default: 'Uploading evidence' },
    value: { type: 'number', label: 'Value', default: 64, min: 0, max: 100, step: 1 },
    shape: { type: 'select', label: 'Shape', options: ['bar', 'ring', 'gauge', 'meter'], default: 'ring' },
    tone: { type: 'segmented', label: 'Tone', options: ['accent', 'success', 'warning', 'danger'], default: 'accent' },
    size: { type: 'segmented', label: 'Size', options: ['sm', 'md', 'lg'], default: 'md' },
    indeterminate: { type: 'boolean', label: 'Indeterminate', default: false },
    showValue: { type: 'boolean', label: 'Show value', default: true },
  },
  style: [{ label: 'Indicator', controls: [
    { name: '--ui-progress-track', label: 'Track', kind: 'color' },
    { name: '--ui-progress-fill', label: 'Fill', kind: 'color' },
    { name: '--ui-progress-radius', label: 'Radius', kind: 'size' },
    { name: '--ui-progress-bar-height', label: 'Bar height', kind: 'size' },
    { name: '--ui-progress-ring-size', label: 'Ring size', kind: 'size' },
    { name: '--ui-progress-gauge-size', label: 'Gauge size', kind: 'size' },
  ] }],
  states: ['default', 'loading'], compare: ['default', 'loading'],
  a11y: {
    role: 'progressbar', name: 'The required label.', keyboard: [], focus: 'Never focusable.',
    notes: ['Determinate progress exposes min, max, now and formatted value. Indeterminate progress omits numeric ARIA values.'],
  },
  render: (p, state) => <Progress label={s(p.label, 'Uploading evidence')} value={b(p.indeterminate) || state === 'loading' ? undefined : n(p.value, 64)} shape={s(p.shape, 'ring') as ProgressShape} tone={s(p.tone, 'accent') as ProgressTone} size={s(p.size, 'lg') as ProgressSize} showValue={p.showValue !== false} />,
  code: p => `<Progress label="${s(p.label, 'Uploading evidence')}"${b(p.indeterminate) ? '' : ` value={${n(p.value, 64)}}`} shape="${s(p.shape, 'ring')}" tone="${s(p.tone, 'accent')}" />`,
};

export const accordionDef: ComponentDef = {
  id: 'accordion', name: 'Accordion', category: 'containers', status: 'stable',
  thumbnail: 'accordion',
  componentPath: 'src/ui/containers/Accordion.tsx', importFrom: '@ui',
  description: 'Collapsible content sections with controlled or uncontrolled state and single or multiple expansion.',
  props: {
    variant: { type: 'segmented', label: 'Appearance', options: ['card', 'bare'], default: 'card' },
    multiple: { type: 'boolean', label: 'Multiple expansion', default: false },
    firstOpen: { type: 'boolean', label: 'First section open', default: true },
    descriptions: { type: 'boolean', label: 'Descriptions', default: true },
    keepMounted: { type: 'boolean', label: 'Keep panels mounted', default: false },
  },
  style: [{ label: 'Sections', controls: [
    { name: '--ui-accordion-border', label: 'Border', kind: 'color' },
    { name: '--ui-accordion-bg', label: 'Background', kind: 'color' },
    { name: '--ui-accordion-trigger-bg', label: 'Trigger background', kind: 'color' },
    { name: '--ui-accordion-hover-bg', label: 'Hover background', kind: 'color' },
    { name: '--ui-accordion-trigger-border-bottom', label: 'Trigger separator', kind: 'text' },
    { name: '--ui-accordion-radius', label: 'Corner radius', kind: 'size' },
    { name: '--ui-accordion-trigger-padding', label: 'Trigger padding', kind: 'text' },
    { name: '--ui-accordion-panel-padding', label: 'Panel padding', kind: 'text' },
  ] }],
  states: ['default', 'open'], compare: ['default', 'open'],
  a11y: {
    role: 'Native heading and button per item; expanded panels are named regions.', name: 'Each trigger is named by its visible title.',
    keyboard: [{ keys: 'Enter / Space', does: 'Toggles the focused section using native button behavior.' }, { keys: 'Tab', does: 'Moves through section triggers.' }],
    focus: 'Remains on the trigger after toggling.', notes: ['Choose headingLevel to preserve the surrounding document outline.'],
  },
  render: (p, state) => <Accordion variant={s(p.variant, 'card') as 'card' | 'bare'} multiple={b(p.multiple)} defaultExpanded={b(p.firstOpen) || state === 'open' ? ['scope'] : []} keepMounted={b(p.keepMounted)} items={[
    { id: 'scope', title: 'Scope and eligibility', description: b(p.descriptions) ? 'Who this policy applies to' : undefined, icon: <LucideIcon name="Users" />, content: 'All permanent employees assigned to active operating sites.' },
    { id: 'approval', title: 'Approval rules', description: b(p.descriptions) ? 'Maker-checker and escalation' : undefined, icon: <LucideIcon name="ShieldCheck" />, content: 'The creator cannot approve their own change. Escalation starts after two business days.' },
    { id: 'audit', title: 'Audit retention', description: b(p.descriptions) ? 'Records and evidence' : undefined, icon: <LucideIcon name="History" />, content: 'Every decision, reason and attachment remains available for seven years.' },
  ]} />,
  code: p => `<Accordion items={sections} variant="${s(p.variant, 'card')}"${b(p.multiple) ? ' multiple' : ''}${b(p.keepMounted) ? ' keepMounted' : ''} />`,
};

const shellPreview = (p: PropValues): VNode => {
  const layout = s(p.layout, 'search') as 'search' | 'actions' | 'user-pill' | 'full';
  const appearance = s(p.appearance, 'dark') as 'dark' | 'light';
  const lightSurface = s(p.lightSurface, 'neutral') as 'white' | 'neutral' | 'brand-tint';
  const actionTreatment = s(p.actionTreatment, 'outline') as 'outline' | 'ghost' | 'soft';
  const chevronTreatment = s(p.chevronTreatment, 'solid') as 'solid' | 'outline' | 'soft';
  const brandPreview = s(p.brandPreview, 'theme') as 'theme' | 'blue' | 'green';
  const actionIconStyle = s(p.actionIconStyle, 'line') as 'line' | 'app';
  return <div class={`sds-library-app-preview sds-library-app-preview--${layout}${b(p.menuOpen) ? ' sds-library-app-preview--menu-open' : ''}`}><AppTopBarArtwork
  layout={layout} appearance={appearance} lightSurface={lightSurface} actionTreatment={actionTreatment}
  chevronTreatment={chevronTreatment} brandPreview={brandPreview} actionIconStyle={actionIconStyle}
  showNotifications={b(p.showNotifications)} showMessages={b(p.showMessages)} showTickets={b(p.showTickets)} menuOpen={b(p.menuOpen)} /></div>;
};

export const activityGaugeDef: ComponentDef = {
  id: 'activity-gauge', name: 'Activity Gauge', category: 'data', status: 'stable',
  thumbnail: 'activity-gauge',
  componentPath: 'src/ui/data/ActivityGauge.tsx', importFrom: '@ui',
  description: 'Compare bounded operational metrics across three concentric radial series with a shared scale.',
  props: {
    value: { type: 'number', label: 'Active', default: 866, min: 0, max: 1000, step: 1 },
    scheduledValue: { type: 'number', label: 'Scheduled', default: 774, min: 0, max: 1000, step: 1 },
    overdueValue: { type: 'number', label: 'Overdue', default: 660, min: 0, max: 1000, step: 1 },
    max: { type: 'number', label: 'Scale maximum', default: 1000, min: 1, max: 10000, step: 1 },
    gaugeColor: { type: 'color', label: 'Gauge color', default: '#7f56d9', help: 'The remaining ring colors are generated automatically.' },
    showLabel: { type: 'boolean', label: 'Show label', default: true },
    showValue: { type: 'boolean', label: 'Show value', default: true },
    showLegend: { type: 'boolean', label: 'Show legend', default: true },
    showTooltip: { type: 'boolean', label: 'Show tooltip', default: true },
  },
  style: [{ label: 'Gauge', controls: [
    { name: '--ui-activity-gauge-track', label: 'Track', kind: 'color' },
    { name: '--ui-activity-gauge-fill', label: 'Value', kind: 'color', linkedTo: '--ui-color-action-primary' },
    { name: '--ui-activity-gauge-label', label: 'Label', kind: 'color', linkedTo: '--ui-color-text-secondary' },
    { name: '--ui-activity-gauge-value-color', label: 'Number', kind: 'color', linkedTo: '--ui-color-text-primary' },
    { name: '--ui-activity-gauge-stroke', label: 'Stroke width', kind: 'size' },
  ] }],
  states: ['default'], compare: ['default'],
  a11y: {
    role: 'meter', name: 'The visible metric label.', keyboard: [], focus: 'Never focusable.',
    notes: ['Exposes minimum, maximum, current value and formatted value.', 'Use Progress instead when the value represents task completion.'],
  },
  render: p => <ActivityGauge
    value={n(p.value, 866)} label="Active users" max={n(p.max, 1000)} size={'sm'} color={s(p.gaugeColor, '#7f56d9')}
    showLabel={p.showLabel !== false} showValue={p.showValue !== false}
    showLegend={p.showLegend !== false} showTooltip={p.showTooltip !== false}
    series={[{ label: 'Overdue', value: n(p.overdueValue, 660) }, { label: 'Scheduled', value: n(p.scheduledValue, 774) }, { label: 'Active', value: n(p.value, 866) }]}
  />,
  code: p => `<ActivityGauge value={${n(p.value, 866)}} label="Active users" max={${n(p.max, 1000)}} color="${s(p.gaugeColor, '#7f56d9')}" />`,
};

const userPillPreview = (): VNode => <div class="app-topbar sds-library-user-preview"><div class="app-topbar-main"><div class="app-topbar-pill"><UserPillArtwork /></div></div></div>;

export const appTopBarDef: ComponentDef = {
  id: 'app-top-bar', name: 'App Top Bar', category: 'patterns', status: 'stable',
  thumbnail: 'app-top-bar',
  componentPath: 'src/components/shared/AppTopBar.tsx', importFrom: '@shared',
  description: 'The single global application frame that hosts search, AI actions, account controls and module navigation.',
  props: {
    layout: { type: 'segmented', label: 'Layout', options: ['search', 'actions', 'user-pill'], default: 'search' },
    appearance: { type: 'segmented', label: 'Surface mode', options: ['dark', 'light'], default: 'dark', help: 'Preview Light or Dark independently. Production follows the application theme.' },
    lightSurface: { type: 'select', label: 'Surface', options: ['white', 'neutral', 'brand-tint'], default: 'neutral', visibleWhen: { prop: 'appearance', equals: 'light' } },
    actionTreatment: { type: 'select', label: 'Action icons', options: ['outline', 'ghost', 'soft'], default: 'outline', help: 'Actions never use a solid brand fill.', visibleWhen: { prop: 'appearance', equals: 'light' } },
    actionIconStyle: { type: 'segmented', label: 'Icon style', options: ['line', 'app'], default: 'line', help: 'Outline uses Lucide line icons; App shows the original filled application glyphs.', visibleWhen: { prop: 'appearance', equals: 'light' } },
    chevronTreatment: { type: 'select', label: 'Chevron', options: ['solid', 'outline', 'soft'], default: 'solid', visibleWhen: { prop: 'appearance', equals: 'light' } },
    brandPreview: { type: 'segmented', label: 'Logo colour', options: ['theme', 'blue', 'green'], default: 'theme', help: 'Theme uses the logo-derived brand token. Blue and Green are preview samples only.', visibleWhen: { prop: 'appearance', equals: 'light' } },
    showNotifications: { type: 'boolean', label: 'Notifications', default: true, visibleWhen: { prop: 'layout', equals: 'actions' } },
    showMessages: { type: 'boolean', label: 'Messages', default: true, visibleWhen: { prop: 'layout', equals: 'actions' } },
    showTickets: { type: 'boolean', label: 'Support tickets', default: true, visibleWhen: { prop: 'layout', equals: 'actions' } },
    menuOpen: { type: 'boolean', label: 'Menu open', default: false, help: 'Preview only; it is never published as application state.', visibleWhen: { prop: 'layout', equals: 'user-pill' } },
  },
  style: [
    { label: 'Bar', controls: [
      { name: '--ui-app-topbar-bg', label: 'Background', kind: 'color', linkedTo: '--ui-color-nav-background' },
      { name: '--ui-app-topbar-fg', label: 'Content color', kind: 'color', linkedTo: '--ui-color-text-inverse' },
      { name: '--ui-app-topbar-muted-fg', label: 'Muted content', kind: 'color-alpha' },
      { name: '--ui-app-topbar-radius', label: 'Corner radius', kind: 'size' },
      { name: '--ui-app-topbar-height', label: 'Row height', kind: 'size' },
      { name: '--ui-app-topbar-breadcrumb-border', label: 'Breadcrumb divider', kind: 'color-alpha' },
      { name: '--ui-app-topbar-breadcrumb-font-size', label: 'Breadcrumb text', kind: 'size' },
    ] },
    { label: 'Search', controls: [
      { name: '--ui-app-topbar-search-bg', label: 'Field background', kind: 'color-alpha' },
      { name: '--ui-app-topbar-search-border', label: 'Field border', kind: 'color-alpha' },
      { name: '--ui-app-topbar-search-radius', label: 'Corner radius', kind: 'size' },
    ] },
    { label: 'Quick actions', controls: [
      { name: '--ui-app-topbar-action-bg', label: 'Icon background', kind: 'color-alpha' },
      { name: '--ui-app-topbar-action-fg', label: 'Icon color', kind: 'color', linkedTo: '--ui-color-text-inverse' },
    ] },
    { label: 'Account', controls: [
      { name: '--ui-app-topbar-profile-bg', label: 'Profile background', kind: 'color-alpha' },
      { name: '--ui-app-topbar-profile-bg-hover', label: 'Profile hover', kind: 'color-alpha' },
      { name: '--ui-app-topbar-avatar-ring', label: 'Avatar ring', kind: 'color' },
      { name: '--ui-app-topbar-divider', label: 'Separator', kind: 'color-alpha' },
      { name: '--ui-app-topbar-caret-bg', label: 'Chevron background', kind: 'color-alpha' },
      { name: '--ui-app-topbar-caret-bg-hover', label: 'Chevron hover', kind: 'color-alpha' },
      { name: '--ui-app-topbar-caret-fg', label: 'Chevron color', kind: 'color' },
      { name: '--ui-app-topbar-caret-width', label: 'Chevron width', kind: 'size' },
    ] },
  ],
  previewAxis: 'layout',
  previewSamples: [
    { value: 'search', title: 'Search', description: 'Global search and command access.', props: { layout: 'search' }, diagram: 'topbar-layout' },
    { value: 'actions', title: 'Action buttons', description: 'Notifications, messages and support shortcuts.', props: { layout: 'actions' }, diagram: 'topbar-layout' },
    { value: 'user-pill', title: 'User pill', description: 'Signed-in identity and account menu.', props: { layout: 'user-pill', menuOpen: true }, diagram: 'topbar-layout' },
  ],
  states: ['default'], compare: ['default'],
  a11y: { role: 'banner', name: 'Global application navigation and actions.', keyboard: [{ keys: 'Tab', does: 'Moves through search, AI and account actions.' }], focus: 'Interactive controls retain visible focus.', notes: ['Mount once in AppShell; module navigation uses the provided slot.'] },
  render: shellPreview, code: () => `<AppTopBar>\n  <UserPill />\n</AppTopBar>`,
};

export const userPillDef: ComponentDef = {
  id: 'user-pill', name: 'User Pill', category: 'patterns', status: 'stable',
  thumbnail: 'user-pill',
  componentPath: 'src/components/shared/UserPill.tsx', importFrom: '@shared',
  description: 'The account cluster used inside the global top bar: profile identity, quick actions and account menu.',
  props: {}, style: [], states: ['default'], compare: ['default'],
  a11y: { role: 'group', name: 'Signed-in user identity and account actions.', keyboard: [{ keys: 'Tab / Enter', does: 'Visits quick actions and opens the account menu.' }], focus: 'Every action has a visible focus state.', notes: ['Rendered by AppTopBar so the two pieces behave as one app control plane.'] },
  render: userPillPreview, code: () => `<AppTopBar><UserPill /></AppTopBar>`,
};

export const REMAINING_PRIMITIVE_DEFS: readonly ComponentDef[] = [breadcrumbsDef, alertDef, progressDef, activityGaugeDef, accordionDef, appTopBarDef, userPillDef];
