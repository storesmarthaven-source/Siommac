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
import { uuid, isoTimestamp } from './employee';

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
  id:         uuid,
  user_id:    uuid,
  type:       NotificationTypeSchema,
  title:      z.string().min(1),
  body:       z.string(),
  is_read:    z.boolean(),
  link:       z.string().nullable(),
  created_at: isoTimestamp,
});

export type NotificationRow = z.infer<typeof NotificationRowSchema>;

// ── Notification preference row ───────────────────────────────────────────────

export const NotificationPreferenceSchema = z.object({
  user_id:  uuid,
  type:     NotificationTypeSchema,
  enabled:  z.boolean(),
  in_app:   z.boolean(),
  email:    z.boolean(),
  whatsapp: z.boolean(),
});

export type NotificationPreferenceRow = z.infer<typeof NotificationPreferenceSchema>;

// ── Send notification payload (used by backend / admin) ──────────────────────

export const SendNotificationSchema = z.object({
  user_id: uuid,
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
