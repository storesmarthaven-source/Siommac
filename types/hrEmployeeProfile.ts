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
  workArrangement: string | null;
  startDate: string | null;
  /** Whole months of continuous service, computed server-side from `startDate`. */
  tenureMonths: number | null;
  supervisorName: string | null;
  payGroupName: string | null;
}

export interface ProfileReadinessSummary {
  percent: number;
  readyControls: number;
  totalControls: number;
  unresolvedWorkItems: number;
  payrollStatus: 'pending' | 'ready' | 'blocked';
  trainingStatus: 'current' | 'due_soon' | 'expired' | 'none';
  blockers: ('assignment' | 'payroll' | 'training')[];
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

/** Severity ordering used for "highest severity wins" rollups. */
export const ATTENTION_SEVERITY_RANK: Record<AttentionSeverity, number> = {
  critical: 3, warning: 2, info: 1,
};
