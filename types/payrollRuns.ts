// types/payrollRuns.ts
// SHARED request/response contract for the Payroll Runs Register slice (spec §15.1/§15.2).
// Imported by BOTH the Netlify routes (validation) and the FE api client. ONE camelCase contract.
//
// Endpoints in this slice (all POST, all behind requirePermission):
//   finance/payroll/runs/list            — the register authority (keyset page + tab counts)
//   finance/payroll/run-views/list       — saved filter views (personal + team)
//   finance/payroll/run-views/create|update|delete
//   finance/payroll/runs/calendar        — scheduled calendar instances + linked run ids
//
// REUSE (do NOT duplicate): run readiness classification comes from ONE place,
// `netlify/functions/lib/finance/payroll/controlCenterDerive.ts registerReadinessState`, and the run
// type/status/readiness/money vocab is imported from the Command Center contract below.

import type {
  MoneyValue,
  PayrollRunType,
  ReadinessState,
} from './payrollControlCenter';

export type { MoneyValue, PayrollRunType, ReadinessState };

/** Canonical run status union (spec §10). */
export type PayrollRunState =
  | 'draft'
  | 'input_locked'
  | 'calculation_failed'
  | 'calculated'
  | 'pending_approval'
  | 'returned'
  | 'approved'
  | 'locked'
  | 'released'
  | 'exported'
  | 'cancelled';

// ── Shared pagination (spec §15.2) ────────────────────────────────────────────

export interface PageRequest {
  /** Opaque keyset cursor from a prior page's `nextCursor`; omit for the first page. */
  cursor?: string;
  /** 1..100, default 25. */
  limit?: number;
}

export interface PageResult<T> {
  items: T[];
  nextCursor: string | null;
  total: number;
  asOf: string;
}

// ── runs/list (spec §15.2) — the ONLY run-register authority ───────────────────

export type PayrollRunSort = 'pay_date_desc' | 'pay_date_asc' | 'updated_desc';

/**
 * The full register request. A saved view stores exactly this shape WITHOUT `cursor`/`limit`.
 * NOTE (reviewed at the backend pause): `archive`/retention is DEFERRED in this slice — the runs
 * table has no archive/retention columns yet, so we do not fake them. Cancelled runs are excluded
 * by default and surfaced only via `states: ['cancelled']`. Add a real archive model in a later slice.
 */
export interface PayrollRunListRequest extends PageRequest {
  search?: string;
  states?: PayrollRunState[];
  runTypes?: PayrollRunType[];
  payGroupIds?: string[];
  periodFrom?: string; // YYYY-MM-DD, inclusive (matched against period_end >= periodFrom)
  periodTo?: string;   // YYYY-MM-DD, inclusive (matched against period_start <= periodTo)
  sort?: PayrollRunSort;
}

/** The filter subset a saved view persists (no paging). */
export type PayrollRunViewFilters = Omit<PayrollRunListRequest, 'cursor' | 'limit'>;

/**
 * One register row (spec §15.2 PayrollRunListItem). Readiness is the SAME classification the Command
 * Center register uses (`registerReadinessState`), so the two surfaces never disagree.
 */
export interface PayrollRunListItem {
  id: string;
  reference: string;            // run_no
  runType: PayrollRunType;
  state: PayrollRunState;
  payGroup: { id: string | null; name: string | null; frequency: string | null };
  period: { startsOn: string; endsOn: string; payDate: string | null; cutoffAt: string | null };
  population: { included: number; excluded: number };
  totals: { currency: 'TTD'; gross: number | null; net: number | null };
  readiness: { state: ReadinessState; percent: number | null; blockers: number; warnings: number; label: string };
  correctionOf: { id: string; reference: string } | null;
  updatedAt: string;
}

/** Register tab keys — server-calculated counts for the exact authorized filter scope. */
export type PayrollRunListTab = 'all' | 'in_progress' | 'approval' | 'attention' | 'released';

export interface PayrollRunListResult extends PageResult<PayrollRunListItem> {
  /** Counts per tab for the CURRENT filter scope (search/states/etc.), independent of the active tab. */
  tabCounts: Record<PayrollRunListTab, number>;
}

/** The register request carries an optional active tab on top of the filter set. */
export interface PayrollRunListPageRequest extends PayrollRunListRequest {
  tab?: PayrollRunListTab;
}

// ── run-views (spec §15.2 saved views) ─────────────────────────────────────────

export type PayrollRunViewScope = 'personal' | 'team';

export interface PayrollRunView {
  id: string;
  name: string;
  scope: PayrollRunViewScope;
  filters: PayrollRunViewFilters;
  ownerId: string;
  isOwn: boolean;
  updatedAt: string;
}

export interface PayrollRunViewCreateRequest {
  name: string;
  scope: PayrollRunViewScope;
  filters: PayrollRunViewFilters;
}

export interface PayrollRunViewUpdateRequest {
  id: string;
  expectedVersion?: number; // reserved for optimistic concurrency; views are low-churn
  name?: string;
  filters?: PayrollRunViewFilters;
}

// ── runs/calendar (spec §15.2) ─────────────────────────────────────────────────

/**
 * A scheduled calendar instance DERIVED from a pay group's schedule (frequency + default pay day +
 * cutoff offset) over a bounded window — NOT by scanning existing run rows. Each instance links to
 * the existing run for that group+period if one exists, else `run: null` (a run yet to be created).
 */
export interface PayrollRunCalendarInstance {
  key: string;                 // stable synthetic key: `${payGroupId}:${periodStart}:${periodEnd}`
  payGroup: { id: string; name: string; frequency: string };
  period: { startsOn: string; endsOn: string };
  payDate: string;
  cutoffAt: string | null;
  run: { id: string; reference: string; state: PayrollRunState } | null;
}

export interface PayrollRunCalendarRequest {
  from: string; // YYYY-MM-DD
  to: string;   // YYYY-MM-DD (bounded window; server caps the span)
  payGroupIds?: string[];
}

export interface PayrollRunCalendarResult {
  window: { from: string; to: string };
  instances: PayrollRunCalendarInstance[];
  asOf: string;
}
