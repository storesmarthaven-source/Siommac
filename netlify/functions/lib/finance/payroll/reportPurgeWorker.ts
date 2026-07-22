// ============================================================================
// Payroll Reports Center (F-12) — purge worker + orphan reconciler (Slice 4)
// ============================================================================
// Postgres cannot call Storage, so retention purge is a worker-owned saga with
// the SAME claim/lease/fencing-token model as generation (contract §6B):
//   purge_claim (retention-expired, active OR stranded-purging, FOR UPDATE SKIP
//   LOCKED) → storage.remove → purge_finalize (token, idempotent, exactly one
//   `payroll.report.purged` event even after retry) | purge_fail (token-checked,
//   expires the lease so the row is re-claimable).
//
// The same file runs the orphan-object reconciler (§6A): a bounded service-role
// scan of UNCOMMITTED upload-attempt rows whose job token is no longer current or
// whose lease expired. It removes each recorded Storage path (missing = already
// gone) and bumps cleanup_attempts; rows stay eligible for a 24h quarantine (a
// displaced worker may upload late after an earlier cleanup), after which the
// ledger row is deleted. It NEVER removes the path of a committed artifact and
// re-checks that immediately before each remove. Removes are idempotent, so two
// concurrent reconcilers are safe without locking (contract: bounded query).
// Driven by the scheduled function (payroll-report-purge-worker.ts) and the admin
// trigger route (finance/payroll/reports/purge/run).
// ============================================================================

import { sb } from '../../db';

const BUCKET = 'payroll-report-artifacts';
const QUARANTINE_MS = 24 * 60 * 60 * 1000; // 24h (contract §6A)

export interface PurgeSummary { claimed: number; purged: number; failed: number }
export interface ReconcileSummary { scanned: number; removed: number; deleted: number }

interface PurgeableArtifact { id: string; storage_path: string; purge_token: string }

// ── retention purge saga (§6B) ───────────────────────────────────────────────
export async function processReportPurgeQueue(workerId: string, limit = 20): Promise<PurgeSummary> {
  const { data, error } = await sb.rpc('finance_payroll_report_purge_claim', {
    p_worker_id: workerId, p_limit: limit, p_lease_seconds: 300,
  });
  if (error) throw Object.assign(new Error('report purge claim: ' + error.message), { status: 500 });
  const arts = (data ?? []) as PurgeableArtifact[];
  let purged = 0, failed = 0;

  for (const a of arts) {
    // A missing object is already-removed (idempotent); any OTHER storage error is
    // checked and routed to purge_fail — never swallowed.
    const rm = await sb.storage.from(BUCKET).remove([a.storage_path]);
    if (rm.error) {
      await sb.rpc('finance_payroll_report_purge_fail', {
        p_artifact_id: a.id, p_purge_token: a.purge_token,
        p_error: { code: 'storage_remove_failed', message: String(rm.error.message ?? 'remove failed').slice(0, 500) },
      });
      failed++;
      continue;
    }
    const fin = await sb.rpc('finance_payroll_report_purge_finalize', {
      p_artifact_id: a.id, p_purge_token: a.purge_token,
    });
    if (fin.error) { failed++; continue; }
    purged++;
  }
  return { claimed: arts.length, purged, failed };
}

// ── orphan upload-attempt reconciler (§6A) ───────────────────────────────────
interface OrphanAttempt {
  id: string; job_id: string; claim_token: string; storage_path: string;
  created_at: string; cleanup_attempts: number;
  payroll_report_jobs:
    | { claim_token: string | null; lease_expires_at: string | null; state: string }
    | { claim_token: string | null; lease_expires_at: string | null; state: string }[]
    | null;
}
const jobOf = (j: OrphanAttempt['payroll_report_jobs']) => (Array.isArray(j) ? j[0] : j) ?? null;

export async function reconcileOrphanUploadAttempts(workerId: string, limit = 50): Promise<ReconcileSummary> {
  // Bounded page of UNCOMMITTED attempts, oldest first (idx committed_at, created_at).
  const { data, error } = await sb.from('payroll_report_upload_attempts')
    .select('id, job_id, claim_token, storage_path, created_at, cleanup_attempts, payroll_report_jobs!job_id!inner(claim_token, lease_expires_at, state)')
    .is('committed_at', null)
    .order('created_at', { ascending: true })
    .limit(Math.max(limit, 1));
  if (error) throw Object.assign(new Error('orphan reconcile scan: ' + error.message), { status: 500 });

  const attempts = (data ?? []) as unknown as OrphanAttempt[];
  const now = Date.now();
  let scanned = 0, removed = 0, deleted = 0;

  for (const at of attempts) {
    const job = jobOf(at.payroll_report_jobs);
    // A still-current running token with a live lease is an in-flight upload — leave
    // it alone. Orphan iff the token is no longer current OR the lease has expired.
    const tokenStale = !job || job.claim_token !== at.claim_token || job.state !== 'running';
    const leaseExpired = !!job && !!job.lease_expires_at && new Date(job.lease_expires_at).getTime() < now;
    if (!(tokenStale || leaseExpired)) continue;
    scanned++;

    // Re-check the committed-path invariant IMMEDIATELY before remove: never remove
    // the object a committed artifact points at.
    const { data: winner } = await sb.from('payroll_report_artifacts')
      .select('id').eq('storage_path', at.storage_path).maybeSingle<{ id: string }>();
    if (winner) continue;
    // Re-check the attempt is still uncommitted (guards a concurrent complete_tx).
    const { data: fresh } = await sb.from('payroll_report_upload_attempts')
      .select('committed_at').eq('id', at.id).maybeSingle<{ committed_at: string | null }>();
    if (!fresh || fresh.committed_at) continue;

    const rm = await sb.storage.from(BUCKET).remove([at.storage_path]);
    if (rm.error) continue; // real storage error — retry on the next pass, don't advance
    removed++;

    const ageMs = now - new Date(at.created_at).getTime();
    if (ageMs >= QUARANTINE_MS && at.cleanup_attempts >= 1) {
      // Past the 24h quarantine with a confirmed removal → the ledger row may go.
      const { error: delErr } = await sb.from('payroll_report_upload_attempts')
        .delete().eq('id', at.id).is('committed_at', null);
      if (!delErr) deleted++;
    } else {
      await sb.from('payroll_report_upload_attempts')
        .update({ cleanup_attempts: at.cleanup_attempts + 1, last_cleanup_at: new Date(now).toISOString() })
        .eq('id', at.id).is('committed_at', null);
    }
  }
  return { scanned, removed, deleted };
}
