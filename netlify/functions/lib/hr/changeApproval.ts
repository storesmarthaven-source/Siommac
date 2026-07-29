// ============================================================================
// HR employee change-request application (shared by the route + the workflow adapter)
// ============================================================================
// `hr_employee_change_requests` is the change ENVELOPE; the central workflow
// engine owns the approval LIFECYCLE. The engine's hr_employee_master adapter
// calls applyApprovedChange() on approval and markChangeRequestStatus() on
// in_review/return/reject/cancel. The HR /decide route reuses the same functions
// as a fallback for requests created without a binding (no workflow).
// ============================================================================

import { sb } from '../db';
import { writeHrAudit, todayISO } from './employeeCore';
import { currentAssignmentConditions } from './employmentDetail';
import { emitAppEvent } from '../appEvents';

export const CHANGE_TYPES = ['status_change', 'department_transfer', 'site_transfer', 'supervisor_change', 'role_change', 'employment_type_change', 'contact_update', 'transfer_promotion'] as const;
export type ChangeType = typeof CHANGE_TYPES[number];

// Contact columns a contact_update change request may touch (whitelist for apply).
export const CONTACT_COLS = ['email', 'phone', 'personal_email', 'emergency_contact_name', 'emergency_contact_phone', 'emergency_contact_relationship'] as const;
const HR_BLOCKING = new Set(['suspended', 'inactive', 'terminated', 'archived']);

interface ChangeRow {
  employee_id: string; change_type: ChangeType;
  requested_value: Record<string, unknown>; previous_value: Record<string, unknown> | null;
}

/** Apply an approved change to app_users (+ history/assignment). */
export async function applyChange(req: ChangeRow, actorId: string | null): Promise<void> {
  const rv = req.requested_value ?? {};
  const eid = req.employee_id;
  const stamp = { updated_at: new Date().toISOString() };
  switch (req.change_type) {
    case 'status_change': {
      const newStatus = String(rv['newStatus'] ?? rv['status'] ?? '');
      await sb.from('hr_employee_status_history').insert({
        employee_id: eid, previous_status: (req.previous_value?.['status'] as string) ?? null, new_status: newStatus,
        reason: 'Approved change request', effective_date: todayISO(), changed_by: actorId,
      });
      await sb.from('app_users').update({ status: HR_BLOCKING.has(newStatus) ? 'inactive' : 'active', ...stamp }).eq('id', eid);
      break;
    }
    case 'department_transfer':
    case 'site_transfer': {
      const patch: Record<string, unknown> = { ...stamp };
      if ('departmentId' in rv) patch['department_id'] = rv['departmentId'];
      if ('siteId' in rv)       patch['site_id']       = rv['siteId'];
      await sb.from('app_users').update(patch).eq('id', eid);
      // Carry the employment conditions forward: a transfer moves the posting,
      // it does not renegotiate contracted hours, FTE or notice.
      const transferConditions = await currentAssignmentConditions(eid);
      await sb.from('hr_employee_assignments').update({ is_current: false, effective_to: todayISO() }).eq('employee_id', eid).eq('is_current', true);
      await sb.from('hr_employee_assignments').insert({
        employee_id: eid, department_id: (rv['departmentId'] as string) ?? null, site_id: (rv['siteId'] as string) ?? null,
        assignment_type: 'primary', effective_from: todayISO(), is_current: true, created_by: actorId,
        weekly_hours: transferConditions.weekly_hours, fte: transferConditions.fte,
        notice_period_days: transferConditions.notice_period_days,
      });
      break;
    }
    case 'supervisor_change':
      await sb.from('app_users').update({ supervisor_id: (rv['supervisorId'] as string) ?? null, ...stamp }).eq('id', eid);
      break;
    case 'role_change':
      await sb.from('app_users').update({ role: rv['role'], ...stamp }).eq('id', eid);
      break;
    case 'employment_type_change':
      await sb.from('app_users').update({ employment_type: rv['employmentType'], ...stamp }).eq('id', eid);
      break;
    case 'contact_update': {
      const patch: Record<string, unknown> = { ...stamp };
      for (const k of CONTACT_COLS) if (k in rv) patch[k] = rv[k];
      await sb.from('app_users').update(patch).eq('id', eid);
      break;
    }
    case 'transfer_promotion': {
      // Build the app_users patch from whichever fields are present in the bundle.
      const patch: Record<string, unknown> = { ...stamp };
      if ('departmentId'  in rv) patch['department_id']  = rv['departmentId'];
      if ('siteId'        in rv) patch['site_id']        = rv['siteId'];
      if ('positionId'    in rv) patch['position_id']    = rv['positionId'];
      if ('supervisorId'  in rv) patch['supervisor_id']  = rv['supervisorId'];
      if ('role'          in rv) patch['role']           = rv['role'];
      if ('monthlySalary' in rv && rv['monthlySalary'] != null) {
        patch['monthly_salary'] = rv['monthlySalary'];
        patch['pay_basis']      = 'salary';
      }
      if ('hourlyRate' in rv && rv['hourlyRate'] != null) {
        patch['hourly_rate'] = rv['hourlyRate'];
        if (!('monthlySalary' in rv) || rv['monthlySalary'] == null) patch['pay_basis'] = 'hourly';
      }
      await sb.from('app_users').update(patch).eq('id', eid);

      // Assignment history — close the current row and open a new one stamped with
      // effectiveDate. Only create an assignment row when org fields actually changed.
      const orgChanged = ('departmentId' in rv) || ('siteId' in rv) || ('positionId' in rv) || ('supervisorId' in rv);
      if (orgChanged) {
        const eff = String(rv['effectiveDate'] ?? todayISO());
        // Merge: use the requested value if present, else fall back to previous_value.
        const prev = req.previous_value ?? {};
        const newDept       = ('departmentId' in rv)  ? (rv['departmentId']  as string | null) : (prev['department_id']  as string | null) ?? null;
        const newSite       = ('siteId'        in rv)  ? (rv['siteId']        as string | null) : (prev['site_id']        as string | null) ?? null;
        const newPosition   = ('positionId'    in rv)  ? (rv['positionId']    as string | null) : (prev['position_id']    as string | null) ?? null;
        const newSupervisor = ('supervisorId'  in rv)  ? (rv['supervisorId']  as string | null) : (prev['supervisor_id']  as string | null) ?? null;

        const approvedConditions = await currentAssignmentConditions(eid);

        await sb.from('hr_employee_assignments')
          .update({ is_current: false, effective_to: eff })
          .eq('employee_id', eid).eq('is_current', true);

        await sb.from('hr_employee_assignments').insert({
          employee_id:     eid,
          position_id:     newPosition,
          department_id:   newDept,
          site_id:         newSite,
          supervisor_id:   newSupervisor,
          assignment_type: 'primary',
          effective_from:  eff,
          is_current:      true,
          weekly_hours:       approvedConditions.weekly_hours,
          fte:                approvedConditions.fte,
          notice_period_days: approvedConditions.notice_period_days,
          created_by:      actorId,
        });
      }
      break;
    }
  }
}

/** Apply an APPROVED change request, mark it applied, audit + emit the event. Idempotent. */
export async function applyApprovedChange(crId: string, actorId: string | null): Promise<void> {
  const { data: req } = await sb.from('hr_employee_change_requests')
    .select('id, employee_id, change_type, requested_value, previous_value, status, requested_by')
    .eq('id', crId)
    .maybeSingle<ChangeRow & { id: string; status: string; requested_by: string | null }>();
  if (!req) throw Object.assign(new Error('Change request not found.'), { status: 404 });
  if (req.status === 'applied') return;                              // idempotent — already applied
  const actor = actorId ?? req.requested_by ?? null;
  await applyChange(req, actor);
  const now = new Date().toISOString();
  await sb.from('hr_employee_change_requests').update({ status: 'applied', decided_at: now, applied_at: now }).eq('id', crId);
  await writeHrAudit({ employeeId: req.employee_id, submoduleKey: 'employees', recordId: crId, actorId: actor,
    action: 'hr.employee.change_applied', previousState: req.previous_value, newState: req.requested_value });
  await emitAppEvent({ eventType: 'hr.employee.change_applied', sourceModule: 'hr', sourceEntityType: 'employee_change',
    sourceEntityId: crId, actorUserId: actor ?? undefined, severity: 'info', payload: { employeeId: req.employee_id, changeType: req.change_type } });
}

/** Move a change request to a non-applied status (in_review / returned / rejected / cancelled). */
export async function markChangeRequestStatus(
  crId: string, status: 'in_review' | 'returned' | 'rejected' | 'cancelled', actorId: string | null, comment?: string | null,
): Promise<void> {
  const { data: req } = await sb.from('hr_employee_change_requests')
    .select('id, employee_id, status, metadata').eq('id', crId)
    .maybeSingle<{ id: string; employee_id: string; status: string; metadata: Record<string, unknown> | null }>();
  if (!req || req.status === status || req.status === 'applied') return;
  const patch: Record<string, unknown> = { status };
  if (status !== 'in_review') {
    patch['decided_at'] = new Date().toISOString();
    patch['metadata'] = { ...(req.metadata ?? {}), decisionComment: comment ?? null };
  }
  await sb.from('hr_employee_change_requests').update(patch).eq('id', crId);
  if (status !== 'in_review') {
    await writeHrAudit({ employeeId: req.employee_id, submoduleKey: 'employees', recordId: crId, actorId,
      action: `hr.employee.change_${status}`, reason: comment ?? null });
  }
}
