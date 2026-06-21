/**
 * src/api/schemas/notification.ts
 *
 * Zod schemas for the Notifications domain.
 *
 * @see docs/ARCHITECTURE.md §10-Realtime
 * @see docs/CODING_STANDARDS.md §2-TypeScript-Rules
 * @see docs/PHASE_PLAN.md §Phase-2c
 */

import { z } from 'zod';
import { isoTimestamp } from './employee';

/**
 * App user / record ids are TEXT (app_users.id like "USR-…"), not UUID. The old
 * `uuid` validator rejected every real row — see docs/COMMUNICATIONS_BACKBONE.md.
 */
const appId = z.string().min(1).max(64);

// ── Notification type enum ────────────────────────────────────────────────────

export const NotificationTypeSchema = z.enum([
  'attendance_late',
  'attendance_absent',
  'attendance_missed_checkout',
  'leave_approved',
  'leave_rejected',
  'leave_pending',
  'payroll_published',
  'system_announcement',
  'mention',
]);

export type NotificationType = z.infer<typeof NotificationTypeSchema>;

/** Human-readable labels for each notification type (used in preferences UI) */
export const NOTIFICATION_TYPE_LABELS: Record<NotificationType, string> = {
  attendance_late:              'Attendance — Late arrival',
  attendance_absent:            'Attendance — Absent',
  attendance_missed_checkout:   'Attendance — Missed clock-out',
  leave_approved:               'Leave — Approved',
  leave_rejected:               'Leave — Rejected',
  leave_pending:                'Leave — New request (manager/admin)',
  payroll_published:            'Payroll — Payslip published',
  system_announcement:          'System announcements',
  mention:                      'Direct mentions',
};

// ── Notification row ──────────────────────────────────────────────────────────

export const NotificationRowSchema = z.object({
  id:         appId,
  // Backend scopes to the JWT actor and omits user_id from the payload; keep it
  // optional so server-scoped rows validate.
  user_id:    appId.optional(),
  // `type` is permissive: the persisted/synthetic notification stream may carry
  // types beyond the curated enum. Validate as string; UI maps known types.
  type:       z.string().min(1),
  title:      z.string().min(1),
  body:       z.string().nullable().default(''),
  is_read:    z.boolean(),
  link:       z.string().nullable(),
  created_at: isoTimestamp,
});

export type NotificationRow = z.infer<typeof NotificationRowSchema>;

// ── Notification preference row ───────────────────────────────────────────────

export const NotificationPreferenceSchema = z.object({
  // user_id omitted by the server-scoped read; optional.
  user_id:  appId.optional(),
  type:     z.string().min(1),
  // `enabled` is a legacy/derived field the backend may not return; optional.
  enabled:  z.boolean().optional(),
  in_app:   z.boolean(),
  email:    z.boolean(),
  whatsapp: z.boolean(),
});

export type NotificationPreferenceRow = z.infer<typeof NotificationPreferenceSchema>;

// ── Send notification payload (used by backend / admin) ──────────────────────

export const SendNotificationSchema = z.object({
  user_id: appId,
  type:    NotificationTypeSchema,
  title:   z.string().min(1).max(200),
  body:    z.string().max(1000).default(''),
  link:    z.string().max(200).optional(),
});

export type SendNotificationPayload = z.infer<typeof SendNotificationSchema>;

// ── Update preferences payload ────────────────────────────────────────────────

export const UpdatePreferenceSchema = z.object({
  type:     NotificationTypeSchema,
  enabled:  z.boolean().optional(),
  in_app:   z.boolean().optional(),
  email:    z.boolean().optional(),
  whatsapp: z.boolean().optional(),
});

export type UpdatePreferencePayload = z.infer<typeof UpdatePreferenceSchema>;
