// Onboarding Command Center — RecentProjectWorkCard (byte-identical JSX from the original monolith).
import { type VNode } from 'preact';
import { useState } from 'preact/hooks';
import { EmptyState } from '@ui';
import { fmtDate, humanize, type DashboardMode, type TaskRow } from '../../OnboardingCommandCenter.helpers';
import { Icon, InsightGlyph, PersonAvatar, taskIconFor } from '../primitives';

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

export { RecentProjectWorkCard };
