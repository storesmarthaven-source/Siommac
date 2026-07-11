// ============================================================================
// Finance — Payroll Reports (Phase 3 Stage 3)
// ============================================================================
// Implements the §18 Finance Payroll report queries.
//
// All reports are read-only against the live tables.
// Results follow the pattern established in financeStatutory reports:
//   { report: string; generatedAt: string; rows: T[] }
//
// Reports implemented:
//   register             — all payroll runs (status, period, totals)
//   payslip_register     — all payslips across runs
//   net_pay_summary      — per-employee net pay for a run
//   employer_nis_summary — employer NIS contributions per run
//   nis_remittance       — NIS remittance detail (employee + employer) per run
//   paye_summary         — PAYE amounts per run / employee
//   hs_summary           — Health Surcharge per run / employee
//   cost_by_department   — gross / net / NIS by department for a run
//   cost_by_cost_center  — gross / net / NIS by cost center for a run
//   export_audit         — all export artifacts across runs
//   nis_continuity       — NIS opening YTD balances used in run lines
//   missing_nis_number   — employees with missing NIS numbers (run warnings)
//   unverified_nis       — employees with unverified NIS profiles
//   new_employee_nis     — new hires with NIS pending verification
//   nis_opening_balance  — employees with non-zero opening YTD NIS balances
//   nis_exceptions       — blocker/warning severity NIS warnings in runs
// ============================================================================

import { sb } from '../db';

export type ReportRow = Record<string, unknown>;

export interface ReportResult {
  report:       string;
  generatedAt:  string;
  rows:         ReportRow[];
}

function result(report: string, rows: ReportRow[]): ReportResult {
  return { report, generatedAt: new Date().toISOString(), rows };
}

// ── Register: all payroll runs ────────────────────────────────────────────────
export async function reportRegister(opts: {
  status?: string;
  fromPeriod?: string;
  toPeriod?: string;
  limit?: number;
}): Promise<ReportResult> {
  let q = sb.from('finance_payroll_runs')
    .select('id, run_no, period_month, pay_frequency, status, employee_count, gross_total, deduction_total, net_total, nis_employer_total, created_at, created_by, approved_by, locked_at, exported_at')
    .order('period_month', { ascending: false })
    .limit(opts.limit ?? 200);
  if (opts.status)     q = q.eq('status', opts.status);
  if (opts.fromPeriod) q = q.gte('period_month', opts.fromPeriod);
  if (opts.toPeriod)   q = q.lte('period_month', opts.toPeriod);
  const { data, error } = await q;
  if (error) throw Object.assign(new Error('reportRegister: ' + error.message), { status: 500 });
  return result('register', (data ?? []) as ReportRow[]);
}

// ── Payslip register ──────────────────────────────────────────────────────────
export async function reportPayslipRegister(opts: { runId?: string; limit?: number }): Promise<ReportResult> {
  let q = sb.from('finance_payslips')
    .select('id, payslip_no, run_id, employee_id, generated_at, generated_by')
    .order('generated_at', { ascending: false })
    .limit(opts.limit ?? 500);
  if (opts.runId) q = q.eq('run_id', opts.runId);
  const { data, error } = await q;
  if (error) throw Object.assign(new Error('reportPayslipRegister: ' + error.message), { status: 500 });
  return result('payslip_register', (data ?? []) as ReportRow[]);
}

// ── Net-pay summary ───────────────────────────────────────────────────────────
export async function reportNetPaySummary(runId: string): Promise<ReportResult> {
  const { data, error } = await sb.from('finance_payroll_run_lines')
    .select('employee_id, gross, nis_employee, health_surcharge, paye, voluntary_deductions, net, department_id, cost_center_id')
    .eq('run_id', runId)
    .order('net', { ascending: false });
  if (error) throw Object.assign(new Error('reportNetPaySummary: ' + error.message), { status: 500 });
  return result('net_pay_summary', (data ?? []) as ReportRow[]);
}

// ── Employer NIS summary ──────────────────────────────────────────────────────
export async function reportEmployerNisSummary(runId: string): Promise<ReportResult> {
  const { data, error } = await sb.from('finance_payroll_run_lines')
    .select('employee_id, nis_employee, nis_employer, nis_class_no, nis_number_masked, nis_status')
    .eq('run_id', runId)
    .order('employee_id');
  if (error) throw Object.assign(new Error('reportEmployerNisSummary: ' + error.message), { status: 500 });
  return result('employer_nis_summary', (data ?? []) as ReportRow[]);
}

// ── NIS remittance detail ─────────────────────────────────────────────────────
export async function reportNisRemittance(runId: string): Promise<ReportResult> {
  const { data: runData } = await sb.from('finance_payroll_runs')
    .select('run_no, period_month, nis_employer_total')
    .eq('id', runId).maybeSingle();

  const { data: lines, error } = await sb.from('finance_payroll_run_lines')
    .select('employee_id, nis_employee, nis_employer, nis_class_no, nis_number_masked, opening_ytd_nis_employee, opening_ytd_nis_employer')
    .eq('run_id', runId)
    .order('employee_id');
  if (error) throw Object.assign(new Error('reportNisRemittance: ' + error.message), { status: 500 });

  const rows = (lines ?? []).map(l => ({
    ...l,
    runNo:        (runData as Record<string, unknown> | null)?.run_no ?? null,
    periodMonth:  (runData as Record<string, unknown> | null)?.period_month ?? null,
  })) as ReportRow[];
  return result('nis_remittance', rows);
}

// ── PAYE summary ──────────────────────────────────────────────────────────────
export async function reportPayeSummary(runId: string): Promise<ReportResult> {
  const { data, error } = await sb.from('finance_payroll_run_lines')
    .select('employee_id, taxable_gross, chargeable_income, paye, department_id')
    .eq('run_id', runId)
    .order('paye', { ascending: false });
  if (error) throw Object.assign(new Error('reportPayeSummary: ' + error.message), { status: 500 });
  return result('paye_summary', (data ?? []) as ReportRow[]);
}

// ── Health Surcharge summary ──────────────────────────────────────────────────
export async function reportHsSummary(runId: string): Promise<ReportResult> {
  const { data, error } = await sb.from('finance_payroll_run_lines')
    .select('employee_id, gross, health_surcharge, department_id')
    .eq('run_id', runId)
    .order('employee_id');
  if (error) throw Object.assign(new Error('reportHsSummary: ' + error.message), { status: 500 });
  return result('hs_summary', (data ?? []) as ReportRow[]);
}

// ── Cost by department ────────────────────────────────────────────────────────
export async function reportCostByDepartment(runId: string): Promise<ReportResult> {
  // Group in JS since PostgREST aggregation requires an RPC for SUM
  const { data, error } = await sb.from('finance_payroll_run_lines')
    .select('department_id, gross, net, nis_employee, nis_employer, paye, health_surcharge')
    .eq('run_id', runId);
  if (error) throw Object.assign(new Error('reportCostByDepartment: ' + error.message), { status: 500 });

  const agg = new Map<string, { gross: number; net: number; nisEmployee: number; nisEmployer: number; paye: number; hs: number; count: number }>();
  for (const row of (data ?? []) as Record<string, unknown>[]) {
    const deptId = (row['department_id'] as string | null) ?? '__unassigned__';
    const existing = agg.get(deptId) ?? { gross: 0, net: 0, nisEmployee: 0, nisEmployer: 0, paye: 0, hs: 0, count: 0 };
    existing.gross       += Number(row['gross'] ?? 0);
    existing.net         += Number(row['net'] ?? 0);
    existing.nisEmployee += Number(row['nis_employee'] ?? 0);
    existing.nisEmployer += Number(row['nis_employer'] ?? 0);
    existing.paye        += Number(row['paye'] ?? 0);
    existing.hs          += Number(row['health_surcharge'] ?? 0);
    existing.count       += 1;
    agg.set(deptId, existing);
  }

  const rows: ReportRow[] = [...agg.entries()].map(([deptId, totals]) => ({
    departmentId: deptId === '__unassigned__' ? null : deptId,
    ...totals,
  }));
  return result('cost_by_department', rows);
}

// ── Cost by cost center ───────────────────────────────────────────────────────
export async function reportCostByCostCenter(runId: string): Promise<ReportResult> {
  const { data, error } = await sb.from('finance_payroll_run_lines')
    .select('cost_center_id, gross, net, nis_employee, nis_employer, paye, health_surcharge')
    .eq('run_id', runId);
  if (error) throw Object.assign(new Error('reportCostByCostCenter: ' + error.message), { status: 500 });

  const agg = new Map<string, { gross: number; net: number; nisEmployee: number; nisEmployer: number; paye: number; hs: number; count: number }>();
  for (const row of (data ?? []) as Record<string, unknown>[]) {
    const ccId = (row['cost_center_id'] as string | null) ?? '__unassigned__';
    const existing = agg.get(ccId) ?? { gross: 0, net: 0, nisEmployee: 0, nisEmployer: 0, paye: 0, hs: 0, count: 0 };
    existing.gross       += Number(row['gross'] ?? 0);
    existing.net         += Number(row['net'] ?? 0);
    existing.nisEmployee += Number(row['nis_employee'] ?? 0);
    existing.nisEmployer += Number(row['nis_employer'] ?? 0);
    existing.paye        += Number(row['paye'] ?? 0);
    existing.hs          += Number(row['health_surcharge'] ?? 0);
    existing.count       += 1;
    agg.set(ccId, existing);
  }

  const rows: ReportRow[] = [...agg.entries()].map(([ccId, totals]) => ({
    costCenterId: ccId === '__unassigned__' ? null : ccId,
    ...totals,
  }));
  return result('cost_by_cost_center', rows);
}

// ── Export audit ──────────────────────────────────────────────────────────────
export async function reportExportAudit(opts: { runId?: string; limit?: number }): Promise<ReportResult> {
  let q = sb.from('finance_payroll_exports')
    .select('id, export_no, run_id, format, file_path, checksum, generated_by, generated_at, is_current, metadata')
    .order('generated_at', { ascending: false })
    .limit(opts.limit ?? 200);
  if (opts.runId) q = q.eq('run_id', opts.runId);
  const { data, error } = await q;
  if (error) throw Object.assign(new Error('reportExportAudit: ' + error.message), { status: 500 });
  return result('export_audit', (data ?? []) as ReportRow[]);
}

// ── NIS Continuity Register ───────────────────────────────────────────────────
export async function reportNisContinuity(runId: string): Promise<ReportResult> {
  const { data, error } = await sb.from('finance_payroll_run_lines')
    .select('employee_id, nis_number_masked, nis_status, nis_class_no, opening_ytd_nis_employee, opening_ytd_nis_employer')
    .eq('run_id', runId)
    .order('employee_id');
  if (error) throw Object.assign(new Error('reportNisContinuity: ' + error.message), { status: 500 });
  return result('nis_continuity', (data ?? []) as ReportRow[]);
}

// ── Missing NIS Number ─────────────────────────────────────────────────────────
export async function reportMissingNisNumber(runId: string): Promise<ReportResult> {
  const { data, error } = await sb.from('finance_payroll_run_warnings')
    .select('employee_id, warning_type, severity, message, resolved, created_at')
    .eq('run_id', runId)
    .eq('warning_type', 'missing_nis_number')
    .order('employee_id');
  if (error) throw Object.assign(new Error('reportMissingNisNumber: ' + error.message), { status: 500 });
  return result('missing_nis_number', (data ?? []) as ReportRow[]);
}

// ── Unverified NIS Profiles ───────────────────────────────────────────────────
export async function reportUnverifiedNis(): Promise<ReportResult> {
  const { data, error } = await sb.from('hr_employee_statutory_profiles')
    .select('employee_id, jurisdiction, nis_number, nis_status, nis_applicable, previous_employer_name, verified_at, created_at')
    .neq('nis_status', 'verified')
    .eq('nis_applicable', true)
    .order('created_at');
  if (error) throw Object.assign(new Error('reportUnverifiedNis: ' + error.message), { status: 500 });
  return result('unverified_nis', (data ?? []) as ReportRow[]);
}

// ── New Employee NIS Onboarding ───────────────────────────────────────────────
export async function reportNewEmployeeNisOnboarding(opts: { daysBack?: number }): Promise<ReportResult> {
  const since = new Date();
  since.setDate(since.getDate() - (opts.daysBack ?? 90));
  const { data, error } = await sb.from('hr_employee_statutory_profiles')
    .select('employee_id, jurisdiction, nis_number, nis_status, nis_applicable, created_at, verified_at')
    .eq('nis_applicable', true)
    .gte('created_at', since.toISOString())
    .order('created_at', { ascending: false });
  if (error) throw Object.assign(new Error('reportNewEmployeeNisOnboarding: ' + error.message), { status: 500 });
  return result('new_employee_nis_onboarding', (data ?? []) as ReportRow[]);
}

// ── NIS Opening Balance ───────────────────────────────────────────────────────
export async function reportNisOpeningBalance(): Promise<ReportResult> {
  const { data, error } = await sb.from('hr_employee_statutory_profiles')
    .select('employee_id, jurisdiction, nis_number, opening_ytd_insurable_earnings, opening_ytd_nis_employee, opening_ytd_nis_employer, opening_balance_as_of, previous_employer_name, previous_employer_end_date')
    .gt('opening_ytd_nis_employee', 0)
    .order('employee_id');
  if (error) throw Object.assign(new Error('reportNisOpeningBalance: ' + error.message), { status: 500 });
  return result('nis_opening_balance', (data ?? []) as ReportRow[]);
}

// ── NIS Exceptions (warnings with blocker/warning severity) ─────────────────
export async function reportNisExceptions(runId: string): Promise<ReportResult> {
  const { data, error } = await sb.from('finance_payroll_run_warnings')
    .select('id, employee_id, warning_type, severity, message, resolved, resolved_by, resolved_at, created_at, metadata')
    .eq('run_id', runId)
    .in('severity', ['blocker', 'warning'])
    .order('severity')
    .order('employee_id');
  if (error) throw Object.assign(new Error('reportNisExceptions: ' + error.message), { status: 500 });
  return result('nis_exceptions', (data ?? []) as ReportRow[]);
}

// ── Dispatch: route report key to handler ────────────────────────────────────

export type PayrollReportKey =
  | 'register'
  | 'payslip_register'
  | 'net_pay_summary'
  | 'employer_nis_summary'
  | 'nis_remittance'
  | 'paye_summary'
  | 'hs_summary'
  | 'cost_by_department'
  | 'cost_by_cost_center'
  | 'export_audit'
  | 'nis_continuity'
  | 'missing_nis_number'
  | 'unverified_nis'
  | 'new_employee_nis_onboarding'
  | 'nis_opening_balance'
  | 'nis_exceptions'
  | 'variation'
  | 'audit_comparison';

// ── Run diff (base → compare) shared by variation + audit comparison ─────────────
interface DiffLine { employee_id: string; gross: number; paye: number; nis_employee: number; health_surcharge: number; net: number }
const r2 = (n: number): number => Math.round((Number(n) || 0) * 100) / 100;

async function diffRuns(baseRunId: string, compareRunId: string, report: string): Promise<ReportResult> {
  const [{ data: baseLines, error: bErr }, { data: compLines, error: cErr }] = await Promise.all([
    sb.from('finance_payroll_run_lines').select('employee_id, gross, paye, nis_employee, health_surcharge, net').eq('run_id', baseRunId),
    sb.from('finance_payroll_run_lines').select('employee_id, gross, paye, nis_employee, health_surcharge, net').eq('run_id', compareRunId),
  ]);
  if (bErr) throw Object.assign(new Error('diffRuns/base: ' + bErr.message), { status: 500 });
  if (cErr) throw Object.assign(new Error('diffRuns/compare: ' + cErr.message), { status: 500 });
  const baseMap = new Map((baseLines ?? []).map((l: DiffLine) => [l.employee_id, l]));
  const compMap = new Map((compLines ?? []).map((l: DiffLine) => [l.employee_id, l]));
  const ids = [...new Set([...baseMap.keys(), ...compMap.keys()])].sort();
  const rows = ids.map(id => {
    const b = baseMap.get(id); const c = compMap.get(id);
    const grossDelta = r2((c?.gross ?? 0) - (b?.gross ?? 0));
    const netDelta   = r2((c?.net ?? 0) - (b?.net ?? 0));
    const payeDelta  = r2((c?.paye ?? 0) - (b?.paye ?? 0));
    const nisDelta   = r2((c?.nis_employee ?? 0) - (b?.nis_employee ?? 0));
    const status = !b ? 'added' : !c ? 'removed' : (grossDelta || netDelta || payeDelta || nisDelta ? 'changed' : 'unchanged');
    return {
      employee_id: id, status,
      prev_gross: r2(b?.gross ?? 0), gross: r2(c?.gross ?? 0), gross_delta: grossDelta,
      prev_net: r2(b?.net ?? 0),     net: r2(c?.net ?? 0),     net_delta: netDelta,
      prev_paye: r2(b?.paye ?? 0),   paye: r2(c?.paye ?? 0),   paye_delta: payeDelta,
      prev_nis: r2(b?.nis_employee ?? 0), nis_employee: r2(c?.nis_employee ?? 0), nis_delta: nisDelta,
    } as ReportRow;
  });
  return result(report, rows);
}

/** Variation: this run vs the immediately-prior run (by period). */
export async function reportVariation(runId: string): Promise<ReportResult> {
  const { data: run, error } = await sb.from('finance_payroll_runs').select('id, period_month').eq('id', runId).maybeSingle<{ id: string; period_month: string }>();
  if (error) throw Object.assign(new Error('reportVariation/run: ' + error.message), { status: 500 });
  if (!run) throw Object.assign(new Error('Payroll run not found.'), { status: 404 });
  const { data: prior } = await sb.from('finance_payroll_runs')
    .select('id').lt('period_month', run.period_month).order('period_month', { ascending: false }).limit(1).maybeSingle<{ id: string }>();
  if (!prior) return result('variation', []);   // nothing to compare against
  return diffRuns(prior.id, run.id, 'variation');
}

/** Audit comparison: diff any two runs (base = A, compare = B). */
export async function reportAuditComparison(runIdA: string, runIdB: string): Promise<ReportResult> {
  return diffRuns(runIdA, runIdB, 'audit_comparison');
}

export async function runPayrollReport(
  key: PayrollReportKey,
  params: Record<string, unknown>,
): Promise<ReportResult> {
  switch (key) {
    case 'register':
      return reportRegister({
        status:     typeof params['status'] === 'string' ? params['status'] : undefined,
        fromPeriod: typeof params['fromPeriod'] === 'string' ? params['fromPeriod'] : undefined,
        toPeriod:   typeof params['toPeriod'] === 'string' ? params['toPeriod'] : undefined,
        limit:      typeof params['limit'] === 'number' ? params['limit'] : undefined,
      });

    case 'payslip_register':
      return reportPayslipRegister({
        runId: typeof params['runId'] === 'string' ? params['runId'] : undefined,
        limit: typeof params['limit'] === 'number' ? params['limit'] : undefined,
      });

    case 'net_pay_summary':
      if (!params['runId']) throw Object.assign(new Error('runId is required for net_pay_summary.'), { status: 422 });
      return reportNetPaySummary(params['runId'] as string);

    case 'employer_nis_summary':
      if (!params['runId']) throw Object.assign(new Error('runId is required for employer_nis_summary.'), { status: 422 });
      return reportEmployerNisSummary(params['runId'] as string);

    case 'nis_remittance':
      if (!params['runId']) throw Object.assign(new Error('runId is required for nis_remittance.'), { status: 422 });
      return reportNisRemittance(params['runId'] as string);

    case 'paye_summary':
      if (!params['runId']) throw Object.assign(new Error('runId is required for paye_summary.'), { status: 422 });
      return reportPayeSummary(params['runId'] as string);

    case 'hs_summary':
      if (!params['runId']) throw Object.assign(new Error('runId is required for hs_summary.'), { status: 422 });
      return reportHsSummary(params['runId'] as string);

    case 'cost_by_department':
      if (!params['runId']) throw Object.assign(new Error('runId is required for cost_by_department.'), { status: 422 });
      return reportCostByDepartment(params['runId'] as string);

    case 'cost_by_cost_center':
      if (!params['runId']) throw Object.assign(new Error('runId is required for cost_by_cost_center.'), { status: 422 });
      return reportCostByCostCenter(params['runId'] as string);

    case 'export_audit':
      return reportExportAudit({
        runId: typeof params['runId'] === 'string' ? params['runId'] : undefined,
        limit: typeof params['limit'] === 'number' ? params['limit'] : undefined,
      });

    case 'nis_continuity':
      if (!params['runId']) throw Object.assign(new Error('runId is required for nis_continuity.'), { status: 422 });
      return reportNisContinuity(params['runId'] as string);

    case 'missing_nis_number':
      if (!params['runId']) throw Object.assign(new Error('runId is required for missing_nis_number.'), { status: 422 });
      return reportMissingNisNumber(params['runId'] as string);

    case 'unverified_nis':
      return reportUnverifiedNis();

    case 'new_employee_nis_onboarding':
      return reportNewEmployeeNisOnboarding({
        daysBack: typeof params['daysBack'] === 'number' ? params['daysBack'] : undefined,
      });

    case 'nis_opening_balance':
      return reportNisOpeningBalance();

    case 'nis_exceptions':
      if (!params['runId']) throw Object.assign(new Error('runId is required for nis_exceptions.'), { status: 422 });
      return reportNisExceptions(params['runId'] as string);

    case 'variation':
      if (!params['runId']) throw Object.assign(new Error('runId is required for variation.'), { status: 422 });
      return reportVariation(params['runId'] as string);

    case 'audit_comparison':
      if (!params['runId'] || !params['compareRunId']) throw Object.assign(new Error('runId and compareRunId are required for audit_comparison.'), { status: 422 });
      return reportAuditComparison(params['runId'] as string, params['compareRunId'] as string);

    default:
      throw Object.assign(new Error(`Unknown payroll report: '${key as string}'.`), { status: 422 });
  }
}
