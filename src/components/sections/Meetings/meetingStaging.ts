import type {
  MeetingActionItemDTO,
  MeetingArtifactDTO,
  MeetingAttendanceDTO,
  MeetingCapabilitiesDTO,
  MeetingChapterDTO,
  MeetingDetailDTO,
  MeetingListItemDTO,
  MeetingMetricsDTO,
  MeetingParticipantDTO,
  MeetingPersonDTO,
  MeetingSessionDTO,
  MeetingStatus,
  MeetingSummaryVersionDTO,
  MeetingTranscriptSegmentDTO,
} from '../../../../types/meetings';
import aliciaAvatar from '../../../assets/avatars/roster-planner/alicia-moore.jpg';
import dariusAvatar from '../../../assets/avatars/roster-planner/darius-king.jpg';
import jordanAvatar from '../../../assets/avatars/roster-planner/jordan-peters.jpg';
import marcusAvatar from '../../../assets/avatars/roster-planner/marcus-allen.jpg';
import sofiaAvatar from '../../../assets/avatars/roster-planner/sofia-reyes.jpg';

export type MeetingStagingScenarioKind =
  | 'awaiting_rsvp'
  | 'live'
  | 'completed_recording'
  | 'recording_processing'
  | 'no_recording'
  | 'cancelled'
  | 'restricted'
  | 'hse_follow_up';

export interface MeetingStagingScenario {
  kind: MeetingStagingScenarioKind;
  description: string;
  listItem: MeetingListItemDTO;
  detail: MeetingDetailDTO | null;
  artifacts: MeetingArtifactDTO[];
  attendance: MeetingAttendanceDTO[];
  transcript: MeetingTranscriptSegmentDTO[];
  chapters: MeetingChapterDTO[];
  summaries: MeetingSummaryVersionDTO[];
  actionItems: MeetingActionItemDTO[];
  metrics: MeetingMetricsDTO | null;
  access: { allowed: boolean; reason: string | null };
}

function required<T>(value: T | null | undefined, label: string): T {
  if (value === null || value === undefined) throw new Error(`Invalid Meetings staging fixture: missing ${label}.`);
  return value;
}

const PEOPLE = {
  alicia: person('demo-alicia', 'Alicia Moore', 'alicia.moore@siomac.demo', 1, aliciaAvatar),
  marcus: person('demo-marcus', 'Marcus Allen', 'marcus.allen@siomac.demo', 2, marcusAvatar),
  darius: person('demo-darius', 'Darius King', 'darius.king@siomac.demo', 3, dariusAvatar),
  jordan: person('demo-jordan', 'Jordan Peters', 'jordan.peters@siomac.demo', 4, jordanAvatar),
  sofia: person('demo-sofia', 'Sofia Reyes', 'sofia.reyes@siomac.demo', 5, sofiaAvatar),
} as const;

const READ_ONLY_CAPABILITIES: MeetingCapabilitiesDTO = {
  edit: false,
  cancel: false,
  archive: false,
  manageParticipants: false,
  respond: false,
  join: false,
  startSession: false,
  endSession: false,
  manageRecording: false,
  viewRecording: false,
  viewTranscript: false,
  exportTranscript: false,
  generateSummary: false,
  reviewSummary: false,
  publishSummary: false,
  manageAgenda: false,
  proposeAction: false,
  acceptAction: false,
  comment: false,
  viewMetrics: false,
  manageLinks: false,
  manageRetention: false,
};

const IDS = {
  awaiting: '81000000-0000-4000-8000-000000000001',
  live: '81000000-0000-4000-8000-000000000002',
  completed: '81000000-0000-4000-8000-000000000003',
  processing: '81000000-0000-4000-8000-000000000004',
  noRecording: '81000000-0000-4000-8000-000000000005',
  cancelled: '81000000-0000-4000-8000-000000000006',
  restricted: '81000000-0000-4000-8000-000000000007',
  hse: '81000000-0000-4000-8000-000000000008',
} as const;

export const MEETING_STAGING_IDS = Object.freeze({
  meetings: IDS,
  calendarEntries: {
    awaiting: '82000000-0000-4000-8000-000000000001',
    live: '82000000-0000-4000-8000-000000000002',
    completed: '82000000-0000-4000-8000-000000000003',
    processing: '82000000-0000-4000-8000-000000000004',
    noRecording: '82000000-0000-4000-8000-000000000005',
    cancelled: '82000000-0000-4000-8000-000000000006',
    restricted: '82000000-0000-4000-8000-000000000007',
    hse: '82000000-0000-4000-8000-000000000008',
  },
});

function person(userId: string, displayName: string, email: string, version: number, profileImage: string): MeetingPersonDTO {
  return { userId, displayName, email, profileImage, profileImageVersion: version };
}

function instant(anchor: Date, dayOffset: number, hour: number, minute = 0): string {
  const value = new Date(anchor);
  value.setUTCHours(0, 0, 0, 0);
  value.setUTCDate(value.getUTCDate() + dayOffset);
  value.setUTCHours(hour, minute, 0, 0);
  return value.toISOString();
}

function participant(
  meetingId: string,
  value: MeetingPersonDTO,
  role: MeetingParticipantDTO['role'],
  responseStatus: MeetingParticipantDTO['responseStatus'],
  addedAt: string,
  required = false,
): MeetingParticipantDTO {
  return {
    id: `${meetingId}:${value.userId}`,
    person: value,
    role,
    responseStatus,
    respondedAt: responseStatus === 'invited' ? null : addedAt,
    required,
    addedAt,
    removedAt: null,
  };
}

interface MeetingSeed {
  id: string;
  calendarEntryId: string;
  reference: string;
  title: string;
  description: string;
  status: MeetingStatus;
  startsAt: string;
  endsAt: string;
  organizer: MeetingPersonDTO;
  attendees: MeetingPersonDTO[];
  responses?: MeetingParticipantDTO['responseStatus'][];
  confidentiality?: MeetingDetailDTO['confidentiality'];
  recordingPolicy?: MeetingDetailDTO['recordingPolicy'];
  transcriptPolicy?: MeetingDetailDTO['transcriptPolicy'];
}

function meeting(seed: MeetingSeed): MeetingDetailDTO {
  const participants = [
    participant(seed.id, seed.organizer, 'organizer', 'accepted', seed.startsAt, true),
    ...seed.attendees.map((value, index) => participant(
      seed.id,
      value,
      index === 0 ? 'presenter' : 'attendee',
      seed.responses?.[index] ?? 'accepted',
      seed.startsAt,
    )),
  ];
  return {
    id: seed.id,
    reference: seed.reference,
    title: seed.title,
    description: seed.description,
    status: seed.status,
    confidentiality: seed.confidentiality ?? 'internal',
    recordingPolicy: seed.recordingPolicy ?? 'optional',
    transcriptPolicy: seed.transcriptPolicy ?? 'automatic',
    retentionStatus: 'active',
    retentionUntil: null,
    organizer: seed.organizer,
    schedule: {
      calendarEntryId: seed.calendarEntryId,
      allDay: false,
      startsOn: null,
      endsOn: null,
      startsAt: seed.startsAt,
      endsAt: seed.endsAt,
      recurrenceRule: null,
      recurrenceSeriesId: null,
      occurrenceDate: null,
      visibility: 'team',
      departmentId: '89000000-0000-4000-8000-000000000001',
    },
    provider: 'external',
    discussionThreadId: `83000000-0000-4000-8000-${seed.id.slice(-12)}`,
    participants,
    labels: [],
    recordLinks: [],
    agendaItems: [
      { id: `87000000-0000-4000-8000-${seed.id.slice(-12)}`, meetingId: seed.id, sequence: 0, title: 'Readiness and objectives', description: 'Confirm the intended outcome and any blockers.', owner: seed.organizer, status: seed.status === 'completed' ? 'covered' : 'open', plannedMinutes: 10, chapterId: null, createdAt: seed.startsAt, updatedAt: seed.startsAt },
      { id: `88000000-0000-4000-8000-${seed.id.slice(-12)}`, meetingId: seed.id, sequence: 1, title: 'Open actions and decisions', description: 'Review accountable owners and agree the next actions.', owner: seed.attendees[0] ?? seed.organizer, status: seed.status === 'completed' ? 'covered' : 'open', plannedMinutes: 20, chapterId: null, createdAt: seed.startsAt, updatedAt: seed.startsAt },
    ],
    sessions: [],
    currentSession: null,
    publishedSummary: null,
    join: null,
    createdAt: instant(new Date(seed.startsAt), -7, 12),
    updatedAt: seed.startsAt,
    version: 1,
    capabilities: { ...READ_ONLY_CAPABILITIES },
  };
}

function session(detail: MeetingDetailDTO, status: MeetingSessionDTO['status']): MeetingSessionDTO {
  return {
    id: `84000000-0000-4000-8000-${detail.id.slice(-12)}`,
    meetingId: detail.id,
    occurrenceKey: detail.schedule.startsAt ?? detail.schedule.startsOn ?? 'staged',
    status,
    scheduledStartsAt: detail.schedule.startsAt,
    scheduledEndsAt: detail.schedule.endsAt,
    startedAt: status === 'scheduled' || status === 'ready' || status === 'cancelled' ? null : detail.schedule.startsAt,
    endedAt: status === 'completed' || status === 'processing' || status === 'processing_failed' ? detail.schedule.endsAt : null,
    recordingStatus: null,
    transcriptStatus: null,
    summaryStatus: null,
    recordingArtifactId: null,
    publishedSummaryVersionId: null,
    failureReason: null,
  };
}

function asListItem(detail: MeetingDetailDTO): MeetingListItemDTO {
  return {
    id: detail.id,
    reference: detail.reference,
    title: detail.title,
    status: detail.status,
    confidentiality: detail.confidentiality,
    organizer: detail.organizer,
    schedule: detail.schedule,
    participantCount: detail.participants.length,
    participantPreview: detail.participants.slice(0, 4).map(value => value.person),
    myResponseStatus: detail.participants[1]?.responseStatus ?? 'accepted',
    currentSession: detail.currentSession,
    labels: detail.labels,
    linkedRecordCount: detail.recordLinks.length,
    updatedAt: detail.updatedAt,
    capabilities: { ...READ_ONLY_CAPABILITIES },
  };
}

function scenario(
  kind: MeetingStagingScenarioKind,
  description: string,
  detail: MeetingDetailDTO,
  extras: Partial<Omit<MeetingStagingScenario, 'kind' | 'description' | 'listItem' | 'detail' | 'access'>> = {},
): MeetingStagingScenario {
  return {
    kind,
    description,
    listItem: asListItem(detail),
    detail,
    artifacts: extras.artifacts ?? [],
    attendance: extras.attendance ?? [],
    transcript: extras.transcript ?? [],
    chapters: extras.chapters ?? [],
    summaries: extras.summaries ?? [],
    actionItems: extras.actionItems ?? [],
    metrics: extras.metrics ?? null,
    access: { allowed: true, reason: null },
  };
}

function buildCompleted(anchor: Date): MeetingStagingScenario {
  const detail = meeting({
    id: IDS.completed,
    calendarEntryId: MEETING_STAGING_IDS.calendarEntries.completed,
    reference: 'MTG-2026-0003',
    title: 'Pelican Platform Deck Inspection Review',
    description: 'Review the inspection evidence, corrective actions and operational handover.',
    status: 'completed',
    startsAt: instant(anchor, -2, 14),
    endsAt: instant(anchor, -2, 15, 10),
    organizer: PEOPLE.alicia,
    attendees: [PEOPLE.marcus, PEOPLE.darius, PEOPLE.jordan],
    recordingPolicy: 'required',
  });
  const current = session(detail, 'completed');
  const artifact: MeetingArtifactDTO = {
    id: '85000000-0000-4000-8000-000000000003',
    sessionId: current.id,
    kind: 'recording',
    fileName: 'pelican-deck-inspection-review.mp4',
    contentType: 'video/mp4',
    sizeBytes: 184_320_000,
    checksumSha256: 'f5e4d3c2b1a09876543210f5e4d3c2b1a09876543210f5e4d3c2b1a09876543',
    durationSeconds: 4_182,
    status: 'ready',
    scanStatus: 'clean',
    createdAt: required(current.endedAt, 'completed session end time'),
    readyAt: instant(anchor, -2, 15, 18),
    retentionUntil: instant(anchor, 363, 0),
    downloadable: false,
    playable: true,
  };
  current.recordingStatus = 'ready';
  current.transcriptStatus = 'reviewed';
  current.summaryStatus = 'reviewed';
  current.recordingArtifactId = artifact.id;
  const transcript: MeetingTranscriptSegmentDTO[] = [
    segment(current.id, 1, 0, 37_000, PEOPLE.alicia, 'Today we are closing the deck inspection review and confirming the remaining corrective actions.'),
    segment(current.id, 2, 37_000, 82_000, PEOPLE.marcus, 'The barricade and signage are complete. The final ladder repair photo is still due before 3:30 PM.'),
    segment(current.id, 3, 82_000, 128_000, PEOPLE.darius, 'I will upload the field photo and confirm that the original inspection files remain attached.'),
    segment(current.id, 4, 272_000, 331_000, PEOPLE.alicia, 'Before we close the evidence review, let us confirm that every corrective action has a named owner and an auditable due date.'),
    segment(current.id, 5, 331_000, 402_000, PEOPLE.jordan, 'The access-control item is complete. I checked the permit register and the updated restriction is visible to the incoming shift.'),
    segment(current.id, 6, 701_000, 765_000, PEOPLE.marcus, 'The only remaining risk is the ladder verification. If the photograph does not pass review, we should route it back to HSE immediately.'),
    segment(current.id, 7, 765_000, 841_000, PEOPLE.darius, 'Agreed. I will keep the original image, upload it without compression, and add the field notes from the inspection.'),
    segment(current.id, 8, 1_435_000, 1_512_000, PEOPLE.alicia, 'The decision is to keep the incident review open until that evidence is accepted. The handover can continue, but the action remains visible.'),
    segment(current.id, 9, 1_769_000, 1_844_000, PEOPLE.jordan, 'I have updated the agenda and will notify the supervisors that the operational controls are in place.'),
    segment(current.id, 10, 2_118_000, 2_185_000, PEOPLE.alicia, 'That closes the review. The summary and proposed actions must be checked by a person before anything is published.'),
  ];
  const chapters: MeetingChapterDTO[] = [
    chapter(current.id, 1, 'Inspection Status', 0, 272_000, 'The team verified completed controls and identified the final evidence gap.'),
    chapter(current.id, 2, 'Corrective Action Ownership', 272_000, 701_000, 'Owners, due dates, access controls, and permit evidence were confirmed.'),
    chapter(current.id, 3, 'Risk And Escalation', 701_000, 1_435_000, 'The group agreed on the HSE escalation path if ladder verification fails.'),
    chapter(current.id, 4, 'Decisions And Handover', 1_435_000, 2_185_000, 'The incident stays open pending accepted evidence while the operational handover continues.'),
  ];
  const summary: MeetingSummaryVersionDTO = {
    id: '86000000-0000-4000-8000-000000000003',
    sessionId: current.id,
    version: 1,
    status: 'reviewed',
    source: 'hybrid',
    content: {
      shortSummary: 'The deck inspection controls are complete except for the final ladder repair photo. Ownership and the review deadline were confirmed.',
      decisions: ['Keep the incident review open until the final photograph is reviewed and accepted.', 'Continue the operational handover with the remaining evidence action visible.'],
      keyTakeaways: ['Barricade, signage, and access controls were verified.', 'Original evidence files remain authoritative and must not be compressed.', 'Final ladder photograph is due before 3:30 PM.', 'Failed verification routes directly to HSE review.'],
    },
    provenance: {
      provider: 'staged-provider',
      model: 'staged-summary-model',
      modelVersion: '1',
      policyVersion: 'meetings-demo-v1',
      generatedAt: instant(anchor, -2, 15, 16),
      inputArtifactIds: [artifact.id],
    },
    createdBy: null,
    createdAt: instant(anchor, -2, 15, 16),
    reviewedBy: PEOPLE.alicia,
    reviewedAt: instant(anchor, -2, 15, 24),
    publishedBy: null,
    publishedAt: null,
    rejectionReason: null,
  };
  const actions: MeetingActionItemDTO[] = [
    action(detail.id, current.id, '87000000-0000-4000-8000-000000000031', 'Upload final ladder repair photo', PEOPLE.darius, 'accepted', 'calendar_task', instant(anchor, -2, 15, 30)),
    action(detail.id, current.id, '87000000-0000-4000-8000-000000000032', 'Escalate any failed repair verification to HSE', PEOPLE.alicia, 'proposed', 'module_handoff', instant(anchor, -1, 10)),
    action(detail.id, current.id, '87000000-0000-4000-8000-000000000033', 'Notify incoming supervisors of the verified controls', PEOPLE.jordan, 'completed', 'meeting', instant(anchor, -2, 16)),
  ];
  required(actions[0], 'primary completed-meeting action').calendarTaskId = '88000000-0000-4000-8000-000000000031';
  const metrics: MeetingMetricsDTO = {
    sessionId: current.id,
    invitedCount: 4,
    acceptedCount: 4,
    declinedCount: 0,
    tentativeCount: 0,
    attendedCount: 4,
    attendanceRate: 1,
    scheduledDurationSeconds: 4_200,
    actualDurationSeconds: 4_182,
    actionItemCount: 3,
    completedActionItemCount: 1,
    actionCompletionRate: 1 / 3,
    speakerTime: [
      { userId: PEOPLE.alicia.userId, displayName: PEOPLE.alicia.displayName, seconds: 1_362, percentage: 32.6 },
      { userId: PEOPLE.marcus.userId, displayName: PEOPLE.marcus.displayName, seconds: 1_470, percentage: 35.1 },
      { userId: PEOPLE.darius.userId, displayName: PEOPLE.darius.displayName, seconds: 1_350, percentage: 32.3 },
    ],
    calculatedAt: instant(anchor, -2, 15, 22),
  };
  detail.labels = [
    { id: 'label-safety', name: 'Safety Review', color: '#d69a24' },
    { id: 'label-follow-up', name: 'Follow-up', color: '#50658d' },
  ];
  detail.recordLinks = [{
    id: '89000000-0000-4000-8000-000000000003',
    module: 'hse',
    recordType: 'hse_incident',
    recordId: 'INC-2026-0184',
    recordNo: 'INC-2026-0184',
    title: 'Pelican Platform Deck Inspection',
    deepLink: 's-hse-incidents',
    relationship: 'reviews',
    confidentiality: 'internal',
  }];
  detail.agendaItems = [
    { id: 'agenda-1', meetingId: detail.id, sequence: 1, title: 'Review completed controls', description: null, owner: PEOPLE.alicia, status: 'covered', plannedMinutes: 15, chapterId: required(chapters[0], 'agenda chapter 1').id, createdAt: detail.createdAt, updatedAt: required(current.endedAt, 'agenda update time') },
    { id: 'agenda-2', meetingId: detail.id, sequence: 2, title: 'Confirm evidence ownership', description: null, owner: PEOPLE.darius, status: 'covered', plannedMinutes: 20, chapterId: required(chapters[1], 'agenda chapter 2').id, createdAt: detail.createdAt, updatedAt: required(current.endedAt, 'agenda update time') },
    { id: 'agenda-3', meetingId: detail.id, sequence: 3, title: 'Agree the escalation path', description: null, owner: PEOPLE.marcus, status: 'covered', plannedMinutes: 15, chapterId: required(chapters[2], 'agenda chapter 3').id, createdAt: detail.createdAt, updatedAt: required(current.endedAt, 'agenda update time') },
    { id: 'agenda-4', meetingId: detail.id, sequence: 4, title: 'Close decisions and handover', description: null, owner: PEOPLE.jordan, status: 'covered', plannedMinutes: 20, chapterId: required(chapters[3], 'agenda chapter 4').id, createdAt: detail.createdAt, updatedAt: required(current.endedAt, 'agenda update time') },
  ];
  detail.sessions = [current];
  detail.currentSession = current;
  detail.publishedSummary = summary;
  detail.updatedAt = required(summary.reviewedAt, 'reviewed summary time');
  return scenario('completed_recording', 'Completed meeting with a governed recording and reviewed collaboration record.', detail, {
    artifacts: [artifact],
    attendance: detail.participants.map((value, index) => ({
      id: `attendance-${index + 1}`,
      sessionId: current.id,
      participantId: value.id,
      person: value.person,
      joinedAt: detail.schedule.startsAt,
      leftAt: detail.schedule.endsAt,
      durationSeconds: 4_182,
      consentStatus: 'granted',
      consentRecordedAt: detail.schedule.startsAt,
    })),
    transcript,
    chapters,
    summaries: [summary],
    actionItems: actions,
    metrics,
  });
}

function segment(sessionId: string, sequence: number, startsAtMs: number, endsAtMs: number, speaker: MeetingPersonDTO, text: string): MeetingTranscriptSegmentDTO {
  return { id: `${sessionId}:segment:${sequence}`, sessionId, sequence, startsAtMs, endsAtMs, speaker, text, confidence: 0.96, redacted: false, editedAt: null };
}

function chapter(sessionId: string, sequence: number, title: string, startsAtMs: number, endsAtMs: number, summary: string): MeetingChapterDTO {
  return { id: `${sessionId}:chapter:${sequence}`, sessionId, sequence, title, summary, startsAtMs, endsAtMs, source: 'hybrid', updatedAt: '2026-09-06T12:00:00.000Z' };
}

function action(meetingId: string, sessionId: string, id: string, title: string, owner: MeetingPersonDTO, status: MeetingActionItemDTO['status'], destination: MeetingActionItemDTO['destination'], dueAt: string): MeetingActionItemDTO {
  return {
    id, meetingId, sessionId, title, description: null, status, destination, owner, dueAt,
    evidence: { transcriptSegmentId: `${sessionId}:segment:3`, startsAtMs: 82_000, endsAtMs: 128_000, excerpt: 'I will upload the field photo.' },
    proposedBy: null,
    proposedByGeneration: true,
    acceptedBy: status === 'accepted' ? PEOPLE.alicia : null,
    acceptedAt: status === 'accepted' ? dueAt : null,
    calendarTaskId: null,
    workflowTaskId: null,
    handoffId: null,
    createdAt: dueAt,
    updatedAt: dueAt,
  };
}

/**
 * Eight isolated, read-only Meetings scenarios. Supplying an anchor keeps tests,
 * screenshots and a future Calendar staging adapter on the same deterministic
 * clock while the exported IDs remain stable across every invocation.
 */
export function meetingStagingScenarios(anchor = new Date()): MeetingStagingScenario[] {
  const awaiting = meeting({
    id: IDS.awaiting, calendarEntryId: MEETING_STAGING_IDS.calendarEntries.awaiting,
    reference: 'MTG-2026-0001', title: 'Weekly Operations Briefing',
    description: 'Align site readiness and mobilisation priorities.', status: 'scheduled',
    startsAt: instant(anchor, 1, 9), endsAt: instant(anchor, 1, 10), organizer: PEOPLE.alicia,
    attendees: [PEOPLE.marcus, PEOPLE.darius], responses: ['invited', 'accepted'],
  });
  awaiting.currentSession = session(awaiting, 'scheduled');
  awaiting.sessions = [awaiting.currentSession];

  const live = meeting({
    id: IDS.live, calendarEntryId: MEETING_STAGING_IDS.calendarEntries.live,
    reference: 'MTG-2026-0002', title: 'Crew Handover',
    description: 'Confirm the incoming shift handover and permit constraints.', status: 'in_progress',
    startsAt: instant(anchor, 0, 10), endsAt: instant(anchor, 0, 10, 45), organizer: PEOPLE.marcus,
    attendees: [PEOPLE.darius, PEOPLE.sofia], recordingPolicy: 'off', transcriptPolicy: 'off',
  });
  live.currentSession = session(live, 'live');
  live.sessions = [live.currentSession];

  const processing = meeting({
    id: IDS.processing, calendarEntryId: MEETING_STAGING_IDS.calendarEntries.processing,
    reference: 'MTG-2026-0004', title: 'September Crew Roster Review',
    description: 'Review roster coverage and supervisor handover.', status: 'processing',
    startsAt: instant(anchor, -1, 11), endsAt: instant(anchor, -1, 12), organizer: PEOPLE.jordan,
    attendees: [PEOPLE.marcus, PEOPLE.sofia],
  });
  processing.currentSession = session(processing, 'processing');
  processing.currentSession.recordingStatus = 'processing';
  processing.currentSession.transcriptStatus = 'queued';
  processing.sessions = [processing.currentSession];
  const processingArtifact: MeetingArtifactDTO = {
    id: '85000000-0000-4000-8000-000000000004', sessionId: processing.currentSession.id,
    kind: 'recording', fileName: 'september-roster-review.mp4', contentType: 'video/mp4',
    sizeBytes: 92_000_000, checksumSha256: null, durationSeconds: null, status: 'processing',
    scanStatus: 'clean', createdAt: required(processing.schedule.endsAt, 'processing meeting end time'), readyAt: null, retentionUntil: null,
    downloadable: false, playable: false,
  };

  const noRecording = meeting({
    id: IDS.noRecording, calendarEntryId: MEETING_STAGING_IDS.calendarEntries.noRecording,
    reference: 'MTG-2026-0005', title: 'Payroll Cut-off Check-in',
    description: 'Confirm submission readiness without recording.', status: 'completed',
    startsAt: instant(anchor, -3, 8, 30), endsAt: instant(anchor, -3, 9), organizer: PEOPLE.sofia,
    attendees: [PEOPLE.jordan], recordingPolicy: 'off', transcriptPolicy: 'off',
  });
  noRecording.currentSession = session(noRecording, 'completed');
  noRecording.sessions = [noRecording.currentSession];

  const cancelled = meeting({
    id: IDS.cancelled, calendarEntryId: MEETING_STAGING_IDS.calendarEntries.cancelled,
    reference: 'MTG-2026-0006', title: 'Contractor Mobilisation Review',
    description: 'Cancelled after the mobilisation date changed.', status: 'cancelled',
    startsAt: instant(anchor, 2, 13), endsAt: instant(anchor, 2, 13, 45), organizer: PEOPLE.marcus,
    attendees: [PEOPLE.darius, PEOPLE.alicia],
  });
  cancelled.currentSession = session(cancelled, 'cancelled');
  cancelled.sessions = [cancelled.currentSession];

  const restricted = meeting({
    id: IDS.restricted, calendarEntryId: MEETING_STAGING_IDS.calendarEntries.restricted,
    reference: 'MTG-2026-0007', title: 'Restricted Employee Relations Review',
    description: 'Content is hidden by the meeting access policy.', status: 'completed',
    startsAt: instant(anchor, -4, 15), endsAt: instant(anchor, -4, 15, 45), organizer: PEOPLE.sofia,
    attendees: [PEOPLE.jordan], confidentiality: 'restricted', recordingPolicy: 'required',
  });

  const hse = meeting({
    id: IDS.hse, calendarEntryId: MEETING_STAGING_IDS.calendarEntries.hse,
    reference: 'MTG-2026-0008', title: 'CAPA Evidence Follow-up',
    description: 'Confirm evidence readiness and route outstanding work to HSE.', status: 'completed',
    startsAt: instant(anchor, -1, 14), endsAt: instant(anchor, -1, 14, 30), organizer: PEOPLE.alicia,
    attendees: [PEOPLE.darius, PEOPLE.marcus], recordingPolicy: 'off', transcriptPolicy: 'manual',
  });
  const hseSession = session(hse, 'completed');
  hse.sessions = [hseSession];
  hse.currentSession = hseSession;
  hse.recordLinks = [{
    id: '89000000-0000-4000-8000-000000000008', module: 'hse', recordType: 'hse_capa_action',
    recordId: 'CAPA-2026-0091', recordNo: 'CAPA-2026-0091', title: 'Deck inspection evidence closure',
    deepLink: 's-hse-incidents', relationship: 'follow_up_for', confidentiality: 'internal',
  }];
  const hseActions = [
    action(hse.id, hseSession.id, '87000000-0000-4000-8000-000000000081', 'Attach verified repair evidence', PEOPLE.darius, 'accepted', 'calendar_task', instant(anchor, 1, 15)),
    action(hse.id, hseSession.id, '87000000-0000-4000-8000-000000000082', 'Route failed verification to HSE review', PEOPLE.alicia, 'proposed', 'module_handoff', instant(anchor, 2, 12)),
  ];
  required(hseActions[0], 'primary HSE follow-up action').calendarTaskId = '88000000-0000-4000-8000-000000000081';

  const restrictedScenario: MeetingStagingScenario = {
    kind: 'restricted',
    description: 'Restricted meeting visible in the list without exposing protected content.',
    listItem: asListItem(restricted),
    detail: null,
    artifacts: [], attendance: [], transcript: [], chapters: [], summaries: [], actionItems: [], metrics: null,
    access: { allowed: false, reason: 'This meeting requires approved, audited compliance access.' },
  };

  return [
    scenario('awaiting_rsvp', 'Upcoming meeting with an unanswered invitation.', awaiting),
    scenario('live', 'Meeting currently in progress without recording.', live),
    buildCompleted(anchor),
    scenario('recording_processing', 'Completed session whose recording and transcript are still processing.', processing, { artifacts: [processingArtifact] }),
    scenario('no_recording', 'Completed meeting intentionally held without a recording or transcript.', noRecording),
    scenario('cancelled', 'Cancelled meeting retained for scheduling and audit context.', cancelled),
    restrictedScenario,
    scenario('hse_follow_up', 'HSE-linked follow-up with accepted Calendar work and a proposed module handoff.', hse, { actionItems: hseActions }),
  ];
}
