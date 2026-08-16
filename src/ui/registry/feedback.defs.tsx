/** Canonical result and cold-loading feedback states. */
import type { CSSProperties } from 'preact';
import { EmptyState, type EmptyStateSize } from '../components/EmptyState';
import { ListSkeleton, Skeleton, SkeletonText } from '../components/Skeleton';
import { Spinner } from '../components/Spinner';
import { Illustration, type IllustrationTreatment, type IllustrationVariant } from '../feedback/Illustration';
import { ToastCard } from '../toast/ToastCard';
import { toast as notify } from '../toast/toastStore';
import type { ToastRecord, ToastTier, ToastVariant } from '../toast/toastTypes';
import { LucideIcon, type LucideName } from '../LucideIcon';
import { Button } from '../primitives/Button';
import { type ComponentDef, type PropValues } from './types';
import avatarOlivia from '../../assets/avatars/untitled-ui/Olivia Rhye.jpg';
import avatarPhoenix from '../../assets/avatars/untitled-ui/Phoenix Baker.jpg';
import avatarLana from '../../assets/avatars/untitled-ui/Lana Steiner.jpg';
import avatarSarah from '../../assets/avatars/untitled-ui/Sarah Page.jpg';

const s = (value: PropValues[string] | undefined, fallback = ''): string => typeof value === 'string' ? value : fallback;
const b = (value: PropValues[string] | undefined): boolean => value === true;

export const illustrationDef: ComponentDef = {
  id: 'illustration', name: 'Illustration', category: 'feedback', status: 'stable',
  thumbnail: 'illustration',
  componentPath: 'src/ui/feedback/Illustration.tsx', importFrom: '@ui',
  description: 'Theme-adaptive SIOMAC product illustrations for profile, document, workflow, people, search and schedule empty states.',
  previewAxis: 'variant',
  previewSamples: [
    { value: 'profile', title: 'Profile', props: { variant: 'profile' } },
    { value: 'documents', title: 'Documents', props: { variant: 'documents' } },
    { value: 'workflow', title: 'Workflow', props: { variant: 'workflow' } },
    { value: 'people', title: 'People', props: { variant: 'people' } },
    { value: 'search', title: 'Search', props: { variant: 'search' } },
    { value: 'schedule', title: 'Schedule', props: { variant: 'schedule' } },
  ],
  props: {
    variant: { type: 'select', label: 'Scenario', options: ['profile', 'documents', 'workflow', 'people', 'search', 'schedule'], default: 'profile' },
    treatment: { type: 'select', label: 'Style', options: ['soft', 'minimal', 'contrast'], default: 'soft' },
  },
  style: [{ label: 'Artwork', controls: [
    { name: '--ui-illustration-accent', label: 'Accent', kind: 'color' },
    { name: '--ui-illustration-line', label: 'Object lines', kind: 'color' },
    { name: '--ui-illustration-halo', label: 'Background shapes', kind: 'color-alpha' },
    { name: '--ui-illustration-surface-top', label: 'Surface highlight', kind: 'color' },
    { name: '--ui-illustration-surface-bottom', label: 'Surface shadow', kind: 'color' },
    { name: '--ui-illustration-size', label: 'Artwork size', kind: 'size' },
  ] }],
  states: ['default'],
  a11y: { role: 'img when labelled; decorative otherwise', name: 'The optional label, when the artwork communicates information.', keyboard: [], focus: 'Never focusable.', notes: ['Leave label unset when nearby text already conveys the same state.'] },
  render: p => <Illustration variant={s(p.variant, 'profile') as IllustrationVariant} treatment={s(p.treatment, 'soft') as IllustrationTreatment} />,
  code: p => `<Illustration variant="${s(p.variant, 'profile')}" treatment="${s(p.treatment, 'soft')}" />`,
};

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
  thumbnail: 'empty-state',
  name: 'EmptyState',
  previewAxis: 'visual',
  previewLayout: 'diagram',
  previewSamples: [
    { value: 'Illustration', title: 'Illustration', props: { visual: 'Illustration' }, diagram: 'empty-state-visual' },
    { value: 'Featured icon', title: 'Featured icon', props: { visual: 'Featured icon' }, diagram: 'empty-state-visual' },
    { value: 'Avatar radius', title: 'Avatar radius', props: { visual: 'Avatar radius' }, diagram: 'empty-state-visual' },
    { value: 'Avatar row', title: 'Avatar row', props: { visual: 'Avatar row' }, diagram: 'empty-state-visual' },
    { value: 'File type', title: 'File type', props: { visual: 'File type' }, diagram: 'empty-state-visual' },
  ],
  category: 'feedback',
  description: 'Actionable no-results guidance with a selectable visual header, one semantic title, concise explanation and optional canonical actions.',
  status: 'stable',
  componentPath: 'src/ui/components/EmptyState.tsx',
  importFrom: '@ui',
  props: {
    visual: { type: 'select', label: 'Visual', options: ['Illustration', 'Featured icon', 'Avatar radius', 'Avatar row', 'File type'], default: 'Illustration' },
    title: { type: 'text', label: 'Title', default: 'No records found' },
    text: { type: 'text', label: 'Guidance', default: 'Adjust your filters or create the first record to continue.' },
    pattern: { type: 'boolean', label: 'Background guide', default: true, help: 'Adds a quiet theme-aware guide behind the visual.' },
    featuredIcon: { type: 'icon', label: 'Icon', default: 'Search', recommendations: ['Search', 'Inbox', 'FolderOpen', 'FilterX'], allowNone: false, visibleWhen: { prop: 'visual', equals: 'Featured icon' } },
    illustrationVariant: { type: 'select', label: 'Illustration', options: ['profile', 'documents', 'workflow', 'people', 'search', 'schedule'], default: 'search', visibleWhen: { prop: 'visual', equals: 'Illustration' } },
    avatarCount: { type: 'segmented', label: 'People shown', options: ['3', '4'], default: '4', visibleWhen: { prop: 'visual', in: ['Avatar radius', 'Avatar row'] } },
    addAvatar: { type: 'boolean', label: 'Add people action', default: true, visibleWhen: { prop: 'visual', equals: 'Avatar row' } },
    fileIcon: { type: 'icon', label: 'File icon', default: 'FileText', recommendations: ['FileText', 'FileSpreadsheet', 'Image', 'Archive'], allowNone: false, visibleWhen: { prop: 'visual', equals: 'File type' } },
    fileColorMode: { type: 'segmented', label: 'File colors', options: ['Theme', 'Custom'], default: 'Theme', visibleWhen: { prop: 'visual', equals: 'File type' } },
    fileThemeTone: { type: 'select', label: 'Theme color', options: ['Brand', 'Neutral', 'Success', 'Warning', 'Danger'], default: 'Brand', visibleWhen: { all: [{ prop: 'visual', equals: 'File type' }, { prop: 'fileColorMode', equals: 'Theme' }] } },
    fileBackground: { type: 'color', label: 'Circle color', default: '#e8f1ff', visibleWhen: { all: [{ prop: 'visual', equals: 'File type' }, { prop: 'fileColorMode', equals: 'Custom' }] } },
    fileIconColor: { type: 'color', label: 'Icon color', default: '#0b55d8', visibleWhen: { all: [{ prop: 'visual', equals: 'File type' }, { prop: 'fileColorMode', equals: 'Custom' }] } },
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
  render: p => {
    const visual = s(p.visual, 'Illustration');
    const avatars = [avatarOlivia, avatarPhoenix, avatarLana, avatarSarah].slice(0, Number(s(p.avatarCount, '4')));
    const customFileColors = s(p.fileColorMode, 'Theme') === 'Custom';
    const fileStyle = customFileColors ? {
      '--ui-empty-file-bg': s(p.fileBackground, '#e8f1ff'),
      '--ui-empty-file-fg': s(p.fileIconColor, '#0b55d8'),
    } as CSSProperties : undefined;
    return <EmptyState
      icon={visual === 'Featured icon' ? <LucideIcon name={s(p.featuredIcon, 'Search') as LucideName} /> : undefined}
      visual={visual === 'Illustration' ? <Illustration variant={s(p.illustrationVariant, 'search') as IllustrationVariant} treatment="soft" />
        : visual === 'Avatar radius' ? <div class={`ui-empty-avatar-radius count-${avatars.length}`}>{avatars.map((src, index) => <img src={src} alt="" key={index} />)}</div>
        : visual === 'Avatar row' ? <div class="ui-empty-avatar-row">{avatars.slice(0, 2).map((src, index) => <img src={src} alt="" key={`before-${index}`} />)}{b(p.addAvatar) && <span><LucideIcon name="UserPlus" /></span>}{avatars.slice(2).map((src, index) => <img src={src} alt="" key={`after-${index}`} />)}</div>
        : visual === 'File type' ? <span class={`ui-empty-file-visual tone-${s(p.fileThemeTone, 'Brand').toLowerCase()}`} style={fileStyle}><LucideIcon name={s(p.fileIcon, 'FileText') as LucideName} /></span>
        : undefined}
      pattern={b(p.pattern)}
      title={s(p.title, 'No records found')}
      text={s(p.text, 'Adjust your filters or create the first record to continue.')}
      size={s(p.size, 'default') as EmptyStateSize}
      actions={b(p.action) ? <><Button variant="outline">Clear filters</Button><Button variant="primary">Create record</Button></> : undefined}
    />;
  },
  code: p => {
    const visual = s(p.visual, 'Illustration');
    const visualProp = visual === 'Illustration'
      ? `  visual={<Illustration variant="${s(p.illustrationVariant, 'search')}" />}`
      : visual === 'Featured icon'
      ? `  icon={<${s(p.featuredIcon, 'Search')} />}`
      : visual === 'Avatar radius'
        ? `  visual={<EmptyStateAvatarRadius users={users.slice(0, ${s(p.avatarCount, '4')})} />}`
        : visual === 'Avatar row'
          ? `  visual={<EmptyStateAvatarRow users={users.slice(0, ${s(p.avatarCount, '4')})}${b(p.addAvatar) ? ' showAdd' : ''} />}`
          : `  visual={<span className="ui-empty-file-visual tone-${s(p.fileThemeTone, 'Brand').toLowerCase()}"${s(p.fileColorMode, 'Theme') === 'Custom' ? ` style={{ '--ui-empty-file-bg': '${s(p.fileBackground, '#e8f1ff')}', '--ui-empty-file-fg': '${s(p.fileIconColor, '#0b55d8')}' }}` : ''}><${s(p.fileIcon, 'FileText')} /></span>}`;
    return `<EmptyState
${visualProp}
${b(p.pattern) ? '  pattern\n' : ''}
  title="${s(p.title, 'No records found')}"
  text="${s(p.text, 'Adjust your filters or create the first record to continue.')}"${s(p.size, 'default') !== 'default' ? `\n  size="${s(p.size)}"` : ''}${b(p.action) ? '\n  actions={<><Button variant="outline">Clear filters</Button><Button>Create record</Button></>}' : ''}
/>`;
  },
};

export const skeletonDef: ComponentDef = {
  id: 'skeleton',
  thumbnail: 'skeleton',
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
  thumbnail: 'spinner',
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
  thumbnail: 'toast',
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
    duration: { type: 'number', label: 'Duration (ms)', default: 4000, min: 1000, max: 15000, step: 500, visibleWhen: { prop: 'timer', equals: true } },
    progress: { type: 'boolean', label: 'Timer progress', default: true, visibleWhen: { prop: 'timer', equals: true } },
    dismissible: { type: 'boolean', label: 'Dismiss button', default: true },
    chips: { type: 'boolean', label: 'Module and status', default: true, visibleWhen: { prop: 'tier', in: ['action', 'rich'] } },
    details: { type: 'boolean', label: 'Summary details', default: true, visibleWhen: { prop: 'tier', in: ['action', 'rich'] } },
    note: { type: 'boolean', label: 'Supporting note', default: true, visibleWhen: { prop: 'tier', equals: 'action' } },
    file: { type: 'boolean', label: 'File preview', default: true, visibleWhen: { prop: 'tier', equals: 'rich' } },
    action: { type: 'boolean', label: 'Action button', default: true, visibleWhen: { prop: 'tier', in: ['action', 'rich'] } },
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

export const FEEDBACK_DEFS: readonly ComponentDef[] = [emptyStateDef, illustrationDef, skeletonDef, spinnerDef, toastDef];
