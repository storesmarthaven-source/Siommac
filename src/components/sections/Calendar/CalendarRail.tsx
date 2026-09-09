import { type VNode } from 'preact';
import { useMemo } from 'preact/hooks';
import type { CalendarAttendeeResponse, CalendarItemDTO } from '@api/calendar';
import { useCalendarItem, useCalendarReminders, useRespondToCalendarActivity } from '@api/calendar';
import { useMessageRecipients } from '@api/communications';
import { Avatar, Button, Drawer, LucideIcon } from '@ui';
import { useSessionStore } from '@store/session';
import { showSection } from '@components/nav/navCore';
import { itemDateKey, parseLocalDate, timeLabel } from '@lib/calendar/date';
import { calendarStagingDetail } from './calendarStaging';

function scheduleLabel(item: CalendarItemDTO): string {
  const key = itemDateKey(item);
  const date = key ? parseLocalDate(key) : null;
  const day = date?.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) ?? 'Date pending';
  if (item.allDay) return `${day} · All day`;
  const start = item.startsAt ? timeLabel(item.startsAt) : 'Time pending';
  const end = item.endsAt ? timeLabel(item.endsAt) : null;
  return `${day} · ${start}${end ? ` – ${end}` : ''}`;
}

function compactNotes(item: CalendarItemDTO): string[] {
  if (!item.notes?.trim()) return [];
  return item.notes.split(/\r?\n|(?<=[.!?])\s+/).map(part => part.trim()).filter(Boolean).slice(0, 4);
}

function nativeCalendarId(item: CalendarItemDTO | null, readOnly: boolean): string | null {
  if (!item || readOnly || item.origin !== 'calendar') return null;
  return item.id.split('::')[0] ?? null;
}

function responseIcon(status: CalendarAttendeeResponse): 'Check' | 'X' | 'Clock3' | 'Mail' {
  if (status === 'accepted') return 'Check';
  if (status === 'declined') return 'X';
  if (status === 'tentative') return 'Clock3';
  return 'Mail';
}

function firstNonBlank(values: (string | null | undefined)[], fallback: string): string {
  return values.find(value => Boolean(value?.trim()))?.trim() ?? fallback;
}

export function CalendarRail({ focusedItem: active, readOnly = false, onEditItem, onCollapse }: {
  focusedItem: CalendarItemDTO | null;
  readOnly?: boolean;
  onEditItem?: (item: CalendarItemDTO, anchor: HTMLElement) => void;
  onCollapse: () => void;
}): VNode {
  const userId = useSessionStore(state => state.userId);
  const liveId = nativeCalendarId(active, readOnly);
  const detail = useCalendarItem(liveId);
  const reminders = useCalendarReminders(liveId);
  const directory = useMessageRecipients('', { enabled: Boolean(liveId && active?.type === 'activity') });
  const respond = useRespondToCalendarActivity();
  const staged = readOnly && active ? calendarStagingDetail(active) : null;
  const noteItems = staged?.agenda ?? (active ? compactNotes(active) : []);
  const peopleById = useMemo(() => new Map((directory.data ?? []).map(person => [person.userId, person])), [directory.data]);
  const liveAttendees = detail.data?.attendees ?? [];
  const myAttendance = liveAttendees.find(attendee => attendee.userId === userId);
  const attendees: { userId: string; name: string; role: string; responseStatus: CalendarAttendeeResponse; photoUrl: string | null }[] = staged
    ? staged.attendees.map(attendee => ({ ...attendee, photoUrl: attendee.profileImage }))
    : liveAttendees.map(attendee => {
      const person = peopleById.get(attendee.userId);
      return {
        userId: attendee.userId,
        name: firstNonBlank([person?.displayName, person?.username], 'SIOMAC employee'),
        role: firstNonBlank([person?.role, person?.department], 'Invitee'),
        responseStatus: attendee.responseStatus,
        photoUrl: person?.profileImage ?? null,
      };
    });
  const responseStatus = staged?.myResponse ?? myAttendance?.responseStatus ?? null;
  const isMeeting = active?.sourceModule === 'meetings';

  const setResponse = (next: 'accepted' | 'declined'): void => {
    if (!liveId || readOnly || respond.isPending) return;
    void respond.mutateAsync({ id: liveId, responseStatus: next });
  };
  const reminderOffsets = readOnly ? [15] : reminders.data ?? [];

  return (
    <Drawer
      open
      contained
      noFooter
      title="Schedule details"
      sub={active ? `${active.title} · ${scheduleLabel(active)}` : 'Select an event to review its schedule.'}
      headIcon={<LucideIcon name="CalendarDays" size={19} />}
      headActions={active?.editable && onEditItem
        ? <Button variant="ghost" size="sm" iconOnly aria-label="Edit event" title="Edit event" iconLeft={<LucideIcon name="Pencil" size={15} />} onClick={event => onEditItem(active, event.currentTarget as HTMLElement)} />
        : null}
      closeLabel="Close schedule details"
      panelClass="cal-side-rail cal-schedule-drawer"
      onClose={onCollapse}
    >
      {active ? <div class="cal-detail-rail-body">
        <section class="cal-detail-intro">
          <div class="cal-detail-kickers">
            <span><LucideIcon name={isMeeting ? 'Video' : active.type === 'task' ? 'ListChecks' : active.type === 'deadline' ? 'CalendarClock' : 'CalendarDays'} size={12} />{isMeeting ? 'Meeting' : active.type}</span>
            {active.status ? <span>{active.status.replace(/_/g, ' ')}</span> : null}
            {active.priority || active.sourcePriority ? <span>{active.priority ?? active.sourcePriority} priority</span> : null}
          </div>
          <h2>{active.title}</h2>
          <ul>
            <li><LucideIcon name="UserRound" size={15} /><span>Created by <strong>{active.ownerName ?? 'Source module'}</strong></span></li>
            {staged?.updatedLabel ? <li><LucideIcon name="Clock3" size={15} /><span>Last updated <strong>{staged.updatedLabel}</strong></span></li> : null}
            <li><LucideIcon name="CalendarDays" size={15} /><span>Scheduled on <strong>{scheduleLabel(active)}</strong></span></li>
            {active.locationLabel ? <li><LucideIcon name="MapPin" size={15} /><span>Location <strong>{active.locationLabel}</strong></span></li> : null}
            {active.calendarName ? <li><LucideIcon name="CalendarRange" size={15} /><span>Calendar <strong>{active.calendarName}</strong></span></li> : null}
            {active.visibility ? <li><LucideIcon name="Eye" size={15} /><span>Access <strong>{active.visibility === 'personal' ? 'Personal' : active.visibility === 'team' ? active.departmentName ?? 'Department' : 'Organisation'}</strong></span></li> : null}
          </ul>
          {isMeeting
            ? <Button variant="secondary" size="sm" fullWidth disabled={readOnly ? !staged?.joinAvailable : !active.sourceRoute} onClick={() => active.sourceRoute && showSection(active.sourceRoute)} iconLeft={<LucideIcon name="Video" size={15} />}>{staged ? 'Join meeting room' : 'Open meeting workspace'}</Button>
            : null}
        </section>

        {active.type === 'activity' && responseStatus ? <section class="cal-response-card">
          <small>{responseStatus === 'invited' ? "You haven't responded to this invite yet" : 'Your invitation response'}</small>
          <strong>{responseStatus === 'invited' ? 'Are you available to attend this meeting?' : `Response: ${responseStatus}`}</strong>
          <div class="cal-response-actions">
            <Button variant="secondary" tone="danger" size="sm" disabled={readOnly || respond.isPending} pressed={responseStatus === 'declined'} onClick={() => setResponse('declined')} iconLeft={<LucideIcon name="X" size={14} />}>Decline</Button>
            <Button variant="primary" size="sm" disabled={readOnly || respond.isPending} pressed={responseStatus === 'accepted'} onClick={() => setResponse('accepted')} iconLeft={<LucideIcon name="Check" size={14} />}>Accept</Button>
          </div>
        </section> : null}

        <section class="cal-detail-section">
          <header><strong>{noteItems.length ? 'What we’ll cover' : 'Event details'}</strong></header>
          {noteItems.length ? <div class="cal-detail-checklist">{noteItems.map(note => <div key={note}><span aria-hidden="true" /><p>{note}</p></div>)}</div>
            : <p class="cal-detail-placeholder">No notes were added to this item.</p>}
        </section>

        {active.origin === 'calendar' && active.status !== 'done' && active.status !== 'cancelled' && reminderOffsets.length ? <section class="cal-detail-section cal-detail-reminders">
          <header><strong>My reminders</strong><span><LucideIcon name="BellRing" size={14} /></span></header>
          <p class="cal-detail-placeholder">Delivered through your notification preferences. Change reminder timing from Edit.</p>
          <div class="cal-detail-reminder-options">
            {reminderOffsets.map(minutes => <span class="cal-detail-reminder-chip" key={minutes}>{minutes === 0 ? 'At start' : minutes < 60 ? `${minutes} min before` : minutes < 1440 ? `${minutes / 60} hr before` : `${minutes / 1440} day before`}</span>)}
          </div>
        </section> : null}

        <section class="cal-detail-section cal-detail-attendees">
          <header><strong>Attendees</strong><span>{active.attendeeCount || attendees.length}</span></header>
          {attendees.length ? <div class="cal-attendee-list">{attendees.map(person => <article key={person.userId}>
            <Avatar name={person.name} src={person.photoUrl} seed={person.userId} size={32} decorative />
            <span><strong>{person.name}</strong><small>{person.role}</small></span>
            <i class={`cal-attendee-response is-${person.responseStatus}`} title={person.responseStatus}><LucideIcon name={responseIcon(person.responseStatus)} size={13} /></i>
          </article>)}</div> : <p class="cal-detail-placeholder">No named attendees are available for this item.</p>}
        </section>

        {active.sourceLabel || active.sourceRef ? <section class="cal-detail-section cal-detail-source">
          <header><strong>Linked source</strong></header>
          <button type="button" disabled={!active.sourceRoute} onClick={() => active.sourceRoute && showSection(active.sourceRoute)}>
            <span><LucideIcon name="Link2" size={15} /></span>
            <span><strong>{active.sourceLabel ?? active.sourceModule ?? 'Source record'}</strong><small>{active.sourceRef ?? 'Open the connected workspace'}</small></span>
            <LucideIcon name="ArrowUpRight" size={14} />
          </button>
        </section> : null}

        {isMeeting ? <section class="cal-detail-section cal-detail-comments">
          <header><strong>Comments</strong><span>{staged?.comments.length ?? 0}</span></header>
          {staged?.comments.map(comment => <article key={comment.id}><Avatar name={comment.author} seed={comment.author} size={28} decorative /><div><strong>{comment.author}<small>{comment.createdLabel}</small></strong><p>{comment.body}</p></div></article>)}
          <div class="cal-comment-composer" aria-label="Meeting comments are available in the meeting workspace">
            <LucideIcon name="Plus" size={14} />
            <span>Comment anything here…</span>
            <LucideIcon name="Mic" size={14} />
            <Button variant="primary" size="sm" iconOnly disabled aria-label="Send comment" iconLeft={<LucideIcon name="ArrowUp" size={14} />} />
          </div>
        </section> : null}
      </div> : <div class="cal-detail-empty"><LucideIcon name="CalendarSearch" size={30} /><strong>Select a calendar item</strong><span>Its schedule, people, notes, and available actions will appear here.</span></div>}
    </Drawer>
  );
}
