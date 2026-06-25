/**
 * netlify/functions/lib/communications.ts
 *
 * Communications backbone — summary, signals, thread management, tickets.
 *
 * The three communication channels:
 *   Notifications — system-generated alerts (readonly for recipient)
 *   Messages      — human/record conversations (threads + posts)
 *   Tickets       — service/escalation cases with SLA
 *
 * Supabase Realtime is triggered by inserting into communication_signals
 * (which has no business payload — safe to expose). The browser client
 * subscribes filtered by its session channel_key and calls
 * /api/communications/summary on any signal.
 */

import { sb }          from './db';
import { emitAppEvent } from './appEvents';
import { getSignedUrl }  from './photos';
import { createAttachmentUploadUrl } from './upload';
import { userCan }       from './auth';
import { classifyAttachment, fileExtension, assertAttachmentAllowed } from './attachmentClassifier';
import type {
  MessageThread, MessageParticipant, MessagePost, MessageAttachment,
  MessageRecipient, ComplianceThread,
} from '../../../types/messaging';

// ── Messaging attachments bucket ───────────────────────────────────────────────
export const MESSAGES_BUCKET = 'message-attachments';

/**
 * Resolve a participant avatar from the CACHED signed-URL columns on app_users —
 * the same 24h URL `getProfileSignedUrl` maintains (refreshed on the user's login
 * or when <1h from expiry). Returns null when there's no fresh cached URL, so the
 * UI falls back to initials. Adds ZERO extra round-trips: the columns ride along
 * on the existing app_users join. (A signed URL per participant on every list
 * request would be far too expensive — this is the deliberate trade-off, and the
 * area the planned redesign should revisit.)
 */
function cachedProfileUrl(
  u: {
    profile_image_thumb_url?: string | null;
    profile_image_url?:       string | null;
    profile_image?:           string | null;
    signed_url?:              string | null;
    signed_url_expires_at?:   string | null;
  } | null | undefined,
): string | null {
  if (!u) return null;
  // Prefer the new public avatar (no signing, never stale, same for every viewer).
  if (u.profile_image_thumb_url) return u.profile_image_thumb_url;
  if (u.profile_image_url)       return u.profile_image_url;
  if (u.profile_image && u.profile_image !== '__removed__' && /^https?:\/\//.test(u.profile_image)) return u.profile_image;
  // Legacy fallback: a still-valid cached signed URL (private profile-photos bucket).
  if (!u.signed_url) return null;
  const exp = u.signed_url_expires_at ? new Date(u.signed_url_expires_at).getTime() : 0;
  return exp > Date.now() ? u.signed_url : null;
}

/** Two-letter initials fallback for an avatar. */
function initialsOf(name: string | null | undefined): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '?';
}

// ── Thread read-access model (participant-default) ──────────────────────────────
//
// SIOMAC messaging is participant-default. There is NO broad "admin reads every
// thread" path. A thread is readable by a user only if ONE of:
//   • participant   — they are an active participant in the thread
//   • record        — the thread is linked to a business record (PTW/incident/…)
//                     AND they hold communications.record_thread_read AND they can
//                     view that record type
//   • grant         — they have an ACTIVE compliance access grant on the thread
//                     (audited, time-boxed; see message_thread_access_grants)
// Otherwise access is denied. If the user holds communications.compliance_read we
// signal `needsCompliance` so the UI can offer the audited access flow. Even
// superadmin must obtain a grant — no role silently reads private DMs.

export type ThreadAccessVia = 'participant' | 'record' | 'grant' | null;

export interface ThreadAccessResult {
  allowed:         boolean;
  via:             ThreadAccessVia;
  needsCompliance: boolean;   // not allowed, but user may request audited access
  participantRole: string | null;   // their role IF a participant, else null
}

/**
 * Map a record-linked thread's source to the permission that governs viewing
 * that record. Conservative: unknown record types return null (no inheritance —
 * participant/grant only). Keyed on module + entity-type text so it tolerates
 * the various source_module/source_entity_type conventions in use.
 */
function recordViewPermissionKey(sourceModule: string | null, sourceEntityType: string | null): string | null {
  const s = `${sourceModule ?? ''} ${sourceEntityType ?? ''}`.toLowerCase();
  if (s.includes('permit') || s.includes('ptw'))         return 'hse.permits.view';
  if (s.includes('incident'))                            return 'hse.incidents.view';
  if (s.includes('capa') || s.includes('investigation')) return 'hse.incidents.view'; // CAPA/investigations inherit incident visibility
  if (s.includes('risk') || s.includes('jsa') || s.includes('hazard')) return 'hse.risk.view';
  return null;
}

/** True if the user has a live (non-revoked, non-expired) compliance grant on the thread. */
async function hasActiveThreadGrant(threadId: string, userId: string): Promise<boolean> {
  const nowIso = new Date().toISOString();
  const { data } = await sb
    .from('message_thread_access_grants')
    .select('id')
    .eq('thread_id', threadId)
    .eq('user_id', userId)
    .is('revoked_at', null)
    .gt('expires_at', nowIso)
    .limit(1)
    .maybeSingle<{ id: string }>();
  return !!data;
}

/**
 * Resolve whether `user` may READ `threadId`, role-agnostically. The single
 * source of truth for messaging read access — used by getThread + getThreadPosts.
 */
export async function resolveThreadReadAccess(
  threadId: string,
  user: { id: string; role?: string },
): Promise<ThreadAccessResult> {
  // 1. Participant?
  const { data: part } = await sb
    .from('message_participants')
    .select('role')
    .eq('thread_id', threadId)
    .eq('user_id', user.id)
    .is('removed_at', null)
    .maybeSingle<{ role: string }>();
  if (part) return { allowed: true, via: 'participant', needsCompliance: false, participantRole: part.role };

  // 2. Record-linked inheritance?
  const { data: thread } = await sb
    .from('message_threads')
    .select('source_module, source_entity_type')
    .eq('id', threadId)
    .maybeSingle<{ source_module: string | null; source_entity_type: string | null }>();

  const principal = { id: user.id, role: (user.role ?? 'employee') as string };

  if (thread?.source_module) {
    const recordPerm = recordViewPermissionKey(thread.source_module, thread.source_entity_type);
    if (recordPerm) {
      const [canReadRecordThreads, canViewRecord] = await Promise.all([
        userCan(principal, 'communications.record_thread_read'),
        userCan(principal, recordPerm),
      ]);
      if (canReadRecordThreads && canViewRecord) {
        return { allowed: true, via: 'record', needsCompliance: false, participantRole: null };
      }
    }
  }

  // 3. Active compliance grant?
  if (await hasActiveThreadGrant(threadId, user.id)) {
    return { allowed: true, via: 'grant', needsCompliance: false, participantRole: null };
  }

  // 4. Denied — can they request audited access?
  const needsCompliance = await userCan(principal, 'communications.compliance_read');
  return { allowed: false, via: null, needsCompliance, participantRole: null };
}

// ── Compliance access flow (audited, time-boxed) ────────────────────────────────

export const COMPLIANCE_REASONS = [
  'investigation', 'safety_incident', 'hr_complaint',
  'legal_compliance', 'security_review', 'other',
] as const;
export type ComplianceReason = typeof COMPLIANCE_REASONS[number];

export interface RequestThreadAccessInput {
  threadId:      string;
  userId:        string;            // the requester (and grantee)
  reason:        ComplianceReason;
  caseRef?:      string | null;
  notes?:        string | null;
  durationHours?: number;           // access window length; default 24h
}

export interface RequestThreadAccessResult {
  ok:        boolean;
  message?:  string;
  grantId?:  string;
  expiresAt?: string;
}

/**
 * Open an audited, time-boxed compliance grant on a thread. The caller must
 * already hold communications.compliance_read (enforced at the route). Writes
 * the grant row AND an app_events + audit_logs record (who / thread / when /
 * reason / case ref / duration). Even superadmin reads a private thread only
 * after going through this flow — the read-gate honours the grant, not the role.
 */
export async function requestThreadAccess(input: RequestThreadAccessInput): Promise<RequestThreadAccessResult> {
  try {
    // Thread must exist.
    const { data: thread } = await sb
      .from('message_threads')
      .select('id, thread_type, subject')
      .eq('id', input.threadId)
      .maybeSingle<{ id: string; thread_type: string; subject: string }>();
    if (!thread) return { ok: false, message: 'Thread not found' };

    const hours     = Math.min(Math.max(input.durationHours ?? 24, 1), 168); // 1h..7d
    const grantedAt = new Date();
    const expiresAt = new Date(grantedAt.getTime() + hours * 3_600_000).toISOString();

    const { data: grant, error } = await sb
      .from('message_thread_access_grants')
      .insert({
        thread_id:  input.threadId,
        user_id:    input.userId,
        reason:     input.reason,
        case_ref:   input.caseRef ?? null,
        notes:      input.notes ?? null,
        granted_at: grantedAt.toISOString(),
        expires_at: expiresAt,
      })
      .select('id')
      .maybeSingle<{ id: string }>();

    if (error || !grant) return { ok: false, message: error?.message ?? 'Could not create access grant' };

    // Audit trail (app_events + audit_logs). No recipient notification — compliance
    // access must not tip off an active investigation.
    void emitAppEvent({
      eventType:        'communications.thread.compliance_access_granted',
      sourceModule:     'communications',
      sourceEntityType: 'message_thread',
      sourceEntityId:   input.threadId,
      actorUserId:      input.userId,
      severity:         'warning',
      payload: {
        grantId:      grant.id,
        reason:       input.reason,
        caseRef:      input.caseRef ?? null,
        notes:        input.notes ?? null,
        durationHours: hours,
        expiresAt,
        threadType:   thread.thread_type,
        threadSubject: thread.subject,
      },
    });

    return { ok: true, grantId: grant.id, expiresAt };
  } catch (e) {
    console.error('[communications] requestThreadAccess failed:', e);
    return { ok: false, message: 'Internal error' };
  }
}

/**
 * Record that message history was exported under a compliance grant. Requires
 * communications.compliance_export (enforced at the route). Stamps the grant and
 * writes an audit row. Returns the grant ids stamped.
 */
export async function recordThreadExport(threadId: string, userId: string): Promise<{ ok: boolean; message?: string }> {
  try {
    const nowIso = new Date().toISOString();
    const { error } = await sb
      .from('message_thread_access_grants')
      .update({ exported_at: nowIso })
      .eq('thread_id', threadId)
      .eq('user_id', userId)
      .is('revoked_at', null)
      .gt('expires_at', nowIso);
    if (error) return { ok: false, message: error.message };

    void emitAppEvent({
      eventType:        'communications.thread.compliance_export',
      sourceModule:     'communications',
      sourceEntityType: 'message_thread',
      sourceEntityId:   threadId,
      actorUserId:      userId,
      severity:         'warning',
      payload: { exportedAt: nowIso },
    });
    return { ok: true };
  } catch (e) {
    console.error('[communications] recordThreadExport failed:', e);
    return { ok: false, message: 'Internal error' };
  }
}

// ── Compliance thread browser (discovery for investigators) ─────────────────────
//
// Lets a holder of communications.compliance_read FIND threads they are not a
// participant in. Returns METADATA ONLY — subject, participants, type, record
// link, last-activity timestamp. NEVER returns post bodies or previews; reading
// the actual messages still requires the audited grant flow (resolveThreadReadAccess).

/** @see ComplianceThread in types/messaging.ts (shared contract) */
export type ComplianceThreadRow = ComplianceThread;

const COMPLIANCE_CANDIDATE_CAP = 200;

/**
 * Search ALL threads (not participant-filtered) for compliance discovery. Matches
 * on subject OR participant name/email. Metadata only — no message content.
 */
export async function searchThreadsForCompliance(input: {
  actorUserId: string;
  search?:     string;
  limit?:      number;
}): Promise<{ rows: ComplianceThreadRow[] }> {
  try {
    const limit = Math.min(input.limit ?? 30, 100);
    const needle = (input.search ?? '').trim().toLowerCase();

    // Pull the most-recent candidate threads (bounded), then filter/rank in JS.
    const { data: threads } = await sb
      .from('message_threads')
      .select('id, thread_type, subject, last_post_at, source_module, source_entity_type, source_entity_id')
      .order('last_post_at', { ascending: false, nullsFirst: false })
      .limit(COMPLIANCE_CANDIDATE_CAP) as {
        data: Array<{
          id: string; thread_type: string; subject: string; last_post_at: string | null;
          source_module: string | null; source_entity_type: string | null; source_entity_id: string | null;
        }> | null;
      };
    if (!threads || threads.length === 0) return { rows: [] };

    const ids = threads.map(t => t.id);
    const { data: parts } = await sb
      .from('message_participants')
      .select('thread_id, user_id, app_users!inner(full_name, email)')
      .in('thread_id', ids)
      .is('removed_at', null) as {
        data: Array<{ thread_id: string; user_id: string; app_users: { full_name: string | null; email: string } }> | null;
      };

    const byThread = new Map<string, { names: string[]; emails: string[]; userIds: Set<string> }>();
    for (const p of parts ?? []) {
      const e = byThread.get(p.thread_id) ?? { names: [], emails: [], userIds: new Set<string>() };
      if (p.app_users.full_name) e.names.push(p.app_users.full_name);
      e.emails.push(p.app_users.email);
      e.userIds.add(p.user_id);
      byThread.set(p.thread_id, e);
    }

    const rows: ComplianceThreadRow[] = [];
    for (const t of threads) {
      const e = byThread.get(t.id) ?? { names: [], emails: [], userIds: new Set<string>() };
      if (needle) {
        const hit = t.subject.toLowerCase().includes(needle)
          || e.names.some(n => n.toLowerCase().includes(needle))
          || e.emails.some(m => m.toLowerCase().includes(needle));
        if (!hit) continue;
      }
      rows.push({
        threadId:         t.id,
        threadType:       t.thread_type as ComplianceThread['threadType'],
        subject:          t.subject,
        lastPostAt:       t.last_post_at,
        participantCount: e.userIds.size,
        participantNames: e.names,
        sourceModule:     t.source_module,
        sourceEntityType: t.source_entity_type,
        sourceEntityId:   t.source_entity_id,
        isParticipant:    e.userIds.has(input.actorUserId),
      });
      if (rows.length >= limit) break;
    }
    return { rows };
  } catch (e) {
    console.error('[communications] searchThreadsForCompliance failed:', e);
    return { rows: [] };
  }
}

// ── Record-linked thread resolver (Discussion deep-links) ───────────────────────
//
// Find-or-create the discussion thread for a business record. The caller must be
// able to VIEW that record type (checked here via the same mapping the read-gate
// uses). Opening a record's discussion joins the caller as a participant so they
// can take part — record discussions are collaborative for authorized viewers.

export interface ResolveRecordThreadInput {
  actorUserId:      string;
  actorRole?:       string;
  sourceModule:     string;
  sourceEntityType: string;
  sourceEntityId:   string;
  recordRef?:       string | null;   // human label, e.g. 'PTW-000421'
  subject?:         string | null;
}

export interface ResolveRecordThreadResult {
  ok:       boolean;
  message?: string;
  code?:    'forbidden';
  threadId?: string;
  created?:  boolean;
}

export async function resolveRecordThread(input: ResolveRecordThreadInput): Promise<ResolveRecordThreadResult> {
  try {
    // The caller must be able to view this record type (record-view inheritance).
    const recordPerm = recordViewPermissionKey(input.sourceModule, input.sourceEntityType);
    if (recordPerm) {
      const canView = await userCan({ id: input.actorUserId, role: input.actorRole }, recordPerm);
      if (!canView) return { ok: false, code: 'forbidden', message: 'You do not have access to this record.' };
    }

    const now = new Date().toISOString();

    // Find an existing record thread.
    const { data: existing } = await sb
      .from('message_threads')
      .select('id')
      .eq('thread_type', 'record')
      .eq('source_module', input.sourceModule)
      .eq('source_entity_type', input.sourceEntityType)
      .eq('source_entity_id', input.sourceEntityId)
      .limit(1)
      .maybeSingle<{ id: string }>();

    let threadId = existing?.id ?? null;
    let created  = false;

    if (!threadId) {
      const subject = (input.subject ?? '').trim()
        || `${input.recordRef ?? input.sourceEntityId} Discussion`;
      const { data: t, error } = await sb
        .from('message_threads')
        .insert({
          thread_type:        'record',
          subject,
          source_module:      input.sourceModule,
          source_entity_type: input.sourceEntityType,
          source_entity_id:   input.sourceEntityId,
          created_by:         input.actorUserId,
          last_post_at:       now,
          last_post_preview:  'Discussion started',
        })
        .select('id')
        .single<{ id: string }>();
      if (error || !t) return { ok: false, message: error?.message ?? 'Could not start discussion' };
      threadId = t.id;
      created  = true;

      await sb.from('message_posts').insert({
        thread_id:      threadId,
        author_user_id: null,
        body:           `Discussion started for ${input.recordRef ?? input.sourceEntityId}.`,
        is_system:      true,
      });

      void emitAppEvent({
        eventType:        'communications.record_thread.created',
        sourceModule:     'communications',
        sourceEntityType: 'message_thread',
        sourceEntityId:   threadId,
        actorUserId:      input.actorUserId,
        severity:         'info',
        payload: {
          recordModule: input.sourceModule,
          recordType:   input.sourceEntityType,
          recordId:     input.sourceEntityId,
          recordRef:    input.recordRef ?? null,
        },
      });
    }

    // Ensure the opener is an active participant (re-activate if previously removed).
    const { data: part } = await sb
      .from('message_participants')
      .select('id, removed_at')
      .eq('thread_id', threadId)
      .eq('user_id', input.actorUserId)
      .maybeSingle<{ id: string; removed_at: string | null }>();

    if (!part) {
      await sb.from('message_participants').insert({
        thread_id: threadId,
        user_id:   input.actorUserId,
        role:      created ? 'owner' : 'participant',
        joined_at: now,
      });
    } else if (part.removed_at) {
      await sb.from('message_participants').update({ removed_at: null }).eq('id', part.id);
    }

    void emitSignal([input.actorUserId], 'messages');
    return { ok: true, threadId: threadId ?? undefined, created };
  } catch (e) {
    console.error('[communications] resolveRecordThread failed:', e);
    return { ok: false, message: 'Internal error' };
  }
}

// ── Realtime signal emission ───────────────────────────────────────────────────

/**
 * Emit one signal per unique user so their browser invalidates badge counts.
 * Best-effort — never throws.
 */
export async function emitSignal(
  userIds: string[],
  domain:  'summary' | 'notifications' | 'messages' | 'tickets' | 'workflow' | 'handoffs',
): Promise<void> {
  if (userIds.length === 0) return;

  try {
    // Fetch channel_keys for these users
    const { data: channels } = await sb
      .from('user_realtime_channels')
      .select('user_id, channel_key')
      .in('user_id', userIds)
      .gt('expires_at', new Date().toISOString()) as {
        data: Array<{ user_id: string; channel_key: string }> | null
      };

    if (!channels || channels.length === 0) return;

    const signals = channels.map(c => ({ channel_key: c.channel_key, domain }));
    await sb.from('communication_signals').insert(signals).then(({ error }) => {
      if (error) console.warn('[communications] signal insert failed:', error.message);
    });
  } catch (e) {
    console.warn('[communications] emitSignal failed:', e);
  }
}

// ── Communications summary ─────────────────────────────────────────────────────

export interface CommsSummary {
  notificationsUnread:         number;
  notificationsTotal:          number; // active (not archived)
  notificationsActionRequired: number; // action_required & pending, active
  notificationsCritical:       number; // unread critical, active
  notificationsArchived:       number;
  messagesUnread:      number;
  ticketsOpen:         number;
  ticketsUnread:       number;
  workflowTasks:       number;
  handoffFailures:     number;
  realtimeChannelKey:  string;
}

/**
 * Aggregate badge counts for the authenticated user.
 * Called by POST /api/communications/summary.
 */
export async function getCommsSummary(userId: string, role: string): Promise<CommsSummary> {
  const nowIso = new Date().toISOString();

  // ── Everything runs in ONE parallel batch (no serial prefix) ───────────────
  // The 5 notification counts collapse into a single fetch of the active rows'
  // flag columns — counted in JS below — instead of 5 round-trips on one table.
  // `_ensureRealtimeChannel` joins the batch too, so it no longer adds a serial
  // round-trip to the badge fetch.
  const [
    activeNotifsRes, notifArchRes,
    msgRes, ticketRes, workflowRes, handoffRes, channelRes,
  ] = await Promise.allSettled([
    sb.from('notifications')
      .select('is_read, action_required, action_status, severity')
      .eq('user_id', userId)
      .is('archived_at', null)
      .or(`expires_at.is.null,expires_at.gt.${nowIso}`),

    sb.from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .not('archived_at', 'is', null),

    // Canonical unread: threads where user is active participant and at least
    // one post by another author exists after last_read_at.
    _countUnreadThreads(userId),

    sb.from('tickets')
      .select('id', { count: 'exact', head: true })
      .eq('requester_user_id', userId)
      .in('status', ['open','assigned','in_progress','waiting_requester','reopened']),

    // Workflow tasks assigned to this user or their role
    _countWorkflowTasks(userId, role),

    // Handoff failures visible to admin/manager
    ['admin','manager','superadmin'].includes(role)
      ? sb.from('handoff_outbox')
          .select('id', { count: 'exact', head: true })
          .eq('status', 'manual_review')
      : Promise.resolve({ count: 0 }),

    _ensureRealtimeChannel(userId),
  ]);

  // Derive the four active-notification counts from the single fetch.
  type NotifFlags = { is_read: boolean; action_required: boolean; action_status: string; severity: string };
  const activeNotifs: NotifFlags[] = activeNotifsRes.status === 'fulfilled'
    ? ((activeNotifsRes.value as { data?: NotifFlags[] | null }).data ?? [])
    : [];

  return {
    notificationsUnread:         activeNotifs.filter(n => !n.is_read).length,
    notificationsTotal:          activeNotifs.length,
    notificationsActionRequired: activeNotifs.filter(n => n.action_required && n.action_status === 'pending').length,
    notificationsCritical:       activeNotifs.filter(n => n.severity === 'critical' && !n.is_read).length,
    notificationsArchived:       _countFromSettled(notifArchRes),
    messagesUnread:      _countFromSettled(msgRes),
    ticketsOpen:         _countFromSettled(ticketRes),
    ticketsUnread:       0, // TODO: per-ticket unread tracking
    workflowTasks:       workflowRes.status === 'fulfilled' ? (workflowRes.value as number) : 0,
    handoffFailures:     _countFromSettled(handoffRes),
    realtimeChannelKey:  channelRes.status === 'fulfilled' ? (channelRes.value as string) : crypto.randomUUID(),
  };
}

function _countFromSettled(result: PromiseSettledResult<unknown>): number {
  if (result.status !== 'fulfilled') return 0;
  const r = result.value as { count?: number | null } | null;
  return r?.count ?? 0;
}

async function _countWorkflowTasks(userId: string, role: string): Promise<number> {
  const OPEN_TASK_STATES = ['open', 'pending', 'in_progress'];
  const [byUser, byRole] = await Promise.all([
    sb.from('workflow_tasks')
      .select('id', { count: 'exact', head: true })
      .eq('assigned_to', userId)
      .in('status', OPEN_TASK_STATES),
    sb.from('workflow_tasks')
      .select('id', { count: 'exact', head: true })
      .eq('assigned_role', role)
      .is('assigned_to', null)
      .in('status', OPEN_TASK_STATES),
  ]);
  return (byUser.count ?? 0) + (byRole.count ?? 0);
}

// ── Realtime channel management ────────────────────────────────────────────────

async function _ensureRealtimeChannel(userId: string): Promise<string> {
  const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(); // 2h

  const { data } = await sb
    .from('user_realtime_channels')
    .upsert({ user_id: userId, expires_at: expiresAt }, { onConflict: 'user_id' })
    .select('channel_key')
    .single<{ channel_key: string }>();

  return data?.channel_key ?? crypto.randomUUID();
}

// ── Canonical unread thread count ─────────────────────────────────────────────

/**
 * Count threads where the user is an active (removed_at null) participant
 * and there is at least one post by another author created after the user's
 * last_read_at (treating null as epoch) that hasn't been soft-deleted.
 *
 * We use a raw RPC / subquery via PostgREST's filter capabilities:
 * For each participant row, compare last_post_at on the thread against last_read_at.
 * This is a close-enough approximation that is fully server-side.
 */
async function _countUnreadThreads(userId: string): Promise<{ count: number | null }> {
  // A thread is unread when it has ≥1 post by ANOTHER author created after the
  // user's last_read_at. This MUST match the per-thread unreadCount computed in
  // listThreadsForUser — otherwise the badge (summary.messagesUnread) and the
  // Unread tab disagree: the old version counted last_post_at > last_read_at
  // regardless of author, so your OWN message bumped the badge while the Unread
  // tab (others-only) stayed empty.
  const epoch = new Date(0).toISOString();

  const { data: parts, error } = await sb
    .from('message_participants')
    .select('thread_id, last_read_at')
    .eq('user_id', userId)
    .is('removed_at', null) as {
      data: Array<{ thread_id: string; last_read_at: string | null }> | null;
      error: { message: string } | null;
    };
  if (error || !parts || parts.length === 0) return { count: 0 };

  const readAt    = new Map(parts.map(p => [p.thread_id, p.last_read_at ?? epoch]));
  const threadIds = parts.map(p => p.thread_id);

  const { data: posts } = await sb
    .from('message_posts')
    .select('thread_id, created_at')
    .in('thread_id', threadIds)
    .neq('author_user_id', userId)
    .is('deleted_at', null) as { data: Array<{ thread_id: string; created_at: string }> | null };

  const unreadThreads = new Set<string>();
  for (const p of posts ?? []) {
    if (p.created_at > (readAt.get(p.thread_id) ?? epoch)) unreadThreads.add(p.thread_id);
  }
  return { count: unreadThreads.size };
}

// ── Message threads ────────────────────────────────────────────────────────────

export interface CreateThreadInput {
  threadType:         'direct' | 'group' | 'record' | 'system';
  subject?:           string | null;   // optional — direct/group threads derive their name from participants
  sourceModule?:      string | null;
  sourceEntityType?:  string | null;
  sourceEntityId?:    string | null;
  createdBy:          string;
  participantUserIds: string[];
  body:               string;
  attachmentIds?:     string[];
}

export interface CreateThreadResult {
  ok:       boolean;
  message?: string;
  threadId?: string;
  postId?:   string;
}

export async function createMessageThread(input: CreateThreadInput): Promise<CreateThreadResult> {
  try {
    const now = new Date().toISOString();
    const preview = input.body.slice(0, 140);

    // Resolve + VALIDATE participants BEFORE creating anything (creator is owner).
    // A single bad FK fails the whole participant batch insert — author included —
    // so an unchecked insert leaves an orphaned, participant-less thread that
    // nobody can see. Reject unknown/inactive recipients up-front instead.
    const participantIds = [...new Set([input.createdBy, ...input.participantUserIds])];
    const { data: validUsers } = await sb
      .from('app_users')
      .select('id')
      .in('id', participantIds)
      .eq('status', 'active') as { data: Array<{ id: string }> | null };
    const validSet = new Set((validUsers ?? []).map(u => u.id));
    const missing  = participantIds.filter(id => !validSet.has(id));
    if (missing.length > 0) {
      return { ok: false, message: `Unknown or inactive recipient(s): ${missing.join(', ')}` };
    }

    const { data: thread, error: threadErr } = await sb
      .from('message_threads')
      .insert({
        thread_type:        input.threadType,
        subject:            input.subject ?? null,
        source_module:      input.sourceModule ?? null,
        source_entity_type: input.sourceEntityType ?? null,
        source_entity_id:   input.sourceEntityId ?? null,
        created_by:         input.createdBy,
        last_post_at:       now,
        last_post_preview:  preview,
      })
      .select('id')
      .single<{ id: string }>();

    if (threadErr || !thread) {
      console.error('[communications] createThread failed:', threadErr?.message);
      return { ok: false, message: 'Failed to create thread' };
    }

    const threadId = thread.id;

    // Participants — CHECK the result; a failure must not leave an orphan thread.
    const { error: partErr } = await sb.from('message_participants').insert(
      participantIds.map(uid => ({
        thread_id:  threadId,
        user_id:    uid,
        role:       uid === input.createdBy ? 'owner' : 'participant',
        joined_at:  now,
      })),
    );
    if (partErr) {
      await sb.from('message_threads').delete().eq('id', threadId);
      console.error('[communications] createThread participants failed:', partErr.message);
      return { ok: false, message: 'Failed to add participants' };
    }

    // First post is required — clean up the thread + participants if it fails.
    const attachmentCount = (input.attachmentIds ?? []).length;
    const { data: post, error: postErr } = await sb
      .from('message_posts')
      .insert({
        thread_id:        threadId,
        author_user_id:   input.createdBy,
        body:             input.body,
        attachment_count: attachmentCount,
      })
      .select('id')
      .single<{ id: string }>();

    if (postErr || !post) {
      await sb.from('message_participants').delete().eq('thread_id', threadId);
      await sb.from('message_threads').delete().eq('id', threadId);
      console.error('[communications] createThread first post failed:', postErr?.message);
      return { ok: false, message: 'Failed to create the first message' };
    }

    // Link any pre-uploaded attachments
    if (input.attachmentIds && input.attachmentIds.length > 0) {
      await sb.from('message_attachments')
        .update({ post_id: post.id })
        .in('id', input.attachmentIds);
    }

    // Fetch author display name for notification body
    const { data: actor } = await sb
      .from('app_users')
      .select('full_name, email')
      .eq('id', input.createdBy)
      .maybeSingle<{ full_name: string | null; email: string }>();
    const actorName = actor?.full_name ?? actor?.email ?? 'Someone';

    // Signal + notify other participants
    const others = participantIds.filter(uid => uid !== input.createdBy);
    if (others.length > 0) {
      void emitSignal(others, 'messages');
      void emitAppEvent({
        eventType:          'communications.thread.created',
        sourceModule:       'communications',
        sourceEntityType:   'message_thread',
        sourceEntityId:     threadId,
        actorUserId:        input.createdBy,
        severity:           'info',
        explicitRecipients: others.map(uid => ({ userId: uid, reason: 'explicit' as const })),
        notification: {
          title:       'New conversation',
          body:        input.subject
            ? `${actorName} started a conversation: ${input.subject}`
            : `${actorName} started a conversation`,
          actionRoute: 's-messages',
        },
      });
    }

    return { ok: true, threadId, postId: post.id };
  } catch (e) {
    console.error('[communications] createMessageThread failed:', e);
    return { ok: false, message: 'Internal error creating thread' };
  }
}

// ── postMessage ────────────────────────────────────────────────────────────────

export interface PostMessageInput {
  currentUserId: string;
  threadId:      string;
  body:          string;
  attachmentIds?: string[];
  replyToPostId?: string | null;
  priority?:      'normal' | 'important' | 'urgent' | 'action_required';
}

export interface PostMessageResult {
  ok:         boolean;
  postId?:    string;
  threadId?:  string;
  createdAt?: string;
  message?:   string;
}

export async function postMessage(input: PostMessageInput): Promise<PostMessageResult> {
  try {
    // Validate the user is an active participant (removed_at null)
    const { data: part } = await sb
      .from('message_participants')
      .select('role')
      .eq('thread_id', input.threadId)
      .eq('user_id', input.currentUserId)
      .is('removed_at', null)
      .maybeSingle<{ role: string }>();

    if (!part) return { ok: false, message: 'Not an active participant in this thread' };

    // Reply target (if any) must belong to the same thread.
    if (input.replyToPostId) {
      const { data: replyTarget } = await sb
        .from('message_posts')
        .select('id')
        .eq('id', input.replyToPostId)
        .eq('thread_id', input.threadId)
        .maybeSingle<{ id: string }>();
      if (!replyTarget) return { ok: false, message: 'Reply target does not belong to this thread' };
    }

    const now = new Date().toISOString();
    const attachmentCount = (input.attachmentIds ?? []).length;
    const priority = input.priority ?? 'normal';

    const { data: post, error: postErr } = await sb
      .from('message_posts')
      .insert({
        thread_id:        input.threadId,
        author_user_id:   input.currentUserId,
        body:             input.body,
        attachment_count: attachmentCount,
        post_type:        'message',
        priority,
        reply_to_post_id: input.replyToPostId ?? null,
        delivery_status:  'sent',
      })
      .select('id, created_at')
      .single<{ id: string; created_at: string }>();

    if (postErr || !post) {
      return { ok: false, message: postErr?.message ?? 'Failed to insert post' };
    }

    // Link any pre-uploaded attachments
    if (input.attachmentIds && input.attachmentIds.length > 0) {
      await sb.from('message_attachments')
        .update({ post_id: post.id })
        .in('id', input.attachmentIds);
    }

    // Update thread last_post summary. An action_required post raises the thread
    // flag so the Action-Required chip shows in the list/header.
    const preview = input.body.slice(0, 140) || (attachmentCount > 0 ? `📎 ${attachmentCount} attachment${attachmentCount > 1 ? 's' : ''}` : '');
    const threadPatch: Record<string, unknown> = { last_post_at: now, last_post_preview: preview };
    if (priority === 'action_required') threadPatch.action_required = true;
    await sb.from('message_threads').update(threadPatch).eq('id', input.threadId);

    // Fetch other active participants to notify
    const { data: othersData } = await sb
      .from('message_participants')
      .select('user_id')
      .eq('thread_id', input.threadId)
      .neq('user_id', input.currentUserId)
      .is('removed_at', null) as { data: Array<{ user_id: string }> | null };

    const others = (othersData ?? []).map(o => o.user_id);

    // Delivery receipts: one row per other participant (delivered now, unread).
    // read_at is stamped later by markThreadRead. Powers "Read by N" + delivery state.
    if (others.length > 0) {
      await sb.from('message_post_receipts').insert(
        others.map(uid => ({ post_id: post.id, user_id: uid, delivered_at: now })),
      );
    }

    if (others.length > 0) {
      // Fetch author name
      const { data: actor } = await sb
        .from('app_users')
        .select('full_name, email')
        .eq('id', input.currentUserId)
        .maybeSingle<{ full_name: string | null; email: string }>();
      const actorName = actor?.full_name ?? actor?.email ?? 'Someone';

      void emitSignal(others, 'messages');
      void emitAppEvent({
        eventType:          'communications.message.received',
        sourceModule:       'communications',
        // Point at the navigable record (the THREAD), not the post — so the
        // notification can deep-link the conversation open. Per-message dedup
        // still uses the post id below.
        sourceEntityType:   'message_thread',
        sourceEntityId:     input.threadId,
        actorUserId:        input.currentUserId,
        severity:           'info',
        dedupeKey:          `msg:${input.threadId}:${post.id}`,
        explicitRecipients: others.map(uid => ({ userId: uid, reason: 'explicit' as const })),
        notification: {
          title:       'New message',
          body:        `${actorName} sent a message…`,
          actionRoute: 's-messages',
        },
      });
    }

    return { ok: true, postId: post.id, threadId: input.threadId, createdAt: post.created_at };
  } catch (e) {
    console.error('[communications] postMessage failed:', e);
    return { ok: false, message: 'Internal error' };
  }
}

// ── Thread listing ─────────────────────────────────────────────────────────────

export type ThreadTab = 'inbox' | 'sent' | 'archived' | 'all';

export interface ListThreadsInput {
  userId: string;
  tab?:    ThreadTab;
  search?: string | null;
  limit?:  number;
  cursor?: string | null;
}

/** @see MessageThread / MessageParticipant in types/messaging.ts (shared contract) */
export type ThreadRow = MessageThread;
export type ParticipantProfile = MessageParticipant;

export interface ListThreadsResult {
  rows:       ThreadRow[];
  nextCursor: string | null;
}

export async function listThreadsForUser(input: ListThreadsInput): Promise<ListThreadsResult> {
  const { userId, tab = 'inbox', search, limit = 30, cursor } = input;
  const epoch = new Date(0).toISOString();

  try {
    // Fetch participant rows for the user with thread data
    type ParticipantWithThread = {
      thread_id:           string;
      role:                string;
      last_read_at:        string | null;
      archived_at:         string | null;
      removed_at:          string | null;
      notifications_muted: boolean | null;
      message_threads: {
        id:                 string;
        thread_type:        string;
        subject:            string;
        last_post_at:       string | null;
        last_post_preview:  string | null;
        source_module:      string | null;
        source_entity_type: string | null;
        source_entity_id:   string | null;
        created_by:         string | null;
        priority:           string | null;
        action_required:    boolean | null;
      };
    };

    let q = sb
      .from('message_participants')
      .select('thread_id, role, last_read_at, archived_at, removed_at, notifications_muted, message_threads!inner(id, thread_type, subject, last_post_at, last_post_preview, source_module, source_entity_type, source_entity_id, created_by, priority, action_required)')
      .eq('user_id', userId)
      .is('removed_at', null)
      .order('thread_id', { ascending: false })
      .limit(limit);

    // Tab filters
    if (tab === 'inbox')    q = q.is('archived_at', null);
    if (tab === 'archived') q = q.not('archived_at', 'is', null);
    // 'sent' and 'all' — no extra filter here; 'sent' is filtered post-query

    if (cursor) q = q.lt('thread_id', cursor); // rough cursor; last_post_at cursor applied below

    const { data: rows, error } = await q as {
      data: ParticipantWithThread[] | null;
      error: { message: string } | null;
    };

    if (error || !rows) return { rows: [], nextCursor: null };

    // Filter 'sent': only threads where this user authored ≥1 post
    let filtered = rows;
    if (tab === 'sent') {
      const threadIds = rows.map(r => r.thread_id);
      if (threadIds.length === 0) return { rows: [], nextCursor: null };
      const { data: sentPosts } = await sb
        .from('message_posts')
        .select('thread_id')
        .in('thread_id', threadIds)
        .eq('author_user_id', userId)
        .is('deleted_at', null) as { data: Array<{ thread_id: string }> | null };
      const sentSet = new Set((sentPosts ?? []).map(p => p.thread_id));
      filtered = rows.filter(r => sentSet.has(r.thread_id));
    }

    // Search filter
    if (search) {
      const needle = search.toLowerCase();
      filtered = filtered.filter(r =>
        r.message_threads.subject.toLowerCase().includes(needle) ||
        (r.message_threads.last_post_preview ?? '').toLowerCase().includes(needle),
      );
    }

    // Sort by last_post_at desc
    filtered.sort((a, b) => {
      const at = a.message_threads.last_post_at ?? a.message_threads.id;
      const bt = b.message_threads.last_post_at ?? b.message_threads.id;
      return bt < at ? -1 : bt > at ? 1 : 0;
    });

    // Apply last_post_at cursor pagination
    if (cursor) {
      filtered = filtered.filter(r => (r.message_threads.last_post_at ?? '') < cursor);
    }

    const page = filtered.slice(0, limit);

    // Batch-fetch all participants for threads in result set
    const threadIdSet = page.map(r => r.thread_id);
    const { data: allParticipants } = threadIdSet.length > 0
      ? await sb
          .from('message_participants')
          .select('thread_id, user_id, role, app_users!inner(full_name, email, signed_url, signed_url_expires_at, profile_image_url, profile_image_thumb_url, profile_image)')
          .in('thread_id', threadIdSet)
          .is('removed_at', null) as {
            data: Array<{
              thread_id: string;
              user_id:   string;
              role:      string;
              app_users: { full_name: string | null; email: string; signed_url: string | null; signed_url_expires_at: string | null; profile_image_url: string | null; profile_image_thumb_url: string | null; profile_image: string | null };
            }> | null;
          }
      : { data: null };

    // Group participants by thread
    const participantMap = new Map<string, ParticipantProfile[]>();
    for (const p of allParticipants ?? []) {
      const list = participantMap.get(p.thread_id) ?? [];
      list.push({
        userId:       p.user_id,
        displayName:  p.app_users.full_name,
        email:        p.app_users.email,
        role:         p.role,
        profileImage: cachedProfileUrl(p.app_users),
      });
      participantMap.set(p.thread_id, list);
    }

    // readAt per thread from the caller's own participant rows (already fetched).
    const readAtMap = new Map<string, string>();
    for (const r of page) readAtMap.set(r.thread_id, r.last_read_at ?? epoch);

    // One pass over the page's non-deleted posts computes unread (others' posts
    // after readAt), hasAttachments, failedSendCount (own failed posts) and the
    // latest post's author — replacing the previous unread-only fetch.
    const unreadCountMap = new Map<string, number>();
    const hasAttachMap   = new Map<string, boolean>();
    const failedCountMap = new Map<string, number>();
    const lastAuthorMap  = new Map<string, { author: string | null; at: string }>();
    if (threadIdSet.length > 0) {
      const { data: posts } = await sb
        .from('message_posts')
        .select('thread_id, author_user_id, attachment_count, delivery_status, created_at')
        .in('thread_id', threadIdSet)
        .is('deleted_at', null) as {
          data: Array<{ thread_id: string; author_user_id: string | null; attachment_count: number | null; delivery_status: string | null; created_at: string }> | null;
        };

      for (const p of posts ?? []) {
        const readAt = readAtMap.get(p.thread_id) ?? epoch;
        if (p.author_user_id !== userId && p.created_at > readAt) {
          unreadCountMap.set(p.thread_id, (unreadCountMap.get(p.thread_id) ?? 0) + 1);
        }
        if ((p.attachment_count ?? 0) > 0) hasAttachMap.set(p.thread_id, true);
        if (p.author_user_id === userId && p.delivery_status === 'failed') {
          failedCountMap.set(p.thread_id, (failedCountMap.get(p.thread_id) ?? 0) + 1);
        }
        const cur = lastAuthorMap.get(p.thread_id);
        if (!cur || p.created_at > cur.at) lastAuthorMap.set(p.thread_id, { author: p.author_user_id, at: p.created_at });
      }
    }

    // Pinned threads (thread-pin visible to the caller) + the caller's drafts.
    const pinnedSet = new Set<string>();
    const draftMap  = new Map<string, string>();
    if (threadIdSet.length > 0) {
      const [pinsRes, draftsRes] = await Promise.all([
        sb.from('message_pins').select('thread_id, visibility, pinned_by').eq('pin_type', 'thread').is('unpinned_at', null).in('thread_id', threadIdSet),
        sb.from('message_thread_drafts').select('thread_id, body').eq('user_id', userId).in('thread_id', threadIdSet),
      ]);
      for (const p of ((pinsRes as { data: Array<{ thread_id: string; visibility: string; pinned_by: string }> | null }).data) ?? []) {
        if (p.visibility === 'thread' || p.pinned_by === userId) pinnedSet.add(p.thread_id);
      }
      for (const d of ((draftsRes as { data: Array<{ thread_id: string; body: string | null }> | null }).data) ?? []) {
        if (d.body && d.body.trim()) draftMap.set(d.thread_id, d.body);
      }
    }

    // Name lookup for last-post author (participants already carry names).
    const nameMap = new Map<string, string | null>();
    for (const list of participantMap.values()) {
      for (const pp of list) nameMap.set(pp.userId, pp.displayName ?? pp.email);
    }

    const resultRows: ThreadRow[] = page.map(r => {
      const mt           = r.message_threads;
      const unread       = unreadCountMap.get(r.thread_id) ?? 0;
      const participants = participantMap.get(r.thread_id) ?? [];
      const draftBody    = draftMap.get(r.thread_id) ?? null;
      const failed       = failedCountMap.get(r.thread_id) ?? 0;
      const lastAuthorId = lastAuthorMap.get(r.thread_id)?.author ?? null;
      return {
        id:               r.thread_id,
        threadType:       mt.thread_type as MessageThread['threadType'],
        subject:          mt.subject,
        sourceModule:     mt.source_module,
        sourceEntityType: mt.source_entity_type,
        sourceEntityId:   mt.source_entity_id,
        createdBy:        mt.created_by,
        createdAt:        mt.last_post_at ?? '',
        lastPostAt:       mt.last_post_at,
        lastPostPreview:  mt.last_post_preview,
        lastPostBy:       lastAuthorId,
        unreadCount:      unread,
        participantCount: participants.length,
        participants,
        isArchived:       r.archived_at != null,
        myRole:           r.role,
        // ── Rich Add-On fields ──
        lastPostAuthorName: lastAuthorId ? (nameMap.get(lastAuthorId) ?? null) : null,
        isUnread:           unread > 0,
        isPinned:           pinnedSet.has(r.thread_id),
        isMuted:            r.notifications_muted === true,
        hasDraft:           draftBody != null,
        draftPreview:       draftBody,
        failedSendCount:    failed,
        hasAttachments:     hasAttachMap.get(r.thread_id) ?? false,
        actionRequired:     mt.action_required === true,
        priority:           (mt.priority ?? 'normal') as MessageThread['priority'],
        archivedAt:         r.archived_at,
      };
    });

    const lastRow    = page[page.length - 1];
    const nextCursor = page.length === limit && lastRow
      ? (lastRow.message_threads.last_post_at ?? null)
      : null;

    return { rows: resultRows, nextCursor };
  } catch (e) {
    console.error('[communications] listThreadsForUser failed:', e);
    return { rows: [], nextCursor: null };
  }
}

// ── getThread ──────────────────────────────────────────────────────────────────

export interface GetThreadResult {
  ok:           boolean;
  message?:     string;
  code?:        'compliance_required' | 'forbidden';
  thread?:      MessageThread;
  participants?: ParticipantProfile[];
  myRole?:       string;
  myLastReadAt?: string | null;
  myArchivedAt?: string | null;
}

export async function getThread(threadId: string, userId: string, userRole?: string): Promise<GetThreadResult> {
  try {
    // Participant-default read-gate (participant / record-inherited / compliance grant).
    const access = await resolveThreadReadAccess(threadId, { id: userId, role: userRole });
    if (!access.allowed) {
      return access.needsCompliance
        ? { ok: false, code: 'compliance_required', message: 'Compliance access required to view this thread' }
        : { ok: false, code: 'forbidden', message: 'Not a participant in this thread' };
    }

    // Their own participant row (for myRole / read state) — null when access is via record/grant.
    const { data: part } = await sb
      .from('message_participants')
      .select('role, last_read_at, archived_at')
      .eq('thread_id', threadId)
      .eq('user_id', userId)
      .is('removed_at', null)
      .maybeSingle<{ role: string; last_read_at: string | null; archived_at: string | null }>();

    const { data: thread, error } = await sb
      .from('message_threads')
      .select('id, thread_type, subject, last_post_at, last_post_preview, source_module, source_entity_type, source_entity_id, created_by, created_at')
      .eq('id', threadId)
      .maybeSingle<{
        id:                 string;
        thread_type:        string;
        subject:            string;
        last_post_at:       string | null;
        last_post_preview:  string | null;
        source_module:      string | null;
        source_entity_type: string | null;
        source_entity_id:   string | null;
        created_by:         string | null;
        created_at:         string;
      }>();

    if (error || !thread) return { ok: false, message: 'Thread not found' };

    const { data: participants } = await sb
      .from('message_participants')
      .select('user_id, role, app_users!inner(full_name, email, signed_url, signed_url_expires_at, profile_image_url, profile_image_thumb_url, profile_image)')
      .eq('thread_id', threadId)
      .is('removed_at', null) as {
        data: Array<{
          user_id:   string;
          role:      string;
          app_users: { full_name: string | null; email: string; signed_url: string | null; signed_url_expires_at: string | null; profile_image_url: string | null; profile_image_thumb_url: string | null; profile_image: string | null };
        }> | null;
      };

    const profiledParticipants: ParticipantProfile[] = (participants ?? []).map(p => ({
      userId:       p.user_id,
      displayName:  p.app_users.full_name,
      email:        p.app_users.email,
      role:         p.role,
      profileImage: cachedProfileUrl(p.app_users),
    }));

    return {
      ok: true,
      thread: {
        id:               thread.id,
        threadType:       thread.thread_type as MessageThread['threadType'],
        subject:          thread.subject,
        sourceModule:     thread.source_module,
        sourceEntityType: thread.source_entity_type,
        sourceEntityId:   thread.source_entity_id,
        createdBy:        thread.created_by,
        createdAt:        thread.created_at,
        lastPostAt:       thread.last_post_at,
        lastPostPreview:  thread.last_post_preview,
        lastPostBy:       null,
        unreadCount:      0,
        participantCount: profiledParticipants.length,
        participants:     profiledParticipants,
        isArchived:       part?.archived_at != null,
        myRole:           part?.role ?? 'viewer',
      },
      participants:  profiledParticipants,
      myRole:        part?.role,
      myLastReadAt:  part?.last_read_at,
      myArchivedAt:  part?.archived_at,
    };
  } catch (e) {
    console.error('[communications] getThread failed:', e);
    return { ok: false, message: 'Internal error' };
  }
}

// ── getThreadPosts ─────────────────────────────────────────────────────────────

/** @see MessagePost / MessageAttachment in types/messaging.ts (shared contract) */
export type PostRow = MessagePost;
export type AttachmentRow = MessageAttachment;

export interface GetThreadPostsResult {
  ok:         boolean;
  message?:   string;
  code?:      'compliance_required' | 'forbidden';
  posts?:     PostRow[];
  nextCursor?: string | null;
}

export async function getThreadPosts(
  threadId: string,
  userId:   string,
  opts: { limit?: number; cursor?: string | null },
  userRole?: string,
): Promise<GetThreadPostsResult> {
  try {
    // Participant-default read-gate (participant / record-inherited / compliance grant).
    const access = await resolveThreadReadAccess(threadId, { id: userId, role: userRole });
    if (!access.allowed) {
      return access.needsCompliance
        ? { ok: false, code: 'compliance_required', message: 'Compliance access required to view this thread' }
        : { ok: false, code: 'forbidden', message: 'Not a participant in this thread' };
    }

    const limit = opts.limit ?? 50;

    type RawPost = {
      id:               string;
      thread_id:        string;
      author_user_id:   string | null;
      body:             string | null;
      is_system:        boolean;
      attachment_count: number;
      edited_at:        string | null;
      deleted_at:       string | null;
      created_at:       string;
      post_type:            string | null;
      system_event_type:    string | null;
      system_event_payload: Record<string, unknown> | null;
      priority:             string | null;
      reply_to_post_id:     string | null;
      delivery_status:      string | null;
      app_users: {
        full_name: string | null; email: string; role: string | null;
        profile_image_url: string | null; profile_image_thumb_url: string | null;
        profile_image: string | null; profile_image_version: number | null;
      } | null;
    };

    let q = sb
      .from('message_posts')
      .select('id, thread_id, author_user_id, body, is_system, attachment_count, edited_at, deleted_at, created_at, post_type, system_event_type, system_event_payload, priority, reply_to_post_id, delivery_status, app_users!author_user_id(full_name, email, role, profile_image_url, profile_image_thumb_url, profile_image, profile_image_version)')
      .eq('thread_id', threadId)
      .order('created_at', { ascending: true })
      .limit(limit);

    if (opts.cursor) q = q.gt('created_at', opts.cursor);

    const { data: posts, error } = await q as { data: RawPost[] | null; error: { message: string } | null };
    if (error) return { ok: false, message: error.message };

    const postIds = (posts ?? []).map(p => p.id);

    // Fetch attachments for all posts in one query
    const { data: attachments } = postIds.length > 0
      ? await sb
          .from('message_attachments')
          .select('id, post_id, file_name, file_path, content_type, size_bytes')
          .in('post_id', postIds) as {
            data: Array<{
              id: string; post_id: string; file_name: string;
              file_path: string; content_type: string | null; size_bytes: number | null;
            }> | null;
          }
      : { data: null };

    // Compute signed URLs for all attachments (best-effort, parallel)
    const attachList = attachments ?? [];
    const signedUrls = await Promise.all(
      attachList.map(a =>
        getSignedUrl(MESSAGES_BUCKET, a.file_path).catch(() => ''),
      ),
    );

    const attachMap = new Map<string, AttachmentRow[]>();
    for (let i = 0; i < attachList.length; i++) {
      const a   = attachList[i]!;
      const url = signedUrls[i] ?? null;
      const list = attachMap.get(a.post_id) ?? [];
      list.push({ id: a.id, fileName: a.file_name, filePath: a.file_path, contentType: a.content_type, sizeBytes: a.size_bytes, url: url || null });
      attachMap.set(a.post_id, list);
    }

    // Rich-context batches: reply-target previews, read-by counts (receipts),
    // and which posts are pinned.
    const replyIds = [...new Set((posts ?? []).map(p => p.reply_to_post_id).filter((x): x is string => !!x))];
    const replyMap = new Map<string, { id: string; authorName: string | null; preview: string }>();
    if (replyIds.length > 0) {
      const { data: rp } = await sb
        .from('message_posts')
        .select('id, body, app_users!author_user_id(full_name, email)')
        .in('id', replyIds) as { data: Array<{ id: string; body: string | null; app_users: { full_name: string | null; email: string } | null }> | null };
      for (const r of rp ?? []) replyMap.set(r.id, { id: r.id, authorName: r.app_users?.full_name ?? null, preview: (r.body ?? '').slice(0, 120) });
    }

    const readCountMap = new Map<string, number>();
    const pinnedPosts  = new Set<string>();
    if (postIds.length > 0) {
      const [receiptsRes, pinsRes] = await Promise.all([
        sb.from('message_post_receipts').select('post_id, read_at').in('post_id', postIds),
        sb.from('message_pins').select('post_id').eq('pin_type', 'post').is('unpinned_at', null).in('post_id', postIds),
      ]);
      for (const r of ((receiptsRes as { data: Array<{ post_id: string; read_at: string | null }> | null }).data) ?? []) {
        if (r.read_at) readCountMap.set(r.post_id, (readCountMap.get(r.post_id) ?? 0) + 1);
      }
      for (const pin of ((pinsRes as { data: Array<{ post_id: string | null }> | null }).data) ?? []) {
        if (pin.post_id) pinnedPosts.add(pin.post_id);
      }
    }

    const resultPosts: PostRow[] = (posts ?? []).map(p => {
      const au = p.app_users;
      const authorName = au?.full_name ?? null;
      return {
        id:              p.id,
        threadId:        p.thread_id,
        authorUserId:    p.author_user_id,
        authorName,
        authorEmail:     au?.email ?? null,
        body:            p.body,
        isSystem:        p.is_system,
        attachmentCount: p.attachment_count,
        editedAt:        p.edited_at,
        deletedAt:       p.deleted_at,
        createdAt:       p.created_at,
        attachments:     attachMap.get(p.id) ?? [],
        // ── Rich Add-On ──
        postType:           (p.post_type ?? 'message') as PostRow['postType'],
        systemEventType:    (p.system_event_type ?? null) as PostRow['systemEventType'],
        systemEventPayload: p.system_event_payload ?? {},
        authorRoleKey:      au?.role ?? null,
        authorProfileImage: cachedProfileUrl(au),
        authorInitials:     initialsOf(authorName ?? au?.email),
        authorProfileImageVersion: au?.profile_image_version ?? 1,
        priority:           (p.priority ?? 'normal') as PostRow['priority'],
        isPinned:           pinnedPosts.has(p.id),
        replyToPost:        p.reply_to_post_id ? (replyMap.get(p.reply_to_post_id) ?? null) : null,
        deliveryStatus:     (p.delivery_status ?? undefined) as PostRow['deliveryStatus'],
        readByCount:        readCountMap.get(p.id) ?? 0,
      };
    });

    const lastPost = resultPosts[resultPosts.length - 1];
    const nextCursor = resultPosts.length === limit && lastPost ? lastPost.createdAt : null;

    return { ok: true, posts: resultPosts, nextCursor };
  } catch (e) {
    console.error('[communications] getThreadPosts failed:', e);
    return { ok: false, message: 'Internal error' };
  }
}

// ── Message attachment helpers ────────────────────────────────────────────────

export interface MessageAttachmentUploadUrlResult {
  uploadUrl: string;
  token:     string;
  path:      string;
  bucket:    string;
  ext:       string;
}

/**
 * Generate a presigned upload URL for the message-attachments bucket.
 * The client PUTs the raw file binary to `uploadUrl`, then calls
 * `createMessageAttachmentRecord` to persist the metadata row.
 */
export async function createMessageAttachmentUploadUrl(
  fileName: string,
  mimeType: string,
): Promise<MessageAttachmentUploadUrlResult> {
  const result = await createAttachmentUploadUrl(MESSAGES_BUCKET, fileName, mimeType);
  return { ...result, bucket: MESSAGES_BUCKET };
}

export interface CreateMessageAttachmentInput {
  fileName:    string;
  filePath:    string;
  contentType: string | null;
  sizeBytes:   number | null;
  uploadedBy:  string;
}

/**
 * Insert a `message_attachments` row with `post_id` NULL.
 * The `postMessage` / `createMessageThread` lib functions link it to the post
 * via UPDATE ... WHERE id IN (...attachmentIds).
 */
export async function createMessageAttachmentRecord(
  input: CreateMessageAttachmentInput,
): Promise<{ ok: boolean; id?: string; message?: string }> {
  // Policy gate (blocked executables / size) + classification for rich rendering.
  try {
    assertAttachmentAllowed(input.fileName, input.sizeBytes);
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : 'File not permitted' };
  }
  const attachmentType = classifyAttachment(input.fileName, input.contentType);
  const ext            = fileExtension(input.fileName);

  const { data, error } = await sb.from('message_attachments').insert({
    file_name:    input.fileName,
    file_path:    input.filePath,
    content_type: input.contentType,
    size_bytes:   input.sizeBytes,
    uploaded_by:  input.uploadedBy,
    attachment_type: attachmentType,
    file_extension:  ext || null,
    upload_status:   'uploaded',
    // post_id intentionally NULL — linked on send
  }).select('id').single<{ id: string }>();

  if (error || !data) {
    console.error('[communications] createMessageAttachmentRecord failed:', error?.message);
    return { ok: false, message: error?.message ?? 'Failed to create attachment record' };
  }
  return { ok: true, id: data.id };
}

// ── Signed attachment URL by purpose (thumbnail | preview | download) ───────────
// Permission-checked: an attachment linked to a post is readable only by someone
// with read access to its thread; an unlinked (draft) attachment is readable only
// by its uploader.

export async function getAttachmentUrl(
  attachmentId: string,
  userId:       string,
  purpose:      'thumbnail' | 'preview' | 'download',
  userRole?:    string,
): Promise<{ ok: boolean; message?: string; code?: 'forbidden' | 'compliance_required'; url?: string }> {
  try {
    const { data: att } = await sb
      .from('message_attachments')
      .select('id, post_id, uploaded_by, file_path, thumbnail_path, preview_path')
      .eq('id', attachmentId)
      .maybeSingle<{ id: string; post_id: string | null; uploaded_by: string | null; file_path: string; thumbnail_path: string | null; preview_path: string | null }>();
    if (!att) return { ok: false, message: 'Attachment not found' };

    if (att.post_id) {
      const { data: post } = await sb.from('message_posts').select('thread_id').eq('id', att.post_id).maybeSingle<{ thread_id: string }>();
      if (!post) return { ok: false, message: 'Attachment not found' };
      const access = await resolveThreadReadAccess(post.thread_id, { id: userId, role: userRole });
      if (!access.allowed) {
        return access.needsCompliance
          ? { ok: false, code: 'compliance_required', message: 'Compliance access required' }
          : { ok: false, code: 'forbidden', message: 'No access to this attachment' };
      }
    } else if (att.uploaded_by !== userId) {
      // Draft attachment, not yet posted — only the uploader may fetch it.
      return { ok: false, code: 'forbidden', message: 'No access to this attachment' };
    }

    const path = purpose === 'thumbnail' ? (att.thumbnail_path ?? att.file_path)
               : purpose === 'preview'   ? (att.preview_path   ?? att.file_path)
               :                            att.file_path;
    const url = await getSignedUrl(MESSAGES_BUCKET, path).catch(() => '');
    return { ok: true, url: url || undefined };
  } catch (e) {
    console.error('[communications] getAttachmentUrl failed:', e);
    return { ok: false, message: 'Internal error' };
  }
}

// ── markThreadRead ─────────────────────────────────────────────────────────────

export async function markThreadRead(threadId: string, userId: string): Promise<void> {
  const nowIso = new Date().toISOString();
  await sb.from('message_participants')
    .update({ last_read_at: nowIso })
    .eq('thread_id', threadId)
    .eq('user_id', userId)
    .is('removed_at', null);

  // Stamp read receipts for this user's delivered-but-unread posts in the thread
  // (powers each post's "Read by N"). Best-effort.
  const { data: tp } = await sb.from('message_posts').select('id').eq('thread_id', threadId) as { data: Array<{ id: string }> | null };
  const ids = (tp ?? []).map(r => r.id);
  if (ids.length > 0) {
    await sb.from('message_post_receipts').update({ read_at: nowIso }).eq('user_id', userId).is('read_at', null).in('post_id', ids);
  }

  void emitSignal([userId], 'summary');
}

// ── archiveThread ──────────────────────────────────────────────────────────────

export async function archiveThread(threadId: string, userId: string, archived: boolean): Promise<{ ok: boolean; message?: string }> {
  const { error } = await sb.from('message_participants')
    .update({ archived_at: archived ? new Date().toISOString() : null })
    .eq('thread_id', threadId)
    .eq('user_id', userId)
    .is('removed_at', null);

  if (error) return { ok: false, message: error.message };
  return { ok: true };
}

/** Mute / unmute thread notifications for the caller (participant-scoped). */
export async function muteThread(threadId: string, userId: string, muted: boolean): Promise<{ ok: boolean; message?: string }> {
  const { error } = await sb.from('message_participants')
    .update({ notifications_muted: muted, muted_until: null })
    .eq('thread_id', threadId)
    .eq('user_id', userId)
    .is('removed_at', null);
  if (error) return { ok: false, message: error.message };
  void emitSignal([userId], 'summary');
  return { ok: true };
}

// ── addThreadParticipants ──────────────────────────────────────────────────────

export async function addThreadParticipants(
  threadId:     string,
  actorUserId:  string,
  userIds:      string[],
  actorRole?:   string,
): Promise<{ ok: boolean; message?: string }> {
  try {
    // Actor must be owner or admin
    const { data: actorPart } = await sb
      .from('message_participants')
      .select('role')
      .eq('thread_id', threadId)
      .eq('user_id', actorUserId)
      .is('removed_at', null)
      .maybeSingle<{ role: string }>();

    // Owner of the thread, or a messaging admin (communications.admin) — no blanket role bypass.
    const canManage = actorPart?.role === 'owner'
      || await userCan({ id: actorUserId, role: actorRole }, 'communications.admin');
    if (!canManage) {
      return { ok: false, message: 'Only the thread owner or a messaging admin can add participants' };
    }

    // Deduplicate and skip existing active participants
    const { data: existing } = await sb
      .from('message_participants')
      .select('user_id')
      .eq('thread_id', threadId)
      .in('user_id', userIds)
      .is('removed_at', null) as { data: Array<{ user_id: string }> | null };

    const existingSet = new Set((existing ?? []).map(e => e.user_id));
    const toAdd = [...new Set(userIds)].filter(uid => !existingSet.has(uid));
    if (toAdd.length === 0) return { ok: true };

    const now = new Date().toISOString();
    await sb.from('message_participants').insert(
      toAdd.map(uid => ({ thread_id: threadId, user_id: uid, role: 'participant', joined_at: now })),
    );

    // Fetch actor name for system post
    const { data: actor } = await sb
      .from('app_users')
      .select('full_name, email')
      .eq('id', actorUserId)
      .maybeSingle<{ full_name: string | null; email: string }>();
    const actorName = actor?.full_name ?? actor?.email ?? 'Someone';

    // Fetch added user names
    const { data: addedUsers } = await sb
      .from('app_users')
      .select('id, full_name, email')
      .in('id', toAdd) as { data: Array<{ id: string; full_name: string | null; email: string }> | null };
    const addedNames = (addedUsers ?? []).map(u => u.full_name ?? u.email).join(', ');

    // System-event post — rendered as a centered timeline announcement (ThreadEvent),
    // not a message bubble. body kept as a plain-text fallback for legacy renderers.
    await sb.from('message_posts').insert({
      thread_id:            threadId,
      author_user_id:       null,
      body:                 `${actorName} added ${addedNames} to the conversation.`,
      is_system:            true,
      post_type:            'system_event',
      system_event_type:    'participant_added',
      system_event_payload: { actorUserId, actorName, addedUserIds: toAdd, addedUserName: addedNames },
    });

    // Signal all current participants so everyone's timeline + notify added ones.
    void emitSignal([actorUserId, ...toAdd], 'messages');
    void emitAppEvent({
      eventType:          'communications.thread.created',
      sourceModule:       'communications',
      sourceEntityType:   'message_thread',
      sourceEntityId:     threadId,
      actorUserId:        actorUserId,
      severity:           'info',
      explicitRecipients: toAdd.map(uid => ({ userId: uid, reason: 'explicit' as const })),
      notification: {
        title:       'Added to conversation',
        body:        `${actorName} added you to a conversation.`,
        actionRoute: 's-messages',
      },
    });

    return { ok: true };
  } catch (e) {
    console.error('[communications] addThreadParticipants failed:', e);
    return { ok: false, message: 'Internal error' };
  }
}

// ── removeThreadParticipant ────────────────────────────────────────────────────

export async function removeThreadParticipant(
  threadId:    string,
  actorUserId: string,
  userId:      string,
  actorRole?:  string,
): Promise<{ ok: boolean; message?: string }> {
  try {
    const { data: actorPart } = await sb
      .from('message_participants')
      .select('role')
      .eq('thread_id', threadId)
      .eq('user_id', actorUserId)
      .is('removed_at', null)
      .maybeSingle<{ role: string }>();

    const canManage = actorPart?.role === 'owner'
      || await userCan({ id: actorUserId, role: actorRole }, 'communications.admin');
    if (!canManage) {
      return { ok: false, message: 'Only the thread owner or a messaging admin can remove participants' };
    }

    await sb.from('message_participants')
      .update({ removed_at: new Date().toISOString() })
      .eq('thread_id', threadId)
      .eq('user_id', userId);

    // Fetch names for system post
    const [actorRes, removedRes] = await Promise.all([
      sb.from('app_users').select('full_name, email').eq('id', actorUserId).maybeSingle<{ full_name: string | null; email: string }>(),
      sb.from('app_users').select('full_name, email').eq('id', userId).maybeSingle<{ full_name: string | null; email: string }>(),
    ]);
    const actorName   = actorRes.data?.full_name   ?? actorRes.data?.email   ?? 'Someone';
    const removedName = removedRes.data?.full_name ?? removedRes.data?.email ?? 'a member';

    // Self-removal reads as "left"; removing someone else reads as "removed".
    const left = actorUserId === userId;
    await sb.from('message_posts').insert({
      thread_id:            threadId,
      author_user_id:       null,
      body:                 left ? `${removedName} left the conversation.` : `${actorName} removed ${removedName} from the conversation.`,
      is_system:            true,
      post_type:            'system_event',
      system_event_type:    left ? 'participant_left' : 'participant_removed',
      system_event_payload: left
        ? { userId, userName: removedName }
        : { actorUserId, actorName, removedUserId: userId, removedUserName: removedName },
    });

    // Refresh everyone still in the thread.
    void emitSignal(await (async () => {
      const { data } = await sb.from('message_participants').select('user_id').eq('thread_id', threadId).is('removed_at', null) as { data: Array<{ user_id: string }> | null };
      return (data ?? []).map(r => r.user_id);
    })(), 'messages');

    return { ok: true };
  } catch (e) {
    console.error('[communications] removeThreadParticipant failed:', e);
    return { ok: false, message: 'Internal error' };
  }
}

// ── searchMessages ─────────────────────────────────────────────────────────────

export interface SearchMessageResult {
  threadId:      string;
  threadSubject: string;
  postId:        string;
  postPreview:   string;
  authorName:    string | null;
  createdAt:     string;
}

export async function searchMessages(userId: string, query: string, limit = 20): Promise<SearchMessageResult[]> {
  try {
    // Get thread ids the user participates in (active)
    const { data: parts } = await sb
      .from('message_participants')
      .select('thread_id')
      .eq('user_id', userId)
      .is('removed_at', null) as { data: Array<{ thread_id: string }> | null };

    const threadIds = (parts ?? []).map(p => p.thread_id);
    if (threadIds.length === 0) return [];

    type PostWithAuthorAndThread = {
      id:             string;
      thread_id:      string;
      body:           string;
      created_at:     string;
      app_users:      { full_name: string | null; email: string } | null;
      message_threads: { subject: string } | null;
    };

    const { data: posts } = await sb
      .from('message_posts')
      .select('id, thread_id, body, created_at, app_users!author_user_id(full_name, email), message_threads(subject)')
      .in('thread_id', threadIds)
      .is('deleted_at', null)
      .ilike('body', `%${query}%`)
      .order('created_at', { ascending: false })
      .limit(limit) as { data: PostWithAuthorAndThread[] | null };

    return (posts ?? []).map(p => ({
      threadId:      p.thread_id,
      threadSubject: p.message_threads?.subject ?? '',
      postId:        p.id,
      postPreview:   p.body.slice(0, 200),
      authorName:    p.app_users?.full_name ?? p.app_users?.email ?? null,
      createdAt:     p.created_at,
    }));
  } catch (e) {
    console.error('[communications] searchMessages failed:', e);
    return [];
  }
}

// ── getMessageRecipients ───────────────────────────────────────────────────────

/** @see MessageRecipient in types/messaging.ts (shared contract) */
export type RecipientProfile = MessageRecipient;

export async function getMessageRecipients(userId: string, query?: string | null): Promise<RecipientProfile[]> {
  try {
    type UserRow = { id: string; full_name: string | null; email: string; department_id: string | null; role: string; signed_url: string | null; signed_url_expires_at: string | null; profile_image_url: string | null; profile_image_thumb_url: string | null; profile_image: string | null };

    // Build query without complex cast — cast only the awaited result.
    const baseQ = sb
      .from('app_users')
      .select('id, full_name, email, department_id, role, signed_url, signed_url_expires_at, profile_image_url, profile_image_thumb_url, profile_image')
      .eq('status', 'active')
      .neq('id', userId)
      .order('full_name', { ascending: true })
      .limit(50);

    const resultQ = query
      ? baseQ.or(`full_name.ilike.%${query}%,email.ilike.%${query}%`)
      : baseQ;

    const { data, error } = await resultQ as { data: UserRow[] | null; error: { message: string } | null };
    if (error || !data) return [];

    return data.map(u => ({
      userId:       u.id,
      displayName:  u.full_name,
      email:        u.email,
      department:   u.department_id,
      role:         u.role,
      profileImage: cachedProfileUrl(u),
    }));
  } catch (e) {
    console.error('[communications] getMessageRecipients failed:', e);
    return [];
  }
}

// ── Tickets ────────────────────────────────────────────────────────────────────

export interface CreateTicketInput {
  category:           string;
  priority?:          'low' | 'medium' | 'high' | 'critical';
  subject:            string;
  description:        string;
  requesterUserId:    string;
  sourceModule?:      string | null;
  sourceEntityType?:  string | null;
  sourceEntityId?:    string | null;
}

export interface CreateTicketResult {
  ok:           boolean;
  ticketId?:    string;
  ticketNumber?: string;
}

export async function createTicket(input: CreateTicketInput): Promise<CreateTicketResult> {
  try {
    const year = new Date().getFullYear();
    const { data: counter } = await sb.rpc('increment_ref_counter', { p_prefix: 'TKT', p_year: year });
    const ticketNumber = `TKT-${year}-${String(counter ?? Date.now()).padStart(4, '0')}`;

    // SLA: critical = 4h, high = 8h, medium = 24h, low = 72h
    const slaHours = { critical: 4, high: 8, medium: 24, low: 72 }[input.priority ?? 'medium'];
    const slaDueAt = new Date(Date.now() + slaHours * 3600_000).toISOString();

    const { data: ticket, error } = await sb
      .from('tickets')
      .insert({
        ticket_number:      ticketNumber,
        category:           input.category,
        priority:           input.priority ?? 'medium',
        subject:            input.subject ?? null,
        description:        input.description,
        requester_user_id:  input.requesterUserId,
        source_module:      input.sourceModule ?? null,
        source_entity_type: input.sourceEntityType ?? null,
        source_entity_id:   input.sourceEntityId ?? null,
        sla_due_at:         slaDueAt,
        status:             'open',
      })
      .select('id')
      .single<{ id: string }>();

    if (error || !ticket) {
      console.error('[communications] createTicket failed:', error?.message);
      return { ok: false };
    }

    // Notify support queue (admin/manager)
    void emitSignal([], 'tickets'); // TODO: resolve admin user ids

    return { ok: true, ticketId: ticket.id, ticketNumber };
  } catch (e) {
    console.error('[communications] createTicket failed:', e);
    return { ok: false };
  }
}
