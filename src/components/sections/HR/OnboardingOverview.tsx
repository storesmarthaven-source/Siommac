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
import {
  TableSkeleton,
  TableSearch, FilterDropdown, AdvancedFilter, ActiveFilters, useFilterDropdowns,
  type AdvTab,
} from '@ui';
import { can } from '@lib/permissions';
import { useOnboardingCases, useOnboardingPackages } from '@api/hr/onboarding';
import type {
  OnboardingCaseStatus, OnboardingCaseRow, DueState, BlockingState, ReadinessState,
} from '../../../../types/hrOnboarding';
import { OnboardingCommandCenter } from './OnboardingCommandCenter';
import type { OnboardingSurface as CommandCenterSurface, OnboardingSurfaceFilters } from './OnboardingCommandCenter.helpers';
import { StartOnboardingWizard } from './StartOnboardingWizard';
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

// Label maps for the single-select advanced-filter sections (due / blocking / readiness).
// The AdvancedFilter checklist section is multi-select by default, so these sections use a
// "take the last item" onChange handler to behave like radio buttons.
const DUE_LABEL: Record<string, string> = {
  overdue: 'Overdue', due_today: 'Due Today', due_this_week: 'Due This Week',
};
const BLOCK_LABEL: Record<string, string> = {
  blocked: 'Blocked', not_blocked: 'Not Blocked',
};
const READY_LABEL: Record<string, string> = {
  ready: 'Ready for Activation', not_ready: 'Not Ready',
};

// Full-page drill-in surfaces under HR ▸ Onboarding. Case Detail and Package Detail
// carry their own data state (selectedCase / openPackageKey) on top of this.
type OnboardingSurface = 'overview' | 'packages' | 'tasks' | 'handoffs' | 'blocked' | 'reports' | 'start';

export function OnboardingOverview({ initialCaseId = null }: { initialCaseId?: string | null } = {}): VNode {
  const [toast, setToast] = useState('');
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
  // Status is now multi-select (mirrors Employee Master pattern) — the FilterDropdown
  // manages a string[] and the query maps it to statuses: string[] | undefined.
  const [status, setStatus] = useState<string[]>([]);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  // Advanced filter state (all backend-honoured: packageKeys/workerTypes/due/blocking/readiness).
  const [pkgKeys, setPkgKeys] = useState<string[]>([]);
  const [workerTypes, setWorkerTypes] = useState<string[]>([]);
  const [dueState, setDueState] = useState<DueState>('all');
  const [blockingState, setBlockingState] = useState<BlockingState>('all');
  const [readinessState, setReadinessState] = useState<ReadinessState>('all');

  // One dropdown open at a time — shared with FilterDropdown and AdvancedFilter.
  const { openId, setOpenId } = useFilterDropdowns();

  // Setter wrappers reset to page 1 so the user never lands on an out-of-range page.
  const setPkg     = (v: string[]) => { setPkgKeys(v); setPage(1); };
  const setWorker  = (v: string[]) => { setWorkerTypes(v); setPage(1); };
  const setDue     = (v: DueState) => { setDueState(v); setPage(1); };
  const setBlock   = (v: BlockingState) => { setBlockingState(v); setPage(1); };
  const setReady   = (v: ReadinessState) => { setReadinessState(v); setPage(1); };
  const resetAdvanced = (): void => {
    setPkgKeys([]); setWorkerTypes([]); setDueState('all'); setBlockingState('all'); setReadinessState('all'); setPage(1);
  };

  const pkgsQ = useOnboardingPackages();
  const packages = useMemo(() => (pkgsQ.data ?? []).map(p => ({ key: p.key, label: p.label })), [pkgsQ.data]);
  const workerTypeOptions = useMemo(
    () => Array.from(new Set((pkgsQ.data ?? []).flatMap(p => p.workerTypes))).sort(),
    [pkgsQ.data],
  );

  const casesQ = useOnboardingCases({
    query: query.trim() || undefined,
    statuses: status.length ? (status as OnboardingCaseStatus[]) : undefined,
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
  if (surface === 'start') {
    return <StartOnboardingWizard onBack={() => setSurface('overview')} />;
  }

  // ── Advanced-filter tabs (Package / Worker Type / Status) ──────────────────────
  // The Status tab's 3 sections (due / blocking / readiness) use single-select semantics:
  // onChange takes the LAST item in the toggled array, or 'all' if cleared.
  const advTabs: AdvTab[] = [
    { name: 'Package', blurb: 'Filter by onboarding package.', sections: [
      { type: 'checklist', title: 'Package',
        options: packages.map(p => p.key), selected: pkgKeys,
        onChange: setPkg, labelFn: k => packages.find(p => p.key === k)?.label ?? k },
    ] },
    { name: 'Worker Type', blurb: 'Filter by worker / employment type.', sections: [
      { type: 'checklist', title: 'Worker Type',
        options: workerTypeOptions, selected: workerTypes,
        onChange: setWorker, labelFn: humanize },
    ] },
    { name: 'Status', blurb: 'Filter by due, blocking and readiness state.', sections: [
      { type: 'checklist', title: 'Due',
        options: ['overdue', 'due_today', 'due_this_week'],
        selected: dueState !== 'all' ? [dueState] : [],
        onChange: v => setDue((v.length ? v[v.length - 1]! : 'all') as DueState),
        labelFn: v => DUE_LABEL[v] ?? v },
      { type: 'checklist', title: 'Blocking',
        options: ['blocked', 'not_blocked'],
        selected: blockingState !== 'all' ? [blockingState] : [],
        onChange: v => setBlock((v.length ? v[v.length - 1]! : 'all') as BlockingState),
        labelFn: v => BLOCK_LABEL[v] ?? v },
      { type: 'checklist', title: 'Readiness',
        options: ['ready', 'not_ready'],
        selected: readinessState !== 'all' ? [readinessState] : [],
        onChange: v => setReady((v.length ? v[v.length - 1]! : 'all') as ReadinessState),
        labelFn: v => READY_LABEL[v] ?? v },
    ] },
  ];

  // Active-filter chips — status (basic filter) + all advanced filter selections.
  const allChips: { label: string; onRemove: () => void }[] = [
    ...status.map(s => ({ label: caseStatusPill(s as OnboardingCaseStatus).label, onRemove: () => { setStatus(status.filter(x => x !== s)); setPage(1); } })),
    ...pkgKeys.map(k => ({ label: packages.find(p => p.key === k)?.label ?? k, onRemove: () => setPkg(pkgKeys.filter(x => x !== k)) })),
    ...workerTypes.map(w => ({ label: humanize(w), onRemove: () => setWorker(workerTypes.filter(x => x !== w)) })),
    ...(dueState !== 'all' ? [{ label: DUE_LABEL[dueState] ?? dueState, onRemove: () => setDue('all') }] : []),
    ...(blockingState !== 'all' ? [{ label: BLOCK_LABEL[blockingState] ?? blockingState, onRemove: () => setBlock('all') }] : []),
    ...(readinessState !== 'all' ? [{ label: READY_LABEL[readinessState] ?? readinessState, onRemove: () => setReady('all') }] : []),
  ];

  // Cases table — a PAGE-LOCAL widget. Wrapped in the `.hr-emp-master` scope so it reuses the
  // Employee Master register styling verbatim (toolbar, table, pagination).
  const renderCases = (): VNode => (
    <div class="hr-emp-master" style={{ display: 'contents' }}>
    <div class="table-card">
      <div class="employee-toolbar compact">
        <TableSearch value={query} onChange={v => { setQuery(v); setPage(1); }}
          placeholder="Search employee, case no, package…" ariaLabel="Search onboarding cases" />
        <FilterDropdown id="onb-status" label="Status"
          options={CASE_STATUS_OPTIONS as string[]} selected={status}
          onChange={v => { setStatus(v); setPage(1); }}
          openId={openId} setOpenId={setOpenId}
          labelFn={s => caseStatusPill(s as OnboardingCaseStatus).label} />
        <AdvancedFilter id="onb-advanced" tabs={advTabs} onReset={resetAdvanced}
          openId={openId} setOpenId={setOpenId} />
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
        <button type="button" class="hse-btn accent" onClick={() => setSurface('start')}>
          <i class="fas fa-circle-plus" /> New Case
        </button>
      </div>

      <ActiveFilters chips={allChips}
        onClearAll={allChips.length ? () => { setStatus([]); resetAdvanced(); } : undefined} />

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
        onNewCase={() => setSurface('start')}
        onToast={notify}
      />

      {renderCases()}


      <div class={`toast ${toast ? 'show' : ''}`}>{toast}</div>
    </div>
  );
}
