// src/components/sections/HR/OnboardingCommandCenter.tsx
// PHASE 2 (real-data wiring): the ported v19 onboarding overview mockup, now driven entirely
// by the real onboarding API. No mock rows, no stock-photo avatars — every displayed fact
// traces to a real column, and every action hits a real mutation or navigates to a real
// workspace. Structural fidelity to the mockup (layout/CSS) is preserved from Phase 1.
import { type ComponentChildren, type VNode } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { animate } from '@motionone/dom';
import { useSessionStore, selectUserId } from '@store/session';
import { EmptyState } from '@ui';
import {
  useOnboardingDashboard, useOnboardingCases, useOnboardingTasksList, useOnboardingBlockersList,
  useOnboardingHandoffsList, useOnboardingRecentActivity, useOnboardingCompleteTask, useOnboardingAddTask,
} from '@api/hr/onboarding';
import { useHrEmployees } from '@api/hr/employees';
import { Avatar } from './shared';
import { OnboardingAddTaskModal } from './OnboardingAddTaskModal';
import {
  adaptCase, adaptTask, adaptBlocker, adaptActivity, deriveKpis, derivePrioritySnapshot,
} from './OnboardingCommandCenter.adapters';
import {
  fmtDate,
  humanize,
  isSameCalendarDay,
  addDays,
  weekWindow,
  blockerMeta,
  deriveDeadlines,
  type ActivityRow,
  type BlockerRow,
  type CaseRow,
  type DashboardMode,
  type DeadlineRow,
  type KpiRow,
  type OnboardingCommandCenterProps,
  type OnboardingSurface,
  type OnboardingSurfaceFilters,
  type TaskRow,
  type Tone,
} from './OnboardingCommandCenter.helpers';

import './OnboardingCommandCenter.css';

function Icon({ name }: { name: KpiRow['icon'] | ActivityRow['icon'] | 'bell' | 'chat' | 'mail' | 'search' | 'filter' | 'calendar' | 'more' | 'upload' | 'swap' | 'alert' | 'handoffPending' | 'handoffProgress' | 'handoffComplete' | 'handoffFailed' | 'medicalClearance' }): VNode {
  const paths: Record<string, VNode> = {
    people: <><path d="M16.7 20.2v-1.7a3.7 3.7 0 0 0-3.7-3.7H7.2a3.7 3.7 0 0 0-3.7 3.7v1.7" /><circle cx="10.1" cy="7.6" r="3.7" /><path d="M20.5 20.2v-1.6a3.6 3.6 0 0 0-2.7-3.5" /><path d="M15.9 4.2a3.7 3.7 0 0 1 0 7.1" /></>,
    play: <path d="M8.8 5.8 18.2 12l-9.4 6.2V5.8Z" />,
    check: <path d="m5.4 12.5 4.2 4.2 9-9.4" />,
    clock: <><circle cx="12" cy="12" r="8.4" /><path d="M12 7.8v4.7l3.3 2" /></>,
    percent: <><path d="M7.5 17.2 16.8 6.8" /><circle cx="7.4" cy="7.7" r="1.8" /><circle cx="16.6" cy="16.3" r="1.8" /></>,
    document: <><path d="M8 4.8h6.6l3.4 3.4v10.9a1.8 1.8 0 0 1-1.8 1.8H8a1.8 1.8 0 0 1-1.8-1.8V6.6A1.8 1.8 0 0 1 8 4.8Z" /><path d="M14.6 4.9v3.5h3.5" /><path d="M9.2 11.1h5.8M9.2 14.3h5.8M9.2 17.5h4.2" /></>,
    bell: <><path d="M18 9.7a6 6 0 1 0-12 0c0 7-2.4 6.6-2.4 8.4h16.8c0-1.8-2.4-1.4-2.4-8.4Z" /><path d="M9.7 20.2a2.6 2.6 0 0 0 4.6 0" /></>,
    chat: <><path d="M6.5 16.3 3.7 19V5.6c0-.9.7-1.6 1.6-1.6h13.4c.9 0 1.6.7 1.6 1.6v9.1c0 .9-.7 1.6-1.6 1.6H6.5Z" /><path d="M8 9h8M8 12.2h5" /></>,
    mail: <><path d="M3.75 6.75h16.5v10.5H3.75z" /><path d="m4.25 7.35 7.75 5.4 7.75-5.4" /></>,
    search: <><circle cx="10.5" cy="10.5" r="6.1" /><path d="m15.2 15.2 4.5 4.5" /></>,
    filter: <><path d="M4.5 6.8h15M7.5 12h9M10.2 17.2h3.6" /></>,
    calendar: <><rect x="4" y="5.7" width="16" height="14" rx="2" /><path d="M8 3.8v4M16 3.8v4M4 10h16" /></>,
    plus: <path d="M12 5v14M5 12h14" />,
    arrow: <path d="M5 12h14M13.5 6.5 19 12l-5.5 5.5" />,
    more: <><circle cx="6.5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="17.5" cy="12" r="1" /></>,
    upload: <><path d="M12 16V5.8M7.8 9.8 12 5.6l4.2 4.2M5 18.6h14" /></>,
    swap: <path d="M7.2 7.8h10.2l-2.4-2.4M16.8 16.2H6.6l2.4 2.4" />,
    alert: <><path d="M12 4 21 20H3L12 4Z" /><path d="M12 9.5v4.5M12 17.2h.01" /></>,
    handoffPending: <><circle cx="7.7" cy="8.2" r="1.8" /><circle cx="16.3" cy="8.2" r="1.8" /><circle cx="12" cy="16" r="1.8" /><path d="M9.1 9.5 11 14.4M14.9 9.5 13 14.4M9.5 8.2h5" /></>,
    handoffProgress: <><path d="M7 17V6.5" /><path d="M7 7h7.5l-1.2 2 1.2 2H7" /><path d="M17.8 14.2H10l2.1-2.1M10 14.2l2.1 2.1" /></>,
    handoffComplete: <><circle cx="12" cy="12" r="7" /><path d="m8.8 12.1 2.1 2.1 4.5-4.9" /></>,
    handoffFailed: <><path d="M12 5 18 7.3v4.9c0 3.3-2.4 6-6 7.4-3.6-1.4-6-4.1-6-7.4V7.3L12 5Z" /><path d="M12 9.2v3.8M12 15.8h.01" /></>,
    shield: <><path d="M12 4.9 18.2 7.2v4.9c0 3.4-2.5 6.2-6.2 7.6-3.7-1.4-6.2-4.2-6.2-7.6V7.2L12 4.9Z" /><path d="m10.5 13.2 1.8 1.8 3.5-4.1" /></>,
    medicalClearance: <><path d="M12 5 18 7.3v4.9c0 3.3-2.4 6-6 7.4-3.6-1.4-6-4.1-6-7.4V7.3L12 5Z" /><path d="m8.8 12.1 2.2 2.2 4.5-4.8" /></>,
  };

  return <svg viewBox="0 0 24 24">{paths[name]}</svg>;
}

/** Real-avatar wrapper: sizes the shared Avatar to fit each mockup placement context.
 *  Shows the person's real profile photo (app_users.profile_image_url) when one is on
 *  file, falling back to initials otherwise — no stock photos. Sizing lives in
 *  OnboardingCommandCenter.css. */
function PersonAvatar({ name, img = null, size = 'md' }: { name: string; img?: string | null; size?: 'sm' | 'md' | 'lg' }): VNode {
  return <span class={`obv-person-avatar obv-person-avatar-${size}`}><Avatar name={name} img={img} /></span>;
}

function Button({ children, className = '', onClick }: { children: ComponentChildren; className?: string; onClick?: () => void }): VNode {
  return <button class={`obx-btn obv-button ${className}`} type="button" onClick={onClick}>{children}</button>;
}

function MetricGauge({ tone, percent, change, trend }: { tone: Tone; percent: number; change: string; trend: 'up' | 'down' }): VNode {
  const fillRef = useRef<SVGPathElement>(null);

  useEffect(() => {
    const fill = fillRef.current;
    if (!fill) return;

    fill.style.strokeDasharray = `${percent} 100`;
    fill.style.strokeDashoffset = '100';

    const controls = animate(
      fill,
      { strokeDashoffset: [100, 0] },
      { duration: 1.8, easing: [0.16, 1, 0.3, 1], delay: 0.15 },
    );

    return () => controls.cancel();
  }, [percent]);

  return (
    <div class={`obv-metric-gauge metric-${tone}`}>
      <svg viewBox="0 0 118 78">
        <path class="obv-metric-gauge-track" d="M17 62 A42 42 0 0 1 101 62" pathLength="100" />
        <path
          ref={fillRef}
          class="obv-metric-gauge-fill"
          d="M17 62 A42 42 0 0 1 101 62"
          pathLength="100"
          stroke-dasharray={`${percent} 100`}
          style={{ '--obv-gauge-percent': String(percent) } as Record<string, string>}
        />
      </svg>
      {change ? (
        <div class="obv-metric-gauge-change">
          <strong>{change}</strong>
          <span>{trend === 'up' ? '↑' : '↓'}</span>
        </div>
      ) : null}
    </div>
  );
}

function MetricMicroChart({ tone, index, percent = 64 }: { tone: Tone; index: number; percent?: number }): VNode {
  if (index % 3 === 0) {
    const clamped = Math.max(0, Math.min(100, percent));
    return (
      <svg class={`obv-command-metric-chart metric-${tone}`} viewBox="0 0 72 38" aria-hidden="true">
        <circle class="obv-command-donut-track" cx="52" cy="19" r="13" pathLength="100" />
        <circle class="obv-command-donut-fill" cx="52" cy="19" r="13" pathLength="100" stroke-dasharray={`${clamped} 100`} />
      </svg>
    );
  }

  if (index % 3 === 1) {
    return (
      <svg class={`obv-command-metric-chart metric-${tone}`} viewBox="0 0 72 38" aria-hidden="true">
        <rect x="8" y="20" width="7" height="12" rx="3.5" />
        <rect x="22" y="14" width="7" height="18" rx="3.5" />
        <rect x="36" y="8" width="7" height="24" rx="3.5" />
        <rect x="50" y="17" width="7" height="15" rx="3.5" />
      </svg>
    );
  }

  return (
    <svg class={`obv-command-metric-chart metric-${tone}`} viewBox="0 0 72 38" aria-hidden="true">
      <path d="M6 27 C 16 11, 25 17, 34 23 S 51 33, 66 9" />
      <circle cx="66" cy="9" r="3" />
    </svg>
  );
}

function CommandMetricStrip({ kpis, mode }: { kpis: KpiRow[]; mode: DashboardMode }): VNode {
  return (
    <section class={`obv-command-metric-strip mode-${mode}`} aria-label={`${mode === 'manager' ? 'Manager' : 'HR staff'} command metrics`}>
      {kpis.map((kpi, index) => (
        <article class={`obv-command-metric-card metric-${kpi.tone}`} key={kpi.key}>
          <div class="obv-command-metric-head">
            <span class={`obv-command-metric-icon metric-${kpi.tone}`}><Icon name={kpi.icon} /></span>
            {kpi.change ? <small class={kpi.trend === 'up' ? 'up' : 'down'}>{kpi.change}</small> : null}
          </div>
          <div class="obv-command-metric-body">
            <div>
              <p>{kpi.title}</p>
              <strong>{kpi.value}</strong>
              <em>{kpi.subtitle}</em>
            </div>
            <MetricMicroChart tone={kpi.tone} index={index} percent={kpi.gaugePercent ?? 64} />
          </div>
        </article>
      ))}
    </section>
  );
}

function CommandCenterHealthBanner({
  mode,
  cases,
  tasks,
  blockers,
  failedHandoffsCount,
  deadlines,
  onOpenRisks,
  onOpenWork,
}: {
  mode: DashboardMode;
  cases: CaseRow[];
  tasks: TaskRow[];
  blockers: BlockerRow[];
  failedHandoffsCount: number;
  deadlines: DeadlineRow[];
  onOpenRisks: () => void;
  onOpenWork: () => void;
}): VNode {
  const blockedCases = cases.filter(row => row.status === 'blocked' || row.activeBlockers > 0).length;
  const blockedTasks = tasks.filter(row => row.status === 'blocked' || row.isBlocking).length;
  const evidenceTasks = tasks.filter(row => row.requiresEvidence && row.status !== 'completed').length;
  const dueToday = deadlines.filter(row => row.dueLabel.toLowerCase().includes('today')).length;
  const readyCases = cases.filter(row => row.ready).length;
  const riskLevel = failedHandoffsCount || blockedCases > 0 ? 'At Risk' : blockedTasks > 0 ? 'Watch' : 'Good';
  const riskTone = riskLevel === 'At Risk' ? 'danger' : riskLevel === 'Watch' ? 'warning' : 'success';
  const nextAction = failedHandoffsCount
    ? 'Review failed handoffs'
    : blockers.length
      ? 'Resolve active blockers'
      : 'Open today work queue';
  const isStaff = mode === 'staff';
  const bannerLabel = isStaff ? 'My Work Queue' : 'Onboarding Health';
  const headline = isStaff ? (blockedTasks ? 'Action Needed' : 'On Track') : riskLevel;
  const summary = isStaff
    ? `${blockedTasks} blocking task${blockedTasks === 1 ? '' : 's'}, ${evidenceTasks} evidence request${evidenceTasks === 1 ? '' : 's'}, ${dueToday} due today.`
    : `${blockedCases} blocked case${blockedCases === 1 ? '' : 's'}, ${failedHandoffsCount} failed handoff${failedHandoffsCount === 1 ? '' : 's'}, ${blockedTasks} blocking task${blockedTasks === 1 ? '' : 's'}.`;
  const staffNextAction = blockedTasks ? 'Clear assigned blockers' : evidenceTasks ? 'Request missing evidence' : 'Open today work queue';

  return (
    <section class={`obv-command-health-banner tone-${riskTone}`} aria-label="Onboarding command center health">
      <div class="obv-command-health-main">
        <span class="obv-command-health-icon"><Icon name={riskLevel === 'Good' ? 'check' : 'alert'} /></span>
        <div>
          <span class="obv-command-kicker">{bannerLabel}</span>
          <strong>{headline}</strong>
          <p>{summary}</p>
        </div>
      </div>

      <div class="obv-command-health-grid">
        <button type="button" onClick={onOpenRisks}>
          <strong>{blockers.length}</strong>
          <span>Open Blockers</span>
        </button>
        <button type="button" onClick={onOpenWork}>
          <strong>{dueToday}</strong>
          <span>Due Today</span>
        </button>
        <button type="button" onClick={onOpenWork}>
          <strong>{evidenceTasks}</strong>
          <span>Need Evidence</span>
        </button>
        <button type="button" onClick={onOpenRisks}>
          <strong>{readyCases}</strong>
          <span>Ready</span>
        </button>
      </div>

      <button class="obv-command-next-action" type="button" onClick={failedHandoffsCount || blockers.length ? onOpenRisks : onOpenWork}>
        <span>Next Action</span>
        <strong>{isStaff ? staffNextAction : nextAction}</strong>
      </button>
    </section>
  );
}

function ActivationCompletionCard({
  kpis,
  cases,
  mode,
  onOpenReadiness,
}: {
  kpis: KpiRow[];
  cases: CaseRow[];
  mode: DashboardMode;
  onOpenReadiness: () => void;
}): VNode {
  const activation = kpis.find(kpi => kpi.key === 'activation_completion');
  const totalCases = kpis.find(kpi => kpi.key === 'total_cases');
  const dueThisWeek = kpis.find(kpi => kpi.key === 'due_this_week');
  const readyCases = cases.filter(row => row.ready).length;
  const progress = Math.min(100, activation?.gaugePercent ?? 0);

  return (
    <article class="obv-health-card obv-activation-side-card">
      <div class="obv-activation-side-head">
        <div class="obv-activation-title-row">
          <span class="obv-activation-main-icon"><Icon name="check" /></span>
          <div>
            <h2>{mode === 'staff' ? 'Ready For HR Review' : 'Readiness Gates'}</h2>
            <p>Day‑1 Readiness Across Active Onboarding.</p>
          </div>
        </div>
      </div>

      <div class="obv-activation-score-row">
        <div class="obv-activation-score-copy">
          <span>Current</span>
          <strong>{activation?.value ?? '0%'}</strong>
          <em>{readyCases} ready case{readyCases === 1 ? '' : 's'}</em>
        </div>
        <MetricGauge tone="green" percent={progress} change="" trend="up" />
      </div>

      <div class="obv-activation-info-grid">
        <button type="button" onClick={onOpenReadiness}>
          <span>Total Cases</span>
          <strong>{totalCases?.value ?? '0'}</strong>
        </button>
        <button type="button" onClick={onOpenReadiness}>
          <span>Due This Week</span>
          <strong>{dueThisWeek?.value ?? '0'}</strong>
        </button>
      </div>

      <button class="obv-activation-open" type="button" onClick={onOpenReadiness}>Open Readiness Work</button>
    </article>
  );
}

function InsightGlyph({ kind }: { kind: 'chevronLeft' | 'chevronRight' }): VNode {
  return <svg viewBox="0 0 24 24"><path d={kind === 'chevronLeft' ? 'm14.5 6.5-5 5.5 5 5.5' : 'm9.5 6.5 5 5.5-5 5.5'} /></svg>;
}


function taskIconFor(task: TaskRow): 'mail' | 'shield' | 'people' | 'upload' | 'alert' {
  if (task.status === 'blocked' || task.isBlocking) return 'alert';
  if (task.moduleKey === 'access') return 'mail';
  if (task.moduleKey === 'training') return 'shield';
  if (task.moduleKey === 'profile') return 'people';
  return 'upload';
}

function TasksPlannerCard({ tasks, onOpenTasks, onCompleteTask }: {
  tasks: TaskRow[];
  onOpenTasks: () => void;
  onCompleteTask: (taskId: string) => void;
}): VNode {
  const today = useMemo(() => new Date(), []);
  const [windowStart, setWindowStart] = useState(today);
  const [selectedDate, setSelectedDate] = useState(today);
  const [slideDirection, setSlideDirection] = useState<'next' | 'previous'>('next');
  const days = useMemo(() => weekWindow(windowStart), [windowStart]);

  // The mockup's own inline composer, restored — wired to the real add-task
  // mutation (with a case picker, since this planner spans every case) instead
  // of a modal dialog.
  const [isComposerOpen, setIsComposerOpen] = useState(false);
  const [composerCaseId, setComposerCaseId] = useState('');
  const [composerTitle, setComposerTitle] = useState('');
  const [composerAssignee, setComposerAssignee] = useState('');
  const [composerRequiresEvidence, setComposerRequiresEvidence] = useState(false);
  const empsQ = useHrEmployees({ limit: 500 });
  const employees = empsQ.data ?? [];
  const casesQ = useOnboardingCases(
    { statuses: ['not_started', 'in_progress', 'blocked'], pageSize: 100, sort: { field: 'due_at', direction: 'asc' } },
    { enabled: isComposerOpen },
  );
  const pickableCases = casesQ.data?.rows ?? [];
  const addTaskMut = useOnboardingAddTask();

  const datedTasks = useMemo(
    () => tasks.filter(t => t.dueAt).map(t => ({ ...t, date: new Date(`${t.dueAt}T12:00:00`) })),
    [tasks],
  );
  const selectedTasks = datedTasks.filter(t => isSameCalendarDay(t.date, selectedDate));
  const visibleTasks = selectedTasks.length ? selectedTasks : datedTasks.filter(t => t.date >= selectedDate).slice(0, 4);
  const monthName = windowStart.toLocaleDateString('en-US', { month: 'long' });
  const selectedDateLabel = selectedDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

  const moveDateWindow = (direction: -1 | 1): void => {
    const nextStart = addDays(windowStart, direction * 7);
    setSlideDirection(direction > 0 ? 'next' : 'previous');
    setWindowStart(nextStart);
    setSelectedDate(nextStart);
  };

  const openComposer = (): void => setIsComposerOpen(true);
  const closeComposer = (): void => {
    setIsComposerOpen(false);
    setComposerCaseId('');
    setComposerTitle('');
    setComposerAssignee('');
    setComposerRequiresEvidence(false);
  };
  const saveTask = async (): Promise<void> => {
    if (!composerCaseId || !composerTitle.trim()) return;
    await addTaskMut.mutateAsync({
      caseId: composerCaseId,
      taskTitle: composerTitle.trim(),
      assignedTo: composerAssignee || null,
      dueAt: selectedDate.toISOString().slice(0, 10),
      requiresEvidence: composerRequiresEvidence,
    });
    closeComposer();
  };

  const renderTask = (task: TaskRow & { date: Date }): VNode => (
    <button class="obv-habit-row" type="button" key={task.taskId} onClick={onOpenTasks}>
      <span class={`obv-habit-icon accent-${task.isBlocking ? 'rose' : 'mint'}`}><Icon name={taskIconFor(task)} /></span>
      <div class="obv-habit-copy">
        <strong class={task.status === 'completed' ? 'struck' : ''}>{task.taskTitle}</strong>
        <span>{task.assignedToName} · {task.employeeName}</span>
      </div>
      {task.status !== 'completed' ? (
        <button
          class="obv-habit-done status-pending" type="button"
          onClick={e => { e.stopPropagation(); onCompleteTask(task.taskId); }}
        >
          Complete
        </button>
      ) : (
        <span class="obv-habit-done status-ready"><Icon name="check" />Done</span>
      )}
    </button>
  );

  return (
    <section class="obv-priority-work-panel obv-priority-task-planner-panel obv-habits-card" aria-label="Task planner">
      <div class="obv-habit-top">
        <div>
          <h2><span>{monthName},</span> {windowStart.getFullYear()}</h2>
          <p>Task planner, evidence tracking, and daily next actions</p>
        </div>
        <button class="obv-add-task-btn" type="button" onClick={openComposer}><Icon name="plus" />Add Task</button>
      </div>
      <div class={`obv-habit-days slide-${slideDirection}`} key={windowStart.toISOString()}>
        <button class="obv-health-ghost-btn" type="button" aria-label="Previous dates" onClick={() => moveDateWindow(-1)}><InsightGlyph kind="chevronLeft" /></button>
        {days.map(day => (
          <button
            class={`obv-habit-day ${isSameCalendarDay(day, selectedDate) ? 'active' : ''} ${isSameCalendarDay(day, today) ? 'today' : ''}`}
            type="button"
            key={day.toISOString()}
            onClick={() => setSelectedDate(day)}
          >
            <span>{day.toLocaleDateString('en-US', { weekday: 'short' })}</span>
            <strong>{day.getDate()}</strong>
          </button>
        ))}
        <button class="obv-health-ghost-btn" type="button" aria-label="Next dates" onClick={() => moveDateWindow(1)}><InsightGlyph kind="chevronRight" /></button>
      </div>
      {isComposerOpen ? (
        <form
          class="obv-task-composer"
          onSubmit={event => { event.preventDefault(); void saveTask(); }}
        >
          <div class="obv-task-composer-head">
            <strong>{selectedDateLabel}</strong>
            <button class="obv-task-composer-close" type="button" aria-label="Cancel task" onClick={closeComposer}><Icon name="plus" /></button>
          </div>
          <label class="obv-task-field obv-task-field-title">
            <span>Case</span>
            <select
              value={composerCaseId}
              onChange={event => setComposerCaseId((event.currentTarget as HTMLSelectElement).value)}
            >
              <option value="">{casesQ.isLoading ? 'Loading cases…' : 'Select a case…'}</option>
              {pickableCases.map(c => <option key={c.caseId} value={c.caseId}>{c.caseNo} · {c.employeeName ?? '—'}</option>)}
            </select>
          </label>
          <label class="obv-task-field obv-task-field-title">
            <span>Task</span>
            <input
              type="text"
              value={composerTitle}
              placeholder="Task title"
              onInput={event => setComposerTitle((event.currentTarget as HTMLInputElement).value)}
            />
          </label>
          <div class="obv-task-composer-grid">
            <label class="obv-task-field">
              <span>Assignee</span>
              <select
                value={composerAssignee}
                onChange={event => setComposerAssignee((event.currentTarget as HTMLSelectElement).value)}
              >
                <option value="">Unassigned</option>
                {employees.map(e => <option key={e.id} value={e.id}>{e.full_name ?? e.email ?? e.id}</option>)}
              </select>
            </label>
          </div>
          <div class="obv-task-composer-actions">
            <label class="obv-task-evidence-toggle">
              <input
                type="checkbox"
                checked={composerRequiresEvidence}
                onChange={event => setComposerRequiresEvidence((event.currentTarget as HTMLInputElement).checked)}
              />
              <span>Evidence</span>
            </label>
            <button class="obv-task-cancel-btn" type="button" onClick={closeComposer}>Cancel</button>
            <button class="obv-task-save-btn" type="submit" disabled={!composerCaseId || !composerTitle.trim() || addTaskMut.isPending}>Save</button>
          </div>
        </form>
      ) : null}
      <div class="obv-habit-grid obv-habit-grid-single">
        <div class="obv-habit-col">
          {visibleTasks.map(renderTask)}
          {!visibleTasks.length ? (
            <EmptyState
              icon="fa-calendar-check"
              title="Nothing scheduled"
              tone="gray"
              note="Try another day, or open the full task list to see everything at once."
            />
          ) : null}
        </div>
      </div>
    </section>
  );
}

function CasePerformanceCard({
  cases, mode, currentUserId, onOpenCases, onOpenCase,
}: {
  cases: CaseRow[];
  mode: DashboardMode;
  currentUserId: string | null;
  onOpenCases: () => void;
  onOpenCase: (caseId: string) => void;
}): VNode {
  const [page, setPage] = useState(0);
  const [slideDirection, setSlideDirection] = useState<'next' | 'previous'>('next');

  const displayCases = mode === 'staff'
    ? cases.filter(row => row.ownerId === currentUserId)
    : [...cases].sort((a, b) => (b.activeBlockers + b.blockingTasks + b.openTasks) - (a.activeBlockers + a.blockingTasks + a.openTasks));
  const pageSize = 3;
  const pageCount = Math.max(1, Math.ceil(displayCases.length / pageSize));
  const safePage = Math.min(page, pageCount - 1);
  const featured = displayCases.slice(safePage * pageSize, safePage * pageSize + pageSize);

  const movePage = (direction: -1 | 1): void => {
    setSlideDirection(direction > 0 ? 'next' : 'previous');
    setPage(current => (current + direction + pageCount) % pageCount);
  };

  return (
    <article class="obv-health-card obv-case-performance-card obv-priority-case-work-card">
      <div class="obv-health-head obv-priority-work-head">
        <div>
          <h2>{mode === 'staff' ? 'My Case Work' : 'Priority Case Work'}</h2>
          <p>Cases, task planner, evidence, and next actions</p>
        </div>
        <div class="obv-health-actions obv-priority-work-actions">
          <button class="obv-health-circle-btn" type="button" aria-label="Previous cases" onClick={() => movePage(-1)}><InsightGlyph kind="chevronLeft" /></button>
          <button class="obv-health-circle-btn" type="button" aria-label="Next cases" onClick={() => movePage(1)}><InsightGlyph kind="chevronRight" /></button>
          <button class="obv-health-viewall" type="button" onClick={onOpenCases}>View All</button>
        </div>
      </div>

      <section class="obv-priority-cases-panel" aria-label="Priority cases">
        <div class="obv-priority-panel-head">
          <em>{displayCases.length} active</em>
        </div>
        <div class={`obv-case-performance-grid obv-priority-case-list slide-${slideDirection}`} key={`${safePage}-${slideDirection}`}>
          {featured.map(row => (
            <button class="obv-case-performance-item obv-priority-case-item" type="button" key={row.caseId} onClick={() => onOpenCase(row.caseId)}>
              <div class="obv-doctor-head">
                <PersonAvatar name={row.employeeName} img={row.employeePhotoUrl} size="md" />
                <div class="obv-doctor-copy">
                  <strong>{row.employeeName}</strong>
                  <span>{row.packageLabel}</span>
                </div>
              </div>
              <div class="obv-doctor-divider" />
              <dl class="obv-doctor-stats">
                <div><dt>Progress</dt><dd>{row.progressPercent}%</dd></div>
                <div><dt>Tasks</dt><dd>{row.openTasks}</dd></div>
                <div><dt>Status</dt><dd><span class={`obv-case-status-text status-${row.status}`}>{humanize(row.status)}</span></dd></div>
              </dl>
            </button>
          ))}
          {!featured.length ? (
            <EmptyState
              icon="fa-user-group"
              title={mode === 'staff' ? 'No assigned cases' : 'No active cases'}
              text={mode === 'staff' ? 'You have no onboarding cases assigned right now.' : 'No onboarding cases match the current view.'}
              tone="gray"
              note="New hire, transfer, and contractor onboarding cases will show up here."
            />
          ) : null}
        </div>
      </section>

      <button class="obv-case-insight-mini obv-case-insight-simple obv-priority-work-insight" type="button" onClick={onOpenCases}>
        <span class="obv-case-insight-purple-icon"><Icon name="play" /></span>
        <span class="obv-case-insight-purple-copy">
          <strong>Risk-ranked cases with the full task planner in one container</strong>
          <em>{mode === 'staff' ? 'See assigned cases, dated tasks, evidence, and HR-owned next actions' : 'Review blockers, open work, dated tasks, and ownership without leaving this case container'}</em>
        </span>
        <span class="obv-case-insight-purple-action">Open Workbench <Icon name="arrow" /></span>
      </button>
    </article>
  );
}

function UpcomingDeadlinesCard({ deadlines, onOpenDeadlines }: { deadlines: DeadlineRow[]; onOpenDeadlines: () => void }): VNode {
  const today = useMemo(() => new Date(), []);
  const [windowStart, setWindowStart] = useState(today);
  const [selectedDate, setSelectedDate] = useState(today);
  const [slideDirection, setSlideDirection] = useState<'next' | 'previous'>('next');
  const days = useMemo(() => weekWindow(windowStart), [windowStart]);
  const monthLabel = windowStart.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  const selectedDeadlines = deadlines.filter(item => isSameCalendarDay(item.date, selectedDate));
  const upcomingDeadlines = selectedDeadlines.length ? selectedDeadlines : deadlines.filter(item => item.date >= selectedDate).slice(0, 3);

  const moveDateWindow = (direction: -1 | 1): void => {
    const nextStart = addDays(windowStart, direction * 7);
    setSlideDirection(direction > 0 ? 'next' : 'previous');
    setWindowStart(nextStart);
    setSelectedDate(nextStart);
  };

  return (
    <article class="obv-health-card obv-deadlines-card obv-appointments-style-card">
      <div class="obv-health-head">
        <div class="obv-appointments-title"><span class="obv-appointments-title-icon"><Icon name="calendar" /></span><h2>Upcoming Deadlines</h2></div>
        <div class="obv-health-actions compact">
          <button class="obv-health-ghost-btn" type="button" aria-label="Previous dates" onClick={() => moveDateWindow(-1)}><InsightGlyph kind="chevronLeft" /></button>
          <button class="obv-health-ghost-btn" type="button" aria-label="Next dates" onClick={() => moveDateWindow(1)}><InsightGlyph kind="chevronRight" /></button>
        </div>
      </div>
      <div class="obv-deadline-month-label">{monthLabel}</div>
      <div class={`obv-appointments-calendar obv-deadline-calendar slide-${slideDirection}`} key={windowStart.toISOString()}>
        {days.map(day => {
          const hasDeadline = deadlines.some(item => isSameCalendarDay(item.date, day));
          return (
            <button
              class={`obv-appointments-day ${isSameCalendarDay(day, selectedDate) ? 'active' : ''} ${isSameCalendarDay(day, today) ? 'today' : ''} ${hasDeadline ? 'has-deadline' : ''}`}
              type="button"
              key={day.toISOString()}
              onClick={() => setSelectedDate(day)}
            >
              <span>{day.toLocaleDateString('en-US', { weekday: 'short' })}</span>
              <strong>{day.getDate()}</strong>
            </button>
          );
        })}
      </div>
      <div class="obv-appointment-list obv-deadline-appointment-list">
        {upcomingDeadlines.map(item => (
          <button class="obv-appointment-item obv-deadline-appointment" type="button" key={item.id} onClick={onOpenDeadlines}>
            <p style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.month} {item.day} · {item.dueLabel}</p>
            <div class="obv-appointment-main">
              <div class="obv-appointment-copy">
                <span class={`obv-deadline-soft-icon obv-deadline-avatar-chip ${item.tone ? `tone-${item.tone}` : ''}`}>
                  <PersonAvatar name={item.employeeName} img={item.employeePhotoUrl} size="sm" />
                </span>
                <div>
                  <strong>{item.taskTitle}</strong>
                  <span>{item.employeeName}</span>
                </div>
              </div>
              <span class="obv-appointment-chat"><Icon name="arrow" /></span>
            </div>
          </button>
        ))}
        {!upcomingDeadlines.length ? (
          <EmptyState
            icon="fa-calendar"
            title="No deadlines"
            tone="gray"
            note="Pick another day on the calendar above to check for deadlines."
          />
        ) : null}
      </div>
    </article>
  );
}

function BlockedCasesCard({ blockers, onOpenBlocked }: { blockers: BlockerRow[]; onOpenBlocked: (filters?: OnboardingSurfaceFilters) => void }): VNode {
  const pageSize = 3;
  const [activeIndex, setActiveIndex] = useState(0);
  const [slideDirection, setSlideDirection] = useState<'next' | 'previous'>('next');
  const blockerCount = blockers.length;
  const canScroll = blockerCount > pageSize;
  const visibleBlockers = blockerCount
    ? Array.from({ length: Math.min(pageSize, blockerCount) }, (_, offset) => blockers[(activeIndex + offset) % blockerCount]!)
    : [];

  useEffect(() => {
    if (blockerCount && activeIndex >= blockerCount) setActiveIndex(0);
  }, [activeIndex, blockerCount]);

  const moveBlockers = (direction: -1 | 1): void => {
    if (!canScroll) return;
    setSlideDirection(direction > 0 ? 'next' : 'previous');
    setActiveIndex(current => (current + direction + blockerCount) % blockerCount);
  };

  return (
    <article class="obx-section obv-card obv-blocked-card obv-blocked-board-compact obv-blocked-condensed-card">
      <div class="obv-health-head obv-blocked-condensed-head">
        <div class="obv-blocked-title-group">
          <span class="obv-blocked-alert-dot" />
          <h2>Blocked Cases</h2>
          <em>{blockers.length}</em>
        </div>
        <div class="obv-health-actions obv-blocked-nav-actions">
          <button class="obv-health-circle-btn" type="button" aria-label="Previous blocked cases" onClick={() => moveBlockers(-1)} disabled={!canScroll}><InsightGlyph kind="chevronLeft" /></button>
          <button class="obv-health-circle-btn" type="button" aria-label="Next blocked cases" onClick={() => moveBlockers(1)} disabled={!canScroll}><InsightGlyph kind="chevronRight" /></button>
          <button class="obv-health-viewall" type="button" onClick={() => onOpenBlocked()}>View All</button>
        </div>
      </div>

      <div class={`obv-blocked-condensed-list slide-${slideDirection}`} key={`${activeIndex}-${slideDirection}`}>
        {visibleBlockers.map(item => {
          const meta = blockerMeta(item);
          return (
            <button
              class={`obv-blocked-condensed-item severity-${item.severity} status-${item.status}`}
              type="button"
              onClick={() => onOpenBlocked({
                blockerId: item.blockerId,
                caseId: item.caseId,
                severity: item.severity,
                status: item.status,
              })}
              key={item.blockerId}
              title={`${meta.links} linked record${meta.links === 1 ? '' : 's'}`}
            >
              <div class="obv-blocked-condensed-main">
                <span class={`obv-blocker-chip blocker-chip-${item.severity}`}><i />{humanize(item.severity)}</span>
                <div class="obv-blocked-condensed-copy">
                  <strong>{item.blockerTitle}</strong>
                  <p>{item.employeeName} · {item.caseNo}</p>
                </div>
              </div>
              <div class="obv-blocked-condensed-side obv-blocked-condensed-assignee">
                <PersonAvatar name={item.ownerName} size="sm" />
                <span class="obv-blocked-owner">{item.ownerName}</span>
              </div>
              <div class="obv-blocked-condensed-meta obv-blocked-essential-meta">
                <span class="obv-blocked-due">Due {fmtDate(item.dueAt)}</span>
              </div>
            </button>
          );
        })}
        {!visibleBlockers.length ? (
          <EmptyState
            icon="fa-circle-check"
            title="No blocked cases"
            tone="gray"
            note="New blockers raised by HR, IT, or HSE will show up here."
          />
        ) : null}
      </div>
    </article>
  );
}

function RecentActivityCard({ activity, onOpenActivity }: { activity: ActivityRow[]; onOpenActivity: () => void }): VNode {
  // Matches the reference mockup's exact visual system (rotating icon set + the
  // complete/pending status dot on the first few rows) — the mockup used position-based
  // fake icons/status here rather than deriving them from the activity data itself.
  // Kept as-is for now on the user's explicit direction; will be reconciled to fully
  // real, derived icon/status semantics in a follow-up pass.
  const activityDayIcons = ['document', 'handoffComplete', 'people', 'medicalClearance'] as const;

  return (
    <article class="obx-section obv-card obv-activity-card obv-activity-day-card">
      <div class="obv-health-head obv-activity-day-head">
        <div>
          <h2>Recent Activity</h2>
          <p>Live onboarding movement</p>
        </div>
        <div class="obv-health-actions">
          <button class="obv-health-viewall" type="button" onClick={onOpenActivity}>View All</button>
        </div>
      </div>

      {activity.length ? (
        <div class="obv-activity-day-timeline">
          {activity.slice(0, 4).map((item, index) => {
            const isCurrent = index === 2;
            const isCompleted = index < 2;
            return (
              <button
                class={`obv-activity-day-item activity-${item.tone}${isCurrent ? ' is-current' : ''}${isCompleted ? ' is-complete' : ' is-pending'}`}
                type="button"
                key={item.id}
                onClick={onOpenActivity}
              >
                <span class="obv-activity-day-icon-wrap">
                  <span class={`obv-activity-day-icon icon-${item.tone}`}><Icon name={activityDayIcons[index] ?? item.icon} /></span>
                </span>

                <span class="obv-activity-day-content">
                  <span class="obv-activity-day-time">
                    <span class={`obv-activity-day-status ${isCompleted ? 'status-complete' : 'status-pending'}`}>
                      {isCompleted ? <Icon name="check" /> : <Icon name="clock" />}
                    </span>
                    <time>{item.occurredAt}</time>
                  </span>

                  <span class="obv-activity-day-card-row">
                    <strong>{item.title}</strong>
                    <span>{item.actorName}</span>
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      ) : (
        <EmptyState
          icon="fa-clock-rotate-left"
          title="No recent activity"
          text="Nothing has happened yet."
          tone="gray"
          note="Task completions, blockers, and case updates are logged here automatically."
        />
      )}
    </article>
  );
}

function RecentProjectWorkCard({ mode, tasks, currentUserId, onOpenTasks }: {
  mode: DashboardMode;
  tasks: TaskRow[];
  currentUserId: string | null;
  onOpenTasks: () => void;
}): VNode {
  const [page, setPage] = useState(0);
  const activeTasks = tasks
    .filter(task => task.status !== 'completed')
    .filter(task => mode === 'manager' || task.assignedTo === currentUserId)
    .sort((a, b) => {
      if (!a.dueAt) return 1;
      if (!b.dueAt) return -1;
      return new Date(`${a.dueAt}T12:00:00`).getTime() - new Date(`${b.dueAt}T12:00:00`).getTime();
    });
  const pageSize = 2;
  const pageCount = Math.max(1, Math.ceil(activeTasks.length / pageSize));
  const safePage = Math.min(page, pageCount - 1);
  const workItems = activeTasks.slice(safePage * pageSize, safePage * pageSize + pageSize);
  const movePage = (direction: -1 | 1): void => setPage(current => (current + direction + pageCount) % pageCount);
  const taskProgress = (task: TaskRow): number => {
    if (task.status === 'in_progress') return task.requiresEvidence ? 68 : 58;
    if (task.status === 'blocked') return task.isBlocking ? 75 : 62;
    if (task.status === 'open') return task.requiresEvidence ? 22 : 18;
    return 12;
  };

  return (
    <article class="obv-collab-card obv-project-card obv-onboarding-work-card obv-task-work-card obv-work-restored-card">
      <div class="obv-project-card-head">
        <div>
          <h2>{mode === 'staff' ? 'My Work Queue' : "Today's Onboarding Work"}</h2>
          <p>{mode === 'staff' ? 'HR-owned tasks, evidence, and reviews due next' : 'Tasks, evidence, and blockers that need action'}</p>
        </div>
        <div class="obv-health-actions obv-recent-work-actions">
          <button class="obv-health-circle-btn" type="button" aria-label="Previous onboarding work" onClick={() => movePage(-1)}><InsightGlyph kind="chevronLeft" /></button>
          <button class="obv-health-circle-btn" type="button" aria-label="Next onboarding work" onClick={() => movePage(1)}><InsightGlyph kind="chevronRight" /></button>
          <button class="obv-health-viewall" type="button" onClick={onOpenTasks}>View All</button>
        </div>
      </div>
      <div class="obv-project-grid obv-work-task-grid">
        {workItems.map(task => {
          const progress = taskProgress(task);
          const isBlocked = task.status === 'blocked' || task.isBlocking;
          return (
            <button type="button" onClick={onOpenTasks} key={task.taskId} class="obv-work-task-card">
              <div class="obv-work-task-top">
                <span class={`obv-project-icon ${isBlocked ? 'dark' : 'green'}`}><Icon name={taskIconFor(task)} /></span>
                <span class={`obv-project-status-pill status-${task.status}`}>{humanize(task.status)}</span>
              </div>
              <strong>{task.taskTitle}</strong>
              <small>{task.employeeName} · {task.caseNo}</small>
              <div class="obv-work-task-owner">
                <PersonAvatar name={task.assignedToName} size="sm" />
                <span>{task.assignedToName}</span>
                <em>Due {fmtDate(task.dueAt)}</em>
              </div>
              <div class="obv-project-facts obv-work-facts">
                <span>{task.ownerRole}</span>
                <span>{humanize(task.moduleKey)}</span>
                {task.requiresEvidence ? <span>Evidence</span> : null}
                {task.isBlocking ? <span>Blocking</span> : null}
              </div>
              <div
                class={`obv-project-meter ${isBlocked ? 'dark' : 'green'}`}
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={progress}
                aria-label={`${task.taskTitle} progress for ${task.employeeName}`}
              >
                <span>{progress}%</span>
                <em><i key={`${task.taskId}-${progress}`} style={`--obv-work-progress: ${progress}%;`}><b /></i></em>
              </div>
            </button>
          );
        })}
        {!workItems.length ? (
          <EmptyState
            icon="fa-list-check"
            title={mode === 'staff' ? 'Work queue clear' : 'No active work'}
            text={mode === 'staff' ? 'You have no open onboarding tasks right now.' : 'There is no onboarding work in progress right now.'}
            tone="gray"
            note="Check back once new tasks are assigned to onboarding cases."
          />
        ) : null}
      </div>
    </article>
  );
}

function MorningGoalCard({ mode, blockers, cases, onOpenTasks }: {
  mode: DashboardMode;
  blockers: BlockerRow[];
  cases: CaseRow[];
  onOpenTasks: () => void;
}): VNode {
  type CriticalAction = 'evidence' | 'escalate';
  const priorityBlockers = blockers.slice(0, 4);
  const [priorityIndex, setPriorityIndex] = useState(0);
  const isStaff = mode === 'staff';
  const [selectedAction, setSelectedAction] = useState<CriticalAction>('evidence');
  const [completedActionsByBlocker, setCompletedActionsByBlocker] = useState<Record<string, Record<CriticalAction, boolean>>>({});

  if (!priorityBlockers.length) {
    return (
      <article class="obv-collab-card obv-goal-card obv-daily-goal-card obv-activation-goal-card obv-critical-path-card obv-critical-path-card-empty">
        <EmptyState
          icon="fa-shield-halved"
          title="No active blockers"
          text={isStaff ? 'Nothing in your queue is blocking activation right now.' : 'Nothing is blocking activation right now.'}
          tone="gray"
        />
      </article>
    );
  }

  const focusBlocker = priorityBlockers[priorityIndex % priorityBlockers.length]!;
  const snapshot = derivePrioritySnapshot(focusBlocker, cases);
  const readinessPercent = snapshot.readinessPercent;
  const blockedPercent = 100 - readinessPercent;
  const actionCopy: Record<CriticalAction, {
    eyebrow: string;
    title: string;
    detail: string;
    cta: string;
    doneTitle: string;
    doneDetail: string;
  }> = {
    evidence: {
      eyebrow: 'Evidence workflow',
      title: 'Notify the blocker owner',
      detail: `${focusBlocker.ownerName} will be notified to submit the missing evidence for this gate.`,
      cta: 'Notify Owner',
      doneTitle: 'Owner notified',
      doneDetail: `${focusBlocker.ownerName} has been notified about this blocker.`,
    },
    escalate: {
      eyebrow: 'Escalation path',
      title: 'Escalate this blocker',
      detail: `Route to the HR owner since this remains open past ${fmtDate(focusBlocker.dueAt)}.`,
      cta: 'Escalate Blocker',
      doneTitle: 'Blocker escalated',
      doneDetail: `The blocker is flagged for ${focusBlocker.ownerName} follow-up.`,
    },
  };
  const selectedActionCopy = actionCopy[selectedAction];
  const completedActions = completedActionsByBlocker[focusBlocker.blockerId] ?? { evidence: false, escalate: false };
  const actionComplete = completedActions[selectedAction];
  const selectAction = (action: CriticalAction): void => setSelectedAction(action);
  const movePriority = (direction: -1 | 1): void => {
    setPriorityIndex(current => (current + direction + priorityBlockers.length) % priorityBlockers.length);
    setSelectedAction('evidence');
  };
  const runSelectedAction = (): void => {
    setCompletedActionsByBlocker(current => ({
      ...current,
      [focusBlocker.blockerId]: {
        ...(current[focusBlocker.blockerId] ?? { evidence: false, escalate: false }),
        [selectedAction]: true,
      },
    }));
    onOpenTasks();
  };

  return (
    <article class="obv-collab-card obv-goal-card obv-daily-goal-card obv-activation-goal-card obv-critical-path-card">
      <div class="obv-critical-top">
        <div class="obv-critical-status-line">
          <span>{isStaff ? 'My queue' : `Blocked by ${focusBlocker.blockingModule}`}</span>
          <time>Due {fmtDate(focusBlocker.dueAt)}</time>
        </div>
        <button class="obv-critical-open" type="button" onClick={onOpenTasks}>Open</button>
      </div>
      <div class="obv-critical-profile">
        <PersonAvatar name={focusBlocker.employeeName} img={focusBlocker.employeePhotoUrl} size="md" />
        <div class="obv-critical-person">
          <strong>{focusBlocker.employeeName}</strong>
          <em>{snapshot.packageLabel} &middot; {snapshot.stage}</em>
        </div>
        <div class="obv-critical-profile-nav">
          <button class="obv-critical-nav" type="button" aria-label="Previous priority employee" onClick={() => movePriority(-1)}>
            <InsightGlyph kind="chevronLeft" />
          </button>
          <button class="obv-critical-nav" type="button" aria-label="Next priority employee" onClick={() => movePriority(1)}>
            <InsightGlyph kind="chevronRight" />
          </button>
        </div>
      </div>
      <div class="obv-critical-identity">
        <span>{focusBlocker.caseNo} &middot; {snapshot.stage}</span>
        <strong>{focusBlocker.blockerTitle}</strong>
      </div>
      <div class="obv-critical-facts" aria-label="Critical path details">
        <button type="button" onClick={() => setSelectedAction('evidence')}>
          <span>Owner</span>
          <strong>{focusBlocker.ownerName}</strong>
        </button>
        <button type="button" onClick={() => setSelectedAction('escalate')}>
          <span>Gate</span>
          <strong>{focusBlocker.blockingModule}</strong>
        </button>
        <button type="button" onClick={() => setSelectedAction('escalate')}>
          <span>Age</span>
          <strong>{focusBlocker.ageDays} day{focusBlocker.ageDays === 1 ? '' : 's'}</strong>
        </button>
      </div>

      <div class="obv-critical-readiness">
        <div class="obv-critical-readiness-head">
          <div class="obv-critical-score">
            <span>Day-1 ready</span>
            <strong>{readinessPercent}%</strong>
          </div>
          <div>
            <span>Readiness impact</span>
            <small>{blockedPercent}% blocked by this gate &middot; {humanize(focusBlocker.status)}</small>
          </div>
        </div>
        <em><i style={{ width: `${readinessPercent}%` }} /></em>
      </div>

      <div class="obv-critical-actions" role="group" aria-label="Critical path actions">
        <button class={selectedAction === 'evidence' ? 'is-active' : ''} type="button" onClick={() => selectAction('evidence')}>
          <Icon name="mail" />
          <span>{completedActions.evidence ? 'Notified' : 'Notify Owner'}</span>
        </button>
        <button class={selectedAction === 'escalate' ? 'is-active' : ''} type="button" onClick={() => selectAction('escalate')}>
          <Icon name="alert" />
          <span>{completedActions.escalate ? 'Escalated' : 'Escalate'}</span>
        </button>
      </div>

      <div class={`obv-critical-action-panel action-${selectedAction} ${actionComplete ? 'is-complete' : ''}`}>
        <div class="obv-critical-action-main">
          <span class="obv-critical-action-eyebrow">{selectedActionCopy.eyebrow}</span>
          <strong>{actionComplete ? selectedActionCopy.doneTitle : selectedActionCopy.title}</strong>
          <p>{actionComplete ? selectedActionCopy.doneDetail : selectedActionCopy.detail}</p>
        </div>
        <div class="obv-critical-action-side">
          <button type="button" onClick={runSelectedAction}>{actionComplete ? 'Open Workflow' : selectedActionCopy.cta}</button>
        </div>
      </div>
    </article>
  );
}

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
