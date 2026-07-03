// types/hrOffboarding.ts — shared camelCase DTOs for the HR Offboarding module
// (the exit bookend of the lifecycle). Imported by BOTH the backend
// (netlify/functions/lib/hr/offboarding*.ts) and the frontend (src/api/hr/offboarding.ts).

export type OffboardingReason = 'resignation' | 'termination' | 'redundancy' | 'end_of_contract' | 'retirement';
export type OffboardingStatus = 'draft' | 'open' | 'in_progress' | 'blocked' | 'paused' | 'ready_for_exit' | 'completed' | 'cancelled';
export type OffboardingTaskStatus = 'pending' | 'in_progress' | 'completed' | 'skipped' | 'blocked';
export type OffboardingHandoffStatus = 'pending' | 'delivered' | 'cancelled';
export type OffboardingBlockerStatus = 'open' | 'resolved' | 'waived';

export interface OffboardingCaseRow {
  id: string;
  caseNo: string;
  employeeId: string | null;
  employeeName: string | null;
  reason: OffboardingReason;
  packageKey: string;
  status: OffboardingStatus;
  ownerId: string | null;
  ownerName: string | null;
  lastWorkingDay: string | null;
  exitDate: string | null;
  noticePeriodDays: number | null;
  startedAt: string;
  readyAt: string | null;
  completedAt: string | null;
  taskCount: number;
  openTaskCount: number;
  blockerCount: number;
}

export interface OffboardingTaskRow {
  id: string;
  caseId: string;
  taskKey: string;
  taskTitle: string;
  ownerRole: string | null;
  assignedTo: string | null;
  assignedToName: string | null;
  moduleKey: string | null;
  status: OffboardingTaskStatus;
  isBlocking: boolean;
  sortOrder: number;
  dueAt: string | null;
  completedAt: string | null;
}

export interface OffboardingHandoffRow {
  id: string;
  caseId: string;
  handoffKey: string | null;
  targetModule: string;
  handoffType: string | null;
  status: OffboardingHandoffStatus;
  createdAt: string;
}

export interface OffboardingBlockerRow {
  id: string;
  caseId: string;
  title: string;
  blockingModule: string | null;
  severity: 'low' | 'medium' | 'high' | 'critical';
  status: OffboardingBlockerStatus;
  ownerId: string | null;
  dueAt: string | null;
}

export interface OffboardingCaseDetail {
  case: OffboardingCaseRow;
  tasks: OffboardingTaskRow[];
  handoffs: OffboardingHandoffRow[];
  blockers: OffboardingBlockerRow[];
}

export interface OffboardingStatusSlice { status: OffboardingStatus; count: number }
export interface OffboardingModuleClearance { module: string; pending: number; delivered: number; total: number }

export interface OffboardingDashboardStats {
  activeCases: number;
  readyForExit: number;
  blocked: number;
  completedThisMonth: number;
  totalCases: number;
  byReason: Array<{ reason: OffboardingReason; count: number }>;
  byStatus: OffboardingStatusSlice[];
  /** Exit-task completion across all non-terminal cases (real clearance ratio). */
  taskClearance: { done: number; total: number };
  /** Open blocking tasks on non-terminal cases (activation risk). */
  blockingTasksOpen: number;
  openBlockers: number;
  criticalBlockers: number;
  handoffs: { pending: number; delivered: number; cancelled: number; total: number };
  /** Cross-module clearance progress (IT / Finance / HSE …). */
  handoffsByModule: OffboardingModuleClearance[];
  /** Pending IT access-removal handoffs — the signature exit control. */
  pendingAccessRemovals: number;
  /** Mean days from case start to ready/complete, or null when none have reached it. */
  avgClearanceDays: number | null;
}

// ── Mutation payloads ──────────────────────────────────────────────────────────
export interface StartOffboardingArgs {
  employeeId: string;
  reason: OffboardingReason;
  ownerId?: string | null;
  lastWorkingDay?: string | null;
  noticePeriodDays?: number | null;
  packageKey?: string | null;
}
export interface StartOffboardingResult { caseId: string; caseNo: string; taskCount: number; handoffCount: number }

export interface CompleteOffboardingTaskArgs { taskId: string }
export interface CaseIdArg { caseId: string }
export interface PauseCaseArgs { caseId: string; reason?: string | null }
export interface CancelCaseArgs { caseId: string; reason?: string | null }
export interface ReassignOwnerArgs { caseId: string; ownerId: string | null }
export interface FinalizeOffboardingArgs { caseId: string; exitDate?: string | null }
export interface FinalizeOffboardingResult { caseId: string; status: OffboardingStatus; employeeStatus: string; itHandoffId: string }
