/**
 * netlify/functions/lib/finance/bridges.ts
 *
 * Idempotent cross-module bridge functions for Finance Wave 2B.
 *
 * These functions wire together already-existing domain services when an
 * upstream event (e.g. a payroll run approval) should automatically create or
 * confirm a downstream Finance record. Each function is safe to call more than
 * once for the same source entity — the second call returns the existing record
 * without side-effects.
 *
 * Idempotency mechanisms:
 *   createDisbursementFromRun  — finance_disbursements.unique(payroll_run_id)
 *   createRemittanceFromRun    — finance_remittances.unique(payroll_run_id, authority)
 *   createReimbursementHandoff — finance_reimbursement_handoffs.unique(expense_claim_id)
 *
 * On a 409 the bridge catches the conflict, fetches the existing row, and
 * returns it with `created: false` — no error is thrown to the caller.
 *
 * Exported:
 *   createDisbursementFromRun(payrollRunId, actorId, metadata?)
 *   createRemittanceFromRun(payrollRunId, authority, actorId, dueDate?, metadata?)
 *   createReimbursementHandoff(expenseClaimId, actorId, payrollRunId?)
 */

import { sb } from '../db';
import {
  createDisbursement,
  listDisbursements,
  type DisbursementDto,
} from './disbursements';
import {
  createRemittance,
  listRemittances,
  type RemittanceDto,
  type RemittanceAuthority,
} from './remittances';
import { getExpenseClaim } from './expenses';
import { createHandoff } from '../handoffBus';
import { emitAppEvent } from '../appEvents';
import { writeHrAudit } from '../hr/employeeCore';

// ── DTOs ──────────────────────────────────────────────────────────────────────

export interface DisbursementBridgeResult {
  /** true = newly created, false = already existed */
  created:      boolean;
  disbursement: DisbursementDto;
}

export interface RemittanceBridgeResult {
  created:     boolean;
  remittance:  RemittanceDto;
}

export interface ReimbursementHandoffBridgeResult {
  created:   boolean;
  bridgeId:  string;
  handoffId: string;
}

// ── DB row type for the handoffs bridge table ─────────────────────────────────

interface DbReimbursementHandoff {
  id:               string;
  expense_claim_id: string;
  handoff_id:       string;
  payroll_run_id:   string | null;
  status:           string;
  error_message:    string | null;
  created_at:       string;
  updated_at:       string | null;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Bridge 1 — Disbursement from payroll run
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Create a draft disbursement for a payroll run, or return the existing one
 * if one has already been created.
 *
 * Safe to call from: payroll run approval handler, manual "Create Disbursement"
 * button, any Wave 2B intake handler.
 *
 * @param payrollRunId UUID of the approved/locked/exported payroll run
 * @param actorId      TEXT (app_users.id) of the actor requesting creation
 * @param metadata     Optional extra metadata to pass through to the record
 */
export async function createDisbursementFromRun(
  payrollRunId: string,
  actorId:      string,
  metadata?:    Record<string, unknown>,
): Promise<DisbursementBridgeResult> {
  try {
    const disbursement = await createDisbursement({ payrollRunId, actorId, metadata });
    return { created: true, disbursement };
  } catch (err: unknown) {
    const status = (err as { status?: number }).status;

    if (status === 409) {
      // A disbursement for this run already exists — fetch and return it.
      const existing = await listDisbursements({ payrollRunId });
      if (existing.length === 0) {
        // Extremely unlikely: constraint fired but no row found; re-throw original.
        throw err;
      }
      return { created: false, disbursement: existing[0]! };
    }

    // Any other error propagates (e.g. 422 missing bank accounts, 500 DB error)
    throw err;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Bridge 2 — Remittance from payroll run
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Create a draft remittance for a (payroll run, authority) pair, or return
 * the existing one if it was already created.
 *
 * Each payroll run can have up to three remittances — one per authority.
 * Use this bridge from: payroll run approval handler (fan out over all three
 * authorities) or the "Create Remittances" action on the Remittances page.
 *
 * @param payrollRunId UUID of the approved/locked/exported payroll run
 * @param authority    Statutory authority ('paye_bir' | 'nis_nibtt' | 'health_surcharge')
 * @param actorId      TEXT (app_users.id) of the actor
 * @param dueDate      Optional ISO date (YYYY-MM-DD) — due date for this remittance
 * @param metadata     Optional extra metadata
 */
export async function createRemittanceFromRun(
  payrollRunId: string,
  authority:    RemittanceAuthority,
  actorId:      string,
  dueDate?:     string | null,
  metadata?:    Record<string, unknown>,
): Promise<RemittanceBridgeResult> {
  try {
    const remittance = await createRemittance({
      payrollRunId,
      authority,
      dueDate:  dueDate ?? null,
      metadata: metadata ?? {},
      actorId,
    });
    return { created: true, remittance };
  } catch (err: unknown) {
    const status = (err as { status?: number }).status;

    if (status === 409) {
      // A remittance for this (run, authority) pair already exists.
      const existing = await listRemittances({ payrollRunId, authority });
      if (existing.length === 0) {
        throw err;
      }
      return { created: false, remittance: existing[0]! };
    }

    throw err;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Bridge 3 — Reimbursement handoff from expense claim
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Create a cross-module handoff from Finance Expenses to the Payroll module
 * so the approved claim is included in the next payroll run's reimbursements.
 * Also writes a `finance_reimbursement_handoffs` bridge row for tracking.
 *
 * If a handoff was already created for this claim (unique on expense_claim_id),
 * the existing bridge record is returned with `created: false`.
 *
 * @param expenseClaimId UUID of the approved expense claim
 * @param actorId        TEXT (app_users.id) — typically the approver
 * @param payrollRunId   Optional UUID — the run that triggered this (if any)
 */
export async function createReimbursementHandoff(
  expenseClaimId: string,
  actorId:        string,
  payrollRunId?:  string | null,
): Promise<ReimbursementHandoffBridgeResult> {
  // ── 1. Idempotency check: does a bridge row already exist? ─────────────────
  const { data: existing, error: checkErr } = await sb
    .from('finance_reimbursement_handoffs')
    .select('id, handoff_id, status')
    .eq('expense_claim_id', expenseClaimId)
    .maybeSingle<Pick<DbReimbursementHandoff, 'id' | 'handoff_id' | 'status'>>();

  if (checkErr) {
    throw Object.assign(
      new Error(`createReimbursementHandoff/check: ${checkErr.message}`),
      { status: 500 },
    );
  }

  if (existing) {
    return { created: false, bridgeId: existing.id, handoffId: existing.handoff_id };
  }

  // ── 2. Resolve claim for payload (non-fatal if not found — handoff still fires) ─
  const claim = await getExpenseClaim(expenseClaimId).catch(() => null);

  // ── 3. Create the cross-module handoff via handoffBus ─────────────────────
  const handoffResult = await createHandoff({
    sourceModule:     'finance_expenses',
    targetModule:     'finance_payroll',
    sourceEntityType: 'expense_claim',
    sourceEntityId:   expenseClaimId,
    targetEntityType: 'payroll_run',
    payload: {
      expenseClaimId,
      payrollRunId:  payrollRunId ?? null,
      claimantId:    claim?.claimantId ?? null,
      totalAmount:   claim?.totalAmount ?? null,
      currency:      claim?.currency ?? 'TTD',
      category:      claim?.category ?? null,
    },
    createdBy: actorId,
  });

  if (!handoffResult.ok || !handoffResult.handoffId) {
    throw Object.assign(
      new Error('createReimbursementHandoff: handoff bus failed to create outbox row.'),
      { status: 500 },
    );
  }

  // ── 4. Insert the bridge row (unique on expense_claim_id guards duplicates) ─
  const { data: bridgeRow, error: insertErr } = await sb
    .from('finance_reimbursement_handoffs')
    .insert({
      expense_claim_id: expenseClaimId,
      handoff_id:       handoffResult.handoffId,
      payroll_run_id:   payrollRunId ?? null,
      status:           'pending',
    })
    .select('id')
    .single<Pick<DbReimbursementHandoff, 'id'>>();

  if (insertErr) {
    if (insertErr.code === '23505') {
      // Race condition: another request beat us. Fetch what exists.
      const { data: race } = await sb
        .from('finance_reimbursement_handoffs')
        .select('id, handoff_id')
        .eq('expense_claim_id', expenseClaimId)
        .maybeSingle<Pick<DbReimbursementHandoff, 'id' | 'handoff_id'>>();
      if (race) {
        return { created: false, bridgeId: race.id, handoffId: race.handoff_id };
      }
    }
    // Any other DB error — throw (the handoff_outbox row already exists but
    // the bridge row doesn't; the handoff will still be processed).
    throw Object.assign(
      new Error(`createReimbursementHandoff/insert: ${insertErr.message}`),
      { status: 500 },
    );
  }

  // ── 5. Emit event + audit ─────────────────────────────────────────────────
  void emitAppEvent({
    eventType:        'finance.expense.reimbursement_handoff_created',
    sourceModule:     'finance_expenses',
    sourceEntityType: 'expense_claim',
    sourceEntityId:   expenseClaimId,
    actorUserId:      actorId,
    severity:         'info',
    payload: {
      bridgeId:    bridgeRow.id,
      handoffId:   handoffResult.handoffId,
      payrollRunId: payrollRunId ?? null,
    },
  });
  await writeHrAudit({
    submoduleKey:  'finance_expenses',
    recordId:      expenseClaimId,
    actorId,
    action:        'expense.reimbursement_handoff_created',
    previousState: null,
    newState:      { bridgeId: bridgeRow.id, handoffId: handoffResult.handoffId },
  });

  return { created: true, bridgeId: bridgeRow.id, handoffId: handoffResult.handoffId };
}
