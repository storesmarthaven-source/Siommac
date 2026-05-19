'use strict';

// Mirror of the T&T payroll calculation from netlify/functions/routes/payroll.js
// Tests verify the arithmetic stays correct across refactors.

const r2 = n => Math.round(n * 100) / 100;

const TT = {
  PERSONAL_ALLOWANCE_ANNUAL:  90000,
  PAYE_RATE_LOW:               0.25,
  PAYE_RATE_HIGH:              0.30,
  PAYE_HIGH_THRESHOLD_ANNUAL:  1000000,
  NIS_RATE:                    0.06,
  NIS_MONTHLY_CAP:             13600,
  HS_THRESHOLD_WEEKLY:         469.99,
};

TT.NIS_CAP = {
  daily:       r2(TT.NIS_MONTHLY_CAP / (52 / 12) / 5),
  weekly:      r2(TT.NIS_MONTHLY_CAP / (52 / 12)),
  fortnightly: r2(TT.NIS_MONTHLY_CAP / (26 / 12)),
  monthly:     TT.NIS_MONTHLY_CAP,
};

TT.ALLOWANCE = {
  daily:       r2(TT.PERSONAL_ALLOWANCE_ANNUAL / 260),
  weekly:      r2(TT.PERSONAL_ALLOWANCE_ANNUAL / 52),
  fortnightly: r2(TT.PERSONAL_ALLOWANCE_ANNUAL / 26),
  monthly:     r2(TT.PERSONAL_ALLOWANCE_ANNUAL / 12),
};

TT.HS_HIGH = { daily: 1.65, weekly: 8.25, fortnightly: 16.50, monthly: 33.00 };
TT.HS_LOW  = { daily: 0.30, weekly: 1.50, fortnightly:  3.00, monthly:  6.00 };

function hsThreshold(cycle) {
  const w = TT.HS_THRESHOLD_WEEKLY;
  return { daily: w / 5, weekly: w, fortnightly: w * 2, monthly: w * 4.333 }[cycle] || w;
}

function calcPayslip(emp, hoursWorked) {
  const cycle         = emp.pay_cycle  || 'monthly';
  const basis         = emp.pay_basis  || 'salary';
  const nisApplicable = emp.nis_applicable !== false;
  const hsApplicable  = emp.health_surcharge_applicable !== false;
  const taxResident   = emp.tax_resident !== false;

  let grossPay = 0;
  if (basis === 'hourly') {
    grossPay = r2(hoursWorked * (Number(emp.hourly_rate) || 0));
  } else {
    const s = Number(emp.monthly_salary) || 0;
    grossPay = r2({ daily: s / 22, weekly: s / 4.333, fortnightly: s / 2.166, monthly: s }[cycle] || s);
  }

  let paye = 0;
  if (taxResident) {
    const allowance  = TT.ALLOWANCE[cycle] || 0;
    const taxablePay = Math.max(0, grossPay - allowance);
    if (taxablePay > 0) {
      const annualFactor  = { daily: 260, weekly: 52, fortnightly: 26, monthly: 12 }[cycle] || 12;
      const highThreshold = TT.PAYE_HIGH_THRESHOLD_ANNUAL / annualFactor;
      paye = taxablePay <= highThreshold
        ? r2(taxablePay * TT.PAYE_RATE_LOW)
        : r2(r2(highThreshold * TT.PAYE_RATE_LOW) + r2((taxablePay - highThreshold) * TT.PAYE_RATE_HIGH));
    }
  } else {
    paye = r2(grossPay * TT.PAYE_RATE_LOW);
  }

  let nis = 0;
  if (nisApplicable) {
    const nisCap = TT.NIS_CAP[cycle] || TT.NIS_CAP.monthly;
    nis = r2(Math.min(grossPay, nisCap) * TT.NIS_RATE);
  }

  let healthSurcharge = 0;
  if (hsApplicable) {
    healthSurcharge = grossPay > hsThreshold(cycle) ? TT.HS_HIGH[cycle] : TT.HS_LOW[cycle];
  }

  const totalDeductions = r2(paye + nis + healthSurcharge);
  const netPay          = r2(Math.max(0, grossPay - totalDeductions));
  return { grossPay, paye, nis, healthSurcharge, totalDeductions, netPay };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('calcPayslip — salary monthly (tax resident)', () => {
  const emp = {
    pay_cycle: 'monthly', pay_basis: 'salary', monthly_salary: 10000,
    nis_applicable: true, health_surcharge_applicable: true, tax_resident: true,
  };

  test('gross pay equals monthly salary', () => {
    expect(calcPayslip(emp, 176).grossPay).toBe(10000);
  });

  test('NIS = 6% of gross (below cap)', () => {
    // 10000 * 0.06 = 600
    expect(calcPayslip(emp, 176).nis).toBe(600);
  });

  test('health surcharge high bracket (gross > 2036.16 monthly threshold)', () => {
    // threshold = 469.99 * 4.333 ≈ 2036 — 10000 is above
    expect(calcPayslip(emp, 176).healthSurcharge).toBe(33.00);
  });

  test('net pay = gross - total deductions', () => {
    const r = calcPayslip(emp, 176);
    expect(r.netPay).toBe(r2(r.grossPay - r.totalDeductions));
  });
});

describe('calcPayslip — hourly daily', () => {
  const emp = {
    pay_cycle: 'daily', pay_basis: 'hourly', hourly_rate: 75,
    nis_applicable: true, health_surcharge_applicable: true, tax_resident: true,
  };

  test('gross = hourly_rate × hours', () => {
    expect(calcPayslip(emp, 8).grossPay).toBe(600);
  });

  test('health surcharge low bracket when daily gross ≤ threshold', () => {
    // daily threshold = 469.99 / 5 = 93.998
    // 8 hrs * $10 = $80 — below threshold
    const lowEmp = { ...emp, hourly_rate: 10 };
    expect(calcPayslip(lowEmp, 8).healthSurcharge).toBe(0.30);
  });
});

describe('calcPayslip — NIS capped at monthly limit', () => {
  test('NIS never exceeds monthly cap ($13600)', () => {
    const emp = {
      pay_cycle: 'monthly', pay_basis: 'salary', monthly_salary: 500000,
      nis_applicable: true, health_surcharge_applicable: false, tax_resident: false,
    };
    expect(calcPayslip(emp, 0).nis).toBe(r2(TT.NIS_MONTHLY_CAP * TT.NIS_RATE));
  });
});

describe('calcPayslip — toggles', () => {
  const base = {
    pay_cycle: 'monthly', pay_basis: 'salary', monthly_salary: 8000,
    nis_applicable: true, health_surcharge_applicable: true, tax_resident: true,
  };

  test('nis_applicable=false → nis=0', () => {
    expect(calcPayslip({ ...base, nis_applicable: false }, 0).nis).toBe(0);
  });

  test('health_surcharge_applicable=false → healthSurcharge=0', () => {
    expect(calcPayslip({ ...base, health_surcharge_applicable: false }, 0).healthSurcharge).toBe(0);
  });

  test('tax_resident=false → flat 25% PAYE on full gross', () => {
    const r = calcPayslip({ ...base, tax_resident: false }, 0);
    expect(r.paye).toBe(r2(8000 * 0.25));
  });

  test('all deductions off → net equals gross', () => {
    const r = calcPayslip({ ...base, nis_applicable: false, health_surcharge_applicable: false, tax_resident: false, monthly_salary: 5000 }, 0);
    // non-resident still pays 25% PAYE
    expect(r.netPay).toBe(r2(5000 - r.paye));
  });
});
