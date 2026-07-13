/**
 * src/api/schemas/attendance.ts
 *
 * Zod schemas for the Attendance domain.
 *
 * @see docs/ARCHITECTURE.md §Validation
 * @see docs/CODING_STANDARDS.md
 * @see docs/PHASE_PLAN.md §Phase-2a
 */

import { z } from 'zod';
import { uuid, isoTimestamp } from './employee';

// ── Enums ─────────────────────────────────────────────────────────────────────

export const AttendanceStatusSchema = z.enum(['present', 'late', 'absent']);

// ── Attendance Row ────────────────────────────────────────────────────────────

export const AttendanceRowSchema = z.object({
  id:                   uuid,
  user_id:              uuid,
  username:             z.string(),
  work_date:            z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  check_in_time:        isoTimestamp,
  check_out_time:       isoTimestamp,
  total_hours:          z.number().nullable(),
  status:               AttendanceStatusSchema.nullable(),
  check_in_lat:         z.number().nullable(),
  check_in_lng:         z.number().nullable(),
  check_in_accuracy:    z.number().nullable(),
  check_in_photo_url:   z.url().nullable(),
  check_in_site_id:     uuid.nullable(),
  check_in_distance_m:  z.number().nullable(),
  check_out_lat:        z.number().nullable(),
  check_out_lng:        z.number().nullable(),
  check_out_accuracy:   z.number().nullable(),
  check_out_photo_url:  z.url().nullable(),
  check_out_site_id:    uuid.nullable(),
  check_out_distance_m: z.number().nullable(),
  notes:                z.string().nullable(),
  updated_at:           isoTimestamp,
});

export type AttendanceRow = z.infer<typeof AttendanceRowSchema>;

// ── Check-in payload ──────────────────────────────────────────────────────────

export const CheckInSchema = z.object({
  lat:       z.number().min(-90).max(90),
  lng:       z.number().min(-180).max(180),
  accuracy:  z.number().nonnegative().optional(),
  photo_url: z.url().optional(),
  site_id:   uuid.optional(),
  notes:     z.string().max(500).optional(),
});

export type CheckInPayload = z.infer<typeof CheckInSchema>;

// ── Check-out payload ─────────────────────────────────────────────────────────

export const CheckOutSchema = z.object({
  attendance_id: uuid,
  lat:           z.number().min(-90).max(90),
  lng:           z.number().min(-180).max(180),
  accuracy:      z.number().nonnegative().optional(),
  photo_url:     z.url().optional(),
  site_id:       uuid.optional(),
  notes:         z.string().max(500).optional(),
});

export type CheckOutPayload = z.infer<typeof CheckOutSchema>;

// ── Filter schemas ────────────────────────────────────────────────────────────

export const MonthFilterSchema = z.object({
  month: z.number().int().min(1).max(12),
  year:  z.number().int().min(2020).max(2100),
});

export type MonthFilter = z.infer<typeof MonthFilterSchema>;

export const DateRangeFilterSchema = z.object({
  dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  dateTo:   z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export type DateRangeFilter = z.infer<typeof DateRangeFilterSchema>;

export const AttendanceFilterSchema = z.union([MonthFilterSchema, DateRangeFilterSchema]);
export type AttendanceFilter = z.infer<typeof AttendanceFilterSchema>;
