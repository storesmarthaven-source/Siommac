/**
 * src/components/sections/HR/EmployeeMaster.tsx
 *
 * HR ▸ Employee Master — a FAITHFUL port of the v36 source mockup's main page
 * (siomac-hr-employee-master-preact-v36-settings-wizard-leftbar.html): the page
 * header (Settings + New menu), the 4 one-line KPI stat cards with their charts,
 * the filter toolbar, the 10-column register, and pagination — rendered inside the
 * Siomac AppShell (the mockup's own hr-sidebar/topbar are dropped; Siomac provides
 * them). Styling lives in ./HR.css, scoped to `.hr-emp-master`.
 *
 * Wiring is real: KPIs ← useHrDashboardStats; the register ← useHrEmployees, whose
 * rows carry siteName (resolved from project_sites) and supervisorName (resolved
 * from app_users) server-side — "Site"/"Supervisor" show — only when genuinely
 * unassigned. Only filters backed by real data are wired (status, department,
 * employment type, training) — the v36 advanced panel's aspirational filters map to
 * features not yet in Siomac and are deferred to the Siomac-fit pass rather than
 * shipped as no-op filters.
 *
 * This is Phase A (read-side main page). The profile drawer, create/import/
 * onboarding wizards, and change/status/document/offboarding dialogs are the next
 * phases — their entry points here surface a "next phase" notice rather than a
 * dead click.
 */

import { type VNode } from 'preact';
import { useMemo, useState, useRef } from 'preact/hooks';
import {
  useHrEmployees, usePrefetchHrEmployee,
  type HrEmployeeRow, type TrainingStatus,
} from '@api/hr/employees';
import {
  humanize, rowName, statusTone, TRAINING_TONE, TRAINING_LABEL, Avatar, TinyAvatar,
} from './shared';
import { ProfileDrawer } from './ProfileDrawer';
import { CreateEmployeeWizard } from './CreateEmployeeWizard';
import { ContactDialog, StatusDialog, OffboardingDialog, ChangeRequestDialog, DocumentDialog, StatutoryDialog } from './ActionDialogs';
import { ImportWizard } from './ImportWizard';
import { OnboardingWizard } from './OnboardingWizard';
import { TableSkeleton, Button } from '@ui';
import { AppTopBar } from '@shared/AppTopBar';
import {
  WidgetBoard, WidgetBoardToolbar, WidgetLibraryModal, useBoardLayout, WIDGET_REGISTRY, commitPreviewWidget,
  type BoardLayout, type LocalWidgetMap, type PreviewWidgetInstance, type WidgetInstance, type WidgetSizeKey,
} from '@ui/widgets';
import { can } from '@lib/permissions';
import { useSessionStore, selectIsManager, selectIsAdmin } from '@store/session';
import './HR.css';

const PAGE_KEY = 'hr.employees.overview';

// ── toolbar ────────────────────────────────────────────────────────────────────

interface Filters { query: string; status: string[]; department: string[]; employmentType: string[]; training: string[]; }
const EMPTY_FILTERS: Filters = { query: '', status: [], department: [], employmentType: [], training: [] };

function toggle(list: string[], v: string): string[] {
  return list.includes(v) ? list.filter(x => x !== v) : [...list, v];
}

function MultiDropdown(
  { id, label, options, selected, onChange, openId, setOpenId, labelFn }:
  { id: string; label: string; options: string[]; selected: string[]; onChange: (v: string[]) => void;
    openId: string | null; setOpenId: (v: string | null) => void; labelFn: (o: string) => string },
): VNode {
  const isOpen = openId === id;
  const value = selected.length
    ? selected.slice(0, 2).map(labelFn).join(', ') + (selected.length > 2 ? ` +${selected.length - 2}` : '')
    : 'All';
  return (
    <div class="dropdown-wrap">
      <button type="button" class="multi-select" onClick={e => { e.stopPropagation(); setOpenId(isOpen ? null : id); }}>
        <span class="multi-select-text"><span class="multi-select-label">{label}</span><span class="multi-select-value">{value}</span></span>
        {selected.length ? <span class="multi-select-count">{selected.length}</span> : <span>⌄</span>}
      </button>
      {isOpen && (
        <div class="dropdown-menu" onClick={e => e.stopPropagation()}>
          <div class="dropdown-head"><strong>{label}</strong><span>Select one or more values.</span></div>
          <div class="dropdown-list">
            {options.length ? options.map(opt => (
              <button type="button" class={`check-row ${selected.includes(opt) ? 'active' : ''}`} onClick={() => onChange(toggle(selected, opt))}>
                <span class="check-box">{selected.includes(opt) ? '✓' : ''}</span><span>{labelFn(opt)}</span>
              </button>
            )) : <div class="em-empty">No values</div>}
          </div>
          <div class="dropdown-foot">
            <button type="button" onClick={() => onChange([])}>Clear</button>
            <button type="button" class="apply" onClick={() => setOpenId(null)}>Apply</button>
          </div>
        </div>
      )}
    </div>
  );
}

function OptionSet(
  { title, options, selected, onChange, labelFn }:
  { title: string; options: string[]; selected: string[]; onChange: (v: string[]) => void; labelFn: (o: string) => string },
): VNode {
  return (
    <div class="advanced-section">
      <div class="advanced-section-title"><strong>{title}</strong><span>{selected.length ? `${selected.length} selected` : 'All'}</span></div>
      <div class="compact-checks">
        {options.length ? options.map(opt => (
          <button type="button" class={`check-row ${selected.includes(opt) ? 'active' : ''}`}
            onClick={e => { e.stopPropagation(); onChange(toggle(selected, opt)); }}>
            <span class="check-box">{selected.includes(opt) ? '✓' : ''}</span><span>{labelFn(opt)}</span>
          </button>
        )) : <div class="em-empty">No values</div>}
      </div>
    </div>
  );
}

const ADV_TABS = ['Organization', 'Employment', 'Compliance'] as const;
type AdvTab = typeof ADV_TABS[number];

function AdvancedFilters(
  { filters, setFilters, openId, setOpenId, deptOptions, typeOptions, trainingOptions }:
  { filters: Filters; setFilters: (f: Filters) => void; openId: string | null; setOpenId: (v: string | null) => void;
    deptOptions: string[]; typeOptions: string[]; trainingOptions: string[] },
): VNode {
  const isOpen = openId === 'advanced-filters';
  const [tab, setTab] = useState<AdvTab>('Organization');
  const count = filters.department.length + filters.employmentType.length + filters.training.length;
  const clearAdvanced = () => setFilters({ ...filters, department: [], employmentType: [], training: [] });
  const trainingLabel = (t: string) => TRAINING_LABEL[t as TrainingStatus] ?? humanize(t);
  return (
    <div class="dropdown-wrap" onClick={e => e.stopPropagation()}>
      <button type="button" class="advanced-filter-btn" onClick={e => { e.stopPropagation(); setOpenId(isOpen ? null : 'advanced-filters'); }}>
        <span class="left">
          <span class="sliders">≡</span>
          <span><small>Advanced</small><strong>{count ? `${count} filters active` : 'Advanced filters'}</strong></span>
        </span>
        <span class="adv-right">
          {count ? <span class="advanced-count">{count}</span> : null}
          <span class="adv-caret"><i class="fas fa-chevron-down" aria-hidden="true" /></span>
        </span>
      </button>
      {isOpen && (
        <div class="dropdown-menu advanced-menu right" onClick={e => e.stopPropagation()}>
          <div class="dropdown-head"><strong>Advanced Filters</strong><span>Filters backed by real Employee Master data.</span></div>
          <div class="advanced-panel tabbed">
            <div class="advanced-tabs">
              {ADV_TABS.map(name => (
                <button type="button" class={`advanced-tab ${tab === name ? 'active' : ''}`} onClick={e => { e.stopPropagation(); setTab(name); }}>{name}</button>
              ))}
            </div>
            <div class="advanced-tab-body">
              {tab === 'Organization' && (
                <div>
                  <div class="advanced-tab-title">
                    <div><strong>Organization filters</strong><span>Filter by department assignment.</span></div>
                    <span class="setting-pill">Multi-select</span>
                  </div>
                  <div class="filter-tab-grid">
                    <OptionSet title="Department" options={deptOptions} selected={filters.department}
                      onChange={v => setFilters({ ...filters, department: v })} labelFn={humanize} />
                  </div>
                </div>
              )}
              {tab === 'Employment' && (
                <div>
                  <div class="advanced-tab-title">
                    <div><strong>Employment filters</strong><span>Filter by employee / worker type.</span></div>
                    <span class="setting-pill">Multi-select</span>
                  </div>
                  <div class="filter-tab-grid">
                    <OptionSet title="Employment Type" options={typeOptions} selected={filters.employmentType}
                      onChange={v => setFilters({ ...filters, employmentType: v })} labelFn={humanize} />
                  </div>
                </div>
              )}
              {tab === 'Compliance' && (
                <div>
                  <div class="advanced-tab-title">
                    <div><strong>Compliance filters</strong><span>Filter by training readiness.</span></div>
                    <span class="setting-pill">Multi-select</span>
                  </div>
                  <div class="filter-tab-grid">
                    <OptionSet title="Training Status" options={trainingOptions} selected={filters.training}
                      onChange={v => setFilters({ ...filters, training: v })} labelFn={trainingLabel} />
                  </div>
                </div>
              )}
            </div>
            <div class="advanced-footer">
              <button class="secondary-btn" type="button" onClick={clearAdvanced}>Reset Advanced</button>
              <button class="primary-btn" type="button" onClick={() => setOpenId(null)}>Apply Filters</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── register table ─────────────────────────────────────────────────────────────

const TABLE_COLS = ['Employee', 'Employee No.', 'Position / Role', 'Department', 'Site', 'Supervisor', 'Employment Type', 'Status', 'Training Status', 'Actions'];

function EmployeeRow(
  { emp, supervisorName, selected, openId, setOpenId, onSelect, onPrefetch, onPrefetchEnd, onAction }:
  { emp: HrEmployeeRow; supervisorName: string | null; selected: boolean; openId: string | null;
    setOpenId: (v: string | null) => void; onSelect: (id: string) => void;
    onPrefetch: (id: string) => void; onPrefetchEnd: () => void;
    onAction: (label: string, id: string) => void },
): VNode {
  const name = rowName(emp);
  const type = emp.employment_type ?? emp.workerType;
  const kebabId = `row-${emp.id}`;
  const isOpen = openId === kebabId;
  return (
    <tr class={`employee-row ${selected ? 'selected' : ''}`} onClick={() => onSelect(emp.id)}
      onMouseEnter={() => onPrefetch(emp.id)} onMouseLeave={onPrefetchEnd} onFocusCapture={() => onPrefetch(emp.id)}>
      <td>
        <div class="employee-cell">
          <Avatar name={name} img={emp.profile_image_url} />
          <div style={{ minWidth: 0 }}>
            <div class="emp-name">{name}</div>
            <div class="emp-email">{emp.email ?? emp.personal_email ?? '—'}</div>
          </div>
        </div>
      </td>
      <td>{emp.employee_number ?? '—'}</td>
      <td>{emp.position ?? '—'}</td>
      <td>{emp.departmentName ?? '—'}</td>
      <td>{emp.siteName ?? '—'}</td>
      <td>{supervisorName
        ? <div class="supervisor-cell"><TinyAvatar name={supervisorName} />{supervisorName}</div>
        : <span style={{ color: '#94a3b8' }}>No supervisor</span>}</td>
      <td>{humanize(type)}</td>
      <td><span class={`pill ${statusTone(emp.status)}`}>{humanize(emp.status)}</span></td>
      <td><span class={`pill ${TRAINING_TONE[emp.trainingStatus]}`}>{TRAINING_LABEL[emp.trainingStatus]}</span></td>
      <td class="kebab" onClick={e => e.stopPropagation()}>
        <div class="dropdown-wrap">
          <button type="button" class="kebab-btn" onClick={e => { e.stopPropagation(); setOpenId(isOpen ? null : kebabId); }}>⋮</button>
          {isOpen && (
            <div class="dropdown-menu right" onClick={e => e.stopPropagation()}>
              <div class="dropdown-list">
                <button type="button" class="menu-row" onClick={() => { onSelect(emp.id); setOpenId(null); }}>
                  <span class="menu-ico"><i class="fas fa-eye" /></span>View Profile
                </button>
                <button type="button" class="menu-row" onClick={() => { onAction('Request Change', emp.id); setOpenId(null); }}>
                  <span class="menu-ico"><i class="fas fa-pen" /></span>Request Change
                </button>
                <button type="button" class="menu-row" onClick={() => { onAction('Change Status', emp.id); setOpenId(null); }}>
                  <span class="menu-ico"><i class="fas fa-shield-halved" /></span>Change Status
                </button>
                <button type="button" class="menu-row" onClick={() => { onAction('Upload Document', emp.id); setOpenId(null); }}>
                  <span class="menu-ico"><i class="fas fa-upload" /></span>Upload Document
                </button>
                <button type="button" class="menu-row danger" onClick={() => { onAction('Start Offboarding', emp.id); setOpenId(null); }}>
                  <span class="menu-ico"><i class="fas fa-triangle-exclamation" /></span>Start Offboarding
                </button>
              </div>
            </div>
          )}
        </div>
      </td>
    </tr>
  );
}

// ── pagination ──────────────────────────────────────────────────────────────────

function pageWindow(cur: number, total: number): (number | '…')[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const out: (number | '…')[] = [1];
  const s = Math.max(2, cur - 1), e = Math.min(total - 1, cur + 1);
  if (s > 2) out.push('…');
  for (let i = s; i <= e; i++) out.push(i);
  if (e < total - 1) out.push('…');
  out.push(total);
  return out;
}

// ── default board layout (fresh user): 4 KPIs + the register, full width ────────

function defInst(widgetId: string, x: number, y: number, w: number, h: number, sizeKey: WidgetSizeKey): WidgetInstance {
  return { instanceId: `${widgetId}#def`, widgetId, pageKey: PAGE_KEY, zoneId: 'main', x, y, w, h, sizeKey, config: {} };
}
function defaultEmployeeLayout(): BoardLayout {
  return {
    pageKey: PAGE_KEY,
    zones: {
      main: [
        defInst('hr.employees.activeWorkforce', 0, 0, 3, 3, 'compact'),
        defInst('hr.employees.workQueue',       3, 0, 3, 3, 'compact'),
        defInst('hr.employees.readiness',       6, 0, 3, 3, 'compact'),
        defInst('hr.employees.exceptions',      9, 0, 3, 3, 'compact'),
        defInst('hr.employees.register',        0, 3, 12, 9, 'hero'),
      ],
    },
  };
}

// ── page root ────────────────────────────────────────────────────────────────

export function EmployeeMaster(): VNode {
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [openId, setOpenId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [toast, setToast] = useState('');
  const [modal, setModal] = useState<{ type: string; employeeId: string | null } | null>(null);
  // Board customize + widget-library (preview-on-board) state.
  const [editing, setEditing] = useState(false);
  const [libOpen, setLibOpen] = useState(false);
  const [demo, setDemo] = useState(false);
  const [preview, setPreview] = useState<PreviewWidgetInstance | null>(null);

  const listQ = useHrEmployees({ limit: 500 });
  const rows = useMemo(() => listQ.data ?? [], [listQ.data]);
  // Only managers/admins/superadmins may customize the board (drag/resize/add).
  const canEdit = useSessionStore(selectIsManager);
  const isAdmin = useSessionStore(selectIsAdmin);

  // The v2 board persists per-user; the register lives as a PAGE-LOCAL widget so it can
  // close over the page's filter/selection/modal state. KPI + insight + workforce
  // widgets come from the global registry (browsable in the Widget Library).
  const { layout, addWidget, setAsDefault, resetLayout } = useBoardLayout(PAGE_KEY, defaultEmployeeLayout());
  const boardItems = layout.zones['main'] ?? [];
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

  const distinct = (vals: (string | null | undefined)[]) => Array.from(new Set(vals.filter((v): v is string => !!v))).sort();
  const statusOptions = useMemo(() => distinct(rows.map(r => r.status)), [rows]);
  const deptOptions = useMemo(() => distinct(rows.map(r => r.departmentName)), [rows]);
  const typeOptions = useMemo(() => distinct(rows.map(r => r.employment_type ?? r.workerType)), [rows]);
  const trainingOptions = useMemo(() => distinct(rows.map(r => r.trainingStatus)), [rows]);

  function notify(message: string) { setToast(message); window.setTimeout(() => setToast(''), 2600); }
  function openAction(label: string, employeeId: string | null) {
    const map: Record<string, string> = {
      'Edit Contact': 'contact', 'Request Change': 'change', 'Change Status': 'status',
      'Start Offboarding': 'offboard', 'Upload Document': 'document', 'Upload HR Document': 'document',
      'Edit Statutory Profile': 'statutory',
    };
    const type = map[label];
    if (type && employeeId) { setModal({ type, employeeId }); setOpenId(null); }
  }

  const filtered = useMemo(() => {
    const q = filters.query.trim().toLowerCase();
    return rows.filter(r => {
      const name = rowName(r);
      const qOk = !q || [name, r.email, r.employee_number, r.position, r.departmentName, r.siteName, r.supervisorName]
        .some(v => String(v ?? '').toLowerCase().includes(q));
      const statusOk = !filters.status.length || filters.status.includes(r.status);
      const deptOk = !filters.department.length || (r.departmentName != null && filters.department.includes(r.departmentName));
      const typeOk = !filters.employmentType.length || filters.employmentType.includes(r.employment_type ?? r.workerType);
      const trainOk = !filters.training.length || filters.training.includes(r.trainingStatus);
      return qOk && statusOk && deptOk && typeOk && trainOk;
    });
  }, [rows, filters]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const curPage = Math.min(page, totalPages);
  const start = (curPage - 1) * pageSize;
  const paged = filtered.slice(start, start + pageSize);
  function setFiltersReset(f: Filters) { setFilters(f); setPage(1); }

  const chipDefs: { label: string; onRemove: () => void }[] = [
    ...filters.status.map(s => ({ label: humanize(s), onRemove: () => setFiltersReset({ ...filters, status: filters.status.filter(x => x !== s) }) })),
    ...filters.department.map(s => ({ label: humanize(s), onRemove: () => setFiltersReset({ ...filters, department: filters.department.filter(x => x !== s) }) })),
    ...filters.employmentType.map(s => ({ label: humanize(s), onRemove: () => setFiltersReset({ ...filters, employmentType: filters.employmentType.filter(x => x !== s) }) })),
    ...filters.training.map(s => ({ label: TRAINING_LABEL[s as TrainingStatus] ?? humanize(s), onRemove: () => setFiltersReset({ ...filters, training: filters.training.filter(x => x !== s) }) })),
  ];

  // The register (toolbar + filters + table + pagination) as a PAGE-LOCAL widget — its
  // render closes over current filters/selection/modal state (rebuilt each render).
  const renderRegister = (): VNode => (
      <div class="table-card">
        <div class="employee-toolbar compact">
          <div class="table-search">
            <span class="magnify">⌕</span>
            <input value={filters.query} placeholder="Search employee, email, employee no, position, department…"
              onInput={e => setFiltersReset({ ...filters, query: e.currentTarget.value })} />
          </div>
          <MultiDropdown id="status-filter" label="Status" options={statusOptions} selected={filters.status}
            onChange={v => setFiltersReset({ ...filters, status: v })} openId={openId} setOpenId={setOpenId} labelFn={humanize} />
          <AdvancedFilters filters={filters} setFilters={setFiltersReset} openId={openId} setOpenId={setOpenId}
            deptOptions={deptOptions} typeOptions={typeOptions} trainingOptions={trainingOptions} />
          <div class="dropdown-wrap">
            <button class="hse-btn accent" type="button" onClick={e => { e.stopPropagation(); setOpenId(openId === 'new-menu' ? null : 'new-menu'); }}>
              <i class="fas fa-circle-plus" /> New Employee <i class="fas fa-chevron-down" style={{ fontSize: '0.6rem', marginLeft: '2px' }} />
            </button>
            {openId === 'new-menu' && (
              <div class="dropdown-menu right" onClick={e => e.stopPropagation()}>
                <div class="dropdown-list">
                  <button type="button" class="menu-row" onClick={() => { setModal({ type: 'create', employeeId: null }); setOpenId(null); }}>
                    <span class="menu-ico"><i class="fas fa-user-plus" /></span>Create Employee
                  </button>
                  <button type="button" class="menu-row" onClick={() => { setModal({ type: 'import', employeeId: null }); setOpenId(null); }}>
                    <span class="menu-ico"><i class="fas fa-file-import" /></span>Import Employees
                  </button>
                  <button type="button" class="menu-row" onClick={() => { setModal({ type: 'onboarding', employeeId: null }); setOpenId(null); }}>
                    <span class="menu-ico"><i class="fas fa-list-check" /></span>Start Onboarding
                  </button>
                  <button type="button" class="menu-row" disabled style={{ opacity: .5, cursor: 'not-allowed' }}
                    title="Blocked on the HSE Contractor Management module, which isn't built yet.">
                    <span class="menu-ico"><i class="fas fa-helmet-safety" /></span>Create Contractor Worker
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {(chipDefs.length || filters.query) ? (
          <div class="active-filter-bar">
            {chipDefs.length ? <strong>Active filters:</strong> : null}
            {chipDefs.map(c => <button class="chip-btn" type="button" onClick={() => c.onRemove()}>{c.label} ×</button>)}
            <button class="ghost-btn" type="button" onClick={() => setFiltersReset(EMPTY_FILTERS)}>Clear all</button>
          </div>
        ) : null}

        <div class="table-scroll">
          <table>
            <thead><tr>{TABLE_COLS.map(c => <th>{c}</th>)}</tr></thead>
            <tbody>
              {listQ.isLoading && !listQ.data
                ? <TableSkeleton rows={pageSize} cols={TABLE_COLS.length} firstCellAvatar />
                : paged.length
                  ? paged.map(emp => (
                    <EmployeeRow emp={emp}
                      supervisorName={emp.supervisorName}
                      selected={selectedId === emp.id} openId={openId} setOpenId={setOpenId}
                      onSelect={setSelectedId} onPrefetch={onRowHover} onPrefetchEnd={onRowHoverEnd}
                      onAction={(label, id) => openAction(label, id)} />
                  ))
                  : <tr><td colSpan={TABLE_COLS.length}><div class="em-empty">No employees match these filters.</div></td></tr>}
            </tbody>
          </table>
        </div>

        <div class="pagination">
          <div>{filtered.length
            ? `Showing ${start + 1} to ${Math.min(start + pageSize, filtered.length)} of ${filtered.length} results`
            : 'No results'}</div>
          <div class="pages">
            <button class="page-btn" type="button" disabled={curPage <= 1} onClick={() => setPage(curPage - 1)}>‹</button>
            {pageWindow(curPage, totalPages).map(p => p === '…'
              ? <span>…</span>
              : <button type="button" class={`page-btn ${p === curPage ? 'active' : ''}`} onClick={() => setPage(p)}>{p}</button>)}
            <button class="page-btn" type="button" disabled={curPage >= totalPages} onClick={() => setPage(curPage + 1)}>›</button>
          </div>
          <div class="rows-select">Rows per page:
            <select value={String(pageSize)} onChange={e => { setPageSize(Number(e.currentTarget.value)); setPage(1); }}>
              <option value="25">25</option><option value="50">50</option><option value="100">100</option>
            </select>
          </div>
        </div>
      </div>
  );
  const localWidgets: LocalWidgetMap = {
    'hr.employees.register': { render: renderRegister, chrome: 'none', title: 'Employee Register' },
  };

  return (
    <>
      {/* Navy top bar (search + profile), full width; the page title + subtext sit in a
          heading BELOW it, left-aligned. */}
      <AppTopBar />
      <div class="hr-emp-master" onClick={() => setOpenId(null)}>
      <div class="em-pagehead">
        <span class="em-headrow-icon"><i class="fas fa-users" aria-hidden="true" /></span>
        <div class="em-headrow-text">
          <div class="em-headrow-name">Employee Master</div>
          <div class="em-headrow-sub">Central register of every employee — roles, records, and readiness.</div>
        </div>
      </div>

      {/* Board Customize control (top-right) — Customize → Widget Library / Reset / Set as
          default / Done. Only managers/admins/superadmins may customize. */}
      {canEdit && (
        <WidgetBoardToolbar
          editing={editing} canSetDefault={isAdmin}
          onToggleEdit={() => setEditing(e => !e)}
          onOpenLibrary={() => setLibOpen(true)}
          onReset={() => void resetLayout()}
          onSetDefault={() => void setAsDefault()}
        />
      )}

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
        preview={preview} onPreviewChange={setPreview}
        onCommitPreview={commitPreview} onDiscardPreview={discardPreview} />

      <WidgetLibraryModal open={libOpen} pageKey={PAGE_KEY} zoneId="main"
        placedWidgetIds={placedWidgetIds} userPermissions={userPermissions}
        demo={demo} onToggleDemo={() => setDemo(d => !d)}
        canManagePackages={isAdmin}
        onClose={() => setLibOpen(false)}
        onAddWidget={inst => addWidget('main', placeBottom(inst as WidgetInstance))}
        onPreviewOnBoard={p => setPreview(placeBottom(p))} />

      {/* Profile drawer */}
      <ProfileDrawer employeeId={selectedId} onClose={() => setSelectedId(null)} onAction={(label) => openAction(label, selectedId)} />

      {/* Modals */}
      {modal?.type === 'create'   && <CreateEmployeeWizard onClose={() => setModal(null)} onToast={notify} />}
      {modal?.type === 'import'   && <ImportWizard onClose={() => setModal(null)} onToast={notify} />}
      {modal?.type === 'onboarding' && <OnboardingWizard onClose={() => setModal(null)} onToast={notify} employeeId={modal.employeeId} />}
      {modal?.type === 'contact'  && modal.employeeId && <ContactDialog      employeeId={modal.employeeId} onClose={() => setModal(null)} onToast={notify} />}
      {modal?.type === 'status'   && modal.employeeId && <StatusDialog       employeeId={modal.employeeId} onClose={() => setModal(null)} onToast={notify} />}
      {modal?.type === 'offboard' && modal.employeeId && <OffboardingDialog  employeeId={modal.employeeId} onClose={() => setModal(null)} onToast={notify} />}
      {modal?.type === 'change'   && modal.employeeId && <ChangeRequestDialog employeeId={modal.employeeId} onClose={() => setModal(null)} onToast={notify} />}
      {modal?.type === 'document' && modal.employeeId && <DocumentDialog      employeeId={modal.employeeId} onClose={() => setModal(null)} onToast={notify} />}
      {modal?.type === 'statutory' && modal.employeeId && <StatutoryDialog     employeeId={modal.employeeId} onClose={() => setModal(null)} onToast={notify} />}

      {/* Toast */}
      <div class={`toast ${toast ? 'show' : ''}`}>{toast}</div>
      </div>
    </>
  );
}
