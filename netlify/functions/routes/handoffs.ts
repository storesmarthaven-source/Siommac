/**
 * netlify/functions/routes/handoffs.ts
 *
 * POST /api/handoffs/list      → pending/failed handoffs (admin/manager)
 * POST /api/handoffs/retry     → manually retry a failed handoff
 * POST /api/handoffs/cancel    → mark a handoff cancelled (manual_review)
 * POST /api/handoffs/intake    → target module intake (process pending handoffs)
 */

import { Hono }              from 'hono';
import { z, zv }             from '../lib/validate';
import { requirePermission } from '../lib/auth';
import { sb }                from '../lib/db';
import { getPendingHandoffs, completeHandoff, failHandoff } from '../lib/handoffBus';
import type { HonoVariables } from '../../../types/api';

const router = new Hono<{ Variables: HonoVariables }>();

// ── POST /api/handoffs/list ────────────────────────────────────────────────────

router.post('/handoffs/list', async c => {
  await requirePermission(c, 'workflow.approve');
  const body = c.get('body') as Record<string, unknown>;
  const args = body.args as {
    status?: string;
    targetModule?: string;
    sourceModule?: string;
    limit?: number;
  } | undefined;

  let q = sb
    .from('handoff_outbox')
    .select('id, source_module, target_module, source_entity_type, source_entity_id, status, attempts, error, created_at, processed_at')
    .order('created_at', { ascending: false })
    .limit(args?.limit ?? 50);

  if (args?.status)       q = q.eq('status', args.status);
  if (args?.targetModule) q = q.eq('target_module', args.targetModule);
  if (args?.sourceModule) q = q.eq('source_module', args.sourceModule);

  const { data, error } = await q;
  if (error) return c.json({ success: false, message: error.message }, 500 as 200);
  return c.json({ success: true, data: data ?? [] });
});

// ── POST /api/handoffs/retry ───────────────────────────────────────────────────

router.post('/handoffs/retry', async c => {
  await requirePermission(c, 'workflow.approve');
  const body = c.get('body') as Record<string, unknown>;
  const args = body.args as { handoffId?: string } | undefined;
  if (!args?.handoffId) return c.json({ success: false, message: 'handoffId required' }, 400 as 200);

  const { error } = await sb
    .from('handoff_outbox')
    .update({ status: 'pending', attempts: 0, error: null })
    .eq('id', args.handoffId);

  if (error) return c.json({ success: false, message: error.message }, 500 as 200);
  return c.json({ success: true });
});

// ── POST /api/handoffs/cancel ──────────────────────────────────────────────────

router.post('/handoffs/cancel', async c => {
  await requirePermission(c, 'workflow.approve');
  const body = c.get('body') as Record<string, unknown>;
  const args = body.args as { handoffId?: string } | undefined;
  if (!args?.handoffId) return c.json({ success: false, message: 'handoffId required' }, 400 as 200);

  const { error } = await sb
    .from('handoff_outbox')
    .update({ status: 'cancelled', processed_at: new Date().toISOString() })
    .eq('id', args.handoffId);

  if (error) return c.json({ success: false, message: error.message }, 500 as 200);
  return c.json({ success: true });
});

// ── POST /api/handoffs/intake ──────────────────────────────────────────────────
// Each target module calls this to process its pending handoffs.
// The payload determines which target table to insert into.

const IntakeSchema = z.object({
  targetModule: z.string().min(1),
});

router.post('/handoffs/intake', async c => {
  await requirePermission(c, 'workflow.approve');
  const body = c.get('body') as Record<string, unknown>;
  const v = zv(c, IntakeSchema, body.args ?? {});
  if (!v.ok) return v.response;

  const pending = await getPendingHandoffs(v.data.targetModule);
  const results: Array<{ handoffId: string; ok: boolean; error?: string }> = [];

  for (const handoff of pending) {
    try {
      await _processHandoff(v.data.targetModule, handoff);
      await completeHandoff(handoff.id);
      results.push({ handoffId: handoff.id, ok: true });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await failHandoff(handoff.id, msg);
      results.push({ handoffId: handoff.id, ok: false, error: msg });
    }
  }

  return c.json({ success: true, processed: results.length, results });
});

async function _processHandoff(
  targetModule: string,
  handoff: { id: string; source_module: string; source_entity_type: string; source_entity_id: string; payload: Record<string, unknown> },
): Promise<void> {
  const p = handoff.payload;

  if (targetModule === 'hr') {
    // Insert into hr_cases
    await sb.from('hr_cases').insert({
      ref:                handoff.id.slice(0, 8).toUpperCase(),
      case_type:          (p.caseType as string | undefined) ?? 'injury',
      employee_id:        p.employeeId as string,
      source_module:      handoff.source_module,
      source_entity_type: handoff.source_entity_type,
      source_entity_id:   handoff.source_entity_id,
      payload:            p,
    }).throwOnError();
  } else if (targetModule === 'finance') {
    await sb.from('finance_cost_entries').insert({
      ref:                `FCE-${Date.now()}`,
      source_module:      handoff.source_module,
      source_entity_type: handoff.source_entity_type,
      source_entity_id:   handoff.source_entity_id,
      amount:             (p.estimatedCost as number | undefined) ?? 0,
      description:        `Handoff from ${handoff.source_module}: ${handoff.source_entity_id}`,
      status:             'pending',
      source_handoff_id:  handoff.id,
      metadata:           p,
    }).throwOnError();
  } else if (targetModule === 'operations') {
    await sb.from('ops_work_orders').insert({
      ref:                `OWO-${Date.now()}`,
      source_module:      handoff.source_module,
      source_entity_type: handoff.source_entity_type,
      source_entity_id:   handoff.source_entity_id,
      description:        (p.description as string | undefined) ?? `Work order from ${handoff.source_module}`,
      priority:           (p.priority as string | undefined) ?? 'medium',
      status:             'open',
      source_handoff_id:  handoff.id,
      metadata:           p,
    }).throwOnError();
  } else {
    throw new Error(`No intake handler for module: ${targetModule}`);
  }
}

export default router;
