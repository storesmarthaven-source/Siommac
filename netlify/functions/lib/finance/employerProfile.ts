// ============================================================================
// Finance Payroll -- Employer statutory profile (Wave 7 foundation)
// ============================================================================
// The company-level statutory identity printed on TD4 / NI184 / NI187 and the
// payslip employer block: legal name, address, BIR employer file number, NIBTT
// employer registration number. Stored as a single JSON value in the `settings`
// KV (key `employerProfile`) -- the same store payslipPdf already reads
// `companyName` from. Single-tenant, so one profile. Read is cheap + cached;
// writes are gated + audited (BIR/NIS employer numbers are statutory identifiers).
// ============================================================================

import { sb } from '../db';
import { setting, invalidateSettingsCache } from '../settings';
import { emitAppEvent } from '../appEvents';
import { writeHrAudit } from '../hr/employeeCore';

const SETTINGS_KEY = 'employerProfile';

export interface EmployerProfile {
  legalName:         string;
  tradingName:       string | null;
  birFileNumber:     string | null;   // BIR employer file number (TD4)
  nisEmployerNumber: string | null;   // NIBTT employer registration number (NI184/187)
  addressLine1:      string | null;
  addressLine2:      string | null;
  city:              string | null;
  country:           string;
  phone:             string | null;
  email:             string | null;
}

const EMPTY: EmployerProfile = {
  legalName: '', tradingName: null, birFileNumber: null, nisEmployerNumber: null,
  addressLine1: null, addressLine2: null, city: null, country: 'Trinidad and Tobago',
  phone: null, email: null,
};

/** Read the employer profile, falling back to the legacy `companyName` for the legal name. */
export async function getEmployerProfile(): Promise<EmployerProfile> {
  const [raw, companyName] = await Promise.all([
    setting(SETTINGS_KEY, ''),
    setting('companyName', ''),
  ]);
  let parsed: Partial<EmployerProfile> = {};
  if (raw) { try { parsed = JSON.parse(raw) as Partial<EmployerProfile>; } catch { /* ignore malformed */ } }
  const merged = { ...EMPTY, ...parsed };
  if (!merged.legalName && companyName) merged.legalName = companyName.trim();
  return merged;
}

/** True once the identifiers TD4/NI forms REQUIRE are present (used to gate generation). */
export function isEmployerProfileComplete(p: EmployerProfile): { ok: boolean; missing: string[] } {
  const missing: string[] = [];
  if (!p.legalName?.trim())         missing.push('legalName');
  if (!p.birFileNumber?.trim())     missing.push('birFileNumber');
  if (!p.nisEmployerNumber?.trim()) missing.push('nisEmployerNumber');
  return { ok: missing.length === 0, missing };
}

export interface UpsertEmployerProfileInput extends Partial<EmployerProfile> { actorId: string; }

const clean = (v: string | null | undefined): string | null => {
  const s = (v ?? '').trim();
  return s.length ? s : null;
};

export async function upsertEmployerProfile(input: UpsertEmployerProfileInput): Promise<EmployerProfile> {
  const prev = await getEmployerProfile();
  const next: EmployerProfile = {
    legalName:         (input.legalName ?? prev.legalName ?? '').trim(),
    tradingName:       'tradingName' in input       ? clean(input.tradingName)       : prev.tradingName,
    birFileNumber:     'birFileNumber' in input     ? clean(input.birFileNumber)     : prev.birFileNumber,
    nisEmployerNumber: 'nisEmployerNumber' in input ? clean(input.nisEmployerNumber) : prev.nisEmployerNumber,
    addressLine1:      'addressLine1' in input      ? clean(input.addressLine1)      : prev.addressLine1,
    addressLine2:      'addressLine2' in input      ? clean(input.addressLine2)      : prev.addressLine2,
    city:              'city' in input              ? clean(input.city)              : prev.city,
    country:           (input.country ?? prev.country ?? 'Trinidad and Tobago').trim() || 'Trinidad and Tobago',
    phone:             'phone' in input             ? clean(input.phone)             : prev.phone,
    email:             'email' in input             ? clean(input.email)             : prev.email,
  };
  if (!next.legalName) throw Object.assign(new Error('Employer legal name is required.'), { status: 422 });

  const { error } = await sb.from('settings').upsert({ key: SETTINGS_KEY, value: JSON.stringify(next) }, { onConflict: 'key' });
  if (error) throw Object.assign(new Error('upsertEmployerProfile: ' + error.message), { status: 500 });
  invalidateSettingsCache();

  void emitAppEvent({
    eventType: 'finance.payroll.employer_profile.updated',
    sourceModule: 'finance_payroll', sourceEntityType: 'employer_profile', sourceEntityId: 'default',
    actorUserId: input.actorId, severity: 'warning',
    payload: { legalName: next.legalName, birFileNumber: next.birFileNumber, nisEmployerNumber: next.nisEmployerNumber },
  });
  await writeHrAudit({
    submoduleKey: 'finance_payroll', recordId: 'employer_profile', actorId: input.actorId,
    action: 'employer_profile.updated',
    previousState: { legalName: prev.legalName, birFileNumber: prev.birFileNumber, nisEmployerNumber: prev.nisEmployerNumber },
    newState:      { legalName: next.legalName, birFileNumber: next.birFileNumber, nisEmployerNumber: next.nisEmployerNumber },
  });
  return next;
}
