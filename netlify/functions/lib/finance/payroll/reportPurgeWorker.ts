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
  const claim = await sb.rpc('finance_payroll_report_purge_claim', {
    p_worker_id: workerId, p_limit: limit, p_lease_seconds: 300,
  });
  if (claim.error) throw Object.assign(new Error('report purge claim: ' + claim.error.message), { status: 500 });
  const arts = (claim.data ?? []) as PurgeableArtifact[];
  let purged = 0, failed = 0;

  for (const a of arts) {
    // A missing object is already-removed (idempotent); any OTHER storage error is
    // checked and routed to purge_fail — never swallowed.
    const rm = await sb.storage.from(BUCKET).remove([a.storage_path]);
    if (rm.error) {
      const pf = await sb.rpc('finance_payroll_report_purge_fail', {
        p_artifact_id: a.id, p_purge_token: a.purge_token,
        p_error: { code: 'storage_remove_failed', message: rm.error.message.slice(0, 500) },
      });
      if (pf.error) console.error(`[payroll-report-purge-worker] purge_fail failed for artifact ${a.id}: ${pf.error.message}`);
      failed++;
      continue;
    }
    const fin = await sb.rpc('finance_payroll_report_purge_finalize', {
      p_artifact_id: a.id, p_purge_token: a.purge_token,
    });
    // A finalize failure leaves the row 'purging' (re-claimable) — surface it.
    if (fin.error) { console.error(`[payroll-report-purge-worker] purge_finalize failed for artifact ${a.id}: ${fin.error.message}`); failed++; continue; }
    purged++;
  }
  return { claimed: arts.length, purged, failed };
}

// ── orphan upload-attempt reconciler (§6A, fenced — see migration 746) ────────
interface ClaimedOrphan { id: string; storage_path: string; created_at: string; cleanup_attempts: number }

export async function reconcileOrphanUploadAttempts(workerId: string, limit = 50): Promise<ReconcileSummary> {
  // ATOMICALLY claim a page of orphan attempts: the RPC locks each row FOR UPDATE
  // SKIP LOCKED, excludes any committed-artifact path, and stamps last_cleanup_at as
  // the claim BEFORE we remove — so complete_tx (which locks the same row) rejects a
  // racing completion and can never keep a succeeded artifact for a deleted object.
  const claim = await sb.rpc('finance_payroll_report_reconcile_claim', {
    p_worker_id: workerId, p_limit: limit,
  });
  if (claim.error) throw Object.assign(new Error('orphan reconcile claim: ' + claim.error.message), { status: 500 });
  const claimed = (claim.data ?? []) as ClaimedOrphan[];
  const now = Date.now();
  let removed = 0, deleted = 0;

  for (const at of claimed) {
    const rm = await sb.storage.from(BUCKET).remove([at.storage_path]);
    // A missing object is already-gone (idempotent, no error); a real error is
    // surfaced and retried next pass (the claim stays, so it re-claims).
    if (rm.error) { console.error(`[payroll-report-purge-worker] orphan remove failed for ${at.id}: ${rm.error.message}`); continue; }
    removed++;

    // Past the 24h quarantine (covers a displaced worker uploading late) → the ledger
    // row may go. Still guarded on committed_at IS NULL so a racing commit is safe.
    if (now - new Date(at.created_at).getTime() >= QUARANTINE_MS) {
      const { error: delErr } = await sb.from('payroll_report_upload_attempts')
        .delete().eq('id', at.id).is('committed_at', null);
      if (delErr) console.error(`[payroll-report-purge-worker] orphan ledger delete failed for ${at.id}: ${delErr.message}`);
      else deleted++;
    }
  }
  return { scanned: claimed.length, removed, deleted };
}
