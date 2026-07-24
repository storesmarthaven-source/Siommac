import { Hono } from 'hono';
import type { HonoVariables } from '../../../types/api';
import { requirePermission } from '../lib/auth';
import { z, zv } from '../lib/validate';
import {
  activatePayPolicy, assignPayPolicy, comparePayPolicyVersions, copyPayPolicyVersion, createPayPolicyDraft,
  decodePolicyCursor, endPayPolicyAssignment, getPayPolicy, listPayPolicies, preflightPayPolicy,
  rejectPayPolicyReview, retirePayPolicy, submitPayPolicy, updatePayPolicyDraft,
} from '../lib/finance/payPolicies';

const router = new Hono<{ Variables: HonoVariables }>();
const body = (c: { get: (key: string) => unknown }): unknown => {
  const raw = c.get('body') as Record<string, unknown>;
  return raw.args ?? raw;
};
const fail = (c: { json: (v: unknown, s: number) => Response }, error: unknown): Response => {
  const e = error as { status?: number; message?: string };
  return c.json({ success: false, message: e.message ?? 'Internal error' }, (e.status ?? 500) as 200);
};
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const requestKey = z.string().trim().min(8).max(200);
const component = z.object({
  componentId: z.string().uuid(),
  calculationBasis: z.enum(['salary_period', 'approved_hours', 'per_qualifying_day']),
  rateSource: z.enum(['employee_contract', 'employee_assignment']),
  eligibilitySource: z.enum(['effective_employment', 'approved_compensation', 'approved_time', 'crew_movement']),
  ruleParameters: z.union([
    z.object({ proration: z.enum(['calendar_days', 'working_days']) }).strict(),
    z.object({}).strict(),
  ]),
  required: z.boolean(),
  sortOrder: z.number().int().min(0).max(999),
}).strict().superRefine((value, ctx) => {
  if (value.calculationBasis === 'salary_period') {
    if (!['effective_employment', 'approved_compensation'].includes(value.eligibilitySource)) {
      ctx.addIssue({ code: 'custom', path: ['eligibilitySource'], message: 'Salary-period rules require employment or compensation eligibility.' });
    }
    if (!('proration' in value.ruleParameters)) {
      ctx.addIssue({ code: 'custom', path: ['ruleParameters'], message: 'Salary-period rules require a proration method.' });
    }
  } else if (value.calculationBasis === 'per_qualifying_day') {
    // CP7b (§14.4): crew day-rate — eligibility comes from crew movements, the
    // TTD rate ONLY from the employee's daily hr_contracts record (locked decision).
    if (value.eligibilitySource !== 'crew_movement') {
      ctx.addIssue({ code: 'custom', path: ['eligibilitySource'], message: 'Qualifying-day rules require crew movement eligibility.' });
    }
    if (value.rateSource !== 'employee_contract') {
      ctx.addIssue({ code: 'custom', path: ['rateSource'], message: 'Qualifying-day rules take their rate from the employee contract.' });
    }
    if (Object.keys(value.ruleParameters).length) {
      ctx.addIssue({ code: 'custom', path: ['ruleParameters'], message: 'Qualifying-day rules take no parameters.' });
    }
  } else if (value.eligibilitySource !== 'approved_time' || Object.keys(value.ruleParameters).length) {
    ctx.addIssue({ code: 'custom', path: ['eligibilitySource'], message: 'Approved-hours rules require approved time and no parameters.' });
  }
});
const sourceRule = z.object({
  sourceType: z.enum(['approved_compensation', 'approved_time', 'approved_leave', 'statutory_profile', 'payment_destination']),
  ownerRole: z.enum(['hr_manager', 'finance_staff', 'finance_manager', 'manager']),
  required: z.boolean(),
  reconciliationKey: z.enum(['employee_effective_date', 'employee_period', 'employee_work_date']),
  lateInputPolicy: z.enum(['exclude_and_review', 'correction_candidate']),
  conflictSeverity: z.enum(['warning', 'blocker']),
  conflictOutcome: z.enum(['exclude_unapproved_input', 'create_review_finding', 'block_employee_calculation', 'block_input_lock', 'create_correction_candidate']),
}).strict();
const draft = z.object({
  code: z.string().trim().min(2).max(20).regex(/^[A-Za-z0-9][A-Za-z0-9_-]+$/),
  name: z.string().trim().min(3).max(120),
  description: z.string().trim().max(1000),
  // CP7b: crew types authorable now that the qualifying-day engine exists.
  // 'project'/'standby_callout' stay OUT until an engine honors them (§14.4).
  policyType: z.enum(['standard_salary', 'hourly_shift', 'offshore_rotation', 'marine_voyage']),
  ownerId: z.string().min(1).max(100).nullable(),
  effectiveFrom: date,
  effectiveTo: date.nullable(),
  changeSummary: z.string().trim().min(3).max(500),
  dayBoundary: z.enum(['calendar_day', 'shift_start']),
  components: z.array(component).min(1).max(50),
  sourceRules: z.array(sourceRule).min(2).max(10),
}).strict().superRefine((value, ctx) => {
  if (value.effectiveTo && value.effectiveTo < value.effectiveFrom) {
    ctx.addIssue({ code: 'custom', path: ['effectiveTo'], message: 'Effective-to cannot precede effective-from.' });
  }
  if (value.policyType === 'standard_salary' && value.dayBoundary !== 'calendar_day') {
    ctx.addIssue({ code: 'custom', path: ['dayBoundary'], message: 'Standard salary uses the calendar-day boundary.' });
  }
  if (value.policyType === 'hourly_shift' && !value.sourceRules.some(x => x.sourceType === 'approved_time' && x.required)) {
    ctx.addIssue({ code: 'custom', path: ['sourceRules'], message: 'Hourly policies require an approved-time source.' });
  }
  for (const required of ['statutory_profile', 'payment_destination'] as const) {
    if (!value.sourceRules.some(x => x.sourceType === required && x.required)) {
      ctx.addIssue({ code: 'custom', path: ['sourceRules'], message: `${required} is required.` });
    }
  }
  if (new Set(value.components.map(x => x.componentId)).size !== value.components.length) {
    ctx.addIssue({ code: 'custom', path: ['components'], message: 'A component can appear only once.' });
  }
  if (new Set(value.sourceRules.map(x => x.sourceType)).size !== value.sourceRules.length) {
    ctx.addIssue({ code: 'custom', path: ['sourceRules'], message: 'A source type can appear only once.' });
  }
});

router.post('/payroll/policies/list', async c => {
  await requirePermission(c, 'finance.payroll.policies.view');
  const v = zv(c, z.object({
    search: z.string().trim().max(120).optional(), status: z.enum(['draft', 'active', 'retired']).optional(),
    cursor: z.string().max(100).optional(), limit: z.number().int().min(1).max(100).optional(),
  }).strict(), body(c));
  if (!v.ok) return v.response;
  try { return c.json({ success: true, data: await listPayPolicies({ ...v.data, limit: v.data.limit ?? 25, offset: decodePolicyCursor(v.data.cursor) }) }); }
  catch (e) { return fail(c, e); }
});

router.post('/payroll/policies/get', async c => {
  await requirePermission(c, 'finance.payroll.policies.view');
  const v = zv(c, z.object({ policyId: z.string().uuid(), versionId: z.string().uuid().optional() }).strict(), body(c));
  if (!v.ok) return v.response;
  try {
    const data = await getPayPolicy(v.data.policyId, v.data.versionId);
    return data ? c.json({ success: true, data }) : c.json({ success: false, message: 'Pay policy not found.' }, 404);
  } catch (e) { return fail(c, e); }
});

router.post('/payroll/policies/create-draft', async c => {
  const actor = await requirePermission(c, 'finance.payroll.policies.draft');
  const v = zv(c, draft.and(z.object({ idempotencyKey: requestKey }).strict()), body(c));
  if (!v.ok) return v.response;
  const { idempotencyKey, ...input } = v.data;
  try { return c.json({ success: true, data: await createPayPolicyDraft(input, actor.id, idempotencyKey) }); }
  catch (e) { return fail(c, e); }
});

router.post('/payroll/policies/update-draft', async c => {
  const actor = await requirePermission(c, 'finance.payroll.policies.draft');
  const v = zv(c, draft.and(z.object({
    policyId: z.string().uuid(), versionId: z.string().uuid(), expectedLockVersion: z.number().int().min(1), idempotencyKey: requestKey,
  }).strict()), body(c));
  if (!v.ok) return v.response;
  const { policyId, versionId, expectedLockVersion, idempotencyKey, ...input } = v.data;
  try { return c.json({ success: true, data: await updatePayPolicyDraft({ policyId, versionId, expectedLockVersion }, input, actor.id, idempotencyKey) }); }
  catch (e) { return fail(c, e); }
});

router.post('/payroll/policies/copy-version', async c => {
  const actor = await requirePermission(c, 'finance.payroll.policies.draft');
  const v = zv(c, z.object({
    policyId: z.string().uuid(), sourceVersionId: z.string().uuid(), effectiveFrom: date,
    changeSummary: z.string().trim().min(3).max(500), idempotencyKey: requestKey,
  }).strict(), body(c));
  if (!v.ok) return v.response;
  try {
    return c.json({
      success: true,
      data: await copyPayPolicyVersion({ ...v.data, actorId: actor.id, requestKey: v.data.idempotencyKey }),
    });
  } catch (e) { return fail(c, e); }
});

router.post('/payroll/policies/preflight', async c => {
  await requirePermission(c, 'finance.payroll.policies.view');
  const v = zv(c, z.object({ versionId: z.string().uuid() }).strict(), body(c));
  if (!v.ok) return v.response;
  try { return c.json({ success: true, data: await preflightPayPolicy(v.data.versionId) }); }
  catch (e) { return fail(c, e); }
});

router.post('/payroll/policies/submit', async c => {
  const actor = await requirePermission(c, 'finance.payroll.policies.submit');
  const v = zv(c, z.object({
    versionId: z.string().uuid(), idempotencyKey: requestKey,
    certifications: z.object({ rulesReviewed: z.literal(true), sourcesOwned: z.literal(true), statutoryPaymentReady: z.literal(true) }).strict(),
  }).strict(), body(c));
  if (!v.ok) return v.response;
  try { return c.json({ success: true, data: await submitPayPolicy(v.data.versionId, v.data.certifications, actor.id, v.data.idempotencyKey) }); }
  catch (e) { return fail(c, e); }
});

router.post('/payroll/policies/activate', async c => {
  const actor = await requirePermission(c, 'finance.payroll.policies.activate');
  const v = zv(c, z.object({ policyId: z.string().uuid(), versionId: z.string().uuid(), idempotencyKey: requestKey }).strict(), body(c));
  if (!v.ok) return v.response;
  try { return c.json({ success: true, data: await activatePayPolicy({ ...v.data, actorId: actor.id, requestKey: v.data.idempotencyKey }) }); }
  catch (e) { return fail(c, e); }
});

router.post('/payroll/policies/reject', async c => {
  const actor = await requirePermission(c, 'finance.payroll.policies.view');
  const v = zv(c, z.object({
    workflowId: z.string().uuid(), taskId: z.string().uuid(), reason: z.string().trim().min(3).max(500),
  }).strict(), body(c));
  if (!v.ok) return v.response;
  try { return c.json({ success: true, data: await rejectPayPolicyReview({ ...v.data, actor }) }); }
  catch (e) { return fail(c, e); }
});

router.post('/payroll/policies/retire', async c => {
  const actor = await requirePermission(c, 'finance.payroll.policies.activate');
  const v = zv(c, z.object({
    policyId: z.string().uuid(), effectiveTo: date, reason: z.string().trim().min(3).max(500), idempotencyKey: requestKey,
  }).strict(), body(c));
  if (!v.ok) return v.response;
  try { return c.json({ success: true, data: await retirePayPolicy({ ...v.data, actorId: actor.id, requestKey: v.data.idempotencyKey }) }); }
  catch (e) { return fail(c, e); }
});

router.post('/payroll/policies/versions/list', async c => {
  await requirePermission(c, 'finance.payroll.policies.view');
  const v = zv(c, z.object({ policyId: z.string().uuid() }).strict(), body(c));
  if (!v.ok) return v.response;
  try {
    const data = await getPayPolicy(v.data.policyId);
    return data ? c.json({ success: true, data: data.versions }) : c.json({ success: false, message: 'Pay policy not found.' }, 404);
  } catch (e) { return fail(c, e); }
});

router.post('/payroll/policies/versions/get', async c => {
  await requirePermission(c, 'finance.payroll.policies.view');
  const v = zv(c, z.object({ policyId: z.string().uuid(), versionId: z.string().uuid() }).strict(), body(c));
  if (!v.ok) return v.response;
  try {
    const data = await getPayPolicy(v.data.policyId, v.data.versionId);
    return data?.version ? c.json({ success: true, data }) : c.json({ success: false, message: 'Pay-policy version not found.' }, 404);
  } catch (e) { return fail(c, e); }
});

router.post('/payroll/policies/versions/compare', async c => {
  await requirePermission(c, 'finance.payroll.policies.view');
  const v = zv(c, z.object({ policyId: z.string().uuid(), fromVersionId: z.string().uuid(), toVersionId: z.string().uuid() }).strict(), body(c));
  if (!v.ok) return v.response;
  try { return c.json({ success: true, data: await comparePayPolicyVersions(v.data.policyId, v.data.fromVersionId, v.data.toVersionId) }); }
  catch (e) { return fail(c, e); }
});

router.post('/payroll/policies/pay-groups/list', async c => {
  await requirePermission(c, 'finance.payroll.policies.view');
  const v = zv(c, z.object({ policyId: z.string().uuid() }).strict(), body(c));
  if (!v.ok) return v.response;
  try {
    const data = await getPayPolicy(v.data.policyId);
    return data ? c.json({ success: true, data: data.assignments }) : c.json({ success: false, message: 'Pay policy not found.' }, 404);
  } catch (e) { return fail(c, e); }
});

router.post('/payroll/policies/pay-groups/assign', async c => {
  const actor = await requirePermission(c, 'finance.payroll.policies.assign');
  const v = zv(c, z.object({
    policyId: z.string().uuid(), versionId: z.string().uuid(), payGroupId: z.string().uuid(),
    effectiveFrom: date, effectiveTo: date.nullable().optional(), idempotencyKey: requestKey,
  }).strict(), body(c));
  if (!v.ok) return v.response;
  try { return c.json({ success: true, data: await assignPayPolicy({ ...v.data, actorId: actor.id, requestKey: v.data.idempotencyKey }) }); }
  catch (e) { return fail(c, e); }
});

router.post('/payroll/policies/pay-groups/end-assignment', async c => {
  const actor = await requirePermission(c, 'finance.payroll.policies.assign');
  const v = zv(c, z.object({
    policyId: z.string().uuid(), assignmentId: z.string().uuid(), effectiveTo: date,
    reason: z.string().trim().min(3).max(500), idempotencyKey: requestKey,
  }).strict(), body(c));
  if (!v.ok) return v.response;
  try { return c.json({ success: true, data: await endPayPolicyAssignment({ ...v.data, actorId: actor.id, requestKey: v.data.idempotencyKey }) }); }
  catch (e) { return fail(c, e); }
});

export default router;
