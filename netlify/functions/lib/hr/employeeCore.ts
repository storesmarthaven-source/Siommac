// lib/hr/employeeCore.ts — shared HR Employee Master core
//
// Single source of truth for employee provisioning + statutory/payroll-readiness
// helpers, reused by routes/hr.ts (employees/create, statutory, get) AND
// routes/hrEmployeeImport.ts (import/commit). Keeping ONE provisionEmployee()
// avoids the duplicated create chain (app_users + Supabase Auth + satellites).

import { sb } from '../db';

export const todayISO = (): string => new Date().toISOString().slice(0, 10);

// app_users.employment_type CHECK set (default 'employee'). Validated at the API
// boundary so a bad value is a clean 400, not a raw DB 500.
export const EMPLOYMENT_TYPES = ['employee', 'contractor', 'intern', 'temporary', 'consultant', 'seconded'] as const;
export const NIS_STATUSES     = ['pending', 'registered', 'exempt', 'not_applicable'] as const;

/**
 * Build the DB row object for an hr_audit_log INSERT without executing it.
 * Pass the result as `p_audit` to an RPC that embeds the INSERT inside its
 * own transaction so the audit row is committed atomically with the business row.
 */
export function buildHrAuditRow(a: {
  employeeId?: string | null; submoduleKey: string; recordId?: string | null;
  actorId?: string | null; action: string; previousState?: unknown; newState?: unknown; reason?: string | null;
}): Record<string, unknown> {
  return {
    employee_id:    a.employeeId ?? null,
    submodule_key:  a.submoduleKey,
    record_id:      a.recordId ?? null,
    actor_id:       a.actorId ?? null,
    action:         a.action,
    previous_state: a.previousState ?? null,
    new_state:      a.newState ?? null,
    reason:         a.reason ?? null,
  };
}

/** Fire-and-forget HR audit (async helper so the supabase builder actually executes). */
export async function writeHrAudit(a: {
  employeeId?: string | null; submoduleKey: string; recordId?: string | null;
  actorId?: string | null; action: string; previousState?: unknown; newState?: unknown; reason?: string | null;
}): Promise<void> {
  // The audit trail is a mandatory §2 side-effect — a failed write must fail the
  // mutation, not be swallowed. (PostgREST returns { error } rather than throwing,
  // so the old try/catch ignored DB errors entirely.)
  const { error } = await sb.from('hr_audit_log').insert({
    employee_id: a.employeeId ?? null, submodule_key: a.submoduleKey, record_id: a.recordId ?? null,
    actor_id: a.actorId ?? null, action: a.action,
    previous_state: a.previousState ?? null, new_state: a.newState ?? null, reason: a.reason ?? null,
  });
  if (error) {
    console.error('[hr] audit failed:', error);
    throw Object.assign(new Error(`HR audit write failed (${a.action}): ${error.message}`), { status: 500 });
  }
}

/** Next EMP-#### reference (shared sequence for HR-created and import-created staff). */
export async function nextEmployeeNumber(): Promise<string> {
  // Fetch all EMP-* numbers and filter in-code to pure-numeric suffixes only.
  // EMP-FIN01 / EMP-HR02 etc. (non-numeric) must be excluded so they don't win
  // the descending sort and push the fallback to 'EMP-0001' (already taken).
  const { data } = await sb.from('app_users')
    .select('employee_number').like('employee_number', 'EMP-%');
  const numeric = (data ?? [])
    .map(r => (r as { employee_number?: string }).employee_number ?? '')
    .filter(n => /^EMP-\d+$/.test(n))
    .map(n => parseInt(n.replace('EMP-', ''), 10))
    .filter(Number.isFinite);
  if (numeric.length > 0) {
    const max = Math.max(...numeric);
    return `EMP-${String(max + 1).padStart(4, '0')}`;
  }
  return 'EMP-0001';
}

// ── Statutory & payroll readiness (v36 §7.2) ────────────────────────────────────
// HR owns the readiness snapshot; Finance/Payroll owns deduction calc + remittance.
// Readiness is computed from the captured statutory fields — never hand-set.

export interface StatutoryRow {
  nis_status: string; nis_number: string | null;
  paye_applicable: boolean; bir_file_number: string | null; td1_received: boolean;
  hs_applicable: boolean; hs_verification_required: boolean;
  [k: string]: unknown;
}

/** Derive payroll readiness from the statutory fields. Blocked until required fields are complete. */
export function computePayrollReadiness(s: StatutoryRow): { status: 'ready' | 'blocked'; blockers: string[]; financeEligible: boolean } {
  const blockers: string[] = [];
  if (s.nis_status === 'pending') blockers.push('NIS registration pending');
  if (s.nis_status === 'registered' && !s.nis_number) blockers.push('NIS number missing');
  if (s.paye_applicable) {
    if (!s.bir_file_number) blockers.push('BIR file number missing');
    if (!s.td1_received)    blockers.push('TD1 not received');
  }
  if (s.hs_applicable && s.hs_verification_required) blockers.push('Health surcharge verification pending');
  const status = blockers.length ? 'blocked' : 'ready';
  return { status, blockers, financeEligible: status === 'ready' };
}

/** camelCase statutory input → snake_case column patch (only provided keys). */
export function statutoryPatch(s: Record<string, unknown>): Record<string, unknown> {
  const p: Record<string, unknown> = {};
  if (s['nisNumber']              !== undefined) p['nis_number']               = s['nisNumber'];
  if (s['nisStatus']              !== undefined) p['nis_status']               = s['nisStatus'];
  if (s['nisEffectiveDate']       !== undefined) p['nis_effective_date']       = s['nisEffectiveDate'];
  if (s['birFileNumber']          !== undefined) p['bir_file_number']          = s['birFileNumber'];
  if (s['payeApplicable']         !== undefined) p['paye_applicable']          = s['payeApplicable'];
  if (s['td1Received']            !== undefined) p['td1_received']             = s['td1Received'];
  if (s['td1EffectiveYear']       !== undefined) p['td1_effective_year']       = s['td1EffectiveYear'];
  if (s['hsApplicable']           !== undefined) p['hs_applicable']            = s['hsApplicable'];
  if (s['hsExemptionReason']      !== undefined) p['hs_exemption_reason']      = s['hsExemptionReason'];
  if (s['hsEffectiveDate']        !== undefined) p['hs_effective_date']        = s['hsEffectiveDate'];
  if (s['hsVerificationRequired'] !== undefined) p['hs_verification_required'] = s['hsVerificationRequired'];
  return p;
}

/** Merge a patch over statutory defaults to a full row for readiness computation. */
export function statutoryWithDefaults(p: Record<string, unknown>): StatutoryRow {
  return {
    nis_status:               (p['nis_status']               as string)        ?? 'pending',
    nis_number:               (p['nis_number']               as string | null) ?? null,
    paye_applicable:          (p['paye_applicable']          as boolean)       ?? true,
    bir_file_number:          (p['bir_file_number']          as string | null) ?? null,
    td1_received:             (p['td1_received']             as boolean)       ?? false,
    hs_applicable:            (p['hs_applicable']            as boolean)       ?? true,
    hs_verification_required: (p['hs_verification_required'] as boolean)       ?? false,
  };
}

// ── Provisioning ────────────────────────────────────────────────────────────────

export interface ProvisionEmployeeInput {
  identity: {
    username: string; password?: string; fullName: string;
    firstName?: string; lastName?: string; email?: string; personalEmail?: string;
    phone?: string; employeeNumber?: string; dateOfBirth?: string; nationality?: string;
    preferredName?: string; governmentId?: string;
  };
  employment?: { employmentType?: string; contractorFlag?: boolean; startDate?: string; position?: string; positionTitle?: string; probationEndDate?: string; employeeGrade?: string; workSchedule?: string };
  assignment?: { departmentId?: string | null; siteId?: string | null; positionId?: string | null; supervisorId?: string | null; costCenter?: string | null; effectiveDate?: string };
  access?:     { role?: string; permissionProfile?: string; selfServiceProfile?: string; requireMfa?: boolean; onboardingRequirements?: Record<string, boolean> };
  statutory?:  Record<string, unknown>;
  /** Create a Supabase Auth login (default true). False (e.g. an import with
   *  "create login accounts" off) provisions the app_user with no login yet. */
  createLogin?: boolean;
  /** Initial app_users.status (default 'active'). An import with a "Draft"
   *  default-record-status provisions 'draft' so the row is reviewed before it
   *  can authenticate (auth requires status='active'). */
  recordStatus?: string;
}

/**
 * Provision one employee: app_users (no password — credentials live in Supabase
 * Auth) → Supabase Auth account → auth_id → current assignment → statutory snapshot
 * → initial status history → HR submodule audit. ATOMIC: on any failure the user +
 * Auth account are rolled back so we never leave a half-provisioned employee.
 * THROWS on failure (errors carry a `status` for the route layer); callers own
 * idempotency/event emission (employees/create via runModuleMutation; import/commit
 * per row). Returns the new id, EMP-#### number, and computed payroll readiness.
 */
export async function provisionEmployee(
  actorId: string,
  input: ProvisionEmployeeInput,
): Promise<{ id: string; employeeNo: string; readiness: 'pending' | 'ready' | 'blocked' }> {
  const { identity, employment, assignment, access, statutory } = input;
  const createLogin = input.createLogin !== false;
  if (createLogin && !identity.password) {
    throw Object.assign(new Error('A password is required to create a login.'), { status: 400 });
  }

  const employeeNo = identity.employeeNumber?.trim()
    ? identity.employeeNumber.trim().toUpperCase()
    : await nextEmployeeNumber();
  const authEmail = identity.email?.trim()
    ? identity.email.trim().toLowerCase()
    : `${identity.username.toLowerCase()}@siomac.internal`;
  const startDate = employment?.startDate ?? todayISO();

  const stPatch = statutory ? statutoryPatch(statutory) : {};
  const readiness = Object.keys(stPatch).length
    ? computePayrollReadiness(statutoryWithDefaults(stPatch))
    : { status: 'pending' as const, blockers: [] as string[], financeEligible: false };

  const insertRow: Record<string, unknown> = {
    username: identity.username, full_name: identity.fullName,
    role: access?.role ?? 'employee', status: input.recordStatus?.trim() || 'active', auth_email: authEmail,
    email: identity.email?.trim() || null, personal_email: identity.personalEmail?.trim() || null,
    phone: identity.phone?.trim() || null, employee_number: employeeNo,
    contractor_flag: employment?.contractorFlag ?? (employment?.employmentType === 'contractor'),
    start_date: startDate, position: employment?.position ?? null, position_id: assignment?.positionId ?? null,
    department_id: assignment?.departmentId ?? null, site_id: assignment?.siteId ?? null,
    supervisor_id: assignment?.supervisorId ?? null,
  };
  if (employment?.employmentType) insertRow['employment_type'] = employment.employmentType;
  if (identity.firstName) insertRow['first_name'] = identity.firstName;
  if (identity.lastName)  insertRow['last_name']  = identity.lastName;
  if (identity.dateOfBirth?.trim()) insertRow['date_of_birth'] = identity.dateOfBirth.trim();
  if (identity.nationality?.trim()) insertRow['nationality']   = identity.nationality.trim();
  if (identity.preferredName?.trim()) insertRow['display_name'] = identity.preferredName.trim();
  if (identity.governmentId?.trim()) insertRow['government_id'] = identity.governmentId.trim();
  if (employment?.positionTitle?.trim()) insertRow['position_title'] = employment.positionTitle.trim();
  if (employment?.probationEndDate) insertRow['probation_end_date'] = employment.probationEndDate;
  if (employment?.employeeGrade?.trim()) insertRow['employee_grade'] = employment.employeeGrade.trim();
  if (employment?.workSchedule?.trim()) insertRow['work_schedule'] = employment.workSchedule.trim();
  if (assignment?.costCenter?.trim()) insertRow['cost_center'] = assignment.costCenter.trim();
  if (access?.permissionProfile?.trim()) insertRow['permission_profile'] = access.permissionProfile.trim();
  if (access?.selfServiceProfile?.trim()) insertRow['self_service_profile'] = access.selfServiceProfile.trim();
  if (access?.requireMfa !== undefined) insertRow['require_mfa'] = access.requireMfa;
  if (access?.onboardingRequirements && Object.keys(access.onboardingRequirements).length) insertRow['onboarding_requirements'] = access.onboardingRequirements;

  const { data: created, error: insErr } = await sb.from('app_users').insert(insertRow).select('id').single<{ id: string }>();
  if (insErr) {
    const dup = insErr.code === '23505';
    const msg = dup
      ? (insErr.message.includes('employee_number') ? `Employee ID "${employeeNo}" is already in use.` : `Username "${identity.username}" is already taken.`)
      : insErr.message;
    throw Object.assign(new Error(msg), { status: dup ? 400 : 500 });
  }
  const employeeId = created.id;

  // Supabase Auth login (when requested) — roll back app_users on failure.
  let authId: string | null = null;
  if (createLogin) {
    const { data: authData, error: authErr } = await sb.auth.admin.createUser({
      email: authEmail, password: identity.password!, email_confirm: true,
      user_metadata: { appUserId: employeeId, username: identity.username },
    });
    if (authErr) {
      await sb.from('app_users').delete().eq('id', employeeId);
      throw Object.assign(new Error('Failed to create auth account: ' + authErr.message), { status: 500 });
    }
    authId = authData.user.id;
    await sb.from('app_users').update({ auth_id: authId }).eq('id', employeeId);
  }

  // Satellites — errors are checked (not swallowed); roll back the user + Auth on failure.
  const { error: asgErr } = await sb.from('hr_employee_assignments').insert({
    employee_id: employeeId, position_id: assignment?.positionId ?? null,
    department_id: assignment?.departmentId ?? null, site_id: assignment?.siteId ?? null,
    supervisor_id: assignment?.supervisorId ?? null, assignment_type: 'primary',
    effective_from: assignment?.effectiveDate || startDate, is_current: true, created_by: actorId,
  });
  const { error: stErr } = await sb.from('hr_employee_statutory').insert({
    employee_id: employeeId, ...stPatch,
    payroll_ready_status: readiness.status, missing_blockers: readiness.blockers,
    finance_handoff_eligible: readiness.financeEligible, updated_by: actorId,
  });
  const { error: histErr } = await sb.from('hr_employee_status_history').insert({
    employee_id: employeeId, previous_status: null, new_status: input.recordStatus?.trim() || 'active',
    reason: 'Employee created', effective_date: startDate, changed_by: actorId,
  });
  const satErr = asgErr ?? stErr ?? histErr;
  if (satErr) {
    await sb.from('app_users').delete().eq('id', employeeId);
    if (authId) { try { await sb.auth.admin.deleteUser(authId); } catch { /* best-effort */ } }
    throw Object.assign(new Error('Failed to write employee records: ' + satErr.message), { status: 500 });
  }

  await writeHrAudit({ employeeId, submoduleKey: 'employees', recordId: employeeId, actorId,
    action: 'hr.employee.created', newState: { employee_number: employeeNo, role: access?.role ?? 'employee', payrollReadiness: readiness.status } });

  return { id: employeeId, employeeNo, readiness: readiness.status };
}
