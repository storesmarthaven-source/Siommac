// src/components/sections/HR/onboarding/CommandCentreWidgets.tsx
//
// The five page-local Command Centre widgets, written against the DOM and class names of
// `docs/mockups/onboarding-command-centre-core.html` and styled by the mechanically-ported
// `OnboardingCommandCenter.mockup.css` (root `.occ-root`).
//
// They are page-local rather than registered because each one needs the Command Centre's own
// callbacks (open case, drill into a surface) and its scoped datasets. Registering them
// globally would publish onboarding-page-specific cards to every board's Widget Library.
//
// Upcoming Deadlines and Tasks are deliberately ABSENT here: the mockup marks those cards
// `data-reuse="existing-widget"`, so the board mounts the registered
// `enterprise.calendar.upcomingDeadlines` / `.taskPlanner` definitions instead of copying them.

import { type VNode } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import {
  Chart, BarController, BarElement, CategoryScale, LinearScale, Tooltip, Legend,
} from 'chart.js';
import type { OnboardingCaseRow, OnboardingBlockerRow, OnboardingDashboardStats, OnboardingWorkItem } from '../../../../../types/hrOnboarding';

// Same charting stack Employee Master's widgets use — one registration, tree-shaken to the
// controllers actually needed here.
Chart.register(BarController, BarElement, CategoryScale, LinearScale, Tooltip, Legend);

// ── shared helpers ───────────────────────────────────────────────────────────────
export function initials(name: string | null | undefined): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '—';
  return (parts[0]!.charAt(0) + (parts[1]?.charAt(0) ?? '')).toUpperCase();
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function ordinal(d: number): string {
  if (d > 3 && d < 21) return `${d}th`;
  const suffix = ['th', 'st', 'nd', 'rd'][d % 10] ?? 'th';
  return `${d}${suffix}`;
}

/** "20th July" — the mockup's date voice. */
export function longDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return `${ordinal(d.getDate())} ${MONTHS[d.getMonth()] ?? ''}`;
}

/** Whole days from today; negative when overdue. */
export function daysFromToday(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  d.setHours(0, 0, 0, 0);
  return Math.round((d.getTime() - today.getTime()) / 86_400_000);
}

function dueHelper(iso: string | null | undefined): string {
  const n = daysFromToday(iso);
  if (n === null) return '';
  if (n < 0) return `${Math.abs(n)} day${Math.abs(n) === 1 ? '' : 's'} overdue`;
  if (n === 0) return 'Due today';
  return `in ${n} day${n === 1 ? '' : 's'}`;
}

function EmptyPanel({ title, text }: { title: string; text: string }): VNode {
  return <div class="occ-empty" role="status"><strong>{title}</strong><p>{text}</p></div>;
}

// ── 1 · Start Readiness ──────────────────────────────────────────────────────────
/**
 * The mockup's readiness band: a real Chart.js bar over the scoped weekly start trend, with
 * the readiness split in the legend beneath. `readyCases`/`inProgressCases`/`notStartedCases`
 * are mutually exclusive and sum to `activeCases.total`, so the legend always reconciles.
 */
export function StartReadinessWidget({ stats, onViewStarts }: {
  stats: OnboardingDashboardStats | undefined;
  onViewStarts: () => void;
}): VNode {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const trend = stats?.activeCases.weeklyTrend ?? [];

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || trend.length === 0) return;
    // A REAL Chart.js chart, as the mockup's <canvas> and Employee Master's widgets both use.
    // It plots `activeCases.weeklyTrend` — actual cases started per week from the scoped read
    // model. The mockup captions this a 14-day view, but no daily start series exists in the
    // contract, so the axis is labelled for the data that is real rather than fabricated.
    const chart = new Chart(canvas, {
      type: 'bar',
      data: {
        labels: trend.map(b => b.week.slice(5)),          // MM-DD
        datasets: [{
          label: 'Cases started', data: trend.map(b => b.count),
          backgroundColor: '#5679df', borderRadius: 5, borderSkipped: false,
        }],
      },
      options: {
        responsive: true, maintainAspectRatio: false, animation: { duration: 720 },
        plugins: { legend: { display: false }, tooltip: { displayColors: false } },
        scales: {
          x: { grid: { display: false }, border: { display: false }, ticks: { color: '#858c97', font: { size: 9 } } },
          y: { beginAtZero: true, grace: '12%', grid: { color: '#edf0f4' }, border: { display: false },
               ticks: { color: '#858c97', precision: 0, font: { size: 9 } } },
        },
      },
    });
    return () => chart.destroy();
  }, [trend]);

  if (!stats) return <EmptyPanel title="Readiness unavailable" text="Onboarding statistics could not be loaded." />;
  const r = stats.activationReadiness;
  const total = stats.activeCases.total;

  return (
    <article class="panel pulse-panel">
      <header class="pulse-header">
        <div><h2>Start Readiness</h2><p>Cases started per week, and current readiness</p></div>
        <span class="pulse-total">{total} {total === 1 ? 'case' : 'cases'}</span>
      </header>
      <div class="command-chart-stage">
        {total === 0
          ? <EmptyPanel title="No active cases" text="Readiness appears once a case is in progress." />
          : <canvas ref={canvasRef} role="img" aria-label={`Cases started per week. Readiness: ${r.readyCases} ready, ${r.inProgressCases} in progress, ${r.notStartedCases} not started.`} />}
      </div>
      <footer class="pulse-legend">
        <span><i class="ready" />Ready {r.readyCases}</span>
        <span><i class="risk" />In Progress {r.inProgressCases}</span>
        <span><i class="blocked" />Not Started {r.notStartedCases}</span>
        <button type="button" class="occ-linkish" onClick={onViewStarts}>View starts</button>
      </footer>
    </article>
  );
}

// ── 2 · Case Focus ───────────────────────────────────────────────────────────────
/** The left-rail focused case: identity, its worst blocker, ownership, readiness and next action. */
export function CaseFocusWidget({ cases, blockers, index, onCycle, onOpenCase, onNotifyOwner }: {
  cases: OnboardingCaseRow[];
  blockers: OnboardingBlockerRow[];
  index: number;
  onCycle: (delta: number) => void;
  onOpenCase: (caseId: string) => void;
  onNotifyOwner: (blocker: OnboardingBlockerRow) => void;
}): VNode {
  if (!cases.length) {
    return <article class="case-focus-panel">
      <EmptyPanel title="No cases need attention" text="Every case in this scope is progressing without a blocking issue." />
    </article>;
  }
  const c = cases[Math.min(index, cases.length - 1)]!;
  const caseBlockers = blockers.filter(b => b.caseId === c.caseId);
  const worst = caseBlockers.find(b => b.severity === 'critical') ?? caseBlockers[0] ?? null;

  return (
    <article class="case-focus-panel" aria-labelledby="occCaseFocusTitle">
      <section class="case-focus-person-stack">
        <div class="case-focus-profile">
          <span class="avatar">{initials(c.employeeName)}</span>
          <div>
            <h2 id="occCaseFocusTitle">{c.employeeName ?? 'Unnamed employee'}</h2>
            <p><span>{c.departmentName ?? c.packageLabel}</span></p>
          </div>
          <nav aria-label="Priority case navigation">
            <div class="case-focus-nav">
              <button type="button" aria-label="Previous priority case" onClick={() => onCycle(-1)}>‹</button>
              <button type="button" aria-label="Next priority case" onClick={() => onCycle(1)}>›</button>
            </div>
            <span>{Math.min(index + 1, cases.length)} of {cases.length}</span>
          </nav>
        </div>
        <section class="case-focus-issue">
          <header>
            <h3>{caseBlockers.length
              ? `${caseBlockers.length} Blocking ${caseBlockers.length === 1 ? 'Gate Needs' : 'Gates Need'} Review`
              : 'No Blocking Gates'}</h3>
            <em>{c.status.replace(/_/g, ' ')}</em>
          </header>
          <div>
            <p>
              <span>{c.caseNo}{worst ? ` · ${worst.blockingModule.toUpperCase()}` : ''}</span>
              <strong>{worst ? worst.blockerTitle : 'All gates are clear'}</strong>
            </p>
            <time>
              <small>Due Date</small>
              <strong>{longDate(worst?.dueAt ?? c.dueAt)}</strong>
              <em>{dueHelper(worst?.dueAt ?? c.dueAt)}</em>
            </time>
          </div>
        </section>
      </section>
      <section class="case-focus-facts" aria-label="HR case facts">
        <div class="case-focus-person-fact">
          <span class="avatar">{initials(c.ownerName)}</span>
          <p><small>Case Owner · HR</small><strong>{c.ownerName ?? 'Owner required'}</strong></p>
        </div>
        <div class="case-focus-person-fact">
          <span class="avatar warm">{initials(worst?.ownerName ?? null)}</span>
          <p><small>Waiting On{worst ? ` · ${worst.blockingModule.toUpperCase()}` : ''}</small>
            <strong>{worst?.ownerName ?? 'Nobody'}</strong></p>
        </div>
      </section>
      <section class="case-focus-impact">
        <div class="case-focus-readiness-ring" aria-label={`Day-One readiness ${c.progressPercent} percent`}>
          <strong>{c.progressPercent}%</strong><span>Ready</span>
        </div>
        <div>
          <strong>Day-One Readiness</strong>
          <p>{c.openTasks} open {c.openTasks === 1 ? 'task' : 'tasks'}
            {c.activeBlockers > 0 ? `, ${c.activeBlockers} blocking this start.` : '. No active blockers.'}</p>
        </div>
      </section>
      <section class="case-focus-recommendation">
        <span>Next Action</span>
        <h4>{worst ? `Resolve ${worst.blockerTitle}` : 'Review remaining tasks'}</h4>
        <p>{worst
          ? 'Notify the accountable owner, then review the submitted evidence before clearing the gate.'
          : 'No blocker is holding this case. Work the remaining tasks to reach Day-One readiness.'}</p>
        <div class="case-focus-actions">
          <button type="button" class="case-focus-open" onClick={() => onOpenCase(c.caseId)}>Open Full Case ›</button>
          {worst && <button type="button" onClick={() => onNotifyOwner(worst)}>Notify Owner</button>}
        </div>
      </section>
    </article>
  );
}

// ── 3 · Blocked Cases ────────────────────────────────────────────────────────────
export function BlockedCasesWidget({ blockers, onOpenCase, onViewAll }: {
  blockers: OnboardingBlockerRow[];
  onOpenCase: (caseId: string) => void;
  onViewAll: () => void;
}): VNode {
  const rank: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
  const rows = [...blockers].sort((a, b) => (rank[a.severity] ?? 9) - (rank[b.severity] ?? 9)).slice(0, 6);

  return (
    <article class="panel blocked-cases-panel" aria-labelledby="occBlockedTitle">
      <header class="blocked-cases-head">
        <div class="blocked-cases-title">
          <span class="blocked-signal" />
          <h2 id="occBlockedTitle">Blocked Cases</h2>
          <span class="blocked-count">{blockers.length}</span>
        </div>
        <div class="blocked-cases-actions">
          <button type="button" class="view-all-control" onClick={onViewAll}>View All</button>
        </div>
      </header>
      {rows.length === 0
        ? <EmptyPanel title="Nothing blocked" text="No case in this scope has an active blocker." />
        : <div class="blocked-case-list">
            {rows.map(b => (
              <button key={b.blockerId} type="button" class={`blocked-case-row severity-${b.severity}`}
                onClick={() => onOpenCase(b.caseId)}>
                <div class="obv-blocked-condensed-main">
                  <span class={`severity-tag ${b.severity}`}><i />{b.severity.charAt(0).toUpperCase() + b.severity.slice(1)}</span>
                  <div class="blocked-case-copy">
                    <strong>{b.blockerTitle}</strong>
                    <small>{b.employeeName ?? '—'} · {b.caseNo}</small>
                  </div>
                </div>
                <div class="blocked-case-meta"><time class="obv-blocked-due">Due {longDate(b.dueAt)}</time></div>
                <div class="blocked-case-owner">
                  <span class="avatar warm">{initials(b.ownerName)}</span>
                  <b class="obv-blocked-owner">{b.ownerName ?? 'Unassigned'}</b>
                </div>
              </button>
            ))}
          </div>}
    </article>
  );
}

// ── 4 · Upcoming Starts ──────────────────────────────────────────────────────────
export function UpcomingStartsWidget({ rows, loading, onOpenCase, onViewAll }: {
  rows: OnboardingCaseRow[];
  loading: boolean;
  onOpenCase: (caseId: string) => void;
  onViewAll: () => void;
}): VNode {
  const tone = (c: OnboardingCaseRow): 'green' | 'amber' | 'red' =>
    c.activeBlockers > 0 ? 'red' : c.ready ? 'green' : 'amber';
  const label = (c: OnboardingCaseRow): string =>
    c.activeBlockers > 0 ? 'Blocked' : c.ready ? 'Ready' : 'At Risk';

  return (
    <section class="panel upcoming-work-panel" aria-labelledby="occUpcomingTitle">
      <header class="panel-header">
        <div><h2 id="occUpcomingTitle">Upcoming Starts</h2><p>Employees starting next, readiness gates, and accountable owners</p></div>
        <div class="upcoming-work-actions">
          <button type="button" class="view-all-control" onClick={onViewAll}>View All</button>
        </div>
      </header>
      {loading
        ? <EmptyPanel title="Loading upcoming starts" text="Fetching cases with a planned start date." />
        : rows.length === 0
          ? <EmptyPanel title="No starts in the next 7 days" text="No case in this scope has a planned first day this week." />
          : <div class="upcoming-task-grid">
              {rows.slice(0, 6).map(c => (
                <button key={c.caseId} type="button" class="upcoming-task-card" onClick={() => onOpenCase(c.caseId)}>
                  <div class="upcoming-task-top">
                    <span class={`upcoming-task-icon ${tone(c)}`} />
                    <span class={`upcoming-status ${tone(c) === 'green' ? 'ready' : 'risk'}`}>{label(c)}</span>
                  </div>
                  <strong>{c.employeeName ?? 'Unnamed employee'}</strong>
                  <small>{c.packageLabel} · {c.caseNo}</small>
                  <div class="upcoming-start-detail">
                    <span>Starts {longDate(c.targetStartDate)}</span>
                    <em>{c.activeBlockers > 0
                      ? `${c.activeBlockers} gate${c.activeBlockers === 1 ? '' : 's'} open`
                      : c.ready ? 'All gates cleared' : `${c.openTasks} open`}</em>
                  </div>
                  <div class="upcoming-owner">
                    <span class="avatar">{initials(c.ownerName)}</span>
                    <span>{c.ownerName ?? 'Owner required'}</span><em>Case owner</em>
                  </div>
                  <div class={`upcoming-meter ${tone(c)}`}>
                    <span>{c.progressPercent}%</span>
                    <em><i style={{ width: `${c.progressPercent}%` }}><b /></i></em>
                  </div>
                </button>
              ))}
            </div>}
    </section>
  );
}

// ── 5 · Team Work Queue ──────────────────────────────────────────────────────────
export type QueueTab = 'overdue' | 'today' | 'upcoming';

export function WorkQueueWidget({ rows, isManager, tab, onTab, counts, activeFilterLabel, onClearFilter, onOpenCase, onOpenQueue }: {
  rows: OnboardingWorkItem[];
  isManager: boolean;
  tab: QueueTab;
  onTab: (t: QueueTab) => void;
  counts: Record<QueueTab, number>;
  activeFilterLabel: string | null;
  onClearFilter: () => void;
  onOpenCase: (caseId: string) => void;
  onOpenQueue: () => void;
}): VNode {
  return (
    <article class="panel work-queue-panel" data-testid="onboarding-work-queue" aria-labelledby="occQueueTitle">
      <header class="panel-header">
        <div class="panel-title">
          <span class="panel-title-icon" />
          <div>
            <h2 id="occQueueTitle">{isManager ? 'Team Work Queue' : 'My Work Queue'}</h2>
            <p>{isManager
              ? 'Overdue work, approvals, handoffs and exceptions across your team.'
              : 'Overdue work, approvals, handoffs and exceptions assigned to you.'}</p>
          </div>
        </div>
        <button type="button" class="btn small" onClick={onOpenQueue}>Open Work Queue</button>
      </header>
      <div class="queue-toolbar">
        <div class="tab-list" role="tablist" aria-label="Work due date">
          {(['overdue', 'today', 'upcoming'] as QueueTab[]).map(t => (
            <button key={t} type="button" role="tab" aria-selected={tab === t} class={tab === t ? 'active' : ''}
              onClick={() => onTab(t)}>
              {t === 'overdue' ? 'Overdue' : t === 'today' ? 'Due Today' : 'Upcoming'}
              <span class="count">{counts[t]}</span>
            </button>
          ))}
        </div>
        {activeFilterLabel && (
          <div class="type-filters">
            <button type="button" class="active" onClick={onClearFilter}>{activeFilterLabel} ✕</button>
          </div>
        )}
      </div>
      {rows.length === 0
        ? <EmptyPanel title="Nothing in this queue" text="No case in this scope matches the selected due state." />
        : <div style={{ overflow: 'auto' }}>
            <table class="work-table">
              <thead><tr>
                <th>Employee</th><th>Case</th><th>Stage</th><th>Due Date</th><th>Owner</th><th>Action</th>
              </tr></thead>
              <tbody>
                {rows.slice(0, 25).map(c => {
                  const overdue = (daysFromToday(c.dueAt) ?? 0) < 0;
                  return (
                    <tr key={`${c.sourceType}:${c.sourceId}`}>
                      <td><div class="employee"><span class="avatar warm">{initials(c.employeeName)}</span>
                        <div><strong>{c.employeeName ?? '—'}</strong><small>{c.departmentName ?? 'Department unassigned'} · {c.caseNo}</small></div></div></td>
                      <td><span class="task-title">{c.title}</span>
                        <span class="task-meta"><i class={`state-dot ${c.isBlocking ? 'red' : 'amber'}`} />
                          {c.sourceType.replace(/_/g, ' ')} · {c.caseNo}</span></td>
                      <td><span class="stage-tag">{c.normalizedStatus.replace(/_/g, ' ')}</span></td>
                      <td><span class={`due ${overdue ? 'overdue' : ''}`}>
                        <span><b>{longDate(c.dueAt)}</b><small>{dueHelper(c.dueAt)}</small></span></span></td>
                      <td><div class="owner"><span class="avatar">{initials(c.accountableName)}</span>
                        <div><strong>{c.accountableName ?? 'Unassigned'}</strong><small>{c.owningQueue ? `${c.owningQueue.replace(/_/g, ' ')} queue` : 'Queue required'}</small></div></div></td>
                      <td><div class="row-actions">
                        <button type="button" class="btn primary small open-detail" onClick={() => onOpenCase(c.caseId)}>Review</button>
                      </div></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>}
    </article>
  );
}
