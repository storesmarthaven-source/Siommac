/**
 * tests/unit/payrollStatutory.test.ts
 *
 * Unit tests for the T&T statutory payroll calculators.
 * All test values are derived BY HAND from the seeded TT 2026 statutory schedule
 * (migration 20260802000002_finance_statutory_config.sql):
 *   - NIS: 16-class table, 4.333 weeks/month
 *   - PAYE: personal allowance TTD 90,000/yr; band1 ceiling TTD 1,000,000/yr @ 25%; band2 @ 30%
 *   - Health Surcharge: threshold TTD 469.99/mo; high TTD 8.25/wk; low TTD 4.80/wk
 *
 * NIS class table excerpt used in assertions:
 *   Class 1:  200.00–339.99   EE 14.60  ER 29.20
 *   Class 5:  760.00–929.99   EE 45.60  ER 91.20
 *   Class 10: 1710.00–1909.99 EE 97.70  ER 195.40
 *   Class 16: 3138.00–∞       EE 169.50 ER 339.00
 */

import {
  computeNis,
  computeHealthSurcharge,
  computePaye,
  computeRunLine,
  findNisClass,
  payPeriodsForFrequency,
  weeksInPeriodForFrequency,
} from '../../netlify/functions/lib/finance/payrollStatutory';
import type { NisClassRow } from '../../netlify/functions/lib/finance/statutoryConfig';

// ── Test fixtures ──────────────────────────────────────────────────────────────

const WEEKS = 4.333; // standard monthly pay period

/**
 * Build a minimal NisClassRow for testing.
 * The id and timestamps are not used by the calculators.
 */
function cls(
  classNo: number,
  weeklyMin: number,
  weeklyMax: number | null,
  employeeWeekly: number,
  employerWeekly: number,
): NisClassRow {
  return {
    id: `test-cls-${classNo}`,
    statutoryVersionId: 'test-version',
    classNo, weeklyMin, weeklyMax,
    assumedAverageWeekly: null,
    employeeWeekly, employerWeekly,
    classZWeekly: null,
    createdAt: '2026-01-05T00:00:00Z',
  };
}

/**
 * Full 16-class NIS table seeded in migration 20260802000002.
 * EE and ER amounts are taken directly from the seed insert.
 */
const ALL_CLASSES: NisClassRow[] = [
  cls( 1,  200.00,  339.99,  14.60,  29.20),
  cls( 2,  340.00,  449.99,  21.30,  42.60),
  cls( 3,  450.00,  609.99,  28.60,  57.20),
  cls( 4,  610.00,  759.99,  37.00,  74.00),
  cls( 5,  760.00,  929.99,  45.60,  91.20),
  cls( 6,  930.00, 1119.99,  55.40, 110.80),
  cls( 7, 1120.00, 1299.99,  65.30, 130.60),
  cls( 8, 1300.00, 1489.99,  75.30, 150.60),
  cls( 9, 1490.00, 1709.99,  86.40, 172.80),
  cls(10, 1710.00, 1909.99,  97.70, 195.40),
  cls(11, 1910.00, 2139.99, 109.40, 218.80),
  cls(12, 2140.00, 2379.99, 122.00, 244.00),
  cls(13, 2380.00, 2629.99, 135.30, 270.60),
  cls(14, 2630.00, 2919.99, 149.90, 299.80),
  cls(15, 2920.00, 3137.99, 163.60, 327.20),
  cls(16, 3138.00,    null, 169.50, 339.00),
];

const TT_2026_STATUTORY = {
  payePersonalAllowance: 90000.00,   // annual
  payeBand1Ceiling:      1000000.00, // annual
  payeBand1Rate:         0.25,
  payeBand2Rate:         0.30,
  hsMonthlyThreshold:    469.99,
  hsWeeklyHigh:          8.25,
  hsWeeklyLow:           4.80,
};

// ── findNisClass ──────────────────────────────────────────────────────────────

describe('findNisClass', () => {
  it('returns null for empty class list', () => {
    expect(findNisClass(1000, [])).toBeNull();
  });

  it('returns null when weekly insurable is below the minimum of any class', () => {
    // Below class 1 min of 200.00
    expect(findNisClass(150.00, ALL_CLASSES)).toBeNull();
  });

  it('matches class 10 for weekly earnings of 1846.30 (8000 / 4.333)', () => {
    // monthly gross 8000 / 4.333 ≈ 1846.30 → class 10 (1710–1909.99)
    const result = findNisClass(8000 / WEEKS, ALL_CLASSES);
    expect(result).not.toBeNull();
    expect(result!.classNo).toBe(10);
    expect(result!.employeeWeekly).toBe(97.70);
    expect(result!.employerWeekly).toBe(195.40);
  });

  it('matches class 16 (open-ended) for weekly earnings well above 3138', () => {
    // monthly gross 100000 / 4.333 ≈ 23079 → class 16 (≥ 3138, no ceiling)
    const result = findNisClass(100000 / WEEKS, ALL_CLASSES);
    expect(result).not.toBeNull();
    expect(result!.classNo).toBe(16);
  });

  it('matches class 1 for weekly earnings at the lower boundary (200.00)', () => {
    const result = findNisClass(200.00, ALL_CLASSES);
    expect(result!.classNo).toBe(1);
  });
});

// ── computeNis ────────────────────────────────────────────────────────────────

describe('computeNis', () => {
  /**
   * Test Case A: Employee in class 10 (mid-table), monthly gross TTD 8,000.
   *
   * Weekly insurable = 8000 / 4.333 = 1846.30 → class 10 (1710–1909.99)
   *   NIS employee = 97.70 × 4.333 = 423.33 (rounded to 2dp)
   *   NIS employer = 195.40 × 4.333 = 846.67 (rounded to 2dp)
   */
  it('Case A — class 10 (monthly gross 8000): correct employee and employer amounts', () => {
    const result = computeNis({
      weeklyInsurable: 8000 / WEEKS,
      classes: ALL_CLASSES,
      weeksInPeriod: WEEKS,
      nisApplicable: true,
    });
    expect(result.classNo).toBe(10);
    expect(result.employee).toBe(423.33);
    expect(result.employer).toBe(846.67);
  });

  /**
   * Test Case B: NIS not applicable → all zeros.
   */
  it('Case B — NIS not applicable: returns zeros and null class', () => {
    const result = computeNis({
      weeklyInsurable: 8000 / WEEKS,
      classes: ALL_CLASSES,
      weeksInPeriod: WEEKS,
      nisApplicable: false,
    });
    expect(result.employee).toBe(0);
    expect(result.employer).toBe(0);
    expect(result.classNo).toBeNull();
  });

  /**
   * Test Case C: Weekly insurable below class 1 minimum (< 200) → no class found → zeros.
   * Monthly gross TTD 400 → weekly = 400/4.333 = 92.30 (below 200 min).
   */
  it('Case C — below class 1 min: returns zeros (class not found)', () => {
    const result = computeNis({
      weeklyInsurable: 400 / WEEKS,  // 92.30 — below class 1 min of 200
      classes: ALL_CLASSES,
      weeksInPeriod: WEEKS,
      nisApplicable: true,
    });
    expect(result.employee).toBe(0);
    expect(result.employer).toBe(0);
    expect(result.classNo).toBeNull();
  });

  /**
   * Test Case D: Class 16 (open-ended ceiling), monthly gross TTD 100,000.
   *
   * Weekly insurable = 100000 / 4.333 ≈ 23079 → class 16 (≥ 3138, no ceiling)
   *   NIS employee = 169.50 × 4.333 = 734.44
   *   NIS employer = 339.00 × 4.333 = 1468.89
   */
  it('Case D — class 16 (monthly gross 100000): open-ended top class', () => {
    const result = computeNis({
      weeklyInsurable: 100000 / WEEKS,
      classes: ALL_CLASSES,
      weeksInPeriod: WEEKS,
      nisApplicable: true,
    });
    expect(result.classNo).toBe(16);
    expect(result.employee).toBe(734.44);
    expect(result.employer).toBe(1468.89);
  });
});

// ── computeHealthSurcharge ────────────────────────────────────────────────────

describe('computeHealthSurcharge', () => {
  /**
   * Income above threshold (469.99): applies high rate (8.25/wk).
   * 8.25 × 4.333 = 35.75 (rounded to 2dp)
   */
  it('applies high rate when monthly income > threshold', () => {
    const result = computeHealthSurcharge({
      monthlyIncome: 8000,
      threshold:     TT_2026_STATUTORY.hsMonthlyThreshold,
      weeklyHigh:    TT_2026_STATUTORY.hsWeeklyHigh,
      weeklyLow:     TT_2026_STATUTORY.hsWeeklyLow,
      weeksInPeriod: WEEKS,
    });
    expect(result).toBe(35.75);
  });

  /**
   * Income at or below threshold (469.99): applies low rate (4.80/wk).
   * 4.80 × 4.333 = 20.80 (rounded to 2dp)
   */
  it('applies low rate when monthly income <= threshold', () => {
    const result = computeHealthSurcharge({
      monthlyIncome: 400,            // below 469.99
      threshold:     TT_2026_STATUTORY.hsMonthlyThreshold,
      weeklyHigh:    TT_2026_STATUTORY.hsWeeklyHigh,
      weeklyLow:     TT_2026_STATUTORY.hsWeeklyLow,
      weeksInPeriod: WEEKS,
    });
    expect(result).toBe(20.8);
  });

  /**
   * Exact threshold boundary (469.99): applies low rate.
   */
  it('applies low rate at exactly the threshold', () => {
    const result = computeHealthSurcharge({
      monthlyIncome: 469.99,
      threshold:     469.99,
      weeklyHigh:    8.25,
      weeklyLow:     4.80,
      weeksInPeriod: WEEKS,
    });
    expect(result).toBe(20.8);
  });
});

// ── computePaye ───────────────────────────────────────────────────────────────

describe('computePaye', () => {
  /**
   * Chargeable income within band1 (no band2): 500/month.
   * 500 × 0.25 = 125.00
   */
  it('band1 only (chargeable income within band1 ceiling)', () => {
    const result = computePaye({
      chargeableIncome:  500,
      personalAllowance: TT_2026_STATUTORY.payePersonalAllowance,
      band1Ceiling:      TT_2026_STATUTORY.payeBand1Ceiling,
      band1Rate:         TT_2026_STATUTORY.payeBand1Rate,
      band2Rate:         TT_2026_STATUTORY.payeBand2Rate,
    });
    expect(result).toBe(125);
  });

  /**
   * Chargeable income zero or below → PAYE is 0 (floor).
   */
  it('returns 0 when chargeable income is zero (below personal allowance)', () => {
    const result = computePaye({
      chargeableIncome:  0,
      personalAllowance: TT_2026_STATUTORY.payePersonalAllowance,
      band1Ceiling:      TT_2026_STATUTORY.payeBand1Ceiling,
      band1Rate:         TT_2026_STATUTORY.payeBand1Rate,
      band2Rate:         TT_2026_STATUTORY.payeBand2Rate,
    });
    expect(result).toBe(0);
  });

  /**
   * Chargeable income crossing band1 → band2: monthly chargeable 92,500.
   *
   * Monthly band1 ceiling = 1,000,000 / 12 = 83,333.33
   * Band1 tax = 83,333.33 × 0.25 = 20,833.33
   * Band2 income = 92,500 − 83,333.33 = 9,166.67
   * Band2 tax = 9,166.67 × 0.30 = 2,750.00
   * Total PAYE = 20,833.33 + 2,750.00 = 23,583.33
   */
  it('band1→band2 crossing (chargeable income 92500): correct split', () => {
    const result = computePaye({
      chargeableIncome:  92500,
      personalAllowance: TT_2026_STATUTORY.payePersonalAllowance,
      band1Ceiling:      TT_2026_STATUTORY.payeBand1Ceiling,
      band1Rate:         TT_2026_STATUTORY.payeBand1Rate,
      band2Rate:         TT_2026_STATUTORY.payeBand2Rate,
    });
    expect(result).toBe(23583.33);
  });
});

// ── Pay-frequency helpers + period-correct PAYE (Wave 3) ─────────────────────────

describe('pay-frequency helpers', () => {
  it('payPeriodsForFrequency maps each frequency to its annual period count', () => {
    expect(payPeriodsForFrequency('weekly')).toBe(52);
    expect(payPeriodsForFrequency('fortnightly')).toBe(26);
    expect(payPeriodsForFrequency('semi_monthly')).toBe(24);
    expect(payPeriodsForFrequency('monthly')).toBe(12);
    expect(payPeriodsForFrequency('off_cycle')).toBe(12); // unknown → monthly annualisation
  });

  it('weeksInPeriodForFrequency maps each frequency to its weeks/period', () => {
    expect(weeksInPeriodForFrequency('weekly')).toBe(1);
    expect(weeksInPeriodForFrequency('fortnightly')).toBe(2);
    expect(weeksInPeriodForFrequency('monthly')).toBeCloseTo(4.3333, 3);
    expect(weeksInPeriodForFrequency('semi_monthly')).toBeCloseTo(2.1667, 3);
  });
});

describe('computePaye — period-correct annualisation', () => {
  /**
   * The SAME chargeable amount must tax differently by frequency, because the annual
   * band-1 ceiling is divided by the pay periods (52 weekly vs 12 monthly).
   *   Weekly ceiling = 1,000,000 / 52 = 19,230.77
   *   chargeable 20,000 → band1 19,230.77 @25% (4,807.69) + band2 769.23 @30% (230.77) = 5,038.46
   *   Monthly ceiling = 1,000,000 / 12 = 83,333.33 → all 20,000 in band1 @25% = 5,000.00
   */
  it('weekly (payPeriods=52) crosses band2 where monthly (12) stays in band1', () => {
    const weekly = computePaye({
      chargeableIncome: 20000, personalAllowance: 90000, band1Ceiling: 1000000,
      band1Rate: 0.25, band2Rate: 0.30, payPeriods: 52,
    });
    const monthly = computePaye({
      chargeableIncome: 20000, personalAllowance: 90000, band1Ceiling: 1000000,
      band1Rate: 0.25, band2Rate: 0.30, payPeriods: 12,
    });
    expect(weekly).toBe(5038.46);
    expect(monthly).toBe(5000);
    expect(weekly).toBeGreaterThan(monthly);
  });

  it('defaults to monthly (12) when payPeriods is omitted (back-compat)', () => {
    const explicit = computePaye({ chargeableIncome: 20000, personalAllowance: 90000, band1Ceiling: 1000000, band1Rate: 0.25, band2Rate: 0.30, payPeriods: 12 });
    const omitted  = computePaye({ chargeableIncome: 20000, personalAllowance: 90000, band1Ceiling: 1000000, band1Rate: 0.25, band2Rate: 0.30 });
    expect(omitted).toBe(explicit);
  });
});

// ── computeRunLine (full orchestrator) ───────────────────────────────────────

describe('computeRunLine', () => {
  /**
   * Test Case 1: Mid-range salary employee, monthly gross TTD 8,000.
   *
   * Inputs: base=8000, no allowances, no OT, no pension deductions, no voluntary deductions.
   *
   * Expected:
   *   base          = 8,000.00
   *   taxableGross  = 8,000.00
   *   gross         = 8,000.00
   *   NIS employee  = 97.70 × 4.333 = 423.33  (class 10)
   *   NIS employer  = 195.40 × 4.333 = 846.67
   *   HS            = 8.25 × 4.333 = 35.75  (income > 469.99 → high)
   *   chargeable    = 8000 − (90000/12) = 8000 − 7500 = 500.00
   *   PAYE          = 500 × 0.25 = 125.00  (band1 only)
   *   voluntary     = 0
   *   net           = 8000 − 423.33 − 35.75 − 125.00 = 7,415.92
   */
  it('Case 1 — mid-range salary (8000): correct NIS class 10 + HS high + PAYE band1', () => {
    const result = computeRunLine({
      basePay:                 8000,
      taxableAllowances:       0,
      nonTaxableAllowances:    0,
      approvedOtAmount:        0,
      preTaxPensionDeductions: 0,
      voluntaryDeductions:     0,
      nisApplicable:           true,
      nisClasses:              ALL_CLASSES,
      weeksInPeriod:           WEEKS,
      statutory:               TT_2026_STATUTORY,
    });

    expect(result.base).toBe(8000);
    expect(result.taxableGross).toBe(8000);
    expect(result.gross).toBe(8000);
    expect(result.nisClassNo).toBe(10);
    expect(result.nisEmployee).toBe(423.33);
    expect(result.nisEmployer).toBe(846.67);
    expect(result.healthSurcharge).toBe(35.75);
    expect(result.chargeableIncome).toBe(500);
    expect(result.paye).toBe(125);
    expect(result.voluntaryDeductions).toBe(0);
    expect(result.net).toBe(7415.92);
  });

  /**
   * Test Case 2: NIS not applicable, monthly gross TTD 5,000.
   *
   * Expected:
   *   NIS employee  = 0
   *   NIS employer  = 0
   *   HS            = 8.25 × 4.333 = 35.75  (5000 > 469.99 → high)
   *   chargeable    = max(0, 5000 − 7500) = 0
   *   PAYE          = 0
   *   net           = 5000 − 0 − 35.75 − 0 = 4,964.25
   */
  it('Case 2 — NIS not applicable (5000): NIS zero, HS high, PAYE zero (below personal allowance)', () => {
    const result = computeRunLine({
      basePay:                 5000,
      taxableAllowances:       0,
      nonTaxableAllowances:    0,
      approvedOtAmount:        0,
      preTaxPensionDeductions: 0,
      voluntaryDeductions:     0,
      nisApplicable:           false,
      nisClasses:              ALL_CLASSES,
      weeksInPeriod:           WEEKS,
      statutory:               TT_2026_STATUTORY,
    });

    expect(result.nisEmployee).toBe(0);
    expect(result.nisEmployer).toBe(0);
    expect(result.nisClassNo).toBeNull();
    expect(result.healthSurcharge).toBe(35.75);
    expect(result.chargeableIncome).toBe(0);
    expect(result.paye).toBe(0);
    expect(result.net).toBe(4964.25);
  });

  /**
   * Test Case 3: Very low income (TTD 400) — below class 1 NIS min, below HS threshold.
   *
   * Weekly insurable = 400 / 4.333 = 92.30 → below class 1 min (200) → NIS class not found
   *
   * Expected:
   *   NIS employee  = 0
   *   HS            = 4.80 × 4.333 = 20.80  (400 <= 469.99 → low rate)
   *   chargeable    = max(0, 400 − 7500) = 0
   *   PAYE          = 0
   *   net           = 400 − 0 − 20.80 − 0 = 379.20
   */
  it('Case 3 — income below HS threshold (400): NIS zero, HS low rate, PAYE zero', () => {
    const result = computeRunLine({
      basePay:                 400,
      taxableAllowances:       0,
      nonTaxableAllowances:    0,
      approvedOtAmount:        0,
      preTaxPensionDeductions: 0,
      voluntaryDeductions:     0,
      nisApplicable:           true,
      nisClasses:              ALL_CLASSES,
      weeksInPeriod:           WEEKS,
      statutory:               TT_2026_STATUTORY,
    });

    expect(result.nisEmployee).toBe(0);
    expect(result.nisClassNo).toBeNull();
    expect(result.healthSurcharge).toBe(20.8);
    expect(result.chargeableIncome).toBe(0);
    expect(result.paye).toBe(0);
    expect(result.net).toBe(379.20);
  });

  /**
   * Test Case 4: High earner crossing band1→band2, monthly gross TTD 100,000.
   *
   * Weekly insurable = 100000/4.333 ≈ 23079 → class 16 (open-ended ≥ 3138)
   *
   * Expected:
   *   NIS employee  = 169.50 × 4.333 = 734.44  (class 16)
   *   NIS employer  = 339.00 × 4.333 = 1468.89
   *   HS            = 8.25 × 4.333 = 35.75
   *   chargeable    = 100000 − 7500 = 92500
   *   Monthly band1 ceiling = 1,000,000 / 12 = 83,333.33
   *   Band1 PAYE    = 83,333.33 × 0.25 = 20,833.33
   *   Band2 PAYE    = (92,500 − 83,333.33) × 0.30 = 9,166.67 × 0.30 = 2,750.00
   *   PAYE total    = 23,583.33
   *   net           = 100000 − 734.44 − 35.75 − 23583.33 = 75,646.48
   */
  it('Case 4 — band1→band2 PAYE crossing (100000): class 16 NIS + HS high + split PAYE', () => {
    const result = computeRunLine({
      basePay:                 100000,
      taxableAllowances:       0,
      nonTaxableAllowances:    0,
      approvedOtAmount:        0,
      preTaxPensionDeductions: 0,
      voluntaryDeductions:     0,
      nisApplicable:           true,
      nisClasses:              ALL_CLASSES,
      weeksInPeriod:           WEEKS,
      statutory:               TT_2026_STATUTORY,
    });

    expect(result.nisClassNo).toBe(16);
    expect(result.nisEmployee).toBe(734.44);
    expect(result.nisEmployer).toBe(1468.89);
    expect(result.healthSurcharge).toBe(35.75);
    expect(result.chargeableIncome).toBe(92500);
    expect(result.paye).toBe(23583.33);
    expect(result.net).toBe(75646.48);
  });

  /**
   * Test Case 5: Pre-tax pension deduction reduces chargeable income.
   * Base 15000, pension 1500 (reduces_chargeable component).
   *
   * Chargeable = 15000 − 7500 − 1500 = 6000
   * PAYE = 6000 × 0.25 = 1500
   */
  it('Case 5 — pre-tax pension reduces chargeable income before PAYE', () => {
    const result = computeRunLine({
      basePay:                 15000,
      taxableAllowances:       0,
      nonTaxableAllowances:    0,
      approvedOtAmount:        0,
      preTaxPensionDeductions: 1500,
      voluntaryDeductions:     0,
      nisApplicable:           true,
      nisClasses:              ALL_CLASSES,
      weeksInPeriod:           WEEKS,
      statutory:               TT_2026_STATUTORY,
    });

    expect(result.chargeableIncome).toBe(6000);
    expect(result.paye).toBe(1500);
  });

  /**
   * Test Case 6: NIS is NOT subtracted from chargeable income before PAYE.
   * Verify that two employees with same gross but different NIS applicability
   * have the SAME chargeable income (NIS neutral to PAYE).
   */
  it('Case 6 — NIS does NOT affect chargeable income (T&T rule)', () => {
    const base = {
      basePay: 8000, taxableAllowances: 0, nonTaxableAllowances: 0,
      approvedOtAmount: 0, preTaxPensionDeductions: 0, voluntaryDeductions: 0,
      nisClasses: ALL_CLASSES, weeksInPeriod: WEEKS, statutory: TT_2026_STATUTORY,
    };

    const withNis    = computeRunLine({ ...base, nisApplicable: true });
    const withoutNis = computeRunLine({ ...base, nisApplicable: false });

    // NIS changes the employee's take-home but NOT the chargeable income
    expect(withNis.chargeableIncome).toBe(withoutNis.chargeableIncome);
    expect(withNis.paye).toBe(withoutNis.paye);
    // But net differs by the NIS employee amount
    expect(withNis.net).toBe(withoutNis.net - withNis.nisEmployee);
  });

  /**
   * Test Case 7 (Wave 3): WEEKLY run — weeksInPeriod=1, payPeriods=52.
   * Base weekly pay 2000.
   *   NIS: weekly insurable 2000/1 = 2000 → class 11 (1910–2139.99) EE 109.40 × 1 = 109.40
   *   HS:  2000 > 469.99 → 8.25 × 1 = 8.25
   *   chargeable = 2000 − (90000/52 = 1730.77) = 269.23
   *   PAYE = 269.23 × 0.25 = 67.31 (weekly band1 ceiling 1,000,000/52 = 19,230.77, well above)
   *   net  = 2000 − 109.40 − 8.25 − 67.31 = 1815.04
   */
  it('Case 7 — weekly run annualises PAYE by 52 (not 12)', () => {
    const result = computeRunLine({
      basePay: 2000, taxableAllowances: 0, nonTaxableAllowances: 0,
      approvedOtAmount: 0, preTaxPensionDeductions: 0, voluntaryDeductions: 0,
      nisApplicable: true, nisClasses: ALL_CLASSES,
      weeksInPeriod: 1, payPeriods: 52, statutory: TT_2026_STATUTORY,
    });
    expect(result.nisClassNo).toBe(11);
    expect(result.nisEmployee).toBe(109.40);
    expect(result.healthSurcharge).toBe(8.25);
    expect(result.chargeableIncome).toBe(269.23);
    expect(result.paye).toBe(67.31);
    expect(result.net).toBe(1815.04);
  });
});
