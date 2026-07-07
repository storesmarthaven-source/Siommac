// src/components/sections/HR/OnboardingCommandCenter.tsx
// PHASE 2 (real-data wiring): the ported v19 onboarding overview mockup, now driven entirely
// by the real onboarding API. No mock rows, no stock-photo avatars — every displayed fact
// traces to a real column, and every action hits a real mutation or navigates to a real
// workspace. Structural fidelity to the mockup (layout/CSS) is preserved from Phase 1.
import { type VNode } from 'preact';
import { useMemo, useState } from 'preact/hooks';
import { useSessionStore, selectUserId } from '@store/session';
import {
  useOnboardingDashboard, useOnboardingCases, useOnboardingTasksList, useOnboardingBlockersList,
  useOnboardingHandoffsList, useOnboardingRecentActivity, useOnboardingCompleteTask,
} from '@api/hr/onboarding';
import { OnboardingAddTaskModal } from './OnboardingAddTaskModal';
import { adaptCase, adaptTask, adaptBlocker, adaptActivity, deriveKpis } from './OnboardingCommandCenter.adapters';
import {
  deriveDeadlines,
  type DashboardMode,
  type OnboardingCommandCenterProps,
  type OnboardingSurface,
  type OnboardingSurfaceFilters,
} from './OnboardingCommandCenter.helpers';
import { Button, Icon } from './onboarding/primitives';
import {
  ActivationCompletionCard, BlockedCasesCard, CasePerformanceCard, CommandCenterHealthBanner,
  CommandMetricStrip, MorningGoalCard, RecentActivityCard, RecentProjectWorkCard,
  TasksPlannerCard, UpcomingDeadlinesCard,
} from './onboarding/cards';

import './OnboardingCommandCenter.css';

export function OnboardingCommandCenter({
  onOpenSurface,
  onOpenCase,
  onNewCase,
  onToast,
}: OnboardingCommandCenterProps = {}): VNode {
  const [query, setQuery] = useState('');
  const [dashboardMode, setDashboardMode] = useState<DashboardMode>('manager');
  const [addTaskOpen, setAddTaskOpen] = useState(false);
  // Design/QA preview only — forces every card into its empty-state variant regardless
  // of real data, so empty states can be reviewed without needing to wipe seed data.
  const [previewEmptyStates, setPreviewEmptyStates] = useState(false);
  const currentUserId = useSessionStore(selectUserId);

  const openSurface = (surface: OnboardingSurface, filters?: OnboardingSurfaceFilters): void => onOpenSurface?.(surface, filters);
  const openCase = (caseId: string): void => onOpenCase?.(caseId);
  const startNewCase = (): void => onNewCase?.();

  const statsQ = useOnboardingDashboard();
  const casesQ = useOnboardingCases({ statuses: ['not_started', 'in_progress', 'blocked'], pageSize: 50, sort: { field: 'due_at', direction: 'asc' } });
  const tasksQ = useOnboardingTasksList({ statuses: ['pending', 'open', 'in_progress', 'blocked'] });
  const blockersQ = useOnboardingBlockersList({ statuses: ['active', 'acknowledged', 'waiting_on_owner', 'escalated'] });
  const failedHandoffsQ = useOnboardingHandoffsList({ statuses: ['failed'] });
  const activityQ = useOnboardingRecentActivity(8);
  const completeTaskMut = useOnboardingCompleteTask();

  const cases = useMemo(() => previewEmptyStates ? [] : (casesQ.data?.rows ?? []).map(adaptCase), [casesQ.data, previewEmptyStates]);
  const allTasks = useMemo(() => previewEmptyStates ? [] : (tasksQ.data ?? []).map(adaptTask), [tasksQ.data, previewEmptyStates]);
  const blockers = useMemo(() => previewEmptyStates ? [] : (blockersQ.data ?? []).map(adaptBlocker), [blockersQ.data, previewEmptyStates]);
  const activity = useMemo(() => previewEmptyStates ? [] : (activityQ.data ?? []).map(adaptActivity), [activityQ.data, previewEmptyStates]);
  const deadlines = useMemo(() => deriveDeadlines(allTasks), [allTasks]);
  const failedHandoffsCount = failedHandoffsQ.data?.length ?? 0;

  const filteredCases = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return cases;
    return cases.filter(row => `${row.employeeName} ${row.caseNo}`.toLowerCase().includes(q));
  }, [cases, query]);

  const commandKpis = useMemo(() => deriveKpis({
    stats: statsQ.data,
    cases: casesQ.data?.rows ?? [],
    openTasks: tasksQ.data ?? [],
    blockers: blockersQ.data ?? [],
    failedHandoffCount: failedHandoffsCount,
    mode: dashboardMode,
    currentUserId,
  }), [statsQ.data, casesQ.data, tasksQ.data, blockersQ.data, failedHandoffsCount, dashboardMode, currentUserId]);

  function handleCompleteTask(taskId: string): void {
    completeTaskMut.mutate({ taskId });
  }

  return (
    <div class="siomac-onboarding-overview-mockup-v2">
      <div class="obx-page obv-shell siomac-onboarding-overview-mockup">
        <main class="obv-overview-page">
        <section class="obv-title-row">
          <div>
            <h1>Onboarding Overview</h1>
            <p>{dashboardMode === 'manager' ? 'Manager command center for readiness, risk, ownership, deadlines, and escalation.' : 'HR staff work queue for assigned cases, due tasks, evidence, and next action.'}</p>
          </div>
          <div class="obx-actions obv-page-actions">
            <div class="obv-role-switch" role="group" aria-label="Dashboard view">
              <button
                class={dashboardMode === 'manager' ? 'is-active' : ''}
                type="button"
                onClick={() => setDashboardMode('manager')}
              >
                HR Manager
              </button>
              <button
                class={dashboardMode === 'staff' ? 'is-active' : ''}
                type="button"
                onClick={() => setDashboardMode('staff')}
              >
                HR Staff
              </button>
            </div>
            <button
              class={`obx-btn ${previewEmptyStates ? 'is-active' : ''}`}
              type="button"
              title="Preview every card's empty state"
              onClick={() => setPreviewEmptyStates(v => !v)}
            >
              Show Empty States
            </button>
            <input
              class="ui-input obv-hidden-filter-input"
              value={query}
              placeholder="Filter recent cases..."
              onInput={event => setQuery((event.target as HTMLInputElement).value)}
            />
            <Button onClick={() => setAddTaskOpen(true)}><Icon name="plus" />Add Task</Button>
            <button class="obx-btn primary obv-primary-button" type="button" onClick={startNewCase}><Icon name="plus" />New Case</button>
          </div>
        </section>

        <CommandCenterHealthBanner
          mode={dashboardMode}
          cases={cases}
          tasks={allTasks}
          blockers={blockers}
          failedHandoffsCount={failedHandoffsCount}
          deadlines={deadlines}
          onOpenRisks={() => openSurface('blocked', { riskView: 'critical' })}
          onOpenWork={() => openSurface('tasks', { viewMode: 'today_work' })}
        />

        <CommandMetricStrip kpis={commandKpis} mode={dashboardMode} />

        <section class="obv-dashboard-grid obv-stack-grid obv-v20-layout">
          <MorningGoalCard mode={dashboardMode} blockers={blockers} cases={cases} onOpenTasks={() => openSurface('tasks', { caseFocus: dashboardMode === 'staff' ? 'my_next_action' : 'activation_goal' })} />
          <UpcomingDeadlinesCard
            deadlines={deadlines}
            onOpenDeadlines={() => openSurface('tasks', { dueState: 'due_this_week' })}
          />
          <div class="obv-center-work-stack">
            {dashboardMode === 'manager' ? (
              <>
                <RecentProjectWorkCard mode={dashboardMode} tasks={allTasks} currentUserId={currentUserId} onOpenTasks={() => openSurface('tasks', { workstream: 'today_onboarding_work' })} />
                <CasePerformanceCard
                  mode={dashboardMode} cases={filteredCases} currentUserId={currentUserId}
                  onOpenCases={() => openSurface('cases', { viewMode: 'risk_ranked' })} onOpenCase={openCase}
                />
              </>
            ) : (
              <>
                <RecentProjectWorkCard mode={dashboardMode} tasks={allTasks} currentUserId={currentUserId} onOpenTasks={() => openSurface('tasks', { workstream: 'my_work_queue' })} />
                <CasePerformanceCard
                  mode={dashboardMode} cases={filteredCases} currentUserId={currentUserId}
                  onOpenCases={() => openSurface('cases', { owner: 'current_hr_user' })} onOpenCase={openCase}
                />
              </>
            )}
            <TasksPlannerCard
              tasks={allTasks}
              onOpenTasks={() => openSurface('tasks', { source: 'priority_case_work' })}
              onCompleteTask={handleCompleteTask}
            />
          </div>
          <div class="obv-right-calendar-stack">
            <ActivationCompletionCard
              kpis={commandKpis}
              cases={cases}
              mode={dashboardMode}
              onOpenReadiness={() => openSurface('tasks', { caseFocus: 'activation_readiness' })}
            />
            <BlockedCasesCard blockers={blockers} onOpenBlocked={(filters) => openSurface('blocked', filters)} />
            <RecentActivityCard activity={activity} onOpenActivity={() => openSurface('activity')} />
          </div>
        </section>
        </main>
      </div>

      <OnboardingAddTaskModal
        open={addTaskOpen}
        caseId={null}
        onClose={() => setAddTaskOpen(false)}
        onToast={message => onToast?.(message)}
      />
    </div>
  );
}
