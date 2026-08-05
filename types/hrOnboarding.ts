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
export interface OnboardingPackageMatch {
  eligible: boolean;
  /** Higher values are a more specific match. The server owns this ranking. */
  rank: number;
  reasons: string[];
  facts: {
    workerCategory: string;
    employmentType: string | null;
    departmentId: string | null;
    departmentName: string | null;
    siteId: string | null;
    siteName: string | null;
    role: string | null;
  };
}

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
  /** Days of probation for this package. null = no probation period (e.g. contractors). */
  probationDays: number | null;
  /** Present when evaluated for a selected Employee Master record. */
  match: OnboardingPackageMatch | null;
}

// ── Start Onboarding wizard: intake-preview (verification + documents + duplicate + task/handoff preview) ──
export interface OnboardingIntakeVerification { id: string; label: string; status: 'verified' | 'pending'; critical: boolean }

export type OnboardingDocumentState = 'present_verified' | 'present_unverified' | 'expired' | 'missing';

/** Selection the wizard makes for a document requirement (how it will be satisfied at launch). */
/**
 * `upload_now` — HR attached a NEW record through the governed Employee Master commit flow
 * during intake. It carries the committed `uploadedDocumentId`; the server re-validates
 * ownership, type and provenance rather than trusting the id.
 */
export type OnboardingDocumentLaunchAction = 'use_existing' | 'upload_now' | 'request_from_worker' | 'waive' | 'none';

export interface OnboardingDocumentLaunchSelection {
  requirementId: string;
  action: OnboardingDocumentLaunchAction;
  /** doc ID when action === 'use_existing' */
  existingDocumentId?: string | null;
  /** doc ID returned by `hr/employees/documents/commit` when action === 'upload_now'. */
  uploadedDocumentId?: string | null;
  waiverReason?: string | null;
}

export interface OnboardingLaunchOneOffAction {
  actionName: string;
  actionType: Exclude<OnboardingActionType, 'custom_approval'>;
  description?: string | null;
  instructions?: string | null;
  ownerRole?: string | null;
  ownerEmployeeId?: string | null;
  ownerDepartmentId?: string | null;
  dueOffsetDays?: number | null;
  priority?: OnboardingActionPriority;
  blocksOnboarding?: boolean;
  requiresEvidence?: boolean;
  externalSystemKey?: string | null;
  externalActionUrl?: string | null;
}

export interface OnboardingIntakeDocument {
  requirementId: string;
  type: string;
  label: string;
  state: OnboardingDocumentState;
  collected: boolean;
  /** Whether the requirement is marked required (vs advisory). Default: true */
  isRequired: boolean;
  /** Whether a missing/expired doc blocks case launch. Default: false */
  isBlocking: boolean;
  /** Whether HR may waive this requirement. Default: false */
  canWaive: boolean;
  /** Whether the document must carry an expiry date to be compliant. */
  requiresExpiry: boolean;
  /** Document ID of the best existing doc for this requirement, if any. */
  existingDocumentId: string | null;
  /** Expiry date of the best existing doc, if any. */
  expiresAt: string | null;
}

/**
 * Minimum safe conflict projection for the wizard's Duplicate Check card.
 * Deliberately carries NO caseId: the conflicting case may be outside the actor's read
 * scope, and an opaque id invites a follow-up fetch the read gate would have to refuse.
 */
export interface OnboardingIntakeDuplicateCase { caseNo: string }
export interface OnboardingIntakePreviewArgs { employeeId: string; packageKey: string; targetStartDate?: string | null }
export interface OnboardingIntakePreview {
  preview: {
    package: string;
    label: string;
    tasks: { taskKey: string; taskTitle: string; ownerRole: string; moduleKey: string | null; isBlocking: boolean }[];
    handoffs: { targetModule: string; handoffType: string }[];
    taskCount: number;
    handoffCount: number;
  } | null;
  verification: OnboardingIntakeVerification[];
  documents: {
    items: OnboardingIntakeDocument[];
    requiredCount: number;
    missingCount: number;
    blockingMissingCount: number;
    pendingVerificationCount: number;
    expiredCount: number;
  };
  duplicate: { hasDuplicate: boolean; checkedAt: string; cases: OnboardingIntakeDuplicateCase[] };
  /** Same server decision used by selection, preview and launch validation. */
  packageMatch: OnboardingPackageMatch;
}

export interface OnboardingAccountPreflight {
  required: boolean;
  ready: boolean;
  operatingModel: 'hr_managed' | 'it_managed' | 'hybrid';
  owningTeam: { id: 'hr_operations' | 'it_service_desk'; label: string };
  accountablePerson: { id: string; name: string | null } | null;
  accessProfile: string;
  proposedWorkEmail: string | null;
  credentialMethod: 'invite_link';
  invitationTiming: { mode: 'before_start'; offsetDays: number } | { mode: 'after_account_handoff' };
  provisioningAuthority: 'hr.onboarding.provision_account';
  blockers: string[];
}

export interface OnboardingLaunchPreflightArgs {
  employeeId: string;
  packageKey: string;
  ownerId?: string | null;
  /** Required at launch (the approved mockup marks it `*`); surfaced here so the wizard can
   *  show it as a `worker`-step blocker instead of only failing at submit. */
  reason?: string | null;
  targetStartDate?: string | null;
  includeActionTemplateIds?: string[] | null;
  oneOffActions?: OnboardingLaunchOneOffAction[] | null;
  documentSelections?: OnboardingDocumentLaunchSelection[] | null;
}

export interface OnboardingLaunchPreflight {
  ready: boolean;
  validatedAt: string;
  blockers: { step: 'worker' | 'package' | 'optional' | 'documents'; message: string }[];
  followUps: { step: 'optional' | 'documents'; label: string; owner: string; dueAt: string | null }[];
  package: { id: string; key: string; label: string; versionNo: number };
  counts: { tasks: number; handoffs: number; documentRequests: number; actions: number };
  owner: { id: string; name: string | null };
  accountPolicy: OnboardingAccountPreflight;
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
  /** Days of probation for this package. null = no probation period. */
  probationDays: number | null;
  taskTemplates: OnboardingTaskTemplateRow[];
  handoffTemplates: OnboardingHandoffTemplateRow[];
}

export interface OnboardingPackageReferenceOption {
  id: string;
  label: string;
  detail: string | null;
}

export interface OnboardingPackageReferenceData {
  documentRequirements: OnboardingPackageReferenceOption[];
  trainingRequirements: OnboardingPackageReferenceOption[];
  workflowTemplates: OnboardingPackageReferenceOption[];
}

export interface CreatePackageArgs {
  label: string;
  description?: string | null;
  workerTypes?: string[];
  defaultSlaDays?: number;
  defaultOwnerRole?: string | null;
  appliesToDepartments?: string[];
  appliesToSites?: string[];
  probationDays?: number | null;
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
  probationDays?: number | null;
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
/**
 * Onboarding read scope. Resolved SERVER-side (netlify/functions/lib/hr/onboardingScope.ts);
 * the client only states which scope it is asking for. Omitted => 'my'. An unauthorised
 * 'team'/'all' request returns 403 — the server never downgrades it.
 */
export type OnboardingReadScope = 'my' | 'team' | 'all';

export interface OnboardingCaseListArgs {
  scope?: OnboardingReadScope;
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
  /** Only cases whose `target_start_date` is within N days of today (inclusive). */
  startsWithinDays?: number;
  /** Only cases with no accountable owner — the Owner Required KPI's drill-through. */
  unassignedOwner?: boolean;
  sort?: { field: 'case_no' | 'due_at' | 'started_at' | 'status' | 'progress' | 'target_start_date'; direction: 'asc' | 'desc' };
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
  /** Planned first day (`hr_onboarding_cases.target_start_date`). Drives Upcoming Starts. */
  targetStartDate: string | null;
}

export interface OnboardingCaseListResult {
  rows: OnboardingCaseRow[];
  total: number;
  page: number;
  pageSize: number;
}

// ── Worker self-service ─────────────────────────────────────────────────────
// This projection is intentionally narrower than Case Detail. It contains only
// the signed-in worker's case, work explicitly assigned to them, their document
// requests, messages addressed to them, and the people they may contact.
export interface OnboardingWorkerTask {
  taskId: string;
  title: string;
  status: OnboardingTaskStatus;
  dueAt: string | null;
  requiresEvidence: boolean;
  isBlocking: boolean;
  moduleLabel: string | null;
}

export interface OnboardingWorkerDocumentRequest {
  requestId: string;
  label: string;
  documentType: string;
  status: 'pending' | 'uploaded' | 'use_existing' | 'waived' | 'verified' | 'rejected';
  isRequired: boolean;
  rejectionReason: string | null;
  /** The worker must supply an expiry date when submitting this document. */
  requiresExpiry: boolean;
}

export interface OnboardingWorkerMessage {
  messageId: string;
  subject: string | null;
  body: string | null;
  channel: OnboardingCommunicationChannel;
  sentAt: string | null;
}

export interface OnboardingWorkerExperience {
  caseId: string;
  caseNo: string;
  employeeName: string;
  employeePhotoUrl: string | null;
  packageLabel: string;
  status: OnboardingCaseStatus;
  targetStartDate: string | null;
  /** Over the worker's OWN visible population (assigned tasks + required documents). */
  progressPercent: number;
  /**
   * False when the worker has nothing assigned at all. Without this, "no worker actions"
   * and "every worker action complete" both render as 100% and are indistinguishable.
   */
  hasWorkerActions: boolean;
  /**
   * Day-One readiness is the CASE's authoritative state, narrowed by the worker's own
   * outstanding items. It is never true merely because the worker was assigned nothing.
   */
  dayOneReady: boolean;
  caseOwner: { id: string; name: string | null } | null;
  supervisor: { id: string; name: string | null } | null;
  tasks: OnboardingWorkerTask[];
  documentRequests: OnboardingWorkerDocumentRequest[];
  messages: OnboardingWorkerMessage[];
}

// ── Dashboard stats ─────────────────────────────────────────────────────────────
export interface OnboardingDashboardStatsArgs {
  scope?: OnboardingReadScope;
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
  /**
   * Active cases whose `target_start_date` falls in the canonical seven-day window
   * [today, today+7]. This is a COHORT count (people starting), deliberately distinct from
   * `dueThisWeek.dueIn7Days`, which counts TASKS falling due.
   */
  startsWithin7Days: number;
  /** Active cases with no accountable case owner (`owner_id is null`). */
  ownerRequired: number;
  activationReadiness: {
    readyPercent: number;
    profileReadyPercent: number;
    documentsReadyPercent: number;
    trainingReadyPercent: number;
    accessReadyPercent: number;
    /**
     * Active cases split three ways by TASK STATE. Definitions are explicit and
     * mutually exclusive, so the three always sum to `activeCases.total`:
     *   ready       — no open tasks remain (or the case is ready_for_activation);
     *   inProgress  — not ready, and at least one task is already done;
     *   notStarted  — not ready, and no task has been completed yet.
     * A case with no tasks at all counts as notStarted, not ready — an empty
     * checklist is not evidence of readiness.
     */
    readyCases: number;
    inProgressCases: number;
    notStartedCases: number;
  };
  packageReadiness: { packageKey: string; packageLabel: string; activeCount: number; readyPercent: number }[];
}

// ── Tasks ─────────────────────────────────────────────────────────────────────--
export interface OnboardingTaskListArgs {
  scope?: OnboardingReadScope;
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

/** Exactly three review states — no reviewer-routing or approval-chain states. */
export type OnboardingEvidenceReviewStatus = 'pending_review' | 'approved' | 'returned';

export interface OnboardingTaskEvidence {
  id: string;
  fileName: string;
  filePath: string;
  mimeType: string | null;
  fileSize: number | null;
  byId: string | null;
  byName: string | null;
  at: string;
  reviewStatus: OnboardingEvidenceReviewStatus;
  reviewedById: string | null;
  reviewedByName: string | null;
  reviewedAt: string | null;
  reviewNote: string | null;
  /** Copied from the pre-table metadata.evidence array; may lack a usable storage path. */
  isLegacy: boolean;
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
  scope?: OnboardingReadScope;
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
  /** Planned completion date resolved from the handoff template's due rule. */
  dueAt: string | null;
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
  scope?: OnboardingReadScope;
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
  scope?: OnboardingReadScope;
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

// ── Start Onboarding: launch args extension ──────────────────────────────────────
/** Governed five-step wizard launch contract. Consumed by the route schema and core. */
export interface OnboardingStartArgs {
  /** Stable for one wizard submission; a new legitimate cycle receives a new id. */
  requestId: string;
  employeeId: string;
  packageKey: string;
  ownerId?: string | null;
  /** REQUIRED and non-blank — the approved wizard marks Reason `*`, and the route, the
   *  service and the launch preflight all enforce it. Typed non-optional so a caller cannot
   *  omit it and discover the 400 at runtime. */
  reason: string;
  priority?: string | null;
  targetStartDate?: string | null;
  includeActionTemplateIds?: string[] | null;
  /** Per-requirement document disposition selections from the Documents wizard step. */
  documentSelections?: OnboardingDocumentLaunchSelection[] | null;
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

// ════════════════════════════════════════════════════════════════════════════════
// Unified Work Queue — executable work across tasks, handoffs, blockers and evidence.
//
// This is a READ PROJECTION over the four existing stores (see the
// hr_onboarding_work_queue RPC). It is not a work store: every row points back at the
// authoritative record via sourceType + sourceId, and every mutation continues to go
// through that source's own endpoint.
// ════════════════════════════════════════════════════════════════════════════════

/** Which store a queue row came from. Drives both the row action and the Case Detail tab. */
export type OnboardingWorkSourceType = 'task' | 'handoff' | 'blocker' | 'evidence';

/**
 * The single normalised lifecycle. The three stores use three different status
 * vocabularies (7 / 8 / 6 values) with overlapping meanings; one Status filter is only
 * possible against this mapping, which is defined server-side in the RPC.
 */
export type OnboardingWorkLifecycle = 'open' | 'in_progress' | 'blocked' | 'done' | 'cancelled';

/** `unscheduled` is a first-class state: work with no deterministic due date. */
export type OnboardingWorkDueState = 'all' | 'overdue' | 'due_today' | 'due_this_week' | 'unscheduled';

export type OnboardingWorkSortField =
  | 'due_at' | 'title' | 'employee_name' | 'case_no' | 'source_type' | 'status' | 'created_at';

export interface OnboardingWorkItem {
  sourceType: OnboardingWorkSourceType;
  /** Primary key WITHIN its source table — unique only together with sourceType. */
  sourceId: string;
  caseId: string;
  caseNo: string;
  employeeId: string | null;
  employeeName: string | null;
  /** The SUBJECT's org unit, not the performer's. Distinct from owningQueue. */
  departmentId: string | null;
  departmentName: string | null;
  siteId: string | null;
  siteName: string | null;
  title: string;
  detail: string | null;
  /** The role/module queue that performs the work (IT, Payroll, HSE …). */
  owningQueue: string | null;
  /** The accountable PERSON. Null means unassigned — still visible in its queue. */
  accountableId: string | null;
  accountableName: string | null;
  /** The row's own store-specific status, preserved verbatim. */
  sourceStatus: string;
  normalizedStatus: OnboardingWorkLifecycle;
  /** Null = Unscheduled. Never inferred from createdAt. */
  dueAt: string | null;
  severity: string | null;
  isBlocking: boolean;
  /** Set so an evidence or blocker row can open its authoritative task. */
  relatedTaskId: string | null;
  relatedHandoffId: string | null;
  createdAt: string;
}

export interface OnboardingWorkQueueArgs {
  scope?: OnboardingReadScope;
  sourceTypes?: OnboardingWorkSourceType[];
  lifecycles?: OnboardingWorkLifecycle[];
  dueState?: OnboardingWorkDueState;
  departmentIds?: string[];
  queues?: string[];
  accountableIds?: string[];
  unassigned?: boolean;
  query?: string;
  sort?: { field: OnboardingWorkSortField; direction: 'asc' | 'desc' };
  page?: number;
  pageSize?: number;
}

export interface OnboardingWorkQueueResult {
  rows: OnboardingWorkItem[];
  /** An EXACT count from Postgres, not the length of a truncated fetch. */
  total: number;
  page: number;
  pageSize: number;
}

/** Approve or return ONE evidence submission. A return must carry a reason. */
export interface ReviewEvidenceArgs {
  evidenceId: string;
  decision: 'approved' | 'returned';
  note?: string | null;
}
