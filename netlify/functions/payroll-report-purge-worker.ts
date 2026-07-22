// payroll-report-purge-worker.ts — Netlify scheduled function (F-12 Slice 4)
//
// Every 15 minutes: purges retention-expired artifacts (claim → storage.remove →
// finalize | fail, exactly one purged event even after retry) and reconciles
// orphaned upload attempts (24h quarantine, committed paths never touched). The
// same functions are also driven by the admin trigger route
// (finance/payroll/reports/purge/run) for manual flushes + E2E.

import './lib/bootstrapEnv'; // must be first
import { schedule } from '@netlify/functions';
import { processReportPurgeQueue, reconcileOrphanUploadAttempts } from './lib/finance/payroll/reportPurgeWorker';

interface ScheduleEvent { headers?: Record<string, string | undefined> }

export const handler = schedule('*/15 * * * *', async (event: ScheduleEvent) => {
  if (event.headers?.['x-netlify-event'] !== 'schedule') {
    return { statusCode: 403, body: 'scheduled invocation only' };
  }
  const purge = await processReportPurgeQueue('scheduled', 20);
  const reconcile = await reconcileOrphanUploadAttempts('scheduled', 50);
  if (purge.claimed > 0 || reconcile.scanned > 0) {
    console.info(`[payroll-report-purge-worker] ${JSON.stringify({ purge, reconcile })}`);
  }
  return { statusCode: 200, body: JSON.stringify({ purge, reconcile }) };
});
