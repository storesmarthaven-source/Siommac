/**
 * netlify/functions/lib/appEvents.ts
 *
 * Central event emitter for the ERP backbone.
 *
 * Every significant mutation across every module calls emitAppEvent().
 * It:
 *   1. Inserts one immutable app_events row (deduped by dedupe_key)
 *   2. Resolves recipients via recipientResolver
 *   3. Persists notifications for each recipient (via lib/notify.ts)
 *   4. Emits communication_signals for Realtime badge refresh
 *   5. Writes an audit_logs row
 *
 * NEVER throws. Event emission must not break the business action that
 * triggered it. Returns { ok, eventId } — callers may log failures but
 * must not block on them.
 *
 * See ARCHITECTURE.md §Event Core and docs/COMMUNICATIONS_BACKBONE.md
 */

import { sb }                 from './db';
import { resolveRecipients }  from './recipientResolver';
import type { ExplicitRecipient } from './recipientResolver';
import { notify }             from './notify';
import { emitSignal }         from './communications';
import { getReqContext }      from './reqContext';

export type EventSeverity = 'info' | 'success' | 'warning' | 'high' | 'critical';

export interface EmitAppEventInput {
  /** Dotted event type, e.g. 'hse.incident.submitted' */
  eventType: string;
  /** Owning module: 'hse'|'hr'|'finance'|'operations'|'payroll'|'platform' */
  sourceModule: string;
  /** Entity kind, e.g. 'incident'|'capa'|'workflow'|'ticket'|'message' */
  sourceEntityType: string;
  /** The record ref/id, e.g. 'INC-2026-0001' */
  sourceEntityId: string;
  /** Who triggered it (app_users.id text). null = system event. */
  actorUserId?: string | null;
  siteId?: string | null;
  departmentId?: string | null;
  severity?: EventSeverity;
  payload?: Record<string, unknown>;
  /**
   * When set, a second emit with the same key is a no-op (idempotency).
   * Use format: '<eventType>:<entityId>' e.g. 'hse.incident.submitted:INC-2026-0001'
   */
  dedupeKey?: string | null;

  /** Owner/assignee/watcher etc. the calling route already knows. */
  explicitRecipients?: ExplicitRecipient[];

  /**
   * Notification rendered for each resolved recipient.
   * Omit for silent audit-style events (no in-app notification).
   */
  notification?: {
    title: string;
    body?: string;
    /** Route the notification opens, e.g. 'hse/incidents/INC-2026-0001' */
    actionRoute?: string;
    type?: string;
    /** Marks the notification as actionable work (drives action_status). */
    actionRequired?: boolean;
    /** When the action is due (for reminders / escalation). */
    dueAt?: string | null;
  };
}

export interface EmitAppEventResult {
  ok: boolean;
  eventId?: string;
  deduped?: boolean;
  recipientCount?: number;
}

/**
 * Write an explicit audit_logs row for platform-level mutations (tickets, account
 * access actions, org-config changes).
 *
 * Unlike the best-effort step-6 write inside emitAppEvent, this function THROWS on
 * failure so callers can roll back and return an honest error — audit write failure
 * must never be swallowed and returned as success.
 *
 * NOTE: No platform-level audit_logs helper existed before this slice. This function
 * was introduced as the canonical explicit audit primitive; emitAppEvent's internal
 * step-6 write is best-effort and DOES NOT replace it.
 *
 * Parameters:
 *   action      — dotted action string, e.g. 'ticket.created', 'account_access.suspended'
 *   tableName   — entity kind / table, e.g. 'support_ticket', 'app_user'
 *   recordId    — the business record identifier (ticket_number, user id, etc.)
 *   actorId     — app_users.id of the actor (null for system events)
 *   changes     — safe metadata; NEVER include passwords, tokens, or raw credentials.
 *                 The current request's reqId is injected automatically from the
 *                 request context so every audit row from one request is correlated.
 */
export async function writePlatformAudit(a: {
  action:    string;
  tableName: string;
  recordId:  string;
  actorId?:  string | null;
  changes:   Record<string, unknown>;
}): Promise<void> {
  const { reqId } = getReqContext();
  const changes = reqId ? { ...a.changes, reqId } : a.changes;
  const { error } = await sb.from('audit_logs').insert({
    action:     a.action,
    table_name: a.tableName,
    record_id:  a.recordId,
    user_id:    a.actorId ?? null,
    changes,
    created_at: new Date().toISOString(),
  });
  if (error) {
    console.error('[audit] platform audit write failed:', error.message, { action: a.action, recordId: a.recordId, reqId });
    throw Object.assign(
      new Error(`Platform audit write failed (${a.action}): ${error.message}`),
      { status: 500 },
    );
  }
}

/**
 * Build the DB row object for an app_events INSERT without executing it.
 * Pass the result as `p_event` to an RPC that embeds the INSERT inside its
 * own transaction so the event row is committed atomically with the business row.
 * After the RPC returns, call deliverEventNotifications() for the best-effort
 * notification / Realtime delivery pass.
 */
export function buildEventRow(input: EmitAppEventInput): Record<string, unknown> {
  return {
    event_type:         input.eventType,
    source_module:      input.sourceModule,
    source_entity_type: input.sourceEntityType,
    source_entity_id:   input.sourceEntityId,
    actor_user_id:      input.actorUserId ?? null,
    site_id:            input.siteId ?? null,
    department_id:      input.departmentId ?? null,
    severity:           input.severity ?? 'info',
    payload:            input.payload ?? {},
    dedupe_key:         input.dedupeKey ?? null,
  };
}

/**
 * Best-effort notification delivery AFTER the transaction commits.
 * Resolves recipients for the event, persists notification rows, and
 * emits the Realtime badge-refresh signal. Never throws — a failure here
 * must not affect the already-committed business transaction.
 *
 * @param input  The same EmitAppEventInput used to build the event row.
 * @param eventId  The uuid returned by the RPC (from the app_events.id of the
 *                 in-txn insert); used to link notification rows to the event.
 *                 Pass null when the event_id is unavailable (notifications
 *                 are still delivered, just without the link).
 */
export async function deliverEventNotifications(
  input: EmitAppEventInput,
  eventId: string | null,
): Promise<void> {
  try {
    if (!input.notification) return; // no notification configured → nothing to send
    const recipients = await resolveRecipients(input);
    if (recipients.size === 0) return;
    const n = input.notification;
    await Promise.all([...recipients.keys()].map(userId =>
      notify({
        userId,
        type:           n.type ?? input.eventType,
        title:          n.title,
        body:           n.body,
        link:           n.actionRoute,
        eventId:        eventId ?? undefined,
        module:         input.sourceModule,
        severity:       input.severity ?? 'info',
        sourceType:     input.sourceEntityType,
        sourceId:       input.sourceEntityId,
        actionRoute:    n.actionRoute,
        metadata:       input.payload,
        dedupeKey:      input.dedupeKey ?? null,
        actionRequired: n.actionRequired,
        dueAt:          n.dueAt,
      }).catch((err: unknown) => console.warn('[appEvents] deliverEventNotifications notify failed for', userId, err)),
    ));
    await emitSignal([...recipients.keys()], 'notifications').catch(() => void 0);
  } catch (e) {
    console.warn('[appEvents] deliverEventNotifications failed:', e);
  }
}

export async function emitAppEvent(input: EmitAppEventInput): Promise<EmitAppEventResult> {
  try {
    // 1. Dedupe check
    if (input.dedupeKey) {
      const { data: existing } = await sb
        .from('app_events')
        .select('id')
        .eq('dedupe_key', input.dedupeKey)
        .maybeSingle<{ id: string }>();
      if (existing) return { ok: true, eventId: existing.id, deduped: true, recipientCount: 0 };
    }

    // 2. Insert app_event — inject reqId from the request context so every
    //    app_events row from one request shares the same correlation ID.
    const { reqId } = getReqContext();
    const payload = reqId
      ? { ...(input.payload ?? {}), reqId }
      : (input.payload ?? {});
    const { data: event, error: evErr } = await sb
      .from('app_events')
      .insert({
        event_type:         input.eventType,
        source_module:      input.sourceModule,
        source_entity_type: input.sourceEntityType,
        source_entity_id:   input.sourceEntityId,
        actor_user_id:      input.actorUserId ?? null,
        site_id:            input.siteId ?? null,
        department_id:      input.departmentId ?? null,
        severity:           input.severity ?? 'info',
        payload,
        dedupe_key:         input.dedupeKey ?? null,
      })
      .select('id')
      .single<{ id: string }>();

    // .single() is discriminated: a non-null error means the insert produced no
    // row, so `event` is guaranteed present once `evErr` is null.
    if (evErr) {
      // Unique violation on dedupe_key = concurrent emit won — treat as deduped
      if (evErr.code === '23505') {
        return { ok: true, deduped: true, recipientCount: 0 };
      }
      console.error('[appEvents] insert failed:', evErr.message);
      return { ok: false };
    }

    const eventId = event.id;

    // 3. Resolve recipients
    const recipients = await resolveRecipients(input);
    const recipientCount = recipients.size;

    // 4. Notify each recipient (best-effort, parallel)
    if (recipientCount > 0 && input.notification) {
      const n = input.notification;
      await Promise.all([...recipients.keys()].map(userId =>
        notify({
          userId,
          type:           n.type ?? input.eventType,
          title:          n.title,
          body:           n.body,
          link:           n.actionRoute,
          eventId,
          module:         input.sourceModule,
          severity:       input.severity ?? 'info',
          sourceType:     input.sourceEntityType,
          sourceId:       input.sourceEntityId,
          actionRoute:    n.actionRoute,
          metadata:       input.payload,
          dedupeKey:      input.dedupeKey ?? null,
          actionRequired: n.actionRequired,
          dueAt:          n.dueAt,
        }).catch((err: unknown) => console.warn('[appEvents] notify failed for', userId, err)),
      ));

      // 5. Emit Realtime signal for each unique user
      const userIds = [...recipients.keys()];
      await emitSignal(userIds, 'notifications').catch(() => void 0);
    }

    // 6. Audit log — awaited (not fire-and-forget): in a serverless runtime, an
    // un-awaited insert issued right before the handler returns can be frozen/
    // dropped entirely once the response is sent, not just "occasionally slow".
    // Still best-effort per the function's contract (never throws — a failed
    // audit write must not break the business action), just no longer a promise
    // dangling past the function's own lifetime.
    const { error: auditErr } = await sb.from('audit_logs').insert({
      action:       input.eventType,
      table_name:   input.sourceEntityType,
      record_id:    input.sourceEntityId,
      user_id:      input.actorUserId ?? null,
      changes:      input.payload ?? {},
      created_at:   new Date().toISOString(),
    });
    if (auditErr) console.error('[appEvents] audit_logs insert failed:', auditErr.message, { eventId, eventType: input.eventType });

    return { ok: true, eventId, deduped: false, recipientCount };
  } catch (e) {
    console.error('[appEvents] emitAppEvent failed:', e);
    return { ok: false };
  }
}
