/**
 * netlify/functions/lib/recipientResolver.ts
 *
 * Resolves which users should receive an event, based on the event type
 * and contextual data (actor, site, department, explicit recipients).
 *
 * Recipient rules per the spec:
 *
 *   Event                           Recipients
 *   hse.incident.submitted          HSE Managers for site/dept, Admin
 *   hse.incident.critical           HSE Managers, Admin, Site Manager
 *   hse.investigation.assigned      Assigned investigator
 *   hse.investigation.overdue       Investigator, HSE Manager
 *   hse.capa.assigned               CAPA owner
 *   hse.capa.due_soon               CAPA owner
 *   hse.capa.overdue                CAPA owner, HSE Manager
 *   workflow.task.assigned          Assigned user or users with assigned role
 *   workflow.returned               Workflow owner and previous actor
 *   workflow.approved               Workflow owner, source record owner
 *   handoff.failed                  Target module manager, Admin
 *   ticket.created                  Admin/support queue
 *   ticket.replied                  Requester, assignee, watchers except actor
 *   payroll.published               Affected employee
 *   message.posted                  Thread participants except actor
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

/** Returns a Map<userId, reason> — first reason wins on conflict. */
export async function resolveRecipients(
  input: EmitAppEventInput & { explicitRecipients?: ExplicitRecipient[] },
): Promise<Map<string, RecipientReason>> {
  const out = new Map<string, RecipientReason>();

  const add = (userId: string | null | undefined, reason: RecipientReason): void => {
    if (userId && !out.has(userId)) out.set(userId, reason);
  };

  // 1. Explicit recipients passed by the calling route
  for (const r of (input.explicitRecipients ?? [])) add(r.userId, r.reason);

  // 2. Rule-based resolution per event type
  switch (input.eventType) {
    case 'hse.incident.submitted':
    case 'hse.incident.critical':
      await _addByRole(out, ['admin', 'manager'], input.departmentId);
      break;

    case 'hse.investigation.assigned':
    case 'hse.capa.assigned':
      // Assignee comes via explicitRecipients from the calling route
      break;

    case 'hse.investigation.overdue':
    case 'hse.capa.overdue':
    case 'hse.capa.due_soon':
      // Owner/assignee via explicitRecipients; also notify managers
      await _addByRole(out, ['manager'], input.departmentId);
      break;

    case 'workflow.task.assigned':
      // Assignee via explicitRecipients
      break;

    case 'workflow.returned':
    case 'workflow.approved':
      // Owner/actor via explicitRecipients; also actor as 'actor'
      add(input.actorUserId, 'actor');
      break;

    case 'handoff.failed':
      await _addByRole(out, ['admin'], null);
      break;

    case 'ticket.created':
      await _addByRole(out, ['admin'], null);
      break;

    case 'ticket.replied':
    case 'message.posted':
      // Participants come via explicitRecipients from calling route; exclude actor
      out.delete(input.actorUserId ?? '');
      break;

    case 'payroll.published':
      // Employee comes via explicitRecipients
      break;

    default:
      // Actor receives all other events by default
      add(input.actorUserId, 'actor');
      break;
  }

  // Remove the actor from their own notifications unless they are explicitly in
  // a non-actor reason (e.g. they are also the owner of the record)
  if (input.actorUserId && out.get(input.actorUserId) === 'actor') {
    // Keep actor notifications for confirmation events (approved/success)
    const confirmEvents = new Set(['workflow.approved', 'hse.capa.closed', 'payroll.published']);
    if (!confirmEvents.has(input.eventType)) {
      out.delete(input.actorUserId);
    }
  }

  return out;
}

async function _addByRole(
  out:          Map<string, RecipientReason>,
  roles:        string[],
  departmentId: string | null | undefined,
): Promise<void> {
  let q = sb.from('app_users').select('id').in('role', roles).eq('status', 'active');
  if (departmentId) q = q.eq('department_id', departmentId);

  const { data } = await q as { data: Array<{ id: string }> | null };
  for (const u of (data ?? [])) {
    if (!out.has(u.id)) out.set(u.id, 'role');
  }
}
