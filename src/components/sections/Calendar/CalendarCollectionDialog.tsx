import { type VNode } from 'preact';
import { useEffect, useMemo, useState } from 'preact/hooks';
import {
  useArchiveCalendarCollection,
  useCalendarDepartments,
  useCreateCalendarCollection,
  useUpdateCalendarCollection,
  type CalendarCollectionDTO,
  type CalendarColorKey,
  type CalendarVisibility,
} from '@api/calendar';
import { useSessionStore } from '@store/session';
import { can } from '@lib/permissions';
import { Button, Checkbox, Dialog, FormField, FormGrid2, LucideIcon, Select, Textarea, TextInput } from '@ui';
import { CalendarColorPicker } from './CalendarColorPicker';

function requestKey(): string {
  return typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `calendar-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function CalendarCollectionEditor({ calendar = null, onCancel, onComplete, embedded = false }: {
  calendar?: CalendarCollectionDTO | null;
  onCancel: () => void;
  onComplete: () => void;
  embedded?: boolean;
}): VNode {
  const currentDepartmentId = useSessionStore(state => state.departmentId);
  const canManageCalendar = can('calendar.manage');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [visibility, setVisibility] = useState<CalendarVisibility>('personal');
  const [departmentId, setDepartmentId] = useState('');
  const [colorKey, setColorKey] = useState<CalendarColorKey>('blue');
  const [customColor, setCustomColor] = useState<string | null>(null);
  const [makeDefault, setMakeDefault] = useState(false);
  const [idempotencyKey, setIdempotencyKey] = useState(requestKey);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const departments = useCalendarDepartments(visibility === 'team');
  const createCalendar = useCreateCalendarCollection();
  const updateCalendar = useUpdateCalendarCollection();
  const archiveCalendar = useArchiveCalendarCollection();

  useEffect(() => {
    setName(calendar?.name ?? '');
    setDescription(calendar?.description ?? '');
    setVisibility(calendar?.visibility ?? 'personal');
    setDepartmentId(calendar?.departmentId ?? currentDepartmentId ?? '');
    setColorKey(calendar?.colorKey ?? 'blue');
    setCustomColor(calendar?.customColor ?? null);
    setMakeDefault(calendar?.isDefault ?? false);
    setIdempotencyKey(requestKey());
    setConfirmArchive(false);
    setError(null);
  }, [calendar, currentDepartmentId]);

  const departmentOptions = useMemo(() => [
    { value: '', label: 'Choose a department' },
    ...(departments.data ?? [])
      .filter(department => canManageCalendar || department.id === currentDepartmentId)
      .map(department => ({ value: department.id, label: department.name })),
  ], [canManageCalendar, currentDepartmentId, departments.data]);
  const pending = createCalendar.isPending || updateCalendar.isPending || archiveCalendar.isPending;
  const valid = name.trim().length > 0 && (visibility !== 'team' || Boolean(departmentId));

  const save = async (): Promise<void> => {
    if (!valid || pending) return;
    setError(null);
    const payload = {
      idempotencyKey,
      name: name.trim(),
      description: description.trim() || null,
      visibility,
      departmentId: visibility === 'team' ? departmentId : null,
      colorKey: customColor ? null : colorKey,
      customColor,
      makeDefault,
    };
    try {
      const response = calendar
        ? await updateCalendar.mutateAsync({ id: calendar.id, ...payload })
        : await createCalendar.mutateAsync(payload);
      if (!response.success) {
        setError(response.message ?? `The calendar could not be ${calendar ? 'updated' : 'created'}.`);
        return;
      }
      onComplete();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The calendar could not be saved.');
    }
  };

  const archive = async (): Promise<void> => {
    if (!calendar?.canArchive || pending) return;
    if (!confirmArchive) {
      setConfirmArchive(true);
      return;
    }
    setError(null);
    try {
      const response = await archiveCalendar.mutateAsync({ id: calendar.id, idempotencyKey });
      if (!response.success) {
        setError(response.message ?? 'The calendar could not be archived.');
        return;
      }
      onComplete();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The calendar could not be archived.');
    }
  };

  const editing = Boolean(calendar);
  return (
    <div class={`cal-collection-editor${embedded ? ' is-embedded' : ''}`} aria-label={editing ? `${calendar?.name} calendar settings` : 'New calendar settings'}>
      <Dialog.Content class="cal-collection-content">
          {error ? <div class="cal-form-error" role="alert"><LucideIcon name="CircleAlert" size={16} />{error}</div> : null}
          <Dialog.Section title="Calendar Details" desc="Use a clear name so people know what belongs here.">
            <FormField label="Calendar Name" required charCount={{ value: name.length, max: 80 }}>
              <TextInput value={name} onInput={setName} maxLength={80} autoFocus placeholder="Operations schedule" />
            </FormField>
            <FormField label="Description" charCount={{ value: description.length, max: 400 }}>
              <Textarea rows={2} value={description} onInput={setDescription} maxLength={400} placeholder="What this calendar is used for" />
            </FormField>
          </Dialog.Section>
          <Dialog.Section title="Access" desc="Choose who can discover this calendar. Event invitations still grant access to invited employees.">
            <FormGrid2>
              <FormField label="Audience">
                <Select value={visibility} onChange={value => setVisibility(value as CalendarVisibility)} options={[
                  { value: 'personal', label: 'Only me' },
                  { value: 'team', label: 'Department' },
                  ...(canManageCalendar ? [{ value: 'org', label: 'Entire organisation' }] : []),
                ]} />
              </FormField>
              {visibility === 'team' ? <FormField label="Department" required>
                <Select value={departmentId} onChange={setDepartmentId} options={departmentOptions} searchable disabled={departments.isLoading} />
              </FormField> : <div class="cal-collection-access-note"><LucideIcon name={visibility === 'org' ? 'Building2' : 'LockKeyhole'} size={17} /><span>{visibility === 'org' ? 'Everyone in SIOMAC can add this calendar to their view.' : 'Only you can see the calendar unless an event invites someone.'}</span></div>}
            </FormGrid2>
          </Dialog.Section>
          <Dialog.Section title="Appearance" desc="This colour is the default identity for new events in the calendar.">
            <FormField label="Calendar Colour">
              <CalendarColorPicker value={customColor ? null : colorKey} customColor={customColor} onChange={value => { if (value) setColorKey(value); }} onCustomColorChange={setCustomColor} allowCustom disabled={pending} label="Calendar colour" />
            </FormField>
            <Checkbox checked={makeDefault} disabled={Boolean(calendar?.isDefault)} onChange={setMakeDefault} label={calendar?.isDefault ? 'Default calendar' : 'Use as my default calendar'} />
          </Dialog.Section>
          {editing && calendar?.canArchive ? <Dialog.Section title="Calendar Lifecycle" desc="Archived calendars disappear from My Calendars, but their historical entries remain available for audit.">
            <div class={`cal-collection-archive${confirmArchive ? ' is-confirming' : ''}`}>
              <span><strong>{confirmArchive ? 'Archive this calendar?' : 'Archive calendar'}</strong><small>{confirmArchive ? 'Existing events remain intact and are removed from the active calendar view.' : 'Use this when the calendar is no longer active.'}</small></span>
              <Button variant={confirmArchive ? 'danger' : 'secondary'} size="sm" onClick={() => void archive()} disabled={pending}>{confirmArchive ? 'Confirm Archive' : 'Archive'}</Button>
            </div>
          </Dialog.Section> : null}
      </Dialog.Content>
      <div class="cal-collection-editor-footer">
        <Button variant="secondary" onClick={onCancel} disabled={pending}>Cancel</Button>
        <Button variant="primary" onClick={() => void save()} disabled={!valid || pending} iconLeft={<LucideIcon name="Save" size={16} />}>{pending ? 'Saving…' : editing ? 'Save Changes' : 'Create Calendar'}</Button>
      </div>
    </div>
  );
}

export function CalendarCollectionDialog({ open, calendar = null, onClose }: {
  open: boolean;
  calendar?: CalendarCollectionDTO | null;
  onClose: () => void;
}): VNode | null {
  if (!open) return null;
  const editing = Boolean(calendar);
  return (
    <Dialog open={open} onClose={onClose} size="lg" variant="form" closeOnBackdrop={false} class="cal-collection-dialog">
      <Dialog.Header
        title={editing ? 'Calendar Settings' : 'Create Calendar'}
        sub={editing ? 'Manage this calendar’s identity, access and default behaviour.' : 'Create a separate calendar for a team, workstream or personal schedule.'}
        icon={<LucideIcon name={editing ? 'CalendarCog' : 'CalendarPlus'} />}
        onClose={onClose}
      />
      <Dialog.Body>
        <CalendarCollectionEditor calendar={calendar} onCancel={onClose} onComplete={onClose} />
      </Dialog.Body>
    </Dialog>
  );
}
