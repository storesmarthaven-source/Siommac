import { type VNode } from 'preact';
import { useEffect, useMemo, useState } from 'preact/hooks';
import { useMessageRecipients, type MessageRecipient } from '@api/communications';
import { useCalendarCategories, useCalendarCollections, useCalendarDepartments } from '@api/calendar';
import { useCreateMeeting } from '@api/meetings';
import { useSessionStore } from '@store/session';
import {
  Avatar,
  AvatarGroup,
  Badge,
  Button,
  Checkbox,
  Dialog,
  FormField,
  FormGrid2,
  LucideIcon,
  PersonSearchSelect,
  Select,
  Textarea,
  TextInput,
  type PersonOption,
} from '@ui';

interface CreateMeetingDialogProps {
  open: boolean;
  initialDate?: string;
  initialTime?: string;
  onClose: () => void;
  onCreated?: (meetingId: string) => void;
}

interface AgendaDraft {
  key: string;
  title: string;
  plannedMinutes: string;
}

function todayIso(): string {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function localTimestamp(date: string, time: string): string {
  return new Date(`${date}T${time}:00`).toISOString();
}

function addMinutes(time: string, minutes: number): string {
  const [hour = '9', minute = '0'] = time.split(':');
  const total = Math.min((Number(hour) * 60) + Number(minute) + minutes, (23 * 60) + 59);
  return `${`${Math.floor(total / 60)}`.padStart(2, '0')}:${`${total % 60}`.padStart(2, '0')}`;
}

function nameOf(person: MessageRecipient): string {
  const displayName = person.displayName?.trim();
  if (displayName) return displayName;
  const username = person.username?.trim();
  return username ?? 'SIOMAC User';
}

function toPersonOption(person: MessageRecipient): PersonOption {
  return {
    id: person.userId,
    name: nameOf(person),
    jobTitle: person.role,
    department: person.department,
    photoUrl: person.profileImage,
  };
}

export function CreateMeetingDialog({ open, initialDate, initialTime = '09:00', onClose, onCreated }: CreateMeetingDialogProps): VNode | null {
  const currentUserId = useSessionStore(state => state.userId);
  const currentDepartmentId = useSessionStore(state => state.departmentId);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [date, setDate] = useState(todayIso());
  const [allDay, setAllDay] = useState(false);
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('09:30');
  const [visibility, setVisibility] = useState<'personal' | 'team' | 'org'>('team');
  const [departmentId, setDepartmentId] = useState('');
  const [calendarId, setCalendarId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [confidentiality, setConfidentiality] = useState<'internal' | 'restricted' | 'confidential'>('internal');
  const recordingPolicy = 'off' as const;
  const transcriptPolicy = 'off' as const;
  const [search, setSearch] = useState('');
  const [pickerValue, setPickerValue] = useState<string | null>(null);
  const [selected, setSelected] = useState<MessageRecipient[]>([]);
  const [agendaItems, setAgendaItems] = useState<AgendaDraft[]>([]);
  const [error, setError] = useState<string | null>(null);
  const directory = useMessageRecipients(search, { enabled: open });
  const calendars = useCalendarCollections(open);
  const categories = useCalendarCategories(open);
  const departments = useCalendarDepartments(open && visibility === 'team');
  const create = useCreateMeeting();

  useEffect(() => {
    if (!open) return;
    setTitle(''); setDescription(''); setDate(initialDate ?? todayIso()); setAllDay(false);
    setStartTime(initialTime); setEndTime(addMinutes(initialTime, 30)); setVisibility(currentDepartmentId ? 'team' : 'personal'); setDepartmentId(currentDepartmentId ?? '');
    setCalendarId(''); setCategoryId('');
    setConfidentiality('internal');
    setSearch(''); setPickerValue(null); setSelected([]); setAgendaItems([]); setError(null); create.reset();
  // The mutation object is not form input.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentDepartmentId, initialDate, initialTime, open]);

  useEffect(() => {
    if (!open || calendarId || !calendars.data?.length) return;
    const writable = calendars.data.filter(calendar => !calendar.readOnly);
    setCalendarId(writable.find(calendar => calendar.isDefault)?.id ?? writable[0]?.id ?? '');
  }, [calendarId, calendars.data, open]);

  useEffect(() => {
    if (!open || categoryId || !categories.data?.length) return;
    setCategoryId(categories.data.find(category => category.key === 'general')?.id ?? categories.data[0]?.id ?? '');
  }, [categories.data, categoryId, open]);

  const available = useMemo(
    () => (directory.data ?? []).filter(person => person.userId !== currentUserId && !selected.some(value => value.userId === person.userId)),
    [currentUserId, directory.data, selected],
  );
  const people = useMemo(() => available.map(toPersonOption), [available]);
  const selectedPeople = useMemo(() => selected.map(person => ({ id: person.userId, name: nameOf(person), src: person.profileImage })), [selected]);
  const temporalError = !date ? 'Choose a meeting date.'
    : !allDay && (!startTime || !endTime) ? 'Choose a start and end time.'
    : !allDay && endTime <= startTime ? 'End time must be after the start time.'
    : null;
  const agendaError = agendaItems.some(item => !item.title.trim()) ? 'Every agenda topic needs a title.' : null;
  const valid = Boolean(calendarId && categoryId && title.trim().length > 0 && !temporalError && !agendaError && (visibility !== 'team' || departmentId));

  const addAgendaItem = (): void => setAgendaItems(current => [...current, { key: crypto.randomUUID(), title: '', plannedMinutes: '15' }]);
  const patchAgendaItem = (key: string, patch: Partial<AgendaDraft>): void => setAgendaItems(current => current.map(item => item.key === key ? { ...item, ...patch } : item));

  const choosePerson = (userId: string | null): void => {
    setPickerValue(null);
    if (!userId) return;
    const person = available.find(value => value.userId === userId);
    if (!person) return;
    setSelected(current => [...current, person]);
    setSearch('');
  };

  const submit = async (): Promise<void> => {
    if (!valid || create.isPending) return;
    setError(null);
    try {
      const startsAt = allDay ? null : localTimestamp(date, startTime);
      const endsAt = allDay ? null : localTimestamp(date, endTime);
      const response = await create.mutateAsync({
        idempotencyKey: crypto.randomUUID(),
        calendarId,
        categoryId,
        title: title.trim(),
        description: description.trim() || null,
        schedule: allDay
          ? { allDay: true, startsOn: date, endsOn: date, visibility, departmentId: visibility === 'team' ? departmentId : null }
          : { allDay: false, startsAt, endsAt, visibility, departmentId: visibility === 'team' ? departmentId : null },
        participants: selected.map(person => ({ userId: person.userId, role: 'attendee', required: true })),
        ...(agendaItems.length ? { agendaItems: agendaItems.map(item => ({ title: item.title.trim(), plannedMinutes: Number(item.plannedMinutes) })) } : {}),
        provider: 'none',
        confidentiality,
        recordingPolicy,
        transcriptPolicy,
      });
      if (!response.success) {
        setError(response.message);
        return;
      }
      onCreated?.(response.data.id);
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The meeting could not be scheduled.');
    }
  };

  if (!open) return null;
  return (
    <Dialog open={open} onClose={onClose} size="lg" variant="form" layout="sidebar-left" busy={create.isPending} closeOnBackdrop={false} class="mtg-create-dialog">
      <Dialog.Header title="Schedule a Meeting" sub="Create the schedule, invitations and discussion together." icon={<LucideIcon name="CalendarPlus" />} onClose={onClose} />
      <Dialog.Body>
        <Dialog.Layout>
          <Dialog.Sidebar class="mtg-create-sidebar">
            <Dialog.SidebarHeader eyebrow="Meeting Workspace" title={title.trim() || 'New Meeting'} description="One audited action creates the Calendar event, meeting record and Messages conversation." />
            <div class="mtg-create-participant-summary">
              <span class="mtg-create-summary-icon"><LucideIcon name="UsersRound" /></span>
              <div><small>Participants</small><strong>{selected.length ? `${selected.length} invited` : 'Organizer only'}</strong></div>
              {selectedPeople.length ? <AvatarGroup people={selectedPeople} max={4} size={26} label="Selected participants" /> : null}
            </div>
            <Dialog.ContextFacts items={[
              { label: 'Schedule', value: allDay ? `${date} · All day` : `${date} · ${startTime}–${endTime}`, icon: <LucideIcon name="Clock3" /> },
              { label: 'Visibility', value: visibility === 'org' ? 'Organisation' : visibility === 'team' ? 'Team' : 'Personal', icon: <LucideIcon name="Eye" /> },
              { label: 'Recording', value: 'Not planned', icon: <LucideIcon name="Video" /> },
            ]} />
          </Dialog.Sidebar>
          <Dialog.Content class="mtg-create-content">
            {error ? <div class="mtg-create-error" role="alert"><LucideIcon name="CircleAlert" size={16} />{error}</div> : null}
            <Dialog.Section title="Meeting Details" desc="Give invitees enough context before they respond.">
              <FormField label="Title" required charCount={{ value: title.length, max: 200 }}>
                <TextInput value={title} onInput={setTitle} maxLength={200} autoFocus placeholder="Quarterly operations review" />
              </FormField>
              <FormField label="Description" charCount={{ value: description.length, max: 10000 }}>
                <Textarea value={description} onInput={setDescription} maxLength={10000} rows={3} placeholder="Add the purpose, expected outcome or preparation notes…" />
              </FormField>
            </Dialog.Section>
            <Dialog.Section title="Schedule" desc="This timing is owned by Calendar and appears in both modules.">
              <FormGrid2>
                <FormField label="Calendar" required><Select value={calendarId} onChange={setCalendarId} options={(calendars.data ?? []).filter(calendar => !calendar.readOnly).map(calendar => ({ value: calendar.id, label: `${calendar.name}${calendar.isDefault ? ' · Default' : ''}` }))} disabled={calendars.isLoading} /></FormField>
                <FormField label="Category" required><Select value={categoryId} onChange={setCategoryId} options={(categories.data ?? []).map(category => ({ value: category.id, label: category.name }))} disabled={categories.isLoading} /></FormField>
                <FormField label="Date" required><TextInput type="date" value={date} onInput={setDate} /></FormField>
                <FormField label="Duration"><div class="mtg-create-all-day"><Checkbox checked={allDay} onChange={setAllDay} label="All-day meeting" /></div></FormField>
                {!allDay ? <><FormField label="Start Time" required><TextInput type="time" value={startTime} onInput={setStartTime} /></FormField><FormField label="End Time" required error={temporalError ?? undefined}><TextInput type="time" value={endTime} onInput={setEndTime} /></FormField></> : null}
              </FormGrid2>
            </Dialog.Section>
            <Dialog.Section title="Invite People" desc="Invite employees from the shared SIOMAC directory.">
              <FormField label="Add Participant">
                <PersonSearchSelect value={pickerValue} onChange={choosePerson} people={people} onSearch={setSearch} loading={directory.isFetching} error={directory.isError ? 'The employee directory could not be loaded.' : null} placeholder="Search employees…" emptyLabel="No matching employees" clearable={false} />
              </FormField>
              {selected.length ? <div class="mtg-create-selected" aria-label="Selected participants">{selected.map(person => <article key={person.userId}><Avatar name={nameOf(person)} src={person.profileImage} seed={person.userId} size={34} decorative /><span><strong>{nameOf(person)}</strong><small>{[person.role, person.department].filter(Boolean).join(' · ') || 'Employee'}</small></span><Button variant="ghost" size="sm" iconOnly aria-label={`Remove ${nameOf(person)}`} iconLeft={<LucideIcon name="X" size={15} />} onClick={() => setSelected(current => current.filter(value => value.userId !== person.userId))} /></article>)}</div> : <div class="mtg-create-empty-invite"><LucideIcon name="UserRoundPlus" size={17} /><span>You can schedule now and invite participants later.</span></div>}
            </Dialog.Section>
            <Dialog.Section title="Meeting Agenda" desc="Set the topics and planned time before invitations are sent.">
              <div class="mtg-agenda-editor">
                {agendaItems.length ? agendaItems.map((item, index) => <article class="mtg-agenda-editor-row" key={item.key}>
                  <span class="mtg-agenda-sequence">{index + 1}</span>
                  <FormField label={`Topic ${index + 1}`} required><TextInput value={item.title} onInput={value => patchAgendaItem(item.key, { title: value })} maxLength={300} placeholder="Agenda topic" /></FormField>
                  <FormField label="Minutes"><Select value={item.plannedMinutes} onChange={value => patchAgendaItem(item.key, { plannedMinutes: value })} options={[{ value: '5', label: '5 min' }, { value: '10', label: '10 min' }, { value: '15', label: '15 min' }, { value: '20', label: '20 min' }, { value: '30', label: '30 min' }, { value: '45', label: '45 min' }, { value: '60', label: '60 min' }]} /></FormField>
                  <Button variant="ghost" size="sm" iconOnly aria-label={`Remove agenda topic ${index + 1}`} iconLeft={<LucideIcon name="Trash2" size={15} />} onClick={() => setAgendaItems(current => current.filter(value => value.key !== item.key))} />
                </article>) : <div class="mtg-agenda-empty"><LucideIcon name="ListTodo" size={18} /><span>No topics yet. Add an agenda when the meeting needs a structured discussion.</span></div>}
                {agendaError ? <span class="mtg-create-field-error" role="alert">{agendaError}</span> : null}
                <Button variant="secondary" size="sm" iconLeft={<LucideIcon name="Plus" size={15} />} onClick={addAgendaItem}>Add Topic</Button>
              </div>
            </Dialog.Section>
            <Dialog.Section title="Access & Capture" desc="Set visibility and recording expectations before invitations are sent.">
              <FormGrid2>
                <FormField label="Visibility"><Select value={visibility} onChange={value => setVisibility(value as typeof visibility)} options={[{ value: 'personal', label: 'Personal' }, { value: 'team', label: 'Team' }, { value: 'org', label: 'Organisation' }]} /></FormField>
                {visibility === 'team' ? <FormField label="Department" required><Select value={departmentId} onChange={setDepartmentId} options={[{ value: '', label: 'Select department' }, ...(departments.data ?? []).map(department => ({ value: department.id, label: department.name }))]} searchable disabled={departments.isLoading} /></FormField> : null}
                <FormField label="Confidentiality"><Select value={confidentiality} onChange={value => setConfidentiality(value as typeof confidentiality)} options={[{ value: 'internal', label: 'Internal' }, { value: 'restricted', label: 'Restricted' }, { value: 'confidential', label: 'Confidential' }]} /></FormField>
                <div class="mtg-ai-capture-preview">
                  <span><LucideIcon name="Sparkles" size={19} /></span>
                  <div><strong>AI Meeting Capture</strong><p>The recording, transcript, and reviewed-summary workflow is designed in the meeting workspace. Processing is not connected yet, so scheduling keeps capture off.</p></div>
                  <Badge tone="neutral" variant="outline">UI Preview</Badge>
                </div>
              </FormGrid2>
            </Dialog.Section>
          </Dialog.Content>
        </Dialog.Layout>
      </Dialog.Body>
      <Dialog.Footer left={<span class="mtg-create-foot-note"><LucideIcon name="ShieldCheck" size={15} /> Invitations are sent only after the transaction succeeds.</span>}>
        <Button variant="secondary" onClick={onClose} disabled={create.isPending}>Cancel</Button>
        <Button variant="primary" onClick={() => void submit()} disabled={!valid || create.isPending} iconLeft={<LucideIcon name="CalendarPlus" size={16} />}>{create.isPending ? 'Scheduling…' : 'Schedule Meeting'}</Button>
      </Dialog.Footer>
    </Dialog>
  );
}
