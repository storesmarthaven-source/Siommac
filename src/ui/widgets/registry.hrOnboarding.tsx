// src/ui/widgets/registry.hrOnboarding.tsx
//
// Onboarding Command Centre KPI widgets. Auto-collected by registry.ts's
// `import.meta.glob('./registry.*.tsx')`.
//
// These render through the SHARED `@ui` KpiTile with the same `.hrew-kpi-shell` wrapper
// Employee Master uses, so the strip is visually identical across HR pages. Only the labels,
// values, tones and drill filters differ. There is deliberately no onboarding-only KPI markup
// or stylesheet — the retired `CommandMetricStrip` was exactly that.
//
// SCOPE: each widget reads `props.runtime.onboardingScope` — transient host context threaded
// through WidgetBoard, never persisted config — and passes it to the authenticated dashboard
// query. Every count therefore comes from the same server-resolved scope as the register
// beside it, and an unauthorised scope 403s at the API rather than being filtered client-side.

import type { VNode } from 'preact';
import { KpiTile, type KpiTone } from '../components/KpiTile';
import { WidgetSkeleton } from '../components/Skeleton';
import { LucideIcon } from '../LucideIcon';
import { defineWidget } from './defineWidget';
import { findWidgetDataSource, registerWidgetDataSource } from './dataSources';
import type { WidgetDef, WidgetRenderProps, WidgetSizeDef } from './types';
import { useOnboardingDashboard } from '@api/hr/onboarding';
import type { OnboardingDashboardStats, OnboardingReadScope } from '../../../types/hrOnboarding';
import './hrEmployeeDashboardWidgets.css';

/** Same loading/error chrome Employee Master's KPI strip uses, so the two look identical. */
function WidgetState({ kind, message }: { kind: 'loading' | 'error'; message?: string }): VNode {
  if (kind === 'loading') return <WidgetSkeleton class="hrew-card" variant="card" />;
  return <article class="hrew-card hrew-state" data-widget-content-root role="alert">
    <LucideIcon name="TriangleAlert" size={23} />
    <span>{message ?? 'Onboarding data is unavailable.'}</span>
  </article>;
}

const PAGE = 'hr.onboarding.command-centre';

const SOURCE = {
  sourceKey: 'hr.onboarding.dashboard',
  label: 'Onboarding Dashboard API',
  refreshIntervalMs: 60_000,
  permissions: ['hr.onboarding.view'],
};

if (!findWidgetDataSource(SOURCE.sourceKey)) {
  registerWidgetDataSource({
    key: SOURCE.sourceKey,
    label: SOURCE.label,
    endpoint: '/api/hr/onboarding/dashboard-stats',
    permission: 'hr.onboarding.view',
    scope: 'organization',
    refresh: { mode: 'realtime-invalidation' },
    authenticated: true,
  });
}

// Same FIXED, reorder-only tile as Employee Master's KPI strip (resizable={false}), so the
// size is code-owned rather than user data — but w6, not w4.
//
// Employee Master fills its 24-column strip with SIX w4 tiles. The Command Centre has FOUR
// measures, so each must be w6 to fill the same width. min==max pins the tile, which meant an
// earlier w4 here silently clamped the layout's w6 and left 285px of dead space on the right —
// the "not spaced properly" defect. Height stays h6 (96px) to match Employee Master exactly.
const KPI_SIZES: WidgetSizeDef[] = [
  { key: 'compact', label: 'Fixed', grid: { w: 6, h: 6 }, min: { w: 6, h: 6 }, max: { w: 6, h: 6 }, description: 'Onboarding Command Centre KPI tile' },
];

/**
 * Drill-through: apply the KPI's filter to the Team Work Queue instead of merely scrolling to
 * it, so the number clicked and the rows landed on are the same set. The board renders widgets
 * outside the page's tree, so this is an event rather than a prop.
 */
export const ONBOARDING_QUEUE_FILTER_EVENT = 'siomac:onboarding-queue-filter';

export interface OnboardingQueueFilter {
  dueState?: 'overdue' | 'due_today';
  startsWithinDays?: number;
  unassignedOwner?: boolean;
  label: string;
}

function applyQueueFilter(detail: OnboardingQueueFilter): void {
  window.dispatchEvent(new CustomEvent(ONBOARDING_QUEUE_FILTER_EVENT, { detail }));
  document.querySelector<HTMLElement>('[data-testid="onboarding-work-queue"]')
    ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function KpiCard({ title, value, detail, icon, linkLabel, tone = 'blue', filter }: {
  title: string; value: number | string; detail: string; icon: string; linkLabel: string;
  tone?: KpiTone; filter: OnboardingQueueFilter;
}): VNode {
  return (
    <div class="hrew-kpi-shell" data-widget-content-root>
      <KpiTile icon={icon} tone={tone} label={title} value={value} sub={detail}
        link={{ label: linkLabel, onClick: () => applyQueueFilter(filter) }} />
    </div>
  );
}

// ── The four approved Command Centre measures ────────────────────────────────────
const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

function DueToday({ stats }: { stats: OnboardingDashboardStats }): VNode {
  const d = stats.dueThisWeek;
  return <KpiCard title="Due Today" value={d.dueToday} icon="fa-calendar-day" tone="blue"
    detail={`${plural(d.dueIn7Days, 'action', 'actions')} due within seven days`}
    linkLabel="View Work Due Today" filter={{ dueState: 'due_today', label: 'Due Today' }} />;
}

function OverdueActions({ stats }: { stats: OnboardingDashboardStats }): VNode {
  const d = stats.dueThisWeek;
  return <KpiCard title="Overdue Actions" value={d.overdue} icon="fa-triangle-exclamation"
    tone={d.overdue > 0 ? 'red' : 'green'}
    detail={d.criticalOverdue > 0 ? `${plural(d.criticalOverdue, 'is', 'are')} critical` : 'No critical overdue work'}
    linkLabel="View Overdue Work" filter={{ dueState: 'overdue', label: 'Overdue Actions' }} />;
}

function StartsWithinSevenDays({ stats }: { stats: OnboardingDashboardStats }): VNode {
  return <KpiCard title="Starting Within 7 Days" value={stats.startsWithin7Days} icon="fa-user-clock" tone="purple"
    detail={`${plural(stats.activeCases.total, 'active case', 'active cases')} in total`}
    linkLabel="View Upcoming Starts" filter={{ startsWithinDays: 7, label: 'Starting Within 7 Days' }} />;
}

function OwnerRequired({ stats }: { stats: OnboardingDashboardStats }): VNode {
  const n = stats.ownerRequired;
  return <KpiCard title="Owner Required" value={n} icon="fa-user-slash" tone={n > 0 ? 'amber' : 'green'}
    detail={n > 0 ? 'Cases waiting on an accountable owner' : 'Every active case has an owner'}
    linkLabel="View Unassigned Cases" filter={{ unassignedOwner: true, label: 'Owner Required' }} />;
}

/** Scoped live data. `runtime.onboardingScope` is transient host context, never saved config. */
function withLiveData(View: (props: { stats: OnboardingDashboardStats }) => VNode): (props: WidgetRenderProps) => VNode {
  return function LiveOnboardingKpi(props: WidgetRenderProps): VNode {
    const scope: OnboardingReadScope | undefined = props.runtime?.onboardingScope;
    const query = useOnboardingDashboard(scope ? { scope } : {});
    if (query.isPending) return <WidgetState kind="loading" />;
    if (!query.data) {
      return <WidgetState kind="error"
        message={query.error instanceof Error ? query.error.message : 'Onboarding data is unavailable.'} />;
    }
    return <View stats={query.data} />;
  };
}

function kpiDefinition(input: {
  id: string; title: string; description: string; icon: string;
  render: (props: { stats: OnboardingDashboardStats }) => VNode;
}): WidgetDef {
  return defineWidget({
    id: input.id, module: 'hr', area: 'Onboarding', title: input.title, description: input.description,
    longDescription: `${input.description} Uses the authenticated onboarding dashboard API with the server-resolved read scope.`,
    icon: input.icon, category: 'Key metrics', tags: ['hr', 'onboarding', 'live api'], previewVariant: 'metric',
    chrome: 'none', sizeToContent: false, resizable: false, supportedPages: [PAGE], supportedZones: ['main'],
    defaultSize: 'compact', allowedSizes: KPI_SIZES,
    sizeConstraints: { defaultColumns: 6, defaultRows: 6, minColumns: 6, minRows: 6, minWidth: 180, minHeight: 84, resizeStrategy: 'fixed-minimum' },
    defaultConfig: {}, configSchema: [], dataSource: SOURCE, dataSourceKey: SOURCE.sourceKey,
    governance: { state: 'enabled', discoverable: true, allowedPages: [PAGE], requiredCapabilities: ['hr.onboarding.view'] },
    permissions: { requiredPermissions: ['hr.onboarding.view'] }, runtimeState: 'live-api', recommendedFor: [PAGE],
    motion: { kind: 'count-up', durationMs: 520, reducedMotion: 'static' },
    render: withLiveData(input.render),
    renderPreview: () => <div class="hrew-kpi-shell" data-widget-content-root>
      <KpiTile icon={input.icon} tone="blue" label={input.title} value="—" sub="Live onboarding metric" />
    </div>,
  });
}

export const widgets: WidgetDef[] = [
  kpiDefinition({ id: 'hr.onboarding.dueToday', title: 'Due Today', description: 'Onboarding actions falling due today.', icon: 'fa-calendar-day', render: DueToday }),
  kpiDefinition({ id: 'hr.onboarding.overdueActions', title: 'Overdue Actions', description: 'Onboarding actions past their due date.', icon: 'fa-triangle-exclamation', render: OverdueActions }),
  kpiDefinition({ id: 'hr.onboarding.startsWithin7Days', title: 'Starting Within 7 Days', description: 'Active cases whose planned first day falls in the next seven days.', icon: 'fa-user-clock', render: StartsWithinSevenDays }),
  kpiDefinition({ id: 'hr.onboarding.ownerRequired', title: 'Owner Required', description: 'Active cases with no accountable case owner.', icon: 'fa-user-slash', render: OwnerRequired }),
];
