/**
 * src/api/schemas/payroll.ts
 *
 * Zod schemas for the Payroll domain (runs, entries, hourly rates).
 *
 * @see docs/ARCHITECTURE.md §Validation
 * @see docs/CODING_STANDARDS.md
 * @see docs/PHASE_PLAN.md §Phase-2a
 */

import { z } from 'zod';
import { uuid, isoTimestamp } from './employee';
import { PayCycleSchema, PayBasisSchema } from './employee';

// ── Enums ─────────────────────────────────────────────────────────────────────

export const PayrollStatusSchema = z.enum(['draft', 'pending', 'approved', 'paid']);

// ── Payroll Run ───────────────────────────────────────────────────────────────

export const PayrollRunSchema = z.object({
  id:           uuid,
  period_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  period_end:   z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  status:       PayrollStatusSchema,
  created_by:   z.string().nullable(),
  approved_by:  z.string().nullable(),
  approved_at:  isoTimestamp,
  created_at:   isoTimestamp,
  updated_at:   isoTimestamp,
});

export type PayrollRun = z.infer<typeof PayrollRunSchema>;

// ── Payroll Entry ─────────────────────────────────────────────────────────────

export const PayrollEntrySchema = z.object({
  id:               uuid,
  payroll_run_id:   uuid,
  user_id:          uuid,
  username:         z.string(),
  gross_pay:        z.number().nonnegative(),
  paye:             z.number().nonnegative(),
  nis:              z.number().nonnegative(),
  health_surcharge: z.number().nonnegative(),
  total_deductions: z.number().nonnegative(),
  net_pay:          z.number().nonnegative(),
  hours_worked:     z.number().nonnegative().nullable(),
  pay_cycle:        PayCycleSchema.nullable(),
  pay_basis:        PayBasisSchema.nullable(),
  created_at:       isoTimestamp,
});

export type PayrollEntry = z.infer<typeof PayrollEntrySchema>;

// ── Hourly Rate ───────────────────────────────────────────────────────────────

export const HourlyRateRowSchema = z.object({
  id:             uuid,
  user_id:        uuid,
  username:       z.string(),
  rate:           z.number().positive(),
  effective_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  created_at:     isoTimestamp,
});

export type HourlyRateRow = z.infer<typeof HourlyRateRowSchema>;

export const SetHourlyRateSchema = z.object({
  username:       z.string().min(1),
  rate:           z.number().positive('Rate must be greater than zero'),
  effective_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD'),
});

export type SetHourlyRatePayload = z.infer<typeof SetHourlyRateSchema>;

// ── Create payroll run ────────────────────────────────────────────────────────

export const CreatePayrollRunSchema = z.object({
  period_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD'),
  period_end:   z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD'),
}).refine(
  (d) => d.period_start <= d.period_end,
  { message: 'period_start must not be after period_end', path: ['period_start'] },
);

export type CreatePayrollRunPayload = z.infer<typeof CreatePayrollRunSchema>;
