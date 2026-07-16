// ============================================================================
// HR Overtime Mutations — write-side for hr_overtime_entries
// ============================================================================
// Rules:
//   • Employee submits ONLY their own OT (self-scope enforced server-side).
//   • Manager / HR approve by scope via the central workflow engine.
//   • Rejected OT never enters payroll; approved OT can.
//   • Paid OT is immutable: cannot be cancelled, rejected, or modified.
//   • OT linked to a locked/exported payroll run is immutable.
// ============================================================================

import { sb } from '../db';
import { emitAppEvent } from '../appEvents';
import { writeHrAudit } from './employeeCore';
import { rpcHttpError } from '../workflow/service';
import { selectWorkflowBinding } from '../workflow/bindingResolver';
import { notifyUsersByRole } from '../finance/financeEvents';
import { getOvertimeEntry, type OvertimeEntryDto, type DbOvertimeRow } from './overtimeQueries';
import { toOvertimeDto, type OvertimeType } from './overtimeCore';

export { getOvertimeEntry };

// ── Submit own OT ─────────────────────────────────────────────────────────────

export interface SubmitOvertimeInput {
  employeeId: string;   // must equal actorId (enforced in route)
  workDate: string;
  hours: number;
  multiplier?: number;
  otType?: OvertimeType | null;
  reason?: string | null;
  actorId: string;
  idempotencyKey: string;
}

export async function submitOvertimeEntry(input: SubmitOvertimeInput): Promise<OvertimeEntryDto> {
  if (input.hours <= 0) {
    throw Object.assign(new Error('Hours must be positive.'), { status: 422 });
  }
  const requestKey = input.idempotencyKey?.trim();
  if (!requestKey) throw Object.assign(new Error('An idempotency key is required to submit overtime.'), { status: 400 });

  // ATOMIC (finding #3, Shape B): when an approval binding exists, the entry INSERT +
  // workflow start + workflow_id link + business event + hr_audit_log all commit in ONE
  // transaction via workflow_create_and_start_tx (hr_overtime_entries branch), with
  // request-key idempotency. When NO binding is configured, approval is not enforced —
  // fall back to a plain insert (submitted, no workflow); a single write cannot strand.
  const binding = await selectWorkflowBinding(sb, {
    moduleKey: 'hr_overtime', workflowType: 'hr_overtime_approval',
    triggerEvent: 'hr.overtime.submitted', sourceRecordId: '', requestedBy: input.actorId, recordData: {},
  });

  if (binding) {
    const { data, error } = await sb.rpc('workflow_create_and_start_tx', {
      p_source_table: 'hr_overtime_entries', p_actor_id: input.actorId,
      p_binding_id: binding.id, p_request_key: requestKey,
      p_business: {
        employeeId: input.employeeId, workDate: input.workDate, hours: input.hours,
        multiplier: input.multiplier ?? 1.5, otType: input.otType ?? null, reason: input.reason ?? null,
      },
    });
    if (error) throw rpcHttpError(error as { code?: string | null; message: string });
    const result = (data ?? {}) as { recordId?: string; ref?: string };
    // The first step routes to the 'manager' role. Notify that role post-commit so approval
    // gets actioned (preserving the fan-out startWorkflowForRecord.notifyTaskAssigned did).
    void notifyUsersByRole('manager', {
      type: 'hr.overtime.submitted',
      title: `Overtime ${result.ref ?? ''} awaiting your approval`.trim(),
      body: 'An overtime entry has been submitted for your approval.',
      module: 'hr_overtime', severity: 'warning', sourceType: 'overtime_entry',
      sourceId: result.recordId ?? '', actionRequired: true,
      dedupeKey: `hr.overtime.submitted.${result.recordId}`,
    });
    const row = await getOvertimeEntry(result.recordId!);
    if (!row) throw Object.assign(new Error('Overtime entry not found after submit.'), { status: 503 });
    return row;
  }

  // No approval binding — approval is opt-in; a plain insert (submitted, no workflow) is
  // a single write that cannot strand. Keep the audit + event.
  const { data, error } = await sb.from('hr_overtime_entries').insert({
    employee_id: input.employeeId,
    work_date: input.workDate,
    hours: input.hours,
    multiplier: input.multiplier ?? 1.5,
    ot_type: input.otType ?? null,
    reason: input.reason ?? null,
    status: 'submitted',
    created_by: input.actorId,
  }).select().single<DbOvertimeRow>();
  if (error) throw Object.assign(new Error('submitOvertimeEntry: ' + error.message), { status: 500 });

  const row = toOvertimeDto(data);

  await writeHrAudit({
    submoduleKey: 'hr_overtime', recordId: row.id, actorId: input.actorId,
    action: 'overtime.submitted',
    previousState: null, newState: { status: 'submitted', employeeId: row.employeeId, workDate: row.workDate, hours: row.hours },
  });
  void emitAppEvent({
    eventType: 'hr.overtime.submitted',
    sourceModule: 'hr_overtime', sourceEntityType: 'overtime_entry', sourceEntityId: row.id,
    actorUserId: input.actorId, severity: 'info',
    payload: { employeeId: row.employeeId, workDate: row.workDate, hours: row.hours, otType: row.otType },
  });

  return row;
}

// ── Approve (workflow adapter calls this) ─────────────────────────────────────

export async function approveOvertimeEntry(id: string, actorId: string): Promise<OvertimeEntryDto> {
  const existing = await getOvertimeEntry(id);
  if (!existing) throw Object.assign(new Error('Overtime entry not found.'), { status: 404 });
  if (existing.status !== 'submitted') {
    throw Object.assign(new Error('Only submitted overtime entries can be approved.'), { status: 422 });
  }

  const now = new Date().toISOString();
  const { data, error } = await sb.from('hr_overtime_entries')
    .update({ status: 'approved', approved_by: actorId, approved_at: now })
    .eq('id', id).select().single<DbOvertimeRow>();
  if (error) throw Object.assign(new Error('approveOvertimeEntry: ' + error.message), { status: 500 });
  const row = toOvertimeDto(data);

  await writeHrAudit({
    submoduleKey: 'hr_overtime', recordId: id, actorId,
    action: 'overtime.approved',
    previousState: { status: 'submitted' }, newState: { status: 'approved' },
  });
  void emitAppEvent({
    eventType: 'hr.overtime.approved',
    sourceModule: 'hr_overtime', sourceEntityType: 'overtime_entry', sourceEntityId: id,
    actorUserId: actorId, severity: 'success', payload: {},
  });

  return row;
}

// ── Reject (workflow adapter calls this) ──────────────────────────────────────

export async function rejectOvertimeEntry(id: string, actorId: string, reason?: string): Promise<OvertimeEntryDto> {
  const existing = await getOvertimeEntry(id);
  if (!existing) throw Object.assign(new Error('Overtime entry not found.'), { status: 404 });
  if (existing.status !== 'submitted') {
    throw Object.assign(new Error('Only submitted overtime entries can be rejected.'), { status: 422 });
  }

  const { data, error } = await sb.from('hr_overtime_entries')
    .update({ status: 'rejected' })
    .eq('id', id).select().single<DbOvertimeRow>();
  if (error) throw Object.assign(new Error('rejectOvertimeEntry: ' + error.message), { status: 500 });
  const row = toOvertimeDto(data);

  await writeHrAudit({
    submoduleKey: 'hr_overtime', recordId: id, actorId,
    action: 'overtime.rejected',
    previousState: { status: 'submitted' }, newState: { status: 'rejected' },
    reason: reason ?? null,
  });
  void emitAppEvent({
    eventType: 'hr.overtime.rejected',
    sourceModule: 'hr_overtime', sourceEntityType: 'overtime_entry', sourceEntityId: id,
    actorUserId: actorId, severity: 'warning', payload: { reason: reason ?? null },
  });

  return row;
}

// ── Cancel (employee or HR cancels; immutable if paid) ────────────────────────

export async function cancelOvertimeEntry(id: string, actorId: string): Promise<OvertimeEntryDto> {
  const existing = await getOvertimeEntry(id);
  if (!existing) throw Object.assign(new Error('Overtime entry not found.'), { status: 404 });
  if (existing.status === 'paid') {
    throw Object.assign(new Error('Paid overtime entries cannot be cancelled.'), { status: 422 });
  }
  if (!['submitted', 'approved'].includes(existing.status)) {
    throw Object.assign(new Error('Only submitted or approved overtime entries can be cancelled.'), { status: 422 });
  }

  const { data, error } = await sb.from('hr_overtime_entries')
    .update({ status: 'cancelled' })
    .eq('id', id).select().single<DbOvertimeRow>();
  if (error) throw Object.assign(new Error('cancelOvertimeEntry: ' + error.message), { status: 500 });
  const row = toOvertimeDto(data);

  await writeHrAudit({
    submoduleKey: 'hr_overtime', recordId: id, actorId,
    action: 'overtime.cancelled',
    previousState: { status: existing.status }, newState: { status: 'cancelled' },
  });
  void emitAppEvent({
    eventType: 'hr.overtime.cancelled',
    sourceModule: 'hr_overtime', sourceEntityType: 'overtime_entry', sourceEntityId: id,
    actorUserId: actorId, severity: 'info', payload: {},
  });

  return row;
}

// ── Set status (workflow adapter helper) ──────────────────────────────────────

export async function setOvertimeStatus(
  id: string,
  status: string,
  actorId: string | null,
  opts?: { reason?: string | null },
): Promise<void> {
  const patch: Record<string, unknown> = { status };
  if (status === 'approved') {
    patch['approved_by'] = actorId;
    patch['approved_at'] = new Date().toISOString();
  }
  const { error } = await sb.from('hr_overtime_entries').update(patch).eq('id', id);
  if (error) throw new Error('setOvertimeStatus failed: ' + error.message);

  await writeHrAudit({
    submoduleKey: 'hr_overtime', recordId: id, actorId: actorId ?? 'workflow',
    action: `overtime.status_set.${status}`,
    previousState: null, newState: { status },
    reason: opts?.reason ?? null,
  });
}
