// ============================================================================
// Finance Payroll — Worksheet overrides (Wave 4a)
// ============================================================================
// A per-employee manual adjustment to a run, made AFTER inputs are locked and
// BEFORE final approval. Overrides are stored as SEPARATE run-input rows
// (source_type='pay_item', tagged metadata.override=true — the source_type CHECK
// constraint only allows base_pay/pay_item/overtime) so the original snapshot is
// preserved; recalculation aggregates them alongside pay items via metadata.kind.
// Every override carries a REASON + audit.
//
// Guards: only on 'input_locked' or 'calculated' runs (not draft/approved/locked).
// After adding/removing overrides the run must be re-calculated (calculateRun
// accepts 'calculated' → recompute).
// ============================================================================

import { sb } from '../db';
import { emitAppEvent } from '../appEvents';
import { writeHrAudit } from '../hr/employeeCore';
import { getPayrollRun } from './payrollRuns';

export interface OverrideDto {
  id: string;
  runId: string;
  employeeId: string;
  label: string;
  amount: number;
  kind: 'earning' | 'deduction';
  isTaxable: boolean;
  reducesChargeable: boolean;
  reason: string | null;
  createdAt: string;
}

interface DbInputRow {
  id: string; run_id: string; employee_id: string; label: string | null;
  amount: number | null; metadata: Record<string, unknown>; created_at: string;
}

function toDto(r: DbInputRow): OverrideDto {
  const m = r.metadata ?? {};
  return {
    id: r.id, runId: r.run_id, employeeId: r.employee_id,
    label: r.label ?? 'Adjustment', amount: Number(r.amount ?? 0),
    kind: (m['kind'] as OverrideDto['kind']) ?? 'earning',
    isTaxable: m['is_taxable'] !== false,
    reducesChargeable: m['reduces_chargeable'] === true,
    reason: (m['reason'] as string | undefined) ?? null,
    createdAt: r.created_at,
  };
}

const EDITABLE_STATUSES = ['input_locked', 'calculated'];

export interface AddOverrideInput {
  runId: string;
  employeeId: string;
  label: string;
  amount: number;
  kind: 'earning' | 'deduction';
  isTaxable?: boolean;
  reducesChargeable?: boolean;   // deduction only — pre-tax pension style
  reason: string;
}

export async function addOverride(input: AddOverrideInput, actorId: string): Promise<OverrideDto> {
  const run = await getPayrollRun(input.runId);
  if (!run) throw Object.assign(new Error('Payroll run not found.'), { status: 404 });
  if (!EDITABLE_STATUSES.includes(run.status)) {
    throw Object.assign(new Error(`Overrides can only be added while a run is input-locked or calculated (run is '${run.status}').`), { status: 422 });
  }
  if (!input.reason || !input.reason.trim()) {
    throw Object.assign(new Error('A reason is required for a worksheet override.'), { status: 422 });
  }
  if (!Number.isFinite(input.amount) || input.amount <= 0) {
    throw Object.assign(new Error('Override amount must be a positive number (kind sets earning vs deduction).'), { status: 422 });
  }

  // The employee must be part of this run (has a snapshot input).
  const { data: exists } = await sb.from('finance_payroll_run_inputs')
    .select('id').eq('run_id', input.runId).eq('employee_id', input.employeeId).limit(1);
  if (!exists || exists.length === 0) {
    throw Object.assign(new Error('That employee is not part of this payroll run.'), { status: 422 });
  }

  const metadata = {
    kind: input.kind,
    is_taxable: input.isTaxable !== false,
    reduces_chargeable: input.kind === 'deduction' ? input.reducesChargeable === true : false,
    override: true,
    reason: input.reason.trim(),
    created_by: actorId,
  };

  const { data, error } = await sb.from('finance_payroll_run_inputs').insert({
    run_id: input.runId, employee_id: input.employeeId,
    source_type: 'pay_item', source_id: null,
    component_code: 'override', label: input.label.trim() || 'Adjustment',
    amount: Math.round(input.amount * 100) / 100, quantity: null, rate: null,
    metadata,
  }).select('id, run_id, employee_id, label, amount, metadata, created_at').single<DbInputRow>();
  if (error) throw Object.assign(new Error('addOverride: ' + error.message), { status: 500 });

  await writeHrAudit({
    submoduleKey: 'finance_payroll', recordId: input.runId, actorId,
    action: 'payroll_run.override_added',
    newState: { employeeId: input.employeeId, label: input.label, amount: input.amount, kind: input.kind, reason: input.reason.trim() },
    reason: input.reason.trim(),
  });
  void emitAppEvent({
    eventType: 'finance.payroll.override.added', sourceModule: 'finance_payroll',
    sourceEntityType: 'payroll_run', sourceEntityId: input.runId, actorUserId: actorId, severity: 'info',
    payload: { employeeId: input.employeeId, kind: input.kind, amount: input.amount },
  });

  return toDto(data);
}

export async function removeOverride(overrideId: string, actorId: string): Promise<{ id: string; removed: true }> {
  const { data: row, error: getErr } = await sb.from('finance_payroll_run_inputs')
    .select('id, run_id, employee_id, metadata, label, amount')
    .eq('id', overrideId)
    .maybeSingle<{ id: string; run_id: string; employee_id: string; metadata: Record<string, unknown>; label: string | null; amount: number | null }>();
  if (getErr) throw Object.assign(new Error('removeOverride/get: ' + getErr.message), { status: 500 });
  if (!row) throw Object.assign(new Error('Override not found.'), { status: 404 });
  if (row.metadata?.['override'] !== true) throw Object.assign(new Error('That input is not a worksheet override.'), { status: 422 });

  const run = await getPayrollRun(row.run_id);
  if (!run) throw Object.assign(new Error('Payroll run not found.'), { status: 404 });
  if (!EDITABLE_STATUSES.includes(run.status)) {
    throw Object.assign(new Error(`Overrides can only be removed while a run is input-locked or calculated (run is '${run.status}').`), { status: 422 });
  }

  const { error } = await sb.from('finance_payroll_run_inputs').delete().eq('id', overrideId);
  if (error) throw Object.assign(new Error('removeOverride: ' + error.message), { status: 500 });

  await writeHrAudit({
    submoduleKey: 'finance_payroll', recordId: row.run_id, actorId,
    action: 'payroll_run.override_removed',
    previousState: { employeeId: row.employee_id, label: row.label, amount: row.amount },
    newState: { overrideId },
  });
  void emitAppEvent({
    eventType: 'finance.payroll.override.removed', sourceModule: 'finance_payroll',
    sourceEntityType: 'payroll_run', sourceEntityId: row.run_id, actorUserId: actorId, severity: 'info',
    payload: { overrideId, employeeId: row.employee_id },
  });

  return { id: overrideId, removed: true };
}

export async function listOverrides(runId: string): Promise<OverrideDto[]> {
  const { data, error } = await sb.from('finance_payroll_run_inputs')
    .select('id, run_id, employee_id, label, amount, metadata, created_at')
    .eq('run_id', runId).contains('metadata', { override: true })
    .order('created_at');
  if (error) throw Object.assign(new Error('listOverrides: ' + error.message), { status: 500 });
  return ((data ?? []) as DbInputRow[]).map(toDto);
}
