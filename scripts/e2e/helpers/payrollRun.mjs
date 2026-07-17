function addDays(dateText, days) {
  const date = new Date(`${dateText}T00:00:00.000Z`);
  if (Number.isNaN(date.valueOf())) throw new Error(`Invalid payroll period date: ${dateText}`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function endOfMonth(dateText) {
  const date = new Date(`${dateText}T00:00:00.000Z`);
  if (Number.isNaN(date.valueOf())) throw new Error(`Invalid payroll period date: ${dateText}`);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0))
    .toISOString()
    .slice(0, 10);
}

export function payrollPeriodEnd(periodStart, payFrequency = 'monthly') {
  if (payFrequency === 'weekly') return addDays(periodStart, 6);
  if (payFrequency === 'fortnightly') return addDays(periodStart, 13);
  if (payFrequency === 'semi_monthly') {
    const day = Number(periodStart.slice(8, 10));
    if (day <= 15) return `${periodStart.slice(0, 8)}15`;
  }
  return endOfMonth(periodStart);
}

function monthStart(dateText) {
  return `${dateText.slice(0, 7)}-01`;
}

export function payrollContributionWeeks(periodStart, periodEnd) {
  const startDate = new Date(`${periodStart}T00:00:00.000Z`);
  const endDate = new Date(`${periodEnd}T00:00:00.000Z`);
  if (Number.isNaN(startDate.valueOf()) || Number.isNaN(endDate.valueOf()) || endDate < startDate) {
    throw new Error(`Invalid payroll contribution period: ${periodStart} to ${periodEnd}`);
  }

  const weeksByMonth = new Map();
  for (
    const cursor = new Date(startDate);
    cursor <= endDate;
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  ) {
    if (cursor.getUTCDay() !== 1) continue;
    const month = monthStart(cursor.toISOString().slice(0, 10));
    weeksByMonth.set(month, (weeksByMonth.get(month) ?? 0) + 1);
  }

  if (weeksByMonth.size === 0) {
    const contributionMonday = new Date(endDate);
    contributionMonday.setUTCDate(
      contributionMonday.getUTCDate() - ((contributionMonday.getUTCDay() + 6) % 7),
    );
    weeksByMonth.set(monthStart(contributionMonday.toISOString().slice(0, 10)), 1);
  }

  return [...weeksByMonth.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([month, weeks]) => ({ periodMonth: month, weeks }));
}

export function nisContributionPeriods({
  periodStart,
  periodEnd,
  employeeWeekly,
  employerWeekly,
}) {
  if (!Number.isFinite(employeeWeekly) || employeeWeekly < 0) {
    throw new Error('nisContributionPeriods requires a non-negative employeeWeekly amount');
  }
  if (!Number.isFinite(employerWeekly) || employerWeekly < 0) {
    throw new Error('nisContributionPeriods requires a non-negative employerWeekly amount');
  }

  return payrollContributionWeeks(periodStart, periodEnd).map(({ periodMonth: month, weeks }) => ({
    periodMonth: month,
    weeks,
    employeeAmount: Math.round(employeeWeekly * weeks * 100) / 100,
    employerAmount: Math.round(employerWeekly * weeks * 100) / 100,
  }));
}

export function payrollRunCommand({
  idempotencyKey,
  periodStart,
  periodEnd,
  runType = 'scheduled',
  payFrequency = 'monthly',
  ...optional
}) {
  if (!idempotencyKey) throw new Error('payrollRunCommand requires idempotencyKey');
  if (!periodStart) throw new Error('payrollRunCommand requires periodStart');
  return {
    idempotencyKey,
    runType,
    periodStart,
    periodEnd: periodEnd ?? payrollPeriodEnd(periodStart, payFrequency),
    payFrequency,
    ...optional,
  };
}

export function payrollCalculationCommand(id, idempotencyKey) {
  if (!id) throw new Error('payrollCalculationCommand requires a run id');
  if (!idempotencyKey) throw new Error('payrollCalculationCommand requires idempotencyKey');
  return { id, idempotencyKey };
}

export function payrollLockCommand(id, idempotencyKey) {
  if (!id) throw new Error('payrollLockCommand requires a run id');
  if (!idempotencyKey) throw new Error('payrollLockCommand requires idempotencyKey');
  return { id, idempotencyKey };
}

export function payrollCertificationCommand(runId, idempotencyKey, note) {
  if (!runId) throw new Error('payrollCertificationCommand requires a run id');
  if (!idempotencyKey) {
    throw new Error('payrollCertificationCommand requires idempotencyKey');
  }
  return {
    runId,
    idempotencyKey,
    attestations: {
      populationReconciled: true,
      inputsReviewed: true,
      statutoryReviewed: true,
      variancesReviewed: true,
      paymentReadinessReviewed: true,
      glReadinessReviewed: true,
    },
    ...(note ? { note } : {}),
  };
}

export function payrollFundingCommand({
  runId,
  idempotencyKey,
  confirmedAmount,
  confirmationReference,
  accountReference,
  note,
}) {
  if (!runId) throw new Error('payrollFundingCommand requires a run id');
  if (!idempotencyKey) {
    throw new Error('payrollFundingCommand requires idempotencyKey');
  }
  if (!Number.isFinite(confirmedAmount) || confirmedAmount < 0) {
    throw new Error('payrollFundingCommand requires a non-negative confirmedAmount');
  }
  if (!confirmationReference?.trim()) {
    throw new Error('payrollFundingCommand requires confirmationReference');
  }
  return {
    runId,
    idempotencyKey,
    confirmedAmount,
    confirmationReference,
    ...(accountReference ? { accountReference } : {}),
    ...(note ? { note } : {}),
  };
}

export function payrollReleaseCommand(runId, idempotencyKey) {
  if (!runId) throw new Error('payrollReleaseCommand requires a run id');
  if (!idempotencyKey) {
    throw new Error('payrollReleaseCommand requires idempotencyKey');
  }
  return { runId, idempotencyKey };
}

export function payrollExportCommand(id, idempotencyKey, format = 'csv') {
  if (!id) throw new Error('payrollExportCommand requires a run id');
  if (!idempotencyKey) {
    throw new Error('payrollExportCommand requires idempotencyKey');
  }
  if (format !== 'csv' && format !== 'json') {
    throw new Error(`payrollExportCommand does not support format '${format}'`);
  }
  return { id, idempotencyKey, format };
}

export function payrollReopenCommand(id, reason, idempotencyKey) {
  if (!id) throw new Error('payrollReopenCommand requires a run id');
  if (!reason?.trim()) throw new Error('payrollReopenCommand requires a reason');
  if (!idempotencyKey) throw new Error('payrollReopenCommand requires idempotencyKey');
  return { id, reason, idempotencyKey };
}

export function payrollRunSeed({
  periodStart,
  periodEnd,
  periodMonth,
  runType = 'scheduled',
  payFrequency = 'monthly',
  sequenceNo = 1,
  ...row
}) {
  const start = periodStart ?? periodMonth;
  if (!start) throw new Error('payrollRunSeed requires periodStart or periodMonth');
  const end = periodEnd ?? payrollPeriodEnd(start, payFrequency);
  const payDate = row.pay_date ?? end;
  const contributionWeeks = payrollContributionWeeks(start, end)
    .reduce((sum, contributionPeriod) => sum + contributionPeriod.weeks, 0);
  return {
    period_month: monthStart(payDate),
    run_type: runType,
    period_start: start,
    period_end: end,
    sequence_no: sequenceNo,
    pay_frequency: payFrequency,
    pay_date: payDate,
    weeks_in_period: contributionWeeks,
    ...row,
  };
}
