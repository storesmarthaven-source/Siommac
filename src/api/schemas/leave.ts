/**
 * src/api/schemas/leave.ts
 *
 * Zod schemas for the Leave Request domain.
 *
 * @see docs/ARCHITECTURE.md §Validation
 * @see docs/CODING_STANDARDS.md
 * @see docs/PHASE_PLAN.md §Phase-2a
 */

import { z } from 'zod';
import { uuid, isoTimestamp } from './employee';

// ── Enums ─────────────────────────────────────────────────────────────────────

export const LeaveStatusSchema = z.enum(['pending', 'approved', 'rejected']);
export const LeaveTypeSchema   = z.enum(['sick', 'casual', 'annual', 'medical']);

// ── Leave Row ─────────────────────────────────────────────────────────────────

export const LeaveRowSchema = z.object({
  id:            uuid,
  user_id:       uuid,
  username:      z.string(),
  department_id: uuid.nullable(),
  type:          z.string(),   // allow custom leave types beyond the enum
  from_date:     z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to_date:       z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  reason:        z.string().nullable(),
  status:        LeaveStatusSchema,
  reviewed_by:   z.string().nullable(),
  reviewed_at:   isoTimestamp,
  created_at:    isoTimestamp,
  updated_at:    isoTimestamp,
});

export type LeaveRow = z.infer<typeof LeaveRowSchema>;

// ── Submit leave ──────────────────────────────────────────────────────────────

export const SubmitLeaveSchema = z.object({
  type:      z.string().min(1),
  from_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD'),
  to_date:   z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD'),
  reason:    z.string().max(1000).optional(),
}).refine(
  (d) => d.from_date <= d.to_date,
  { message: 'from_date must not be after to_date', path: ['from_date'] },
);

export type SubmitLeavePayload = z.infer<typeof SubmitLeaveSchema>;

// ── Review leave (admin / manager) ───────────────────────────────────────────

export const ReviewLeaveSchema = z.object({
  id:     uuid,
  status: z.enum(['approved', 'rejected']),
  reason: z.string().max(500).optional(),
});

export type ReviewLeavePayload = z.infer<typeof ReviewLeaveSchema>;
