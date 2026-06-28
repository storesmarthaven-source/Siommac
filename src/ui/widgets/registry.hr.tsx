// src/ui/widgets/registry.hr.tsx — HR widget definitions for the library.
//
// REUSE-HOOKS model: each `render` is a component that fetches its own data via the
// module's existing TanStack hooks (here useOnboardingDashboard) — no generic data
// endpoint. `renderPreview` is a representative catalogue thumbnail (illustrative
// sample, clearly a preview), never presented as live data.

import type { WidgetDef } from './types';
import { StatsCard, ChartCard } from '@ui';
import { ListRow, WidgetList, MiniSparkline, type RowTone } from './inlinePrimitives';
import {
  useOnboardingDashboard, useOnboardingCases, useOnboardingTasksList,
  useOnboardingHandoffsList, useOnboardingBlockersList, useOnboardingPackages,
} from '@api/hr/onboarding';

const ONB_PAGES = ['hr.onboarding.overview', 'hr.onboarding.cases', 'hr.onboarding.caseDetail'];
const ONB_ZONES = ['main', 'overview', 'case-detail'];
const ONB_SOURCE = { sourceKey: 'hr_onboarding_cases', label: 'HR Onboarding Cases', refreshIntervalMs: 300000, permissions: ['hr.onboarding.view'] };

const fmtDate = (iso: string | null): string => {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};
const caseTone = (s: string): RowTone => s === 'blocked' ? 'danger' : s === 'paused' ? 'warn' : (s === 'ready_for_activation' || s === 'completed') ? 'ok' : 'muted';
const sevTone  = (s: string): RowTone => (s === 'critical' || s === 'high') ? 'danger' : s === 'medium' ? 'warn' : 'muted';

// Widget package: auto-registered by registry.ts via the `widgets` export (see the guide).
export const widgets: WidgetDef[] = [
  {
    id: 'hr.onboarding.activeCases',
    module: 'hr', area: 'onboarding',
    title: 'Active Onboarding',
    description: 'Active cases with the new-hire / transfer / contractor split.',
    icon: 'fa-users',
    category: 'Case Operations',
    tags: ['onboarding', 'cases', 'kpi'],
    previewVariant: 'metric',
    chrome: 'none',
    supportedPages: ONB_PAGES,
    supportedZones: ONB_ZONES,
    defaultSize: 'compact',
    allowedSizes: [
      { key: 'compact', label: 'Compact', grid: { w: 3, h: 2 }, description: 'Metric summary.' },
      { key: 'standard', label: 'Standard', grid: { w: 4, h: 2 }, description: 'Metric with breakdown.' },
    ],
    defaultConfig: {},
    configSchema: [],
    dataSource: { ...ONB_SOURCE, dependencies: [{ key: 'hr_onboarding_cases', label: 'Onboarding case records', required: true }] },
    recommendedFor: ONB_PAGES,
    render: () => {
      const q = useOnboardingDashboard();
      const d = q.data?.activeCases;
      return (
        <StatsCard
          icon="fa-users" title="Active onboarding"
          loading={q.isLoading && !q.data}
          metric={d?.total ?? 0}
          supporting="Active cases across the org"
          footer={`${d?.newHires ?? 0} new hires · ${d?.transfers ?? 0} transfers · ${d?.contractors ?? 0} contractors`}
        />
      );
    },
    renderPreview: () => (
      <StatsCard icon="fa-users" title="Active onboarding" metric={42}
        supporting="Active cases across the org" footer="28 new hires · 9 transfers · 5 contractors" />
    ),
  },
  {
    id: 'hr.onboarding.activationReadiness',
    module: 'hr', area: 'onboarding',
    title: 'Activation Readiness',
    description: 'Overall readiness % with per-category breakdown.',
    icon: 'fa-shield-halved',
    category: 'Case Operations',
    tags: ['onboarding', 'readiness', 'kpi'],
    previewVariant: 'donut',
    chrome: 'none',
    supportedPages: ONB_PAGES,
    supportedZones: ONB_ZONES,
    defaultSize: 'compact',
    allowedSizes: [
      { key: 'compact', label: 'Compact', grid: { w: 3, h: 2 }, description: 'Readiness %.' },
      { key: 'standard', label: 'Standard', grid: { w: 4, h: 2 }, description: 'Readiness % with categories.' },
    ],
    defaultConfig: {},
    configSchema: [],
    dataSource: ONB_SOURCE,
    recommendedFor: ONB_PAGES,
    render: () => {
      const q = useOnboardingDashboard();
      const d = q.data?.activationReadiness;
      return (
        <StatsCard
          icon="fa-shield-halved" title="Activation readiness"
          loading={q.isLoading && !q.data}
          metric={`${d?.readyPercent ?? 0}%`}
          supporting="Cases ready for activation"
          footer={`Docs ${d?.documentsReadyPercent ?? 0}% · Training ${d?.trainingReadyPercent ?? 0}% · Access ${d?.accessReadyPercent ?? 0}%`}
        />
      );
    },
    renderPreview: () => (
      <StatsCard icon="fa-shield-halved" title="Activation readiness" metric="64%"
        supporting="Cases ready for activation" footer="Docs 71% · Training 60% · Access 80%" />
    ),
  },
  {
    id: 'hr.onboarding.blockingTasks',
    module: 'hr', area: 'onboarding',
    title: 'Blocking Tasks',
    description: 'Cases blocked, split by documents / training / HSE / payroll.',
    icon: 'fa-ban',
    category: 'Case Operations',
    tags: ['onboarding', 'blockers', 'risk', 'kpi'],
    previewVariant: 'status-stack',
    chrome: 'none',
    supportedPages: ONB_PAGES,
    supportedZones: ONB_ZONES,
    defaultSize: 'compact',
    allowedSizes: [
      { key: 'compact', label: 'Compact', grid: { w: 3, h: 2 }, description: 'Blocked count.' },
      { key: 'standard', label: 'Standard', grid: { w: 4, h: 2 }, description: 'Blocked with split.' },
    ],
    defaultConfig: {},
    configSchema: [],
    dataSource: ONB_SOURCE,
    recommendedFor: ONB_PAGES,
    render: () => {
      const q = useOnboardingDashboard();
      const d = q.data?.blockingTasks;
      return (
        <StatsCard
          icon="fa-ban" title="Blocking tasks"
          loading={q.isLoading && !q.data}
          metric={d?.blockedCases ?? 0}
          supporting="Cases with a blocking task"
          footer={`Docs ${d?.documents ?? 0} · Training ${d?.training ?? 0} · HSE ${d?.hse ?? 0} · Payroll ${d?.payroll ?? 0}`}
        />
      );
    },
    renderPreview: () => (
      <StatsCard icon="fa-ban" title="Blocking tasks" metric={7}
        supporting="Cases with a blocking task" footer="Docs 4 · Training 2 · HSE 1 · Payroll 0" />
    ),
  },
  {
    id: 'hr.onboarding.dueThisWeek',
    module: 'hr', area: 'onboarding',
    title: 'Due This Week',
    description: 'Overdue, due today, and due in 7 days across active cases.',
    icon: 'fa-calendar-day',
    category: 'Case Operations',
    tags: ['onboarding', 'due', 'overdue', 'kpi'],
    previewVariant: 'metric',
    chrome: 'none',
    supportedPages: ONB_PAGES,
    supportedZones: ONB_ZONES,
    defaultSize: 'compact',
    allowedSizes: [
      { key: 'compact', label: 'Compact', grid: { w: 3, h: 2 }, description: 'Overdue count.' },
      { key: 'standard', label: 'Standard', grid: { w: 4, h: 2 }, description: 'Overdue with split.' },
    ],
    defaultConfig: {},
    configSchema: [],
    dataSource: ONB_SOURCE,
    recommendedFor: ONB_PAGES,
    render: () => {
      const q = useOnboardingDashboard();
      const d = q.data?.dueThisWeek;
      return (
        <StatsCard
          icon="fa-calendar-day" title="Due this week"
          loading={q.isLoading && !q.data}
          metric={d?.overdue ?? 0}
          supporting="Overdue tasks"
          footer={`Today ${d?.dueToday ?? 0} · 7d ${d?.dueIn7Days ?? 0} · Critical ${d?.criticalOverdue ?? 0}`}
        />
      );
    },
    renderPreview: () => (
      <StatsCard icon="fa-calendar-day" title="Due this week" metric={3}
        supporting="Overdue tasks" footer="Today 2 · 7d 9 · Critical 1" />
    ),
  },
  {
    id: 'hr.onboarding.weeklyTrend',
    module: 'hr', area: 'onboarding',
    title: 'New Cases / Week',
    description: 'Weekly trend of new onboarding cases started.',
    icon: 'fa-chart-line',
    category: 'Trends',
    tags: ['onboarding', 'trend', 'cases'],
    previewVariant: 'trend',
    chrome: 'none',
    supportedPages: ONB_PAGES,
    supportedZones: ONB_ZONES,
    defaultSize: 'standard',
    allowedSizes: [
      { key: 'standard', label: 'Standard', grid: { w: 4, h: 2 }, description: 'Compact trend.' },
      { key: 'wide', label: 'Wide', grid: { w: 6, h: 2 }, description: 'Full-width trend.' },
    ],
    defaultConfig: {},
    configSchema: [],
    dataSource: ONB_SOURCE,
    recommendedFor: ONB_PAGES,
    render: () => {
      const q = useOnboardingDashboard();
      const trend = q.data?.activeCases.weeklyTrend ?? [];
      return (
        <ChartCard label="New cases / week" loading={q.isLoading && !q.data} chartHeight={56}>
          <MiniSparkline points={trend.map(t => t.count)} />
        </ChartCard>
      );
    },
    renderPreview: () => (
      <ChartCard label="New cases / week" chartHeight={56}>
        <MiniSparkline points={[3, 5, 4, 7, 6, 9, 8]} />
      </ChartCard>
    ),
  },
  {
    id: 'hr.onboarding.recentCases',
    module: 'hr', area: 'onboarding',
    title: 'Recent Cases',
    description: 'Most recently started onboarding cases with progress and status.',
    icon: 'fa-list-check',
    category: 'Case Operations',
    tags: ['onboarding', 'cases', 'list', 'table'],
    previewVariant: 'table',
    supportedPages: ONB_PAGES,
    supportedZones: ONB_ZONES,
    defaultSize: 'tall',
    allowedSizes: [
      { key: 'tall', label: 'Tall', grid: { w: 4, h: 4 }, description: 'Narrow list.' },
      { key: 'large', label: 'Large', grid: { w: 6, h: 4 }, description: 'Wide list.' },
    ],
    defaultConfig: {},
    configSchema: [],
    dataSource: { ...ONB_SOURCE, dependencies: [{ key: 'hr_onboarding_cases', label: 'Onboarding case records', required: true }] },
    recommendedFor: ONB_PAGES,
    render: () => {
      const q = useOnboardingCases({ sort: { field: 'started_at', direction: 'desc' }, pageSize: 8 });
      const rows = (q.data?.rows ?? []).slice(0, 8).map(c => (
        <ListRow key={c.caseId}
          primary={c.employeeName ?? c.caseNo}
          secondary={`${c.packageLabel} · ${c.status.replace(/_/g, ' ')}`}
          right={`${c.progressPercent}%`} tone={caseTone(c.status)} />
      ));
      return <WidgetList loading={q.isLoading && !q.data} rows={rows} empty="No onboarding cases yet" />;
    },
    renderPreview: () => (
      <WidgetList loading={false} empty="" rows={[
        <ListRow key="1" primary="A. Okafor" secondary="Field New Hire · in progress" right="60%" tone="muted" />,
        <ListRow key="2" primary="M. Santos" secondary="Office New Hire · blocked" right="35%" tone="danger" />,
        <ListRow key="3" primary="R. Daniels" secondary="Contractor · ready for activation" right="100%" tone="ok" />,
      ]} />
    ),
  },
  {
    id: 'hr.onboarding.overdueTasks',
    module: 'hr', area: 'onboarding',
    title: 'Overdue Tasks',
    description: 'Onboarding tasks past their due date, across active cases.',
    icon: 'fa-clock',
    category: 'Case Operations',
    tags: ['onboarding', 'tasks', 'overdue', 'list'],
    previewVariant: 'checklist',
    supportedPages: ONB_PAGES,
    supportedZones: ONB_ZONES,
    defaultSize: 'tall',
    allowedSizes: [
      { key: 'tall', label: 'Tall', grid: { w: 4, h: 4 }, description: 'Narrow list.' },
      { key: 'large', label: 'Large', grid: { w: 6, h: 4 }, description: 'Wide list.' },
    ],
    defaultConfig: {},
    configSchema: [],
    dataSource: { ...ONB_SOURCE, dependencies: [{ key: 'hr_onboarding_tasks', label: 'Onboarding task records', required: true }] },
    recommendedFor: ONB_PAGES,
    render: () => {
      const q = useOnboardingTasksList({ dueState: 'overdue' });
      const rows = (q.data ?? []).slice(0, 10).map(t => (
        <ListRow key={t.taskId}
          primary={t.taskTitle}
          secondary={`${t.caseNo} · ${t.employeeName ?? '—'}`}
          right={`Due ${fmtDate(t.dueAt)}`} tone="danger" />
      ));
      return <WidgetList loading={q.isLoading && !q.data} rows={rows} empty="No overdue tasks" />;
    },
    renderPreview: () => (
      <WidgetList loading={false} empty="" rows={[
        <ListRow key="1" primary="Collect signed contract" secondary="ONB-1042 · A. Okafor" right="Due Jun 12" tone="danger" />,
        <ListRow key="2" primary="HSE induction booking" secondary="ONB-1039 · M. Santos" right="Due Jun 14" tone="danger" />,
      ]} />
    ),
  },
  {
    id: 'hr.onboarding.pendingHandoffs',
    module: 'hr', area: 'onboarding',
    title: 'Pending Handoffs',
    description: 'Cross-module handoffs awaiting acceptance or delivery.',
    icon: 'fa-right-left',
    category: 'Cross-module',
    tags: ['onboarding', 'handoffs', 'list'],
    previewVariant: 'status-stack',
    supportedPages: ONB_PAGES,
    supportedZones: ONB_ZONES,
    defaultSize: 'tall',
    allowedSizes: [
      { key: 'tall', label: 'Tall', grid: { w: 4, h: 4 }, description: 'Narrow list.' },
      { key: 'large', label: 'Large', grid: { w: 6, h: 4 }, description: 'Wide list.' },
    ],
    defaultConfig: {},
    configSchema: [],
    dataSource: { ...ONB_SOURCE, dependencies: [{ key: 'hr_onboarding_handoffs', label: 'Onboarding handoff records', required: true }] },
    recommendedFor: ONB_PAGES,
    render: () => {
      const q = useOnboardingHandoffsList({ statuses: ['pending', 'sent'] });
      const rows = (q.data ?? []).slice(0, 10).map(hd => (
        <ListRow key={hd.handoffId}
          primary={`${hd.targetModule}${hd.handoffType ? ` · ${hd.handoffType}` : ''}`}
          secondary={`${hd.caseNo} · ${hd.employeeName ?? '—'}`}
          right={hd.status} tone={hd.status === 'sent' ? 'warn' : 'muted'} />
      ));
      return <WidgetList loading={q.isLoading && !q.data} rows={rows} empty="No pending handoffs" />;
    },
    renderPreview: () => (
      <WidgetList loading={false} empty="" rows={[
        <ListRow key="1" primary="payroll · enrol" secondary="ONB-1042 · A. Okafor" right="sent" tone="warn" />,
        <ListRow key="2" primary="hse · induction" secondary="ONB-1039 · M. Santos" right="pending" tone="muted" />,
      ]} />
    ),
  },
  {
    id: 'hr.onboarding.activeBlockers',
    module: 'hr', area: 'onboarding',
    title: 'Active Blockers',
    description: 'Open blockers holding cases, by severity and owning module.',
    icon: 'fa-triangle-exclamation',
    category: 'Case Operations',
    tags: ['onboarding', 'blockers', 'risk', 'list'],
    previewVariant: 'risk',
    supportedPages: ONB_PAGES,
    supportedZones: ONB_ZONES,
    defaultSize: 'tall',
    allowedSizes: [
      { key: 'tall', label: 'Tall', grid: { w: 4, h: 4 }, description: 'Narrow list.' },
      { key: 'large', label: 'Large', grid: { w: 6, h: 4 }, description: 'Wide list.' },
    ],
    defaultConfig: {},
    configSchema: [],
    dataSource: { ...ONB_SOURCE, dependencies: [{ key: 'hr_onboarding_blockers', label: 'Onboarding blocker records', required: true }] },
    recommendedFor: ONB_PAGES,
    render: () => {
      const q = useOnboardingBlockersList({ statuses: ['active', 'escalated', 'waiting_on_owner'] });
      const rows = (q.data ?? []).slice(0, 10).map(b => (
        <ListRow key={b.blockerId}
          primary={b.blockerTitle}
          secondary={`${b.caseNo} · ${b.blockingModule} · ${b.ageDays}d`}
          right={b.severity} tone={sevTone(b.severity)} />
      ));
      return <WidgetList loading={q.isLoading && !q.data} rows={rows} empty="No active blockers" />;
    },
    renderPreview: () => (
      <WidgetList loading={false} empty="" rows={[
        <ListRow key="1" primary="Missing right-to-work doc" secondary="ONB-1042 · hr · 4d" right="critical" tone="danger" />,
        <ListRow key="2" primary="Medical clearance pending" secondary="ONB-1039 · hse · 2d" right="medium" tone="warn" />,
      ]} />
    ),
  },
  {
    id: 'hr.onboarding.packagesInUse',
    module: 'hr', area: 'onboarding',
    title: 'Onboarding Packages',
    description: 'Configured onboarding packages with owner roles and task counts.',
    icon: 'fa-box-open',
    category: 'Configuration',
    tags: ['onboarding', 'packages', 'config'],
    previewVariant: 'status-stack',
    supportedPages: ONB_PAGES,
    supportedZones: ONB_ZONES,
    defaultSize: 'standard',
    allowedSizes: [
      { key: 'standard', label: 'Standard', grid: { w: 4, h: 3 }, description: 'Compact list.' },
      { key: 'tall', label: 'Tall', grid: { w: 4, h: 4 }, description: 'Full list.' },
    ],
    defaultConfig: {},
    configSchema: [],
    dataSource: { ...ONB_SOURCE, sourceKey: 'hr_onboarding_packages', label: 'HR Onboarding Packages' },
    recommendedFor: ONB_PAGES,
    render: () => {
      const q = useOnboardingPackages();
      const rows = (q.data ?? []).filter(p => p.status === 'active').slice(0, 10).map(p => (
        <ListRow key={p.key}
          primary={p.label}
          secondary={p.owners || '—'}
          right={`${p.taskCount} tasks`} tone="muted" />
      ));
      return <WidgetList loading={q.isLoading && !q.data} rows={rows} empty="No active packages" />;
    },
    renderPreview: () => (
      <WidgetList loading={false} empty="" rows={[
        <ListRow key="1" primary="Office New Hire" secondary="HR, IT, Finance" right="12 tasks" tone="muted" />,
        <ListRow key="2" primary="Field New Hire" secondary="HR, HSE, Ops" right="16 tasks" tone="muted" />,
      ]} />
    ),
  },
];
