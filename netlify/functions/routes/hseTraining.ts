/**
 * netlify/functions/routes/hseTraining.ts
 *
 * Mounted at /api/hse. POST-only, permission-gated. HSE Training / Competency.
 *
 * Setup:        training/competencies/{list,create,update}
 *               training/courses/{list,create,update}
 *               training/requirements/{list,create,update,delete}
 * Certificates: training/certificates/{list,get,create,update,renew,verify,reject,revoke,archive}
 *               training/certificates/evidence/{upload-url,add}
 * Assignments:  training/assignments/{list,get,create,complete,cancel}
 * Matrix/KPIs:  training/competency-matrix · training/stats · training/dashboard
 *
 * Permissions: hse.training.view · hse.training.manage · hse.training.verify
 */

import { Hono }              from 'hono';
import type { Context }      from 'hono';
import { z, zv }             from '../lib/validate';
import { requirePermission } from '../lib/auth';
import { sb }                from '../lib/db';
import { resolveSettingValue } from '../lib/settings/resolveSetting';
import { nextRef }           from '../lib/refGenerator';
import { emitAppEvent }      from '../lib/appEvents';
import { runModuleMutation } from '../lib/moduleServiceAdapter';
import { createAttachmentUploadUrl } from '../lib/upload';
import { getSignedUrl }      from '../lib/photos';
import type { HonoVariables } from '../../../types/api';

const router = new Hono<{ Variables: HonoVariables }>();
const EVIDENCE_BUCKET = 'hse-attachments';

// ── Audit helper (async so the insert actually fires — supabase-js is lazy) ────
type TAuditEntity = 'competency' | 'course' | 'requirement' | 'certificate' | 'evidence' | 'verification' | 'assignment';
async function writeAudit(entityType: TAuditEntity, entityId: string, action: string, actorId: string, after?: Record<string, unknown>, before?: Record<string, unknown>): Promise<void> {
  await sb.from('hse_training_audit_events').insert({
    entity_type: entityType, entity_id: entityId, action, actor_user_id: actorId,
    before_state: before ?? null, after_state: after ?? null, metadata: {},
  });
}

async function signEvidence(rows: Array<Record<string, unknown>>): Promise<Array<Record<string, unknown>>> {
  return Promise.all(rows.map(async r => ({ ...r, url: r.file_path ? await getSignedUrl(EVIDENCE_BUCKET, r.file_path as string).catch(() => '') : '' })));
}

// ── Certificate lifecycle ─────────────────────────────────────────────────────
const CERT_TRANSITIONS: Record<string, string[]> = {
  draft:                ['pending_verification', 'current', 'archived'],
  pending_verification: ['current', 'due_soon', 'rejected', 'draft'],
  current:              ['due_soon', 'expired', 'revoked'],
  due_soon:             ['expired', 'revoked', 'current'],
  expired:              ['archived', 'revoked'],
  rejected:             ['archived', 'draft'],
  revoked:              ['archived'],
  archived:            [],
};

/** A certificate is "valid" for compliance: verified (if required), not revoked, not expired. */
function isValidCert(c: { status: string; expires_at: string | null; verified_at: string | null; verification_required: boolean; revoked_at: string | null }): boolean {
  if (c.revoked_at) return false;
  if (!['current', 'due_soon'].includes(c.status)) return false;
  if (c.expires_at && new Date(c.expires_at).getTime() < Date.now()) return false;
  if (c.verification_required && !c.verified_at) return false;
  return true;
}

// ── Competency matrix engine ──────────────────────────────────────────────────

interface WorkerRow { id: string; username: string; full_name: string | null; role: string | null; department_id: string | null; status: string }
interface ReqRow { id: string; role_name: string | null; site_id: string | null; department_id: string | null; competency_id: string; requirement_level: string; is_active: boolean }
interface CompRow { id: string; name: string; default_renewal_window_days: number }
interface CertRow { id: string; worker_id: string; competency_id: string | null; status: string; expires_at: string | null; verified_at: string | null; verification_required: boolean; revoked_at: string | null }

const REQUIRED_LEVELS = new Set(['required', 'site_specific', 'task_specific']);

/** Does a requirement apply to a worker? role match (or global), dept match (or global). */
function reqAppliesTo(req: ReqRow, w: WorkerRow): boolean {
  if (req.role_name && req.role_name !== w.role) return false;
  if (req.department_id && req.department_id !== w.department_id) return false;
  return true;
}

type CellStatus = 'ok' | 'due_soon' | 'expired' | 'missing' | 'pending_verification' | 'not_required';

async function buildMatrix(filter: { siteId?: string; departmentId?: string; roleId?: string; status?: string; competencyId?: string; workerSearch?: string }) {
  const [workersRes, reqsRes, compsRes] = await Promise.all([
    sb.from('app_users').select('id, username, full_name, role, department_id, status').eq('status', 'active').neq('role', 'superadmin').order('full_name'),
    sb.from('hse_training_requirements').select('id, role_name, site_id, department_id, competency_id, requirement_level, is_active').eq('is_active', true),
    sb.from('hse_training_competencies').select('id, name, default_renewal_window_days').eq('is_active', true),
  ]);
  const workers = (workersRes.data ?? []) as WorkerRow[];
  const reqs = ((reqsRes.data ?? []) as ReqRow[]).filter(r => REQUIRED_LEVELS.has(r.requirement_level));
  const comps = new Map((compsRes.data ?? []).map(c => [c.id, c as CompRow]));
  // Configurable global fallback for competencies without their own renewal window
  // (training.default_renewal_window_days; catalog default matches the legacy 90).
  const globalRenewal = await resolveSettingValue<number>(sb, 'training.default_renewal_window_days', { moduleKey: 'training' }, 90);

  const workerIds = workers.map(w => w.id);
  const certs = workerIds.length
    ? ((await sb.from('hse_worker_certificates').select('id, worker_id, competency_id, status, expires_at, verified_at, verification_required, revoked_at').in('worker_id', workerIds)).data ?? []) as CertRow[]
    : [];
  // index certs by worker|competency
  const certByKey = new Map<string, CertRow[]>();
  for (const c of certs) {
    if (!c.competency_id) continue;
    const k = `${c.worker_id}|${c.competency_id}`;
    (certByKey.get(k) ?? certByKey.set(k, []).get(k)!).push(c);
  }

  const cellFor = (w: WorkerRow, competencyId: string, renewalDays: number): { status: CellStatus; certId: string | null; expiresAt: string | null } => {
    const list = certByKey.get(`${w.id}|${competencyId}`) ?? [];
    if (list.length === 0) return { status: 'missing', certId: null, expiresAt: null };
    const valid = list.find(isValidCert);
    if (valid) {
      const days = valid.expires_at ? Math.ceil((new Date(valid.expires_at).getTime() - Date.now()) / 86400000) : 9999;
      return { status: days <= renewalDays ? 'due_soon' : 'ok', certId: valid.id, expiresAt: valid.expires_at };
    }
    if (list.some(c => c.status === 'pending_verification')) return { status: 'pending_verification', certId: list[0]!.id, expiresAt: list[0]!.expires_at };
    return { status: 'expired', certId: list[0]!.id, expiresAt: list[0]!.expires_at };
  };

  const rows = workers
    .filter(w => !filter.roleId || w.role === filter.roleId)
    .filter(w => !filter.departmentId || w.department_id === filter.departmentId)
    .filter(w => !filter.workerSearch || (w.full_name ?? w.username).toLowerCase().includes(filter.workerSearch.toLowerCase()))
    .map(w => {
      const applicable = reqs.filter(r => reqAppliesTo(r, w));
      const competencies = applicable
        .filter(r => !filter.competencyId || r.competency_id === filter.competencyId)
        .map(r => {
          const comp = comps.get(r.competency_id);
          const cell = cellFor(w, r.competency_id, comp?.default_renewal_window_days ?? globalRenewal);
          return { competencyId: r.competency_id, competencyName: comp?.name ?? r.competency_id, status: cell.status, certificateId: cell.certId, expiresAt: cell.expiresAt, requirementLevel: r.requirement_level };
        });
      const requiredCount  = competencies.length;
      const compliantCount = competencies.filter(c => c.status === 'ok' || c.status === 'due_soon').length;
      const dueSoonCount   = competencies.filter(c => c.status === 'due_soon').length;
      const expiredCount   = competencies.filter(c => c.status === 'expired').length;
      const missingCount   = competencies.filter(c => c.status === 'missing').length;
      const pendingCount   = competencies.filter(c => c.status === 'pending_verification').length;
      const overallStatus =
        requiredCount === 0                  ? 'not_applicable' :
        (expiredCount > 0 || missingCount > 0) ? 'non_compliant' :
        dueSoonCount > 0                     ? 'due_soon' :
        pendingCount > 0                     ? 'pending_verification' :
                                              'compliant';
      return {
        workerId: w.id, workerName: w.full_name ?? w.username, roleName: w.role, siteName: null, departmentName: w.department_id,
        overallStatus, requiredCount, compliantCount, dueSoonCount, expiredCount, missingCount, pendingCount, competencies,
      };
    })
    .filter(r => !filter.status || r.overallStatus === filter.status);

  return rows;
}

router.post('/training/competency-matrix', async c => {
  await requirePermission(c, 'hse.training.view');
  const v = zv(c, z.object({
    siteId: z.string().optional(), departmentId: z.string().optional(), roleId: z.string().optional(),
    status: z.string().optional(), competencyId: z.string().optional(), workerSearch: z.string().optional(),
  }), (c.get('body') as Record<string, unknown>).args ?? {});
  if (!v.ok) return v.response;
  return c.json({ success: true, data: await buildMatrix(v.data) });
});

// ── Stats / dashboard ─────────────────────────────────────────────────────────
async function computeStats() {
  const now = new Date();
  const soon = new Date(now.getTime() + 90 * 86400000).toISOString().slice(0, 10);
  const today = now.toISOString().slice(0, 10);

  const [current, dueSoon, expired, totalCerts, trackedWorkers] = await Promise.all([
    sb.from('hse_worker_certificates').select('id', { count: 'exact', head: true }).in('status', ['current', 'due_soon']).gte('expires_at', today),
    sb.from('hse_worker_certificates').select('id', { count: 'exact', head: true }).eq('status', 'due_soon'),
    sb.from('hse_worker_certificates').select('id', { count: 'exact', head: true }).or(`status.eq.expired,expires_at.lt.${today}`),
    sb.from('hse_worker_certificates').select('id', { count: 'exact', head: true }),
    sb.from('app_users').select('id', { count: 'exact', head: true }).eq('status', 'active').neq('role', 'superadmin'),
  ]);

  // Overall compliance from the matrix (required cells).
  const matrix = await buildMatrix({});
  const totalRequired = matrix.reduce((n, r) => n + r.requiredCount, 0);
  const totalCompliant = matrix.reduce((n, r) => n + r.compliantCount, 0);
  void soon;

  return {
    overallCompliancePercent: totalRequired > 0 ? Math.round((totalCompliant / totalRequired) * 100) : 0,
    compliantSlots: totalCompliant,
    totalRequiredSlots: totalRequired,
    targetPercent: 85,
    currentCerts: current.count ?? 0,
    dueForRenewal: dueSoon.count ?? 0,
    expired: expired.count ?? 0,
    totalCertificates: totalCerts.count ?? 0,
    trackedWorkers: trackedWorkers.count ?? 0,
  };
}
router.post('/training/stats', async c => { await requirePermission(c, 'hse.training.view'); return c.json({ success: true, data: await computeStats() }); });
router.post('/training/dashboard', async c => { await requirePermission(c, 'hse.training.view'); return c.json({ success: true, data: await computeStats() }); });

// ── Competencies / courses / requirements ─────────────────────────────────────
router.post('/training/competencies/list', async c => {
  await requirePermission(c, 'hse.training.view');
  const v = zv(c, z.object({ activeOnly: z.boolean().default(true) }), (c.get('body') as Record<string, unknown>).args ?? {});
  if (!v.ok) return v.response;
  let q = sb.from('hse_training_competencies').select('*').order('name');
  if (v.data.activeOnly) q = q.eq('is_active', true);
  const { data, error } = await q;
  if (error) return c.json({ success: false, message: error.message }, 500 as 200);
  return c.json({ success: true, data: data ?? [] });
});

const CompetencyCreateSchema = z.object({
  name: z.string().min(1), code: z.string().nullable().optional(), category: z.string().nullable().optional(),
  description: z.string().nullable().optional(), defaultValidityMonths: z.number().int().nullable().optional(),
  defaultRenewalWindowDays: z.number().int().default(90),
  requiresEvidence: z.boolean().default(true), requiresCertificateNumber: z.boolean().default(false), requiresVerification: z.boolean().default(true),
});
router.post('/training/competencies/create', async c => {
  const user = await requirePermission(c, 'hse.training.manage');
  const v = zv(c, CompetencyCreateSchema, (c.get('body') as Record<string, unknown>).args);
  if (!v.ok) return v.response;
  const { data, error } = await sb.from('hse_training_competencies').insert({
    name: v.data.name, code: v.data.code ?? null, category: v.data.category ?? null, description: v.data.description ?? null,
    default_validity_months: v.data.defaultValidityMonths ?? null, default_renewal_window_days: v.data.defaultRenewalWindowDays,
    requires_evidence: v.data.requiresEvidence, requires_certificate_number: v.data.requiresCertificateNumber, requires_verification: v.data.requiresVerification,
    created_by: user.id, created_at: new Date().toISOString(),
  }).select('id').single<{ id: string }>();
  if (error || !data) return c.json({ success: false, message: error?.message ?? 'Insert failed' }, 500 as 200);
  await writeAudit('competency', data.id, 'created', user.id, { name: v.data.name });
  return c.json({ success: true, data: { id: data.id } });
});
router.post('/training/competencies/update', async c => {
  const user = await requirePermission(c, 'hse.training.manage');
  const v = zv(c, z.object({ competencyId: z.string().uuid(), name: z.string().optional(), isActive: z.boolean().optional(), defaultRenewalWindowDays: z.number().int().optional() }), (c.get('body') as Record<string, unknown>).args);
  if (!v.ok) return v.response;
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (v.data.name !== undefined) updates.name = v.data.name;
  if (v.data.isActive !== undefined) updates.is_active = v.data.isActive;
  if (v.data.defaultRenewalWindowDays !== undefined) updates.default_renewal_window_days = v.data.defaultRenewalWindowDays;
  const { error } = await sb.from('hse_training_competencies').update(updates).eq('id', v.data.competencyId);
  if (error) return c.json({ success: false, message: error.message }, 500 as 200);
  await writeAudit('competency', v.data.competencyId, 'updated', user.id, updates);
  return c.json({ success: true });
});

router.post('/training/courses/list', async c => {
  await requirePermission(c, 'hse.training.view');
  const v = zv(c, z.object({ competencyId: z.string().uuid().optional(), activeOnly: z.boolean().default(true) }), (c.get('body') as Record<string, unknown>).args ?? {});
  if (!v.ok) return v.response;
  let q = sb.from('hse_training_courses').select('*').order('name');
  if (v.data.competencyId) q = q.eq('competency_id', v.data.competencyId);
  if (v.data.activeOnly) q = q.eq('is_active', true);
  const { data, error } = await q;
  if (error) return c.json({ success: false, message: error.message }, 500 as 200);
  return c.json({ success: true, data: data ?? [] });
});
router.post('/training/courses/create', async c => {
  const user = await requirePermission(c, 'hse.training.manage');
  const v = zv(c, z.object({ name: z.string().min(1), competencyId: z.string().uuid().nullable().optional(), provider: z.string().nullable().optional(), courseCode: z.string().nullable().optional(), validityMonths: z.number().int().nullable().optional(), isInternal: z.boolean().default(false) }), (c.get('body') as Record<string, unknown>).args);
  if (!v.ok) return v.response;
  const { data, error } = await sb.from('hse_training_courses').insert({
    name: v.data.name, competency_id: v.data.competencyId ?? null, provider: v.data.provider ?? null, course_code: v.data.courseCode ?? null,
    validity_months: v.data.validityMonths ?? null, is_internal: v.data.isInternal, created_by: user.id, created_at: new Date().toISOString(),
  }).select('id').single<{ id: string }>();
  if (error || !data) return c.json({ success: false, message: error?.message ?? 'Insert failed' }, 500 as 200);
  await writeAudit('course', data.id, 'created', user.id, { name: v.data.name });
  return c.json({ success: true, data: { id: data.id } });
});

router.post('/training/requirements/list', async c => {
  await requirePermission(c, 'hse.training.view');
  const v = zv(c, z.object({ roleName: z.string().optional(), competencyId: z.string().uuid().optional(), activeOnly: z.boolean().default(true) }), (c.get('body') as Record<string, unknown>).args ?? {});
  if (!v.ok) return v.response;
  let q = sb.from('hse_training_requirements').select('*').order('created_at', { ascending: false });
  if (v.data.roleName) q = q.eq('role_name', v.data.roleName);
  if (v.data.competencyId) q = q.eq('competency_id', v.data.competencyId);
  if (v.data.activeOnly) q = q.eq('is_active', true);
  const { data, error } = await q;
  if (error) return c.json({ success: false, message: error.message }, 500 as 200);
  return c.json({ success: true, data: data ?? [] });
});
const RequirementCreateSchema = z.object({
  competencyId: z.string().uuid(),
  roleName: z.string().nullable().optional(), siteId: z.string().uuid().nullable().optional(), siteName: z.string().nullable().optional(),
  departmentId: z.string().uuid().nullable().optional(), departmentName: z.string().nullable().optional(),
  requirementLevel: z.enum(['required', 'recommended', 'optional', 'site_specific', 'task_specific']).default('required'),
  mandatoryBeforeWork: z.boolean().default(true), appliesToContractors: z.boolean().default(true), renewalWindowDays: z.number().int().nullable().optional(),
});
router.post('/training/requirements/create', async c => {
  const user = await requirePermission(c, 'hse.training.manage');
  const v = zv(c, RequirementCreateSchema, (c.get('body') as Record<string, unknown>).args);
  if (!v.ok) return v.response;
  if (!v.data.roleName && !v.data.siteId && !v.data.departmentId) {
    return c.json({ success: false, message: 'At least one scope (role, site, or department) is required.' }, 400 as 200);
  }
  const { data, error } = await sb.from('hse_training_requirements').insert({
    competency_id: v.data.competencyId, role_name: v.data.roleName ?? null, site_id: v.data.siteId ?? null, site_name: v.data.siteName ?? null,
    department_id: v.data.departmentId ?? null, department_name: v.data.departmentName ?? null,
    requirement_level: v.data.requirementLevel, mandatory_before_work: v.data.mandatoryBeforeWork, applies_to_contractors: v.data.appliesToContractors,
    renewal_window_days: v.data.renewalWindowDays ?? null, created_by: user.id, created_at: new Date().toISOString(),
  }).select('id').single<{ id: string }>();
  if (error || !data) return c.json({ success: false, message: error?.message ?? 'Insert failed' }, 500 as 200);
  await writeAudit('requirement', data.id, 'created', user.id, { competencyId: v.data.competencyId, roleName: v.data.roleName });
  return c.json({ success: true, data: { id: data.id } });
});
router.post('/training/requirements/delete', async c => {
  const user = await requirePermission(c, 'hse.training.manage');
  const v = zv(c, z.object({ requirementId: z.string().uuid() }), (c.get('body') as Record<string, unknown>).args);
  if (!v.ok) return v.response;
  const { error } = await sb.from('hse_training_requirements').update({ is_active: false, updated_at: new Date().toISOString() }).eq('id', v.data.requirementId);
  if (error) return c.json({ success: false, message: error.message }, 500 as 200);
  await writeAudit('requirement', v.data.requirementId, 'deactivated', user.id);
  return c.json({ success: true });
});

// ── Certificates ──────────────────────────────────────────────────────────────
const CERT_COLS = 'id, certificate_no, worker_id, worker_name, competency_id, course_id, course_name, provider, certificate_number, issued_at, expires_at, status, verification_required, verified_by, verified_at, created_at, updated_at';

router.post('/training/certificates/list', async c => {
  await requirePermission(c, 'hse.training.view');
  const v = zv(c, z.object({ workerId: z.string().optional(), competencyId: z.string().uuid().optional(), status: z.string().optional(), limit: z.number().int().min(1).max(500).default(200) }), (c.get('body') as Record<string, unknown>).args ?? {});
  if (!v.ok) return v.response;
  let q = sb.from('hse_worker_certificates').select(CERT_COLS).order('created_at', { ascending: false }).limit(v.data.limit);
  if (v.data.workerId) q = q.eq('worker_id', v.data.workerId);
  if (v.data.competencyId) q = q.eq('competency_id', v.data.competencyId);
  if (v.data.status) q = q.eq('status', v.data.status);
  const { data, error } = await q;
  if (error) return c.json({ success: false, message: error.message }, 500 as 200);
  return c.json({ success: true, data: data ?? [] });
});

router.post('/training/certificates/get', async c => {
  await requirePermission(c, 'hse.training.view');
  const v = zv(c, z.object({ certificateId: z.string().uuid() }), (c.get('body') as Record<string, unknown>).args);
  if (!v.ok) return v.response;
  const cert = await sb.from('hse_worker_certificates').select('*').eq('id', v.data.certificateId).maybeSingle();
  if (!cert.data) return c.json({ success: false, message: 'Certificate not found.' }, 404 as 200);
  const [evidence, verifications, audit] = await Promise.all([
    sb.from('hse_certificate_evidence').select('*').eq('certificate_id', v.data.certificateId).order('uploaded_at', { ascending: false }),
    sb.from('hse_certificate_verifications').select('*').eq('certificate_id', v.data.certificateId).order('verified_at', { ascending: false }),
    sb.from('hse_training_audit_events').select('*').eq('entity_type', 'certificate').eq('entity_id', v.data.certificateId).order('created_at', { ascending: false }).limit(100),
  ]);
  return c.json({ success: true, data: { certificate: cert.data, evidence: await signEvidence(evidence.data ?? []), verifications: verifications.data ?? [], audit: audit.data ?? [] } });
});

const CertCreateSchema = z.object({
  workerId: z.string().min(1), competencyId: z.string().uuid().nullable().optional(), courseId: z.string().uuid().nullable().optional(),
  courseName: z.string().min(1), provider: z.string().nullable().optional(), certificateNumber: z.string().nullable().optional(),
  issuedAt: z.string().min(1), expiresAt: z.string().min(1),
  verificationRequired: z.boolean().default(true), verifierId: z.string().nullable().optional(),
  asDraft: z.boolean().default(false),
});
router.post('/training/certificates/create', async c => {
  const user = await requirePermission(c, 'hse.training.manage');
  const v = zv(c, CertCreateSchema, (c.get('body') as Record<string, unknown>).args);
  if (!v.ok) return v.response;
  if (new Date(v.data.expiresAt).getTime() <= new Date(v.data.issuedAt).getTime()) {
    return c.json({ success: false, message: 'Expiry date must be after the issued date.' }, 400 as 200);
  }
  const initialStatus = v.data.asDraft ? 'draft' : (v.data.verificationRequired ? 'pending_verification' : 'current');

  try {
    const result = await runModuleMutation<{ id: string; certificate_no: string }>({
      context: { actorUserId: user.id },
      options: {
        module: 'hse', operation: 'create', entityType: 'certificate',
        idempotencyKey: `hse.training.cert.create:${user.id}:${v.data.workerId}:${v.data.courseName}:${v.data.issuedAt}`,
        eventType: 'hse.training.certificate.created', eventSeverity: 'info',
        eventPayload: { workerId: v.data.workerId, status: initialStatus },
        getEntityIdentity: (r) => ({ id: r.id, ref: r.certificate_no ?? r.id }),
        afterCommit: async ({ entityId }) => { await writeAudit('certificate', entityId, 'created', user.id, { status: initialStatus }); },
      },
      writeRecord: async () => {
        const certNo = await nextRef('CERT');
        const now = new Date().toISOString();
        const worker = await sb.from('app_users').select('full_name, username').eq('id', v.data.workerId).maybeSingle<{ full_name: string | null; username: string }>();
        const { data, error } = await sb.from('hse_worker_certificates').insert({
          certificate_no: certNo, worker_id: v.data.workerId, worker_name: worker.data?.full_name ?? worker.data?.username ?? null,
          competency_id: v.data.competencyId ?? null, course_id: v.data.courseId ?? null, course_name: v.data.courseName,
          provider: v.data.provider ?? null, certificate_number: v.data.certificateNumber ?? null,
          issued_at: v.data.issuedAt, expires_at: v.data.expiresAt, status: initialStatus,
          verification_required: v.data.verificationRequired, created_by: user.id, created_at: now, updated_at: now,
        }).select('id, certificate_no').single<{ id: string; certificate_no: string }>();
        if (error || !data) throw new Error(error?.message ?? 'Insert failed');
        return data;
      },
    });
    return c.json({ success: true, data: { id: result.entityId, certificateNo: result.entityRef } });
  } catch (e) {
    return c.json({ success: false, message: e instanceof Error ? e.message : 'Create failed' }, 500 as 200);
  }
});

// renew: create a NEW cert linked to the previous, supersede the old.
const RenewSchema = z.object({ certificateId: z.string().uuid(), issuedAt: z.string().min(1), expiresAt: z.string().min(1), certificateNumber: z.string().nullable().optional(), provider: z.string().nullable().optional() });
router.post('/training/certificates/renew', async c => {
  const user = await requirePermission(c, 'hse.training.manage');
  const v = zv(c, RenewSchema, (c.get('body') as Record<string, unknown>).args);
  if (!v.ok) return v.response;
  const prev = await sb.from('hse_worker_certificates').select('*').eq('id', v.data.certificateId).maybeSingle<CertRow & Record<string, unknown>>();
  if (!prev.data) return c.json({ success: false, message: 'Certificate not found.' }, 404 as 200);
  const certNo = await nextRef('CERT');
  const now = new Date().toISOString();
  const { data, error } = await sb.from('hse_worker_certificates').insert({
    certificate_no: certNo, worker_id: prev.data.worker_id, worker_name: prev.data.worker_name ?? null,
    competency_id: prev.data.competency_id, course_id: prev.data.course_id, course_name: prev.data.course_name,
    provider: v.data.provider ?? prev.data.provider, certificate_number: v.data.certificateNumber ?? null,
    issued_at: v.data.issuedAt, expires_at: v.data.expiresAt, status: 'pending_verification',
    verification_required: prev.data.verification_required, previous_certificate_id: prev.data.id, created_by: user.id, created_at: now, updated_at: now,
  }).select('id').single<{ id: string }>();
  if (error || !data) return c.json({ success: false, message: error?.message ?? 'Renew failed' }, 500 as 200);
  await sb.from('hse_worker_certificates').update({ status: 'archived', updated_at: now }).eq('id', prev.data.id);
  await writeAudit('certificate', data.id, 'renewed', user.id, { previousCertificateId: prev.data.id });
  void emitAppEvent({ eventType: 'hse.training.certificate.renewed', sourceModule: 'hse', sourceEntityType: 'certificate', sourceEntityId: certNo, actorUserId: user.id, severity: 'info', payload: { previousId: prev.data.id } });
  return c.json({ success: true, data: { id: data.id } });
});

async function certTransition(c: Context<{ Variables: HonoVariables }>, opts: { certificateId: string; action: string; toStatus: string; actorId: string; patch?: Record<string, unknown>; note?: string | null }): Promise<Response> {
  const cur = await sb.from('hse_worker_certificates').select('id, certificate_no, status, worker_id').eq('id', opts.certificateId).maybeSingle<{ id: string; certificate_no: string | null; status: string; worker_id: string }>();
  if (!cur.data) return c.json({ success: false, message: 'Certificate not found.' }, 404 as 200);
  if (!(CERT_TRANSITIONS[cur.data.status]?.includes(opts.toStatus) ?? false)) {
    return c.json({ success: false, message: `Cannot ${opts.action} from status "${cur.data.status}".` }, 400 as 200);
  }
  const now = new Date().toISOString();
  const { error } = await sb.from('hse_worker_certificates').update({ status: opts.toStatus, updated_at: now, ...opts.patch }).eq('id', opts.certificateId);
  if (error) return c.json({ success: false, message: error.message }, 500 as 200);
  await writeAudit('certificate', opts.certificateId, opts.action, opts.actorId, { status: opts.toStatus, note: opts.note ?? null }, { status: cur.data.status });
  void emitAppEvent({ eventType: `hse.training.certificate.${opts.action}`, sourceModule: 'hse', sourceEntityType: 'certificate', sourceEntityId: cur.data.certificate_no ?? opts.certificateId, actorUserId: opts.actorId, severity: opts.toStatus === 'revoked' || opts.toStatus === 'rejected' ? 'warning' : 'success', payload: { toStatus: opts.toStatus } });
  return c.json({ success: true, data: { status: opts.toStatus } });
}

router.post('/training/certificates/verify', async c => {
  const user = await requirePermission(c, 'hse.training.verify');
  const v = zv(c, z.object({ certificateId: z.string().uuid(), comments: z.string().nullable().optional() }), (c.get('body') as Record<string, unknown>).args);
  if (!v.ok) return v.response;
  const cur = await sb.from('hse_worker_certificates').select('expires_at, created_by, verification_required').eq('id', v.data.certificateId).maybeSingle<{ expires_at: string | null; created_by: string | null; verification_required: boolean }>();
  if (!cur.data) return c.json({ success: false, message: 'Certificate not found.' }, 404 as 200);
  // current vs due_soon depending on expiry
  const toStatus = cur.data.expires_at && new Date(cur.data.expires_at).getTime() < Date.now() + 90 * 86400000 ? 'due_soon' : 'current';
  await sb.from('hse_certificate_verifications').insert({ certificate_id: v.data.certificateId, decision: 'approved', comments: v.data.comments ?? null, verified_by: user.id });
  return certTransition(c, { certificateId: v.data.certificateId, action: 'verified', toStatus, actorId: user.id, patch: { verified_by: user.id, verified_at: new Date().toISOString(), verification_notes: v.data.comments ?? null } });
});
router.post('/training/certificates/reject', async c => {
  const user = await requirePermission(c, 'hse.training.verify');
  const v = zv(c, z.object({ certificateId: z.string().uuid(), reason: z.string().min(1) }), (c.get('body') as Record<string, unknown>).args);
  if (!v.ok) return v.response;
  await sb.from('hse_certificate_verifications').insert({ certificate_id: v.data.certificateId, decision: 'rejected', comments: v.data.reason, verified_by: user.id });
  return certTransition(c, { certificateId: v.data.certificateId, action: 'rejected', toStatus: 'rejected', actorId: user.id, patch: { rejected_by: user.id, rejected_at: new Date().toISOString(), rejected_reason: v.data.reason }, note: v.data.reason });
});
router.post('/training/certificates/revoke', async c => {
  const user = await requirePermission(c, 'hse.training.verify');
  const v = zv(c, z.object({ certificateId: z.string().uuid(), reason: z.string().min(1) }), (c.get('body') as Record<string, unknown>).args);
  if (!v.ok) return v.response;
  return certTransition(c, { certificateId: v.data.certificateId, action: 'revoked', toStatus: 'revoked', actorId: user.id, patch: { revoked_by: user.id, revoked_at: new Date().toISOString(), revoked_reason: v.data.reason }, note: v.data.reason });
});
router.post('/training/certificates/archive', async c => {
  const user = await requirePermission(c, 'hse.training.manage');
  const v = zv(c, z.object({ certificateId: z.string().uuid() }), (c.get('body') as Record<string, unknown>).args);
  if (!v.ok) return v.response;
  return certTransition(c, { certificateId: v.data.certificateId, action: 'archived', toStatus: 'archived', actorId: user.id });
});

// ── Evidence ──────────────────────────────────────────────────────────────────
router.post('/training/certificates/evidence/upload-url', async c => {
  await requirePermission(c, 'hse.training.manage');
  const v = zv(c, z.object({ fileName: z.string().min(1), mimeType: z.string().min(1) }), (c.get('body') as Record<string, unknown>).args);
  if (!v.ok) return v.response;
  try {
    const { uploadUrl, token, path } = await createAttachmentUploadUrl(EVIDENCE_BUCKET, v.data.fileName, v.data.mimeType);
    return c.json({ success: true, uploadUrl, token, path, bucket: EVIDENCE_BUCKET });
  } catch (err) { return c.json({ success: false, message: err instanceof Error ? err.message : 'Upload URL failed' }, 400 as 200); }
});
router.post('/training/certificates/evidence/add', async c => {
  const user = await requirePermission(c, 'hse.training.manage');
  const v = zv(c, z.object({ certificateId: z.string().uuid(), fileName: z.string().min(1), filePath: z.string().min(1), fileType: z.string().nullable().optional(), fileSize: z.number().int().nullable().optional(), evidenceType: z.enum(['certificate', 'training_card', 'attendance_sheet', 'provider_confirmation', 'other']).default('certificate') }), (c.get('body') as Record<string, unknown>).args);
  if (!v.ok) return v.response;
  const { data, error } = await sb.from('hse_certificate_evidence').insert({
    certificate_id: v.data.certificateId, file_name: v.data.fileName, file_path: v.data.filePath, file_type: v.data.fileType ?? null, file_size: v.data.fileSize ?? null, evidence_type: v.data.evidenceType, uploaded_by: user.id,
  }).select('id').single<{ id: string }>();
  if (error || !data) return c.json({ success: false, message: error?.message ?? 'Insert failed' }, 500 as 200);
  await writeAudit('evidence', data.id, 'uploaded', user.id, { evidenceType: v.data.evidenceType });
  return c.json({ success: true, data: { id: data.id } });
});

// ── Assignments ───────────────────────────────────────────────────────────────
router.post('/training/assignments/list', async c => {
  await requirePermission(c, 'hse.training.view');
  const v = zv(c, z.object({ workerId: z.string().optional(), status: z.string().optional(), limit: z.number().int().min(1).max(500).default(200) }), (c.get('body') as Record<string, unknown>).args ?? {});
  if (!v.ok) return v.response;
  let q = sb.from('hse_training_assignments').select('*').order('due_at', { ascending: true }).limit(v.data.limit);
  if (v.data.workerId) q = q.eq('worker_id', v.data.workerId);
  if (v.data.status) q = q.eq('status', v.data.status);
  const { data, error } = await q;
  if (error) return c.json({ success: false, message: error.message }, 500 as 200);
  return c.json({ success: true, data: data ?? [] });
});
const AssignCreateSchema = z.object({
  workerId: z.string().min(1), competencyId: z.string().uuid().nullable().optional(), courseId: z.string().uuid().nullable().optional(),
  reason: z.string().nullable().optional(), priority: z.enum(['low', 'medium', 'high', 'critical']).default('medium'),
  provider: z.string().nullable().optional(), scheduledAt: z.string().nullable().optional(), dueAt: z.string().min(1),
});
router.post('/training/assignments/create', async c => {
  const user = await requirePermission(c, 'hse.training.manage');
  const v = zv(c, AssignCreateSchema, (c.get('body') as Record<string, unknown>).args);
  if (!v.ok) return v.response;
  try {
    const result = await runModuleMutation<{ id: string; assignment_no: string }>({
      context: { actorUserId: user.id },
      options: {
        module: 'hse', operation: 'create', entityType: 'training_assignment',
        idempotencyKey: `hse.training.assign.create:${user.id}:${v.data.workerId}:${v.data.competencyId ?? v.data.courseId}:${v.data.dueAt}`,
        eventType: 'hse.training.assignment.created', eventSeverity: 'info',
        eventPayload: { workerId: v.data.workerId, priority: v.data.priority },
        getEntityIdentity: (r) => ({ id: r.id, ref: r.assignment_no ?? r.id }),
        ...(v.data.workerId !== user.id ? { explicitRecipients: [{ userId: v.data.workerId, reason: 'assignee' as const }], notification: { title: 'Training assigned', body: `A training assignment is due ${v.data.dueAt}.`, actionRoute: 'hse/training', type: 'hse.training.assignment.created', actionRequired: true, dueAt: v.data.dueAt } } : {}),
        afterCommit: async ({ entityId }) => { await writeAudit('assignment', entityId, 'created', user.id, { workerId: v.data.workerId }); },
      },
      writeRecord: async () => {
        const no = await nextRef('TRN');
        const now = new Date().toISOString();
        const { data, error } = await sb.from('hse_training_assignments').insert({
          assignment_no: no, worker_id: v.data.workerId, competency_id: v.data.competencyId ?? null, course_id: v.data.courseId ?? null,
          reason: v.data.reason ?? null, priority: v.data.priority, provider: v.data.provider ?? null, scheduled_at: v.data.scheduledAt ?? null,
          due_at: v.data.dueAt, status: 'assigned', assigned_by: user.id, assigned_at: now, updated_at: now,
        }).select('id, assignment_no').single<{ id: string; assignment_no: string }>();
        if (error || !data) throw new Error(error?.message ?? 'Insert failed');
        return data;
      },
    });
    return c.json({ success: true, data: { id: result.entityId, assignmentNo: result.entityRef } });
  } catch (e) {
    return c.json({ success: false, message: e instanceof Error ? e.message : 'Create failed' }, 500 as 200);
  }
});
router.post('/training/assignments/complete', async c => {
  const user = await requirePermission(c, 'hse.training.manage');
  const v = zv(c, z.object({ assignmentId: z.string().uuid(), linkedCertificateId: z.string().uuid().nullable().optional() }), (c.get('body') as Record<string, unknown>).args);
  if (!v.ok) return v.response;
  const now = new Date().toISOString();
  const { error } = await sb.from('hse_training_assignments').update({ status: 'completed', completed_at: now, linked_certificate_id: v.data.linkedCertificateId ?? null, updated_at: now }).eq('id', v.data.assignmentId);
  if (error) return c.json({ success: false, message: error.message }, 500 as 200);
  await writeAudit('assignment', v.data.assignmentId, 'completed', user.id);
  return c.json({ success: true });
});
router.post('/training/assignments/cancel', async c => {
  const user = await requirePermission(c, 'hse.training.manage');
  const v = zv(c, z.object({ assignmentId: z.string().uuid(), note: z.string().nullable().optional() }), (c.get('body') as Record<string, unknown>).args);
  if (!v.ok) return v.response;
  const { error } = await sb.from('hse_training_assignments').update({ status: 'cancelled', updated_at: new Date().toISOString() }).eq('id', v.data.assignmentId);
  if (error) return c.json({ success: false, message: error.message }, 500 as 200);
  await writeAudit('assignment', v.data.assignmentId, 'cancelled', user.id, { note: v.data.note ?? null });
  return c.json({ success: true });
});

export default router;
