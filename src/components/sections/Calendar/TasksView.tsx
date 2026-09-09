import { type VNode } from 'preact';
import type { CalendarItemDTO } from '@api/calendar';
import { itemDateKey, parseLocalDate, timeLabel, toLocalDateKey } from '@lib/calendar/date';
import { sourceLabel } from './calendarViewModel';
import { calendarCustomColorVariables } from './calendarColor';
import { CalendarTitleIcon } from './CalendarTitleIconPicker';

type TaskGroup = 'overdue' | 'today' | 'upcoming' | 'completed';

const GROUP_LABELS: Record<TaskGroup, string> = {
  overdue: 'Overdue',
  today: 'Today',
  upcoming: 'Upcoming',
  completed: 'Completed',
};

function taskGroup(item: CalendarItemDTO, today: string): TaskGroup {
  if (item.status === 'done' || item.status === 'cancelled') return 'completed';
  const key = item.deadlineAt ? toLocalDateKey(new Date(item.deadlineAt)) : itemDateKey(item);
  if (key && key < today) return 'overdue';
  if (key === today) return 'today';
  return 'upcoming';
}

function dateLabel(item: CalendarItemDTO): string {
  if (item.deadlineAt) {
    const deadline = new Date(item.deadlineAt);
    const label = deadline.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    return `${label} · ${timeLabel(item.deadlineAt)}`;
  }
  const key = itemDateKey(item);
  if (!key) return 'No due date';
  const date = parseLocalDate(key);
  const label = date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  return item.allDay || !item.startsAt ? label : `${label} · ${timeLabel(item.startsAt)}`;
}

export function TasksView({ items, loading, enteringItemId = null, onOpenItem, onEntryAnimationEnd }: {
  items: CalendarItemDTO[];
  loading: boolean;
  enteringItemId?: string | null;
  onOpenItem: (item: CalendarItemDTO) => void;
  onEntryAnimationEnd?: (id: string) => void;
}): VNode {
  const today = toLocalDateKey(new Date());
  const tasks = items.filter(item => item.type === 'task');
  const groups = (['overdue', 'today', 'upcoming', 'completed'] as TaskGroup[]).map(group => ({
    group,
    items: tasks.filter(item => taskGroup(item, today) === group),
  })).filter(section => section.items.length > 0);

  if (loading) return <div class="cal-task-view">{[0, 1, 2, 3].map(index => <div key={index} class="cal-skeleton cal-skeleton-row" />)}</div>;
  if (!tasks.length) return <div class="cal-empty-state"><i class="fas fa-list-check" aria-hidden="true" /><strong>No matching tasks</strong><span>Adjust the calendar scope or filters to see assigned work.</span></div>;

  return (
    <div class="cal-task-view" aria-label="Calendar tasks">
      <header class="cal-task-summary"><div><span>Tasks</span><strong>Actionable schedule</strong><small>Due work grouped by urgency and completion.</small></div><div><strong>{tasks.length}</strong><span>tasks shown</span></div></header>
      <div class="cal-task-groups">
        {groups.map(section => <section class={`cal-task-group is-${section.group}`} key={section.group}>
          <header><strong>{GROUP_LABELS[section.group]}</strong><span>{section.items.length}</span></header>
          <div>{section.items.map(item => <button type="button" class={`cal-task-row${item.customColor ? ' has-custom-color' : ''}${item.id === enteringItemId || item.id.startsWith(`${enteringItemId}::`) ? ' cal-entry-is-entering' : ''}`} key={item.id}
            style={calendarCustomColorVariables(item.customColor) || undefined}
            onAnimationEnd={item.id === enteringItemId || item.id.startsWith(`${enteringItemId}::`) ? () => onEntryAnimationEnd?.(item.id) : undefined} onClick={() => onOpenItem(item)}>
            <span class="cal-task-check" aria-hidden="true"><i class={`fas ${section.group === 'completed' ? 'fa-check' : 'fa-circle'}`} /></span>
            <span class="cal-task-copy"><strong class="cal-title-with-icon"><CalendarTitleIcon type={item.titleIconType} value={item.titleIconValue} size={13} /><span>{item.title}</span></strong><small>{sourceLabel(item)}{item.assigneeName ? ` · ${item.assigneeName}` : ''}</small></span>
            <time dateTime={item.startsAt ?? item.startsOn ?? undefined}>{dateLabel(item)}</time>
            {item.priority ? <span class={`cal-task-priority is-${item.priority}`}>{item.priority}</span> : null}
            <i class="fas fa-chevron-right" aria-hidden="true" />
          </button>)}</div>
        </section>)}
      </div>
    </div>
  );
}
