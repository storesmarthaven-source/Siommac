/**
 * src/ui/registry/data.defs.tsx — Data, and the Badge system.
 *
 * ONE DataTable card. Search, filters, sorting, pagination, rows-per-page,
 * selection, bulk actions, the column chooser and row actions are capabilities
 * demonstrated by its presets — not sibling cards. The parts exist as
 * implementation files (`DataTableToolbar.tsx`, `useDataTable.ts`), which is a
 * code-organisation choice and deliberately not a public one.
 */

import { LucideIcon } from '../LucideIcon';
import { Badge } from '../primitives/Badge';
import { Button } from '../primitives/Button';
import { PersonCell } from '../table/PersonCell';
import { DataTable, type DataTableColumn } from '../data/DataTable';
import { type ComponentDef, type PropValues } from './types';
import { type DataTableDensity } from '../data/DataTable';

const s = (v: PropValues[string] | undefined, f = ''): string => (typeof v === 'string' ? v : f);
const b = (v: PropValues[string] | undefined): boolean => v === true;
const noop = (): void => { /* preview */ };

/* ── Demo data. Realistic, because "Option 1 / Option 2" hides every layout
      problem that real names and job titles cause. ─────────────────────────*/

interface DemoEmployee {
  id: string;
  name: string;
  employeeNo: string;
  photoUrl: string | null;
  role: string;
  department: string;
  status: 'active' | 'probation' | 'leave' | 'inactive';
  startDate: string;
}

const EMPLOYEES: DemoEmployee[] = [
  { id: 'p1', name: 'Sarah James',      employeeNo: 'EMP-00484', photoUrl: null, role: 'Safety Officer',      department: 'HSE',         status: 'active',    startDate: '2021-03-08' },
  { id: 'p2', name: 'Amara Diallo',     employeeNo: 'EMP-00010', photoUrl: null, role: 'Field Engineer',      department: 'Operations',  status: 'leave',     startDate: '2019-11-18' },
  { id: 'p3', name: 'Priya Ramkissoon', employeeNo: 'EMP-00034', photoUrl: null, role: 'HR Officer',          department: 'People',      status: 'active',    startDate: '2022-07-04' },
  { id: 'p4', name: 'Jordan Alexander', employeeNo: 'EMP-00021', photoUrl: null, role: 'Shift Supervisor',    department: 'Operations',  status: 'probation', startDate: '2026-06-01' },
  { id: 'p5', name: 'Kwame Boateng',    employeeNo: 'EMP-00097', photoUrl: null, role: 'Maintenance Planner', department: 'Engineering', status: 'inactive',  startDate: '2018-02-26' },
];

const STATUS_TONE = {
  active:    { tone: 'success' as const, label: 'Active' },
  probation: { tone: 'warning' as const, label: 'Probation' },
  leave:     { tone: 'info'    as const, label: 'On leave' },
  inactive:  { tone: 'neutral' as const, label: 'Inactive' },
};

/**
 * Columns show the composition rule: DataTable knows nothing about employees.
 * A person column returns `<PersonCell>`; a status column returns `<Badge>`.
 */
const COLUMNS: DataTableColumn<DemoEmployee>[] = [
  {
    id: 'employee',
    header: 'Employee',
    alwaysVisible: true,
    minWidth: 220,
    sortable: true,
    sortValue: r => r.name,
    cell: r => <PersonCell name={r.name} image={r.photoUrl} sub={r.role} meta={`· ${r.employeeNo}`} size={28} />,
  },
  { id: 'department', header: 'Department', sortable: true, sortValue: r => r.department, cell: r => r.department },
  {
    id: 'status',
    header: 'Status',
    width: 130,
    sortable: true,
    sortValue: r => r.status,
    cell: r => <Badge tone={STATUS_TONE[r.status].tone} dot>{STATUS_TONE[r.status].label}</Badge>,
  },
  { id: 'startDate', header: 'Start date', width: 120, align: 'right', sortable: true, sortValue: r => r.startDate, cell: r => r.startDate },
  { id: 'role', header: 'Role', hidden: true, cell: r => r.role },
];

const ROW_ACTIONS = (row: DemoEmployee): { id: string; label: string; icon: preact.JSX.Element; tone?: 'danger'; disabled?: boolean; onSelect: () => void }[] => [
  { id: 'view',  label: 'View employee', icon: <LucideIcon name="Eye" />,   onSelect: noop },
  { id: 'edit',  label: 'Edit details',  icon: <LucideIcon name="Pencil" />, onSelect: noop },
  { id: 'off',   label: 'Deactivate',    icon: <LucideIcon name="UserMinus" />, tone: 'danger', disabled: row.status === 'inactive', onSelect: noop },
];

/* ── DataTable ─────────────────────────────────────────────────────────────*/

export const dataTableDef: ComponentDef = {
  id: 'data-table',
  name: 'DataTable',
  category: 'data',
  description: 'ONE table engine. Search, filters, sorting, pagination, rows-per-page, selection, bulk actions, the column chooser and row actions are optional capabilities of this component — not separate components.',
  status: 'stable',
  componentPath: 'src/ui/data/DataTable/DataTable.tsx',
  importFrom: '@ui',
  migration: {
    replaces: ['.ui-dt-legacy'],
    deprecatedImports: ['@shared/DataTable', 'HrfinTable', 'RegisterTable', 'LegacyDataTable'],
    rawPatterns: ['<table'],
    nextSurface: 'Tabs',
    notes: [
      'Four table implementations and 186 raw <table> exist today. Migrate a surface only when its local table CSS is deleted too — see RECIPES.md §4.',
      'No virtualisation, deliberately. Server pagination covers the datasets SIOMAC has, and virtualisation costs accessibility, sticky headers, keyboard navigation and testability. Build it when a measured page needs it.',
      'The Employees and Attendance History registers are the first clean family: both now use canonical JSX cells, sorting and pagination; the imperative jQuery/DataTables wrapper and its HTML-string rendering path are deleted.',
      'Pinned identity columns and module-owned toolbar content are canonical capabilities, not module CSS. All four Finance Statutory Configuration registers now use the v2 engine and their old scoped dt-* rules are deleted.',
      'The pre-v2 DataTable runtimes and styles are deleted. EmailTemplateLibrary.tsx retains one type-only DtColumn debt marker because its seven pre-existing lint blockers defer that Studio-owned migration.',
    ],
  },
  props: {
    density:      { type: 'segmented', label: 'Density', options: ['compact', 'standard', 'comfortable'], default: 'standard' },
    search:       { type: 'boolean',   label: 'Search', default: true },
    filters:      { type: 'boolean',   label: 'Filters', default: true },
    sorting:      { type: 'boolean',   label: 'Sortable headers', default: true },
    pagination:   { type: 'boolean',   label: 'Pagination', default: true },
    selection:    { type: 'boolean',   label: 'Selection + bulk actions', default: false },
    rowActions:   { type: 'boolean',   label: 'Row actions', default: true },
    columnChooser:{ type: 'boolean',   label: 'Column chooser', default: true },
    stickyHeader: { type: 'boolean',   label: 'Sticky header', default: false },
    zebra:        { type: 'boolean',   label: 'Zebra rows', default: false },
    state:        { type: 'select',    label: 'Data state', options: ['Rows', 'Loading', 'Empty', 'Error'], default: 'Rows' },
  },

  style: [
    { label: 'Frame', controls: [
      { name: '--ui-dt-radius', label: 'Corner radius', kind: 'size' },
      { name: '--ui-dt-border', label: 'Border', kind: 'color' },
      { name: '--ui-dt-bg',     label: 'Background', kind: 'color' },
      { name: '--ui-dt-grid-line', label: 'Grid lines', kind: 'color' },
    ] },
    { label: 'Header', controls: [
      { name: '--ui-dt-header-h',         label: 'Header height', kind: 'size' },
      { name: '--ui-dt-header-bg',        label: 'Header background', kind: 'color' },
      { name: '--ui-dt-header-fg',        label: 'Header text', kind: 'color' },
      { name: '--ui-dt-header-font-size', label: 'Header font size', kind: 'size' },
    ] },
    { label: 'Rows', controls: [
      { name: '--ui-dt-row-h',        label: 'Row height', kind: 'size' },
      { name: '--ui-dt-cell-pad-x',   label: 'Cell padding X', kind: 'size' },
      { name: '--ui-dt-cell-pad-y',   label: 'Cell padding Y', kind: 'size' },
      { name: '--ui-dt-font-size',    label: 'Text size', kind: 'size' },
      { name: '--ui-dt-row-hover',    label: 'Hover background', kind: 'color' },
      { name: '--ui-dt-row-selected', label: 'Selected background', kind: 'color-alpha' },
      { name: '--ui-dt-zebra',        label: 'Zebra background', kind: 'color' },
    ] },
  ],

  states: ['default', 'hover', 'selected', 'loading', 'error'],
  compare: ['default', 'loading', 'error'],

  a11y: {
    role: 'Semantic <table> with <thead>/<tbody>, scoped column headers',
    name: 'The required `label` prop, applied as aria-label on the table.',
    keyboard: [
      { keys: 'Tab',           does: 'Reaches the toolbar, then each sortable header, then each row\'s controls.' },
      { keys: 'Enter / Space', does: 'Sorts a header, ticks a checkbox, or opens a row menu.' },
      { keys: '↓ / ↑',         does: 'Moves within an open row-action menu.' },
      { keys: 'Escape',        does: 'Closes a row menu and returns focus to its trigger.' },
    ],
    focus: 'Row actions are hidden until hover, but revealed by :focus-within — so they stay reachable by keyboard rather than being invisible to it.',
    notes: [
      'A real <table>, not a grid of divs: div grids have no column headers and no row/column relationships for a screen reader.',
      'aria-sort is on the header CELL, not the sort button — it describes the column, not the control.',
      'Select-all is scoped to the CURRENT PAGE. On a server-paginated table it cannot honestly mean 4,000 unloaded rows, and pretending it does is how bulk actions delete records nobody saw.',
      'Row checkboxes and the actions cell stop click propagation, so ticking a row does not also fire onRowClick.',
    ],
  },

  render: (p, st) => {
    const state = s(p.state, 'Rows');
    const loading = state === 'Loading' || st === 'loading';
    const error = state === 'Error' || st === 'error' ? 'The request timed out after 30 seconds.' : null;
    const rows = state === 'Empty' ? [] : EMPLOYEES;

    return (
      <DataTable<DemoEmployee>
        label="Employees"
        rows={rows}
        columns={COLUMNS}
        getRowId={r => r.id}
        loading={loading}
        error={error}
        onRetry={noop}
        density={s(p.density, 'standard') as DataTableDensity}
        stickyHeader={b(p.stickyHeader)}
        zebra={b(p.zebra)}
        columnChooser={b(p.columnChooser)}
        search={b(p.search) ? { value: '', onChange: noop, placeholder: 'Search employees…' } : undefined}
        filters={b(p.filters)
          ? [
            { id: 'dept', label: 'Department', values: ['Operations'], onChange: noop,
              options: [
                { value: 'Operations', label: 'Operations' },
                { value: 'HSE', label: 'HSE' },
                { value: 'People', label: 'People' },
                { value: 'Engineering', label: 'Engineering' },
              ] },
            { id: 'status', label: 'Status', values: [], onChange: noop,
              options: [
                { value: 'active', label: 'Active' },
                { value: 'probation', label: 'Probation' },
                { value: 'leave', label: 'On leave' },
              ] },
          ]
          : undefined}
        sorting={b(p.sorting) ? { value: { columnId: 'employee', direction: 'asc' }, onChange: noop, client: true } : undefined}
        pagination={b(p.pagination)
          ? { page: 1, pageSize: 25, total: 148, onPageChange: noop, onPageSizeChange: noop }
          : undefined}
        selection={b(p.selection) || st === 'selected'
          ? {
            selectedIds: ['p1', 'p3'],
            onChange: noop,
            isSelectable: r => r.status !== 'inactive',
            bulkActions: [
              { id: 'export', label: 'Export', icon: <LucideIcon name="Download" />, onSelect: noop },
              { id: 'deactivate', label: 'Deactivate', icon: <LucideIcon name="UserMinus" />, tone: 'danger', onSelect: noop },
            ],
          }
          : undefined}
        rowActions={b(p.rowActions) ? ROW_ACTIONS : undefined}
        emptyState={{ title: 'No employees found', text: 'Try clearing the filters, or add your first employee.', icon: 'fa-users' }}
        toolbarActions={<Button variant="primary" size="sm" iconLeft={<LucideIcon name="Plus" />}>New employee</Button>}
      />
    );
  },

  code: p => `<DataTable
  label="Employees"
  rows={query.data.rows}
  columns={COLUMNS}
  getRowId={r => r.id}

  loading={query.isLoading}
  error={query.error?.message ?? null}
  onRetry={query.refetch}
${b(p.density) ? '' : ''}${s(p.density) !== 'standard' ? `  density="${s(p.density)}"\n` : ''}${b(p.search) ? '\n  search={{ value: q, onChange: setQ, placeholder: \'Search employees…\' }}' : ''}${b(p.filters) ? '\n  filters={FILTERS}' : ''}${b(p.sorting) ? '\n  sorting={{ value: sort, onChange: setSort }}' : ''}${b(p.pagination) ? '\n  pagination={{ page, pageSize, total: query.data.total, onPageChange: setPage, onPageSizeChange: setPageSize }}' : ''}${b(p.selection) ? '\n  selection={{ selectedIds, onChange: setSelectedIds, bulkActions: BULK }}' : ''}${b(p.rowActions) ? '\n  rowActions={row => [\n    { id: \'view\', label: \'View employee\', icon: <Eye />, onSelect: () => open(row.id) },\n    { id: \'off\', label: \'Deactivate\', tone: \'danger\', onSelect: () => deactivate(row.id) },\n  ]}' : ''}
/>`,

  presets: [
    { label: 'Basic (read-only)', props: { density: 'standard', search: false, filters: false, sorting: false, pagination: false, selection: false, rowActions: false, columnChooser: false, stickyHeader: false, zebra: false, state: 'Rows' } },
    { label: 'Server paginated', props: { density: 'standard', search: true, filters: true, sorting: true, pagination: true, selection: false, rowActions: true, columnChooser: true, stickyHeader: false, zebra: false, state: 'Rows' } },
    { label: 'Selectable admin', props: { density: 'standard', search: true, filters: false, sorting: true, pagination: true, selection: true, rowActions: true, columnChooser: false, stickyHeader: false, zebra: false, state: 'Rows' } },
    { label: 'Loading',          props: { density: 'standard', search: true, filters: true, sorting: true, pagination: true, selection: false, rowActions: true, columnChooser: true, stickyHeader: false, zebra: false, state: 'Loading' } },
    { label: 'Empty',            props: { density: 'standard', search: true, filters: true, sorting: true, pagination: false, selection: false, rowActions: false, columnChooser: false, stickyHeader: false, zebra: false, state: 'Empty' } },
    { label: 'Error',            props: { density: 'standard', search: true, filters: false, sorting: true, pagination: true, selection: false, rowActions: true, columnChooser: false, stickyHeader: false, zebra: false, state: 'Error' } },
    { label: 'Compact + zebra',  props: { density: 'compact', search: false, filters: false, sorting: true, pagination: true, selection: false, rowActions: true, columnChooser: false, stickyHeader: true, zebra: true, state: 'Rows' } },
  ],
};

/* ── Badge ─────────────────────────────────────────────────────────────────*/

export const badgeDef: ComponentDef = {
  id: 'badge',
  name: 'Badge',
  category: 'status',
  description: 'ONE badge system. Status pill, tag, chip, priority and risk indicators are all this component — a tone, a variant, and an optional remove affordance.',
  status: 'stable',
  componentPath: 'src/ui/primitives/Badge.tsx',
  importFrom: '@ui',
  migration: {
    replaces: ['.pill', '.obx-pill', '.stat-badge', '.totp-badge'],
    deprecatedImports: ['StatusPill'],
    nextSurface: 'TextInput / FormField',
    notes: [
      'Generic status labels now use semantic Badge tones. Domain adapters such as HrfinPill may remain only when they translate a bounded domain vocabulary into Badge props.',
      'Identity, date, presence, interactive toggle/filter chips and HSE risk-score indicators remain separate by design; they are not generic statuses.',
    ],
  },

  props: {
    label:   { type: 'text',      label: 'Label', default: 'Active' },
    tone:    { type: 'select',    label: 'Tone', options: ['success', 'warning', 'danger', 'info', 'neutral', 'accent'], default: 'success' },
    variant: { type: 'segmented', label: 'Variant', options: ['soft', 'solid', 'outline'], default: 'soft' },
    size:    { type: 'segmented', label: 'Size', options: ['sm', 'md'], default: 'md' },
    dot:     { type: 'boolean',   label: 'Status dot', default: false, help: 'For dense tables where a filled pill is heavier than the data it describes.' },
    icon:    { type: 'select',    label: 'Icon', options: ['none', 'CircleCheck', 'TriangleAlert', 'Clock', 'ShieldAlert'], default: 'none' },
    remove:  { type: 'boolean',   label: 'Removable (tag)', default: false },
  },

  style: [
    { label: 'Shape', controls: [
      { name: '--ui-badge-radius',      label: 'Corner radius', kind: 'size' },
      { name: '--ui-badge-height',      label: 'Height', kind: 'size' },
      { name: '--ui-badge-pad-x',       label: 'Padding X', kind: 'size' },
      { name: '--ui-badge-font-size',   label: 'Font size', kind: 'size' },
      { name: '--ui-badge-font-weight', label: 'Font weight', kind: 'text' },
      { name: '--ui-badge-dot-size',    label: 'Dot size', kind: 'size' },
    ] },
    { label: 'Tones', controls: [
      { name: '--ui-badge-success-solid', label: 'Success — solid', kind: 'color' },
      { name: '--ui-badge-success-soft',  label: 'Success — soft', kind: 'color-alpha' },
      { name: '--ui-badge-warning-solid', label: 'Warning — solid', kind: 'color' },
      { name: '--ui-badge-danger-solid',  label: 'Danger — solid', kind: 'color' },
      { name: '--ui-badge-info-solid',    label: 'Info — solid', kind: 'color' },
      { name: '--ui-badge-neutral-soft',  label: 'Neutral — soft', kind: 'color-alpha' },
    ] },
  ],

  states: ['default'],

  a11y: {
    role: null,
    name: 'Its text content. A badge is not interactive unless `onRemove` is set.',
    keyboard: [{ keys: 'Tab / Enter', does: 'Reaches and activates the remove control, when the badge is a tag.' }],
    focus: 'Only the remove control is focusable — the badge itself is text.',
    notes: [
      'Tone carries MEANING, not decoration. Do not pick a colour because it looks good next to the row.',
      'Colour alone is never the only signal: pair a tone with a word, and use `dot` or `icon` where the label must stay short.',
    ],
  },

  render: p => {
    const icon = s(p.icon, 'none');
    return (
      <Badge
        tone={s(p.tone, 'success') as never}
        variant={s(p.variant, 'soft') as never}
        size={s(p.size, 'md') as never}
        dot={b(p.dot)}
        icon={icon !== 'none' ? <LucideIcon name={icon as never} /> : undefined}
        onRemove={b(p.remove) ? noop : undefined}
      >
        {s(p.label, 'Badge')}
      </Badge>
    );
  },
  code: p => `<Badge tone="${s(p.tone, 'success')}"${s(p.variant) !== 'soft' ? ` variant="${s(p.variant)}"` : ''}${b(p.dot) ? ' dot' : ''}${b(p.remove) ? ' onRemove={remove}' : ''}>${s(p.label, 'Active')}</Badge>`,

  examples: [
    {
      id: 'status-set',
      title: 'A status set',
      description: 'One component, one tone scale. The ten legacy pill implementations each chose their own "active" green.',
      render: () => (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
          <Badge tone="success" dot>Active</Badge>
          <Badge tone="warning" dot>Probation</Badge>
          <Badge tone="info" dot>On leave</Badge>
          <Badge tone="neutral" dot>Inactive</Badge>
          <Badge tone="danger" dot>Terminated</Badge>
        </div>
      ),
    },
    {
      id: 'variants',
      title: 'Soft, solid, outline — and tags',
      description: 'Loudness is a variant; removability is a prop. Neither is a new component.',
      render: () => (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', alignItems: 'center' }}>
          <Badge tone="danger" variant="soft">Overdue</Badge>
          <Badge tone="danger" variant="solid">Critical</Badge>
          <Badge tone="danger" variant="outline">Escalated</Badge>
          <Badge tone="accent" size="sm" onRemove={noop}>Night shift</Badge>
        </div>
      ),
    },
  ],
};

export const DATA_DEFS: readonly ComponentDef[] = [dataTableDef, badgeDef];
