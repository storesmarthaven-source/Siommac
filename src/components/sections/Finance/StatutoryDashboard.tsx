/**
 * src/components/sections/Finance/StatutoryDashboard.tsx
 *
 * Statutory Configuration dashboard — a self-contained enterprise page (its own
 * `.sdb` design system) rendered directly by StatutoryConfigOverview. Not a widget.
 *
 * Layout: movable board — summary strip · 6 KPI cards · full-width NIS rate chart ·
 *   readiness (Config Completeness) + upcoming deadlines · then the tabbed register
 *   (Rate Versions / NIS / Components / Verify / Reports).
 *
 * Data binding notes (be honest — no fake numbers):
 *   REAL:
 *     - Active Version label + effective date         ← activeVer
 *     - Draft Versions count                          ← drafts
 *     - Pay Components count + inactive count         ← components / activeComponents
 *     - Verification Queue count                      ← verifyQueue
 *     - Pending Approvals count                       ← pending
 *     - Upcoming Effective Dates list                 ← versions with future effectiveFrom
 *     - Readiness gauge + 2 stats                     ← version status / config ratios
 *     - NIS Classes count in stat card                ← activeNisClasses.length
 *
 *   DERIVED (computed from real data, not server-authored — clearly labelled):
 *     - Readiness lenses (Config Completeness / NIS Verification / Payroll)
 *                                                     ← booleans + ratios over the
 *                                                       active version's real config
 */

import { type VNode, type ComponentChildren } from 'preact';
import { memo } from 'preact/compat';
import { useMemo, useState, useEffect, useRef } from 'preact/hooks';
import {
  Chart,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Filler,
  Tooltip,
  Legend,
} from 'chart.js';
import {
  type StatutoryVersion, type PayComponent, type NisClass,
} from '@api/finance/statutory';
import {
  WidgetBoard, WidgetBoardToolbar, WidgetLibraryModal, useBoardLayout, WIDGET_REGISTRY, commitPreviewWidget,
  type BoardLayout, type LocalWidgetMap, type PreviewWidgetInstance, type WidgetInstance, type WidgetSizeDef, type WidgetSizeKey,
} from '@ui/widgets';
import { LucideIcon } from '@ui/LucideIcon';
import { InfoTip } from '@ui/InfoTip';
import { can } from '@lib/permissions';
import { dialog } from '@lib/dialog';
import { toast } from '@store';
import { useSessionStore, selectIsManager, selectIsAdmin } from '@store/session';
import { fmtDate, fmtMoney, humanize } from './financeShared';

// Register chart.js tree-shakeable modules once (module-level, idempotent).
Chart.register(CategoryScale, LinearScale, PointElement, LineElement, Filler, Tooltip, Legend);

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
const W_REGISTER  = 'finance.statutory.register';

// Reverse map (widget id → source constant NAME) — powers the "Copy layout" capture
// button, which emits ready-to-paste `defInst(...)` lines for `defaultStatutoryLayout()`.
const WIDGET_CONST: Record<string, string> = {
  [W_SUMMARY]: 'W_SUMMARY',
  [W_KPI_ACTIVE]: 'W_KPI_ACTIVE', [W_KPI_DRAFTS]: 'W_KPI_DRAFTS', [W_KPI_COMPONENTS]: 'W_KPI_COMPONENTS',
  [W_KPI_NIS]: 'W_KPI_NIS', [W_KPI_VERIFY]: 'W_KPI_VERIFY', [W_KPI_APPROVALS]: 'W_KPI_APPROVALS',
  [W_CHART]: 'W_CHART', [W_READY]: 'W_READY', [W_DEADLINES]: 'W_DEADLINES',
  [W_REGISTER]: 'W_REGISTER',
};

// Serialize a live board zone into the exact `defInst(...)` code block used by
// `defaultStatutoryLayout()`, so a hand-arranged board can be captured verbatim.
function serializeLayout(items: WidgetInstance[]): string {
  const rows = [...items]
    .sort((a, b) => (a.y - b.y) || (a.x - b.x))
    .map(w => {
      const name = (WIDGET_CONST[w.widgetId] ?? `'${w.widgetId}'`).padEnd(17);
      const n = (v: number) => String(v).padStart(2);
      return `        defInst(${name}, ${n(w.x)}, ${n(w.y)}, ${n(w.w)}, ${n(w.h)}, '${w.sizeKey}'),`;
    });
  return `      main: [\n${rows.join('\n')}\n      ],`;
}

function defInst(widgetId: string, x: number, y: number, w: number, h: number, sizeKey: WidgetSizeKey): WidgetInstance {
  return { instanceId: `${widgetId}#def`, widgetId, pageKey: PAGE_KEY, zoneId: 'main', x, y, w, h, sizeKey, config: {} };
}
// 12-COLUMN grid. 6 compact KPI cards on the TOP row (w2 each) → thin summary strip →
// a row of chart (left half, w6) · Upcoming Deadlines (w3) · Config Completeness (w3) →
// the register. rowHeight is a fine 6px; spacing a fixed 12px gap.
// Tile px ≈ 6·h + 12·(h−1) = 18h − 12.
function defaultStatutoryLayout(): BoardLayout {
  return {
    pageKey: PAGE_KEY,
    zones: {
      main: [
        defInst(W_KPI_ACTIVE,      0,   0,  2,  6, 'compact'),   // 6 compact KPIs, top row
        defInst(W_KPI_DRAFTS,      2,   0,  2,  6, 'compact'),
        defInst(W_KPI_COMPONENTS,  4,   0,  2,  6, 'compact'),
        defInst(W_KPI_NIS,         6,   0,  2,  6, 'compact'),
        defInst(W_KPI_VERIFY,      8,   0,  2,  6, 'compact'),
        defInst(W_KPI_APPROVALS,  10,   0,  2,  6, 'compact'),
        defInst(W_SUMMARY,         0,   6, 12,  4, 'wide'),      // thin summary strip
        defInst(W_CHART,           0,  10,  6, 24, 'large'),     // chart (left half) · deadlines · readiness
        defInst(W_DEADLINES,       6,  10,  3, 24, 'standard'),
        defInst(W_READY,           9,  10,  3, 24, 'standard'),
        defInst(W_REGISTER,        0,  34, 12, 40, 'hero'),      // register table
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
  drafts: number;
  pending: number;
  activeComponents: number;
  verifyQueue: number;
  versionsLoading: boolean;
  // ── Tab state (owned by parent so drawer/edit dialogs stay synced) ────────
  tab: MainTab;
  onTabChange: (t: MainTab) => void;
  // Fully-wired tab content rendered by the parent (VersionsTab / NisClassesTab / …)
  tabContent: VNode;
}

// ── SVG helpers ────────────────────────────────────────────────────────────────

/** Semicircle gauge — gradient track + gradient colored fill.
 *  The fill sweeps LEFT→RIGHT from 0 to the value using a Web Animations stroke-dashoffset
 *  tween (~700ms ease-out). Both arcs carry a linear gradient that fades toward the ends so
 *  the arc reads as polished at any fill level; at 100% the whole arc is fully saturated.
 *  `memo` ensures the animation only re-triggers when `pct` / `color` genuinely change —
 *  unrelated parent re-renders (tab switches, board edits, etc.) don't replay it. */
const HalfGauge = memo(function HalfGauge({ pct, color }: { pct: number; color: string }): VNode {
  const p = Math.max(0, Math.min(100, pct));
  const rest = 100 - p; // dashoffset that reveals exactly the first p units (left→right)
  const ARC = 'M17 62 A42 42 0 0 1 101 62';
  const fillRef = useRef<SVGPathElement>(null);
  // Stable unique IDs for gradient <defs> — generated once on first mount; ignored arg
  // on subsequent renders so the ref's .current always has the original value.
  const gid = useRef(`sdb-g${Math.floor(Math.random() * 1e6)}`).current;

  useEffect(() => {
    const el = fillRef.current;
    if (!el) return;
    const reduce = typeof window !== 'undefined' && window.matchMedia
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) { el.style.strokeDashoffset = String(rest); return; } // jump to final, no motion
    // Always sweep LEFT→RIGHT from empty (offset 100) to the value — the static attribute
    // stays at 100 so there's no flash of the filled arc before the animation starts.
    const anim = el.animate(
      [{ strokeDashoffset: 100 }, { strokeDashoffset: rest }],
      { duration: 700, easing: 'cubic-bezier(0.16, 1, 0.3, 1)', delay: 80, fill: 'forwards' },
    );
    return () => anim.cancel();
  }, [rest]);

  return (
    <div class="sdb-gauge">
      <svg viewBox="0 0 118 78">
        <defs>
          {/* Track gradient — grey that softly fades toward both arc ends. */}
          <linearGradient id={`${gid}-t`} x1="17" y1="0" x2="101" y2="0" gradientUnits="userSpaceOnUse">
            <stop offset="0%"   stopColor="#c8d4e8" stopOpacity="0.35" />
            <stop offset="28%"  stopColor="#e9edf4" stopOpacity="1" />
            <stop offset="72%"  stopColor="#e9edf4" stopOpacity="1" />
            <stop offset="100%" stopColor="#c8d4e8" stopOpacity="0.35" />
          </linearGradient>
          {/* Fill gradient — the accent color fading toward both ends; at 100% fill it
              reads as one continuous saturated arc with polished tapered tips. */}
          <linearGradient id={`${gid}-f`} x1="17" y1="0" x2="101" y2="0" gradientUnits="userSpaceOnUse">
            <stop offset="0%"   stopColor={color} stopOpacity="0.5" />
            <stop offset="22%"  stopColor={color} stopOpacity="1" />
            <stop offset="78%"  stopColor={color} stopOpacity="1" />
            <stop offset="100%" stopColor={color} stopOpacity="0.55" />
          </linearGradient>
        </defs>
        {/* Track arc */}
        <path d={ARC} pathLength={100} fill="none"
          stroke={`url(#${gid}-t)`} strokeWidth={13} strokeLinecap="round" />
        {/* Fill arc — animates via strokeDashoffset */}
        <path ref={fillRef} d={ARC} pathLength={100} fill="none"
          stroke={`url(#${gid}-f)`} strokeWidth={13}
          strokeLinecap="round" strokeDasharray="100" strokeDashoffset={100} />
      </svg>
    </div>
  );
});

// ── Main component ─────────────────────────────────────────────────────────────

export function StatutoryDashboard({
  versions, components, activeVer, activeNisClasses, drafts, pending, activeComponents, verifyQueue,
  versionsLoading,
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

  // ── Config Completeness — the single readiness lens. Booleans over the active
  //    version's configuration; drives the gauge, subtext, and the two info stats.
  const lens = useMemo(() => {
    const hasVer     = !!activeVer;
    const hasPaye    = !!activeVer && activeVer.payePersonalAllowance > 0 && activeVer.payeBand1Rate > 0 && activeVer.payeBand2Rate > 0;
    const hasCeiling = !!activeVer && activeVer.nisMonthyCeiling != null;
    const hasNis     = activeNisClasses.length > 0 && hasCeiling;
    const hasHs      = !!activeVer && activeVer.hsWeeklyHigh >= 0 && activeVer.hsWeeklyLow >= 0 && activeVer.hsMonthlyThreshold > 0;
    const hasComp    = components.some(c => c.isStatutory && c.isActive);
    // Six real gates behind the % and the "X of 6" line. The four cards below show WHICH
    // config DOMAINS are set — actionable and non-duplicative of the KPI counts.
    const checks = [hasVer, activeNisClasses.length > 0, hasPaye, hasHs, hasCeiling, hasComp];
    const passed = checks.filter(Boolean).length;
    const configPct = Math.round((passed / checks.length) * 100);
    return {
      title: 'Readiness', color: '#16a34a', pct: configPct,
      subtitle: 'PAYE, NIS & Health Surcharge',
      sub: `${passed} of ${checks.length} configuration items set`,
      gates: [
        { label: 'PAYE Bands',       ok: hasPaye },
        { label: 'NIS Schedule',     ok: hasNis },
        { label: 'Health Surcharge', ok: hasHs },
        { label: 'Pay Components',   ok: hasComp },
      ],
      cta: 'Open active version', onCta: () => onTabChange('nis'),
    };
  }, [activeVer, activeNisClasses.length, components, onTabChange]);

  // Count-up for the readiness % number — animates 0→lens.pct on first mount and whenever
  // the value genuinely changes. Guarded by [lens.pct] so unrelated re-renders (tab switch,
  // board edit, etc.) never re-trigger it; respects prefers-reduced-motion.
  const [displayPct, setDisplayPct] = useState(0);
  useEffect(() => {
    const target = lens.pct;
    const reduce = typeof window !== 'undefined'
      && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduce) { setDisplayPct(target); return; }
    const start = performance.now();
    const dur = 700; // matches the gauge arc animation
    let raf: number;
    const step = (now: number): void => {
      const t = Math.min((now - start) / dur, 1);
      const eased = 1 - (1 - t) ** 3; // ease-out cubic
      setDisplayPct(Math.round(target * eased));
      if (t < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return (): void => { cancelAnimationFrame(raf); };
  }, [lens.pct]);

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
  // ── Chart.js canvas — callback-ref pattern so the useEffect re-runs if the widget is
  //    removed then re-added to the board (new DOM element; rateTrend reference unchanged).
  const [chartCanvas, setChartCanvas] = useState<HTMLCanvasElement | null>(null);
  const chartInstanceRef = useRef<{ destroy(): void } | null>(null);

  useEffect(() => {
    if (!chartCanvas) return;
    // Destroy any previous instance (stale canvas or data change).
    chartInstanceRef.current?.destroy();
    chartInstanceRef.current = null;
    const { pts, lo, hi } = rateTrend;
    if (pts.length === 0) return;
    chartInstanceRef.current = new Chart(chartCanvas, {
      type: 'line',
      data: {
        labels: pts.map(p => p.year),
        datasets: [{
          data: pts.map(p => p.rate),
          borderColor: '#2f5fe0',
          backgroundColor: 'rgba(47,95,224,0.09)',
          fill: true,
          tension: 0.3,
          // Active-version point is filled blue; all others are hollow white.
          pointRadius: pts.map(p => p.isActive ? 6 : 4),
          pointHoverRadius: 7,
          pointBackgroundColor: pts.map(p => p.isActive ? '#2f5fe0' : '#ffffff'),
          pointBorderColor: '#2f5fe0',
          pointBorderWidth: 2,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 700 },
        scales: {
          x: {
            border: { display: false },
            grid: { color: '#eef1f7' },
            ticks: { color: '#8593a8', font: { size: 10 } },
          },
          y: {
            min: lo,
            max: hi,
            border: { display: false },
            grid: { color: '#eef1f7' },
            ticks: {
              color: '#9aa4b6',
              font: { size: 10 },
              callback: (v: string | number) => `${v}%`,
            },
          },
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: '#17305c',
            titleColor: '#ffffff',
            bodyColor: '#c9d6f0',
            padding: 10,
            cornerRadius: 7,
            callbacks: {
              title: (items) => {
                const idx = items[0]?.dataIndex ?? -1;
                const p = pts[idx];
                return p ? fmtDate(p.effectiveFrom) : '';
              },
              label: (item) => {
                const p = pts[item.dataIndex];
                return p ? `${p.rate}% · ${p.isActive ? 'Active' : humanize(p.status)}` : '';
              },
            },
          },
        },
      },
    });
    return (): void => {
      chartInstanceRef.current?.destroy();
      chartInstanceRef.current = null;
    };
  }, [chartCanvas, rateTrend]);

  // Active-version contribution rate derived from the data (total ÷ assumed average).
  const nisRatePct = (() => {
    const c = nis.rows.find(r => r.assumedAverageWeekly && r.assumedAverageWeekly > 0);
    if (!c || !c.assumedAverageWeekly) return null;
    return Math.round(((c.employeeWeekly + c.employerWeekly) / c.assumedAverageWeekly) * 1000) / 10;
  })();

  // ── Widget board (Readiness / Upcoming Deadlines) ──
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
  // Capture the CURRENT board arrangement as ready-to-paste `defInst(...)` code, so a
  // hand-tuned layout can be hard-coded into `defaultStatutoryLayout()` verbatim. The
  // page + board share one query cache, so `boardItems` reflects live drag/resize.
  async function captureLayout(): Promise<void> {
    const code = serializeLayout(boardItems);
    try { await navigator.clipboard.writeText(code); toast.success('Layout copied — paste it to Claude'); }
    catch { toast('Copied below — select and copy it'); }
    await dialog.prompt({
      title: 'Board layout coordinates',
      text: 'This is the exact arrangement on screen. It is already on your clipboard — paste it to Claude to hard-code as the default.',
      type: 'textarea', value: code, confirmText: 'Done', cancelText: 'Close',
    });
  }
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
      <div class="sdb-kpi-top">
        <span class={`sdb-kpi-ic sdb-kpi-ic--${p.color}`}><i class={`fa-solid ${p.icon}`} /></span>
        <span class="sdb-kpi-cap">{p.cap}</span>
      </div>
      <div class="sdb-kpi-val">{p.value}</div>
      <div class="sdb-kpi-sub">{p.sub}</div>
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

  // NIS contribution RATE over time — real trend across the seeded schedule history
  // (10.5% 2008 → 16.2% 2026). Rendered as a Chart.js line chart on a <canvas>;
  // Chart.js owns responsive resizing, hover, and tooltips.
  const renderChart = (): VNode => {
    const { pts } = rateTrend;
    const first = pts[0];
    const last  = pts[pts.length - 1];
    return (
      <div class="sdb-card sdb-ch sdb-wgt-fill">
        <div class="sdb-ch-hd">
          <h2>NIS Contribution Rate</h2>
          <InfoTip placement="bottom" tip="The headline NIS rate for each schedule version on record — (employee + employer weekly) as a % of the assumed average earnings. The trend shows every version, active and retired." />
          <div class="sdb-ch-tools">
            <span class="sdb-pill-sel">
              <i class="fa-solid fa-arrow-trend-up" /> {first && last ? `${first.year}–${last.year}` : 'History'}
            </span>
          </div>
        </div>

        <div class="sdb-sum-body">
          {pts.length === 0 ? (
            <div class="sdb-up-empty" style={{ padding: '48px 0' }}>No NIS schedules on record yet.</div>
          ) : (
            <div class="sdb-chart-plot">
              <canvas ref={setChartCanvas} />
            </div>
          )}
        </div>

        {/* NIS schedule reference note */}
        <div class="sdb-nis-note">
          <div class="sdb-nis-note-hd">
            <i class="fa-solid fa-circle-info" />
            NIBTT Earnings-Class Schedule
          </div>
          <div class="sdb-nis-note-chips">
            <span class="sdb-nis-chip">
              <span class="sdb-nis-chip-k">Rate</span>
              <span class="sdb-nis-chip-v">16.2%</span>
            </span>
            <span class="sdb-nis-chip">
              <span class="sdb-nis-chip-k">Employee</span>
              <span class="sdb-nis-chip-v">⅓ · 5.4%</span>
            </span>
            <span class="sdb-nis-chip">
              <span class="sdb-nis-chip-k">Employer</span>
              <span class="sdb-nis-chip-v">⅔ · 10.8%</span>
            </span>
          </div>
          <div class="sdb-nis-note-lines">
            <div class="sdb-nis-note-line">
              <span class="sdb-nis-note-k">Assumed Avg</span> The earnings figure the contribution is based on; weekly or monthly by pay cycle.
            </div>
            <div class="sdb-nis-note-line">
              <span class="sdb-nis-note-k">Class Z</span> Reduced weekly rate for workers over pensionable age — employment-injury portion only.
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

  // Readiness card — rebuilt to the Onboarding `obv-activation-side-card` model: a
  // FIXED-content grid (head → score-row with a fixed-size gauge → 2-stat grid → CTA),
  // so it scales predictably in the board instead of stretch-growing a blank gauge.
  // Readiness card — tight, gauge-centric: head (icon · title · ‹ ›) → a FIXED-size
  // semicircle gauge with the % overlaid → one subtext line → lens dots → CTA. Compact
  // and top-aligned; no stretch, no dead space.
  const renderReadiness = (): VNode => (
    <div class="sdb-card sdb-ready sdb-wgt-fill">
      <div class="sdb-ch-hd">
        <i class="fa-regular fa-circle-check" style={{ color: lens.color }} />
        <h2>{lens.title}</h2>
      </div>
      <div class="sdb-ready-subtitle">{lens.subtitle}</div>

      <div class="sdb-ready-score">
        <div class="sdb-gauge-wrap">
          <HalfGauge pct={lens.pct} color={lens.color} />
          <div class="sdb-gauge-val" style={{ color: lens.color }}>{displayPct}%</div>
        </div>
      </div>

      <div class="sdb-ready-sub">{lens.sub}</div>

      <div class="sdb-ready-gates">
        {lens.gates.map((g, i) => (
          <div key={i} class={`sdb-gate ${g.ok ? 'ok' : 'warn'}`}>
            <span class="sdb-gate-ci"><LucideIcon name={g.ok ? 'Check' : 'Minus'} size={13} strokeWidth={2.4} /></span>
            <span class="sdb-gate-l">{g.label}</span>
            <span class="sdb-gate-v">{g.ok ? 'Set' : 'Open'}</span>
          </div>
        ))}
      </div>

      <button type="button" class="sdb-ready-cta" onClick={lens.onCta}>{lens.cta}</button>
    </div>
  );

  const renderDeadlines = (): VNode => (
    <div class="sdb-card sdb-ch sdb-cal sdb-wgt-fill">
      <div class="sdb-ch-hd">
        <i class="fa-regular fa-calendar" style={{ color: '#2f5fe0' }} />
        <h2>Upcoming Deadlines</h2>
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
          <div class="sdb-cal-empty">
            <LucideIcon name="CalendarCheck" size={52} strokeWidth={1.5} class="sdb-cal-empty-ic" />
            <div class="sdb-cal-empty-t">No Filings Due on {selectedDay.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</div>
            <div class="sdb-cal-empty-s">NIS and PAYE remittances are due on the 15th; the TD4 return by 28 February.</div>
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

  // The 6 KPI tiles are `locked: true` → PINNED at the top (RGL static): compact uniform
  // size (w2 × h7 ≈ 114px), one row, and they never move, resize, or get displaced by
  // other tiles. The remaining widgets ARE resizable and each declares a resize FLOOR
  // (allowedSizes → minGridFor); without one the generic floor is 2 cells on this 6px grid.
  const floor = (key: WidgetSizeKey, w: number, h: number): WidgetSizeDef[] =>
    [{ key, label: 'Default', grid: { w, h } }];
  const localWidgets: LocalWidgetMap = {
    [W_SUMMARY]:        { render: renderSummary,      chrome: 'none', title: 'Statutory Summary',        allowedSizes: floor('wide', 6, 4) },
    [W_KPI_ACTIVE]:     { render: renderKpiActive,    chrome: 'none', title: 'Active Version',           resizable: false, allowedSizes: floor('compact', 2, 6) },
    [W_KPI_DRAFTS]:     { render: renderKpiDrafts,    chrome: 'none', title: 'Draft Versions',           resizable: false, allowedSizes: floor('compact', 2, 6) },
    [W_KPI_COMPONENTS]: { render: renderKpiComponents,chrome: 'none', title: 'Pay Components',           resizable: false, allowedSizes: floor('compact', 2, 6) },
    [W_KPI_NIS]:        { render: renderKpiNis,       chrome: 'none', title: 'NIS Classes',              resizable: false, allowedSizes: floor('compact', 2, 6) },
    [W_KPI_VERIFY]:     { render: renderKpiVerify,    chrome: 'none', title: 'Verification Queue (KPI)', resizable: false, allowedSizes: floor('compact', 2, 6) },
    [W_KPI_APPROVALS]:  { render: renderKpiApprovals, chrome: 'none', title: 'Pending Approvals',        resizable: false, allowedSizes: floor('compact', 2, 6) },
    [W_CHART]:          { render: renderChart,        chrome: 'none', title: 'NIS Contribution Schedule', allowedSizes: floor('large', 6, 16) },
    [W_READY]:          { render: renderReadiness,    chrome: 'none', title: 'Statutory Readiness',      allowedSizes: floor('standard', 3, 16) },
    [W_DEADLINES]:      { render: renderDeadlines,    chrome: 'none', title: 'Upcoming Deadlines',       allowedSizes: floor('standard', 3, 12) },
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
          {editing && (
            <button type="button" class="sdb-capture-btn" onClick={() => void captureLayout()}
              title="Copy the current board arrangement as code to hard-code as the default">
              <i class="fa-solid fa-crosshairs" /> Copy layout
            </button>
          )}
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
