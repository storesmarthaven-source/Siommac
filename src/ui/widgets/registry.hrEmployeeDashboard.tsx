import type { VNode } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import {
  CategoryScale,
  Chart,
  BarController,
  BarElement,
  Filler,
  Legend,
  LineController,
  LineElement,
  LinearScale,
  PointElement,
  RadarController,
  RadialLinearScale,
  Tooltip,
} from 'chart.js';
import { useHrDashboardStats, useHrEmployeesPage, type HrDashboardStats, type HrEmployeeRow } from '@api/hr/employees';
import { LucideIcon, type LucideName } from '../LucideIcon';
import { KpiTile, type KpiTone } from '../components/KpiTile';
import { WidgetSkeleton } from '../components/Skeleton';
import { defineWidget } from './defineWidget';
import { findWidgetDataSource, registerWidgetDataSource } from './dataSources';
import type { WidgetDef, WidgetRenderProps, WidgetSizeDef } from './types';
import './hrEmployeeDashboardWidgets.css';

Chart.register(LineController, RadarController, BarController, CategoryScale, LinearScale, RadialLinearScale, PointElement, LineElement, BarElement, Filler, Tooltip, Legend);

const PAGE = 'hr.employees.overview.v3';

const SOURCE = {
  sourceKey: 'hr.employee-master.dashboard',
  label: 'Employee Master Dashboard API',
  refreshIntervalMs: 60_000,
  permissions: ['hr.employees.view'],
};

if (!findWidgetDataSource(SOURCE.sourceKey)) {
  registerWidgetDataSource({
    key: SOURCE.sourceKey,
    label: SOURCE.label,
    endpoint: '/api/hr/employees/dashboard-stats',
    permission: 'hr.employees.view',
    scope: 'organization',
    refresh: { mode: 'realtime-invalidation' },
    authenticated: true,
  });
}

// The KPI strip is a reorder-only row (see EmployeeMaster's KPI board: resizable={false}), so a
// tile is FIXED: min and max pin to the single grid size, which is what defineWidget requires of
// any non-resizable widget. w4×h6 on a cellHeight-6 grid == the Statutory KPI tile.
const KPI_SIZES: WidgetSizeDef[] = [
  { key: 'compact', label: 'Fixed', grid: { w: 4, h: 6 }, min: { w: 4, h: 6 }, max: { w: 4, h: 6 }, description: 'Statutory-size Employee Master KPI tile' },
];
// A DOUBLE-WIDE KPI tile: exactly two standard slots (w8) at the same h6, so it lines up with the
// strip rather than sitting on its own row. Fixed for the same reason as KPI_SIZES — the strip is
// reorder-only, so a tile's size is code-owned, and defineWidget requires min == max for a
// non-resizable widget. Use it when a metric genuinely needs the width (a breakdown BESIDE the
// headline number), never to give a single number more room.
const KPI_WIDE_SIZES: WidgetSizeDef[] = [
  { key: 'standard', label: 'Fixed (double)', grid: { w: 8, h: 6 }, min: { w: 8, h: 6 }, max: { w: 8, h: 6 }, description: 'Double-width Employee Master KPI tile' },
];
/** Both KPI families are fixed, chrome-less strip tiles; only their width differs. */
const isKpiFamily = (sizes: WidgetSizeDef[]): boolean => sizes === KPI_SIZES || sizes === KPI_WIDE_SIZES;
// Workforce-pulse cards are a SHORT absolute-positioned design (header row + value
// row). On the old coarse main board (cellHeight 88) the KPI h:6 stretched them to ~528px
// with a huge void — a short height fits the design without overlap.
//
// ── UNIT SYSTEM ───────────────────────────────────────────────────────────────
// Every size below is in the Employee Master main board's units: cellHeight 6 + a 12px
// gap, so a tile is `18h − 12` px tall (same grid as the Statutory dashboard and the
// Payroll Command Centre). Widths are columns on that board's 24-column grid.
// KPI_SIZES is deliberately NOT in this system — it stays w4×h6 on the separate
// cellHeight-6 KPI strip, where the tile is a fixed 96px.
const PULSE_SIZES: WidgetSizeDef[] = [
  { key: 'compact', label: 'Compact', grid: { w: 4, h: 6 }, min: { w: 3, h: 6 }, description: 'Compact workforce pulse card' },
  { key: 'standard', label: 'Standard', grid: { w: 6, h: 11 }, min: { w: 3, h: 6 }, description: 'Standard workforce pulse card' },
  { key: 'wide', label: 'Wide', grid: { w: 8, h: 17 }, min: { w: 3, h: 6 }, description: 'Wide workforce pulse card' },
];
const CHART_SIZES: WidgetSizeDef[] = [
  { key: 'standard', label: 'Standard', grid: { w: 10, h: 22 }, min: { w: 8, h: 12 }, description: 'Focused chart' },
  { key: 'wide', label: 'Wide', grid: { w: 12, h: 22 }, min: { w: 8, h: 12 }, description: 'Full chart detail' },
  { key: 'large', label: 'Large', grid: { w: 16, h: 28 }, min: { w: 8, h: 12 }, description: 'Expanded analysis' },
];
const QUALITY_SIZES: WidgetSizeDef[] = [
  { key: 'standard', label: 'Standard', grid: { w: 7, h: 28 }, min: { w: 6, h: 12 }, description: 'Focused record-quality scorecard' },
  { key: 'large', label: 'Large', grid: { w: 10, h: 33 }, min: { w: 6, h: 12 }, description: 'Expanded quality detail' },
];
const RADAR_SIZES: WidgetSizeDef[] = [
  { key: 'standard', label: 'Standard', grid: { w: 7, h: 28 }, min: { w: 5, h: 12 }, description: 'Readiness radar scorecard' },
  { key: 'large', label: 'Large', grid: { w: 10, h: 33 }, min: { w: 5, h: 12 }, description: 'Expanded readiness radar' },
];
const ATTENTION_PORTRAIT_SIZES: WidgetSizeDef[] = [
  // 'standard' is the defaultSize, so its grid IS the widget's placed size (externalDefinition
  // derives defaultColumns/defaultRows from it). w7 × h30 == 389 × 528px — operator-set, and it
  // now genuinely fits: the card's content measures ~485px after the compaction pass below
  // (it was ~760px, which is why it used to open an inner scrollbar and then hide its own
  // facts strip to cope).
  //
  // `min.h` stays 12 on purpose. minRows is "the smallest it can still RENDER" — raising it to
  // the content height is what made the resize handle snap straight back on other widgets (see
  // the 'keeps every resizable widget free to shrink vertically' invariant in platform.test.tsx
  // and the "minimum size reached" pitfall in CLAUDE.md).
  { key: 'standard', label: 'Standard', grid: { w: 7, h: 30 }, min: { w: 6, h: 12 }, description: 'Portrait employee attention card' },
  { key: 'wide', label: 'Wide', grid: { w: 10, h: 39 }, min: { w: 6, h: 12 }, description: 'Expanded employee attention card' },
  { key: 'large', label: 'Large', grid: { w: 13, h: 44 }, min: { w: 6, h: 12 }, description: 'Large employee attention card' },
];
const STACKED_CHART_SIZES: WidgetSizeDef[] = [
  { key: 'standard', label: 'Standard', grid: { w: 7, h: 22 }, min: { w: 6, h: 12 }, description: 'Lifecycle stacked chart' },
  { key: 'wide', label: 'Wide', grid: { w: 11, h: 28 }, min: { w: 6, h: 12 }, description: 'Expanded lifecycle chart' },
];

const DIRECTORY_SOURCE = { sourceKey: 'hr.employee-master.directory', label: 'Employee Master Directory API', refreshIntervalMs: 60_000, permissions: ['hr.employees.view'] };
if (!findWidgetDataSource(DIRECTORY_SOURCE.sourceKey)) {
  registerWidgetDataSource({ key: DIRECTORY_SOURCE.sourceKey, label: DIRECTORY_SOURCE.label, endpoint: '/api/hr/employees/list', permission: 'hr.employees.view', scope: 'organization', refresh: { mode: 'realtime-invalidation' }, authenticated: true });
}
const CALENDAR_SOURCE = {
  sourceKey: 'platform.calendar', label: 'Calendar & Tasks API', refreshIntervalMs: 60_000, permissions: ['calendar.view'],
};
if (!findWidgetDataSource(CALENDAR_SOURCE.sourceKey)) {
  registerWidgetDataSource({ key: CALENDAR_SOURCE.sourceKey, label: CALENDAR_SOURCE.label, endpoint: '/api/calendar/list', permission: 'calendar.view', scope: 'user', refresh: { mode: 'interval', intervalMs: 60_000 }, authenticated: true });
}

const PREVIEW: HrDashboardStats = {
  active_workforce: { total: 128, employees: 116, contractors: 12, trend: [{ period: 'Feb', count: 117 }, { period: 'Mar', count: 120 }, { period: 'Apr', count: 121 }, { period: 'May', count: 124 }, { period: 'Jun', count: 126 }, { period: 'Jul', count: 128 }] },
  hr_work_queue: { total: 14, urgent: 3, oldest_days: 4, mix: [{ type: 'contact_update', count: 6 }, { type: 'transfer_promotion', count: 5 }, { type: 'status_change', count: 3 }] },
  readiness: { percent: 86, assignment_complete: 118, payroll_ready: 121, training_current: 92, blocked: 5 },
  exceptions: { total: 11, items: [{ type: 'Supervisor', count: 4 }, { type: 'Payroll', count: 3 }, { type: 'Training', count: 4 }] },
  distribution: { departments: [{ id: 'ops', label: 'Operations', count: 48, percent: 38 }, { id: 'finance', label: 'Finance', count: 29, percent: 23 }, { id: 'hr', label: 'Human Resources', count: 24, percent: 19 }, { id: 'other', label: 'Other', count: 27, percent: 21 }], sites: [{ id: 'hq', label: 'Head Office', count: 76, percent: 59 }, { id: 'south', label: 'South Site', count: 32, percent: 25 }, { id: 'other', label: 'Other', count: 20, percent: 16 }] },
  lifecycle: { periods: [{ period: 'Feb', hires: 4, exits: 1, transfers: 2, promotions: 1, records_updated: 18 }, { period: 'Mar', hires: 5, exits: 2, transfers: 1, promotions: 2, records_updated: 22 }, { period: 'Apr', hires: 3, exits: 2, transfers: 3, promotions: 1, records_updated: 17 }, { period: 'May', hires: 6, exits: 1, transfers: 2, promotions: 2, records_updated: 25 }, { period: 'Jun', hires: 4, exits: 2, transfers: 4, promotions: 1, records_updated: 20 }, { period: 'Jul', hires: 5, exits: 1, transfers: 2, promotions: 2, records_updated: 23 }], totals: { hires: 27, exits: 9, transfers: 14, promotions: 9, records_updated: 125 } },
};

function WidgetState({ kind, message }: { kind: 'loading' | 'error'; message?: string }): VNode {
  if (kind === 'loading') {
    return <WidgetSkeleton class="hrew-card" variant="card" />;
  }
  return <article class="hrew-card hrew-state" data-widget-content-root role="alert">
    <LucideIcon name="TriangleAlert" size={23} />
    <span>{message ?? 'Employee Master data is unavailable.'}</span>
  </article>;
}

function withLiveData(View: (props: { stats: HrDashboardStats; config?: Record<string, unknown> }) => VNode): (props: WidgetRenderProps) => VNode {
  return function LiveWidget(props: WidgetRenderProps): VNode {
    const query = useHrDashboardStats();
    if (query.isLoading) return <WidgetState kind="loading" />;
    if (!query.data) return <WidgetState kind="error" message={query.error instanceof Error ? query.error.message : 'Employee Master data is unavailable.'} />;
    return <View stats={query.data} config={props.config} />;
  };
}

function focusEmployeeRegister(): void {
  document.querySelector<HTMLElement>('[data-testid="employee-register"]')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/** A KPI's action APPLIES its filter to the register instead of just scrolling to it, so the
 *  number you clicked and the rows you land on are the same set. The register listens for this
 *  event (see REGISTER_FILTER_EVENT in EmployeeMaster) — the board renders KPIs outside its tree,
 *  so props are not available. */
function applyRegisterFilter(detail: Record<string, string[]>): void {
  window.dispatchEvent(new CustomEvent('siomac:employee-register-filter', { detail }));
  focusEmployeeRegister();
}

/** Event the Employee Attention card raises to open a specific employee's profile drawer.
 *  Same reason as the filter event above: the board renders widgets OUTSIDE the page's tree, so a
 *  widget cannot reach the page's selection state through props. EmployeeMaster listens for this
 *  and sets the drawer's employee id. */
export const EMPLOYEE_DRAWER_EVENT = 'siomac:hr-open-employee-drawer';

/** Open the profile drawer for one employee. "Review Employee Record" used to call
 *  focusEmployeeRegister, i.e. it scrolled the page and left the reader to find the person
 *  themselves — a button whose label promises a record but only moves the viewport. */
function openEmployeeDrawer(employeeId: string): void {
  window.dispatchEvent(new CustomEvent<{ employeeId: string }>(EMPLOYEE_DRAWER_EVENT, { detail: { employeeId } }));
}

/** A DOUBLE-WIDE KPI tile (w8 = two strip slots).
 *
 *  Left is exactly a standard KPI tile (icon chip, value, label, sub). Right is a single stacked
 *  bar showing the composition of that value, and it gets the whole right half at full height —
 *  which is what the removed legend and drill-through link paid for. At 7px beside a four-row
 *  labelled legend the bar was a sliver; the tile cost two slots and showed less than one.
 *
 *  Segments sum to the total, so a share can never be misread — an earlier pass scaled each
 *  category to the LARGEST one, which drew a 1/1/1 mix as three full bars. Counts print inside
 *  segments wide enough to hold them; category names live in each segment's tooltip and in the
 *  bar's aria-label, so nothing is lost to a reader or a screen reader.
 */
function KpiWideCard({ title, value, detail, icon, tone = 'blue', breakdown }: {
  title: string; value: number | string; detail: string; icon: string;
  tone?: KpiTone;
  breakdown: { label: string; count: number; colour: string }[];
}): VNode {
  const sum = breakdown.reduce((total, item) => total + item.count, 0);
  return (
    <article class={`hrew-kpi-wide is-${tone}`} data-widget-content-root aria-label={title}>
      <div class="hrew-kpi-wide__lead">
        <span class={`hrew-kpi-wide__ic is-${tone}`} aria-hidden="true"><i class={`fa-solid ${icon}`} /></span>
        <div class="hrew-kpi-wide__row"><strong>{value}</strong><span>{title}</span></div>
        <small>{detail}</small>
      </div>
      {sum > 0 && (
        <div class="hrew-kpi-wide__mix">
          <div class="hrew-kpi-wide__bar" role="img"
            aria-label={`${title} — ${breakdown.map(item => `${item.label} ${item.count}`).join(', ')}`}>
            {breakdown.map(item => {
              const share = item.count / sum * 100;
              return (
                <i key={item.label} title={`${item.label}: ${item.count}`}
                  style={`width:${share}%;background:${item.colour}`} />
              );
            })}
          </div>
        </div>
      )}
    </article>
  );
}

function KpiCard({ title, value, detail, icon, linkLabel, tone = 'blue', filter }: { title: string; value: number | string | VNode; detail: string; icon: string; linkLabel: string; tone?: KpiTone; filter?: Record<string, string[]> }): VNode {
  const onClick = filter ? () => applyRegisterFilter(filter) : focusEmployeeRegister;
  return <div class="hrew-kpi-shell" data-widget-content-root><KpiTile icon={icon} tone={tone} label={title} value={value} sub={detail} link={{ label: linkLabel, onClick }} /></div>;
}


function ActiveWorkforce({ stats }: { stats: HrDashboardStats }): VNode {
  const s = stats.active_workforce;
  // Title Case per the register conventions, and the nouns agree with their counts —
  // a single contractor read "1 contractors".
  return <KpiCard title="Active Workforce" value={s.total} detail={`${s.employees} ${s.employees === 1 ? 'Employee' : 'Employees'} · ${s.contractors} ${s.contractors === 1 ? 'Contractor' : 'Contractors'}`} icon="fa-users" linkLabel="View Active Employees" filter={{ status: ['active'] }} />;
}
function RecordReadiness({ stats }: { stats: HrDashboardStats }): VNode {
  const s = stats.readiness;
  return <KpiCard title="Record Readiness" value={<>{s.percent}<small style="font-size:.6em;font-weight:600;margin-left:1px">%</small></>} detail={`${s.blocked} ${s.blocked === 1 ? 'Person' : 'People'} Currently Blocked`} icon="fa-shield-halved" linkLabel="View Training Gaps" filter={{ training: ['expired', 'due_soon'] }} tone="green" />;
}
function HrWorkQueue({ stats }: { stats: HrDashboardStats }): VNode {
  const s = stats.hr_work_queue;
  return <KpiCard title="HR Work Queue" value={s.total} detail={`${s.urgent} Urgent · Oldest ${s.oldest_days}d`} icon="fa-list-check" linkLabel="View Register" tone="amber" />;
}
/** Payroll readiness as a double-wide KPI — the highest-consequence number on this board.
 *
 * The headline is the count NOT payroll-ready, because that is the actionable figure: those people
 * are paid wrong, or not at all, at month end. "N ready" reads as reassurance and buries the work.
 *
 * The bar is deliberately TWO segments (ready / not ready) and not one segment per readiness
 * domain. `assignment_complete`, `payroll_ready` and `training_current` are independent counts that
 * OVERLAP — one employee can fail several — so stacking them to 100% would assert a partition the
 * data does not support. Ready vs not-ready is an exact partition of the active workforce, so every
 * width on this bar is literally true. The domain gaps go in the sub-line, where they are words
 * rather than implied shares.
 */
function PayrollReadinessKpi({ stats }: { stats: HrDashboardStats }): VNode {
  const total = stats.active_workforce.total;
  const ready = Math.min(stats.readiness.payroll_ready, total);
  const notReady = Math.max(0, total - ready);
  const detail = total === 0
    ? 'No active workforce'
    : notReady === 0
      ? `All ${total} Active Employees Ready`
      : `${ready} of ${total} Ready · ${stats.readiness.percent}% Record Readiness`;
  return <KpiWideCard title="Not Payroll-Ready" value={notReady} detail={detail}
    icon="fa-money-check-dollar" tone={notReady === 0 ? 'green' : 'red'}
    breakdown={[
      { label: 'Not payroll-ready', count: notReady, colour: '#dc2626' },
      { label: 'Payroll-ready', count: ready, colour: '#16a34a' },
    ]} />;
}

function Exceptions({ stats }: { stats: HrDashboardStats }): VNode {
  const s = stats.exceptions;
  return <KpiCard title="Exceptions" value={s.total} detail={s.items.slice(0, 2).map(x => `${x.type} ${x.count}`).join(' · ') || 'No Current Exceptions'} icon="fa-circle-exclamation" linkLabel="View Missing Assignments" filter={{ missing: ['supervisor', 'department', 'site'] }} tone="red" />;
}

function focusLifecycleMovement(): void {
  document.querySelector<HTMLElement>('.hrew-lifecycle[data-widget-content-root]')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function LifecyclePulse({ stats, metric, title, accent }: { stats: HrDashboardStats; metric: 'hires' | 'exits'; title: string; accent: 'blue' | 'coral' }): VNode {
  const periods = stats.lifecycle.periods.slice(-4);
  const latest = periods.at(-1)?.[metric] ?? 0;
  const previous = periods.at(-2)?.[metric] ?? 0;
  const delta = latest - previous;
  const peak = Math.max(1, ...periods.map(period => period[metric]));
  const previousPeriod = periods.at(-2)?.period ?? 'prior month';
  return <article class={`hrew-pulse hrew-pulse--${accent}`} data-widget-content-root>
    <div class="hrew-pulse-copy"><header><h3>{title}</h3><button type="button" aria-label={`View ${title.toLowerCase()} lifecycle details`} onClick={focusLifecycleMovement}><LucideIcon name="ChevronRight" size={17} /></button></header><strong>{latest}</strong><p>{delta === 0 ? 'No change' : <b>{delta > 0 ? '+' : ''}{delta}</b>} <span>vs {previousPeriod}</span></p></div>
    <div class="hrew-pulse-chart" aria-label={`${title} over the last four months`}>{periods.map((period, index) => <span key={period.period} class={index === periods.length - 1 ? 'current' : ''}><i style={`height:${Math.max(18, period[metric] / peak * 100)}%`} title={`${period.period}: ${period[metric]}`} /><small>{period.period}</small></span>)}</div>
  </article>;
}
function Departures({ stats }: { stats: HrDashboardStats }): VNode { return <LifecyclePulse stats={stats} metric="exits" title="Departures" accent="coral" />; }

function RecordQuality({ stats }: { stats: HrDashboardStats }): VNode {
  const total = Math.max(1, stats.active_workforce.total);
  const readiness = stats.readiness;
  const measures = [
    { label: 'Assignment', count: readiness.assignment_complete, percent: Math.round(readiness.assignment_complete / total * 100), tone: 'purple' },
    { label: 'Payroll', count: readiness.payroll_ready, percent: Math.round(readiness.payroll_ready / total * 100), tone: 'blue' },
    { label: 'Training', count: readiness.training_current, percent: Math.round(readiness.training_current / total * 100), tone: 'cyan' },
  ];
  const status = readiness.percent >= 85 ? 'Good records' : readiness.percent >= 70 ? 'Needs review' : 'At risk';
  return <article class="hrew-quality" data-widget-content-root>
    <header><div><h3>Record quality</h3><p>Active workforce</p></div><span class="hrew-quality-icon"><LucideIcon name="ShieldCheck" size={25} /></span></header>
    <div class="hrew-quality-score"><strong>{readiness.percent}</strong><span>/100</span><b>{status}</b></div>
    <div class="hrew-quality-band" aria-label="Record quality dimensions">{measures.map(measure => <i key={measure.label} class={`is-${measure.tone}`} title={`${measure.label}: ${measure.percent}%`} />)}</div>
    <div class="hrew-quality-measures">{measures.map(measure => <div key={measure.label}>
      <span><i class={`is-${measure.tone}`} />{measure.label}</span><strong>{measure.count}</strong><small>{measure.percent}%</small>
    </div>)}</div>
    <footer><span>Ready records</span><strong>{readiness.assignment_complete} of {stats.active_workforce.total}</strong></footer>
  </article>;
}

function initials(person: Pick<HrEmployeeRow, 'display_name' | 'full_name'>): string { return (person.display_name ?? person.full_name ?? 'Employee').split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase(); }

type AttentionEmployee = Pick<HrEmployeeRow, 'id' | 'full_name' | 'display_name' | 'employee_number' | 'position' | 'departmentName' | 'profile_image_url' | 'readiness'>;
function previewReadiness(
  readyControls: number,
  blockedDomains: NonNullable<HrEmployeeRow['readiness']>['blockedDomains'],
): NonNullable<HrEmployeeRow['readiness']> {
  const totalControls = 3;
  return {
    percent: Math.round((readyControls / totalControls) * 100),
    readyControls,
    totalControls,
    unresolvedWorkItems: blockedDomains.length,
    payrollStatus: blockedDomains.includes('payroll') ? 'blocked' : 'ready',
    trainingStatus: blockedDomains.includes('training') ? 'expired' : 'current',
    blockedDomains,
    lastReviewedAt: null,
    reviewOwnerLabel: blockedDomains.length ? 'Owner Required' : null,
    nextReviewAt: null,
  };
}
const PREVIEW_ATTENTION: AttentionEmployee[] = [
  { id: 'a1', full_name: 'Amara Diallo', display_name: null, employee_number: 'EMP-0010', position: 'Field Engineer', departmentName: 'Operations', profile_image_url: null, readiness: previewReadiness(1, ['payroll', 'training']) },
  { id: 'a2', full_name: 'Claudia Pierre', display_name: null, employee_number: 'EMP-0008', position: 'People Specialist', departmentName: 'Human Resources', profile_image_url: null, readiness: previewReadiness(2, ['assignment']) },
  { id: 'a3', full_name: 'Damani Baptiste', display_name: null, employee_number: 'EMP-0007', position: 'Site Coordinator', departmentName: 'Operations', profile_image_url: null, readiness: previewReadiness(2, ['training']) },
];
const ATTENTION_LABELS = {
  assignment: 'Assignment', payroll: 'Payroll', training: 'Training',
  documents: 'Documents', statutory: 'Statutory', access: 'Access',
} as const;
const COUNT_WORDS = ['Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten'];
const countWithWord = (count: number): string => `${COUNT_WORDS[count] ?? count} (${count})`;
type AttentionBlocker = keyof typeof ATTENTION_LABELS;
/** Title doubles as the instruction — a separate explanatory paragraph repeated the same
 *  sentence on every card and pushed the action button out of a compact tile. */
function attentionReviewCopy(blockers: AttentionBlocker[]): { title: string; button: string } {
  const unique = Array.from(new Set(blockers));
  if (unique.length >= 3) return {
    title: 'Complete the Employee Readiness Record',
    button: 'Review Employee Record',
  };
  if (unique.length === 2) {
    const first = unique[0]!;
    const second = unique[1]!;
    const labels = [first, second].map(blocker => ATTENTION_LABELS[blocker].toLowerCase());
    return {
      title: `Resolve ${labels[0]} and ${labels[1]} readiness`,
      button: 'Review Employee Record',
    };
  }
  const blocker = unique[0] ?? 'assignment';
  if (blocker === 'assignment') return {
    title: 'Complete the Employee Assignment',
    button: 'Review Assignment',
  };
  if (blocker === 'payroll') return {
    title: 'Complete Payroll Readiness',
    button: 'Review Payroll Setup',
  };
  if (blocker === 'training') return {
    title: 'Update Training Compliance',
    button: 'Review Training',
  };
  return {
    title: `Resolve ${ATTENTION_LABELS[blocker]} Readiness`,
    button: `Review ${ATTENTION_LABELS[blocker]}`,
  };
}

type AttentionReferenceVariant = 'neutral' | 'semantic';
const PREVIEW_ATTENTION_REFERENCE: AttentionEmployee[] = [
  PREVIEW_ATTENTION[0]!,
  { id: 'a4', full_name: 'Camille Rampersad', display_name: null, employee_number: 'EMP-FIN01', position: 'Finance Manager', departmentName: null, profile_image_url: null, readiness: previewReadiness(0, ['assignment', 'payroll', 'training']) },
];
function EmployeeAttentionReferenceView({ employees, total, variant, initialIndex = 0 }: { employees: AttentionEmployee[]; total: number; variant: AttentionReferenceVariant; initialIndex?: number }): VNode {
  const [activeIndex, setActiveIndex] = useState(Math.min(initialIndex, Math.max(0, employees.length - 1)));
  const employee = employees.length ? employees[activeIndex % employees.length]! : null;
  const move = (direction: -1 | 1): void => setActiveIndex(current => (current + direction + employees.length) % employees.length);
  const readiness = employee?.readiness ?? null;
  if (!employee || !readiness) return <article class={`hrew-attention-reference is-${variant}`} aria-label="Employee attention card" data-widget-content-root><div class="hrew-attention-empty"><LucideIcon name="ShieldCheck" size={24} /><strong>No Employee Issues</strong><span>All visible employee records meet their readiness controls.</span></div></article>;
  const name = employee.display_name ?? employee.full_name ?? 'Employee';
  const primaryBlocker = readiness.blockedDomains[0] ?? 'assignment';
  const primaryLabel = ATTENTION_LABELS[primaryBlocker];
  const reviewCopy = attentionReviewCopy(readiness.blockedDomains);
  // Spelled-out count (the same COUNT_WORDS the facts strip uses), and the verb agrees with
  // it — the singular branch read "1 Readiness Control Need Review".
  const blockedCount = readiness.blockedDomains.length;
  const issueTitle = blockedCount === 1
    ? `${COUNT_WORDS[1]} Readiness Control Needs Review`
    : `${COUNT_WORDS[blockedCount] ?? blockedCount} Readiness Controls Need Review`;
  const roleLine = [employee.position, employee.departmentName].filter(Boolean).join(' · ') || 'Employee';
  return <article class={`hrew-attention-reference is-${variant}`} aria-label={`${variant === 'neutral' ? 'Neutral' : 'Semantic'} employee attention card`} data-widget-content-root>
    <section class="hrew-ar-person"><span class="hrew-avatar">{employee.profile_image_url ? <img src={employee.profile_image_url} alt="" /> : initials(employee)}</span><div><strong>{name}</strong><small><LucideIcon name="BriefcaseBusiness" size={13} /><span>{roleLine}</span></small></div><nav><div class="hrew-ar-nav-row"><button type="button" aria-label="Previous employee issue" disabled={employees.length < 2} onClick={() => move(-1)}><LucideIcon name="ChevronLeft" size={18} /></button><button type="button" aria-label="Next employee issue" disabled={employees.length < 2} onClick={() => move(1)}><LucideIcon name="ChevronRight" size={18} /></button></div><span class="hrew-ar-count">{activeIndex + 1} of {total}</span></nav>
    </section>
    <section class="hrew-ar-issue"><h3>{issueTitle}</h3></section>
    <section class="hrew-ar-facts"><div class="is-department"><LucideIcon name="UserRound" size={21} /><strong>{employee.departmentName ?? 'Unassigned'}</strong><span>Department</span></div><div class="is-control"><LucideIcon name="BriefcaseBusiness" size={21} /><strong>{primaryLabel}</strong><span>Control</span></div><div class="is-issues"><LucideIcon name="CircleAlert" size={21} /><strong>{countWithWord(readiness.blockedDomains.length)}</strong><span>Issues</span></div></section>
    <section class="hrew-ar-impact"><div class="hrew-ar-ready-gauge" style={`--hrew-ready-angle:${readiness.percent * 1.12 - 56}deg`} aria-label={`Record ready ${readiness.percent}%`}><svg viewBox="0 0 360 158" preserveAspectRatio="xMidYMid meet" aria-hidden="true"><defs><linearGradient id={`hrew-ready-arc-${employee.id}`} x1="0" x2="1"><stop offset="0" stop-color="#dc2626" /><stop offset=".18" stop-color="#ef4444" /><stop offset=".38" stop-color="#f97316" /><stop offset=".55" stop-color="#f59e0b" /><stop offset=".74" stop-color="#84cc16" /><stop offset="1" stop-color="#16a34a" /></linearGradient></defs><path class="hrew-ready-track" d="M34 132 A146 146 0 0 1 326 132" fill="none" stroke="#edf0f4" stroke-width="24" stroke-linecap="round" /><path class="hrew-ready-arc" pathLength="100" d="M34 132 A146 146 0 0 1 326 132" fill="none" stroke={`url(#hrew-ready-arc-${employee.id})`} stroke-width="24" stroke-linecap="round" stroke-opacity={readiness.percent > 0 ? 1 : 0} style={`stroke-dasharray:${readiness.percent} 100`} /></svg><div><strong>{readiness.percent}<small>%</small></strong><span>{readiness.percent === 100 ? 'Ready' : 'Not Ready'}</span></div></div><div><strong>Readiness Impact</strong><p>Complete {readiness.blockedDomains.map(blocker => ATTENTION_LABELS[blocker].toLowerCase()).join(', ')} to make this record ready.</p></div><i><em style={`width:${readiness.percent}%`} /></i></section>
    {/* Separated footer — a hairline rule instead of a nested rounded container. */}
    <section class="hrew-ar-action"><span>Recommended Review</span><h4>{reviewCopy.title}</h4><button type="button" onClick={() => openEmployeeDrawer(employee.id)}>{reviewCopy.button}</button></section>
  </article>;
}
/**
 * The roster slice the attention widgets read.
 *
 * EXPORTED so the host page can warm the very same query key before it clears
 * its own page skeleton. It is a different key from the register's filtered
 * list, so without this the page skeleton finished while these widgets were
 * still cold and each one flashed its own card skeleton afterwards. Two copies
 * of these params would silently drift apart and bring the flash back.
 */
export const EMPLOYEE_ATTENTION_ROSTER_QUERY = {
  statuses: ['active'], page: 1, pageSize: 200, sortBy: 'full_name', sortDir: 'asc',
} as const;

function EmployeeAttentionReferenceWidget({ variant }: { variant: AttentionReferenceVariant }): VNode {
  const query = useHrEmployeesPage({ ...EMPLOYEE_ATTENTION_ROSTER_QUERY, statuses: ['active'] });
  if (query.isLoading) return <WidgetState kind="loading" />;
  if (!query.data) return <WidgetState kind="error" message={query.error instanceof Error ? query.error.message : 'Employee attention data is unavailable.'} />;
  const affected = query.data.rows.filter(employee => employee.readiness?.blockedDomains.length).sort((a, b) => (a.readiness?.percent ?? 100) - (b.readiness?.percent ?? 100));
  return <EmployeeAttentionReferenceView employees={affected} total={query.data.meta.total} variant={variant} />;
}
function EmployeeAttentionNeutralWidget(): VNode { return <EmployeeAttentionReferenceWidget variant="neutral" />; }



function useAnimatedInteger(value: number, durationMs = 680): number {
  const [displayValue, setDisplayValue] = useState(value);
  useEffect(() => {
    const reduceMotion = typeof globalThis.matchMedia === 'function'
      && globalThis.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduceMotion || typeof globalThis.requestAnimationFrame !== 'function') {
      setDisplayValue(value);
      return;
    }
    let frame = 0;
    const startedAt = performance.now();
    setDisplayValue(0);
    const animate = (now: number): void => {
      const progress = Math.min(1, (now - startedAt) / durationMs);
      setDisplayValue(Math.round(value * (1 - Math.pow(1 - progress, 3))));
      if (progress < 1) frame = globalThis.requestAnimationFrame(animate);
    };
    frame = globalThis.requestAnimationFrame(animate);
    return () => globalThis.cancelAnimationFrame(frame);
  }, [durationMs, value]);
  return displayValue;
}

function movementTrend(values: number[]): { direction: 'up' | 'down' | 'flat'; percent: number } {
  const current = values.at(-1) ?? 0;
  const previous = values.at(-2) ?? 0;
  if (current === previous) return { direction: 'flat', percent: 0 };
  return { direction: current > previous ? 'up' : 'down', percent: previous === 0 ? 100 : Math.round(Math.abs((current - previous) / previous) * 100) };
}

function pulseLinePath(values: number[]): string {
  if (values.length === 0) return '';
  const peak = Math.max(1, ...values);
  const points = values.map((value, index) => ({ x: 8 + index * (124 / Math.max(1, values.length - 1)), y: 90 - (value / peak) * 82 }));
  return points.reduce((path, point, index) => {
    if (index === 0) return `M${point.x} ${point.y}`;
    const previous = points[index - 1]!;
    const midpoint = (previous.x + point.x) / 2;
    return `${path} C${midpoint} ${previous.y} ${midpoint} ${point.y} ${point.x} ${point.y}`;
  }, '');
}

type WorkplacePulseChart = 'bars' | 'ranges' | 'line';
function WorkplacePulseCard({ title, icon, values, labels, chart, showTrend = false, tone = 'violet' }: { title: string; icon: LucideName; values: number[]; labels: string[]; chart: WorkplacePulseChart; showTrend?: boolean; tone?: 'violet' | 'blue' }): VNode {
  const current = values.at(-1) ?? 0;
  const animatedValue = useAnimatedInteger(current);
  const trend = movementTrend(values);
  const peak = Math.max(1, ...values);
  const linePoints = values.map((value, index) => ({ x: 8 + index * (124 / Math.max(1, values.length - 1)), y: 90 - (value / peak) * 82 }));
  return <article class={`hrew-workplace-pulse is-${chart} is-${tone}`} data-widget-content-root data-pulse-chart={chart}>
    <div class="hrew-wp-inner">
    <h3>{title}</h3>
    <span class="hrew-workplace-pulse-icon" aria-hidden="true"><LucideIcon name={icon} size={18} /></span>
    <div class="hrew-workplace-pulse-value" aria-label={`${title}: ${current}`}><strong>{animatedValue}</strong>{showTrend ? <small class={`is-${trend.direction}`}><LucideIcon name={trend.direction === 'down' ? 'ArrowDown' : trend.direction === 'flat' ? 'Minus' : 'ArrowUp'} size={10} />{trend.percent}%</small> : null}</div>
    {chart === 'bars' ? <svg class="hrew-workplace-pulse-chart" viewBox="0 0 180 124" role="img" aria-label={`${title} monthly bar chart`}><line class="hrew-pulse-baseline" x1="2" x2="172" y1="98" y2="98" /><g class="hrew-pulse-bars">{values.map((value, index) => { const height = value > 0 ? Math.max(6, value / peak * 96) : 2; return <rect key={`${labels[index]}-${index}`} class={`${index === values.length - 1 ? 'is-active' : ''}${value === 0 ? ' is-zero' : ''}`} x={2 + index * 36} y={98 - height} width={index === values.length - 1 ? 26 : 24} height={height} rx={value === 0 ? '1' : '5'} style={`animation-delay:${index * 75}ms`}><title>{labels[index]}: {value} hire{value === 1 ? '' : 's'}</title></rect>; })}</g><g class="hrew-pulse-labels">{labels.map((label, index) => <text key={`${label}-${index}`} x={14 + index * 36} y="116" text-anchor="middle">{label}</text>)}</g></svg> : null}
    {chart === 'ranges' ? <svg class="hrew-workplace-pulse-chart" viewBox="0 0 137 124" role="img" aria-label={`${title} monthly range chart`}><g class="hrew-pulse-range-tracks">{values.map((_value, index) => <rect key={`track-${index}`} x={4 + index * 25} y="1" width="8" height="96" rx="4" />)}</g><g class="hrew-pulse-range-values">{values.map((value, index) => { const height = Math.max(24, value / peak * 72); const y = 49 - height / 2; return <rect key={`${labels[index]}-${index}`} x={4 + index * 25} y={y} width="8" height={height} rx="4" style={`animation-delay:${index * 70}ms`} />; })}</g><g class="hrew-pulse-labels">{labels.map((label, index) => <text key={`${label}-${index}`} x={8 + index * 25} y="116" text-anchor="middle">{label}</text>)}</g></svg> : null}
    {chart === 'line' ? <svg class="hrew-workplace-pulse-chart" viewBox="0 0 148 124" role="img" aria-label={`${title} monthly line chart`}><path class="hrew-pulse-line" d={pulseLinePath(values)} pathLength="1" /><g class="hrew-pulse-points">{linePoints.map((point, index) => <circle key={`${labels[index]}-${index}`} cx={point.x} cy={point.y} r="5.5" style={`animation-delay:${300 + index * 70}ms`} />)}</g><g class="hrew-pulse-labels">{labels.map((label, index) => <text key={`${label}-${index}`} x={8 + index * 24.8} y="116" text-anchor="middle">{label}</text>)}</g></svg> : null}
    </div>
  </article>;
}

/** A plain KPI tile, not a pulse card: it belongs on the Employee Master KPI strip, which is a
 *  uniform w4×h6 reorder-only row. The 5-month bars chart it used to draw cannot survive at that
 *  size, and the month-over-month movement it carried is still on the board through Workforce
 *  Activity. The sub-line keeps the comparison in words instead. */
function MonthlyHiresCard({ stats }: { stats: HrDashboardStats }): VNode {
  const periods = stats.lifecycle.periods;
  const latest = periods.at(-1)?.hires ?? 0;
  const previous = periods.at(-2)?.hires ?? 0;
  const delta = latest - previous;
  const previousPeriod = periods.at(-2)?.period;
  // Never fabricate a comparison: with only one bucket there is no prior period to compare to.
  const detail = previousPeriod === undefined
    ? 'No Prior Period To Compare'
    : delta === 0
      ? `No Change vs ${previousPeriod}`
      : `${delta > 0 ? '+' : ''}${delta} vs ${previousPeriod}`;
  return <KpiCard title="Hires This Month" value={latest} detail={detail} icon="fa-user-plus"
    linkLabel="View Active Employees" filter={{ status: ['active'] }} tone="teal" />;
}
function InternalMovesCard({ stats }: { stats: HrDashboardStats }): VNode {
  const periods = stats.lifecycle.periods.slice(-6);
  return <WorkplacePulseCard title="Internal moves" icon="Package" values={periods.map(period => period.transfers)} labels={periods.map(period => period.period)} chart="ranges" showTrend />;
}
function PromotionsCard({ stats }: { stats: HrDashboardStats }): VNode {
  const periods = stats.lifecycle.periods.slice(-6);
  return <WorkplacePulseCard title="Promotions" icon="ChevronsRight" values={periods.map(period => period.promotions)} labels={periods.map(period => period.period)} chart="line" />;
}

function ReadinessRadar({ stats }: { stats: HrDashboardStats }): VNode {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const total = Math.max(1, stats.active_workforce.total);
  const targetValues = [92, 88, 78, 84, 94, 72];
  const rawValues = [
    Math.round(stats.readiness.assignment_complete / total * 100),
    Math.round(stats.readiness.payroll_ready / total * 100),
    Math.round(stats.readiness.training_current / total * 100),
    stats.readiness.percent,
    Math.round(stats.active_workforce.employees / total * 100),
    Math.max(0, 100 - Math.round(stats.hr_work_queue.urgent / Math.max(1, stats.hr_work_queue.total) * 100)),
  ];
  const values = rawValues.map((value, index) => Math.max([58, 82, 64, 72, 88, 50][index] ?? 50, Math.min(96, value)));
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const chart = new Chart(canvas, {
      type: 'radar',
      data: { labels: ['Assignment', 'Payroll', 'Training', 'Records', 'Workforce', 'Queue'], datasets: [{ label: 'Readiness Target', data: targetValues, fill: true, borderColor: 'rgba(70,185,26,0)', backgroundColor: 'rgba(91,202,46,.105)', pointBackgroundColor: 'rgba(255,255,255,0)', pointBorderColor: 'rgba(100,189,66,0)', pointBorderWidth: 0, pointRadius: 0, pointHoverRadius: 0, borderWidth: 0, order: 1 }, { label: 'Current Coverage', data: values, fill: true, borderColor: 'rgba(70,185,26,.72)', backgroundColor: 'rgba(91,202,46,.025)', pointBackgroundColor: '#46bf18', pointBorderColor: '#fff', pointBorderWidth: 2, pointRadius: 4, pointHoverRadius: 5, borderWidth: 1.25, order: 0 }] },
      options: { responsive: true, maintainAspectRatio: false, animation: { duration: 720 }, elements: { line: { tension: .12 } }, plugins: { legend: { display: false }, tooltip: { callbacks: { label: context => { const raw = typeof context.raw === 'number' ? context.raw : 0; return `${raw}%`; } } } }, scales: { r: { min: 0, max: 100, beginAtZero: true, backgroundColor: 'rgba(91,202,46,.025)', ticks: { display: false, stepSize: 20 }, grid: { color: 'rgba(196,205,201,.62)' }, angleLines: { color: 'rgba(196,205,201,.62)' }, pointLabels: { color: '#414544', font: { size: 10, weight: 500 } } } } },
    });
    return () => chart.destroy();
  }, [values]);
  return <article class="hrew-radar" data-widget-content-root><div class="hrew-radar-canvas"><canvas ref={canvasRef} role="img" aria-label="Employee readiness radar" /></div><header><div><h3>Employee Readiness</h3><p>Assignment · Payroll · Training</p></div></header><div class="hrew-radar-score"><strong>{stats.readiness.percent}%</strong><span>Regular Review</span></div></article>;
}

function LifecycleOutcomeChart({ stats }: { stats: HrDashboardStats }): VNode {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const periods = stats.lifecycle.periods;
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const chart = new Chart(canvas, {
      type: 'bar',
      data: { labels: periods.map(period => period.period), datasets: [
        { label: 'New starters', data: periods.map(period => period.hires), backgroundColor: '#5679df', borderRadius: 5, borderSkipped: false },
        { label: 'Internal moves', data: periods.map(period => period.transfers + period.promotions), backgroundColor: '#d8e0fb', borderRadius: 5, borderSkipped: false },
      ] },
      options: { responsive: true, maintainAspectRatio: false, animation: { duration: 760 }, interaction: { mode: 'index', intersect: false }, plugins: { legend: { position: 'bottom', labels: { usePointStyle: true, pointStyle: 'circle', boxWidth: 6, boxHeight: 6, color: '#747d8b', font: { size: 9 } } }, tooltip: { displayColors: true } }, scales: { x: { stacked: true, grid: { display: false }, border: { display: false }, ticks: { color: '#858c97', font: { size: 9 } } }, y: { stacked: true, beginAtZero: true, grace: '12%', grid: { color: '#edf0f4' }, border: { display: false }, ticks: { color: '#858c97', precision: 0, font: { size: 9 } } } } },
    });
    return () => chart.destroy();
  }, [periods]);
  const total = stats.lifecycle.totals.hires + stats.lifecycle.totals.transfers + stats.lifecycle.totals.promotions;
  return <article class="hrew-outcomes" data-widget-content-root><header><div><h3>Lifecycle outcomes</h3><strong>{total}</strong><p>This period’s completed employee movements <b>+{stats.lifecycle.totals.promotions} promotions</b></p></div><LucideIcon name="ChevronRight" size={18} /></header><div><canvas ref={canvasRef} role="img" aria-label="Lifecycle outcomes stacked bar chart" /></div></article>;
}

function liveDefinition(input: { id: string; title: string; description: string; icon: string; category: string; defaultSize: WidgetDef['defaultSize']; sizes: WidgetSizeDef[]; render: (props: { stats: HrDashboardStats; config?: Record<string, unknown> }) => VNode; previewVariant: WidgetDef['previewVariant']; motion: NonNullable<WidgetDef['motion']>; fixed?: boolean; minWidth?: number; minHeight?: number; previewAspect?: number; resizeStrategy?: NonNullable<WidgetDef['sizeConstraints']>['resizeStrategy']; defaultConfig?: Record<string, unknown>; configSchema?: WidgetDef['configSchema'] }): WidgetDef {
  const defaultGrid = input.sizes.find(size => size.key === input.defaultSize)?.grid ?? input.sizes[0]?.grid ?? { w: 6, h: 3 };
  // KPI tiles are UNIFORM and FIXED, like the Statutory dashboard's KPI strip: the strip is a
  // reorder-only row (drag left/right), so a tile's size is code-owned rather than user data.
  // KPI_SIZES declares a single w4×h6 preset whose min == the preset, and clampWidgetInstanceToMinimum
  // heals a fixed widget in BOTH directions — so a layout saved when the tile was resizable snaps
  // back to the code default instead of being pinned forever at a stale size.
  const fixed = input.fixed === true || isKpiFamily(input.sizes);
  return defineWidget({
    id: input.id, module: 'hr', area: 'Employee Master', title: input.title, description: input.description,
    longDescription: `${input.description} Uses the authenticated Employee Master dashboard API and server-scoped workforce records.`,
    icon: input.icon, category: input.category, tags: ['hr', 'employee master', 'live api'], previewVariant: input.previewVariant,
    chrome: 'none', sizeToContent: false, resizable: !fixed, supportedPages: [PAGE], supportedZones: ['main'], defaultSize: input.defaultSize,
    allowedSizes: input.sizes, sizeConstraints: { defaultColumns: defaultGrid.w, defaultRows: defaultGrid.h, minColumns: input.sizes[0]?.min?.w ?? 5, minRows: input.sizes[0]?.min?.h ?? 2, minWidth: input.minWidth ?? (input.sizes === KPI_WIDE_SIZES ? 340 : input.sizes === KPI_SIZES ? 180 : input.sizes === PULSE_SIZES ? 160 : input.sizes === QUALITY_SIZES ? 280 : 300), minHeight: input.minHeight ?? (isKpiFamily(input.sizes) ? 84 : input.sizes === PULSE_SIZES ? 84 : input.sizes === QUALITY_SIZES ? 360 : 320), resizeStrategy: input.resizeStrategy ?? (fixed ? 'fixed-minimum' : 'content-measured') },
    ...(isKpiFamily(input.sizes) || input.sizes === PULSE_SIZES ? {} : { previewAspect: input.previewAspect ?? (input.sizes === CHART_SIZES ? 1.55 : input.sizes === QUALITY_SIZES ? .78 : 1.1) }),
    defaultConfig: input.defaultConfig ?? {}, configSchema: input.configSchema ?? [], dataSource: SOURCE, dataSourceKey: SOURCE.sourceKey,
    governance: { state: 'enabled', discoverable: true, allowedPages: [PAGE], requiredCapabilities: ['hr.employees.view'] },
    permissions: { requiredPermissions: ['hr.employees.view'] }, runtimeState: 'live-api', recommendedFor: [PAGE], motion: input.motion,
    render: withLiveData(input.render), renderPreview: props => input.render({ stats: PREVIEW, config: props.config }),
  });
}

function externalDefinition(input: { id: string; title: string; description: string; icon: string; category: string; defaultSize: WidgetDef['defaultSize']; sizes: WidgetSizeDef[]; source: typeof DIRECTORY_SOURCE | typeof CALENDAR_SOURCE; permission: string; render: WidgetDef['render']; renderPreview: NonNullable<WidgetDef['renderPreview']>; previewVariant: WidgetDef['previewVariant']; minWidth: number; minHeight: number; previewAspect?: number; fixed?: boolean; recommended?: boolean }): WidgetDef {
  const size = input.sizes.find(candidate => candidate.key === input.defaultSize) ?? input.sizes[0]!;
  const fixed = input.fixed === true || isKpiFamily(input.sizes);   // see liveDefinition
  return defineWidget({
    id: input.id, module: 'hr', area: 'Employee Master', title: input.title, description: input.description,
    longDescription: `${input.description} Uses an authenticated SIOMAC API with server-scoped records.`, icon: input.icon,
    category: input.category, tags: ['hr', 'employee master', 'live api'], previewVariant: input.previewVariant,
    chrome: 'none', sizeToContent: false, resizable: !fixed, supportedPages: [PAGE], supportedZones: ['main'], defaultSize: input.defaultSize,
    allowedSizes: input.sizes, sizeConstraints: { defaultColumns: size.grid.w, defaultRows: size.grid.h, minColumns: input.sizes[0]?.min?.w ?? size.grid.w, minRows: input.sizes[0]?.min?.h ?? size.grid.h, minWidth: input.minWidth, minHeight: input.minHeight, resizeStrategy: fixed ? 'fixed-minimum' : 'content-measured' },
    ...(input.previewAspect ? { previewAspect: input.previewAspect } : {}), defaultConfig: {}, configSchema: [], dataSource: input.source, dataSourceKey: input.source.sourceKey,
    governance: { state: 'enabled', discoverable: true, allowedPages: [PAGE], requiredCapabilities: [input.permission] },
    permissions: { requiredPermissions: [input.permission] }, runtimeState: 'live-api', ...(input.recommended === false ? {} : { recommendedFor: [PAGE] }),
    motion: { kind: 'sequence', durationMs: 620, reducedMotion: 'static' }, render: input.render, renderPreview: input.renderPreview,
  });
}

export const widgets: WidgetDef[] = [
  liveDefinition({ id: 'hr.employeeMaster.activeWorkforce', title: 'Active Workforce', description: 'Current active employee and contractor headcount.', icon: 'fa-users', category: 'Key metrics', defaultSize: 'compact', sizes: KPI_SIZES, render: ActiveWorkforce, previewVariant: 'metric', motion: { kind: 'count-up', durationMs: 520, reducedMotion: 'static' } }),
  liveDefinition({ id: 'hr.employeeMaster.recordReadiness', title: 'Record Readiness', description: 'Assignment, payroll, and training readiness across active workers.', icon: 'fa-shield-halved', category: 'Key metrics', defaultSize: 'compact', sizes: KPI_SIZES, render: RecordReadiness, previewVariant: 'metric', motion: { kind: 'progress', durationMs: 620, reducedMotion: 'static' } }),
  liveDefinition({ id: 'hr.employeeMaster.hrWorkQueue', title: 'HR Work Queue', description: 'Open and urgent Employee Master change requests.', icon: 'fa-list-check', category: 'Key metrics', defaultSize: 'compact', sizes: KPI_SIZES, render: HrWorkQueue, previewVariant: 'metric', motion: { kind: 'count-up', durationMs: 520, reducedMotion: 'static' } }),
  liveDefinition({ id: 'hr.employeeMaster.exceptions', title: 'Exceptions', description: 'Current assignment, payroll, and training gaps.', icon: 'fa-circle-exclamation', category: 'Key metrics', defaultSize: 'compact', sizes: KPI_SIZES, render: Exceptions, previewVariant: 'metric', motion: { kind: 'count-up', durationMs: 520, reducedMotion: 'static' } }),
  liveDefinition({ id: 'hr.employeeMaster.departures', title: 'Departures', description: 'Recent employee departures with month-over-month movement.', icon: 'fa-user-minus', category: 'Activity & trends', defaultSize: 'compact', sizes: KPI_SIZES, render: Departures, previewVariant: 'trend', motion: { kind: 'sequence', durationMs: 620, reducedMotion: 'static' } }),
  liveDefinition({ id: 'hr.employeeMaster.recordQuality', title: 'Record Quality', description: 'Workforce record quality across assignment, payroll, and training readiness.', icon: 'fa-shield-halved', category: 'Health & readiness', defaultSize: 'standard', sizes: QUALITY_SIZES, render: RecordQuality, previewVariant: 'metric', motion: { kind: 'progress', durationMs: 680, reducedMotion: 'static' } }),
  externalDefinition({ id: 'hr.employeeMaster.employeeAttentionNeutral', title: 'Employee Attention — Neutral', description: 'Employee readiness issue card in the supplied neutral structured design.', icon: 'fa-user-clock', category: 'Actions & workload', defaultSize: 'standard', sizes: ATTENTION_PORTRAIT_SIZES, source: DIRECTORY_SOURCE, permission: 'hr.employees.view', render: EmployeeAttentionNeutralWidget, renderPreview: () => <EmployeeAttentionReferenceView employees={PREVIEW_ATTENTION_REFERENCE} total={25} variant="neutral" initialIndex={1} />, previewVariant: 'task-board', minWidth: 389, minHeight: 528, previewAspect: .62, recommended: false }),
  // Payroll readiness — a DOUBLE-WIDE KPI strip tile (w8 = two slots).
  //
  // This replaces the Master Data Workload card that used to hold this id. That card showed
  // hardcoded 18/9/72%/3-days, and once wired to real data its numbers were the SAME
  // `hr_work_queue` stats the HR Work Queue KPI already shows — the same metric twice, and a mix so
  // thin (5 items over 5 types) that the second slot bought nothing. Payroll readiness is the
  // highest-consequence number on this board and has an exact two-part partition to chart, so the
  // width is doing work. New id, because a widget id should mean one thing: an instance saved as
  // "workload" must not silently become a readiness tile.
  liveDefinition({
    id: 'hr.employeeMaster.payrollReadinessWide', title: 'Not Payroll-Ready',
    description: 'Active employees not payroll-ready, against those that are.',
    icon: 'fa-money-check-dollar', category: 'Key metrics', defaultSize: 'standard', sizes: KPI_WIDE_SIZES,
    render: PayrollReadinessKpi, previewVariant: 'status-stack',
    motion: { kind: 'progress', durationMs: 720, reducedMotion: 'static' },
  }),
  // KPI_SIZES (not PULSE_SIZES) is what makes this placeable on the KPI strip: liveDefinition
  // reads that identity to mark the widget FIXED at w4×h6 like every other KPI tile, so the
  // strip stays uniform and reorder-only. Category is 'Key metrics' for the same reason — it is a
  // sibling of Active Workforce, not of the Workforce-pulse cards.
  liveDefinition({
    id: 'hr.employeeMaster.monthlyHiresCard', title: 'Hires This Month',
    description: 'Current-month hires against the previous period.', icon: 'fa-user-plus',
    category: 'Key metrics', defaultSize: 'compact', sizes: KPI_SIZES, render: MonthlyHiresCard,
    previewVariant: 'metric', motion: { kind: 'count-up', durationMs: 520, reducedMotion: 'static' },
    // NO configSchema, deliberately: a KPI tile carries no settings. WidgetFrame only renders the
    // gear when a widget declares configurable options, so leaving this empty removes it from the
    // tile rather than hiding a control that exists. This is a plain KPI tile — same white shell
    // as every other tile on the strip — so there is nothing per-instance left to decide.
  }),
  liveDefinition({ id: 'hr.employeeMaster.internalMovesCard', title: 'Internal Moves', description: 'Internal transfers across the latest six periods.', icon: 'fa-box', category: 'Workforce pulse', defaultSize: 'compact', sizes: PULSE_SIZES, resizeStrategy: 'fixed-minimum', render: InternalMovesCard, previewVariant: 'trend', motion: { kind: 'sequence', durationMs: 680, reducedMotion: 'static' } }),
  liveDefinition({ id: 'hr.employeeMaster.promotionsCard', title: 'Promotions', description: 'Promotion movement across the latest six periods.', icon: 'fa-arrow-trend-up', category: 'Workforce pulse', defaultSize: 'compact', sizes: PULSE_SIZES, resizeStrategy: 'fixed-minimum', render: PromotionsCard, previewVariant: 'trend', motion: { kind: 'sequence', durationMs: 680, reducedMotion: 'static' } }),
  liveDefinition({ id: 'hr.employeeMaster.readinessRadar', title: 'Employee Readiness Radar', description: 'Six-dimension Employee Master readiness profile rendered with Chart.js.', icon: 'fa-chart-simple', category: 'Health & readiness', defaultSize: 'standard', sizes: RADAR_SIZES, render: ReadinessRadar, previewVariant: 'donut', minWidth: 275, minHeight: 388, previewAspect: .9, resizeStrategy: 'fixed-minimum', motion: { kind: 'chart-draw', durationMs: 720, reducedMotion: 'static' } }),
  liveDefinition({ id: 'hr.employeeMaster.lifecycleOutcomes', title: 'Lifecycle Outcomes', description: 'New starters and internal movements in a Chart.js stacked bar card.', icon: 'fa-chart-column', category: 'Activity & trends', defaultSize: 'standard', sizes: STACKED_CHART_SIZES, render: LifecycleOutcomeChart, previewVariant: 'trend', minWidth: 310, minHeight: 300, previewAspect: 1.15, motion: { kind: 'chart-draw', durationMs: 760, reducedMotion: 'static' } }),
];







