/** Canonical result and cold-loading feedback states. */
import type { CSSProperties } from 'preact';
import { EmptyState, type EmptyStateSize } from '../components/EmptyState';
import { ListSkeleton, Skeleton, SkeletonText, WorkspaceSkeleton } from '../components/Skeleton';
import { Spinner } from '../components/Spinner';
import { ActivityDots, type ActivityDotsSize } from '../components/ActivityDots';
import { Illustration, type IllustrationTreatment, type IllustrationVariant } from '../feedback/Illustration';
import { IconTile, type IconTileShape, type IconTileSize, type IconTileTone } from '../feedback/IconTile';
import { NotificationIcon, type NotificationIconVariant } from '../feedback/NotificationIcon';
import { NotificationListItem, type NotificationIndicatorTone } from '../feedback/NotificationListItem';
import { NotificationPopover } from '../feedback/NotificationPopover';
import { ToastCard } from '../toast/ToastCard';
import { toast as notify } from '../toast/toastStore';
import type { ToastRecord, ToastTier, ToastVariant } from '../toast/toastTypes';
import { LucideIcon, type LucideName } from '../LucideIcon';
import { Button } from '../primitives/Button';
import { Badge } from '../primitives/Badge';
import { Avatar } from '../people/Avatar';
import { Tabs } from '../navigation/Tabs';
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
  const iconMode = s(p.iconMode, 'Automatic');
  const icon = s(p.icon, 'CircleCheck');
  const timer = b(p.timer);
  const duration = timer && typeof p.duration === 'number' ? p.duration : 0;
  const title = tone === 'loading'
    ? 'Updating records'
    : tier === 'action'
      ? 'Link has expired'
      : tier === 'rich'
        ? 'Report generated'
        : 'Changes saved';
  const description = tier === 'action'
    ? 'One of the links provided in Campaign 01 has expired.'
    : 'Your changes are now available across SIOMAC.';
  return {
    id: 'studio-toast', tier, variant: tone,
    title,
    description,
    duration, dismissible: b(p.dismissible), ariaLive: tone === 'error' ? 'assertive' : 'polite', createdAt: 0,
    icon: iconMode === 'Custom' ? icon as LucideName : undefined,
    progress: b(p.progress),
    expandable: b(p.expandable),
    defaultExpanded: b(p.expandable) && b(p.defaultExpanded),
    moduleLabel: tier !== 'normal' && b(p.chips) ? 'Employees' : undefined,
    statusLabel: tier !== 'normal' && b(p.chips) ? 'Complete' : undefined,
    details: tier !== 'normal' && b(p.details) ? [{ label: 'Records', value: '18 updated' }] : undefined,
    note: tier === 'action' && b(p.note) ? 'You can review the audit entry.' : undefined,
    file: tier === 'rich' && b(p.file) ? { name: 'employee-import.csv', sizeLabel: '24 KB', subtitle: 'Import complete' } : undefined,
    actions: tier !== 'normal' && b(p.action) ? [{ label: tier === 'action' ? 'Go to Campaign' : 'View details', dismissOnClick: true }] : undefined,
  };
}

function triggerToast(record: ToastRecord): void {
  const actionVariant = record.variant === 'loading' ? 'info' : record.variant;
  const common = {
    title: record.title, description: record.description, variant: actionVariant,
    duration: record.duration, dismissible: record.dismissible, icon: record.icon, progress: record.progress,
    expandable: record.expandable, defaultExpanded: record.defaultExpanded,
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
  description: 'Element-aware cold-path geometry, from atomic placeholders to a complete command bar, grouped data grid, inspector and footer workspace.',
  status: 'stable',
  componentPath: 'src/ui/components/Skeleton.tsx',
  importFrom: '@ui',
  props: {
    shape: { type: 'segmented', label: 'Shape', options: ['workspace', 'list', 'text', 'block'], default: 'workspace' },
    rows: { type: 'number', label: 'Rows', default: 4, min: 1, max: 8, step: 1 },
  },
  states: ['default'],
  compare: ['default'],
  a11y: {
    role: null,
    name: 'Skeleton geometry is aria-hidden. The owning region supplies aria-busy and a loading name.',
    keyboard: [],
    focus: 'Never focusable.',
    notes: ['Use only when no real data exists. Cached data remains visible during refetch.', 'Use WorkspaceSkeleton for dense operational pages instead of rebuilding page-local shimmer geometry.'],
  },
  migration: {
    replaces: ['.vt-skeleton', '.mps-skel'],
    nextSurface: 'Checkbox / RadioGroup / Switch',
    notes: ['The HSE Workflows local Skeleton is deleted; every workflow cold state uses canonical ListSkeleton.', 'Dense planner-style pages use the canonical WorkspaceSkeleton so the loading state preserves all major page regions.'],
  },
  render: p => {
    const rows = typeof p.rows === 'number' ? p.rows : 4;
    if (p.shape === 'workspace') return <WorkspaceSkeleton columns={5} groups={2} rowsPerGroup={1} filters={3} />;
    if (p.shape === 'block') return <Skeleton height={80} radius={12} />;
    if (p.shape === 'text') return <SkeletonText lines={rows} />;
    return <ListSkeleton rows={rows} avatar={false} />;
  },
  code: p => p.shape === 'workspace'
    ? '<WorkspaceSkeleton columns={5} groups={2} rowsPerGroup={1} filters={3} />'
    : p.shape === 'block'
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

export const activityDotsDef: ComponentDef = {
  id: 'activity-dots',
  thumbnail: 'spinner',
  name: 'Activity Dots',
  category: 'feedback',
  description: 'Four-dot indeterminate activity feedback for searches and compact asynchronous regions that should not use shape-preserving skeletons.',
  status: 'stable',
  componentPath: 'src/ui/components/ActivityDots.tsx',
  importFrom: '@ui',
  props: {
    label: { type: 'text', label: 'Accessible label', default: 'Searching SIOMAC…' },
    size: { type: 'segmented', label: 'Size', options: ['sm', 'md', 'lg'], default: 'md' },
  },
  states: ['default'],
  compare: ['default'],
  a11y: {
    role: 'role="status" with a polite live announcement.',
    name: 'The label names the state while the moving dots remain decorative.',
    keyboard: [],
    focus: 'Never focusable.',
    notes: ['Motion stops under prefers-reduced-motion.', 'Use for indeterminate compact work; keep existing data visible during a refresh.'],
  },
  render: p => <ActivityDots label={s(p.label, 'Searching SIOMAC…')} size={s(p.size, 'md') as ActivityDotsSize} />,
  code: p => `<ActivityDots label="${s(p.label, 'Searching SIOMAC…')}" size="${s(p.size, 'md')}" />`,
};

export const iconTileDef: ComponentDef = {
  id: 'icon-tile', name: 'Icon Tile', category: 'feedback', status: 'stable',
  thumbnail: 'badge',
  componentPath: 'src/ui/feedback/IconTile.tsx', importFrom: '@ui',
  description: 'A compact, borderless icon surface shared by notifications, activity feeds, group headers and summary rows.',
  previewAxis: 'tone',
  previewSamples: [
    { value: 'neutral', title: 'Neutral', props: { tone: 'neutral', icon: 'Bell' } },
    { value: 'navy', title: 'Navy', props: { tone: 'navy', icon: 'Bell' } },
    { value: 'group', title: 'Group', props: { tone: 'group', icon: 'FolderTree' } },
    { value: 'blue', title: 'Blue', props: { tone: 'blue', icon: 'FileText' } },
    { value: 'indigo', title: 'Indigo', props: { tone: 'indigo', icon: 'BadgeCheck' } },
    { value: 'cyan', title: 'Cyan', props: { tone: 'cyan', icon: 'Clock3' } },
    { value: 'teal', title: 'Teal', props: { tone: 'teal', icon: 'Workflow' } },
    { value: 'violet', title: 'Violet', props: { tone: 'violet', icon: 'Megaphone' } },
    { value: 'rose', title: 'Rose', props: { tone: 'rose', icon: 'Workflow' } },
    { value: 'amber', title: 'Amber', props: { tone: 'amber', icon: 'TriangleAlert' } },
    { value: 'orange', title: 'Orange', props: { tone: 'orange', icon: 'WalletCards' } },
    { value: 'danger', title: 'Danger', props: { tone: 'danger', icon: 'CircleAlert' } },
    { value: 'success', title: 'Success', props: { tone: 'success', icon: 'CircleCheck' } },
  ],
  props: {
    icon: { type: 'icon', label: 'Icon', default: 'Bell', recommendations: ['Bell', 'Workflow', 'FileText', 'Megaphone', 'WalletCards', 'Users'] },
    tone: { type: 'select', label: 'Tone', options: ['neutral', 'navy', 'group', 'blue', 'indigo', 'cyan', 'teal', 'violet', 'rose', 'amber', 'orange', 'danger', 'success'], default: 'navy' },
    size: { type: 'segmented', label: 'Size', options: ['sm', 'md', 'lg'], default: 'md' },
    shape: { type: 'segmented', label: 'Shape', options: ['rounded', 'circle'], default: 'rounded' },
  },
  style: [{ label: 'Tile', controls: [
    { name: '--ui-icon-tile-size-md', label: 'Size', kind: 'size' },
    { name: '--ui-icon-tile-radius', label: 'Corner radius', kind: 'size' },
    { name: '--ui-icon-tile-bg', label: 'Neutral background', kind: 'color' },
    { name: '--ui-icon-tile-fg', label: 'Neutral icon', kind: 'color' },
    { name: '--ui-icon-tile-group-bg', label: 'Group background', kind: 'color' },
    { name: '--ui-icon-tile-group-fg', label: 'Group icon', kind: 'color' },
  ] }],
  states: ['default'], compare: ['default'],
  a11y: { role: 'Decorative by default; role="img" when labelled.', name: 'Optional label.', keyboard: [], focus: 'Never focusable.', notes: ['Use semantic text beside the tile; label it only when the icon communicates information not present in that text.'] },
  render: p => <IconTile
    icon={s(p.icon, 'Bell') as LucideName}
    tone={s(p.tone, 'navy') as IconTileTone}
    size={s(p.size, 'md') as IconTileSize}
    shape={s(p.shape, 'rounded') as IconTileShape}
  />,
  code: p => `<IconTile icon="${s(p.icon, 'Bell')}" tone="${s(p.tone, 'navy')}" size="${s(p.size, 'md')}" />`,
};

export const notificationIconDef: ComponentDef = {
  id: 'notification-icon', name: 'Notification Icon', category: 'feedback', status: 'stable',
  thumbnail: 'badge',
  componentPath: 'src/ui/feedback/NotificationIcon.tsx', importFrom: '@ui',
  description: 'The governed icon and soft-background pairing for each notification meaning. Use the semantic variant instead of selecting an icon and color independently.',
  previewAxis: 'variant',
  previewSamples: [
    { value: 'general', title: 'General', props: { variant: 'general' } },
    { value: 'critical', title: 'Critical', props: { variant: 'critical' } },
    { value: 'warning', title: 'Warning', props: { variant: 'warning' } },
    { value: 'success', title: 'Success', props: { variant: 'success' } },
    { value: 'approval', title: 'Approval', props: { variant: 'approval' } },
    { value: 'assignment', title: 'Assignment', props: { variant: 'assignment' } },
    { value: 'reminder', title: 'Reminder', props: { variant: 'reminder' } },
    { value: 'announcement', title: 'Announcement', props: { variant: 'announcement' } },
    { value: 'document', title: 'Document', props: { variant: 'document' } },
    { value: 'message', title: 'Message', props: { variant: 'message' } },
    { value: 'finance', title: 'Finance', props: { variant: 'finance' } },
    { value: 'workflow', title: 'Workflow', props: { variant: 'workflow' } },
  ],
  props: {
    variant: { type: 'select', label: 'Meaning', options: ['general', 'critical', 'warning', 'success', 'approval', 'assignment', 'reminder', 'announcement', 'document', 'message', 'finance', 'workflow'], default: 'general' },
    size: { type: 'segmented', label: 'Size', options: ['sm', 'md', 'lg'], default: 'md' },
  },
  states: ['default'], compare: ['default'],
  a11y: { role: 'Decorative by default; role="img" when labelled.', name: 'Optional label.', keyboard: [], focus: 'Never focusable.', notes: ['Notification meaning must also be present in text; color and icon are supporting cues.'] },
  render: p => <NotificationIcon variant={s(p.variant, 'general') as NotificationIconVariant} size={s(p.size, 'md') as IconTileSize} />,
  code: p => `<NotificationIcon variant="${s(p.variant, 'general')}" size="${s(p.size, 'md')}" />`,
};

export const notificationListItemDef: ComponentDef = {
  id: 'notification-list-item', name: 'Notification List Item', category: 'feedback', status: 'stable',
  thumbnail: 'toast',
  componentPath: 'src/ui/feedback/NotificationListItem.tsx', importFrom: '@ui',
  description: 'A scan-friendly notification row with a module icon or avatar, concise metadata, timestamp, unread state and optional action.',
  props: {
    visual: { type: 'segmented', label: 'Visual', options: ['Icon', 'Avatar'], default: 'Icon' },
    iconVariant: { type: 'select', label: 'Icon meaning', options: ['general', 'critical', 'warning', 'success', 'approval', 'assignment', 'reminder', 'announcement', 'document', 'message', 'finance', 'workflow'], default: 'workflow', visibleWhen: { prop: 'visual', equals: 'Icon' } },
    indicatorTone: { type: 'select', label: 'Unread tone', options: ['neutral', 'info', 'success', 'warning', 'danger'], default: 'success' },
    unread: { type: 'boolean', label: 'Unread', default: true },
    status: { type: 'boolean', label: 'Status badge', default: false },
    action: { type: 'boolean', label: 'Action', default: false },
  },
  states: ['default', 'hover'], compare: ['default', 'hover'],
  a11y: { role: 'Article containing one primary button and an optional separate action.', name: 'The title and description name the primary action.', keyboard: [{ keys: 'Tab / Enter', does: 'Opens the notification, then reaches its optional action.' }], focus: 'The full primary row has a visible inset focus outline.', notes: ['Do not nest the action button inside the row button.'] },
  render: p => <div style={{ width: '438px', maxWidth: '100%' }}><NotificationListItem
    title="Workflow approved"
    description="RRQ-2026-0004 was approved and is ready for the next step."
    metadata={['Workflow', 'WF-2026-3405']}
    timestamp="14m ago"
    iconVariant={s(p.iconVariant, 'workflow') as NotificationIconVariant}
    visual={s(p.visual, 'Icon') === 'Avatar' ? <Avatar name="Olivia Rhye" src={avatarOlivia} size={36} decorative /> : undefined}
    status={b(p.status) ? <Badge tone="warning" size="sm">Action Required</Badge> : undefined}
    action={b(p.action) ? <Button variant="secondary" size="sm">Review</Button> : undefined}
    unread={b(p.unread)}
    indicatorTone={s(p.indicatorTone, 'success') as NotificationIndicatorTone}
    onOpen={() => undefined}
  /></div>,
  code: p => `<NotificationListItem
  title="Workflow approved"
  description="RRQ-2026-0004 was approved and is ready for the next step."
  metadata={['Workflow', 'WF-2026-3405']}
  timestamp="14m ago"
  iconVariant="${s(p.iconVariant, 'workflow')}"${b(p.unread) ? '\n  unread' : ''}
  onOpen={openNotification}
/>`,
};

export const notificationPopoverDef: ComponentDef = {
  id: 'notification-popover', name: 'Notification Popover', category: 'feedback', status: 'stable',
  thumbnail: 'popover',
  componentPath: 'src/ui/feedback/NotificationPopover.tsx', importFrom: '@ui',
  description: 'The canonical compact notification surface with a header, segmented views, scrolling results and a fixed action footer.',
  props: {
    view: { type: 'segmented', label: 'View', options: ['all', 'unread', 'action'], default: 'all' },
    rows: { type: 'number', label: 'Rows', default: 3, min: 1, max: 5, step: 1 },
  },
  style: [
    { label: 'Surface', controls: [
      { name: '--ui-notification-popover-width', label: 'Width', kind: 'size' },
      { name: '--ui-notification-popover-radius', label: 'Corner radius', kind: 'size' },
      { name: '--ui-notification-popover-bg', label: 'Background', kind: 'color' },
      { name: '--ui-notification-popover-border', label: 'Border', kind: 'color-alpha' },
    ] },
    { label: 'Rows', controls: [
      { name: '--ui-notification-row-hover', label: 'Hover background', kind: 'color' },
      { name: '--ui-notification-row-divider', label: 'Divider', kind: 'color-alpha' },
    ] },
  ],
  states: ['default'], compare: ['default'],
  a11y: { role: 'Named dialog with an accessible tablist.', name: 'Notifications by default; configurable for product-specific inboxes.', keyboard: [{ keys: 'Tab', does: 'Moves through header actions, views, notifications and footer action.' }, { keys: 'Arrow Left / Right', does: 'Moves between notification views.' }], focus: 'Every action uses canonical focus treatment.', notes: ['The application owns data fetching, mutations, permissions and deep-link routing.'] },
  render: p => {
    const view = s(p.view, 'all');
    const rows = Math.max(1, Math.min(5, typeof p.rows === 'number' ? p.rows : 3));
    const samples = [
      { title: 'Workflow approved', description: 'The roster review has been approved.', meta: ['Workflow', 'WF-2026-3405'], icon: 'Workflow', tone: 'teal' },
      { title: 'Document needs verification', description: 'Bank Account Confirmation is awaiting review.', meta: ['Documents', 'ONB-2026-0747'], icon: 'FileText', tone: 'blue' },
      { title: 'Payroll exception', description: 'A timesheet is missing from the current payroll run.', meta: ['Payroll', 'PAY-2026-503'], icon: 'WalletCards', tone: 'violet' },
      { title: 'Permit expires soon', description: 'Review the permit before the next shift begins.', meta: ['Permit to Work', 'PTW-2026-118'], icon: 'FileCheck2', tone: 'amber' },
      { title: 'Incident escalated', description: 'A high-priority incident has been assigned for review.', meta: ['Incidents', 'INC-2026-092'], icon: 'TriangleAlert', tone: 'danger' },
    ] as const;
    return <NotificationPopover
      resetScrollKey={view}
      headerActions={<><Button iconOnly variant="ghost" size="sm" aria-label="Mark All Read" iconLeft={<LucideIcon name="CheckCheck" />} /><Button iconOnly variant="ghost" size="sm" aria-label="Notification Settings" iconLeft={<LucideIcon name="Settings2" />} /></>}
      navigation={<Tabs id="studio-notification-tabs" label="Notification Views" variant="contained" size="sm" value={view} onChange={() => undefined} items={[{ id: 'all', label: 'View All' }, { id: 'unread', label: 'Unread', badge: 4 }, { id: 'action', label: 'Needs Action', badge: 2 }]} />}
      footer={<><span style={{ color: '#788397', fontSize: '11px' }}>4 unread · 2 need action</span><Button size="sm" iconRight={<LucideIcon name="ArrowRight" />}>View All Notifications</Button></>}
    >
      {samples.slice(0, rows).map((item, index) => <NotificationListItem
        key={item.title}
        title={item.title}
        description={item.description}
        metadata={item.meta}
        timestamp={index === 0 ? '14m ago' : `${index + 1}h ago`}
        icon={item.icon}
        iconTone={item.tone}
        unread={index < 2}
        indicatorTone={index === 0 ? 'success' : 'info'}
        onOpen={() => undefined}
      />)}
    </NotificationPopover>;
  },
  code: () => `<NotificationPopover
  headerActions={headerActions}
  navigation={<Tabs items={views} value={view} onChange={setView} />}
  footer={footerActions}
  resetScrollKey={view}
>
  {notifications.map(notification => (
    <NotificationListItem key={notification.id} {...toNotificationItem(notification)} />
  ))}
</NotificationPopover>`,
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
    iconMode: { type: 'segmented', label: 'Icon', options: ['Automatic', 'Custom'], default: 'Automatic', help: 'Automatic uses the semantic icon for the selected tone.' },
    icon: { type: 'icon', label: 'Custom icon', default: 'CircleCheck', recommendations: ['CircleCheck', 'Info', 'TriangleAlert', 'CircleX', 'Bell', 'FileCheck2'], visibleWhen: { prop: 'iconMode', equals: 'Custom' } },
    timer: { type: 'boolean', label: 'Auto dismiss', default: true, help: 'Set a duration; the timer can be stopped permanently from the toast footer.' },
    duration: { type: 'number', label: 'Duration (ms)', default: 6000, min: 1000, max: 15000, step: 500, visibleWhen: { prop: 'timer', equals: true } },
    progress: { type: 'boolean', label: 'Timer progress', default: true, visibleWhen: { prop: 'timer', equals: true } },
    dismissible: { type: 'boolean', label: 'Dismiss button', default: true },
    expandable: { type: 'boolean', label: 'Expandable details', default: true, help: 'Keeps the status header stable while supporting content opens beneath it.' },
    defaultExpanded: { type: 'boolean', label: 'Start expanded', default: false, visibleWhen: { prop: 'expandable', equals: true } },
    chips: { type: 'boolean', label: 'Module and status', default: false, visibleWhen: { prop: 'tier', in: ['action', 'rich'] } },
    details: { type: 'boolean', label: 'Summary details', default: false, visibleWhen: { prop: 'tier', in: ['action', 'rich'] } },
    note: { type: 'boolean', label: 'Supporting note', default: false, visibleWhen: { prop: 'tier', equals: 'action' } },
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
  states: ['default', 'open'],
  compare: ['default', 'open'],
  a11y: {
    role: 'status for routine messages; alert for errors.',
    name: 'The visible title and description are announced through the global live region.',
    keyboard: [
      { keys: 'Enter / Space', does: 'Expands or collapses details from the disclosure control.' },
      { keys: 'Escape', does: 'Dismisses a dismissible toast while it contains focus.' },
    ],
    focus: 'Expand, action, stop-timer and dismiss controls are keyboard reachable; the explicit stop control preserves a timed toast.',
  },
  migration: { notes: ['Application notifications already use the globally mounted canonical Toaster; Studio edits the same runtime contract rather than a parallel preview implementation.'] },
  render: (p, state) => {
    const record = toastRecord(p);
    if (state === 'open' && record.expandable) record.defaultExpanded = true;
    return <div class="sds-toast-specimen">
      <div style={{ position: 'relative', width: '344px', minHeight: record.tier === 'normal' ? '122px' : '190px' }}>
        <ToastCard toast={record} standalone onDismiss={() => undefined} />
      </div>
      <Button variant="secondary" iconLeft={<LucideIcon name="BellRing" />} onClick={() => triggerToast(record)}>Trigger toast</Button>
    </div>;
  },
  code: (p, state) => {
    const tier = s(p.tier, 'normal');
    const tone = s(p.tone, 'success');
    const options = [
      `variant: '${tier === 'normal' ? tone : tone === 'loading' ? 'info' : tone}'`,
      "description: 'Your changes are now available across SIOMAC.'",
      ...(s(p.iconMode, 'Automatic') === 'Custom' ? [`icon: '${s(p.icon, 'CircleCheck')}'`] : []),
      `duration: ${b(p.timer) && typeof p.duration === 'number' ? p.duration : 0}`,
      `progress: ${b(p.timer) && b(p.progress)}`,
      `dismissible: ${b(p.dismissible)}`,
      `expandable: ${b(p.expandable)}`,
      `defaultExpanded: ${b(p.expandable) && (b(p.defaultExpanded) || state === 'open')}`,
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

export const FEEDBACK_DEFS: readonly ComponentDef[] = [
  emptyStateDef,
  illustrationDef,
  skeletonDef,
  spinnerDef,
  activityDotsDef,
  iconTileDef,
  notificationIconDef,
  notificationListItemDef,
  notificationPopoverDef,
  toastDef,
];
