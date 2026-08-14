import { Breadcrumbs } from '../navigation/Breadcrumbs';
import { Alert, type AlertPlacement, type AlertTone } from '../feedback/Alert';
import { Progress, type ProgressShape, type ProgressSize, type ProgressTone } from '../feedback/Progress';
import { Accordion } from '../containers/Accordion';
import { Button } from '../primitives/Button';
import { LucideIcon } from '../LucideIcon';
import { type ComponentDef, type PropValues } from './types';

const s = (v: PropValues[string] | undefined, fallback = ''): string => typeof v === 'string' ? v : fallback;
const b = (v: PropValues[string] | undefined): boolean => v === true;
const n = (v: PropValues[string] | undefined, fallback: number): number => typeof v === 'number' ? v : fallback;
const noop = (): void => { /* preview */ };

export const breadcrumbsDef: ComponentDef = {
  id: 'breadcrumbs', name: 'Breadcrumbs', category: 'navigation', status: 'stable',
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
  componentPath: 'src/ui/feedback/Progress.tsx', importFrom: '@ui',
  description: 'Determinate or indeterminate task progress. Bar, ring and meter are shapes of the same accessible value.',
  props: {
    label: { type: 'text', label: 'Label', default: 'Uploading evidence' },
    value: { type: 'number', label: 'Value', default: 64, min: 0, max: 100, step: 1 },
    shape: { type: 'segmented', label: 'Shape', options: ['bar', 'ring', 'meter'], default: 'bar' },
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
  ] }],
  states: ['default', 'loading'], compare: ['default', 'loading'],
  a11y: {
    role: 'progressbar', name: 'The required label.', keyboard: [], focus: 'Never focusable.',
    notes: ['Determinate progress exposes min, max, now and formatted value. Indeterminate progress omits numeric ARIA values.'],
  },
  render: (p, state) => <Progress label={s(p.label, 'Uploading evidence')} value={b(p.indeterminate) || state === 'loading' ? undefined : n(p.value, 64)} shape={s(p.shape, 'bar') as ProgressShape} tone={s(p.tone, 'accent') as ProgressTone} size={s(p.size, 'md') as ProgressSize} showValue={b(p.showValue)} />,
  code: p => `<Progress label="${s(p.label, 'Uploading evidence')}"${b(p.indeterminate) ? '' : ` value={${n(p.value, 64)}}`} shape="${s(p.shape, 'bar')}" tone="${s(p.tone, 'accent')}" />`,
};

export const accordionDef: ComponentDef = {
  id: 'accordion', name: 'Accordion', category: 'containers', status: 'stable',
  componentPath: 'src/ui/containers/Accordion.tsx', importFrom: '@ui',
  description: 'Collapsible content sections with controlled or uncontrolled state and single or multiple expansion.',
  props: {
    multiple: { type: 'boolean', label: 'Multiple expansion', default: false },
    firstOpen: { type: 'boolean', label: 'First section open', default: true },
    descriptions: { type: 'boolean', label: 'Descriptions', default: true },
    keepMounted: { type: 'boolean', label: 'Keep panels mounted', default: false },
  },
  style: [{ label: 'Sections', controls: [
    { name: '--ui-accordion-border', label: 'Border', kind: 'color' },
    { name: '--ui-accordion-bg', label: 'Background', kind: 'color' },
    { name: '--ui-accordion-hover-bg', label: 'Hover background', kind: 'color' },
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
  render: (p, state) => <Accordion multiple={b(p.multiple)} defaultExpanded={b(p.firstOpen) || state === 'open' ? ['scope'] : []} keepMounted={b(p.keepMounted)} items={[
    { id: 'scope', title: 'Scope and eligibility', description: b(p.descriptions) ? 'Who this policy applies to' : undefined, icon: <LucideIcon name="Users" />, content: 'All permanent employees assigned to active operating sites.' },
    { id: 'approval', title: 'Approval rules', description: b(p.descriptions) ? 'Maker-checker and escalation' : undefined, icon: <LucideIcon name="ShieldCheck" />, content: 'The creator cannot approve their own change. Escalation starts after two business days.' },
    { id: 'audit', title: 'Audit retention', description: b(p.descriptions) ? 'Records and evidence' : undefined, icon: <LucideIcon name="History" />, content: 'Every decision, reason and attachment remains available for seven years.' },
  ]} />,
  code: p => `<Accordion items={sections}${b(p.multiple) ? ' multiple' : ''}${b(p.keepMounted) ? ' keepMounted' : ''} />`,
};

export const REMAINING_PRIMITIVE_DEFS: readonly ComponentDef[] = [breadcrumbsDef, alertDef, progressDef, accordionDef];
