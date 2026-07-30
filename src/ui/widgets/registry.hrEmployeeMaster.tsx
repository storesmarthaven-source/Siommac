import type { VNode } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import {
  CategoryScale,
  Chart,
  Filler,
  LineController,
  LineElement,
  LinearScale,
  PointElement,
  Tooltip,
} from 'chart.js';
import type { ActiveElement, Plugin, ScriptableScaleContext, TooltipModel } from 'chart.js';
import { useHrDashboardStats } from '@api/hr/employees';
import type { HrDashboardStats } from '@api/hr/employees';
import type { WidgetDef, WidgetRenderProps, WidgetSizeConstraints, WidgetSizeDef } from './types';
import { LucideIcon, type LucideName } from '../LucideIcon';
import { defineWidget } from './defineWidget';
import { reducedMotion } from './motion';
import './employeeMasterWidgets.css';

Chart.register(LineController, CategoryScale, LinearScale, PointElement, LineElement, Filler, Tooltip);

const PAGE = 'hr.employees.overview.v3';
/** Workforce Activity's line-draw duration — the same 880ms its `motion` spec declares. */
const DRAW_MS = 880;
// All sizes here are in the Employee Master board's units: cellHeight 6 + a 12px gap,
// so a tile is `18h − 12` px tall (Statutory-parity grid). Widths are columns on that
// board's 24-column grid. A preset authored in any other board's units renders wrong.
const SIZES: WidgetSizeDef[] = [
  { key: 'standard', label: 'Standard', grid: { w: 10, h: 22 }, min: { w: 4, h: 12 }, description: 'Compact dashboard card' },
  { key: 'wide', label: 'Wide', grid: { w: 12, h: 22 }, min: { w: 4, h: 12 }, description: 'Full visual detail' },
  { key: 'large', label: 'Large', grid: { w: 16, h: 28 }, min: { w: 6, h: 12 }, description: 'Expanded dashboard card' },
];
const DESIGN_SIZES: WidgetSizeDef[] = [
  { key: 'standard', label: 'Standard', grid: { w: 10, h: 28 }, min: { w: 7, h: 12 }, description: 'Full design detail' },
  { key: 'wide', label: 'Wide', grid: { w: 14, h: 28 }, min: { w: 8, h: 12 }, description: 'Expanded design detail' },
  { key: 'large', label: 'Large', grid: { w: 16, h: 28 }, min: { w: 8, h: 12 }, description: 'Wide dashboard card' },
];
const RISK_SIZES: WidgetSizeDef[] = [
  { key: 'standard', label: 'Standard', grid: { w: 7, h: 17 }, min: { w: 5, h: 12 }, description: 'Compact risk monitor' },
  { key: 'wide', label: 'Wide', grid: { w: 12, h: 22 }, min: { w: 5, h: 12 }, description: 'Expanded trend detail' },
  { key: 'large', label: 'Large', grid: { w: 16, h: 28 }, min: { w: 5, h: 12 }, description: 'Large risk monitor' },
];
const HEALTH_SIZES: WidgetSizeDef[] = [
  { key: 'standard', label: 'Standard', grid: { w: 8, h: 22 }, min: { w: 5, h: 12 }, description: 'Compact record health' },
  { key: 'wide', label: 'Wide', grid: { w: 12, h: 22 }, min: { w: 5, h: 12 }, description: 'Expanded category detail' },
  { key: 'large', label: 'Large', grid: { w: 16, h: 28 }, min: { w: 5, h: 12 }, description: 'Large record health card' },
];
const PREVIEW_SOURCE = {
  sourceKey: 'hr.employee-master.selection-preview',
  label: 'Employee Master approved design preview',
  permissions: ['hr.employees.view'],
};
const LIVE_SOURCE = {
  sourceKey: 'hr.employee-master.dashboard',
  label: 'Employee Master Dashboard API',
  refreshIntervalMs: 60_000,
  permissions: ['hr.employees.view'],
};
const LIFECYCLE_PREVIEW_STATS: HrDashboardStats = {
  active_workforce: { total: 128, employees: 116, contractors: 12, trend: [] },
  hr_work_queue: { total: 26, urgent: 4, oldest_days: 8, mix: [] },
  readiness: { percent: 74, assignment_complete: 41, payroll_ready: 36, training_current: 30, blocked: 21 },
  exceptions: { total: 5, items: [] },
  distribution: { departments: [], sites: [] },
  lifecycle: {
    periods: [
      { period: 'Feb', hires: 4, exits: 1, transfers: 3, promotions: 2, records_updated: 18 },
      { period: 'Mar', hires: 7, exits: 2, transfers: 4, promotions: 1, records_updated: 24 },
      { period: 'Apr', hires: 5, exits: 1, transfers: 6, promotions: 3, records_updated: 21 },
      { period: 'May', hires: 11, exits: 1, transfers: 3, promotions: 4, records_updated: 30 },
      { period: 'Jun', hires: 5, exits: 1, transfers: 2, promotions: 2, records_updated: 10 },
      { period: 'Jul', hires: 6, exits: 1, transfers: 4, promotions: 2, records_updated: 26 },
    ],
    totals: { hires: 38, exits: 7, transfers: 22, promotions: 14, records_updated: 129 },
  },
};

function configColor(value: unknown, fallback: string): string {
  return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value) ? value : fallback;
}

function Header({ title }: { title: string }): VNode {
  return (
    <header class="em-widget__header" data-widget-fit-required data-widget-fit-group>
      <h3 data-widget-fit-no-overlap data-widget-fit-full-text>{title}</h3>
      <div class="em-widget__controls" data-widget-fit-no-overlap aria-hidden="true"><span class="em-widget__menu"><LucideIcon name="MoreHorizontal" size={18} /></span></div>
    </header>
  );
}

export type WorkforceGranularity = 'day' | 'week' | 'month';
const GRANULARITIES: { value: WorkforceGranularity; label: string }[] = [
  { value: 'day', label: 'Day' }, { value: 'week', label: 'Week' }, { value: 'month', label: 'Month' },
];

function WeeklyEmployeeActivity(): VNode {
  const bars = [45, 62, 30, 80, 57, 40, 55];
  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  return (
    <article class="em-widget em-widget--weekly" data-widget-content-root aria-label="Weekly employee activity preview">
      <Header title="Weekly employee activity" />
      <div class="em-widget__metric-line" data-widget-fit-required>
        <div class="em-widget__metric"><strong>57</strong><span>updates</span></div>
        <div class="em-widget__gain"><strong>↑18%</strong><span>vs last week</span></div>
      </div>
      <div class="em-weekly-chart" data-widget-fit-required data-widget-min-height="140" aria-label="Employee updates from Monday to Sunday">
        {bars.map((value, index) => (
          <div class="em-weekly-chart__column" key={days[index]}>
            <b>{value}</b>
            <i style={`--em-bar-height:${value}%;--em-bar-delay:${index * 65}ms`} />
            <span>{days[index]}</span>
          </div>
        ))}
      </div>
      <footer class="em-widget__legend" data-widget-fit-required>
        <span><i class="em-dot em-dot--green" />Profile edits</span>
        <span><i class="em-dot em-dot--blue" />Status changes</span>
        <span><i class="em-dot em-dot--purple" />Documents</span>
      </footer>
    </article>
  );
}

function DataChangeTrend(): VNode {
  return (
    <article class="em-widget em-widget--trend" data-widget-content-root aria-label="Data change trend preview">
      <Header title="Data change trend" />
      <div class="em-trend__metric" data-widget-fit-required><strong>68</strong><span>changes</span></div>
      <span class="em-trend__period">Last 7 days</span>
      <div class="em-trend__status" data-widget-fit-required><b>Stable</b><strong>↑ 8%</strong><span>vs baseline</span></div>
      <div class="em-trend__chart" data-widget-fit-required data-widget-min-height="120" aria-label="Stable seven-day upward data change trend">
        <svg viewBox="0 0 420 160" preserveAspectRatio="none" aria-hidden="true">
          <defs><linearGradient id="em-purple-area" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8153f4" stop-opacity=".26" /><stop offset="1" stop-color="#8153f4" stop-opacity=".03" /></linearGradient></defs>
          <path class="em-chart-area" d="M8 128 C40 112 55 82 88 80 C120 79 130 110 161 104 C190 99 199 69 225 56 C251 43 266 83 294 71 C321 60 324 26 350 18 C370 12 389 9 412 2 L412 148 L8 148 Z" fill="url(#em-purple-area)" />
          <path class="em-chart-line em-chart-line--purple" pathLength="1" d="M8 128 C40 112 55 82 88 80 C120 79 130 110 161 104 C190 99 199 69 225 56 C251 43 266 83 294 71 C321 60 324 26 350 18 C370 12 389 9 412 2" />
          <g class="em-chart-points em-chart-points--purple"><circle cx="8" cy="128" r="5" /><circle cx="88" cy="80" r="5" /><circle cx="161" cy="104" r="5" /><circle cx="225" cy="56" r="5" /><circle cx="294" cy="71" r="5" /><circle cx="350" cy="18" r="5" /><circle cx="412" cy="2" r="5" /></g>
        </svg>
        <div class="em-chart-days"><span>Mon</span><span>Tue</span><span>Wed</span><span>Thu</span><span>Fri</span><span>Sat</span><span>Sun</span></div>
      </div>
      <footer class="em-trend__summary" data-widget-fit-required>
        <div><span>Personal</span><strong><i class="em-dot em-dot--green" />28</strong></div>
        <div><span>Employment</span><strong><i class="em-dot em-dot--blue" />22</strong></div>
        <div><span>Assignment</span><strong><i class="em-dot em-dot--purple-light" />18</strong></div>
      </footer>
    </article>
  );
}

function LifecycleActivityView({ stats, config, granularity = 'month', onGranularity }: {
  stats: HrDashboardStats;
  config?: Record<string, unknown>;
  granularity?: WorkforceGranularity;
  /** Omitted by the library preview, which renders a fixed sample and cannot refetch. */
  onGranularity?: (next: WorkforceGranularity) => void;
}): VNode {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  // No fixed slice: the API returns exactly the buckets for the requested granularity
  // (14 days / 8 weeks / 6 months), so slicing here would silently truncate Day and Week.
  const periods = stats.lifecycle.periods.length ? stats.lifecycle.periods : LIFECYCLE_PREVIEW_STATS.lifecycle.periods;
  const movementColor = configColor(config?.movementColor, '#22c55e');
  const recordsColor = configColor(config?.recordsColor, '#f59e0b');
  const iconColor = configColor(config?.iconColor, '#0b1f4d');
  const textColor = configColor(config?.textColor, '#0b1f4d');
  // "Workforce Changes" is every headcount movement in the bucket — joins, leaves, transfers
  // and promotions. records_updated stays its own line: it measures admin activity, not people
  // moving, and summing the two would make a busy data-entry week look like churn.
  const movement = (period: HrDashboardStats['lifecycle']['periods'][number]): number =>
    period.hires + period.exits + period.transfers + period.promotions;
  // Value key, not the array reference: refetches return a fresh array every render,
  // and rebuilding the chart on reference change restarts the draw animation.
  const periodsKey = periods
    .map(period => `${period.period}:${movement(period)}:${period.records_updated}`)
    .join('|');

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const makeFill = (color: string): string | CanvasGradient => {
      if (!ctx) return `${color}12`;
      const gradient = ctx.createLinearGradient(0, 0, 0, canvas.clientHeight || 220);
      gradient.addColorStop(0, `${color}2e`);
      gradient.addColorStop(.6, `${color}0d`);
      gradient.addColorStop(1, `${color}00`);
      return gradient;
    };
    const movementByPeriod = periods.map(movement);
    const recordsByPeriod = periods.map(period => period.records_updated);
    const labels = periods.map(period => period.period);
    const lastIndex = labels.length - 1;

    // Dashed crosshair + guide line from the active movement point to the y-axis,
    // matching the reference card. Local to this chart instance (not globally registered).
    const crosshair: Plugin<'line'> = {
      id: 'emCrosshair',
      afterDatasetsDraw(chart) {
        const active = chart.getActiveElements();
        if (!active.length) return;
        const primary = active.find((a: ActiveElement) => a.datasetIndex === 0) ?? active[0];
        if (!primary) return;
        const { chartArea } = chart;
        const drawCtx = chart.ctx;
        const x = primary.element.x;
        const y = primary.element.y;
        drawCtx.save();
        drawCtx.strokeStyle = '#c7cfdb';
        drawCtx.lineWidth = 1;
        drawCtx.setLineDash([5, 5]);
        drawCtx.beginPath();
        drawCtx.moveTo(x, chartArea.top);
        drawCtx.lineTo(x, chartArea.bottom);
        drawCtx.moveTo(chartArea.left, y);
        drawCtx.lineTo(x, y);
        drawCtx.stroke();
        drawCtx.restore();
      },
    };

    // Progressive left-to-right DRAW — the motion this widget declares
    // (`motion: { kind: 'chart-draw', durationMs: 880, reducedMotion: 'static' }`).
    //
    // Chart.js's own property animation was doing something else entirely: it interpolates
    // every point's x/y, so the two series slid/rose in from the axis as finished shapes.
    // A draw has to reveal the finished geometry along the x-axis instead, which is a CLIP,
    // not a property tween — clipping also keeps the curve tension and the area fills
    // consistent with the final render, which per-point tweening cannot.
    //
    // Chart.js's animation is therefore off and this plugin owns the entrance: the clip
    // widens over DRAW_MS, driven by rAF, and once complete it stops clipping altogether so
    // the last point's `clip: false` overhang is not shaved off. Under
    // prefers-reduced-motion it starts finished — the declared 'static' end-state.
    let progress = reducedMotion() ? 1 : 0;
    let rafId = 0;
    let startedAt = 0;
    const draw: Plugin<'line'> = {
      id: 'emChartDraw',
      beforeDatasetsDraw(chart) {
        if (progress >= 1) return;
        const { chartArea, ctx: drawCtx } = chart;
        drawCtx.save();
        drawCtx.beginPath();
        // Full height, and generous vertical bleed, so only the horizontal sweep clips.
        drawCtx.rect(
          chartArea.left, 0,
          (chartArea.right - chartArea.left) * progress, chart.height,
        );
        drawCtx.clip();
      },
      afterDatasetsDraw(chart) {
        if (progress >= 1) return;
        // Paired with the save() above — restored before the crosshair plugin draws, which
        // is why `draw` is registered ahead of `crosshair` (same-hook plugins run in order).
        chart.ctx.restore();
      },
    };

    const chart = new Chart(canvas, {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: 'Workforce Changes',
            data: movementByPeriod,
            borderColor: movementColor,
            backgroundColor: makeFill(movementColor),
            borderWidth: 3,
            pointBackgroundColor: movementColor,
            pointBorderColor: '#fff',
            pointBorderWidth: 2.5,
            pointRadius: movementByPeriod.map((_, index) => index === lastIndex ? 5 : 0),
            pointHoverRadius: 6,
            pointHoverBackgroundColor: movementColor,
            pointHoverBorderColor: '#fff',
            pointHoverBorderWidth: 3,
            tension: .42,
            fill: 'origin',
            clip: false,
          },
          {
            label: 'Records Updated',
            data: recordsByPeriod,
            borderColor: recordsColor,
            backgroundColor: makeFill(recordsColor),
            borderWidth: 3,
            pointBackgroundColor: recordsColor,
            pointBorderColor: '#fff',
            pointBorderWidth: 2.5,
            pointRadius: 0,
            pointHoverRadius: 5,
            pointHoverBackgroundColor: recordsColor,
            pointHoverBorderColor: '#fff',
            pointHoverBorderWidth: 3,
            tension: .42,
            fill: 'origin',
            clip: false,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        // Off by design — the entrance is the `emChartDraw` clip sweep above. Leaving
        // Chart.js's property animation on would tween x/y underneath the sweep, which is
        // the sliding entrance this replaces, and the two would fight on every re-render.
        animation: false,
        // 'nearest' (not 'index') so each point is hovered individually — the green and
        // amber series are read separately, not joined at a shared x.
        interaction: { mode: 'nearest', intersect: false },
        layout: { padding: { top: 26, right: 12, bottom: 2, left: 4 } },
        plugins: {
          legend: { display: false },
          tooltip: {
            enabled: false,
            external: ({ chart: c, tooltip }: { chart: Chart; tooltip: TooltipModel<'line'> }) => {
              const el = tooltipRef.current;
              if (!el) return;
              if (tooltip.opacity === 0) { el.style.opacity = '0'; return; }
              const month = tooltip.dataPoints[0]?.label ?? '';
              const monthEl = el.querySelector<HTMLElement>('.emtt-month');
              if (monthEl) monthEl.textContent = month;
              const rowsEl = el.querySelector<HTMLElement>('.emtt-rows');
              if (rowsEl) {
                // Every datapoint at this month — both the green and amber series — so the
                // hover always shows both values, not just the line nearest the cursor.
                rowsEl.replaceChildren(...tooltip.dataPoints.map(dp => {
                  const color = typeof dp.dataset.borderColor === 'string' ? dp.dataset.borderColor : '#fff';
                  const row = document.createElement('div');
                  row.className = 'emtt-row';
                  const dot = document.createElement('span');
                  dot.className = 'emtt-dot';
                  dot.style.background = color;
                  const value = document.createElement('b');
                  value.textContent = String(dp.parsed.y);
                  const name = document.createElement('span');
                  name.className = 'emtt-name';
                  name.textContent = dp.dataset.label ?? '';
                  row.append(dot, value, name);
                  return row;
                }));
              }
              el.classList.toggle('is-below', tooltip.caretY < 64);
              el.style.opacity = '1';
              // Clamp the (centre-anchored) tooltip so it never overflows the chart
              // container — otherwise the last point's card is cut off by the card edge.
              const container = el.parentElement;
              const half = el.offsetWidth / 2;
              const pad = 4;
              let cx = c.canvas.offsetLeft + tooltip.caretX;
              if (container) cx = Math.max(half + pad, Math.min(container.clientWidth - half - pad, cx));
              el.style.left = `${cx}px`;
              el.style.top = `${c.canvas.offsetTop + tooltip.caretY}px`;
            },
          },
        },
        scales: {
          x: {
            grid: { display: false },
            border: { display: false },
            ticks: {
              color: (c: ScriptableScaleContext) => c.index === lastIndex ? '#334155' : '#9aa5b8',
              font: (c: ScriptableScaleContext) => ({ size: 12, weight: c.index === lastIndex ? 700 : 500 }),
            },
          },
          y: {
            beginAtZero: true,
            grace: '30%',
            grid: { color: '#eef2f6', drawTicks: false },
            border: { display: false },
            ticks: { color: '#b5becb', precision: 0, maxTicksLimit: 5, padding: 10, font: { size: 12, weight: 500 } },
          },
        },
      },
      // Order matters: emChartDraw must restore the clip before emCrosshair paints, so the
      // hover guides are never shaved by a sweep still in flight.
      plugins: [draw, crosshair],
    });

    // Drive the sweep. easeOutQuart matches the pace the rest of this card animates at.
    if (progress < 1) {
      const tick = (now: number): void => {
        startedAt ||= now;
        const t = Math.min(1, (now - startedAt) / DRAW_MS);
        progress = 1 - Math.pow(1 - t, 4);
        chart.draw();
        if (t < 1) rafId = requestAnimationFrame(tick);
        else { rafId = 0; progress = 1; chart.draw(); }
      };
      rafId = requestAnimationFrame(tick);
    }

    return () => {
      if (rafId) cancelAnimationFrame(rafId);
      chart.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- periodsKey stands in for periods (value equality)
  }, [periodsKey, movementColor, recordsColor]);

  return (
    <article class="em-widget em-widget--lifecycle" data-widget-content-root aria-label="Employee activity" style={`--em-life-icon:${iconColor};--em-life-text:${textColor};--em-life-activity:${movementColor};--em-life-records:${recordsColor}`}>
      <header class="em-widget__header em-lifecycle__header" data-widget-fit-required data-widget-fit-group>
        <div class="em-lifecycle__title" data-widget-fit-no-overlap>
          <span aria-hidden="true"><LucideIcon name="ChartNoAxesCombined" size={20} /></span>
          <h3 data-widget-fit-full-text>Workforce Activity</h3>
        </div>
        <div class="em-lifecycle__legend" aria-hidden="true">
          <span class="is-movements">Changes</span>
          <span class="is-records">Records</span>
        </div>
        <div class="em-lifecycle__range" role="group" aria-label="Activity range">
          {GRANULARITIES.map(option => (
            <button key={option.value} type="button"
              class={option.value === granularity ? 'is-on' : ''}
              aria-pressed={option.value === granularity}
              disabled={!onGranularity}
              onClick={() => onGranularity?.(option.value)}>{option.label}</button>
          ))}
        </div>
      </header>
      <div class="em-lifecycle__chart" data-widget-fit-required data-widget-min-height="140" aria-label="Employee activity by month">
        <canvas ref={canvasRef} role="img" aria-label="Employee Activity monthly trend" />
        <div class="em-lifecycle__tooltip" ref={tooltipRef} aria-hidden="true">
          <div class="emtt-month" />
          <div class="emtt-rows" />
        </div>
      </div>
      {/* Totals, not chart lines. New Hires and Exits are deliberately absent — they are
          already KPI cards, and repeating them here was the same number shown twice. */}
      <footer class="em-lifecycle__summary" data-widget-fit-required>
        <div><i aria-hidden="true"><LucideIcon name="ClipboardList" size={20} /></i><strong>{stats.hr_work_queue.total}</strong><span>Pending Reviews</span></div>
        <div><i aria-hidden="true"><LucideIcon name="ShieldAlert" size={20} /></i><strong>{stats.readiness.blocked}</strong><span>Readiness Gaps</span></div>
      </footer>
    </article>
  );
}

function LifecycleActivity(props: WidgetRenderProps): VNode {
  const [granularity, setGranularity] = useState<WorkforceGranularity>('month');
  const query = useHrDashboardStats({ granularity });
  if (query.isLoading) return <LifecycleActivityView stats={LIFECYCLE_PREVIEW_STATS} config={props.config} granularity={granularity} onGranularity={setGranularity} />;
  if (!query.data) return <article class="em-widget em-widget--lifecycle" data-widget-content-root role="alert"><Header title="Employee Activity" /><div class="em-widget__empty">Employee activity is unavailable.</div></article>;
  return <LifecycleActivityView stats={query.data} config={props.config} granularity={granularity} onGranularity={setGranularity} />;
}

function WorkloadRing({ value, tone }: { value: number; tone: 'green' | 'orange' }): VNode {
  return <div class={`em-workload-ring em-workload-ring--${tone}`} style={`--em-progress:${value * 3.6}deg`} aria-label={`${value} percent`}><div><strong>{value}<small>%</small></strong></div></div>;
}

function MasterDataWorkload(): VNode {
  return (
    <article class="em-widget em-widget--workload" data-widget-content-root aria-label="Master data workload preview">
      <Header title="Master data workload" />
      <div class="em-workload__rows" data-widget-fit-required>
        <div class="em-workload__row"><WorkloadRing value={72} tone="green" /><div><span>Pending corrections</span><strong>18</strong></div></div>
        <div class="em-workload__row"><WorkloadRing value={35} tone="orange" /><div><span>Pending approvals</span><strong>9</strong></div></div>
      </div>
      <footer class="em-workload__footer" data-widget-fit-required><span><i aria-hidden="true"><LucideIcon name="Clock3" size={18} /></i>Oldest item: 3 days</span><span class="em-workload__link">Open work queue <b aria-hidden="true">›</b></span></footer>
    </article>
  );
}

function BlockedEmployeeActions(): VNode {
  const actions = [
    { title: 'Missing work permit', employee: 'Claudia Pierre · EMP-0008', due: 'Due Jul 24', owner: 'HR Team', initials: 'CP', priority: 'High', tone: 'red' },
    { title: 'Work email setup', employee: 'Amara Diallo · EMP-0010', due: 'Due Jul 25', owner: 'IT Team', initials: 'AD', priority: 'High', tone: 'red' },
    { title: 'Medical clearance', employee: 'Damani Baptiste · EMP-0007', due: 'Due Jul 26', owner: 'HSE Team', initials: 'DB', priority: 'Medium', tone: 'amber' },
  ];
  return <article class="em-widget em-widget--blocked" data-widget-content-root aria-label="Blocked employee actions preview"><Header title="Blocked employee actions" /><div class="em-blocked__list" data-widget-fit-required>{actions.map(action => <div class="em-blocked__item" key={action.title}><span class={`em-blocked__signal is-${action.tone}`} /><div class="em-blocked__copy"><strong>{action.title}</strong><span>{action.employee}</span></div><span class={`em-blocked__priority is-${action.tone}`}>{action.priority}</span><span class="em-blocked__due"><LucideIcon name="CalendarDays" size={14} />{action.due}</span><span class={`em-avatar em-avatar--${action.tone}`}>{action.initials}</span><span class="em-blocked__owner">{action.owner}</span></div>)}</div><footer class="em-widget__action"><span>View all</span><LucideIcon name="ChevronRight" size={17} /></footer></article>;
}

function RecordHealth(): VNode {
  const segments = Array.from({ length: 13 }, (_, index) => index < 6 ? 'green' : index < 11 ? 'blue' : 'muted');
  const facts: { icon: LucideName; label: string; value: string; tone: string }[] = [
    { icon: 'ShieldCheck', label: 'Identity', value: '100%', tone: 'green' },
    { icon: 'BriefcaseBusiness', label: 'Employment', value: '96%', tone: 'green' },
    { icon: 'FileText', label: 'Documents', value: '78%', tone: 'blue' },
    { icon: 'LockKeyhole', label: 'Access', value: '58%', tone: 'amber' },
  ];
  return (
    <article class="em-widget em-widget--health" data-widget-content-root aria-label="Employee record health preview">
      <Header title="Employee record health" />
      <div class="em-health__gauge" data-widget-fit-required aria-label="Record health 83 out of 100">
        <div class="sdb-gauge">
          <svg viewBox="0 0 118 78" role="presentation">
            {segments.map((tone, index) => <line key={index} class={`is-${tone}`} x1="59" y1="31" x2="59" y2="20"
              stroke-width="5.6" stroke-linecap="round" transform={`rotate(${-90 + index * 15} 59 62)`} pathLength="1" style={`--em-health-index:${index}`} />)}
          </svg>
        </div>
        <div><strong>83</strong><span>/100</span><b><i />Good</b></div>
      </div>
      <div class="em-health__facts" data-widget-fit-required>
        {facts.map(fact => <div key={fact.label}><i><LucideIcon name={fact.icon} size={20} /></i><span>{fact.label}</span><strong class={`is-${fact.tone}`}>{fact.value}</strong></div>)}
      </div>
    </article>
  );
}

function RecordRiskMonitor(): VNode {
  return (
    <article class="em-widget em-widget--risk" data-widget-content-root aria-label="Record risk monitor preview">
      <Header title="Record risk monitor" />
      <div class="em-risk__gauge" data-widget-fit-required>
        <svg viewBox="0 0 360 158" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
          <defs><linearGradient id="em-risk-arc" x1="0" x2="1"><stop offset="0" stop-color="#20b75d"/><stop offset=".48" stop-color="#f2c83f"/><stop offset=".75" stop-color="#ff8b24"/><stop offset="1" stop-color="#ee2e24"/></linearGradient></defs>
          <path class="em-risk__arc" pathLength="1" d="M34 132 A146 146 0 0 1 326 132" fill="none" stroke="url(#em-risk-arc)" stroke-width="13" stroke-linecap="round" />
          <g class="em-risk__needle">
            <path d="M180 132 L92 50" fill="none" stroke="#79c885" stroke-width="2" />
            <circle cx="92" cy="50" r="10" fill="#57bd64" stroke="#fff" stroke-width="4" />
            <circle cx="180" cy="132" r="4" fill="#79c885" />
          </g>
        </svg>
        <div><strong>32<small>%</small></strong><span>Elevated risk</span></div>
      </div>
      <div class="em-risk__spark" aria-label="Current record-risk trend"><svg viewBox="0 0 360 54" preserveAspectRatio="none" aria-hidden="true"><defs><linearGradient id="em-risk-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#22b45d" stop-opacity=".28"/><stop offset="1" stop-color="#22b45d" stop-opacity="0"/></linearGradient></defs><path class="em-risk__spark-area" d="M0 38 C10 8 23 13 32 35 C42 52 53 17 67 31 C81 46 91 45 103 31 C116 12 130 7 143 22 C155 37 166 12 180 13 C197 15 204 31 217 23 C232 14 240 18 250 10 C266 -3 277 2 285 20 C297 43 308 35 320 30 C333 23 344 31 360 29 L360 54 L0 54 Z" fill="url(#em-risk-fill)"/><path class="em-risk__spark-line" pathLength="1" d="M0 38 C10 8 23 13 32 35 C42 52 53 17 67 31 C81 46 91 45 103 31 C116 12 130 7 143 22 C155 37 166 12 180 13 C197 15 204 31 217 23 C232 14 240 18 250 10 C266 -3 277 2 285 20 C297 43 308 35 320 30 C333 23 344 31 360 29" fill="none" stroke="#18ad53" stroke-width="2"/><circle class="em-risk__spark-dot" cx="360" cy="29" r="5" fill="#fff" stroke="#18ad53" stroke-width="2"/></svg></div>
      <footer class="em-risk__summary" data-widget-fit-required><div><span>Highest risk</span><strong>58%</strong></div><div><span>Average risk</span><strong>35%</strong></div></footer>
    </article>
  );
}

function previewDefinition(input: {
  id: string; title: string; description: string; icon: string; tags: string[];
  category: string; recommended?: boolean; defaultSize: WidgetDef['defaultSize']; previewAspect: number; sizeConstraints: WidgetSizeConstraints;
  previewVariant: WidgetDef['previewVariant']; motion: NonNullable<WidgetDef['motion']>; component: () => VNode; allowedSizes?: WidgetSizeDef[];
}): WidgetDef {
  return defineWidget({
    id: input.id, module: 'hr', area: 'Employee Master', title: input.title, description: input.description,
    longDescription: `${input.description} This approved visual is ready for placement testing; live figures will be connected only through an authenticated Employee Master API.`,
    icon: input.icon, category: input.category, tags: ['hr', 'employee master', ...input.tags], previewVariant: input.previewVariant,
    // These cards fill their grid tile and resize on both axes. The content-measured validator
    // enforces the safe floor; size-to-content would take height ownership away from the user and
    // leave the southeast grip below shorter card content on a coarse board grid.
    chrome: 'none', sizeToContent: false, supportedPages: [PAGE], supportedZones: ['main'], defaultSize: input.defaultSize, allowedSizes: input.allowedSizes ?? SIZES, sizeConstraints: input.sizeConstraints,
    previewAspect: input.previewAspect, defaultConfig: {}, configSchema: [], dataSource: PREVIEW_SOURCE,
    governance: { state: 'preview', discoverable: true, allowedPages: [PAGE], requiredCapabilities: ['hr.employees.view'] },
    permissions: { requiredPermissions: ['hr.employees.view'] }, runtimeState: 'static-preview', motion: input.motion,
    ...(input.recommended ? { recommendedFor: [PAGE] } : {}), render: input.component, renderPreview: input.component,
  });
}

export const widgets: WidgetDef[] = [
  previewDefinition({ id: 'hr.employeeMaster.blockedActions', title: 'Blocked Employee Actions', description: 'Employee record actions currently blocked or approaching their due dates.', icon: 'fa-circle-exclamation', category: 'Actions & workload', defaultSize: 'standard', previewAspect: 1.08, sizeConstraints: { defaultColumns: 10, defaultRows: 28, minColumns: 7, minRows: 12, minWidth: 350, minHeight: 390, resizeStrategy: 'content-measured' }, tags: ['blocked actions', 'deadlines', 'selection a'], previewVariant: 'task-board', motion: { kind: 'sequence', durationMs: 640, reducedMotion: 'static' }, component: BlockedEmployeeActions, allowedSizes: DESIGN_SIZES }),
  previewDefinition({ id: 'hr.employeeMaster.recordHealth', title: 'Employee Record Health', description: 'Completeness across identity, employment, documents, and access.', icon: 'fa-shield-heart', category: 'Health & readiness', defaultSize: 'standard', previewAspect: 1.08, sizeConstraints: { defaultColumns: 8, defaultRows: 22, minColumns: 5, minRows: 12, minWidth: 250, minHeight: 270, resizeStrategy: 'content-measured' }, tags: ['record health', 'completeness', 'selection f'], previewVariant: 'donut', motion: { kind: 'sequence', durationMs: 780, reducedMotion: 'static' }, component: RecordHealth, allowedSizes: HEALTH_SIZES }),
  previewDefinition({ id: 'hr.employeeMaster.recordRisk', title: 'Record Risk Monitor', description: 'Employee-record risk level and recent movement.', icon: 'fa-gauge-high', category: 'Health & readiness', defaultSize: 'standard', previewAspect: 1.2, sizeConstraints: { defaultColumns: 7, defaultRows: 17, minColumns: 5, minRows: 12, minWidth: 240, minHeight: 260, resizeStrategy: 'content-measured' }, tags: ['record risk', 'risk monitor', 'selection h'], previewVariant: 'risk', motion: { kind: 'chart-draw', durationMs: 820, reducedMotion: 'static' }, component: RecordRiskMonitor, allowedSizes: RISK_SIZES }),
  previewDefinition({ id: 'hr.employeeMaster.weeklyActivity', title: 'Weekly Employee Activity', description: 'Employee Master updates across the current week.', icon: 'fa-chart-column', category: 'Activity & trends', defaultSize: 'standard', previewAspect: 1.25, sizeConstraints: { defaultColumns: 10, defaultRows: 22, minColumns: 4, minRows: 12, minWidth: 240, minHeight: 330, resizeStrategy: 'content-measured' }, tags: ['weekly activity', 'bar chart', 'selection l'], previewVariant: 'trend', motion: { kind: 'sequence', durationMs: 760, reducedMotion: 'static' }, component: WeeklyEmployeeActivity }),
  previewDefinition({ id: 'hr.employeeMaster.changeTrend', title: 'Data Change Trend', description: 'Seven-day trend for Employee Master data changes.', icon: 'fa-chart-line', category: 'Activity & trends', defaultSize: 'standard', previewAspect: 1.25, sizeConstraints: { defaultColumns: 10, defaultRows: 22, minColumns: 6, minRows: 12, minWidth: 280, minHeight: 350, resizeStrategy: 'content-measured' }, tags: ['change trend', 'line chart', 'selection m'], previewVariant: 'trend', motion: { kind: 'chart-draw', durationMs: 820, reducedMotion: 'static' }, component: DataChangeTrend }),
  defineWidget<Record<string, unknown>>({
    id: 'hr.employeeMaster.lifecycleActivity',
    module: 'hr',
    area: 'Employee Master',
    title: 'Workforce Activity',
    description: 'Monthly Employee Master activity, current review workload, readiness gaps, and record updates.',
    icon: 'fa-rotate',
    category: 'Activity & trends',
    tags: ['hr', 'employee master', 'lifecycle', 'live api', 'chart.js', 'selection n'],
    previewVariant: 'trend',
    chrome: 'none',
    sizeToContent: false,
    supportedPages: [PAGE],
    supportedZones: ['main'],
    defaultSize: 'large',
    allowedSizes: DESIGN_SIZES,
    sizeConstraints: { defaultColumns: 16, defaultRows: 28, minColumns: 6, minRows: 12, minWidth: 280, minHeight: 340, resizeStrategy: 'content-measured' },
    previewAspect: 2,
    defaultConfig: {
      textColor: '#0b1f4d',
      iconColor: '#0b1f4d',
      movementColor: '#22c55e',
      recordsColor: '#f59e0b',
    },
    configSchema: [
      { key: 'textColor', label: 'Title Text Colour', type: 'color', defaultValue: '#0b1f4d' },
      { key: 'iconColor', label: 'Icon Colour', type: 'color', defaultValue: '#0b1f4d' },
      { key: 'movementColor', label: 'Movements Line Colour', type: 'color', defaultValue: '#22c55e' },
      { key: 'recordsColor', label: 'Records Line Colour', type: 'color', defaultValue: '#f59e0b' },
    ],
    dataSource: LIVE_SOURCE,
    dataSourceKey: LIVE_SOURCE.sourceKey,
    governance: { state: 'enabled', discoverable: true, allowedPages: [PAGE], requiredCapabilities: ['hr.employees.view'] },
    permissions: { requiredPermissions: ['hr.employees.view'] },
    runtimeState: 'live-api',
    motion: { kind: 'chart-draw', durationMs: 880, reducedMotion: 'static' },
    recommendedFor: [PAGE],
    render: LifecycleActivity,
    renderPreview: props => <LifecycleActivityView stats={LIFECYCLE_PREVIEW_STATS} config={props.config} />,
  }),
  previewDefinition({ id: 'hr.employeeMaster.adminWorkload', title: 'Master Data Workload', description: 'Pending Employee Master corrections and approvals.', icon: 'fa-list-check', category: 'Work management', defaultSize: 'large', previewAspect: 2, sizeConstraints: { defaultColumns: 16, defaultRows: 28, minColumns: 4, minRows: 12, minWidth: 240, minHeight: 330, resizeStrategy: 'content-measured' }, tags: ['workload', 'corrections', 'approvals', 'selection o'], previewVariant: 'status-stack', motion: { kind: 'progress', durationMs: 720, reducedMotion: 'static' }, component: MasterDataWorkload }),
];
