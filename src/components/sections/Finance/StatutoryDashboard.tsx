/**
 * src/components/sections/Finance/StatutoryDashboard.tsx
 *
 * Statutory Configuration dashboard — a self-contained enterprise page (its own
 * `.sdb` design system) rendered directly by StatutoryConfigOverview. Not a widget.
 *
 * Layout: movable board — 6 KPI cards · full-width NIS rate chart ·
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
 *
 *   STATIC REFERENCE (fixed regulatory constants, not server data — labelled on-card):
 *     - NIBTT rate + employee/employer split (16.2% · ⅓ / ⅔)
 *                                                     ← T&T NIBTT Earnings-Class
 *                                                       schedule, effective 05 Jan 2026.
 *                                                       Rendered as a reference card, not
 *                                                       a KPI (see .sdb-nis-note).
 */

import { type VNode, type ComponentChildren } from 'preact';
import { memo } from 'preact/compat';
import { useMemo, useState, useEffect, useRef } from 'preact/hooks';
import {
  Chart,
  LineController,
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
import { PageHeader, KpiTile } from '@ui';
import { can } from '@lib/permissions';
import { useSessionStore, selectIsManager, selectIsAdmin } from '@store/session';
import { fmtDate, humanize } from './financeShared';

// Register chart.js tree-shakeable modules once (module-level, idempotent).
Chart.register(LineController, CategoryScale, LinearScale, PointElement, LineElement, Filler, Tooltip, Legend);

// Re-export so the parent can reference the same literal type without a second import.
export type MainTab = 'versions' | 'nis' | 'components' | 'verify' | 'reports';

const TABS: { key: MainTab; label: string; locked?: boolean }[] = [
  { key: 'versions',   label: 'Rate Versions' },
  { key: 'nis',        label: 'NIS Classes' },
  { key: 'components', label: 'Pay Components' },
  { key: 'verify',     label: 'NIS Verification' },
  // Locked until the reporting direction is decided — visible but not selectable.
  { key: 'reports',    label: 'Reports', locked: true },
];

// ── Widget zone ────────────────────────────────────────────────────────────────
// The KPI strip is a SEPARATE reorder-only row above the board (drag left/right, never
// pushes anything down — see useCardReorder below). The movable/resizable board holds the
// NIS contribution chart, Upcoming Deadlines, Config Completeness and the register table.
// v2 keys — the KPI cards moved OUT of the main board into their own row, so any layout saved
// under the old keys is stale (it positions the chart/content below the old in-board KPI row,
// leaving a big empty band). Bumping the keys retires those and everyone gets the corrected default.
const PAGE_KEY = 'finance.statutory.v2';
const KPI_PAGE_KEY = 'finance.statutory.kpis.v2';
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

function defInst(widgetId: string, x: number, y: number, w: number, h: number, sizeKey: WidgetSizeKey, pageKey = PAGE_KEY): WidgetInstance {
  return { instanceId: `${widgetId}#def`, widgetId, pageKey, zoneId: 'main', x, y, w, h, sizeKey, config: {} };
}
// 12-COLUMN grid. Top row: chart (left half, w6) · Upcoming Deadlines (w3) · Config
// Completeness (w3) → then the register. rowHeight is a fine 6px; spacing a fixed 12px gap.
// Tile px ≈ 6·h + 12·(h−1) = 18h − 12. (The KPI strip is NOT on this board.)
function defaultStatutoryLayout(): BoardLayout {
  return {
    pageKey: PAGE_KEY,
    zones: {
      main: [
        defInst(W_CHART,           0,   0,  6, 24, 'large'),     // chart (left half) · deadlines · readiness
        defInst(W_DEADLINES,       6,   0,  3, 24, 'standard'),
        defInst(W_READY,           9,   0,  3, 24, 'standard'),
        defInst(W_REGISTER,        0,  24, 12, 40, 'hero'),      // register table
      ],
    },
  };
}

// KPI board — a SEPARATE single-row react-grid-layout grid (its own page key). 6 uniform w2×h6
// tiles in row 0, reorder-only (resizable=false, no locked). Vertical compaction keeps them in the
// row, so dragging one reorders LEFT/RIGHT and never leaves row 0; being its own grid, it can never
// push the main board's widgets down.
function defaultKpiLayout(): BoardLayout {
  return {
    pageKey: KPI_PAGE_KEY,
    zones: {
      main: [
        defInst(W_KPI_ACTIVE,     0, 0, 2, 6, 'compact', KPI_PAGE_KEY),
        defInst(W_KPI_DRAFTS,     2, 0, 2, 6, 'compact', KPI_PAGE_KEY),
        defInst(W_KPI_COMPONENTS, 4, 0, 2, 6, 'compact', KPI_PAGE_KEY),
        defInst(W_KPI_NIS,        6, 0, 2, 6, 'compact', KPI_PAGE_KEY),
        defInst(W_KPI_VERIFY,     8, 0, 2, 6, 'compact', KPI_PAGE_KEY),
        defInst(W_KPI_APPROVALS, 10, 0, 2, 6, 'compact', KPI_PAGE_KEY),
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
  /** Page-level header actions (Export · New ▾) rendered in the standard PageHeader. The
   *  board's Customize control is appended after these so it sits in the header, not on
   *  its own row. */
  headerActions?: ComponentChildren;
}

// ── SVG helpers ────────────────────────────────────────────────────────────────

/** Segmented semicircle gauge — a fan of rounded pill segments (like a speedometer tick
 *  ring). The first `value%` of the segments light up in `color` (a subtle brighten across
 *  the run), the segment at the leading edge fades in proportionally, and the rest stay
 *  grey. `value` is the live (count-up) percentage, so as the parent's number animates
 *  0→target the segments fill in lock-step. Same footprint as the old arc (endpoints
 *  17,62 → 101,62) so the centred value overlay is unaffected. `memo` keeps it from
 *  replaying on unrelated parent re-renders. */
const GAUGE_SEGMENTS = 13;
const HalfGauge = memo(function HalfGauge({ value, color }: { value: number; color: string }): VNode {
  const v = Math.max(0, Math.min(100, value));
  const cx = 59, cy = 62, rIn = 31, rOut = 42;      // radial pill from rIn→rOut, rotated per segment
  const filled = (v / 100) * GAUGE_SEGMENTS;
  const full = Math.floor(filled);
  const frac = filled - full;
  const segs = [];
  for (let i = 0; i < GAUGE_SEGMENTS; i++) {
    const rot = -90 + i * (180 / (GAUGE_SEGMENTS - 1)); // -90° (left) → +90° (right)
    let stroke = '#e6eaf1', op = 1;
    if (i < full) {                                   // lit: gentle brighten toward the leading edge
      stroke = color; op = full <= 1 ? 1 : 0.8 + 0.2 * (i / (full - 1));
    } else if (i === full && frac > 0.04) {           // leading edge: fades in with the fraction
      stroke = color; op = 0.28 + frac * 0.5;
    }
    segs.push(
      <line key={i} x1={cx} y1={cy - rIn} x2={cx} y2={cy - rOut}
        stroke={stroke} stroke-opacity={op} stroke-width={5.6} stroke-linecap="round"
        transform={`rotate(${rot} ${cx} ${cy})`} />,
    );
  }
  return (
    <div class="sdb-gauge">
      <svg viewBox="0 0 118 78">{segs}</svg>
    </div>
  );
});

// ── Main component ─────────────────────────────────────────────────────────────

export function StatutoryDashboard({
  versions, components, activeVer, activeNisClasses, drafts, pending, activeComponents, verifyQueue,
  versionsLoading,
  tab, onTabChange, tabContent, headerActions,
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
      cta: 'Open Active Version', onCta: () => onTabChange('nis'),
    };
  }, [activeVer, activeNisClasses.length, components, onTabChange]);

  // Count-up for the readiness % number — tweens the CURRENTLY displayed value to the new
  // target (not always from 0). Progressive data loading moves lens.pct 0→…→final, so a
  // from-0 restart made the gauge fill, snap back to 0, and fill again ("triggers twice").
  // A ref holds the live value so it drives `from` without being an effect dep (which would
  // loop). Guarded by [lens.pct]; a no-op when unchanged; respects prefers-reduced-motion.
  const [displayPct, setDisplayPct] = useState(0);
  const displayRef = useRef(0);
  const setPct = (v: number): void => { displayRef.current = v; setDisplayPct(v); };
  useEffect(() => {
    const target = lens.pct;
    const from = displayRef.current;
    if (from === target) return;
    const reduce = typeof window !== 'undefined'
      && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduce) { setPct(target); return; }
    const start = performance.now();
    const dur = 700; // matches the gauge arc animation
    let raf: number;
    const step = (now: number): void => {
      const t = Math.min((now - start) / dur, 1);
      const eased = 1 - (1 - t) ** 3; // ease-out cubic
      setPct(Math.round(from + (target - from) * eased));
      if (t < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return (): void => { cancelAnimationFrame(raf); };
  }, [lens.pct]);

  // ── NIS contribution-rate trend across ALL versions (rate over time) ────────
  // Real historical data — each version's headline rate (nisRatePercent, computed
  // server-side from its earnings classes), plotted by schedule year.
  const rateTrend = useMemo(() => {
    const pts = versions
      .filter(v => v.nisRatePercent != null)
      .map(v => ({ id: v.id, year: v.effectiveFrom.slice(0, 4), rate: v.nisRatePercent!, isActive: v.isActive, effectiveFrom: v.effectiveFrom, status: v.status }))
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
    // Smooth left-to-right line DRAW: the final geometry is drawn instantly, then revealed by an
    // eased clip that sweeps from the y-axis to the right edge. Clipping only the DATASETS (line +
    // fill + points, never the axes/grid) avoids the per-point stepping and curve/fill wobble that
    // a point-by-point animation produced; driven by rAF so it stays frame-smooth no matter how few
    // points there are. No-ops under prefers-reduced-motion (draws instantly).
    const reduceMotion = typeof window !== 'undefined'
      && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const totalDuration = 1100;
    const reveal = { v: reduceMotion ? 1 : 0 };
    let didClip = false;
    const revealPlugin = {
      id: 'nisLineReveal',
      beforeDatasetsDraw(chart: Chart): void {
        // Once fully revealed, never clip — otherwise the last point's marker (which sits at the
        // chart-area's right edge) gets shaved. Pad the moving clip a little past the sweep so a
        // marker is never half-cut as the wipe crosses it.
        if (reveal.v >= 1) { didClip = false; return; }
        const area = chart.chartArea;
        if (!area) return;
        const { ctx } = chart;
        ctx.save();
        ctx.beginPath();
        ctx.rect(area.left, area.top, (area.right - area.left) * reveal.v + 8, area.bottom - area.top);
        ctx.clip();
        didClip = true;
      },
      afterDatasetsDraw(chart: Chart): void { if (didClip) { chart.ctx.restore(); didClip = false; } },
    };
    const chart = new Chart(chartCanvas, {
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
        // Geometry is final immediately; the rAF-driven clip below does the reveal.
        animation: false,
        // Right/top padding so the last point's marker (no y-axis on the right) isn't clipped.
        layout: { padding: { right: 10, left: 2, top: 6, bottom: 0 } },
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
      plugins: [revealPlugin],
    });
    chartInstanceRef.current = chart;

    // Drive the clip 0→1 with an ease-out cubic, redrawing each frame (no Chart animation).
    let rafId = 0;
    if (!reduceMotion) {
      const easeOutCubic = (t: number): number => 1 - Math.pow(1 - t, 3);
      const start = performance.now();
      const tick = (now: number): void => {
        const t = Math.min((now - start) / totalDuration, 1);
        reveal.v = easeOutCubic(t);
        chart.draw();
        if (t < 1) rafId = requestAnimationFrame(tick);
      };
      rafId = requestAnimationFrame(tick);
    }

    return (): void => {
      if (rafId) cancelAnimationFrame(rafId);
      chartInstanceRef.current?.destroy();
      chartInstanceRef.current = null;
    };
  }, [chartCanvas, rateTrend]);

  // ── Widget board (Readiness / Upcoming Deadlines) ──
  // Per-user movable/resizable zone. Only managers/admins may customize it.
  const canEditBoard = useSessionStore(selectIsManager);
  const isAdmin      = useSessionStore(selectIsAdmin);
  const [editing, setEditing] = useState(false);
  const [libOpen, setLibOpen] = useState(false);
  const [demo, setDemo]       = useState(false);
  const [preview, setPreview] = useState<PreviewWidgetInstance | null>(null);
  const { layout, addWidget, setAsDefault, resetLayout, isDefaultDirty } = useBoardLayout(PAGE_KEY, defaultStatutoryLayout());
  // The KPI row is its own board (separate page key) — its layout state shares the query cache
  // with the KPI WidgetBoard below, so this instance sees reorders live. "Set as default" and
  // "Reset layout" act on the WHOLE page: either board being dirty enables the button, and
  // promoting/resetting applies to whichever board(s) changed.
  const kpiBoard = useBoardLayout(KPI_PAGE_KEY, defaultKpiLayout());
  const pageDefaultDirty = isDefaultDirty || kpiBoard.isDefaultDirty;
  // In-flight guard: the promote is a network write — disable the button and swallow
  // re-clicks until it settles, so it can't be spammed into duplicate saves/toasts.
  const [savingDefault, setSavingDefault] = useState(false);
  const promotePageDefault = async (): Promise<void> => {
    if (savingDefault) return;
    setSavingDefault(true);
    try {
      if (isDefaultDirty) await setAsDefault();
      if (kpiBoard.isDefaultDirty) await kpiBoard.setAsDefault();
    } finally { setSavingDefault(false); }
  };
  const resetPageLayout = (): void => { void resetLayout(); void kpiBoard.resetLayout(); };
  const boardItems = layout.zones.main ?? [];
  const placedWidgetIds = boardItems.map(w => w.widgetId);
  const placeBottom = <T extends { x: number; y: number }>(w: T): T =>
    ({ ...w, x: 0, y: Math.max(0, ...boardItems.map(i => i.y + i.h)) });
  const userPermissions = useMemo(
    () => Array.from(new Set(WIDGET_REGISTRY.flatMap(w => w.dataSource.permissions))).filter(can),
    [],
  );
  // "Copy layout" (capture the live arrangement as code) now lives in the shared board
  // toolbar dropdown — passed `boardItems` below. Available on every board page, admin-only.
  function discardPreview(): void { setPreview(null); setLibOpen(true); }
  function commitPreview(p: PreviewWidgetInstance): void { void addWidget(p.zoneId, commitPreviewWidget(p)); setPreview(null); }

  // KPI drill links switch the register tab AND scroll the register into view — the register
  // lives below the chart/board, so a plain tab switch would leave it off-screen. The card is
  // always mounted (only its inner tab content changes), so scrolling it is safe immediately.
  const goToRegisterTab = (t: MainTab): void => {
    onTabChange(t);
    requestAnimationFrame(() => {
      document.getElementById('sdb-register')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  };

  // KPI strip — the app-wide standard plain KPI tile (@ui KpiTile). "Active Version"
  // is a label rather than a count, so it uses the text variant; the rest are metric
  // tiles with a drill link into the matching register tab.
  const renderKpiActive = (): VNode => (
    <KpiTile variant="text" icon="fa-file-lines" label="Active Version"
      value={versionsLoading ? '…' : (activeVer?.label ?? 'No active version')}
      sub={activeVer
        ? <><span class="ui-kpi-dot ui-kpi-dot--green" />Effective {fmtDate(activeVer.effectiveFrom)}</>
        : 'No active version configured'} />
  );
  const renderKpiDrafts = (): VNode => (
    <KpiTile icon="fa-pen-to-square" tone="green" label="Draft Versions"
      value={versionsLoading ? '…' : drafts}
      sub={pending > 0 ? `${pending} awaiting review` : 'None awaiting review'}
      link={{ label: 'View versions', onClick: () => goToRegisterTab('versions') }} />
  );
  const renderKpiComponents = (): VNode => (
    <KpiTile icon="fa-layer-group" tone="teal" label="Pay Components"
      value={activeComponents} sub={`${inactiveComponents} inactive`}
      link={{ label: 'View components', onClick: () => goToRegisterTab('components') }} />
  );
  const renderKpiNis = (): VNode => (
    <KpiTile icon="fa-users" tone="blue" label="NIS Classes"
      value={activeVer ? activeNisClasses.length : '—'}
      sub={activeVer
        ? <><span class="ui-kpi-dot ui-kpi-dot--green" />On {activeVer.label}</>
        : 'No active version'}
      link={{ label: 'View NIS classes', onClick: () => goToRegisterTab('nis') }} />
  );
  const renderKpiVerify = (): VNode => (
    <KpiTile icon="fa-clock" tone="amber" label="Verification Queue"
      value={verifyQueue}
      sub={verifyQueue > 0 ? <><span class="ui-kpi-dot ui-kpi-dot--amber" />Needs attention</> : 'Queue clear'}
      link={{ label: 'View queue', onClick: () => goToRegisterTab('verify') }} />
  );
  const renderKpiApprovals = (): VNode => (
    <KpiTile icon="fa-user-check" tone="coral" label="Pending Approvals"
      value={pending}
      sub={pending > 0 ? `Across ${pending} item${pending !== 1 ? 's' : ''}` : 'None pending'}
      link={{ label: 'View approvals', onClick: () => goToRegisterTab('versions') }} />
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

        {/* NIS schedule reference note — static NIBTT regulatory constants, not computed */}
        <div class="sdb-nis-note">
          <div class="sdb-nis-note-hd">
            <i class="fa-solid fa-circle-info" />
            NIBTT Earnings-Class Schedule
            <span class="sdb-nis-note-ref">Reference</span>
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
          <div class="sdb-nis-note-src">
            Static regulatory reference · NIBTT, effective 05 Jan 2026
          </div>
        </div>
      </div>
    );
  };

  const renderRegister = (): VNode => (
    <div id="sdb-register" class="sdb-card sdb-table-card sdb-wgt-fill">
      {/* Tab strip */}
      <div class="sdb-tabs">
        {TABS.map(t => (
          <button key={t.key} type="button"
            class={`sdb-tab${tab === t.key ? ' sdb-tab--on' : ''}${t.locked ? ' sdb-tab--locked' : ''}`}
            disabled={t.locked}
            title={t.locked ? 'Coming soon' : undefined}
            onClick={t.locked ? undefined : () => onTabChange(t.key)}>
            {t.label}
            {t.locked && <i class="fa-solid fa-lock sdb-tab-lock" aria-hidden="true" />}
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
          <HalfGauge value={displayPct} color={lens.color} />
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

      <button type="button" class="sdb-ready-cta" onClick={() => goToRegisterTab('nis')}>{lens.cta}</button>
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

  // Board widgets each declare a resize FLOOR (allowedSizes → minGridFor); without one the generic
  // floor is 2 cells on this 6px grid. (The KPI cards are NOT board widgets — they live in the
  // reorder-only strip above.)
  const floor = (key: WidgetSizeKey, w: number, h: number): WidgetSizeDef[] =>
    [{ key, label: 'Default', grid: { w, h } }];
  const localWidgets: LocalWidgetMap = {
    [W_CHART]:          { render: renderChart,        chrome: 'none', title: 'NIS Contribution Schedule', allowedSizes: floor('large', 6, 16) },
    [W_READY]:          { render: renderReadiness,    chrome: 'none', title: 'Statutory Readiness',      allowedSizes: floor('standard', 3, 16) },
    [W_DEADLINES]:      { render: renderDeadlines,    chrome: 'none', title: 'Upcoming Deadlines',       allowedSizes: floor('standard', 3, 12) },
    [W_REGISTER]:       { render: renderRegister,     chrome: 'none', title: 'Statutory Register',       allowedSizes: floor('hero', 6, 20) },
  };

  // KPI board widgets — uniform, reorder-only (resizable:false → w2×h6 floor pins the tile size).
  const kpiLocalWidgets: LocalWidgetMap = {
    [W_KPI_ACTIVE]:     { render: renderKpiActive,    chrome: 'none', title: 'Active Version',           resizable: false, allowedSizes: floor('compact', 2, 6) },
    [W_KPI_DRAFTS]:     { render: renderKpiDrafts,    chrome: 'none', title: 'Draft Versions',           resizable: false, allowedSizes: floor('compact', 2, 6) },
    [W_KPI_COMPONENTS]: { render: renderKpiComponents,chrome: 'none', title: 'Pay Components',           resizable: false, allowedSizes: floor('compact', 2, 6) },
    [W_KPI_NIS]:        { render: renderKpiNis,       chrome: 'none', title: 'NIS Classes',              resizable: false, allowedSizes: floor('compact', 2, 6) },
    [W_KPI_VERIFY]:     { render: renderKpiVerify,    chrome: 'none', title: 'Verification Queue (KPI)', resizable: false, allowedSizes: floor('compact', 2, 6) },
    [W_KPI_APPROVALS]:  { render: renderKpiApprovals, chrome: 'none', title: 'Pending Approvals',        resizable: false, allowedSizes: floor('compact', 2, 6) },
  };

  // The board's Customize control now lives in the standard PageHeader actions (right of
  // Export · New ▾), so it no longer consumes a full-width row above the board.
  const boardTools = canEditBoard ? (
    <WidgetBoardToolbar
      editing={editing} canSetDefault={isAdmin} defaultDirty={pageDefaultDirty} finishInBanner layoutItems={boardItems}
      onToggleEdit={() => setEditing(e => !e)}
      onOpenLibrary={() => setLibOpen(true)}
      onReset={resetPageLayout}
      onSetDefault={() => void promotePageDefault()}
    />
  ) : null;

  return (
    <>
      <PageHeader
        icon="fa-scale-balanced"
        module="Finance · Statutory Configuration"
        title="Statutory Configuration"
        sub="Manage Trinidad & Tobago statutory rate versions, NIS classes and pay components."
        actions={<>{headerActions}{boardTools}</>}
      />
      <div class="sdb">

      {/* KPI board — its own single-row react-grid-layout grid. Reorder-only (resizable=false);
          drag LEFT/RIGHT while the board is in edit mode. Isolated from the main board, so it can
          never push the widgets below. */}
      <div class="sdb-kpi-board">
        <WidgetBoard pageKey={KPI_PAGE_KEY} zones={['main']} editing={editing && canEditBoard}
          localWidgets={kpiLocalWidgets} defaultLayout={defaultKpiLayout()}
          cellHeight={6} gap={[12, 12]} resizable={false} maxRows={6} isBounded revealOnMount={false} />
      </div>

      {preview && (
        <div class="wmock-preview-banner">
          <span><i class="fas fa-eye" /> Previewing a widget — drag and resize it on the board, then add it or discard.</span>
        </div>
      )}
      <WidgetBoard pageKey={PAGE_KEY} zones={['main']} editing={editing && canEditBoard}
        localWidgets={localWidgets} defaultLayout={defaultStatutoryLayout()} demo={demo}
        cellHeight={6} gap={[12, 12]} revealOnMount={false}
        preview={preview} onPreviewChange={setPreview}
        onCommitPreview={commitPreview} onDiscardPreview={discardPreview}
        onFinishEditing={() => setEditing(false)}
        onSetDefault={() => void promotePageDefault()} canSetDefault={isAdmin}
        defaultDirty={pageDefaultDirty} defaultSaving={savingDefault} />

      <WidgetLibraryModal open={libOpen} pageKey={PAGE_KEY} zoneId="main"
        placedWidgetIds={placedWidgetIds} userPermissions={userPermissions}
        demo={demo} onToggleDemo={() => setDemo(d => !d)}
        canManagePackages={isAdmin}
        onClose={() => setLibOpen(false)}
        onAddWidget={inst => addWidget('main', placeBottom(inst))}
        onPreviewOnBoard={p => setPreview(placeBottom(p))} />
      </div>
    </>
  );
}
