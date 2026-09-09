import { type VNode } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import {
  useCalendarDepartments,
  useCalendarCategories,
  useCalendarItem,
  useCalendarReminders,
  useSetCalendarReminders,
  useUpdateEntry,
  type CalendarColorKey,
  type CalendarCategoryDTO,
  type CalendarItemDTO,
  type CalendarCollectionDTO,
  type CalendarTaskPriority,
  type CalendarTitleIconType,
  type CalendarVisibility,
  type RecurrenceScope,
  type UpdateEntryRequest,
} from '@api/calendar';
import { useMessageRecipients, type MessageRecipient } from '@api/communications';
import { itemDateKey, itemEndDateKey, localTimestamp, localTimeValue, toLocalDateKey } from '@lib/calendar/date';
import { Button, Checkbox, DateInput, Drawer, FormField, FormGrid2, LucideIcon, Select, Textarea, TextInput, TimeInput, type PersonOption } from '@ui';
import { CalendarColorPicker } from './CalendarColorPicker';
import { CalendarPeoplePicker } from './CalendarPeoplePicker';
import { CalendarTitleIconPicker } from './CalendarTitleIconPicker';

const EMPTY_PEOPLE: readonly PersonOption[] = [];

export interface CalendarPreviewEditorDetails {
  people: readonly PersonOption[];
  reminderOffsets: readonly number[];
}

function recipientName(person: MessageRecipient): string {
  const displayName = person.displayName?.trim();
  if (displayName) return displayName;
  const username = person.username?.trim();
  return username && username.length > 0 ? username : 'SIOMAC employee';
}

export function CalendarItemEditor({ open = true, item, calendars = [], preview = false, titleIconMode = 'emoji', previewPeople = EMPTY_PEOPLE, previewDirectory = EMPTY_PEOPLE, previewCategories = [], previewReminderOffset = null, onPreviewSave, onColourPreview, onClose }: {
  open?: boolean;
  item: CalendarItemDTO | null;
  calendars?: readonly CalendarCollectionDTO[];
  preview?: boolean;
  titleIconMode?: CalendarTitleIconType;
  previewPeople?: readonly PersonOption[];
  previewDirectory?: readonly PersonOption[];
  previewCategories?: readonly CalendarCategoryDTO[];
  previewReminderOffset?: number | null;
  onPreviewSave?: (item: CalendarItemDTO, patch: UpdateEntryRequest['patch'], details: CalendarPreviewEditorDetails) => void;
  onColourPreview?: (item: CalendarItemDTO, colorKey: CalendarColorKey | null, customColor: string | null) => void;
  onClose: () => void;
}): VNode | null {
  const [title, setTitle] = useState('');
  const [titleIconType, setTitleIconType] = useState<CalendarTitleIconType | null>(null);
  const [titleIconValue, setTitleIconValue] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('10:00');
  const [allDay, setAllDay] = useState(false);
  const [locationLabel, setLocationLabel] = useState('');
  const [priority, setPriority] = useState<CalendarTaskPriority>('medium');
  const [colorKey, setColorKey] = useState<CalendarColorKey | null>(null);
  const [customColor, setCustomColor] = useState<string | null>(null);
  const [calendarId, setCalendarId] = useState('');
  const [visibility, setVisibility] = useState<CalendarVisibility>('personal');
  const [departmentId, setDepartmentId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [availability, setAvailability] = useState<'busy' | 'free' | 'tentative' | 'out_of_office'>('busy');
  const [recurrenceRule, setRecurrenceRule] = useState('');
  const [reminderOffset, setReminderOffset] = useState('none');
  const [deadlineEnabled, setDeadlineEnabled] = useState(false);
  const [deadlineDate, setDeadlineDate] = useState('');
  const [deadlineTime, setDeadlineTime] = useState('17:00');
  const [assigneeUserId, setAssigneeUserId] = useState<string | null>(null);
  const [attendeeUserIds, setAttendeeUserIds] = useState<string[]>([]);
  const [peopleSearch, setPeopleSearch] = useState('');
  const [scope, setScope] = useState<RecurrenceScope>('series');
  const [error, setError] = useState<string | null>(null);
  const update = useUpdateEntry();
  const setReminders = useSetCalendarReminders();
  const nativeId = !preview && item?.origin === 'calendar' ? item.id.split('::')[0] ?? null : null;
  const detail = useCalendarItem(nativeId);
  const reminders = useCalendarReminders(nativeId);
  const departments = useCalendarDepartments(Boolean(item?.editable));
  const categories = useCalendarCategories(Boolean(item?.editable && !preview));
  const directory = useMessageRecipients(peopleSearch, { enabled: Boolean(item?.editable && (item.type === 'activity' || item.assignable)) && !preview });
  const previewPeopleSignature = previewPeople.map(person => person.id).join('\u0000');

  useEffect(() => {
    if (!item) return;
    const firstDay = itemDateKey(item) ?? toLocalDateKey(new Date());
    setTitle(item.title);
    setTitleIconType(item.titleIconType ?? null);
    setTitleIconValue(item.titleIconValue ?? null);
    setNotes(item.notes ?? '');
    setStartDate(firstDay);
    setEndDate(itemEndDateKey(item) ?? firstDay);
    setStartTime(localTimeValue(item.startsAt, '09:00'));
    setEndTime(localTimeValue(item.endsAt, '10:00'));
    setAllDay(item.allDay);
    setLocationLabel(item.locationLabel ?? '');
    setPriority(item.priority ?? 'medium');
    setColorKey(item.colorKey);
    setCustomColor(item.customColor);
    setCalendarId(item.calendarId ?? '');
    setVisibility(item.visibility ?? 'personal');
    setDepartmentId(item.departmentId ?? '');
    setCategoryId(item.categoryId ?? '');
    setAvailability(item.availability ?? 'busy');
    setRecurrenceRule(item.recurrenceRule ?? '');
    setReminderOffset(preview && previewReminderOffset !== null ? String(previewReminderOffset) : 'none');
    setDeadlineEnabled(Boolean(item.deadlineAt));
    setDeadlineDate(item.deadlineAt ? toLocalDateKey(new Date(item.deadlineAt)) : itemEndDateKey(item) ?? firstDay);
    setDeadlineTime(localTimeValue(item.deadlineAt ?? null, '17:00'));
    setAssigneeUserId(item.assigneeUserId);
    setAttendeeUserIds(preview ? previewPeople.map(person => person.id) : []);
    setScope('series');
    setError(null);
  }, [item, preview, previewPeopleSignature, previewReminderOffset]);

  useEffect(() => {
    if (!item || calendarId || item.calendarId) return;
    const fallbackId = calendars.find(calendar => calendar.isDefault)?.id ?? calendars[0]?.id;
    if (fallbackId) setCalendarId(fallbackId);
  }, [calendarId, calendars, item]);

  useEffect(() => {
    if (!preview && detail.data?.attendees) setAttendeeUserIds(detail.data.attendees.map(attendee => attendee.userId));
  }, [detail.data?.attendees, preview]);

  useEffect(() => {
    if (!nativeId || reminders.data === undefined) return;
    setReminderOffset(reminders.data[0] === undefined ? 'none' : String(reminders.data[0]));
  }, [nativeId, reminders.data]);

  if (!item) return null;
  const kind = item.kind;
  const dueSchedule = kind === 'deadline';
  const supportsDeadline = kind === 'event' || kind === 'task';
  const timed = !allDay;
  const scheduleValid = Boolean(startDate && endDate) && endDate >= startDate
    && (!timed || localTimestamp(endDate, endTime) > localTimestamp(startDate, startTime));
  const deadlineValid = !deadlineEnabled || Boolean(deadlineDate && deadlineTime);
  const valid = Boolean(calendarId && categoryId) && title.trim().length > 0 && scheduleValid && deadlineValid && (visibility !== 'team' || Boolean(departmentId));
  const recurrence = Boolean(item.recurrenceSeriesId ?? item.recurrenceRule ?? item.occurrenceDate);
  const directoryPeople: PersonOption[] = (directory.data ?? []).map(person => ({ id: person.userId, name: recipientName(person), jobTitle: person.role, department: person.department, photoUrl: person.profileImage }));
  const peopleById = new Map<string, PersonOption>();
  [...previewDirectory, ...previewPeople, ...directoryPeople].forEach(person => peopleById.set(person.id, person));
  const availablePeople = [...peopleById.values()];
  if (item.assigneeUserId && !peopleById.has(item.assigneeUserId)) {
    const currentAssignee = { id: item.assigneeUserId, name: item.assigneeName ?? 'Current assignee' };
    peopleById.set(currentAssignee.id, currentAssignee);
    availablePeople.unshift(currentAssignee);
  }
  const selectedAttendees = attendeeUserIds.map(userId => peopleById.get(userId) ?? { id: userId, name: 'SIOMAC employee' });
  const selectedAssignee = assigneeUserId ? [peopleById.get(assigneeUserId) ?? { id: assigneeUserId, name: item.assigneeName ?? 'Current assignee' }] : [];
  const categoryOptions = preview
    ? previewCategories.map(category => ({ value: category.id, label: category.name }))
    : (categories.data ?? []).map(category => ({ value: category.id, label: category.name }));

  const save = async (): Promise<void> => {
    if (!valid || update.isPending || setReminders.isPending) return;
    const patch: UpdateEntryRequest['patch'] = {
      title: title.trim(),
      notes: notes.trim() || null,
      ...(timed
        ? { allDay: false, startsOn: null, endsOn: null, startsAt: localTimestamp(startDate, startTime), endsAt: localTimestamp(endDate, endTime) }
        : { allDay: true, startsOn: startDate, endsOn: endDate, startsAt: null, endsAt: null }),
      ...(item.type === 'task' && scope === 'series' ? { priority } : {}),
      ...(item.type === 'task' && item.assignable && scope === 'series' ? { assigneeUserId } : {}),
      ...(item.type === 'activity' && scope === 'series' ? { attendeeUserIds } : {}),
      ...(scope === 'series' ? {
        titleIconType,
        titleIconValue,
        visibility,
        departmentId: visibility === 'team' && departmentId ? departmentId : null,
        locationLabel: locationLabel.trim() || null,
        colorKey: customColor ? null : colorKey,
        customColor,
        calendarId,
        categoryId,
        recurrenceRule: recurrenceRule || null,
        ...(supportsDeadline ? { deadlineAt: deadlineEnabled ? localTimestamp(deadlineDate, deadlineTime) : null } : {}),
        ...(item.type === 'activity' ? { availability } : {}),
      } : {}),
    };
    if (preview && onPreviewSave) {
      onPreviewSave(item, patch, {
        people: item.type === 'activity' ? selectedAttendees : selectedAssignee,
        reminderOffsets: reminderOffset === 'none' ? [] : [Number(reminderOffset)],
      });
      onClose();
      return;
    }
    setError(null);
    try {
      const response = await update.mutateAsync({
        id: item.id,
        ...(recurrence ? { scope, ...(scope === 'occurrence' && item.occurrenceDate ? { occurrenceDate: item.occurrenceDate } : {}) } : {}),
        patch,
      });
      if (!response.success) {
        setError(response.message ?? 'The calendar card could not be saved.');
        return;
      }
      if (nativeId && scope === 'series') {
        const reminderResponse = await setReminders.mutateAsync({ id: nativeId, offsetMinutes: reminderOffset === 'none' ? [] : [Number(reminderOffset)] });
        if (!reminderResponse.success) {
          setError(reminderResponse.message ?? 'The item was saved, but its reminder could not be updated.');
          return;
        }
      }
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The calendar card could not be saved.');
    }
  };

  const peopleContent = <div class="cal-editor-section-content">
    {item.type === 'task' ? <FormField label="Assignee"><CalendarPeoplePicker mode="task" people={availablePeople} selected={selectedAssignee} onAdd={setAssigneeUserId} onRemove={() => setAssigneeUserId(null)} onSearch={setPeopleSearch} loading={directory.isFetching} error={directory.isError ? 'The employee directory could not be loaded.' : null} disabled={!item.assignable} /></FormField> : <FormField label="Invitees"><CalendarPeoplePicker mode="event" people={availablePeople} selected={selectedAttendees} onAdd={userId => setAttendeeUserIds(ids => [...new Set([...ids, userId])])} onRemove={userId => setAttendeeUserIds(ids => ids.filter(id => id !== userId))} onSearch={setPeopleSearch} loading={directory.isFetching} error={directory.isError ? 'The employee directory could not be loaded.' : null} readOnly={Boolean(item.sourceModule)} /></FormField>}
    <FormField label="Audience"><Select value={visibility} onChange={value => setVisibility(value as CalendarVisibility)} options={[{ value: 'personal', label: item.type === 'activity' ? 'Invitees only' : 'Personal' }, { value: 'team', label: 'Department' }, { value: 'org', label: 'Entire organisation' }]} /></FormField>
    {visibility === 'team' ? <FormField label="Department"><Select value={departmentId} onChange={setDepartmentId} options={[{ value: '', label: 'Select department' }, ...(departments.data ?? []).map(department => ({ value: department.id, label: department.name }))]} searchable disabled={departments.isLoading} /></FormField> : null}
  </div>;
  const pending = update.isPending || setReminders.isPending;
  return <Drawer open={open} contained title={`Edit ${kind}`} sub={item.title} headIcon={<LucideIcon name="PencilLine" size={19} />} panelClass="cal-side-rail cal-item-editor-drawer" closeLabel="Close calendar editor" onClose={onClose} foot={<Button variant="primary" tone="success" loading={pending} loadingText="Saving…" disabled={!valid} iconLeft={<LucideIcon name="Save" size={16} />} onClick={() => void save()}>Save Changes</Button>}>
    <div class="cal-item-editor-body">
      {error ? <div class="cal-form-error" role="alert"><LucideIcon name="CircleAlert" size={15} />{error}</div> : null}
      <section class="cal-editor-primary" aria-label="Calendar item details">
        <FormField label="Title" required charCount={{ value: title.length, max: 200 }}><div class="cal-title-field-row"><CalendarTitleIconPicker mode={titleIconMode} type={titleIconType} value={titleIconValue} disabled={scope === 'occurrence'} onChange={(type, value) => { setTitleIconType(type); setTitleIconValue(value); }} /><TextInput value={title} onInput={setTitle} maxLength={200} autoFocus /></div></FormField>
        <FormGrid2><FormField label="Calendar" required><Select value={calendarId} onChange={setCalendarId} options={calendars.map(calendar => ({ value: calendar.id, label: `${calendar.name}${calendar.isDefault ? ' · Default' : ''}` }))} disabled={!calendars.length || scope === 'occurrence'} /></FormField><FormField label="Category" required error={!preview && categories.isError ? 'Categories could not be loaded.' : undefined}><Select value={categoryId} onChange={setCategoryId} options={categoryOptions} searchable disabled={(!preview && categories.isLoading) || !categoryOptions.length || scope === 'occurrence'} /></FormField></FormGrid2>
        <FormField label="Card Colour"><CalendarColorPicker value={customColor ? null : colorKey} customColor={customColor} onChange={next => { setColorKey(next); if (next) setCustomColor(null); onColourPreview?.(item, next, null); }} onCustomColorChange={next => { setCustomColor(next); if (next) setColorKey(null); onColourPreview?.(item, null, next); }} allowAutomatic allowCustom disabled={update.isPending || scope === 'occurrence'} label="Edit card colour" /></FormField>
        <div class="cal-editor-all-day">
          <Checkbox checked={allDay} onChange={setAllDay} label="All Day" />
          <div><strong>All-Day Event</strong><span>Schedule this item across one or more dates without assigning specific start or end times.</span></div>
        </div>
        <FormGrid2><FormField label="Start Date" required><DateInput value={startDate} onChange={value => { setStartDate(value); if (endDate < value) setEndDate(value); }} /></FormField><FormField label={dueSchedule ? 'Due Date' : 'End Date'} required><DateInput min={startDate} value={endDate} onChange={setEndDate} /></FormField>{timed ? <><FormField label="Start Time" required><TimeInput value={startTime} onChange={setStartTime} step={900} /></FormField><FormField label={dueSchedule ? 'Due Time' : 'End Time'} required error={!scheduleValid ? 'Must be after the start.' : undefined}><TimeInput value={endTime} onChange={setEndTime} step={900} /></FormField></> : null}</FormGrid2>
        {supportsDeadline ? <div class={`cal-editor-deadline${deadlineEnabled ? ' is-enabled' : ''}`}>
          <div class="cal-editor-deadline-toggle"><Checkbox checked={deadlineEnabled} onChange={setDeadlineEnabled} label="Set Deadline" disabled={scope === 'occurrence'} /><div><strong>Deadline</strong><span>{kind === 'task' ? 'Set when this task must be completed.' : 'Set the last date and time for registration, RSVP, or any required action.'}</span></div></div>
          {deadlineEnabled ? <FormGrid2><FormField label="Deadline Date" required><DateInput value={deadlineDate} onChange={setDeadlineDate} disabled={scope === 'occurrence'} /></FormField><FormField label="Deadline Time" required><TimeInput value={deadlineTime} onChange={setDeadlineTime} step={900} disabled={scope === 'occurrence'} /></FormField></FormGrid2> : null}
        </div> : null}
        <FormGrid2><FormField label="Repeat"><Select value={recurrenceRule} onChange={setRecurrenceRule} options={[{ value: '', label: 'Does not repeat' }, { value: 'FREQ=DAILY', label: 'Daily' }, { value: 'FREQ=WEEKLY', label: 'Weekly' }, { value: 'FREQ=MONTHLY', label: 'Monthly' }]} disabled={scope === 'occurrence'} /></FormField><FormField label="Reminder"><Select value={reminderOffset} onChange={setReminderOffset} options={[{ value: 'none', label: 'No reminder' }, { value: '0', label: 'At start' }, { value: '15', label: '15 minutes before' }, { value: '60', label: '1 hour before' }, { value: '1440', label: '1 day before' }]} disabled={scope === 'occurrence' || reminders.isLoading} /></FormField></FormGrid2>
        {item.type === 'task' ? <FormField label="Priority"><Select value={priority} onChange={value => setPriority(value as CalendarTaskPriority)} options={[{ value: 'high', label: 'High' }, { value: 'medium', label: 'Medium' }, { value: 'low', label: 'Low' }]} /></FormField> : <FormGrid2><FormField label="Location"><TextInput value={locationLabel} onInput={setLocationLabel} maxLength={240} placeholder="Add a location" iconLeft={<LucideIcon name="MapPin" size={14} />} disabled={scope === 'occurrence'} /></FormField><FormField label="Availability"><Select value={availability} onChange={value => setAvailability(value as typeof availability)} options={[{ value: 'busy', label: 'Busy' }, { value: 'free', label: 'Free' }, { value: 'tentative', label: 'Tentative' }, { value: 'out_of_office', label: 'Out of office' }]} disabled={scope === 'occurrence'} /></FormField></FormGrid2>}
        <FormField label={kind === 'meeting' ? 'What we’ll cover' : 'Description'} charCount={{ value: notes.length, max: 4000 }}><Textarea rows={3} value={notes} onInput={setNotes} maxLength={4000} placeholder={kind === 'meeting' ? 'Add each agenda item on a new line…' : 'Purpose, preparation or expected outcome…'} /></FormField>
        {recurrence ? <div class="cal-main-editor-scope"><span>Apply changes to</span><Button variant={scope === 'occurrence' ? 'primary' : 'secondary'} size="sm" disabled={!item.occurrenceDate} onClick={() => setScope('occurrence')}>This occurrence</Button><Button variant={scope === 'series' ? 'primary' : 'secondary'} size="sm" onClick={() => setScope('series')}>Entire series</Button></div> : null}
      </section>
      <section class="cal-editor-people-section" aria-labelledby="cal-editor-people-title">
        <header>
          <h3 id="cal-editor-people-title">{item.type === 'task' ? 'Assignment & Visibility' : 'Participants & Visibility'}</h3>
          <p>{item.type === 'task' ? 'Assign responsibility and control who can access this task.' : 'Select the people involved and control who can view this event.'}</p>
        </header>
        {peopleContent}
      </section>
    </div>
  </Drawer>;
}
