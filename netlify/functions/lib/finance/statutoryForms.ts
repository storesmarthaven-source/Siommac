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
import { emitAppEvent } from '../appEvents';
import { writeHrAudit } from '../hr/employeeCore';

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
 */
export async function recordStatutoryForm(input: RecordStatutoryFormInput): Promise<StatutoryFormDto> {
  // Mark prior generations of the same identity superseded (kept for audit history).
  let sup = sb.from('finance_statutory_forms').update({ status: 'superseded' })
    .eq('form_type', input.formType).eq('status', 'generated');
  sup = input.taxYear != null ? sup.eq('tax_year', input.taxYear) : sup.is('tax_year', null);
  sup = input.employeeId ? sup.eq('employee_id', input.employeeId) : sup.is('employee_id', null);
  if (input.periodStart) sup = sup.eq('period_start', input.periodStart);
  try { await sup; } catch { /* best-effort supersede */ }

  const { data, error } = await sb.from('finance_statutory_forms').insert({
    form_type: input.formType, tax_year: input.taxYear ?? null,
    period_start: input.periodStart ?? null, period_end: input.periodEnd ?? null,
    employee_id: input.employeeId ?? null, run_id: input.runId ?? null,
    scope: input.scope ?? (input.employeeId ? 'employee' : 'employer'),
    format: input.format ?? 'pdf', file_path: input.filePath, data_file_path: input.dataFilePath ?? null,
    totals: input.totals ?? {}, checksum: input.checksum ?? null, generated_by: input.actorId,
    metadata: input.metadata ?? {},
  }).select().single<DbRow>();
  if (error) throw Object.assign(new Error('recordStatutoryForm: ' + error.message), { status: 500 });
  const dto = toDto(data);

  void emitAppEvent({
    eventType: 'finance.payroll.statutory_form.generated',
    sourceModule: 'finance_payroll', sourceEntityType: 'statutory_form', sourceEntityId: dto.id,
    actorUserId: input.actorId, severity: 'info',
    payload: { formType: dto.formType, taxYear: dto.taxYear, employeeId: dto.employeeId, totals: dto.totals },
  });
  await writeHrAudit({
    submoduleKey: 'finance_payroll', recordId: dto.id, actorId: input.actorId,
    action: 'statutory_form.generated',
    previousState: null, newState: { formType: dto.formType, taxYear: dto.taxYear, employeeId: dto.employeeId },
  });
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
  return ((data ?? []) as DbRow[]).map(toDto);
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
  if (error || !data?.signedUrl) {
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
