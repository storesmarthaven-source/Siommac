/**
 * src/components/sections/HR/OnboardingOverview.tsx
 *
 * HR ▸ Onboarding — the management page, built on the SAME stack-grid base as Employee Master:
 * a customizable widget board (KPI widgets from the registry + a page-local Cases table) with the
 * Customize control (Widget Library / Reset / Set as default / Done). The 4 onboarding KPIs live in
 * registry.hrOnboarding.tsx (real dashboard-stats); the Cases table is a PAGE-LOCAL widget so it can
 * close over the page's search / status / pagination state (like the employee register).
 *
 * Wiring is real: KPIs ← useOnboardingDashboard; cases ← useOnboardingCases (server-side paging).
 * Clicking a case row opens the full case-detail workspace (OnboardingCaseDetail).
 */

import { type VNode } from 'preact';
import { useEffect, useMemo, useState } from 'preact/hooks';
import { TableSkeleton } from '@ui';
import { can } from '@lib/permissions';
import { useOnboardingCases, useOnboardingPackages } from '@api/hr/onboarding';
import type {
  OnboardingCaseStatus, OnboardingCaseRow, DueState, BlockingState, ReadinessState,
} from '../../../../types/hrOnboarding';
import { OnboardingCommandCenter } from './OnboardingCommandCenter';
import type { OnboardingSurface as CommandCenterSurface, OnboardingSurfaceFilters } from './OnboardingCommandCenter.helpers';
import { OnboardingWizard } from './OnboardingWizard';
import { OnboardingCaseDetail } from './OnboardingCaseDetail';
import { OnboardingPackageManager } from './OnboardingPackageManager';
import { OnboardingPackageDetail } from './OnboardingPackageDetail';
import { OnboardingTasksWorkspace } from './OnboardingTasksWorkspace';
import { OnboardingHandoffsWorkspace } from './OnboardingHandoffsWorkspace';
import { OnboardingBlockedBoard } from './OnboardingBlockedBoard';
import { OnboardingReportsWorkspace } from './OnboardingReportsWorkspace';
import { caseStatusPill, pillClass, humanize, CASE_STATUS_OPTIONS, fmtDate } from './onboardingStatus';
import { Avatar } from './shared';
import './HR.css';

const CASE_COLS = ['Employee', 'Package', 'Owner', 'Due Date', 'Progress', 'Blockers', 'Status'];

// Numbered pagination window (same behaviour as the Employee Master register).
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

// ── advanced filter (mirrors the Employee Master tabbed advanced filter) ─────────
function toggleVal(arr: string[], v: string): string[] {
  return arr.includes(v) ? arr.filter(x => x !== v) : [...arr, v];
}
const OB_ADV_TABS = ['Package', 'Worker Type', 'Status'] as const;
type ObAdvTab = typeof OB_ADV_TABS[number];
const DUE_OPTS:   { v: DueState;        label: string }[] = [
  { v: 'overdue', label: 'Overdue' }, { v: 'due_today', label: 'Due Today' }, { v: 'due_this_week', label: 'Due This Week' },
];
const BLOCK_OPTS: { v: BlockingState;   label: string }[] = [
  { v: 'blocked', label: 'Blocked' }, { v: 'not_blocked', label: 'Not Blocked' },
];
const READY_OPTS: { v: ReadinessState;  label: string }[] = [
  { v: 'ready', label: 'Ready for Activation' }, { v: 'not_ready', label: 'Not Ready' },
];

interface ObAdvProps {
  packages: { key: string; label: string }[];
  workerTypeOptions: string[];
  pkgKeys: string[]; onPkg: (v: string[]) => void;
  workerTypes: string[]; onWorker: (v: string[]) => void;
  dueState: DueState; onDue: (v: DueState) => void;
  blockingState: BlockingState; onBlocking: (v: BlockingState) => void;
  readinessState: ReadinessState; onReadiness: (v: ReadinessState) => void;
  onReset: () => void;
}

function ObAdvancedFilters(p: ObAdvProps): VNode {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<ObAdvTab>('Package');
  const count = p.pkgKeys.length + p.workerTypes.length
    + (p.dueState !== 'all' ? 1 : 0) + (p.blockingState !== 'all' ? 1 : 0) + (p.readinessState !== 'all' ? 1 : 0);
  const section = (title: string, sel: string, body: VNode): VNode => (
    <div class="advanced-section">
      <div class="advanced-section-title"><strong>{title}</strong><span>{sel}</span></div>
      <div class="compact-checks">{body}</div>
    </div>
  );
  const checkRow = (label: string, active: boolean, onClick: () => void): VNode => (
    <button type="button" class={`check-row ${active ? 'active' : ''}`} onClick={e => { e.stopPropagation(); onClick(); }}>
      <span class="check-box">{active ? '✓' : ''}</span><span>{label}</span>
    </button>
  );
  return (
    <div class="dropdown-wrap" onClick={e => e.stopPropagation()}>
      <button type="button" class="advanced-filter-btn" onClick={() => setOpen(o => !o)}>
        <span class="left">
          <span class="sliders">≡</span>
          <span><small>Advanced</small><strong>{count ? `${count} filters active` : 'Advanced filters'}</strong></span>
        </span>
        <span class="adv-right">
          {count ? <span class="advanced-count">{count}</span> : null}
          <span class="adv-caret"><i class="fas fa-chevron-down" aria-hidden="true" /></span>
        </span>
      </button>
      {open && (
        <>
          <div class="onb-adv-overlay" onClick={() => setOpen(false)} />
          <div class="dropdown-menu advanced-menu right" onClick={e => e.stopPropagation()}>
            <div class="dropdown-head"><strong>Advanced Filters</strong><span>Filters backed by real onboarding case data.</span></div>
            <div class="advanced-panel tabbed">
              <div class="advanced-tabs">
                {OB_ADV_TABS.map(name => (
                  <button type="button" class={`advanced-tab ${tab === name ? 'active' : ''}`} onClick={() => setTab(name)}>{name}</button>
                ))}
              </div>
              <div class="advanced-tab-body">
                {tab === 'Package' && (
                  <div>
                    <div class="advanced-tab-title">
                      <div><strong>Package filters</strong><span>Filter by onboarding package.</span></div>
                      <span class="setting-pill">Multi-select</span>
                    </div>
                    <div class="filter-tab-grid">
                      {section('Package', p.pkgKeys.length ? `${p.pkgKeys.length} selected` : 'All',
                        <>{p.packages.length
                          ? p.packages.map(pk => checkRow(pk.label, p.pkgKeys.includes(pk.key), () => p.onPkg(toggleVal(p.pkgKeys, pk.key))))
                          : <div class="em-empty">No packages</div>}</>)}
                    </div>
                  </div>
                )}
                {tab === 'Worker Type' && (
                  <div>
                    <div class="advanced-tab-title">
                      <div><strong>Worker type filters</strong><span>Filter by worker / employment type.</span></div>
                      <span class="setting-pill">Multi-select</span>
                    </div>
                    <div class="filter-tab-grid">
                      {section('Worker Type', p.workerTypes.length ? `${p.workerTypes.length} selected` : 'All',
                        <>{p.workerTypeOptions.length
                          ? p.workerTypeOptions.map(w => checkRow(humanize(w), p.workerTypes.includes(w), () => p.onWorker(toggleVal(p.workerTypes, w))))
                          : <div class="em-empty">No worker types</div>}</>)}
                    </div>
                  </div>
                )}
                {tab === 'Status' && (
                  <div>
                    <div class="advanced-tab-title">
                      <div><strong>Status filters</strong><span>Filter by due, blocking and readiness state.</span></div>
                      <span class="setting-pill">Single-select</span>
                    </div>
                    <div class="filter-tab-grid">
                      {section('Due', p.dueState !== 'all' ? '1' : 'All',
                        <>{DUE_OPTS.map(o => checkRow(o.label, p.dueState === o.v, () => p.onDue(p.dueState === o.v ? 'all' : o.v)))}</>)}
                      {section('Blocking', p.blockingState !== 'all' ? '1' : 'All',
                        <>{BLOCK_OPTS.map(o => checkRow(o.label, p.blockingState === o.v, () => p.onBlocking(p.blockingState === o.v ? 'all' : o.v)))}</>)}
                      {section('Readiness', p.readinessState !== 'all' ? '1' : 'All',
                        <>{READY_OPTS.map(o => checkRow(o.label, p.readinessState === o.v, () => p.onReadiness(p.readinessState === o.v ? 'all' : o.v)))}</>)}
                    </div>
                  </div>
                )}
              </div>
              <div class="advanced-footer">
                <button class="secondary-btn" type="button" onClick={p.onReset}>Reset Advanced</button>
                <button class="primary-btn" type="button" onClick={() => setOpen(false)}>Apply Filters</button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// Full-page drill-in surfaces under HR ▸ Onboarding. Case Detail and Package Detail
// carry their own data state (selectedCase / openPackageKey) on top of this.
type OnboardingSurface = 'overview' | 'packages' | 'tasks' | 'handoffs' | 'blocked' | 'reports';

export function OnboardingOverview({ initialCaseId = null }: { initialCaseId?: string | null } = {}): VNode {
  const [toast, setToast] = useState('');
  const [wizardOpen, setWizardOpen] = useState(false);
  const [surface, setSurface] = useState<OnboardingSurface>('overview');
  const [selectedCase, setSelectedCase] = useState<OnboardingCaseRow | null>(null);
  const [openPackageKey, setOpenPackageKey] = useState<string | null>(null);
  // Open-case-by-id: used by the Profile Drawer deep-link (initialCaseId prop) AND by
  // the workspaces' "Open Case" actions. The id is resolved to the same rich, computed
  // row the cases table uses, then Case Detail opens and the pending id clears (so the
  // same case can be re-opened later without a stale-guard ref).
  const [jumpCaseId, setJumpCaseId] = useState<string | null>(initialCaseId);
  useEffect(() => { if (initialCaseId) setJumpCaseId(initialCaseId); }, [initialCaseId]);
  const jumpCaseQ = useOnboardingCases({ caseIds: jumpCaseId ? [jumpCaseId] : [] }, { enabled: !!jumpCaseId });
  useEffect(() => {
    const row = jumpCaseQ.data?.rows[0];
    if (row && jumpCaseId && row.caseId === jumpCaseId) {
      setSelectedCase(row);
      setSurface('overview');
      setJumpCaseId(null);
    }
  }, [jumpCaseId, jumpCaseQ.data]);
  const openCaseById = (caseId: string): void => setJumpCaseId(caseId);
  // When this page is ALREADY mounted, the drawer's open-case event must work too —
  // the initialCaseId prop can't retrigger for a repeat of the same case id.
  useEffect(() => {
    function onOpen(e: Event): void {
      const caseId = (e as CustomEvent<{ caseId: string }>).detail?.caseId;
      if (caseId) setJumpCaseId(caseId);
    }
    window.addEventListener('siomac:hr-onboarding-open-case', onOpen);
    return () => window.removeEventListener('siomac:hr-onboarding-open-case', onOpen);
  }, []);
  // Cases table state (the page-local widget closes over these).
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<OnboardingCaseStatus | ''>('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  // Advanced filter state (all backend-honoured: packageKeys/workerTypes/due/blocking/readiness).
  const [pkgKeys, setPkgKeys] = useState<string[]>([]);
  const [workerTypes, setWorkerTypes] = useState<string[]>([]);
  const [dueState, setDueState] = useState<DueState>('all');
  const [blockingState, setBlockingState] = useState<BlockingState>('all');
  const [readinessState, setReadinessState] = useState<ReadinessState>('all');
  // Setter wrappers reset to page 1 so the user never lands on an out-of-range page.
  const setPkg     = (v: string[]) => { setPkgKeys(v); setPage(1); };
  const setWorker  = (v: string[]) => { setWorkerTypes(v); setPage(1); };
  const setDue     = (v: DueState) => { setDueState(v); setPage(1); };
  const setBlock   = (v: BlockingState) => { setBlockingState(v); setPage(1); };
  const setReady   = (v: ReadinessState) => { setReadinessState(v); setPage(1); };
  const resetAdvanced = () => { setPkgKeys([]); setWorkerTypes([]); setDueState('all'); setBlockingState('all'); setReadinessState('all'); setPage(1); };

  const pkgsQ = useOnboardingPackages();
  const packages = useMemo(() => (pkgsQ.data ?? []).map(p => ({ key: p.key, label: p.label })), [pkgsQ.data]);
  const workerTypeOptions = useMemo(
    () => Array.from(new Set((pkgsQ.data ?? []).flatMap(p => p.workerTypes))).sort(),
    [pkgsQ.data],
  );

  const casesQ = useOnboardingCases({
    query: query.trim() || undefined,
    statuses: status ? [status] : undefined,
    packageKeys: pkgKeys.length ? pkgKeys : undefined,
    workerTypes: workerTypes.length ? workerTypes : undefined,
    dueState: dueState !== 'all' ? dueState : undefined,
    blockingState: blockingState !== 'all' ? blockingState : undefined,
    readinessState: readinessState !== 'all' ? readinessState : undefined,
    page, pageSize,
    sort: { field: 'due_at', direction: 'asc' },
  });
  const result = casesQ.data;
  const rows = result?.rows ?? [];
  const total = result?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const curPage = Math.min(page, totalPages);

  function notify(message: string): void { setToast(message); window.setTimeout(() => setToast(''), 2600); }

  // Case-detail workspace — full-page drill-in. Re-resolve the row from the (live) cases query so
  // the header reflects state-machine changes after a mutation; fall back to the clicked snapshot.
  const liveSelected = selectedCase ? (rows.find(r => r.caseId === selectedCase.caseId) ?? selectedCase) : null;
  if (liveSelected) {
    return (
      <div class="hr-onboarding-overview">
        <OnboardingCaseDetail caseRow={liveSelected} onBack={() => setSelectedCase(null)} onToast={notify} />
        <div class={`toast ${toast ? 'show' : ''}`}>{toast}</div>
      </div>
    );
  }

  // Package Manager / Package Detail / Tasks Workspace — same full-page drill-in
  // pattern as Case Detail, driven by the surface enum.
  if (openPackageKey) {
    return (
      <div class="hr-onboarding-overview">
        <OnboardingPackageDetail packageKey={openPackageKey} onBack={() => setOpenPackageKey(null)} onToast={notify} />
        <div class={`toast ${toast ? 'show' : ''}`}>{toast}</div>
      </div>
    );
  }
  if (surface === 'packages') {
    return (
      <div class="hr-onboarding-overview">
        <OnboardingPackageManager onBack={() => setSurface('overview')} onOpenPackage={setOpenPackageKey} onToast={notify} />
        <div class={`toast ${toast ? 'show' : ''}`}>{toast}</div>
      </div>
    );
  }
  if (surface === 'tasks') {
    return (
      <div class="hr-onboarding-overview">
        <OnboardingTasksWorkspace onBack={() => setSurface('overview')} onOpenCase={openCaseById} onToast={notify} />
        <div class={`toast ${toast ? 'show' : ''}`}>{toast}</div>
      </div>
    );
  }
  if (surface === 'handoffs') {
    return (
      <div class="hr-onboarding-overview">
        <OnboardingHandoffsWorkspace onBack={() => setSurface('overview')} onOpenCase={openCaseById} onToast={notify} />
        <div class={`toast ${toast ? 'show' : ''}`}>{toast}</div>
      </div>
    );
  }
  if (surface === 'blocked') {
    return (
      <div class="hr-onboarding-overview">
        <OnboardingBlockedBoard onBack={() => setSurface('overview')} onOpenCase={openCaseById} onToast={notify} />
        <div class={`toast ${toast ? 'show' : ''}`}>{toast}</div>
      </div>
    );
  }
  if (surface === 'reports') {
    return (
      <div class="hr-onboarding-overview">
        <OnboardingReportsWorkspace onBack={() => setSurface('overview')} onToast={notify} />
        <div class={`toast ${toast ? 'show' : ''}`}>{toast}</div>
      </div>
    );
  }

  // Cases table — a PAGE-LOCAL widget. Wrapped in the `.hr-emp-master` scope so it reuses the
  // Employee Master register styling verbatim (toolbar, table, pagination, advanced-filter dropdown).
  const renderCases = (): VNode => {
    const advChips: { label: string; onRemove: () => void }[] = [
      ...pkgKeys.map(k => ({ label: packages.find(p => p.key === k)?.label ?? k, onRemove: () => setPkg(pkgKeys.filter(x => x !== k)) })),
      ...workerTypes.map(w => ({ label: humanize(w), onRemove: () => setWorker(workerTypes.filter(x => x !== w)) })),
      ...(dueState !== 'all' ? [{ label: DUE_OPTS.find(o => o.v === dueState)!.label, onRemove: () => setDue('all') }] : []),
      ...(blockingState !== 'all' ? [{ label: BLOCK_OPTS.find(o => o.v === blockingState)!.label, onRemove: () => setBlock('all') }] : []),
      ...(readinessState !== 'all' ? [{ label: READY_OPTS.find(o => o.v === readinessState)!.label, onRemove: () => setReady('all') }] : []),
    ];
    return (
    <div class="hr-emp-master" style={{ display: 'contents' }}>
    <div class="table-card">
      <div class="employee-toolbar compact">
        <div class="table-search">
          <span class="magnify">⌕</span>
          <input type="search" placeholder="Search employee, case no, package…"
            value={query} onInput={e => { setQuery((e.target as HTMLInputElement).value); setPage(1); }} />
        </div>
        <select class="onb-status-select" value={status} onChange={e => { setStatus((e.target as HTMLSelectElement).value as OnboardingCaseStatus | ''); setPage(1); }}>
          <option value="">All statuses</option>
          {CASE_STATUS_OPTIONS.map(s => <option key={s} value={s}>{caseStatusPill(s).label}</option>)}
        </select>
        <ObAdvancedFilters
          packages={packages} workerTypeOptions={workerTypeOptions}
          pkgKeys={pkgKeys} onPkg={setPkg}
          workerTypes={workerTypes} onWorker={setWorker}
          dueState={dueState} onDue={setDue}
          blockingState={blockingState} onBlocking={setBlock}
          readinessState={readinessState} onReadiness={setReady}
          onReset={resetAdvanced}
        />
        <button type="button" class="hse-btn" onClick={() => setSurface('tasks')}>
          <i class="fas fa-list-check" /> Tasks
        </button>
        <button type="button" class="hse-btn" onClick={() => setSurface('handoffs')}>
          <i class="fas fa-arrow-right-arrow-left" /> Handoffs
        </button>
        <button type="button" class="hse-btn" onClick={() => setSurface('blocked')}>
          <i class="fas fa-triangle-exclamation" /> Blocked
        </button>
        {can('hr.onboarding.reports.view') && (
          <button type="button" class="hse-btn" onClick={() => setSurface('reports')}>
            <i class="fas fa-chart-column" /> Reports
          </button>
        )}
        {can('hr.onboarding.packages.manage') && (
          <button type="button" class="hse-btn" onClick={() => setSurface('packages')}>
            <i class="fas fa-boxes-stacked" /> Packages
          </button>
        )}
        <button type="button" class="hse-btn accent" onClick={() => setWizardOpen(true)}>
          <i class="fas fa-circle-plus" /> New Case
        </button>
      </div>

      {advChips.length ? (
        <div class="active-filter-bar">
          <strong>Active filters:</strong>
          {advChips.map(c => <button class="chip-btn" type="button" onClick={() => c.onRemove()}>{c.label} ×</button>)}
          <button class="ghost-btn" type="button" onClick={resetAdvanced}>Clear all</button>
        </div>
      ) : null}

      <div class="table-scroll">
        <table>
          <thead><tr>{CASE_COLS.map(c => <th>{c}</th>)}</tr></thead>
          <tbody>
            {casesQ.isLoading && !casesQ.data
              ? <TableSkeleton rows={pageSize} cols={CASE_COLS.length} firstCellAvatar />
              : rows.length
                ? rows.map(r => {
                  const st = caseStatusPill(r.status);
                  return (
                    <tr key={r.caseId} class="employee-row" title="Open case detail" onClick={() => setSelectedCase(r)}>
                      <td>
                        <div class="employee-cell">
                          <Avatar name={r.employeeName ?? ''} img={r.employeePhotoUrl} />
                          <div style={{ minWidth: 0 }}>
                            <div class="emp-name">{r.employeeName ?? '—'}</div>
                            <div class="emp-email">{r.caseNo}{r.employeeNo ? ` · ${r.employeeNo}` : ''}</div>
                          </div>
                        </div>
                      </td>
                      <td>{r.packageLabel}</td>
                      <td>{r.ownerName ?? <span style={{ color: '#94a3b8' }}>Unassigned</span>}</td>
                      <td>{fmtDate(r.dueAt)}</td>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <div style={{ flex: 1, minWidth: 54, height: 6, borderRadius: 999, background: '#eef2f7', overflow: 'hidden' }}>
                            <i style={{ display: 'block', height: '100%', width: `${r.progressPercent}%`, background: '#2563eb' }} />
                          </div>
                          <b style={{ fontSize: 12, color: '#475569' }}>{r.progressPercent}%</b>
                        </div>
                      </td>
                      <td style={{ textAlign: 'center' }}>
                        {r.activeBlockers > 0
                          ? <span class="pill red">{r.activeBlockers}</span>
                          : <span style={{ color: '#94a3b8' }}>—</span>}
                      </td>
                      <td><span class={`pill ${pillClass(st)}`}>{st.label}</span></td>
                    </tr>
                  );
                })
                : <tr><td colSpan={CASE_COLS.length}><div class="em-empty">No onboarding cases match these filters.</div></td></tr>}
          </tbody>
        </table>
      </div>

      <div class="pagination">
        <div>{total
          ? `Showing ${(curPage - 1) * pageSize + 1} to ${Math.min(curPage * pageSize, total)} of ${total} results`
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
            <option value="10">10</option><option value="25">25</option><option value="50">50</option>
          </select>
        </div>
      </div>
    </div>
    </div>
    );
  };
  // Command Center's generic surface names map onto this page's surface enum; 'cases' and
  // 'activity' have no dedicated workspace — the cases table below the Command Center already
  // shows cases, so those just stay on the overview.
  function handleOpenSurface(commandSurface: CommandCenterSurface, filters?: OnboardingSurfaceFilters): void {
    if (filters?.dueState && (filters.dueState === 'due_this_week' || filters.dueState === 'overdue' || filters.dueState === 'due_today')) {
      setDue(filters.dueState as DueState);
    }
    switch (commandSurface) {
      case 'tasks': setSurface('tasks'); break;
      case 'handoffs': setSurface('handoffs'); break;
      case 'blocked': setSurface('blocked'); break;
      case 'packages': setSurface('packages'); break;
      case 'reports': setSurface('reports'); break;
      case 'cases':
      case 'activity':
      default: break;
    }
  }

  return (
    <div class="hr-onboarding-overview">
      <OnboardingCommandCenter
        onOpenSurface={handleOpenSurface}
        onOpenCase={openCaseById}
        onNewCase={() => setWizardOpen(true)}
        onToast={notify}
      />

      {renderCases()}

      {wizardOpen && <OnboardingWizard employeeId={null} onClose={() => setWizardOpen(false)} onToast={notify} />}

      <div class={`toast ${toast ? 'show' : ''}`}>{toast}</div>
    </div>
  );
}
