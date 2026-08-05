/**
 * lib/hr/employmentDetail.ts — the Employment tab's own dataset: masked bank
 * context and effective-dated employment history.
 *
 * TAB-SCOPED on purpose. Neither block belongs in the profile shell: the bank
 * block is capability-gated and the history is unbounded, so pulling either to
 * open the drawer would be exactly the load the shell contract exists to avoid.
 *
 * BANKING BOUNDARY — read this before adding anything here:
 * HR sees masked CONTEXT and workflow state only. This module reads the
 * canonical Finance API (`listBankAccounts`, which projects through SAFE_SELECT
 * and never returns `account_number`), and it exposes no banking action. Moving
 * a protected banking action into HR is explicitly out of bounds; Payroll
 * accepts or returns account details in its own authorised workspace.
 */

import { sb } from '../db';
import { listBankAccounts, type BankAccountDto } from '../finance/bankAccounts';
import { firstNonBlank } from './employeeCore';
import type {
  ProfileBankContext, EmploymentHistoryEntry, EmploymentDetail,
} from '../../../../types/hrEmployeeProfile';

/**
 * The employment CONDITIONS carried on an assignment period.
 *
 * These describe the terms of employment, not the posting. A transfer or a
 * supervisor change opens a new assignment period but does NOT renegotiate
 * contracted hours, FTE or notice — so every writer that opens a period must
 * carry them forward. Before this helper existed each writer omitted them, which
 * silently erased an employee's contracted working time on every transfer.
 */
export interface AssignmentConditions {
  weekly_hours: number | null;
  fte: number | null;
  notice_period_days: number | null;
}

/**
 * Read the conditions on the employee's CURRENT assignment period.
 *
 * Returns all-null when there is no current period, which is the correct
 * starting point for a first assignment — never a fabricated default.
 */
export async function currentAssignmentConditions(employeeId: string): Promise<AssignmentConditions> {
  const { data, error } = await sb.from('hr_employee_assignments')
    .select('weekly_hours, fte, notice_period_days')
    .eq('employee_id', employeeId).eq('is_current', true)
    .order('effective_from', { ascending: false }).limit(1)
    .maybeSingle<AssignmentConditions>();
  if (error) throw new Error(`Assignment conditions read failed: ${error.message}`);
  return {
    weekly_hours: data?.weekly_hours ?? null,
    fte: data?.fte ?? null,
    notice_period_days: data?.notice_period_days ?? null,
  };
}

// The timeline and detail contracts live in types/hrEmployeeProfile.ts — the ONE
// authoritative profile contract — because the Employment tab renders them and
// the frontend cannot import from netlify/functions.
export type { EmploymentHistoryEntry, EmploymentDetail } from '../../../../types/hrEmployeeProfile';

interface AssignmentRow {
  id: string;
  position_id: string | null;
  department_id: string | null;
  site_id: string | null;
  supervisor_id: string | null;
  assignment_type: string;
  effective_from: string;
  effective_to: string | null;
  is_current: boolean;
  created_by: string | null;
}

interface StatusRow {
  id: string;
  previous_status: string | null;
  new_status: string;
  reason: string | null;
  effective_date: string | null;
  changed_by: string | null;
  changed_at: string;
}

const TITLE_CASE_EXCEPTIONS = new Set(['of', 'to', 'the', 'and', 'a', 'an', 'in', 'on', 'for']);

/** "pending_onboarding" → "Pending Onboarding". Register/profile Title-Case rule. */
function humanizeStatus(value: string): string {
  return value.split(/[_\s]+/).filter(Boolean)
    .map((word, i) => (i > 0 && TITLE_CASE_EXCEPTIONS.has(word.toLowerCase())
      ? word.toLowerCase()
      : word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()))
    .join(' ');
}

/**
 * Resolve the payroll control's view of bank verification.
 *
 * The state is READ from the readiness control instance rather than guessed from
 * the account row: "verified" is a decision Payroll makes, not something HR can
 * infer from the presence of an account number.
 */
async function bankVerificationState(
  employeeId: string, hasPrimary: boolean,
): Promise<{ state: ProfileBankContext['verificationState']; lastVerifiedAt: string | null }> {
  const { data, error } = await sb.from('hr_readiness_control_instances')
    .select('state, evaluated_at, hr_readiness_controls!inner(control_key)')
    .eq('employee_id', employeeId)
    .eq('hr_readiness_controls.control_key', 'payroll.statutory_ready')
    .maybeSingle<{ state: string; evaluated_at: string }>();
  if (error) throw new Error(`Bank verification state read failed: ${error.message}`);

  if (!hasPrimary) return { state: 'missing', lastVerifiedAt: null };
  // An early return rather than optional chaining: the employee may simply have
  // no instance row for this control yet, and that is "reverify", not "verified".
  if (data === null) return { state: 'reverify', lastVerifiedAt: null };

  const satisfied = data.state === 'ready' || data.state === 'exception_approved';
  return {
    state: satisfied ? 'verified' : 'reverify',
    // Only a satisfied control carries a meaningful verification date.
    lastVerifiedAt: satisfied ? data.evaluated_at : null,
  };
}

/**
 * Masked bank context for the Employment tab.
 *
 * `canViewPayrollContext` is resolved by the route from the actor's capability;
 * a caller without it gets null and the card renders its denied state.
 */
export async function getBankContext(
  employeeId: string, canViewPayrollContext: boolean,
): Promise<ProfileBankContext | null> {
  if (!canViewPayrollContext) return null;

  const accounts = await listBankAccounts({ employeeId });
  // Explicitly nullable: this tsconfig types an array index as non-nullish, so
  // without the annotation the empty-account case reads as "always present".
  const primary: BankAccountDto | null =
    accounts.find(a => a.isPrimary) ?? (accounts.length > 0 ? accounts[0] : null);
  const verification = await bankVerificationState(employeeId, primary !== null);

  return {
    bankName: primary === null ? null : primary.bankName,
    accountNumberMasked: primary === null ? null : primary.accountNumberMasked,
    accountType: primary === null ? null : primary.accountType,
    hasPrimaryAccount: primary !== null,
    lastVerifiedAt: verification.lastVerifiedAt,
    verificationState: verification.state,
  };
}

/**
 * Effective-dated employment history, merged from the assignment periods and the
 * status lifecycle — the two canonical records of "what changed and when".
 */
export async function getEmploymentHistory(employeeId: string): Promise<EmploymentHistoryEntry[]> {
  const [assignRes, statusRes] = await Promise.all([
    sb.from('hr_employee_assignments')
      .select('id, position_id, department_id, site_id, supervisor_id, assignment_type, effective_from, effective_to, is_current, created_by')
      .eq('employee_id', employeeId).order('effective_from', { ascending: false }),
    sb.from('hr_employee_status_history')
      .select('id, previous_status, new_status, reason, effective_date, changed_by, changed_at')
      .eq('employee_id', employeeId).order('changed_at', { ascending: false }),
  ]);
  if (assignRes.error) throw new Error(`Employment history assignment read failed: ${assignRes.error.message}`);
  if (statusRes.error) throw new Error(`Employment history status read failed: ${statusRes.error.message}`);

  const assignments = assignRes.data as AssignmentRow[];
  const statuses = statusRes.data as StatusRow[];

  // Resolve every referenced id to a label in ONE pass, so the timeline shows
  // names and never a raw uuid.
  const positionIds  = [...new Set(assignments.map(a => a.position_id).filter((x): x is string => !!x))];
  const departmentIds = [...new Set(assignments.map(a => a.department_id).filter((x): x is string => !!x))];
  const actorIds = [...new Set([
    ...assignments.flatMap(a => [a.created_by, a.supervisor_id]),
    ...statuses.map(s => s.changed_by),
  ].filter((x): x is string => !!x))];

  const [posRes, deptRes, actorRes] = await Promise.all([
    positionIds.length
      ? sb.from('hr_positions').select('id, title').in('id', positionIds)
      : Promise.resolve({ data: [] as { id: string; title: string }[], error: null }),
    departmentIds.length
      ? sb.from('departments').select('id, name').in('id', departmentIds)
      : Promise.resolve({ data: [] as { id: string; name: string }[], error: null }),
    actorIds.length
      ? sb.from('app_users').select('id, display_name, full_name, username').in('id', actorIds)
      : Promise.resolve({ data: [] as Record<string, string | null>[], error: null }),
  ]);
  if (posRes.error) throw new Error(`Employment history position read failed: ${posRes.error.message}`);
  if (deptRes.error) throw new Error(`Employment history department read failed: ${deptRes.error.message}`);
  if (actorRes.error) throw new Error(`Employment history actor read failed: ${actorRes.error.message}`);

  const positions = new Map((posRes.data as { id: string; title: string }[]).map(p => [p.id, p.title]));
  const departments = new Map((deptRes.data as { id: string; name: string }[]).map(d => [d.id, d.name]));
  const actors = new Map(
    (actorRes.data as { id: string; display_name: string | null; full_name: string | null; username: string | null }[])
      .map(u => [u.id, firstNonBlank(u.display_name, u.full_name, u.username) ?? u.id]),
  );

  const entries: EmploymentHistoryEntry[] = [];

  for (const a of assignments) {
    const position = a.position_id ? positions.get(a.position_id) : null;
    const department = a.department_id ? departments.get(a.department_id) : null;
    const supervisor = a.supervisor_id ? actors.get(a.supervisor_id) : null;
    const parts = [department, supervisor ? `Reports to ${supervisor}` : null].filter(Boolean);
    entries.push({
      id: `assignment:${a.id}`,
      kind: 'assignment',
      title: position ? `Assigned as ${position}` : 'Assignment Updated',
      detail: parts.length ? parts.join(' · ') : humanizeStatus(a.assignment_type) + ' Assignment',
      occurredAt: a.effective_from,
      actorName: a.created_by ? (actors.get(a.created_by) ?? null) : null,
    });
  }

  for (const s of statuses) {
    entries.push({
      id: `status:${s.id}`,
      kind: 'status',
      title: s.previous_status
        ? `Status Changed To ${humanizeStatus(s.new_status)}`
        : `Employment ${humanizeStatus(s.new_status)}`,
      detail: s.reason ?? (s.previous_status ? `From ${humanizeStatus(s.previous_status)}` : 'Initial status'),
      occurredAt: s.effective_date ?? s.changed_at,
      actorName: s.changed_by ? (actors.get(s.changed_by) ?? null) : null,
    });
  }

  return entries.sort((a, b) => (a.occurredAt < b.occurredAt ? 1 : a.occurredAt > b.occurredAt ? -1 : 0));
}

export async function getEmploymentDetail(
  employeeId: string, canViewPayrollContext: boolean,
): Promise<EmploymentDetail> {
  const [bank, history] = await Promise.all([
    getBankContext(employeeId, canViewPayrollContext),
    getEmploymentHistory(employeeId),
  ]);
  return { bank, history };
}

// ── Assignment command ──────────────────────────────────────────────────────

export interface ApplyAssignmentInput {
  actorId: string;
  employeeId: string;
  positionId?: string | null;
  departmentId?: string | null;
  siteId?: string | null;
  supervisorId?: string | null;
  effectiveFrom?: string | null;
  /**
   * Only the keys PRESENT are applied; anything omitted is carried forward from
   * the outgoing period. A key present with `null` deliberately CLEARS the value,
   * which is why this is a partial object rather than three nullable params.
   */
  conditions?: {
    weeklyHours?: number | null;
    fte?: number | null;
    noticePeriodDays?: number | null;
  };
  reason?: string | null;
  correlationId: string;
}

export interface ApplyAssignmentResult {
  assignmentId: string;
  employeeId: string;
  /** True when this opened the employee's FIRST effective period. */
  isFirstAssignment: boolean;
  supersededAssignmentId: string | null;
  effectiveFrom: string;
  weeklyHours: number | null;
  fte: number | null;
  noticePeriodDays: number | null;
  correlationId: string;
}

/**
 * Open a new effective-dated assignment period, creating the FIRST one when the
 * employee has none.
 *
 * Closing the outgoing period and opening the incoming one are two writes that
 * must commit together: a failure between them would leave the employee with no
 * current assignment at all. They therefore run inside
 * `hr_employee_assignment_apply_tx`, together with the event and both audit
 * trails, under one correlation id.
 */
export async function applyEmployeeAssignment(input: ApplyAssignmentInput): Promise<ApplyAssignmentResult> {
  const result = await sb.rpc('hr_employee_assignment_apply_tx', {
    p_actor_id:       input.actorId,
    p_employee_id:    input.employeeId,
    p_position_id:    input.positionId ?? null,
    p_department_id:  input.departmentId ?? null,
    p_site_id:        input.siteId ?? null,
    p_supervisor_id:  input.supervisorId ?? null,
    p_effective_from: input.effectiveFrom ?? null,
    p_conditions:     input.conditions ?? {},
    p_reason:         input.reason ?? null,
    p_correlation_id: input.correlationId,
  }) as unknown as { data: unknown; error: { message: string; code?: string } | null };

  if (result.error) {
    const status = result.error.code === '22023' ? 422 : result.error.code === 'P0002' ? 404 : 500;
    throw Object.assign(new Error(`Assignment update failed: ${result.error.message}`), { status });
  }
  return result.data as ApplyAssignmentResult;
}

export interface CorrectProbationInput {
  actorId: string;
  employeeId: string;
  /** null CLEARS the date. The caller states this explicitly; it is never inferred. */
  probationEndDate: string | null;
  reason: string;
  correlationId: string;
}

export interface CorrectProbationResult {
  employeeId: string;
  previousProbationEndDate: string | null;
  probationEndDate: string | null;
  changed: boolean;
  eventId: string;
}

/**
 * Correct an employee's probation end date — the ONLY sanctioned way to change the field
 * after an onboarding launch has set it.
 *
 * `probation_end_date` is written as a side effect of a launch, so a case cleanup needs an
 * authoritative prior value to restore. The launch now records that pre-image
 * (`hr_audit_log.previous_state`), and this command is how a human applies a correction:
 * locked read + write + event + both audit trails in ONE transaction, with a mandatory
 * reason. Cleanup scripts must call this rather than write `app_users` directly — a direct
 * write has no actor, no reason and no trail, which is the failure this replaces.
 */
export async function correctEmployeeProbation(input: CorrectProbationInput): Promise<CorrectProbationResult> {
  const result = await sb.rpc('hr_employee_probation_correct_tx', {
    p_actor_id:            input.actorId,
    p_employee_id:         input.employeeId,
    p_probation_end_date:  input.probationEndDate,
    p_reason:              input.reason,
    p_correlation_id:      input.correlationId,
  }) as unknown as { data: unknown; error: { message: string; code?: string } | null };

  if (result.error) {
    const status = result.error.code === '22023' ? 422 : result.error.code === '23503' ? 404 : 500;
    throw Object.assign(new Error(`Probation correction failed: ${result.error.message}`), { status });
  }
  return result.data as CorrectProbationResult;
}
