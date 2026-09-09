import { type VNode } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import {
  useCalendarReminders,
  useCancelEntry,
  useSetCalendarReminders,
  type CalendarItemDTO,
  type RecurrenceScope,
} from '@api/calendar';
import { dialog } from '@lib/dialog';
import { Button, Dialog, LucideIcon } from '@ui';

export type CalendarItemAction = 'reminder' | 'delete';

const REMINDER_OPTIONS = [
  { minutes: 0, label: 'At start' },
  { minutes: 15, label: '15 minutes before' },
  { minutes: 60, label: '1 hour before' },
  { minutes: 1440, label: '1 day before' },
] as const;

function deleteCopy(item: CalendarItemDTO, preview: boolean): string {
  if (preview) return 'This item will be removed from the staged calendar.';
  if (item.type === 'task') return 'The task will be cancelled and retained in the audit history.';
  return 'The event will be cancelled and retained in the audit history.';
}

/** SweetAlert2-backed destructive confirmation shared by click, context-menu and keyboard deletion. */
function CalendarDeleteConfirmation({ item, preview, onPreviewDelete, onClose }: {
  item: CalendarItemDTO;
  preview: boolean;
  onPreviewDelete?: (item: CalendarItemDTO) => void;
  onClose: () => void;
}): null {
  const cancel = useCancelEntry();
  const cancelRef = useRef(cancel);
  const closeRef = useRef(onClose);
  const previewDeleteRef = useRef(onPreviewDelete);

  useEffect(() => {
    cancelRef.current = cancel;
    closeRef.current = onClose;
    previewDeleteRef.current = onPreviewDelete;
  }, [cancel, onClose, onPreviewDelete]);

  useEffect(() => {
    const recurring = Boolean(item.occurrenceDate);
    let scope: RecurrenceScope = recurring ? 'occurrence' : 'series';

    const confirm = async (): Promise<void> => {
      const accepted = await dialog.confirm({
        title: `Delete “${item.title}”?`,
        text: recurring ? undefined : deleteCopy(item, preview),
        danger: true,
        confirmText: item.type === 'task' ? 'Delete task' : 'Delete event',
        panelClass: 'cal-delete-confirm',
        renderContent: recurring ? (container) => {
          const copy = document.createElement('p');
          copy.className = 'cal-delete-confirm-copy';
          copy.textContent = 'Choose whether to remove this occurrence or the complete recurring series.';
          const group = document.createElement('div');
          group.className = 'cal-delete-confirm-scope';
          group.setAttribute('role', 'group');
          group.setAttribute('aria-label', 'Delete recurrence scope');
          const occurrence = document.createElement('button');
          occurrence.type = 'button';
          occurrence.textContent = 'This occurrence';
          const series = document.createElement('button');
          series.type = 'button';
          series.textContent = 'Entire series';
          const choose = (next: RecurrenceScope): void => {
            scope = next;
            occurrence.setAttribute('aria-pressed', `${next === 'occurrence'}`);
            series.setAttribute('aria-pressed', `${next === 'series'}`);
          };
          const chooseOccurrence = (): void => choose('occurrence');
          const chooseSeries = (): void => choose('series');
          occurrence.addEventListener('click', chooseOccurrence);
          series.addEventListener('click', chooseSeries);
          choose(scope);
          group.append(occurrence, series);
          container.append(copy, group);
          return () => {
            occurrence.removeEventListener('click', chooseOccurrence);
            series.removeEventListener('click', chooseSeries);
          };
        } : undefined,
      });
      if (!accepted) {
        closeRef.current();
        return;
      }
      if (preview) {
        previewDeleteRef.current?.(item);
        closeRef.current();
        return;
      }
      try {
        const response = await cancelRef.current.mutateAsync({
          id: item.id,
          ...(item.occurrenceDate || item.recurrenceRule ? { scope } : {}),
          ...(scope === 'occurrence' && item.occurrenceDate ? { occurrenceDate: item.occurrenceDate } : {}),
        });
        if (!response.success) await dialog.error('Calendar item not deleted', response.message ?? 'The calendar item could not be deleted.');
      } catch (cause) {
        await dialog.error('Calendar item not deleted', cause instanceof Error ? cause.message : 'The calendar item could not be deleted.');
      } finally {
        closeRef.current();
      }
    };

    void confirm();
    return undefined;
  }, [item.id]);

  return null;
}

function CalendarReminderDialog({ item, onClose }: { item: CalendarItemDTO; onClose: () => void }): VNode {
  const nativeId = item.origin === 'calendar' ? (item.id.split('::')[0] ?? null) : null;
  const reminders = useCalendarReminders(nativeId);
  const setReminders = useSetCalendarReminders();
  const [offsets, setOffsets] = useState<number[]>([]);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    setActionError(null);
    setOffsets([]);
  }, [item.id]);

  useEffect(() => {
    if (reminders.data) setOffsets(reminders.data);
  }, [reminders.data]);

  const pending = setReminders.isPending;
  const toggleOffset = (minutes: number): void => setOffsets(current => current.includes(minutes)
    ? current.filter(offset => offset !== minutes)
    : [...current, minutes].sort((a, b) => a - b));

  const saveReminder = async (): Promise<void> => {
    if (!nativeId) return;
    setActionError(null);
    try {
      const response = await setReminders.mutateAsync({ id: nativeId, offsetMinutes: offsets });
      if (response.success) onClose();
      else setActionError(response.message ?? 'Reminder settings could not be saved.');
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : 'Reminder settings could not be saved.');
    }
  };

  return (
    <Dialog open onClose={onClose} size="sm" variant="standard" busy={pending} closeOnBackdrop={!pending} class="cal-action-dialog">
      <Dialog.Header title="Set reminder" sub="Calendar action" icon={<LucideIcon name="BellRing" size={18} />} onClose={onClose} />
      <Dialog.Body>
        <div class="cal-action-item-summary">
          <span><LucideIcon name="BellRing" size={18} /></span>
          <div><strong>{item.title}</strong><small>Choose when SIOMAC should notify you.</small></div>
        </div>
        {actionError ? <div class="cal-form-error" role="alert">{actionError}</div> : null}
        <div class="cal-action-reminder-options" aria-label="Reminder time">
          {REMINDER_OPTIONS.map(option => (
            <button type="button" key={option.minutes} aria-pressed={offsets.includes(option.minutes)} disabled={reminders.isLoading || pending} onClick={() => toggleOffset(option.minutes)}>
              <LucideIcon name={offsets.includes(option.minutes) ? 'Check' : 'Clock3'} size={14} />
              {option.label}
            </button>
          ))}
        </div>
      </Dialog.Body>
      <Dialog.Footer>
        <Button variant="secondary" disabled={pending} onClick={onClose}>Cancel</Button>
        <Button variant="primary" disabled={pending || reminders.isLoading} onClick={() => void saveReminder()}>
          {pending ? 'Working…' : 'Save reminder'}
        </Button>
      </Dialog.Footer>
    </Dialog>
  );
}

/** Mutation controller opened from calendar item actions. */
export function CalendarItemActionDialog({ item, action, preview = false, onPreviewDelete, onClose }: {
  item: CalendarItemDTO | null;
  action: CalendarItemAction | null;
  preview?: boolean;
  onPreviewDelete?: (item: CalendarItemDTO) => void;
  onClose: () => void;
}): VNode | null {
  if (!item || !action) return null;
  if (action === 'delete') return <CalendarDeleteConfirmation item={item} preview={preview} onPreviewDelete={onPreviewDelete} onClose={onClose} />;
  return <CalendarReminderDialog item={item} onClose={onClose} />;
}
