// types/hrOrganization.ts — shared camelCase DTOs for the HR Organization
// Structure module (Phase A). Imported by BOTH the backend (netlify/functions/
// lib/hr/organization*.ts) and the frontend (src/api/hr/organization.ts) — one
// contract, no per-endpoint mappers.

export type OrgUnitType =
  | 'company'
  | 'division'
  | 'department'
  | 'team'
  | 'crew'
  | 'site_department';

export interface OrgUnit {
  id: string;
  name: string;
  code: string | null;
  description: string | null;
  parentId: string | null;
  orgUnitType: OrgUnitType;
  siteId: string | null;
  siteName: string | null;
  managerId: string | null;
  managerName: string | null;
  costCenterId: string | null;
  costCenterName: string | null;
  isActive: boolean;
  sortOrder: number;
  employeeCount: number;
  positionCount: number;
  childCount: number;
  updatedAt: string | null;
}

export interface OrgUnitDetail extends OrgUnit {
  positions: Array<{ id: string; title: string; incumbentCount: number }>;
  employees: Array<{ id: string; fullName: string; positionTitle: string | null }>;
  children: Array<Pick<OrgUnit, 'id' | 'name' | 'orgUnitType' | 'isActive'>>;
}

export interface Position {
  id: string;
  positionKey: string;
  title: string;
  grade: string | null;
  departmentId: string | null;
  departmentName: string | null;
  siteId: string | null;
  siteName: string | null;
  defaultSupervisorId: string | null;
  defaultSupervisorName: string | null;
  reportsToPositionId: string | null;
  reportsToPositionTitle: string | null;
  isSafetyCritical: boolean;
  isActive: boolean;
  headcountBudget: number | null;
  incumbentCount: number;
  vacancy: number | null;
  updatedAt: string | null;
}

export interface PositionDetail extends Position {
  incumbents: Array<{ id: string; fullName: string }>;
}

export interface CostCenter {
  id: string;
  code: string | null;
  name: string;
  currency: string;
  annualBudget: number | null;
  isActive: boolean;
  managerId: string | null;
  managerName: string | null;
  departmentId: string | null;
  assignedUnitCount: number;
  updatedAt: string | null;
}

export interface OrgStats {
  unitCount: number;
  activeUnitCount: number;
  positionCount: number;
  activePositionCount: number;
  filledHeadcount: number;
  budgetedHeadcount: number;
  costCenterCount: number;
  employeesWithoutUnit: number;
  employeesWithoutSupervisor: number;
  employeesWithoutPosition: number;
  departmentsWithoutManager: number;
  departmentsWithoutCostCenter: number;
  positionsOverBudget: number;
  vacantSafetyCriticalPositions: number;
}

export type OrgHealthSeverity = 'info' | 'warning' | 'critical';

export type OrgHealthIssueType =
  | 'employee_without_department'
  | 'employee_without_supervisor'
  | 'employee_without_position'
  | 'department_without_manager'
  | 'department_without_cost_center'
  | 'position_without_department'
  | 'position_over_budget'
  | 'inactive_unit_with_active_employees'
  | 'inactive_cost_center_assigned'
  | 'vacant_safety_critical_position';

export interface OrgHealthIssue {
  id: string;
  severity: OrgHealthSeverity;
  issueType: OrgHealthIssueType;
  title: string;
  description: string;
  entityType: 'org_unit' | 'position' | 'cost_center' | 'employee';
  entityId: string | null;
  count: number;
}

export interface OrgHealthSummary {
  criticalCount: number;
  warningCount: number;
  infoCount: number;
  issues: OrgHealthIssue[];
}

export interface OrgChangeImpactSummary {
  affectedEmployees: number;
  affectedPositions: number;
  affectedChildUnits: number;
  affectedOnboardingCases: number;
  affectedOffboardingCases: number;
  affectedPendingTransfers: number;
  affectedFinanceReferences: number;
  warnings: string[];
  blockers: string[];
}

// ── Mutation payloads ──────────────────────────────────────────────────────────

export interface CreateOrgUnitArgs {
  name: string;
  code?: string | null;
  orgUnitType?: OrgUnitType;
  parentId?: string | null;
  siteId?: string | null;
  managerId?: string | null;
  costCenterId?: string | null;
  description?: string | null;
  sortOrder?: number;
}

export interface UpdateOrgUnitArgs {
  unitId: string;
  expectedUpdatedAt?: string | null;
  name?: string;
  code?: string | null;
  orgUnitType?: OrgUnitType;
  siteId?: string | null;
  managerId?: string | null;
  costCenterId?: string | null;
  description?: string | null;
  isActive?: boolean;
  sortOrder?: number;
  reason?: string | null;
  effectiveFrom?: string | null;
  /** Per-attempt idempotency key — required when the change routes to approval. */
  idempotencyKey?: string;
}

export interface MoveOrgUnitArgs {
  unitId: string;
  newParentId: string | null;
  expectedUpdatedAt?: string | null;
  reason?: string | null;
  effectiveFrom?: string | null;
  /** Per-attempt idempotency key — required when the change routes to approval. */
  idempotencyKey?: string;
}

export interface ArchiveOrgUnitArgs { unitId: string; reason?: string | null; effectiveFrom?: string | null; idempotencyKey?: string; }
export interface DeleteOrgUnitArgs { unitId: string; reason?: string | null; effectiveFrom?: string | null; idempotencyKey?: string; }

export interface CreatePositionArgs {
  positionKey: string;
  title: string;
  grade?: string | null;
  departmentId?: string | null;
  siteId?: string | null;
  defaultSupervisorId?: string | null;
  reportsToPositionId?: string | null;
  isSafetyCritical?: boolean;
  headcountBudget?: number | null;
}

export interface UpdatePositionArgs {
  positionId: string;
  expectedUpdatedAt?: string | null;
  title?: string;
  grade?: string | null;
  departmentId?: string | null;
  siteId?: string | null;
  defaultSupervisorId?: string | null;
  reportsToPositionId?: string | null;
  isSafetyCritical?: boolean;
  headcountBudget?: number | null;
  isActive?: boolean;
  reason?: string | null;
  effectiveFrom?: string | null;
  /** Per-attempt idempotency key — required when the change routes to approval. */
  idempotencyKey?: string;
}

export interface RetirePositionArgs { positionId: string; reason?: string | null; effectiveFrom?: string | null; idempotencyKey?: string; }

export interface CreateCostCenterArgs {
  code?: string | null;
  name: string;
  currency?: string;
  annualBudget?: number | null;
  departmentId?: string | null;
  managerId?: string | null;
}

export interface UpdateCostCenterArgs {
  costCenterId: string;
  expectedUpdatedAt?: string | null;
  code?: string | null;
  name?: string;
  currency?: string;
  annualBudget?: number | null;
  departmentId?: string | null;
  managerId?: string | null;
  isActive?: boolean;
  reason?: string | null;
  effectiveFrom?: string | null;
  /** Per-attempt idempotency key — required when the change routes to approval. */
  idempotencyKey?: string;
}

export interface RetireCostCenterArgs { costCenterId: string; reason?: string | null; effectiveFrom?: string | null; idempotencyKey?: string; }

export type OrgEntityType = 'org_unit' | 'position' | 'cost_center';
export type OrgChangeAction = 'move' | 'archive' | 'delete' | 'retire' | 'update';

export interface PreviewOrgChangeArgs {
  entityType: OrgEntityType;
  entityId: string;
  action: OrgChangeAction;
  newParentId?: string | null;
}

// Also allow reason/effectiveFrom on org-unit + position edits (they can be gated).
export interface UpdateOrgUnitPhaseB { reason?: string | null; effectiveFrom?: string | null; idempotencyKey?: string; }

// ── Phase B — change-request envelope + gated mutation results ────────────────────

export type OrgChangeStatus =
  | 'draft' | 'pending_approval' | 'approved' | 'rejected' | 'scheduled' | 'applied' | 'cancelled' | 'failed';
export type OrgChangeRiskLevel = 'low' | 'medium' | 'high' | 'critical';

export interface OrgChangeRequest {
  id: string;
  changeNo: string | null;
  entityType: OrgEntityType;
  entityId: string | null;
  entityName: string | null;
  action: string;
  riskLevel: OrgChangeRiskLevel;
  status: OrgChangeStatus;
  effectiveFrom: string;
  effectiveTo: string | null;
  reason: string | null;
  rejectionReason: string | null;
  oldState: Record<string, unknown>;
  newState: Record<string, unknown>;
  impactSummary: Partial<OrgChangeImpactSummary>;
  workflowId: string | null;
  requestedBy: string | null;
  requestedByName: string | null;
  decidedBy: string | null;
  decidedByName: string | null;
  appliedBy: string | null;
  appliedByName: string | null;
  requestedAt: string;
  decidedAt: string | null;
  appliedAt: string | null;
}

/** Result of a gated mutation: applied immediately, or held for approval. */
export type OrgMutationResult =
  | { mode: 'applied'; entityType: OrgEntityType; entityId: string }
  | {
      mode: 'pendingApproval';
      changeRequestId: string;
      changeNo: string | null;
      workflowId: string | null;
      riskLevel: OrgChangeRiskLevel;
      impactSummary: OrgChangeImpactSummary;
    };

export interface OrgChangeListArgs { status?: OrgChangeStatus | 'all'; entityType?: OrgEntityType; limit?: number; }
export interface CancelOrgChangeArgs { changeRequestId: string; reason?: string | null; }
export interface OverrideApplyOrgChangeArgs { changeRequestId: string; reason?: string | null; }
