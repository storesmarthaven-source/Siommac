/**
 * src/api/schemas/employee.ts
 *
 * Zod schemas for the Employee and Department domains.
 *
 * PURPOSE:
 *   - Validate data at the API boundary (Supabase response → typed TS object)
 *   - Validate form inputs before mutation (addEmployee, updateEmployee, etc.)
 *   - Generate inferred TypeScript types from schemas (DRY — no separate interface)
 *
 * VALIDATION PHILOSOPHY:
 *   - Be strict on writes (all required fields must be present)
 *   - Be lenient on reads (nullable fields are optional — DB may have legacy nulls)
 *   - Never throw on parse — always use safeParse() and handle the error case
 *
 * @see docs/ARCHITECTURE.md §Validation
 * @see docs/CODING_STANDARDS.md
 * @see docs/PHASE_PLAN.md §Phase-2a
 */

import { z } from 'zod';
import { UserRoleSchema } from './auth';

// ── Shared primitives ─────────────────────────────────────────────────────────

const uuid         = z.uuid();
const isoTimestamp = z.iso.datetime({ offset: true }).nullable();
const isoDate      = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD').nullable();

// ── Employee ──────────────────────────────────────────────────────────────────

// UserRoleSchema is the canonical source in schemas/auth.ts — re-exported here
export { UserRoleSchema };
export const UserStatusSchema  = z.enum(['active', 'inactive']);
export const PayCycleSchema    = z.enum(['daily', 'weekly', 'fortnightly', 'monthly']);
export const PayBasisSchema    = z.enum(['salary', 'hourly']);

/** Full DB row — returned by SELECT queries */
export const EmployeeRowSchema = z.object({
  id:                          uuid,
  username:                    z.string().min(1),
  password_hash:               z.string(),
  full_name:                   z.string().min(1),
  role:                        UserRoleSchema,
  status:                      UserStatusSchema,
  department_id:               uuid.nullable(),
  position:                    z.string().nullable(),
  email:                       z.email().nullable(),
  phone:                       z.string().nullable(),
  employee_number:             z.string().nullable(),
  profile_image:               z.url().nullable(),
  signed_url:                  z.string().nullable(),
  signed_url_expires_at:       isoTimestamp,
  color_scheme:                z.string().nullable(),
  layout_mode:                 z.string().nullable(),
  totp_secret:                 z.string().nullable(),
  totp_enabled:                z.boolean(),
  totp_enrolled_at:            isoTimestamp,
  backup_codes:                z.array(z.string()).nullable(),
  pay_cycle:                   PayCycleSchema.nullable(),
  pay_basis:                   PayBasisSchema.nullable(),
  hourly_rate:                 z.number().nonnegative().nullable(),
  monthly_salary:              z.number().nonnegative().nullable(),
  standard_hours_per_day:      z.number().positive().nullable(),
  nis_applicable:              z.boolean().nullable(),
  health_surcharge_applicable: z.boolean().nullable(),
  tax_resident:                z.boolean().nullable(),
  created_at:                  isoTimestamp,
  updated_at:                  isoTimestamp,
});

export type EmployeeRow = z.infer<typeof EmployeeRowSchema>;

/** Payload for creating a new employee (server generates id / timestamps) */
export const AddEmployeeSchema = z.object({
  username:   z.string().min(2).max(50),
  full_name:  z.string().min(2).max(100),
  password:   z.string().min(8),
  role:       UserRoleSchema,
  status:     UserStatusSchema.default('active'),
  department_id: uuid.optional(),
  position:   z.string().max(100).optional(),
  email:      z.email().optional(),
  phone:      z.string().max(20).optional(),
  employee_number: z.string().max(20).optional(),
  pay_cycle:  PayCycleSchema.optional(),
  pay_basis:  PayBasisSchema.optional(),
  hourly_rate:   z.number().nonnegative().optional(),
  monthly_salary: z.number().nonnegative().optional(),
  standard_hours_per_day: z.number().positive().optional(),
  nis_applicable:              z.boolean().optional(),
  health_surcharge_applicable: z.boolean().optional(),
  tax_resident:                z.boolean().optional(),
});

export type AddEmployeePayload = z.infer<typeof AddEmployeeSchema>;

/** Payload for updating an existing employee */
export const UpdateEmployeeSchema = AddEmployeeSchema
  .omit({ username: true, password: true })
  .partial()
  .extend({ username: z.string().min(1) }); // username required to identify the row

export type UpdateEmployeePayload = z.infer<typeof UpdateEmployeeSchema>;

// ── Department ────────────────────────────────────────────────────────────────

export const DepartmentRowSchema = z.object({
  id:         uuid,
  name:       z.string().min(1).max(100),
  manager_id: uuid.nullable(),
  created_at: isoTimestamp,
});

export type DepartmentRow = z.infer<typeof DepartmentRowSchema>;

export const AddDepartmentSchema = z.object({
  name:       z.string().min(1).max(100),
  manager_id: uuid.optional(),
});

export type AddDepartmentPayload = z.infer<typeof AddDepartmentSchema>;

export const UpdateDepartmentSchema = AddDepartmentSchema.partial().extend({
  id: uuid,
});

export type UpdateDepartmentPayload = z.infer<typeof UpdateDepartmentSchema>;

// ── Shared "slim" list views ──────────────────────────────────────────────────

/** Minimal employee view used in dropdowns, assignment pickers, etc. */
export const EmployeeSlimSchema = z.object({
  id:        uuid,
  username:  z.string(),
  full_name: z.string(),
  role:      UserRoleSchema,
  status:    UserStatusSchema,
  department_id: uuid.nullable(),
  position:  z.string().nullable(),
  profile_image: z.string().nullable().optional(),
});

export type EmployeeSlim = z.infer<typeof EmployeeSlimSchema>;

// ── isoDate re-export for reuse in other schemas ──────────────────────────────
export { isoDate, isoTimestamp, uuid };
