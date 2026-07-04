// routes/hrRequests.ts — HR Requests (Request Center).
//
// Employee self-service requests (employment letters, document copies, inquiries,
// profile corrections) + HR triage (decide, fulfill). POST-only pattern, envelope
// {success,data}, body.args. Self-scope SERVER-SIDE invariant.

import { Hono, type Context } from 'hono';
import { requirePermission, userCan } from '../lib/auth';
import { z, zv }                      from '../lib/validate';
import { submitRequest }               from '../lib/hr/requestsCore';
import { listMyRequests, listAllRequests, getRequest } from '../lib/hr/requestsQueries';
import { decideRequest, fulfillRequest, cancelRequest } from '../lib/hr/requestsMutations';
import { REQUEST_TYPE_CATALOGUE }      from '../../../types/hrRequests';
import type { HonoVariables }          from '../../../types/api';

const router = new Hono<{ Variables: HonoVariables }>();

const body = (c: Context<{ Variables: HonoVariables }>) =>
  (c.get('body') as Record<string, unknown>).args ?? {};

function fail(c: Context<{ Variables: HonoVariables }>, e: unknown): Response {
  const er = e as { status?: number; message?: string };
  return c.json({ success: false, message: er.message ?? 'Request failed.' }, (er.status ?? 500) as 200);
}

const VALID_TYPE_KEYS = ['employment_letter','document_copy','profile_correction','general_inquiry','reference_letter','salary_certificate'] as const;
const PRIORITIES = ['low', 'normal', 'high'] as const;
const DECISIONS  = ['approved', 'rejected', 'returned'] as const;

// ── /requests/types — catalogue (any authenticated user) ─────────────────────

router.post('/requests/types', async c => {
  await requirePermission(c, 'hr.requests.submit_own');
  return c.json({ success: true, data: REQUEST_TYPE_CATALOGUE });
});

// ── /requests/submit — employee submits a request ────────────────────────────

router.post('/requests/submit', async c => {
  const actor = await requirePermission(c, 'hr.requests.submit_own');
  const v = zv(c, z.object({
    requestType: z.enum(VALID_TYPE_KEYS),
    title:       z.string().min(1).max(256),
    details:     z.record(z.string(), z.unknown()).optional(),
    priority:    z.enum(PRIORITIES).optional(),
    employeeId:  z.string().min(1).optional(), // HR-only override
  }), body(c));
  if (!v.ok) return v.response;

  // Self-scope enforcement: if the caller lacks manage, force employee_id to their own id.
  let resolvedEmployeeId = actor.id;
  if (v.data.employeeId && v.data.employeeId !== actor.id) {
    const canManage = await userCan(actor, 'hr.requests.manage');
    if (!canManage) {
      return c.json({ success: false, message: 'You may only submit requests for yourself.' }, 403 as 200);
    }
    resolvedEmployeeId = v.data.employeeId;
  }

  try {
    const result = await submitRequest(actor.id, resolvedEmployeeId, {
      requestType: v.data.requestType,
      title:       v.data.title,
      details:     v.data.details,
      priority:    v.data.priority,
    });
    return c.json({ success: true, data: result });
  } catch (e) { return fail(c, e); }
});

// ── /requests/my — caller's own requests ─────────────────────────────────────

router.post('/requests/my', async c => {
  const actor = await requirePermission(c, 'hr.requests.submit_own');
  try {
    return c.json({ success: true, data: await listMyRequests(actor.id) });
  } catch (e) { return fail(c, e); }
});

// ── /requests/list — HR triage: all requests ─────────────────────────────────

router.post('/requests/list', async c => {
  await requirePermission(c, 'hr.requests.manage');
  const v = zv(c, z.object({
    status:      z.string().max(32).optional(),
    requestType: z.string().max(64).optional(),
    employeeId:  z.string().max(128).optional(),
  }), body(c));
  if (!v.ok) return v.response;
  try {
    return c.json({ success: true, data: await listAllRequests(v.data) });
  } catch (e) { return fail(c, e); }
});

// ── /requests/get — single request: manage OR own ────────────────────────────

router.post('/requests/get', async c => {
  const actor = await requirePermission(c, 'hr.requests.submit_own');
  const v = zv(c, z.object({ requestId: z.string().uuid() }), body(c));
  if (!v.ok) return v.response;
  try {
    const req = await getRequest(v.data.requestId);
    if (!req) return c.json({ success: false, message: 'Request not found.' }, 404 as 200);

    // Self-scope: an actor without manage may only see their own requests.
    if (req.employeeId !== actor.id) {
      const canManage = await userCan(actor, 'hr.requests.manage');
      if (!canManage) {
        return c.json({ success: false, message: 'Forbidden.' }, 403 as 200);
      }
    }
    return c.json({ success: true, data: req });
  } catch (e) { return fail(c, e); }
});

// ── /requests/decide — approve / reject / return (manage only) ────────────────

router.post('/requests/decide', async c => {
  const actor = await requirePermission(c, 'hr.requests.manage');
  const v = zv(c, z.object({
    requestId: z.string().uuid(),
    decision:  z.enum(DECISIONS),
    comment:   z.string().max(1000).optional(),
    taskId:    z.string().uuid().optional(),
  }).superRefine((val, ctx) => {
    // A comment is mandatory when rejecting or returning (matches the UI DecideModal).
    if ((val.decision === 'rejected' || val.decision === 'returned') && !val.comment?.trim()) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['comment'], message: 'A comment is required to reject or return a request.' });
    }
  }), body(c));
  if (!v.ok) return v.response;
  try {
    return c.json({ success: true, data: await decideRequest(actor.id, v.data) });
  } catch (e) { return fail(c, e); }
});

// ── /requests/fulfill — mark fulfilled (manage only) ─────────────────────────

router.post('/requests/fulfill', async c => {
  const actor = await requirePermission(c, 'hr.requests.manage');
  const v = zv(c, z.object({
    requestId:   z.string().uuid(),
    note:        z.string().max(2000).optional(),
    artifactRef: z.string().max(512).optional(),
  }), body(c));
  if (!v.ok) return v.response;
  try {
    return c.json({ success: true, data: await fulfillRequest(actor.id, v.data) });
  } catch (e) { return fail(c, e); }
});

// ── /requests/cancel — requester cancels own, or manage cancels any ──────────

router.post('/requests/cancel', async c => {
  const actor = await requirePermission(c, 'hr.requests.submit_own');
  const v = zv(c, z.object({
    requestId: z.string().uuid(),
    reason:    z.string().trim().min(1, 'A reason is required to cancel a request.').max(500),
  }), body(c));
  if (!v.ok) return v.response;
  try {
    const req = await getRequest(v.data.requestId);
    if (!req) return c.json({ success: false, message: 'Request not found.' }, 404 as 200);

    // Self-scope enforcement: only manage can cancel others' requests.
    if (req.employeeId !== actor.id) {
      const canManage = await userCan(actor, 'hr.requests.manage');
      if (!canManage) {
        return c.json({ success: false, message: 'Forbidden.' }, 403 as 200);
      }
    }
    return c.json({ success: true, data: await cancelRequest(actor.id, v.data) });
  } catch (e) { return fail(c, e); }
});

export default router;
