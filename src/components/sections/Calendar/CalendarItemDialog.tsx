import { type VNode } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import {
  useCalendarItem,
  useCancelEntry,
  useTaskStatus,
  useUpdateEntry,
  type CalendarItemDTO,
  type CalendarTaskPriority,
  type CalendarVisibility,
  type RecurrenceScope,
} from '@api/calendar';
import { showSection } from '@components/nav/navCore';
import { itemDateKey, longDayLabel, parseLocalDate, timeLabel } from '@lib/calendar/date';
import { sourceLabel, sourceTone } from './calendarViewModel';

export function CalendarItemDialog({ item, onClose }: { item: CalendarItemDTO | null; onClose: () => void }): VNode | null {
  const nativeId = item?.origin === 'calendar' ? item.id : null;
  const detail = useCalendarItem(nativeId);
  const current = item?.occurrenceDate && detail.data?.item
    ? { ...detail.data.item, ...item, attendeeCount: detail.data.item.attendeeCount }
    : detail.data?.item ?? item;
  const update = useUpdateEntry();
  const status = useTaskStatus();
  const cancel = useCancelEntry();
  const [editing, setEditing] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [priority, setPriority] = useState<CalendarTaskPriority>('medium');
  const [visibility, setVisibility] = useState<CalendarVisibility>('personal');
  const [scope, setScope] = useState<RecurrenceScope>('series');
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    if (!current) return;
    setTitle(current.title);
    setNotes(current.notes ?? '');
    setPriority(current.priority ?? 'medium');
    setVisibility(current.visibility ?? 'personal');
    setEditing(false);
    setConfirmCancel(false);
    setScope(current.occurrenceDate ? 'occurrence' : 'series');
    setActionError(null);
  }, [current?.id]);

  useEffect(() => {
    if (!item) return;
    const close = (event: KeyboardEvent): void => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [item, onClose]);

  if (!current) return null;
  const key = itemDateKey(current);
  const date = key ? parseLocalDate(key) : null;
  const recurrence = current.occurrenceDate || current.recurrenceRule;
  const actionArgs = { id: current.id, ...(recurrence ? { scope } : {}), ...(scope === 'occurrence' && current.occurrenceDate ? { occurrenceDate: current.occurrenceDate } : {}) };
  const pending = update.isPending || status.isPending || cancel.isPending;

  const save = async (): Promise<void> => {
    setActionError(null);
    try {
      const response = await update.mutateAsync({
        ...actionArgs,
        patch: {
          title: title.trim(),
          notes: notes.trim() || null,
          ...(current.type === 'task' ? { priority } : {}),
          visibility,
        },
      });
      if (response.success) { setEditing(false); onClose(); }
      else setActionError(response.message ?? 'The calendar item could not be saved.');
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : 'The calendar item could not be saved.');
    }
  };
  const setTaskStatus = async (next: 'done' | 'not_started'): Promise<void> => {
    setActionError(null);
    try {
      const response = await status.mutateAsync({ ...actionArgs, status: next });
      if (response.success) onClose();
      else setActionError(response.message ?? 'The task status could not be changed.');
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : 'The task status could not be changed.');
    }
  };
  const cancelItem = async (): Promise<void> => {
    setActionError(null);
    try {
      const response = await cancel.mutateAsync(actionArgs);
      if (response.success) onClose();
      else setActionError(response.message ?? `The ${current.type} could not be cancelled.`);
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : `The ${current.type} could not be cancelled.`);
    }
  };
  const drillThrough = (): void => {
    if (!current.sourceRoute) return;
    showSection(current.sourceRoute);
    onClose();
  };

  return (
    <div class="cal-modal-backdrop" onClick={event => { if (event.target === event.currentTarget && !pending) onClose(); }}>
      <section class="cal-modal" role="dialog" aria-modal="true" aria-labelledby="cal-detail-title">
        <header class="cal-modal-head">
          <div><span>{sourceLabel(current)}</span><h2 id="cal-detail-title">{current.title}</h2></div>
          <button type="button" onClick={onClose} disabled={pending} aria-label="Close"><i class="fas fa-times" /></button>
        </header>
        <div class="cal-modal-body">
          {actionError ? <div class="cal-form-error" role="alert">{actionError}</div> : null}
          <div class={`cal-detail-banner ${sourceTone(current)}`}>
            <span><i class={`fas ${current.type === 'deadline' ? 'fa-clock' : current.type === 'task' ? 'fa-list-check' : 'fa-calendar-day'}`} /></span>
            <div><small>{date ? longDayLabel(date) : 'Date unavailable'}</small><strong>{current.allDay ? 'All day' : current.startsAt ? timeLabel(current.startsAt) : 'Time pending'}</strong></div>
            <span class={`cal-status ${current.status ?? 'scheduled'}`}>{current.status?.replace(/_/g, ' ') ?? 'Scheduled'}</span>
          </div>

          {editing ? (
            <div class="cal-form cal-detail-edit">
              <label>Title<input value={title} maxLength={200} onInput={event => setTitle(event.currentTarget.value)} /></label>
              <label>Notes<textarea rows={4} value={notes} maxLength={4000} onInput={event => setNotes(event.currentTarget.value)} /></label>
              <div class="cal-form-grid">
                {current.type === 'task' ? <label>Priority<select value={priority} onChange={event => setPriority(event.currentTarget.value as CalendarTaskPriority)}><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></select></label> : null}
                <label>Visibility<select value={visibility} onChange={event => setVisibility(event.currentTarget.value as CalendarVisibility)}><option value="personal">Personal</option><option value="team">Team</option><option value="org">Organisation</option></select></label>
              </div>
            </div>
          ) : (
            <>
              {current.notes ? <p class="cal-detail-notes">{current.notes}</p> : null}
              <div class="cal-detail-grid">
                <div><span>Type</span><strong>{current.type}</strong></div>
                <div><span>Source</span><strong>{sourceLabel(current)}</strong></div>
                <div><span>Owner</span><strong>{current.ownerName ?? 'Module owned'}</strong></div>
                <div><span>Assignee</span><strong>{current.assigneeName ?? 'Unassigned'}</strong></div>
                <div><span>Priority</span><strong>{current.priority ?? 'Not applicable'}</strong></div>
                <div><span>Visibility</span><strong>{current.visibility ?? 'Source controlled'}</strong></div>
              </div>
            </>
          )}

          {recurrence ? <div class="cal-recurrence-choice"><span>Apply actions to</span><button type="button" class={scope === 'occurrence' ? 'active' : ''} disabled={!current.occurrenceDate} onClick={() => setScope('occurrence')}>This occurrence</button><button type="button" class={scope === 'series' ? 'active' : ''} onClick={() => setScope('series')}>Entire series</button></div> : null}
          {current.origin !== 'calendar' ? <div class="cal-readonly-note"><i class="fas fa-shield-halved" /><div><strong>Source-controlled item</strong><span>Calendar displays this record read-only. Open the source module to take action.</span></div></div> : null}
          {confirmCancel ? <div class="cal-confirm-row"><span>Cancel this {current.type}?</span><button type="button" onClick={() => setConfirmCancel(false)}>Keep</button><button type="button" class="danger" onClick={() => void cancelItem()}>Confirm cancel</button></div> : null}
        </div>
        <footer class="cal-modal-foot">
          {current.drillThrough && current.sourceRoute ? <button type="button" onClick={drillThrough}><i class="fas fa-arrow-up-right-from-square" /> Open source</button> : null}
          <span class="grow" />
          {editing ? <><button type="button" onClick={() => setEditing(false)}>Discard</button><button type="button" class="primary" disabled={!title.trim() || pending} onClick={() => void save()}>Save changes</button></>
            : <>
              {current.editable ? <button type="button" onClick={() => setEditing(true)}>Edit</button> : null}
              {current.completable ? <button type="button" class="primary" disabled={pending} onClick={() => void setTaskStatus(current.status === 'done' ? 'not_started' : 'done')}>{current.status === 'done' ? 'Reopen' : 'Complete'}</button> : null}
              {current.cancelable ? <button type="button" class="danger" disabled={pending} onClick={() => setConfirmCancel(true)}>Cancel</button> : null}
            </>}
        </footer>
      </section>
    </div>
  );
}
