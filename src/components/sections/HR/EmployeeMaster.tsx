/**
 * HR Employee Master workspace.
 *
 * The register is a page-local board widget so it retains server-backed search,
 * filters, sorting, pagination, profile selection, and capability-gated actions.
 * Business data always comes through authenticated HR API hooks.
 */

import { Fragment, type VNode } from 'preact';
import { useEffect, useLayoutEffect, useMemo, useState, useRef } from 'preact/hooks';
import {
  useHrEmployeesPage, usePrefetchHrEmployee,
  type HrEmployeeRow, type TrainingStatus, type EmployeeSortCol, type EmployeeMissingField,
} from '@api/hr/employees';
import {
  humanize, rowName, statusTone, TRAINING_TONE, TRAINING_LABEL, Avatar, TinyAvatar,
} from './shared';
import { ProfileDrawer } from './ProfileDrawer';
import { HR_EMPLOYEE_DEEPLINK_KEY } from './hrDeepLink';
import { EmployeeCreatePage } from './EmployeeCreatePage';
import { ContactDialog, StatusDialog, OffboardingDialog, ChangeRequestDialog, DocumentDialog, StatutoryDialog } from './ActionDialogs';
import { ImportWizard } from './ImportWizard';
import { StartOnboardingWizard } from './StartOnboardingWizard';
import { TableSkeleton, Button, EmptyState, LucideIcon, PageHeader, Pagination } from '@ui';
import {
  WidgetBoard, WidgetBoardToolbar, WidgetLibraryModal, useBoardLayout, WIDGET_REGISTRY, commitPreviewWidget, insertWidgetsAtRow,
  type BoardLayout, type LocalWidgetMap, type PreviewWidgetInstance, type WidgetInstance, type WidgetSizeDef, type WidgetSizeKey,
} from '@ui/widgets';
import { TableSearch, FilterDropdown, AdvancedFilter, ActiveFilters, useFilterDropdowns, FILTER_DROPDOWN_ATTR, type AdvTab } from '@ui';
import { readinessFillStyle } from './readinessScale';
import { can } from '@lib/permissions';
import { dialog } from '@lib/dialog';
import { toast } from '@store';
import { useSessionStore, selectIsManager, selectIsAdmin, selectUserId } from '@store/session';
import { HRQueryNotice } from './HRQueryState';
import {
  hasEmployeeCreationAction, resolveEmployeeMasterAccess,
  type EmployeeMasterAccess,
} from './employeeMasterAccess';
import { employeeRowActions } from './employeeRowActions';
import { employeeRegisterEmptyCopy, employeeRegisterSummary } from './employeeRegisterPresentation';
import { getUiPreference, saveUiPreference } from '@api/uiPreferences';
import { EMPLOYEE_REGISTER_COLUMNS_PREFERENCE_KEY } from '../../../../types/uiPreferences';
import {
  DEFAULT_EMPLOYEE_REGISTER_COLUMNS, EMPLOYEE_REGISTER_COLUMNS,
  employeeRegisterTableMinWidth, readEmployeeRegisterColumns, sanitizeEmployeeRegisterColumns,
  writeEmployeeRegisterColumns, type EmployeeRegisterColumnKey,
} from './employeeRegisterColumns';
import {
  EMPLOYEE_REGISTER_VIEWS_PREFERENCE_KEY,
  sanitizeEmployeeRegisterViews,
  type EmployeeRegisterView,
} from './employeeRegisterViews';
import './HR.css';

const PAGE_KEY = 'hr.employees.overview.v3';
const KPI_PAGE_KEY = 'hr.employees.overview.kpis.v2';
const EMPLOYEE_BOARD_COLUMNS = 24;

// ── toolbar ────────────────────────────────────────────────────────────────────

// `department` holds department IDs (server-authoritative), not display names —
// labels are resolved via the `meta.departments` id→name map returned by the list endpoint.
interface Filters { query: string; status: string[]; department: string[]; employmentType: string[]; training: string[]; missing: EmployeeMissingField[]; }
const EMPTY_FILTERS: Filters = { query: '', status: [], department: [], employmentType: [], training: [], missing: [] };
const MISSING_LABEL: Record<EmployeeMissingField, string> = {
  supervisor: 'Missing Supervisor', department: 'Missing Department', site: 'Missing Site',
};
/** KPI cards live inside the widget board, outside this component's tree, so they ask for a
 *  filter by event rather than through props. Applying a filter beats navigating away: the
 *  number you clicked and the rows you land on are then provably the same set. */
export const REGISTER_FILTER_EVENT = 'siomac:employee-register-filter';
export type RegisterFilterPatch = Partial<Pick<Filters, 'status' | 'training' | 'missing'>>;

// ── register table ─────────────────────────────────────────────────────────────

/** The row ⋮ menu: state-aware actions (employeeRowActions), a real keyboard menu, and a
 *  flip-up when the row sits near the bottom of the register's scroll area. */
function EmployeeRowMenu(
  { emp, name, menuId, isOpen, setOpenId, access, onSelect, onAction }:
  { emp: HrEmployeeRow; name: string; menuId: string; isOpen: boolean;
    setOpenId: (v: string | null) => void; access: EmployeeMasterAccess;
    onSelect: (id: string) => void; onAction: (label: string, id: string) => void },
): VNode {
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [dropUp, setDropUp] = useState(false);
  const actions = employeeRowActions(emp, access);

  const items = (): HTMLElement[] =>
    Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);

  // On open: flip the menu above the trigger when the row is too close to the bottom of the
  // table's scroll area (otherwise it hangs off the widget), then move focus into the menu.
  useLayoutEffect(() => {
    if (!isOpen) { setDropUp(false); return; }
    const trigger = triggerRef.current, menu = menuRef.current;
    if (!trigger || !menu) return;
    const scroller = trigger.closest('.table-scroll')?.getBoundingClientRect();
    const rect = trigger.getBoundingClientRect();
    const needed = menu.offsetHeight + 8;
    const below = Math.min(scroller?.bottom ?? window.innerHeight, window.innerHeight);
    const above = Math.max(scroller?.top ?? 0, 0);
    setDropUp(rect.bottom + needed > below && rect.top - needed > above);
    items()[0]?.focus();

  }, [isOpen]);

  const close = (restoreFocus: boolean): void => {
    setOpenId(null);
    if (restoreFocus) triggerRef.current?.focus();
  };

  // Full menu keyboard behaviour. Every key is stopped here so it never reaches the row's own
  // Enter/Space "open profile" handler.
  const onMenuKeyDown = (e: KeyboardEvent): void => {
    const list = items();
    const current = list.findIndex(el => el === document.activeElement);
    const focusAt = (i: number): void => { e.preventDefault(); list[(i + list.length) % list.length]?.focus(); };
    switch (e.key) {
      case 'ArrowDown': focusAt(current + 1); break;
      case 'ArrowUp':   focusAt(current - 1); break;
      case 'Home':      focusAt(0); break;
      case 'End':       focusAt(list.length - 1); break;
      case 'Escape':    e.preventDefault(); close(true); break;
      case 'Tab':       close(false); return; // let focus move on naturally
      default: break;
    }
    e.stopPropagation();
  };

  return (
    <div class="dropdown-wrap" {...{ [FILTER_DROPDOWN_ATTR]: menuId }}>
      <button ref={triggerRef} type="button" class="kebab-btn" aria-label={`Actions for ${name}`}
        aria-haspopup="menu" aria-expanded={isOpen}
        onClick={e => { e.stopPropagation(); setOpenId(isOpen ? null : menuId); }}
        onKeyDown={e => { e.stopPropagation(); }}><LucideIcon name="MoreHorizontal" size={18} /></button>
      {isOpen && (
        <div ref={menuRef} class={`dropdown-menu right ${dropUp ? 'up' : ''}`} role="menu"
          aria-label={`Actions for ${name}`} onKeyDown={onMenuKeyDown}>
          <div class="dropdown-list">
            {actions.map(action => (
              <Fragment key={action.label}>
                {action.separatorBefore && <div class="menu-sep" role="separator" />}
                <button type="button" role="menuitem" class={`menu-row ${action.danger ? 'danger' : ''}`}
                  onClick={() => {
                    if (action.label === 'View Profile') onSelect(emp.id);
                    else onAction(action.label, emp.id);
                    close(false);
                  }}>
                  <span class="menu-ico" aria-hidden="true"><LucideIcon name={action.icon} size={15} /></span>{action.label}
                </button>
              </Fragment>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

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
      {visibleColumns.includes('readiness') && <td data-column="readiness">
        {emp.readiness ? <div class="em-readiness" aria-label={`${emp.readiness.percent}% ready${emp.readiness.blockers.length ? `; blockers: ${emp.readiness.blockers.join(', ')}` : ''}`}>
          <div><span>Record readiness</span><strong>{emp.readiness.percent}%</strong></div>
          {/* One percentage-derived colour per bar (see readinessScale) — never the whole
              red→amber→green ramp, which would give a low score a green tail. */}
          <i aria-hidden="true"><b style={readinessFillStyle(emp.readiness.percent)} /></i>
        </div> : <span class="em-readiness-restricted">Restricted</span>}
      </td>}
      {visibleColumns.includes('trainingStatus') && <td data-column="trainingStatus"><span class={`pill ${TRAINING_TONE[emp.trainingStatus]}`}>{TRAINING_LABEL[emp.trainingStatus]}</span></td>}
      {visibleColumns.includes('actions') && <td data-column="actions" class="kebab" onClick={e => e.stopPropagation()}>
        <EmployeeRowMenu emp={emp} name={name} menuId={kebabId} isOpen={isOpen} setOpenId={setOpenId}
          access={access} onSelect={onSelect} onAction={onAction} />
      </td>}
    </tr>
  );
}

// ── default board layout (fresh user): 4 KPIs + the register, full width ────────

function defInst(widgetId: string, x: number, y: number, w: number, h: number, sizeKey: WidgetSizeKey, pageKey = PAGE_KEY): WidgetInstance {
  return { instanceId: `${widgetId}#def`, widgetId, pageKey, zoneId: 'main', x, y, w, h, sizeKey, config: {} };
}
export function defaultEmployeeKpiLayout(): BoardLayout {
  return {
    pageKey: KPI_PAGE_KEY,
    columns: EMPLOYEE_BOARD_COLUMNS,
    zones: {
      main: [
        defInst('hr.employeeMaster.activeWorkforce', 0, 0, 4, 6, 'compact', KPI_PAGE_KEY),
        defInst('hr.employeeMaster.recordReadiness', 4, 0, 4, 6, 'compact', KPI_PAGE_KEY),
        defInst('hr.employeeMaster.hrWorkQueue', 8, 0, 4, 6, 'compact', KPI_PAGE_KEY),
        defInst('hr.employeeMaster.exceptions', 12, 0, 4, 6, 'compact', KPI_PAGE_KEY),
        defInst('hr.employeeMaster.newStarters', 16, 0, 4, 6, 'compact', KPI_PAGE_KEY),
        defInst('hr.employeeMaster.departures', 20, 0, 4, 6, 'compact', KPI_PAGE_KEY),
      ],
    },
  };
}
// Fresh users receive the production overview plus the page-local employee register.
export function defaultEmployeeLayout(): BoardLayout {
  return {
    pageKey: PAGE_KEY,
    columns: EMPLOYEE_BOARD_COLUMNS,
    zones: {
      main: [
        // Rows are Statutory-parity units: cellHeight 6 + a 12px gap, so a tile is
        // 18h − 12 px tall and the resize handle snaps every 18px. Two chart columns,
        // then lifecycle + deadlines + workload, then the full-width register.
        // `lifecycleMovement` and `masterDataWorkload` were retired in favour of their
        // near-identical survivors (`lifecycleActivity`, `adminWorkload` — same titles), and the
        // two workforce charts were retired outright, so the top row closes up.
        defInst('hr.employeeMaster.lifecycleActivity', 0, 0, 12, 28, 'wide'),         // 492px
        defInst('enterprise.calendar.upcomingDeadlines', 12, 0, 6, 28, 'standard'),
        defInst('hr.employeeMaster.adminWorkload', 18, 0, 6, 28, 'large'),
        defInst('hr.employees.register', 0, 28, EMPLOYEE_BOARD_COLUMNS, 50, 'hero'),  // 888px
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
  const [savedViews, setSavedViews] = useState<EmployeeRegisterView[]>([]);
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
  useEffect(() => {
    setSavedViews([]);
    if (!userId) return;
    let alive = true;
    void getUiPreference<EmployeeRegisterView[]>(EMPLOYEE_REGISTER_VIEWS_PREFERENCE_KEY)
      .then(preference => {
        if (alive) setSavedViews(sanitizeEmployeeRegisterViews(preference?.value));
      })
      .catch((error: unknown) => {
        console.warn('[ui-preferences] Could not load employee register views:', error);
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

  // Deep-link: another module (e.g. the payroll exceptions queue's affected-employee
  // Subject) can request a specific profile. Consume the one-shot hint on mount.
  useEffect(() => {
    let pending: string | null = null;
    try { pending = sessionStorage.getItem(HR_EMPLOYEE_DEEPLINK_KEY); sessionStorage.removeItem(HR_EMPLOYEE_DEEPLINK_KEY); } catch { /* ignore */ }
    if (pending) setSelectedId(pending);
  }, []);

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
    missing: filters.missing.length ? filters.missing : undefined,
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
  const {
    layout, updateZoneLayout, saveLayout, cancelLayout, setAsDefault, resetLayout,
    isDefaultDirty, isDirty, isSaving,
  } = useBoardLayout(PAGE_KEY, defaultEmployeeLayout(), EMPLOYEE_BOARD_COLUMNS);
  const kpiBoard = useBoardLayout(KPI_PAGE_KEY, defaultEmployeeKpiLayout(), EMPLOYEE_BOARD_COLUMNS);
  const pageDefaultDirty = isDefaultDirty || kpiBoard.isDefaultDirty;
  const pageDirty = isDirty || kpiBoard.isDirty;
  const pageSaving = isSaving || kpiBoard.isSaving;
  const boardItems = layout.zones.main ?? [];
  const placedWidgetIds = boardItems.map(w => w.widgetId);
  const WIDGET_SECTION_START_ROW = 0;
  // New widgets enter the editable widget section, below the independent fixed KPI row.
  const placeInWidgetSection = <T extends { x: number; y: number }>(w: T): T => ({ ...w, x: 0, y: WIDGET_SECTION_START_ROW });
  const userPermissions = useMemo(
    () => Array.from(new Set(WIDGET_REGISTRY.flatMap(w => w.dataSource.permissions))).filter(can),
    [],
  );
  function discardPreview(): void {
    setPreview(null);
    setLibOpen(true); // undecided → back to the library
  }
  function commitPreview(p: PreviewWidgetInstance): void {
    void updateZoneLayout(p.zoneId, insertWidgetsAtRow(boardItems, [commitPreviewWidget(p)], WIDGET_SECTION_START_ROW));
    setPreview(null);
  }
  const savePageLayout = async (): Promise<boolean> => {
    const saved = await Promise.all([saveLayout(), kpiBoard.saveLayout()]);
    return saved.every(Boolean);
  };
  const cancelPageLayout = async (): Promise<void> => {
    await Promise.all([cancelLayout(), kpiBoard.cancelLayout()]);
  };
  const resetPageLayout = (): void => {
    void resetLayout();
    void kpiBoard.resetLayout();
  };
  const setPageAsDefault = async (): Promise<void> => {
    if (isDefaultDirty) await setAsDefault();
    if (kpiBoard.isDefaultDirty) await kpiBoard.setAsDefault();
  };

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
    // Register-row labels and the profile drawer's older labels both resolve here.
    const map: Record<string, string> = {
      'Edit Contact': 'contact', 'Edit Contact Details': 'contact',
      'Request Change': 'change',
      'Change Status': 'status', 'Update Employment Status': 'status',
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

  // KPI cards ask for a register filter by event (they render inside the widget board, outside
  // this tree). Replace rather than merge the filtered dimensions, so clicking a second KPI
  // gives that KPI's set instead of an accumulated intersection nobody asked for.
  useEffect(() => {
    const onFilterRequest = (event: Event): void => {
      const patch = (event as CustomEvent<RegisterFilterPatch>).detail;
      setSearchDraft('');
      setFilters({ ...EMPTY_FILTERS, ...patch });
      setPage(1);
    };
    window.addEventListener(REGISTER_FILTER_EVENT, onFilterRequest);
    return () => window.removeEventListener(REGISTER_FILTER_EVENT, onFilterRequest);
  }, []);

  const chipDefs: { label: string; onRemove: () => void }[] = [
    ...(filters.query ? [{ label: `Search: ${filters.query}`, onRemove: () => { setSearchDraft(''); setFiltersReset({ ...filters, query: '' }); } }] : []),
    ...filters.status.map(s => ({ label: humanize(s), onRemove: () => setFiltersReset({ ...filters, status: filters.status.filter(x => x !== s) }) })),
    ...filters.department.map(s => ({ label: deptLabelFn(s), onRemove: () => setFiltersReset({ ...filters, department: filters.department.filter(x => x !== s) }) })),
    ...filters.employmentType.map(s => ({ label: humanize(s), onRemove: () => setFiltersReset({ ...filters, employmentType: filters.employmentType.filter(x => x !== s) }) })),
    ...filters.training.map(s => ({ label: (TRAINING_LABEL as Record<string, string | undefined>)[s] ?? humanize(s), onRemove: () => setFiltersReset({ ...filters, training: filters.training.filter(x => x !== s) }) })),
    ...filters.missing.map(s => ({ label: MISSING_LABEL[s], onRemove: () => setFiltersReset({ ...filters, missing: filters.missing.filter(x => x !== s) }) })),
  ];
  const hasActiveFilters = chipDefs.length > 0;
  const emptyRegisterCopy = employeeRegisterEmptyCopy(hasActiveFilters);

  const trainingLabel = (t: string): string => (TRAINING_LABEL as Record<string, string | undefined>)[t] ?? humanize(t);
  // Filters panel tabs (Organization / Employment / Compliance), backed by real meta lists.
  // Status is deliberately absent: it is the dedicated toolbar quick filter, and duplicating it
  // here would give two controls for one piece of state.
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

  const applySavedView = (view: EmployeeRegisterView): void => {
    setSearchDraft(view.filters.query);
    // Spread over EMPTY_FILTERS: a saved view carries only the filters it was saved with, so
    // anything it omits (e.g. a KPI-applied `missing` filter) must clear rather than persist.
    // Deliberately NOT widening the persisted view shape — that contract is already on disk.
    setFilters({ ...EMPTY_FILTERS, ...view.filters });
    setSortBy(view.sortBy);
    setSortDir(view.sortDir);
    setPageSize(view.pageSize);
    setPage(1);
    setColumns(view.columns);
    setOpenId(null);
  };
  const persistViews = async (views: EmployeeRegisterView[]): Promise<void> => {
    if (!userId) return;
    const sanitized = sanitizeEmployeeRegisterViews(views);
    await saveUiPreference(EMPLOYEE_REGISTER_VIEWS_PREFERENCE_KEY, sanitized);
    setSavedViews(sanitized);
  };
  const saveCurrentView = async (): Promise<void> => {
    const requested = await dialog.prompt({
      title: 'Save employee register view',
      text: 'Save the current filters, sorting, page size, and visible columns.',
      placeholder: 'View name',
      confirmText: 'Save View',
    });
    const name = requested?.trim().slice(0, 48);
    if (!name) return;
    const existing = savedViews.find(view => view.name.toLocaleLowerCase() === name.toLocaleLowerCase());
    const view: EmployeeRegisterView = {
      id: existing?.id ?? crypto.randomUUID(),
      name,
      filters,
      sortBy,
      sortDir,
      pageSize,
      columns: visibleColumnKeys,
    };
    try {
      await persistViews(existing ? savedViews.map(item => item.id === existing.id ? view : item) : [...savedViews, view]);
      toast.success(existing ? 'Register view updated.' : 'Register view saved.');
      setOpenId(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Register view could not be saved.');
    }
  };
  const deleteSavedView = async (view: EmployeeRegisterView): Promise<void> => {
    if (!await dialog.confirm({ title: `Delete “${view.name}”?`, text: 'This removes the saved view for your account.', danger: true, confirmText: 'Delete View' })) return;
    try {
      await persistViews(savedViews.filter(item => item.id !== view.id));
      toast.success('Register view deleted.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Register view could not be deleted.');
    }
  };

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
            placeholder="Search name, email, employee no. or position" ariaLabel="Search employees" />
          <FilterDropdown id="status-filter" label="Status" options={statusOptions} selected={filters.status}
            onChange={v => setFiltersReset({ ...filters, status: v })} openId={openId} setOpenId={setOpenId} labelFn={humanize} />
          {/* Same panel design as before — only the wording changes: the trigger reads "Filters"
              (the duplicate "Advanced" kicker is gone), and since every selection already applies
              on click the confirm button is an honest "Done", not "Apply Filters". */}
          <AdvancedFilter id="advanced-filters" tabs={advTabs} onReset={clearAdvanced} openId={openId} setOpenId={setOpenId}
            kicker={null} title="Filters" resetLabel="Reset Filters" doneLabel="Done" />
          <div class="tf-wrap em-views-wrap" {...{ [FILTER_DROPDOWN_ATTR]: 'register-views' }}>
            <button type="button" class="em-column-btn" aria-haspopup="menu" aria-expanded={openId === 'register-views'}
              onClick={() => setOpenId(openId === 'register-views' ? null : 'register-views')}>
              <LucideIcon name="Bookmark" size={16} />
              <span>Saved Views</span>
              {savedViews.length ? <span class="em-column-count">{savedViews.length}</span> : null}
            </button>
            {openId === 'register-views' && <div class="tf-menu tf-right em-views-menu" role="menu" aria-label="Saved employee register views">
              <div class="tf-menu-head"><strong>Saved Views</strong><span>Reuse filters, sorting, columns, and page size.</span></div>
              <div class="tf-menu-list">
                {/* The only built-in entry. "Active employees" / "Training attention" were removed —
                    they restated the Status quick filter, the KPI drill-downs, and Filters. */}
                <button type="button" role="menuitem" class="tf-check" onClick={() => {
                  setSearchDraft(''); setFilters(EMPTY_FILTERS); setSortBy('full_name'); setSortDir('asc'); setPageSize(25); setPage(1); setColumns(DEFAULT_EMPLOYEE_REGISTER_COLUMNS); setOpenId(null);
                }}>
                  <span class="tf-checkbox" aria-hidden="true"><LucideIcon name="UsersRound" size={13} /></span><span>Default Register</span>
                </button>
                {savedViews.map(view => <div class="em-view-row" key={view.id}>
                  <button type="button" role="menuitem" onClick={() => applySavedView(view)}><LucideIcon name="Bookmark" size={13} /><span>{view.name}</span></button>
                  <button type="button" aria-label={`Delete ${view.name}`} onClick={() => void deleteSavedView(view)}><LucideIcon name="Trash2" size={13} /></button>
                </div>)}
              </div>
              <div class="tf-menu-foot"><button type="button" class="tf-apply" onClick={() => void saveCurrentView()}><LucideIcon name="Plus" size={13} /> Save Current View</button></div>
            </div>}
          </div>
          <div class="tf-wrap em-columns-wrap" {...{ [FILTER_DROPDOWN_ATTR]: 'register-columns' }}>
            <button type="button" class="em-column-btn" aria-haspopup="menu" aria-expanded={openId === 'register-columns'}
              onClick={() => setOpenId(openId === 'register-columns' ? null : 'register-columns')}>
              <LucideIcon name="Columns3" size={16} />
              <span>Columns</span>
              <span class="em-column-count">{visibleColumns.length} of {EMPLOYEE_REGISTER_COLUMNS.length}</span>
            </button>
            {openId === 'register-columns' && <div class="tf-menu tf-right em-columns-menu" role="menu" aria-label="Customize employee register columns">
              <div class="tf-menu-head"><strong>Customize Columns</strong><span>Choose the information shown in your register.</span></div>
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
              {listQ.isLoading
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
  // Page-local widgets declare a resize FLOOR the same way the Statutory board does — without
  // one `widgetMinGrid` falls back to a generic 2 cells, which on this 6px grid lets the register
  // be dragged down to a 24px sliver. w12 (half the 24-column grid) × h20 == 348px.
  const floor = (key: WidgetSizeKey, w: number, h: number): WidgetSizeDef[] =>
    [{ key, label: 'Default', grid: { w, h } }];
  const localWidgets: LocalWidgetMap = {
    'hr.employees.register': { render: renderRegister, chrome: 'none', title: 'Employee Register', allowedSizes: floor('hero', 12, 12) },
  };

  // Full-PAGE wizards — take over the whole view when launched.
  if (modal?.type === 'create') {
    return <EmployeeCreatePage onClose={() => setModal(null)} />;
  }
  if (modal?.type === 'onboarding') {
    return <StartOnboardingWizard employeeId={modal.employeeId} onBack={() => setModal(null)} />;
  }

  return (
    <>
      {/* No page-wide "click anywhere closes the open menu" handler: it double-closed panels
          whose own content did not stopPropagation. useFilterDropdowns closes on genuine
          outside clicks by containment instead — see FILTER_DROPDOWN_ATTR. */}
      <div class="hr-emp-master">
      <PageHeader
        icon={<LucideIcon name="UsersRound" size={21} />}
        module="Human Resources"
        title="Employee Master"
        sub="Manage workforce records, employment status, assignments, and employee lifecycle actions."
        actions={<div class="em-page-actions">
          {canEdit && <WidgetBoardToolbar
            editing={editing} canSetDefault={isAdmin} defaultDirty={pageDefaultDirty} finishInBanner layoutItems={boardItems}
            onToggleEdit={() => setEditing(e => !e)}
            onOpenLibrary={() => { setEditing(true); setLibOpen(true); }}
            onSaveEditing={async () => { if (await savePageLayout()) setEditing(false); }}
            onCancelEditing={async () => { await cancelPageLayout(); setEditing(false); }}
            onReset={resetPageLayout}
            onSetDefault={() => void setPageAsDefault()}
          />}
          {hasEmployeeCreationAction(access) && <div class="dropdown-wrap" {...{ [FILTER_DROPDOWN_ATTR]: 'new-menu' }}>
            <button class="em-new-btn" type="button" aria-haspopup="menu" aria-expanded={openId === 'new-menu'}
              onClick={() => setOpenId(openId === 'new-menu' ? null : 'new-menu')}>
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
      <div class="em-kpi-board">
        <WidgetBoard pageKey={KPI_PAGE_KEY} zones={['main']} editing={editing && canEdit}
          defaultLayout={defaultEmployeeKpiLayout()} column={EMPLOYEE_BOARD_COLUMNS}
          cellHeight={6} gap={[12, 12]} resizable={false} maxRows={6} isBounded revealOnMount={false} />
      </div>

      {/* Fine grid at Statutory/Command-Centre parity (cellHeight 6, gap 12 → an 18px vertical
          snap). react-grid-layout snaps to one cell, so a coarser board only resizes in big
          jumps. Every widget on this board is authored in these same 18px units — mixing in a
          coarse-unit widget (one sized for the default 88px board) renders it ~15× too short. */}
      <WidgetBoard pageKey={PAGE_KEY} zones={['main']} editing={editing && canEdit}
        localWidgets={localWidgets} defaultLayout={defaultEmployeeLayout()} demo={demo}
        column={EMPLOYEE_BOARD_COLUMNS} cellHeight={6} gap={[12, 12]}
        preview={preview} onPreviewChange={setPreview}
        onCommitPreview={commitPreview} onDiscardPreview={discardPreview}
        onFinishEditing={() => setEditing(false)}
        onSaveEditing={async () => { if (await savePageLayout()) setEditing(false); }}
        onCancelEditing={async () => { await cancelPageLayout(); setEditing(false); }}
        onOpenLibrary={() => setLibOpen(true)}
        onSetDefault={() => void setPageAsDefault()} canSetDefault={isAdmin}
        defaultDirty={pageDefaultDirty} isDirty={pageDirty} saving={pageSaving}
      />

      <WidgetLibraryModal open={libOpen} pageKey={PAGE_KEY} zoneId="main"
        placedWidgetIds={placedWidgetIds} userPermissions={userPermissions}
        demo={demo} onToggleDemo={() => setDemo(d => !d)}
        canManagePackages={isAdmin}
        onClose={() => setLibOpen(false)}
        onAddWidget={inst => updateZoneLayout('main', insertWidgetsAtRow(boardItems, [inst], WIDGET_SECTION_START_ROW))}
        onAddWidgets={instances => updateZoneLayout('main', insertWidgetsAtRow(boardItems, instances, WIDGET_SECTION_START_ROW))}
        onPreviewOnBoard={p => setPreview(placeInWidgetSection(p))} />

      {/* Profile drawer */}
      <ProfileDrawer employeeId={selectedId} onClose={() => setSelectedId(null)} onAction={(label) => openAction(label, selectedId)} access={access} />

      {/* Modals — 'create' is handled as a full-page takeover above */}
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
