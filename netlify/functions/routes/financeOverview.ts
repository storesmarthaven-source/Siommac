// routes/financeOverview.ts -- Finance: Overview dashboard (read-only)
// Mounted at /api/finance in api.ts. POST-only, JWT-gated via requirePermission.

import { Hono } from 'hono';
import { requirePermission } from '../lib/auth';
import { getFinanceOverview } from '../lib/finance/overview';
import type { HonoVariables } from '../../../types/api';

const router = new Hono<{ Variables: HonoVariables }>();

// POST /api/finance/overview/summary
router.post('/overview/summary', async c => {
  await requirePermission(c, 'finance.overview.view');
  try {
    const data = await getFinanceOverview();
    return c.json({ success: true, data });
  } catch (e) {
    const er = e as { status?: number; message?: string };
    return c.json({ success: false, message: er.message ?? 'Failed to load finance overview' }, (er.status ?? 500) as 200);
  }
});

export default router;
