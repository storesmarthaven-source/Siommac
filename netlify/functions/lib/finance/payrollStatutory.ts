// ============================================================================
// Finance — T&T Statutory Calculators (Phase 3 Stage 2)
// ============================================================================
// PURE functions — no DB calls, no side-effects, no hardcoded rates.
// All rates/thresholds are passed in from the caller (read from the live
// finance_statutory_versions + finance_nis_classes rows at calculate time).
//
// Calculation order per §12:
//   1. Gross           = base + taxable allowances + approved OT
//   2. NIS             = find class by weekly insurable band × weeks_in_period
//                        (skip if !nisApplicable)
//   3. Health Surcharge = threshold test → weekly_high or weekly_low × weeks
//   4. Chargeable income = taxable_gross − monthly_personal_allowance
//                          − approved pre-tax pension items
//                          (NIS and HS are NOT subtracted before PAYE in T&T)
//   5. PAYE            = band1 up to ceiling, band2 on remainder; floor 0
//   6. Voluntary deductions
//   7. Net             = gross − nis_employee − health_surcharge − paye − voluntary_deductions
//
// Unit-tested in tests/unit/payrollStatutory.test.ts
// ============================================================================

import type { NisClassRow } from './statutoryConfig';

// ── NIS calculator ────────────────────────────────────────────────────────────

export interface ComputeNisInput {
  /** The employee's weekly insurable earnings (gross_monthly / weeks_in_period). */
  weeklyInsurable: number;
  /** The NIS class table for the active statutory version. */
  classes: NisClassRow[];
  /** Number of weeks in the pay period (typically 4.333 for monthly). */
  weeksInPeriod: number;
  /** Whether NIS is applicable for this employee. If false, returns zeros. */
  nisApplicable: boolean;
}

export interface ComputeNisResult {
  /** NIS employee contribution for the period. */
  employee: number;
  /** NIS employer contribution for the period. */
  employer: number;
  /** The matched NIS class number (or null if not applicable / not found). */
  classNo: number | null;
}

/**
 * Find the NIS class for a given weekly insurable earnings value.
 * Classes are searched in ascending order. The last class (open-ended, weekly_max=null)
 * matches any earnings above its weekly_min.
 */
export function findNisClass(
  weeklyInsurable: number,
  classes: NisClassRow[],
): NisClassRow | null {
  if (classes.length === 0) return null;

  // Sort by class_no ascending to walk the table in order
  const sorted = [...classes].sort((a, b) => a.classNo - b.classNo);

  for (const cls of sorted) {
    const aboveMin = weeklyInsurable >= cls.weeklyMin;
    const belowMax = cls.weeklyMax === null || weeklyInsurable <= cls.weeklyMax;
    if (aboveMin && belowMax) return cls;
  }

  return null;
}

export function computeNis(input: ComputeNisInput): ComputeNisResult {
  if (!input.nisApplicable) {
    return { employee: 0, employer: 0, classNo: null };
  }

  const cls = findNisClass(input.weeklyInsurable, input.classes);
  if (!cls) {
    return { employee: 0, employer: 0, classNo: null };
  }

  const employee = round2(cls.employeeWeekly * input.weeksInPeriod);
  const employer = round2(cls.employerWeekly * input.weeksInPeriod);
  return { employee, employer, classNo: cls.classNo };
}

// ── Health Surcharge calculator ───────────────────────────────────────────────

export interface ComputeHealthSurchargeInput {
  /** Monthly income (gross) used for threshold test. */
  monthlyIncome: number;
  /** hs_monthly_threshold from the statutory version (e.g. 469.99). */
  threshold: number;
  /** hs_weekly_high from the statutory version (e.g. 8.25). */
  weeklyHigh: number;
  /** hs_weekly_low from the statutory version (e.g. 4.80). */
  weeklyLow: number;
  /** Weeks in the pay period (e.g. 4.333). */
  weeksInPeriod: number;
}

/**
 * T&T Health Surcharge:
 *   - If monthly income > threshold → weeklyHigh × weeksInPeriod
 *   - Otherwise                     → weeklyLow  × weeksInPeriod
 */
export function computeHealthSurcharge(input: ComputeHealthSurchargeInput): number {
  const weekly = input.monthlyIncome > input.threshold
    ? input.weeklyHigh
    : input.weeklyLow;
  return round2(weekly * input.weeksInPeriod);
}

// ── PAYE calculator ───────────────────────────────────────────────────────────

export interface ComputePayeInput {
  /** Chargeable income for the MONTH (after personal allowance + pre-tax pension deductions). */
  chargeableIncome: number;
  /** paye_personal_allowance from the statutory version (ANNUAL; must be divided by 12). */
  personalAllowance: number;
  /** paye_band1_ceiling from the statutory version (ANNUAL; must be divided by 12). */
  band1Ceiling: number;
  /** paye_band1_rate from the statutory version (e.g. 0.25). */
  band1Rate: number;
  /** paye_band2_rate from the statutory version (e.g. 0.30). */
  band2Rate: number;
}

/**
 * T&T PAYE (monthly calculation on chargeable income):
 *   - Band 1: chargeable_income up to monthly band1_ceiling × band1_rate
 *   - Band 2: any excess above monthly band1_ceiling × band2_rate
 *   - Floor: 0 (never negative)
 *
 * Note: personal_allowance and band1_ceiling in the DB are ANNUAL figures.
 * The monthly band1 ceiling is (band1_ceiling / 12).
 * The chargeableIncome passed in must already be the MONTHLY chargeable figure
 * (computed by the orchestrator as: taxable_gross − monthly_personal_allowance
 *  − approved_pre_tax_items; NIS/HS are NOT subtracted per T&T rules).
 */
export function computePaye(input: ComputePayeInput): number {
  if (input.chargeableIncome <= 0) return 0;

  const monthlyBand1Ceiling = input.band1Ceiling / 12;

  const band1Income = Math.min(input.chargeableIncome, monthlyBand1Ceiling);
  const band2Income = Math.max(0, input.chargeableIncome - monthlyBand1Ceiling);

  const tax = band1Income * input.band1Rate + band2Income * input.band2Rate;
  return round2(Math.max(0, tax));
}

// ── Orchestrator ──────────────────────────────────────────────────────────────

export interface ComputeRunLineInput {
  /** Monthly base salary (or computed equivalent for hourly employees). */
  basePay: number;
  /** Taxable allowances from approved active pay items. */
  taxableAllowances: number;
  /** Non-taxable allowances (housing, meal etc. if non-taxable). */
  nonTaxableAllowances: number;
  /** Approved OT amount (taxable). */
  approvedOtAmount: number;
  /** Approved pre-tax pension deductions (reduce_chargeable components). */
  preTaxPensionDeductions: number;
  /** Approved voluntary deductions (loan, union, salary advance). */
  voluntaryDeductions: number;
  /** NIS applicability for this employee. */
  nisApplicable: boolean;
  /** NIS class table from the active statutory version. */
  nisClasses: NisClassRow[];
  /** Weeks in period (from finance_payroll_runs.weeks_in_period). */
  weeksInPeriod: number;
  /** Statutory version rates. */
  statutory: {
    payePersonalAllowance: number;  // annual
    payeBand1Ceiling: number;       // annual
    payeBand1Rate: number;
    payeBand2Rate: number;
    hsMonthlyThreshold: number;
    hsWeeklyHigh: number;
    hsWeeklyLow: number;
  };
}

export interface ComputeRunLineResult {
  base: number;
  taxableGross: number;
  gross: number;
  nisEmployee: number;
  nisEmployer: number;
  nisClassNo: number | null;
  healthSurcharge: number;
  chargeableIncome: number;
  paye: number;
  voluntaryDeductions: number;
  net: number;
}

/**
 * Full per-employee payroll line calculation per §12 order.
 * All inputs come from the caller; no DB access.
 */
export function computeRunLine(input: ComputeRunLineInput): ComputeRunLineResult {
  const { statutory, weeksInPeriod } = input;

  // Step 1 — Gross
  const base          = round2(input.basePay);
  const taxableGross  = round2(base + input.taxableAllowances + input.approvedOtAmount);
  const gross         = round2(taxableGross + input.nonTaxableAllowances);

  // Step 2 — NIS (based on weekly insurable = taxableGross / weeksInPeriod)
  const weeklyInsurable = weeksInPeriod > 0 ? taxableGross / weeksInPeriod : 0;
  const nisResult = computeNis({
    weeklyInsurable,
    classes: input.nisClasses,
    weeksInPeriod,
    nisApplicable: input.nisApplicable,
  });

  // Step 3 — Health Surcharge (based on monthly gross)
  const healthSurcharge = computeHealthSurcharge({
    monthlyIncome: gross,
    threshold:    statutory.hsMonthlyThreshold,
    weeklyHigh:   statutory.hsWeeklyHigh,
    weeklyLow:    statutory.hsWeeklyLow,
    weeksInPeriod,
  });

  // Step 4 — Chargeable income
  //   = taxable_gross − monthly_personal_allowance − pre_tax_pension
  //   NIS and HS are NOT subtracted before PAYE in T&T
  const monthlyPersonalAllowance = statutory.payePersonalAllowance / 12;
  const chargeableIncome = round2(
    Math.max(0, taxableGross - monthlyPersonalAllowance - input.preTaxPensionDeductions)
  );

  // Step 5 — PAYE
  const paye = computePaye({
    chargeableIncome,
    personalAllowance: statutory.payePersonalAllowance,
    band1Ceiling:      statutory.payeBand1Ceiling,
    band1Rate:         statutory.payeBand1Rate,
    band2Rate:         statutory.payeBand2Rate,
  });

  // Step 6 — Voluntary deductions
  const voluntaryDeductions = round2(input.voluntaryDeductions);

  // Step 7 — Net
  const net = round2(
    gross - nisResult.employee - healthSurcharge - paye - voluntaryDeductions
  );

  return {
    base,
    taxableGross,
    gross,
    nisEmployee:        nisResult.employee,
    nisEmployer:        nisResult.employer,
    nisClassNo:         nisResult.classNo,
    healthSurcharge,
    chargeableIncome,
    paye,
    voluntaryDeductions,
    net,
  };
}

// ── Internal helper ───────────────────────────────────────────────────────────

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
