/**
 * src/components/sections/Finance/PayrollCommandCenter.tsx
 *
 * Payroll Command Center — the first payroll UI vertical slice (approved contract
 * `docs/module-contracts/PAYROLL_COMMAND_CENTER_IMPLEMENTATION.md`). Server-aggregated,
 * authenticated read model: ONE bounded response from `finance/payroll/control-center/get`
 * drives every region. No 500-run browser aggregation.
 *
 * VISUAL: faithful port of mockups/payroll-enterprise/index.html — command-page head, the
 * portfolio-health band, 6 payroll-metric cards, and the pay-widget cards — re-implemented to
 * Siomac standard under the scoped `.pcc` root (payrollCommandCenter.css). Per the user's
 * "keep the board, style like the mockup" direction: the 4 operational widgets (approvals,
 * deadlines, release readiness, release impact) live on the movable widget board, styled as
 * the mockup's `.pay-widget` cards; the band, metrics and run register are fixed regions.
 */
import { type VNode } from 'preact';
import { useMemo, useState, useEffect, useRef, useCallback } from 'preact/hooks';
import { Chart, DoughnutController, ArcElement, Tooltip } from 'chart.js';
import {
  WidgetBoard, WidgetBoardToolbar, WidgetLibraryModal, useBoardLayout, useInstalledWidgetPackages,
  WIDGET_REGISTRY, commitPreviewWidget,
  type BoardLayout, type LocalWidgetMap, type PreviewWidgetInstance, type WidgetInstance, type WidgetSizeDef, type WidgetSizeKey,
} from '@ui/widgets';
import { PageHeader, KpiTile } from '@ui';
import { can } from '@lib/permissions';
import { dialog } from '@lib/dialog';
import { toast } from '@store';
import { useSessionStore, selectIsManager, selectIsAdmin } from '@store/session';
import { humanize } from './financeShared';
import { usePayrollMutation, financePayrollApi } from '@api/finance/payroll';
import { PayNewRunWizard } from './PayNewRunWizard';
import { PayRunDetailPage } from './PayRunDetailPage';
import { type PayRunDrawerActions } from './payRunDetail/interactiveTabs';
import {
  usePayrollControlCenter, defaultControlCenterWindow, isControlCenterDenied,
  type PayrollControlCenterParams, type PayrollControlCenterResponse, type PayrollRunRegisterTab,
  type PayrollRunRegisterItem, type PayrollDeadlineItem, type PayrollReadinessGate,
} from '@api/finance/payroll/controlCenter';
import './payrollCommandCenter.css';

Chart.register(DoughnutController, ArcElement, Tooltip);

// ── Movable board layout (contract §7; default mirrors the mockup arrangement) ──
const PAGE_KEY = 'finance.payroll.commandCenter.v3';
const BOARD_COLS = 24;
const KPI_PAGE_KEY = 'finance.payroll.commandCenter.kpis.v1';
const W_ASSIGNED  = 'finance.payroll.assignedWork';
const W_DEADLINES = 'finance.payroll.deadlines';
const W_READINESS = 'finance.payroll.releaseReadiness';
const W_IMPACT    = 'finance.payroll.releaseImpact';
const W_REGISTER  = 'finance.payroll.runRegister';
const W_KPI_NEXTPAY   = 'finance.payroll.kpi.nextPay';
const W_KPI_ACTIVE    = 'finance.payroll.kpi.activeRuns';
const W_KPI_EMPLOYEES = 'finance.payroll.kpi.employeesDue';
const W_KPI_GROSS     = 'finance.payroll.kpi.grossPayroll';
const W_KPI_NET       = 'finance.payroll.kpi.netPayroll';
const CELL = 6;

function defInst(widgetId: string, x: number, y: number, w: number, h: number, sizeKey: WidgetSizeKey, pageKey = PAGE_KEY): WidgetInstance {
  return { instanceId: `${widgetId}#def`, widgetId, pageKey, zoneId: 'main', x, y, w, h, sizeKey, config: {} };
}
// KPI strip — a SEPARATE single-row board (its own page key), 6 uniform w2×h6 tiles, reorder-only
// (resizable=false, maxRows=6, isBounded), exactly like StatutoryDashboard's KPI board.
function defaultKpiLayout(): BoardLayout {
  return {
    pageKey: KPI_PAGE_KEY,
    zones: {
      main: [
        defInst(W_KPI_NEXTPAY,   0, 0, 2, 6, 'compact', KPI_PAGE_KEY),
        defInst(W_KPI_ACTIVE,    2, 0, 2, 6, 'compact', KPI_PAGE_KEY),
        defInst(W_KPI_EMPLOYEES, 4, 0, 2, 6, 'compact', KPI_PAGE_KEY),
        defInst(W_KPI_GROSS,     6, 0, 2, 6, 'compact', KPI_PAGE_KEY),
        defInst(W_KPI_NET,       8, 0, 2, 6, 'compact', KPI_PAGE_KEY),
      ],
    },
  };
}
function defaultLayout(): BoardLayout {
  return {
    pageKey: PAGE_KEY,
    zones: {
      // Mirror the mockup: wide left workspace (approvals over deadlines) + narrow right rail
      // (readiness over impact). Run register is a fixed region below the board.
      // 24-col grid (finer resize). Wide left workspace (approvals over deadlines) + narrow right rail.
      main: [
        defInst(W_ASSIGNED,   0,  0,  9, 25, 'wide'),
        defInst(W_DEADLINES,  9,  0,  7, 25, 'wide'),
        defInst(W_READINESS, 16,  0,  8, 25, 'standard'),
        defInst(W_REGISTER,   0, 25, 16, 41, 'hero'),
        defInst(W_IMPACT,    16, 25,  8, 30, 'standard'),
      ],
    },
  };
}
const floor = (key: WidgetSizeKey, w: number, h: number): WidgetSizeDef[] => [{ key, label: 'Default', grid: { w, h } }];

// ── Register tabs (mockup labels → contract §4 tab keys) ──────────────────────
const REGISTER_TABS: { key: PayrollRunRegisterTab; label: string }[] = [
  { key: 'all',       label: 'Active' },
  { key: 'attention', label: 'Needs Action' },
  { key: 'approval',  label: 'My Approvals' },
  { key: 'released',  label: 'Completed' },
];

// ── formatting (match the mockup: "TTD 7,814,920" / "TTD 10.3M" / "31 Jul 2026") ──
const fmtTTD = (n: number): string => `TTD ${Math.round(n).toLocaleString('en-US')}`;
function fmtTTDc(n: number): string {
  const a = Math.abs(n);
  if (a >= 1e6) return `TTD ${(n / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `TTD ${Math.round(n / 1e3)}K`;
  return `TTD ${Math.round(n).toLocaleString('en-US')}`;
}
function fmtDay(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return `${d.getDate()} ${d.toLocaleString('en-US', { month: 'short' })} ${d.getFullYear()}`;
}
function fmtDayShort(iso: string | null | undefined): { day: string; mon: string } {
  if (!iso) return { day: '—', mon: '' };
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { day: '—', mon: '' };
  return { day: String(d.getDate()), mon: d.toLocaleString('en-US', { month: 'short' }) };
}
function relDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso); if (Number.isNaN(d.getTime())) return '';
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const day = new Date(d); day.setHours(0, 0, 0, 0);
  const diff = Math.round((day.getTime() - today.getTime()) / 86_400_000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  if (diff < 0) return `${Math.abs(diff)}d overdue`;
  return `In ${diff}d`;
}
function timeOf(iso: string): string {
  const d = new Date(iso);
  // 12-hour clock with an AM/PM suffix (uppercase so the page-wide capitalize doesn't render "Am").
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
}
const initials = (name: string): string => name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase() || '?';

// ── run readiness → progress-bar state + label (mockup .run-progress) ──────────
const READINESS_PROGRESS: Record<string, string> = {
  ready: 'is-ready', released: 'is-ready', in_progress: 'is-warning', blocked: 'is-danger', not_started: '',
};
const READINESS_LABEL: Record<string, string> = {
  ready: 'Ready', released: 'Released', in_progress: 'In Progress', blocked: 'Blocked', not_started: 'Not Started',
};

// ── deadline kind → label (mockup deadline-list) ───────────────────────────────
const DEADLINE_LABEL: Record<PayrollDeadlineItem['kind'], string> = {
  cutoff: 'Input Cutoff', pay_date: 'Pay Date', approval: 'Approval Due', funding: 'Funding Due', release: 'Release Due',
};
const DEADLINE_PILL: Record<PayrollDeadlineItem['state'], { cls: string; label: string }> = {
  overdue: { cls: 'red', label: 'Overdue' }, today: { cls: 'red', label: 'Today' }, upcoming: { cls: 'blue', label: 'Upcoming' },
};

// ── recent-activity event type → icon + colour tone (mockup .activity-icon .green/.blue/.amber) ──
// Each payroll event gets its own glyph + tone instead of a single generic info icon, matching the
// mockup (green check for certify/approve, blue calculator for recalculation, amber for funding, …).
const ACTIVITY_VISUAL: Record<string, { tone: 'green' | 'blue' | 'amber' | 'red'; icon: string }> = {
  'finance.payroll.run.certified':         { tone: 'green', icon: 'fa-user-check' },
  'finance.payroll.run.approved':          { tone: 'green', icon: 'fa-circle-check' },
  'finance.payroll.run.released':          { tone: 'green', icon: 'fa-paper-plane' },
  'finance.payroll.run.funding_confirmed': { tone: 'green', icon: 'fa-building-columns' },
  'finance.payroll.run.calculated':        { tone: 'blue',  icon: 'fa-calculator' },
  'finance.payroll.run.submitted':         { tone: 'blue',  icon: 'fa-arrow-up-from-bracket' },
  'finance.payroll.run.locked':            { tone: 'blue',  icon: 'fa-lock' },
  'finance.payroll.run.reopened':          { tone: 'amber', icon: 'fa-rotate-left' },
  'finance.payroll.run.rejected':          { tone: 'red',   icon: 'fa-circle-xmark' },
};
const activityVisual = (eventType: string): { tone: string; icon: string } =>
  ACTIVITY_VISUAL[eventType] ?? { tone: 'blue', icon: 'fa-circle-info' };

// ── readiness gate state → gate-state class + FontAwesome icon + value ──────────
const GATE_STATE: Record<PayrollReadinessGate['state'], { cls: string; icon: string; value: string }> = {
  pass:            { cls: 'ok',   icon: 'fa-check',       value: 'Complete' },
  warning:         { cls: 'warn', icon: 'fa-exclamation', value: 'Review' },
  fail:            { cls: 'bad',  icon: 'fa-xmark',       value: 'Blocked' },
  not_applicable:  { cls: 'na',   icon: 'fa-minus',       value: 'N/A' },
};

const HEALTH_STATE_LABEL: Record<string, string> = {
  healthy: 'Healthy', attention: 'Attention', at_risk: 'At Risk', critical: 'Critical',
};
const HEALTH_ICON: Record<string, string> = {
  healthy: 'fa-circle-check', attention: 'fa-triangle-exclamation', at_risk: 'fa-triangle-exclamation', critical: 'fa-triangle-exclamation',
};

// ── Readiness doughnut (the ONLY chart; passed/applicable; text fallback + reduced motion) ──
function ReadinessDoughnut({ passed, applicable, state }: { passed: number; applicable: number; state: string }): VNode {
  const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null);
  const chartRef = useRef<{ destroy(): void } | null>(null);
  const arc = state === 'blocked' ? '#ff9c5b' : state === 'released' ? '#7fb2ff' : '#4fd08a';
  const denom = Math.max(1, applicable);
  useEffect(() => {
    if (!canvas) return;
    chartRef.current?.destroy();
    const reduce = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const c = new Chart(canvas, {
      type: 'doughnut',
      data: { labels: ['Passed', 'Remaining'], datasets: [{ data: [passed, Math.max(0, applicable - passed)], backgroundColor: [arc, 'rgba(255,255,255,.12)'], borderWidth: 0 }] },
      options: {
        responsive: true, maintainAspectRatio: false, cutout: '72%', rotation: -90,
        animation: reduce ? false : { animateRotate: true, duration: 700 },
        plugins: { legend: { display: false }, tooltip: { enabled: false } },
      },
    });
    chartRef.current = c;
    return () => { chartRef.current?.destroy(); chartRef.current = null; };
  }, [canvas, passed, applicable, arc, denom]);
  return (
    <div class="readiness-chart" role="img" aria-label={`${passed} of ${applicable} release controls complete`}>
      <canvas ref={setCanvas} width={82} height={82} aria-hidden="true" />
      <div class="readiness-chart-value"><strong>{passed} / {applicable}</strong><span>controls</span></div>
    </div>
  );
}

// ── Ready gate ──────────────────────────────────────────────────────────────
// The page reveals as ONE unit only when EVERY initial dependency has resolved: the
// control-center payload AND both widget-board layouts AND the installed-widget registry.
// Gating on the payload alone (the old behaviour) let the boards mount into an EMPTY
// layout — `useBoardLayout` returns an empty board while its own query loads — so the
// portfolio painted, then the KPI/operational tiles filled in a beat later ("KPI card
// loads last"). Each input is an independently-keyed query, so observing them at the page
// costs no extra fetch (they dedupe with the boards' own subscriptions). A settled-but-
// errored layout or registry query reports not-loading, so a backend hiccup reveals the
// page (local widgets still render) rather than trapping it on the skeleton forever.
export function commandCenterReady(s: {
  hasData: boolean;
  mainLayoutLoading: boolean;
  kpiLayoutLoading: boolean;
  registryLoading: boolean;
}): boolean {
  return s.hasData && !s.mainLayoutLoading && !s.kpiLayoutLoading && !s.registryLoading;
}

// ── Skeleton (mirrors the final CC geometry so the reveal doesn't shift) ───────
// Body only — the header-shaped placeholder is rendered in the header's slot (outside
// `.pcc`) so the real PageHeader reveals in place without pushing the body down.
function SkeletonBody(): VNode {
  return (
    <>
      <div class="pcc-skel-band pcc-skel-anim" />
      <div class="pcc-skel-kpis">{Array.from({ length: 5 }).map((_, i) => <div key={i} class="pcc-skel-kpi pcc-skel-anim" />)}</div>
      <div class="pcc-skel-board">{Array.from({ length: 3 }).map((_, i) => <div key={i} class="pcc-skel-card pcc-skel-anim" />)}</div>
      <div class="pcc-skel-lower">
        <div class="pcc-skel-register pcc-skel-anim" />
        <div class="pcc-skel-rail pcc-skel-anim" />
      </div>
    </>
  );
}
// Header-shaped placeholder — same box metrics as `.ui-page-header` (48px icon chip +
// text stack, matching margins/padding) so revealing the real header causes no shift.
function SkeletonHeader(): VNode {
  return (
    <div class="pcc-skel-head" aria-hidden="true">
      <div class="pcc-skel-head-icon pcc-skel-anim" />
      <div class="pcc-skel-head-text">
        <div class="pcc-skel-head-crumb pcc-skel-anim" />
        <div class="pcc-skel-head-title pcc-skel-anim" />
        <div class="pcc-skel-head-sub pcc-skel-anim" />
      </div>
    </div>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────
export function PayrollCommandCenter(): VNode {
  const window0 = useMemo(() => defaultControlCenterWindow(), []);
  const [tab, setTab] = useState<PayrollRunRegisterTab>('all');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [cursor, setCursor] = useState<string | undefined>(undefined);

  useEffect(() => {
    const t = setTimeout(() => { setSearch(searchInput.trim()); setCursor(undefined); }, 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const params: PayrollControlCenterParams = useMemo(() => ({
    window: window0,
    register: { tab, search: search || undefined, cursor, limit: 10 },
  }), [window0, tab, search, cursor]);

  const q = usePayrollControlCenter(params);
  const data: PayrollControlCenterResponse | undefined = q.data;
  const denied = isControlCenterDenied(q.error);

  // ── Board (per-user movable layout; managers/admins may customize) ──
  const canEditBoard = useSessionStore(selectIsManager);
  const isAdmin = useSessionStore(selectIsAdmin);
  const [editing, setEditing] = useState(false);
  const [libOpen, setLibOpen] = useState(false);
  const [preview, setPreview] = useState<PreviewWidgetInstance | null>(null);
  const { layout, addWidget, setAsDefault, resetLayout, isDefaultDirty, isLoading: mainLayoutLoading } = useBoardLayout(PAGE_KEY, defaultLayout());
  // Observe the KPI board's own layout query + the installed-widget registry at the PAGE
  // level so the reveal can wait for them. Both dedupe by query key with the boards' own
  // subscriptions (WidgetBoardZone → useBoardLayout, WidgetBoard → useInstalledWidgetPackages),
  // so this adds no network cost — it only lets the page gate on their loading state.
  const kpiLayoutLoading = useBoardLayout(KPI_PAGE_KEY, defaultKpiLayout()).isLoading;
  const pkgQuery = useInstalledWidgetPackages();
  const [savingDefault, setSavingDefault] = useState(false);
  const boardItems = layout.zones.main ?? [];
  const placedWidgetIds = boardItems.map(w => w.widgetId);
  const placeBottom = <T extends { x: number; y: number }>(w: T): T => ({ ...w, x: 0, y: Math.max(0, ...boardItems.map(i => i.y + i.h)) });
  const userPermissions = useMemo(() => Array.from(new Set(WIDGET_REGISTRY.flatMap(w => w.dataSource.permissions))).filter(can), []);
  const promoteDefault = async (): Promise<void> => { if (savingDefault) return; setSavingDefault(true); try { await setAsDefault(); } finally { setSavingDefault(false); } };

  // The whole page reveals as one unit once data + both board layouts + the registry are ready.
  const ready = commandCenterReady({ hasData: !!data, mainLayoutLoading, kpiLayoutLoading, registryLoading: pkgQuery.isLoading });
  // Chrome = the real PageHeader (with its data-dependent New-Run action + board toolbar). It
  // shows on reveal AND on the error state; during the initial load a header-shaped skeleton
  // reserves its space so revealing the header never shifts the body down.
  const showChrome = ready || (q.isError && !denied);

  // ── Lifecycle actions → the real run drawer + create wizard (contract §8) ──
  const [drawerRunId, setDrawerRunId] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen]   = useState(false);
  const [wizOpen, setWizOpen]         = useState(false);

  const lockInputsMut = usePayrollMutation(financePayrollApi.lockInputs);
  const calcMut       = usePayrollMutation(financePayrollApi.calculate);
  const submitMut     = usePayrollMutation(financePayrollApi.submitRun);
  const approveRunMut = usePayrollMutation(financePayrollApi.approveRun);
  const rejectRunMut  = usePayrollMutation(financePayrollApi.rejectRun);
  const lockRunMut    = usePayrollMutation(financePayrollApi.lockRun);
  const reopenMut     = usePayrollMutation(financePayrollApi.reopenRun);
  const exportMut     = usePayrollMutation(financePayrollApi.exportRun);
  const genMut        = usePayrollMutation(financePayrollApi.generatePayslips);

  async function runAction(p: Promise<unknown>, ok: string): Promise<void> {
    try { await p; toast(ok); }
    catch (e) { toast(e instanceof Error ? e.message : 'Action failed.'); }
  }

  const submitKeys = useRef<Map<string, string>>(new Map());
  function submitRunStable(runId: string): Promise<unknown> {
    const keys = submitKeys.current;
    const key = keys.get(runId) ?? crypto.randomUUID();
    keys.set(runId, key);
    return submitMut.mutateAsync({ id: runId, idempotencyKey: key }).then(r => { keys.delete(runId); return r; });
  }

  const drawerActions: PayRunDrawerActions = {
    onLockInputs:  run => void runAction(lockInputsMut.mutateAsync({ id: run.id }), 'Inputs locked.'),
    onCalculate:   run => void runAction(calcMut.mutateAsync({ id: run.id }),       'Run calculated.'),
    onSubmit:      run => void runAction(submitRunStable(run.id),                   'Submitted for approval.'),
    onApprove:     run => { void (async () => {
      const confirmed = await dialog.confirm({
        title: `Approve run ${run.runNo}?`,
        text: `Approving transitions the ${run.periodMonth.slice(0, 7)} pay run to 'Approved'. SoD check: you must not be the preparer.`,
        confirmText: 'Approve', icon: 'question',
      });
      if (!confirmed) return;
      void runAction(approveRunMut.mutateAsync({ id: run.id }), 'Run approved.');
    })(); },
    onReject:      run => { void (async () => {
      const reason = await dialog.prompt({
        title: `Reject run ${run.runNo}`,
        text: 'Provide a reason. The workflow task is decided as rejected; the preparer is notified and the run is returned to them for revision.',
        placeholder: 'Reason for rejection…', confirmText: 'Reject',
      });
      if (reason == null) return;
      void runAction(rejectRunMut.mutateAsync({ id: run.id, reason: reason.trim() || 'Rejected by approver.' }), 'Run rejected and returned for revision.');
    })(); },
    onLockRun:     run => void runAction(lockRunMut.mutateAsync({ id: run.id }), 'Run locked.'),
    onExport:      run => void runAction(exportMut.mutateAsync({ id: run.id }),  'Export generated.'),
    onReopen:      run => void runAction(reopenMut.mutateAsync({ id: run.id }),  'Run reopened.'),
    onGenPayslips: run => void runAction(genMut.mutateAsync({ runId: run.id }),  'Payslips generated.'),
  };

  // Open the run's drawer — used by run rows, deadlines, the portfolio intervention, the
  // assigned-approval card, and readiness gates. The drawer IS the workflow decision surface.
  const openRun = useCallback((runId: string | null) => {
    if (!runId) return;
    setDrawerRunId(runId);
    setDrawerOpen(true);
  }, []);
  // Deep-link from the Payroll Runs register: it stores a runId + navigates here.
  // Consume the hint once on mount and open that run's full-page detail.
  useEffect(() => {
    let pending: string | null = null;
    try { pending = sessionStorage.getItem('siomac_open_payroll_run'); sessionStorage.removeItem('siomac_open_payroll_run'); } catch { /* ignore */ }
    if (pending) openRun(pending);
  }, [openRun]);
  const refresh = useCallback(() => { void q.refetch(); }, [q]);
  // KPI drill-through: focus the run register on a tab (mirrors Statutory's goToRegisterTab).
  const focusRegister = useCallback((t: PayrollRunRegisterTab) => {
    setTab(t); setCursor(undefined);
    requestAnimationFrame(() => document.getElementById('active-runs')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  }, []);

  // ── Standard chrome: PageHeader + the board Customize toolbar in its actions (Statutory pattern) ──
  const headerActions = (
    <>
      <button type="button" class="pcc-hbtn pcc-hbtn--icon" title="Refresh payroll data" aria-label="Refresh payroll data"
        disabled={q.isFetching} onClick={refresh}>
        <i class={`fa-solid fa-rotate${q.isFetching ? ' fa-spin' : ''}`} />
      </button>
      {data?.capabilities.canCreateRun && (
        <button type="button" class="pcc-hbtn pcc-hbtn--primary" onClick={() => setWizOpen(true)}>
          <i class="fa-solid fa-plus" /> New Payroll Run
        </button>
      )}
    </>
  );
  const boardTools = canEditBoard ? (
    <WidgetBoardToolbar
      editing={editing} canSetDefault={isAdmin} defaultDirty={isDefaultDirty} finishInBanner layoutItems={boardItems}
      onToggleEdit={() => setEditing(e => !e)} onOpenLibrary={() => setLibOpen(true)}
      onReset={() => void resetLayout()} onSetDefault={() => void promoteDefault()} />
  ) : null;
  const header = (
    <PageHeader icon="fa-money-check-dollar" module="Finance · Payroll" title="Payroll Command Center"
      sub="Run payroll, clear release controls, coordinate approvals and confirm funding."
      actions={<>{headerActions}{boardTools}</>} />
  );

  // ── Denied state ──
  if (denied) {
    return (
      <>
        {header}
        <div class="pcc">
          <div class="pcc-state pcc-state--denied">
            <i class="fa-solid fa-lock" />
            <h3>Access Restricted</h3>
            <p>You don't have permission to view the payroll command center.</p>
          </div>
        </div>
      </>
    );
  }

  // ── KPI board widgets — 6 KpiTiles on their own reorder-only board (Statutory pattern) ──
  const kk = data?.kpis;
  const kpiLoading = !kk;
  const nextPay = fmtDayShort(kk?.nextPayDate.date);
  const kpiFloor = floor('compact', 2, 6);
  const kpiLocalWidgets: LocalWidgetMap = {
    [W_KPI_NEXTPAY]: { chrome: 'none', title: 'Next Pay Date', resizable: false, allowedSizes: kpiFloor,
      render: () => <KpiTile icon="fa-calendar-day" tone="blue" label="Next Pay Date"
        value={kk ? (nextPay.mon ? `${nextPay.day} ${nextPay.mon}` : '—') : '—'}
        sub={kk?.nextPayDate.runNo ? `Run ${kk.nextPayDate.runNo}` : 'No scheduled run'} loading={kpiLoading}
        link={{ label: kk?.nextPayDate.runNo ? 'Open run' : 'View runs', onClick: () => (kk?.nextPayDate.runId ? openRun(kk.nextPayDate.runId) : focusRegister('all')) }} /> },
    [W_KPI_ACTIVE]: { chrome: 'none', title: 'Active Runs', resizable: false, allowedSizes: kpiFloor,
      render: () => <KpiTile icon="fa-layer-group" tone="teal" label="Active Runs" value={kk?.activeRuns ?? 0} sub="In the reporting window" loading={kpiLoading}
        link={{ label: 'View runs', onClick: () => focusRegister('all') }} /> },
    [W_KPI_EMPLOYEES]: { chrome: 'none', title: 'Employees Due', resizable: false, allowedSizes: kpiFloor,
      render: () => <KpiTile icon="fa-users" tone="blue" label="Employees Due" value={kk?.employeesDue ?? 0} sub="Current calc population" loading={kpiLoading}
        link={{ label: 'View runs', onClick: () => focusRegister('all') }} /> },
    [W_KPI_GROSS]: { chrome: 'none', title: 'Gross Payroll', resizable: false, allowedSizes: kpiFloor,
      render: () => <KpiTile icon="fa-coins" tone="green" label="Gross Payroll" value={kk ? fmtTTDc(kk.grossPayroll.amount) : '—'} sub="Window total" loading={kpiLoading}
        link={{ label: 'View runs', onClick: () => focusRegister('all') }} /> },
    [W_KPI_NET]: { chrome: 'none', title: 'Net Payroll', resizable: false, allowedSizes: kpiFloor,
      render: () => <KpiTile icon="fa-wallet" tone="teal" label="Net Payroll" value={kk ? fmtTTDc(kk.netPayroll.amount) : '—'} sub="Window total" loading={kpiLoading}
        link={{ label: 'View runs', onClick: () => focusRegister('all') }} /> },
  };

  // ── Local widgets (close over the shared query) ──
  const localWidgets: LocalWidgetMap = {
    // allowedSizes = resize FLOOR (min width/height). Keep min width small (3) so widgets can be
    // narrowed AND widened freely left/right; the default layout still starts them wide.
    [W_ASSIGNED]:  { render: () => <ApprovalsWidget data={data} onOpen={openRun} />,  chrome: 'none', title: 'Approval and Activity', allowedSizes: floor('wide', 6, 12) },
    [W_DEADLINES]: { render: () => <DeadlinesWidget data={data} onOpen={openRun} />,   chrome: 'none', title: 'Upcoming Deadlines',   allowedSizes: floor('wide', 6, 10) },
    [W_READINESS]: { render: () => <ReadinessWidget data={data} onOpen={openRun} />,   chrome: 'none', title: 'Release Readiness',    allowedSizes: floor('standard', 6, 14) },
    [W_IMPACT]:    { render: () => <ImpactWidget data={data} onOpen={openRun} />,      chrome: 'none', title: 'Release Impact',       allowedSizes: floor('standard', 6, 10) },
    [W_REGISTER]:  { chrome: 'none', title: 'Payroll Runs', allowedSizes: floor('hero', 12, 24),
      render: () => <RunRegister data={data} tab={tab} setTab={setTab} searchInput={searchInput} setSearchInput={setSearchInput} cursor={cursor} setCursor={setCursor} onOpen={openRun} onNewRun={() => setWizOpen(true)} /> },
  };

  // A selected run replaces the command-center board with the full-page run
  // workspace (in-place detail, mirroring OffboardingOverview → CaseDetail).
  if (drawerRunId && drawerOpen) {
    return (
      <PayRunDetailPage
        runId={drawerRunId}
        onBack={() => { setDrawerOpen(false); setDrawerRunId(null); }}
        canManage={data?.capabilities.canManageRun ?? false}
        canApprove={data?.capabilities.canApprove ?? false}
        actions={drawerActions}
      />
    );
  }

  // The create-run wizard is a full-page workspace (mockup create-run.html),
  // replacing the board in-place like the run detail above.
  if (wizOpen) {
    return (
      <PayNewRunWizard
        onClose={() => setWizOpen(false)}
        onCreated={run => { setWizOpen(false); setTab('all'); setCursor(undefined); setDrawerRunId(run.id); setDrawerOpen(true); }}
      />
    );
  }

  return (
    <>
      {showChrome ? header : <SkeletonHeader />}
      <div class="pcc">
      {/* ── Error / loading gate ── everything below the header reveals atomically once `ready` ── */}
      {q.isError && !denied ? (
        <div class="pcc-state pcc-state--error">
          <i class="fa-solid fa-triangle-exclamation" />
          <h3>Couldn't load the command center</h3>
          <p>{(q.error)?.message ?? 'Please try again.'}</p>
          <button type="button" class="pcc-hbtn pcc-hbtn--primary" onClick={refresh}>Retry</button>
        </div>
      ) : !ready ? (
        <SkeletonBody />
      ) : (
        <>
          <PortfolioBand data={data} onOpen={openRun} />
          <div class="pcc-kpi-board">
            <WidgetBoard pageKey={KPI_PAGE_KEY} zones={['main']} editing={editing && canEditBoard}
              localWidgets={kpiLocalWidgets} defaultLayout={defaultKpiLayout()}
              cellHeight={6} column={10} gap={[12, 12]} resizable={false} maxRows={6} isBounded revealOnMount={false} />
          </div>

          {preview && (
            <div class="wmock-preview-banner">
              <span><i class="fa-solid fa-eye" /> Previewing a widget — drag and resize it, then add or discard.</span>
            </div>
          )}

          <WidgetBoard pageKey={PAGE_KEY} zones={['main']} editing={editing && canEditBoard}
            localWidgets={localWidgets} defaultLayout={defaultLayout()}
            cellHeight={CELL} column={BOARD_COLS} gap={[12, 12]} compact={null} revealOnMount={false}
            preview={preview} onPreviewChange={setPreview}
            onCommitPreview={p => { void addWidget(p.zoneId, commitPreviewWidget(p)); setPreview(null); }}
            onDiscardPreview={() => { setPreview(null); setLibOpen(true); }}
            onFinishEditing={() => setEditing(false)}
            onSetDefault={() => void promoteDefault()} canSetDefault={isAdmin}
            defaultDirty={isDefaultDirty} defaultSaving={savingDefault} />

          <WidgetLibraryModal open={libOpen} pageKey={PAGE_KEY} zoneId="main"
            placedWidgetIds={placedWidgetIds} userPermissions={userPermissions}
            canManagePackages={isAdmin} onClose={() => setLibOpen(false)}
            onAddWidget={inst => addWidget('main', placeBottom(inst))}
            onPreviewOnBoard={p => setPreview(placeBottom(p))} />
        </>
      )}
      </div>

    </>
  );
}

// ── Portfolio-health band (fixed, ~80px; mockup .portfolio-health) ─────────────
function PortfolioBand({ data, onOpen }: { data?: PayrollControlCenterResponse; onOpen: (id: string | null) => void }): VNode {
  const h = data?.portfolioHealth;
  const k = data?.kpis;
  const state = h?.state ?? 'healthy';
  const stateLabel = HEALTH_STATE_LABEL[state] ?? 'Healthy';
  const stateIcon = HEALTH_ICON[state] ?? 'fa-triangle-exclamation';
  const intervention = h?.primaryIntervention ?? null;
  const needCount = (h?.criticalCount ?? 0) + (h?.atRiskCount ?? 0);
  // Headline is single-sourced from `state` so it can never contradict the rail: "on track" appears
  // ONLY when the portfolio is genuinely healthy. When runs are at risk we name the count; when the
  // risk is elsewhere (overdue approvals, near-due funding) we still say attention is needed.
  const headline = needCount > 0
    ? `${needCount} run${needCount !== 1 ? 's' : ''} need intervention`
    : state === 'healthy' ? 'Portfolio is on track' : 'Payroll needs attention';
  // Sub-line mirrors the mockup: when release-blocking controls are open, name how many to clear before
  // the next window; otherwise surface the specific top intervention, else the all-clear.
  const openBlockers = h?.openBlockerCount ?? 0;
  const summarySub = openBlockers > 0
    ? `Resolve ${openBlockers} critical control${openBlockers !== 1 ? 's' : ''} before the next release window.`
    : intervention ? intervention.detail : 'No critical release controls outstanding.';
  // ── Stat tiles mirror the mockup: Approval Due · Funding Gap · Next Cutoff ─────
  const deadlines = data?.upcomingDeadlines ?? [];
  const nextApproval = deadlines.filter(d => d.kind === 'approval').sort((a, b) => a.dueAt.localeCompare(b.dueAt))[0];
  const approvalCount = data?.runRegister.tabCounts.approval ?? 0;
  const approvalSub = nextApproval
    ? `${relDate(nextApproval.dueAt)}${timeOf(nextApproval.dueAt) ? ` · ${timeOf(nextApproval.dueAt)}` : ''}`
    : 'None due';
  const fundReq = k?.funding.required.amount ?? 0;
  const fundGap = k?.funding.gap.amount ?? 0;
  const fundingSub = fundGap <= 0 ? 'Fully funded'
    : `${Math.round((fundReq > 0 ? fundGap / fundReq : 0) * 1000) / 10}% unconfirmed`;
  const nextCutoff = deadlines.filter(d => d.kind === 'cutoff' && d.state !== 'overdue').sort((a, b) => a.dueAt.localeCompare(b.dueAt))[0];
  return (
    <section class={`portfolio-health is-${state}`} aria-label="Payroll portfolio health">
      <div class="health-urgency-rail"><i class={`fa-solid ${stateIcon}`} /><span>{stateLabel}</span></div>
      <div class="health-summary">
        <span>Payroll Portfolio Health</span>
        <strong>{headline}</strong>
        <small>{summarySub}</small>
      </div>
      <div class="health-stats" aria-label="Portfolio operational measures">
        <div class="health-stat"><strong>{approvalCount}</strong><span>Approval Due</span><small>{approvalSub}</small></div>
        <div class="health-stat"><strong>{k ? fmtTTDc(fundGap) : '—'}</strong><span>Funding Gap</span><small>{fundingSub}</small></div>
        <div class="health-stat"><strong>{nextCutoff ? relDate(nextCutoff.dueAt) : '—'}</strong><span>Next Cutoff</span><small>{nextCutoff ? fmtDay(nextCutoff.dueAt) : 'None scheduled'}</small></div>
      </div>
      <div class="health-actions" aria-label="Priority payroll actions">
        <div class="health-actions-head"><span>Resolve in order</span><span>{h?.overdueActionCount ?? 0} total</span></div>
        {intervention ? (
          <button type="button" onClick={() => onOpen(intervention.runId)}>
            <b>01</b><span>{intervention.title}</span><i class="fa-solid fa-arrow-right" />
          </button>
        ) : (
          <div class="health-clear">No urgent interventions.</div>
        )}
      </div>
    </section>
  );
}

// ── 6 KPI tiles (fixed) — the app-standard @ui KpiTile with drill-through footer, exactly
// like the Statutory page (icon chip + value/label + dotted sub + "View …" link footer). ──
function MetricsRow({ data, onFocusRegister, onOpen }: {
  data?: PayrollControlCenterResponse; onFocusRegister: (t: PayrollRunRegisterTab) => void; onOpen: (id: string) => void;
}): VNode {
  const k = data?.kpis;
  const loading = !k;
  const nextPay = fmtDayShort(k?.nextPayDate.date);
  const fundedPct = k ? Math.round((k.funding.required.amount > 0 ? k.funding.confirmed.amount / k.funding.required.amount : 1) * 100) : 0;
  const fundingOk = !k || k.funding.gap.amount <= 0;
  return (
    <div class="pcc-kpis" aria-label="Payroll operational measures">
      <KpiTile icon="fa-calendar-day" tone="blue" label="Next Pay Date"
        value={k ? (nextPay.mon ? `${nextPay.day} ${nextPay.mon}` : '—') : '—'}
        sub={k?.nextPayDate.runNo ? `Run ${k.nextPayDate.runNo}` : 'No scheduled run'} loading={loading}
        link={{ label: k?.nextPayDate.runNo ? 'Open run' : 'View runs', onClick: () => (k?.nextPayDate.runId ? onOpen(k.nextPayDate.runId) : onFocusRegister('all')) }} />
      <KpiTile icon="fa-layer-group" tone="teal" label="Active Runs" value={k?.activeRuns ?? 0} sub="In the reporting window" loading={loading}
        link={{ label: 'View runs', onClick: () => onFocusRegister('all') }} />
      <KpiTile icon="fa-users" tone="blue" label="Employees Due" value={k?.employeesDue ?? 0} sub="Current calc population" loading={loading}
        link={{ label: 'View runs', onClick: () => onFocusRegister('all') }} />
      <KpiTile icon="fa-coins" tone="green" label="Gross Payroll" value={k ? fmtTTDc(k.grossPayroll.amount) : '—'} sub="Window total" loading={loading}
        link={{ label: 'View runs', onClick: () => onFocusRegister('all') }} />
      <KpiTile icon="fa-wallet" tone="teal" label="Net Payroll" value={k ? fmtTTDc(k.netPayroll.amount) : '—'} sub="Window total" loading={loading}
        link={{ label: 'View runs', onClick: () => onFocusRegister('all') }} />
      <KpiTile icon="fa-building-columns" tone="amber" label="Funding Confirmed" value={k ? `${fundedPct}%` : '—'}
        sub={k
          ? <><span class={`ui-kpi-dot ui-kpi-dot--${fundingOk ? 'green' : 'amber'}`} />{fundingOk ? humanize(k.funding.state) : `${fmtTTDc(k.funding.gap.amount)} outstanding`}</>
          : ''} loading={loading}
        link={{ label: fundingOk ? 'View runs' : 'Needs action', onClick: () => onFocusRegister(fundingOk ? 'all' : 'attention') }} />
    </div>
  );
}

// ── Run register (fixed; mockup .pay-widget-runs) ──────────────────────────────
function RunRegister({ data, tab, setTab, searchInput, setSearchInput, cursor, setCursor, onOpen, onNewRun }: {
  data?: PayrollControlCenterResponse; tab: PayrollRunRegisterTab; setTab: (t: PayrollRunRegisterTab) => void;
  searchInput: string; setSearchInput: (v: string) => void; cursor?: string; setCursor: (c: string | undefined) => void;
  onOpen: (id: string) => void; onNewRun: () => void;
}): VNode {
  const reg = data?.runRegister;
  const canCreate = data?.capabilities.canCreateRun;
  const attention = reg?.tabCounts.attention ?? 0;
  return (
    <section id="active-runs" class="card pay-widget pay-widget-runs run-register">
      <div class="widget-head">
        <div><span class="widget-kicker">Operational workspace</span><h2>Payroll Runs</h2><p>Ordered by release risk, action due time and pay date.</p></div>
        {attention > 0 && <span class="pill red">{attention} need action</span>}
      </div>
      <div class="run-tabs" role="tablist" aria-label="Payroll run views">
        {REGISTER_TABS.map(t => (
          <button key={t.key} type="button" role="tab" aria-selected={tab === t.key}
            class={`run-tab${tab === t.key ? ' on' : ''}`}
            onClick={() => { setTab(t.key); setCursor(undefined); }}>
            {t.label}<span class="run-tab-count">{reg?.tabCounts[t.key] ?? 0}</span>
          </button>
        ))}
      </div>
      <div class="run-toolbar">
        <label class="run-search"><i class="fa-solid fa-magnifying-glass" />
          <input type="search" placeholder="Search runs or pay groups" value={searchInput} aria-label="Search payroll runs"
            onInput={e => setSearchInput((e.target as HTMLInputElement).value)} />
        </label>
      </div>
      <div class="run-table-wrap">
        <table class="payroll-run-table">
          <thead><tr><th>Run</th><th>Pay Group</th><th>Pay Date</th><th class="num">Net Payroll</th><th>Readiness</th><th /></tr></thead>
          <tbody>
            {reg && reg.items.length > 0 ? reg.items.map(row => <RunRow key={row.id} row={row} onOpen={onOpen} />) : (
              <tr><td colSpan={6}>
                <div class="run-empty">
                  <i class="fa-regular fa-folder-open" />
                  <strong>No payroll runs match this view</strong>
                  <small>Change the filter or clear the search.</small>
                  {canCreate && tab === 'all' && !searchInput && (
                    <button type="button" class="pcc-hbtn pcc-hbtn--primary" onClick={onNewRun}><i class="fa-solid fa-plus" /> New Payroll Run</button>
                  )}
                </div>
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
      <div class="run-table-footer">
        <span>Showing portfolio activity{reg ? ` · ${reg.total} run${reg.total !== 1 ? 's' : ''}` : ''}</span>
        <div class="run-pager">
          <button type="button" disabled={!cursor} onClick={() => setCursor(undefined)}>First page</button>
          <button type="button" disabled={!reg?.nextCursor} onClick={() => setCursor(reg?.nextCursor ?? undefined)}>Next <i class="fa-solid fa-chevron-right" /></button>
        </div>
      </div>
    </section>
  );
}

function RunRow({ row, onOpen }: { row: PayrollRunRegisterItem; onOpen: (id: string) => void }): VNode {
  const prog = READINESS_PROGRESS[row.readiness.state] ?? '';
  const pct = row.readiness.percent ?? (row.readiness.state === 'ready' || row.readiness.state === 'released' ? 100 : 0);
  const blockers = row.readiness.blockerCount;
  return (
    <tr onClick={() => onOpen(row.id)} tabIndex={0} onKeyDown={e => { if (e.key === 'Enter') onOpen(row.id); }}>
      <td><strong>{row.runNo}</strong><small>{humanize(row.runType)}</small></td>
      <td><strong>{row.payGroup.name ?? 'Ungrouped'}</strong><small>{row.employeeCount} employee{row.employeeCount !== 1 ? 's' : ''} · {humanize(row.status)}</small></td>
      <td><strong>{fmtDay(row.payDate)}</strong></td>
      <td class="num">{fmtTTD(row.net.amount)}</td>
      <td>
        <div class={`run-progress ${prog}`}><span style={{ width: `${pct}%` }} /></div>
        <small>{READINESS_LABEL[row.readiness.state] ?? 'Not Started'}{row.readiness.percent != null ? ` · ${row.readiness.percent}%` : ''}{blockers > 0 ? ` · ${blockers} blocker${blockers !== 1 ? 's' : ''}` : ''}</small>
      </td>
      <td><span class="table-action" aria-label={`Open ${row.runNo}`}><i class="fa-solid fa-arrow-right" /></span></td>
    </tr>
  );
}

// ── Approvals & activity widget (mockup .pay-widget-approvals) ─────────────────
function ApprovalsWidget({ data, onOpen }: { data?: PayrollControlCenterResponse; onOpen: (id: string) => void }): VNode {
  const a = data?.assignedToYou;
  const activity = data?.recentActivity ?? [];
  return (
    <section class="card pay-widget pay-widget-approvals">
      <div class="widget-head">
        <div><span class="widget-kicker">Assigned to you</span><h2>Approval and Activity</h2><p>Your next payroll decision and its latest movement.</p></div>
        {a && <span class="pill amber">1 Due</span>}
      </div>
      {a ? (
        <div class="approval-focus">
          <div class="approval-decision-banner">
            <div class="approval-assignee">
              {a.assignee.photoUrl ? <img src={a.assignee.photoUrl} alt={a.assignee.displayName} /> : <span class="av">{initials(a.assignee.displayName)}</span>}
              <div><small>Assigned approver</small><strong>{a.assignee.displayName}</strong><span>{a.isOverdue ? 'Overdue' : 'Awaiting decision'}</span></div>
            </div>
            <div class="approval-decision-copy"><small>{a.dueAt ? `Decision due ${relDate(a.dueAt).toLowerCase()}` : 'Decision pending'}</small><strong>{a.title}</strong><p>{a.dueAt ? `Review by ${fmtDay(a.dueAt)}` : 'Awaiting your review'}</p></div>
          </div>
          <div class="approval-control-summary">
            <div><small>Payroll run</small><strong>{a.runNo}</strong></div>
            <div><small>Net payroll</small><strong>{fmtTTD(a.netPayroll.amount)}</strong></div>
          </div>
          <div class="approval-command">
            <div class="approval-context"><span><i class="fa-regular fa-calendar" /> {a.payDate ? `Pays ${fmtDay(a.payDate)}` : 'No pay date'}</span><span><i class="fa-solid fa-users" /> {a.employeeCount} employee{a.employeeCount !== 1 ? 's' : ''}</span></div>
            <button type="button" class="btn primary" onClick={() => onOpen(a.runId)}><i class="fa-solid fa-user-check" /> Review <i class="fa-solid fa-arrow-right" /></button>
          </div>
        </div>
      ) : (
        <div class="approval-empty"><i class="fa-solid fa-circle-check" /><span>You're all caught up — no payroll approvals assigned to you.</span></div>
      )}
      <div class="activity-head"><span>Recent payroll activity</span><small>{activity.length} update{activity.length !== 1 ? 's' : ''}</small></div>
      <div class="activity-list approval-activity-list">
        {activity.length ? activity.map(ev => {
          const v = activityVisual(ev.eventType);
          return (
            <div class="activity-item" key={ev.eventId}>
              <span class={`activity-icon ${v.tone}`}><i class={`fa-solid ${v.icon}`} /></span>
              <div><strong>{ev.label}</strong><small>{ev.actor?.displayName ?? 'System'}{ev.runNo ? ` · ${ev.runNo}` : ''}</small></div>
              <time>{timeOf(ev.occurredAt)}</time>
            </div>
          );
        }) : <div class="approval-empty"><span>No recent payroll activity.</span></div>}
      </div>
    </section>
  );
}

// ── Deadlines widget — clickable calendar (Statutory .sdb-cal): month · 7-day strip · day list ──
function DeadlinesWidget({ data, onOpen }: { data?: PayrollControlCenterResponse; onOpen: (id: string) => void }): VNode {
  const rows = data?.upcomingDeadlines ?? [];
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const days = Array.from({ length: 7 }, (_, i) => { const d = new Date(today); d.setDate(today.getDate() + i); return d; });
  const dayKey = (iso: string): number => { const d = new Date(iso); d.setHours(0, 0, 0, 0); return d.getTime(); };
  const onDay = (d: Date): PayrollDeadlineItem[] => rows.filter(r => dayKey(r.dueAt) === d.getTime());
  const [selectedTs, setSelectedTs] = useState<number>(() => today.getTime());
  const selected = days.find(d => d.getTime() === selectedTs) ?? today;
  const selectedRows = onDay(selected);
  return (
    <section class="card pay-widget pay-widget-deadlines">
      <div class="widget-head">
        <div><span class="widget-kicker">Pay calendar</span><h2>Upcoming Deadlines</h2><p>Release-critical dates in the next seven days.</p></div>
        {rows.length > 0 && <span class="pill amber">{rows.length} due</span>}
      </div>
      <div class="pcc-cal">
        <div class="pcc-cal-month">{today.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}</div>
        <div class="pcc-cal-strip" aria-label="Payroll deadlines this week">
          {days.map(d => {
            const isToday = d.getTime() === today.getTime();
            const isOn = d.getTime() === selected.getTime();
            const has = onDay(d).length > 0;
            return (
              <button type="button" key={d.getTime()}
                class={`pcc-cal-day${isOn ? ' is-on' : ''}${isToday ? ' is-today' : ''}${has ? ' has-deadline' : ''}`}
                onClick={() => setSelectedTs(d.getTime())}>
                <span>{d.toLocaleDateString('en-GB', { weekday: 'short' })}</span>
                <strong>{d.getDate()}</strong>
              </button>
            );
          })}
        </div>
        <div class="pcc-cal-list">
          {selectedRows.length === 0 ? (
            <div class="pcc-cal-empty">
              <i class="fa-regular fa-calendar-check pcc-cal-empty-ic" />
              <div class="pcc-cal-empty-t">No deadlines on {selected.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</div>
              <div class="pcc-cal-empty-s">Days with an amber marker have release-critical dates — select one to view it.</div>
            </div>
          ) : selectedRows.map(d => {
            const pill = DEADLINE_PILL[d.state];
            return (
              <button type="button" key={d.id} class="pcc-cal-item" onClick={() => onOpen(d.runId)}>
                <span class={`pcc-cal-dot pcc-cal-dot--${pill.cls}`} />
                <div class="pcc-cal-copy"><div class="pcc-cal-t">{d.title}</div><div class="pcc-cal-s">Run {d.runNo} · {DEADLINE_LABEL[d.kind]}</div></div>
                <span class={`pill ${pill.cls}`}>{pill.label}</span>
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}

// ── Release readiness widget (mockup .pay-widget-readiness) ────────────────────
function ReadinessWidget({ data, onOpen }: { data?: PayrollControlCenterResponse; onOpen: (id: string) => void }): VNode {
  const n = data?.nextScheduledRun;
  if (!n) {
    return (
      <section class="card pay-widget pay-widget-readiness">
        <div class="readiness-profile-hero">
          <div class="readiness-profile-head">
            <div class="readiness-profile-title"><span class="readiness-profile-icon"><i class="fa-solid fa-calendar-check" /></span><div><span class="widget-kicker">Next scheduled run</span><h2>Release Readiness</h2></div></div>
          </div>
        </div>
        <div class="readiness-empty"><i class="fa-solid fa-calendar-xmark" /><span>No scheduled run in this window.</span></div>
      </section>
    );
  }
  const r = n.readiness;
  const im = n.releaseImpact;
  const statusCls = r.state === 'ready' || r.state === 'released' ? 'is-ready' : '';
  return (
    <section class="card pay-widget pay-widget-readiness">
      <div class="readiness-profile-hero">
        <div class="readiness-profile-head">
          <div class="readiness-profile-title"><span class="readiness-profile-icon"><i class="fa-solid fa-calendar-check" /></span><div><span class="widget-kicker">Next scheduled run</span><h2>Release Readiness</h2></div></div>
          <span class={`readiness-profile-status ${statusCls}`}><i />{humanize(r.state)}</span>
        </div>
        <div class="readiness-overview">
          <ReadinessDoughnut passed={r.passed} applicable={r.applicable} state={r.state} />
          <div class="readiness-identity">
            <strong class="readiness-identity-name">{n.run.payGroup.name ?? 'Scheduled run'}</strong>
            <div class="readiness-reference"><span class="readiness-run-id">{n.run.runNo}</span><span>{r.percent}% controls passing</span></div>
            <div class="readiness-meta"><span><i class="fa-regular fa-calendar" />{fmtDay(n.run.payDate)}</span><i class="readiness-meta-sep" /><span><i class="fa-solid fa-users" />{n.run.employeeCount} employees</span></div>
          </div>
        </div>
      </div>
      <div class="readiness-profile-stats" aria-label="Release readiness facts">
        <div><small>Pay population</small><strong>{im.employees}</strong></div>
        <div><small>Net exposed</small><strong>{fmtTTDc(im.net.amount)}</strong></div>
        <div><small>Funding Gap</small><strong class={im.fundingGap.amount > 0 ? 'bad' : ''}>{fmtTTDc(im.fundingGap.amount)}</strong></div>
      </div>
      <div class="readiness-gates-head"><span>Release controls</span><button type="button" class="linklike" onClick={() => onOpen(n.run.id)}>Open workspace <i class="fa-solid fa-arrow-right" /></button></div>
      <div class="readiness-gates">
        {r.gates.map(g => {
          const gs = GATE_STATE[g.state];
          const Tag: 'button' | 'div' = g.targetId ? 'button' : 'div';
          return (
            <Tag key={g.key} class="gate-row" {...(g.targetId ? { type: 'button', onClick: () => onOpen(n.run.id) } : {})}>
              <span class={`gate-state ${gs.cls}`}><i class={`fa-solid ${gs.icon}`} /></span>
              <div class="gate-copy"><strong>{g.label}</strong><small>{g.detail}</small></div>
              <span class={`gate-value ${gs.cls === 'ok' ? '' : gs.cls}`}>{gs.value}</span>
            </Tag>
          );
        })}
      </div>
    </section>
  );
}

// ── Release impact widget (mockup .pay-widget-impact) ──────────────────────────
function ImpactWidget({ data, onOpen }: { data?: PayrollControlCenterResponse; onOpen: (id: string) => void }): VNode {
  const n = data?.nextScheduledRun;
  const im = n?.releaseImpact;
  return (
    <section class="card pay-widget pay-widget-impact">
      <div class="widget-head">
        <div><span class="widget-kicker">{n?.run.payGroup.name ?? 'Next scheduled run'}</span><h2>Release Impact</h2><p>What is exposed if the next scheduled payroll misses its release controls.</p></div>
        {im && im.fundingGap.amount > 0 && <span class="pill red">Funding Gap</span>}
      </div>
      {n && im ? (
        <>
          <div class="impact-overview">
            <div class="impact-run"><span>Release at risk</span><strong>{n.run.runNo}</strong><small>{fmtDay(n.run.payDate)} pay date</small></div>
            <div><span>Employees exposed</span><strong>{im.employees}</strong><small>Scheduled population</small></div>
            <div><span>Net payroll exposed</span><strong>{fmtTTDc(im.net.amount)}</strong><small>Bank release control total</small></div>
            <div><span>Funding Gap</span><strong>{fmtTTDc(im.fundingGap.amount)}</strong><small>Treasury confirmation</small></div>
          </div>
          <div class="impact-path" aria-label="Release control path">
            {n.readiness.gates.slice(0, 4).map(g => {
              const cls = g.state === 'pass' ? 'ok' : g.state === 'warning' ? 'warn' : g.state === 'fail' ? 'bad' : 'ok';
              const Tag: 'button' | 'div' = g.targetId ? 'button' : 'div';
              return (
                <Tag key={g.key} class={`impact-step ${cls}`} {...(g.targetId ? { type: 'button', onClick: () => onOpen(n.run.id) } : {})}>
                  <span><i class={`fa-solid ${g.state === 'pass' ? 'fa-check' : g.state === 'fail' ? 'fa-xmark' : 'fa-clock'}`} /></span>
                  <div><small>{g.label}</small><strong>{GATE_STATE[g.state].value}</strong><em>{g.detail}</em></div>
                </Tag>
              );
            })}
          </div>
          <div class="widget-foot"><span>Critical controls override readiness percentage.</span></div>
        </>
      ) : <div class="impact-empty">No scheduled run to project.</div>}
    </section>
  );
}
