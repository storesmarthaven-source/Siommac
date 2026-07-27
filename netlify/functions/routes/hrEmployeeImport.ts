// routes/hrEmployeeImport.ts — HR Employee Master bulk import (v36 §8), CSV-only.
//
// 7-step wizard: upload → map → policy → validate → resolve → commit → report.
// The browser uploads the raw file (base64); the BACKEND parses it server-side
// (the staged rows are the source of truth), validates per mapping+policy, and
// commits via the SHARED provisionEmployee() (create) or a targeted update — so an
// imported employee is provisioned by the exact same path as a single create.
// Backend-only (service-role); every route gated by hr.employees.import.*.
// XLSX is a flagged follow-up (CLAUDE.md) — uploads are restricted to CSV here.

import { Hono }       from 'hono';
import { sb }         from '../lib/db';
import { requirePermission, userCan } from '../lib/auth';
import { emitAppEvent } from '../lib/appEvents';
import { nextRef }    from '../lib/refGenerator';
import { z, zv }      from '../lib/validate';
import { runModuleMutation } from '../lib/moduleServiceAdapter';
import { resolveSettingValue } from '../lib/settings/resolveSetting';
import { parseCsv }   from '../lib/hr/csvParse';
import { IMPORT_LIMITS, checkImportLimits } from '../lib/hr/importLimits';
import { IMPORT_MAPPING_VERSION, checkMapping } from '../lib/hr/importFields';
import {
  provisionEmployee, writeHrAudit, statutoryProfilePatch, statutoryWithDefaults, computePayrollReadiness,
  EMPLOYMENT_TYPES,
} from '../lib/hr/employeeCore';
import type { HonoVariables } from '../../../types/api';

const router = new Hono<{ Variables: HonoVariables }>();
const body = (c: { get: (k: string) => unknown }) => (c.get('body') as Record<string, unknown>).args ?? {};

// ── Field model + policy ──────────────────────────────────────────────────────

const REQUIRED_FIELDS = ['firstName', 'lastName', 'workerType', 'department', 'position'] as const;

interface ImportPolicy {
  duplicateEmployeeNumber: 'skip' | 'update' | 'error';
  duplicateUsername:       'skip' | 'error';
  missingSupervisor:       'allow' | 'warn' | 'block';
  missingStatutory:        'allow' | 'warn' | 'block';
  contractorRows:          'import' | 'reject';
  // `defaultRecordStatus` is deliberately limited to the values app_users.status
  // actually accepts. The live CHECK constraint permits only 'active' | 'inactive';
  // the previous 'draft' option could never commit. Import-review state belongs to the
  // staged row, not to the employee's account status.
  defaultRecordStatus?:    'active' | 'inactive';
  batchReference?:         string;
}
const DEFAULT_POLICY: ImportPolicy = {
  duplicateEmployeeNumber: 'skip', duplicateUsername: 'skip',
  missingSupervisor: 'warn', missingStatutory: 'warn',
  contractorRows: 'import',
  defaultRecordStatus: 'active', batchReference: '',
};

// NOTE — fields deliberately REMOVED from the contract rather than left accepted:
//   • createLogins    — import never mints credentials (see employeeCore).
//   • batchOwner      — was a free-text label with no resolved owner or authority.
//   • reviewRequired  — no approval gate existed; the toggle did nothing.
//   • notifyOnComplete— no recipients were resolved and no notification was ever sent,
//                       while the review screen promised "Notify on complete".
// Each returns only when it is genuinely wired end to end.
const PolicySchema = z.object({
  duplicateEmployeeNumber: z.enum(['skip', 'update', 'error']).optional(),
  duplicateUsername:       z.enum(['skip', 'error']).optional(),
  missingSupervisor:       z.enum(['allow', 'warn', 'block']).optional(),
  missingStatutory:        z.enum(['allow', 'warn', 'block']).optional(),
  contractorRows:          z.enum(['import', 'reject']).optional(),
  defaultRecordStatus:     z.enum(['active', 'inactive']).optional(),
  batchReference:          z.string().max(80).optional(),
}).strict();   // unknown policy keys are rejected, never silently stored

const STATUTORY_KEYS = ['nisNumber', 'nisStatus', 'birFileNumber', 'td1Received', 'hsApplicable'] as const;
const parseBool = (v: string | undefined): boolean | undefined => {
  if (v === undefined || v === '') return undefined;
  return /^(y|yes|true|1)$/i.test(v.trim());
};
const norm = (s: string | undefined) => (s ?? '').trim();

/** Apply the column mapping to a raw row → SIOMAC field map (trimmed). */
function applyMapping(raw: Record<string, string>, mapping: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [field, col] of Object.entries(mapping)) {
    // raw[col] is typed non-optional, but a mapped column may be absent in this row —
    // check presence honestly instead of an undefined-comparison the type rules out.
    if (col && Object.hasOwn(raw, col)) out[field] = norm(raw[col]);
  }
  return out;
}

/** Derive a username when one isn't mapped: email local-part, else first.last. */
function deriveUsername(m: Record<string, string>): string {
  if (m.username) return m.username.toLowerCase();
  if (m.email.includes('@')) return m.email.split('@')[0].toLowerCase();
  const base = `${norm(m.firstName)}.${norm(m.lastName)}`.toLowerCase().replace(/[^a-z0-9._-]/g, '');
  return base.replace(/^\.|\.$/g, '') || 'employee';
}

interface LookupCtx {
  usernames: Set<string>;
  employeeNumbers: Set<string>;
  deptByKey: Map<string, string>;       // lower(name) | id → id
  siteIds: Set<string>;
  supervisorByKey: Map<string, string>; // lower(username|employee_number|full_name) → id
}

interface RowVerdict {
  status: 'ready' | 'warning' | 'blocked' | 'duplicate';
  severity: 'info' | 'warning' | 'error' | null;
  resolution: string | null;
  targetEmployeeId: string | null;
  errors: { fieldKey: string | null; code: string; severity: 'info' | 'warning' | 'error'; message: string; resolutionRequired: boolean }[];
}

/** Validate one mapped row against the lookup context + policy. Pure (no DB). */
function validateRow(m: Record<string, string>, importMode: string, policy: ImportPolicy, ctx: LookupCtx): RowVerdict {
  const errors: RowVerdict['errors'] = [];
  let targetEmployeeId: string | null = null;
  let resolution: string | null = null;

  for (const f of REQUIRED_FIELDS) {
    if (!norm(m[f])) errors.push({ fieldKey: f, code: 'required_missing', severity: 'error', message: `${f} is required`, resolutionRequired: true });
  }

  const workerType = norm(m.workerType).toLowerCase();
  if (workerType && workerType !== 'employee' && workerType !== 'contractor') {
    errors.push({ fieldKey: 'workerType', code: 'invalid_worker_type', severity: 'error', message: `worker type must be employee or contractor`, resolutionRequired: true });
  }
  if (workerType === 'contractor' && policy.contractorRows === 'reject') {
    errors.push({ fieldKey: 'workerType', code: 'contractor_rejected', severity: 'error', message: 'contractor rows are rejected by policy', resolutionRequired: true });
  }

  const empType = norm(m.employmentType);
  if (empType && !(EMPLOYMENT_TYPES as readonly string[]).includes(empType)) {
    errors.push({ fieldKey: 'employmentType', code: 'invalid_employment_type', severity: 'error', message: `employment type must be one of ${EMPLOYMENT_TYPES.join(', ')}`, resolutionRequired: true });
  }

  // Department must resolve to a known department (by id or name).
  const deptKey = norm(m.department).toLowerCase();
  if (deptKey && !ctx.deptByKey.has(deptKey)) {
    errors.push({ fieldKey: 'department', code: 'unknown_department', severity: 'error', message: `department "${m.department}" not found`, resolutionRequired: true });
  }

  // Duplicates (username + employee number).
  const username = deriveUsername(m);
  const empNo = norm(m.employeeNumber).toUpperCase();
  const userDup = ctx.usernames.has(username);
  const numDup = empNo ? ctx.employeeNumbers.has(empNo) : false;

  // ── Import-mode semantics (exact, per audit P0-4) ───────────────────────────
  //   create        — a matched record is never updated (error or skip by policy)
  //   update        — an UNMATCHED record is a blocker; update never creates
  //   create_update — matched updates, unmatched creates
  // The mode governs; the duplicate policy only chooses HOW `create` refuses a match.
  // Previously an `update` row with no match stayed `ready` and fell through to the
  // create branch at commit, so a typo'd employee number silently created a person.
  if (numDup) {
    if (importMode === 'update' || importMode === 'create_update') {
      resolution = 'update'; targetEmployeeId = empNo;   // resolved to id at commit
    } else if (policy.duplicateEmployeeNumber === 'update') {
      // `create` mode must not update. Honour the policy's intent by refusing the row
      // rather than silently converting it into an update.
      errors.push({ fieldKey: 'employeeNumber', code: 'duplicate_in_create_mode', severity: 'error', message: `employee number ${empNo} already exists; switch to "update" or "create & update" mode to modify it`, resolutionRequired: true });
    } else if (policy.duplicateEmployeeNumber === 'error') {
      errors.push({ fieldKey: 'employeeNumber', code: 'duplicate_employee_number', severity: 'error', message: `employee number ${empNo} already exists`, resolutionRequired: true });
    } else {
      return { status: 'duplicate', severity: 'warning', resolution: 'skip', targetEmployeeId: null, errors: [] };
    }
  } else if (importMode === 'update') {
    // No match, and the mode forbids creating.
    errors.push({
      fieldKey: 'employeeNumber',
      code: 'update_target_not_found',
      severity: 'error',
      message: empNo
        ? `no existing employee with number ${empNo}; update mode cannot create records`
        : 'update mode requires an employee number that matches an existing record',
      resolutionRequired: true,
    });
  } else if (userDup) {
    if (policy.duplicateUsername === 'error') {
      errors.push({ fieldKey: 'username', code: 'duplicate_username', severity: 'error', message: `username ${username} already exists`, resolutionRequired: true });
    } else {
      return { status: 'duplicate', severity: 'warning', resolution: 'skip', targetEmployeeId: null, errors: [] };
    }
  }

  // Supervisor existence (optional field) — policy-driven.
  const supKey = norm(m.supervisor).toLowerCase();
  let supWarn = false;
  if (supKey && !ctx.supervisorByKey.has(supKey)) {
    if (policy.missingSupervisor === 'block') errors.push({ fieldKey: 'supervisor', code: 'unknown_supervisor', severity: 'error', message: `supervisor "${m.supervisor}" not found`, resolutionRequired: true });
    else if (policy.missingSupervisor === 'warn') supWarn = true;
  }

  // Statutory completeness (NIS/BIR) — policy-driven, warning by default.
  let statWarn = false;
  const hasStatutory = STATUTORY_KEYS.some(k => norm(m[k]));
  if (!hasStatutory && policy.missingStatutory !== 'allow') {
    if (policy.missingStatutory === 'block') errors.push({ fieldKey: null, code: 'missing_statutory', severity: 'error', message: 'statutory fields are required by policy', resolutionRequired: true });
    else statWarn = true;
  }
  if (supWarn) errors.push({ fieldKey: 'supervisor', code: 'unknown_supervisor', severity: 'warning', message: `supervisor "${m.supervisor}" not found — will be left unset`, resolutionRequired: false });
  if (statWarn) errors.push({ fieldKey: null, code: 'missing_statutory', severity: 'warning', message: 'no statutory fields — payroll will be pending', resolutionRequired: false });

  if (errors.some(e => e.severity === 'error')) return { status: 'blocked', severity: 'error', resolution, targetEmployeeId, errors };
  if (errors.some(e => e.severity === 'warning')) return { status: 'warning', severity: 'warning', resolution, targetEmployeeId, errors };
  return { status: 'ready', severity: null, resolution, targetEmployeeId, errors };
}

/** Load the dedup/resolution lookups once for a validate/commit pass. */
async function loadLookups(): Promise<LookupCtx> {
  const [{ data: users }, { data: depts }] = await Promise.all([
    sb.from('app_users').select('id, username, employee_number, full_name, site_id'),
    sb.from('departments').select('id, name'),
  ]);
  const usernames = new Set<string>();
  const employeeNumbers = new Set<string>();
  const supervisorByKey = new Map<string, string>();
  const siteIds = new Set<string>();
  for (const u of (users ?? []) as { id: string; username: string | null; employee_number: string | null; full_name: string | null; site_id: string | null }[]) {
    if (u.username) { usernames.add(u.username.toLowerCase()); supervisorByKey.set(u.username.toLowerCase(), u.id); }
    if (u.employee_number) { employeeNumbers.add(u.employee_number.toUpperCase()); supervisorByKey.set(u.employee_number.toLowerCase(), u.id); }
    if (u.full_name) supervisorByKey.set(u.full_name.toLowerCase(), u.id);
    if (u.site_id) siteIds.add(u.site_id);
  }
  const deptByKey = new Map<string, string>();
  for (const d of (depts ?? []) as { id: string; name: string }[]) {
    deptByKey.set(d.id.toLowerCase(), d.id);
    deptByKey.set(d.name.toLowerCase(), d.id);
  }
  return { usernames, employeeNumbers, deptByKey, siteIds, supervisorByKey };
}

/** Raw batch read. A DB failure must NOT be reported as "not found" — that turns an
 *  outage into a misleading 404 and hides the real error. */
async function loadBatch(id: string) {
  const { data, error } = await sb.from('hr_employee_import_batches').select('*').eq('id', id).maybeSingle<Record<string, unknown>>();
  if (error) throw Object.assign(new Error(`Could not read import batch: ${error.message}`), { status: 500 });
  return data;
}

/**
 * Load a batch the actor is ALLOWED to act on.
 *
 * Capability alone is not authorisation here: a staged batch holds raw personal data
 * (date of birth, nationality, NIS, BIR) for everyone in the file, and the report
 * endpoint returns the full mapped_data. Every batch route therefore scopes to the
 * uploader unless the actor holds `hr.employees.import.manage_all`.
 *
 * Returns a discriminated result so callers surface the right status: `not_found` for
 * a genuinely missing batch, `forbidden` for someone else's.
 */
async function loadScopedBatch(
  actor: { id: string; role?: string | null },
  batchId: string,
): Promise<{ ok: true; batch: Record<string, unknown> } | { ok: false; status: 404 | 403; message: string }> {
  const batch = await loadBatch(batchId);
  if (!batch) return { ok: false, status: 404, message: 'Import batch not found.' };
  if (batch.uploaded_by === actor.id) return { ok: true, batch };

  // The whole actor is passed, not just the id: userCan resolves the role's grants and
  // the superadmin carve-out from `role`. An id-only object silently resolves to no role.
  if (await userCan(actor, 'hr.employees.import.manage_all')) return { ok: true, batch };

  // Deliberately does NOT reveal whether the batch exists or who owns it.
  return { ok: false, status: 403, message: 'This import batch belongs to another operator.' };
}

// ── 1. upload ─────────────────────────────────────────────────────────────────
router.post('/employees/import/upload', async c => {
  const actor = await requirePermission(c, 'hr.employees.import.upload');
  const v = zv(c, z.object({
    fileName:   z.string().min(1).max(255),
    fileType:   z.enum(['csv']),
    // Bounded at the schema so an oversized payload is rejected BEFORE it is decoded
    // into memory. Previously any non-empty string was accepted, held whole in the
    // request, decoded, parsed, and inserted in a single statement.
    fileBase64: z.string().min(1).max(IMPORT_LIMITS.maxBase64Chars, `The file is too large. The limit is ${IMPORT_LIMITS.maxFileBytes / 1024 / 1024} MB.`),
    importMode: z.enum(['create', 'update', 'create_update']).optional(),
    defaultSiteId:       z.string().nullable().optional(),
    defaultDepartmentId: z.string().nullable().optional(),
  }), body(c));
  if (!v.ok) return v.response;

  let text: string;
  try { text = Buffer.from(v.data.fileBase64, 'base64').toString('utf8'); }
  catch { return c.json({ success: false, message: 'Could not decode the uploaded file.' }, 400 as 200); }

  if (Buffer.byteLength(text, 'utf8') > IMPORT_LIMITS.maxFileBytes) {
    return c.json({ success: false, message: `The file is too large. The limit is ${IMPORT_LIMITS.maxFileBytes / 1024 / 1024} MB.` }, 400 as 200);
  }

  const parsed = parseCsv(text);
  if (!parsed.headers.length) return c.json({ success: false, message: 'The file has no header row.' }, 400 as 200);
  if (!parsed.rows.length)    return c.json({ success: false, message: 'The file has no data rows.' }, 400 as 200);

  // Structural + size limits, enforced before any row is staged.
  const limitError = checkImportLimits(parsed);
  if (limitError) return c.json({ success: false, message: limitError }, 400 as 200);

  const batchNo = await nextRef('HRI');
  // Defaults come from the Employee Master settings catalog (employees.import_default_*)
  // unless the request overrides them; set-policy can still override later.
  const importMode = v.data.importMode ?? await resolveSettingValue<string>(sb, 'employees.import_default_mode', { moduleKey: 'employees' }, 'create');
  const policyDefaults = {
    // employees.import_default_create_logins is intentionally NOT read: import no longer
    // creates credentials at all, so honouring the setting would be theatre.
    duplicateEmployeeNumber: await resolveSettingValue<string>(sb, 'employees.import_duplicate_employee_number', { moduleKey: 'employees' }, 'skip'),
  };
  const { data: batch, error: bErr } = await sb.from('hr_employee_import_batches').insert({
    batch_no: batchNo, uploaded_by: actor.id, file_name: v.data.fileName, file_type: v.data.fileType,
    import_mode: importMode, status: 'uploaded', total_rows: parsed.rows.length, policy: policyDefaults,
    default_site_id: v.data.defaultSiteId ?? null, default_department_id: v.data.defaultDepartmentId ?? null,
  }).select('id, batch_no').single<{ id: string; batch_no: string }>();
  if (bErr) return c.json({ success: false, message: bErr.message }, 500 as 200);

  const { error: rErr } = await sb.from('hr_employee_import_rows').insert(
    parsed.rows.map((r, i) => ({ batch_id: batch.id, row_no: i + 1, raw_data: r, status: 'pending' })),
  );
  if (rErr) { await sb.from('hr_employee_import_batches').delete().eq('id', batch.id); return c.json({ success: false, message: rErr.message }, 500 as 200); }

  await writeHrAudit({ submoduleKey: 'import', recordId: batch.id, actorId: actor.id, action: 'hr.import.uploaded',
    newState: { batchNo, fileName: v.data.fileName, totalRows: parsed.rows.length } });
  return c.json({ success: true, data: { batchId: batch.id, batchNo: batch.batch_no, totalRows: parsed.rows.length, columns: parsed.headers, sample: parsed.rows.slice(0, 10) } });
});

// ── 2. map-fields ─────────────────────────────────────────────────────────────
router.post('/employees/import/map-fields', async c => {
  const actor = await requirePermission(c, 'hr.employees.import.map');
  const v = zv(c, z.object({ batchId: z.uuid(), mapping: z.record(z.string(), z.string()) }), body(c));
  if (!v.ok) return v.response;
  const scoped = await loadScopedBatch(actor, v.data.batchId);
  if (!scoped.ok) return c.json({ success: false, message: scoped.message }, scoped.status as 200);

  // Server-owned allowlist: unknown targets are refused, never persisted.
  const mappingError = checkMapping(v.data.mapping);
  if (mappingError) return c.json({ success: false, message: mappingError }, 400 as 200);

  const { error } = await sb.from('hr_employee_import_batches')
    .update({ mapping: v.data.mapping, mapping_version: IMPORT_MAPPING_VERSION, status: 'mapped' })
    .eq('id', v.data.batchId);
  if (error) return c.json({ success: false, message: error.message }, 500 as 200);
  await writeHrAudit({ submoduleKey: 'import', recordId: v.data.batchId, actorId: actor.id, action: 'hr.import.mapped', newState: { mapping: v.data.mapping } });
  return c.json({ success: true, data: { batchId: v.data.batchId } });
});

// ── 3. set-policy ─────────────────────────────────────────────────────────────
router.post('/employees/import/set-policy', async c => {
  const actor = await requirePermission(c, 'hr.employees.import.map');
  const v = zv(c, z.object({ batchId: z.uuid(), policy: PolicySchema }), body(c));
  if (!v.ok) return v.response;
  const scoped = await loadScopedBatch(actor, v.data.batchId);
  if (!scoped.ok) return c.json({ success: false, message: scoped.message }, scoped.status as 200);
  const { error } = await sb.from('hr_employee_import_batches').update({ policy: v.data.policy }).eq('id', v.data.batchId);
  if (error) return c.json({ success: false, message: error.message }, 500 as 200);
  await writeHrAudit({ submoduleKey: 'import', recordId: v.data.batchId, actorId: actor.id, action: 'hr.import.policy_set', newState: { policy: v.data.policy } });
  return c.json({ success: true, data: { batchId: v.data.batchId } });
});

// ── 4. validate ───────────────────────────────────────────────────────────────
router.post('/employees/import/validate', async c => {
  const actor = await requirePermission(c, 'hr.employees.import.validate');
  const v = zv(c, z.object({ batchId: z.uuid() }), body(c));
  if (!v.ok) return v.response;

  const scoped = await loadScopedBatch(actor, v.data.batchId);
  if (!scoped.ok) return c.json({ success: false, message: scoped.message }, scoped.status as 200);
  const batch = scoped.batch;
  const mapping = (batch.mapping ?? {}) as Record<string, string>;
  if (!Object.keys(mapping).length) return c.json({ success: false, message: 'Map columns before validating.' }, 400 as 200);
  const policy: ImportPolicy = { ...DEFAULT_POLICY, ...((batch.policy ?? {}) as Partial<ImportPolicy>) };
  const importMode = typeof batch.import_mode === 'string' ? batch.import_mode : 'create';

  const [{ data: rows }, ctx] = await Promise.all([
    sb.from('hr_employee_import_rows').select('id, row_no, raw_data').eq('batch_id', v.data.batchId).order('row_no'),
    loadLookups(),
  ]);
  // Re-validating is idempotent — clear prior errors for this batch.
  await sb.from('hr_employee_import_row_errors').delete().eq('batch_id', v.data.batchId);

  const tally = { ready: 0, warning: 0, blocked: 0, duplicate: 0 };
  const errorRows: Record<string, unknown>[] = [];
  for (const r of (rows ?? []) as { id: string; row_no: number; raw_data: Record<string, string> }[]) {
    const mapped = applyMapping(r.raw_data, mapping);
    const verdict = validateRow(mapped, importMode, policy, ctx);
    tally[verdict.status]++;
    await sb.from('hr_employee_import_rows').update({
      mapped_data: mapped, status: verdict.status, severity: verdict.severity,
      resolution: verdict.resolution, target_employee_id: null,   // resolved at commit
    }).eq('id', r.id);
    for (const e of verdict.errors) {
      errorRows.push({ batch_id: v.data.batchId, row_id: r.id, field_key: e.fieldKey, error_code: e.code, severity: e.severity, message: e.message, resolution_required: e.resolutionRequired });
    }
  }
  if (errorRows.length) await sb.from('hr_employee_import_row_errors').insert(errorRows);

  await sb.from('hr_employee_import_batches').update({
    status: 'validated', ready_rows: tally.ready, warning_rows: tally.warning, blocked_rows: tally.blocked, duplicate_rows: tally.duplicate,
  }).eq('id', v.data.batchId);
  await writeHrAudit({ submoduleKey: 'import', recordId: v.data.batchId, actorId: actor.id, action: 'hr.import.validated', newState: tally });

  return c.json({ success: true, data: { batchId: v.data.batchId, summary: tally } });
});

// ── 5. resolve-row ────────────────────────────────────────────────────────────
router.post('/employees/import/resolve-row', async c => {
  const actor = await requirePermission(c, 'hr.employees.import.validate');
  const v = zv(c, z.object({
    batchId: z.uuid(), rowId: z.uuid(),
    action: z.enum(['edit', 'ignore', 'skip', 'assign']),
    patch: z.record(z.string(), z.string()).optional(),
  }), body(c));
  if (!v.ok) return v.response;

  const { data: row } = await sb.from('hr_employee_import_rows').select('id, status, mapped_data').eq('id', v.data.rowId).eq('batch_id', v.data.batchId).maybeSingle<{ id: string; status: string; mapped_data: Record<string, string> }>();
  if (!row) return c.json({ success: false, message: 'Import row not found.' }, 404 as 200);

  if (v.data.action === 'skip') {
    await sb.from('hr_employee_import_rows').update({ status: 'skipped', resolution: 'skip' }).eq('id', row.id);
    await writeHrAudit({ submoduleKey: 'import', recordId: v.data.batchId, actorId: actor.id, action: 'hr.import.row_skipped', newState: { rowId: row.id } });
    return c.json({ success: true, data: { rowId: row.id, status: 'skipped' } });
  }
  if (v.data.action === 'ignore') {
    if (row.status !== 'warning') return c.json({ success: false, message: 'Only warning rows can be ignored.' }, 400 as 200);
    await sb.from('hr_employee_import_rows').update({ status: 'ready', resolution: 'ignored' }).eq('id', row.id);
    return c.json({ success: true, data: { rowId: row.id, status: 'ready' } });
  }

  // edit / assign → merge the patch into mapped_data, then re-validate this row.
  const merged = { ...row.mapped_data, ...(v.data.patch ?? {}) };
  const scoped = await loadScopedBatch(actor, v.data.batchId);
  if (!scoped.ok) return c.json({ success: false, message: scoped.message }, scoped.status as 200);
  const batch = scoped.batch;
  const policy: ImportPolicy = { ...DEFAULT_POLICY, ...((batch.policy ?? {}) as Partial<ImportPolicy>) };
  const importMode = typeof batch.import_mode === 'string' ? batch.import_mode : 'create';
  const ctx = await loadLookups();
  const verdict = validateRow(merged, importMode, policy, ctx);
  await sb.from('hr_employee_import_row_errors').delete().eq('row_id', row.id);
  await sb.from('hr_employee_import_rows').update({ mapped_data: merged, status: verdict.status, severity: verdict.severity, resolution: verdict.resolution ?? v.data.action }).eq('id', row.id);
  if (verdict.errors.length) {
    await sb.from('hr_employee_import_row_errors').insert(verdict.errors.map(e => ({ batch_id: v.data.batchId, row_id: row.id, field_key: e.fieldKey, error_code: e.code, severity: e.severity, message: e.message, resolution_required: e.resolutionRequired })));
  }
  await writeHrAudit({ submoduleKey: 'import', recordId: v.data.batchId, actorId: actor.id, action: 'hr.import.row_resolved', newState: { rowId: row.id, action: v.data.action, status: verdict.status } });
  return c.json({ success: true, data: { rowId: row.id, status: verdict.status } });
});

/** Build provisionEmployee input from a mapped row + resolved lookups. */
function toProvisionInput(m: Record<string, string>, policy: ImportPolicy, ctx: LookupCtx, batch: Record<string, unknown>) {
  const deptId = ctx.deptByKey.get(norm(m.department).toLowerCase()) ?? (batch.default_department_id as string | null) ?? null;
  const supId  = ctx.supervisorByKey.get(norm(m.supervisor).toLowerCase()) ?? null;
  const siteId = (norm(m.site) && ctx.siteIds.has(norm(m.site))) ? norm(m.site) : (batch.default_site_id as string | null) ?? null;
  const statutory: Record<string, unknown> = {};
  if (m.nisNumber)     statutory.nisNumber     = m.nisNumber;
  if (m.nisStatus)     statutory.nisStatus     = m.nisStatus;
  if (m.birFileNumber) statutory.birFileNumber = m.birFileNumber;
  if (parseBool(m.td1Received) !== undefined) statutory.td1Received = parseBool(m.td1Received);
  if (parseBool(m.hsApplicable) !== undefined) statutory.hsApplicable = parseBool(m.hsApplicable);
  return {
    identity: {
      username: deriveUsername(m),
      fullName: norm(m.fullName) || `${norm(m.firstName)} ${norm(m.lastName)}`.trim(),
      firstName: norm(m.firstName) || undefined, lastName: norm(m.lastName) || undefined,
      email: norm(m.email) || undefined, phone: norm(m.phone) || undefined,
      employeeNumber: norm(m.employeeNumber) || undefined,
      dateOfBirth: norm(m.dateOfBirth) || undefined, nationality: norm(m.nationality) || undefined,
    },
    employment: { employmentType: norm(m.employmentType) || undefined, contractorFlag: norm(m.workerType).toLowerCase() === 'contractor', startDate: norm(m.startDate) || undefined, position: norm(m.position) || undefined },
    assignment: { departmentId: deptId, siteId, supervisorId: supId },
    // NO access block: an imported row can never carry a role. Every imported employee
    // lands on the default `employee` role. Elevated access is a governed access-profile
    // request made deliberately per person, not a spreadsheet column.
    statutory,
    recordStatus: policy.defaultRecordStatus,
  };
}

/** The ONLY employee columns an imported row may change. Anything absent here — most
 *  importantly `role` — is unreachable from a spreadsheet. Mirrors the allowlist
 *  enforced inside hr_employee_import_update_tx, so neither layer alone is load-bearing. */
export const IMPORT_UPDATE_PATCH_FIELDS = ['position', 'email', 'phone', 'employmentType'] as const;

/** Build the allowlisted employee patch + resolved assignment for an update row. */
export function buildImportUpdatePatch(
  m: Record<string, string>,
  lookups: {
    deptByKey: Map<string, string>;
    supervisorByKey: Map<string, string>;
    siteIds: Set<string>;
  },
): { patch: Record<string, string>; assignment: Record<string, string | null> } {
  const patch: Record<string, string> = {};
  for (const f of IMPORT_UPDATE_PATCH_FIELDS) {
    const value = norm(m[f]);
    if (value) patch[f] = value;
  }
  const site = norm(m.site);
  return {
    patch,
    assignment: {
      departmentId: lookups.deptByKey.get(norm(m.department).toLowerCase()) ?? null,
      siteId:       site && lookups.siteIds.has(site) ? site : null,
      supervisorId: lookups.supervisorByKey.get(norm(m.supervisor).toLowerCase()) ?? null,
    },
  };
}

/**
 * Update an existing employee from a mapped row (update / create_update mode).
 *
 * ONE transactional command (hr_employee_import_update_tx): the allowlisted employee
 * patch, an effective-dated assignment change, the CANONICAL statutory profile, and the
 * HR audit row with previous AND new state all commit together, or none of them do.
 * The previous implementation issued four separate PostgREST calls, wrote the legacy
 * statutory table, and left no assignment history.
 */
async function updateFromImport(
  targetId: string, m: Record<string, string>, ctx: LookupCtx, actorId: string,
  meta: { rowNo: number; batchNo: string; requestId: string | null },
): Promise<void> {
  const { patch, assignment } = buildImportUpdatePatch(m, ctx);

  // Statutory goes to the CANONICAL profile shape; readiness is recomputed from the
  // merged view so the stored status always agrees with the stored fields.
  const stPatch = statutoryProfilePatch({
    nisNumber: m.nisNumber, nisStatus: m.nisStatus, birFileNumber: m.birFileNumber,
    td1Received: parseBool(m.td1Received), hsApplicable: parseBool(m.hsApplicable),
  });
  let readiness = { status: 'pending', blockers: [] as string[], financeEligible: false };
  if (Object.keys(stPatch).length) {
    const { data: existing, error: exErr } = await sb.from('hr_employee_statutory_profiles')
      .select('*').eq('employee_id', targetId).maybeSingle<Record<string, unknown>>();
    if (exErr) throw Object.assign(new Error(`Could not read the statutory profile: ${exErr.message}`), { status: 500 });
    const merged = statutoryWithDefaults({ ...(existing ?? {}), ...stPatch });
    const computed = computePayrollReadiness(merged);
    readiness = { status: computed.status, blockers: computed.blockers, financeEligible: computed.financeEligible };
  }

  const { error } = await sb.rpc('hr_employee_import_update_tx', {
    p_actor_id:    actorId,
    p_employee_id: targetId,
    p_patch:       patch,
    p_assignment:  assignment,
    p_statutory:   stPatch,
    p_readiness:   readiness,
    p_row_no:      meta.rowNo,
    p_batch_no:    meta.batchNo,
    p_request_id:  meta.requestId,
  });
  if (error) throw Object.assign(new Error(error.message), { status: 500 });
}

// ── 6. commit ─────────────────────────────────────────────────────────────────
router.post('/employees/import/commit', async c => {
  const actor = await requirePermission(c, 'hr.employees.import.commit');
  const v = zv(c, z.object({ batchId: z.uuid() }), body(c));
  if (!v.ok) return v.response;

  const scoped = await loadScopedBatch(actor, v.data.batchId);
  if (!scoped.ok) return c.json({ success: false, message: scoped.message }, scoped.status as 200);
  const batch = scoped.batch;
  const batchStatus = typeof batch.status === 'string' ? batch.status : '';
  if (batchStatus !== 'validated') return c.json({ success: false, message: `Validate the batch first (status: ${batchStatus}).` }, 400 as 200);
  const policy: ImportPolicy = { ...DEFAULT_POLICY, ...((batch.policy ?? {}) as Partial<ImportPolicy>) };

  await sb.from('hr_employee_import_batches').update({ status: 'committing' }).eq('id', v.data.batchId);
  const ctx = await loadLookups();

  // Committable: ready rows + warnings the user explicitly ignored.
  const { data: rows } = await sb.from('hr_employee_import_rows')
    .select('id, mapped_data, status, resolution').eq('batch_id', v.data.batchId)
    .in('status', ['ready']).order('row_no');

  const result = await runModuleMutation<{ id: string; ref: string; created: number; updated: number; failed: number }>({
    context: { actorUserId: actor.id },
    options: {
      module: 'hr', operation: 'create', entityType: 'employee_import_batch',
      idempotencyKey: `hr.import.commit:${v.data.batchId}`,
      eventType: 'hr.import.committed', eventSeverity: 'info',
      getEntityIdentity: (r) => ({ id: r.id, ref: r.ref }),
      buildEventPayload: (r) => ({ batchNo: r.ref, created: r.created, updated: r.updated, failed: r.failed }),
    },
    writeRecord: async () => {
      let created = 0, updated = 0, failed = 0;
      for (const r of (rows ?? []) as { id: string; mapped_data: Record<string, string>; resolution: string | null }[]) {
        try {
          if (r.resolution === 'update') {
            const empNo = norm(r.mapped_data.employeeNumber).toUpperCase();
            const { data: tgt } = await sb.from('app_users').select('id').eq('employee_number', empNo).maybeSingle<{ id: string }>();
            if (!tgt) throw new Error(`update target ${empNo} not found`);
            await updateFromImport(tgt.id, r.mapped_data, ctx, actor.id,
              { rowNo: (r as { row_no?: number }).row_no ?? 0, batchNo: typeof batch.batch_no === 'string' ? batch.batch_no : '', requestId: null });
            await sb.from('hr_employee_import_rows').update({ status: 'updated', target_employee_id: tgt.id }).eq('id', r.id);
            updated++;
          } else {
            // Mode is re-checked HERE, not just at validation. Validation state can be
            // stale by commit time (the batch is re-validatable, and rows can be
            // resolved individually), so `update` mode must be unable to create even if
            // a row somehow arrives without an update resolution.
            if (batch.import_mode === 'update') {
              throw new Error('update mode cannot create records — no existing employee matched this row');
            }
            const prov = await provisionEmployee(actor.id, toProvisionInput(r.mapped_data, policy, ctx, batch));
            await sb.from('hr_employee_import_rows').update({ status: 'created', target_employee_id: prov.id }).eq('id', r.id);
            // Imported employees emit the same domain event as a single create.
            void emitAppEvent({ eventType: 'hr.employee.created', sourceModule: 'hr', sourceEntityType: 'employee', sourceEntityId: prov.id, actorUserId: actor.id, severity: 'info', payload: { employeeNumber: prov.employeeNo, viaImport: batch.batch_no } });
            created++;
          }
        } catch (e) {
          failed++;
          await sb.from('hr_employee_import_rows').update({ status: 'failed' }).eq('id', r.id);
          await sb.from('hr_employee_import_row_errors').insert({ batch_id: v.data.batchId, row_id: r.id, field_key: null, error_code: 'commit_failed', severity: 'error', message: e instanceof Error ? e.message : 'commit failed', resolution_required: true });
        }
      }
      await sb.from('hr_employee_import_batches').update({
        status: 'committed', created_rows: created, updated_rows: updated, failed_rows: failed, committed_at: new Date().toISOString(),
      }).eq('id', v.data.batchId);
      return { id: v.data.batchId, ref: String(batch.batch_no), created, updated, failed };
    },
  });

  await writeHrAudit({ submoduleKey: 'import', recordId: v.data.batchId, actorId: actor.id, action: 'hr.import.committed', newState: { created: result.record.created, updated: result.record.updated, failed: result.record.failed } });
  return c.json({ success: true, data: { batchId: v.data.batchId, created: result.record.created, updated: result.record.updated, failed: result.record.failed } });
});

// ── 7. report ─────────────────────────────────────────────────────────────────
router.post('/employees/import/report', async c => {
  const actor = await requirePermission(c, 'hr.employees.import.report.download');
  const v = zv(c, z.object({ batchId: z.uuid() }), body(c));
  if (!v.ok) return v.response;

  const scoped = await loadScopedBatch(actor, v.data.batchId);
  if (!scoped.ok) return c.json({ success: false, message: scoped.message }, scoped.status as 200);
  const batch = scoped.batch;
  const [{ data: rows }, { data: errors }] = await Promise.all([
    sb.from('hr_employee_import_rows').select('id, row_no, status, severity, resolution, target_employee_id, mapped_data').eq('batch_id', v.data.batchId).order('row_no'),
    sb.from('hr_employee_import_row_errors').select('row_id, field_key, error_code, severity, message').eq('batch_id', v.data.batchId),
  ]);
  return c.json({ success: true, data: {
    batch: {
      batchNo: batch.batch_no, status: batch.status, importMode: batch.import_mode,
      totalRows: batch.total_rows, readyRows: batch.ready_rows, warningRows: batch.warning_rows,
      blockedRows: batch.blocked_rows, duplicateRows: batch.duplicate_rows,
      createdRows: batch.created_rows, updatedRows: batch.updated_rows, failedRows: batch.failed_rows,
    },
    rows: rows ?? [], errors: errors ?? [],
  } });
});

export default router;
