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
import { notify }             from './notify';
import { emitSignal }         from './communications';

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
  };
}

export interface EmitAppEventResult {
  ok: boolean;
  eventId?: string;
  deduped?: boolean;
  recipientCount?: number;
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

    // 2. Insert app_event
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
        payload:            input.payload ?? {},
        dedupe_key:         input.dedupeKey ?? null,
      })
      .select('id')
      .single<{ id: string }>();

    if (evErr || !event) {
      // Unique violation on dedupe_key = concurrent emit won — treat as deduped
      if ((evErr as { code?: string } | null)?.code === '23505') {
        return { ok: true, deduped: true, recipientCount: 0 };
      }
      console.error('[appEvents] insert failed:', evErr?.message);
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
          type:  n.type ?? input.eventType,
          title: n.title,
          body:  n.body,
          link:  n.actionRoute,
        }).catch(err => console.warn('[appEvents] notify failed for', userId, err)),
      ));

      // 5. Emit Realtime signal for each unique user
      const userIds = [...recipients.keys()];
      await emitSignal(userIds, 'notifications').catch(() => void 0);
    }

    // 6. Audit log (best-effort — never block on this)
    void sb.from('audit_logs').insert({
      action:       input.eventType,
      table_name:   input.sourceEntityType,
      record_id:    input.sourceEntityId,
      user_id:      input.actorUserId ?? null,
      changes:      input.payload ?? {},
      created_at:   new Date().toISOString(),
    }).then(({ error }) => {
      if (error) console.warn('[appEvents] audit_logs insert failed:', error.message);
    });

    return { ok: true, eventId, deduped: false, recipientCount };
  } catch (e) {
    console.error('[appEvents] emitAppEvent failed:', e);
    return { ok: false };
  }
}
