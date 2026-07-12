// Onboarding Command Center — TasksPlannerCard (byte-identical JSX from the original monolith).
import { type VNode } from 'preact';
import { useMemo, useState } from 'preact/hooks';
import { EmptyState } from '@ui';
import { useHrEmployees } from '@api/hr/employees';
import { useOnboardingCases, useOnboardingAddTask } from '@api/hr/onboarding';
import { addDays, isSameCalendarDay, weekWindow, type TaskRow } from '../../OnboardingCommandCenter.helpers';
import { Icon, InsightGlyph, taskIconFor } from '../primitives';

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
              onChange={event => setComposerCaseId((event.currentTarget).value)}
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
              onInput={event => setComposerTitle((event.currentTarget).value)}
            />
          </label>
          <div class="obv-task-composer-grid">
            <label class="obv-task-field">
              <span>Assignee</span>
              <select
                value={composerAssignee}
                onChange={event => setComposerAssignee((event.currentTarget).value)}
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
                onChange={event => setComposerRequiresEvidence((event.currentTarget).checked)}
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

export { TasksPlannerCard };
