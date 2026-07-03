// ============================================================================
// HR — Employee Statutory Profile Core (Phase 2.5)
// ============================================================================
// DTO + DB row shape + mapper for hr_employee_statutory_profiles.
// Shared between the HR capture layer (statutoryProfileMutations.ts)
// and the Finance verify layer (finance/nisProfileVerification.ts).
//
// Ownership:
//   HR captures (nis_number, employer history, opening YTD balances).
//   Finance verifies (sets nis_status='verified', verified_by/at/note).
//   HR can NEVER set nis_status='verified' — enforced at the mutation layer.
// ============================================================================

import { sb } from '../db';

// ── DTO (camelCase — what routes return to the frontend) ──────────────────────

export interface StatutoryProfileDto {
  id: string;
  employeeId: string;
  jurisdiction: string;
  currency: string;
  nisNumber: string | null;
  nisStatus: 'pending_verification' | 'verified' | 'not_available' | 'not_applicable' | 'exempt';
  nisApplicable: boolean;
  previousEmployerName: string | null;
  previousEmployerEndDate: string | null;
  openingYtdInsurableEarnings: number;
  openingYtdNisEmployee: number;
  openingYtdNisEmployer: number;
  openingBalanceAsOf: string | null;
  verifiedBy: string | null;
  verifiedAt: string | null;
  verificationNote: string | null;
  workflowId: string | null;
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

// ── DB row shape ──────────────────────────────────────────────────────────────

export interface DbStatutoryProfileRow {
  id: string;
  employee_id: string;
  jurisdiction: string;
  currency: string;
  nis_number: string | null;
  nis_status: string;
  nis_applicable: boolean;
  previous_employer_name: string | null;
  previous_employer_end_date: string | null;
  opening_ytd_insurable_earnings: number;
  opening_ytd_nis_employee: number;
  opening_ytd_nis_employer: number;
  opening_balance_as_of: string | null;
  verified_by: string | null;
  verified_at: string | null;
  verification_note: string | null;
  workflow_id: string | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

// ── Mapper ────────────────────────────────────────────────────────────────────

export function toStatutoryProfileDto(r: DbStatutoryProfileRow): StatutoryProfileDto {
  return {
    id:                          r.id,
    employeeId:                  r.employee_id,
    jurisdiction:                r.jurisdiction,
    currency:                    r.currency,
    nisNumber:                   r.nis_number,
    nisStatus:                   r.nis_status as StatutoryProfileDto['nisStatus'],
    nisApplicable:               r.nis_applicable,
    previousEmployerName:        r.previous_employer_name,
    previousEmployerEndDate:     r.previous_employer_end_date,
    openingYtdInsurableEarnings: Number(r.opening_ytd_insurable_earnings),
    openingYtdNisEmployee:       Number(r.opening_ytd_nis_employee),
    openingYtdNisEmployer:       Number(r.opening_ytd_nis_employer),
    openingBalanceAsOf:          r.opening_balance_as_of,
    verifiedBy:                  r.verified_by,
    verifiedAt:                  r.verified_at,
    verificationNote:            r.verification_note,
    workflowId:                  r.workflow_id,
    createdBy:                   r.created_by,
    updatedBy:                   r.updated_by,
    createdAt:                   r.created_at,
    updatedAt:                   r.updated_at,
  };
}

// ── Shared query helpers ──────────────────────────────────────────────────────

/** Load a statutory profile by employee + jurisdiction. Returns null if not found. */
export async function getStatutoryProfileByEmployee(
  employeeId: string,
  jurisdiction = 'TT',
): Promise<StatutoryProfileDto | null> {
  const { data, error } = await sb
    .from('hr_employee_statutory_profiles')
    .select('*')
    .eq('employee_id', employeeId)
    .eq('jurisdiction', jurisdiction)
    .maybeSingle<DbStatutoryProfileRow>();
  if (error) throw Object.assign(new Error('getStatutoryProfileByEmployee: ' + error.message), { status: 500 });
  return data ? toStatutoryProfileDto(data) : null;
}

/** Load a statutory profile by its primary key. Returns null if not found. */
export async function getStatutoryProfileById(
  id: string,
): Promise<StatutoryProfileDto | null> {
  const { data, error } = await sb
    .from('hr_employee_statutory_profiles')
    .select('*')
    .eq('id', id)
    .maybeSingle<DbStatutoryProfileRow>();
  if (error) throw Object.assign(new Error('getStatutoryProfileById: ' + error.message), { status: 500 });
  return data ? toStatutoryProfileDto(data) : null;
}
