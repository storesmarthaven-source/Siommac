// ============================================================================
// Finance Payroll -- Back pay (retro adjustment) (Wave 7c, rebuilt P2-a)
// ============================================================================
// A retro adjustment recomputes an employee's base for PRIOR finalised periods
// and pays the DELTA on the CURRENT run, taxed at current-period rates. It is
// stored as a taxable `pay_item` earning (metadata.back_pay=true) so
// calculateRun folds it into gross/PAYE exactly like any other earning.
// Prior runs are never mutated; only the delta is paid now.
//
// P2-a rebuild adds:
//   - pay-group scoping: only include prior runs that match the current run's
//     pay_group_id (if the current run is grouped) and pay_frequency.
//   - effective-date parameter: stored in the adjustment metadata and used to
//     derive the content-keyed idempotency key; the period range is controlled
//     by fromPeriodMonth (backward-compatible).
//   - Content-keyed idempotency: the idem key is derived from
//     (fromPeriodMonth|effectiveDate|correctedPeriodBase) so distinct
//     adjustments (e.g. two different effective dates) are allowed to coexist
//     on the same run, while an identical retry dedupes cleanly.
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
  /** When the correction became effective. Defaults to fromPeriodMonth if not provided. */
  effectiveDate: string;
  correctedPeriodBase: number;
  periods: BackPayPeriod[];
  totalDelta: number;
  /** Descriptor of the pay-group + frequency scope applied when filtering prior runs. */
  scope: { payGroupId: string | null; payFrequency: string };
}

export interface ComputeBackPayInput {
  currentRunId: string;
  employeeId: string;
  /** Recompute affected prior runs from this period (inclusive, YYYY-MM-DD). */
  fromPeriodMonth: string;
  /** What base SHOULD have been per period. */
  correctedPeriodBase: number;
  /**
   * When the salary correction became effective (YYYY-MM-DD).
   * GATES which prior periods are corrected: only periods on/after this date are
   * included (a raise effective in Feb must not back-pay January). It tightens
   * fromPeriodMonth's lower bound; it never widens it. Defaults to fromPeriodMonth.
   */
  effectiveDate?: string;
}

/**
 * Derive the idempotency key for a back-pay adjustment. An adjustment's IDENTITY
 * is what+when — the period range (fromPeriodMonth) and when it took effect
 * (effectiveDate) — NOT its value. So the corrected base is deliberately excluded:
 *   - same fromPeriodMonth + effectiveDate + SAME base  -> identical retry (dedupe)
 *   - same fromPeriodMonth + effectiveDate + DIFFERENT base -> CONFLICT (409): two
 *     contradictory corrections for the same periods can't coexist.
 *   - different fromPeriodMonth or effectiveDate -> a distinct adjustment (allowed).
 */
export function backPayIdemKey(
  fromPeriodMonth: string,
  effectiveDate: string,
): string {
  return `${fromPeriodMonth}|${effectiveDate}`;
}

/**
 * Recompute the retro delta from every finalised prior run in the range
 * [max(fromPeriodMonth, effectiveDate), currentRun.periodMonth) that:
 *   - Match the current run's pay_frequency (avoids mixing weekly/monthly).
 *   - Match the current run's pay_group_id when the run is grouped (avoids
 *     including runs outside the pay-group's scope).
 *   - Have an actual run_line for this employee (proves they were paid that period).
 * Read-only — mutates nothing.
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

  const effectiveDate = input.effectiveDate ?? input.fromPeriodMonth;
  // effectiveDate gates the corrected periods: the range starts at the LATER of
  // fromPeriodMonth and effectiveDate, so a correction effective mid-range never
  // back-pays periods before it took effect.
  const rangeStart = effectiveDate > input.fromPeriodMonth ? effectiveDate : input.fromPeriodMonth;

  // ── Query: prior finalised runs in range, scoped to pay-group + frequency ───
  // pay_group_id filter: if the current run belongs to a pay group, only include
  // prior runs from the SAME group (prevents mixing cross-group figures).
  // If the current run is ungrouped (pay_group_id IS NULL), we include all prior
  // runs matching the frequency — preserving the legacy ungrouped behaviour.
  type PriorRunRow = { id: string; period_month: string };
  let q = sb.from('finance_payroll_runs')
    .select('id, period_month')
    .in('status', ['locked', 'exported'])
    .gte('period_month', rangeStart)
    .lt('period_month', run.periodMonth)
    .eq('pay_frequency', run.payFrequency)       // must match the current run's frequency
    .order('period_month');

  if (run.payGroupId) {
    q = q.eq('pay_group_id', run.payGroupId);    // same pay group (grouped run)
  }

  const { data: priorRuns, error: prErr } = await q;
  if (prErr) throw Object.assign(new Error('computeBackPay/runs: ' + prErr.message), { status: 500 });

  const runById = new Map<string, string>(
    (priorRuns ?? []).map((r: PriorRunRow) => [r.id, r.period_month]),
  );
  const runIds = [...runById.keys()];

  // ── Query: only periods where the employee actually has a run_line ───────────
  // A run_line proves the employee was paid in that period; an absent line means
  // they weren't on that payroll (e.g. they joined mid-year) and we must exclude it.
  const periods: BackPayPeriod[] = [];
  if (runIds.length > 0) {
    const { data: lines, error: lErr } = await sb.from('finance_payroll_run_lines')
      .select('run_id, base')
      .in('run_id', runIds).eq('employee_id', input.employeeId);
    if (lErr) throw Object.assign(new Error('computeBackPay/lines: ' + lErr.message), { status: 500 });
    for (const l of (lines ?? []) as Array<{ run_id: string; base: number }>) {
      const oldBase = round2(l.base);
      const delta = round2(input.correctedPeriodBase - oldBase);
      periods.push({
        runId:         l.run_id,
        periodMonth:   runById.get(l.run_id) ?? '',
        oldBase,
        correctedBase: round2(input.correctedPeriodBase),
        delta,
      });
    }
    periods.sort((a, b) => a.periodMonth.localeCompare(b.periodMonth));
  }

  const totalDelta = round2(periods.reduce((s, p) => s + p.delta, 0));
  return {
    employeeId:          input.employeeId,
    currentRunId:        input.currentRunId,
    fromPeriodMonth:     input.fromPeriodMonth,
    effectiveDate,
    correctedPeriodBase: round2(input.correctedPeriodBase),
    periods,
    totalDelta,
    scope: { payGroupId: run.payGroupId, payFrequency: run.payFrequency },
  };
}

export interface AddBackPayInput extends ComputeBackPayInput { reason: string; }

export interface AddBackPayResult { inputId: string; breakdown: BackPayBreakdown; }

/**
 * Add the computed retro delta as a taxable back-pay earning on the current run.
 * The run must be input_locked/calculated and the employee must be a member.
 * Requires a positive delta and a reason. A recalculate applies it (gross+PAYE).
 *
 * Idempotency (content-keyed):
 *   - Same (run, employee, fromPeriodMonth, effectiveDate, correctedBase) → returns
 *     the existing row without creating a duplicate.
 *   - A DIFFERENT adjustment (different key) for the same run+employee → allowed,
 *     both rows coexist and their deltas are summed on recalculate.
 *   - A row with the SAME idem key but different amount (data race / corruption) →
 *     rejected with 409.
 */
export async function addBackPay(input: AddBackPayInput, actorId: string): Promise<AddBackPayResult> {
  const run = await getPayrollRun(input.currentRunId);
  if (!run) throw Object.assign(new Error('Payroll run not found.'), { status: 404 });
  if (!EDITABLE_STATUSES.includes(run.status)) {
    throw Object.assign(
      new Error(`Back pay can only be added while a run is input-locked or calculated (run is '${run.status}').`),
      { status: 422 },
    );
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
    throw Object.assign(
      new Error('No positive back-pay delta for the selected periods (corrected base is not higher than what was paid).'),
      { status: 422 },
    );
  }

  const idemKey = backPayIdemKey(input.fromPeriodMonth, breakdown.effectiveDate);

  const metadata = {
    kind: 'earning', is_taxable: true, reduces_chargeable: false,
    back_pay: true, reason: input.reason.trim(), created_by: actorId,
    from_period:            input.fromPeriodMonth,
    effective_date:         breakdown.effectiveDate,
    corrected_period_base:  breakdown.correctedPeriodBase,
    back_pay_idem_key:      idemKey,
    scope_pay_group_id:     breakdown.scope.payGroupId,
    scope_pay_frequency:    breakdown.scope.payFrequency,
    source_periods: breakdown.periods.map(p => ({
      runId: p.runId, periodMonth: p.periodMonth, delta: p.delta,
    })),
  };

  const { data, error } = await sb.from('finance_payroll_run_inputs').insert({
    run_id:         input.currentRunId,
    employee_id:    input.employeeId,
    source_type:    'pay_item',
    source_id:      null,
    component_code: 'back_pay',
    label:          'Back Pay',
    amount:         breakdown.totalDelta,
    quantity:       null,
    rate:           null,
    metadata,
  }).select('id').single<{ id: string }>();

  if (error) {
    // 23505 = unique violation — check whether it is the idem index or a conflict
    if (error.code === '23505') {
      const { data: existing } = await sb.from('finance_payroll_run_inputs')
        .select('id, amount, metadata')
        .eq('run_id', input.currentRunId)
        .eq('employee_id', input.employeeId)
        .eq('component_code', 'back_pay')
        .eq('metadata->>back_pay_idem_key' as string, idemKey)
        .maybeSingle<{ id: string; amount: number; metadata: Record<string, unknown> }>();

      if (existing) {
        // Identical retry → idempotent: return the existing row without a new event.
        if (Math.abs(round2(existing.amount) - breakdown.totalDelta) < 0.001) {
          return { inputId: existing.id, breakdown };
        }
        // Same idem key but different amount — data race / inconsistency.
        throw Object.assign(
          new Error('A back-pay adjustment with identical parameters already exists but with a different amount. Investigate before retrying.'),
          { status: 409 },
        );
      }

      // No row with our idem key — the violation came from a DIFFERENT unique index
      // (shouldn't happen with the new partial index, but guard defensively).
      throw Object.assign(
        new Error('Back-pay insertion failed due to a uniqueness conflict. Check for duplicate adjustments on this run.'),
        { status: 409 },
      );
    }
    throw Object.assign(new Error('addBackPay: ' + error.message), { status: 500 });
  }

  await writeHrAudit({
    submoduleKey: 'finance_payroll', recordId: input.currentRunId, actorId,
    action: 'payroll_run.back_pay_added',
    newState: {
      employeeId:          input.employeeId,
      totalDelta:          breakdown.totalDelta,
      periods:             breakdown.periods.length,
      fromPeriod:          input.fromPeriodMonth,
      effectiveDate:       breakdown.effectiveDate,
      correctedPeriodBase: breakdown.correctedPeriodBase,
      idemKey,
    },
    reason: input.reason.trim(),
  });
  void emitAppEvent({
    eventType:        'finance.payroll.back_pay.added',
    sourceModule:     'finance_payroll',
    sourceEntityType: 'payroll_run',
    sourceEntityId:   input.currentRunId,
    actorUserId:      actorId,
    severity:         'info',
    payload: {
      employeeId:  input.employeeId,
      totalDelta:  breakdown.totalDelta,
      periods:     breakdown.periods.length,
      idemKey,
    },
  });

  return { inputId: data.id, breakdown };
}
