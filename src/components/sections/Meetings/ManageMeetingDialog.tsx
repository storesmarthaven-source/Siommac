import { type VNode } from 'preact';
import { useEffect, useMemo, useState } from 'preact/hooks';
import { useMessageRecipients, type MessageRecipient } from '@api/communications';
import {
  useArchiveMeeting,
  useCancelMeeting,
  useInviteMeetingParticipants,
  useRemoveMeetingParticipant,
  useUpdateMeeting,
  useUpdateMeetingAgenda,
} from '@api/meetings';
import {
  Avatar,
  Button,
  Dialog,
  FormField,
  LucideIcon,
  PersonSearchSelect,
  Select,
  Textarea,
  TextInput,
  type PersonOption,
} from '@ui';
import type { MeetingDetailDTO, MeetingParticipantDTO } from '../../../../types/meetings';

export type MeetingManageAction = 'edit' | 'participants' | 'agenda' | 'cancel' | 'archive' | null;

interface AgendaEditDraft {
  key: string;
  id?: string;
  title: string;
  description: string;
  status: 'open' | 'covered' | 'deferred' | 'cancelled';
  plannedMinutes: string;
  ownerUserId: string | null;
}

interface ManageMeetingDialogProps {
  action: MeetingManageAction;
  meeting: MeetingDetailDTO;
  onClose: () => void;
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

function responseFailed(response: { success: boolean; message?: string }): string | null {
  return response.success ? null : response.message ?? 'The meeting could not be updated.';
}

function participantSubtext(participant: MeetingParticipantDTO): string {
  const role = participant.role.charAt(0).toUpperCase() + participant.role.slice(1);
  const response = participant.responseStatus.charAt(0).toUpperCase() + participant.responseStatus.slice(1);
  return `${role} · ${response}`;
}

export function ManageMeetingDialog({ action, meeting, onClose }: ManageMeetingDialogProps): VNode | null {
  const [title, setTitle] = useState(meeting.title);
  const [description, setDescription] = useState(meeting.description ?? '');
  const [reason, setReason] = useState('');
  const [search, setSearch] = useState('');
  const [pickerValue, setPickerValue] = useState<string | null>(null);
  const [selected, setSelected] = useState<MessageRecipient[]>([]);
  const [removeCandidate, setRemoveCandidate] = useState<MeetingParticipantDTO | null>(null);
  const [agendaItems, setAgendaItems] = useState<AgendaEditDraft[]>([]);
  const [error, setError] = useState<string | null>(null);
  const directory = useMessageRecipients(search, { enabled: action === 'participants' });
  const update = useUpdateMeeting();
  const updateAgenda = useUpdateMeetingAgenda();
  const cancel = useCancelMeeting();
  const archive = useArchiveMeeting();
  const invite = useInviteMeetingParticipants();
  const remove = useRemoveMeetingParticipant();

  useEffect(() => {
    if (!action) return;
    setTitle(meeting.title);
    setDescription(meeting.description ?? '');
    setReason('');
    setSearch('');
    setPickerValue(null);
    setSelected([]);
    setRemoveCandidate(null);
    setAgendaItems(meeting.agendaItems.map(item => ({ key: item.id, id: item.id, title: item.title, description: item.description ?? '', status: item.status, plannedMinutes: item.plannedMinutes ? String(item.plannedMinutes) : '15', ownerUserId: item.owner?.userId ?? null })));
    setError(null);
  }, [action, meeting.agendaItems, meeting.description, meeting.id, meeting.title]);

  const available = useMemo(
    () => (directory.data ?? []).filter(person => (
      !meeting.participants.some(value => value.person.userId === person.userId && !value.removedAt)
      && !selected.some(value => value.userId === person.userId)
    )),
    [directory.data, meeting.participants, selected],
  );
  const people = useMemo(() => available.map(toPersonOption), [available]);
  const activeParticipants = meeting.participants.filter(value => !value.removedAt);
  const busy = update.isPending || updateAgenda.isPending || cancel.isPending || archive.isPending || invite.isPending || remove.isPending;

  const patchAgenda = (key: string, patch: Partial<AgendaEditDraft>): void => setAgendaItems(current => current.map(item => item.key === key ? { ...item, ...patch } : item));
  const moveAgenda = (index: number, delta: number): void => setAgendaItems(current => {
    const target = index + delta;
    if (target < 0 || target >= current.length) return current;
    const next = [...current];
    const [item] = next.splice(index, 1);
    if (item) next.splice(target, 0, item);
    return next;
  });

  const choosePerson = (userId: string | null): void => {
    setPickerValue(null);
    if (!userId) return;
    const person = available.find(value => value.userId === userId);
    if (person) setSelected(current => [...current, person]);
    setSearch('');
  };

  const finish = (response: { success: boolean; message?: string }): void => {
    const failure = responseFailed(response);
    if (failure) setError(failure);
    else onClose();
  };

  const execute = async (operation: () => Promise<{ success: boolean; message?: string }>): Promise<void> => {
    try {
      finish(await operation());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The meeting could not be updated.');
    }
  };

  const saveEdit = async (): Promise<void> => {
    if (!title.trim() || busy) return;
    setError(null);
    await execute(() => update.mutateAsync({
      meetingId: meeting.id,
      idempotencyKey: crypto.randomUUID(),
      expectedVersion: meeting.version,
      patch: { title: title.trim(), description: description.trim() || null },
    }));
  };

  const invitePeople = async (): Promise<void> => {
    if (!selected.length || busy) return;
    setError(null);
    await execute(() => invite.mutateAsync({
      meetingId: meeting.id,
      idempotencyKey: crypto.randomUUID(),
      expectedVersion: meeting.version,
      participants: selected.map(person => ({ userId: person.userId, role: 'attendee', required: true })),
    }));
  };

  const saveAgenda = async (): Promise<void> => {
    if (busy || agendaItems.some(item => !item.title.trim())) return;
    setError(null);
    await execute(() => updateAgenda.mutateAsync({
      meetingId: meeting.id,
      idempotencyKey: crypto.randomUUID(),
      expectedVersion: meeting.version,
      items: agendaItems.map((item, sequence) => ({
        ...(item.id ? { id: item.id } : {}), sequence, title: item.title.trim(), description: item.description.trim() || null,
        ownerUserId: item.ownerUserId, status: item.status, plannedMinutes: Number(item.plannedMinutes),
      })),
    }));
  };

  const removePerson = async (): Promise<void> => {
    if (!removeCandidate || busy) return;
    setError(null);
    try {
      const response = await remove.mutateAsync({
        meetingId: meeting.id,
        idempotencyKey: crypto.randomUUID(),
        expectedVersion: meeting.version,
        userId: removeCandidate.person.userId,
        reason: 'Removed by the meeting organiser.',
      });
      const failure = responseFailed(response);
      if (failure) setError(failure);
      else setRemoveCandidate(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The participant could not be removed.');
    }
  };

  if (!action) return null;

  if (action === 'edit') return (
    <Dialog open onClose={onClose} size="md" variant="form" busy={busy} closeOnBackdrop={false} class="mtg-manage-dialog">
      <Dialog.Header title="Edit Meeting" sub={meeting.reference} icon={<LucideIcon name="SquarePen" />} onClose={onClose} />
      <Dialog.Body><Dialog.Content>
        {error ? <div class="mtg-dialog-error" role="alert"><LucideIcon name="CircleAlert" size={15} />{error}</div> : null}
        <Dialog.Section title="Meeting Details" desc="Changes stay aligned with Calendar and the linked conversation.">
          <FormField label="Title" required charCount={{ value: title.length, max: 200 }}><TextInput value={title} onInput={setTitle} maxLength={200} autoFocus /></FormField>
          <FormField label="Description" charCount={{ value: description.length, max: 10000 }}><Textarea value={description} onInput={setDescription} maxLength={10000} rows={5} /></FormField>
        </Dialog.Section>
      </Dialog.Content></Dialog.Body>
      <Dialog.Footer><Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button><Button variant="primary" loading={update.isPending} loadingText="Saving…" disabled={!title.trim()} onClick={() => void saveEdit()}>Save Changes</Button></Dialog.Footer>
    </Dialog>
  );

  if (action === 'participants') return (
    <Dialog open onClose={onClose} size="lg" variant="form" busy={busy} closeOnBackdrop={false} class="mtg-manage-dialog">
      <Dialog.Header title="Manage Participants" sub={`${activeParticipants.length} people in this meeting`} icon={<LucideIcon name="UsersRound" />} onClose={onClose} />
      <Dialog.Body><Dialog.Content>
        {error ? <div class="mtg-dialog-error" role="alert"><LucideIcon name="CircleAlert" size={15} />{error}</div> : null}
        {removeCandidate ? <section class="mtg-remove-confirm" aria-label="Confirm participant removal">
          <Avatar name={removeCandidate.person.displayName} src={removeCandidate.person.profileImage} seed={removeCandidate.person.userId} size={42} decorative />
          <div><strong>Remove {removeCandidate.person.displayName}?</strong><p>The invitation, Calendar attendee and conversation membership will be updated together.</p></div>
          <div><Button variant="secondary" size="sm" onClick={() => setRemoveCandidate(null)} disabled={busy}>Keep</Button><Button variant="danger" size="sm" loading={remove.isPending} loadingText="Removing…" onClick={() => void removePerson()}>Remove</Button></div>
        </section> : null}
        <Dialog.Section title="Invite Employees" desc="Search the shared SIOMAC employee directory.">
          <FormField label="Add Participant"><PersonSearchSelect value={pickerValue} onChange={choosePerson} people={people} onSearch={setSearch} loading={directory.isFetching} error={directory.isError ? 'The employee directory could not be loaded.' : null} placeholder="Search employees…" emptyLabel="No matching employees" clearable={false} /></FormField>
          {selected.length ? <div class="mtg-invite-selection">{selected.map(person => <span key={person.userId}><Avatar name={nameOf(person)} src={person.profileImage} seed={person.userId} size={28} decorative /><strong>{nameOf(person)}</strong><Button variant="ghost" size="sm" iconOnly aria-label={`Remove ${nameOf(person)} from invitation`} iconLeft={<LucideIcon name="X" size={14} />} onClick={() => setSelected(current => current.filter(value => value.userId !== person.userId))} /></span>)}</div> : null}
        </Dialog.Section>
        <Dialog.Section title="Current Participants" desc="The organiser cannot be removed.">
          <div class="mtg-participant-manager">{activeParticipants.map(participant => <article key={participant.id}><Avatar name={participant.person.displayName} src={participant.person.profileImage} seed={participant.person.userId} size={36} decorative /><span><strong>{participant.person.displayName}</strong><small>{participantSubtext(participant)}</small></span>{participant.role !== 'organizer' ? <Button variant="ghost" tone="danger" size="sm" iconOnly aria-label={`Remove ${participant.person.displayName}`} iconLeft={<LucideIcon name="UserRoundMinus" size={16} />} onClick={() => setRemoveCandidate(participant)} /> : <span class="mtg-organizer-label">Organizer</span>}</article>)}</div>
        </Dialog.Section>
      </Dialog.Content></Dialog.Body>
      <Dialog.Footer><Button variant="secondary" onClick={onClose} disabled={busy}>Close</Button><Button variant="primary" loading={invite.isPending} loadingText="Inviting…" disabled={!selected.length || Boolean(removeCandidate)} onClick={() => void invitePeople()}>Invite {selected.length || ''} {selected.length === 1 ? 'Person' : 'People'}</Button></Dialog.Footer>
    </Dialog>
  );

  if (action === 'agenda') return (
    <Dialog open onClose={onClose} size="lg" variant="form" busy={busy} closeOnBackdrop={false} class="mtg-manage-dialog">
      <Dialog.Header title="Manage Agenda" sub={meeting.title} icon={<LucideIcon name="ListTodo" />} onClose={onClose} />
      <Dialog.Body><Dialog.Content>
        {error ? <div class="mtg-dialog-error" role="alert"><LucideIcon name="CircleAlert" size={15} />{error}</div> : null}
        <Dialog.Section title="Discussion Topics" desc="Reorder topics, assign planned time, and record their current outcome.">
          <div class="mtg-agenda-manager">
            {agendaItems.map((item, index) => <article key={item.key} class="mtg-agenda-manager-row">
              <div class="mtg-agenda-manager-order"><Button variant="ghost" size="sm" iconOnly disabled={index === 0} aria-label={`Move topic ${index + 1} up`} iconLeft={<LucideIcon name="ChevronUp" size={15} />} onClick={() => moveAgenda(index, -1)} /><strong>{index + 1}</strong><Button variant="ghost" size="sm" iconOnly disabled={index === agendaItems.length - 1} aria-label={`Move topic ${index + 1} down`} iconLeft={<LucideIcon name="ChevronDown" size={15} />} onClick={() => moveAgenda(index, 1)} /></div>
              <div class="mtg-agenda-manager-fields"><FormField label="Topic" required><TextInput value={item.title} onInput={value => patchAgenda(item.key, { title: value })} maxLength={300} /></FormField><FormField label="Notes"><Textarea value={item.description} onInput={value => patchAgenda(item.key, { description: value })} rows={2} maxLength={4000} /></FormField></div>
              <div class="mtg-agenda-manager-meta"><FormField label="Minutes"><Select value={item.plannedMinutes} onChange={value => patchAgenda(item.key, { plannedMinutes: value })} options={[{ value: '5', label: '5 min' }, { value: '10', label: '10 min' }, { value: '15', label: '15 min' }, { value: '20', label: '20 min' }, { value: '30', label: '30 min' }, { value: '45', label: '45 min' }, { value: '60', label: '60 min' }]} /></FormField><FormField label="Status"><Select value={item.status} onChange={value => patchAgenda(item.key, { status: value as AgendaEditDraft['status'] })} options={[{ value: 'open', label: 'Open' }, { value: 'covered', label: 'Covered' }, { value: 'deferred', label: 'Deferred' }, { value: 'cancelled', label: 'Cancelled' }]} /></FormField></div>
              <Button variant="ghost" tone="danger" size="sm" iconOnly aria-label={`Remove topic ${index + 1}`} iconLeft={<LucideIcon name="Trash2" size={15} />} onClick={() => setAgendaItems(current => current.filter(value => value.key !== item.key))} />
            </article>)}
            {!agendaItems.length ? <div class="mtg-agenda-empty"><LucideIcon name="ListTodo" size={18} /><span>No agenda topics. Add one to structure the discussion.</span></div> : null}
            <Button variant="secondary" size="sm" iconLeft={<LucideIcon name="Plus" size={15} />} onClick={() => setAgendaItems(current => [...current, { key: crypto.randomUUID(), title: '', description: '', status: 'open', plannedMinutes: '15', ownerUserId: null }])}>Add Topic</Button>
          </div>
        </Dialog.Section>
      </Dialog.Content></Dialog.Body>
      <Dialog.Footer><Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button><Button variant="primary" loading={updateAgenda.isPending} loadingText="Saving…" disabled={agendaItems.some(item => !item.title.trim())} onClick={() => void saveAgenda()}>Save Agenda</Button></Dialog.Footer>
    </Dialog>
  );

  if (action === 'cancel') return (
    <Dialog open onClose={onClose} size="sm" variant="form" busy={busy} closeOnBackdrop={false} class="mtg-manage-dialog">
      <Dialog.Header title="Cancel Meeting" sub={meeting.title} icon={<LucideIcon name="CalendarX2" />} onClose={onClose} />
      <Dialog.Body><Dialog.Content>
        {error ? <div class="mtg-dialog-error" role="alert"><LucideIcon name="CircleAlert" size={15} />{error}</div> : null}
        <Dialog.Section title="Notify Everyone" desc="The meeting, Calendar event, participants, and linked conversation will be updated atomically.">
          <FormField label="Reason" required charCount={{ value: reason.length, max: 500 }}><Textarea value={reason} onInput={setReason} rows={4} maxLength={500} autoFocus placeholder="Explain why the meeting is being cancelled…" /></FormField>
        </Dialog.Section>
      </Dialog.Content></Dialog.Body>
      <Dialog.Footer><Button variant="secondary" onClick={onClose} disabled={busy}>Keep Meeting</Button><Button variant="danger" loading={cancel.isPending} loadingText="Cancelling…" disabled={!reason.trim()} onClick={() => void execute(() => cancel.mutateAsync({ meetingId: meeting.id, idempotencyKey: crypto.randomUUID(), expectedVersion: meeting.version, reason: reason.trim() }))}>Cancel Meeting</Button></Dialog.Footer>
    </Dialog>
  );

  return (
    <Dialog open onClose={onClose} size="sm" variant="form" busy={busy} closeOnBackdrop={false} class="mtg-manage-dialog">
      <Dialog.Header title="Archive Meeting" sub={meeting.reference} icon={<LucideIcon name="Archive" />} onClose={onClose} />
      <Dialog.Body><Dialog.Content><Dialog.Section title="Move To Archive" desc="The meeting remains auditable and can no longer be changed."><p class="mtg-archive-copy">Archive <strong>{meeting.title}</strong>? Its Calendar and Messages history will remain linked.</p>{error ? <div class="mtg-dialog-error" role="alert"><LucideIcon name="CircleAlert" size={15} />{error}</div> : null}</Dialog.Section></Dialog.Content></Dialog.Body>
      <Dialog.Footer><Button variant="secondary" onClick={onClose} disabled={busy}>Keep Active</Button><Button variant="primary" loading={archive.isPending} loadingText="Archiving…" onClick={() => void execute(() => archive.mutateAsync({ meetingId: meeting.id, idempotencyKey: crypto.randomUUID(), expectedVersion: meeting.version }))}>Archive</Button></Dialog.Footer>
    </Dialog>
  );
}
