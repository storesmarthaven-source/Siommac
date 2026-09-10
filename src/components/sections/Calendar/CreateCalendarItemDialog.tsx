import { type VNode } from 'preact';
import { useEffect, useMemo, useState } from 'preact/hooks';
import {
  useCalendarCategories, useCalendarDepartments, useCreateActivity, useCreateTask,
  type CalendarCategoryDTO, type CalendarCollectionDTO, type CalendarColorKey, type CalendarEntryKind, type CalendarItemDTO, type CalendarTitleIconType, type CalendarVisibility,
} from '@api/calendar';
import { useMessageRecipients, type MessageRecipient } from '@api/communications';
import { useCreateMeeting } from '@api/meetings';
import { useSessionStore } from '@store/session';
import { can } from '@lib/permissions';
import { itemDateKey, itemEndDateKey, localTimestamp, toLocalDateKey } from '@lib/calendar/date';
import { Accordion, Button, Checkbox, DateInput, Drawer, FormField, FormGrid2, LucideIcon, SegmentedControl, Select, Textarea, TextInput, TimeInput, type PersonOption } from '@ui';
import { CalendarColorPicker } from './CalendarColorPicker';
import { CalendarPeoplePicker } from './CalendarPeoplePicker';
import { CalendarTitleIconPicker } from './CalendarTitleIconPicker';
import { type CalendarDraftSelection } from './TimeGridView';

export type CalendarCreateType = Exclude<CalendarEntryKind, 'deadline'>;

export interface CalendarPreviewCreateDraft {
  kind: CalendarCreateType;
  calendarId: string;
  categoryId: string;
  title: string;
  titleIconType: CalendarTitleIconType | null;
  titleIconValue: string | null;
  notes: string | null;
  allDay: boolean;
  startsOn: string | null;
  endsOn: string | null;
  startsAt: string | null;
  endsAt: string | null;
  deadlineAt: string | null;
  priority: 'low' | 'medium' | 'high';
  visibility: CalendarVisibility;
  departmentId: string | null;
  attendeeUserIds: string[];
  attendeePeople: PersonOption[];
  assigneeUserId: string | null;
  assignee: PersonOption | null;
  recurrenceRule: string | null;
  reminderOffsets: number[];
  colorKey: CalendarColorKey | null;
  customColor: string | null;
  locationLabel: string | null;
  availability: 'busy' | 'free' | 'tentative' | 'out_of_office';
}

function addMinutes(time: string, minutes: number): string {
  const [hour = '9', minute = '0'] = time.split(':');
  const total = Math.min((Number(hour) * 60) + Number(minute) + minutes, (23 * 60) + 59);
  return `${`${Math.floor(total / 60)}`.padStart(2, '0')}:${`${total % 60}`.padStart(2, '0')}`;
}

function personName(person: MessageRecipient): string {
  return person.displayName?.trim() || person.username?.trim() || 'SIOMAC employee';
}

function personOption(person: MessageRecipient): PersonOption {
  return { id: person.userId, name: personName(person), jobTitle: person.role, department: person.department, photoUrl: person.profileImage };
}

function messageRecipient(person: PersonOption): MessageRecipient {
  return { userId: person.id, displayName: person.name, email: null, role: person.jobTitle ?? undefined, department: person.department, profileImage: person.photoUrl };
}

function timeInputValue(iso: string | null | undefined, fallback: string): string {
  if (!iso) return fallback;
  const value = new Date(iso);
  if (Number.isNaN(value.getTime())) return fallback;
  return `${`${value.getHours()}`.padStart(2, '0')}:${`${value.getMinutes()}`.padStart(2, '0')}`;
}

function titleFor(kind: CalendarCreateType): string {
  if (kind === 'meeting') return 'Schedule Meeting';
  if (kind === 'reminder') return 'Add Reminder';
  return kind === 'task' ? 'Create Task' : 'Create Event';
}

function iconFor(kind: CalendarCreateType): 'Video' | 'BellRing' | 'ListChecks' | 'CalendarPlus' {
  if (kind === 'meeting') return 'Video';
  if (kind === 'reminder') return 'BellRing';
  return kind === 'task' ? 'ListChecks' : 'CalendarPlus';
}

export function CreateCalendarItemDialog({ open, calendars, categoriesOverride, preview = false, titleIconMode = 'emoji', previewSessionId = 0, initialCalendarId, initialDate, initialEndDate, initialTime = '09:00', initialEndTime, initialTitle = '', initialType = 'event', initialColorKey = 'blue', initialCustomColor = null, initialItem = null, initialPeople = [], initialReminderOffsets = [], canCreateMeeting = false, onPreviewCreate, onDraftChange, onClose, onCreated }: {
  open: boolean;
  calendars: readonly CalendarCollectionDTO[];
  categoriesOverride?: readonly CalendarCategoryDTO[];
  preview?: boolean;
  titleIconMode?: CalendarTitleIconType;
  previewSessionId?: number;
  initialCalendarId?: string | null;
  initialDate: string;
  initialEndDate?: string;
  initialTime?: string;
  initialEndTime?: string;
  initialTitle?: string;
  initialType?: CalendarCreateType;
  initialColorKey?: CalendarColorKey;
  initialCustomColor?: string | null;
  /** Existing item used to prefill a reviewed duplicate; it is never updated in place. */
  initialItem?: CalendarItemDTO | null;
  initialPeople?: readonly PersonOption[];
  initialReminderOffsets?: readonly number[];
  canCreateMeeting?: boolean;
  onPreviewCreate?: (draft: CalendarPreviewCreateDraft) => string;
  onDraftChange?: (draft: CalendarDraftSelection) => void;
  onClose: () => void;
  onCreated?: (id: string) => void;
}): VNode | null {
  const currentUserId = useSessionStore(state => state.userId);
  const currentDepartmentId = useSessionStore(state => state.departmentId);
  const allowedTask = preview || can('calendar.task.manage_own');
  const allowedEvent = preview || can('calendar.activity.manage_own');
  const canManageCalendar = preview || can('calendar.manage');
  const canAssignTask = preview || can('calendar.task.assign');
  const fallbackKind: CalendarCreateType = allowedEvent ? 'event' : allowedTask ? 'task' : canCreateMeeting ? 'meeting' : 'event';
  const [kind, setKind] = useState<CalendarCreateType>(initialType);
  const [calendarId, setCalendarId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [title, setTitle] = useState('');
  const [titleIconType, setTitleIconType] = useState<CalendarTitleIconType | null>(null);
  const [titleIconValue, setTitleIconValue] = useState<string | null>(null);
  const [date, setDate] = useState(initialDate);
  const [endDate, setEndDate] = useState(initialEndDate ?? initialDate);
  const [allDay, setAllDay] = useState(false);
  const [startTime, setStartTime] = useState(initialTime);
  const [endTime, setEndTime] = useState(initialEndTime ?? addMinutes(initialTime, 60));
  const [notes, setNotes] = useState('');
  const [locationLabel, setLocationLabel] = useState('');
  const [colorKey, setColorKey] = useState<CalendarColorKey | null>('blue');
  const [customColor, setCustomColor] = useState<string | null>(null);
  const [priority, setPriority] = useState<'low' | 'medium' | 'high'>('medium');
  const [visibility, setVisibility] = useState<CalendarVisibility>('personal');
  const [departmentId, setDepartmentId] = useState('');
  const [recurrenceRule, setRecurrenceRule] = useState('');
  const [reminderOffset, setReminderOffset] = useState('15');
  const [deadlineEnabled, setDeadlineEnabled] = useState(false);
  const [deadlineDate, setDeadlineDate] = useState(initialEndDate ?? initialDate);
  const [deadlineTime, setDeadlineTime] = useState(initialEndTime ?? addMinutes(initialTime, 60));
  const [availability, setAvailability] = useState<'busy' | 'free' | 'tentative' | 'out_of_office'>('busy');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<MessageRecipient[]>([]);
  const [assignee, setAssignee] = useState<MessageRecipient | null>(null);
  const [meetingProvider, setMeetingProvider] = useState<'none' | 'external' | 'microsoft_teams' | 'zoom' | 'google_meet'>('none');
  const [joinUrl, setJoinUrl] = useState('');
  const [confidentiality, setConfidentiality] = useState<'internal' | 'restricted' | 'confidential'>('internal');
  const [expanded, setExpanded] = useState<readonly string[]>(['people']);
  const [error, setError] = useState<string | null>(null);
  const [readyPreviewSessionId, setReadyPreviewSessionId] = useState(-1);
  const createTask = useCreateTask();
  const createActivity = useCreateActivity();
  const createMeeting = useCreateMeeting();
  const categories = useCalendarCategories(open && !categoriesOverride);
  const departments = useCalendarDepartments(open && visibility === 'team');
  const directory = useMessageRecipients(search, { enabled: open && (kind !== 'task' || canAssignTask) });
  const writableCalendars = useMemo(() => calendars.filter(calendar => !calendar.readOnly), [calendars]);

  const permittedKind = (candidate: CalendarCreateType): CalendarCreateType => {
    if ((candidate === 'event' || candidate === 'reminder') && allowedEvent) return candidate;
    if (candidate === 'task' && allowedTask) return candidate;
    if (candidate === 'meeting' && canCreateMeeting) return candidate;
    return fallbackKind;
  };

  useEffect(() => {
    if (!open) return;
    const sourceKind: CalendarCreateType = initialItem?.kind === 'meeting' || initialItem?.kind === 'task' || initialItem?.kind === 'reminder' ? initialItem.kind : initialType;
    const sourceDate = initialItem ? itemDateKey(initialItem) ?? initialDate : initialDate;
    const sourceEndDate = initialItem ? itemEndDateKey(initialItem) ?? sourceDate : initialEndDate ?? initialDate;
    const sourceStartTime = timeInputValue(initialItem?.startsAt, initialTime);
    const sourceEndTime = timeInputValue(initialItem?.endsAt, initialEndTime ?? addMinutes(sourceStartTime, 60));
    const sourcePeople = initialPeople.map(messageRecipient);
    const selectedCalendar = writableCalendars.find(value => value.id === (initialItem?.calendarId ?? initialCalendarId)) ?? writableCalendars.find(value => value.isDefault) ?? writableCalendars[0] ?? null;
    setKind(permittedKind(sourceKind)); setCalendarId(selectedCalendar?.id ?? ''); setCategoryId(initialItem?.categoryId ?? ''); setTitle(initialItem ? `${initialItem.title} copy` : initialTitle); setTitleIconType(initialItem?.titleIconType ?? null); setTitleIconValue(initialItem?.titleIconValue ?? null);
    setDate(sourceDate); setEndDate(sourceEndDate); setAllDay(initialItem?.allDay ?? false); setStartTime(sourceStartTime); setEndTime(sourceEndTime);
    setNotes(initialItem?.notes ?? ''); setLocationLabel(initialItem?.locationLabel ?? ''); setColorKey(initialItem?.colorKey ?? initialColorKey); setCustomColor(initialItem?.customColor ?? initialCustomColor); setPriority(initialItem?.priority ?? 'medium');
    setVisibility(initialItem?.visibility ?? selectedCalendar?.visibility ?? 'personal'); setDepartmentId(initialItem?.departmentId ?? selectedCalendar?.departmentId ?? currentDepartmentId ?? '');
    setRecurrenceRule(initialItem?.recurrenceRule ?? ''); setReminderOffset(initialItem ? initialReminderOffsets[0] === undefined ? 'none' : `${initialReminderOffsets[0]}` : '15'); setDeadlineEnabled(Boolean(initialItem?.deadlineAt)); setDeadlineDate(initialItem?.deadlineAt ? toLocalDateKey(new Date(initialItem.deadlineAt)) : sourceEndDate); setDeadlineTime(timeInputValue(initialItem?.deadlineAt, sourceEndTime)); setAvailability(initialItem?.availability ?? 'busy'); setSearch(''); setSelected(sourceKind === 'task' ? [] : sourcePeople); setAssignee(sourceKind === 'task' ? sourcePeople[0] ?? null : null);
    setMeetingProvider('none'); setJoinUrl(''); setConfidentiality('internal'); setExpanded(['people']); setError(null);
    setReadyPreviewSessionId(previewSessionId);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, previewSessionId, initialType, initialCalendarId, initialDate, initialEndDate, initialTime, initialEndTime, initialTitle, initialItem?.id]);

  const categoryData = categoriesOverride ?? categories.data ?? [];

  useEffect(() => {
    if (!open || categoryId || !categoryData.length) return;
    setCategoryId(categoryData.find(category => category.key === 'general')?.id ?? categoryData[0]?.id ?? '');
  }, [categoryData, categoryId, open]);

  useEffect(() => {
    if (!open || readyPreviewSessionId !== previewSessionId || !onDraftChange) return;
    const draftEndTime = kind === 'reminder' ? addMinutes(startTime, 15) : endTime;
    onDraftChange({
      key: date,
      endKey: allDay ? (kind === 'reminder' ? date : endDate) : endDate,
      startTime,
      endTime: draftEndTime,
      allDay,
      kind,
      title,
      titleIconType,
      titleIconValue,
      colorKey: customColor ? null : colorKey,
      customColor,
      locationLabel: kind === 'event' || kind === 'meeting' ? locationLabel : null,
      peopleCount: kind === 'task' ? (assignee ? 1 : 0) : selected.length,
    });
  }, [allDay, assignee, colorKey, customColor, date, endDate, endTime, kind, locationLabel, onDraftChange, open, previewSessionId, readyPreviewSessionId, selected, startTime, title, titleIconType, titleIconValue]);

  if (!open) return null;
  const eventFamily = kind === 'event' || kind === 'meeting';
  const taskFamily = kind === 'task';
  const standaloneReminder = kind === 'reminder';
  const supportsDeadline = kind === 'event' || kind === 'task';
  const providerNeedsUrl = kind === 'meeting' && meetingProvider !== 'none';
  const pending = createTask.isPending || createActivity.isPending || createMeeting.isPending;
  const scheduleValid = Boolean(date) && (standaloneReminder || allDay || Boolean(endDate && endDate >= date && endTime && localTimestamp(endDate, endTime) > localTimestamp(date, startTime)));
  const deadlineValid = !deadlineEnabled || Boolean(deadlineDate && deadlineTime);
  const valid = Boolean(calendarId && categoryId && title.trim() && scheduleValid && deadlineValid && (visibility !== 'team' || departmentId) && (!providerNeedsUrl || /^https?:\/\//i.test(joinUrl)) && (!preview || onPreviewCreate));
  const categoryOptions = categoryData.map(category => ({ value: category.id, label: category.name }));
  const calendarOptions = writableCalendars.map(calendar => ({ value: calendar.id, label: `${calendar.name}${calendar.isDefault ? ' · Default' : ''}` }));
  const departmentOptions = [{ value: '', label: 'Select department' }, ...(departments.data ?? []).filter(department => canManageCalendar || department.id === currentDepartmentId).map(department => ({ value: department.id, label: department.name }))];
  const available = (directory.data ?? []).filter(person => person.userId !== currentUserId && !selected.some(value => value.userId === person.userId));
  const people = available.map(personOption);
  const selectedPeople = selected.map(personOption);

  const chooseCalendar = (id: string): void => {
    setCalendarId(id);
    const calendar = writableCalendars.find(value => value.id === id);
    if (!calendar) return;
    setColorKey(calendar.colorKey ?? 'blue'); setCustomColor(calendar.customColor ?? null); setVisibility(calendar.visibility); setDepartmentId(calendar.departmentId ?? currentDepartmentId ?? '');
  };

  const choosePerson = (userId: string | null): void => {
    if (!userId) return;
    const person = available.find(value => value.userId === userId);
    if (!person) return;
    if (taskFamily) setAssignee(person); else setSelected(current => [...current, person]);
    setSearch('');
  };

  const submit = async (): Promise<void> => {
    if (!valid || pending) return;
    setError(null);
    try {
      const timedStart = localTimestamp(date, startTime);
      const timedEnd = localTimestamp(endDate, endTime);
      const deadlineAt = supportsDeadline && deadlineEnabled ? localTimestamp(deadlineDate, deadlineTime) : null;
      const reminderOffsets = reminderOffset === 'none' ? [] : [Number(reminderOffset)];
      if (preview) {
        if (!onPreviewCreate) throw new Error('Staged creation is not configured.');
        const singleDate = standaloneReminder;
        const id = onPreviewCreate({
          kind, calendarId, categoryId, title: title.trim(), titleIconType, titleIconValue, notes: notes.trim() || null, allDay,
          startsOn: allDay ? date : null,
          endsOn: allDay ? (singleDate ? date : endDate) : null,
          startsAt: allDay ? null : timedStart,
          endsAt: allDay || singleDate ? null : timedEnd,
          deadlineAt,
          priority, visibility, departmentId: visibility === 'team' && departmentId ? departmentId : null,
          attendeeUserIds: selected.map(person => person.userId), attendeePeople: selectedPeople,
          assigneeUserId: assignee?.userId ?? null, assignee: assignee ? personOption(assignee) : null,
          recurrenceRule: recurrenceRule || null, reminderOffsets,
          colorKey: customColor ? null : colorKey, customColor,
          locationLabel: eventFamily ? locationLabel.trim() || null : null,
          availability: standaloneReminder ? 'free' : availability,
        });
        onCreated?.(id);
        onClose();
        return;
      }
      if (kind === 'meeting') {
        const response = await createMeeting.mutateAsync({
          idempotencyKey: crypto.randomUUID(), calendarId, categoryId, title: title.trim(), titleIconType, titleIconValue, description: notes.trim() || null,
          schedule: allDay ? { allDay: true, startsOn: date, endsOn: endDate, visibility, departmentId: visibility === 'team' ? departmentId : null, recurrenceRule: recurrenceRule || null } : { allDay: false, startsAt: timedStart, endsAt: timedEnd, visibility, departmentId: visibility === 'team' ? departmentId : null, recurrenceRule: recurrenceRule || null },
          participants: selected.map(person => ({ userId: person.userId, role: 'attendee', required: true })),
          provider: meetingProvider, joinUrl: providerNeedsUrl ? joinUrl.trim() : null, confidentiality, recordingPolicy: 'off', transcriptPolicy: 'off', reminderOffsets,
        });
        if (!response.success) throw new Error(response.message);
        onCreated?.(response.data.schedule.calendarEntryId);
      } else if (taskFamily) {
        const temporal = allDay ? { startsOn: date, endsOn: endDate } : { startsAt: timedStart, endsAt: timedEnd };
        const response = await createTask.mutateAsync({
          kind: 'task', categoryId, calendarId, title: title.trim(), titleIconType, titleIconValue, notes: notes.trim() || null, allDay, ...temporal, deadlineAt, priority, visibility,
          assigneeUserId: assignee?.userId ?? null, departmentId: visibility === 'team' && departmentId ? departmentId : null,
          recurrenceRule: recurrenceRule || null, colorKey: customColor ? null : colorKey, customColor, reminderOffsets,
        });
        if (!response.success || !response.id) throw new Error(response.message ?? 'The task could not be created.');
        onCreated?.(response.id);
      } else {
        const temporal = allDay ? { startsOn: date, endsOn: standaloneReminder ? date : endDate } : { startsAt: timedStart, endsAt: standaloneReminder ? null : timedEnd };
        const response = await createActivity.mutateAsync({
          kind, categoryId, calendarId, title: title.trim(), titleIconType, titleIconValue, notes: notes.trim() || null, allDay, ...temporal, visibility,
          departmentId: visibility === 'team' && departmentId ? departmentId : null, attendeeUserIds: selected.map(person => person.userId),
          recurrenceRule: recurrenceRule || null, colorKey: customColor ? null : colorKey, customColor,
          locationLabel: eventFamily ? locationLabel.trim() || null : null, availability: standaloneReminder ? 'free' : availability, reminderOffsets, deadlineAt,
        });
        if (!response.success || !response.id) throw new Error(response.message ?? 'The calendar item could not be created.');
        onCreated?.(response.id);
      }
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The calendar item could not be created.');
    }
  };

  const peopleContent = <div class="cal-editor-section-content">
    {(eventFamily || standaloneReminder || canAssignTask) ? <FormField label={taskFamily ? 'Assignee' : standaloneReminder ? 'Recipients' : 'Invitees'}><CalendarPeoplePicker mode={taskFamily ? 'task' : 'event'} people={people} selected={taskFamily ? assignee ? [personOption(assignee)] : [] : selectedPeople} onAdd={choosePerson} onRemove={userId => taskFamily ? setAssignee(null) : setSelected(current => current.filter(person => person.userId !== userId))} onSearch={setSearch} loading={directory.isFetching} error={directory.isError ? 'The employee directory could not be loaded.' : null} disabled={pending} emptyText={taskFamily ? 'No assignee selected.' : 'No people added.'} /></FormField> : null}
    <FormField label="Audience"><Select value={visibility} onChange={value => setVisibility(value as CalendarVisibility)} options={[{ value: 'personal', label: eventFamily || standaloneReminder ? 'Participants only' : 'Personal' }, { value: 'team', label: 'Department' }, { value: 'org', label: 'Entire organisation' }]} /></FormField>
    {visibility === 'team' ? <FormField label="Department"><Select value={departmentId} onChange={setDepartmentId} options={departmentOptions} searchable disabled={departments.isLoading} /></FormField> : null}
  </div>;
  const accordionItems = [
    ...(kind === 'meeting' ? [{ id: 'meeting', title: 'Meeting Settings', description: 'Conferencing and confidentiality', icon: <LucideIcon name="Video" size={17} />, content: <div class="cal-editor-section-content"><FormGrid2><FormField label="Meeting Method"><Select value={meetingProvider} onChange={value => { setMeetingProvider(value as typeof meetingProvider); if (value === 'none') setJoinUrl(''); }} options={[{ value: 'none', label: 'In person' }, { value: 'zoom', label: 'Zoom' }, { value: 'microsoft_teams', label: 'Microsoft Teams' }, { value: 'google_meet', label: 'Google Meet' }, { value: 'external', label: 'Other provider' }]} /></FormField><FormField label="Confidentiality"><Select value={confidentiality} onChange={value => setConfidentiality(value as typeof confidentiality)} options={[{ value: 'internal', label: 'Internal' }, { value: 'restricted', label: 'Restricted' }, { value: 'confidential', label: 'Confidential' }]} /></FormField></FormGrid2>{providerNeedsUrl ? <FormField label="Join Link" required><TextInput type="url" value={joinUrl} onInput={setJoinUrl} placeholder="https://…" iconLeft={<LucideIcon name="Link2" size={15} />} /></FormField> : null}</div> }] : []),
    { id: 'people', title: taskFamily ? 'Ownership & Access' : 'People & Access', description: taskFamily ? 'Assignee, collaborators and visibility' : 'Invitees, recipients and visibility', icon: <LucideIcon name="UsersRound" size={17} />, content: peopleContent },
  ];
  const siblingOptions = standaloneReminder
    ? []
    : [
          ...(allowedEvent ? [{ value: 'event', label: 'Event', icon: <LucideIcon name="CalendarDays" size={15} /> }] : []),
          ...(canCreateMeeting ? [{ value: 'meeting', label: 'Meeting', icon: <LucideIcon name="Video" size={15} /> }] : []),
          ...(allowedTask ? [{ value: 'task', label: 'Task', icon: <LucideIcon name="ListChecks" size={15} /> }] : []),
        ];

  return <Drawer open contained title={titleFor(kind)} sub="Complete the schedule without leaving Calendar." headIcon={<LucideIcon name={iconFor(kind)} size={19} />} panelClass="cal-side-rail cal-item-editor-drawer" closeLabel="Close calendar editor" onClose={onClose} foot={<><Button variant="secondary" onClick={onClose} disabled={pending}>Cancel</Button><Button variant="primary" onClick={() => void submit()} disabled={!valid || pending} iconLeft={<LucideIcon name={iconFor(kind)} size={16} />}>{pending ? 'Saving…' : titleFor(kind)}</Button></>}>
    <div class="cal-item-editor-body">
      {error ? <div class="cal-form-error" role="alert"><LucideIcon name="CircleAlert" size={16} />{error}</div> : null}
       {siblingOptions.length > 1 ? <SegmentedControl class="cal-editor-kind" size="sm" value={kind} onChange={value => setKind(value as CalendarCreateType)} label="Calendar item type" options={siblingOptions} /> : null}
      <section class="cal-editor-primary" aria-label={`${titleFor(kind)} details`}>
        <FormField label="Title" required charCount={{ value: title.length, max: 200 }}><div class="cal-title-field-row"><CalendarTitleIconPicker mode={titleIconMode} type={titleIconType} value={titleIconValue} disabled={pending} onChange={(type, value) => { setTitleIconType(type); setTitleIconValue(value); }} /><TextInput value={title} onInput={setTitle} maxLength={200} autoFocus placeholder={taskFamily ? 'What needs to be completed?' : standaloneReminder ? 'What should SIOMAC remind you about?' : 'What is happening?'} /></div></FormField>
        <FormGrid2><FormField label="Calendar" required><Select value={calendarId} onChange={chooseCalendar} options={calendarOptions} disabled={!calendarOptions.length} /></FormField><FormField label="Category" required error={!categoriesOverride && categories.isError ? 'Categories could not be loaded.' : undefined}><Select value={categoryId} onChange={setCategoryId} options={categoryOptions} searchable disabled={(!categoriesOverride && categories.isLoading) || !categoryOptions.length} /></FormField></FormGrid2>
        <FormField label="Card Colour"><CalendarColorPicker value={customColor ? null : colorKey} customColor={customColor} onChange={value => { setColorKey(value); if (value) setCustomColor(null); }} onCustomColorChange={value => { setCustomColor(value); if (value) setColorKey(null); }} allowCustom disabled={pending} label={`${titleFor(kind)} colour`} /></FormField>
        <div class="cal-editor-all-day">
          <Checkbox checked={allDay} onChange={setAllDay} label="All Day" />
          <div>
            <strong>All-Day Event</strong>
            <span>Schedule this item across one or more dates without assigning specific start or end times.</span>
          </div>
        </div>
        <FormGrid2><FormField label="Start Date" required><DateInput value={date} onChange={value => { setDate(value); if (endDate < value) setEndDate(value); }} /></FormField>{!standaloneReminder ? <FormField label="End Date" required><DateInput min={date} value={endDate} onChange={setEndDate} /></FormField> : null}{!allDay ? <FormField label="Start Time" required><TimeInput value={startTime} onChange={setStartTime} step={900} /></FormField> : null}{!allDay && !standaloneReminder ? <FormField label="End Time" required error={!scheduleValid ? 'Must be after the start.' : undefined}><TimeInput value={endTime} onChange={setEndTime} step={900} /></FormField> : null}</FormGrid2>
        {supportsDeadline ? <div class={`cal-editor-deadline${deadlineEnabled ? ' is-enabled' : ''}`}>
          <div class="cal-editor-deadline-toggle"><Checkbox checked={deadlineEnabled} onChange={setDeadlineEnabled} label="Set Deadline" /><div><strong>Deadline</strong><span>{kind === 'task' ? 'Set when this task must be completed.' : 'Set the last date and time for registration, RSVP, or any required action.'}</span></div></div>
          {deadlineEnabled ? <FormGrid2><FormField label="Deadline Date" required><DateInput value={deadlineDate} onChange={setDeadlineDate} /></FormField><FormField label="Deadline Time" required><TimeInput value={deadlineTime} onChange={setDeadlineTime} step={900} /></FormField></FormGrid2> : null}
        </div> : null}
        <FormGrid2><FormField label="Repeat"><Select value={recurrenceRule} onChange={setRecurrenceRule} options={[{ value: '', label: 'Does not repeat' }, { value: 'FREQ=DAILY', label: 'Daily' }, { value: 'FREQ=WEEKLY', label: 'Weekly' }, { value: 'FREQ=MONTHLY', label: 'Monthly' }]} /></FormField><FormField label="Reminder"><Select value={reminderOffset} onChange={setReminderOffset} options={[{ value: 'none', label: 'No reminder' }, { value: '0', label: 'At start' }, { value: '15', label: '15 minutes before' }, { value: '60', label: '1 hour before' }, { value: '1440', label: '1 day before' }]} /></FormField></FormGrid2>
        {taskFamily ? <FormGrid2><FormField label="Priority"><Select value={priority} onChange={value => setPriority(value as typeof priority)} options={[{ value: 'high', label: 'High' }, { value: 'medium', label: 'Medium' }, { value: 'low', label: 'Low' }]} /></FormField>{assignee ? <FormField label="Accountable Owner"><div class="cal-editor-owner"><span>{personName(assignee)}</span><Button variant="ghost" size="sm" onClick={() => setAssignee(null)}>Change</Button></div></FormField> : null}</FormGrid2> : null}
        {eventFamily ? <FormGrid2><FormField label="Location"><TextInput value={locationLabel} onInput={setLocationLabel} maxLength={240} placeholder="Optional site, room or work area" iconLeft={<LucideIcon name="MapPin" size={15} />} /></FormField><FormField label="Availability"><Select value={availability} onChange={value => setAvailability(value as typeof availability)} options={[{ value: 'busy', label: 'Busy' }, { value: 'free', label: 'Free' }, { value: 'tentative', label: 'Tentative' }, { value: 'out_of_office', label: 'Out of office' }]} /></FormField></FormGrid2> : null}
        <FormField label="Description" charCount={{ value: notes.length, max: kind === 'meeting' ? 10_000 : 4_000 }}><Textarea rows={3} value={notes} onInput={setNotes} maxLength={kind === 'meeting' ? 10_000 : 4_000} placeholder={kind === 'meeting' ? 'Purpose, agenda and preparation…' : 'Context, instructions or expected outcome…'} /></FormField>
      </section>
      <Accordion class="cal-editor-accordion" variant="bare" multiple expanded={expanded} onChange={setExpanded} items={accordionItems} />
    </div>
  </Drawer>;
}
