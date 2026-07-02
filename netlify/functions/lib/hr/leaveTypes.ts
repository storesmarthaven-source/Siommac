// lib/hr/leaveTypes.ts — HR Leave type CRUD
//
// create/update/retire leave types + emit app_events + audit.
// All writes go through service_role; no soft-auth bypass.

import { sb }           from '../db';
import { emitAppEvent } from '../appEvents';
import { writeHrAudit } from './employeeCore';
import type { LeaveType } from '../../../../types/hrLeave';

const err = (status: number, msg: string): Error => Object.assign(new Error(msg), { status });

// ── Row mapper ───────────────────────────────────────────────────────────────

function mapRow(r: Record<string, unknown>): LeaveType {
  return {
    id:                 r.id as string,
    code:               r.code as string,
    label:              r.label as string,
    paid:               r.paid as boolean,
    unit:               r.unit as LeaveType['unit'],
    requiresAttachment: r.requires_attachment as boolean,
    requiresApproval:   r.requires_approval as boolean,
    accrualRate:        r.accrual_rate != null ? Number(r.accrual_rate) : null,
    accrualCadence:     r.accrual_cadence as LeaveType['accrualCadence'],
    maxCarryover:       r.max_carryover != null ? Number(r.max_carryover) : null,
    appliesToScope:     r.applies_to_scope as LeaveType['appliesToScope'],
    appliesToValue:     (r.applies_to_value as string | null) ?? null,
    color:              (r.color as string | null) ?? null,
    isActive:           r.is_active as boolean,
    createdAt:          r.created_at as string,
    updatedAt:          (r.updated_at as string | null) ?? null,
  };
}

// ── Queries ──────────────────────────────────────────────────────────────────

export async function listLeaveTypes(includeInactive = false): Promise<LeaveType[]> {
  let q = sb.from('hr_leave_types').select('*').order('label');
  if (!includeInactive) q = q.eq('is_active', true);
  const { data, error } = await q;
  if (error) throw err(500, `Failed to list leave types: ${error.message}`);
  return (data ?? []).map(r => mapRow(r as Record<string, unknown>));
}

export async function getLeaveType(id: string): Promise<LeaveType> {
  const { data, error } = await sb.from('hr_leave_types').select('*').eq('id', id).maybeSingle();
  if (error) throw err(500, `Failed to get leave type: ${error.message}`);
  if (!data) throw err(404, 'Leave type not found.');
  return mapRow(data as Record<string, unknown>);
}

// ── Mutations ────────────────────────────────────────────────────────────────

export async function createLeaveType(
  actorId: string,
  args: Partial<LeaveType> & { code: string; label: string },
): Promise<LeaveType> {
  // Check unique code
  const { data: existing } = await sb.from('hr_leave_types').select('id').eq('code', args.code).maybeSingle();
  if (existing) throw err(409, `Leave type with code '${args.code}' already exists.`);

  const insert = {
    code:               args.code,
    label:              args.label,
    paid:               args.paid ?? true,
    unit:               args.unit ?? 'days',
    requires_attachment: args.requiresAttachment ?? false,
    requires_approval:   args.requiresApproval ?? true,
    accrual_rate:        args.accrualRate ?? null,
    accrual_cadence:     args.accrualCadence ?? 'annual',
    max_carryover:       args.maxCarryover ?? null,
    applies_to_scope:    args.appliesToScope ?? 'all',
    applies_to_value:    args.appliesToValue ?? null,
    color:               args.color ?? null,
    is_active:           args.isActive ?? true,
  };

  const { data, error } = await sb.from('hr_leave_types').insert(insert).select().single();
  if (error) throw err(500, `Failed to create leave type: ${error.message}`);

  const row = mapRow(data as Record<string, unknown>);
  await writeHrAudit({ submoduleKey: 'leave_types', recordId: row.id, actorId, action: 'hr.leave_type.created', newState: row });
  void emitAppEvent({ eventType: 'hr.leave_type.created', sourceModule: 'hr', sourceEntityType: 'leave_type', sourceEntityId: row.id, actorUserId: actorId, severity: 'info', payload: { code: row.code, label: row.label } });
  return row;
}

export async function updateLeaveType(
  actorId: string,
  id: string,
  args: Partial<LeaveType>,
): Promise<LeaveType> {
  const existing = await getLeaveType(id);

  const patch: Record<string, unknown> = {};
  if (args.label              !== undefined) patch.label               = args.label;
  if (args.paid               !== undefined) patch.paid                = args.paid;
  if (args.unit               !== undefined) patch.unit                = args.unit;
  if (args.requiresAttachment !== undefined) patch.requires_attachment = args.requiresAttachment;
  if (args.requiresApproval   !== undefined) patch.requires_approval   = args.requiresApproval;
  if (args.accrualRate        !== undefined) patch.accrual_rate        = args.accrualRate;
  if (args.accrualCadence     !== undefined) patch.accrual_cadence     = args.accrualCadence;
  if (args.maxCarryover       !== undefined) patch.max_carryover       = args.maxCarryover;
  if (args.appliesToScope     !== undefined) patch.applies_to_scope    = args.appliesToScope;
  if (args.appliesToValue     !== undefined) patch.applies_to_value    = args.appliesToValue;
  if (args.color              !== undefined) patch.color               = args.color;
  if (args.isActive           !== undefined) patch.is_active           = args.isActive;

  const { data, error } = await sb.from('hr_leave_types').update(patch).eq('id', id).select().single();
  if (error) throw err(500, `Failed to update leave type: ${error.message}`);

  const updated = mapRow(data as Record<string, unknown>);
  await writeHrAudit({ submoduleKey: 'leave_types', recordId: id, actorId, action: 'hr.leave_type.updated', previousState: existing, newState: updated });
  void emitAppEvent({ eventType: 'hr.leave_type.updated', sourceModule: 'hr', sourceEntityType: 'leave_type', sourceEntityId: id, actorUserId: actorId, severity: 'info', payload: { code: updated.code } });
  return updated;
}

export async function retireLeaveType(actorId: string, id: string): Promise<void> {
  const existing = await getLeaveType(id);
  if (!existing.isActive) return; // idempotent

  const { error } = await sb.from('hr_leave_types').update({ is_active: false }).eq('id', id);
  if (error) throw err(500, `Failed to retire leave type: ${error.message}`);

  await writeHrAudit({ submoduleKey: 'leave_types', recordId: id, actorId, action: 'hr.leave_type.retired', previousState: { isActive: true }, newState: { isActive: false } });
  void emitAppEvent({ eventType: 'hr.leave_type.retired', sourceModule: 'hr', sourceEntityType: 'leave_type', sourceEntityId: id, actorUserId: actorId, severity: 'info', payload: { code: existing.code } });
}
