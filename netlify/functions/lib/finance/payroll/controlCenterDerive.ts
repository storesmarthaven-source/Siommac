// lib/finance/payroll/controlCenterDerive.ts
// PURE (DB-free) derivations for the Payroll Command Center — unit-testable per approved §10:
// health scoring, deadline classification, readiness (register + 7-gate next-run), funding state,
// event-label projection. No Supabase import. The SQL function supplies raw counts/rows; these
// compose the display semantics so they can be unit-tested independently of the database.

import type {
  HealthState,
  PayrollReadinessGate,
  ReadinessState,
} from '../../../../../types/payrollControlCenter';

// ── Dates ─────────────────────────────────────────────────────────────────────

export function todayIso(now: Date): string {
  return now.toISOString().slice(0, 10);
}

/** overdue (before today) · today · upcoming (after today). dueAt may be a full ISO or YYYY-MM-DD. */
export function classifyDeadline(dueAt: string, today: string): 'overdue' | 'today' | 'upcoming' {
  const due = dueAt.slice(0, 10);
  if (due < today) return 'overdue';
  if (due === today) return 'today';
  return 'upcoming';
}

// ── Health score + state (deterministic; a display summary, never a release authority) ──
// Both the numeric score AND the discrete state derive from the SAME concrete risk signals, so the
// portfolio-health band can never contradict itself (the bug this replaced: state came from `score`
// while the headline came from criticalCount+atRiskCount — two independent definitions of "at risk"
// that disagreed, e.g. rail "At Risk" + headline "Portfolio is on track").
//
// Risk signals (all supplied by the SQL read model, already de-duplicated — a due-soon blocker run is
// counted as critical, NOT also as at-risk):
//   · criticalRunCount — runs with a failed latest calculation OR an open blocker that is due within 3d
//   · atRiskRunCount   — runs with an open blocker finding that are not yet critical
//   · overdueTaskCount — the actor's own overdue approval/workflow tasks
//   · nearDueUnfunded  — ≥1 fundable run is due within 3d with funding still short (ONE portfolio flag)
//
// Score: 100 − min(40·critical,80) − min(20·atRisk,60) − min(10·overdue,20) − (nearDueUnfunded ? 10 : 0).

export interface HealthInput {
  criticalRunCount: number;
  atRiskRunCount: number;
  overdueTaskCount: number;
  nearDueUnfunded: boolean;
}

export function healthScore(input: HealthInput): number {
  let s = 100;
  s -= Math.min(input.criticalRunCount * 40, 80);
  s -= Math.min(input.atRiskRunCount * 20, 60);
  s -= Math.min(input.overdueTaskCount * 10, 20);
  s -= input.nearDueUnfunded ? 10 : 0;
  return Math.max(0, Math.min(100, s));
}

// State is derived from the risk signals directly (NOT bucketed from the numeric score), so it is an
// exact, gap-free classification: 'healthy' is reachable ONLY with zero risk of any kind, and the
// severity ordering (critical › at-risk › attention › healthy) always matches the counts the band shows.
export function healthState(input: HealthInput): HealthState {
  if (input.criticalRunCount > 0) return 'critical';
  if (input.atRiskRunCount > 0) return 'at_risk';
  if (input.overdueTaskCount > 0 || input.nearDueUnfunded) return 'attention';
  return 'healthy';
}

// ── Funding KPI state ─────────────────────────────────────────────────────────

export function fundingKpiState(
  confirmed: number,
  required: number,
): 'not_required' | 'unconfirmed' | 'partial' | 'confirmed' {
  if (required <= 0) return 'not_required';
  if (confirmed <= 0) return 'unconfirmed';
  if (confirmed + 0.005 < required) return 'partial';
  return 'confirmed';
}

// ── Recent-activity label projection ──────────────────────────────────────────

const ACTIVITY_LABELS: Record<string, string> = {
  'finance.payroll.run.certified': 'Processor Certified The Run',
  'finance.payroll.run.calculated': 'Payroll Recalculated',
  'finance.payroll.run.funding_confirmed': 'Funding Confirmation Recorded',
  'finance.payroll.run.released': 'Payroll Released',
  'finance.payroll.run.submitted': 'Submitted For Approval',
  'finance.payroll.run.approved': 'Payroll Approved',
  'finance.payroll.run.rejected': 'Payroll Returned',
  'finance.payroll.run.reopened': 'Run Reopened',
  'finance.payroll.run.locked': 'Run Locked',
};

export function activityLabel(eventType: string): string {
  const known = ACTIVITY_LABELS[eventType];
  if (known) return known;
  const tail = eventType.split('.').slice(-2).join(' ');
  return tail.replace(/[_-]+/g, ' ').replace(/\b\w/g, m => m.toUpperCase());
}

// ── Register-row readiness state (status + blocker presence; percent = null per D7) ──

const TERMINAL_RELEASED = new Set(['released', 'exported']);

export function registerReadinessState(status: string, blockerCount: number): ReadinessState {
  if (TERMINAL_RELEASED.has(status)) return 'released';
  if (status === 'calculation_failed' || blockerCount > 0) return 'blocked';
  if (status === 'draft') return 'not_started';
  if (status === 'approved' || status === 'locked') return 'ready';
  return 'in_progress';
}

// ── Next-run 7 readiness gates — a PROJECTION of the authoritative release preflight ──
// The gates NEVER re-derive readiness; each of the preflight's 18 blocker codes maps to exactly one
// gate, so a gate is `fail` iff the preflight raised a mapped blocker, and the OVERALL state is gated
// on preflight.ready. A gate can therefore never contradict finance_payroll_release_preflight().

/** Every preflight blocker code → the gate that owns it (the 7 fixed gate keys cover all 18 codes). */
const PREFLIGHT_CODE_TO_GATE: Record<string, PayrollReadinessGate['key']> = {
  run_not_locked: 'inputs_locked',
  calculation_version_missing: 'calculation_current',
  calculation_version_invalid: 'calculation_current',
  control_blockers_open: 'findings_clear',
  nis_period_evidence_invalid: 'findings_clear',
  certification_missing: 'approval_certified',
  certification_version_mismatch: 'approval_certified',
  funding_confirmation_missing: 'funding_confirmed',
  funding_amount_mismatch: 'funding_confirmed',
  gl_journal_missing: 'journal_posted',
  gl_journal_invalid: 'journal_posted',
  gl_journal_unbalanced: 'journal_posted',
  gl_journal_checksum_mismatch: 'journal_posted',
  gl_accounts_invalid: 'journal_posted',
  bank_accounts_missing: 'bank_accounts_ready',
  payslips_not_ready: 'bank_accounts_ready',
  disbursement_conflict: 'bank_accounts_ready',
  remittance_conflict: 'bank_accounts_ready',
};

const GATE_ORDER: { key: PayrollReadinessGate['key']; label: string; okDetail: string }[] = [
  { key: 'inputs_locked', label: 'Inputs Locked', okDetail: 'Input snapshot locked' },
  { key: 'calculation_current', label: 'Calculation Current', okDetail: 'Current calculation version valid' },
  { key: 'findings_clear', label: 'Findings & Statutory Evidence Clear', okDetail: 'No blocking findings or statutory-evidence issues' },
  { key: 'approval_certified', label: 'Approval Certified', okDetail: 'Processor certification present and version-matched' },
  { key: 'funding_confirmed', label: 'Funding Confirmed', okDetail: 'Funding confirmed and reconciled' },
  { key: 'journal_posted', label: 'Journal Posted', okDetail: 'GL journal posted, balanced and valid' },
  { key: 'bank_accounts_ready', label: 'Payment Readiness', okDetail: 'Bank accounts, payslips and disbursement/remittance ready' },
];

export interface PreflightReadinessInput {
  ready: boolean;
  alreadyReleased: boolean;
  blockers: { code: string; message: string }[];
  status: string;
}

export function evaluateReadinessGates(pf: PreflightReadinessInput): {
  gates: PayrollReadinessGate[];
  state: ReadinessState;
  percent: number;
  passed: number;
  applicable: number;
} {
  // First blocker message per gate (drives the fail detail); unknown codes bucket to findings_clear.
  const failByGate = new Map<PayrollReadinessGate['key'], string>();
  for (const b of pf.blockers) {
    const gate = PREFLIGHT_CODE_TO_GATE[b.code] ?? 'findings_clear';
    if (!failByGate.has(gate)) failByGate.set(gate, b.message || b.code);
  }

  const gates: PayrollReadinessGate[] = GATE_ORDER.map(g => {
    const failMsg = failByGate.get(g.key);
    return {
      key: g.key,
      label: g.label,
      state: failMsg ? 'fail' : 'pass',
      detail: failMsg ?? g.okDetail,
      targetId: null,
    };
  });

  const applicable = gates.length; // all 7 gates apply; the preflight decides pass/fail
  const passed = gates.filter(x => x.state === 'pass').length;
  const percent = Math.round((passed / applicable) * 100);

  let state: ReadinessState;
  if (pf.alreadyReleased) state = 'released';
  else if (pf.ready) state = 'ready';           // authoritative: ready only when the preflight says so
  else if (passed === 0) state = 'not_started';
  else state = 'blocked';                         // not ready ⇒ ≥1 fail ⇒ blocked

  return { gates, state, percent, passed, applicable };
}
