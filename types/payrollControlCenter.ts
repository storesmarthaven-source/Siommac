// types/payrollControlCenter.ts
// SHARED request/response contract for the Payroll Command Center (approved contract §4).
// Imported by BOTH the backend service and the FE api client. ONE camelCase contract.
// Endpoint: POST /api/finance/payroll/control-center/get (pure read, no mutation).

// ── Request ──────────────────────────────────────────────────────────────────

export type PayrollRunRegisterTab = 'all' | 'attention' | 'approval' | 'ready' | 'released';

export interface PayrollControlCenterRequest {
  window: { from: string; to: string };
  payGroupIds?: string[];
  register?: {
    tab?: PayrollRunRegisterTab;
    search?: string;
    cursor?: string;
    limit?: number;
  };
}

// ── Response ─────────────────────────────────────────────────────────────────

export type HealthState = 'healthy' | 'attention' | 'at_risk' | 'critical';
export type ReadinessState = 'not_started' | 'in_progress' | 'blocked' | 'ready' | 'released';
export type PayrollRunType = 'scheduled' | 'off_cycle' | 'correction' | 'final_pay';

export interface MoneyValue {
  amount: number;
  currency: 'TTD';
}

export interface PayrollControlCenterCapabilities {
  canCreateRun: boolean;
  canManageRun: boolean;
  canApprove: boolean;
  canConfirmFunding: boolean;
  canRelease: boolean;
  canExport: boolean;
}

export interface PayrollPortfolioHealth {
  state: HealthState;
  score: number;
  criticalCount: number;
  atRiskCount: number;
  openBlockerCount: number;
  overdueActionCount: number;
  primaryIntervention: {
    kind: 'finding' | 'approval' | 'funding' | 'deadline';
    title: string;
    detail: string;
    runId: string | null;
    targetId: string;
    dueAt: string | null;
  } | null;
}

export interface PayrollCommandCenterKpis {
  nextPayDate: { date: string | null; runId: string | null; runNo: string | null };
  activeRuns: number;
  employeesDue: number;
  grossPayroll: MoneyValue;
  netPayroll: MoneyValue;
  funding: {
    confirmed: MoneyValue;
    required: MoneyValue;
    gap: MoneyValue;
    state: 'not_required' | 'unconfirmed' | 'partial' | 'confirmed';
  };
}

export interface PayrollAssignedWork {
  taskId: string;
  workflowId: string;
  runId: string;
  runNo: string;
  /** Human pay-group name for the run — the card shows THIS, never the raw run number. */
  payGroupName: string | null;
  /** Population + net payroll the approval covers (mockup: "84 employees" / "Net payroll TTD …"). */
  employeeCount: number;
  netPayroll: MoneyValue;
  title: string;
  dueAt: string | null;
  isOverdue: boolean;
  assignee: { id: string; displayName: string; photoUrl: string | null };
  action: 'review_approval';
}

export interface PayrollActivityItem {
  eventId: string;
  runId: string | null;
  runNo: string | null;
  eventType: string;
  label: string;
  actor: { id: string | null; displayName: string; photoUrl: string | null } | null;
  occurredAt: string;
}

export interface PayrollDeadlineItem {
  id: string;
  kind: 'cutoff' | 'pay_date' | 'approval' | 'funding' | 'release';
  runId: string;
  runNo: string;
  title: string;
  dueAt: string;
  state: 'overdue' | 'today' | 'upcoming';
}

export interface PayrollReadinessGate {
  key:
    | 'inputs_locked'
    | 'calculation_current'
    | 'findings_clear'
    | 'approval_certified'
    | 'funding_confirmed'
    | 'journal_posted'
    | 'bank_accounts_ready';
  label: string;
  state: 'pass' | 'warning' | 'fail' | 'not_applicable';
  detail: string;
  targetId: string | null;
}

export interface PayrollRunRegisterItem {
  id: string;
  runNo: string;
  runType: PayrollRunType;
  payGroup: { id: string | null; name: string | null };
  periodStart: string;
  periodEnd: string;
  payDate: string | null;
  employeeCount: number;
  gross: MoneyValue;
  net: MoneyValue;
  status: string;
  readiness: {
    state: ReadinessState;
    percent: number | null;
    blockerCount: number;
    warningCount: number;
  };
  updatedAt: string;
}

export interface PayrollNextRun {
  run: PayrollRunRegisterItem;
  readiness: {
    state: ReadinessState;
    percent: number;
    passed: number;
    applicable: number;
    gates: PayrollReadinessGate[];
  };
  releaseImpact: {
    employees: number;
    gross: MoneyValue;
    net: MoneyValue;
    employerNis: MoneyValue;
    fundingGap: MoneyValue;
  };
}

export interface PayrollRunRegisterPage {
  items: PayrollRunRegisterItem[];
  nextCursor: string | null;
  total: number;
  tabCounts: Record<PayrollRunRegisterTab, number>;
}

export interface PayrollControlCenterResponse {
  asOf: string;
  window: { from: string; to: string };
  appliedFilters: { payGroupIds: string[] };
  capabilities: PayrollControlCenterCapabilities;
  portfolioHealth: PayrollPortfolioHealth;
  kpis: PayrollCommandCenterKpis;
  assignedToYou: PayrollAssignedWork | null;
  recentActivity: PayrollActivityItem[];
  upcomingDeadlines: PayrollDeadlineItem[];
  nextScheduledRun: PayrollNextRun | null;
  runRegister: PayrollRunRegisterPage;
}
