// routes/orchestration.ts — Cross-module orchestration platform endpoints.
// Mounted at /api/orchestration in api.ts. POST-only; reads body.args ?? body.
//
// Today: the unified record timeline (read-only projection over the existing
// platform tables). Access is gated inside the service by the source record's own
// view permission — you can only see a timeline for a record you could open.

import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { requireUser } from '../lib/auth';
import { zv } from '../lib/validate';
import { getRecordTimeline } from '../lib/orchestration/timelineService';
import { linkRecords, listRecordLinks, deleteRecordLink } from '../lib/orchestration/recordLinkService';
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

const recordRefSchema = z.object({
  module:     z.string().min(1),
  recordType: z.string().min(1),
  recordId:   z.string().min(1),
  recordNo:   z.string().optional(),
  title:      z.string().optional(),
  deepLink:   z.string().optional(),
});

const LinkCreateSchema = z.object({
  source:           recordRefSchema,
  target:           recordRefSchema,
  relationshipType: z.string().min(1).max(60),
  label:            z.string().max(120).optional(),
  direction:        z.enum(['outbound', 'inbound', 'bidirectional']).optional(),
  visibility:       z.enum(['public', 'internal', 'restricted', 'confidential']).optional(),
  metadata:         z.record(z.string(), z.unknown()).optional(),
});

const LinkListSchema   = z.object({ module: z.string().min(1), recordType: z.string().min(1), recordId: z.string().min(1) });
const LinkDeleteSchema = z.object({ id: z.string().uuid() });

/** Run a service call with the standard error→JSON envelope. */
async function handle<T>(c: Context<{ Variables: HonoVariables }>, fn: () => Promise<T>): Promise<Response> {
  try {
    return c.json({ success: true, data: await fn() });
  } catch (e) {
    const status = (e as { status?: number }).status ?? 500;
    return c.json({ success: false, message: e instanceof Error ? e.message : 'Request failed.' }, status as 200);
  }
}

// POST /api/orchestration/timeline/get
router.post('/timeline/get', async c => {
  const actor = await requireUser(c);
  const body  = c.get('body') as Record<string, unknown>;
  const v     = zv(c, TimelineSchema, body.args ?? body);
  if (!v.ok) return v.response;
  return handle(c, () => getRecordTimeline(actor, v.data));
});

// POST /api/orchestration/record-links/create
router.post('/record-links/create', async c => {
  const actor = await requireUser(c);
  const body  = c.get('body') as Record<string, unknown>;
  const v     = zv(c, LinkCreateSchema, body.args ?? body);
  if (!v.ok) return v.response;
  return handle(c, () => linkRecords(actor, v.data));
});

// POST /api/orchestration/record-links/list
router.post('/record-links/list', async c => {
  const actor = await requireUser(c);
  const body  = c.get('body') as Record<string, unknown>;
  const v     = zv(c, LinkListSchema, body.args ?? body);
  if (!v.ok) return v.response;
  return handle(c, () => listRecordLinks(actor, v.data));
});

// POST /api/orchestration/record-links/delete
router.post('/record-links/delete', async c => {
  const actor = await requireUser(c);
  const body  = c.get('body') as Record<string, unknown>;
  const v     = zv(c, LinkDeleteSchema, body.args ?? body);
  if (!v.ok) return v.response;
  return handle(c, () => deleteRecordLink(actor, v.data));
});

export default router;
