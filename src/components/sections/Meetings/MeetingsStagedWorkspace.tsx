import { type VNode } from 'preact';
import { useEffect, useMemo, useState } from 'preact/hooks';
import {
  Alert,
  Avatar,
  Badge,
  Button,
  DropdownMenu,
  EmptyState,
  LucideIcon,
  OverflowTooltipText,
  Progress,
  SearchField,
  Select,
  TabPanel,
  Tabs,
  type MenuAction,
  type TabItem,
} from '@ui';
import type { MeetingDetailDTO, MeetingTranscriptSegmentDTO } from '../../../../types/meetings';
import type { MeetingStagingScenario } from './meetingStaging';
import { meetingStagingScenarios } from './meetingStaging';
import './meetings.css';

type MeetingTab = 'summary' | 'agenda' | 'actions' | 'snippets' | 'decisions';
type EvidenceTab = 'speakers' | 'transcript' | 'keywords';

export type MeetingWorkspaceAction =
  | 'edit' | 'participants' | 'agenda' | 'share' | 'conversation' | 'join'
  | 'rsvp_accept' | 'rsvp_tentative' | 'rsvp_decline'
  | 'start' | 'end' | 'cancel' | 'archive';

const DETAIL_TABS: readonly TabItem[] = [
  { id: 'summary', label: 'Summary', icon: <LucideIcon name="Sparkles" /> },
  { id: 'agenda', label: 'Agenda', icon: <LucideIcon name="ListTodo" /> },
  { id: 'actions', label: 'Action Items', icon: <LucideIcon name="ListChecks" /> },
  { id: 'snippets', label: 'Snippets', icon: <LucideIcon name="Scissors" /> },
  { id: 'decisions', label: 'Decisions', icon: <LucideIcon name="BadgeCheck" /> },
];

const EVIDENCE_TABS: readonly TabItem[] = [
  { id: 'speakers', label: 'Speakers', icon: <LucideIcon name="UsersRound" /> },
  { id: 'transcript', label: 'Transcripts', icon: <LucideIcon name="Captions" /> },
  { id: 'keywords', label: 'Keywords', icon: <LucideIcon name="Search" /> },
];

const STOP_WORDS = new Set([
  'about', 'after', 'again', 'before', 'being', 'confirm', 'could', 'every', 'final', 'from',
  'have', 'into', 'meeting', 'only', 'remain', 'should', 'still', 'that', 'their', 'there', 'these',
  'they', 'this', 'until', 'with', 'would', 'your', 'will',
]);

function formatDate(iso: string | null): string {
  if (!iso) return 'Schedule pending';
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatTime(iso: string | null): string {
  if (!iso) return 'Time pending';
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function transcriptTime(milliseconds: number): string {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

function statusTone(status: string): 'neutral' | 'success' | 'warning' | 'danger' | 'info' {
  if (status === 'completed') return 'success';
  if (status === 'cancelled' || status === 'processing_failed') return 'danger';
  if (status === 'processing') return 'warning';
  if (status === 'live' || status === 'in_progress') return 'info';
  return 'neutral';
}

function personAvatar(person: { userId: string; displayName: string; profileImage: string | null }, size = 30): VNode {
  return <Avatar name={person.displayName} seed={person.userId} src={person.profileImage} size={size} decorative />;
}

function requireScenarioDetail(scenario: MeetingStagingScenario): MeetingDetailDTO {
  if (!scenario.detail) throw new Error(`Meeting scenario ${scenario.kind} does not expose meeting detail.`);
  return scenario.detail;
}

function requireScenario(scenario: MeetingStagingScenario | undefined): MeetingStagingScenario {
  if (!scenario) throw new Error('The Meetings workspace requires at least one scenario.');
  return scenario;
}

function SummaryPanel({ scenario, staged }: { scenario: MeetingStagingScenario; staged: boolean }): VNode {
  const detail = requireScenarioDetail(scenario);
  const summary = scenario.summaries.find(value => value.status === 'published' || value.status === 'reviewed') ?? detail.publishedSummary;
  return <TabPanel tabsId="meeting-detail-tabs" tabId="summary" value="summary">
    <div class="mtg-detail-tab-body">
      {summary ? <>
        <section class="mtg-insight-block is-summary">
          <header><span><LucideIcon name="FileText" size={16} /><strong>Overview</strong></span><LucideIcon name="ChevronDown" size={16} /></header>
          <p>{summary.content.shortSummary}</p>
        </section>
        <section class="mtg-insight-block">
          <header><span><LucideIcon name="CheckSquare2" size={16} /><strong>Key Points</strong></span><LucideIcon name="ChevronDown" size={16} /></header>
          <ul class="mtg-key-points">{summary.content.keyTakeaways.map(item => <li key={item}>{item}</li>)}</ul>
        </section>
        <section class="mtg-insight-block">
          <header><span><LucideIcon name="BookOpen" size={16} /><strong>AI Insights</strong></span><span class="mtg-preview-mark"><LucideIcon name="Sparkles" size={13} /> Interface Preview</span></header>
          <p>{staged ? 'The team aligned on accountable ownership, preserved the original evidence, and kept the unresolved safety item visible through handover.' : 'AI insights will appear after authorised transcription and human review are connected.'}</p>
        </section>
      </> : <EmptyState icon={<LucideIcon name="FileSearch" />} title="No reviewed summary" text={staged ? 'This state demonstrates how the workspace looks before a summary is available.' : 'A reviewed meeting summary has not been published for this session.'} size="compact" />}
    </div>
  </TabPanel>;
}

function ActionsPanel({ scenario }: { scenario: MeetingStagingScenario }): VNode {
  return <TabPanel tabsId="meeting-detail-tabs" tabId="actions" value="actions"><div class="mtg-detail-tab-body">
    <header class="mtg-panel-intro"><div><strong>Action Items</strong><p>Accepted tasks remain linked to their owner, deadline, and transcript evidence.</p></div><Badge tone="neutral" variant="outline">{scenario.actionItems.length} items</Badge></header>
    {scenario.actionItems.length ? <div class="mtg-action-list">{scenario.actionItems.map(action => <article key={action.id}><span class={`mtg-action-check is-${action.status}`}>{action.status === 'completed' ? <LucideIcon name="Check" size={12} /> : null}</span><div><strong>{action.title}</strong><small>{action.owner?.displayName ?? 'Owner required'}{action.dueAt ? ` · Due ${formatDate(action.dueAt)}` : ''}</small>{action.evidence?.excerpt ? <span class="mtg-evidence-link"><LucideIcon name="Captions" size={12} /> {action.evidence.excerpt}</span> : null}</div><Badge tone={action.status === 'completed' ? 'success' : action.status === 'proposed' ? 'warning' : 'info'} variant="soft">{action.status.replace(/_/g, ' ')}</Badge></article>)}</div> : <EmptyState icon={<LucideIcon name="ListChecks" />} title="No action items" text="Accepted follow-up work will appear here." size="compact" />}
  </div></TabPanel>;
}

function AgendaPanel({ scenario }: { scenario: MeetingStagingScenario }): VNode {
  const detail = requireScenarioDetail(scenario);
  return <TabPanel tabsId="meeting-detail-tabs" tabId="agenda" value="agenda"><div class="mtg-detail-tab-body">
    <header class="mtg-panel-intro"><div><strong>Meeting Agenda</strong><p>Discussion topics stay ordered, owned, and timed with the meeting record.</p></div><Badge tone="neutral" variant="outline">{detail.agendaItems.length} topics</Badge></header>
    {detail.agendaItems.length ? <ol class="mtg-agenda-list">{detail.agendaItems.map(item => <li key={item.id}><span>{item.sequence + 1}</span><div><strong>{item.title}</strong><small>{[item.owner?.displayName, item.plannedMinutes ? `${item.plannedMinutes} min` : null].filter(Boolean).join(' · ') || 'No owner or planned time'}{item.description ? ` · ${item.description}` : ''}</small></div><Badge tone={item.status === 'covered' ? 'success' : item.status === 'deferred' ? 'warning' : 'neutral'} variant="soft">{item.status}</Badge></li>)}</ol> : <EmptyState icon={<LucideIcon name="ListTodo" />} title="No agenda topics" text="The organiser can add topics from the meeting actions menu." size="compact" />}
  </div></TabPanel>;
}

function SnippetsPanel({ scenario, onSeek }: { scenario: MeetingStagingScenario; onSeek: (milliseconds: number) => void }): VNode {
  const snippets = scenario.chapters.length ? scenario.chapters : scenario.transcript.slice(0, 4).map(segment => ({ id: segment.id, startsAtMs: segment.startsAtMs, title: segment.speaker?.displayName ?? 'Meeting excerpt', summary: segment.text }));
  return <TabPanel tabsId="meeting-detail-tabs" tabId="snippets" value="snippets"><div class="mtg-detail-tab-body">
    <header class="mtg-panel-intro"><div><strong>Evidence Snippets</strong><p>Jump to a chapter or saved moment without losing its source context.</p></div><Badge tone="neutral" variant="outline">{snippets.length} snippets</Badge></header>
    {snippets.length ? <div class="mtg-snippet-list">{snippets.map(snippet => <button type="button" key={snippet.id} onClick={() => onSeek(snippet.startsAtMs)}><time>{transcriptTime(snippet.startsAtMs)}</time><span><strong>{snippet.title}</strong><small>{snippet.summary ?? 'No description available.'}</small></span><LucideIcon name="Play" size={15} /></button>)}</div> : <EmptyState icon={<LucideIcon name="Scissors" />} title="No snippets" text="Saved transcript moments and chapters will appear here." size="compact" />}
  </div></TabPanel>;
}

function DecisionsPanel({ scenario }: { scenario: MeetingStagingScenario }): VNode {
  const detail = requireScenarioDetail(scenario);
  const summary = scenario.summaries.find(value => value.status === 'published' || value.status === 'reviewed') ?? detail.publishedSummary;
  const decisions = summary?.content.decisions ?? [];
  return <TabPanel tabsId="meeting-detail-tabs" tabId="decisions" value="decisions"><div class="mtg-detail-tab-body">
    <header class="mtg-panel-intro"><div><strong>Meeting Decisions</strong><p>Reviewed outcomes are separated from suggestions and remain traceable to the meeting.</p></div><Badge tone="neutral" variant="outline">{decisions.length} decisions</Badge></header>
    {decisions.length ? <div class="mtg-decision-list">{decisions.map((decision, index) => <article key={decision}><span>{String(index + 1).padStart(2, '0')}</span><div><strong>{decision}</strong><small><LucideIcon name="ShieldCheck" size={12} /> Human reviewed · Evidence linked</small></div></article>)}</div> : <EmptyState icon={<LucideIcon name="BadgeCheck" />} title="No reviewed decisions" text="Reviewed decisions will appear here after the meeting." size="compact" />}
  </div></TabPanel>;
}

function transcriptKeywords(segments: MeetingTranscriptSegmentDTO[]): { label: string; count: number }[] {
  const counts = new Map<string, number>();
  segments.forEach(segment => segment.text.toLowerCase().match(/[a-z][a-z-]{3,}/g)?.forEach(word => {
    if (!STOP_WORDS.has(word)) counts.set(word, (counts.get(word) ?? 0) + 1);
  }));
  return [...counts.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0])).slice(0, 12).map(([label, count]) => ({ label, count }));
}

function RecordingStage({ scenario, currentMs, onSeek }: { scenario: MeetingStagingScenario; currentMs: number; onSeek: (milliseconds: number) => void }): VNode {
  const detail = requireScenarioDetail(scenario);
  const recording = scenario.artifacts.find(artifact => artifact.kind === 'recording' || artifact.kind === 'audio');
  const recordingStatus = recording?.status ?? detail.currentSession?.recordingStatus;
  const participants = detail.participants.slice(0, 5);
  const durationMs = Math.max(1, (recording?.durationSeconds ?? Math.ceil((scenario.transcript.at(-1)?.endsAtMs ?? 0) / 1000)) * 1000);
  const main = participants[0];
  const others = participants.slice(1);
  return <section class={`mtg-recording-stage is-${recordingStatus ?? 'empty'}`} aria-label="Meeting recording preview">
    <div class="mtg-video-grid">
      <div class="mtg-video-primary">{main ? personAvatar(main.person, 92) : <LucideIcon name="VideoOff" size={34} />}<span>{main?.person.displayName ?? 'Recording unavailable'}</span></div>
      <div class="mtg-video-rail">{others.length ? others.map(participant => <div class="mtg-video-tile" key={participant.id}>{personAvatar(participant.person, 48)}<span>{participant.person.displayName}</span></div>) : <div class="mtg-video-tile is-empty"><LucideIcon name="VideoOff" size={22} /><span>No participant video</span></div>}</div>
    </div>
    <div class="mtg-speaker-timeline" aria-hidden="true">{scenario.transcript.map(segment => <i key={segment.id} style={`left:${Math.min(100, (segment.startsAtMs / durationMs) * 100)}%;width:${Math.max(1.5, ((segment.endsAtMs - segment.startsAtMs) / durationMs) * 100)}%`} />)}</div>
    <div class="mtg-player-row">
      <time>{transcriptTime(currentMs)}</time>
      <button type="button" class="mtg-player-track" aria-label="Seek meeting recording" disabled={!recording?.playable} onClick={event => { const box = event.currentTarget.getBoundingClientRect(); onSeek(((event.clientX - box.left) / box.width) * durationMs); }}><i style={`width:${Math.min(100, (currentMs / durationMs) * 100)}%`} /></button>
      <time>{transcriptTime(durationMs)}</time>
    </div>
    <div class="mtg-player-controls"><Button variant="ghost" size="sm" iconOnly aria-label="Back 10 seconds" disabled={!recording?.playable} iconLeft={<LucideIcon name="RotateCcw" size={16} />} onClick={() => onSeek(Math.max(0, currentMs - 10_000))} /><Button variant="primary" size="sm" iconOnly aria-label="Play meeting recording" disabled={!recording?.playable} iconLeft={<LucideIcon name="Play" size={18} />} /><Button variant="ghost" size="sm" iconOnly aria-label="Forward 10 seconds" disabled={!recording?.playable} iconLeft={<LucideIcon name="RotateCw" size={16} />} onClick={() => onSeek(Math.min(durationMs, currentMs + 10_000))} /><span>{recordingStatus === 'ready' ? 'Recording ready' : recordingStatus === 'processing' ? 'Processing recording' : 'No recording'}</span></div>
  </section>;
}

function EvidenceWorkspace({ scenario, staged, query, onQueryChange, seekToMs }: { scenario: MeetingStagingScenario; staged: boolean; query: string; onQueryChange: (value: string) => void; seekToMs: number | null }): VNode {
  const [tab, setTab] = useState<EvidenceTab>('transcript');
  const [activeMs, setActiveMs] = useState<number | null>(null);
  useEffect(() => { setActiveMs(null); setTab('transcript'); }, [scenario.listItem.id]);
  useEffect(() => { if (seekToMs !== null) { setActiveMs(seekToMs); setTab('transcript'); } }, [seekToMs]);
  const currentMs = activeMs ?? 0;
  const visible = useMemo(() => {
    const clean = query.trim().toLowerCase();
    if (!clean) return scenario.transcript;
    return scenario.transcript.filter(segment => `${segment.speaker?.displayName ?? ''} ${segment.text}`.toLowerCase().includes(clean));
  }, [query, scenario.transcript]);
  const keywords = useMemo(() => transcriptKeywords(scenario.transcript), [scenario.transcript]);
  const speakers = useMemo(() => {
    const byName = new Map<string, { displayName: string; userId: string; profileImage: string | null; milliseconds: number; turns: number }>();
    scenario.transcript.forEach(segment => {
      const displayName = segment.speaker?.displayName ?? 'Unknown Speaker';
      const existing = byName.get(displayName) ?? { displayName, userId: segment.speaker?.userId ?? segment.id, profileImage: segment.speaker?.profileImage ?? null, milliseconds: 0, turns: 0 };
      existing.milliseconds += Math.max(0, segment.endsAtMs - segment.startsAtMs);
      existing.turns += 1;
      byName.set(displayName, existing);
    });
    return [...byName.values()].sort((left, right) => right.milliseconds - left.milliseconds);
  }, [scenario.transcript]);
  const totalSpeakerMs = speakers.reduce((total, speaker) => total + speaker.milliseconds, 0);
  const recordingStatus = scenario.artifacts.find(artifact => artifact.kind === 'recording' || artifact.kind === 'audio')?.status ?? scenario.detail?.currentSession?.recordingStatus;

  return <aside class="mtg-evidence-pane" aria-label="Recording and transcript">
    <RecordingStage scenario={scenario} currentMs={currentMs} onSeek={setActiveMs} />
    <section class="mtg-evidence-workspace">
      <Tabs id="meeting-evidence-tabs" items={EVIDENCE_TABS} value={tab} onChange={value => setTab(value as EvidenceTab)} label="Meeting evidence views" size="md" variant="contained" fullWidth />
      {staged && scenario.transcript.length ? <Alert tone="neutral" class="mtg-ai-preview-alert" icon={<LucideIcon name="Sparkles" size={14} />}><strong>Interface Preview</strong> — AI transcription is staged and not connected.</Alert> : null}
      {tab === 'transcript' ? <TabPanel tabsId="meeting-evidence-tabs" tabId="transcript" value="transcript"><div class="mtg-transcript-tools"><span><strong>Transcript</strong><small>{scenario.transcript.length} evidence-linked segments</small></span>{scenario.transcript.length ? <SearchField value={query} onInput={onQueryChange} size="sm" aria-label="Search transcript" placeholder="Search transcript…" /> : null}</div><div class="mtg-transcript-list">{visible.length ? visible.map(segment => <button type="button" class={`mtg-transcript-segment${currentMs === segment.startsAtMs ? ' is-active' : ''}`} key={segment.id} onClick={() => setActiveMs(segment.startsAtMs)}><time>{transcriptTime(segment.startsAtMs)}</time><span>{segment.speaker ? personAvatar({ userId: segment.speaker.userId ?? segment.id, displayName: segment.speaker.displayName, profileImage: segment.speaker.profileImage }, 30) : <span class="mtg-speaker-placeholder" />}<p><strong>{segment.speaker?.displayName ?? 'Unknown Speaker'}</strong>{segment.text}</p></span></button>) : query ? <EmptyState icon={<LucideIcon name="SearchX" />} title="No transcript matches" text={`No speaker or transcript text matches “${query}”.`} size="compact" /> : <EmptyState icon={<LucideIcon name="CaptionsOff" />} title={recordingStatus === 'processing' ? 'Transcript processing' : 'Transcript unavailable'} text={recordingStatus === 'processing' ? 'The transcript interface will populate after authorised processing finishes.' : 'This meeting was not recorded or transcription was turned off.'} size="compact" />}</div></TabPanel> : null}
      {tab === 'speakers' ? <TabPanel tabsId="meeting-evidence-tabs" tabId="speakers" value="speakers"><div class="mtg-evidence-tab-body"><header class="mtg-panel-intro"><div><strong>Speaker Activity</strong><p>Talk time is shown only from attributable transcript evidence.</p></div></header>{speakers.length ? <div class="mtg-speaker-list">{speakers.map(speaker => <article key={speaker.displayName}>{personAvatar(speaker, 36)}<span><strong>{speaker.displayName}</strong><small>{speaker.turns} transcript turns · {transcriptTime(speaker.milliseconds)}</small></span><Progress label={`${speaker.displayName} speaker time`} value={totalSpeakerMs ? (speaker.milliseconds / totalSpeakerMs) * 100 : 0} size="sm" showValue={false} /></article>)}</div> : <EmptyState icon={<LucideIcon name="UsersRound" />} title="No speaker data" text="Speaker activity requires an authorised transcript." size="compact" />}</div></TabPanel> : null}
      {tab === 'keywords' ? <TabPanel tabsId="meeting-evidence-tabs" tabId="keywords" value="keywords"><div class="mtg-evidence-tab-body"><header class="mtg-panel-intro"><div><strong>Transcript Keywords</strong><p>Select a keyword to filter the transcript to matching evidence.</p></div></header>{keywords.length ? <div class="mtg-keyword-cloud">{keywords.map(keyword => <button type="button" key={keyword.label} onClick={() => { onQueryChange(keyword.label); setTab('transcript'); }}><span>{keyword.label}</span><strong>{keyword.count}</strong></button>)}</div> : <EmptyState icon={<LucideIcon name="Search" />} title="No keywords" text="Keywords will appear when transcript evidence is available." size="compact" />}</div></TabPanel> : null}
    </section>
  </aside>;
}

export interface MeetingsWorkspaceProps {
  scenarios?: MeetingStagingScenario[];
  scenarioOptions?: { value: string; label: string }[];
  selectedScenarioId?: string;
  onScenarioChange?: (meetingId: string) => void;
  staged?: boolean;
  onCreate?: () => void;
  onBack?: () => void;
  onAction?: (action: MeetingWorkspaceAction) => void;
  pendingAction?: MeetingWorkspaceAction | null;
}

function canShowAction(detail: MeetingDetailDTO, action: MeetingWorkspaceAction, staged: boolean): boolean {
  if (staged) return true;
  if (action === 'edit') return detail.capabilities.edit;
  if (action === 'participants') return detail.capabilities.manageParticipants;
  if (action === 'agenda') return detail.capabilities.manageAgenda;
  if (action === 'cancel') return detail.capabilities.cancel;
  if (action === 'archive') return detail.capabilities.archive;
  return true;
}

export function MeetingsStagedWorkspace({ scenarios = meetingStagingScenarios(), scenarioOptions, selectedScenarioId, onScenarioChange, staged = true, onCreate, onBack, onAction, pendingAction }: MeetingsWorkspaceProps): VNode {
  const defaultScenario = requireScenario(scenarios.find(value => value.kind === 'completed_recording') ?? scenarios[0]);
  const [localScenarioId, setLocalScenarioId] = useState(defaultScenario.listItem.id);
  const [tab, setTab] = useState<MeetingTab>('summary');
  const [seekToMs, setSeekToMs] = useState<number | null>(null);
  const [meetingQuery, setMeetingQuery] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  const scenarioId = selectedScenarioId ?? localScenarioId;
  const setScenarioId = (meetingId: string): void => { setLocalScenarioId(meetingId); setSeekToMs(null); setMeetingQuery(''); onScenarioChange?.(meetingId); };
  const scenario = useMemo(() => scenarios.find(value => value.listItem.id === scenarioId) ?? defaultScenario, [defaultScenario, scenarioId, scenarios]);
  const detail = scenario.detail;
  const options = scenarioOptions ?? scenarios.map(value => ({ value: value.listItem.id, label: value.listItem.title }));
  const invoke = (action: MeetingWorkspaceAction): void => { if (!staged) onAction?.(action); };
  const goBack = (): void => { if (onBack) onBack(); else window.history.back(); };

  if (!scenario.access.allowed || !detail) return <main class="mtg-page"><header class="mtg-page-top"><div class="mtg-detail-title"><Button variant="ghost" size="sm" iconOnly aria-label="Back to meetings" iconLeft={<LucideIcon name="ArrowLeft" size={17} />} onClick={goBack} /><strong>Meeting Details</strong></div>{options.length > 1 ? <Select value={scenarioId} onChange={setScenarioId} aria-label={staged ? 'Staged meeting scenario' : 'Meeting'} options={options} /> : null}</header><div class="mtg-access-denied"><EmptyState icon={<LucideIcon name="ShieldAlert" />} title="Meeting access restricted" text={scenario.access.reason ?? 'You do not have access to this meeting.'} />{staged ? <Button variant="secondary" onClick={() => setScenarioId(defaultScenario.listItem.id)}>Return To Accessible Meeting</Button> : null}</div></main>;

  const schedule = detail.schedule;
  const sessionStatus = detail.currentSession?.status ?? detail.status;
  const actionDisabled = (): boolean => staged || !onAction || pendingAction !== null && pendingAction !== undefined;
  const moreItems: MenuAction[] = [];
  moreItems.push({ id: 'conversation', label: 'Open in Messages', description: 'Continue the meeting conversation.', icon: <LucideIcon name="MessagesSquare" size={15} />, disabled: actionDisabled(), onSelect: () => invoke('conversation') });
  if (canShowAction(detail, 'edit', staged)) moreItems.push({ id: 'edit', label: 'Edit meeting', description: 'Update the title and purpose.', icon: <LucideIcon name="SquarePen" size={15} />, disabled: actionDisabled(), onSelect: () => invoke('edit') });
  if (canShowAction(detail, 'participants', staged)) moreItems.push({ id: 'participants', label: 'Manage participants', description: 'Invite or remove attendees.', icon: <LucideIcon name="UsersRound" size={15} />, disabled: actionDisabled(), onSelect: () => invoke('participants') });
  if (canShowAction(detail, 'agenda', staged)) moreItems.push({ id: 'agenda', label: 'Manage agenda', description: 'Add, reorder, and update topics.', icon: <LucideIcon name="ListTodo" size={15} />, disabled: actionDisabled(), onSelect: () => invoke('agenda') });
  if (canShowAction(detail, 'archive', staged)) moreItems.push({ id: 'archive', label: 'Archive meeting', icon: <LucideIcon name="Archive" size={15} />, disabled: actionDisabled(), onSelect: () => invoke('archive') });
  if (canShowAction(detail, 'cancel', staged)) moreItems.push({ id: 'cancel', label: 'Cancel meeting', icon: <LucideIcon name="CalendarX2" size={15} />, danger: true, disabled: actionDisabled(), onSelect: () => invoke('cancel') });

  const visibleParticipants = detail.participants.slice(0, 3);
  const canRespond = (detail.capabilities.respond || staged) && (detail.status === 'draft' || detail.status === 'scheduled');
  const canStart = (detail.capabilities.startSession || staged) && detail.status === 'scheduled';
  const canEnd = detail.capabilities.endSession || (staged && detail.status === 'in_progress');
  const canJoin = Boolean(detail.join?.joinUrl) || (staged && (detail.status === 'scheduled' || detail.status === 'in_progress'));
  const showMeetingActions = canRespond || canStart || canEnd || canJoin;
  return <main class="mtg-page" aria-label={staged ? 'Read-only staged Meetings workspace' : 'Meetings workspace'}>
    <header class="mtg-page-top">
      <div class="mtg-detail-title"><Button variant="ghost" size="sm" iconOnly aria-label="Back to meetings" iconLeft={<LucideIcon name="ArrowLeft" size={17} />} onClick={goBack} /><strong>Meeting Details</strong></div>
      <div class="mtg-page-actions">{options.length > 1 ? <div class="mtg-scenario-select"><Select value={scenarioId} onChange={setScenarioId} aria-label={staged ? 'Staged meeting scenario' : 'Meeting'} options={options} /></div> : null}<SearchField value={meetingQuery} onInput={setMeetingQuery} size="sm" aria-label="Search about this meeting" placeholder="Search about this meeting…" /><Button variant="primary" size="sm" disabled title="AI assistant is not connected" iconLeft={<LucideIcon name="Sparkles" size={15} />}>Ask AI</Button></div>
    </header>
    <div class="mtg-detail-grid">
      <section class="mtg-main-pane">
        <header class="mtg-meeting-head">
          <div class="mtg-title-line"><OverflowTooltipText as="h1" text={detail.title} maxWidth={620} />{canShowAction(detail, 'edit', staged) ? <Button variant="ghost" size="sm" iconOnly aria-label="Edit meeting" title={staged ? 'Available in a live meeting' : 'Edit meeting'} disabled={actionDisabled()} iconLeft={<LucideIcon name="Pencil" size={16} />} onClick={() => invoke('edit')} /> : null}<Button variant="ghost" size="sm" iconOnly aria-label="Share meeting" disabled={actionDisabled()} iconLeft={<LucideIcon name="Share2" size={16} />} onClick={() => invoke('share')} /><Button variant="ghost" size="sm" iconOnly aria-label="More meeting actions" aria-haspopup="menu" aria-expanded={menuOpen} disabled={!moreItems.length} iconLeft={<LucideIcon name="Ellipsis" size={16} />} onClick={event => { setMenuAnchor(event.currentTarget as HTMLElement); setMenuOpen(value => !value); }} /><DropdownMenu open={menuOpen} anchor={menuAnchor} onClose={() => setMenuOpen(false)} items={moreItems} label="Meeting actions" align="end" /></div>
          <div class="mtg-meeting-facts"><span>{personAvatar(detail.organizer, 24)}<span>Created by <strong>{detail.organizer.displayName}</strong></span></span><span><LucideIcon name="Calendar" size={15} />{formatDate(schedule.startsAt ?? schedule.startsOn)} · {schedule.allDay ? 'All day' : `${formatTime(schedule.startsAt)}–${formatTime(schedule.endsAt)}`}</span><Button variant="ghost" size="sm" disabled={!detail.publishedSummary && !scenario.summaries.length} onClick={() => void navigator.clipboard.writeText((scenario.summaries[0] ?? detail.publishedSummary)?.content.shortSummary ?? '')} iconLeft={<LucideIcon name="Copy" size={14} />}>Copy Summary</Button></div>
          <div class="mtg-people-row"><span class="mtg-row-label">Attendees</span><div>{visibleParticipants.map(participant => <span class="mtg-person-chip" key={participant.id}>{personAvatar(participant.person, 24)}<strong>{participant.person.displayName}</strong></span>)}{detail.participants.length > visibleParticipants.length ? <Badge tone="neutral" variant="outline">+{detail.participants.length - visibleParticipants.length} more</Badge> : null}</div></div>
          <div class="mtg-people-row"><span class="mtg-row-label">Labels</span><div>{detail.labels.length ? detail.labels.map(label => <Badge key={label.id} tone="neutral" variant="soft">{label.name}</Badge>) : <Badge tone="neutral" variant="soft">{detail.confidentiality}</Badge>}<Badge tone={statusTone(sessionStatus)} variant="soft">{sessionStatus.replace(/_/g, ' ')}</Badge><Badge tone="neutral" variant="outline">{detail.reference}</Badge>{staged ? <Badge tone="neutral" variant="outline"><LucideIcon name="PanelsTopLeft" size={12} /> Staged UI</Badge> : null}</div></div>
          {showMeetingActions ? <div class="mtg-meeting-actions">
            {canRespond ? <div class="mtg-rsvp"><span>Your response</span><Button variant="outline" size="sm" disabled={actionDisabled()} onClick={() => invoke('rsvp_decline')} iconLeft={<LucideIcon name="X" size={14} />}>Decline</Button><Button variant="outline" size="sm" disabled={actionDisabled()} onClick={() => invoke('rsvp_tentative')}>Tentative</Button><Button variant="primary" size="sm" disabled={actionDisabled()} loading={pendingAction === 'rsvp_accept'} onClick={() => invoke('rsvp_accept')} iconLeft={<LucideIcon name="Check" size={14} />}>Accept</Button></div> : <span />}
            <div class="mtg-session-actions">{onCreate ? <Button variant="secondary" size="sm" iconLeft={<LucideIcon name="CalendarPlus" size={14} />} onClick={onCreate}>Schedule</Button> : null}{canStart ? <Button variant="secondary" size="sm" disabled={actionDisabled()} loading={pendingAction === 'start'} onClick={() => invoke('start')} iconLeft={<LucideIcon name="Radio" size={15} />}>Start</Button> : null}{canEnd ? <Button variant="secondary" size="sm" disabled={actionDisabled()} loading={pendingAction === 'end'} onClick={() => invoke('end')}>End</Button> : null}{canJoin ? <Button variant="primary" size="sm" disabled={actionDisabled()} onClick={() => invoke('join')} iconLeft={<LucideIcon name="Video" size={15} />}>Join Room</Button> : null}</div>
          </div> : null}
        </header>
        <Tabs id="meeting-detail-tabs" items={DETAIL_TABS} value={tab} onChange={value => setTab(value as MeetingTab)} label="Meeting detail sections" size="md" variant="contained" fullWidth />
        {tab === 'summary' ? <SummaryPanel scenario={scenario} staged={staged} /> : null}
        {tab === 'agenda' ? <AgendaPanel scenario={scenario} /> : null}
        {tab === 'actions' ? <ActionsPanel scenario={scenario} /> : null}
        {tab === 'snippets' ? <SnippetsPanel scenario={scenario} onSeek={value => setSeekToMs(value)} /> : null}
        {tab === 'decisions' ? <DecisionsPanel scenario={scenario} /> : null}
        <footer class="mtg-next-actions"><strong>What would you like to do next?</strong><div><Button variant="secondary" size="sm" disabled={actionDisabled() || !canEnd} onClick={() => invoke('end')} iconLeft={<LucideIcon name="CheckCircle2" size={15} />}>Mark Meeting Complete</Button><Button variant="secondary" size="sm" disabled={actionDisabled()} onClick={() => invoke('share')} iconLeft={<LucideIcon name="Share2" size={15} />}>Share Summary</Button><Button variant="secondary" size="sm" disabled={actionDisabled()} onClick={() => invoke('conversation')} iconLeft={<LucideIcon name="MessagesSquare" size={15} />}>Open Messages</Button><Button variant="secondary" size="sm" disabled title="Task conversion is not connected" iconLeft={<LucideIcon name="ClipboardPlus" size={15} />}>Create Tasks</Button></div></footer>
      </section>
      <EvidenceWorkspace scenario={scenario} staged={staged} query={meetingQuery} onQueryChange={setMeetingQuery} seekToMs={seekToMs} />
    </div>
  </main>;
}
