// payroll-report-generation-worker.ts — Netlify scheduled function (F-12 Slice 3)
//
// Every-minute pass over the payroll report-generation queue. Netlify scheduled
// functions have a fixed, unconfigurable ~30-second wall-clock limit, so this
// processes ONE job per invocation (a proven bounded unit) — a single render +
// upload comfortably fits, and the every-minute cadence drains a backlog without a
// mid-batch termination leaving jobs stuck. A killed render just re-queues (its
// lease expires → reclaimed; over-budget jobs are reaped to 'failed'). Bulk/ops
// flushes go through the admin trigger route (finance/payroll/reports/generation/
// run), which is NOT under the scheduled 30-second cap.

import './lib/bootstrapEnv'; // must be first
import { schedule } from '@netlify/functions';
import { processReportGenerationQueue } from './lib/finance/payroll/reportGenerationWorker';

interface ScheduleEvent { headers?: Record<string, string | undefined> }

export const handler = schedule('* * * * *', async (event: ScheduleEvent) => {
  if (event.headers?.['x-netlify-event'] !== 'schedule') {
    return { statusCode: 403, body: 'scheduled invocation only' };
  }
  const summary = await processReportGenerationQueue('scheduled', 1);
  if (summary.claimed > 0) {
    console.info(`[payroll-report-generation-worker] ${JSON.stringify(summary)}`);
  }
  return { statusCode: 200, body: JSON.stringify(summary) };
});
