// ============================================================================
// Finance Payroll -- Back pay (retro adjustment) (Wave 7c)
// ============================================================================
// A retro adjustment recomputes an employee's base for PRIOR finalised periods
// against a corrected per-period base and pays the DELTA on the CURRENT run,
// taxed at the current period's rates. It is stored as a taxable `pay_item`
// earning input tagged metadata.back_pay=true — so calculateRun folds it into
// gross/PAYE exactly like any earning (no calc-path fork). The prior runs are
// never mutated; only the delta is paid now.
// ============================================================================

import { sb } from '../db';
import { emitAppEvent } from '../appEvents';
import { writeHrAudit } from '../hr/employeeCore';
import { getPayrollRun } from './payrollRuns';

const round2 = (n: number): number => Math.round((Number(n) || 0) * 100) / 100;
const EDITABLE_STATUSES = ['input_locked', 'calculated'];

export interface BackPayPeriod {
  runId: string;
  periodMonth: string;
  oldBase: number;
  correctedBase: number;
  delta: number;
}

export interface BackPayBreakdown {
  employeeId: string;
  currentRunId: string;
  fromPeriodMonth: string;
  correctedPeriodBase: number;
  periods: BackPayPeriod[];
  totalDelta: number;
}

export interface ComputeBackPayInput {
  currentRunId: string;
  employeeId: string;
  fromPeriodMonth: string;      // recompute affected prior runs from this period (inclusive)
  correctedPeriodBase: number;  // what base SHOULD have been per period
}

/**
 * Recompute the retro delta from every finalised prior run in the range
 * [fromPeriodMonth, currentRun.periodMonth). Read-only — mutates nothing.
 */
export async function computeBackPay(input: ComputeBackPayInput): Promise<BackPayBreakdown> {
  const run = await getPayrollRun(input.currentRunId);
  if (!run) throw Object.assign(new Error('Payroll run not found.'), { status: 404 });
  if (!Number.isFinite(input.correctedPeriodBase) || input.correctedPeriodBase <= 0) {
    throw Object.assign(new Error('Corrected per-period base must be a positive amount.'), { status: 422 });
  }
  if (input.fromPeriodMonth >= run.periodMonth) {
    throw Object.assign(new Error('The back-pay start period must be BEFORE the current run period.'), { status: 422 });
  }

  const { data: priorRuns, error: prErr } = await sb.from('finance_payroll_runs')
    .select('id, period_month')
    .in('status', ['locked', 'exported'])
    .gte('period_month', input.fromPeriodMonth).lt('period_month', run.periodMonth)
    .order('period_month');
  if (prErr) throw Object.assign(new Error('computeBackPay/runs: ' + prErr.message), { status: 500 });
  const runById = new Map<string, string>((priorRuns ?? []).map((r: { id: string; period_month: string }) => [r.id, r.period_month]));
  const runIds = [...runById.keys()];

  const periods: BackPayPeriod[] = [];
  if (runIds.length > 0) {
    const { data: lines, error: lErr } = await sb.from('finance_payroll_run_lines')
      .select('run_id, base')
      .in('run_id', runIds).eq('employee_id', input.employeeId);
    if (lErr) throw Object.assign(new Error('computeBackPay/lines: ' + lErr.message), { status: 500 });
    for (const l of (lines ?? []) as Array<{ run_id: string; base: number }>) {
      const oldBase = round2(l.base);
      const delta = round2(input.correctedPeriodBase - oldBase);
      periods.push({ runId: l.run_id, periodMonth: runById.get(l.run_id) ?? '', oldBase, correctedBase: round2(input.correctedPeriodBase), delta });
    }
    periods.sort((a, b) => a.periodMonth.localeCompare(b.periodMonth));
  }

  const totalDelta = round2(periods.reduce((s, p) => s + p.delta, 0));
  return { employeeId: input.employeeId, currentRunId: input.currentRunId, fromPeriodMonth: input.fromPeriodMonth, correctedPeriodBase: round2(input.correctedPeriodBase), periods, totalDelta };
}

export interface AddBackPayInput extends ComputeBackPayInput { reason: string; }

export interface AddBackPayResult { inputId: string; breakdown: BackPayBreakdown; }

/**
 * Add the computed retro delta as a taxable back-pay earning on the current run.
 * The run must be input_locked/calculated and the employee must be a member.
 * Requires a positive delta and a reason. A recalculate applies it (gross+PAYE).
 */
export async function addBackPay(input: AddBackPayInput, actorId: string): Promise<AddBackPayResult> {
  const run = await getPayrollRun(input.currentRunId);
  if (!run) throw Object.assign(new Error('Payroll run not found.'), { status: 404 });
  if (!EDITABLE_STATUSES.includes(run.status)) {
    throw Object.assign(new Error(`Back pay can only be added while a run is input-locked or calculated (run is '${run.status}').`), { status: 422 });
  }
  if (!input.reason || !input.reason.trim()) {
    throw Object.assign(new Error('A reason is required for a back-pay adjustment.'), { status: 422 });
  }

  // The employee must be part of this run.
  const { data: exists } = await sb.from('finance_payroll_run_inputs')
    .select('id').eq('run_id', input.currentRunId).eq('employee_id', input.employeeId).limit(1);
  if (!exists || exists.length === 0) {
    throw Object.assign(new Error('That employee is not part of this payroll run.'), { status: 422 });
  }

  const breakdown = await computeBackPay(input);
  if (breakdown.totalDelta <= 0) {
    throw Object.assign(new Error('No positive back-pay delta for the selected periods (corrected base is not higher than what was paid).'), { status: 422 });
  }

  const metadata = {
    kind: 'earning', is_taxable: true, reduces_chargeable: false,
    back_pay: true, reason: input.reason.trim(), created_by: actorId,
    from_period: input.fromPeriodMonth, corrected_period_base: breakdown.correctedPeriodBase,
    source_periods: breakdown.periods.map(p => ({ runId: p.runId, periodMonth: p.periodMonth, delta: p.delta })),
  };

  const { data, error } = await sb.from('finance_payroll_run_inputs').insert({
    run_id: input.currentRunId, employee_id: input.employeeId,
    source_type: 'pay_item', source_id: null,
    component_code: 'back_pay', label: 'Back Pay',
    amount: breakdown.totalDelta, quantity: null, rate: null, metadata,
  }).select('id').single<{ id: string }>();
  if (error) {
    // Idempotency guard (finance_run_inputs_backpay_once): one back-pay per run+employee.
    if (error.code === '23505') {
      const { data: existing } = await sb.from('finance_payroll_run_inputs')
        .select('id, amount, metadata')
        .eq('run_id', input.currentRunId).eq('employee_id', input.employeeId)
        .eq('component_code', 'back_pay')
        .maybeSingle<{ id: string; amount: number; metadata: Record<string, unknown> }>();
      const em = (existing?.metadata ?? {}) as { from_period?: string; corrected_period_base?: number };
      // Same request replayed → idempotent: return the existing row, emit nothing new.
      if (existing
        && round2(existing.amount) === breakdown.totalDelta
        && em.from_period === input.fromPeriodMonth
        && round2(em.corrected_period_base ?? NaN) === breakdown.correctedPeriodBase) {
        return { inputId: existing.id, breakdown };
      }
      // A DIFFERENT adjustment already exists for this employee on this run.
      throw Object.assign(
        new Error('This employee already has a back-pay adjustment on this run. Remove it before adding a different one.'),
        { status: 409 },
      );
    }
    throw Object.assign(new Error('addBackPay: ' + error.message), { status: 500 });
  }

  await writeHrAudit({
    submoduleKey: 'finance_payroll', recordId: input.currentRunId, actorId,
    action: 'payroll_run.back_pay_added',
    newState: { employeeId: input.employeeId, totalDelta: breakdown.totalDelta, periods: breakdown.periods.length, fromPeriod: input.fromPeriodMonth },
    reason: input.reason.trim(),
  });
  void emitAppEvent({
    eventType: 'finance.payroll.back_pay.added', sourceModule: 'finance_payroll',
    sourceEntityType: 'payroll_run', sourceEntityId: input.currentRunId, actorUserId: actorId, severity: 'info',
    payload: { employeeId: input.employeeId, totalDelta: breakdown.totalDelta, periods: breakdown.periods.length },
  });

  return { inputId: data.id, breakdown };
}
