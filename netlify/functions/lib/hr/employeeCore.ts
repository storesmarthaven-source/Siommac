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
  // Atomic, race-free allocation via the shared reference-counter RPC. Year sentinel 0 = a
  // single GLOBAL EMP sequence (the number carries no year, unlike ORC-2026-#### refs). The
  // counter is seeded to the current max by migration 20260919000270, so it continues the
  // existing sequence. The previous scan-max-then-increment was non-atomic: two concurrent
  // creates read the same max and minted the SAME EMP-#### (duplicate reference).
  const counterRes = await sb.rpc('increment_ref_counter', { p_prefix: 'EMP', p_year: 0 });
  if (counterRes.error || counterRes.data == null) {
    // No safe fallback: a scan or timestamp would re-introduce the collision / break format.
    throw Object.assign(new Error(`Could not allocate an employee number: ${counterRes.error?.message ?? 'reference counter unavailable'}`), { status: 500 });
  }
  return `EMP-${String(counterRes.data as number).padStart(4, '0')}`;
}

// Mirror `x?.trim() || fallback` for user-entered strings — a blank/whitespace-only value
// counts as absent. `??` is NOT equivalent here (it would keep an empty string), so these
// helpers preserve the intent while satisfying prefer-nullish-coalescing.
const orDefault = (s: string | null | undefined, fallback: string): string => {
  const t = s?.trim();
  if (t) return t;
  return fallback;
};
const blankToNull = (s: string | null | undefined): string | null => {
  const t = s?.trim();
  if (t) return t;
  return null;
};

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

/** camelCase statutory input → snake_case column patch for the LEGACY
 *  hr_employee_statutory table. Only kept for the employees/statutory/update
 *  read-write path until that endpoint is retired. New creates MUST use
 *  statutoryProfilePatch() → hr_employee_statutory_profiles instead. */
export function statutoryPatch(s: Record<string, unknown>): Record<string, unknown> {
  const p: Record<string, unknown> = {};
  if (s.nisNumber              !== undefined) p.nis_number               = s.nisNumber;
  if (s.nisStatus              !== undefined) p.nis_status               = s.nisStatus;
  if (s.nisEffectiveDate       !== undefined) p.nis_effective_date       = s.nisEffectiveDate;
  if (s.birFileNumber          !== undefined) p.bir_file_number          = s.birFileNumber;
  if (s.payeApplicable         !== undefined) p.paye_applicable          = s.payeApplicable;
  if (s.td1Received            !== undefined) p.td1_received             = s.td1Received;
  if (s.td1EffectiveYear       !== undefined) p.td1_effective_year       = s.td1EffectiveYear;
  if (s.hsApplicable           !== undefined) p.hs_applicable            = s.hsApplicable;
  if (s.hsExemptionReason      !== undefined) p.hs_exemption_reason      = s.hsExemptionReason;
  if (s.hsEffectiveDate        !== undefined) p.hs_effective_date        = s.hsEffectiveDate;
  if (s.hsVerificationRequired !== undefined) p.hs_verification_required = s.hsVerificationRequired;
  return p;
}

/**
 * camelCase statutory input → snake_case column patch for
 * hr_employee_statutory_profiles (the canonical table).
 * nisStatus maps to nis_reg_status (HR registration status).
 * nis_status (Finance verification status) is ALWAYS 'pending_verification'
 * on create — Finance owns the transition to 'verified'.
 */
export function statutoryProfilePatch(s: Record<string, unknown>): Record<string, unknown> {
  const p: Record<string, unknown> = {};
  if (s.nisNumber              !== undefined) p.nis_number               = s.nisNumber;
  if (s.nisStatus              !== undefined) p.nis_reg_status           = s.nisStatus;   // ← mapped to new column
  if (s.nisApplicable          !== undefined) p.nis_applicable           = s.nisApplicable;
  if (s.nisEffectiveDate       !== undefined) p.nis_effective_date       = s.nisEffectiveDate;
  if (s.birFileNumber          !== undefined) p.bir_file_number          = s.birFileNumber;
  if (s.payeApplicable         !== undefined) p.paye_applicable          = s.payeApplicable;
  if (s.td1Received            !== undefined) p.td1_received             = s.td1Received;
  if (s.td1EffectiveYear       !== undefined) p.td1_effective_year       = s.td1EffectiveYear;
  if (s.hsApplicable           !== undefined) p.hs_applicable            = s.hsApplicable;
  if (s.hsExemptionReason      !== undefined) p.hs_exemption_reason      = s.hsExemptionReason;
  if (s.hsEffectiveDate        !== undefined) p.hs_effective_date        = s.hsEffectiveDate;
  if (s.hsVerificationRequired !== undefined) p.hs_verification_required = s.hsVerificationRequired;
  return p;
}

/**
 * Build a StatutoryRow-compatible object from an hr_employee_statutory_profiles
 * DB row, mapping nis_reg_status → nis_status so computePayrollReadiness() works.
 */
export function profileRowToStatutoryRow(row: Record<string, unknown>): StatutoryRow {
  return {
    nis_status:               (row.nis_reg_status as string | undefined)   ?? (row.nis_status as string | undefined) ?? 'pending',
    nis_number:               (row.nis_number     as string | null) ?? null,
    paye_applicable:          (row.paye_applicable as boolean | undefined) ?? true,
    bir_file_number:          (row.bir_file_number as string | null) ?? null,
    td1_received:             (row.td1_received    as boolean | undefined) ?? false,
    hs_applicable:            (row.hs_applicable   as boolean | undefined) ?? true,
    hs_verification_required: (row.hs_verification_required as boolean | undefined) ?? false,
    ...row,
  };
}

/** Merge a patch over statutory defaults to a full row for readiness computation. */
export function statutoryWithDefaults(p: Record<string, unknown>): StatutoryRow {
  return {
    nis_status:               (p.nis_status               as string | undefined)        ?? 'pending',
    nis_number:               (p.nis_number               as string | null) ?? null,
    paye_applicable:          (p.paye_applicable          as boolean | undefined)       ?? true,
    bir_file_number:          (p.bir_file_number          as string | null) ?? null,
    td1_received:             (p.td1_received             as boolean | undefined)       ?? false,
    hs_applicable:            (p.hs_applicable            as boolean | undefined)       ?? true,
    hs_verification_required: (p.hs_verification_required as boolean | undefined)       ?? false,
  };
}

// ── Provisioning ────────────────────────────────────────────────────────────────

export interface ProvisionEmployeeInput {
  identity: {
    username: string; fullName: string;
    firstName?: string; lastName?: string; email?: string; personalEmail?: string;
    phone?: string; employeeNumber?: string; dateOfBirth?: string; nationality?: string;
    preferredName?: string; governmentId?: string;
  };
  employment?: { employmentType?: string; contractorFlag?: boolean; startDate?: string; position?: string; positionTitle?: string; probationEndDate?: string; employeeGrade?: string; workSchedule?: string };
  assignment?: { departmentId?: string | null; siteId?: string | null; positionId?: string | null; supervisorId?: string | null; costCenter?: string | null; effectiveDate?: string };
  /** Governed access only.
   *
   *  `resolvedRole` is the role a caller has ALREADY derived server-side from an
   *  approved access profile. It must never be populated from user-supplied input
   *  (a mapped CSV column, a request field). The field previously named `role` was
   *  reachable from an import mapping, which let anyone who could commit a batch put
   *  `role=admin` in a spreadsheet. Omit it and the record defaults to `employee`. */
  access?:     { resolvedRole?: string; permissionProfile?: string; selfServiceProfile?: string; requireMfa?: boolean; onboardingRequirements?: Record<string, boolean> };
  statutory?:  Record<string, unknown>;
  /** Initial app_users.status (default 'active'). */
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

  const employeeNo = identity.employeeNumber?.trim()
    ? identity.employeeNumber.trim().toUpperCase()
    : await nextEmployeeNumber();
  const authEmail = identity.email?.trim()
    ? identity.email.trim().toLowerCase()
    : `${identity.username.toLowerCase()}@siomac.internal`;
  const startDate = employment?.startDate ?? todayISO();

  // Use the profile-table mapping (nisStatus → nis_reg_status) for the canonical insert.
  const stPatch = statutory ? statutoryProfilePatch(statutory) : {};
  // computePayrollReadiness needs nis_status in StatutoryRow semantics; map nis_reg_status back.
  const stForReadiness = statutory ? statutoryWithDefaults(statutoryPatch(statutory)) : null;
  const readiness = stForReadiness
    ? computePayrollReadiness(stForReadiness)
    : { status: 'pending' as const, blockers: [] as string[], financeEligible: false };

  const insertRow: Record<string, unknown> = {
    username: identity.username, full_name: identity.fullName,
    role: access?.resolvedRole ?? 'employee',
    // app_users.status is an authentication gate. HR lifecycle belongs in the
    // dedicated employment_status column and status history.
    status: 'active',
    employment_status: orDefault(input.recordStatus, 'active'),
    auth_email: authEmail,
    email: blankToNull(identity.email), personal_email: blankToNull(identity.personalEmail),
    phone: blankToNull(identity.phone), employee_number: employeeNo,
    contractor_flag: employment?.contractorFlag ?? (employment?.employmentType === 'contractor'),
    start_date: startDate, position: employment?.position ?? null, position_id: assignment?.positionId ?? null,
    department_id: assignment?.departmentId ?? null, site_id: assignment?.siteId ?? null,
    supervisor_id: assignment?.supervisorId ?? null,
  };
  if (employment?.employmentType) insertRow.employment_type = employment.employmentType;
  if (identity.firstName) insertRow.first_name = identity.firstName;
  if (identity.lastName)  insertRow.last_name  = identity.lastName;
  if (identity.dateOfBirth?.trim()) insertRow.date_of_birth = identity.dateOfBirth.trim();
  if (identity.nationality?.trim()) insertRow.nationality   = identity.nationality.trim();
  if (identity.preferredName?.trim()) insertRow.display_name = identity.preferredName.trim();
  if (identity.governmentId?.trim()) insertRow.government_id = identity.governmentId.trim();
  if (employment?.positionTitle?.trim()) insertRow.position_title = employment.positionTitle.trim();
  if (employment?.probationEndDate) insertRow.probation_end_date = employment.probationEndDate;
  if (employment?.employeeGrade?.trim()) insertRow.employee_grade = employment.employeeGrade.trim();
  if (employment?.workSchedule?.trim()) insertRow.work_schedule = employment.workSchedule.trim();
  if (assignment?.costCenter?.trim()) insertRow.cost_center = assignment.costCenter.trim();
  if (access?.permissionProfile?.trim()) insertRow.permission_profile = access.permissionProfile.trim();
  if (access?.selfServiceProfile?.trim()) insertRow.self_service_profile = access.selfServiceProfile.trim();
  if (access?.requireMfa !== undefined) insertRow.require_mfa = access.requireMfa;
  if (access?.onboardingRequirements && Object.keys(access.onboardingRequirements).length) insertRow.onboarding_requirements = access.onboardingRequirements;

  const { data: created, error: insErr } = await sb.from('app_users').insert(insertRow).select('id').single<{ id: string }>();
  if (insErr) {
    const dup = insErr.code === '23505';
    const msg = dup
      ? (insErr.message.includes('employee_number') ? `Employee ID "${employeeNo}" is already in use.` : `Username "${identity.username}" is already taken.`)
      : insErr.message;
    throw Object.assign(new Error(msg), { status: dup ? 400 : 500 });
  }
  const employeeId = created.id;

  // NO Supabase Auth account is created here, by design.
  //
  // This path used to mint an Auth user with a randomly generated password and
  // `email_confirm: true`. Nobody ever received that password, so the credential was
  // unusable — yet the account was pre-confirmed, meaning anyone controlling the
  // mailbox could reset it and inherit whatever role the record carried. Bulk import
  // defaulted this ON.
  //
  // Account provisioning is a governed, invite-based flow: see
  // lib/hr/accountProvisioning.ts (`provisionAccount`), which the Employee Creation
  // Wizard calls for its `invite_on_create` mode. An employee record with no login is
  // a valid, safe end state; a login is requested separately and explicitly.

  // Satellites — errors are checked (not swallowed); roll back the user + Auth on failure.
  const { error: asgErr } = await sb.from('hr_employee_assignments').insert({
    employee_id: employeeId, position_id: assignment?.positionId ?? null,
    department_id: assignment?.departmentId ?? null, site_id: assignment?.siteId ?? null,
    supervisor_id: assignment?.supervisorId ?? null, assignment_type: 'primary',
    effective_from: orDefault(assignment?.effectiveDate, startDate), is_current: true, created_by: actorId,
  });
  // Write statutory data to hr_employee_statutory_profiles (canonical table).
  // nis_status on this table is the Finance verification status (always 'pending_verification' on create).
  // nis_reg_status is the HR registration status (from the input's nisStatus field).
  const { error: stErr } = await sb.from('hr_employee_statutory_profiles').insert({
    employee_id: employeeId,
    jurisdiction: 'TT',
    currency: 'TTD',
    nis_status: 'pending_verification',  // Finance verification state — HR cannot set 'verified'
    ...stPatch,                          // stPatch maps nisStatus → nis_reg_status, other columns direct
    payroll_ready_status:     readiness.status,
    missing_blockers:         readiness.blockers,
    finance_handoff_eligible: readiness.financeEligible,
    created_by:               actorId,
    updated_by:               actorId,
  });
  const { error: histErr } = await sb.from('hr_employee_status_history').insert({
    employee_id: employeeId, previous_status: null, new_status: orDefault(input.recordStatus, 'active'),
    reason: 'Employee created', effective_date: startDate, changed_by: actorId,
  });
  const satErr = asgErr ?? stErr ?? histErr;
  if (satErr) {
    await sb.from('app_users').delete().eq('id', employeeId);
    // No auth account is created in this path (createLogin: false), so app_users is the
    // only row to compensate — there is no Auth user to delete.
    throw Object.assign(new Error('Failed to write employee records: ' + satErr.message), { status: 500 });
  }

  await writeHrAudit({ employeeId, submoduleKey: 'employees', recordId: employeeId, actorId,
    action: 'hr.employee.created', newState: { employee_number: employeeNo, role: access?.resolvedRole ?? 'employee', payrollReadiness: readiness.status } });

  return { id: employeeId, employeeNo, readiness: readiness.status };
}
