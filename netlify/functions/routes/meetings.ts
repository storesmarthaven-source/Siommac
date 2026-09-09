/** Authenticated Meetings routes. Calendar owns scheduling; Communications owns discussion. */
import { Hono } from 'hono';
import { sb } from '../lib/db';
import { loadUserOverrides, requirePermission } from '../lib/auth';
import { loadRolePermissions, resolveWithSet } from '../lib/permissions';
import { deliverEventNotifications } from '../lib/appEvents';
import { assertCanViewRecordType } from '../lib/orchestration/recordLinkService';
import { z, zv } from '../lib/validate';
import { CALENDAR_LUCIDE_TITLE_ICONS, CALENDAR_TITLE_ICON_TYPES } from '../../../types/calendar';
import type { HonoVariables } from '../../../types/api';
import type {
  MeetingCapabilitiesDTO,
  MeetingDetailDTO,
  MeetingListItemDTO,
  MeetingPersonDTO,
  MeetingSessionDTO,
} from '../../../types/meetings';

const router = new Hono<{ Variables: HonoVariables }>();
const UUID = z.uuid();

const statusSchema = z.enum(['draft', 'scheduled', 'in_progress', 'processing', 'completed', 'cancelled', 'archived']);
const confidentialitySchema = z.enum(['internal', 'restricted', 'confidential']);
const providerSchema = z.enum(['none', 'external', 'microsoft_teams', 'zoom', 'google_meet']);
const recordingPolicySchema = z.enum(['off', 'optional', 'required']);
const transcriptPolicySchema = z.enum(['off', 'manual', 'automatic']);
const visibilitySchema = z.enum(['personal', 'team', 'org']);
const agendaStatusSchema = z.enum(['open', 'covered', 'deferred', 'cancelled']);
const calendarLucideTitleIcons = new Set<string>(CALENDAR_LUCIDE_TITLE_ICONS);

const listSchema = z.object({
  from: z.iso.datetime().optional(), to: z.iso.datetime().optional(),
  statuses: z.array(statusSchema).max(7).optional(), ownerUserId: z.string().min(1).optional(),
  participantUserId: z.string().min(1).optional(), departmentId: z.string().min(1).optional(),
  sourceModule: z.string().min(1).optional(), labelIds: z.array(UUID).max(20).optional(),
  query: z.string().trim().max(200).optional(), cursor: z.string().max(500).optional(),
  limit: z.number().int().min(1).max(100).optional(),
}).strict();

const getSchema = z.object({ meetingId: UUID, occurrenceKey: z.string().max(100).optional() }).strict();
const createSchema = z.object({
  idempotencyKey: z.string().trim().min(8).max(200), title: z.string().trim().min(1).max(200),
  titleIconType: z.enum(CALENDAR_TITLE_ICON_TYPES).nullable().optional(), titleIconValue: z.string().trim().min(1).max(64).nullable().optional(),
  calendarId: UUID.optional(), categoryId: UUID.optional(),
  description: z.string().trim().max(10_000).nullable().optional(),
  schedule: z.object({
    allDay: z.boolean(), startsOn: z.iso.date().nullable().optional(), endsOn: z.iso.date().nullable().optional(),
    startsAt: z.iso.datetime().nullable().optional(), endsAt: z.iso.datetime().nullable().optional(),
    recurrenceRule: z.string().trim().max(2_000).nullable().optional(), visibility: visibilitySchema,
    departmentId: z.string().min(1).nullable().optional(),
  }).strict().superRefine((value, context) => {
    if (value.allDay && !value.startsOn) context.addIssue({ code: 'custom', message: 'An all-day meeting requires startsOn.' });
    if (!value.allDay && !value.startsAt) context.addIssue({ code: 'custom', message: 'A timed meeting requires startsAt.' });
    if (value.allDay && (value.startsAt || value.endsAt)) context.addIssue({ code: 'custom', message: 'All-day meetings cannot include timestamps.' });
    if (!value.allDay && (value.startsOn || value.endsOn)) context.addIssue({ code: 'custom', message: 'Timed meetings cannot include date-only fields.' });
    if (!value.allDay && !value.endsAt) context.addIssue({ code: 'custom', message: 'A timed meeting requires endsAt.' });
    if (value.startsAt && value.endsAt && Date.parse(value.endsAt) <= Date.parse(value.startsAt)) context.addIssue({ code: 'custom', message: 'Meeting end must be after its start.' });
    if (value.startsOn && value.endsOn && value.endsOn < value.startsOn) context.addIssue({ code: 'custom', message: 'Meeting end date must be after its start date.' });
  }),
  participants: z.array(z.object({ userId: z.string().min(1), role: z.enum(['presenter', 'attendee', 'observer']).optional(), required: z.boolean().optional() }).strict()).max(250),
  labelIds: z.array(UUID).max(20).optional(),
  recordLinks: z.array(z.object({ module: z.string().trim().min(1).max(80), recordType: z.string().trim().min(1).max(80), recordId: z.string().trim().min(1).max(200), relationship: z.enum(['related_to', 'evidence_for', 'reviews', 'blocks', 'follow_up_for']).optional() }).strict()).max(30).optional(),
  agendaItems: z.array(z.object({
    title: z.string().trim().min(1).max(300), description: z.string().trim().max(4_000).nullable().optional(),
    ownerUserId: z.string().min(1).nullable().optional(), plannedMinutes: z.number().int().positive().max(1_440).nullable().optional(),
  }).strict()).max(50).optional(),
  provider: providerSchema.optional(), joinUrl: z.url().max(2_000).nullable().optional(),
  confidentiality: confidentialitySchema.optional(), recordingPolicy: recordingPolicySchema.optional(),
  transcriptPolicy: transcriptPolicySchema.optional(), retentionUntil: z.iso.datetime().nullable().optional(),
  reminderOffsets: z.array(z.number().int().min(0).max(525600)).max(5).optional(),
}).strict().superRefine((value, context) => {
  const participantIds = value.participants.map(participant => participant.userId);
  if (new Set(participantIds).size !== participantIds.length) {
    context.addIssue({ code: 'custom', path: ['participants'], message: 'Each participant may only be invited once.' });
  }
  if (value.transcriptPolicy === 'automatic' && value.recordingPolicy === 'off') {
    context.addIssue({ code: 'custom', path: ['transcriptPolicy'], message: 'Automatic transcripts require recording to be enabled.' });
  }
  if ((value.provider ?? 'none') === 'none' && value.joinUrl) {
    context.addIssue({ code: 'custom', path: ['joinUrl'], message: 'A join URL requires a meeting provider.' });
  }
  if ((value.provider ?? 'none') !== 'none' && !value.joinUrl) {
    context.addIssue({ code: 'custom', path: ['joinUrl'], message: 'The selected meeting provider requires a join URL.' });
  }
  const hasIconType = Boolean(value.titleIconType);
  const hasIconValue = Boolean(value.titleIconValue?.trim());
  if (hasIconType !== hasIconValue) {
    context.addIssue({ code: 'custom', path: ['titleIconValue'], message: 'Choose both an icon style and an icon, or clear both fields.' });
  } else if (value.titleIconType === 'lucide' && value.titleIconValue && !calendarLucideTitleIcons.has(value.titleIconValue)) {
    context.addIssue({ code: 'custom', path: ['titleIconValue'], message: 'Choose a supported calendar icon.' });
  } else if (value.titleIconType === 'emoji' && value.titleIconValue && Array.from(value.titleIconValue).length > 8) {
    context.addIssue({ code: 'custom', path: ['titleIconValue'], message: 'Choose a single emoji for the calendar title.' });
  }
});

const idempotencyKeySchema = z.string().trim().min(8).max(200);
const schedulePatchSchema = z.object({
  allDay: z.boolean(), startsOn: z.iso.date().nullable().optional(), endsOn: z.iso.date().nullable().optional(),
  startsAt: z.iso.datetime().nullable().optional(), endsAt: z.iso.datetime().nullable().optional(),
  recurrenceRule: z.string().trim().max(2_000).nullable().optional(), visibility: visibilitySchema,
  departmentId: z.string().min(1).nullable().optional(),
}).strict().superRefine((value, context) => {
  if (value.allDay && !value.startsOn) context.addIssue({ code: 'custom', message: 'An all-day meeting requires startsOn.' });
  if (!value.allDay && (!value.startsAt || !value.endsAt)) context.addIssue({ code: 'custom', message: 'A timed meeting requires startsAt and endsAt.' });
  if (value.allDay && (value.startsAt || value.endsAt)) context.addIssue({ code: 'custom', message: 'All-day meetings cannot include timestamps.' });
  if (!value.allDay && (value.startsOn || value.endsOn)) context.addIssue({ code: 'custom', message: 'Timed meetings cannot include date-only fields.' });
  if (value.startsAt && value.endsAt && Date.parse(value.endsAt) <= Date.parse(value.startsAt)) context.addIssue({ code: 'custom', message: 'Meeting end must be after its start.' });
});
const participantInputSchema = z.object({ userId: z.string().min(1), role: z.enum(['presenter','attendee','observer']).optional(), required: z.boolean().optional() }).strict();
const updateSchema = z.object({
  meetingId: UUID, expectedVersion: z.number().int().positive(), idempotencyKey: idempotencyKeySchema,
  scope: z.enum(['occurrence','series']).optional(), occurrenceDate: z.iso.date().optional(),
  patch: z.object({ title: z.string().trim().min(1).max(200).optional(), description: z.string().trim().max(10_000).nullable().optional(),
    schedule: schedulePatchSchema.optional(), labelIds: z.array(UUID).max(20).optional(), provider: providerSchema.optional(),
    joinUrl: z.url().max(2_000).nullable().optional(), confidentiality: confidentialitySchema.optional(),
    recordingPolicy: recordingPolicySchema.optional(), transcriptPolicy: transcriptPolicySchema.optional(), retentionUntil: z.iso.datetime().nullable().optional(),
  }).strict().refine(value => Object.keys(value).length > 0, 'At least one update is required.'),
}).strict();
const cancelSchema = z.object({ meetingId: UUID, expectedVersion: z.number().int().positive(), idempotencyKey: idempotencyKeySchema,
  reason: z.string().trim().min(1).max(2_000), scope: z.enum(['occurrence','series']).optional(), occurrenceDate: z.iso.date().optional() }).strict();
const archiveSchema = z.object({ meetingId: UUID, expectedVersion: z.number().int().positive(), idempotencyKey: idempotencyKeySchema }).strict();
const agendaUpdateSchema = z.object({
  meetingId: UUID, expectedVersion: z.number().int().positive(), idempotencyKey: idempotencyKeySchema,
  items: z.array(z.object({
    id: UUID.optional(), sequence: z.number().int().min(0), title: z.string().trim().min(1).max(300),
    description: z.string().trim().max(4_000).nullable().optional(), ownerUserId: z.string().min(1).nullable().optional(),
    status: agendaStatusSchema.optional(), plannedMinutes: z.number().int().positive().max(1_440).nullable().optional(),
  }).strict()).max(50),
}).strict().superRefine((value, context) => {
  value.items.forEach((item, index) => {
    if (item.sequence !== index) context.addIssue({ code: 'custom', path: ['items', index, 'sequence'], message: 'Agenda sequence must be contiguous and match item order.' });
  });
  const ids = value.items.flatMap(item => item.id ? [item.id] : []);
  if (new Set(ids).size !== ids.length) context.addIssue({ code: 'custom', path: ['items'], message: 'Each agenda item may only appear once.' });
});
const inviteSchema = z.object({ meetingId: UUID, expectedVersion: z.number().int().positive(), idempotencyKey: idempotencyKeySchema,
  participants: z.array(participantInputSchema).min(1).max(250) }).strict().superRefine((value, context) => {
    if (new Set(value.participants.map(item => item.userId)).size !== value.participants.length) context.addIssue({ code:'custom',path:['participants'],message:'Each participant may only be invited once.' });
  });
const removeSchema = z.object({ meetingId: UUID, expectedVersion: z.number().int().positive(), idempotencyKey: idempotencyKeySchema,
  userId: z.string().min(1), reason: z.string().trim().max(2_000).nullable().optional() }).strict();
const rsvpSchema = z.object({ meetingId: UUID, expectedVersion: z.number().int().positive(), idempotencyKey: idempotencyKeySchema,
  responseStatus: z.enum(['accepted','declined','tentative']) }).strict();
const sessionStartSchema = z.object({ meetingId: UUID, occurrenceKey: z.string().trim().min(1).max(100), idempotencyKey: idempotencyKeySchema }).strict();
const sessionEndSchema = z.object({ meetingId: UUID, sessionId: UUID, expectedStatus: z.enum(['ready','live']), idempotencyKey: idempotencyKeySchema }).strict();

interface Actor { id: string; role?: string | null; department_id?: string | null }
interface MeetingRow {
  id: string; meeting_ref: string; calendar_entry_id: string; discussion_thread_id: string;
  organizer_user_id: string; title: string; description: string | null; status: MeetingDetailDTO['status'];
  confidentiality: MeetingDetailDTO['confidentiality']; provider: MeetingDetailDTO['provider']; join_url: string | null;
  recording_policy: MeetingDetailDTO['recordingPolicy']; transcript_policy: MeetingDetailDTO['transcriptPolicy'];
  retention_status: MeetingDetailDTO['retentionStatus']; retention_until: string | null;
  version: number; created_at: string; updated_at: string;
}
interface CalendarRow {
  id: string; all_day: boolean; starts_on: string | null; ends_on: string | null; starts_at: string | null;
  ends_at: string | null; recurrence_rule: string | null; recurrence_series_id: string | null;
  visibility: MeetingDetailDTO['schedule']['visibility']; department_id: string | null;
}
interface ParticipantRow { id: string; meeting_id: string; user_id: string; role: MeetingDetailDTO['participants'][number]['role']; required: boolean; added_at: string; removed_at: string | null; calendar_attendee_id: string }
interface UserRow { id: string; full_name: string | null; email: string | null; username: string; profile_image_thumb_url: string | null; profile_image_url: string | null; profile_image: string | null; profile_image_version: number | null }
interface SessionRow { id: string; meeting_id: string; occurrence_key: string; status: MeetingSessionDTO['status']; scheduled_starts_at: string | null; scheduled_ends_at: string | null; actual_started_at: string | null; actual_ended_at: string | null; transcript_status: MeetingSessionDTO['transcriptStatus']; failure_detail: string | null; updated_at: string }
interface ArtifactProjectionRow { id: string; session_id: string; kind: string; status: string }
interface SummaryProjectionRow {
  id: string; session_id: string; version: number; status: NonNullable<MeetingDetailDTO['publishedSummary']>['status'];
  source: NonNullable<MeetingDetailDTO['publishedSummary']>['source']; short_summary: string; decisions: string[]; key_takeaways: string[];
  provenance: NonNullable<MeetingDetailDTO['publishedSummary']>['provenance']; created_by: string | null; created_at: string;
  reviewed_by: string | null; reviewed_at: string | null; published_by: string | null; published_at: string | null; rejection_reason: string | null;
}
interface AgendaProjectionRow {
  id: string; meeting_id: string; sequence: number; title: string; description: string | null; owner_user_id: string | null;
  status: MeetingDetailDTO['agendaItems'][number]['status']; planned_minutes: number | null; chapter_id: string | null; created_at: string; updated_at: string;
}
interface AttendeeProjectionRow { id: string; response_status: MeetingDetailDTO['participants'][number]['responseStatus']; responded_at: string | null }
interface LabelAssignmentProjectionRow { meeting_labels: { id: string; name: string; color: string | null } | { id: string; name: string; color: string | null }[] | null }
interface RecordLinkProjectionRow {
  id: string; target_module: string; target_record_type: string; target_record_id: string; target_record_no: string | null;
  target_title: string | null; target_deep_link: string | null; relationship_type: MeetingDetailDTO['recordLinks'][number]['relationship'];
  visibility: MeetingDetailDTO['recordLinks'][number]['confidentiality'];
}

async function permissionChecker(actor: Actor): Promise<(permission: string) => boolean> {
  if (actor.role === 'superadmin') return permission => permission !== 'meetings.compliance_read';
  const [roles, overrides] = await Promise.all([loadRolePermissions(actor.role ?? ''), loadUserOverrides(actor.id)]);
  return permission => resolveWithSet(permission, roles, overrides);
}

function avatarOf(user: UserRow): string | null {
  return user.profile_image_thumb_url ?? user.profile_image_url ?? (/^https?:\/\//.test(user.profile_image ?? '') ? user.profile_image : null);
}

function toPerson(user: UserRow): MeetingPersonDTO {
  return { userId: user.id, displayName: user.full_name ?? user.username, email: user.email, profileImage: avatarOf(user), profileImageVersion: user.profile_image_version };
}

async function loadUsers(ids: string[]): Promise<Map<string, MeetingPersonDTO>> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return new Map();
  const { data, error } = await sb.from('app_users').select('id,full_name,email,username,profile_image_thumb_url,profile_image_url,profile_image,profile_image_version').in('id', unique);
  if (error) throw new Error(`meeting user hydration failed: ${error.message}`);
  return new Map((data as UserRow[]).map(user => [user.id, toPerson(user)]));
}

function scheduleOf(row: CalendarRow, occurrenceKey?: string) {
  return { calendarEntryId: row.id, allDay: row.all_day, startsOn: row.starts_on, endsOn: row.ends_on, startsAt: row.starts_at, endsAt: row.ends_at, recurrenceRule: row.recurrence_rule, recurrenceSeriesId: row.recurrence_series_id, occurrenceDate: occurrenceKey && occurrenceKey !== 'master' ? occurrenceKey : null, visibility: row.visibility, departmentId: row.department_id };
}

function sessionOf(row: SessionRow, artifacts: { id: string; session_id: string; kind: string; status: string }[] = [], summaries: { id: string; session_id: string; status: string }[] = []): MeetingSessionDTO {
  const recording = artifacts.find(item => item.session_id === row.id && (item.kind === 'recording' || item.kind === 'audio'));
  const summary = summaries.find(item => item.session_id === row.id && item.status === 'published');
  return { id: row.id, meetingId: row.meeting_id, occurrenceKey: row.occurrence_key, status: row.status, scheduledStartsAt: row.scheduled_starts_at, scheduledEndsAt: row.scheduled_ends_at, startedAt: row.actual_started_at, endedAt: row.actual_ended_at, recordingStatus: (recording?.status as MeetingSessionDTO['recordingStatus']) ?? null, transcriptStatus: row.transcript_status, summaryStatus: (summary?.status as MeetingSessionDTO['summaryStatus']) ?? null, recordingArtifactId: recording?.id ?? null, publishedSummaryVersionId: summary?.id ?? null, failureReason: row.failure_detail };
}

function capabilities(meeting: MeetingRow, actor: Actor, can: (permission: string) => boolean, participant: boolean): MeetingCapabilitiesDTO {
  const owner = meeting.organizer_user_id === actor.id;
  const manager = can('meetings.manage_team');
  const mutable = !['cancelled', 'archived'].includes(meeting.status);
  const controls = owner || manager;
  return {
    edit: mutable && controls && can(owner ? 'meetings.manage_own' : 'meetings.manage_team'), cancel: mutable && controls,
    archive: meeting.status === 'completed' && controls, manageParticipants: mutable && controls && can('meetings.participants.manage'),
    respond: participant && meeting.status === 'scheduled', join: participant && meeting.status === 'scheduled' && Boolean(meeting.join_url),
    // Session controls are organizer-owned. A participant's elevated global role
    // must not let them take over another organizer's live meeting.
    startSession: mutable && owner, endSession: mutable && owner, manageRecording: controls && can('meetings.recording.manage'),
    viewRecording: participant && can('meetings.recording.view'), viewTranscript: participant && can('meetings.transcript.view'),
    exportTranscript: participant && can('meetings.transcript.export'), generateSummary: controls && can('meetings.summary.generate'),
    reviewSummary: controls && can('meetings.summary.review'), publishSummary: controls && can('meetings.summary.publish'),
    manageAgenda: mutable && controls, proposeAction: participant, acceptAction: participant && can('meetings.actions.publish'),
    comment: participant && can('meetings.comments.post'), viewMetrics: participant && can('meetings.metrics.view'),
    manageLinks: mutable && controls, manageRetention: can('meetings.retention.manage'),
  };
}

async function canReadMeeting(actor: Actor, meeting: MeetingRow, calendar: CalendarRow, can: (permission: string) => boolean): Promise<boolean> {
  if (meeting.organizer_user_id === actor.id) return true;
  const { data, error } = await sb.from('meeting_participants').select('id').eq('meeting_id', meeting.id).eq('user_id', actor.id).is('removed_at', null).maybeSingle();
  if (error) throw new Error(`meeting access check failed: ${error.message}`);
  if (data) return true;
  if (!can('meetings.manage_team')) return false;
  return actor.role === 'admin' || actor.role === 'superadmin' || (Boolean(actor.department_id) && calendar.department_id === actor.department_id);
}

async function loadMeetingDetail(actor: Actor, meetingId: string, occurrenceKey?: string): Promise<MeetingDetailDTO | null> {
  const meetingResult = await sb.from('meetings').select('*').eq('id', meetingId).maybeSingle();
  if (meetingResult.error) throw new Error(`meeting read failed: ${meetingResult.error.message}`);
  const meeting = meetingResult.data as MeetingRow | null;
  if (!meeting) return null;
  const calendarResult = await sb.from('calendar_entries').select('id,all_day,starts_on,ends_on,starts_at,ends_at,recurrence_rule,recurrence_series_id,visibility,department_id').eq('id', meeting.calendar_entry_id).single();
  if (calendarResult.error) throw new Error(`meeting calendar projection failed: ${calendarResult.error.message}`);
  const calendar = calendarResult.data;
  const can = await permissionChecker(actor);
  if (!await canReadMeeting(actor, meeting, calendar, can)) return null;

  const [participantResult, sessionResult] = await Promise.all([
    sb.from('meeting_participants').select('*').eq('meeting_id', meeting.id).is('removed_at', null).order('added_at'),
    sb.from('meeting_sessions').select('*').eq('meeting_id', meeting.id).order('scheduled_starts_at', { ascending: false }),
  ]);
  if (participantResult.error || sessionResult.error) throw new Error(`meeting detail projection failed: ${(participantResult.error ?? sessionResult.error)!.message}`);
  const participantRows = participantResult.data as ParticipantRow[];
  const sessionRows = sessionResult.data as SessionRow[];
  const sessionIds = sessionRows.map(row => row.id);
  const [artifactResult, summaryResult, agendaResult, labelsResult, linksResult] = await Promise.all([
    sessionIds.length ? sb.from('meeting_artifacts').select('id,session_id,kind,status').in('session_id', sessionIds) : Promise.resolve({ data: [], error: null }),
    sessionIds.length ? sb.from('meeting_summary_versions').select('*').in('session_id', sessionIds).order('version', { ascending: false }) : Promise.resolve({ data: [], error: null }),
    sb.from('meeting_agenda_items').select('*').eq('meeting_id', meeting.id).order('sequence'),
    sb.from('meeting_label_assignments').select('label_id,meeting_labels(id,name,color)').eq('meeting_id', meeting.id),
    sb.from('record_links').select('*').eq('source_module', 'meetings').eq('source_record_type', 'meeting').eq('source_record_id', meeting.id),
  ]);
  const failure = [artifactResult.error, summaryResult.error, agendaResult.error, labelsResult.error, linksResult.error].find(Boolean);
  if (failure) throw new Error(`meeting detail projection failed: ${failure.message}`);

  const artifactRows = artifactResult.data as ArtifactProjectionRow[];
  const summaryRows = summaryResult.data as SummaryProjectionRow[];
  const agendaRows = agendaResult.data as AgendaProjectionRow[];
  const labelRows = labelsResult.data as LabelAssignmentProjectionRow[];
  const linkRows = linksResult.data as RecordLinkProjectionRow[];
  const participants = participantRows;
  const people = await loadUsers([meeting.organizer_user_id, ...participants.map(row => row.user_id), ...agendaRows.flatMap(row => row.owner_user_id ? [row.owner_user_id] : [])]);
  const organizer = people.get(meeting.organizer_user_id);
  if (!organizer) throw new Error('meeting organizer projection is missing');
  const attendeeRows = participants.length
    ? await sb.from('calendar_activity_attendees').select('id,response_status,responded_at').in('id', participants.map(row => row.calendar_attendee_id))
    : { data: [], error: null };
  if (attendeeRows.error) throw new Error(`meeting attendee projection failed: ${attendeeRows.error.message}`);
  const attendeeById = new Map((attendeeRows.data as AttendeeProjectionRow[]).map(row => [row.id, row]));
  const sessions = sessionRows.map(row => sessionOf(row, artifactRows, summaryRows));
  const currentSession = sessions.find(value => value.occurrenceKey === occurrenceKey) ?? sessions.at(0) ?? null;
  const publishedRaw = summaryRows.find(row => row.status === 'published');
  const publishedSummary = publishedRaw ? {
    id: publishedRaw.id, sessionId: publishedRaw.session_id, version: publishedRaw.version, status: publishedRaw.status,
    source: publishedRaw.source, content: { shortSummary: publishedRaw.short_summary, decisions: publishedRaw.decisions, keyTakeaways: publishedRaw.key_takeaways },
    provenance: publishedRaw.provenance, createdBy: publishedRaw.created_by ? people.get(publishedRaw.created_by) ?? null : null,
    createdAt: publishedRaw.created_at, reviewedBy: publishedRaw.reviewed_by ? people.get(publishedRaw.reviewed_by) ?? null : null,
    reviewedAt: publishedRaw.reviewed_at, publishedBy: publishedRaw.published_by ? people.get(publishedRaw.published_by) ?? null : null,
    publishedAt: publishedRaw.published_at, rejectionReason: publishedRaw.rejection_reason,
  } as MeetingDetailDTO['publishedSummary'] : null;
  const isParticipant = meeting.organizer_user_id === actor.id || participants.some(row => row.user_id === actor.id);

  return {
    id: meeting.id, reference: meeting.meeting_ref, title: meeting.title, description: meeting.description, status: meeting.status,
    confidentiality: meeting.confidentiality, recordingPolicy: meeting.recording_policy, transcriptPolicy: meeting.transcript_policy,
    retentionStatus: meeting.retention_status, retentionUntil: meeting.retention_until, organizer, schedule: scheduleOf(calendar, occurrenceKey),
    provider: meeting.provider, discussionThreadId: meeting.discussion_thread_id,
    participants: participants.map(row => { const attendee = attendeeById.get(row.calendar_attendee_id); return { id: row.id, person: people.get(row.user_id)!, role: row.role, responseStatus: attendee?.response_status ?? 'invited', respondedAt: attendee?.responded_at ?? null, required: row.required, addedAt: row.added_at, removedAt: row.removed_at }; }),
    labels: labelRows.flatMap(row => { const label = Array.isArray(row.meeting_labels) ? row.meeting_labels[0] : row.meeting_labels; return label ? [label] : []; }),
    recordLinks: linkRows.map(row => ({ id: row.id, module: row.target_module, recordType: row.target_record_type, recordId: row.target_record_id, recordNo: row.target_record_no, title: row.target_title ?? row.target_record_id, deepLink: row.target_deep_link, relationship: row.relationship_type, confidentiality: row.visibility })),
    agendaItems: agendaRows.map(row => ({ id: row.id, meetingId: row.meeting_id, sequence: row.sequence, title: row.title, description: row.description, owner: row.owner_user_id ? people.get(row.owner_user_id) ?? null : null, status: row.status, plannedMinutes: row.planned_minutes, chapterId: row.chapter_id, createdAt: row.created_at, updatedAt: row.updated_at })),
    sessions, currentSession, publishedSummary,
    join: meeting.join_url && isParticipant ? {
      provider: meeting.provider,
      joinUrl: meeting.join_url,
      availableFrom: typeof calendar.starts_at === 'string' ? calendar.starts_at : null,
      availableUntil: typeof calendar.ends_at === 'string' ? calendar.ends_at : null,
    } : null,
    createdAt: meeting.created_at, updatedAt: meeting.updated_at, version: meeting.version, capabilities: capabilities(meeting, actor, can, isParticipant),
  };
}

router.post('/meetings/list', async context => {
  const actor = await requirePermission(context, 'meetings.view');
  const parsed = zv(context, listSchema, context.get('body').args ?? {});
  if (!parsed.ok) return parsed.response;
  const request = parsed.data;
  const can = await permissionChecker(actor);

  const [{ data: ownMemberships, error: ownMembershipError }, participantMemberships] = await Promise.all([
    sb.from('meeting_participants').select('meeting_id').eq('user_id', actor.id).is('removed_at', null),
    request.participantUserId
      ? sb.from('meeting_participants').select('meeting_id').eq('user_id', request.participantUserId).is('removed_at', null)
      : Promise.resolve({ data: null, error: null }),
  ]);
  if (ownMembershipError || participantMemberships.error) return context.json({ success: false, message: 'Failed to load meetings.' }, 500);
  const accessibleIds = [...new Set(ownMemberships.map(row => row.meeting_id as string))];

  let managedCalendarIds: string[] = [];
  if (can('meetings.manage_team')) {
    let managed = sb.from('calendar_entries').select('id').eq('type', 'activity').eq('visibility', 'team');
    if (actor.role !== 'admin' && actor.role !== 'superadmin') {
      if (!actor.department_id) managedCalendarIds = [];
      else managed = managed.eq('department_id', actor.department_id);
    }
    if (actor.role === 'admin' || actor.role === 'superadmin' || actor.department_id) {
      const result = await managed;
      if (result.error) return context.json({ success: false, message: 'Failed to load meetings.' }, 500);
      managedCalendarIds = result.data.map(row => row.id as string);
    }
  }

  const candidateSets: Set<string>[] = [];
  if (participantMemberships.data) candidateSets.push(new Set(participantMemberships.data.map(row => row.meeting_id as string)));

  if (request.labelIds?.length) {
    const result = await sb.from('meeting_label_assignments').select('meeting_id,label_id').in('label_id', request.labelIds);
    if (result.error) return context.json({ success: false, message: 'Failed to load meetings.' }, 500);
    const grouped = new Map<string, Set<string>>();
    for (const row of result.data) (grouped.get(row.meeting_id as string) ?? grouped.set(row.meeting_id as string, new Set()).get(row.meeting_id as string)!).add(row.label_id as string);
    candidateSets.push(new Set([...grouped].filter(([, labels]) => request.labelIds!.every(id => labels.has(id))).map(([id]) => id)));
  }

  if (request.sourceModule) {
    const result = await sb.from('record_links').select('source_record_id').eq('source_module', 'meetings').eq('source_record_type', 'meeting').eq('target_module', request.sourceModule);
    if (result.error) return context.json({ success: false, message: 'Failed to load meetings.' }, 500);
    candidateSets.push(new Set(result.data.map(row => row.source_record_id as string)));
  }

  let calendarFilter = sb.from('calendar_entries').select('id').eq('type', 'activity');
  let hasCalendarFilter = false;
  if (request.departmentId) { calendarFilter = calendarFilter.eq('department_id', request.departmentId); hasCalendarFilter = true; }
  if (request.from || request.to) {
    const fromTs = request.from ?? '1970-01-01T00:00:00.000Z';
    const toTs = request.to ?? '9999-12-31T23:59:59.999Z';
    const fromDate = fromTs.slice(0, 10); const toDate = toTs.slice(0, 10);
    calendarFilter = calendarFilter.or(`and(starts_at.gte.${fromTs},starts_at.lte.${toTs}),and(starts_on.gte.${fromDate},starts_on.lte.${toDate})`);
    hasCalendarFilter = true;
  }
  if (hasCalendarFilter) {
    const result = await calendarFilter;
    if (result.error) return context.json({ success: false, message: 'Failed to load meetings.' }, 500);
    const calendarIds = result.data.map(row => row.id as string);
    if (!calendarIds.length) return context.json({ success: true, data: { items: [], nextCursor: null } });
    const resultMeetings = await sb.from('meetings').select('id').in('calendar_entry_id', calendarIds);
    if (resultMeetings.error) return context.json({ success: false, message: 'Failed to load meetings.' }, 500);
    candidateSets.push(new Set(resultMeetings.data.map(row => row.id as string)));
  }

  let candidateIds: string[] | null = null;
  if (candidateSets.length) {
    candidateIds = [...candidateSets[0]].filter(id => candidateSets.slice(1).every(set => set.has(id)));
    if (!candidateIds.length) return context.json({ success: true, data: { items: [], nextCursor: null } });
  }

  let query = sb.from('meetings').select('*').order('updated_at', { ascending: false }).limit(request.limit ?? 30);
  const scope = [
    `organizer_user_id.eq.${actor.id}`,
    ...(accessibleIds.length ? [`id.in.(${accessibleIds.join(',')})`] : []),
    ...(managedCalendarIds.length ? [`calendar_entry_id.in.(${managedCalendarIds.join(',')})`] : []),
  ];
  query = query.or(scope.join(','));
  if (candidateIds) query = query.in('id', candidateIds);
  if (request.statuses?.length) query = query.in('status', request.statuses);
  if (request.ownerUserId) query = query.eq('organizer_user_id', request.ownerUserId);
  if (request.query) query = query.ilike('title', `%${request.query.replace(/[%_]/g, '\\$&')}%`);
  if (request.cursor) {
    try {
      const cursor = JSON.parse(Buffer.from(request.cursor, 'base64url').toString('utf8')) as { updatedAt?: string; id?: string };
      if (!cursor.updatedAt || !cursor.id) throw new Error('invalid cursor');
      query = query.or(`updated_at.lt.${cursor.updatedAt},and(updated_at.eq.${cursor.updatedAt},id.lt.${cursor.id})`);
    } catch {
      return context.json({ success: false, message: 'Invalid meetings cursor.' }, 400);
    }
  }
  const { data: rawMeetings, error } = await query;
  if (error) return context.json({ success: false, message: 'Failed to load meetings.' }, 500);
  const details = (await Promise.all((rawMeetings as MeetingRow[]).map(row => loadMeetingDetail(actor, row.id)))).filter((value): value is MeetingDetailDTO => Boolean(value));
  const items: MeetingListItemDTO[] = details.map(detail => ({
    id: detail.id, reference: detail.reference, title: detail.title, status: detail.status, confidentiality: detail.confidentiality,
    organizer: detail.organizer, schedule: detail.schedule, participantCount: detail.participants.length,
    participantPreview: detail.participants.slice(0, 4).map(row => row.person), myResponseStatus: detail.participants.find(row => row.person.userId === actor.id)?.responseStatus ?? null,
    currentSession: detail.currentSession, labels: detail.labels, linkedRecordCount: detail.recordLinks.length, updatedAt: detail.updatedAt, capabilities: detail.capabilities,
  }));
  const last = (rawMeetings as MeetingRow[]).at(-1);
  const nextCursor = rawMeetings.length === (request.limit ?? 30) && last
    ? Buffer.from(JSON.stringify({ updatedAt: last.updated_at, id: last.id }), 'utf8').toString('base64url')
    : null;
  return context.json({ success: true, data: { items, nextCursor } });
});

router.post('/meetings/get', async context => {
  const actor = await requirePermission(context, 'meetings.view');
  const parsed = zv(context, getSchema, context.get('body').args ?? {});
  if (!parsed.ok) return parsed.response;
  try {
    const detail = await loadMeetingDetail(actor, parsed.data.meetingId, parsed.data.occurrenceKey);
    return detail ? context.json({ success: true, data: detail }) : context.json({ success: false, message: 'Meeting not found.' }, 404);
  } catch (error) {
    console.error('[meetings/get]', error);
    return context.json({ success: false, message: 'Failed to load the meeting.' }, 500);
  }
});

router.post('/meetings/create', async context => {
  const actor = await requirePermission(context, 'meetings.create');
  const parsed = zv(context, createSchema, context.get('body').args ?? {});
  if (!parsed.ok) return parsed.response;
  const { idempotencyKey, ...payload } = parsed.data;
  const departmentId = payload.schedule.visibility === 'team'
    ? payload.schedule.departmentId ?? actor.department_id ?? null
    : null;
  if (payload.schedule.visibility === 'team' && !departmentId) {
    return context.json({ success: false, message: 'Choose a department for a department-visible meeting.' }, 400);
  }
  if (departmentId) {
    const can = await permissionChecker(actor);
    if (departmentId !== actor.department_id && !can('calendar.manage')) {
      return context.json({ success: false, message: 'You cannot schedule a meeting for another department.' }, 403);
    }
    const { data: department, error: departmentError } = await sb.from('departments').select('id').eq('id', departmentId).maybeSingle();
    if (departmentError) return context.json({ success: false, message: 'The selected department could not be validated.' }, 500);
    if (!department) return context.json({ success: false, message: 'The selected department is not valid.' }, 400);
  }
  payload.schedule.departmentId = departmentId;
  if (!payload.calendarId) {
    const { data: defaultCalendar, error: defaultCalendarError } = await sb.from('calendar_collections')
      .select('id').eq('owner_user_id', actor.id).eq('status', 'active').eq('is_default', true).maybeSingle<{ id: string }>();
    if (defaultCalendarError) {
      return context.json({ success: false, message: 'Your default calendar could not be resolved.' }, 500);
    }
    if (!defaultCalendar) {
      return context.json({ success: false, message: 'Create or select an active SIOMAC calendar before scheduling a meeting.' }, 409);
    }
    payload.calendarId = defaultCalendar.id;
  }
  const { data: calendar, error: calendarError } = await sb.from('calendar_collections')
    .select('id,owner_user_id,visibility,status').eq('id', payload.calendarId).eq('status', 'active').maybeSingle();
  if (calendarError) return context.json({ success: false, message: 'The selected calendar could not be validated.' }, 500);
  if (!calendar) return context.json({ success: false, message: 'The selected calendar was not found.' }, 404);
  if (calendar.owner_user_id !== actor.id && calendar.visibility === 'personal') {
    return context.json({ success: false, message: 'You cannot schedule a meeting in this calendar.' }, 403);
  }
  if (payload.categoryId) {
    const { data: category, error: categoryError } = await sb.from('calendar_categories')
      .select('id').eq('id', payload.categoryId).eq('is_active', true).maybeSingle();
    if (categoryError) return context.json({ success: false, message: 'The selected category could not be validated.' }, 500);
    if (!category) return context.json({ success: false, message: 'The selected category is not available.' }, 400);
  }
  if (payload.participants.some(participant => participant.userId === actor.id)) {
    return context.json({ success: false, message: 'The organizer must not also be included as an invited participant.' }, 400);
  }
  try {
    await Promise.all((payload.recordLinks ?? []).map(link => assertCanViewRecordType(actor, link.module, link.recordType)));
  } catch (cause) {
    const status = (cause as { status?: number }).status ?? 403;
    return context.json({ success: false, message: cause instanceof Error ? cause.message : 'You cannot link one or more selected records.' }, status as 403);
  }
  const createResult = await sb.rpc('meetings_create_tx', { p_actor_id: actor.id, p_idempotency_key: idempotencyKey, p_payload: payload });
  if (createResult.error) {
    console.error('[meetings/create]', createResult.error);
    const conflict = createResult.error.code === '23000' || createResult.error.code === '23505';
    const invalid = createResult.error.code === '22023' || createResult.error.code === '23503' || createResult.error.code === 'P0002';
    return context.json({ success: false, message: conflict ? 'This request conflicts with an existing meeting.' : invalid ? createResult.error.message : 'The meeting could not be created.' }, conflict ? 409 : invalid ? 400 : 500);
  }
  const transaction = createResult.data as { meetingId?: string; meetingRef?: string; eventId?: string } | null;
  const meetingId = transaction?.meetingId;
  if (!meetingId) return context.json({ success: false, message: 'The meeting transaction returned an invalid result.' }, 500);
  const detail = await loadMeetingDetail(actor, meetingId);
  if (!detail) return context.json({ success: false, message: 'The meeting was created but could not be reloaded.' }, 500);
  const invited = [...new Set(payload.participants.map(participant => participant.userId).filter(userId => userId !== actor.id))];
  await deliverEventNotifications({
    eventType: 'meetings.meeting.created', sourceModule: 'meetings', sourceEntityType: 'meeting', sourceEntityId: meetingId,
    actorUserId: actor.id, severity: 'success',
    payload: { meetingId, meetingRef: transaction.meetingRef, calendarEntryId: detail.schedule.calendarEntryId, discussionThreadId: detail.discussionThreadId },
    dedupeKey: `${actor.id}:meetings.create:${idempotencyKey}`,
    explicitRecipients: invited.map(userId => ({ userId, reason: 'participant' as const })),
    notification: { title: `Meeting invitation: ${detail.title}`, body: detail.schedule.startsAt ?? detail.schedule.startsOn ?? 'Schedule pending', actionRoute: 's-meetings', type: 'meeting_invitation', actionRequired: true, dueAt: detail.schedule.startsAt },
  }, transaction.eventId ?? null);
  return context.json({ success: true, data: detail }, 201);
});

type CapabilityKey = keyof MeetingCapabilitiesDTO;
async function commandMeeting(actor: Actor, meetingId: string, capability: CapabilityKey) {
  const detail = await loadMeetingDetail(actor, meetingId);
  return detail?.capabilities[capability] ? detail : null;
}
async function notifyMeetingCommand(actor: Actor, detail: MeetingDetailDTO, eventType: string, idempotencyKey: string, result: unknown, title: string, body: string, userIds: string[]) {
  const eventId=(result as {eventId?:string}|null)?.eventId??null;
  await deliverEventNotifications({eventType,sourceModule:'meetings',sourceEntityType:'meeting',sourceEntityId:detail.id,actorUserId:actor.id,severity:'info',payload:{meetingId:detail.id,meetingRef:detail.reference},dedupeKey:`${actor.id}:${eventType}:${idempotencyKey}`,explicitRecipients:[...new Set(userIds)].map(userId=>({userId,reason:'participant' as const})),notification:{title,body,actionRoute:'s-meetings',type:eventType,actionRequired:eventType==='meetings.meeting.cancelled'}},eventId);
}
function commandFailure(context: Parameters<typeof zv>[0], error: { code?: string; message?: string } | null) {
  const code = error?.code;
  const message=(error?.message??'').toLowerCase();
  const conflict=code === 'MT409' || code === '23000' || code === '23505' || message.includes('version conflict') || message.includes('idempotency key payload mismatch');
  const status = code === 'MT404' || code === 'P0002' ? 404 : conflict ? 409 : code === '22023' || code === '0A000' || code === '55000' ? 400 : 500;
  return context.json({ success:false, message: status === 409 ? 'The meeting changed. Reload it and try again.' : status === 404 ? 'Meeting not found.' : status === 400 ? error?.message ?? 'Invalid meeting command.' : 'The meeting command failed.' }, status as 400);
}

router.post('/meetings/update', async context => {
  const actor=await requirePermission(context,'meetings.manage_own'); const parsed=zv(context,updateSchema,context.get('body').args??{}); if(!parsed.ok)return parsed.response;
  const current = await commandMeeting(actor,parsed.data.meetingId,'edit');
  if(!current) return context.json({success:false,message:'Meeting not found.'},404);
  if (parsed.data.patch.schedule) {
    const schedule = parsed.data.patch.schedule;
    const departmentId = schedule.visibility === 'team'
      ? schedule.departmentId ?? current.schedule.departmentId ?? actor.department_id ?? null
      : null;
    if (schedule.visibility === 'team' && !departmentId) {
      return context.json({ success: false, message: 'Choose a department for a department-visible meeting.' }, 400);
    }
    if (departmentId) {
      const can = await permissionChecker(actor);
      if (departmentId !== actor.department_id && !can('calendar.manage')) {
        return context.json({ success: false, message: 'You cannot schedule a meeting for another department.' }, 403);
      }
      const { data: department, error: departmentError } = await sb.from('departments').select('id').eq('id', departmentId).maybeSingle();
      if (departmentError) return context.json({ success: false, message: 'The selected department could not be validated.' }, 500);
      if (!department) return context.json({ success: false, message: 'The selected department is not valid.' }, 400);
    }
    schedule.departmentId = departmentId;
  }
  const updateResult=await sb.rpc('meetings_update_tx',{p_actor_id:actor.id,p_idempotency_key:parsed.data.idempotencyKey,p_meeting_id:parsed.data.meetingId,p_expected_version:parsed.data.expectedVersion,p_patch:parsed.data.patch,p_scope:parsed.data.scope??'series',p_occurrence_date:parsed.data.occurrenceDate??null});
  if(updateResult.error)return commandFailure(context,updateResult.error); const data=updateResult.data as Record<string,unknown>; const detail=await loadMeetingDetail(actor,parsed.data.meetingId); if(detail)await notifyMeetingCommand(actor,detail,'meetings.meeting.updated',parsed.data.idempotencyKey,data,`Meeting updated: ${detail.title}`,'Meeting details or schedule changed.',detail.participants.map(item=>item.person.userId)); return context.json({success:true,data});
});
router.post('/meetings/agenda/update', async context => {
  const actor=await requirePermission(context,'meetings.manage_own'); const parsed=zv(context,agendaUpdateSchema,context.get('body').args??{}); if(!parsed.ok)return parsed.response;
  const before=await commandMeeting(actor,parsed.data.meetingId,'manageAgenda'); if(!before)return context.json({success:false,message:'Meeting not found.'},404);
  const agendaResult=await sb.rpc('meetings_agenda_update_tx',{p_actor_id:actor.id,p_idempotency_key:parsed.data.idempotencyKey,p_meeting_id:parsed.data.meetingId,p_expected_version:parsed.data.expectedVersion,p_items:parsed.data.items});
  if(agendaResult.error)return commandFailure(context,agendaResult.error);
  const data=agendaResult.data as Record<string,unknown>;
  const detail=await loadMeetingDetail(actor,parsed.data.meetingId); if(!detail)return context.json({success:false,message:'Meeting not found.'},404);
  await notifyMeetingCommand(actor,detail,'meetings.agenda.updated',parsed.data.idempotencyKey,data,`Agenda updated: ${detail.title}`,'The meeting agenda was updated.',detail.participants.map(item=>item.person.userId));
  return context.json({success:true,data:{items:detail.agendaItems,version:detail.version}});
});
router.post('/meetings/cancel', async context => {
  const actor=await requirePermission(context,'meetings.manage_own'); const parsed=zv(context,cancelSchema,context.get('body').args??{}); if(!parsed.ok)return parsed.response;
  const detail=await commandMeeting(actor,parsed.data.meetingId,'cancel'); if(!detail)return context.json({success:false,message:'Meeting not found.'},404);
  const cancelResult=await sb.rpc('meetings_cancel_tx',{p_actor_id:actor.id,p_idempotency_key:parsed.data.idempotencyKey,p_meeting_id:parsed.data.meetingId,p_expected_version:parsed.data.expectedVersion,p_reason:parsed.data.reason,p_scope:parsed.data.scope??'series',p_occurrence_date:parsed.data.occurrenceDate??null});
  if(cancelResult.error)return commandFailure(context,cancelResult.error); const data=cancelResult.data as Record<string,unknown>; await notifyMeetingCommand(actor,detail,'meetings.meeting.cancelled',parsed.data.idempotencyKey,data,`Meeting cancelled: ${detail.title}`,parsed.data.reason,detail.participants.map(item=>item.person.userId)); return context.json({success:true,data});
});
router.post('/meetings/archive', async context => {
  const actor=await requirePermission(context,'meetings.manage_own'); const parsed=zv(context,archiveSchema,context.get('body').args??{}); if(!parsed.ok)return parsed.response;
  if(!await commandMeeting(actor,parsed.data.meetingId,'archive'))return context.json({success:false,message:'Meeting not found.'},404);
  const archiveResult=await sb.rpc('meetings_archive_tx',{p_actor_id:actor.id,p_idempotency_key:parsed.data.idempotencyKey,p_meeting_id:parsed.data.meetingId,p_expected_version:parsed.data.expectedVersion});
  if(archiveResult.error)return commandFailure(context,archiveResult.error); const data=archiveResult.data as Record<string,unknown>; const detail=await loadMeetingDetail(actor,parsed.data.meetingId); if(detail)await notifyMeetingCommand(actor,detail,'meetings.meeting.archived',parsed.data.idempotencyKey,data,`Meeting archived: ${detail.title}`,'The completed meeting was archived.',detail.participants.map(item=>item.person.userId)); return context.json({success:true,data});
});
router.post('/meetings/participants/invite', async context => {
  const actor=await requirePermission(context,'meetings.participants.manage'); const parsed=zv(context,inviteSchema,context.get('body').args??{}); if(!parsed.ok)return parsed.response;
  const before=await commandMeeting(actor,parsed.data.meetingId,'manageParticipants'); if(!before)return context.json({success:false,message:'Meeting not found.'},404);
  const inviteResult=await sb.rpc('meetings_participants_invite_tx',{p_actor_id:actor.id,p_idempotency_key:parsed.data.idempotencyKey,p_meeting_id:parsed.data.meetingId,p_expected_version:parsed.data.expectedVersion,p_participants:parsed.data.participants});
  if(inviteResult.error)return commandFailure(context,inviteResult.error); const result=inviteResult.data as {version:number;eventId?:string}; const detail=await loadMeetingDetail(actor,parsed.data.meetingId);
  await deliverEventNotifications({eventType:'meetings.participants.invited',sourceModule:'meetings',sourceEntityType:'meeting',sourceEntityId:parsed.data.meetingId,actorUserId:actor.id,severity:'info',payload:{meetingId:parsed.data.meetingId},dedupeKey:`${actor.id}:meetings.participants.invited:${parsed.data.idempotencyKey}`,explicitRecipients:parsed.data.participants.map(item=>({userId:item.userId,reason:'participant' as const})),notification:{title:`Meeting invitation: ${detail?.title??'Meeting'}`,body:'You were invited to a meeting.',actionRoute:'s-meetings',type:'meeting_invitation',actionRequired:true}},result.eventId??null);
  return context.json({success:true,data:{meetingId:parsed.data.meetingId,participants:detail?.participants??[],version:result.version}});
});
router.post('/meetings/participants/remove', async context => {
  const actor=await requirePermission(context,'meetings.participants.manage'); const parsed=zv(context,removeSchema,context.get('body').args??{}); if(!parsed.ok)return parsed.response;
  const detail=await commandMeeting(actor,parsed.data.meetingId,'manageParticipants'); if(!detail)return context.json({success:false,message:'Meeting not found.'},404);
  const removeResult=await sb.rpc('meetings_participant_remove_tx',{p_actor_id:actor.id,p_idempotency_key:parsed.data.idempotencyKey,p_meeting_id:parsed.data.meetingId,p_expected_version:parsed.data.expectedVersion,p_user_id:parsed.data.userId,p_reason:parsed.data.reason??null});
  if(removeResult.error)return commandFailure(context,removeResult.error); const data=removeResult.data as {version:number}; await notifyMeetingCommand(actor,detail,'meetings.participant.removed',parsed.data.idempotencyKey,data,`Removed from meeting: ${detail.title}`,parsed.data.reason??'Your meeting invitation was removed.',[parsed.data.userId]); const refreshed=await loadMeetingDetail(actor,parsed.data.meetingId); return context.json({success:true,data:{meetingId:parsed.data.meetingId,participants:refreshed?.participants??[],version:data.version}});
});
router.post('/meetings/rsvp', async context => {
  const actor=await requirePermission(context,'meetings.view'); const parsed=zv(context,rsvpSchema,context.get('body').args??{}); if(!parsed.ok)return parsed.response;
  if(!await commandMeeting(actor,parsed.data.meetingId,'respond'))return context.json({success:false,message:'Meeting not found.'},404);
  const rsvpResult=await sb.rpc('meetings_rsvp_tx',{p_actor_id:actor.id,p_idempotency_key:parsed.data.idempotencyKey,p_meeting_id:parsed.data.meetingId,p_expected_version:parsed.data.expectedVersion,p_response_status:parsed.data.responseStatus});
  if(rsvpResult.error)return commandFailure(context,rsvpResult.error); const data=rsvpResult.data as Record<string,unknown>; const detail=await loadMeetingDetail(actor,parsed.data.meetingId); if(detail)await notifyMeetingCommand(actor,detail,'meetings.participant.rsvp_changed',parsed.data.idempotencyKey,data,`RSVP updated: ${detail.title}`,`${actor.id} responded ${parsed.data.responseStatus}.`,[detail.organizer.userId]); return context.json({success:true,data});
});
router.post('/meetings/sessions/start', async context => {
  const actor=await requirePermission(context,'meetings.manage_own'); const parsed=zv(context,sessionStartSchema,context.get('body').args??{}); if(!parsed.ok)return parsed.response;
  if(!await commandMeeting(actor,parsed.data.meetingId,'startSession'))return context.json({success:false,message:'Meeting not found.'},404);
  const startResult=await sb.rpc('meetings_session_start_tx',{p_actor_id:actor.id,p_idempotency_key:parsed.data.idempotencyKey,p_meeting_id:parsed.data.meetingId,p_occurrence_key:parsed.data.occurrenceKey});
  if(startResult.error)return commandFailure(context,startResult.error); const data=startResult.data as Record<string,unknown>; const detail=await loadMeetingDetail(actor,parsed.data.meetingId,parsed.data.occurrenceKey); if(detail)await notifyMeetingCommand(actor,detail,'meetings.session.started',parsed.data.idempotencyKey,data,`Meeting started: ${detail.title}`,'The meeting session is now live.',detail.participants.map(item=>item.person.userId)); return context.json({success:true,data:detail?.currentSession??data});
});
router.post('/meetings/sessions/end', async context => {
  const actor=await requirePermission(context,'meetings.manage_own'); const parsed=zv(context,sessionEndSchema,context.get('body').args??{}); if(!parsed.ok)return parsed.response;
  if(!await commandMeeting(actor,parsed.data.meetingId,'endSession'))return context.json({success:false,message:'Meeting not found.'},404);
  const endResult=await sb.rpc('meetings_session_end_tx',{p_actor_id:actor.id,p_idempotency_key:parsed.data.idempotencyKey,p_meeting_id:parsed.data.meetingId,p_session_id:parsed.data.sessionId,p_expected_status:parsed.data.expectedStatus});
  if(endResult.error)return commandFailure(context,endResult.error); const data=endResult.data as Record<string,unknown>; const detail=await loadMeetingDetail(actor,parsed.data.meetingId); if(detail)await notifyMeetingCommand(actor,detail,'meetings.session.ended',parsed.data.idempotencyKey,data,`Meeting ended: ${detail.title}`,'The meeting session has ended.',detail.participants.map(item=>item.person.userId)); return context.json({success:true,data:detail?.sessions.find(item=>item.id===parsed.data.sessionId)??data});
});

export default router;
