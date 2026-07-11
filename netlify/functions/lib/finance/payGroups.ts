// ============================================================================
// Finance Payroll — Pay groups (Wave 3b)
// ============================================================================
// CRUD + membership for pay groups. A run scoped to a group takes the group's
// frequency and only populates that group's members (see payrollRuns.lockInputs).
// ============================================================================

import { sb } from '../db';
import { emitAppEvent } from '../appEvents';
import { writeHrAudit } from '../hr/employeeCore';

export interface PayGroupDto {
  id: string;
  code: string;
  name: string;
  frequency: 'weekly' | 'fortnightly' | 'semi_monthly' | 'monthly';
  defaultPayDay: number | null;
  defaultCutoffOffsetDays: number;
  statutoryCountry: string;
  active: boolean;
  memberCount?: number;
  createdAt: string;
}

interface DbPayGroupRow {
  id: string; code: string; name: string;
  frequency: PayGroupDto['frequency'];
  default_pay_day: number | null; default_cutoff_offset_days: number;
  statutory_country: string; active: boolean; created_at: string;
}

function toDto(r: DbPayGroupRow): PayGroupDto {
  return {
    id: r.id, code: r.code, name: r.name, frequency: r.frequency,
    defaultPayDay: r.default_pay_day, defaultCutoffOffsetDays: r.default_cutoff_offset_days,
    statutoryCountry: r.statutory_country, active: r.active, createdAt: r.created_at,
  };
}

// ── List / get ──────────────────────────────────────────────────────────────

export async function listPayGroups(opts: { activeOnly?: boolean } = {}): Promise<PayGroupDto[]> {
  let q = sb.from('finance_pay_groups').select('*').order('name');
  if (opts.activeOnly) q = q.eq('active', true);
  const { data, error } = await q;
  if (error) throw Object.assign(new Error('listPayGroups: ' + error.message), { status: 500 });
  const groups = ((data ?? []) as DbPayGroupRow[]).map(toDto);

  // Current member counts (assignments with no end date or ending in the future).
  const today = new Date().toISOString().slice(0, 10);
  const { data: members } = await sb.from('finance_employee_pay_group_assignments')
    .select('pay_group_id, effective_to');
  const counts = new Map<string, number>();
  for (const m of (members ?? []) as Array<{ pay_group_id: string; effective_to: string | null }>) {
    if (m.effective_to && m.effective_to < today) continue;
    counts.set(m.pay_group_id, (counts.get(m.pay_group_id) ?? 0) + 1);
  }
  for (const g of groups) g.memberCount = counts.get(g.id) ?? 0;
  return groups;
}

export async function getPayGroup(id: string): Promise<PayGroupDto | null> {
  const { data, error } = await sb.from('finance_pay_groups').select('*').eq('id', id).maybeSingle<DbPayGroupRow>();
  if (error) throw Object.assign(new Error('getPayGroup: ' + error.message), { status: 500 });
  return data ? toDto(data) : null;
}

// ── Create ────────────────────────────────────────────────────────────────────

export interface CreatePayGroupInput {
  code: string;
  name: string;
  frequency: PayGroupDto['frequency'];
  defaultPayDay?: number | null;
  defaultCutoffOffsetDays?: number;
  statutoryCountry?: string;
}

export async function createPayGroup(input: CreatePayGroupInput, actorId: string): Promise<PayGroupDto> {
  const code = input.code.trim().toUpperCase();
  if (!code) throw Object.assign(new Error('Pay group code is required.'), { status: 422 });
  if (!input.name.trim()) throw Object.assign(new Error('Pay group name is required.'), { status: 422 });

  const { data, error } = await sb.from('finance_pay_groups').insert({
    code, name: input.name.trim(), frequency: input.frequency,
    default_pay_day: input.defaultPayDay ?? null,
    default_cutoff_offset_days: input.defaultCutoffOffsetDays ?? 0,
    statutory_country: input.statutoryCountry ?? 'TT',
    created_by: actorId,
  }).select('*').single<DbPayGroupRow>();
  if (error) {
    if (error.code === '23505') throw Object.assign(new Error(`Pay group code "${code}" already exists.`), { status: 409 });
    throw Object.assign(new Error('createPayGroup: ' + error.message), { status: 500 });
  }

  const dto = toDto(data);
  await writeHrAudit({
    submoduleKey: 'finance_payroll', recordId: dto.id, actorId,
    action: 'pay_group.created', newState: { code: dto.code, name: dto.name, frequency: dto.frequency },
  });
  void emitAppEvent({
    eventType: 'finance.payroll.pay_group.created', sourceModule: 'finance_payroll',
    sourceEntityType: 'pay_group', sourceEntityId: dto.id, actorUserId: actorId, severity: 'info',
    payload: { code: dto.code, frequency: dto.frequency },
  });
  return dto;
}

// ── Membership ────────────────────────────────────────────────────────────────

export interface AssignEmployeeInput {
  employeeId: string;
  payGroupId: string;
  effectiveFrom: string;      // YYYY-MM-DD
  effectiveTo?: string | null;
}

export async function assignEmployee(input: AssignEmployeeInput, actorId: string): Promise<{ employeeId: string; payGroupId: string }> {
  const group = await getPayGroup(input.payGroupId);
  if (!group) throw Object.assign(new Error('Pay group not found.'), { status: 404 });
  if (input.effectiveTo && input.effectiveTo < input.effectiveFrom) {
    throw Object.assign(new Error('effectiveTo must be on or after effectiveFrom.'), { status: 422 });
  }

  // Business intent: moving to a new group ENDS the previous membership — close
  // any open assignment that started before this one (ends the day before the
  // new start). Overlaps the close can't resolve are rejected by the DB
  // exclusion constraint (one active group per employee per date).
  const dayBefore = new Date(Date.parse(input.effectiveFrom) - 86_400_000).toISOString().slice(0, 10);
  const { error: closeErr } = await sb.from('finance_employee_pay_group_assignments')
    .update({ effective_to: dayBefore })
    .eq('employee_id', input.employeeId)
    .is('effective_to', null)
    .lt('effective_from', input.effectiveFrom);
  if (closeErr) throw Object.assign(new Error('assignEmployee/close-previous: ' + closeErr.message), { status: 500 });

  const { error } = await sb.from('finance_employee_pay_group_assignments').upsert({
    employee_id: input.employeeId, pay_group_id: input.payGroupId,
    effective_from: input.effectiveFrom, effective_to: input.effectiveTo ?? null,
    created_by: actorId,
  }, { onConflict: 'employee_id,pay_group_id,effective_from' });
  if (error) {
    // 23P01 = exclusion violation — the requested range still overlaps another assignment.
    if (error.code === '23P01') {
      throw Object.assign(new Error('This employee already has a pay-group assignment covering part of that period. End the existing assignment first.'), { status: 409 });
    }
    throw Object.assign(new Error('assignEmployee: ' + error.message), { status: 500 });
  }

  await writeHrAudit({
    submoduleKey: 'finance_payroll', recordId: input.payGroupId, actorId,
    action: 'pay_group.employee_assigned',
    newState: { employeeId: input.employeeId, payGroupId: input.payGroupId, effectiveFrom: input.effectiveFrom, effectiveTo: input.effectiveTo ?? null },
  });
  return { employeeId: input.employeeId, payGroupId: input.payGroupId };
}

/**
 * Employee ids assigned to a pay group and active for the given period
 * (effective_from <= periodEnd AND (effective_to is null OR effective_to >= periodStart)).
 */
export async function listGroupMemberIds(payGroupId: string, periodStart: string, periodEnd: string): Promise<string[]> {
  const { data, error } = await sb.from('finance_employee_pay_group_assignments')
    .select('employee_id, effective_from, effective_to')
    .eq('pay_group_id', payGroupId)
    .lte('effective_from', periodEnd);
  if (error) throw Object.assign(new Error('listGroupMemberIds: ' + error.message), { status: 500 });
  const ids = new Set<string>();
  for (const r of (data ?? []) as Array<{ employee_id: string; effective_to: string | null }>) {
    if (r.effective_to && r.effective_to < periodStart) continue;
    ids.add(r.employee_id);
  }
  return [...ids];
}

export interface PayGroupMemberDto { employeeId: string; effectiveFrom: string; effectiveTo: string | null }

export async function listGroupMembers(payGroupId: string): Promise<PayGroupMemberDto[]> {
  const { data, error } = await sb.from('finance_employee_pay_group_assignments')
    .select('employee_id, effective_from, effective_to')
    .eq('pay_group_id', payGroupId).order('effective_from', { ascending: false });
  if (error) throw Object.assign(new Error('listGroupMembers: ' + error.message), { status: 500 });
  return ((data ?? []) as Array<{ employee_id: string; effective_from: string; effective_to: string | null }>)
    .map(r => ({ employeeId: r.employee_id, effectiveFrom: r.effective_from, effectiveTo: r.effective_to }));
}
