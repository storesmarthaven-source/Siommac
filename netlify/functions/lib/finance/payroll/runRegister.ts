// lib/finance/payroll/runRegister.ts
// Payroll Runs Register read model — §15.2 keyset-paginated run list + tab counts.
// Authority: docs/module-contracts/PAYROLL_RUNS_REGISTER_SLICE.md
//
// Design (no new SQL functions):
//   1. Query ALL runs matching base filter (minimal columns) — no cursor/tab/limit.
//   2. Batch-fetch findings for those run IDs; compute blockerCount+warningCount per run
//      using the SAME rule as the Command Center register (current_calculation_version_id match).
//   3. Compute tabCounts (all/in_progress/approval/attention/released) over the full set.
//   4. Apply tab predicate + sort in memory on the full set.
//   5. Apply cursor (keyset position in sorted list), take limit+1.
//   6. For the page items only: batch-fetch effective totals (calc versions), pay group
//      details, and source run references.
//   7. Map to PayrollRunListItem; build nextCursor from the last item.
//
// Readiness: registerReadinessState from controlCenterDerive.ts is the ONE source.
// Effective totals: coalesce(cv.*, run.*) — same rule as the CC register.

import { sb } from '../../db';
import { registerReadinessState } from './controlCenterDerive';
import type {
  PayrollRunListPageRequest,
  PayrollRunListItem,
  PayrollRunListResult,
  PayrollRunListTab,
  PayrollRunState,
  PayrollRunSort,
  PayrollRunRegisterAggregates,
  MoneyValue,
} from '../../../../../types/payrollRuns';
import type {
  PayrollRunType,
  ReadinessState,
} from '../../../../../types/payrollControlCenter';

// ── Cursor ─────────────────────────────────────────────────────────────────────
//
// Opaque base64url blob validated against a filter fingerprint (includes sort, tab,
// and all filter fields). A cursor replayed with different filters or a different
// sort is rejected with 422. The tuple format differs by sort:
//   pay_date_desc / pay_date_asc  →  [payDate: string|null, periodEnd, runNo, id]
//   updated_desc                  →  [updatedAt, id]

/** djb2 hash → 8 hex chars (identical to controlCenterCursor.ts). */
function hashStr(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return h.toString(16).padStart(8, '0');
}

/** Filter fingerprint: includes sort + tab so cursor is invalidated when either changes. */
function filterFingerprint(req: Omit<PayrollRunListPageRequest, 'cursor' | 'limit'>): string {
  const canonical = JSON.stringify({
    sort:         req.sort ?? 'pay_date_desc',
    tab:          req.tab ?? 'all',
    states:       [...(req.states ?? [])].sort(),
    runTypes:     [...(req.runTypes ?? [])].sort(),
    payGroupIds:  [...(req.payGroupIds ?? [])].sort(),
    search:       req.search?.trim() ?? '',
    periodFrom:   req.periodFrom ?? '',
    periodTo:     req.periodTo ?? '',
  });
  return hashStr(canonical);
}

interface CursorKeyDateSort { sort: 'pay_date_desc' | 'pay_date_asc'; k: [string | null, string, string, string] }
interface CursorKeyUpdated { sort: 'updated_desc'; k: [string, string] }
type CursorKey = CursorKeyDateSort | CursorKeyUpdated;

function encodeCursor(key: CursorKey, fingerprint: string): string {
  const json = JSON.stringify({ f: fingerprint, s: key.sort, k: key.k });
  return Buffer.from(json, 'utf8').toString('base64url');
}

function decodeCursor(cursor: string, fingerprint: string, sort: PayrollRunSort): CursorKey {
  const malformed = (): never => {
    throw Object.assign(new Error('Malformed register cursor.'), { status: 422 });
  };
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  } catch {
    return malformed();
  }
  const obj = parsed as { f?: unknown; s?: unknown; k?: unknown };
  if (typeof obj?.f !== 'string' || typeof obj?.s !== 'string' || !Array.isArray(obj.k)) return malformed();
  if (obj.f !== fingerprint) {
    throw Object.assign(new Error('Register cursor does not match the current filters.'), { status: 422 });
  }
  if (obj.s !== sort) {
    throw Object.assign(new Error('Register cursor sort does not match the requested sort.'), { status: 422 });
  }
  const DATE = /^\d{4}-\d{2}-\d{2}$/;
  const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
  const k = obj.k as unknown[];

  if (sort === 'updated_desc') {
    if (k.length < 2 || typeof k[0] !== 'string' || typeof k[1] !== 'string' || !UUID.test(k[1])) {
      return malformed();
    }
    return { sort: 'updated_desc', k: [k[0], k[1]] };
  }
  // pay_date_desc | pay_date_asc
  if (k.length < 4) return malformed();
  const payDateOk = k[0] === null || (typeof k[0] === 'string' && DATE.test(k[0]));
  const periodEndOk = typeof k[1] === 'string' && DATE.test(k[1]);
  const runNoOk     = typeof k[2] === 'string' && (k[2]).length > 0 && (k[2]).length <= 100;
  const idOk        = typeof k[3] === 'string' && UUID.test(k[3]);
  if (!(payDateOk && periodEndOk && runNoOk && idOk)) return malformed();
  return {
    sort: sort,
    k: [k[0] as string | null, k[1] as string, k[2] as string, k[3] as string],
  };
}

function makeCursorKey(run: RunMinimal, sort: PayrollRunSort): CursorKey {
  if (sort === 'updated_desc') return { sort: 'updated_desc', k: [run.updated_at, run.id] };
  return {
    sort: sort,
    k: [run.pay_date, run.period_end, run.run_no, run.id],
  };
}

// ── Row types ─────────────────────────────────────────────────────────────────

interface RunMinimal {
  id: string;
  run_no: string;
  status: string;
  run_type: string;
  current_calculation_version_id: string | null;
  pay_date: string | null;
  period_start: string;
  period_end: string;
  updated_at: string;
  source_run_id: string | null;
  pay_group_id: string | null;
  pay_group: string | null;
  employee_count: number;
  gross_total: number;
  net_total: number;
  cut_off_date: string | null;
  created_by: string | null;
}

// ── Tab predicates ─────────────────────────────────────────────────────────────
//
// Tabs (spec §15.2, PAYROLL_RUNS_REGISTER_SLICE.md §Decisions 2):
//   all:         status != 'cancelled'                                              [base: default filter excludes cancelled]
//   in_progress: status in ('draft','input_locked','calculated')                    [active, not failed/returned/approval/released]
//   approval:    status = 'pending_approval'
//   attention:   status in ('calculation_failed','returned') OR blockerCount > 0    [action needed]
//   released:    status in ('released','exported')
//
// A run may appear in multiple tabs (e.g., pending_approval + open blockers → both approval AND attention).
// Tab counts are computed independently over the FULL base-filtered set.

const IN_PROGRESS_STATUSES  = new Set(['draft', 'input_locked', 'calculated']);
const APPROVAL_STATUSES     = new Set(['pending_approval']);
const ATTENTION_STATUSES    = new Set(['calculation_failed', 'returned']);
const RELEASED_STATUSES     = new Set(['released', 'exported']);

function matchesTab(status: string, blockers: number, tab: PayrollRunListTab): boolean {
  if (status === 'cancelled') return false; // cancelled never appears in any tab
  switch (tab) {
    case 'all':         return true;
    case 'in_progress': return IN_PROGRESS_STATUSES.has(status);
    case 'approval':    return APPROVAL_STATUSES.has(status);
    case 'attention':   return ATTENTION_STATUSES.has(status) || blockers > 0;
    case 'released':    return RELEASED_STATUSES.has(status);
  }
}

// ── Sort + cursor position ─────────────────────────────────────────────────────

function compareRuns(a: RunMinimal, b: RunMinimal, sort: PayrollRunSort): number {
  switch (sort) {
    case 'pay_date_desc': {
      // NULLS LAST DESC: non-null pay_dates first (descending), then null entries.
      if (a.pay_date !== null && b.pay_date !== null) {
        if (a.pay_date > b.pay_date) return -1;
        if (a.pay_date < b.pay_date) return 1;
      } else if (a.pay_date !== null) return -1; // a has date, b is null → a first
      else if (b.pay_date !== null) return 1;    // b has date, a is null → b first
      // same pay_date (or both null): tiebreak DESC
      if (a.period_end > b.period_end) return -1;
      if (a.period_end < b.period_end) return 1;
      if (a.run_no > b.run_no) return -1;
      if (a.run_no < b.run_no) return 1;
      return a.id > b.id ? -1 : a.id < b.id ? 1 : 0;
    }
    case 'pay_date_asc': {
      // NULLS LAST ASC: non-null pay_dates first (ascending), then null entries.
      if (a.pay_date !== null && b.pay_date !== null) {
        if (a.pay_date < b.pay_date) return -1;
        if (a.pay_date > b.pay_date) return 1;
      } else if (a.pay_date !== null) return -1;
      else if (b.pay_date !== null) return 1;
      // tiebreak ASC
      if (a.period_end < b.period_end) return -1;
      if (a.period_end > b.period_end) return 1;
      if (a.run_no < b.run_no) return -1;
      if (a.run_no > b.run_no) return 1;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    }
    case 'updated_desc': {
      if (a.updated_at > b.updated_at) return -1;
      if (a.updated_at < b.updated_at) return 1;
      return a.id > b.id ? -1 : a.id < b.id ? 1 : 0;
    }
  }
}

/**
 * Returns true if `run` belongs to the NEXT PAGE after the cursor
 * (i.e., it comes strictly after the cursor position in sort order).
 */
function isAfterCursor(run: RunMinimal, cursor: CursorKey): boolean {
  if (cursor.sort === 'updated_desc') {
    const [cut, cid] = cursor.k;
    return run.updated_at < cut || (run.updated_at === cut && run.id < cid);
  }
  const [cpd, cpe, crn, cid] = cursor.k;
  const sort = cursor.sort;

  if (sort === 'pay_date_desc') {
    // After cursor in desc order: either
    //   (a) run.pay_date < cursor.pay_date
    //   (b) cursor.pay_date is non-null and run.pay_date is null (nulls last = later)
    //   (c) same pay_date + earlier tiebreak
    if (cpd !== null) {
      if (run.pay_date === null) return true;
      if (run.pay_date < cpd) return true;
      if (run.pay_date === cpd) {
        if (run.period_end < cpe) return true;
        if (run.period_end === cpe) {
          if (run.run_no < crn) return true;
          if (run.run_no === crn && run.id < cid) return true;
        }
      }
      return false;
    } else {
      // cursor is in the NULL section (pay_date is null, nulls last)
      if (run.pay_date !== null) return false; // non-null comes before null section
      if (run.period_end < cpe) return true;
      if (run.period_end === cpe) {
        if (run.run_no < crn) return true;
        if (run.run_no === crn && run.id < cid) return true;
      }
      return false;
    }
  } else { // pay_date_asc
    // After cursor in asc order:
    if (cpd !== null) {
      if (run.pay_date === null) return true;
      if (run.pay_date > cpd) return true;
      if (run.pay_date === cpd) {
        if (run.period_end > cpe) return true;
        if (run.period_end === cpe) {
          if (run.run_no > crn) return true;
          if (run.run_no === crn && run.id > cid) return true;
        }
      }
      return false;
    } else {
      if (run.pay_date !== null) return false;
      if (run.period_end > cpe) return true;
      if (run.period_end === cpe) {
        if (run.run_no > crn) return true;
        if (run.run_no === crn && run.id > cid) return true;
      }
      return false;
    }
  }
}

// ── Readiness label ───────────────────────────────────────────────────────────

function readinessLabel(state: ReadinessState): string {
  switch (state) {
    case 'not_started': return 'Not Started';
    case 'in_progress': return 'In Progress';
    case 'blocked':     return 'Blocked';
    case 'ready':       return 'Ready';
    case 'released':    return 'Released';
  }
}

// Lifecycle progress percent for the register's stage bar — a run's position
// along draft → … → released, matching the enterprise mockup's stage-line. The
// register row shows the STAGE reached (not a live readiness estimate); a failed
// calculation keeps the stage it reached and is coloured 'bad' by the FE.
function lifecycleStagePercent(status: string): number {
  switch (status) {
    case 'draft':              return 12;
    case 'input_locked':       return 42;
    case 'calculation_failed': return 42;
    case 'calculated':         return 60;
    case 'pending_approval':   return 76;
    case 'returned':           return 58;
    case 'approved':           return 88;
    case 'locked':             return 94;
    case 'released':
    case 'exported':           return 100;
    case 'cancelled':          return 0;
    default:                   return 0;
  }
}

// ── Main entry point ──────────────────────────────────────────────────────────

export async function listPayrollRunsRegister(
  req: PayrollRunListPageRequest,
): Promise<PayrollRunListResult> {
  const sort: PayrollRunSort        = req.sort ?? 'pay_date_desc';
  const limit                       = Math.max(1, Math.min(100, req.limit ?? 25));
  const tab: PayrollRunListTab      = req.tab ?? 'all';
  const asOf                        = new Date().toISOString();

  // ── 1. Cursor decode (422 on malformed or filter mismatch) ────────────────
  const fp = filterFingerprint(req);
  let cursor: CursorKey | null = null;
  if (req.cursor) {
    cursor = decodeCursor(req.cursor, fp, sort);
  }

  // ── 2. Query ALL runs matching the base filter (minimal columns) ──────────
  // We fetch all matching runs (no tab filter, no cursor, no limit) so we can
  // compute exact tab counts over the full filter scope, then filter/sort/page in memory.
  let q = sb
    .from('finance_payroll_runs')
    .select(
      'id,run_no,status,run_type,current_calculation_version_id,' +
      'pay_date,period_start,period_end,updated_at,' +
      'source_run_id,pay_group_id,pay_group,' +
      'employee_count,gross_total,net_total,cut_off_date,created_by',
    );

  // State filter (default excludes cancelled)
  if (req.states && req.states.length > 0) {
    q = q.in('status', req.states as string[]);
  } else {
    q = q.neq('status', 'cancelled');
  }

  if (req.runTypes && req.runTypes.length > 0) {
    q = q.in('run_type', req.runTypes as string[]);
  }
  if (req.payGroupIds && req.payGroupIds.length > 0) {
    q = q.in('pay_group_id', req.payGroupIds);
  }
  if (req.search?.trim()) {
    const term = `%${req.search.trim()}%`;
    // PostgREST OR filter: run_no ilike OR pay_group ilike
    q = q.or(`run_no.ilike.${term},pay_group.ilike.${term}`);
  }
  if (req.periodFrom) q = q.gte('period_end',   req.periodFrom);  // period overlaps: period_end >= from
  if (req.periodTo)   q = q.lte('period_start', req.periodTo);    // period overlaps: period_start <= to

  const { data: rawRuns, error: runsErr } = await q;
  if (runsErr) throw Object.assign(new Error('listPayrollRunsRegister/runs: ' + runsErr.message), { status: 500 });
  const allRuns = (rawRuns ?? []) as unknown as RunMinimal[];

  // ── 3. Batch-fetch findings (current version only, open+in_progress) ─────
  // Mirror the CC rule:
  //   f.run_id = r.id AND f.calculation_version_id = r.current_calculation_version_id
  //   AND f.state IN ('open','in_progress')
  // We fetch all findings for the run IDs and filter by matching cv in memory.

  const runById = new Map(allRuns.map(r => [r.id, r]));
  const runIds = allRuns.map(r => r.id);

  interface FindingRow {
    run_id: string;
    calculation_version_id: string | null;
    severity: string;
  }
  const allFindings: FindingRow[] = [];
  if (runIds.length > 0) {
    const CHUNK = 200;
    for (let i = 0; i < runIds.length; i += CHUNK) {
      const chunk = runIds.slice(i, i + CHUNK);
      const { data, error } = await sb
        .from('finance_payroll_control_findings')
        .select('run_id,calculation_version_id,severity')
        .in('run_id', chunk)
        .in('state', ['open', 'in_progress'])
        .in('severity', ['blocker', 'warning']);
      if (error) throw Object.assign(new Error('listPayrollRunsRegister/findings: ' + error.message), { status: 500 });
      allFindings.push(...((data ?? []) as FindingRow[]));
    }
  }

  // Per-run counts, matching current_calculation_version_id only.
  const blockerCount = new Map<string, number>();
  const warningCount = new Map<string, number>();
  for (const f of allFindings) {
    const run = runById.get(f.run_id);
    if (!run?.current_calculation_version_id) continue;
    if (f.calculation_version_id !== run.current_calculation_version_id) continue;
    if (f.severity === 'blocker') blockerCount.set(f.run_id, (blockerCount.get(f.run_id) ?? 0) + 1);
    else if (f.severity === 'warning') warningCount.set(f.run_id, (warningCount.get(f.run_id) ?? 0) + 1);
  }

  // ── 4. Tab counts (full filter scope, independent of active tab) ──────────
  const ALL_TABS: PayrollRunListTab[] = ['all', 'in_progress', 'approval', 'attention', 'released'];
  const tabCounts: Record<PayrollRunListTab, number> = { all: 0, in_progress: 0, approval: 0, attention: 0, released: 0 };
  for (const run of allRuns) {
    const bc = blockerCount.get(run.id) ?? 0;
    for (const t of ALL_TABS) {
      if (matchesTab(run.status, bc, t)) tabCounts[t]++;
    }
  }

  // ── 5. Apply tab filter + sort + cursor ────────────────────────────────────
  const tabFiltered = allRuns
    .filter(r => matchesTab(r.status, blockerCount.get(r.id) ?? 0, tab))
    .sort((a, b) => compareRuns(a, b, sort));

  const total = tabFiltered.length;

  // Keyset: skip everything up to and including the cursor position.
  const afterCursor = cursor
    ? tabFiltered.filter(r => isAfterCursor(r, cursor))
    : tabFiltered;

  const pageSlice = afterCursor.slice(0, limit + 1);
  const hasMore   = pageSlice.length > limit;
  const pageRuns  = pageSlice.slice(0, limit);

  // ── 6. Effective totals for ALL runs (cv coalesce) — used by BOTH the money
  //       aggregates (full filtered scope) AND page enrichment. Fetched once.
  interface CalcVersionRow { id: string; employee_count: number; gross_total: number; net_total: number }
  const cvMap = new Map<string, CalcVersionRow>();
  const allCalcVsnIds = [...new Set(allRuns.map(r => r.current_calculation_version_id).filter((v): v is string => v !== null))];
  if (allCalcVsnIds.length > 0) {
    const CHUNK = 200;
    for (let i = 0; i < allCalcVsnIds.length; i += CHUNK) {
      const chunk = allCalcVsnIds.slice(i, i + CHUNK);
      const { data, error } = await sb
        .from('finance_payroll_calculation_versions')
        .select('id,employee_count,gross_total,net_total')
        .in('id', chunk);
      if (error) throw Object.assign(new Error('listPayrollRunsRegister/calc-versions: ' + error.message), { status: 500 });
      for (const cv of (data ?? []) as CalcVersionRow[]) cvMap.set(cv.id, cv);
    }
  }

  // Effective net per run: coalesce(cv.net_total, run.net_total) — the CC register rule.
  const effNetOf = (run: RunMinimal): number => {
    const cv = run.current_calculation_version_id ? cvMap.get(run.current_calculation_version_id) : undefined;
    return cv ? Number(cv.net_total) : Number(run.net_total);
  };
  const CLOSED_STATUSES = new Set(['released', 'exported']);
  // fundable — EXACTLY the CC/mig-430 predicate.
  const isFundable = (run: RunMinimal): boolean =>
    run.current_calculation_version_id !== null
    && effNetOf(run) > 0
    && !CLOSED_STATUSES.has(run.status)
    && run.status !== 'cancelled';

  // ── 6b. Latest funding confirmation per fundable run (run_id + current cv) ────
  //   Mirrors mig 430: fc.run_id = r.id AND fc.calculation_version_id = r.current cv,
  //   ordered by confirmation_no desc → latest wins.
  const fundedById = new Map<string, number>();
  const fundableIds = allRuns.filter(isFundable).map(r => r.id);
  if (fundableIds.length > 0) {
    interface FundingRow { run_id: string; calculation_version_id: string | null; confirmed_amount: number | string; confirmation_no: number }
    const seenNo = new Map<string, number>();
    const CHUNK = 200;
    for (let i = 0; i < fundableIds.length; i += CHUNK) {
      const chunk = fundableIds.slice(i, i + CHUNK);
      const { data, error } = await sb
        .from('finance_payroll_funding_confirmations')
        .select('run_id,calculation_version_id,confirmed_amount,confirmation_no')
        .in('run_id', chunk);
      if (error) throw Object.assign(new Error('listPayrollRunsRegister/funding: ' + error.message), { status: 500 });
      for (const f of (data ?? []) as FundingRow[]) {
        const run = runById.get(f.run_id);
        if (!run?.current_calculation_version_id) continue;
        if (f.calculation_version_id !== run.current_calculation_version_id) continue;
        const prev = seenNo.get(f.run_id);
        if (prev === undefined || f.confirmation_no > prev) {
          seenNo.set(f.run_id, f.confirmation_no);
          fundedById.set(f.run_id, Number(f.confirmed_amount));
        }
      }
    }
  }

  // ── 6c. Register-scoped money aggregates over the FULL filtered set ───────────
  let fundingRequired = 0, fundingConfirmed = 0, closedNet = 0;
  for (const run of allRuns) {
    if (isFundable(run)) {
      fundingRequired  += effNetOf(run);
      fundingConfirmed += fundedById.get(run.id) ?? 0;
    } else if (CLOSED_STATUSES.has(run.status)) {
      closedNet += effNetOf(run);
    }
  }
  const money = (amount: number): MoneyValue => ({ amount: Math.round(amount * 100) / 100, currency: 'TTD' });
  const aggregates: PayrollRunRegisterAggregates = {
    fundingRequired:  money(fundingRequired),
    fundingConfirmed: money(fundingConfirmed),
    fundingGap:       money(Math.max(0, fundingRequired - fundingConfirmed)),
    closedNet:        money(closedNet),
  };

  // ── 6d. Owner display names for the PAGE runs (created_by → name, never a raw id) ──
  const pageOwnerIds = [...new Set(pageRuns.map(r => r.created_by).filter((v): v is string => v !== null))];
  const ownerName = new Map<string, string>();
  if (pageOwnerIds.length > 0) {
    const { data, error } = await sb
      .from('app_users').select('id, first_name, last_name, username').in('id', pageOwnerIds);
    if (error) throw Object.assign(new Error('listPayrollRunsRegister/owners: ' + error.message), { status: 500 });
    interface UserRow { id: string; first_name: string | null; last_name: string | null; username: string | null }
    for (const u of (data ?? []) as UserRow[]) {
      const name = [u.first_name, u.last_name].filter(Boolean).join(' ').trim() || u.username || u.id;
      ownerName.set(u.id, name);
    }
  }

  // ── 6e. Page FK enrichment (source runs + pay groups) ─────────────────────────
  const pageSourceRunIds = [...new Set(pageRuns.map(r => r.source_run_id).filter((v): v is string => v !== null))];
  const pagePayGroupIds  = [...new Set(pageRuns.map(r => r.pay_group_id).filter((v): v is string => v !== null))];

  interface SourceRunRow { id: string; run_no: string }
  const sourceRunMap = new Map<string, SourceRunRow>();
  if (pageSourceRunIds.length > 0) {
    const { data, error } = await sb
      .from('finance_payroll_runs')
      .select('id,run_no')
      .in('id', pageSourceRunIds);
    if (error) throw Object.assign(new Error('listPayrollRunsRegister/source-runs: ' + error.message), { status: 500 });
    for (const s of (data ?? []) as SourceRunRow[]) sourceRunMap.set(s.id, s);
  }

  interface PayGroupRow { id: string; name: string; frequency: string }
  const pgMap = new Map<string, PayGroupRow>();
  if (pagePayGroupIds.length > 0) {
    const { data, error } = await sb
      .from('finance_pay_groups')
      .select('id,name,frequency')
      .in('id', pagePayGroupIds);
    if (error) throw Object.assign(new Error('listPayrollRunsRegister/pay-groups: ' + error.message), { status: 500 });
    for (const pg of (data ?? []) as PayGroupRow[]) pgMap.set(pg.id, pg);
  }

  // ── 7. Map to PayrollRunListItem ──────────────────────────────────────────
  const items: PayrollRunListItem[] = pageRuns.map(run => {
    const cv       = run.current_calculation_version_id ? cvMap.get(run.current_calculation_version_id) : undefined;
    const pg       = run.pay_group_id ? pgMap.get(run.pay_group_id) : undefined;
    const srcRun   = run.source_run_id ? sourceRunMap.get(run.source_run_id) : undefined;
    const blockers = blockerCount.get(run.id) ?? 0;
    const warnings = warningCount.get(run.id) ?? 0;
    const rdnState = registerReadinessState(run.status, blockers);

    // Effective totals: coalesce(cv, run) — mirrors the CC register rule.
    const effEmp   = cv ? cv.employee_count : run.employee_count;
    const effGross = cv ? Number(cv.gross_total) : Number(run.gross_total);
    const effNet   = cv ? Number(cv.net_total)   : Number(run.net_total);

    return {
      id:        run.id,
      reference: run.run_no,
      runType:   run.run_type as PayrollRunType,
      state:     run.status   as PayrollRunState,
      payGroup: {
        id:        run.pay_group_id,
        name:      pg?.name ?? run.pay_group ?? null,
        frequency: pg?.frequency ?? null,
      },
      period: {
        startsOn: run.period_start,
        endsOn:   run.period_end,
        payDate:  run.pay_date,
        cutoffAt: run.cut_off_date,
      },
      population: {
        included: effEmp,
        excluded: 0, // not tracked at the register level
      },
      totals: {
        currency: 'TTD',
        gross:    effGross,
        net:      effNet,
      },
      readiness: {
        state:    rdnState,
        // Stage progress along the lifecycle (draft → released), matching the
        // enterprise mockup's stage-line bar. Was null, which rendered an empty
        // 0% bar with a "—" for every run.
        percent:  lifecycleStagePercent(run.status),
        blockers,
        warnings,
        label:    readinessLabel(rdnState),
      },
      correctionOf: srcRun ? { id: srcRun.id, reference: srcRun.run_no } : null,
      owner: {
        id:   run.created_by,
        name: run.created_by ? (ownerName.get(run.created_by) ?? null) : null,
      },
      updatedAt:    run.updated_at,
    };
  });

  // ── 8. Next cursor ─────────────────────────────────────────────────────────
  const lastRun   = pageRuns[pageRuns.length - 1];
  const nextCursor = (hasMore && lastRun)
    ? encodeCursor(makeCursorKey(lastRun, sort), fp)
    : null;

  return { items, nextCursor, total, asOf, tabCounts, aggregates };
}
