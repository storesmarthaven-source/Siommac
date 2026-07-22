// ============================================================================
// Payroll Reports Center (F-12) — generation worker (Slice 3)
// ============================================================================
// Claims queued file-export jobs (fencing claim_token + lease), computes the
// report (the SAME §5B DTO as preview), renders it (xlsx/csv/pdf), registers the
// upload ledger BEFORE the Storage upload (so a crash leaves a discoverable
// orphan), uploads to the immutable attempt path, then complete_tx | fail_tx.
// Modelled on lib/workflow/outboxWorker. Driven by the scheduled function
// (payroll-report-generation-worker.ts) and the admin trigger route.
// ============================================================================

import { createHash } from 'node:crypto';
import { sb } from '../../db';
import { computeInteractiveReport } from './payrollReportCatalog';
import { renderReportFile } from './payrollReportFiles';
import type { InteractiveReportParams, StandardFileFormat } from '../../../../../types/payrollReports';

const BUCKET = 'payroll-report-artifacts';
const RETENTION_CLASS = 'standard';
const RETENTION_DAYS = 365;

interface ClaimedJob {
  id: string;
  report_key: string;
  params: InteractiveReportParams;
  format: StandardFileFormat; // csv | pdf (XLSX deferred)
  scope: unknown;
  scope_id: string;
  claim_token: string;
}

export interface GenerationSummary { claimed: number; succeeded: number; failed: number }

async function failJob(job: ClaimedJob, code: string, message: string, retryable: boolean): Promise<void> {
  // Surface a transition failure: if fail_tx itself fails the job is stranded
  // 'running' until its lease expires — that MUST be visible, never swallowed.
  const { error } = await sb.rpc('finance_payroll_report_fail_tx', {
    p_job_id: job.id, p_claim_token: job.claim_token,
    p_error_code: code, p_error_message: message.slice(0, 500), p_retryable: retryable,
  });
  if (error) console.error(`[payroll-report-generation-worker] fail_tx failed for job ${job.id}: ${error.message}`);
}

export async function processReportGenerationQueue(workerId: string, limit = 5): Promise<GenerationSummary> {
  // Reap expired-running jobs that have exhausted their retry budget so they surface
  // as 'failed' (claim excludes them now) instead of looping forever (#4).
  const reap = await sb.rpc('finance_payroll_report_reap', { p_worker_id: workerId, p_limit: Math.max(limit, 5) });
  if (reap.error) console.error(`[payroll-report-generation-worker] reap failed: ${reap.error.message}`);

  const claim = await sb.rpc('finance_payroll_report_claim', {
    p_worker_id: workerId, p_limit: limit, p_lease_seconds: 300,
  });
  if (claim.error) throw Object.assign(new Error('report claim: ' + claim.error.message), { status: 500 });
  const jobs = (claim.data ?? []) as ClaimedJob[];
  let succeeded = 0, failed = 0;

  for (const job of jobs) {
    try {
      const completed = await computeInteractiveReport(job.params);
      const file = await renderReportFile(completed, job.format);
      const sha256 = createHash('sha256').update(file.buffer).digest('hex');
      const path = `${job.id}/${job.claim_token}/${sha256}.${file.ext}`;

      // Ledger row BEFORE the upload → an upload-before-commit crash is discoverable.
      const reg = await sb.rpc('finance_payroll_report_register_upload_tx', {
        p_job_id: job.id, p_claim_token: job.claim_token, p_storage_path: path, p_sha256: sha256, p_byte_size: file.buffer.length,
      });
      if (reg.error) { await failJob(job, 'register_failed', reg.error.message, true); failed++; continue; }

      const up = await sb.storage.from(BUCKET).upload(path, file.buffer, { contentType: file.contentType, upsert: false });
      if (up.error) {
        await sb.storage.from(BUCKET).remove([path]).catch(() => { /* missing = already gone */ });
        await failJob(job, 'upload_failed', up.error.message, true); failed++; continue;
      }

      const comp = await sb.rpc('finance_payroll_report_complete_tx', {
        p_job_id: job.id, p_claim_token: job.claim_token, p_storage_path: path,
        p_content_type: file.contentType, p_byte_size: file.buffer.length, p_sha256: sha256,
        p_scope: job.scope, p_scope_id: job.scope_id, p_row_count: file.rowCount,
        p_retention_class: RETENTION_CLASS, p_retention_days: RETENTION_DAYS,
      });
      if (comp.error) { await failJob(job, 'complete_failed', comp.error.message, true); failed++; continue; }
      succeeded++;
    } catch (e) {
      await failJob(job, 'generation_failed', (e as Error).message, false);
      failed++;
    }
  }
  return { claimed: jobs.length, succeeded, failed };
}
