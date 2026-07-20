import { type VNode } from 'preact';
import { useEffect, useMemo, useState } from 'preact/hooks';
import { useCreateActivity, useCreateTask, type CalendarVisibility } from '@api/calendar';
import { can } from '@lib/permissions';

type CreateType = 'task' | 'activity';

function localTimestamp(date: string, time: string): string {
  return new Date(`${date}T${time}:00`).toISOString();
}

export function CreateCalendarItemDialog({ open, initialDate, initialType = 'task', onClose }: {
  open: boolean;
  initialDate: string;
  initialType?: CreateType;
  onClose: () => void;
}): VNode | null {
  const allowedTask = can('calendar.task.manage_own');
  const allowedActivity = can('calendar.activity.manage_own');
  const permittedInitialType: CreateType = initialType === 'task' && allowedTask ? 'task' : allowedActivity ? 'activity' : 'task';
  const [type, setType] = useState<CreateType>(permittedInitialType);
  const [title, setTitle] = useState('');
  const [date, setDate] = useState(initialDate);
  const [allDay, setAllDay] = useState(true);
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('10:00');
  const [notes, setNotes] = useState('');
  const [priority, setPriority] = useState<'low' | 'medium' | 'high'>('medium');
  const [visibility, setVisibility] = useState<CalendarVisibility>('personal');
  const [recurrenceRule, setRecurrenceRule] = useState('');
  const [error, setError] = useState<string | null>(null);
  const task = useCreateTask();
  const activity = useCreateActivity();

  useEffect(() => {
    if (!open) return;
    setType(permittedInitialType);
    setDate(initialDate);
    setTitle('');
    setNotes('');
    setAllDay(true);
    setError(null);
  }, [open, initialDate, permittedInitialType]);

  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !task.isPending && !activity.isPending) onClose();
    };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [open, onClose, task.isPending, activity.isPending]);

  const pending = task.isPending || activity.isPending;
  const temporalError = !date ? 'Choose a date.'
    : !allDay && (!startTime || !endTime) ? 'Choose a start and end time.'
    : !allDay && endTime <= startTime ? 'End time must be after the start time.'
    : null;
  const valid = title.trim().length > 0 && !temporalError && (type === 'task' ? allowedTask : allowedActivity);

  const context = useMemo(() => [
    { label: 'Source', value: 'Calendar native item' },
    { label: 'Visibility', value: visibility === 'org' ? 'Organisation' : visibility === 'team' ? 'Team' : 'Personal' },
    { label: 'Audit', value: 'Event and activity log written on success' },
  ], [visibility]);

  if (!open) return null;

  const submit = async (): Promise<void> => {
    if (!valid) return;
    setError(null);
    try {
      if (type === 'task') {
        const response = await task.mutateAsync({
          title: title.trim(),
          notes: notes.trim() || null,
          allDay,
          ...(allDay ? { startsOn: date } : { startsAt: localTimestamp(date, startTime), endsAt: localTimestamp(date, endTime) }),
          priority,
          visibility,
          recurrenceRule: recurrenceRule || null,
        });
        if (!response.success) { setError(response.message ?? 'Task could not be created.'); return; }
      } else {
        const response = await activity.mutateAsync({
          title: title.trim(),
          notes: notes.trim() || null,
          allDay,
          ...(allDay ? { startsOn: date, endsOn: date } : { startsAt: localTimestamp(date, startTime), endsAt: localTimestamp(date, endTime) }),
          visibility,
          recurrenceRule: recurrenceRule || null,
        });
        if (!response.success) { setError(response.message ?? 'Activity could not be created.'); return; }
      }
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : `${type === 'task' ? 'Task' : 'Activity'} could not be created.`);
    }
  };

  return (
    <div class="cal-modal-backdrop" onClick={event => { if (event.target === event.currentTarget && !pending) onClose(); }}>
      <section class="cal-modal cal-create-modal" role="dialog" aria-modal="true" aria-labelledby="cal-create-title">
        <header class="cal-modal-head">
          <div><span>Calendar native item</span><h2 id="cal-create-title">New {type}</h2></div>
          <button type="button" onClick={onClose} disabled={pending} aria-label="Close"><i class="fas fa-times" /></button>
        </header>
        <div class="cal-create-switch" role="tablist" aria-label="Item type">
          {allowedTask ? <button type="button" role="tab" aria-selected={type === 'task'} class={type === 'task' ? 'active' : ''} onClick={() => setType('task')}><i class="fas fa-list-check" /> Task</button> : null}
          {allowedActivity ? <button type="button" role="tab" aria-selected={type === 'activity'} class={type === 'activity' ? 'active' : ''} onClick={() => setType('activity')}><i class="fas fa-calendar-day" /> Activity</button> : null}
        </div>
        <div class="cal-modal-body cal-create-layout">
          <div class="cal-form">
            {error ? <div class="cal-form-error" role="alert">{error}</div> : null}
            <label>Title<input autoFocus value={title} maxLength={200} onInput={event => setTitle(event.currentTarget.value)} placeholder={type === 'task' ? 'Review payroll inputs' : 'Team planning meeting'} /></label>
            <div class="cal-form-grid">
              <label>Date<input type="date" value={date} onInput={event => setDate(event.currentTarget.value)} /></label>
              <label class="cal-checkbox"><input type="checkbox" checked={allDay} onChange={event => setAllDay(event.currentTarget.checked)} /> All-day item</label>
            </div>
            {!allDay ? <div class="cal-form-grid"><label>Start time<input type="time" value={startTime} onInput={event => setStartTime(event.currentTarget.value)} /></label><label>End time<input type="time" value={endTime} onInput={event => setEndTime(event.currentTarget.value)} /></label></div> : null}
            {temporalError ? <small class="cal-field-error">{temporalError}</small> : null}
            <label>Notes<textarea rows={4} value={notes} maxLength={4000} onInput={event => setNotes(event.currentTarget.value)} placeholder="Add useful context…" /></label>
            <div class="cal-form-grid">
              {type === 'task' ? <label>Priority<select value={priority} onChange={event => setPriority(event.currentTarget.value as typeof priority)}><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></select></label> : null}
              <label>Visibility<select value={visibility} onChange={event => setVisibility(event.currentTarget.value as CalendarVisibility)}><option value="personal">Personal</option><option value="team">Team</option><option value="org">Organisation</option></select></label>
              <label>Recurrence<select value={recurrenceRule} onChange={event => setRecurrenceRule(event.currentTarget.value)}><option value="">Does not repeat</option><option value="FREQ=DAILY">Daily</option><option value="FREQ=WEEKLY">Weekly</option><option value="FREQ=MONTHLY">Monthly</option></select></label>
            </div>
          </div>
          <aside class="cal-create-context">
            <i class={`fas ${type === 'task' ? 'fa-list-check' : 'fa-calendar-day'}`} />
            <h3>{type === 'task' ? 'Task' : 'Activity'} context</h3>
            <p>{type === 'task' ? 'Tasks can be prioritised, completed and reopened.' : 'Activities represent meetings, visits and other scheduled work.'}</p>
            {context.map(row => <div key={row.label}><span>{row.label}</span><strong>{row.value}</strong></div>)}
          </aside>
        </div>
        <footer class="cal-modal-foot">
          <button type="button" onClick={onClose} disabled={pending}>Cancel</button>
          <button type="button" class="primary" onClick={() => void submit()} disabled={!valid || pending}>{pending ? 'Creating…' : `Create ${type}`}</button>
        </footer>
      </section>
    </div>
  );
}
