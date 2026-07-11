// ============================================================================
// Finance Payroll — Overtime rules (Wave 4b)
// ============================================================================
// Configurable, effective-dated OT multipliers by event type. The resolver is
// PURE (no DB) so it's unit-testable; lockInputs uses loadActiveOvertimeRules +
// resolveOvertimeMultiplier to price OT entries by their ot_type + work_date.
// ============================================================================

import { sb } from '../db';
import { emitAppEvent } from '../appEvents';
import { writeHrAudit } from '../hr/employeeCore';
import { resolveOvertimeMultiplier, type OvertimeRule, type OvertimeEventType } from './overtimeResolver';

// Re-export the pure resolver + types so callers have one import surface.
export { resolveOvertimeMultiplier };
export type { OvertimeRule, OvertimeEventType };

interface DbRuleRow {
  id: string; code: string; event_type: OvertimeEventType; multiplier: number;
  minimum_hours: number | null; active: boolean; effective_from: string;
  effective_to: string | null; created_at: string;
}

function toDto(r: DbRuleRow): OvertimeRule {
  return {
    id: r.id, code: r.code, eventType: r.event_type, multiplier: Number(r.multiplier),
    minimumHours: r.minimum_hours != null ? Number(r.minimum_hours) : null,
    active: r.active, effectiveFrom: r.effective_from, effectiveTo: r.effective_to, createdAt: r.created_at,
  };
}

// ── DB access ────────────────────────────────────────────────────────────────

export async function loadActiveOvertimeRules(): Promise<OvertimeRule[]> {
  const { data, error } = await sb.from('finance_overtime_rules').select('*').eq('active', true);
  if (error) throw Object.assign(new Error('loadActiveOvertimeRules: ' + error.message), { status: 500 });
  return ((data ?? []) as DbRuleRow[]).map(toDto);
}

export async function listOvertimeRules(): Promise<OvertimeRule[]> {
  const { data, error } = await sb.from('finance_overtime_rules').select('*')
    .order('event_type').order('effective_from', { ascending: false });
  if (error) throw Object.assign(new Error('listOvertimeRules: ' + error.message), { status: 500 });
  return ((data ?? []) as DbRuleRow[]).map(toDto);
}

export interface CreateOvertimeRuleInput {
  code: string;
  eventType: OvertimeEventType;
  multiplier: number;
  minimumHours?: number | null;
  effectiveFrom: string;
  effectiveTo?: string | null;
}

export async function createOvertimeRule(input: CreateOvertimeRuleInput, actorId: string): Promise<OvertimeRule> {
  const code = input.code.trim().toUpperCase();
  if (!code) throw Object.assign(new Error('Rule code is required.'), { status: 422 });
  if (!(input.multiplier > 0)) throw Object.assign(new Error('Multiplier must be greater than 0.'), { status: 422 });

  const { data, error } = await sb.from('finance_overtime_rules').insert({
    code, event_type: input.eventType, multiplier: input.multiplier,
    minimum_hours: input.minimumHours ?? null,
    effective_from: input.effectiveFrom, effective_to: input.effectiveTo ?? null,
    created_by: actorId,
  }).select('*').single<DbRuleRow>();
  if (error) {
    if (error.code === '23505') throw Object.assign(new Error(`Overtime rule code "${code}" already exists.`), { status: 409 });
    throw Object.assign(new Error('createOvertimeRule: ' + error.message), { status: 500 });
  }

  const dto = toDto(data);
  await writeHrAudit({
    submoduleKey: 'finance_payroll', recordId: dto.id, actorId,
    action: 'overtime_rule.created',
    newState: { code: dto.code, eventType: dto.eventType, multiplier: dto.multiplier, minimumHours: dto.minimumHours },
  });
  void emitAppEvent({
    eventType: 'finance.payroll.overtime_rule.created', sourceModule: 'finance_payroll',
    sourceEntityType: 'overtime_rule', sourceEntityId: dto.id, actorUserId: actorId, severity: 'info',
    payload: { code: dto.code, eventType: dto.eventType, multiplier: dto.multiplier },
  });
  return dto;
}

export async function setOvertimeRuleActive(id: string, active: boolean, actorId: string): Promise<OvertimeRule> {
  const { data, error } = await sb.from('finance_overtime_rules')
    .update({ active, updated_at: new Date().toISOString() }).eq('id', id).select('*').single<DbRuleRow>();
  if (error) throw Object.assign(new Error('setOvertimeRuleActive: ' + error.message), { status: 500 });
  await writeHrAudit({
    submoduleKey: 'finance_payroll', recordId: id, actorId,
    action: active ? 'overtime_rule.activated' : 'overtime_rule.deactivated',
    newState: { active },
  });
  return toDto(data);
}
