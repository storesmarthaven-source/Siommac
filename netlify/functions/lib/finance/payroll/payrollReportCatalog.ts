// ============================================================================
// Payroll Reports Center (F-12, Phase A) — engine adapter / catalog compute
// ============================================================================
// Maps the server-owned 9-key catalog to the EXACT frozen §5B DTOs from the
// shared contract (types/payrollReports). Reuses the read helpers (sb,
// selectAllRows) and the existing report engine where the shape maps; computes
// the net-new reports (reconciliation, overtime/allowance, population movements)
// against confirmed live sources. All money is MoneyValue (dollars, r2); every
// completed result carries a deterministic scopeId; charts carry a unit.
//
// Eligibility: a run must be locked/released/exported (post-approval) else 422.
// Semantic validation that the shared zod schema deliberately omits (period span
// ≤ 24 months, nis scope/runId, variance compareRunId ≠ runId) is enforced here.
//
// Phase-A honest scoping (no faked data):
//   • gross_to_net_reconciliation: 'outputs' only (header vs lines) — 'gl' is
//     DEC-RPT-035 Phase-B.
//   • population_movements: hires/leavers/leave only — transfers is DEC-RPT-034.
//   • overtime controlStatus is 'approved' and thresholdMode='exceptions' returns
//     no rows: there is NO materiality/overtime threshold policy in Phase A (R7,
//     same stance as the inert materialVariances KPI).
// ============================================================================

import { createHash } from 'node:crypto';
import { sb } from '../../db';
import { selectAllRows } from '../../dbBulk';
import { reportNisExceptions, reportUnverifiedNis } from '../payrollReports';
import type {
  MoneyValue,
  ReportParams,
  InteractiveReportParams,
  PayrollReportKey,
  ReportFormat,
  ReportRunResult,
  ReportControlTotals,
  RegisterRow,
  NetPaySummaryRow,
  CostRow,
  ReportChart,
  VarianceRow,
  OvertimeRow,
  PopulationMovementRow,
  NisExceptionRow,
  ReconciliationResult,
  ReconciliationSource,
  ReportCatalogEntry,
  ReportKpiTile,
  ReportKpiTiles,
  ReportArtifactRow,
  ReportArtifactFormat,
  ReportJobStatus,
  PageResult,
} from '../../../../../types/payrollReports';
import {
  PAYROLL_REPORT_KEYS,
  REPORT_FORMAT_MATRIX,
  EMPLOYEE_LEVEL_REPORTS,
  deriveReportRequirements,
} from '../../../../../types/payrollReports';
import { payrollRpcHttpError } from './rpcError';

type Completed = Extract<ReportRunResult, { state: 'completed' }>;

const ELIGIBLE_STATES = new Set(['locked', 'released', 'exported']);
// Slice 3: standard file exports (xlsx/csv/pdf) are live (generation worker +
// reports/status). The export_audit_package ZIP is still deferred (jszip not yet
// approved) — gated separately so the catalog never advertises what it can't
// fulfil (no accept-and-drop).
export const REPORT_FILE_EXPORTS_ENABLED = true;
export const REPORT_ZIP_ENABLED = false;

/** A format is runnable only when its capability is enabled (preview always). */
export function isFormatEnabled(f: ReportFormat): boolean {
  if (f === 'preview') return true;
  if (f === 'zip') return REPORT_ZIP_ENABLED;
  return REPORT_FILE_EXPORTS_ENABLED;
}
const OVERTIME_CODE = 'overtime';
const ALLOWANCE_CODES = new Set(['housing_allowance', 'travel_allowance', 'meal_allowance']);
const PREVIEW_ROW_CAP = 5000;

// ── small helpers ────────────────────────────────────────────────────────────
const r2 = (n: number): number => Math.round((Number.isFinite(n) ? n : 0) * 100) / 100;
const money = (n: number): MoneyValue => ({ amount: r2(n), currency: 'TTD' });
const err = (status: number, message: string): Error & { status: number } =>
  Object.assign(new Error(message), { status });

function scopeIdFor(parts: Record<string, unknown>): string {
  return createHash('sha1').update(JSON.stringify(parts)).digest('hex').slice(0, 16);
}
function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}
/** YYYY-MM → first-of-month 'YYYY-MM-01'. */
const monthStart = (ym: string): string => `${ym}-01`;
/** First-of-month for the month AFTER the given YYYY-MM (exclusive upper bound). */
function monthAfter(ym: string): string {
  const [y, m] = ym.split('-').map(Number) as [number, number];
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  return `${ny}-${String(nm).padStart(2, '0')}-01`;
}
function monthSpan(from: string, to: string): number {
  const [fy, fm] = from.split('-').map(Number) as [number, number];
  const [ty, tm] = to.split('-').map(Number) as [number, number];
  return (ty - fy) * 12 + (tm - fm) + 1;
}
/**
 * Semantic period validation (§5A2) — the zod schema guarantees a well-formed
 * YYYY-MM with a real month (400); this enforces `to ≥ from` and a 1..24-month
 * span (422). A reversed range gives a span ≤ 0 and must NOT silently return an
 * empty "success".
 */
function assertValidPeriod(from: string, to: string): void {
  const span = monthSpan(from, to);
  if (span < 1) throw err(422, 'Reporting period end (to) cannot be before its start (from).');
  if (span > 24) throw err(422, 'Reporting period cannot exceed 24 months.');
}
function shiftMonth(ym: string, delta: number): string {
  const [y, m] = ym.split('-').map(Number) as [number, number];
  const total = y * 12 + (m - 1) + delta;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return `${ny}-${String(nm).padStart(2, '0')}`;
}

// ── shared row types (raw DB) ────────────────────────────────────────────────
interface RunRow {
  id: string;
  run_no: string;
  status: string;
  period_month: string;
  pay_group: string | null;
  pay_group_id: string | null;
  gross_total: number | null;
  deduction_total: number | null;
  net_total: number | null;
  nis_employer_total: number | null;
  employee_count: number | null;
  current_calculation_version_id: string | null;
  current_input_snapshot_id: string | null;
}
interface LineRow {
  employee_id: string;
  gross: number | null;
  paye: number | null;
  nis_employee: number | null;
  nis_employer: number | null;
  health_surcharge: number | null;
  voluntary_deductions: number | null;
  net: number | null;
  department_id: string | null;
  cost_center_id: string | null;
  nis_class_no: number | null;
  nis_number_masked: string | null;
  nis_status: string | null;
}
// supabase-js only infers row types from a LITERAL select string, so these are
// inlined (a runtime `const` string yields GenericStringError[]).
async function loadEligibleRun(runId: string): Promise<RunRow> {
  const { data, error } = await sb
    .from('finance_payroll_runs')
    .select('id, run_no, status, period_month, pay_group, pay_group_id, gross_total, deduction_total, net_total, nis_employer_total, employee_count, current_calculation_version_id, current_input_snapshot_id')
    .eq('id', runId)
    .maybeSingle<RunRow>();
  if (error) throw err(500, 'loadRun: ' + error.message);
  if (!data) throw err(404, 'Payroll run not found.');
  if (!ELIGIBLE_STATES.has(data.status)) {
    throw err(422, `Run is ${data.status}; reports require a locked, released or exported run.`);
  }
  return data;
}
function loadRunLines(runId: string): Promise<LineRow[]> {
  return selectAllRows<LineRow>(() =>
    sb.from('finance_payroll_run_lines')
      .select('employee_id, gross, paye, nis_employee, nis_employer, health_surcharge, voluntary_deductions, net, department_id, cost_center_id, nis_class_no, nis_number_masked, nis_status')
      .eq('run_id', runId).order('id'),
  );
}

// ── name / department / cost-centre resolution ───────────────────────────────
async function resolveNames(ids: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const uniq = [...new Set(ids.filter(Boolean))];
  for (const c of chunk(uniq, 300)) {
    const { data, error } = await sb
      .from('app_users')
      .select('id, full_name, first_name, last_name, username')
      .in('id', c);
    if (error) throw err(500, 'resolveNames: ' + error.message);
    for (const u of data as { id: string; full_name: string | null; first_name: string | null; last_name: string | null; username: string | null }[]) {
      const name =
        (u.full_name ?? '').trim() ||
        [u.first_name, u.last_name].filter(Boolean).join(' ').trim() ||
        (u.username ?? '') ||
        u.id;
      map.set(u.id, name);
    }
  }
  return map;
}
async function resolveDepartments(ids: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const uniq = [...new Set(ids.filter(Boolean))];
  for (const c of chunk(uniq, 300)) {
    const { data, error } = await sb.from('departments').select('id, name').in('id', c);
    if (error) throw err(500, 'resolveDepartments: ' + error.message);
    for (const d of data as { id: string; name: string | null }[]) {
      map.set(d.id, d.name ?? d.id);
    }
  }
  return map;
}
async function resolveCostCentres(ids: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const uniq = [...new Set(ids.filter(Boolean))];
  for (const c of chunk(uniq, 300)) {
    const { data, error } = await sb.from('finance_cost_centers').select('id, name').in('id', c);
    if (error) throw err(500, 'resolveCostCentres: ' + error.message);
    for (const cc of data as { id: string; name: string | null }[]) {
      map.set(cc.id, cc.name ?? cc.id);
    }
  }
  return map;
}

function controlTotals(lines: LineRow[]): ReportControlTotals {
  let gross = 0, net = 0;
  for (const l of lines) { gross += (l.gross ?? 0); net += (l.net ?? 0); }
  return {
    employees: lines.length,
    gross: money(gross),
    deductions: money(gross - net),
    net: money(net),
  };
}

// ── period runs (eligible only) ──────────────────────────────────────────────
async function loadPeriodRuns(from: string, to: string): Promise<RunRow[]> {
  assertValidPeriod(from, to);
  const { data, error } = await sb
    .from('finance_payroll_runs')
    .select('id, run_no, status, period_month, pay_group, pay_group_id, gross_total, deduction_total, net_total, nis_employer_total, employee_count, current_calculation_version_id, current_input_snapshot_id')
    .gte('period_month', monthStart(from))
    .lt('period_month', monthAfter(to))
    .in('status', ['locked', 'released', 'exported'])
    .order('period_month');
  if (error) throw err(500, 'loadPeriodRuns: ' + error.message);
  return data;
}

// ════════════════════════════════════════════════════════════════════════════
// Per-report compute
// ════════════════════════════════════════════════════════════════════════════

async function computeRegister(p: Extract<ReportParams, { report: 'payroll_register' }>): Promise<Completed> {
  const run = await loadEligibleRun(p.runId);
  if (p.payGroupId && run.pay_group_id !== p.payGroupId) {
    throw err(422, 'The requested pay group does not match this run.');
  }
  let lines = await loadRunLines(p.runId);
  if (p.departmentId) lines = lines.filter(l => l.department_id === p.departmentId);
  if (lines.length > PREVIEW_ROW_CAP) throw err(422, 'Preview exceeds 5,000 rows — export this report to a file instead.');
  const names = await resolveNames(lines.map(l => l.employee_id));
  const rows: RegisterRow[] = lines
    .map(l => ({
      employeeId: l.employee_id,
      employeeName: names.get(l.employee_id) ?? l.employee_id,
      payGroup: run.pay_group ?? '—',
      gross: money(l.gross ?? 0),
      paye: money(l.paye ?? 0),
      nis: money(l.nis_employee ?? 0),
      other: money(l.voluntary_deductions ?? 0),
      net: money(l.net ?? 0),
    }))
    .sort((a, b) => a.employeeId.localeCompare(b.employeeId));
  return {
    state: 'completed',
    report: 'payroll_register',
    scopeId: scopeIdFor({ report: 'payroll_register', runId: p.runId, cv: run.current_calculation_version_id, dept: p.departmentId ?? null }),
    generatedAt: new Date().toISOString(),
    rows,
    totals: controlTotals(lines),
  };
}

async function computeNetPaySummary(p: Extract<ReportParams, { report: 'net_pay_summary' }>): Promise<Completed> {
  const run = await loadEligibleRun(p.runId);
  const lines = await loadRunLines(p.runId);
  const groupBy = p.groupBy ?? 'pay_group';

  // Per-employee worst open-finding severity → group readiness.
  const findings = await selectAllRows<{ employee_id: string | null; severity: string | null }>(() =>
    sb.from('finance_payroll_control_findings')
      .select('employee_id, severity').eq('run_id', p.runId).eq('state', 'open').order('id'),
  );
  const worst = new Map<string, 'blocker' | 'warning'>();
  for (const f of findings) {
    if (!f.employee_id) continue;
    const sev = f.severity === 'blocker' ? 'blocker' : 'warning';
    if (sev === 'blocker' || !worst.has(f.employee_id)) worst.set(f.employee_id, sev);
  }

  const deptNames = groupBy === 'department' ? await resolveDepartments(lines.map(l => l.department_id ?? '')) : null;
  const ccNames = groupBy === 'cost_centre' ? await resolveCostCentres(lines.map(l => l.cost_center_id ?? '')) : null;
  const keyOf = (l: LineRow): string => {
    if (groupBy === 'department') return deptNames?.get(l.department_id ?? '') ?? (l.department_id ?? 'Unassigned');
    if (groupBy === 'cost_centre') return ccNames?.get(l.cost_center_id ?? '') ?? (l.cost_center_id ?? 'Unassigned');
    return run.pay_group ?? 'Unassigned';
  };

  interface Agg { gross: number; net: number; employees: number; blocker: boolean; warning: boolean }
  const groups = new Map<string, Agg>();
  for (const l of lines) {
    const k = keyOf(l);
    const g = groups.get(k) ?? { gross: 0, net: 0, employees: 0, blocker: false, warning: false };
    g.gross += (l.gross ?? 0);
    g.net += (l.net ?? 0);
    g.employees += 1;
    const w = worst.get(l.employee_id);
    if (w === 'blocker') g.blocker = true;
    else if (w === 'warning') g.warning = true;
    groups.set(k, g);
  }
  const rows: NetPaySummaryRow[] = [...groups.entries()]
    .map(([group, g]) => ({
      group,
      employees: g.employees,
      gross: money(g.gross),
      deductions: money(g.gross - g.net),
      net: money(g.net),
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion -- narrows the string ternary to the readiness union (tsc needs it)
      readiness: (g.blocker ? 'held' : g.warning ? 'review' : 'ready') as NetPaySummaryRow['readiness'],
    }))
    .sort((a, b) => a.group.localeCompare(b.group));
  return {
    state: 'completed',
    report: 'net_pay_summary',
    scopeId: scopeIdFor({ report: 'net_pay_summary', runId: p.runId, cv: run.current_calculation_version_id, groupBy }),
    generatedAt: new Date().toISOString(),
    rows,
    totals: controlTotals(lines),
  };
}

async function computeCostAnalysis(p: Extract<ReportParams, { report: 'payroll_cost_analysis' }>): Promise<Completed> {
  const runs = await loadPeriodRuns(p.period.from, p.period.to);
  const groupBy = p.groupBy ?? 'department_cost_centre';
  const includeEmployer = (p.include ?? 'gross_net_employer') === 'gross_net_employer';

  // Prior equal-length window for vsPriorPct.
  const span = monthSpan(p.period.from, p.period.to);
  const priorTo = shiftMonth(p.period.from, -1);
  const priorFrom = shiftMonth(priorTo, -(span - 1));

  // Tag each line with its run's pay group so pay_group grouping keys off the
  // ACTUAL pay group (not the department) — two pay groups sharing a department
  // must not collapse.
  type TaggedLine = LineRow & { _payGroup: string };
  const allLines = async (rs: RunRow[]): Promise<TaggedLine[]> => {
    const out: TaggedLine[] = [];
    for (const r of rs) {
      const pg = r.pay_group ?? 'Unassigned';
      for (const l of await loadRunLines(r.id)) out.push({ ...l, _payGroup: pg });
    }
    return out;
  };
  const curLines = await allLines(runs);
  // Fail closed: a prior-window DB error must not masquerade as "no prior data".
  const priorRuns = await loadPeriodRuns(priorFrom, priorTo);
  const priorLines = await allLines(priorRuns);

  const deptNames = await resolveDepartments([...curLines, ...priorLines].map(l => l.department_id ?? ''));
  const ccNames = await resolveCostCentres([...curLines, ...priorLines].map(l => l.cost_center_id ?? ''));
  const label = (l: TaggedLine): { key: string; dept: string; cc: string } => {
    if (groupBy === 'pay_group') return { key: l._payGroup, dept: l._payGroup, cc: '—' };
    const dept = deptNames.get(l.department_id ?? '') ?? (l.department_id ?? 'Unassigned');
    const cc = ccNames.get(l.cost_center_id ?? '') ?? (l.cost_center_id ?? 'Unassigned');
    return { key: `${dept} ${cc}`, dept, cc };
  };

  interface Agg { dept: string; cc: string; gross: number; employer: number; employees: number }
  const cur = new Map<string, Agg>();
  for (const l of curLines) {
    const { key, dept, cc } = label(l);
    const g = cur.get(key) ?? { dept, cc, gross: 0, employer: 0, employees: 0 };
    g.gross += (l.gross ?? 0);
    g.employer += (l.gross ?? 0) + (includeEmployer ? (l.nis_employer ?? 0) + (l.health_surcharge ?? 0) : 0);
    g.employees += 1;
    cur.set(key, g);
  }
  const priorGross = new Map<string, number>();
  for (const l of priorLines) {
    const { key } = label(l);
    priorGross.set(key, (priorGross.get(key) ?? 0) + (l.gross ?? 0));
  }

  const rows: CostRow[] = [...cur.entries()]
    .map(([key, g]) => {
      const prior = priorGross.get(key) ?? 0;
      return {
        department: g.dept,
        costCentre: g.cc,
        employees: g.employees,
        gross: money(g.gross),
        employerCost: money(g.employer),
        vsPriorPct: prior > 0 ? r2(((g.gross - prior) / prior) * 100) : 0,
      };
    })
    .sort((a, b) => a.department.localeCompare(b.department) || a.costCentre.localeCompare(b.costCentre));

  const scopeId = scopeIdFor({ report: 'payroll_cost_analysis', from: p.period.from, to: p.period.to, groupBy, include: p.include ?? null });
  const chart: ReportChart = {
    scopeId,
    series: [{ label: 'Gross by group', unit: 'TTD', points: rows.map(r => ({ x: `${r.department}${r.costCentre !== '—' ? ' / ' + r.costCentre : ''}`, y: r.gross.amount })).slice(0, 24) }],
  };
  return {
    state: 'completed',
    report: 'payroll_cost_analysis',
    scopeId,
    generatedAt: new Date().toISOString(),
    rows,
    chart,
    totals: controlTotals(curLines),
  };
}

async function computeReconciliation(p: Extract<ReportParams, { report: 'gross_to_net_reconciliation' }>): Promise<Completed> {
  const run = await loadEligibleRun(p.runId);
  const lines = await loadRunLines(p.runId);
  let gross = 0, net = 0, nisEmployer = 0;
  for (const l of lines) {
    gross += (l.gross ?? 0);
    net += (l.net ?? 0);
    nisEmployer += (l.nis_employer ?? 0);
  }
  const src = (source: string, register: number, summary: number): ReconciliationSource => {
    const diff = r2(register - summary);
    return {
      source,
      registerTotal: money(register),
      summaryTotal: money(summary),
      difference: money(diff),
      matched: diff === 0,
      evidenceRef: `${run.run_no}:${source}`,
    };
  };
  const sources: ReconciliationSource[] = [
    src('gross', gross, (run.gross_total ?? 0)),
    src('deductions', gross - net, (run.deduction_total ?? 0)),
    src('net', net, (run.net_total ?? 0)),
    src('nis_employer', nisEmployer, (run.nis_employer_total ?? 0)),
  ];
  const reconciliation: ReconciliationResult = {
    scopeId: scopeIdFor({ report: 'gross_to_net_reconciliation', runId: p.runId, cv: run.current_calculation_version_id }),
    currency: 'TTD',
    balanced: sources.every(s => s.matched),
    sources,
  };
  return {
    state: 'completed',
    report: 'gross_to_net_reconciliation',
    scopeId: reconciliation.scopeId,
    generatedAt: new Date().toISOString(),
    reconciliation,
  };
}

async function sumMeasures(runId: string): Promise<{ gross: number; net: number; paye: number; nis: number; employees: number }> {
  const lines = await loadRunLines(runId);
  let gross = 0, net = 0, paye = 0, nis = 0;
  for (const l of lines) {
    gross += (l.gross ?? 0); net += (l.net ?? 0);
    paye += (l.paye ?? 0); nis += (l.nis_employee ?? 0);
  }
  return { gross, net, paye, nis, employees: lines.length };
}

async function computeVariance(p: Extract<ReportParams, { report: 'variance_analysis' }>): Promise<Completed> {
  const run = await loadEligibleRun(p.runId);
  let priorRunId = p.compareRunId ?? null;
  if (priorRunId && priorRunId === p.runId) throw err(422, 'The comparison run must differ from the reporting run.');
  if (!priorRunId) {
    // Auto-compare only to the latest earlier COMPARABLE run — same pay group —
    // never an unrelated run of a different population. Fail closed on error.
    let q = sb
      .from('finance_payroll_runs')
      .select('id')
      .lt('period_month', run.period_month)
      .in('status', ['locked', 'released', 'exported'])
      .order('period_month', { ascending: false })
      .limit(1);
    q = run.pay_group_id
      ? q.eq('pay_group_id', run.pay_group_id)
      : q.eq('pay_group', run.pay_group ?? '');
    const { data: prior, error } = await q.maybeSingle<{ id: string }>();
    if (error) throw err(500, 'variance prior-run lookup: ' + error.message);
    priorRunId = prior?.id ?? null;
  } else {
    await loadEligibleRun(priorRunId); // validate eligibility of an explicit comparison run
  }

  const cur = await sumMeasures(p.runId);
  const prior = priorRunId ? await sumMeasures(priorRunId) : { gross: 0, net: 0, paye: 0, nis: 0, employees: 0 };
  const driver = cur.employees !== prior.employees ? 'headcount change' : 'rate/amount change';
  const mk = (measure: string, pv: number, cv: number): VarianceRow => ({
    measure,
    value: { unit: 'money', prior: money(pv), current: money(cv) },
    changePct: pv > 0 ? r2(((cv - pv) / pv) * 100) : 0,
    driver,
    certified: false,
  });
  const rows: VarianceRow[] = [
    mk('gross', prior.gross, cur.gross),
    mk('net', prior.net, cur.net),
    mk('paye', prior.paye, cur.paye),
    mk('nis', prior.nis, cur.nis),
  ];
  const scopeId = scopeIdFor({ report: 'variance_analysis', runId: p.runId, compareRunId: priorRunId });
  const chart: ReportChart = {
    scopeId,
    series: [
      { label: 'Prior', unit: 'TTD', points: rows.map(r => ({ x: r.measure, y: (r.value as { prior: MoneyValue }).prior.amount })) },
      { label: 'Current', unit: 'TTD', points: rows.map(r => ({ x: r.measure, y: (r.value as { current: MoneyValue }).current.amount })) },
    ],
  };
  return { state: 'completed', report: 'variance_analysis', scopeId, generatedAt: new Date().toISOString(), rows, chart };
}

async function computeOvertimeAllowance(p: Extract<ReportParams, { report: 'overtime_allowance_analysis' }>): Promise<Completed> {
  const runs = await loadPeriodRuns(p.period.from, p.period.to);
  const groupBy = p.groupBy ?? 'department';
  const exceptionsOnly = (p.thresholdMode ?? 'all') === 'exceptions';

  interface Agg { key: string; label: string; employees: Set<string>; otHours: number; otCost: number; allowCost: number }
  const groups = new Map<string, Agg>();

  for (const run of runs) {
    if (!run.current_input_snapshot_id) continue;
    const lines = await loadRunLines(run.id);
    const deptOf = new Map(lines.map(l => [l.employee_id, l.department_id]));
    const ccOf = new Map(lines.map(l => [l.employee_id, l.cost_center_id]));
    const comps = await selectAllRows<{ employee_id: string; component_code: string | null; amount: number | null; quantity: number | null }>(() =>
      sb.from('finance_payroll_input_snapshot_lines')
        .select('employee_id, component_code, amount, quantity')
        .eq('input_snapshot_id', run.current_input_snapshot_id)
        .in('component_code', [OVERTIME_CODE, ...ALLOWANCE_CODES])
        .order('id'),
    );
    const deptIds = [...new Set(lines.map(l => l.department_id ?? ''))];
    const ccIds = [...new Set(lines.map(l => l.cost_center_id ?? ''))];
    const deptNames = groupBy === 'cost_centre' ? new Map<string, string>() : await resolveDepartments(deptIds);
    const ccNames = groupBy === 'cost_centre' ? await resolveCostCentres(ccIds) : new Map<string, string>();
    for (const c of comps) {
      let key: string, label: string;
      if (groupBy === 'cost_centre') { const id = ccOf.get(c.employee_id) ?? ''; label = ccNames.get(id) ?? (id || 'Unassigned'); key = label; }
      else if (groupBy === 'pay_group') { label = run.pay_group ?? 'Unassigned'; key = label; }
      else { const id = deptOf.get(c.employee_id) ?? ''; label = deptNames.get(id) ?? (id || 'Unassigned'); key = label; }
      const g = groups.get(key) ?? { key, label, employees: new Set<string>(), otHours: 0, otCost: 0, allowCost: 0 };
      g.employees.add(c.employee_id);
      if (c.component_code === OVERTIME_CODE) { g.otHours += (c.quantity ?? 0); g.otCost += (c.amount ?? 0); }
      else { g.allowCost += (c.amount ?? 0); }
      groups.set(key, g);
    }
  }

  // Phase A: no overtime/materiality threshold policy (R7) → controlStatus is
  // always 'approved' and 'exceptions' mode yields no rows (nothing to exceed).
  const rows: OvertimeRow[] = exceptionsOnly ? [] : [...groups.values()]
    .map(g => ({
      department: g.label,
      employees: g.employees.size,
      overtimeHours: r2(g.otHours),
      overtimeCost: money(g.otCost),
      allowanceCost: money(g.allowCost),
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion -- pins the literal to the controlStatus union (tsc needs it)
      controlStatus: 'approved' as OvertimeRow['controlStatus'],
    }))
    .sort((a, b) => a.department.localeCompare(b.department));

  const scopeId = scopeIdFor({ report: 'overtime_allowance_analysis', from: p.period.from, to: p.period.to, groupBy, thresholdMode: p.thresholdMode ?? 'all' });
  const chart: ReportChart = {
    scopeId,
    series: [
      { label: 'Overtime cost', unit: 'TTD', points: rows.map(r => ({ x: r.department, y: r.overtimeCost.amount })).slice(0, 24) },
      { label: 'Overtime hours', unit: 'hours', points: rows.map(r => ({ x: r.department, y: r.overtimeHours })).slice(0, 24) },
    ],
  };
  return { state: 'completed', report: 'overtime_allowance_analysis', scopeId, generatedAt: new Date().toISOString(), rows, chart };
}

async function computePopulationMovements(p: Extract<ReportParams, { report: 'population_movements' }>): Promise<Completed> {
  assertValidPeriod(p.period.from, p.period.to);
  const from = monthStart(p.period.from);
  const toExcl = monthAfter(p.period.to);
  const want = p.movementType ?? 'all';
  const evidenceFilter = p.evidenceStatus ?? 'all';
  const rows: PopulationMovementRow[] = [];

  const empIds: string[] = [];
  interface Raw { employeeId: string; movement: PopulationMovementRow['movement']; effectiveDate: string; prior: string; current: string; impact: string; verified: boolean; deptId: string | null }
  const raws: Raw[] = [];

  // Hires — employee start_date in period (employee start records).
  if (want === 'all' || want === 'hires_leavers') {
    const { data, error } = await sb.from('app_users')
      .select('id, start_date, department_id, status')
      .gte('start_date', from).lt('start_date', toExcl);
    if (error) throw err(500, 'population hires: ' + error.message);
    for (const u of data as { id: string; start_date: string | null; department_id: string | null; status: string | null }[]) {
      if (!u.start_date) continue;
      raws.push({ employeeId: u.id, movement: 'hire', effectiveDate: u.start_date, prior: '—', current: '', impact: 'Added to payroll population', verified: u.status === 'active', deptId: u.department_id });
      empIds.push(u.id);
    }
  }
  // Leavers — offboarding last working day / exit date in period.
  if (want === 'all' || want === 'hires_leavers') {
    const { data, error } = await sb.from('hr_offboarding_cases')
      .select('employee_id, last_working_day, exit_date, status')
      .in('status', ['ready_for_exit', 'completed']);
    if (error) throw err(500, 'population leavers: ' + error.message);
    for (const o of data as { employee_id: string; last_working_day: string | null; exit_date: string | null; status: string | null }[]) {
      const eff = o.last_working_day ?? o.exit_date;
      if (!eff || eff < from || eff >= toExcl) continue;
      raws.push({ employeeId: o.employee_id, movement: 'leaver', effectiveDate: eff, prior: '', current: '—', impact: 'Removed from payroll population', verified: o.status === 'completed', deptId: null });
      empIds.push(o.employee_id);
    }
  }
  // Unpaid leave — approved leave of an unpaid type overlapping the period.
  if (want === 'all' || want === 'leave') {
    const { data: unpaidTypes, error: typesErr } = await sb.from('hr_leave_types').select('id').eq('paid', false);
    if (typesErr) throw err(500, 'population leave types: ' + typesErr.message);
    const unpaidIds = (unpaidTypes as { id: string }[]).map(t => t.id);
    if (unpaidIds.length) {
      const { data, error } = await sb.from('hr_leave_requests')
        .select('employee_id, from_date, to_date, status, leave_type_id')
        .eq('status', 'approved').in('leave_type_id', unpaidIds)
        .lt('from_date', toExcl).gte('to_date', from);
      if (error) throw err(500, 'population unpaid leave: ' + error.message);
      for (const lv of data as { employee_id: string; from_date: string; to_date: string; status: string }[]) {
        raws.push({ employeeId: lv.employee_id, movement: 'unpaid_leave', effectiveDate: lv.from_date, prior: '', current: '', impact: 'Unpaid leave period', verified: true, deptId: null });
        empIds.push(lv.employee_id);
      }
    }
  }

  const names = await resolveNames(empIds);
  const deptNames = await resolveDepartments(raws.map(r => r.deptId ?? ''));
  for (const rw of raws) {
    const evidence = rw.verified ? 'verified' : 'missing';
    if (evidenceFilter !== 'all' && evidence !== evidenceFilter) continue;
    const deptName = rw.deptId ? (deptNames.get(rw.deptId) ?? rw.deptId) : '';
    rows.push({
      employeeId: rw.employeeId,
      employeeName: names.get(rw.employeeId) ?? rw.employeeId,
      movement: rw.movement,
      effectiveDate: rw.effectiveDate,
      priorAssignment: rw.movement === 'hire' ? '—' : (deptName || rw.prior),
      currentAssignment: rw.movement === 'leaver' ? '—' : (deptName || rw.current),
      payrollImpact: rw.impact,
      evidence,
    });
  }
  rows.sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate) || a.employeeId.localeCompare(b.employeeId));
  return {
    state: 'completed',
    report: 'population_movements',
    scopeId: scopeIdFor({ report: 'population_movements', from: p.period.from, to: p.period.to, movementType: want, evidenceStatus: evidenceFilter }),
    generatedAt: new Date().toISOString(),
    rows,
  };
}

async function computeNisExceptions(p: Extract<ReportParams, { report: 'nis_exceptions' }>): Promise<Completed> {
  if (p.scope === 'run' && !p.runId) throw err(422, 'A run is required when scope is "run".');
  if (p.scope === 'all' && p.runId) throw err(422, 'Do not supply a run when scope is "all".');

  const rows: NisExceptionRow[] = [];
  // The legacy NIS engine rows are loosely typed (unknown values); coerce safely.
  const str = (v: unknown): string => (typeof v === 'string' ? v : '');
  if (p.scope === 'run' && p.runId) {
    const run = await loadEligibleRun(p.runId);
    const warnings = await reportNisExceptions(p.runId);
    const lines = await loadRunLines(run.id);
    const lineOf = new Map(lines.map(l => [l.employee_id, l]));
    const empIds = warnings.rows.map(w => str(w.employee_id)).filter(Boolean);
    const names = await resolveNames(empIds);
    for (const w of warnings.rows) {
      const eid = str(w.employee_id);
      if (!eid) continue;
      const line = lineOf.get(eid);
      const status = line?.nis_status ?? 'unverified';
      rows.push({
        employeeId: eid,
        employeeName: names.get(eid) ?? eid,
        nisNumber: line?.nis_number_masked ?? null,
        nisClass: line?.nis_class_no != null ? String(line.nis_class_no) : '—',
        profileStatus: status === 'continuity_review' ? 'continuity_review' : 'unverified',
        payrollImpact: str(w.message),
        owner: '',
      });
    }
  } else {
    const unverified = await reportUnverifiedNis();
    const empIds = unverified.rows.map(r => str(r.employee_id)).filter(Boolean);
    const names = await resolveNames(empIds);
    for (const r of unverified.rows) {
      const eid = str(r.employee_id);
      if (!eid) continue;
      const st = str(r.nis_status) || 'unverified';
      rows.push({
        employeeId: eid,
        employeeName: names.get(eid) ?? eid,
        nisNumber: (r.nis_number as string | null) ?? null,
        nisClass: '—',
        profileStatus: st === 'continuity_review' ? 'continuity_review' : 'unverified',
        payrollImpact: 'NIS profile requires verification',
        owner: '',
      });
    }
  }
  rows.sort((a, b) => a.employeeId.localeCompare(b.employeeId));
  return {
    state: 'completed',
    report: 'nis_exceptions',
    scopeId: scopeIdFor({ report: 'nis_exceptions', scope: p.scope, runId: p.runId ?? null }),
    generatedAt: new Date().toISOString(),
    rows,
  };
}

// ── public dispatch ──────────────────────────────────────────────────────────
export async function computeInteractiveReport(params: InteractiveReportParams): Promise<Completed> {
  switch (params.report) {
    case 'payroll_register': return computeRegister(params);
    case 'net_pay_summary': return computeNetPaySummary(params);
    case 'payroll_cost_analysis': return computeCostAnalysis(params);
    case 'gross_to_net_reconciliation': return computeReconciliation(params);
    case 'variance_analysis': return computeVariance(params);
    case 'overtime_allowance_analysis': return computeOvertimeAllowance(params);
    case 'population_movements': return computePopulationMovements(params);
    case 'nis_exceptions': return computeNisExceptions(params);
    default: {
      const _exhaustive: never = params;
      throw err(422, `Unsupported interactive report: ${(_exhaustive as { report: string }).report}`);
    }
  }
}

// ── catalog metadata ─────────────────────────────────────────────────────────
interface ReportMeta { label: string; description: string; category: ReportCatalogEntry['category']; paramKind: ReportCatalogEntry['paramKind'] }
const REPORT_META: Record<PayrollReportKey, ReportMeta> = {
  payroll_register:            { label: 'Payroll Register', description: 'Per-employee gross-to-net register for a locked run.', category: 'operational', paramKind: 'single_run' },
  net_pay_summary:             { label: 'Net Pay Summary', description: 'Net pay grouped by pay group, department or cost centre with readiness.', category: 'operational', paramKind: 'single_run' },
  payroll_cost_analysis:       { label: 'Payroll Cost Analysis', description: 'Employer cost by department/cost centre over a period, vs prior.', category: 'financial', paramKind: 'period' },
  gross_to_net_reconciliation: { label: 'Gross-to-Net Reconciliation', description: 'Exact reconciliation of run totals against the line register.', category: 'financial', paramKind: 'single_run' },
  variance_analysis:           { label: 'Variance Analysis', description: 'Run-over-run variance in gross, net, PAYE and NIS.', category: 'financial', paramKind: 'two_run' },
  overtime_allowance_analysis: { label: 'Overtime & Allowance Analysis', description: 'Overtime hours/cost and allowance cost by group over a period.', category: 'workforce', paramKind: 'period' },
  population_movements:        { label: 'Population Movements', description: 'Hires, leavers and unpaid leave affecting payroll over a period.', category: 'workforce', paramKind: 'period' },
  nis_exceptions:              { label: 'NIS Exceptions', description: 'Unverified / continuity-review NIS profiles for a run or overall.', category: 'statutory', paramKind: 'nis_scope' },
  export_audit_package:        { label: 'Export Audit Package', description: 'Tamper-evident ZIP of run exports and decisions for audit.', category: 'statutory', paramKind: 'single_run' },
};

export function buildReportCatalog(caller: { canViewAll: boolean; canExport: boolean }): ReportCatalogEntry[] {
  return PAYROLL_REPORT_KEYS.map((key): ReportCatalogEntry => {
    const employeeLevel = EMPLOYEE_LEVEL_REPORTS.has(key);
    const supportedFormats = REPORT_FORMAT_MATRIX[key].filter((f: ReportFormat) => isFormatEnabled(f)
      && (!employeeLevel || caller.canViewAll)
      && (f === 'preview' || caller.canExport));
    const meta = REPORT_META[key];
    return {
      key,
      label: meta.label,
      description: meta.description,
      category: meta.category,
      supportedFormats,
      paramKind: meta.paramKind,
      requiresViewAll: employeeLevel,
      requiresExport: REPORT_FORMAT_MATRIX[key].every((f: ReportFormat) => f !== 'preview'),
    };
  });
}

// ── preview audit (single audit row, no business event) ──────────────────────
export async function logReportPreview(
  actorId: string,
  params: InteractiveReportParams,
  scopeId: string,
): Promise<void> {
  const { error } = await sb.rpc('finance_payroll_report_log_run', {
    p_actor_id: actorId,
    p_report_key: params.report,
    p_params: params,
    p_scope_id: scopeId,
    p_format: 'preview',
  });
  if (error) throw err(500, 'logReportPreview: ' + error.message);
}

// ── enqueue a file-export job (§8 MUT-RPT-001) ───────────────────────────────
type FileFormat = 'csv' | 'pdf' | 'zip'; // XLSX deferred (see REPORT_FORMAT_MATRIX)
export async function enqueueReportJob(input: {
  actorId: string; params: ReportParams; format: FileFormat; idempotencyKey: string;
}): Promise<{ state: 'queued'; jobId: string }> {
  // requires_view_all / requires_export are SERVER-derived here — never client-supplied.
  const reqs = deriveReportRequirements(input.params.report, input.format);
  const scopeId = scopeIdFor({ report: input.params.report, params: input.params, format: input.format });
  const res = await sb.rpc('finance_payroll_report_enqueue_tx', {
    p_actor_id: input.actorId,
    p_report_key: input.params.report,
    p_params: input.params,
    p_format: input.format,
    p_scope: input.params,
    p_scope_id: scopeId,
    p_requires_view_all: reqs.requiresViewAll,
    p_requires_export: reqs.requiresExport,
    p_idempotency_key: input.idempotencyKey,
  });
  if (res.error) throw payrollRpcHttpError(res.error);
  return { state: 'queued', jobId: (res.data as { id: string }).id };
}

// ── KPI summary (§4A) ────────────────────────────────────────────────────────
/** Start of the current AST (UTC-4, no DST) month as a UTC ISO instant. */
function astMonthStartIso(): string {
  const ast = new Date(Date.now() - 4 * 3600_000);
  return new Date(Date.UTC(ast.getUTCFullYear(), ast.getUTCMonth(), 1, 4, 0, 0)).toISOString();
}
const tile = (value: number, available = true): ReportKpiTile => ({ value, available });
const TILE_NA: ReportKpiTile = { value: null, available: false };

export async function computeReportSummary(caller: { canViewAll: boolean; canExport: boolean }): Promise<ReportKpiTiles> {
  const monthStartIso = astMonthStartIso();

  // availableReports — runnable catalog keys for this caller.
  const availableReports = tile(buildReportCatalog(caller).filter(e => e.supportedFormats.length > 0).length);

  // generatedThisMonth — succeeded artifacts this AST month, gated per §4A.
  // Every count fails closed: a DB error must NOT read as a real "0".
  let genQ = sb.from('payroll_report_artifacts').select('id', { count: 'exact', head: true }).gte('created_at', monthStartIso);
  if (!caller.canExport) genQ = genQ.eq('requires_export', false);
  if (!caller.canViewAll) genQ = genQ.eq('requires_view_all', false);
  const { count: genCount, error: genErr } = await genQ;
  if (genErr) throw err(500, 'summary generatedThisMonth: ' + genErr.message);
  const generatedThisMonth = tile(genCount ?? 0);

  // nisExceptions — latest eligible run's open unverified/continuity; needs view_all.
  let nisExceptions: ReportKpiTile = TILE_NA;
  if (caller.canViewAll) {
    const { data: run, error: runErr } = await sb.from('finance_payroll_runs')
      .select('id').in('status', ['locked', 'released', 'exported'])
      .order('period_month', { ascending: false }).limit(1).maybeSingle<{ id: string }>();
    if (runErr) throw err(500, 'summary nis run lookup: ' + runErr.message);
    if (run) {
      const { count, error: cErr } = await sb.from('finance_payroll_run_lines')
        .select('employee_id', { count: 'exact', head: true })
        .eq('run_id', run.id).in('nis_status', ['unverified', 'continuity_review']);
      if (cErr) throw err(500, 'summary nis count: ' + cErr.message);
      nisExceptions = tile(count ?? 0);
    } else {
      nisExceptions = tile(0);
    }
  }

  // materialVariances — Phase A: always inert (no materiality/escalation policy, R7).
  const materialVariances: ReportKpiTile = TILE_NA;

  // auditPackages — succeeded export_audit_package this AST month; needs export.
  let auditPackages: ReportKpiTile = TILE_NA;
  if (caller.canExport) {
    const { count, error: apErr } = await sb.from('payroll_report_artifacts')
      .select('id, payroll_report_jobs!job_id!inner(report_key)', { count: 'exact', head: true })
      .gte('created_at', monthStartIso)
      .eq('payroll_report_jobs.report_key', 'export_audit_package');
    if (apErr) throw err(500, 'summary auditPackages: ' + apErr.message);
    auditPackages = tile(count ?? 0);
  }

  return { availableReports, generatedThisMonth, nisExceptions, materialVariances, auditPackages };
}

// ── history (keyset, additive-gate filtered) ─────────────────────────────────
interface ArtifactJoinRow {
  id: string; scope_id: string; format: string; byte_size: number; sha256: string;
  row_count: number; retention_class: string; retention_expires_at: string;
  requires_view_all: boolean; requires_export: boolean; purge_state: string;
  created_by: string | null; created_at: string;
  payroll_report_jobs: { report_key: string } | { report_key: string }[] | null;
}
function jobKey(j: ArtifactJoinRow['payroll_report_jobs']): PayrollReportKey {
  const rec = Array.isArray(j) ? j[0] : j;
  return (rec?.report_key ?? 'payroll_register') as PayrollReportKey;
}
const purgeToStatus = (s: string): ReportArtifactRow['status'] =>
  s === 'purged' ? 'purged' : s === 'purging' ? 'purging' : 'ready';
const encodeCursor = (createdAt: string, id: string): string =>
  Buffer.from(`${createdAt}|${id}`).toString('base64url');
function decodeCursor(cursor: string): { createdAt: string; id: string } | null {
  try {
    const [createdAt, id] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
    return createdAt && id ? { createdAt, id } : null;
  } catch { return null; }
}

export async function listReportHistory(
  caller: { canViewAll: boolean; canExport: boolean },
  opts: { cursor?: string; limit?: number; reportKey?: PayrollReportKey },
): Promise<PageResult<ReportArtifactRow>> {
  const limit = Math.min(Math.max(opts.limit ?? 25, 1), 100);
  // Disambiguate the embed: two FKs exist between artifacts and jobs
  // (artifacts.job_id → jobs, and jobs.artifact_id → artifacts). Hint the job_id FK.
  let q = sb.from('payroll_report_artifacts')
    .select('id, scope_id, format, byte_size, sha256, row_count, retention_class, retention_expires_at, requires_view_all, requires_export, purge_state, created_by, created_at, payroll_report_jobs!job_id!inner(report_key)')
    .order('created_at', { ascending: false }).order('id', { ascending: false })
    .limit(limit + 1);
  if (!caller.canExport) q = q.eq('requires_export', false);
  if (!caller.canViewAll) q = q.eq('requires_view_all', false);
  if (opts.reportKey) q = q.eq('payroll_report_jobs.report_key', opts.reportKey);
  const cur = opts.cursor ? decodeCursor(opts.cursor) : null;
  if (cur) q = q.or(`created_at.lt.${cur.createdAt},and(created_at.eq.${cur.createdAt},id.lt.${cur.id})`);
  const { data, error } = await q;
  if (error) throw err(500, 'listReportHistory: ' + error.message);
  const raw = data as ArtifactJoinRow[];
  const hasMore = raw.length > limit;
  const page = raw.slice(0, limit);
  const rows: ReportArtifactRow[] = page.map(a => ({
    id: a.id,
    reportKey: jobKey(a.payroll_report_jobs),
    scopeId: a.scope_id,
    format: a.format as ReportArtifactFormat,
    byteSize: (a.byte_size),
    sha256: a.sha256,
    rowCount: a.row_count,
    retentionClass: a.retention_class,
    retentionExpiresAt: a.retention_expires_at,
    requiresViewAll: a.requires_view_all,
    requiresExport: a.requires_export,
    status: purgeToStatus(a.purge_state),
    createdBy: a.created_by ?? '',
    createdAt: a.created_at,
  }));
  const last = page[page.length - 1];
  const nextCursor = hasMore ? encodeCursor(last.created_at, last.id) : null;
  return { rows, nextCursor };
}

// ── job status (read-only, state-discriminated; 404 on any auth failure) ─────
interface JobRow {
  id: string; report_key: string; requested_by: string | null;
  requires_view_all: boolean; requires_export: boolean; state: string;
  error: { code: string; message: string; retryable: boolean } | null; artifact_id: string | null;
  created_at: string; started_at: string | null; lease_expires_at: string | null;
  completed_at: string | null; failed_at: string | null;
}
interface ArtifactRowDb {
  id: string; scope_id: string; format: string; byte_size: number; sha256: string; row_count: number;
  retention_class: string; retention_expires_at: string; requires_view_all: boolean; requires_export: boolean;
  purge_state: string; created_by: string | null; created_at: string;
}
function toArtifactRow(a: ArtifactRowDb, reportKey: PayrollReportKey): ReportArtifactRow {
  return {
    id: a.id, reportKey, scopeId: a.scope_id, format: a.format as ReportArtifactFormat,
    byteSize: (a.byte_size), sha256: a.sha256, rowCount: a.row_count,
    retentionClass: a.retention_class, retentionExpiresAt: a.retention_expires_at,
    requiresViewAll: a.requires_view_all, requiresExport: a.requires_export,
    status: purgeToStatus(a.purge_state), createdBy: a.created_by ?? '', createdAt: a.created_at,
  };
}

/**
 * Returns the job status only when the caller is (the requester OR a reports.export
 * reviewer) AND holds every requirement the job stored. Any other case → null
 * (the route returns 404, no existence leak). Permissions are re-evaluated here.
 */
export async function getReportJobStatus(opts: {
  jobId: string; actorId: string; canViewAll: boolean; canExport: boolean;
}): Promise<ReportJobStatus | null> {
  const { data: job, error: jobErr } = await sb.from('payroll_report_jobs')
    .select('id, report_key, requested_by, requires_view_all, requires_export, state, error, artifact_id, created_at, started_at, lease_expires_at, completed_at, failed_at')
    .eq('id', opts.jobId).maybeSingle<JobRow>();
  // Fail closed: a DB error must throw (500), never masquerade as a not-found 404.
  if (jobErr) throw err(500, 'getReportJobStatus: ' + jobErr.message);
  if (!job) return null;

  const isOwner = job.requested_by === opts.actorId;
  const isReviewer = opts.canExport; // reports.export = reviewer authority (§5C)
  if (!(isOwner || isReviewer)) return null;
  if (job.requires_view_all && !opts.canViewAll) return null;
  if (job.requires_export && !opts.canExport) return null;

  switch (job.state) {
    case 'queued':
      return { state: 'queued', jobId: job.id, queuedAt: job.created_at };
    case 'running':
      return { state: 'running', jobId: job.id, startedAt: job.started_at ?? job.created_at, leaseExpiresAt: job.lease_expires_at ?? job.created_at };
    case 'failed':
      return { state: 'failed', jobId: job.id, failedAt: job.failed_at ?? job.created_at, error: job.error ?? { code: 'unknown', message: 'failed', retryable: false } };
    case 'succeeded': {
      const { data: art, error: artErr } = await sb.from('payroll_report_artifacts')
        .select('id, scope_id, format, byte_size, sha256, row_count, retention_class, retention_expires_at, requires_view_all, requires_export, purge_state, created_by, created_at')
        .eq('id', job.artifact_id ?? '').maybeSingle<ArtifactRowDb>();
      if (artErr) throw err(500, 'getReportJobStatus artifact: ' + artErr.message);
      if (!art) return null;
      return { state: 'succeeded', jobId: job.id, completedAt: job.completed_at ?? job.created_at, artifact: toArtifactRow(art, job.report_key as PayrollReportKey) };
    }
    default:
      return null;
  }
}

// ── artifact download (§6A / API-RPT-006) ────────────────────────────────────
const ARTIFACT_BUCKET = 'payroll-report-artifacts';
/** Frozen artifact signed-URL lifetime (R6-7). expiresAt = issue + 120s. */
const DOWNLOAD_TTL_SECONDS = 120;

interface DownloadArtifactRow {
  id: string; storage_path: string; requires_view_all: boolean; requires_export: boolean;
  purge_state: string; retention_expires_at: string;
}

/** Outcome of a download request — a fresh URL, or a terminal HTTP status. */
export type ReportDownloadOutcome =
  | { ok: true; url: string; expiresAt: string }
  | { ok: false; status: 403 | 404 | 410 };

/**
 * Resolve an artifact download. Reads committed artifact metadata only (a job's
 * uncommitted upload attempt is never an artifact row), enforces the additive
 * gates AFTER the lookup (§5C — 403 when a stored requirement is absent), denies
 * with 410 when the artifact is purging/purged or retention-expired (§6A), then
 * writes the download audit (MUT-RPT-005) and mints a fresh 120-second signed URL.
 * The URL is memory-only and re-issued for every download action — never cached.
 *
 * The 410 boundary (`now >= retention_expires_at`) is the same clock condition the
 * purge worker claims on, so a live download and a purge can never both act on the
 * same artifact at one instant; the worst case at the exact boundary is a signed
 * URL to an object the purge then removes, which simply 404s on fetch (no leak).
 */
export async function resolveReportDownload(opts: {
  artifactId: string; actorId: string; canViewAll: boolean; canExport: boolean;
}): Promise<ReportDownloadOutcome> {
  const { data: art, error: artErr } = await sb.from('payroll_report_artifacts')
    .select('id, storage_path, requires_view_all, requires_export, purge_state, retention_expires_at')
    .eq('id', opts.artifactId).maybeSingle<DownloadArtifactRow>();
  // Fail closed: a DB error must throw (500), never read as a not-found 404.
  if (artErr) throw err(500, 'resolveReportDownload lookup: ' + artErr.message);
  if (!art) return { ok: false, status: 404 };

  // Additive gates (§5C) — export is required for every file; view_all additionally
  // for employee-level artifacts. A missing gate is 403 (not a no-leak 404): the
  // artifact's existence is not sensitive, only its bytes are gated.
  if (art.requires_export && !opts.canExport) return { ok: false, status: 403 };
  if (art.requires_view_all && !opts.canViewAll) return { ok: false, status: 403 };

  const expired = Date.now() >= new Date(art.retention_expires_at).getTime();
  if (art.purge_state === 'purging' || art.purge_state === 'purged' || expired) {
    return { ok: false, status: 410 };
  }

  const logged = await sb.rpc('finance_payroll_report_log_download', {
    p_actor_id: opts.actorId, p_artifact_id: art.id,
  });
  if (logged.error) throw payrollRpcHttpError(logged.error);

  const { data: signed, error: signErr } = await sb.storage
    .from(ARTIFACT_BUCKET).createSignedUrl(art.storage_path, DOWNLOAD_TTL_SECONDS);
  if (signErr || !signed.signedUrl) {
    throw err(500, 'resolveReportDownload: ' + (signErr?.message ?? 'signed URL unavailable'));
  }
  const expiresAt = new Date(Date.now() + DOWNLOAD_TTL_SECONDS * 1000).toISOString();
  return { ok: true, url: signed.signedUrl, expiresAt };
}
