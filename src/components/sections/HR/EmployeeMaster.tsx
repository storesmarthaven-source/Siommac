/**
 * HR Employee Master workspace.
 *
 * The register is a page-local board widget so it retains server-backed search,
 * filters, sorting, pagination, profile selection, and capability-gated actions.
 * Business data always comes through authenticated HR API hooks.
 */

import { type VNode } from 'preact';
import { useEffect, useMemo, useState, useRef } from 'preact/hooks';
import {
  useHrEmployeesPage, usePrefetchHrEmployee,
  type HrEmployeeRow, type TrainingStatus, type EmployeeSortCol,
} from '@api/hr/employees';
import {
  humanize, rowName, statusTone, TRAINING_TONE, TRAINING_LABEL, Avatar, TinyAvatar,
} from './shared';
import { ProfileDrawer } from './ProfileDrawer';
import { CreateEmployeeWizard } from './CreateEmployeeWizard';
import { ContactDialog, StatusDialog, OffboardingDialog, ChangeRequestDialog, DocumentDialog, StatutoryDialog } from './ActionDialogs';
import { ImportWizard } from './ImportWizard';
import { StartOnboardingWizard } from './StartOnboardingWizard';
import { TableSkeleton, Button, EmptyState, LucideIcon, PageHeader, Pagination } from '@ui';
import {
  WidgetBoard, WidgetBoardToolbar, WidgetLibraryModal, useBoardLayout, WIDGET_REGISTRY, commitPreviewWidget, placeWidgetsAtBottom,
  type BoardLayout, type LocalWidgetMap, type PreviewWidgetInstance, type WidgetInstance, type WidgetSizeKey,
} from '@ui/widgets';
import { TableSearch, FilterDropdown, AdvancedFilter, ActiveFilters, useFilterDropdowns, type AdvTab } from '@ui';
import { can } from '@lib/permissions';
import { toast } from '@store';
import { useSessionStore, selectIsManager, selectIsAdmin, selectUserId } from '@store/session';
import { HRQueryNotice } from './HRQueryState';
import {
  hasEmployeeCreationAction, resolveEmployeeMasterAccess,
  type EmployeeMasterAccess,
} from './employeeMasterAccess';
import { employeeRegisterEmptyCopy, employeeRegisterSummary } from './employeeRegisterPresentation';
import { getUiPreference, saveUiPreference } from '@api/uiPreferences';
import { EMPLOYEE_REGISTER_COLUMNS_PREFERENCE_KEY } from '../../../../types/uiPreferences';
import {
  DEFAULT_EMPLOYEE_REGISTER_COLUMNS, EMPLOYEE_REGISTER_COLUMNS,
  employeeRegisterTableMinWidth, readEmployeeRegisterColumns, sanitizeEmployeeRegisterColumns,
  writeEmployeeRegisterColumns, type EmployeeRegisterColumnKey,
} from './employeeRegisterColumns';
import './HR.css';

const PAGE_KEY = 'hr.employees.overview';
const EMPLOYEE_BOARD_COLUMNS = 24;

// ── toolbar ────────────────────────────────────────────────────────────────────

// `department` holds department IDs (server-authoritative), not display names —
// labels are resolved via the `meta.departments` id→name map returned by the list endpoint.
interface Filters { query: string; status: string[]; department: string[]; employmentType: string[]; training: string[]; }
const EMPTY_FILTERS: Filters = { query: '', status: [], department: [], employmentType: [], training: [] };

// ── register table ─────────────────────────────────────────────────────────────

function EmployeeRow(
  { emp, supervisorName, visibleColumns, selected, openId, setOpenId, onSelect, onPrefetch, onPrefetchEnd, onAction, access }:
  { emp: HrEmployeeRow; supervisorName: string | null; selected: boolean; openId: string | null;
    visibleColumns: readonly EmployeeRegisterColumnKey[];
    setOpenId: (v: string | null) => void; onSelect: (id: string) => void;
    onPrefetch: (id: string) => void; onPrefetchEnd: () => void;
    onAction: (label: string, id: string) => void; access: EmployeeMasterAccess },
): VNode {
  const name = rowName(emp);
  const type = emp.employment_type ?? emp.workerType;
  const kebabId = `row-${emp.id}`;
  const isOpen = openId === kebabId;
  const activate = () => onSelect(emp.id);
  return (
    <tr class={`employee-row ${selected ? 'selected' : ''}`} tabIndex={0} role="button"
      aria-label={`View profile for ${name}`}
      onClick={activate}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activate(); } }}
      onMouseEnter={() => onPrefetch(emp.id)} onMouseLeave={onPrefetchEnd} onFocusCapture={() => onPrefetch(emp.id)}>
      {visibleColumns.includes('employee') && <td data-column="employee">
        <div class="employee-cell">
          <Avatar name={name} img={emp.profile_image_url} />
          <div style={{ minWidth: 0 }}>
            <div class="emp-name">{name}</div>
            <div class="emp-email">{emp.email ?? emp.personal_email ?? '—'}</div>
          </div>
        </div>
      </td>}
      {visibleColumns.includes('employeeNumber') && <td data-column="employeeNumber">{emp.employee_number ?? '—'}</td>}
      {visibleColumns.includes('position') && <td data-column="position">{emp.position ?? '—'}</td>}
      {visibleColumns.includes('department') && <td data-column="department">{emp.departmentName ?? '—'}</td>}
      {visibleColumns.includes('site') && <td data-column="site">{emp.siteName ?? '—'}</td>}
      {visibleColumns.includes('supervisor') && <td data-column="supervisor">{supervisorName
        ? <div class="supervisor-cell"><TinyAvatar name={supervisorName} />{supervisorName}</div>
        : <span style={{ color: '#94a3b8' }}>No supervisor</span>}</td>}
      {visibleColumns.includes('employmentType') && <td data-column="employmentType">{humanize(type)}</td>}
      {visibleColumns.includes('status') && <td data-column="status"><span class={`pill ${statusTone(emp.status)}`}>{humanize(emp.status)}</span></td>}
      {visibleColumns.includes('trainingStatus') && <td data-column="trainingStatus"><span class={`pill ${TRAINING_TONE[emp.trainingStatus]}`}>{TRAINING_LABEL[emp.trainingStatus]}</span></td>}
      {visibleColumns.includes('actions') && <td data-column="actions" class="kebab" onClick={e => e.stopPropagation()}>
        <div class="dropdown-wrap">
          <button type="button" class="kebab-btn" aria-label={`Actions for ${name}`} aria-haspopup="menu" aria-expanded={isOpen}
            onClick={e => { e.stopPropagation(); setOpenId(isOpen ? null : kebabId); }}><LucideIcon name="MoreHorizontal" size={18} /></button>
          {isOpen && (
            <div class="dropdown-menu right" role="menu" aria-label={`Actions for ${name}`} onClick={e => e.stopPropagation()}>
              <div class="dropdown-list">
                <button type="button" role="menuitem" class="menu-row" onClick={() => { onSelect(emp.id); setOpenId(null); }}>
                  <span class="menu-ico" aria-hidden="true"><LucideIcon name="Eye" size={15} /></span>View Profile
                </button>
                {access.requestChange && <button type="button" role="menuitem" class="menu-row" onClick={() => { onAction('Request Change', emp.id); setOpenId(null); }}>
                  <span class="menu-ico" aria-hidden="true"><LucideIcon name="FilePenLine" size={15} /></span>Request Change
                </button>}
                {access.changeStatus && <button type="button" role="menuitem" class="menu-row" onClick={() => { onAction('Change Status', emp.id); setOpenId(null); }}>
                  <span class="menu-ico" aria-hidden="true"><LucideIcon name="ShieldCheck" size={15} /></span>Change Status
                </button>}
                {access.uploadDocument && <button type="button" role="menuitem" class="menu-row" onClick={() => { onAction('Upload Document', emp.id); setOpenId(null); }}>
                  <span class="menu-ico" aria-hidden="true"><LucideIcon name="Upload" size={15} /></span>Upload Document
                </button>}
                {access.startOffboarding && <button type="button" role="menuitem" class="menu-row danger" onClick={() => { onAction('Start Offboarding', emp.id); setOpenId(null); }}>
                  <span class="menu-ico" aria-hidden="true"><LucideIcon name="UserRoundX" size={15} /></span>Start Offboarding
                </button>}
              </div>
            </div>
          )}
        </div>
      </td>}
    </tr>
  );
}

// ── default board layout (fresh user): 4 KPIs + the register, full width ────────

function defInst(widgetId: string, x: number, y: number, w: number, h: number, sizeKey: WidgetSizeKey): WidgetInstance {
  return { instanceId: `${widgetId}#def`, widgetId, pageKey: PAGE_KEY, zoneId: 'main', x, y, w, h, sizeKey, config: {} };
}
// The widget catalogue was cleared for a rebuild (no KPI/insight widgets left) — the
// default board is just the page-local register until new widgets are authored and
// added via the Widget Library.
export function defaultEmployeeLayout(): BoardLayout {
  return {
    pageKey: PAGE_KEY,
    columns: EMPLOYEE_BOARD_COLUMNS,
    zones: {
      main: [
        defInst('hr.employeeMaster.activeWorkforce', 0, 0, 4, 1, 'compact'),
        defInst('hr.employeeMaster.recordReadiness', 4, 0, 4, 1, 'compact'),
        defInst('hr.employeeMaster.hrWorkQueue', 8, 0, 4, 1, 'compact'),
        defInst('hr.employeeMaster.exceptions', 12, 0, 4, 1, 'compact'),
        defInst('hr.employeeMaster.newStarters', 16, 0, 4, 1, 'compact'),
        defInst('hr.employeeMaster.departures', 20, 0, 4, 1, 'compact'),
        defInst('hr.employeeMaster.workforceTrend', 0, 1, 12, 4, 'wide'),
        defInst('hr.employeeMaster.workforceDistribution', 12, 1, 12, 4, 'wide'),
        defInst('hr.employeeMaster.lifecycleMovement', 0, 5, 12, 5, 'wide'),
        defInst('enterprise.calendar.upcomingDeadlines', 12, 5, 6, 5, 'standard'),
        defInst('hr.employeeMaster.masterDataWorkload', 18, 5, 6, 5, 'standard'),
        defInst('hr.employees.register', 0, 10, EMPLOYEE_BOARD_COLUMNS, 9, 'hero'),
      ],
    },
  };
}

// ── page root ────────────────────────────────────────────────────────────────

export function EmployeeMaster(): VNode {
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const { openId, setOpenId } = useFilterDropdowns();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [modal, setModal] = useState<{ type: string; employeeId: string | null } | null>(null);
  // Board customize + widget-library (preview-on-board) state.
  const [editing, setEditing] = useState(false);
  const [libOpen, setLibOpen] = useState(false);
  const [demo, setDemo] = useState(false);
  const [preview, setPreview] = useState<PreviewWidgetInstance | null>(null);
  const userId = useSessionStore(selectUserId);
  const [visibleColumnKeys, setVisibleColumnKeys] = useState<EmployeeRegisterColumnKey[]>(
    () => readEmployeeRegisterColumns(userId),
  );
  const columnPreferenceDirty = useRef(false);
  const columnSaveQueue = useRef<Promise<void>>(Promise.resolve());
  useEffect(() => {
    columnPreferenceDirty.current = false;
    const cached = readEmployeeRegisterColumns(userId);
    setVisibleColumnKeys(cached);
    if (!userId) return;

    let alive = true;
    void getUiPreference<EmployeeRegisterColumnKey[]>(EMPLOYEE_REGISTER_COLUMNS_PREFERENCE_KEY)
      .then(preference => {
        if (!alive || columnPreferenceDirty.current || !preference) return;
        const remote = sanitizeEmployeeRegisterColumns(preference.value);
        setVisibleColumnKeys(remote);
        writeEmployeeRegisterColumns(userId, remote);
      })
      .catch((error: unknown) => {
        console.warn('[ui-preferences] Could not load employee register columns:', error);
      });
    return () => { alive = false; };
  }, [userId]);
  const visibleColumns = useMemo(
    () => EMPLOYEE_REGISTER_COLUMNS.filter(column => visibleColumnKeys.includes(column.key)),
    [visibleColumnKeys],
  );
  const tableMinWidth = useMemo(() => employeeRegisterTableMinWidth(visibleColumnKeys), [visibleColumnKeys]);

  const setColumns = (next: readonly EmployeeRegisterColumnKey[]): void => {
    const sanitized = sanitizeEmployeeRegisterColumns(next);
    columnPreferenceDirty.current = true;
    setVisibleColumnKeys(sanitized);
    writeEmployeeRegisterColumns(userId, sanitized);
    if (!userId) return;
    const saveForUser = userId;
    columnSaveQueue.current = columnSaveQueue.current.then(async () => {
      if (useSessionStore.getState().userId !== saveForUser) return;
      await saveUiPreference(EMPLOYEE_REGISTER_COLUMNS_PREFERENCE_KEY, sanitized);
    }).catch((error: unknown) => {
      console.warn('[ui-preferences] Could not save employee register columns:', error);
      toast.error('Column settings could not be synced. Your local selection is still available.');
    });
  };
  const toggleColumn = (key: EmployeeRegisterColumnKey): void => {
    const column = EMPLOYEE_REGISTER_COLUMNS.find(candidate => candidate.key === key);
    if (column?.required) return;
    setColumns(visibleColumnKeys.includes(key)
      ? visibleColumnKeys.filter(candidate => candidate !== key)
      : [...visibleColumnKeys, key]);
  };

  // Debounce free-text search before it hits the network — every other filter/sort/
  // page change fires immediately (they're discrete clicks, not keystrokes).
  const [searchDraft, setSearchDraft] = useState('');
  const filtersRef = useRef(filters);
  filtersRef.current = filters;
  useEffect(() => {
    if (searchDraft === filtersRef.current.query) return; // no real change — skip the pointless re-render
    const t = window.setTimeout(() => setFiltersReset({ ...filtersRef.current, query: searchDraft }), 300);
    return () => window.clearTimeout(t);
     
  }, [searchDraft]);

  const [sortBy, setSortBy] = useState<EmployeeSortCol>('full_name');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  function toggleSort(col: EmployeeSortCol) {
    if (sortBy === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortBy(col); setSortDir('asc'); }
    setPage(1);
  }

  // All filtering, sorting, and pagination happen in Postgres — this fetches only
  // the current page, never the whole register.
  const listQ = useHrEmployeesPage({
    search: filters.query || undefined,
    statuses: filters.status.length ? filters.status : undefined,
    departmentIds: filters.department.length ? filters.department : undefined,
    employmentTypes: filters.employmentType.length ? filters.employmentType : undefined,
    trainingStatuses: filters.training.length ? (filters.training as TrainingStatus[]) : undefined,
    sortBy, sortDir, page, pageSize,
  });
  const paged = listQ.data?.rows ?? [];
  const meta = listQ.data?.meta;
  const total = meta?.total ?? 0;
  const deptById = useMemo(() => Object.fromEntries((meta?.departments ?? []).map(d => [d.id, d.name])), [meta?.departments]);
  // Only managers/admins/superadmins may customize the board (drag/resize/add).
  const canEdit = useSessionStore(selectIsManager);
  const isAdmin = useSessionStore(selectIsAdmin);
  const access = resolveEmployeeMasterAccess();

  // The v2 board persists per-user; the register lives as a PAGE-LOCAL widget so it can
  // close over the page's filter/selection/modal state. KPI + insight + workforce
  // widgets come from the global registry (browsable in the Widget Library).
  const { layout, addWidget, updateZoneLayout, saveLayout, cancelLayout, setAsDefault, resetLayout } = useBoardLayout(PAGE_KEY, defaultEmployeeLayout(), EMPLOYEE_BOARD_COLUMNS);
  const boardItems = layout.zones.main ?? [];
  const placedWidgetIds = boardItems.map(w => w.widgetId);
  // New widgets/previews drop at the bottom of the board (never over the stats cards).
  const placeBottom = <T extends { x: number; y: number }>(w: T): T => ({ ...w, x: 0, y: Math.max(0, ...boardItems.map(i => i.y + i.h)) });
  const userPermissions = useMemo(
    () => Array.from(new Set(WIDGET_REGISTRY.flatMap(w => w.dataSource.permissions))).filter(can),
    [],
  );
  function discardPreview(): void {
    setPreview(null);
    setLibOpen(true); // undecided → back to the library
  }
  function commitPreview(p: PreviewWidgetInstance): void {
    void addWidget(p.zoneId, commitPreviewWidget(p));
    setPreview(null);
  }

  // Debounced hover-prefetch: only warm a row's detail once the cursor RESTS on it
  // (~140ms) — sweeping across the list fires nothing, so we never storm the API.
  const prefetchEmployee = usePrefetchHrEmployee();
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onRowHover = (id: string) => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    hoverTimer.current = setTimeout(() => prefetchEmployee(id), 140);
  };
  const onRowHoverEnd = () => {
    if (hoverTimer.current) { clearTimeout(hoverTimer.current); hoverTimer.current = null; }
  };

  // Filter option lists come from the server (meta), not the loaded page — a page of
  // 25 rows must not hide statuses/departments that exist elsewhere in the register.
  const statusOptions = meta?.statuses ?? [];
  const deptOptions = (meta?.departments ?? []).map(d => d.id);
  const deptLabelFn = (id: string) => deptById[id] ?? humanize(id);
  const typeOptions = meta?.employmentTypes ?? [];
  const trainingOptions = meta?.trainingStatuses ?? [];

  function notify(message: string) { toast.success(message); }
  function openAction(label: string, employeeId: string | null) {
    const map: Record<string, string> = {
      'Edit Contact': 'contact', 'Request Change': 'change', 'Change Status': 'status',
      'Start Offboarding': 'offboard', 'Upload Document': 'document', 'Upload HR Document': 'document',
      'Edit Statutory Profile': 'statutory',
    };
    const type = map[label];
    if (type && employeeId) { setModal({ type, employeeId }); setOpenId(null); }
  }

  // Pagination is server-authoritative: `total`/`paged` come from the API response
  // (meta.total, data), not a client-side slice of an over-fetched array.
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const curPage = Math.min(page, totalPages);
  function setFiltersReset(f: Filters) { setFilters(f); setPage(1); }

  const chipDefs: { label: string; onRemove: () => void }[] = [
    ...(filters.query ? [{ label: `Search: ${filters.query}`, onRemove: () => { setSearchDraft(''); setFiltersReset({ ...filters, query: '' }); } }] : []),
    ...filters.status.map(s => ({ label: humanize(s), onRemove: () => setFiltersReset({ ...filters, status: filters.status.filter(x => x !== s) }) })),
    ...filters.department.map(s => ({ label: deptLabelFn(s), onRemove: () => setFiltersReset({ ...filters, department: filters.department.filter(x => x !== s) }) })),
    ...filters.employmentType.map(s => ({ label: humanize(s), onRemove: () => setFiltersReset({ ...filters, employmentType: filters.employmentType.filter(x => x !== s) }) })),
    ...filters.training.map(s => ({ label: TRAINING_LABEL[s as TrainingStatus] ?? humanize(s), onRemove: () => setFiltersReset({ ...filters, training: filters.training.filter(x => x !== s) }) })),
  ];
  const hasActiveFilters = chipDefs.length > 0;
  const emptyRegisterCopy = employeeRegisterEmptyCopy(hasActiveFilters);

  const trainingLabel = (t: string): string => TRAINING_LABEL[t as TrainingStatus] ?? humanize(t);
  // Advanced-filter tabs (Organization / Employment / Compliance), backed by real meta lists.
  const advTabs: AdvTab[] = [
    { name: 'Organization', blurb: 'Filter by department assignment.', sections: [
      { type: 'checklist', title: 'Department', options: deptOptions, selected: filters.department,
        onChange: v => setFiltersReset({ ...filters, department: v }), labelFn: deptLabelFn },
    ] },
    { name: 'Employment', blurb: 'Filter by employee / worker type.', sections: [
      { type: 'checklist', title: 'Employment Type', options: typeOptions, selected: filters.employmentType,
        onChange: v => setFiltersReset({ ...filters, employmentType: v }), labelFn: humanize },
    ] },
    { name: 'Compliance', blurb: 'Filter by training readiness.', sections: [
      { type: 'checklist', title: 'Training Status', options: trainingOptions, selected: filters.training,
        onChange: v => setFiltersReset({ ...filters, training: v }), labelFn: trainingLabel },
    ] },
  ];
  const clearAdvanced = (): void => setFiltersReset({ ...filters, department: [], employmentType: [], training: [] });

  // The register (toolbar + filters + table + pagination) as a PAGE-LOCAL widget — its
  // render closes over current filters/selection/modal state (rebuilt each render).
  const renderRegister = (): VNode => (
      <div class="table-card" data-testid="employee-register">
        <header class="em-register-head">
          <div class="em-register-identity">
            <span class="em-register-icon" aria-hidden="true"><LucideIcon name="ContactRound" size={19} /></span>
            <div>
              <h2>Employee register</h2>
              <p aria-live="polite">{employeeRegisterSummary({
                total,
                activeFilterCount: chipDefs.length,
                isInitialLoading: listQ.isLoading && !listQ.data,
                isInitialError: listQ.isError && !listQ.data,
              })}</p>
            </div>
          </div>
        </header>

        <div class="employee-toolbar compact" role="search" aria-label="Employee register filters">
          <TableSearch value={searchDraft} onChange={setSearchDraft}
            placeholder="Search employee, email, employee no, position…" ariaLabel="Search employees" />
          <FilterDropdown id="status-filter" label="Status" options={statusOptions} selected={filters.status}
            onChange={v => setFiltersReset({ ...filters, status: v })} openId={openId} setOpenId={setOpenId} labelFn={humanize} />
          <AdvancedFilter id="advanced-filters" tabs={advTabs} onReset={clearAdvanced} openId={openId} setOpenId={setOpenId} />
          <div class="tf-wrap em-columns-wrap" onClick={e => e.stopPropagation()}>
            <button type="button" class="em-column-btn" aria-haspopup="menu" aria-expanded={openId === 'register-columns'}
              onClick={e => { e.stopPropagation(); setOpenId(openId === 'register-columns' ? null : 'register-columns'); }}>
              <LucideIcon name="Columns3" size={16} />
              <span>Columns</span>
              <span class="em-column-count">{visibleColumns.length}/{EMPLOYEE_REGISTER_COLUMNS.length}</span>
            </button>
            {openId === 'register-columns' && <div class="tf-menu tf-right em-columns-menu" role="menu" aria-label="Employee register columns" onClick={e => e.stopPropagation()}>
              <div class="tf-menu-head"><strong>Visible columns</strong><span>Choose the information shown in your register.</span></div>
              <div class="tf-menu-list">
                {EMPLOYEE_REGISTER_COLUMNS.map(column => {
                  const shown = visibleColumnKeys.includes(column.key);
                  return <button key={column.key} type="button" role="menuitemcheckbox" aria-checked={shown}
                    disabled={column.required} class={`tf-check ${shown ? 'active' : ''}`}
                    onClick={() => toggleColumn(column.key)}>
                    <span class="tf-checkbox" aria-hidden="true">{shown ? <LucideIcon name="Check" size={12} strokeWidth={3} /> : ''}</span>
                    <span class="tf-check-label">{column.label}</span>
                    {column.required && <span class="em-column-required">Required</span>}
                  </button>;
                })}
              </div>
              <div class="tf-menu-foot">
                <button type="button" onClick={() => setColumns(DEFAULT_EMPLOYEE_REGISTER_COLUMNS)}>Reset Columns</button>
                <button type="button" class="tf-apply" onClick={() => setOpenId(null)}>Done</button>
              </div>
            </div>}
          </div>
        </div>

        <HRQueryNotice queries={[listQ]} />

        <ActiveFilters chips={chipDefs} onClearAll={() => { setSearchDraft(''); setFiltersReset(EMPTY_FILTERS); }} />

        <div class="table-scroll" role="region" aria-label="Employee register table, scrollable" aria-busy={listQ.isFetching} tabIndex={0}>
          <table style={{ minWidth: `${tableMinWidth}px` }}>
            <caption class="sr-only">Employee register — {total} employee{total === 1 ? '' : 's'}, sorted by {humanize(sortBy)} ({sortDir === 'asc' ? 'ascending' : 'descending'})</caption>
            <colgroup>
              {visibleColumns.map(column => <col key={column.key} style={{ width: `${column.minWidth}px` }} />)}
            </colgroup>
            <thead>
              <tr>
                {visibleColumns.map(c => {
                  if (!c.sortKey) return <th key={c.key} scope="col" data-column={c.key}>{c.label}</th>;
                  const active = sortBy === c.sortKey;
                  const ariaSort = active ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none';
                  return (
                    <th key={c.key} scope="col" data-column={c.key} aria-sort={ariaSort}>
                      <button type="button" class="th-sort-btn" onClick={() => toggleSort(c.sortKey!)}>
                        {c.label}
                        <span aria-hidden="true" class="sort-caret">
                          <LucideIcon name={active ? (sortDir === 'asc' ? 'ArrowUp' : 'ArrowDown') : 'ChevronsUpDown'} size={12} />
                        </span>
                      </button>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {listQ.isLoading && !listQ.data
                ? <TableSkeleton rows={pageSize} cols={visibleColumns.length} firstCellAvatar />
                : paged.length
                  ? paged.map(emp => (
                    <EmployeeRow emp={emp} visibleColumns={visibleColumnKeys}
                      supervisorName={emp.supervisorName}
                      selected={selectedId === emp.id} openId={openId} setOpenId={setOpenId}
                      onSelect={setSelectedId} onPrefetch={onRowHover} onPrefetchEnd={onRowHoverEnd}
                      onAction={(label, id) => openAction(label, id)} access={access} />
                  ))
                  : <tr><td colSpan={visibleColumns.length} class="em-register-empty-cell">
                    <div class="em-register-empty">
                      {listQ.isError && !listQ.data
                        ? <EmptyState icon="fa-triangle-exclamation" tone="gray" title="Employee register unavailable"
                            text="The employee records could not be loaded. Your filters and workspace have been preserved."
                            actions={<Button variant="outline" icon="fa-rotate-right" onClick={() => void listQ.refetch()}>Retry</Button>} />
                        : <EmptyState icon="fa-user-group" tone="gray"
                            title={emptyRegisterCopy.title}
                            text={emptyRegisterCopy.text}
                            actions={hasActiveFilters
                              ? <Button variant="outline" icon="fa-filter-circle-xmark" onClick={() => { setSearchDraft(''); setFiltersReset(EMPTY_FILTERS); }}>Clear filters</Button>
                              : undefined} />}
                    </div>
                  </td></tr>}
            </tbody>
          </table>
        </div>

        {total > 0 && <footer class="em-register-footer">
          <Pagination page={curPage - 1} pageCount={totalPages} total={total} pageSize={pageSize}
            onPage={nextPage => setPage(nextPage + 1)} noun="employees" />
          <div class="rows-select">
            <label for="employee-page-size">Rows per page</label>
            <select id="employee-page-size" value={String(pageSize)} onChange={e => { setPageSize(Number(e.currentTarget.value)); setPage(1); }}>
              <option value="25">25</option><option value="50">50</option><option value="100">100</option>
            </select>
          </div>
        </footer>}
      </div>
  );
  const localWidgets: LocalWidgetMap = {
    'hr.employees.register': { render: renderRegister, chrome: 'none', title: 'Employee Register' },
  };

  // Start Onboarding is a full-PAGE wizard now (not a modal) — take over the view when launched.
  if (modal?.type === 'onboarding') {
    return <StartOnboardingWizard employeeId={modal.employeeId} onBack={() => setModal(null)} />;
  }

  return (
    <>
      <div class="hr-emp-master" onClick={() => setOpenId(null)}>
      <PageHeader
        icon={<LucideIcon name="UsersRound" size={21} />}
        module="Human Resources"
        title="Employee Master"
        sub="Manage workforce records, employment status, assignments, and employee lifecycle actions."
        actions={<div class="em-page-actions" onClick={e => e.stopPropagation()}>
          {canEdit && <WidgetBoardToolbar
            editing={editing} canSetDefault={isAdmin} layoutItems={boardItems}
            onToggleEdit={() => setEditing(e => !e)}
            onOpenLibrary={() => { setEditing(true); setLibOpen(true); }}
            onSaveEditing={async () => { await saveLayout(); setEditing(false); }}
            onCancelEditing={async () => { await cancelLayout(); setEditing(false); }}
            onReset={() => void resetLayout()}
            onSetDefault={() => void setAsDefault()}
          />}
          {hasEmployeeCreationAction(access) && <div class="dropdown-wrap">
            <button class="em-new-btn" type="button" aria-haspopup="menu" aria-expanded={openId === 'new-menu'}
              onClick={e => { e.stopPropagation(); setOpenId(openId === 'new-menu' ? null : 'new-menu'); }}>
              <LucideIcon name="UserPlus" size={16} />
              <span>New Employee</span>
              <LucideIcon name="ChevronDown" size={14} />
            </button>
            {openId === 'new-menu' && (
              <div class="dropdown-menu right" role="menu" aria-label="New employee actions" onClick={e => e.stopPropagation()}>
                <div class="dropdown-list">
                  {access.createEmployee && <button type="button" role="menuitem" class="menu-row" onClick={() => { setModal({ type: 'create', employeeId: null }); setOpenId(null); }}>
                    <span class="menu-ico"><LucideIcon name="UserPlus" size={15} /></span>Create Employee
                  </button>}
                  {access.importEmployees && <button type="button" role="menuitem" class="menu-row" onClick={() => { setModal({ type: 'import', employeeId: null }); setOpenId(null); }}>
                    <span class="menu-ico"><LucideIcon name="FileUp" size={15} /></span>Import Employees
                  </button>}
                  {access.startOnboarding && <button type="button" role="menuitem" class="menu-row" onClick={() => { setModal({ type: 'onboarding', employeeId: null }); setOpenId(null); }}>
                    <span class="menu-ico"><LucideIcon name="ListChecks" size={15} /></span>Start Onboarding
                  </button>}
                </div>
              </div>
            )}
          </div>}
          <button type="button" class="em-page-icon-btn" aria-label="Refresh Employee Register" title="Refresh Employee Register"
            disabled={listQ.isFetching} onClick={() => void listQ.refetch()}>
            <LucideIcon name="RefreshCw" size={17} class={listQ.isFetching ? 'is-spinning' : undefined} />
          </button>
        </div>}
      />

      {preview && (
        <div class="wmock-preview-banner">
          <span><i class="fas fa-eye" /> Previewing a widget — drag and resize it on the board, then <strong>Add to board</strong> or <strong>Discard</strong>.</span>
          <Button variant="outline" icon="fa-xmark" onClick={discardPreview}>Discard preview</Button>
        </div>
      )}

      {/* Unified customizable board — KPI/insight/workforce widgets (from the library) +
          the employee register (page-local). Read-only unless manager/admin/superadmin. */}
      <WidgetBoard pageKey={PAGE_KEY} zones={['main']} editing={editing && canEdit}
        localWidgets={localWidgets} defaultLayout={defaultEmployeeLayout()} demo={demo}
        column={EMPLOYEE_BOARD_COLUMNS}
        preview={preview} onPreviewChange={setPreview}
        onCommitPreview={commitPreview} onDiscardPreview={discardPreview} />

      <WidgetLibraryModal open={libOpen} pageKey={PAGE_KEY} zoneId="main"
        placedWidgetIds={placedWidgetIds} userPermissions={userPermissions}
        demo={demo} onToggleDemo={() => setDemo(d => !d)}
        canManagePackages={isAdmin}
        onClose={() => setLibOpen(false)}
        onAddWidget={inst => addWidget('main', placeBottom(inst))}
        onAddWidgets={instances => updateZoneLayout('main', [...boardItems, ...placeWidgetsAtBottom(boardItems, instances)])}
        onPreviewOnBoard={p => setPreview(placeBottom(p))} />

      {/* Profile drawer */}
      <ProfileDrawer employeeId={selectedId} onClose={() => setSelectedId(null)} onAction={(label) => openAction(label, selectedId)} access={access} />

      {/* Modals */}
      {modal?.type === 'create'   && <CreateEmployeeWizard onClose={() => setModal(null)} onToast={notify} />}
      {modal?.type === 'import'   && <ImportWizard onClose={() => setModal(null)} onToast={notify} />}
      {modal?.type === 'contact'  && modal.employeeId && <ContactDialog      employeeId={modal.employeeId} onClose={() => setModal(null)} onToast={notify} />}
      {modal?.type === 'status'   && modal.employeeId && <StatusDialog       employeeId={modal.employeeId} onClose={() => setModal(null)} onToast={notify} />}
      {modal?.type === 'offboard' && modal.employeeId && <OffboardingDialog  employeeId={modal.employeeId} onClose={() => setModal(null)} onToast={notify} />}
      {modal?.type === 'change'   && modal.employeeId && <ChangeRequestDialog employeeId={modal.employeeId} onClose={() => setModal(null)} onToast={notify} />}
      {modal?.type === 'document' && modal.employeeId && <DocumentDialog      employeeId={modal.employeeId} onClose={() => setModal(null)} onToast={notify} />}
      {modal?.type === 'statutory' && modal.employeeId && <StatutoryDialog     employeeId={modal.employeeId} onClose={() => setModal(null)} onToast={notify} />}

      </div>
    </>
  );
}
