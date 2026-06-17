// lib/validate.ts — Zod schemas and validation helper
// All route handlers call zv() to parse + validate input before touching the DB.
// On failure it returns a typed 400 response; on success it returns the parsed data.

import { z } from 'zod';
import type { Context } from 'hono';
import type { HonoVariables } from '../../../types/api';

export { z };

// ── Helper ────────────────────────────────────────────────────────────────────

type ZvResult<T> =
  | { ok: true;  data: T }
  | { ok: false; response: Response };

/**
 * Parse `input` against `schema`.
 * Returns `{ ok: true, data }` on success or `{ ok: false, response }` on failure.
 * Usage: `const v = zv(c, MySchema, args); if (!v.ok) return v.response;`
 */
export function zv<T>(
  c: Context<{ Variables: HonoVariables }>,
  schema: z.ZodType<T>,
  input: unknown,
): ZvResult<T> {
  const result = schema.safeParse(input);
  if (!result.success) {
    const issues = result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ');
    return {
      ok: false,
      response: c.json({ success: false, message: `Validation error: ${issues}` }, 400) as Response,
    };
  }
  return { ok: true, data: result.data };
}

// ── Reusable primitives ───────────────────────────────────────────────────────

export const zUsername   = z.string().min(1).max(64).regex(/^[a-zA-Z0-9_.\-@]+$/, 'Invalid characters in username');
export const zPassword   = z.string().min(6).max(128);
export const zUuid       = z.string().uuid();
export const zDateStr    = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD');
export const zHHMM       = z.string().regex(/^\d{2}:\d{2}$/, 'Must be HH:MM');
export const zRole       = z.enum(['admin', 'manager', 'employee']);
export const zStatus     = z.enum(['active', 'inactive']);
export const zLeaveType  = z.enum(['sick', 'casual', 'annual', 'medical']);
export const zPayCycle   = z.enum(['weekly', 'biweekly', 'monthly']);
export const zPayBasis   = z.enum(['salary', 'hourly']);
export const zBase64Img  = z.string().max(8 * 1024 * 1024, 'Image too large').optional();
export const zShortStr   = (max = 255) => z.string().min(1).max(max);
export const zOptStr     = (max = 255) => z.string().max(max).optional();
export const zPosFloat   = z.number().nonnegative();
export const zLat        = z.number().min(-90).max(90);
export const zLng        = z.number().min(-180).max(180);

// ── Auth schemas ──────────────────────────────────────────────────────────────

export const LoginSchema = z.object({
  username: zUsername,
  password: z.string().min(1).max(128),
});

// 2FA — TOTP code (6 digits) or backup code (8 alphanumeric chars)
export const zTotpCode   = z.string().regex(/^\d{6}$/, 'Must be a 6-digit code');
export const zBackupCode = z.string().regex(/^[A-Z0-9]{8}$/i, 'Must be an 8-character backup code');

export const Verify2faSchema = z.object({
  preAuthToken: z.string().min(1).max(256),
  code:         z.string().min(6).max(8),   // 6-digit TOTP or 8-char backup code
});

export const Setup2faInitSchema = z.object({
  preAuthToken: z.string().min(1).max(256),
});

export const Setup2faConfirmSchema = z.object({
  preAuthToken: z.string().min(1).max(256),
  code:         zTotpCode,
});

export const Disable2faSchema = z.object({
  password: z.string().min(1).max(128),
});

export const UpdateColorSchemeSchema = z.object({
  username: zUsername,
  scheme:   zShortStr(32),
});

export const UpdateLayoutModeSchema = z.object({
  username: zUsername,
  mode:     z.enum(['sidebar', 'topbar']),
});

export const UpdateMyProfileSchema = z.object({
  username:           zUsername,
  fullName:           zShortStr(128).optional(),
  email:              z.string().email().max(128).optional().or(z.literal('')),
  phone:              z.string().max(32).optional(),
  oldPassword:        zPassword.optional(),
  newPassword:        zPassword.optional(),
  profileImageBase64: zBase64Img,
  removeProfileImage: z.boolean().optional(),
});

export const VerifyPasswordSchema = z.object({
  password: z.string().min(1).max(128),
});

// ── Employee schemas ──────────────────────────────────────────────────────────

export const AddEmployeeSchema = z.object({
  username:                  zUsername,
  password:                  zPassword,
  fullName:                  zShortStr(128),
  role:                      zRole,
  department:                z.string().max(64).optional(),
  position:                  zOptStr(128),
  employeeNumber:            zOptStr(32),
  email:                     z.string().email().max(128).optional().or(z.literal('')),
  phone:                     zOptStr(32),
  payCycle:                  zPayCycle.optional(),
  payBasis:                  zPayBasis.optional(),
  hourlyRate:                z.number().nonnegative().optional(),
  monthlySalary:             z.number().nonnegative().optional(),
  standardHoursPerDay:       z.number().min(1).max(24).optional(),
  nisApplicable:             z.boolean().optional(),
  healthSurchargeApplicable: z.boolean().optional(),
  taxResident:               z.boolean().optional(),
});

export const UpdateEmployeeSchema = z.object({
  username:                  zUsername,
  fullName:                  zShortStr(128).optional(),
  role:                      zRole.optional(),
  department:                z.string().max(64).optional(),
  position:                  zOptStr(128),
  status:                    zStatus.optional(),
  employeeNumber:            zOptStr(32),
  email:                     z.string().email().max(128).optional().or(z.literal('')),
  phone:                     zOptStr(32),
  password:                  zPassword.optional(),
  payCycle:                  zPayCycle.optional(),
  payBasis:                  zPayBasis.optional(),
  hourlyRate:                z.number().nonnegative().optional(),
  monthlySalary:             z.number().nonnegative().optional(),
  standardHoursPerDay:       z.number().min(1).max(24).optional(),
  nisApplicable:             z.boolean().optional(),
  healthSurchargeApplicable: z.boolean().optional(),
  taxResident:               z.boolean().optional(),
  profileImageBase64:        zBase64Img,
  removeProfileImage:        z.boolean().optional(),
});

export const DeleteEmployeeSchema = z.object({
  username: zUsername,
});

export const GetEmployeeSchema = z.object({
  username: zUsername,
});

// ── Department schemas ────────────────────────────────────────────────────────

export const AddDepartmentSchema = z.object({
  name:      zShortStr(128),
  managerId: z.string().max(64).optional(),
});

export const UpdateDepartmentSchema = z.object({
  id:        zShortStr(64),
  name:      zShortStr(128).optional(),
  managerId: z.string().max(64).optional(),
});

export const DeleteDepartmentSchema = z.object({
  id: zShortStr(64),
});

// ── Site schemas ──────────────────────────────────────────────────────────────

export const AddSiteSchema = z.object({
  name:         zShortStr(128),
  address:      zOptStr(256),
  latitude:     zLat,
  longitude:    zLng,
  radius:       z.number().min(10).max(10_000).optional(),
  status:       z.enum(['active', 'inactive']).optional(),
  departmentId: zShortStr(64).nullish(),   // null/omitted = org-wide (unassigned)
});

export const UpdateSiteSchema = z.object({
  id:           zShortStr(64),
  name:         zShortStr(128).optional(),
  address:      zOptStr(256),
  latitude:     zLat.optional(),
  longitude:    zLng.optional(),
  radius:       z.number().min(10).max(10_000).optional(),
  status:       z.enum(['active', 'inactive']).optional(),
  departmentId: zShortStr(64).nullish(),   // null = clear (org-wide)
});

export const DeleteSiteSchema = z.object({
  id: zShortStr(64),
});

export const AssignSiteEmployeesSchema = z.object({
  siteId:      zShortStr(64),
  employeeIds: z.array(z.string().max(64)).max(500),
});

// ── Attendance schemas ────────────────────────────────────────────────────────

export const MarkAttendanceSchema = z.object({
  username:    zUsername,
  action:      z.enum(['CheckIn', 'CheckOut', 'Project']),
  siteId:      z.string().max(64).optional(),
  photoBase64: zBase64Img,
  location: z.object({
    latitude:  zLat,
    longitude: zLng,
    accuracy:  z.number().nonnegative().optional(),
  }).optional(),
});

export const GetMyStatusSchema = z.object({
  username: zUsername.optional(),
});

export const GetMyHistorySchema = z.object({
  days: z.number().int().min(1).max(365).optional(),
});

export const GetMyChartSchema = z.object({
  year:  z.number().int().min(2000).max(2100).optional(),
  month: z.number().int().min(0).max(11).optional(),
});

export const ListAttendanceSchema = z.object({
  year:  z.number().int().min(2000).max(2100).optional(),
  month: z.number().int().min(0).max(11).optional(),
});

export const ListDailyLogSchema = z.object({
  year:     z.number().int().min(2000).max(2100).optional(),
  month:    z.number().int().min(0).max(11).optional(),
  dateFrom: zDateStr.optional(),
  dateTo:   zDateStr.optional(),
});

export const GetLiveAttendanceSchema = z.object({
  scope: z.string().max(64).optional(),
});

export const GetRecentAttendanceSchema = z.object({
  limit: z.number().int().min(1).max(50).optional(),
});

export const GetDeptStatsSchema = z.object({
  departmentId: z.string().max(64).optional(),
});

// ── Leave schemas ─────────────────────────────────────────────────────────────

export const SubmitLeaveSchema = z.object({
  type:     zLeaveType,
  fromDate: zDateStr,
  toDate:   zDateStr,
  reason:   z.string().min(1).max(1000),
});

export const GetLeaveByIdSchema = z.object({
  leaveId: zShortStr(64),
});

export const UpdateLeaveSchema = z.object({
  id:       zShortStr(64),
  type:     zLeaveType.optional(),
  fromDate: zDateStr.optional(),
  toDate:   zDateStr.optional(),
  reason:   z.string().min(1).max(1000).optional(),
});

export const DeleteLeaveSchema = z.object({
  leaveId: zShortStr(64),
});

export const DecideLeaveSchema = z.object({
  leaveId: zShortStr(64),
  notes:   z.string().max(1000).optional(),
});

// ── Payroll schemas ───────────────────────────────────────────────────────────

export const RunPayrollSchema = z.object({
  payCycle:  zPayCycle,
  periodEnd: zDateStr,
});

export const GetPayslipSchema = z.object({
  entryId: zShortStr(64),
});

export const GetPayrollRunSchema = z.object({
  runId: zShortStr(64),
});

export const ListPayrollRunsSchema = z.object({
  limit: z.number().int().min(1).max(100).optional(),
});

export const ApprovePayrollSchema = z.object({
  runId: zShortStr(64),
});

export const GetEmployeePayrollSchema = z.object({
  userId:    z.string().max(64).optional(),
  username:  zUsername.optional(),
  payCycle:  zPayCycle.optional(),
  periodEnd: zDateStr.optional(),
});

// ── Settings schemas ──────────────────────────────────────────────────────────

export const UpdateSettingSchema = z.object({
  key:   z.string().min(1).max(64).regex(/^[a-zA-Z0-9_]+$/, 'Key must be alphanumeric'),
  value: z.string().max(4096),
});

export const SaveWorkHoursSchema = z.object({
  start: zHHMM,
  end:   zHHMM,
}).refine(d => d.start < d.end, { message: 'start must be before end' });

export const UpdateHourlyRateSchema = z.object({
  userId:      z.string().max(64),
  hourlyRate:  z.number().nonnegative(),
});

export const BulkImportRatesSchema = z.object({
  rates: z.array(z.object({
    userId:     z.string().max(64),
    hourlyRate: z.number().nonnegative(),
  })).max(500),
});

export const UploadLogoSchema = z.object({
  imageBase64: z.string().min(1).max(8 * 1024 * 1024),
});

// ── Message schemas ───────────────────────────────────────────────────────────

export const SendMessageSchema = z.object({
  recipientId: z.string().max(64),
  content:     z.string().min(1).max(5000),
});

export const GetMessagesSchema = z.object({
  withUserId: z.string().max(64),
  limit:      z.number().int().min(1).max(200).optional(),
});

export const MarkMessageReadSchema = z.object({
  messageId: zShortStr(64),
});

// ── Ticket schemas ────────────────────────────────────────────────────────────

export const CreateTicketSchema = z.object({
  subject:  z.string().min(1).max(256),
  body:     z.string().min(1).max(10_000),
  priority: z.enum(['low', 'medium', 'high']).optional(),
});

export const UpdateTicketSchema = z.object({
  ticketId: zShortStr(64),
  status:   z.enum(['open', 'in_progress', 'resolved', 'closed']).optional(),
  priority: z.enum(['low', 'medium', 'high']).optional(),
  body:     z.string().min(1).max(10_000).optional(),
});

export const GetTicketSchema = z.object({
  ticketId: zShortStr(64),
});

export const ReplyTicketSchema = z.object({
  ticketId: zShortStr(64),
  body:     z.string().min(1).max(10_000),
});

// ── Notification schemas ──────────────────────────────────────────────────────

export const GetNotificationsSchema = z.object({
  limit:  z.number().int().min(1).max(100).optional(),
  offset: z.number().int().min(0).optional(),
});

export const MarkNotificationReadSchema = z.object({
  notificationId: zShortStr(64),
});

export const SendNotificationSchema = z.object({
  userId:  z.string().max(64).optional(),
  role:    zRole.optional(),
  title:   z.string().min(1).max(256),
  message: z.string().min(1).max(2000),
  type:    z.enum(['info', 'warning', 'success', 'error']).optional(),
});
