/**
 * netlify/functions/lib/finance/backbone.ts
 *
 * Shared mutation side-effect composer for Finance Wave 2B.
 *
 * ALL six Wave 2B pages call emitFinanceMutationBackbone() after their primary
 * DB write succeeds. It composes, in order:
 *   1. emitAppEvent      — app_events row + auto-resolved recipient notifications
 *   2. writeHrAudit      — hr_audit_log row (MANDATORY — throws on failure)
 *   3. notification(s)   — explicit additional in-app notifications via notify()
 *   4. messageThread     — Message Center thread via createMessageThread() (if requested)
 *   5. ticket            — support ticket via createTicket() (if requested)
 *   6. handoff           — cross-module handoff via createHandoff() (if requested, CRITICAL)
 *
 * Error contract
 * ─────────────
 * • writeHrAudit:        THROWS on DB failure — the mutation must be rolled back.
 * • handoff creation:    THROWS on failure — caller compensates (the handoff is
 *                        a mandatory delivery contract, not best-effort).
 * • emitAppEvent:        NEVER throws (by design) — ok:false is logged only.
 * • notifications:       Best-effort — individual failures are logged; the batch
 *                        does not abort.
 * • messageThread:       Best-effort — failure logged; does not abort.
 * • ticket:              Best-effort — failure logged; does not abort.
 *
 * Text user IDs
 * ─────────────
 * All *UserId fields are TEXT (app_users.id), never UUID literals.
 * No tenant_id is used anywhere — SIOMAC is single-tenant.
 *
 * Usage
 * ─────
 * const biz = await createBizRecord(...);
 * try {
 *   await emitFinanceMutationBackbone({ actorUserId, module: 'finance_expenses', ... });
 * } catch {
 *   await deleteBizRecord(biz.id);   // compensating rollback
 *   throw;
 * }
 */

import { emitAppEvent, type EventSeverity } from '../appEvents';
import { writeHrAudit }     from '../hr/employeeCore';
import { notify, notifyMany } from '../notify';
import { createMessageThread } from '../communications';
import { createTicket }     from '../communications';
import { createHandoff }    from '../handoffBus';

// ── Params ────────────────────────────────────────────────────────────────────

export interface FinanceNotificationSpec {
  title:              string;
  body?:              string;
  actionRoute?:       string;
  actionRequired?:    boolean;
  dueAt?:             string | null;
  /** TEXT user ids (app_users.id) to notify explicitly (beyond event_rules auto-routing). */
  recipientUserIds?:  string[];
  type?:              string;
  severity?:          EventSeverity;
}

export interface FinanceMessageThreadSpec {
  subject:             string;
  /** TEXT user ids — ALL must be active app_users. Creator is auto-included. */
  participantUserIds:  string[];
  body:                string;
}

export interface FinanceTicketSpec {
  category:         string;
  priority?:        'low' | 'medium' | 'high' | 'critical';
  subject:          string;
  description:      string;
  /** TEXT user id — the user who "raised" the ticket (requester). */
  requesterUserId:  string;
}

export interface FinanceHandoffSpec {
  targetModule:       string;
  targetEntityType?:  string;
  payload:            Record<string, unknown>;
}

export interface FinanceBackboneParams {
  /** TEXT (app_users.id) — the user who triggered the mutation. */
  actorUserId:   string;
  /**
   * source_module for app_events / hr_audit_log.
   * e.g. 'finance_expenses', 'finance_remittances', 'finance_payroll'
   */
  module:        string;
  /** source_entity_type for app_events. e.g. 'expense_claim', 'remittance' */
  entityType:    string;
  /** source_entity_id for app_events (the record's uuid or ref). */
  entityId:      string;
  /** Dotted event type string. e.g. 'finance.expense.approved' */
  eventType:     string;
  /** Action string written to hr_audit_log.action. e.g. 'expense.approved' */
  auditAction:   string;
  /**
   * hr_audit_log.submodule_key.
   * Defaults to `params.module` when omitted.
   */
  auditSubmodule?: string;
  previousState?:  unknown;
  newState?:       unknown;
  reason?:         string | null;
  metadata?:       Record<string, unknown>;
  severity?:       EventSeverity;

  // ── Optional side effects ────────────────────────────────────────────────────

  /**
   * Notification spec.
   * The `notification` block is forwarded to emitAppEvent for auto-recipient resolution.
   * `recipientUserIds` are additionally notified directly via notify().
   */
  notification?:    FinanceNotificationSpec;

  /**
   * Create a Message Center thread anchored to this entity.
   * Best-effort — failure does NOT abort the backbone.
   */
  messageThread?:   FinanceMessageThreadSpec;

  /**
   * Create a support ticket linked to this entity.
   * Best-effort — failure does NOT abort the backbone.
   */
  ticket?:          FinanceTicketSpec;

  /**
   * Create a cross-module handoff.
   * CRITICAL — throws on failure (caller must compensate on the business record).
   */
  handoff?:         FinanceHandoffSpec;
}

// ── Result ────────────────────────────────────────────────────────────────────

export interface FinanceBackboneResult {
  eventId?:    string;
  threadId?:   string;
  ticketId?:   string;
  handoffId?:  string;
}

// ── Main composer ─────────────────────────────────────────────────────────────

/**
 * Compose the mandatory and optional side effects for a Finance mutation.
 *
 * Call AFTER the primary business-row write. On writeHrAudit or handoff failure
 * this function throws — the caller is responsible for compensating rollback.
 */
export async function emitFinanceMutationBackbone(
  params: FinanceBackboneParams,
): Promise<FinanceBackboneResult> {
  const result: FinanceBackboneResult = {};

  // ── 1. Emit app event ─────────────────────────────────────────────────────
  // NEVER throws — fire-and-forget per emitAppEvent's contract.
  const evResult = await emitAppEvent({
    eventType:         params.eventType,
    sourceModule:      params.module,
    sourceEntityType:  params.entityType,
    sourceEntityId:    params.entityId,
    actorUserId:       params.actorUserId,
    severity:          params.severity ?? 'info',
    payload:           params.metadata ?? {},
    ...(params.notification
      ? {
          notification: {
            title:          params.notification.title,
            body:           params.notification.body,
            actionRoute:    params.notification.actionRoute,
            type:           params.notification.type ?? params.eventType,
            actionRequired: params.notification.actionRequired,
            dueAt:          params.notification.dueAt,
          },
        }
      : {}),
  });
  if (!evResult.ok) {
    console.error('[finance/backbone] emitAppEvent returned ok:false', {
      eventType: params.eventType,
      entityId:  params.entityId,
    });
  }
  result.eventId = evResult.eventId;

  // ── 2. Write hr_audit_log — MANDATORY; throws on failure ──────────────────
  await writeHrAudit({
    submoduleKey:  params.auditSubmodule ?? params.module,
    recordId:      params.entityId,
    actorId:       params.actorUserId,
    action:        params.auditAction,
    previousState: params.previousState ?? null,
    newState:      params.newState ?? null,
    reason:        params.reason ?? null,
  });

  // ── 3. Additional explicit notifications (beyond event_rules auto-routing) ─
  if (params.notification?.recipientUserIds?.length) {
    const notifPayload = {
      type:           params.notification.type ?? params.eventType,
      title:          params.notification.title,
      body:           params.notification.body,
      module:         params.module,
      severity:       (params.notification.severity ?? params.severity ?? 'info') as string,
      sourceType:     params.entityType,
      sourceId:       params.entityId,
      actionRoute:    params.notification.actionRoute,
      eventId:        result.eventId,
      actionRequired: params.notification.actionRequired,
      dueAt:          params.notification.dueAt,
    };
    // Best-effort — individual failures are caught and logged inside notifyMany
    await notifyMany(params.notification.recipientUserIds, notifPayload).catch(e =>
      console.warn('[finance/backbone] notifyMany failed:', e),
    );
  }

  // ── 4. Message Center thread (best-effort) ────────────────────────────────
  if (params.messageThread) {
    const tRes = await createMessageThread({
      threadType:        'record',
      subject:           params.messageThread.subject,
      sourceModule:      params.module,
      sourceEntityType:  params.entityType,
      sourceEntityId:    params.entityId,
      createdBy:         params.actorUserId,
      participantUserIds: params.messageThread.participantUserIds,
      body:              params.messageThread.body,
    }).catch(e => {
      console.warn('[finance/backbone] createMessageThread failed:', e);
      return { ok: false as const };
    });
    if (tRes.ok && tRes.threadId) result.threadId = tRes.threadId;
  }

  // ── 5. Support ticket (best-effort) ──────────────────────────────────────
  if (params.ticket) {
    const tkRes = await createTicket({
      category:          params.ticket.category,
      priority:          params.ticket.priority,
      subject:           params.ticket.subject,
      description:       params.ticket.description,
      requesterUserId:   params.ticket.requesterUserId,
      sourceModule:      params.module,
      sourceEntityType:  params.entityType,
      sourceEntityId:    params.entityId,
    }).catch(e => {
      console.warn('[finance/backbone] createTicket failed:', e);
      return { ok: false as const };
    });
    if (tkRes.ok && tkRes.ticketId) result.ticketId = tkRes.ticketId;
  }

  // ── 6. Cross-module handoff (CRITICAL — throws on failure) ───────────────
  if (params.handoff) {
    const hRes = await createHandoff({
      sourceModule:      params.module,
      targetModule:      params.handoff.targetModule,
      sourceEntityType:  params.entityType,
      sourceEntityId:    params.entityId,
      targetEntityType:  params.handoff.targetEntityType,
      payload:           params.handoff.payload,
      createdBy:         params.actorUserId,
    });
    if (!hRes.ok || !hRes.handoffId) {
      throw Object.assign(
        new Error(
          `[finance/backbone] createHandoff failed: ${params.module}→${params.handoff.targetModule} for ${params.entityId}`,
        ),
        { status: 500 },
      );
    }
    result.handoffId = hRes.handoffId;
  }

  return result;
}
