import { type VNode } from 'preact';
import type { CalendarItemDTO } from '@api/calendar';
import { itemDateKey, parseLocalDate, timeLabel } from '@lib/calendar/date';
import { AvatarGroup, Button, LucideIcon, Popover, type PersonOption } from '@ui';
import { CalendarTitleIcon } from './CalendarTitleIconPicker';

function scheduleLabel(item: CalendarItemDTO): string {
  const key = itemDateKey(item);
  const date = key ? parseLocalDate(key).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) : 'Date pending';
  if (item.allDay) return `${date} · All Day`;
  return `${date} · ${item.startsAt ? timeLabel(item.startsAt) : 'Time pending'}${item.endsAt ? ` – ${timeLabel(item.endsAt)}` : ''}`;
}

function deadlineLabel(deadlineAt: string): string {
  const value = new Date(deadlineAt);
  return value.toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function iconFor(item: CalendarItemDTO): 'Video' | 'Flag' | 'BellRing' | 'ListChecks' | 'CalendarDays' {
  const kind = item.kind ?? (item.sourceModule === 'meetings' ? 'meeting' : item.type === 'deadline' ? 'deadline' : item.type === 'task' ? 'task' : 'event');
  if (kind === 'meeting') return 'Video';
  if (kind === 'deadline') return 'Flag';
  if (kind === 'reminder') return 'BellRing';
  return kind === 'task' ? 'ListChecks' : 'CalendarDays';
}

function sourceActionLabel(item: CalendarItemDTO): string {
  if (item.kind === 'meeting' && item.sourceModule === 'meetings') return 'Open meeting';
  if (item.kind === 'task' || item.type === 'task') return 'Open task';
  return 'Open source';
}

function aboutLabel(kind: string): string {
  if (kind === 'meeting') return 'What we’ll cover';
  if (kind === 'task') return 'Task details';
  if (kind === 'deadline') return 'Deadline details';
  if (kind === 'reminder') return 'Reminder details';
  return 'About this event';
}

function meetingAgenda(notes: string | null, supplied: readonly string[]): string[] {
  const agenda = supplied.map(entry => entry.trim()).filter(Boolean);
  if (agenda.length) return agenda;
  return (notes ?? '')
    .split(/\r?\n/)
    .map(entry => entry.replace(/^\s*[-*•]\s*/, '').trim())
    .filter(Boolean);
}

export function CalendarItemPreview({ item, anchor, boundary, people = [], agenda = [], reminderLabel = null, onEdit, onDuplicate, onDelete, onSetReminder, onOpenSource, onClose }: {
  item: CalendarItemDTO | null;
  anchor: HTMLElement | null;
  boundary?: HTMLElement | null;
  people?: readonly PersonOption[];
  agenda?: readonly string[];
  reminderLabel?: string | null;
  onEdit?: (item: CalendarItemDTO) => void;
  onDuplicate?: (item: CalendarItemDTO) => void;
  onDelete?: (item: CalendarItemDTO) => void;
  onSetReminder?: (item: CalendarItemDTO) => void;
  onOpenSource?: (item: CalendarItemDTO) => void;
  onClose: () => void;
}): VNode | null {
  if (!item || !anchor) return null;
  const kind = item.kind ?? (item.sourceModule === 'meetings' ? 'meeting' : item.type === 'deadline' ? 'deadline' : item.type === 'task' ? 'task' : 'event');
  const agendaItems = kind === 'meeting' ? meetingAgenda(item.notes, agenda) : [];
  return <Popover open anchor={anchor} boundary={boundary} onClose={onClose} label={item.title} class="cal-item-preview-popover" align="start" placement="auto" offset={8} maxHeight={420}>
    <article class="cal-item-preview">
      <header>
        <span class="cal-item-preview-kind"><LucideIcon name={iconFor(item)} size={18} /></span>
        <div class="cal-item-preview-heading"><small>{item.categoryName ?? kind}</small><strong class="cal-title-with-icon"><CalendarTitleIcon type={item.titleIconType} value={item.titleIconValue} size={14} /><span>{item.title}</span></strong></div>
        <div class="cal-item-preview-head-actions">
          {item.editable && onDuplicate ? <Button variant="ghost" size="sm" iconOnly aria-label={`Duplicate ${item.title}`} title="Duplicate" iconLeft={<LucideIcon name="CopyPlus" size={14} />} onClick={() => { onClose(); onDuplicate(item); }} /> : null}
          {item.cancelable && onDelete ? <Button class="is-danger" variant="ghost" size="sm" iconOnly aria-label={`Delete ${item.title}`} title="Delete" iconLeft={<LucideIcon name="Trash2" size={14} />} onClick={() => { onClose(); onDelete(item); }} /> : null}
          <Button variant="ghost" size="sm" iconOnly aria-label="Close preview" title="Close" iconLeft={<LucideIcon name="X" size={15} />} onClick={onClose} />
        </div>
      </header>
      <div class="cal-item-preview-facts">
        <p><LucideIcon name="Clock3" size={15} /><span>{scheduleLabel(item)}</span></p>
        {item.locationLabel ? <p><LucideIcon name="MapPin" size={15} /><span>{item.locationLabel}</span></p> : null}
        {item.calendarName ? <p><LucideIcon name="CalendarRange" size={15} /><span>{item.calendarName}</span></p> : null}
        {item.deadlineAt ? <p class="cal-item-preview-deadline"><LucideIcon name="Flag" size={15} /><span><small>Deadline</small><strong>{deadlineLabel(item.deadlineAt)}</strong></span></p> : null}
        {reminderLabel ? <div class="cal-item-preview-reminder">
          <p><LucideIcon name="AlarmClock" size={15} /><span><small>Reminder</small><strong>{reminderLabel}</strong></span></p>
          {onSetReminder ? <Button variant="ghost" size="sm" onClick={() => { onClose(); onSetReminder(item); }}>Change</Button> : null}
        </div> : null}
      </div>
      <section class="cal-item-preview-about">
        <strong>{aboutLabel(kind)}</strong>
        {kind === 'meeting' && agendaItems.length
          ? <ul>{agendaItems.map(entry => <li key={entry}>{entry}</li>)}</ul>
          : <p>{item.notes?.trim() || (kind === 'meeting' ? 'No agenda items were added.' : 'No additional details were added.')}</p>}
      </section>
      {people.length ? <div class="cal-item-preview-people"><AvatarGroup people={people} max={3} size={26} totalCount={Math.max(item.attendeeCount, people.length)} label={`${item.title} people`} /><span>{item.type === 'task' ? 'Owner and collaborators' : 'Organizer and invitees'}</span></div> : null}
      <footer>
        {onOpenSource ? <Button variant="secondary" size="sm" iconLeft={<LucideIcon name="ExternalLink" size={14} />} onClick={() => { onClose(); onOpenSource(item); }}>{sourceActionLabel(item)}</Button> : null}
        {item.editable && onEdit ? <Button variant="primary" size="sm" iconLeft={<LucideIcon name="Pencil" size={14} />} onClick={() => { onClose(); onEdit(item); }}>Edit</Button> : null}
      </footer>
    </article>
  </Popover>;
}
