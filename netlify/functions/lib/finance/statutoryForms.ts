// ============================================================================
// Finance Payroll -- statutory forms store (Wave 7 foundation)
// ============================================================================
// Table + storage layer for generated statutory forms (TD4/TD4 Summary/NI184/
// NI187). Form-specific BUILDERS (figures + PDF/CSV) live in td4Forms.ts /
// niForms.ts and call recordStatutoryForm() here. Mirrors the bank-files
// pattern: upload artifact -> record row -> signed-url download (+ audit/event).
// ============================================================================

import { createHash } from 'crypto';
import { sb } from '../db';
import { emitAppEvent, buildEventRow, deliverEventNotifications } from '../appEvents';
import { writeHrAudit, buildHrAuditRow } from '../hr/employeeCore';

export const STATUTORY_FORMS_BUCKET = 'statutory-forms';

export type StatutoryFormType = 'td4' | 'td4_summary' | 'ni184' | 'ni187';

export interface StatutoryFormDto {
  id: string;
  formType: StatutoryFormType;
  taxYear: number | null;
  periodStart: string | null;
  periodEnd: string | null;
  employeeId: string | null;
  runId: string | null;
  scope: 'employee' | 'employer';
  format: string;
  filePath: string;
  dataFilePath: string | null;
  totals: Record<string, unknown>;
  checksum: string | null;
  status: 'generated' | 'superseded';
  generatedBy: string | null;
  createdAt: string;
  metadata: Record<string, unknown>;
}

interface DbRow {
  id: string; form_type: string; tax_year: number | null; period_start: string | null; period_end: string | null;
  employee_id: string | null; run_id: string | null; scope: string; format: string;
  file_path: string; data_file_path: string | null; totals: Record<string, unknown>;
  checksum: string | null; status: string; generated_by: string | null; created_at: string;
  metadata: Record<string, unknown>;
}
function toDto(r: DbRow): StatutoryFormDto {
  return {
    id: r.id, formType: r.form_type as StatutoryFormType, taxYear: r.tax_year, periodStart: r.period_start, periodEnd: r.period_end,
    employeeId: r.employee_id, runId: r.run_id, scope: r.scope as 'employee' | 'employer', format: r.format,
    filePath: r.file_path, dataFilePath: r.data_file_path, totals: r.totals, checksum: r.checksum,
    status: r.status as 'generated' | 'superseded', generatedBy: r.generated_by, createdAt: r.created_at, metadata: r.metadata,
  };
}

/** Bucket-relative object key (defensive strip of a legacy bucket prefix). */
function bucketKey(path: string): string {
  return path.replace(new RegExp('^' + STATUTORY_FORMS_BUCKET + '/'), '');
}

export function sha256Hex(content: string | Buffer): string {
  return createHash('sha256').update(content).digest('hex');
}

/** Upload one artifact (PDF or CSV) to the private statutory-forms bucket. */
export async function uploadFormArtifact(key: string, bytes: Uint8Array, contentType: string): Promise<void> {
  const { error } = await sb.storage.from(STATUTORY_FORMS_BUCKET).upload(key, bytes, { contentType, upsert: true });
  if (error) throw Object.assign(new Error('uploadFormArtifact(' + key + '): ' + error.message), { status: 500 });
}

export interface RecordStatutoryFormInput {
  formType: StatutoryFormType;
  taxYear?: number | null;
  periodStart?: string | null;
  periodEnd?: string | null;
  employeeId?: string | null;
  runId?: string | null;
  scope?: 'employee' | 'employer';
  format?: string;
  filePath: string;
  dataFilePath?: string | null;
  totals?: Record<string, unknown>;
  checksum?: string | null;
  actorId: string;
  metadata?: Record<string, unknown>;
}

/**
 * Insert a form row + emit its `finance.payroll.statutory_form.generated` event
 * and hr_audit_log. Supersedes any prior GENERATED form with the same identity
 * (type + year/period + employee) so a re-run keeps a clean "current" set.
 *
 * The supersede + insert run in ONE transaction via finance_record_statutory_form_commit
 * — a mid-operation failure can never leave an identity with zero or two 'generated'
 * rows. (The artifact upload happens before this call; object storage is external to
 * the DB txn, so an orphaned artifact on a failed commit is harmless / overwritten.)
 */
export async function recordStatutoryForm(input: RecordStatutoryFormInput): Promise<StatutoryFormDto> {
  // P3: build the event + audit row objects BEFORE the RPC so they can be inserted
  // atomically inside the same transaction. The form's uuid (unknown to JS at this
  // point) is used as source_entity_id inside the RPC (the p_event.source_entity_id
  // value passed here is a placeholder overridden by the function with v_row.id).
  const sfEventInput = {
    eventType:        'finance.payroll.statutory_form.generated',
    sourceModule:     'finance_payroll',
    sourceEntityType: 'statutory_form',
    sourceEntityId:   '', // placeholder — overridden inside the RPC with v_row.id
    actorUserId:      input.actorId,
    severity:         'info' as const,
    payload:          {
      formType:   input.formType,
      taxYear:    input.taxYear,
      employeeId: input.employeeId,
    },
  };

  const rpcResult = (await sb.rpc('finance_record_statutory_form_commit', {
    p_form: {
      form_type: input.formType, tax_year: input.taxYear ?? null,
      period_start: input.periodStart ?? null, period_end: input.periodEnd ?? null,
      employee_id: input.employeeId ?? null, run_id: input.runId ?? null,
      scope: input.scope ?? (input.employeeId ? 'employee' : 'employer'),
      format: input.format ?? 'pdf', file_path: input.filePath, data_file_path: input.dataFilePath ?? null,
      totals: input.totals ?? {}, checksum: input.checksum ?? null, generated_by: input.actorId,
      metadata: input.metadata ?? {},
    },
    p_event: buildEventRow(sfEventInput),
    p_audit: buildHrAuditRow({
      submoduleKey: 'finance_payroll', recordId: null, // form id not yet known; will be set as source_entity_id in event
      actorId: input.actorId, action: 'statutory_form.generated',
      previousState: null, newState: { formType: input.formType, taxYear: input.taxYear, employeeId: input.employeeId },
    }),
  })) as { data: unknown; error: { message: string } | null };
  const { data, error } = rpcResult;
  if (error) throw Object.assign(new Error('recordStatutoryForm: ' + error.message), { status: 500 });
  const dto = toDto(data as DbRow);

  // P1-8 (same pattern as calc publish): AWAITED best-effort delivery after
  // commit — a serverless freeze can no longer drop it. No notification block is
  // configured for statutory_form.generated today (silent audit event), so this
  // is a fast no-op; a failure is observability, never a rollback.
  try {
    await deliverEventNotifications({ ...sfEventInput, sourceEntityId: dto.id }, null);
  } catch (e) {
    console.error(`[payroll] statutory-form-notify-failed form=${dto.id}:`,
      e instanceof Error ? e.message : e);
  }

  return dto;
}

export async function listStatutoryForms(opts: {
  formType?: StatutoryFormType; taxYear?: number; employeeId?: string; status?: 'generated' | 'superseded';
} = {}): Promise<StatutoryFormDto[]> {
  let q = sb.from('finance_statutory_forms').select('*').order('created_at', { ascending: false }).limit(1000);
  if (opts.formType) q = q.eq('form_type', opts.formType);
  if (opts.taxYear != null) q = q.eq('tax_year', opts.taxYear);
  if (opts.employeeId) q = q.eq('employee_id', opts.employeeId);
  q = q.eq('status', opts.status ?? 'generated');
  const { data, error } = await q;
  if (error) throw Object.assign(new Error('listStatutoryForms: ' + error.message), { status: 500 });
  return (data as DbRow[]).map(toDto);
}

export async function getStatutoryForm(id: string): Promise<StatutoryFormDto | null> {
  const { data, error } = await sb.from('finance_statutory_forms').select('*').eq('id', id).maybeSingle<DbRow>();
  if (error) throw Object.assign(new Error('getStatutoryForm: ' + error.message), { status: 500 });
  return data ? toDto(data) : null;
}

/** Short-lived signed URL for a form artifact (PDF by default, or its data file). */
export async function getStatutoryFormSignedUrl(
  id: string, actorId: string, which: 'pdf' | 'data' = 'pdf',
): Promise<{ signedUrl: string; form: StatutoryFormDto }> {
  const form = await getStatutoryForm(id);
  if (!form) throw Object.assign(new Error('Statutory form not found.'), { status: 404 });
  const path = which === 'data' ? form.dataFilePath : form.filePath;
  if (!path) throw Object.assign(new Error('No ' + which + ' artifact for this form.'), { status: 422 });

  const { data, error } = await sb.storage.from(STATUTORY_FORMS_BUCKET).createSignedUrl(bucketKey(path), 300);
  if (error || !data.signedUrl) {
    throw Object.assign(new Error('getStatutoryFormSignedUrl: ' + (error?.message ?? 'Unknown error')), { status: 500 });
  }
  void emitAppEvent({
    eventType: 'finance.payroll.statutory_form.downloaded',
    sourceModule: 'finance_payroll', sourceEntityType: 'statutory_form', sourceEntityId: id,
    actorUserId: actorId, severity: 'info', payload: { formType: form.formType, which },
  });
  await writeHrAudit({
    submoduleKey: 'finance_payroll', recordId: id, actorId,
    action: 'statutory_form.downloaded', previousState: null, newState: { formType: form.formType, which },
  });
  return { signedUrl: data.signedUrl, form };
}
