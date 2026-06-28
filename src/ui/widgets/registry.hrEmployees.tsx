/**
 * src/ui/widgets/registry.hrEmployees.tsx — HR Employee Master widgets for the library.
 *
 * Reuse-hooks: KPI widgets fetch via useHrDashboardStats; insight widgets via
 * useHrEmployees. Charts are SELF-CONTAINED (inline styles + primitive data props, no
 * `.hr-emp-master`-scoped CSS) so they render identically on the board and in catalogue
 * previews. The legacy `.em-*`/`.hrw-*` charts + panels are replaced by these.
 */
import type { JSX, VNode } from 'preact';
import type { WidgetDef } from './types';
import { StatsCard } from '@ui';
import { ellip, Empty, TrendArea, MiniBars, DonutPct } from './inlinePrimitives';
import { useHrDashboardStats, useHrEmployees, type HrEmployeeRow } from '@api/hr/employees';

const EMP_PAGES = ['hr.employees.overview'];
const EMP_ZONES = ['main', 'overview'];
const EMP_SOURCE = { sourceKey: 'hr_employees', label: 'HR Employee Master', refreshIntervalMs: 300000, permissions: ['hr.employees.view'] };

// ── insight charts (take primitive data so previews need no fake employee rows) ──
const DEPT_COLORS = ['#2f80ed', '#5db2dd', '#54bfae', '#68c487', '#38aab9', '#9b70dc'];
const EXC_PALETTE = ['#dc2626', '#d97706', '#2563eb'];

interface Slice { name: string; count: number }
interface Tile { label: string; value: string }

function computeDeptSlices(rows: HrEmployeeRow[]): Slice[] {
  const counts = new Map<string, number>();
  for (const r of rows) { const d = r.departmentName ?? 'Unassigned'; counts.set(d, (counts.get(d) ?? 0) + 1); }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([name, count]) => ({ name, count }));
}

function computeDemoTiles(rows: HrEmployeeRow[]): Tile[] {
  const now = Date.now(), YEAR = 365.25 * 864e5;
  const ages: number[] = [], tenures: number[] = [];
  for (const r of rows) {
    if (r.date_of_birth) { const a = (now - new Date(r.date_of_birth).getTime()) / YEAR; if (a > 0 && a < 100) ages.push(a); }
    if (r.start_date)    { const t = (now - new Date(r.start_date).getTime())    / YEAR; if (t >= 0 && t < 60)  tenures.push(t); }
  }
  const avg = (xs: number[]): number | null => xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null;
  const total = rows.length, contractors = rows.filter(r => r.workerType === 'contractor').length;
  const a = avg(ages), t = avg(tenures);
  return [
    { label: 'Headcount', value: String(total) },
    { label: 'Employees', value: String(total - contractors) },
    { label: 'Contractors', value: String(contractors) },
    { label: 'Average age', value: a != null ? a.toFixed(1) : '—' },
    { label: 'Average tenure', value: t != null ? `${t.toFixed(1)} yrs` : '—' },
  ];
}

function DeptPie({ slices }: { slices: Slice[] }): VNode {
  const total = slices.reduce((s, x) => s + x.count, 0) || 1;
  if (!slices.length) return <Empty label="No employees" />;
  let acc = 0;
  const stops = slices.map((s, i) => { const a = (acc / total) * 100; acc += s.count; const b = (acc / total) * 100; return `${DEPT_COLORS[i % DEPT_COLORS.length]} ${a.toFixed(1)}% ${b.toFixed(1)}%`; });
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
      <div style={{ width: 96, height: 96, borderRadius: '50%', flex: 'none', background: `conic-gradient(${stops.join(', ')})` }} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0, fontSize: 12, flex: 1 }}>
        {slices.map((s, i) => (
          <div key={s.name} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <i style={{ width: 9, height: 9, borderRadius: 3, background: DEPT_COLORS[i % DEPT_COLORS.length], flex: 'none' }} />
            <span style={{ ...ellip, color: '#475569' }}>{s.name}</span>
            <b style={{ marginLeft: 'auto', color: '#1f2a44', flex: 'none' }}>{Math.round((s.count / total) * 100)}% ({s.count})</b>
          </div>
        ))}
      </div>
    </div>
  );
}

function DemoTiles({ tiles }: { tiles: Tile[] }): VNode {
  const tile: JSX.CSSProperties = { border: '1px solid var(--cds-border, #e4e7ec)', borderRadius: 10, padding: '8px 10px', background: 'var(--cds-surface, #fff)' };
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(92px, 1fr))', gap: 8 }}>
      {tiles.map(t => (
        <div key={t.label} style={tile}>
          <small style={{ display: 'block', color: '#94a3b8', fontSize: 11 }}>{t.label}</small>
          <strong style={{ fontSize: 18, color: '#1f2a44' }}>{t.value}</strong>
        </div>
      ))}
    </div>
  );
}

function lockedDef(id: string, title: string, icon: string, category: string, reason: string, previewVariant: WidgetDef['previewVariant'], grid: { w: number; h: number }): WidgetDef {
  return {
    id, module: 'hr', area: 'employees', title,
    description: reason, icon, category, tags: [category.toLowerCase(), 'coming soon'],
    previewVariant, supportedPages: EMP_PAGES, supportedZones: EMP_ZONES,
    defaultSize: 'standard',
    allowedSizes: [{ key: 'standard', label: 'Standard', grid, description: 'Standard.' }],
    defaultConfig: {}, configSchema: [],
    dataSource: { ...EMP_SOURCE, sourceKey: id },
    lockedReason: reason,
    render: () => <Empty label="Coming soon" />,
    renderPreview: () => <Empty label={title} h={70} />,
  };
}

// Widget package: auto-registered by registry.ts via the `widgets` export (see the guide).
export const widgets: WidgetDef[] = [
  // ── KPIs (chrome:none — StatsCard brings its own card) ──
  {
    id: 'hr.employees.activeWorkforce',
    module: 'hr', area: 'employees',
    title: 'Active Workforce',
    description: 'Headcount across all sites with employees / contractors split + trend.',
    icon: 'fa-users', category: 'KPIs', tags: ['workforce', 'headcount', 'kpi', 'trend'],
    previewVariant: 'metric', chrome: 'none',
    supportedPages: EMP_PAGES, supportedZones: EMP_ZONES,
    defaultSize: 'standard',
    allowedSizes: [
      { key: 'compact', label: 'Compact', grid: { w: 3, h: 3 }, description: 'Metric.' },
      { key: 'standard', label: 'Standard', grid: { w: 4, h: 3 }, description: 'Metric + trend.' },
    ],
    defaultConfig: {}, configSchema: [],
    dataSource: EMP_SOURCE, recommendedFor: EMP_PAGES,
    render: () => {
      const q = useHrDashboardStats();
      const aw = q.data?.active_workforce;
      const trend = aw?.trend ?? [];
      const last = trend[trend.length - 1], prev = trend[trend.length - 2];
      const net = last && prev ? last.count - prev.count : null;
      return (
        <StatsCard icon="fa-users" title="Active Workforce" loading={q.isLoading && !q.data}
          metric={aw?.total ?? 0} supporting="Active people records across all sites"
          chart={<TrendArea points={trend.map(t => t.count)} />}
          footer={`${aw?.employees ?? 0} employees · ${aw?.contractors ?? 0} contractors${net != null ? ` · ${net >= 0 ? '+' : ''}${net} net` : ''}`} />
      );
    },
    renderPreview: () => (
      <StatsCard icon="fa-users" title="Active Workforce" metric={248} supporting="Active people records across all sites"
        chart={<TrendArea points={[210, 218, 225, 230, 240, 248]} />} footer="206 employees · 42 contractors · +8 net" />
    ),
  },
  {
    id: 'hr.employees.workQueue',
    module: 'hr', area: 'employees',
    title: 'HR Work Queue',
    description: 'Open HR actions requiring review, by type.',
    icon: 'fa-list-check', category: 'KPIs', tags: ['work queue', 'actions', 'kpi'],
    previewVariant: 'status-stack', chrome: 'none',
    supportedPages: EMP_PAGES, supportedZones: EMP_ZONES,
    defaultSize: 'standard',
    allowedSizes: [
      { key: 'compact', label: 'Compact', grid: { w: 3, h: 3 }, description: 'Metric.' },
      { key: 'standard', label: 'Standard', grid: { w: 4, h: 3 }, description: 'Metric + mix.' },
    ],
    defaultConfig: {}, configSchema: [],
    dataSource: EMP_SOURCE, recommendedFor: EMP_PAGES,
    render: () => {
      const q = useHrDashboardStats();
      const wq = q.data?.hr_work_queue;
      return (
        <StatsCard icon="fa-list-check" title="HR Work Queue" loading={q.isLoading && !q.data}
          metric={wq?.total ?? 0} supporting="Open HR actions requiring review"
          chart={<MiniBars rows={(wq?.mix ?? []).map(m => ({ label: m.type, count: m.count }))} />}
          footer={`${wq?.urgent ?? 0} urgent`} />
      );
    },
    renderPreview: () => (
      <StatsCard icon="fa-list-check" title="HR Work Queue" metric={14} supporting="Open HR actions requiring review"
        chart={<MiniBars rows={[{ label: 'change_request', count: 6 }, { label: 'status_change', count: 4 }, { label: 'document', count: 3 }]} />} footer="3 urgent" />
    ),
  },
  {
    id: 'hr.employees.readiness',
    module: 'hr', area: 'employees',
    title: 'Readiness',
    description: 'Payroll, statutory and training readiness across the workforce.',
    icon: 'fa-shield-halved', category: 'KPIs', tags: ['readiness', 'payroll', 'training', 'kpi'],
    previewVariant: 'donut', chrome: 'none',
    supportedPages: EMP_PAGES, supportedZones: EMP_ZONES,
    defaultSize: 'standard',
    allowedSizes: [
      { key: 'compact', label: 'Compact', grid: { w: 3, h: 3 }, description: 'Percent.' },
      { key: 'standard', label: 'Standard', grid: { w: 4, h: 3 }, description: 'Percent + breakdown.' },
    ],
    defaultConfig: {}, configSchema: [],
    dataSource: EMP_SOURCE, recommendedFor: EMP_PAGES,
    render: () => {
      const q = useHrDashboardStats();
      const rd = q.data?.readiness;
      return (
        <StatsCard icon="fa-shield-halved" title="Readiness" loading={q.isLoading && !q.data}
          metric={`${rd?.percent ?? 0}%`} supporting="Payroll, statutory and training readiness"
          chart={<DonutPct percent={rd?.percent ?? 0} />}
          footer={`${rd?.payroll_ready ?? 0} payroll ready · ${rd?.training_current ?? 0} training current`} />
      );
    },
    renderPreview: () => (
      <StatsCard icon="fa-shield-halved" title="Readiness" metric="82%" supporting="Payroll, statutory and training readiness"
        chart={<DonutPct percent={82} />} footer="190 payroll ready · 176 training current" />
    ),
  },
  {
    id: 'hr.employees.exceptions',
    module: 'hr', area: 'employees',
    title: 'Workforce Exceptions',
    description: 'Records blocking clean handoff or assignment, by type.',
    icon: 'fa-triangle-exclamation', category: 'KPIs', tags: ['exceptions', 'risk', 'kpi'],
    previewVariant: 'status-stack', chrome: 'none',
    supportedPages: EMP_PAGES, supportedZones: EMP_ZONES,
    defaultSize: 'standard',
    allowedSizes: [
      { key: 'compact', label: 'Compact', grid: { w: 3, h: 3 }, description: 'Metric.' },
      { key: 'standard', label: 'Standard', grid: { w: 4, h: 3 }, description: 'Metric + items.' },
    ],
    defaultConfig: {}, configSchema: [],
    dataSource: EMP_SOURCE, recommendedFor: EMP_PAGES,
    render: () => {
      const q = useHrDashboardStats();
      const ex = q.data?.exceptions;
      return (
        <StatsCard icon="fa-triangle-exclamation" title="Workforce Exceptions" loading={q.isLoading && !q.data}
          metric={ex?.total ?? 0} supporting="Records blocking clean handoff or assignment"
          chart={<MiniBars rows={(ex?.items ?? []).map(m => ({ label: m.type, count: m.count }))} palette={EXC_PALETTE} />}
          footer={(ex?.total ?? 0) > 0 ? 'Needs action' : 'Clear'} />
      );
    },
    renderPreview: () => (
      <StatsCard icon="fa-triangle-exclamation" title="Workforce Exceptions" metric={5} supporting="Records blocking clean handoff or assignment"
        chart={<MiniBars rows={[{ label: 'missing_statutory', count: 3 }, { label: 'no_supervisor', count: 2 }]} palette={EXC_PALETTE} />} footer="Needs action" />
    ),
  },
  // ── insight panels (standard chrome — framed with title) ──
  {
    id: 'hr.employees.deptDistribution',
    module: 'hr', area: 'employees',
    title: 'Department Distribution',
    description: 'Share of the workforce by department.',
    icon: 'fa-chart-pie', category: 'Workforce', tags: ['departments', 'distribution', 'workforce'],
    previewVariant: 'donut',
    supportedPages: EMP_PAGES, supportedZones: EMP_ZONES,
    defaultSize: 'standard',
    allowedSizes: [
      { key: 'standard', label: 'Standard', grid: { w: 4, h: 3 }, description: 'Pie + legend.' },
      { key: 'wide', label: 'Wide', grid: { w: 6, h: 3 }, description: 'Wide pie + legend.' },
    ],
    defaultConfig: {}, configSchema: [],
    dataSource: EMP_SOURCE, recommendedFor: EMP_PAGES,
    render: () => {
      const q = useHrEmployees({ limit: 500 });
      if (q.isLoading && !q.data) return <Empty label="Loading…" />;
      return <DeptPie slices={computeDeptSlices(q.data ?? [])} />;
    },
    renderPreview: () => (
      <DeptPie slices={[{ name: 'Operations', count: 64 }, { name: 'Engineering', count: 41 }, { name: 'HSE', count: 22 }, { name: 'Finance', count: 14 }]} />
    ),
  },
  {
    id: 'hr.employees.demographics',
    module: 'hr', area: 'employees',
    title: 'Demographics',
    description: 'Headcount, employee/contractor split, average age and tenure.',
    icon: 'fa-users', category: 'Workforce', tags: ['demographics', 'age', 'tenure', 'workforce'],
    previewVariant: 'matrix',
    supportedPages: EMP_PAGES, supportedZones: EMP_ZONES,
    defaultSize: 'standard',
    allowedSizes: [
      { key: 'standard', label: 'Standard', grid: { w: 4, h: 3 }, description: 'Tiles.' },
      { key: 'wide', label: 'Wide', grid: { w: 6, h: 2 }, description: 'Wide tiles.' },
    ],
    defaultConfig: {}, configSchema: [],
    dataSource: EMP_SOURCE, recommendedFor: EMP_PAGES,
    render: () => {
      const q = useHrEmployees({ limit: 500 });
      if (q.isLoading && !q.data) return <Empty label="Loading…" />;
      return <DemoTiles tiles={computeDemoTiles(q.data ?? [])} />;
    },
    renderPreview: () => (
      <DemoTiles tiles={[
        { label: 'Headcount', value: '248' }, { label: 'Employees', value: '206' }, { label: 'Contractors', value: '42' },
        { label: 'Average age', value: '37.4' }, { label: 'Average tenure', value: '4.6 yrs' },
      ]} />
    ),
  },
  // ── locked until their source module exists (no fake data) ──
  lockedDef('hr.employees.compliance', 'Overall Compliance', 'fa-shield-halved', 'Compliance', 'Needs the HR compliance summary endpoint', 'donut', { w: 3, h: 4 }),
  lockedDef('hr.employees.expiringCerts', 'Expiring Certifications', 'fa-triangle-exclamation', 'Compliance', 'Needs the HR compliance summary endpoint', 'table', { w: 4, h: 4 }),
  lockedDef('hr.employees.attendanceTrend', 'Attendance Trend', 'fa-chart-line', 'Attendance', 'Needs the Attendance module', 'trend', { w: 6, h: 4 }),
  lockedDef('hr.employees.lifecycleFunnel', 'Lifecycle Funnel', 'fa-filter', 'Lifecycle', 'Needs a recruiting / ATS module', 'flow-map', { w: 6, h: 5 }),
  lockedDef('hr.employees.skillsHeatmap', 'Competency Heatmap', 'fa-grip', 'Skills', 'Needs the competency module', 'matrix', { w: 8, h: 5 }),
];
