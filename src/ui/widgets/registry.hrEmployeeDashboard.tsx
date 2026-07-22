import type { VNode } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import {
  CategoryScale,
  Chart,
  Filler,
  Legend,
  LineController,
  LineElement,
  LinearScale,
  PointElement,
  Tooltip,
} from 'chart.js';
import { useHrDashboardStats, type HrDashboardStats } from '@api/hr/employees';
import { LucideIcon } from '../LucideIcon';
import { KpiTile, type KpiTone } from '../components/KpiTile';
import { defineWidget } from './defineWidget';
import { findWidgetDataSource, registerWidgetDataSource } from './dataSources';
import type { WidgetDef, WidgetRenderProps, WidgetSizeDef } from './types';
import './hrEmployeeDashboardWidgets.css';

Chart.register(LineController, CategoryScale, LinearScale, PointElement, LineElement, Filler, Tooltip, Legend);

const PAGE = 'hr.employees.overview';
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

const KPI_SIZES: WidgetSizeDef[] = [
  { key: 'compact', label: 'Fixed', grid: { w: 6, h: 2 }, min: { w: 6, h: 2 }, max: { w: 6, h: 2 }, description: 'Uniform Employee Master KPI tile' },
];
const CHART_SIZES: WidgetSizeDef[] = [
  { key: 'standard', label: 'Standard', grid: { w: 10, h: 4 }, min: { w: 8, h: 4 }, description: 'Focused chart' },
  { key: 'wide', label: 'Wide', grid: { w: 12, h: 4 }, min: { w: 8, h: 4 }, description: 'Full chart detail' },
  { key: 'large', label: 'Large', grid: { w: 16, h: 5 }, min: { w: 8, h: 4 }, description: 'Expanded analysis' },
];
const OPERATIONS_SIZES: WidgetSizeDef[] = [
  { key: 'standard', label: 'Standard', grid: { w: 6, h: 5 }, min: { w: 5, h: 4 }, description: 'Compact work queue' },
  { key: 'wide', label: 'Wide', grid: { w: 9, h: 5 }, min: { w: 5, h: 4 }, description: 'Expanded queue detail' },
  { key: 'large', label: 'Large', grid: { w: 12, h: 5 }, min: { w: 5, h: 4 }, description: 'Full operational detail' },
];

const PREVIEW: HrDashboardStats = {
  active_workforce: { total: 128, employees: 116, contractors: 12, trend: [{ period: 'Feb', count: 117 }, { period: 'Mar', count: 120 }, { period: 'Apr', count: 121 }, { period: 'May', count: 124 }, { period: 'Jun', count: 126 }, { period: 'Jul', count: 128 }] },
  hr_work_queue: { total: 14, urgent: 3, oldest_days: 4, mix: [{ type: 'contact_update', count: 6 }, { type: 'transfer_promotion', count: 5 }, { type: 'status_change', count: 3 }] },
  readiness: { percent: 86, assignment_complete: 118, payroll_ready: 121, training_current: 92, blocked: 5 },
  exceptions: { total: 11, items: [{ type: 'Supervisor', count: 4 }, { type: 'Payroll', count: 3 }, { type: 'Training', count: 4 }] },
  distribution: { departments: [{ id: 'ops', label: 'Operations', count: 48, percent: 38 }, { id: 'finance', label: 'Finance', count: 29, percent: 23 }, { id: 'hr', label: 'Human Resources', count: 24, percent: 19 }, { id: 'other', label: 'Other', count: 27, percent: 21 }], sites: [{ id: 'hq', label: 'Head Office', count: 76, percent: 59 }, { id: 'south', label: 'South Site', count: 32, percent: 25 }, { id: 'other', label: 'Other', count: 20, percent: 16 }] },
  lifecycle: { periods: [{ period: 'Feb', hires: 4, exits: 1, transfers: 2, promotions: 1 }, { period: 'Mar', hires: 5, exits: 2, transfers: 1, promotions: 2 }, { period: 'Apr', hires: 3, exits: 2, transfers: 3, promotions: 1 }, { period: 'May', hires: 6, exits: 1, transfers: 2, promotions: 2 }, { period: 'Jun', hires: 4, exits: 2, transfers: 4, promotions: 1 }, { period: 'Jul', hires: 5, exits: 1, transfers: 2, promotions: 2 }], totals: { hires: 27, exits: 9, transfers: 14, promotions: 9 } },
};

function WidgetHeader({ title, subtitle }: { title: string; subtitle?: string }): VNode {
  return <header class="hrew-head"><div><h3>{title}</h3>{subtitle ? <p>{subtitle}</p> : null}</div><LucideIcon name="MoreHorizontal" size={18} /></header>;
}

function WidgetState({ kind, message }: { kind: 'loading' | 'error'; message?: string }): VNode {
  return <article class="hrew-card hrew-state" data-widget-content-root role={kind === 'error' ? 'alert' : 'status'}>
    <LucideIcon name={kind === 'error' ? 'TriangleAlert' : 'LoaderCircle'} size={23} class={kind === 'loading' ? 'is-spinning' : undefined} />
    <span>{message ?? 'Loading authorised Employee Master data…'}</span>
  </article>;
}

function withLiveData(View: (props: { stats: HrDashboardStats }) => VNode): (_props: WidgetRenderProps) => VNode {
  return function LiveWidget(): VNode {
    const query = useHrDashboardStats();
    if (query.isLoading && !query.data) return <WidgetState kind="loading" />;
    if (!query.data) return <WidgetState kind="error" message={query.error instanceof Error ? query.error.message : 'Employee Master data is unavailable.'} />;
    return <View stats={query.data} />;
  };
}

function KpiCard({ title, value, detail, icon, tone = 'blue' }: { title: string; value: number | string; detail: string; icon: string; tone?: KpiTone }): VNode {
  return <div class="hrew-kpi-shell" data-widget-content-root><KpiTile icon={icon} tone={tone} label={title} value={value} sub={detail} /></div>;
}

function ActiveWorkforce({ stats }: { stats: HrDashboardStats }): VNode {
  const s = stats.active_workforce;
  return <KpiCard title="Active workforce" value={s.total} detail={`${s.employees} employees · ${s.contractors} contractors`} icon="fa-users" />;
}
function RecordReadiness({ stats }: { stats: HrDashboardStats }): VNode {
  const s = stats.readiness;
  return <KpiCard title="Record readiness" value={`${s.percent}%`} detail={`${s.blocked} people currently blocked`} icon="fa-shield-check" tone="green" />;
}
function HrWorkQueue({ stats }: { stats: HrDashboardStats }): VNode {
  const s = stats.hr_work_queue;
  return <KpiCard title="HR work queue" value={s.total} detail={`${s.urgent} urgent · oldest ${s.oldest_days ?? 0}d`} icon="fa-list-check" tone="amber" />;
}
function Exceptions({ stats }: { stats: HrDashboardStats }): VNode {
  const s = stats.exceptions;
  return <KpiCard title="Exceptions" value={s.total} detail={s.items.slice(0, 2).map(x => `${x.type} ${x.count}`).join(' · ') || 'No current exceptions'} icon="fa-circle-exclamation" tone="neutral" />;
}

function WorkforceTrend({ stats }: { stats: HrDashboardStats }): VNode {
  const points = stats.active_workforce.trend;
  const values = points.map(point => point.count);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const change = (values.at(-1) ?? 0) - (values[0] ?? 0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || points.length === 0) return;

    const chart = new Chart(canvas, {
      type: 'line',
      data: {
        labels: points.map(point => point.period),
        datasets: [{
          label: 'Active workforce',
          data: values,
          borderColor: '#2563d8',
          backgroundColor: 'rgba(37, 99, 216, 0.12)',
          borderWidth: 2,
          pointRadius: 3,
          pointHoverRadius: 5,
          pointBackgroundColor: '#ffffff',
          pointBorderColor: '#2563d8',
          pointBorderWidth: 2,
          tension: 0.35,
          fill: true,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 760 },
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            displayColors: false,
            callbacks: { label: context => `${context.parsed.y ?? 0} active people` },
          },
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: { color: '#6b7689', font: { size: 10 } },
            border: { display: false },
          },
          y: {
            beginAtZero: false,
            grace: '12%',
            ticks: { color: '#6b7689', precision: 0, font: { size: 10 } },
            grid: { color: 'rgba(148, 163, 184, 0.18)' },
            border: { display: false },
          },
        },
      },
    });

    return () => chart.destroy();
  }, [points, values]);
  return <article class="hrew-card hrew-chart" data-widget-content-root>
    <WidgetHeader title="Workforce trend" subtitle="Active headcount · last six months" />
    <div class="hrew-chart-metric"><strong>{stats.active_workforce.total}</strong><span class={change >= 0 ? 'is-positive' : 'is-negative'}>{change >= 0 ? '+' : ''}{change} over period</span></div>
    <div class="hrew-line-chart">
      <div class="hrew-line-chart-canvas"><canvas ref={canvasRef} aria-label="Six month active workforce trend" role="img" /></div>
      <div class="hrew-trend-values" aria-label="Workforce trend values">{points.map(point => <span key={point.period}>{point.period}<b>{point.count}</b></span>)}</div>
    </div>
  </article>;
}

function WorkforceDistribution({ stats }: { stats: HrDashboardStats }): VNode {
  const rows = stats.distribution.departments.slice(0, 5);
  return <article class="hrew-card hrew-distribution" data-widget-content-root>
    <WidgetHeader title="Workforce distribution" subtitle="Active people by department" />
    <div class="hrew-distribution-total"><strong>{stats.active_workforce.total}</strong><span>active people</span></div>
    <div class="hrew-distribution-list">{rows.length ? rows.map(row => <div key={row.id}><span>{row.label}</span><b>{row.count}</b><i><em style={`width:${row.percent}%`} /></i><small>{row.percent}%</small></div>) : <p>No active workforce distribution is available.</p>}</div>
  </article>;
}

function LifecycleMovement({ stats }: { stats: HrDashboardStats }): VNode {
  const { periods, totals } = stats.lifecycle;
  const peak = Math.max(1, ...periods.flatMap(period => [period.hires, period.exits, period.transfers, period.promotions]));
  return <article class="hrew-card hrew-lifecycle" data-widget-content-root>
    <WidgetHeader title="Lifecycle movement" subtitle="Effective movement · last six months" />
    <div class="hrew-lifecycle-bars">{periods.map(period => <div key={period.period}><span class="is-hires" style={`height:${Math.max(4, period.hires / peak * 100)}%`} title={`${period.hires} hires`} /><span class="is-transfers" style={`height:${Math.max(4, period.transfers / peak * 100)}%`} title={`${period.transfers} transfers`} /><span class="is-promotions" style={`height:${Math.max(4, period.promotions / peak * 100)}%`} title={`${period.promotions} promotions`} /><span class="is-exits" style={`height:${Math.max(4, period.exits / peak * 100)}%`} title={`${period.exits} exits`} /><b>{period.period}</b></div>)}</div>
    <footer class="hrew-lifecycle-summary"><span><i class="is-hires" />Hires <b>{totals.hires}</b></span><span><i class="is-transfers" />Transfers <b>{totals.transfers}</b></span><span><i class="is-promotions" />Promotions <b>{totals.promotions}</b></span><span><i class="is-exits" />Exits <b>{totals.exits}</b></span></footer>
  </article>;
}

function MasterDataWorkload({ stats }: { stats: HrDashboardStats }): VNode {
  const queue = stats.hr_work_queue;
  const max = Math.max(1, ...queue.mix.map(row => row.count));
  const labels: Record<string, string> = { contact_update: 'Profile corrections', transfer_promotion: 'Transfers & promotions', status_change: 'Status changes', role_change: 'Role changes', department_transfer: 'Department transfers', site_transfer: 'Site transfers', supervisor_change: 'Supervisor changes', employment_type_change: 'Employment changes', salary_change: 'Salary changes' };
  return <article class="hrew-card hrew-workload" data-widget-content-root>
    <WidgetHeader title="Master data workload" subtitle={`${queue.total} open · ${queue.urgent} urgent`} />
    <div class="hrew-workload-list">{queue.mix.length ? [...queue.mix].sort((a, b) => b.count - a.count).slice(0, 4).map(row => <div key={row.type}><span>{labels[row.type] ?? row.type.replace(/_/g, ' ')}</span><b>{row.count}</b><i><em style={`width:${row.count / max * 100}%`} /></i></div>) : <div class="hrew-empty"><LucideIcon name="CircleCheckBig" size={24} /><span>The Employee Master queue is clear.</span></div>}</div>
    <footer><LucideIcon name="Clock3" size={15} />Oldest open item: {queue.oldest_days ?? 0} days</footer>
  </article>;
}

function liveDefinition(input: { id: string; title: string; description: string; icon: string; category: string; defaultSize: WidgetDef['defaultSize']; sizes: WidgetSizeDef[]; render: (props: { stats: HrDashboardStats }) => VNode; previewVariant: WidgetDef['previewVariant']; motion: NonNullable<WidgetDef['motion']>; fixed?: boolean }): WidgetDef {
  const defaultGrid = input.sizes.find(size => size.key === input.defaultSize)?.grid ?? input.sizes[0]?.grid ?? { w: 6, h: 3 };
  return defineWidget({
    id: input.id, module: 'hr', area: 'Employee Master', title: input.title, description: input.description,
    longDescription: `${input.description} Uses the authenticated Employee Master dashboard API and server-scoped workforce records.`,
    icon: input.icon, category: input.category, tags: ['hr', 'employee master', 'live api'], previewVariant: input.previewVariant,
    chrome: 'none', sizeToContent: false, resizable: input.fixed !== true, supportedPages: [PAGE], supportedZones: ['main'], defaultSize: input.defaultSize,
    allowedSizes: input.sizes, sizeConstraints: { defaultColumns: defaultGrid.w, defaultRows: defaultGrid.h, minColumns: input.sizes[0]?.min?.w ?? 5, minRows: input.sizes[0]?.min?.h ?? 2, minWidth: input.sizes === KPI_SIZES ? 220 : 300, minHeight: input.sizes === KPI_SIZES ? 140 : 320, resizeStrategy: input.fixed ? 'fixed-minimum' : 'content-measured' },
    previewAspect: input.sizes === KPI_SIZES ? 1.45 : input.sizes === CHART_SIZES ? 1.55 : 1.1,
    defaultConfig: {}, configSchema: [], dataSource: SOURCE, dataSourceKey: SOURCE.sourceKey,
    governance: { state: 'enabled', discoverable: true, allowedPages: [PAGE], requiredCapabilities: ['hr.employees.view'] },
    permissions: { requiredPermissions: ['hr.employees.view'] }, runtimeState: 'live-api', recommendedFor: [PAGE], motion: input.motion,
    render: withLiveData(input.render), renderPreview: () => input.render({ stats: PREVIEW }),
  });
}

export const widgets: WidgetDef[] = [
  liveDefinition({ id: 'hr.employeeMaster.activeWorkforce', title: 'Active workforce', description: 'Current active employee and contractor headcount.', icon: 'fa-users', category: 'Key metrics', defaultSize: 'compact', sizes: KPI_SIZES, fixed: true, render: ActiveWorkforce, previewVariant: 'metric', motion: { kind: 'count-up', durationMs: 520, reducedMotion: 'static' } }),
  liveDefinition({ id: 'hr.employeeMaster.recordReadiness', title: 'Record readiness', description: 'Assignment, payroll, and training readiness across active workers.', icon: 'fa-shield-check', category: 'Key metrics', defaultSize: 'compact', sizes: KPI_SIZES, fixed: true, render: RecordReadiness, previewVariant: 'metric', motion: { kind: 'progress', durationMs: 620, reducedMotion: 'static' } }),
  liveDefinition({ id: 'hr.employeeMaster.hrWorkQueue', title: 'HR work queue', description: 'Open and urgent Employee Master change requests.', icon: 'fa-list-check', category: 'Key metrics', defaultSize: 'compact', sizes: KPI_SIZES, fixed: true, render: HrWorkQueue, previewVariant: 'metric', motion: { kind: 'count-up', durationMs: 520, reducedMotion: 'static' } }),
  liveDefinition({ id: 'hr.employeeMaster.exceptions', title: 'Exceptions', description: 'Current assignment, payroll, and training gaps.', icon: 'fa-circle-exclamation', category: 'Key metrics', defaultSize: 'compact', sizes: KPI_SIZES, fixed: true, render: Exceptions, previewVariant: 'metric', motion: { kind: 'count-up', durationMs: 520, reducedMotion: 'static' } }),
  liveDefinition({ id: 'hr.employeeMaster.workforceTrend', title: 'Workforce trend', description: 'Six-month active workforce movement.', icon: 'fa-chart-line', category: 'Activity & trends', defaultSize: 'wide', sizes: CHART_SIZES, render: WorkforceTrend, previewVariant: 'trend', motion: { kind: 'chart-draw', durationMs: 760, reducedMotion: 'static' } }),
  liveDefinition({ id: 'hr.employeeMaster.workforceDistribution', title: 'Workforce distribution', description: 'Active workforce concentration by department.', icon: 'fa-chart-pie', category: 'Workforce overview', defaultSize: 'wide', sizes: CHART_SIZES, render: WorkforceDistribution, previewVariant: 'donut', motion: { kind: 'progress', durationMs: 680, reducedMotion: 'static' } }),
  liveDefinition({ id: 'hr.employeeMaster.lifecycleMovement', title: 'Lifecycle movement', description: 'Hires, exits, transfers, and promotions over six months.', icon: 'fa-arrow-right-arrow-left', category: 'Activity & trends', defaultSize: 'wide', sizes: CHART_SIZES, render: LifecycleMovement, previewVariant: 'trend', motion: { kind: 'sequence', durationMs: 720, reducedMotion: 'static' } }),
  liveDefinition({ id: 'hr.employeeMaster.masterDataWorkload', title: 'Master data workload', description: 'Employee change workload by request type and age.', icon: 'fa-list-check', category: 'Actions & workload', defaultSize: 'standard', sizes: OPERATIONS_SIZES, render: MasterDataWorkload, previewVariant: 'status-stack', motion: { kind: 'progress', durationMs: 620, reducedMotion: 'static' } }),
];
