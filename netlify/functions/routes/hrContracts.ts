// routes/hrContracts.ts — HR Contract Management.
//
// Templates → issue → sign → active → renew/terminate/cancel/expire. Distinct from
// HSE Contractors (contractor-company safety). POST-only; gated by hr.contracts.*;
// envelope {success,data}; body = body.args. Mount at /api/hr in api.ts.

import { Hono, type Context } from 'hono';
import { requirePermission } from '../lib/auth';
import { z, zv }             from '../lib/validate';
import {
  createContract, issueContract, recordSignature, activateContract, renewContract,
  terminateContract, cancelContract, expireContracts,
  createTemplate, updateTemplate, retireTemplate,
} from '../lib/hr/contractsService';
import { listTemplates, listContracts, getContractDetail, getContractDashboardStats } from '../lib/hr/contractsQueries';
import type { HonoVariables } from '../../../types/api';

const router = new Hono<{ Variables: HonoVariables }>();
const body = (c: Context<{ Variables: HonoVariables }>) => (c.get('body') as Record<string, unknown>).args ?? {};
function fail(c: Context<{ Variables: HonoVariables }>, e: unknown): Response {
  const er = e as { status?: number; message?: string };
  return c.json({ success: false, message: er.message ?? 'Request failed.' }, (er.status ?? 500) as 200);
}

const CONTRACT_TYPES = ['permanent', 'fixed_term', 'probation', 'contractor', 'temporary', 'internship'] as const;
const PERIODS        = ['annual', 'monthly', 'fortnightly', 'weekly', 'daily', 'hourly'] as const;
const PARTIES        = ['employer', 'employee', 'witness', 'guarantor'] as const;
const METHODS        = ['e_signature', 'wet_signature', 'uploaded'] as const;

const signatoryInput = z.object({
  party: z.enum(PARTIES),
  signatoryId: z.string().nullable().optional(),
  signatoryName: z.string().trim().min(1),
  signatoryEmail: z.string().email().nullable().optional(),
});
const clauseInput = z.object({ title: z.string().trim().min(1), body: z.string() });

// ── Reads ───────────────────────────────────────────────────────────────────
router.post('/contracts/list', async c => {
  await requirePermission(c, 'hr.contracts.view');
  const v = zv(c, z.object({ status: z.string().optional(), employeeId: z.string().optional(), contractType: z.enum(CONTRACT_TYPES).optional() }), body(c));
  if (!v.ok) return v.response;
  try { return c.json({ success: true, data: await listContracts(v.data) }); } catch (e) { return fail(c, e); }
});

router.post('/contracts/get', async c => {
  await requirePermission(c, 'hr.contracts.view');
  const v = zv(c, z.object({ contractId: z.string().uuid() }), body(c));
  if (!v.ok) return v.response;
  try {
    const detail = await getContractDetail(v.data.contractId);
    if (!detail) return c.json({ success: false, message: 'Contract not found.' }, 404 as 200);
    return c.json({ success: true, data: detail });
  } catch (e) { return fail(c, e); }
});

router.post('/contracts/dashboard-stats', async c => {
  await requirePermission(c, 'hr.contracts.view');
  try { return c.json({ success: true, data: await getContractDashboardStats() }); } catch (e) { return fail(c, e); }
});

router.post('/contracts/templates/list', async c => {
  await requirePermission(c, 'hr.contracts.view');
  const v = zv(c, z.object({ status: z.string().optional(), contractType: z.enum(CONTRACT_TYPES).optional() }), body(c));
  if (!v.ok) return v.response;
  try { return c.json({ success: true, data: await listTemplates(v.data) }); } catch (e) { return fail(c, e); }
});

// ── Lifecycle ─────────────────────────────────────────────────────────────────
router.post('/contracts/create', async c => {
  const actor = await requirePermission(c, 'hr.contracts.manage');
  const v = zv(c, z.object({
    employeeId: z.string().min(1), templateId: z.string().uuid().nullable().optional(), title: z.string().trim().min(1),
    contractType: z.enum(CONTRACT_TYPES), startDate: z.string().nullable().optional(), endDate: z.string().nullable().optional(),
    probationEndDate: z.string().nullable().optional(), compensationAmount: z.number().nonnegative().nullable().optional(),
    compensationCurrency: z.string().nullable().optional(), compensationPeriod: z.enum(PERIODS).nullable().optional(),
    body: z.string().nullable().optional(), onboardingCaseId: z.string().uuid().nullable().optional(),
    signatories: z.array(signatoryInput).optional(),
  }), body(c));
  if (!v.ok) return v.response;
  try { return c.json({ success: true, data: await createContract(actor.id, v.data) }); } catch (e) { return fail(c, e); }
});

router.post('/contracts/issue', async c => {
  const actor = await requirePermission(c, 'hr.contracts.manage');
  const v = zv(c, z.object({ contractId: z.string().uuid(), signatories: z.array(signatoryInput).optional() }), body(c));
  if (!v.ok) return v.response;
  try { return c.json({ success: true, data: await issueContract(actor.id, v.data) }); } catch (e) { return fail(c, e); }
});

router.post('/contracts/sign', async c => {
  const actor = await requirePermission(c, 'hr.contracts.manage');
  const v = zv(c, z.object({
    signatoryRowId: z.string().uuid(), decision: z.enum(['signed', 'declined']),
    method: z.enum(METHODS).optional(), declineReason: z.string().trim().max(500).nullable().optional(),
  }), body(c));
  if (!v.ok) return v.response;
  try { return c.json({ success: true, data: await recordSignature(actor.id, v.data) }); } catch (e) { return fail(c, e); }
});

router.post('/contracts/activate', async c => {
  const actor = await requirePermission(c, 'hr.contracts.manage');
  const v = zv(c, z.object({ contractId: z.string().uuid() }), body(c));
  if (!v.ok) return v.response;
  try { return c.json({ success: true, data: await activateContract(actor.id, v.data) }); } catch (e) { return fail(c, e); }
});

router.post('/contracts/renew', async c => {
  const actor = await requirePermission(c, 'hr.contracts.manage');
  const v = zv(c, z.object({
    contractId: z.string().uuid(), startDate: z.string().nullable().optional(), endDate: z.string().nullable().optional(),
    probationEndDate: z.string().nullable().optional(), compensationAmount: z.number().nonnegative().nullable().optional(),
    compensationCurrency: z.string().nullable().optional(), compensationPeriod: z.enum(PERIODS).nullable().optional(),
    title: z.string().trim().nullable().optional(),
  }), body(c));
  if (!v.ok) return v.response;
  try { return c.json({ success: true, data: await renewContract(actor.id, v.data) }); } catch (e) { return fail(c, e); }
});

router.post('/contracts/terminate', async c => {
  const actor = await requirePermission(c, 'hr.contracts.terminate');
  const v = zv(c, z.object({ contractId: z.string().uuid(), reason: z.string().trim().min(1, 'A termination reason is required.').max(500), effectiveDate: z.string().nullable().optional() }), body(c));
  if (!v.ok) return v.response;
  try { return c.json({ success: true, data: await terminateContract(actor.id, v.data) }); } catch (e) { return fail(c, e); }
});

router.post('/contracts/cancel', async c => {
  const actor = await requirePermission(c, 'hr.contracts.manage');
  const v = zv(c, z.object({ contractId: z.string().uuid(), reason: z.string().trim().max(500).nullable().optional() }), body(c));
  if (!v.ok) return v.response;
  try { return c.json({ success: true, data: await cancelContract(actor.id, v.data) }); } catch (e) { return fail(c, e); }
});

router.post('/contracts/expire-sweep', async c => {
  const actor = await requirePermission(c, 'hr.contracts.manage');
  try { return c.json({ success: true, data: await expireContracts(actor.id) }); } catch (e) { return fail(c, e); }
});

// ── Templates (config) ──────────────────────────────────────────────────────
router.post('/contracts/templates/create', async c => {
  const actor = await requirePermission(c, 'hr.contracts.template.manage');
  const v = zv(c, z.object({
    templateKey: z.string().trim().min(1), name: z.string().trim().min(1), description: z.string().nullable().optional(),
    contractType: z.enum(CONTRACT_TYPES), workerTypes: z.array(z.string()).optional(), bodyTemplate: z.string().optional(),
    clauses: z.array(clauseInput).optional(), defaultDurationMonths: z.number().int().nullable().optional(), probationMonths: z.number().int().nullable().optional(),
  }), body(c));
  if (!v.ok) return v.response;
  try { return c.json({ success: true, data: await createTemplate(actor.id, v.data) }); } catch (e) { return fail(c, e); }
});

router.post('/contracts/templates/update', async c => {
  const actor = await requirePermission(c, 'hr.contracts.template.manage');
  const v = zv(c, z.object({
    templateId: z.string().uuid(), name: z.string().trim().optional(), description: z.string().nullable().optional(),
    contractType: z.enum(CONTRACT_TYPES).optional(), workerTypes: z.array(z.string()).optional(), bodyTemplate: z.string().optional(),
    clauses: z.array(clauseInput).optional(), defaultDurationMonths: z.number().int().nullable().optional(), probationMonths: z.number().int().nullable().optional(),
  }), body(c));
  if (!v.ok) return v.response;
  try { return c.json({ success: true, data: await updateTemplate(actor.id, v.data) }); } catch (e) { return fail(c, e); }
});

router.post('/contracts/templates/retire', async c => {
  const actor = await requirePermission(c, 'hr.contracts.template.manage');
  const v = zv(c, z.object({ templateId: z.string().uuid() }), body(c));
  if (!v.ok) return v.response;
  try { return c.json({ success: true, data: await retireTemplate(actor.id, v.data) }); } catch (e) { return fail(c, e); }
});

export default router;
