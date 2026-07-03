// ============================================================================
// Finance — NIS Profile Verification (Phase 2.5)
// ============================================================================
// Finance staff reviews and Finance manager verifies employee NIS statutory
// profiles captured by HR.
//
// Key rules:
//   • Only `finance.payroll.nis.verify` may set nis_status='verified'.
//   • Rejection returns the profile to 'not_available' (Finance decided it
//     cannot be verified — HR must correct and re-submit).
//   • verified_by / verified_at are Finance-owned fields.
//   • Every mutation writes hr_audit_log + emits app_event.
// ============================================================================

import { sb } from '../db';
import { emitAppEvent } from '../appEvents';
import { writeHrAudit } from '../hr/employeeCore';
import {
  getStatutoryProfileById,
  toStatutoryProfileDto,
  type StatutoryProfileDto,
  type DbStatutoryProfileRow,
} from '../hr/statutoryProfileCore';

export { getStatutoryProfileById };

// ── List profiles pending Finance review ──────────────────────────────────────

export interface ListNisProfilesOpts {
  jurisdiction?: string;
  nisStatus?: string;
  employeeId?: string;
}

export async function listNisProfiles(opts: ListNisProfilesOpts = {}): Promise<StatutoryProfileDto[]> {
  let q = sb
    .from('hr_employee_statutory_profiles')
    .select('*')
    .order('created_at', { ascending: false });

  if (opts.jurisdiction) q = q.eq('jurisdiction', opts.jurisdiction);
  if (opts.nisStatus)    q = q.eq('nis_status', opts.nisStatus);
  if (opts.employeeId)   q = q.eq('employee_id', opts.employeeId);

  const { data, error } = await q;
  if (error) throw Object.assign(new Error('listNisProfiles: ' + error.message), { status: 500 });
  return ((data ?? []) as DbStatutoryProfileRow[]).map(toStatutoryProfileDto);
}

// ── Verify (Finance Manager sets nis_status='verified') ─────────────────────

export interface VerifyNisProfileInput {
  id: string;
  actorId: string;
  verificationNote?: string | null;
}

export async function verifyNisProfile(
  input: VerifyNisProfileInput,
): Promise<StatutoryProfileDto> {
  const existing = await getStatutoryProfileById(input.id);
  if (!existing) throw Object.assign(new Error('Statutory profile not found.'), { status: 404 });

  if (existing.nisStatus === 'verified') {
    throw Object.assign(new Error('This statutory profile is already verified.'), { status: 422 });
  }

  // Only profiles that are in an unverified state can be verified
  const allowedStatuses = ['pending_verification', 'not_available', 'not_applicable', 'exempt'];
  if (!allowedStatuses.includes(existing.nisStatus)) {
    throw Object.assign(
      new Error(`Cannot verify a profile with status '${existing.nisStatus}'.`),
      { status: 422 },
    );
  }

  const now = new Date().toISOString();
  const { data, error } = await sb
    .from('hr_employee_statutory_profiles')
    .update({
      nis_status:        'verified',
      verified_by:       input.actorId,
      verified_at:       now,
      verification_note: input.verificationNote ?? null,
      updated_by:        input.actorId,
    })
    .eq('id', input.id)
    .select()
    .single<DbStatutoryProfileRow>();
  if (error) throw Object.assign(new Error('verifyNisProfile: ' + error.message), { status: 500 });
  const row = toStatutoryProfileDto(data);

  await writeHrAudit({
    submoduleKey: 'finance_payroll_nis',
    recordId:     input.id,
    actorId:      input.actorId,
    action:       'nis_profile.verified',
    previousState: { nisStatus: existing.nisStatus },
    newState: { nisStatus: 'verified', verifiedBy: input.actorId, verifiedAt: now },
  });

  void emitAppEvent({
    eventType:       'finance.nis.profile.verified',
    sourceModule:    'finance_payroll',
    sourceEntityType: 'statutory_profile',
    sourceEntityId:  input.id,
    actorUserId:     input.actorId,
    severity:        'success',
    payload: {
      employeeId:      existing.employeeId,
      jurisdiction:    existing.jurisdiction,
      verificationNote: input.verificationNote ?? null,
    },
  });

  return row;
}

// ── Reject (Finance cannot verify — HR must correct and re-submit) ────────────

export interface RejectNisProfileInput {
  id: string;
  actorId: string;
  reason: string;
}

export async function rejectNisProfile(
  input: RejectNisProfileInput,
): Promise<StatutoryProfileDto> {
  const existing = await getStatutoryProfileById(input.id);
  if (!existing) throw Object.assign(new Error('Statutory profile not found.'), { status: 404 });

  if (existing.nisStatus === 'verified') {
    throw Object.assign(new Error('A verified profile cannot be rejected. Contact Finance Manager if a correction is needed.'), { status: 422 });
  }

  const { data, error } = await sb
    .from('hr_employee_statutory_profiles')
    .update({
      nis_status:        'not_available',
      verification_note: input.reason,
      updated_by:        input.actorId,
    })
    .eq('id', input.id)
    .select()
    .single<DbStatutoryProfileRow>();
  if (error) throw Object.assign(new Error('rejectNisProfile: ' + error.message), { status: 500 });
  const row = toStatutoryProfileDto(data);

  await writeHrAudit({
    submoduleKey: 'finance_payroll_nis',
    recordId:     input.id,
    actorId:      input.actorId,
    action:       'nis_profile.rejected',
    previousState: { nisStatus: existing.nisStatus },
    newState: { nisStatus: 'not_available' },
    reason: input.reason,
  });

  void emitAppEvent({
    eventType:       'finance.nis.profile.rejected',
    sourceModule:    'finance_payroll',
    sourceEntityType: 'statutory_profile',
    sourceEntityId:  input.id,
    actorUserId:     input.actorId,
    severity:        'warning',
    payload: {
      employeeId:   existing.employeeId,
      jurisdiction: existing.jurisdiction,
      reason:       input.reason,
    },
  });

  return row;
}

// ── Adapter helper: set NIS status (called by workflow adapter) ───────────────

export async function setNisProfileStatus(
  id: string,
  status: string,
  actorId: string | null,
  opts?: { note?: string | null; verifiedBy?: string | null },
): Promise<void> {
  const patch: Record<string, unknown> = {
    nis_status: status,
    updated_by: actorId,
  };
  if (status === 'verified') {
    patch['verified_by'] = opts?.verifiedBy ?? actorId;
    patch['verified_at'] = new Date().toISOString();
    if (opts?.note !== undefined) patch['verification_note'] = opts.note;
  }
  if (opts?.note !== undefined && status !== 'verified') {
    patch['verification_note'] = opts.note;
  }

  const { error } = await sb
    .from('hr_employee_statutory_profiles')
    .update(patch)
    .eq('id', id);
  if (error) throw new Error('setNisProfileStatus failed: ' + error.message);

  await writeHrAudit({
    submoduleKey: 'finance_payroll_nis',
    recordId:     id,
    actorId:      actorId ?? 'workflow',
    action:       `nis_profile.status_set.${status}`,
    previousState: null,
    newState: { nisStatus: status },
    reason: opts?.note ?? null,
  });
}
