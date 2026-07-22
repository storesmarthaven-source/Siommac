// payroll-report-generation-worker.ts — Netlify scheduled function (F-12 Slice 3)
//
// Every-minute pass over the payroll report-generation queue: claims queued (or
// lease-expired-running) file-export jobs and renders → uploads → completes them.
// The same processReportGenerationQueue is also driven by the admin trigger route
// (finance/payroll/reports/generation/run) for manual flushes + E2E.

import './lib/bootstrapEnv'; // must be first
import { schedule } from '@netlify/functions';
import { processReportGenerationQueue } from './lib/finance/payroll/reportGenerationWorker';

interface ScheduleEvent { headers?: Record<string, string | undefined> }

export const handler = schedule('* * * * *', async (event: ScheduleEvent) => {
  if (event.headers?.['x-netlify-event'] !== 'schedule') {
    return { statusCode: 403, body: 'scheduled invocation only' };
  }
  const summary = await processReportGenerationQueue('scheduled', 10);
  if (summary.claimed > 0) {
    console.info(`[payroll-report-generation-worker] ${JSON.stringify(summary)}`);
  }
  return { statusCode: 200, body: JSON.stringify(summary) };
});
