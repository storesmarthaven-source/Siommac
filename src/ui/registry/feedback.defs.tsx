/** Canonical result and cold-loading feedback states. */
import { EmptyState, type EmptyStateSize, type EmptyTone } from '../components/EmptyState';
import { ListSkeleton, Skeleton, SkeletonText } from '../components/Skeleton';
import { Spinner } from '../components/Spinner';
import { ToastCard } from '../toast/ToastCard';
import { toast as notify } from '../toast/toastStore';
import type { ToastRecord, ToastTier, ToastVariant } from '../toast/toastTypes';
import { LucideIcon, type LucideName } from '../LucideIcon';
import { Button } from '../primitives/Button';
import { type ComponentDef, type PropValues } from './types';

const s = (value: PropValues[string] | undefined, fallback = ''): string => typeof value === 'string' ? value : fallback;
const b = (value: PropValues[string] | undefined): boolean => value === true;

function toastRecord(p: PropValues): ToastRecord {
  const tier = s(p.tier, 'normal') as ToastTier;
  const tone = s(p.tone, 'success') as ToastVariant;
  const icon = s(p.icon, 'CircleCheck');
  const timer = b(p.timer);
  const duration = timer && typeof p.duration === 'number' ? p.duration : 0;
  return {
    id: 'studio-toast', tier, variant: tone,
    title: tone === 'loading' ? 'Updating records' : 'Changes saved',
    description: 'Your changes are now available across SIOMAC.',
    duration, dismissible: b(p.dismissible), ariaLive: tone === 'error' ? 'assertive' : 'polite', createdAt: 0,
    icon: icon === 'None' ? null : icon as LucideName,
    progress: b(p.progress),
    moduleLabel: tier !== 'normal' && b(p.chips) ? 'Employees' : undefined,
    statusLabel: tier !== 'normal' && b(p.chips) ? 'Complete' : undefined,
    details: tier !== 'normal' && b(p.details) ? [{ label: 'Records', value: '18 updated' }] : undefined,
    note: tier === 'action' && b(p.note) ? 'You can review the audit entry.' : undefined,
    file: tier === 'rich' && b(p.file) ? { name: 'employee-import.csv', sizeLabel: '24 KB', subtitle: 'Import complete' } : undefined,
    actions: tier !== 'normal' && b(p.action) ? [{ label: 'View details', dismissOnClick: true }] : undefined,
  };
}

function triggerToast(record: ToastRecord): void {
  const actionVariant = record.variant === 'loading' ? 'info' : record.variant;
  const common = {
    title: record.title, description: record.description, variant: actionVariant,
    duration: record.duration, dismissible: record.dismissible, icon: record.icon, progress: record.progress,
  };
  if (record.tier === 'action') {
    notify.action({ ...common, moduleLabel: record.moduleLabel, statusLabel: record.statusLabel, details: record.details,
      note: record.note, actions: record.actions ?? [{ label: 'View details' }] });
  } else if (record.tier === 'rich') {
    notify.rich({ ...common, moduleLabel: record.moduleLabel, statusLabel: record.statusLabel, details: record.details,
      file: record.file, actions: record.actions });
  } else {
    notify(record.title, { ...common, variant: record.variant, title: record.title });
  }
}

export const emptyStateDef: ComponentDef = {
  id: 'empty-state',
  name: 'EmptyState',
  category: 'feedback',
  description: 'Actionable absence or no-results guidance with one semantic title, tonal icon, explanation and optional canonical actions.',
  status: 'stable',
  componentPath: 'src/ui/components/EmptyState.tsx',
  importFrom: '@ui',
  props: {
    title: { type: 'text', label: 'Title', default: 'No documents yet' },
    text: { type: 'text', label: 'Guidance', default: 'Upload the first document to begin this record.' },
    tone: { type: 'segmented', label: 'Tone', options: ['blue', 'amber', 'green', 'purple', 'gray'], default: 'blue' },
    size: { type: 'segmented', label: 'Size', options: ['default', 'compact'], default: 'default' },
    action: { type: 'boolean', label: 'Action', default: true },
  },
  style: [
    { label: 'Layout', controls: [
      { name: '--ui-empty-padding', label: 'Padding', kind: 'size' },
      { name: '--ui-empty-gap', label: 'Content gap', kind: 'size' },
      { name: '--ui-empty-max-width', label: 'Maximum width', kind: 'size' },
      { name: '--ui-empty-icon-size', label: 'Icon disc', kind: 'size' },
    ] },
    { label: 'Type', controls: [
      { name: '--ui-empty-title-size', label: 'Title size', kind: 'size' },
      { name: '--ui-empty-title-color', label: 'Title', kind: 'color' },
      { name: '--ui-empty-text-color', label: 'Guidance', kind: 'color' },
      { name: '--ui-empty-note-color', label: 'Note', kind: 'color' },
    ] },
  ],
  states: ['default'],
  compare: ['default'],
  a11y: {
    role: 'No role for static absence; consumers opt into status or alert only when an async result change must be announced.',
    name: 'A configurable h2/h3/h4 supplies the visible title. Decorative icon nodes are hidden.',
    keyboard: [{ keys: 'Tab', does: 'Reaches only composed actions; the empty state itself is not a focus stop.' }],
    focus: 'No focus management. Composed Buttons own their behaviour.',
    notes: ['Choose headingLevel to fit the surrounding document outline. Do not use an EmptyState as a loading placeholder.'],
  },
  migration: {
    replaces: ['.wf-empty', '.hrfin-empty', '.obx-empty'],
    nextSurface: 'Checkbox / RadioGroup / Switch',
    notes: [
      'The complete workflow family now uses canonical EmptyState and its two competing .wf-empty CSS definitions are deleted.',
      'Four HSE drawer-local EmptyState functions are exact dirty-file debt and remain deferred until their owners are naturally touched.',
    ],
  },
  render: p => (
    <EmptyState
      icon={<LucideIcon name="FolderOpen" />}
      title={s(p.title, 'No documents yet')}
      text={s(p.text)}
      tone={s(p.tone, 'blue') as EmptyTone}
      size={s(p.size, 'default') as EmptyStateSize}
      actions={b(p.action) ? <Button variant="primary">Upload document</Button> : undefined}
    />
  ),
  code: p => `<EmptyState
  icon={<FolderOpen />}
  title="${s(p.title, 'No documents yet')}"
  text="${s(p.text)}"${s(p.tone, 'blue') !== 'blue' ? `\n  tone="${s(p.tone)}"` : ''}${s(p.size, 'default') !== 'default' ? `\n  size="${s(p.size)}"` : ''}${b(p.action) ? '\n  actions={<Button>Upload document</Button>}' : ''}
/>`,
};

export const skeletonDef: ComponentDef = {
  id: 'skeleton',
  name: 'Skeleton',
  category: 'feedback',
  description: 'Cold-path geometry for content whose real shape is known; never replaces cached or placeholder data that can already be rendered.',
  status: 'stable',
  componentPath: 'src/ui/components/Skeleton.tsx',
  importFrom: '@ui',
  props: {
    shape: { type: 'segmented', label: 'Shape', options: ['block', 'text', 'list'], default: 'list' },
    rows: { type: 'number', label: 'Rows', default: 4, min: 1, max: 8, step: 1 },
  },
  states: ['default'],
  compare: ['default'],
  a11y: {
    role: null,
    name: 'Skeleton geometry is aria-hidden. The owning region supplies aria-busy and a loading name.',
    keyboard: [],
    focus: 'Never focusable.',
    notes: ['Use only when no real data exists. Cached data remains visible during refetch.'],
  },
  migration: {
    replaces: ['.vt-skeleton', '.mps-skel'],
    nextSurface: 'Checkbox / RadioGroup / Switch',
    notes: ['The HSE Workflows local Skeleton is deleted; every workflow cold state uses canonical ListSkeleton.'],
  },
  render: p => {
    const rows = typeof p.rows === 'number' ? p.rows : 4;
    if (p.shape === 'block') return <Skeleton height={80} radius={12} />;
    if (p.shape === 'text') return <SkeletonText lines={rows} />;
    return <ListSkeleton rows={rows} avatar={false} />;
  },
  code: p => p.shape === 'block'
    ? '<Skeleton height={80} radius={12} />'
    : p.shape === 'text'
      ? `<SkeletonText lines={${typeof p.rows === 'number' ? p.rows : 4}} />`
      : `<ListSkeleton rows={${typeof p.rows === 'number' ? p.rows : 4}} avatar={false} />`,
};

export const spinnerDef: ComponentDef = {
  id: 'spinner',
  name: 'Spinner / Loading',
  category: 'feedback',
  description: 'Compact loading feedback for an inline value or small region where a shape-preserving Skeleton would be excessive.',
  status: 'stable',
  componentPath: 'src/ui/components/Spinner.tsx',
  importFrom: '@ui',
  props: {
    label: { type: 'text', label: 'Label', default: 'Loading workflow…' },
    size: { type: 'number', label: 'Diameter', default: 18, min: 12, max: 40, step: 2 },
    center: { type: 'boolean', label: 'Centred block', default: true },
  },
  states: ['default'],
  compare: ['default'],
  a11y: {
    role: 'role="status" with polite live announcement.',
    name: 'Visible label text names the state; an omitted label receives a screen-reader-only “Loading…” fallback.',
    keyboard: [],
    focus: 'Never focusable.',
  },
  migration: {
    replaces: ['.fa-spinner.fa-spin'],
    nextSurface: 'Checkbox / RadioGroup / Switch',
    notes: ['Workflow inline loaders now use Spinner; full workflow register states use ListSkeleton.'],
  },
  render: p => <Spinner label={s(p.label, 'Loading workflow…')} size={typeof p.size === 'number' ? p.size : 18} center={b(p.center)} />,
  code: p => `<Spinner label="${s(p.label, 'Loading workflow…')}" size={${typeof p.size === 'number' ? p.size : 18}}${b(p.center) ? ' center' : ''} />`,
};

export const toastDef: ComponentDef = {
  id: 'toast',
  name: 'Toast',
  category: 'feedback',
  description: 'The app-wide transient notification: normal, actionable and rich messages share one accessible stacking and dismissal engine.',
  status: 'stable',
  componentPath: 'src/ui/toast/Toaster.tsx',
  importFrom: '@ui',
  props: {
    tier: { type: 'segmented', label: 'Variant', options: ['normal', 'action', 'rich'], default: 'normal' },
    tone: { type: 'segmented', label: 'Tone', options: ['success', 'info', 'warning', 'error', 'loading'], default: 'success' },
    icon: { type: 'icon', label: 'Icon', default: 'CircleCheck', recommendations: ['CircleCheck', 'Info', 'TriangleAlert', 'CircleX', 'Bell', 'FileCheck2'] },
    timer: { type: 'boolean', label: 'Auto dismiss', default: true, help: 'Set a duration and pause it automatically on hover or focus.' },
    duration: { type: 'number', label: 'Duration (ms)', default: 4000, min: 1000, max: 15000, step: 500 },
    progress: { type: 'boolean', label: 'Timer progress', default: true },
    dismissible: { type: 'boolean', label: 'Dismiss button', default: true },
    chips: { type: 'boolean', label: 'Module and status', default: true },
    details: { type: 'boolean', label: 'Summary details', default: true },
    note: { type: 'boolean', label: 'Supporting note', default: true },
    file: { type: 'boolean', label: 'File preview', default: true },
    action: { type: 'boolean', label: 'Action button', default: true },
  },
  style: [
    { label: 'Surface', controls: [
      { name: '--siomac-toast-width', label: 'Width', kind: 'size' },
      { name: '--siomac-toast-radius', label: 'Corner radius', kind: 'size' },
      { name: '--siomac-toast-padding', label: 'Content padding', kind: 'text' },
      { name: '--siomac-toast-card', label: 'Background', kind: 'color' },
      { name: '--siomac-toast-border', label: 'Border', kind: 'color' },
      { name: '--siomac-toast-icon-size', label: 'Icon size', kind: 'size' },
    ] },
    { label: 'Typography', controls: [
      { name: '--siomac-toast-title-size', label: 'Title size', kind: 'size' },
      { name: '--siomac-toast-text-size', label: 'Supporting text size', kind: 'size' },
      { name: '--siomac-toast-navy', label: 'Title', kind: 'color' },
      { name: '--siomac-toast-muted', label: 'Supporting text', kind: 'color' },
    ] },
    { label: 'Tones', controls: [
      { name: '--siomac-toast-success', label: 'Success', kind: 'color' },
      { name: '--siomac-toast-info', label: 'Information', kind: 'color' },
      { name: '--siomac-toast-warning', label: 'Warning', kind: 'color' },
      { name: '--siomac-toast-red', label: 'Error', kind: 'color' },
    ] },
  ],
  states: ['default'],
  compare: ['default'],
  a11y: {
    role: 'status for routine messages; alert for errors.',
    name: 'The visible title and description are announced through the global live region.',
    keyboard: [{ keys: 'Escape', does: 'Dismisses a dismissible toast while it contains focus.' }],
    focus: 'Actions and the dismiss control are keyboard reachable; timers pause on hover and focus.',
  },
  migration: { notes: ['Application notifications already use the globally mounted canonical Toaster; Studio edits the same runtime contract rather than a parallel preview implementation.'] },
  render: p => {
    const record = toastRecord(p);
    return <div class="sds-toast-specimen">
      <div style={{ position: 'relative', width: '344px', minHeight: record.tier === 'normal' ? '122px' : '190px' }}>
        <ToastCard toast={record} standalone onDismiss={() => undefined} />
      </div>
      <Button variant="secondary" iconLeft={<LucideIcon name="BellRing" />} onClick={() => triggerToast(record)}>Trigger toast</Button>
    </div>;
  },
  code: p => {
    const tier = s(p.tier, 'normal');
    const tone = s(p.tone, 'success');
    const options = [
      `variant: '${tier === 'normal' ? tone : tone === 'loading' ? 'info' : tone}'`,
      "description: 'Your changes are now available across SIOMAC.'",
      `icon: ${s(p.icon, 'CircleCheck') === 'None' ? 'null' : `'${s(p.icon, 'CircleCheck')}'`}`,
      `duration: ${b(p.timer) && typeof p.duration === 'number' ? p.duration : 0}`,
      `progress: ${b(p.timer) && b(p.progress)}`,
      `dismissible: ${b(p.dismissible)}`,
    ];
    if (tier === 'action' || tier === 'rich') {
      if (b(p.chips)) options.push("moduleLabel: 'Employees'", "statusLabel: 'Complete'");
      if (b(p.details)) options.push("details: [{ label: 'Records', value: '18 updated' }]");
      if (b(p.action)) options.push("actions: [{ label: 'View details', onClick: openAuditLog }]");
    }
    if (tier === 'action' && b(p.note)) options.push("note: 'You can review the audit entry.'");
    if (tier === 'rich' && b(p.file)) options.push("file: { name: 'employee-import.csv', sizeLabel: '24 KB' }");
    const body = options.map(option => `  ${option},`).join('\n');
    return tier === 'normal'
      ? `toast('Changes saved', {\n${body}\n});`
      : `toast.${tier}({\n  title: 'Changes saved',\n${body}\n});`;
  },
};

export const FEEDBACK_DEFS: readonly ComponentDef[] = [emptyStateDef, skeletonDef, spinnerDef, toastDef];
