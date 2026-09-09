import { type VNode } from 'preact';
import { useMemo, useState } from 'preact/hooks';
import {
  Avatar,
  AvatarGroup,
  Badge,
  Button,
  EmptyState,
  FormField,
  LucideIcon,
  SegmentedControl,
  Select,
  Switch,
  TextInput,
} from '@ui';
import type { MeetingActionItemDTO, MeetingListItemDTO, MeetingStatus } from '../../../../types/meetings';
import './meetings.css';

type NewMeetingMode = 'online' | 'in_person' | 'upload';

export interface MeetingsOverviewProps {
  items: MeetingListItemDTO[];
  staged?: boolean;
  previews?: Readonly<Record<string, string>>;
  tasks?: MeetingActionItemDTO[];
  onOpen: (meetingId: string) => void;
  onCreate?: () => void;
  onOpenCalendar?: () => void;
}

const NEW_MEETING_OPTIONS = [
  { value: 'online', label: 'Online meeting', icon: <LucideIcon name="Video" /> },
  { value: 'in_person', label: 'In-person meeting', icon: <LucideIcon name="Mic2" /> },
  { value: 'upload', label: 'Upload recording', icon: <LucideIcon name="UploadCloud" />, disabled: true },
] as const;

function meetingInstant(item: MeetingListItemDTO): Date | null {
  const source = item.schedule.startsAt ?? item.schedule.startsOn;
  if (!source) return null;
  const value = new Date(source);
  return Number.isNaN(value.getTime()) ? null : value;
}

function humanize(value: string): string {
  return value.replace(/_/g, ' ').replace(/\b\w/g, letter => letter.toUpperCase());
}

function statusTone(status: MeetingStatus): 'neutral' | 'warning' | 'danger' | 'info' {
  if (status === 'cancelled') return 'danger';
  if (status === 'processing') return 'warning';
  if (status === 'in_progress') return 'info';
  return 'neutral';
}

function formatSchedule(item: MeetingListItemDTO, includeDate = true): string {
  const starts = meetingInstant(item);
  if (!starts) return 'Schedule pending';
  const date = starts.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  if (item.schedule.allDay) return includeDate ? `${date} · All day` : 'All day';
  const endsSource = item.schedule.endsAt;
  const ends = endsSource ? new Date(endsSource) : null;
  const startTime = starts.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  const endTime = ends && !Number.isNaN(ends.getTime()) ? ends.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : null;
  return `${includeDate ? `${date} · ` : ''}${startTime}${endTime ? `–${endTime}` : ''}`;
}

function durationLabel(item: MeetingListItemDTO): string | null {
  const starts = item.schedule.startsAt ? new Date(item.schedule.startsAt) : null;
  const ends = item.schedule.endsAt ? new Date(item.schedule.endsAt) : null;
  if (!starts || !ends || Number.isNaN(starts.getTime()) || Number.isNaN(ends.getTime())) return null;
  const minutes = Math.max(0, Math.round((ends.getTime() - starts.getTime()) / 60_000));
  return minutes ? `${minutes} min` : null;
}

function isToday(item: MeetingListItemDTO): boolean {
  const starts = meetingInstant(item);
  if (!starts) return false;
  const today = new Date();
  return starts.getFullYear() === today.getFullYear() && starts.getMonth() === today.getMonth() && starts.getDate() === today.getDate();
}

function evidenceLabel(item: MeetingListItemDTO): string {
  const session = item.currentSession;
  if (session?.recordingStatus === 'ready' && session.transcriptStatus === 'ready') return 'Recording and transcript ready';
  if (session?.recordingStatus === 'processing' || session?.transcriptStatus === 'processing' || session?.transcriptStatus === 'queued') return 'Meeting evidence is processing';
  if (session?.summaryStatus === 'published' || session?.summaryStatus === 'reviewed') return 'Reviewed summary is ready';
  if (item.status === 'in_progress') return 'Meeting is currently in progress';
  if (item.myResponseStatus === 'invited') return 'Your invitation response is required';
  return 'Open the meeting workspace for its complete record and follow-up.';
}

function MeetingPreviewCard({ item, preview, onOpen }: { item: MeetingListItemDTO; preview?: string; onOpen: (meetingId: string) => void }): VNode {
  const duration = durationLabel(item);
  return <article class="mtg-home-recent-card">
    <header>
      <button type="button" onClick={() => onOpen(item.id)}>{item.title}</button>
      <Badge tone={statusTone(item.status)} variant="soft">{humanize(item.status)}</Badge>
    </header>
    <div class="mtg-home-card-facts">
      <span><LucideIcon name="CalendarDays" size={14} />{formatSchedule(item)}</span>
      {duration ? <span><LucideIcon name="Clock3" size={14} />{duration}</span> : null}
      <span>{item.reference}</span>
    </div>
    <p>{preview ?? evidenceLabel(item)}</p>
    <footer>
      <div class="mtg-home-card-labels">
        {item.labels.length ? item.labels.slice(0, 2).map(label => <Badge key={label.id} tone="neutral" variant="soft"><LucideIcon name="Tag" size={11} />{label.name}</Badge>) : <Badge tone="neutral" variant="soft"><LucideIcon name="Video" size={11} />Meeting</Badge>}
      </div>
      <div class="mtg-home-card-people">
        <AvatarGroup people={item.participantPreview.map(person => ({ id: person.userId, name: person.displayName, src: person.profileImage }))} max={3} size={27} label={`${item.participantCount} meeting participants`} />
        <span>{item.participantCount}</span>
        <Button variant="ghost" size="sm" iconOnly aria-label={`Open ${item.title}`} iconLeft={<LucideIcon name="ArrowUpRight" size={16} />} onClick={() => onOpen(item.id)} />
      </div>
    </footer>
  </article>;
}

function TodayMeeting({ item, onOpen }: { item: MeetingListItemDTO; onOpen: (meetingId: string) => void }): VNode {
  return <article class="mtg-home-today-card">
    <button type="button" onClick={() => onOpen(item.id)}>
      <span class="mtg-home-today-title"><strong>{item.title}</strong></span>
      <span class="mtg-home-today-time"><LucideIcon name="Clock3" size={13} />{formatSchedule(item, false)}<Badge tone={statusTone(item.status)} variant="soft">{humanize(item.status)}</Badge></span>
      <span class="mtg-home-today-person"><Avatar name={item.organizer.displayName} seed={item.organizer.userId} src={item.organizer.profileImage} size={24} decorative />{item.organizer.displayName}</span>
    </button>
    <Switch checked={false} disabled onChange={() => undefined} size="sm" aria-label={`Capture ${item.title}`} />
  </article>;
}

export function MeetingsOverview({ items, staged = false, previews, tasks = [], onOpen, onCreate, onOpenCalendar }: MeetingsOverviewProps): VNode {
  const [mode, setMode] = useState<NewMeetingMode>('online');
  const [showAll, setShowAll] = useState(false);
  const recent = useMemo(() => [...items].sort((left, right) => {
    const leftTime = meetingInstant(left)?.getTime() ?? new Date(left.updatedAt).getTime();
    const rightTime = meetingInstant(right)?.getTime() ?? new Date(right.updatedAt).getTime();
    return rightTime - leftTime;
  }), [items]);
  const today = useMemo(() => items.filter(isToday).sort((left, right) => (meetingInstant(left)?.getTime() ?? 0) - (meetingInstant(right)?.getTime() ?? 0)), [items]);
  const visibleRecent = showAll ? recent : recent.slice(0, 2);

  return <main class="mtg-page mtg-home" aria-label={staged ? 'Staged Meetings home' : 'Meetings home'}>
    <div class="mtg-home-layout">
      <section class="mtg-home-main">
        <section class="mtg-home-new">
          <div class="mtg-home-section-title"><div><span>New meeting</span>{staged ? <Badge tone="neutral" variant="outline">Staged capture UI</Badge> : null}</div>{onCreate ? <Button variant="ghost" size="sm" onClick={onCreate} iconLeft={<LucideIcon name="CalendarPlus" size={15} />}>Schedule meeting</Button> : null}</div>
          <div class="mtg-home-new-panel">
            <SegmentedControl value={mode} onChange={setMode} options={NEW_MEETING_OPTIONS} label="New meeting type" fullWidth />
            <div class="mtg-home-capture-form">
              <div class="mtg-home-capture-url">
                <TextInput readOnly value="" placeholder={mode === 'online' ? 'Paste your meeting URL here' : 'Enter the meeting room or location'} aria-label={mode === 'online' ? 'Meeting URL preview' : 'Meeting location preview'} />
                <div class="mtg-home-provider-icons" aria-label="Supported conferencing providers"><span title="Google Meet"><LucideIcon name="Video" size={15} /></span><span title="Zoom"><LucideIcon name="Camera" size={15} /></span><span title="Microsoft Teams"><LucideIcon name="UsersRound" size={15} /></span></div>
                <Button variant="primary" disabled title="Meeting capture is not connected yet" iconLeft={<LucideIcon name="Radio" size={15} />}>{mode === 'online' ? 'Start capturing' : 'Start session'}</Button>
              </div>
              <div class="mtg-home-capture-fields">
                <FormField label="Name your meeting" helpText="Optional"><TextInput readOnly value="" placeholder="E.g. Weekly operations review" /></FormField>
                <FormField label="Meeting language"><Select disabled value="en" onChange={() => undefined} options={[{ value: 'en', label: 'English' }]} /></FormField>
                <FormField label="Bot name"><TextInput readOnly value="SIOMAC Meeting Assistant" /></FormField>
              </div>
            </div>
          </div>
        </section>

        <section class="mtg-home-recent">
          <div class="mtg-home-section-title"><div><span>{showAll ? 'All meetings' : 'Recent meetings'}</span></div>{recent.length > 2 ? <Button variant="ghost" size="sm" onClick={() => setShowAll(value => !value)} iconRight={<LucideIcon name={showAll ? 'ChevronUp' : 'ArrowRight'} size={15} />}>{showAll ? 'Show recent' : 'Go to meetings'}</Button> : null}</div>
          <div class="mtg-home-recent-grid">{visibleRecent.length ? visibleRecent.map(item => <MeetingPreviewCard key={item.id} item={item} preview={previews?.[item.id]} onOpen={onOpen} />) : <EmptyState icon={<LucideIcon name="CalendarDays" />} title="No meetings yet" text="Scheduled and completed meetings will appear here." size="compact" />}</div>
        </section>
      </section>

      <aside class="mtg-home-rail" aria-label="Today and meeting actions">
        <section class="mtg-home-today">
          <header><div><span>Today</span><small>{new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}</small></div>{onOpenCalendar ? <Button variant="ghost" size="sm" iconOnly aria-label="Open Calendar" iconLeft={<LucideIcon name="CalendarDays" size={17} />} onClick={onOpenCalendar} /> : null}</header>
          <div class="mtg-home-rail-heading"><strong>Meetings</strong><Button variant="secondary" size="sm" disabled title="Automatic capture is not connected" iconRight={<LucideIcon name="ChevronDown" size={13} />}>Capture all</Button></div>
          <div class="mtg-home-today-list">{today.length ? today.map(item => <TodayMeeting key={item.id} item={item} onOpen={onOpen} />) : <div class="mtg-home-rail-empty"><LucideIcon name="CalendarCheck2" size={20} /><span>No meetings scheduled today.</span></div>}</div>
        </section>
        <section class="mtg-home-tasks">
          <div class="mtg-home-rail-heading"><strong>To do</strong><span>{tasks.filter(task => task.status !== 'completed' && task.status !== 'cancelled').length} open</span></div>
          <div class="mtg-home-task-list">{tasks.length ? tasks.slice(0, 4).map(task => <button type="button" key={task.id} onClick={() => onOpen(task.meetingId)}><span class={`mtg-home-task-check is-${task.status}`}>{task.status === 'completed' ? <LucideIcon name="Check" size={12} /> : null}</span><span><strong>{task.title}</strong><small>{task.owner?.displayName ?? 'Owner required'}{task.dueAt ? ` · Due ${new Date(task.dueAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : ''}</small></span></button>) : <div class="mtg-home-rail-empty"><LucideIcon name="ListChecks" size={20} /><span>No meeting action items are assigned here.</span></div>}</div>
        </section>
      </aside>
    </div>
  </main>;
}
