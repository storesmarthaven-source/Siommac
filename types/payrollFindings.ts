/**
 * types/payrollFindings.ts — shared DTOs for the Payroll Exceptions & Approvals
 * work-queue (spec §15.3). ONE camelCase contract imported by both the backend
 * read model/routes and the (future) frontend page. No per-endpoint mappers.
 *
 * Contract: docs/module-contracts/PAYROLL_EXCEPTIONS_APPROVALS_DELIVERY_CONTRACT.md
 */

/** Source kind of a queue row (DEC-EXC-008). */
export type PayrollFindingKind = 'approval' | 'blocker' | 'warning';

/** Triage priority, distinct from the finding's raw severity (DEC-EXC-008 mapping):
 *  blocker → critical · warning → medium · info → low · approval task → high. */
export type PayrollFindingQueueSeverity = 'critical' | 'high' | 'medium' | 'low';

/** Persisted finding states (DEC-EXC-003 — DB truth; "reopened" is history, not a state). */
export type PayrollFindingQueueState = 'open' | 'in_progress' | 'resolved' | 'waived';

/** Activity/comment feed entry types (append-only). */
export type PayrollFindingActivityType =
  | 'created' | 'assign' | 'escalate' | 'comment' | 'resolve' | 'waive' | 'reopen';

/** Actions a row exposes for the current actor. Approval-kind rows are review-only
 *  (DEC-EXC-004 — approve/return/reject go through the workflow decision path). */
export type PayrollFindingAllowedAction =
  | 'review' | 'assign' | 'escalate' | 'comment' | 'resolve' | 'waive' | 'reopen';

export type PayrollWorkQueueTab = 'all' | 'approvals' | 'blockers' | 'warnings' | 'resolved';

/** Shared keyset page envelope (§15.2). */
export interface PayrollPageResult<T> {
  items: T[];
  nextCursor: string | null;
  total: number;
  asOf: string;
}

export interface PayrollFindingOwner {
  type: 'user' | 'team';
  id: string;
  displayName: string;
}

export interface PayrollFindingRunRef {
  id: string;
  reference: string;
  payDate: string | null;
}

/** Stable on EVERY row for a consistent FE shape. Finding rows carry nulls
 *  (no per-finding financial impact in v1); approval rows carry the run's totals. */
export interface PayrollFindingImpact {
  currency: 'TTD';
  amount: number | null;
  employeeCount: number | null;
  label: string | null;
}

/** Compact work-queue row. */
export interface PayrollFindingQueueItem {
  /** Finding id, or "task:<workflowTaskId>" for an approval row. */
  id: string;
  kind: PayrollFindingKind;
  severity: PayrollFindingQueueSeverity;
  /** Approval rows carry the run's approval status label; finding rows carry the finding state. */
  state: PayrollFindingQueueState | 'pending_approval';
  version: number;
  run: PayrollFindingRunRef;
  title: string;
  summary: string;
  owner: PayrollFindingOwner | null;
  dueAt: string | null;
  impact: PayrollFindingImpact;
  allowedActions: PayrollFindingAllowedAction[];
  /** Present on approval-kind rows only — the workflow task to deep-link to (never actioned here). */
  workflowTaskId: string | null;
}

export interface PayrollFindingActivity {
  id: string;
  findingId: string;
  actorId: string | null;
  actorName: string | null;
  activityType: PayrollFindingActivityType;
  body: string | null;
  fromState: string | null;
  toState: string | null;
  findingVersion: number | null;
  createdAt: string;
}

export interface PayrollFindingEvidenceRef {
  type: string;
  id: string;
  label: string;
  occurredAt: string | null;
}

export interface PayrollFindingResolution {
  actorId: string;
  note: string;
  resolvedAt: string;
}

/** Full detail for the selected row (§15.3). */
export interface PayrollFindingDetail extends PayrollFindingQueueItem {
  trigger: { ruleKey: string; threshold: string | null; observed: string };
  subject: { employeeId: string | null; displayName: string | null; scopeLabel: string };
  sourceEvidence: PayrollFindingEvidenceRef[];
  requiredEvidence: string[];
  resolution: PayrollFindingResolution | null;
  activity: PayrollPageResult<PayrollFindingActivity>;
}

/** POST finance/payroll/findings/work-queue */
export interface PayrollWorkQueueRequest {
  cursor?: string;
  limit: number;                 // 1..100, default 25
  tab?: PayrollWorkQueueTab;
  kinds?: PayrollFindingKind[];
  severities?: PayrollFindingQueueSeverity[];
  states?: PayrollFindingQueueState[];
  runIds?: string[];
  ownerId?: string;
  search?: string;
  /** Finding id or "task:<workflowTaskId>" to hydrate `selected`. */
  selectedId?: string;
  /** Page size for the selected detail's activity feed. */
  activityLimit?: number;
  activityCursor?: string;
}

export interface PayrollWorkQueueResult {
  items: PayrollFindingQueueItem[];
  nextCursor: string | null;
  total: number;
  tabCounts: Record<PayrollWorkQueueTab, number>;
  asOf: string;
  selected: PayrollFindingDetail | null;
}

/** POST finance/payroll/findings/escalate (gated by finance.payroll.finding.assign). */
export interface PayrollFindingEscalateRequest {
  findingId: string;
  expectedVersion: number;
  idempotencyKey: string;
  assigneeId: string;
  note?: string;
}

/** POST finance/payroll/findings/comment (gated by finance.payroll.view_all). */
export interface PayrollFindingCommentRequest {
  findingId: string;
  idempotencyKey: string;
  body: string;
  /** Optional optimistic hint; comment never bumps the finding version. */
  expectedVersion?: number;
}

export interface PayrollFindingCommentResult {
  activity: PayrollFindingActivity;
  findingVersion: number;
}
