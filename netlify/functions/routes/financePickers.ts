/**
 * Shared Finance cost-centre picker endpoint.
 * POST-only and protected by the neutral Finance read capability.
 */

import { Hono } from 'hono';
import { requirePermission } from '../lib/auth';
import { z, zv } from '../lib/validate';
import { listCostCentres } from '../lib/finance/pickers';
import type { HonoVariables } from '../../../types/api';

const router = new Hono<{ Variables: HonoVariables }>();
const bodyArgs = (c: { get: (key: string) => unknown }) =>
  (c.get('body') as Record<string, unknown>).args ?? {};

router.post('/pickers/cost-centres', async c => {
  await requirePermission(c, 'finance.overview.view');
  const parsed = zv(c, z.object({ search: z.string().max(100).optional() }), bodyArgs(c));
  if (!parsed.ok) return parsed.response;

  try {
    const data = await listCostCentres(parsed.data.search);
    return c.json({ success: true, data });
  } catch (error) {
    const failure = error as { status?: number; message?: string };
    return c.json(
      { success: false, message: failure.message ?? 'Failed to list cost centres' },
      (failure.status ?? 500) as 200,
    );
  }
});

export default router;
