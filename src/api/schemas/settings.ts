/**
 * src/api/schemas/settings.ts
 *
 * Zod schemas for the Settings domain.
 *
 * @see docs/ARCHITECTURE.md §Validation
 * @see docs/CODING_STANDARDS.md
 * @see docs/PHASE_PLAN.md §Phase-2a
 */

import { z } from 'zod';

// ── Setting Row ───────────────────────────────────────────────────────────────

export const SettingRowSchema = z.object({
  key:   z.string().min(1),
  value: z.string(),
});

export type SettingRow = z.infer<typeof SettingRowSchema>;

/** Key-value map returned after fetching all settings */
export type SettingsMap = Record<string, string>;

// ── Company settings payload ──────────────────────────────────────────────────

export const SaveCompanySettingsSchema = z.object({
  company_name:    z.string().min(1).max(200).optional(),
  company_address: z.string().max(500).optional(),
  company_phone:   z.string().max(30).optional(),
  company_email:   z.string().email().optional(),
  company_nis:     z.string().max(50).optional(),
  company_bir:     z.string().max(50).optional(),
  currency:        z.string().length(3).optional(),   // ISO 4217 e.g. 'TTD'
  logo_url:        z.string().url().optional(),
});

export type SaveCompanySettingsPayload = z.infer<typeof SaveCompanySettingsSchema>;

// ── Statutory rates payload ───────────────────────────────────────────────────

export const SaveStatutoryRatesSchema = z.object({
  nis_employee_rate:    z.number().min(0).max(1).optional(),  // e.g. 0.03
  nis_employer_rate:    z.number().min(0).max(1).optional(),
  nis_max_insurable:    z.number().nonnegative().optional(),
  hs_rate:              z.number().min(0).max(1).optional(),
  paye_personal_allowance: z.number().nonnegative().optional(),
  paye_brackets:        z.array(z.object({
    from:  z.number().nonnegative(),
    to:    z.number().nonnegative().nullable(),
    rate:  z.number().min(0).max(1),
  })).optional(),
});

export type SaveStatutoryRatesPayload = z.infer<typeof SaveStatutoryRatesSchema>;
