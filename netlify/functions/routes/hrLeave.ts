// routes/hrLeave.ts -- HR Leave and Absence API router (POST-only, Hono)
// Mounted at /api/hr/leave/* in api.ts

import { Hono, type Context } from 'hono';
import { requirePermission }  from '../lib/auth';
import type { HonoVariables } from '../../../types/api';

import { listLeaveTypes, getLeaveType, createLeaveType, updateLeaveType, retireLeaveType } from '../lib/hr/leaveTypes';
import { listMyLeaveRequests, listTeamLeaveRequests, listAllLeaveRequests, getLeaveRequest, getAllBalancesForEmployee, getLeaveBalance, getCalendar, getLeaveStats } from '../lib/hr/leaveQueries';
import { submitLeaveRequest } from '../lib/hr/leaveCore';
import { updateLeaveRequest, approveLeaveRequest, rejectLeave, cancelLeave } from '../lib/hr/leaveMutations';
import { runAccruals, adjustBalance } from '../lib/hr/leaveAccruals';
import { listLeaveReports, runLeaveReport, exportLeaveReport } from '../lib/hr/leaveReports';

const router = new Hono<{ Variables: HonoVariables }>();

const body = (c: Context<{ Variables: HonoVariables }>): Record<string, unknown> => {
  const b = c.get('body') as Record<string, unknown> | undefined;
  if (!b) return {};
  return (b.args as Record<string, unknown> | undefined) ?? b;
};

async function mutate<T>(c: Context<{ Variables: HonoVariables }>, fn: () => Promise<T>): Promise<Response> {
  try { return c.json({ success: true, data: await fn() }); }
  catch (e) {
    const er = e as { status?: number; message?: string };
    return c.json({ success: false, message: er.message ?? 'Request failed.' }, (er.status ?? 500) as 200);
  }
}

router.post('/leave/types/list', async c => {
  await requirePermission(c, 'hr.leave.view');
  const b = body(c);
  const includeInactive = b.includeInactive === true;
  return mutate(c, () => listLeaveTypes(includeInactive));
});

router.post('/leave/types/get', async c => {
  await requirePermission(c, 'hr.leave.view');
  const b = body(c);
  if (!b.id) return c.json({ success: false, message: 'id is required.' }, 400);
  return mutate(c, () => getLeaveType(b.id as string));
});

router.post('/leave/types/create', async c => {
  const actor = await requirePermission(c, 'hr.leave.types.manage');
  const b = body(c);
  if (!b.code || !b.label) return c.json({ success: false, message: 'code and label are required.' }, 400);
  return mutate(c, () => createLeaveType(actor.id, b as unknown as Parameters<typeof createLeaveType>[1]));
});

router.post('/leave/types/update', async c => {
  const actor = await requirePermission(c, 'hr.leave.types.manage');
  const b = body(c);
  if (!b.id) return c.json({ success: false, message: 'id is required.' }, 400);
  return mutate(c, () => updateLeaveType(actor.id, b.id as string, b as unknown as Parameters<typeof updateLeaveType>[2]));
});

router.post('/leave/types/retire', async c => {
  const actor = await requirePermission(c, 'hr.leave.types.manage');
  const b = body(c);
  if (!b.id) return c.json({ success: false, message: 'id is required.' }, 400);
  return mutate(c, () => retireLeaveType(actor.id, b.id as string));
});
router.post('/leave/request/submit', async c => {
  const actor = await requirePermission(c, 'hr.leave.submit');
  const b = body(c);
  if (!b.leaveTypeId || !b.fromDate || !b.toDate) {
    return c.json({ success: false, message: 'leaveTypeId, fromDate, toDate are required.' }, 400);
  }
  const employeeId = (b.employeeId as string | undefined) ?? actor.id;
  return mutate(c, () => submitLeaveRequest(actor.id, { ...b, employeeId } as Parameters<typeof submitLeaveRequest>[1]));
});

router.post('/leave/request/list', async c => {
  const actor = await requirePermission(c, 'hr.leave.view');
  const b = body(c);
  return mutate(c, () => listMyLeaveRequests(actor.id, b as unknown as Parameters<typeof listMyLeaveRequests>[1]));
});

router.post('/leave/request/list-all', async c => {
  const actor = await requirePermission(c, 'hr.leave.view_all');
  const b = body(c);
  if (['manager'].includes(actor.role) && actor.department_id) {
    return mutate(c, () => listTeamLeaveRequests(actor.id, actor.role, actor.department_id ?? null, b as unknown as Parameters<typeof listTeamLeaveRequests>[3]));
  }
  return mutate(c, () => listAllLeaveRequests(b as unknown as Parameters<typeof listAllLeaveRequests>[0]));
});

router.post('/leave/request/get', async c => {
  await requirePermission(c, 'hr.leave.view');
  const b = body(c);
  if (!b.requestId) return c.json({ success: false, message: 'requestId is required.' }, 400);
  return mutate(c, () => getLeaveRequest(b.requestId as string));
});

router.post('/leave/request/update', async c => {
  const actor = await requirePermission(c, 'hr.leave.submit');
  const b = body(c);
  if (!b.requestId) return c.json({ success: false, message: 'requestId is required.' }, 400);
  return mutate(c, () => updateLeaveRequest(actor.id, b as unknown as Parameters<typeof updateLeaveRequest>[1]));
});

router.post('/leave/request/cancel', async c => {
  const actor = await requirePermission(c, 'hr.leave.cancel_own');
  const b = body(c);
  if (!b.requestId) return c.json({ success: false, message: 'requestId is required.' }, 400);
  // A cancellation reason is mandatory (matches the UI) and is persisted to the audit trail.
  if (typeof b.reason !== 'string' || !b.reason.trim()) return c.json({ success: false, message: 'A reason is required to cancel a leave request.' }, 400);
  return mutate(c, () => cancelLeave(actor.id, b as unknown as Parameters<typeof cancelLeave>[1]));
});

router.post('/leave/request/approve', async c => {
  const actor = await requirePermission(c, 'hr.leave.approve');
  const b = body(c);
  if (!b.requestId) return c.json({ success: false, message: 'requestId is required.' }, 400);
  return mutate(c, () => approveLeaveRequest(actor.id, b as unknown as Parameters<typeof approveLeaveRequest>[1]));
});
router.post('/leave/request/reject', async c => {
  const actor = await requirePermission(c, 'hr.leave.approve');
  const b = body(c);
  if (!b.requestId || !b.reviewNotes) return c.json({ success: false, message: 'requestId and reviewNotes are required.' }, 400);
  return mutate(c, () => rejectLeave(actor.id, b as unknown as Parameters<typeof rejectLeave>[1]));
});

router.post('/leave/balances/get', async c => {
  const actor = await requirePermission(c, 'hr.leave.balances.view');
  const b = body(c);
  const employeeId = (b.employeeId as string | undefined) ?? actor.id;
  const year       = Number(b.year ?? new Date().getFullYear());
  if (b.leaveTypeId) {
    return mutate(c, () => getLeaveBalance(employeeId, b.leaveTypeId as string, year));
  }
  return mutate(c, () => getAllBalancesForEmployee(employeeId, year));
});

router.post('/leave/balances/adjust', async c => {
  const actor = await requirePermission(c, 'hr.leave.balances.adjust');
  const b = body(c);
  if (!b.employeeId || !b.leaveTypeId || b.delta == null || !b.year || !b.reason) {
    return c.json({ success: false, message: 'employeeId, leaveTypeId, year, delta, reason are required.' }, 400);
  }
  return mutate(c, () => adjustBalance(actor.id, b as unknown as Parameters<typeof adjustBalance>[1]));
});

router.post('/leave/accruals/run', async c => {
  const actor = await requirePermission(c, 'hr.leave.accruals.run');
  const b = body(c);
  if (!b.period) return c.json({ success: false, message: 'period is required.' }, 400);
  return mutate(c, () => runAccruals(actor.id, b as unknown as Parameters<typeof runAccruals>[1]));
});

router.post('/leave/calendar/get', async c => {
  await requirePermission(c, 'hr.leave.calendar.view');
  const b = body(c);
  if (!b.fromDate || !b.toDate) return c.json({ success: false, message: 'fromDate and toDate are required.' }, 400);
  return mutate(c, () => getCalendar(b as unknown as Parameters<typeof getCalendar>[0]));
});

router.post('/leave/stats', async c => {
  const actor = await requirePermission(c, 'hr.leave.view');
  return mutate(c, () => getLeaveStats(actor.id, actor.role, actor.department_id ?? null));
});

router.post('/leave/reports/list', async c => {
  await requirePermission(c, 'hr.leave.reports.view');
  return c.json({ success: true, data: listLeaveReports() });
});

router.post('/leave/reports/run', async c => {
  await requirePermission(c, 'hr.leave.reports.view');
  const b = body(c);
  if (!b.reportKey) return c.json({ success: false, message: 'reportKey is required.' }, 400);
  return mutate(c, () => runLeaveReport(b as unknown as Parameters<typeof runLeaveReport>[0]));
});

router.post('/leave/reports/export', async c => {
  const actor = await requirePermission(c, 'hr.leave.reports.export');
  const b = body(c);
  if (!b.reportKey) return c.json({ success: false, message: 'reportKey is required.' }, 400);
  return mutate(c, () => exportLeaveReport(actor.id, b as unknown as Parameters<typeof exportLeaveReport>[1]));
});

export default router;
