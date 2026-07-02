// lib/hr/leaveCore.ts — HR Leave core business logic
//
// submitLeaveRequest — full submit flow with runModuleMutation + workflow
// applyApprovedLeave — called by adapter onWorkflowCompleted
// setLeaveRequestStatus — used by adapter hooks
// rejectLeaveRequest — release pending reserve, set rejected
// cancelLeaveRequest — release pending or taken, set cancelled

import { sb }                 from '../db';
import { emitAppEvent }       from '../appEvents';
import { nextRef }            from '../refGenerator';
import { runModuleMutation }  from '../moduleServiceAdapter';
import { resolveSettingValue } from '../settings/resolveSetting';
import { writeHrAudit }       from './employeeCore';
import { startWorkflowForRecord } from '../workflow/service';
import type {
  LeaveStatus, SubmitLeaveRequestArgs, SubmitLeaveResult,
} from '../../../../types/hrLeave';

const err = (status: number, msg: string): Error => Object.assign(new Error(msg), { status });
const sScope = { moduleKey: 'hr_leave' };

// ── Balance ledger helpers ────────────────────────────────────────────

export async function recomputeBalance(
  employeeId: string,
  leaveTypeId: string,
  year: number,
): Promise<void> {
  const { data: rows } = await sb.from('hr_leave_accruals')
    .select('kind, delta')
    .eq('employee_id', employeeId)
    .eq('leave_type_id', leaveTypeId)
    .eq('year', year);

  const ledger = (rows ?? []) as { kind: string; delta: number }[];
  const accruedAmount  = ledger.filter(r => r.kind === 'accrual').reduce((a, r) => a + Number(r.delta), 0);
  const takenAmount    = ledger.filter(r => r.kind === 'deduction').reduce((a, r) => a + Math.abs(Number(r.delta)), 0);
  const pendingAmount  = ledger.filter(r => r.kind === 'pending_reserve').reduce((a, r) => a + Math.abs(Number(r.delta)), 0);
  const releaseAmount  = ledger.filter(r => r.kind === 'release').reduce((a, r) => a + Number(r.delta), 0);
  const adjustmentAmount = ledger.filter(r => r.kind === 'adjustment').reduce((a, r) => a + Number(r.delta), 0);
  // Releases cancel pending and taken (both are stored as negatives; releases are positive)
  // Net taken = deductions - releases (releases are always positive; deductions absolute)
  const netTaken = Math.max(0, takenAmount - releaseAmount);

  const { error } = await sb.from('hr_leave_balances').upsert({
    employee_id: employeeId,
    leave_type_id: leaveTypeId,
    year,
    entitled:   0,
    accrued:    accruedAmount,
    taken:      netTaken,
    pending:    pendingAmount,
    adjustment: adjustmentAmount,
  }, { onConflict: 'employee_id,leave_type_id,year' });
  if (error) throw err(500, `Failed to recompute balance: ${error.message}`);
}

async function insertLedgerRow(p: {
  employeeId: string; leaveTypeId: string; year: number;
  delta: number; kind: string; idempotencyKey: string;
  sourceRequestId?: string | null; note?: string | null; createdBy?: string | null;
}): Promise<void> {
  const { error } = await sb.from('hr_leave_accruals').insert({
    employee_id:       p.employeeId,
    leave_type_id:     p.leaveTypeId,
    year:              p.year,
    delta:             p.delta,
    kind:              p.kind,
    idempotency_key:   p.idempotencyKey,
    source_request_id: p.sourceRequestId ?? null,
    note:              p.note ?? null,
    created_by:        p.createdBy ?? null,
  });
  // Idempotency: conflict means already inserted — not an error.
  if (error && !error.message?.includes('duplicate') && !error.code?.includes('23505')) {
    throw err(500, `Failed to insert ledger row (${p.kind}): ${error.message}`);
  }
}

// ── Submit ────────────────────────────────────────────────────────────────────────────

export async function submitLeaveRequest(
  actorId: string,
  args: SubmitLeaveRequestArgs,
): Promise<SubmitLeaveResult> {
  // 1. Settings gates
  const enabled = await resolveSettingValue<unknown>(sb, 'hr_leave.enabled', sScope, true);
  if (enabled === false || enabled === 'false') {
    throw err(403, 'Leave module is disabled in settings.');
  }

  const minNoticeDays = Number(await resolveSettingValue<unknown>(sb, 'hr_leave.min_notice_days', sScope, 1) ?? 1);
  if (minNoticeDays > 0) {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const from  = new Date(args.fromDate);
    const diffDays = Math.floor((from.getTime() - today.getTime()) / 86_400_000);
    if (diffDays < minNoticeDays) {
      throw err(400, `Leave requires at least ${minNoticeDays} day(s) notice.`);
    }
  }

  // 2. Validate leave type
  const { data: lt, error: ltErr } = await sb.from('hr_leave_types').select('*').eq('id', args.leaveTypeId).maybeSingle();
  if (ltErr) throw err(500, `Failed to load leave type: ${ltErr.message}`);
  if (!lt || !(lt as Record<string, unknown>).is_active) throw err(400, 'Invalid or inactive leave type.');

  const year  = new Date(args.fromDate).getFullYear();
  const days  = args.days ?? null;

  // 3. Balance check
  const allowNeg = await resolveSettingValue<unknown>(sb, 'hr_leave.allow_negative_balance', sScope, false);
  if (allowNeg !== true && allowNeg !== 'true' && days != null) {
    const { data: bal } = await sb.from('hr_leave_balances')
      .select('accrued, taken, pending, adjustment')
      .eq('employee_id', args.employeeId)
      .eq('leave_type_id', args.leaveTypeId)
      .eq('year', year)
      .maybeSingle();
    if (bal) {
      const b = bal as Record<string, number>;
      const available = (b.accrued ?? 0) + (b.adjustment ?? 0) - (b.taken ?? 0) - (b.pending ?? 0);
      if (days > available) throw err(400, `Insufficient balance. Available: ${available} days.`);
    }
  }

  // 4. Overlap check
  const { data: overlapping } = await sb.from('hr_leave_requests')
    .select('id')
    .eq('employee_id', args.employeeId)
    .in('status', ['pending_approval', 'approved'])
    .lte('from_date', args.toDate)
    .gte('to_date', args.fromDate)
    .limit(1);
  if ((overlapping ?? []).length > 0) {
    throw err(409, 'An overlapping leave request already exists for this period.');
  }

  // 5. runModuleMutation — insert request + pending_reserve ledger + audit
  const result = await runModuleMutation<{ id: string; caseNo: string }>({
    context: { actorUserId: actorId },
    options: {
      module: 'hr', operation: 'submit', entityType: 'leave_request',
      idempotencyKey: `hr.leave.submit:${args.employeeId}:${args.fromDate}:${args.toDate}:${args.leaveTypeId}`,
      eventType: 'hr.leave.submitted', eventSeverity: 'info',
      getEntityIdentity: (r) => ({ id: r.id, ref: r.caseNo }),
      buildEventPayload: (r) => ({ employeeId: args.employeeId, leaveTypeId: args.leaveTypeId, days, caseNo: r.caseNo }),
    },
    writeRecord: async () => {
      const caseNo = await nextRef('LVR');

      const { data: requestRow, error: insertErr } = await sb.from('hr_leave_requests').insert({
        case_no:       caseNo,
        employee_id:   args.employeeId,
        leave_type_id: args.leaveTypeId,
        from_date:     args.fromDate,
        to_date:       args.toDate,
        unit:          args.unit ?? 'days',
        days:          days,
        hours:         args.hours ?? null,
        half_day:      args.halfDay ?? false,
        reason:        args.reason ?? null,
        status:        'pending_approval',
        department_id: args.departmentId ?? null,
        applied_at:    new Date().toISOString(),
      }).select().single();
      if (insertErr) throw err(500, `Failed to insert leave request: ${insertErr.message}`);

      const req = requestRow as Record<string, unknown>;
      const requestId = req.id as string;

      // Insert pending_reserve ledger row (idempotent)
      if (days != null) {
        const { error: ledgerErr } = await sb.from('hr_leave_accruals').insert({
          employee_id:       args.employeeId,
          leave_type_id:     args.leaveTypeId,
          year,
          delta:             -days,
          kind:              'pending_reserve',
          idempotency_key:   `hr.leave.pending:${requestId}`,
          source_request_id: requestId,
          created_by:        actorId,
        });
        if (ledgerErr && !ledgerErr.code?.includes('23505')) {
          // Compensating rollback — delete the request we just created
          await sb.from('hr_leave_requests').delete().eq('id', requestId);
          throw err(500, `Failed to insert pending reserve: ${ledgerErr.message}`);
        }
        await recomputeBalance(args.employeeId, args.leaveTypeId, year);
      }

      await writeHrAudit({
        employeeId: args.employeeId, submoduleKey: 'leave', recordId: requestId,
        actorId, action: 'hr.leave.submitted',
        previousState: null, newState: { caseNo, status: 'pending_approval', leaveTypeId: args.leaveTypeId },
      });

      return { id: requestId, caseNo };
    },
  });

  const requestId = result.record.id;
  const caseNo    = result.record.caseNo;

  // 6. Start workflow (or direct-approve if no binding)
  let finalStatus: LeaveStatus = 'pending_approval';
  try {
    const wf = await startWorkflowForRecord({
      context: {
        moduleKey: 'hr_leave', workflowType: 'hr_leave_approval',
        triggerEvent: 'hr.leave.requested',
        sourceRecordId: requestId, sourceRecordRef: caseNo,
        requestedBy: actorId,
        departmentId: args.departmentId ?? null,
        recordData: { employeeId: args.employeeId, leaveTypeId: args.leaveTypeId, days, fromDate: args.fromDate, toDate: args.toDate, reason: args.reason },
      },
      actor: { id: actorId },
    });
    if (!wf) {
      // No binding — direct approve
      await applyApprovedLeave(requestId, actorId);
      finalStatus = 'approved';
    } else {
      // Save workflow_id on the request
      await sb.from('hr_leave_requests').update({ workflow_id: (wf as unknown as Record<string, unknown>).id }).eq('id', requestId);
    }
  } catch (_wfErr) {
    // Workflow start failure is non-fatal — request stays pending_approval
  }

  // 7. Fire-and-forget app_event
  void emitAppEvent({
    eventType: 'hr.leave.submitted', sourceModule: 'hr',
    sourceEntityType: 'leave_request', sourceEntityId: requestId,
    actorUserId: actorId, severity: 'info',
    payload: { caseNo, employeeId: args.employeeId, leaveTypeId: args.leaveTypeId, days },
  });

  return { requestId, caseNo, status: finalStatus };
}

// ── Status transitions ────────────────────────────────────────────────────────────────────

export async function setLeaveRequestStatus(
  requestId: string,
  status: LeaveStatus,
  reviewerId: string | null,
  notes?: string | null,
): Promise<void> {
  const patch: Record<string, unknown> = { status };
  if (reviewerId) { patch.reviewed_by = reviewerId; patch.reviewed_at = new Date().toISOString(); }
  if (notes)      patch.review_notes = notes;
  const { error } = await sb.from('hr_leave_requests').update(patch).eq('id', requestId);
  if (error) throw err(500, `Failed to set leave request status: ${error.message}`);
}

export async function applyApprovedLeave(requestId: string, approverId: string | null): Promise<void> {
  const { data: req, error: rErr } = await sb.from('hr_leave_requests')
    .select('employee_id, leave_type_id, days, from_date')
    .eq('id', requestId).maybeSingle();
  if (rErr) throw err(500, `Failed to load leave request: ${rErr.message}`);
  if (!req) throw err(404, 'Leave request not found.');

  const r    = req as Record<string, unknown>;
  const empId = r.employee_id as string;
  const ltId  = r.leave_type_id as string;
  const days  = r.days != null ? Number(r.days) : null;
  const year  = new Date(r.from_date as string).getFullYear();

  if (days != null) {
    // Insert deduction (idempotent)
    const { error: dedErr } = await sb.from('hr_leave_accruals').insert({
      employee_id: empId, leave_type_id: ltId, year,
      delta: -days, kind: 'deduction',
      idempotency_key: `hr.leave.deduction:${requestId}`,
      source_request_id: requestId,
    });
    if (dedErr && !dedErr.code?.includes('23505')) throw err(500, `Failed to insert deduction: ${dedErr.message}`);

    // Release the pending reserve (idempotent)
    const { error: relErr } = await sb.from('hr_leave_accruals').insert({
      employee_id: empId, leave_type_id: ltId, year,
      delta: days, kind: 'release',
      idempotency_key: `hr.leave.release_pending:${requestId}`,
      source_request_id: requestId,
    });
    if (relErr && !relErr.code?.includes('23505')) throw err(500, `Failed to insert release: ${relErr.message}`);

    await recomputeBalance(empId, ltId, year);
  }

  await setLeaveRequestStatus(requestId, 'approved', approverId);

  void emitAppEvent({
    eventType: 'hr.leave.approved', sourceModule: 'hr',
    sourceEntityType: 'leave_request', sourceEntityId: requestId,
    actorUserId: approverId ?? 'system', severity: 'info', payload: { days },
  });
  await writeHrAudit({
    employeeId: empId, submoduleKey: 'leave', recordId: requestId,
    actorId: approverId ?? 'system', action: 'hr.leave.approved',
    newState: { status: 'approved', reviewedBy: approverId },
  });
}

export async function rejectLeaveRequest(
  requestId: string, reviewerId: string | null, notes: string,
): Promise<void> {
  const { data: req } = await sb.from('hr_leave_requests')
    .select('employee_id, leave_type_id, days, from_date, status').eq('id', requestId).maybeSingle();
  if (!req) throw err(404, 'Leave request not found.');
  const r    = req as Record<string, unknown>;
  const empId = r.employee_id as string;
  const ltId  = r.leave_type_id as string;
  const days  = r.days != null ? Number(r.days) : null;
  const year  = new Date(r.from_date as string).getFullYear();

  if (days != null && r.status === 'pending_approval') {
    const { error: relErr } = await sb.from('hr_leave_accruals').insert({
      employee_id: empId, leave_type_id: ltId, year,
      delta: days, kind: 'release',
      idempotency_key: `hr.leave.release_pending:${requestId}`,
      source_request_id: requestId,
    });
    if (relErr && !relErr.code?.includes('23505')) throw err(500, `Failed to release pending reserve: ${relErr.message}`);
    await recomputeBalance(empId, ltId, year);
  }

  await setLeaveRequestStatus(requestId, 'rejected', reviewerId, notes);
  void emitAppEvent({ eventType: 'hr.leave.rejected', sourceModule: 'hr', sourceEntityType: 'leave_request', sourceEntityId: requestId, actorUserId: reviewerId ?? 'system', severity: 'info', payload: {} });
  await writeHrAudit({ employeeId: empId, submoduleKey: 'leave', recordId: requestId, actorId: reviewerId ?? 'system', action: 'hr.leave.rejected', newState: { status: 'rejected', reviewNotes: notes } });
}

export async function cancelLeaveRequest(
  actorId: string, requestId: string, reason?: string | null,
): Promise<void> {
  const { data: req } = await sb.from('hr_leave_requests')
    .select('employee_id, leave_type_id, days, from_date, status').eq('id', requestId).maybeSingle();
  if (!req) throw err(404, 'Leave request not found.');
  const r     = req as Record<string, unknown>;
  const empId  = r.employee_id as string;
  const ltId   = r.leave_type_id as string;
  const days   = r.days != null ? Number(r.days) : null;
  const year   = new Date(r.from_date as string).getFullYear();
  const status = r.status as string;

  if (!['pending_approval', 'approved'].includes(status)) {
    throw err(400, `Cannot cancel a leave request in status '${status}'.`);
  }

  if (days != null) {
    const idempotencyKey = status === 'approved'
      ? `hr.leave.release_approved:${requestId}`
      : `hr.leave.release_pending:${requestId}`;

    const { error: relErr } = await sb.from('hr_leave_accruals').insert({
      employee_id: empId, leave_type_id: ltId, year,
      delta: days, kind: 'release',
      idempotency_key: idempotencyKey,
      source_request_id: requestId,
    });
    if (relErr && !relErr.code?.includes('23505')) throw err(500, `Failed to release balance on cancel: ${relErr.message}`);
    await recomputeBalance(empId, ltId, year);
  }

  const { error } = await sb.from('hr_leave_requests').update({
    status:       'cancelled',
    cancelled_by: actorId,
    cancelled_at: new Date().toISOString(),
  }).eq('id', requestId);
  if (error) throw err(500, `Failed to cancel leave request: ${error.message}`);

  void emitAppEvent({ eventType: 'hr.leave.cancelled', sourceModule: 'hr', sourceEntityType: 'leave_request', sourceEntityId: requestId, actorUserId: actorId, severity: 'info', payload: { reason } });
  await writeHrAudit({ employeeId: empId, submoduleKey: 'leave', recordId: requestId, actorId, action: 'hr.leave.cancelled', newState: { status: 'cancelled', reason } });
}
