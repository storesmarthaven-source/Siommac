/**
 * netlify/functions/lib/finance/financeEvents.ts
 *
 * Shared backbone utilities for Finance module mutations (Spec §8.5 / §17).
 *
 * Provides:
 *   emitFinanceMutationBackbone  — emitAppEvent + writeHrAudit in one call
 *   getUserIdsByRole             — query active user IDs by role (internal helper)
 *   notifyUsersByRole            — push in-app notifications to all users with a given role
 *   createFinanceRecordThread    — create a message thread linked to a finance record
 *
 * Active Finance workflows reuse these helpers so notification, handoff, and
 * thread behavior stays consistent without module-by-module duplication.
 *
 * NEVER throws — all errors are caught and logged so that a side-effect failure
 * never rolls back the primary business mutation.
 */

import { sb }                     from '../db';
import { emitAppEvent }           from '../appEvents';
import { writeHrAudit }           from '../hr/employeeCore';
import { notifyMany }             from '../notify';
import { createMessageThread }    from '../communications';
import type { NotifyPayload }     from '../notify';
import type { CreateThreadInput } from '../communications';
import type { EventSeverity }     from '../appEvents';

// ── Backbone ──────────────────────────────────────────────────────────────────

export interface FinanceMutationBackboneInput {
  eventType:        string;
  sourceModule:     string;
  sourceEntityType: string;
  sourceEntityId:   string;
  actorId:          string;
  severity:         EventSeverity;
  payload:          Record<string, unknown>;
  audit: {
    submoduleKey:  string;
    action:        string;
    previousState: Record<string, unknown> | null;
    newState:      Record<string, unknown>;
    reason?:       string;
  };
}

/**
 * Emit app_events (fire-and-forget) + hr_audit_log (awaited) for a finance mutation.
 * The audit write is awaited so a failed write still surfaces as 500.
 */
export async function emitFinanceMutationBackbone(
  input: FinanceMutationBackboneInput,
): Promise<void> {
  void emitAppEvent({
    eventType:        input.eventType,
    sourceModule:     input.sourceModule,
    sourceEntityType: input.sourceEntityType,
    sourceEntityId:   input.sourceEntityId,
    actorUserId:      input.actorId,
    severity:         input.severity,
    payload:          input.payload,
  });
  await writeHrAudit({
    submoduleKey:  input.audit.submoduleKey,
    recordId:      input.sourceEntityId,
    actorId:       input.actorId,
    action:        input.audit.action,
    previousState: input.audit.previousState,
    newState:      input.audit.newState,
    reason:        input.audit.reason,
  });
}

// ── Role-based user lookup ────────────────────────────────────────────────────

/** Returns all active app_users IDs for a given role. Never throws — returns [] on error. */
export async function getUserIdsByRole(role: string): Promise<string[]> {
  try {
    const { data, error } = await sb
      .from('app_users')
      .select('id')
      .eq('role', role)
      .eq('status', 'active');
    if (error) {
      console.error('[financeEvents] getUserIdsByRole:', error.message);
      return [];
    }
    return ((data ?? []) as Array<{ id: string }>).map(r => r.id);
  } catch (e) {
    console.error('[financeEvents] getUserIdsByRole failed:', e);
    return [];
  }
}

// ── Notification helpers ──────────────────────────────────────────────────────

/**
 * Notify all active users with a given role (in-app + their chosen delivery channels).
 * Never throws — wrap in void when calling fire-and-forget.
 */
export async function notifyUsersByRole(
  role: string,
  payload: Omit<NotifyPayload, 'userId'>,
): Promise<void> {
  try {
    const ids = await getUserIdsByRole(role);
    if (ids.length === 0) return;
    await notifyMany(ids, payload);
  } catch (e) {
    console.error('[financeEvents] notifyUsersByRole failed:', e);
  }
}

// ── Message thread helpers ────────────────────────────────────────────────────

export interface CreateFinanceRecordThreadInput
  extends Omit<CreateThreadInput, 'participantUserIds'> {
  /** Additional participant IDs beyond the creator. */
  extraParticipantUserIds?: string[];
  /**
   * If set, all active users with this role are also added as participants so
   * the thread lands in their Message Center inbox.
   */
  notifyRole?: string;
}

/**
 * Create a record-linked message thread for a finance entity.
 * Resolves extra participants from a role query, deduplicates, then calls
 * createMessageThread (which validates all IDs before inserting).
 * Returns the new threadId, or null on error.
 * Never throws.
 */
export async function createFinanceRecordThread(
  input: CreateFinanceRecordThreadInput,
): Promise<string | null> {
  try {
    const extra   = input.extraParticipantUserIds ?? [];
    const roleIds = input.notifyRole ? await getUserIdsByRole(input.notifyRole) : [];
    // Creator is auto-included by createMessageThread; dedup to avoid duplicate-participant errors.
    const participantUserIds = [...new Set([...extra, ...roleIds])];

    const res = await createMessageThread({
      threadType:        input.threadType,
      subject:           input.subject,
      sourceModule:      input.sourceModule,
      sourceEntityType:  input.sourceEntityType,
      sourceEntityId:    input.sourceEntityId,
      createdBy:         input.createdBy,
      body:              input.body,
      participantUserIds,
    });

    if (!res.ok) {
      console.error('[financeEvents] createFinanceRecordThread:', res.message);
      return null;
    }
    return res.threadId ?? null;
  } catch (e) {
    console.error('[financeEvents] createFinanceRecordThread failed:', e);
    return null;
  }
}
