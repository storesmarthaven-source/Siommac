/**
 * types/hrEmployeeProfile.ts — the ONE authoritative Employee Profile contract.
 *
 * Shared verbatim by the backend (routes/hr.ts, lib/hr/employeeAttention.ts,
 * lib/hr/employeeProfileShell.ts) and the frontend (src/api/hr/employeeProfile.ts).
 * The drawer and the full page consume this same shell — per the implementation
 * contract there is exactly one profile-shell contract, not one per surface.
 */

/** Tabs the profile surfaces can target. The drawer renders all but `offboarding`. */
export type ProfileTabKey =
  | 'overview' | 'employment' | 'documents' | 'readiness'
  | 'access' | 'activity' | 'offboarding';

/** Source domain of an unresolved item. Drives the icon and the owning workspace. */
export type AttentionDomain =
  | 'employment' | 'statutory' | 'payroll' | 'documents'
  | 'training' | 'access' | 'onboarding' | 'offboarding';

/**
 * Indicator severity, matching the readiness collaboration note:
 *   critical → red   (blocked, overdue, missing, critical)
 *   warning  → amber (pending review, expiring)
 *   info     → blue  (active informational workflow, no action required)
 */
export type AttentionSeverity = 'critical' | 'warning' | 'info';

export type AttentionDueState = 'overdue' | 'due_soon' | 'scheduled' | 'none';

/**
 * One unresolved, genuinely actionable employee issue.
 *
 * `actionTarget` is the canonical destination — never inferred from display text.
 * `requiredCapability` is the capability the VIEWER needs to see the item at all;
 * the backend filters on it, the frontend never receives a suppressed item.
 */
export interface EmployeeAttentionItem {
  /** Deterministic and stable across reads, e.g. `documents.expired:<documentId>`. */
  id: string;
  domain: AttentionDomain;
  title: string;
  /** Supporting line rendered after the owner in the approved layout. */
  detail: string;
  severity: AttentionSeverity;
  dueState: AttentionDueState;
  dueDate: string | null;
  /** Resolved operational owner label (never a raw id). */
  owner: string | null;
  /** Who is expected to act next — may differ from the owner. */
  responsibleParty: string | null;
  actionLabel: string;
  actionTarget: ProfileTabKey;
  requiredCapability: string | null;
}

/** Per-tab rollup derived from the SAME attention items — never maintained by hand. */
export interface ProfileTabIndicator {
  tab: ProfileTabKey;
  unresolvedCount: number;
  highestSeverity: AttentionSeverity | null;
}

export interface ProfileIdentity {
  employeeId: string;
  employeeNo: string | null;
  displayName: string;
  profileImageUrl: string | null;
  employmentStatus: string;
  accountStatus: string;
  position: string | null;
  departmentName: string | null;
  siteName: string | null;
}

export interface ProfileEmploymentFacts {
  employmentBasis: string | null;
  /**
   * Full-Time / Part-Time, DERIVED from `fte`.
   *
   * The locked mockup pairs the two in one stat — "Full-Time · 1.0 FTE" — so the
   * arrangement is the FTE expressed in words, not a separate stored field.
   * Null when FTE is unknown; it is never guessed at from hours.
   */
  workArrangement: string | null;
  /** Rostered pattern (e.g. Standard, Shift) from `app_users.work_schedule`. */
  workSchedule: string | null;
  startDate: string | null;
  /** Whole months of continuous service, computed server-side from `startDate`. */
  tenureMonths: number | null;
  supervisorName: string | null;
  payGroupName: string | null;
  /**
   * Legal name of the employing entity, read from the CANONICAL single-tenant
   * employer profile that also feeds TD4/NI184/NI187 and the payslip employer
   * block — never a second employer record kept for the profile surface.
   */
  legalEmployer: string | null;
  /**
   * Contracted working time for the CURRENT assignment period. Effective-dated
   * on the assignment, so a change preserves the prior period's values rather
   * than overwriting them.
   */
  weeklyHours: number | null;
  /** Full-time equivalent for the current assignment; 1.0 = full-time. */
  fte: number | null;
  /** Cost centre carried on the employee record (`app_users.cost_center`). */
  costCentre: string | null;
  employeeGrade: string | null;
  /** Null when no probation was recorded — never treated as "completed". */
  probationEndDate: string | null;
  /**
   * Contractual notice in DAYS for the CURRENT assignment period.
   *
   * Effective-dated on the assignment, so a historical period keeps the notice
   * that applied then. Deliberately NOT the notice served on an offboarding
   * case, which is a departure fact rather than an employment term.
   */
  noticePeriodDays: number | null;
  /** Pay cycle from the assigned pay group (`finance_pay_groups.frequency`). */
  payFrequency: string | null;
  /** Employee vs Contractor, from `contractor_flag`. */
  workerCategory: string | null;
  /** Start of the CURRENT effective-dated assignment period. */
  assignmentEffectiveFrom: string | null;
}

/**
 * Masked bank context for the Employment tab.
 *
 * HR sees context and workflow state ONLY — never the raw account number, and
 * never a banking action. The canonical Finance API returns the masked value;
 * the unmasked number is not read here at all.
 */
export interface ProfileBankContext {
  bankName: string | null;
  accountNumberMasked: string | null;
  accountType: string | null;
  /** True when Finance holds a primary, active account for this employee. */
  hasPrimaryAccount: boolean;
  lastVerifiedAt: string | null;
  /** Readiness state of the payroll control that owns bank verification. */
  verificationState: 'verified' | 'reverify' | 'missing';
}

/**
 * Readiness summary for the gauge, derived from the TYPED control instances —
 * not from the superseded three-factor (assignment/payroll/training) guess.
 *
 * `readyControls`/`totalControls` count real `hr_readiness_control_instances`
 * rows against active `hr_readiness_controls`, and `blockedDomains` names the
 * domains that actually hold a non-ready blocking control.
 */
export interface ProfileReadinessSummary {
  percent: number;
  readyControls: number;
  totalControls: number;
  unresolvedWorkItems: number;
  payrollStatus: 'pending' | 'ready' | 'blocked';
  trainingStatus: 'current' | 'due_soon' | 'expired' | 'none';
  /** Domains carrying at least one non-ready BLOCKING control. */
  blockedDomains: ReadinessDomain[];
  /** Most recent control evaluation for this employee; null before first evaluation. */
  lastReviewedAt: string | null;
  /** Resolved label of the coordinating owner, never a raw id. */
  reviewOwnerLabel: string | null;
  /** Earliest outstanding work-item due date — the next date something is expected. */
  nextReviewAt: string | null;
}

export interface ProfileContactSummary {
  workEmail: string | null;
  workPhone: string | null;
  mobilePhone: string | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  emergencyContactRelationship: string | null;
}

/**
 * Non-technical account health suitable for HR.
 *
 * Deliberately excludes session ids, device identifiers, IP details and every
 * password/security control: HR must not receive those merely because it can
 * view an employee.
 */
export interface ProfileAccountHealth {
  accountStatus: string;
  hasLoginIdentity: boolean;
  accessProfileLabel: string | null;
  openSupportRequests: number;
}

export interface ProfileActivityEntry {
  id: string;
  action: string;
  area: string;
  actorName: string | null;
  occurredAt: string;
}

/** Presentation hints. Server-side authorization remains authoritative. */
export interface ProfileCapabilities {
  viewStatutory: boolean;
  viewReadiness: boolean;
  viewDocuments: boolean;
  viewAudit: boolean;
  viewOnboarding: boolean;
  viewOffboarding: boolean;
  viewAccountSecurity: boolean;
}

/**
 * The permission-filtered shell both surfaces open with.
 *
 * Deliberately excludes the large per-tab datasets (full document list, audit
 * history, access events, offboarding records) — those load when their tab opens.
 */
export interface EmployeeProfileShell {
  identity: ProfileIdentity;
  employment: ProfileEmploymentFacts;
  readiness: ProfileReadinessSummary | null;
  /** First page of attention items for the panel; `attentionTotal` drives "view all". */
  attentionPreview: EmployeeAttentionItem[];
  attentionTotal: number;
  tabIndicators: ProfileTabIndicator[];
  contact: ProfileContactSummary | null;
  accountHealth: ProfileAccountHealth | null;
  recentActivity: ProfileActivityEntry[];
  capabilities: ProfileCapabilities;
}

export interface EmployeeAttentionResponse {
  items: EmployeeAttentionItem[];
  total: number;
  tabIndicators: ProfileTabIndicator[];
}

// ── Access assignments ──────────────────────────────────────────────────────

export type AccessScopeType = 'organisation' | 'department' | 'site';
export type AccessAssignmentType = 'profile' | 'mandatory' | 'delegated';
export type AccessAssignmentStatus = 'active' | 'suspended' | 'revoked';

/**
 * One recorded scope on an access assignment.
 *
 * Scope is STORED, never inferred from a role label. `scopeId` is null only for
 * `organisation`, which means the whole organisation. `scopeLabel` is resolved
 * server-side so no raw id reaches the UI.
 */
export interface EmployeeAccessScope {
  scopeType: AccessScopeType;
  scopeId: string | null;
  scopeLabel: string;
}

export interface EmployeeAccessAssignment {
  id: string;
  accessProfileId: string;
  accessProfileCode: string;
  accessProfileLabel: string;
  requiresMfa: boolean;
  assignmentType: AccessAssignmentType;
  status: AccessAssignmentStatus;
  effectiveFrom: string;
  effectiveTo: string | null;
  grantedByName: string | null;
  grantedAt: string;
  revokedByName: string | null;
  revokedAt: string | null;
  scopes: EmployeeAccessScope[];
}

/** Severity ordering used for "highest severity wins" rollups. */
export const ATTENTION_SEVERITY_RANK: Record<AttentionSeverity, number> = {
  critical: 3, warning: 2, info: 1,
};

/** One entry in the Employment History timeline. */
export interface EmploymentHistoryEntry {
  id: string;
  /** Drives the timeline icon; never inferred from the title text. */
  kind: 'assignment' | 'status';
  title: string;
  detail: string;
  occurredAt: string;
  actorName: string | null;
}

/** The Employment tab's own dataset — deliberately not part of the shell. */
export interface EmploymentDetail {
  /** Null when the actor may not see payroll context — omitted, not blanked. */
  bank: ProfileBankContext | null;
  history: EmploymentHistoryEntry[];
}

// ── Document health ─────────────────────────────────────────────────────────
// Lives in the SHARED contract, not in the backend lib, because the Documents
// tab renders it directly: the approved health bar and tree list are not
// decorative, and the frontend cannot import from netlify/functions.

/**
 * Health state for one expected document.
 *
 * `missing` and `expired` are compliance failures; `expiring` is a warning;
 * `verified` and `current` are healthy; `unverified` is provided-but-unreviewed.
 */
export type DocumentHealthState =
  | 'verified' | 'current' | 'expiring' | 'expired' | 'unverified' | 'missing';

export interface DocumentHealthItem {
  /** Null when the requirement has no document at all. */
  documentId: string | null;
  /** Null for a held document that satisfies no active requirement. */
  requirementId: string | null;
  documentType: string;
  title: string;
  state: DocumentHealthState;
  expiryDate: string | null;
  /**
   * The date the held document became effective: its verification date when it
   * has one, otherwise when it was provided. Null for a requirement with no
   * document — an absent record has no issue date, and inventing one would put a
   * date against evidence that does not exist.
   */
  issuedAt: string | null;
  /** Supporting line under the title, e.g. "Expires 03 Jun 2025". */
  detail: string;
  /** True when this row exists because a requirement expects it. */
  required: boolean;
}

export interface DocumentHealthGroup {
  key: string;
  label: string;
  currentCount: number;
  expiringCount: number;
  missingCount: number;
  items: DocumentHealthItem[];
}

export interface DocumentHealthSummary {
  /** Documents actually held (non-archived, visible to this actor). */
  totalDocuments: number;
  /** Requirements that apply to this employee. */
  requiredCount: number;
  verifiedCount: number;
  expiringCount: number;
  missingCount: number;
  /** Percentages are of `requiredCount`, and are 0 when nothing is required. */
  verifiedPercent: number;
  expiringPercent: number;
  missingPercent: number;
  categoryCount: number;
  groups: DocumentHealthGroup[];
}

// ── Readiness: controls, work items, ownership ──────────────────────────────
// Mirrors docs/EMPLOYEE_READINESS_COLLABORATION_NOTE.md. A CONTROL is the rule,
// an INSTANCE is this employee's state against it, and a WORK ITEM is the
// collaboration record used to resolve a failure. They are deliberately three
// separate things — a blocker is not always a document upload.

/** Readiness area. Each has exactly one configured operational owner. */
export type ReadinessDomain =
  | 'assignment' | 'payroll' | 'training' | 'documents' | 'statutory' | 'access';

/**
 * What a control definition declares is needed to resolve it. The work-item
 * panel adapts its information and actions to this — the system must not treat
 * every blocker as a document-upload problem.
 */
export type ReadinessResolutionType =
  | 'field_correction' | 'document_evidence' | 'training_completion'
  | 'department_verification' | 'support_request' | 'external_system_confirmation';

/**
 * Canonical lifecycle. `exception_approved` and `not_applicable` are the only
 * exceptional terminal outcomes; rejected evidence returns to
 * `waiting_for_information` and is NOT terminal.
 */
export type ReadinessState =
  | 'open' | 'assigned' | 'waiting_for_information' | 'submitted_for_review'
  | 'in_review' | 'ready' | 'exception_approved' | 'not_applicable';

/** States in which a control counts as satisfied for coverage. */
export const READINESS_SATISFIED_STATES: readonly ReadinessState[] =
  ['ready', 'exception_approved', 'not_applicable'];

export type ReadinessDecision = 'approved' | 'returned' | 'rejected';

/** How an owner was configured. Configuration never grants authority by itself. */
export type ReadinessOwnerType = 'role' | 'user';

/**
 * Result of resolving a domain's configured owner.
 *
 * `owner_required` is the fail-closed outcome: the domain has no configured
 * owner, the configured owner no longer exists or is inactive, or no holder of
 * the configured role holds the capability the control needs. The UI surfaces
 * this as **Owner Required** for an administrator to configure — it never
 * silently falls back to HR or to the actor.
 */
export interface ReadinessOwnerResolution {
  domain: ReadinessDomain;
  status: 'resolved' | 'owner_required';
  ownerType: ReadinessOwnerType | null;
  /** Role key or user id. Never rendered directly — `ownerLabel` is. */
  ownerId: string | null;
  ownerLabel: string | null;
  /** Concrete user ids that should receive routing/notification for this domain. */
  recipientUserIds: string[];
  /** Populated only when `status` is `owner_required`; explains what is missing. */
  reason: string | null;
}

/** A control's rule definition, as configured (not per employee). */
export interface ReadinessControlDefinition {
  controlKey: string;
  label: string;
  domain: ReadinessDomain;
  resolutionType: ReadinessResolutionType;
  description: string | null;
  isBlocking: boolean;
}

/** Compact work-item shape carried inside a matrix row. */
export interface ReadinessWorkItemSummary {
  id: string;
  status: ReadinessState;
  severity: AttentionSeverity;
  dueDate: string | null;
  /** Whole days since the work item was opened — the "ageing" the row shows. */
  ageDays: number;
  ownerLabel: string | null;
  responsibleTeam: string | null;
  /** Who is expected to act NOW; may differ from the owner. */
  nextResponsibleParty: string | null;
}

/** One row of the control matrix: the rule, this employee's state, and its work. */
export interface ReadinessControlMatrixEntry {
  control: ReadinessControlDefinition;
  state: ReadinessState;
  percent: number;
  evaluatedAt: string | null;
  /** Resolved owner for the control's domain, including the fail-closed case. */
  owner: ReadinessOwnerResolution;
  /** The open work item blocking this control, when one exists. */
  workItem: ReadinessWorkItemSummary | null;
}

export interface ReadinessCoverage {
  percent: number;
  readyControls: number;
  totalControls: number;
  unresolvedWorkItems: number;
  blockedDomains: ReadinessDomain[];
}

/** The Readiness tab's whole dataset. */
export interface EmployeeReadinessMatrix {
  employeeId: string;
  coverage: ReadinessCoverage;
  controls: ReadinessControlMatrixEntry[];
  /** Actions the CURRENT actor may take. Presentation only — routes re-authorize. */
  capabilities: ReadinessCapabilities;
}

/** Presentation hints for readiness actions. Server-side authorization is authoritative. */
export interface ReadinessCapabilities {
  view: boolean;
  /** Coordination: remind, reassign, note. Does NOT confer specialist authority. */
  followUp: boolean;
  /** Approve/return submitted evidence. Elevated, and never granted to hr_staff. */
  review: boolean;
}

export interface ReadinessWorkItemTransitionEntry {
  id: string;
  fromStatus: ReadinessState | null;
  toStatus: ReadinessState;
  actorName: string | null;
  note: string | null;
  occurredAt: string;
}

/** Full work-item detail behind **Open Work Item**. */
export interface ReadinessWorkItemDetail {
  id: string;
  employeeId: string;
  employeeName: string;
  control: ReadinessControlDefinition;
  status: ReadinessState;
  severity: AttentionSeverity;
  dueDate: string | null;
  ageDays: number;
  owner: ReadinessOwnerResolution;
  ownerLabel: string | null;
  responsibleTeam: string | null;
  /** HR's coordinating contact for this employee, resolved to a name. */
  coordinatorLabel: string | null;
  reviewerName: string | null;
  decision: ReadinessDecision | null;
  decisionReason: string | null;
  /** Evidence/source references; shape depends on the control's resolution type. */
  evidenceRefs: unknown[];
  correlationId: string;
  workflowId: string | null;
  createdAt: string;
  resolvedAt: string | null;
  history: ReadinessWorkItemTransitionEntry[];
  /** The two or three valid next actions for THIS control and THIS actor. */
  availableActions: ReadinessWorkItemAction[];
}

/**
 * One offered outcome. `effect` is the explicit explanation of what the
 * submission will change, which the dialog is required to show.
 */
export interface ReadinessWorkItemAction {
  action: ReadinessActionKey;
  /** The primary button label for this outcome, e.g. "Approve And Complete". */
  label: string;
  effect: string;
  requiresReason: boolean;
  targetStatus: ReadinessState;
}

export type ReadinessActionKey =
  | 'send_reminder' | 'assign' | 'request_information'
  | 'submit_for_review' | 'approve' | 'return' | 'approve_exception' | 'mark_not_applicable';
