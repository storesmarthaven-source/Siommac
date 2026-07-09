/**
 * src/components/sections/Finance/StatutoryDashboard.tsx
 *
 * Statutory Configuration dashboard — a self-contained enterprise page (its own
 * `.sdb` design system) rendered directly by StatutoryConfigOverview. Not a widget.
 *
 * Layout (matches conv-statutory-config-dashboard.html mockup):
 *   Header  →  6 stat cards  →  middle row (combo chart | readiness donut | upcoming dates)
 *   Bottom  →  tabbed table (Rate Versions / NIS / Components / Verify / Reports) + side stack
 *
 * Data binding notes (be honest — no fake numbers):
 *   REAL:
 *     - Active Version label + effective date         ← activeVer
 *     - Draft Versions count                          ← drafts
 *     - Pay Components count + inactive count         ← components / activeComponents
 *     - Verification Queue count                      ← verifyQueue
 *     - Pending Approvals count                       ← pending
 *     - Upcoming Effective Dates list                 ← versions with future effectiveFrom
 *     - Recent Activity list                          ← activityItems
 *     - Readiness donut segments                      ← version status distribution
 *     - NIS Classes count in stat card                ← activeNisClasses.length
 *     - Verification-queue breakdown (Missing NIS Numbers / Opening-Balance
 *       Anomalies)                                    ← derived from pending profiles
 *
 *   DERIVED (computed from real data, not server-authored — clearly labelled):
 *     - Readiness lenses (Config Completeness / NIS Verification / Payroll)
 *                                                     ← booleans + ratios over the
 *                                                       active version's real config
 */

import { type VNode, type ComponentChildren } from 'preact';
import { useMemo, useState, useEffect, useRef } from 'preact/hooks';
import {
  type StatutoryVersion, type PayComponent, type NisClass,
} from '@api/finance/statutory';
import { type ActivityItem } from '@ui';
import {
  WidgetBoard, WidgetBoardToolbar, WidgetLibraryModal, useBoardLayout, WIDGET_REGISTRY, commitPreviewWidget,
  type BoardLayout, type LocalWidgetMap, type PreviewWidgetInstance, type WidgetInstance, type WidgetSizeDef, type WidgetSizeKey,
} from '@ui/widgets';
import { can } from '@lib/permissions';
import { useSessionStore, selectIsManager, selectIsAdmin } from '@store/session';
import { fmtDate, fmtMoney, humanize } from './financeShared';

// Re-export so the parent can reference the same literal type without a second import.
export type MainTab = 'versions' | 'nis' | 'components' | 'verify' | 'reports';

const TABS: { key: MainTab; label: string }[] = [
  { key: 'versions',   label: 'Rate Versions' },
  { key: 'nis',        label: 'NIS Classes' },
  { key: 'components', label: 'Pay Components' },
  { key: 'verify',     label: 'NIS Verification' },
  { key: 'reports',    label: 'Reports' },
];

// ── Widget zone ────────────────────────────────────────────────────────────────
// The middle band is a movable/resizable board (per-user layout). The KPI strip,
// the NIS contribution chart and the register table stay FIXED (never widgets).
const PAGE_KEY = 'finance.statutory';
const W_SUMMARY   = 'finance.statutory.summary';
const W_KPI_ACTIVE     = 'finance.statutory.kpi.activeVersion';
const W_KPI_DRAFTS     = 'finance.statutory.kpi.drafts';
const W_KPI_COMPONENTS = 'finance.statutory.kpi.components';
const W_KPI_NIS        = 'finance.statutory.kpi.nisClasses';
const W_KPI_VERIFY     = 'finance.statutory.kpi.verifyQueue';
const W_KPI_APPROVALS  = 'finance.statutory.kpi.approvals';
const W_CHART     = 'finance.statutory.nisChart';
const W_READY     = 'finance.statutory.readiness';
const W_DEADLINES = 'finance.statutory.deadlines';
const W_VERIFY    = 'finance.statutory.verifyQueue';
const W_ACTIVITY  = 'finance.statutory.activity';
const W_REGISTER  = 'finance.statutory.register';

function defInst(widgetId: string, x: number, y: number, w: number, h: number, sizeKey: WidgetSizeKey): WidgetInstance {
  return { instanceId: `${widgetId}#def`, widgetId, pageKey: PAGE_KEY, zoneId: 'main', x, y, w, h, sizeKey, config: {} };
}
// 12-COLUMN grid. Summary strip → 6 onboarding-sized KPI cards (w3, fixed h11 ≈ 186px,
// non-resizable, 4+2) → FULL-WIDTH NIS rate chart → readiness/deadlines/verify/activity
// on one row (w3 each) → the register. rowHeight is a fine 6px; spacing a fixed 12px gap.
// Tile px ≈ 6·h + 12·(h−1) = 18h − 12.
function defaultStatutoryLayout(): BoardLayout {
  return {
    pageKey: PAGE_KEY,
    zones: {
      main: [
        defInst(W_SUMMARY,         0,   0, 12,  4, 'wide'),      // ≈ 60px  thin strip
        defInst(W_KPI_ACTIVE,      0,   4,  3, 11, 'compact'),   // ≈ 186px  KPI row 1 (4)
        defInst(W_KPI_DRAFTS,      3,   4,  3, 11, 'compact'),
        defInst(W_KPI_COMPONENTS,  6,   4,  3, 11, 'compact'),
        defInst(W_KPI_NIS,         9,   4,  3, 11, 'compact'),
        defInst(W_KPI_VERIFY,      0,  15,  3, 11, 'compact'),   // KPI row 2 (2)
        defInst(W_KPI_APPROVALS,   3,  15,  3, 11, 'compact'),
        defInst(W_CHART,           0,  26, 12, 30, 'large'),     // FULL WIDTH ≈ 528px
        defInst(W_READY,           0,  56,  3, 24, 'standard'),  // info row (4 × w3)
        defInst(W_DEADLINES,       3,  56,  3, 24, 'standard'),
        defInst(W_VERIFY,          6,  56,  3, 24, 'standard'),
        defInst(W_ACTIVITY,        9,  56,  3, 24, 'standard'),
        defInst(W_REGISTER,        0,  80, 12, 46, 'hero'),      // ≈ 816px
      ],
    },
  };
}

export interface StatutoryDashboardProps {
  // ── Data ──────────────────────────────────────────────────────────────────
  versions: StatutoryVersion[];
  components: PayComponent[];
  activeVer: StatutoryVersion | null;
  /** NIS bands of the active version — powers the NIS contribution schedule chart. */
  activeNisClasses: NisClass[];
  /** Count of verified NIS profiles — for the NIS Verification readiness lens. */
  verifiedNisCount: number;
  drafts: number;
  pending: number;
  activeComponents: number;
  verifyQueue: number;
  /** Real sub-counts of the pending verification queue (derived in the parent). */
  verifyBreakdown: { missingNisNumbers: number; openingAnomalies: number };
  activityItems: ActivityItem[];
  versionsLoading: boolean;
  // ── Quick-action handler — the readiness card's CTA opens the Verify tab. ──
  onVerifyNis: () => void;
  // ── Tab state (owned by parent so drawer/edit dialogs stay synced) ────────
  tab: MainTab;
  onTabChange: (t: MainTab) => void;
  // Fully-wired tab content rendered by the parent (VersionsTab / NisClassesTab / …)
  tabContent: VNode;
}

// ── SVG helpers ────────────────────────────────────────────────────────────────

/** Semicircle gauge (solid track + colored fill) — matches the obv MetricGauge.
 *  The fill sweeps LEFT→RIGHT from 0 to the value; the value shows in the copy. */
function HalfGauge({ pct, color }: { pct: number; color: string }): VNode {
  const p = Math.max(0, Math.min(100, pct));
  const rest = 100 - p; // dashoffset that reveals exactly the first p units (left→right)
  const ARC = 'M17 62 A42 42 0 0 1 101 62';
  const fillRef = useRef<SVGPathElement>(null);

  useEffect(() => {
    const el = fillRef.current;
    if (!el) return;
    const reduce = typeof window !== 'undefined' && window.matchMedia
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) return; // element already rests at the correct offset via the attribute
    const anim = el.animate(
      [{ strokeDashoffset: 100 }, { strokeDashoffset: rest }],
      { duration: 1300, easing: 'cubic-bezier(0.16, 1, 0.3, 1)', delay: 80, fill: 'forwards' },
    );
    return () => anim.cancel();
  }, [rest]);

  return (
    <div class="sdb-gauge">
      <svg viewBox="0 0 118 78">
        <path d={ARC} pathLength={100} fill="none" stroke="#e9edf4" strokeWidth={13} strokeLinecap="round" />
        <path ref={fillRef} d={ARC} pathLength={100} fill="none" stroke={color} strokeWidth={13}
          strokeLinecap="round" strokeDasharray="100" strokeDashoffset={rest} />
      </svg>
    </div>
  );
}

// ── Activity icon helper ────────────────────────────────────────────────────────

function actIcon(icon: string): { bg: string; color: string; fa: string } {
  switch (icon) {
    case 'check':  return { bg: '#e4f8ea', color: '#16a34a', fa: 'fa-bolt' };
    case 'upload': return { bg: '#eaf1fe', color: '#2563eb', fa: 'fa-file-import' };
    case 'gavel':  return { bg: '#f2effe', color: '#8b5cf6', fa: 'fa-layer-group' };
    default:       return { bg: '#fdf3e0', color: '#f59e0b', fa: 'fa-clock' };
  }
}

// ── Time-ago helper ────────────────────────────────────────────────────────────

function timeAgo(isoOrLabel: string): string {
  // activityItems already have a `meta` string like "Active · 01 Jan 2025" — just show it
  return isoOrLabel;
}

// ── Main component ─────────────────────────────────────────────────────────────

export function StatutoryDashboard({
  versions, components, activeVer, activeNisClasses, verifiedNisCount, drafts, pending, activeComponents, verifyQueue,
  verifyBreakdown, activityItems, versionsLoading,
  onVerifyNis,
  tab, onTabChange, tabContent,
}: StatutoryDashboardProps): VNode {

  const inactiveComponents = components.length - activeComponents;

  // ── Statutory compliance calendar (REAL recurring T&T deadlines) ────────────
  // NIS + PAYE/HS remit on the 15th of each month; TD4 certificates file by 28 Feb.
  const today = new Date();
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const [weekStart, setWeekStart] = useState<Date>(startOfToday);
  const [selectedDay, setSelectedDay] = useState<Date>(startOfToday);

  const weekDays = useMemo(
    () => Array.from({ length: 7 }, (_, i) => { const d = new Date(weekStart); d.setDate(weekStart.getDate() + i); return d; }),
    [weekStart],
  );
  const sameDay = (a: Date, b: Date): boolean =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  const deadlinesOn = (d: Date): { title: string; note: string; tagLabel: string; tagCls: string }[] => {
    const out: { title: string; note: string; tagLabel: string; tagCls: string }[] = [];
    if (d.getDate() === 15) {
      out.push({ title: 'NIS Contribution Remittance', note: 'Monthly payment to NIBTT', tagLabel: 'NIS', tagCls: 'sdb-tag--upcoming' });
      out.push({ title: 'PAYE & Health Surcharge',     note: 'Monthly return to BIR',    tagLabel: 'BIR', tagCls: 'sdb-tag--pending' });
    }
    if (d.getMonth() === 1 && d.getDate() === 28) {
      out.push({ title: 'TD4 Certificates & Summary', note: 'Annual filing to BIR', tagLabel: 'Annual', tagCls: 'sdb-tag--planned' });
    }
    return out;
  };
  const selectedDeadlines = deadlinesOn(selectedDay);
  const shiftWeek = (dir: -1 | 1): void => {
    const d = new Date(weekStart); d.setDate(d.getDate() + dir * 7);
    setWeekStart(d); setSelectedDay(d);
  };

  // ── Statutory readiness lenses (switchable via ‹ ›) ─────────────────────────
  const [readyLens, setReadyLens] = useState(0);
  const readiness = useMemo(() => {
    // Config completeness — booleans over the active version's configuration.
    const checks = [
      !!activeVer,
      activeNisClasses.length > 0,
      !!activeVer && activeVer.payePersonalAllowance > 0 && activeVer.payeBand1Rate > 0 && activeVer.payeBand2Rate > 0,
      !!activeVer && activeVer.hsWeeklyHigh >= 0 && activeVer.hsWeeklyLow >= 0 && activeVer.hsMonthlyThreshold > 0,
      !!activeVer && activeVer.nisMonthyCeiling != null,
      components.some(c => c.isStatutory && c.isActive),
    ];
    const passed = checks.filter(Boolean).length;
    const configPct = Math.round((passed / checks.length) * 100);
    // NIS verification — verified vs (verified + pending) among submitted profiles.
    const verifyTotal = verifiedNisCount + verifyQueue;
    const verifyPct = verifyTotal === 0 ? 100 : Math.round((verifiedNisCount / verifyTotal) * 100);
    // Payroll readiness — the weakest gate (both must be high to run cleanly).
    const payrollPct = Math.min(configPct, verifyPct);
    return [
      {
        title: 'Config Completeness', color: '#16a34a', icon: 'fa-clipboard-check', pct: configPct,
        subtitle: 'PAYE, NIS & Health Surcharge on the active version.',
        sub: `${passed} of ${checks.length} configuration items set`,
        stats: [{ label: 'NIS Classes', value: String(activeNisClasses.length) }, { label: 'Pay Components', value: String(activeComponents) }],
        cta: 'Open active version', onCta: () => onTabChange('nis'),
      },
      {
        title: 'NIS Verification', color: '#2f5fe0', icon: 'fa-user-check', pct: verifyPct,
        subtitle: 'Employee NIS profiles cleared for payroll.',
        sub: verifyTotal === 0 ? 'No profiles awaiting verification' : `${verifiedNisCount} verified · ${verifyQueue} pending`,
        stats: [{ label: 'Verified', value: String(verifiedNisCount) }, { label: 'Pending', value: String(verifyQueue) }],
        cta: 'Open verification', onCta: onVerifyNis,
      },
      {
        title: 'Payroll Readiness', color: '#12b3a6', icon: 'fa-money-check-dollar', pct: payrollPct,
        subtitle: 'Ready to run a clean payroll cycle.',
        sub: `Config ${configPct}% · Verification ${verifyPct}%`,
        stats: [{ label: 'Config', value: `${configPct}%` }, { label: 'Verified NIS', value: `${verifyPct}%` }],
        cta: 'Review readiness', onCta: onVerifyNis,
      },
    ];
  }, [activeVer, activeNisClasses.length, components, activeComponents, verifiedNisCount, verifyQueue, onTabChange, onVerifyNis]);
  const lens = readiness[readyLens] ?? readiness[0]!;

  // Active version's earnings classes (sorted) — powers the summary class count and
  // the active-rate figure below.
  const nis = useMemo(() => ({ rows: [...activeNisClasses].sort((a, b) => a.classNo - b.classNo) }), [activeNisClasses]);

  // ── NIS contribution-rate trend across ALL versions (rate over time) ────────
  // Real historical data — each version's headline rate (nisRatePercent, computed
  // server-side from its earnings classes), plotted by schedule year.
  const rateTrend = useMemo(() => {
    const pts = versions
      .filter(v => v.nisRatePercent != null)
      .map(v => ({ id: v.id, year: v.effectiveFrom.slice(0, 4), rate: v.nisRatePercent as number, isActive: v.isActive, effectiveFrom: v.effectiveFrom, status: v.status }))
      .sort((a, b) => (a.year < b.year ? -1 : a.year > b.year ? 1 : 0));
    const rates = pts.map(p => p.rate);
    const lo = rates.length ? Math.floor(Math.min(...rates)) - 1 : 0;
    const hi = rates.length ? Math.ceil(Math.max(...rates)) + 1 : 20;
    return { pts, lo, hi };
  }, [versions]);
  // Hovered data point on the rate-trend chart (index into rateTrend.pts) → tooltip.
  const [chartHover, setChartHover] = useState<number | null>(null);

  // Active-version contribution rate derived from the data (total ÷ assumed average).
  const nisRatePct = (() => {
    const c = nis.rows.find(r => r.assumedAverageWeekly && r.assumedAverageWeekly > 0);
    if (!c || !c.assumedAverageWeekly) return null;
    return Math.round(((c.employeeWeekly + c.employerWeekly) / c.assumedAverageWeekly) * 1000) / 10;
  })();

  // ── Activity icon lookup ──────────────────────────────────────────────────────
  // activityItems come from parent (derived from versions list)

  // ── Widget board (Readiness / Upcoming Deadlines / Verify Queue / Activity) ──
  // Per-user movable/resizable zone. Only managers/admins may customize it.
  const canEditBoard = useSessionStore(selectIsManager);
  const isAdmin      = useSessionStore(selectIsAdmin);
  const [editing, setEditing] = useState(false);
  const [libOpen, setLibOpen] = useState(false);
  const [demo, setDemo]       = useState(false);
  const [preview, setPreview] = useState<PreviewWidgetInstance | null>(null);
  const { layout, addWidget, setAsDefault, resetLayout } = useBoardLayout(PAGE_KEY, defaultStatutoryLayout());
  const boardItems = layout.zones['main'] ?? [];
  const placedWidgetIds = boardItems.map(w => w.widgetId);
  const placeBottom = <T extends { x: number; y: number }>(w: T): T =>
    ({ ...w, x: 0, y: Math.max(0, ...boardItems.map(i => i.y + i.h)) });
  const userPermissions = useMemo(
    () => Array.from(new Set(WIDGET_REGISTRY.flatMap(w => w.dataSource.permissions))).filter(can),
    [],
  );
  function discardPreview(): void { setPreview(null); setLibOpen(true); }
  function commitPreview(p: PreviewWidgetInstance): void { void addWidget(p.zoneId, commitPreviewWidget(p)); setPreview(null); }

  // Full-width statutory summary bar (redesigned) — PAYE / NIS / Health Surcharge
  // for the active version, as evenly-spread labelled segments.
  const renderSummary = (): VNode => (
    <div class="sdb-card sdb-sumbar sdb-wgt-fill">
      {!activeVer ? (
        <div class="sdb-sumbar-empty">No active statutory version — activate one to see the summary.</div>
      ) : (
        <>
          <div class="sdb-sumbar-seg">
            <i class="fa-solid fa-percent sdb-sumbar-i sdb-sumbar-i--blue" />
            <span class="sdb-sumbar-k">PAYE</span>
            <span class="sdb-sumbar-v">{Math.round(activeVer.payeBand1Rate * 100)}% / {Math.round(activeVer.payeBand2Rate * 100)}%</span>
            <span class="sdb-sumbar-s">allowance {fmtMoney(activeVer.payePersonalAllowance)}</span>
          </div>
          <div class="sdb-sumbar-seg">
            <i class="fa-solid fa-scale-balanced sdb-sumbar-i sdb-sumbar-i--teal" />
            <span class="sdb-sumbar-k">NIS</span>
            <span class="sdb-sumbar-v">{nisRatePct != null ? `${nisRatePct}%` : '—'} · {nis.rows.length} classes</span>
            <span class="sdb-sumbar-s">{activeVer.nisMonthyCeiling ? `ceiling ${fmtMoney(activeVer.nisMonthyCeiling)}/mo` : 'no ceiling'}</span>
          </div>
          <div class="sdb-sumbar-seg">
            <i class="fa-solid fa-heart-pulse sdb-sumbar-i sdb-sumbar-i--amber" />
            <span class="sdb-sumbar-k">Health Surcharge</span>
            <span class="sdb-sumbar-v">{fmtMoney(activeVer.hsWeeklyHigh)} / {fmtMoney(activeVer.hsWeeklyLow)}/wk</span>
            <span class="sdb-sumbar-s">over / under {fmtMoney(activeVer.hsMonthlyThreshold)}/mo</span>
          </div>
        </>
      )}
    </div>
  );

  // Rich KPI tile (onboarding-sized) — colored icon chip + uppercase caption,
  // large value, context sub-line with a status dot. `text` variant sizes the
  // value down for label-style values (e.g. the active version name).
  const Kpi = (p: {
    icon: string; color: string; cap: string; value: ComponentChildren; sub: ComponentChildren;
    text?: boolean; onClick?: () => void;
  }): VNode => (
    <div
      class={`sdb-card sdb-kpi sdb-wgt-fill sdb-kpi--${p.color}${p.text ? ' sdb-kpi--text' : ''}${p.onClick ? ' sdb-kpi--clickable' : ''}`}
      {...(p.onClick ? { role: 'button', tabIndex: 0, onClick: p.onClick,
        onKeyDown: (e: KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') p.onClick!(); } } : {})}>
      {/* Large faded watermark icon (fills the card the way the onboarding spark does). */}
      <i class={`fa-solid ${p.icon} sdb-kpi-watermark sdb-kpi-ic--${p.color}`} aria-hidden="true" />
      <div class="sdb-kpi-body">
        <div class="sdb-kpi-top">
          <span class={`sdb-kpi-ic sdb-kpi-ic--${p.color}`}><i class={`fa-solid ${p.icon}`} /></span>
          <span class="sdb-kpi-cap">{p.cap}</span>
        </div>
        <div class="sdb-kpi-val">{p.value}</div>
        <div class="sdb-kpi-sub">{p.sub}</div>
      </div>
    </div>
  );

  const renderKpiActive = (): VNode => (
    <Kpi icon="fa-file-lines" color="blue" cap="Active Version" text
      value={versionsLoading ? '…' : (activeVer?.label ?? '—')}
      sub={activeVer
        ? <><span class="sdb-dot sdb-dot--green" />Effective {fmtDate(activeVer.effectiveFrom)}</>
        : 'No active version'} />
  );
  const renderKpiDrafts = (): VNode => (
    <Kpi icon="fa-pen-to-square" color="purple" cap="Draft Versions"
      value={versionsLoading ? '…' : drafts}
      sub={pending > 0 ? `${pending} awaiting review` : 'None awaiting review'} />
  );
  const renderKpiComponents = (): VNode => (
    <Kpi icon="fa-layer-group" color="teal" cap="Pay Components"
      value={activeComponents} sub={`${inactiveComponents} inactive`} />
  );
  const renderKpiNis = (): VNode => (
    <Kpi icon="fa-users" color="blue" cap="NIS Classes" onClick={() => onTabChange('nis')}
      value={activeVer ? activeNisClasses.length : '—'}
      sub={activeVer
        ? <><span class="sdb-dot sdb-dot--green" />On {activeVer.label}</>
        : 'No active version'} />
  );
  const renderKpiVerify = (): VNode => (
    <Kpi icon="fa-clock" color="amber" cap="Verification Queue"
      onClick={verifyQueue > 0 ? () => onTabChange('verify') : undefined}
      value={verifyQueue}
      sub={verifyQueue > 0 ? <><span class="sdb-dot sdb-dot--amber" />Needs attention</> : 'Queue clear'} />
  );
  const renderKpiApprovals = (): VNode => (
    <Kpi icon="fa-user-check" color="coral" cap="Pending Approvals"
      value={pending}
      sub={pending > 0 ? `Across ${pending} item${pending !== 1 ? 's' : ''}` : 'None pending'} />
  );

  // NIS contribution RATE over time — a real trend across the seeded schedule history
  // (10.5% 2008 → 16.2% 2026), which a per-class bar chart could never show.
  const renderChart = (): VNode => {
    const P = { x0: 58, x1: 496, yTop: 34, yBase: 244 };
    const { pts, lo, hi } = rateTrend;
    const span = Math.max(1, hi - lo);
    const yFor = (r: number): number => P.yBase - ((r - lo) / span) * (P.yBase - P.yTop);
    const xFor = (i: number): number => pts.length <= 1 ? (P.x0 + P.x1) / 2 : P.x0 + (i / (pts.length - 1)) * (P.x1 - P.x0);
    const grid = Array.from({ length: 5 }, (_, i) => { const val = lo + (span * i) / 4; return { val, y: yFor(val) }; });
    const first = pts[0];
    const last = pts[pts.length - 1];
    const areaD = pts.length
      ? `M ${xFor(0)} ${P.yBase} ` + pts.map((p, i) => `L ${xFor(i)} ${yFor(p.rate)}`).join(' ') + ` L ${xFor(pts.length - 1)} ${P.yBase} Z`
      : '';
    const lineD = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${xFor(i)} ${yFor(p.rate)}`).join(' ');
    return (
      <div class="sdb-card sdb-ch sdb-wgt-fill">
        <div class="sdb-ch-hd">
          <h2>NIS Contribution Rate</h2>
          <i class="fa-solid fa-circle-info sdb-info-ic" />
          <div class="sdb-ch-tools">
            <span class="sdb-pill-sel">
              <i class="fa-solid fa-arrow-trend-up" /> {first && last ? `${first.year}–${last.year}` : 'History'}
            </span>
          </div>
        </div>
        <div class="sdb-sum-body">
          <div>
            {pts.length === 0 ? (
              <div class="sdb-up-empty" style={{ padding: '48px 0' }}>No NIS schedules on record yet.</div>
            ) : (
              <svg viewBox="0 0 520 300" width="100%" style={{ display: 'block' }}>
                {/* Gridlines + left axis (%) */}
                <g fontSize="10" fill="#9aa4b6" textAnchor="end">
                  {grid.map((g, i) => <text key={i} x={P.x0 - 8} y={g.y + 3}>{g.val.toFixed(1)}%</text>)}
                </g>
                <g stroke="#eef1f7" strokeWidth="1">
                  {grid.map((g, i) => <line key={i} x1={P.x0} y1={g.y} x2={P.x1} y2={g.y} />)}
                </g>
                {/* Area + trend line */}
                {areaD && <path d={areaD} fill="rgba(47,95,224,.09)" />}
                <path d={lineD} fill="none" stroke="#2f5fe0" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
                {/* Hover guide line for the active point */}
                {chartHover != null && pts[chartHover] && (
                  <line x1={xFor(chartHover)} y1={P.yTop} x2={xFor(chartHover)} y2={P.yBase} stroke="#c9d6f0" strokeWidth="1" strokeDasharray="3 3" />
                )}
                {/* Points + labels (active version highlighted; hovered point enlarged) */}
                {pts.map((p, i) => {
                  const on = chartHover === i;
                  return (
                    <g key={p.id}>
                      <circle cx={xFor(i)} cy={yFor(p.rate)} r={p.isActive || on ? 6 : 4}
                        fill={p.isActive || on ? '#2f5fe0' : '#ffffff'} stroke="#2f5fe0" strokeWidth="2" />
                      <text x={xFor(i)} y={yFor(p.rate) - 12} textAnchor="middle" fontSize="10.5" fontWeight="700" fill="#1f3b6d">{p.rate}%</text>
                      <text x={xFor(i)} y={P.yBase + 18} textAnchor="middle" fontSize="10" fill={on ? '#2f5fe0' : '#8593a8'} fontWeight={on ? '700' : '400'}>{p.year}</text>
                      {/* Invisible larger hit-area for easy hovering */}
                      <circle cx={xFor(i)} cy={yFor(p.rate)} r="16" fill="transparent" style={{ cursor: 'pointer' }}
                        onMouseEnter={() => setChartHover(i)} onMouseLeave={() => setChartHover(h => (h === i ? null : h))} />
                    </g>
                  );
                })}
                <line x1={P.x0} y1={P.yBase} x2={P.x1} y2={P.yBase} stroke="#d7deea" strokeWidth="1" />
                <text x={(P.x0 + P.x1) / 2} y="286" textAnchor="middle" fontSize="10.5" fill="#7a8698">NIS contribution rate by schedule year</text>
                {/* Tooltip at the hovered data point */}
                {chartHover != null && pts[chartHover] && (() => {
                  const p = pts[chartHover]!;
                  const cx = xFor(chartHover), cy = yFor(p.rate);
                  const tw = 132, th = 42;
                  const tx = Math.min(Math.max(cx - tw / 2, 4), 520 - tw - 4);
                  const ty = cy - th - 16 < P.yTop ? cy + 14 : cy - th - 16;
                  return (
                    <g pointerEvents="none">
                      <rect x={tx} y={ty} width={tw} height={th} rx="7" fill="#17305c" />
                      <text x={tx + 11} y={ty + 17} fontSize="11" fontWeight="700" fill="#ffffff">{fmtDate(p.effectiveFrom)}</text>
                      <text x={tx + 11} y={ty + 32} fontSize="10.5" fill="#c9d6f0">{p.rate}% · {p.isActive ? 'Active' : humanize(p.status)}</text>
                    </g>
                  );
                })()}
              </svg>
            )}
          </div>
          {/* Compact info cards (right of the chart) — icon + label + value. */}
          <div class="sdb-mini">
            <div class="sdb-mini-item">
              <span class="sdb-fact-ic sdb-fact-ic--blue"><i class="fa-solid fa-percent" /></span>
              <div class="sdb-mini-txt">
                <span class="sdb-mini-k">Active rate</span>
                <span class="sdb-mini-vv">{nisRatePct != null ? `${nisRatePct}%` : '—'}</span>
              </div>
            </div>
            {first && last && last.rate !== first.rate && (
              <div class="sdb-mini-item">
                <span class="sdb-fact-ic sdb-fact-ic--teal"><i class="fa-solid fa-arrow-trend-up" /></span>
                <div class="sdb-mini-txt">
                  <span class="sdb-mini-k">Since {first.year}</span>
                  <span class="sdb-mini-vv">{last.rate > first.rate ? '+' : ''}{(last.rate - first.rate).toFixed(1)} pts</span>
                </div>
              </div>
            )}
            <div class="sdb-mini-item">
              <span class="sdb-fact-ic sdb-fact-ic--amber"><i class="fa-solid fa-layer-group" /></span>
              <div class="sdb-mini-txt">
                <span class="sdb-mini-k">Schedules on record</span>
                <span class="sdb-mini-vv">{pts.length}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  };

  const renderRegister = (): VNode => (
    <div class="sdb-card sdb-table-card sdb-wgt-fill">
      {/* Tab strip */}
      <div class="sdb-tabs">
        {TABS.map(t => (
          <button key={t.key} type="button"
            class={`sdb-tab${tab === t.key ? ' sdb-tab--on' : ''}`}
            onClick={() => onTabChange(t.key)}>
            {t.label}
            {t.key === 'verify' && verifyQueue > 0 && (
              <span class="sdb-tab-badge">{verifyQueue}</span>
            )}
          </button>
        ))}
      </div>
      {/* Tab content (rendered by parent) */}
      <div class="sdb-tab-body">
        {tabContent}
      </div>
    </div>
  );

  const renderReadiness = (): VNode => (
    <div class="sdb-card sdb-ch sdb-ready sdb-wgt-fill">
      <div class="sdb-ready-head">
        <span class="sdb-ready-icon" style={{ color: lens.color }}><i class={`fa-solid ${lens.icon}`} /></span>
        <div class="sdb-ready-htext">
          <h2>{lens.title}</h2>
          <p>{lens.subtitle}</p>
        </div>
        <div class="sdb-ready-nav-group">
          <button type="button" class="sdb-ready-nav" aria-label="Previous readiness view"
            onClick={() => setReadyLens(l => (l + readiness.length - 1) % readiness.length)}>
            <i class="fa-solid fa-chevron-left" />
          </button>
          <button type="button" class="sdb-ready-nav" aria-label="Next readiness view"
            onClick={() => setReadyLens(l => (l + 1) % readiness.length)}>
            <i class="fa-solid fa-chevron-right" />
          </button>
        </div>
      </div>
      <div class="sdb-ready-score">
        <span class="sdb-ready-label">Current</span>
        <div class="sdb-gauge-wrap">
          <HalfGauge key={readyLens} pct={lens.pct} color={lens.color} />
          <div class="sdb-gauge-val" style={{ color: lens.color }}>{lens.pct}%</div>
        </div>
        <div class="sdb-ready-sub">{lens.sub}</div>
      </div>
      <div class="sdb-ready-grid">
        {lens.stats.map((s, i) => (
          <div key={i} class="sdb-ready-stat">
            <span>{s.label}</span>
            <strong>{s.value}</strong>
          </div>
        ))}
      </div>
      <div class="sdb-ready-dots" aria-hidden="true">
        {readiness.map((_, i) => (
          <span key={i} class={`sdb-ready-dot${i === readyLens ? ' is-on' : ''}`} />
        ))}
      </div>
      <button type="button" class="sdb-ready-cta" onClick={lens.onCta}>{lens.cta}</button>
    </div>
  );

  const renderDeadlines = (): VNode => (
    <div class="sdb-card sdb-ch sdb-cal sdb-wgt-fill">
      <div class="sdb-ch-hd">
        <i class="fa-regular fa-calendar" style={{ color: '#2f5fe0' }} />
        <h2 style={{ fontSize: 14 }}>Upcoming Deadlines</h2>
        <div class="sdb-ch-tools">
          <button type="button" class="sdb-ready-nav" aria-label="Previous week" onClick={() => shiftWeek(-1)}><i class="fa-solid fa-chevron-left" /></button>
          <button type="button" class="sdb-ready-nav" aria-label="Next week" onClick={() => shiftWeek(1)}><i class="fa-solid fa-chevron-right" /></button>
        </div>
      </div>
      <div class="sdb-cal-month">{weekStart.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}</div>
      <div class="sdb-cal-strip">
        {weekDays.map(d => {
          const on = sameDay(d, selectedDay);
          const isToday = sameDay(d, today);
          const has = deadlinesOn(d).length > 0;
          return (
            <button type="button" key={d.toISOString()}
              class={`sdb-cal-day${on ? ' is-on' : ''}${isToday ? ' is-today' : ''}${has ? ' has-deadline' : ''}`}
              onClick={() => setSelectedDay(new Date(d))}>
              <span>{d.toLocaleDateString('en-GB', { weekday: 'short' })}</span>
              <strong>{d.getDate()}</strong>
            </button>
          );
        })}
      </div>
      <div class="sdb-cal-list">
        {selectedDeadlines.length === 0 ? (
          <div class="sdb-up-empty">
            No statutory deadlines on {selectedDay.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}. NIS &amp; PAYE fall on the 15th; TD4 by 28 Feb.
          </div>
        ) : (
          selectedDeadlines.map((d, i) => (
            <div key={i} class="sdb-cal-item">
              <span class={`sdb-cal-dot ${d.tagCls}`} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div class="sdb-up-t">{d.title}</div>
                <div class="sdb-up-s">{d.note}</div>
              </div>
              <span class={`sdb-tag ${d.tagCls}`}>{d.tagLabel}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );

  const renderVerifyQueue = (): VNode => (
    <div class="sdb-card sdb-listcard sdb-wgt-fill">
      <div class="sdb-sc-hd">
        <i class="fa-regular fa-circle-check sdb-sc-lead" />
        <h3>Verification Queue</h3>
        <span class="sdb-view-all" onClick={() => onTabChange('verify')} role="button" tabIndex={0}>View all</span>
      </div>
      {verifyQueue === 0 ? (
        <div class="sdb-act-empty">Queue clear — all NIS profiles verified.</div>
      ) : (
        <>
          <div class="sdb-q-row">
            <span class="sdb-q-ic"><i class="fa-regular fa-circle-user" /></span>
            <span class="sdb-q-l">NIS Profiles Pending</span>
            <span class="sdb-q-n">{verifyQueue}</span>
          </div>
          <div class="sdb-q-row sdb-q-row--muted">
            <span class="sdb-q-ic"><i class="fa-solid fa-hashtag" /></span>
            <span class="sdb-q-l">Missing NIS Numbers</span>
            <span class="sdb-q-n">{verifyBreakdown.missingNisNumbers}</span>
          </div>
          <div class="sdb-q-row sdb-q-row--muted">
            <span class="sdb-q-ic"><i class="fa-solid fa-chart-line" /></span>
            <span class="sdb-q-l">Opening-Balance Anomalies</span>
            <span class="sdb-q-n">{verifyBreakdown.openingAnomalies}</span>
          </div>
          <div class="sdb-q-total">
            <span>Total pending</span><span>{verifyQueue}</span>
          </div>
        </>
      )}
    </div>
  );

  const renderActivity = (): VNode => (
    <div class="sdb-card sdb-listcard sdb-wgt-fill">
      <div class="sdb-sc-hd">
        <i class="fa-regular fa-calendar sdb-sc-lead" />
        <h3>Recent Activity</h3>
      </div>
      <div class="sdb-listcard-body">
        {activityItems.length === 0 ? (
          <div class="sdb-act-empty">No recent activity.</div>
        ) : (
          activityItems.slice(0, 5).map((item, i) => {
            const ic = actIcon(item.icon ?? '');
            return (
              <div key={i} class="sdb-act">
                <span class="sdb-act-ic" style={{ background: ic.bg, color: ic.color }}>
                  <i class={`fa-solid ${ic.fa}`} />
                </span>
                <div style={{ flex: 1 }}>
                  <div class="sdb-act-t">{item.title}</div>
                  <div class="sdb-act-s">{item.meta}</div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );

  // The 6 KPI tiles are `locked: true` → PINNED at the top (RGL static): fixed uniform
  // size (w3 × h11 ≈ 186px) like the Onboarding Overview KPIs, and they never move,
  // resize, or get displaced by other tiles. The remaining widgets ARE resizable and
  // each declares a resize FLOOR (allowedSizes → minGridFor); without one the generic
  // floor is 2 cells ≈ 22px on this fine 6px grid.
  const floor = (key: WidgetSizeKey, w: number, h: number): WidgetSizeDef[] =>
    [{ key, label: 'Default', grid: { w, h } }];
  const localWidgets: LocalWidgetMap = {
    [W_SUMMARY]:        { render: renderSummary,      chrome: 'none', title: 'Statutory Summary',        allowedSizes: floor('wide', 6, 4) },
    [W_KPI_ACTIVE]:     { render: renderKpiActive,    chrome: 'none', title: 'Active Version',           locked: true, allowedSizes: floor('compact', 3, 11) },
    [W_KPI_DRAFTS]:     { render: renderKpiDrafts,    chrome: 'none', title: 'Draft Versions',           locked: true, allowedSizes: floor('compact', 3, 11) },
    [W_KPI_COMPONENTS]: { render: renderKpiComponents,chrome: 'none', title: 'Pay Components',           locked: true, allowedSizes: floor('compact', 3, 11) },
    [W_KPI_NIS]:        { render: renderKpiNis,       chrome: 'none', title: 'NIS Classes',              locked: true, allowedSizes: floor('compact', 3, 11) },
    [W_KPI_VERIFY]:     { render: renderKpiVerify,    chrome: 'none', title: 'Verification Queue (KPI)', locked: true, allowedSizes: floor('compact', 3, 11) },
    [W_KPI_APPROVALS]:  { render: renderKpiApprovals, chrome: 'none', title: 'Pending Approvals',        locked: true, allowedSizes: floor('compact', 3, 11) },
    [W_CHART]:          { render: renderChart,        chrome: 'none', title: 'NIS Contribution Schedule', allowedSizes: floor('large', 6, 16) },
    [W_READY]:          { render: renderReadiness,    chrome: 'none', title: 'Statutory Readiness',      allowedSizes: floor('standard', 3, 24) },
    [W_DEADLINES]:      { render: renderDeadlines,    chrome: 'none', title: 'Upcoming Deadlines',       allowedSizes: floor('standard', 3, 12) },
    [W_VERIFY]:         { render: renderVerifyQueue,  chrome: 'none', title: 'Verification Queue',       allowedSizes: floor('standard', 3, 12) },
    [W_ACTIVITY]:       { render: renderActivity,     chrome: 'none', title: 'Recent Activity',          allowedSizes: floor('standard', 3, 12) },
    [W_REGISTER]:       { render: renderRegister,     chrome: 'none', title: 'Statutory Register',       allowedSizes: floor('hero', 6, 20) },
  };

  return (
    <div class="sdb">

      {/* ── Customize toolbar at the TOP of the page ───────────────────────── */}
      {canEditBoard && (
        <div class="sdb-board-tools">
          <WidgetBoardToolbar
            editing={editing} canSetDefault={isAdmin}
            onToggleEdit={() => setEditing(e => !e)}
            onOpenLibrary={() => setLibOpen(true)}
            onReset={() => void resetLayout()}
            onSetDefault={() => void setAsDefault()}
          />
        </div>
      )}
      {preview && (
        <div class="wmock-preview-banner">
          <span><i class="fas fa-eye" /> Previewing a widget — drag and resize it on the board, then add it or discard.</span>
        </div>
      )}
      <WidgetBoard pageKey={PAGE_KEY} zones={['main']} editing={editing && canEditBoard}
        localWidgets={localWidgets} defaultLayout={defaultStatutoryLayout()} demo={demo}
        cellHeight={6} gap={[12, 12]}
        preview={preview} onPreviewChange={setPreview}
        onCommitPreview={commitPreview} onDiscardPreview={discardPreview} />

      <WidgetLibraryModal open={libOpen} pageKey={PAGE_KEY} zoneId="main"
        placedWidgetIds={placedWidgetIds} userPermissions={userPermissions}
        demo={demo} onToggleDemo={() => setDemo(d => !d)}
        canManagePackages={isAdmin}
        onClose={() => setLibOpen(false)}
        onAddWidget={inst => addWidget('main', placeBottom(inst as WidgetInstance))}
        onPreviewOnBoard={p => setPreview(placeBottom(p))} />
    </div>
  );
}
