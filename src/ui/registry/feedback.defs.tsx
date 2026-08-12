/** Canonical result and cold-loading feedback states. */
import { EmptyState, type EmptyStateSize, type EmptyTone } from '../components/EmptyState';
import { ListSkeleton, Skeleton, SkeletonText } from '../components/Skeleton';
import { Spinner } from '../components/Spinner';
import { LucideIcon } from '../LucideIcon';
import { Button } from '../primitives/Button';
import { type ComponentDef, type PropValues } from './types';

const s = (value: PropValues[string] | undefined, fallback = ''): string => typeof value === 'string' ? value : fallback;
const b = (value: PropValues[string] | undefined): boolean => value === true;

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

export const FEEDBACK_DEFS: readonly ComponentDef[] = [emptyStateDef, skeletonDef, spinnerDef];
