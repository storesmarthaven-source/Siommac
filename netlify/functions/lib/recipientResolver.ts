/**
 * netlify/functions/lib/recipientResolver.ts
 *
 * Data-driven recipient resolution (notification system, Phase 2). Recipients
 * are derived from the `event_rules` table — NOT a hardcoded switch — so admins
 * can change *who gets notified* without code changes.
 *
 * For each active rule matching the event type (or '*'), the `recipient_kind`
 * expands to user ids:
 *   actor        → the event actor
 *   owner|assignee → supplied by the calling route via explicitRecipients
 *   explicit     → rule.recipient_value (a user id) or explicitRecipients
 *   role         → all active users with that role
 *   dept_manager → managers of the event's department
 *   site_manager → managers (best-effort; no per-user site assignment yet)
 *   watcher      → entity watchers (tickets today)
 *
 * The actor is dropped from their own notifications unless the event is a
 * confirmation-style type.
 */

import { sb } from './db';
import type { EmitAppEventInput } from './appEvents';

export type RecipientReason =
  | 'actor' | 'owner' | 'assignee' | 'dept_manager' | 'site_manager'
  | 'role' | 'watcher' | 'explicit' | 'participant';

export interface ExplicitRecipient {
  userId: string;
  reason: RecipientReason;
}

interface EventRule {
  recipient_kind: string;
  recipient_value: string | null;
  notify: boolean;
}

/** Events where the ACTOR is a legitimate recipient — a receipt for something they
 *  submitted or decided. Registering an event here is the ONLY supported way to keep the
 *  actor on its notification: relabelling the actor as `owner`/`participant` to slip past
 *  the step-4 suppression below misdescribes the recipient and leaves sibling routes
 *  silently inconsistent. */
const ACTOR_CONFIRMATION_EVENTS = new Set([
  'workflow.approved', 'workflow.rejected',
  'hse.capa.closed', 'hse.incident.closed',
  'ptw.permit.approved', 'ptw.permit.rejected',
  'documents.document.published', 'payroll.published',
  // Ticket / account-support submission receipts — the submitter is told their request landed.
  'ticket.created',
  'ticket.account_support.created',
  'account_access.assistance_requested',
]);

/** Returns a Map<userId, reason> — first reason wins on conflict. */
export async function resolveRecipients(
  input: EmitAppEventInput & { explicitRecipients?: ExplicitRecipient[] },
): Promise<Map<string, RecipientReason>> {
  const out = new Map<string, RecipientReason>();
  const add = (userId: string | null | undefined, reason: RecipientReason): void => {
    if (userId && !out.has(userId)) out.set(userId, reason);
  };

  // 1. Explicit recipients passed by the calling route (owner/assignee/etc).
  for (const r of (input.explicitRecipients ?? [])) add(r.userId, r.reason);

  // 2. Data-driven rules from event_rules (this type + catch-all '*').
  const { data: rules } = await sb.from('event_rules')
    .select('recipient_kind, recipient_value, notify')
    .eq('active', true)
    .or(`event_type.eq.${input.eventType},event_type.eq.*`) as { data: EventRule[] | null };

  for (const rule of (rules ?? [])) {
    if (!rule.notify) continue;
    switch (rule.recipient_kind) {
      case 'actor':
        add(input.actorUserId, 'actor');
        break;
      case 'explicit':
        if (rule.recipient_value) add(rule.recipient_value, 'explicit');
        break;
      case 'role':
        if (rule.recipient_value) await _addByRole(out, [rule.recipient_value.toLowerCase()], null);
        break;
      case 'dept_manager':
        await _addByRole(out, ['manager'], input.departmentId);
        break;
      case 'site_manager':
        await _addByRole(out, ['manager'], null);
        break;
      case 'watcher':
        await _addWatchers(out, input.sourceEntityType, input.sourceEntityId);
        break;
      case 'owner':
      case 'assignee':
        // Provided by the calling route via explicitRecipients (added in step 1).
        break;
    }
  }

  // 3. No rule matched and no explicit recipients → default to the actor.
  if (out.size === 0) add(input.actorUserId, 'actor');

  // 4. Drop the actor from their own notifications unless it's a confirmation.
  if (input.actorUserId && out.get(input.actorUserId) === 'actor'
      && !ACTOR_CONFIRMATION_EVENTS.has(input.eventType)) {
    out.delete(input.actorUserId);
  }

  return out;
}

async function _addByRole(
  out: Map<string, RecipientReason>,
  roles: string[],
  departmentId: string | null | undefined,
): Promise<void> {
  let q = sb.from('app_users').select('id').in('role', roles).eq('status', 'active');
  if (departmentId) q = q.eq('department_id', departmentId);
  const { data } = await q as { data: { id: string }[] | null };
  for (const u of (data ?? [])) if (!out.has(u.id)) out.set(u.id, 'role');
}

async function _addWatchers(
  out: Map<string, RecipientReason>,
  entityType: string,
  entityId: string,
): Promise<void> {
  if (entityType !== 'ticket') return;
  const res = await sb
    .from('ticket_participants')
    .select('user_id')
    .eq('ticket_id', entityId)
    .is('removed_at', null);
  const rows = (res.data ?? []) as { user_id: string }[];
  for (const w of rows) if (!out.has(w.user_id)) out.set(w.user_id, 'watcher');
}
