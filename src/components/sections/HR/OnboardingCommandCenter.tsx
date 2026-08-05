// src/components/sections/HR/OnboardingCommandCenter.tsx
//
// HR ▸ Onboarding ▸ Command Centre — the production operational landing page.
//
// ARCHITECTURE: Employee Master's board implementation with the page-specific parts swapped.
// Two WidgetBoards — a fixed KPI strip and the main board — sharing its `useBoardLayout`
// lifecycle, toolbar, Widget Library, save/cancel/reset/set-default flow, grid settings
// (24 columns, cellHeight 6, gap [12,12]) and `revealOnMount={false}`. Nothing about the board
// is re-invented; only the page keys, default layout, widget set, runtime scope and
// drill-throughs belong to onboarding.
//
// VISUAL: docs/mockups/onboarding-command-centre-core.html, styled by the mechanically-ported
// `OnboardingCommandCenter.mockup.css` under the `.occ-root` scope. LIGHT MODE ONLY — the
// approved mockup is authored light, and onboarding ships no dark override layer.
//
// ROLE vs SCOPE: presentation follows CAPABILITY (`view_team`/`view_all`); data follows the
// SELECTED SCOPE. A manager narrowing to My Work keeps the manager experience and sees only
// their own data.

import { type VNode } from 'preact';
import { useEffect, useMemo, useState } from 'preact/hooks';
import {
  WidgetBoard, WidgetBoardToolbar, WidgetLibraryModal, useBoardLayout, insertWidgetsAtRow,
} from '@ui/widgets';
import type {
  BoardLayout, LocalWidgetMap, PreviewWidgetInstance, WidgetInstance, WidgetSizeDef, WidgetSizeKey,
} from '@ui/widgets';
import { DashboardPageSkeleton } from '@ui';
import { can } from '@lib/permissions';
import {
  useOnboardingDashboard, useOnboardingCases, useOnboardingBlockersList,
  useOnboardingWorkQueue,
} from '@api/hr/onboarding';
import { ONBOARDING_QUEUE_FILTER_EVENT, type OnboardingQueueFilter } from '@ui/widgets/registry.hrOnboarding';
import type { OnboardingCaseRow } from '../../../../types/hrOnboarding';
import { OnboardingAddTaskModal } from './OnboardingAddTaskModal';
import { OnboardingScopeSelector } from './OnboardingScopeSelector';
import { useOnboardingScope } from './useOnboardingScope';
import type { OnboardingCommandCenterProps, OnboardingSurface, OnboardingSurfaceFilters } from './OnboardingCommandCenter.helpers';
import {
  StartReadinessWidget, CaseFocusWidget, BlockedCasesWidget, UpcomingStartsWidget,
  WorkQueueWidget, daysFromToday, type QueueTab,
} from './onboarding/CommandCentreWidgets';

// The mechanically-ported mockup stylesheet, imported ONLY here — together with the TSX that
// emits its DOM — plus the production-only page shell and panel bounding. Both are LIGHT
// mode: onboarding pages follow the approved light mockup and ship no dark layer.
import './OnboardingCommandCenter.mockup.css';
import './OnboardingCommandCenter.page.css';

const PAGE_KEY = 'hr.onboarding.command-centre';
const KPI_PAGE_KEY = 'hr.onboarding.command-centre.kpis';
const BOARD_COLUMNS = 24;

const ACTIVE_STATUSES = ['draft', 'open', 'in_progress', 'blocked', 'paused', 'ready_for_activation'];

function defInst(widgetId: string, x: number, y: number, w: number, h: number, sizeKey: WidgetSizeKey, pageKey = PAGE_KEY): WidgetInstance {
  return { instanceId: `${widgetId}#def`, widgetId, pageKey, zoneId: 'main', x, y, w, h, sizeKey, config: {} };
}

/** Four measures across the strip — the mockup's first band. 6×6 on a 24-column grid. */
export function defaultOnboardingKpiLayout(): BoardLayout {
  return {
    pageKey: KPI_PAGE_KEY, columns: BOARD_COLUMNS,
    zones: {
      main: [
        defInst('hr.onboarding.dueToday', 0, 0, 6, 6, 'compact', KPI_PAGE_KEY),
        defInst('hr.onboarding.overdueActions', 6, 0, 6, 6, 'compact', KPI_PAGE_KEY),
        defInst('hr.onboarding.startsWithin7Days', 12, 0, 6, 6, 'compact', KPI_PAGE_KEY),
        defInst('hr.onboarding.ownerRequired', 18, 0, 6, 6, 'compact', KPI_PAGE_KEY),
      ],
    },
  };
}

/**
 * Mockup composition, in order:
 *   band 1 — Start Readiness · Upcoming Deadlines · Task Planner
 *   band 2 — Case Focus (left rail) with Blocked Cases directly beneath it,
 *            Upcoming Starts to its right, above the full-width Team Work Queue
 */
export function defaultOnboardingLayout(): BoardLayout {
  return {
    pageKey: PAGE_KEY, columns: BOARD_COLUMNS,
    zones: {
      main: [
        // 24 columns exactly on every row. Left rail w8, main column w16.
        //
        //  y  0-15 | Start Readiness 8 | Deadlines 8 | Task Planner 8   = 24
        //  y 15-24 | Case Focus     8 | Deadlines 8 | Task Planner 8   = 24
        //  y 24-42 | Case Focus     8 | Upcoming Starts        16      = 24
        //  y 42-45 | Case Focus     8 | Work Queue             16      = 24
        //  y 45-69 | Blocked Cases  8 | Work Queue             16      = 24
        //
        // Both columns end at y69, so the board has no ragged bottom band. Heights come from
        // the measured content at 1440px (a row is 18px: h*18 - 12).
        defInst('hr.onboarding.startReadiness', 0, 0, 8, 15, 'standard'),           // 258px — compact
        defInst('enterprise.calendar.upcomingDeadlines', 8, 0, 8, 24, 'standard'),  // 420px
        defInst('enterprise.calendar.taskPlanner', 16, 0, 8, 24, 'standard'),       // 420px
        defInst('hr.onboarding.caseFocus', 0, 15, 8, 30, 'standard'),               // 528px
        defInst('hr.onboarding.upcomingStarts', 8, 24, 16, 18, 'wide'),             // 312px
        defInst('hr.onboarding.workQueue', 8, 42, 16, 27, 'hero'),                  // 474px
        defInst('hr.onboarding.blockedCases', 0, 45, 8, 24, 'standard'),            // 420px — list scrolls
      ],
    },
  };
}

export function OnboardingCommandCenter({
  onOpenSurface, onOpenCase, onNewCase, onToast,
}: OnboardingCommandCenterProps = {}): VNode {
  const [addTaskOpen, setAddTaskOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [libOpen, setLibOpen] = useState(false);
  const [preview, setPreview] = useState<PreviewWidgetInstance | null>(null);
  const [queueFilter, setQueueFilter] = useState<OnboardingQueueFilter | null>(null);
  const [queueTab, setQueueTab] = useState<QueueTab>('overdue');
  const [focusIndex, setFocusIndex] = useState(0);

  const scopeState = useOnboardingScope();
  const { scope } = scopeState;

  // Presentation is a PERMISSION fact, never the selected scope.
  const isManager = can('hr.onboarding.view_team') || can('hr.onboarding.view_all');
  const canView = can('hr.onboarding.view');
  const isAdmin = can('hr.onboarding.packages.manage');

  const openSurface = (surface: OnboardingSurface, filters?: OnboardingSurfaceFilters): void => onOpenSurface?.(surface, filters);
  const openCase = (caseId: string): void => onOpenCase?.(caseId);

  // ── scoped datasets — every query carries the scope, so their keys change together ──
  const statsQ = useOnboardingDashboard({ scope });
  const casesQ = useOnboardingCases({
    scope, statuses: ACTIVE_STATUSES, page: 1, pageSize: 100,
    sort: { field: 'due_at', direction: 'asc' },
  });
  const startsQ = useOnboardingCases({
    scope, statuses: ACTIVE_STATUSES, page: 1, pageSize: 25, startsWithinDays: 7,
    sort: { field: 'target_start_date', direction: 'asc' },
  });
  const blockersQ = useOnboardingBlockersList({ scope, statuses: ['active', 'acknowledged', 'waiting_on_owner', 'escalated'] });
  // The summary queue and the full Work Queue now share the same server-authoritative
  // four-source read model. Three small count queries keep the tab totals exact instead of
  // counting whichever cases happened to fit in a client-side page.
  const overdueWorkQ = useOnboardingWorkQueue({ scope, dueState: 'overdue', page: 1, pageSize: 25, unassigned: !!queueFilter?.unassignedOwner });
  const todayWorkQ = useOnboardingWorkQueue({ scope, dueState: 'due_today', page: 1, pageSize: 25, unassigned: !!queueFilter?.unassignedOwner });
  const upcomingWorkQ = useOnboardingWorkQueue({ scope, dueState: 'due_this_week', page: 1, pageSize: 25, unassigned: !!queueFilter?.unassignedOwner });

  const cases = useMemo(() => casesQ.data?.rows ?? [], [casesQ.data]);
  const starts = useMemo(() => startsQ.data?.rows ?? [], [startsQ.data]);
  const blockers = useMemo(() => blockersQ.data ?? [], [blockersQ.data]);

  /** Case Focus shows cases that actually need attention, worst first. */
  const focusCases = useMemo(() => {
    const withIssues = cases.filter(c => c.activeBlockers > 0 || c.status === 'blocked');
    return (withIssues.length ? withIssues : cases).slice(0, 12);
  }, [cases]);

  const queueCounts: Record<QueueTab, number> = {
    overdue: overdueWorkQ.data?.total ?? 0,
    today: todayWorkQ.data?.total ?? 0,
    upcoming: upcomingWorkQ.data?.total ?? 0,
  };
  const queueRows = queueTab === 'overdue' ? overdueWorkQ.data?.rows ?? []
    : queueTab === 'today' ? todayWorkQ.data?.rows ?? []
      : upcomingWorkQ.data?.rows ?? [];

  // KPI drill-through: a KPI selects the queue tab / filter so the number clicked and the
  // rows landed on are the same scoped set.
  useEffect(() => {
    const onFilter = (e: Event): void => {
      const detail = (e as CustomEvent<OnboardingQueueFilter>).detail;
      if (detail.dueState === 'overdue') { setQueueTab('overdue'); setQueueFilter(null); return; }
      if (detail.dueState === 'due_today') { setQueueTab('today'); setQueueFilter(null); return; }
      if (detail.startsWithinDays) { setQueueFilter(null); return; }   // Upcoming Starts scrolls
      setQueueFilter(detail);
    };
    window.addEventListener(ONBOARDING_QUEUE_FILTER_EVENT, onFilter);
    return () => window.removeEventListener(ONBOARDING_QUEUE_FILTER_EVENT, onFilter);
  }, []);

  // ── board lifecycle (Employee Master's) ────────────────────────────────────────
  const {
    layout, updateZoneLayout, saveLayout, cancelLayout, setAsDefault, resetLayout,
    isDefaultDirty, isDirty, isSaving,
  } = useBoardLayout(PAGE_KEY, defaultOnboardingLayout(), BOARD_COLUMNS);
  const kpiBoard = useBoardLayout(KPI_PAGE_KEY, defaultOnboardingKpiLayout(), BOARD_COLUMNS);
  const boardItems = layout.zones.main ?? [];
  const pageDefaultDirty = isDefaultDirty || kpiBoard.isDefaultDirty;
  const pageDirty = isDirty || kpiBoard.isDirty;
  const pageSaving = isSaving || kpiBoard.isSaving;
  const placedWidgetIds = useMemo(
    () => [...boardItems, ...(kpiBoard.layout.zones.main ?? [])].map(i => i.widgetId),
    [boardItems, kpiBoard.layout],
  );

  const savePageLayout = async (): Promise<boolean> => {
    const a = await saveLayout(); const b = await kpiBoard.saveLayout(); return a && b;
  };
  const cancelPageLayout = async (): Promise<void> => { await cancelLayout(); await kpiBoard.cancelLayout(); };
  const resetPageLayout = (): void => { void resetLayout(); void kpiBoard.resetLayout(); };
  const setPageAsDefault = async (): Promise<void> => { await setAsDefault(); await kpiBoard.setAsDefault(); };

  // ── scope transition — no stale-scope flash ────────────────────────────────────
  const scopedQueries = [statsQ, casesQ, startsQ, blockersQ, overdueWorkQ, todayWorkQ, upcomingWorkQ];
  const shellPending = scopedQueries.some(q => q.isPending);
  useEffect(() => {
    if (scopeState.changing && !shellPending) scopeState.settled();
  }, [scopeState, shellPending]);

  // ── page-local widgets ─────────────────────────────────────────────────────────
  const size = (key: WidgetSizeKey, w: number, h: number): WidgetSizeDef[] =>
    [{ key, label: 'Default', grid: { w, h }, min: { w: Math.max(6, Math.round(w / 2)), h: Math.max(12, Math.round(h / 2)) } }];

  const localWidgets: LocalWidgetMap = {
    'hr.onboarding.startReadiness': {
      title: 'Start Readiness', chrome: 'none', allowedSizes: size('standard', 8, 15),
      render: () => <StartReadinessWidget stats={statsQ.data}
        onViewStarts={() => openSurface('cases', { startsWithinDays: 7 })} />,
    },
    'hr.onboarding.caseFocus': {
      title: 'Case Focus', chrome: 'none', allowedSizes: size('standard', 8, 30),
      render: () => <CaseFocusWidget
        cases={focusCases} blockers={blockers} index={focusIndex}
        onCycle={d => setFocusIndex(i => {
          const n = focusCases.length || 1;
          return ((i + d) % n + n) % n;
        })}
        onOpenCase={openCase}
        onNotifyOwner={b => openSurface('blocked', { blockerId: b.blockerId })} />,
    },
    'hr.onboarding.blockedCases': {
      title: 'Blocked Cases', chrome: 'none', allowedSizes: size('standard', 8, 24),
      render: () => <BlockedCasesWidget blockers={blockers} onOpenCase={openCase}
        onViewAll={() => openSurface('blocked')} />,
    },
    'hr.onboarding.upcomingStarts': {
      title: 'Upcoming Starts', chrome: 'none', allowedSizes: size('wide', 16, 18),
      render: () => <UpcomingStartsWidget rows={starts} loading={startsQ.isPending}
        onOpenCase={openCase} onViewAll={() => openSurface('cases', { startsWithinDays: 7 })} />,
    },
    'hr.onboarding.workQueue': {
      title: isManager ? 'Team Work Queue' : 'My Work Queue', chrome: 'none', allowedSizes: size('hero', 16, 27),
      render: () => <WorkQueueWidget rows={queueRows} isManager={isManager} tab={queueTab}
        onTab={setQueueTab} counts={queueCounts}
        activeFilterLabel={queueFilter?.label ?? null}
        onClearFilter={() => setQueueFilter(null)} onOpenCase={openCase}
        onOpenQueue={() => openSurface('tasks')} />,
    },
  };

  // Employee Master's cold-state approach: gate on the page's own data queries. `layout` is
  // never null (the hook falls back to the default), so it cannot be part of this condition.
  if (shellPending) {
    return <DashboardPageSkeleton title="Loading Onboarding Command Centre" kpiCount={4} widgetCount={7} includeTable />;
  }

  const runtime = { onboardingScope: scope };

  return (
    <div class="occ-root obx-page">
      <section class="occ-title-row">
        <div>
          <h1>Onboarding Command Centre</h1>
          <p>{isManager
            ? 'Today’s onboarding work, upcoming starts, deadlines and blocked cases across your teams.'
            : 'Today’s onboarding work, upcoming starts, deadlines and blocked cases assigned to you.'}</p>
        </div>
        <div class="occ-page-actions">
          <button class="btn" type="button" onClick={() => openSurface('tasks')}>
            Work Queue
          </button>
          {can('hr.onboarding.reports.view') && (
            <button class="btn" type="button" onClick={() => openSurface('reports')}>
              Insights
            </button>
          )}
          {isAdmin && (
            <button class="btn" type="button" onClick={() => openSurface('packages')}>
              Packages
            </button>
          )}
          <OnboardingScopeSelector
            scope={scopeState.scope} options={scopeState.options} visible={scopeState.visible}
            busy={scopeState.changing} onSelect={scopeState.select} />
          {canView && <WidgetBoardToolbar
            editing={editing} canSetDefault={isAdmin} defaultDirty={pageDefaultDirty} finishInBanner
            layoutItems={boardItems}
            onToggleEdit={() => setEditing(e => !e)}
            onOpenLibrary={() => { setEditing(true); setLibOpen(true); }}
            onSaveEditing={async () => { if (await savePageLayout()) setEditing(false); }}
            onCancelEditing={async () => { await cancelPageLayout(); setEditing(false); }}
            onReset={resetPageLayout}
            onSetDefault={() => void setPageAsDefault()}
          />}
          {can('hr.onboarding.case.manage') && (
            <button class="btn" type="button" onClick={() => setAddTaskOpen(true)}>Add Task</button>
          )}
          {can('hr.onboarding.start') && (
            <button class="btn primary" type="button" onClick={() => onNewCase?.()}>Start Onboarding</button>
          )}
        </div>
      </section>

      {/* Keyed by scope: a scope change discards the previous tree entirely, so no cached
          All-scope rows, counts or widget data can paint while My is resolving. */}
      <div key={`board-${scope}`}>
        {scopeState.changing
          ? <DashboardPageSkeleton title="Loading" kpiCount={4} widgetCount={7} includeTable />
          : (
            <>
              <div class="occ-kpi-board">
                <WidgetBoard pageKey={KPI_PAGE_KEY} zones={['main']} editing={editing && canView}
                  defaultLayout={defaultOnboardingKpiLayout()} column={BOARD_COLUMNS}
                  cellHeight={6} gap={[12, 12]} resizable={false} maxRows={6} isBounded
                  revealOnMount={false} runtime={runtime} />
              </div>

              <WidgetBoard pageKey={PAGE_KEY} zones={['main']} editing={editing && canView}
                localWidgets={localWidgets} defaultLayout={defaultOnboardingLayout()}
                column={BOARD_COLUMNS} cellHeight={6} gap={[12, 12]} revealOnMount={false}
                runtime={runtime}
                preview={preview} onPreviewChange={setPreview}
                onFinishEditing={() => setEditing(false)}
                onSaveEditing={async () => { if (await savePageLayout()) setEditing(false); }}
                onCancelEditing={async () => { await cancelPageLayout(); setEditing(false); }}
                onOpenLibrary={() => setLibOpen(true)}
                onSetDefault={() => void setPageAsDefault()} canSetDefault={isAdmin}
                defaultDirty={pageDefaultDirty} isDirty={pageDirty} saving={pageSaving}
              />
            </>
          )}
      </div>

      <WidgetLibraryModal open={libOpen} pageKey={PAGE_KEY} zoneId="main"
        placedWidgetIds={placedWidgetIds} userPermissions={[]}
        canManagePackages={isAdmin}
        onClose={() => setLibOpen(false)}
        onAddWidget={inst => updateZoneLayout('main', insertWidgetsAtRow(boardItems, [inst], 0))}
        onAddWidgets={instances => updateZoneLayout('main', insertWidgetsAtRow(boardItems, instances, 0))}
        onPreviewOnBoard={p => setPreview(p)}
      />

      <OnboardingAddTaskModal open={addTaskOpen} caseId={null}
        onClose={() => setAddTaskOpen(false)} onToast={m => onToast?.(m)} />
    </div>
  );
}
