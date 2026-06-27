/**
 * types/hrOnboarding.ts
 *
 * Shared camelCase contract for the HR Onboarding management module — imported by
 * BOTH the backend (netlify/functions/lib/hr/onboardingQueries.ts) and the frontend
 * (src/api/hr/onboarding.ts). ONE source of truth, no per-endpoint mappers/dual aliases
 * (see the messaging contract lesson). Add fields here, never re-declare them per side.
 *
 * Phase 2 = read contracts (dashboard / list / tasks / handoffs / blockers). Mutation
 * contracts (Phase 3+) and package/custom-action contracts (Phase 4/5) land here too.
 */

export type OnboardingCaseStatus =
  | 'draft' | 'open' | 'in_progress' | 'blocked' | 'paused'
  | 'ready_for_activation' | 'completed' | 'cancelled';

export type OnboardingTaskStatus =
  | 'pending' | 'open' | 'in_progress' | 'blocked' | 'completed' | 'skipped' | 'cancelled';

export type OnboardingHandoffStatus =
  | 'pending' | 'sent' | 'accepted' | 'blocked' | 'delivered' | 'completed' | 'failed' | 'cancelled';

export type OnboardingBlockerStatus =
  | 'active' | 'acknowledged' | 'waiting_on_owner' | 'escalated' | 'resolved' | 'waived';

export type OnboardingSeverity = 'low' | 'medium' | 'high' | 'critical';

export type DueState     = 'all' | 'overdue' | 'due_today' | 'due_this_week';
export type BlockingState = 'all' | 'blocked' | 'not_blocked';
export type ReadinessState = 'all' | 'ready' | 'not_ready';

// ── Packages (Phase 4) ───────────────────────────────────────────────────────────
export interface OnboardingPackageSummary {
  key: string;
  label: string;
  description: string | null;
  status: 'draft' | 'active' | 'retired';
  /** Human owner-role summary derived from the package's task templates, e.g. "HR, IT, HSE". */
  owners: string;
  taskCount: number;
  handoffCount: number;
  workerTypes: string[];
  defaultSlaDays: number;
  defaultOwnerRole: string | null;
  versionNo: number;
}

// ── Cases list ──────────────────────────────────────────────────────────────────
export interface OnboardingCaseListArgs {
  query?: string;
  statuses?: string[];
  packageKeys?: string[];
  ownerIds?: string[];
  departmentIds?: string[];
  siteIds?: string[];
  workerTypes?: string[];
  reasons?: string[];
  dueState?: DueState;
  blockingState?: BlockingState;
  readinessState?: ReadinessState;
  page?: number;
  pageSize?: number;
  sort?: { field: 'case_no' | 'due_at' | 'started_at' | 'status' | 'progress'; direction: 'asc' | 'desc' };
}

export interface OnboardingCaseRow {
  caseId: string;
  caseNo: string;
  employeeId: string | null;
  employeeName: string | null;
  employeeNo: string | null;
  workerType: string | null;
  departmentName: string | null;
  siteName: string | null;
  packageKey: string;
  packageLabel: string;
  reason: string | null;
  ownerId: string | null;
  ownerName: string | null;
  status: OnboardingCaseStatus;
  progressPercent: number;
  openTasks: number;
  blockingTasks: number;
  activeBlockers: number;
  ready: boolean;
  dueAt: string | null;
  startedAt: string | null;
}

export interface OnboardingCaseListResult {
  rows: OnboardingCaseRow[];
  total: number;
  page: number;
  pageSize: number;
}

// ── Dashboard stats ─────────────────────────────────────────────────────────────
export interface OnboardingDashboardStatsArgs {
  departmentIds?: string[];
  siteIds?: string[];
  ownerIds?: string[];
  packageKeys?: string[];
}

export interface OnboardingDashboardStats {
  activeCases: {
    total: number;
    newHires: number;
    transfers: number;
    contractors: number;
    weeklyTrend: { week: string; count: number }[];
  };
  blockingTasks: {
    blockedCases: number;
    documents: number;
    training: number;
    hse: number;
    payroll: number;
  };
  dueThisWeek: {
    dueToday: number;
    overdue: number;
    dueIn7Days: number;
    criticalOverdue: number;
  };
  activationReadiness: {
    readyPercent: number;
    profileReadyPercent: number;
    documentsReadyPercent: number;
    trainingReadyPercent: number;
    accessReadyPercent: number;
  };
}

// ── Tasks ─────────────────────────────────────────────────────────────────────--
export interface OnboardingTaskListArgs {
  caseId?: string;
  statuses?: string[];
  ownerRoles?: string[];
  moduleKeys?: string[];
  assignedTo?: string;
  blockingOnly?: boolean;
  dueState?: DueState;
  query?: string;
}

export interface OnboardingTaskRow {
  taskId: string;
  caseId: string;
  caseNo: string;
  employeeId: string | null;
  employeeName: string | null;
  packageKey: string;
  taskKey: string;
  taskTitle: string;
  ownerRole: string | null;
  moduleKey: string | null;
  assignedTo: string | null;
  assignedToName: string | null;
  status: OnboardingTaskStatus;
  dueAt: string | null;
  isBlocking: boolean;
  requiresEvidence: boolean;
  priority: string | null;
}

// ── Handoffs ──────────────────────────────────────────────────────────────────--
export interface OnboardingHandoffListArgs {
  caseId?: string;
  targetModules?: string[];
  statuses?: string[];
}

export interface OnboardingHandoffRow {
  handoffId: string;
  caseId: string;
  caseNo: string;
  employeeName: string | null;
  targetModule: string;
  handoffType: string | null;
  handoffKey: string | null;
  status: OnboardingHandoffStatus;
  ownerId: string | null;
  ownerName: string | null;
  createdAt: string;
  lastEventAt: string | null;
}

// ── Blockers ──────────────────────────────────────────────────────────────────--
export interface OnboardingBlockerListArgs {
  caseId?: string;
  blockingModules?: string[];
  statuses?: string[];
  severities?: string[];
}

export interface OnboardingBlockerRow {
  blockerId: string;
  caseId: string;
  caseNo: string;
  employeeName: string | null;
  blockerKey: string;
  blockerTitle: string;
  blockingModule: string;
  severity: OnboardingSeverity;
  status: OnboardingBlockerStatus;
  ownerId: string | null;
  ownerName: string | null;
  dueAt: string | null;
  ageDays: number;
  taskId: string | null;
  handoffId: string | null;
}

// ── Custom Onboarding Actions (Phase 5) ──────────────────────────────────────────
export type OnboardingActionType =
  | 'custom_task' | 'custom_handoff' | 'custom_document_request' | 'custom_training_request'
  | 'custom_approval' | 'custom_notification' | 'custom_checklist_item' | 'custom_external_action';

export type OnboardingOwnerType = 'role' | 'employee' | 'department' | 'system' | 'external';
export type OnboardingActionPriority = 'low' | 'normal' | 'high' | 'critical';
export type OnboardingCaseActionStatus = 'open' | 'in_progress' | 'completed' | 'cancelled' | 'blocked';

export interface OnboardingActionTemplate {
  id: string;
  packageKey: string;
  actionName: string;
  actionType: OnboardingActionType;
  description: string | null;
  instructions: string | null;
  ownerType: OnboardingOwnerType;
  ownerRole: string | null;
  ownerEmployeeId: string | null;
  ownerDepartmentId: string | null;
  dueOffsetDays: number | null;
  priority: OnboardingActionPriority;
  isRequired: boolean;
  isActive: boolean;
  blocksOnboarding: boolean;
  requiresEvidence: boolean;
  documentTypeId: string | null;
  trainingRequirementId: string | null;
  workflowTemplateId: string | null;
  notificationTemplateId: string | null;
  externalSystemKey: string | null;
  externalActionUrl: string | null;
  displayOrder: number;
}

export interface OnboardingCaseAction {
  id: string;
  caseId: string;
  sourceTemplateId: string | null;
  actionName: string;
  actionType: OnboardingActionType;
  status: OnboardingCaseActionStatus;
  linkedTaskId: string | null;
  linkedHandoffId: string | null;
  linkedWorkflowInstanceId: string | null;
  addedBy: string | null;
  addedByName: string | null;
  addedAt: string;
  completedAt: string | null;
}

// ── Audit (case Audit tab — Phase 3) ─────────────────────────────────────────────
export interface OnboardingAuditRow {
  id: string;
  action: string;
  actorId: string | null;
  actorName: string | null;
  reason: string | null;
  previousState: unknown;
  newState: unknown;
  createdAt: string;
}
