// lib/finance/payroll/controlCenter.ts
// Payroll Command Center service (approved contract §4/§5 + restart directives).
// PURE READ. FAILS AS A UNIT — any DB error throws (no partial-dashboard fallback).
// Composition:
//   1. one call to the read-only SQL function finance_payroll_control_center(...) — complete-dataset,
//      snapshot-consistent aggregation (KPIs, health inputs, tab counts, keyset register page,
//      assigned task, deadlines, safe activity, next-run identity+evidence);
//   2. exactly ONE finance_payroll_release_preflight() for the selected next run;
//   3. server-authored capabilities (passed in) + final readiness gate composition + display mapping.

import { sb } from '../../db';
import { getPayrollReleasePreflight } from './releases';
import { decodeCursor, encodeCursor, filterFingerprint } from './controlCenterCursor';
import {
  activityLabel,
  classifyDeadline,
  evaluateReadinessGates,
  fundingKpiState,
  healthScore,
  healthState,
  registerReadinessState,
  todayIso,
} from './controlCenterDerive';
import type {
  MoneyValue,
  PayrollControlCenterCapabilities,
  PayrollControlCenterResponse,
  PayrollDeadlineItem,
  PayrollRunRegisterItem,
  PayrollRunRegisterTab,
  PayrollRunType,
} from '../../../../../types/payrollControlCenter';

export interface ControlCenterServiceInput {
  actorId: string;
  actorRole: string | null;
  window: { from: string; to: string };
  payGroupIds: string[];
  register: { tab: PayrollRunRegisterTab; search: string | null; cursor: string | null; limit: number };
  capabilities: PayrollControlCenterCapabilities;
}

function money(n: unknown): MoneyValue {
  const v = Number(n);
  return { amount: Math.round((Number.isFinite(v) ? v : 0) * 100) / 100, currency: 'TTD' };
}
function num(n: unknown): number {
  const v = Number(n);
  return Number.isFinite(v) ? v : 0;
}
function str(n: unknown): string {
  return n == null ? '' : String(n);
}

// ── Raw shapes returned by the SQL function ───────────────────────────────────
type Rec = Record<string, unknown>;

/**
 * Strict runtime validation of the RPC payload (F8): a malformed/incomplete aggregation FAILS the
 * request (500) instead of being coerced into believable zeros. Required sections + numeric fields
 * must be present; the three nullable sections must at least be present as keys.
 */
function assertRpcShape(data: unknown): Rec {
  const err = (msg: string): never => {
    throw Object.assign(new Error(`controlCenter/malformed-rpc: ${msg}`), { status: 500 });
  };
  if (!data || typeof data !== 'object' || Array.isArray(data)) return err('response is not an object');
  const raw = data as Rec;
  const obj = (k: string): Rec => {
    const v = raw[k];
    if (!v || typeof v !== 'object' || Array.isArray(v)) return err(`missing/invalid object: ${k}`);
    return v as Rec;
  };
  const reqNum = (o: Rec, key: string, label: string): void => {
    const v = o[key];
    const ok = (typeof v === 'number' && Number.isFinite(v)) ||
      (typeof v === 'string' && v !== '' && Number.isFinite(Number(v)));
    if (!ok) err(`missing/invalid number: ${label}`);
  };
  const kpis = obj('kpis');
  for (const f of ['activeRuns', 'employeesDue', 'gross', 'net', 'fundingRequired', 'fundingConfirmed']) reqNum(kpis, f, `kpis.${f}`);
  const health = obj('health');
  for (const f of ['openBlockerCount', 'blockerRunCount', 'criticalCount', 'atRiskCount', 'overdueActionCount']) reqNum(health, f, `health.${f}`);
  if (typeof health.nearDueUnfunded !== 'boolean') err('missing/invalid boolean: health.nearDueUnfunded');
  const tab = obj('tabCounts');
  for (const f of ['all', 'attention', 'approval', 'ready', 'released']) reqNum(tab, f, `tabCounts.${f}`);
  const reg = obj('register');
  reqNum(reg, 'total', 'register.total');
  if (!Array.isArray(reg.items)) err('missing/invalid array: register.items');
  if (!Array.isArray(raw.deadlines)) err('missing/invalid array: deadlines');
  if (!Array.isArray(raw.activity)) err('missing/invalid array: activity');
  for (const k of ['primaryIntervention', 'assignedToYou', 'nextRun']) if (!(k in raw)) err(`missing key: ${k}`);
  return raw;
}

export async function getPayrollControlCenter(
  input: ControlCenterServiceInput,
): Promise<PayrollControlCenterResponse> {
  const today = todayIso(new Date());
  const asOf = new Date().toISOString();

  // Cursor: validate against the current filter fingerprint (throws 422 on mismatch/malformed),
  // then pass the typed tuple to the SQL function.
  const fingerprint = filterFingerprint({
    window: input.window,
    payGroupIds: input.payGroupIds,
    tab: input.register.tab,
    search: input.register.search,
  });
  const cursor = input.register.cursor ? decodeCursor(input.register.cursor, fingerprint) : null;

  const { data, error } = await sb.rpc('finance_payroll_control_center', {
    p_from: input.window.from,
    p_to: input.window.to,
    p_pay_group_ids: input.payGroupIds.length ? input.payGroupIds : null,
    p_actor_id: input.actorId,
    p_actor_role: input.actorRole,
    p_tab: input.register.tab,
    p_search: input.register.search,
    p_limit: input.register.limit,
    p_cursor_pay_date: cursor?.payDate ?? null,
    p_cursor_period_end: cursor?.periodEnd ?? null,
    p_cursor_run_no: cursor?.runNo ?? null,
    p_cursor_id: cursor?.id ?? null,
  });
  if (error) {
    throw Object.assign(new Error(`controlCenter/aggregate: ${error.message}`), { status: 500 });
  }
  const raw = assertRpcShape(data);

  // ── KPIs ────────────────────────────────────────────────────────────────────
  const k = (raw.kpis ?? {}) as Rec;
  const npd = (k.nextPayDate ?? null) as Rec | null;
  const fundingRequired = num(k.fundingRequired);
  const fundingConfirmed = num(k.fundingConfirmed);

  // ── Health ──────────────────────────────────────────────────────────────────
  // Score AND state derive from the same concrete risk counts (see controlCenterDerive) so the band is
  // internally consistent — the rail state can never contradict the criticalCount/atRiskCount the FE shows.
  const h = (raw.health ?? {}) as Rec;
  const healthInput = {
    criticalRunCount: num(h.criticalCount),
    atRiskRunCount: num(h.atRiskCount),
    overdueTaskCount: num(h.overdueActionCount),
    nearDueUnfunded: h.nearDueUnfunded === true,
  };
  const score = healthScore(healthInput);
  const pi = (raw.primaryIntervention ?? null) as Rec | null;

  // ── Register ────────────────────────────────────────────────────────────────
  const reg = (raw.register ?? {}) as Rec;
  const rawItems = Array.isArray(reg.items) ? (reg.items as Rec[]) : [];
  const items: PayrollRunRegisterItem[] = rawItems.map(mapRegisterItem);
  const nextCursorTuple = (reg.nextCursor ?? null) as Rec | null;
  const nextCursor = nextCursorTuple
    ? encodeCursor(
        {
          payDate: (nextCursorTuple.payDate as string | null) ?? null,
          periodEnd: str(nextCursorTuple.periodEnd),
          runNo: str(nextCursorTuple.runNo),
          id: str(nextCursorTuple.id),
        },
        fingerprint,
      )
    : null;
  const tc = (raw.tabCounts ?? {}) as Rec;

  // ── Assigned to you ─────────────────────────────────────────────────────────
  // The RPC returns the task identity only; the card displays HUMAN run values (pay-group NAME — never
  // the raw run id — plus population and net payroll), so resolve them from the run with one indexed
  // lookup, and ONLY when a task is actually assigned. Effective totals mirror the read model's eff_*
  // rule (the published calculation version wins over the run's own summary columns).
  const at = (raw.assignedToYou ?? null) as Rec | null;
  let assignedToYou: PayrollControlCenterResponse['assignedToYou'] = null;
  if (at) {
    const runId = str(at.runId);
    const { data: rr } = await sb
      .from('finance_payroll_runs')
      .select('pay_group, employee_count, net_total, current_calculation_version_id')
      .eq('id', runId)
      .maybeSingle();
    let employeeCount = num(rr?.employee_count);
    let netAmount = num(rr?.net_total);
    if (rr?.current_calculation_version_id) {
      const { data: cv } = await sb
        .from('finance_payroll_calculation_versions')
        .select('employee_count, net_total')
        .eq('id', rr.current_calculation_version_id as string)
        .maybeSingle();
      if (cv) { employeeCount = num(cv.employee_count); netAmount = num(cv.net_total); }
    }
    assignedToYou = {
      taskId: str(at.taskId),
      workflowId: str(at.workflowId),
      runId,
      runNo: str(at.runNo),
      payGroupName: (rr?.pay_group as string | null) ?? null,
      employeeCount,
      netPayroll: money(netAmount),
      title: str(at.title),
      dueAt: (at.dueAt as string | null) ?? null,
      isOverdue: at.dueAt != null && String(at.dueAt).slice(0, 10) < today,
      assignee: {
        id: str(at.assigneeId),
        displayName: (at.assigneeName as string | null) ?? 'You',
        photoUrl: (at.assigneePhoto as string | null) ?? null,
      },
      action: 'review_approval' as const,
    };
  }

  // ── Recent activity ─────────────────────────────────────────────────────────
  const rawActivity = Array.isArray(raw.activity) ? (raw.activity as Rec[]) : [];
  const recentActivity = rawActivity.map(a => {
    const actorId = (a.actor_id as string | null) ?? null;
    const actorName = (a.actor_name as string | null) ?? null;
    return {
      eventId: str(a.event_id),
      runId: (a.run_id as string | null) ?? null,
      runNo: (a.run_no as string | null) ?? null,
      eventType: str(a.event_type),
      label: activityLabel(str(a.event_type)),
      actor: actorId || actorName
        ? { id: actorId, displayName: actorName ?? 'User', photoUrl: (a.actor_photo as string | null) ?? null }
        : null,
      occurredAt: str(a.occurred_at),
    };
  });

  // ── Deadlines ───────────────────────────────────────────────────────────────
  const rawDeadlines = Array.isArray(raw.deadlines) ? (raw.deadlines as Rec[]) : [];
  const upcomingDeadlines: PayrollDeadlineItem[] = rawDeadlines.map(d => {
    const dueAt = str(d.due_date);
    return {
      id: str(d.id),
      kind: str(d.kind) as PayrollDeadlineItem['kind'],
      runId: str(d.run_id),
      runNo: str(d.run_no),
      title: str(d.title),
      dueAt,
      state: classifyDeadline(dueAt, today),
    };
  });

  // ── Next scheduled run (one preflight) ──────────────────────────────────────
  const nr = (raw.nextRun ?? null) as Rec | null;
  let nextScheduledRun: PayrollControlCenterResponse['nextScheduledRun'] = null;
  if (nr) {
    const runId = str(nr.id);
    const preflight = await getPayrollReleasePreflight(runId); // ONE call; throws → fail as a unit
    const netAmt = num(nr.net);
    const fundedAmt = num(nr.funded);
    // Readiness gates are a PROJECTION of the authoritative preflight — never re-derived.
    const evalGates = evaluateReadinessGates({
      ready: preflight.ready,
      alreadyReleased: preflight.alreadyReleased,
      blockers: preflight.blockers,
      status: str(nr.status),
    });
    nextScheduledRun = {
      run: mapRegisterItem(nr),
      readiness: {
        state: evalGates.state,
        percent: evalGates.percent,
        passed: evalGates.passed,
        applicable: evalGates.applicable,
        gates: evalGates.gates,
      },
      releaseImpact: {
        employees: num(nr.employeeCount),
        gross: money(nr.gross),
        net: money(nr.net),
        employerNis: money(nr.employerNis),
        fundingGap: money(Math.max(0, netAmt - fundedAmt)),
      },
    };
  }

  return {
    asOf,
    window: input.window,
    appliedFilters: { payGroupIds: input.payGroupIds },
    capabilities: input.capabilities,
    portfolioHealth: {
      state: healthState(healthInput),
      score,
      criticalCount: num(h.criticalCount),
      atRiskCount: num(h.atRiskCount),
      openBlockerCount: num(h.openBlockerCount),
      overdueActionCount: num(h.overdueActionCount),
      primaryIntervention: pi
        ? {
            kind: str(pi.kind) as 'finding' | 'approval' | 'funding' | 'deadline',
            title: str(pi.title),
            detail: str(pi.detail),
            runId: (pi.runId as string | null) ?? null,
            targetId: str(pi.targetId),
            dueAt: (pi.dueAt as string | null) ?? null,
          }
        : null,
    },
    kpis: {
      nextPayDate: {
        date: (npd?.date as string | null) ?? null,
        runId: (npd?.runId as string | null) ?? null,
        runNo: (npd?.runNo as string | null) ?? null,
      },
      activeRuns: num(k.activeRuns),
      employeesDue: num(k.employeesDue),
      grossPayroll: money(k.gross),
      netPayroll: money(k.net),
      funding: {
        confirmed: money(fundingConfirmed),
        required: money(fundingRequired),
        gap: money(Math.max(0, fundingRequired - fundingConfirmed)),
        state: fundingKpiState(fundingConfirmed, fundingRequired),
      },
    },
    assignedToYou,
    recentActivity,
    upcomingDeadlines,
    nextScheduledRun,
    runRegister: {
      items,
      nextCursor,
      total: num(reg.total),
      tabCounts: {
        all: num(tc.all),
        attention: num(tc.attention),
        approval: num(tc.approval),
        ready: num(tc.ready),
        released: num(tc.released),
      },
    },
  };
}

function mapRegisterItem(r: Rec): PayrollRunRegisterItem {
  const blockerCount = num(r.blockerCount);
  return {
    id: str(r.id),
    runNo: str(r.runNo),
    runType: str(r.runType) as PayrollRunType,
    payGroup: { id: (r.payGroupId as string | null) ?? null, name: (r.payGroupName as string | null) ?? null },
    periodStart: str(r.periodStart),
    periodEnd: str(r.periodEnd),
    payDate: (r.payDate as string | null) ?? null,
    employeeCount: num(r.employeeCount),
    gross: money(r.gross),
    net: money(r.net),
    status: str(r.status),
    readiness: {
      state: registerReadinessState(str(r.status), blockerCount),
      percent: null,
      blockerCount,
      warningCount: num(r.warningCount),
    },
    updatedAt: str(r.updatedAt),
  };
}
