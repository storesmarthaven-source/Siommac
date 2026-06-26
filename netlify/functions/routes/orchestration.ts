// routes/orchestration.ts — Cross-module orchestration platform endpoints.
// Mounted at /api/orchestration in api.ts. POST-only; reads body.args ?? body.
//
// Today: the unified record timeline (read-only projection over the existing
// platform tables). Access is gated inside the service by the source record's own
// view permission — you can only see a timeline for a record you could open.

import { Hono } from 'hono';
import { z } from 'zod';
import { requireUser } from '../lib/auth';
import { zv } from '../lib/validate';
import { getRecordTimeline } from '../lib/orchestration/timelineService';
import type { HonoVariables } from '../../../types/api';

const router = new Hono<{ Variables: HonoVariables }>();

const TimelineSchema = z.object({
  module:          z.string().min(1),
  recordType:      z.string().min(1),
  recordId:        z.string().min(1),
  includeAudit:    z.boolean().optional(),
  includeWorkflows: z.boolean().optional(),
  includeHandoffs: z.boolean().optional(),
  includeMessages: z.boolean().optional(),
  includeTickets:  z.boolean().optional(),
});

// POST /api/orchestration/timeline/get
router.post('/timeline/get', async c => {
  const actor = await requireUser(c);
  const body  = c.get('body') as Record<string, unknown>;
  const v     = zv(c, TimelineSchema, body.args ?? body);
  if (!v.ok) return v.response;

  try {
    const items = await getRecordTimeline(actor, v.data);
    return c.json({ success: true, data: items });
  } catch (e) {
    const status = (e as { status?: number }).status ?? 500;
    return c.json({ success: false, message: e instanceof Error ? e.message : 'Failed to load timeline.' }, status as 200);
  }
});

export default router;
