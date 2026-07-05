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
  id: string;
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

// ── Package Manager (task templates, handoff templates, package CRUD) ───────────
export interface OnboardingTaskTemplateRow {
  id: string;
  taskKey: string;
  taskTitle: string;
  ownerRole: string;
  moduleKey: string | null;
  isBlocking: boolean;
  requiresEvidence: boolean;
  dependencyKeys: string[];
  sortOrder: number;
}

export interface OnboardingHandoffTemplateRow {
  id: string;
  handoffKey: string;
  targetModule: string;
  handoffType: string;
  isRequired: boolean;
  sortOrder: number;
  payloadTemplate: Record<string, unknown>;
}

export interface OnboardingPackageDetail {
  id: string;
  key: string;
  label: string;
  description: string | null;
  workerTypes: string[];
  defaultSlaDays: number;
  defaultOwnerRole: string | null;
  appliesToDepartments: string[];
  appliesToSites: string[];
  status: 'draft' | 'active' | 'retired';
  versionNo: number;
  taskTemplates: OnboardingTaskTemplateRow[];
  handoffTemplates: OnboardingHandoffTemplateRow[];
}

export interface CreatePackageArgs {
  label: string;
  description?: string | null;
  workerTypes?: string[];
  defaultSlaDays?: number;
  defaultOwnerRole?: string | null;
  appliesToDepartments?: string[];
  appliesToSites?: string[];
}
export interface UpdatePackageArgs {
  id: string;
  label?: string;
  description?: string | null;
  workerTypes?: string[];
  defaultSlaDays?: number;
  defaultOwnerRole?: string | null;
  appliesToDepartments?: string[];
  appliesToSites?: string[];
}
export interface SetPackageStatusArgs { id: string; status: 'draft' | 'active' | 'retired' }

export interface CreateTaskTemplateArgs {
  packageId: string; taskKey: string; taskTitle: string; ownerRole: string; moduleKey?: string | null;
  isBlocking?: boolean; requiresEvidence?: boolean; dependencyKeys?: string[]; sortOrder?: number;
}
export interface UpdateTaskTemplateArgs {
  id: string; taskTitle?: string; ownerRole?: string; moduleKey?: string | null;
  isBlocking?: boolean; requiresEvidence?: boolean; dependencyKeys?: string[]; sortOrder?: number;
}
export interface CreateHandoffTemplateArgs {
  packageId: string; handoffKey: string; targetModule: string; handoffType: string;
  isRequired?: boolean; sortOrder?: number; payloadTemplate?: Record<string, unknown>;
}
export interface UpdateHandoffTemplateArgs {
  id: string; targetModule?: string; handoffType?: string;
  isRequired?: boolean; sortOrder?: number; payloadTemplate?: Record<string, unknown>;
}

// ── Cases list ──────────────────────────────────────────────────────────────────
export interface OnboardingCaseListArgs {
  query?: string;
  statuses?: string[];
  packageKeys?: string[];
  ownerIds?: string[];
  employeeIds?: string[];
  caseIds?: string[];
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
  employeePhotoUrl: string | null;
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
  packageReadiness: { packageKey: string; packageLabel: string; activeCount: number; readyPercent: number }[];
}

// ── Tasks ─────────────────────────────────────────────────────────────────────--
export interface OnboardingTaskListArgs {
  caseId?: string;
  statuses?: string[];
  ownerRoles?: string[];
  moduleKeys?: string[];
  packageKeys?: string[];
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
  employeePhotoUrl: string | null;
  packageKey: string;
  taskKey: string;
  taskTitle: string;
  ownerRole: string | null;
  moduleKey: string | null;
  assignedTo: string | null;
  assignedToName: string | null;
  status: OnboardingTaskStatus;
  dueAt: string | null;
  completedAt: string | null;
  isBlocking: boolean;
  requiresEvidence: boolean;
  priority: string | null;
}

// ── Task notes / evidence (Tasks Workspace drawer) ────────────────────────────────
// Stored as append-only arrays in hr_onboarding_tasks.metadata (notes / evidence) —
// no satellite table: they are strictly task-scoped, never queried across tasks, and
// every append is separately audited via hr_audit_log + app_events.
export interface OnboardingTaskNote {
  id: string;
  note: string;
  byId: string | null;
  byName: string | null;
  at: string;
}

export interface OnboardingTaskEvidence {
  id: string;
  fileName: string;
  filePath: string;
  mimeType: string | null;
  fileSize: number | null;
  byId: string | null;
  byName: string | null;
  at: string;
}

/** Full single-task view for the workspace drawer: the list row + notes/evidence +
 *  flags the list omits. */
export interface OnboardingTaskDetail extends OnboardingTaskRow {
  blockedReason: string | null;
  dependencyKeys: string[];
  sortOrder: number;
  completedBy: string | null;
  completedByName: string | null;
  completedAt: string | null;
  createdAt: string;
  notes: OnboardingTaskNote[];
  evidence: OnboardingTaskEvidence[];
}

export interface AddTaskNoteArgs { taskId: string; note: string }
export interface AttachTaskEvidenceArgs {
  taskId: string; fileName: string; filePath: string;
  mimeType?: string | null; fileSize?: number | null;
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
  failureReason: string | null;
  payload: Record<string, unknown>;
  createdAt: string;
  lastEventAt: string | null;
}

/** Handoff lifecycle transition. `note` becomes failure_reason on 'fail', or an audit
 *  reason otherwise. The allowed source→target map lives in onboardingMutations.ts. */
export interface OnboardingHandoffActionArgs {
  handoffId: string;
  reason?: string | null;
}
export interface OnboardingHandoffActionResult {
  handoffId: string;
  caseId: string;
  status: OnboardingHandoffStatus;
  lastEventAt: string;
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
  employeePhotoUrl: string | null;
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

export interface NotifyBlockerOwnerArgs { blockerId: string; message?: string | null }
export interface NotifyBlockerOwnerResult { blockerId: string; notifiedOwnerId: string; notifiedAt: string }

// ── Case Communications (Phase 5) ─────────────────────────────────────────────────
export type OnboardingCommunicationType =
  | 'employee_welcome' | 'supervisor_notification' | 'owner_reminder' | 'escalation_notice' | 'manual_message';
export type OnboardingCommunicationChannel = 'email' | 'in_app' | 'sms' | 'manual';
export type OnboardingCommunicationStatus = 'draft' | 'queued' | 'sent' | 'failed' | 'cancelled';

export interface OnboardingCommunicationRow {
  id: string;
  caseId: string;
  communicationType: OnboardingCommunicationType;
  channel: OnboardingCommunicationChannel;
  recipientUserId: string | null;
  recipientName: string | null;
  recipientEmail: string | null;
  subject: string | null;
  body: string | null;
  status: OnboardingCommunicationStatus;
  failureReason: string | null;
  sentByName: string | null;
  sentAt: string | null;
  createdAt: string;
}

/** Resolved recipient + rendered subject/body for a communication, without sending. */
export interface OnboardingCommunicationPreview {
  communicationType: OnboardingCommunicationType;
  recipientUserId: string | null;
  recipientName: string | null;
  subject: string;
  body: string;
  /** Set when the type resolves no recipient (e.g. no supervisor on file). */
  warning: string | null;
}

export interface PreviewCommunicationArgs {
  caseId: string;
  communicationType: OnboardingCommunicationType;
  subject?: string | null;
  body?: string | null;
  recipientUserId?: string | null;
}
export interface SendCommunicationArgs extends PreviewCommunicationArgs {
  channel?: OnboardingCommunicationChannel;
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

// ── Reports (Phase 6) ─────────────────────────────────────────────────────────────
export type OnboardingReportKey =
  | 'cycle_time' | 'blocked_cases' | 'task_owner_performance' | 'handoff_completion'
  | 'package_effectiveness' | 'activation_readiness' | 'overdue_tasks'
  | 'contractor_onboarding' | 'safety_critical_onboarding';

export interface OnboardingReportMeta {
  key: OnboardingReportKey;
  title: string;
  description: string;
  icon: string;
  chartType: 'line' | 'bar' | 'stacked_bar' | 'donut' | null;
  groupByOptions: ('day' | 'week' | 'month' | 'department' | 'package' | 'owner')[];
}

export interface RunOnboardingReportArgs {
  reportKey: OnboardingReportKey;
  dateFrom?: string | null;
  dateTo?: string | null;
  departmentIds?: string[];
  siteIds?: string[];
  packageKeys?: string[];
  ownerIds?: string[];
  workerTypes?: string[];
  status?: string[];
  groupBy?: 'day' | 'week' | 'month' | 'department' | 'package' | 'owner';
  page?: number;
  pageSize?: number;
}

export interface OnboardingReportColumn {
  key: string;
  label: string;
  type?: 'text' | 'number' | 'date' | 'percent' | 'status';
}
export interface OnboardingReportSummaryStat {
  label: string;
  value: string | number;
  delta?: string;
  state?: 'good' | 'warning' | 'critical' | 'neutral';
}
export interface OnboardingReportChart {
  type: 'line' | 'bar' | 'stacked_bar' | 'donut';
  labels: string[];
  series: { name: string; values: number[] }[];
}
export interface OnboardingReportResult {
  reportKey: OnboardingReportKey;
  title: string;
  summary: OnboardingReportSummaryStat[];
  chart: OnboardingReportChart | null;
  columns: OnboardingReportColumn[];
  rows: Record<string, unknown>[];
  totalRows: number;
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
