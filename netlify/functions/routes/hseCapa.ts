/**
 * netlify/functions/routes/hseCapa.ts
 *
 * POST /api/hse/capa/list
 * POST /api/hse/capa/get
 * POST /api/hse/capa/create
 * POST /api/hse/capa/update
 */

import { Hono }               from 'hono';
import { createHash }         from 'crypto';
import { z, zv }              from '../lib/validate';
import { requirePermission }  from '../lib/auth';
import { sb }                 from '../lib/db';
import { nextRef }            from '../lib/refGenerator';
import { emitAppEvent, deliverEventNotifications } from '../lib/appEvents';
import { runModuleMutation }  from '../lib/moduleServiceAdapter';
import { selectWorkflowBinding } from '../lib/workflow/bindingResolver';
import { rpcHttpError }       from '../lib/workflow/service';
import type { HonoVariables } from '../../../types/api';

const router = new Hono<{ Variables: HonoVariables }>();

// ── POST /api/hse/capa/list ───────────────────────────────────────────────────

const ListCapaSchema = z.object({
  status:    z.string().nullable().optional(),
  ownerId:   z.string().nullable().optional(),
  priority:  z.string().nullable().optional(),
  overdue:   z.boolean().optional(),
  limit:     z.number().int().min(1).max(200).default(50),
  cursor:    z.string().nullable().optional(),
});

router.post('/capa/list', async c => {
  const user = await requirePermission(c, 'hse.capa.view');
  const body = c.get('body') as Record<string, unknown>;
  const v = zv(c, ListCapaSchema, body.args ?? {});
  if (!v.ok) return v.response;

  let q = sb
    .from('hse_capa_actions')
    .select('id, ref, source_type, source_id, title, owner_user_id, priority, status, due_at, completed_at, verified_at, created_at')
    .order('due_at', { ascending: true, nullsFirst: false })
    .limit(v.data.limit);

  if (v.data.status)   q = q.eq('status', v.data.status);
  if (v.data.priority) q = q.eq('priority', v.data.priority);
  if (v.data.overdue)  q = q.lt('due_at', new Date().toISOString()).not('status', 'in', '(closed,cancelled)');
  if (v.data.cursor)   q = q.lt('due_at', v.data.cursor);

  // Non-manager: see only CAPAs you own
  if (!['admin','superadmin','manager'].includes(user.role)) {
    q = q.eq('owner_user_id', user.id);
  } else if (v.data.ownerId) {
    q = q.eq('owner_user_id', v.data.ownerId);
  }

  const { data, error } = await q;
  if (error) return c.json({ success: false, message: error.message }, 500 as 200);
  return c.json({ success: true, data: data ?? [] });
});

// ── POST /api/hse/capa/get ────────────────────────────────────────────────────

router.post('/capa/get', async c => {
  await requirePermission(c, 'hse.capa.view');
  const body = c.get('body') as Record<string, unknown>;
  const args = body.args as { capaId?: string; ref?: string } | undefined;

  if (!args?.capaId && !args?.ref) return c.json({ success: false, message: 'capaId or ref required' }, 400 as 200);

  let q = sb.from('hse_capa_actions').select('*');
  if (args.capaId) q = q.eq('id', args.capaId);
  else q = q.eq('ref', args.ref!);

  const { data, error } = await q.maybeSingle();
  if (error) return c.json({ success: false, message: error.message }, 500 as 200);
  if (!data)  return c.json({ success: false, message: 'CAPA not found' }, 404 as 200);

  return c.json({ success: true, data });
});

// ── POST /api/hse/capa/create ─────────────────────────────────────────────────

const CreateCapaSchema = z.object({
  sourceType:   z.string().min(1),
  sourceId:     z.string().min(1),
  title:        z.string().min(1).max(300),
  description:  z.string().min(1),
  ownerUserId:  z.string().nullable().optional(),
  priority:     z.enum(['low','medium','high','critical']).default('medium'),
  dueAt:        z.string().nullable().optional(),
  metadata:     z.record(z.string(), z.unknown()).optional(),
});

router.post('/capa/create', async c => {
  const user = await requirePermission(c, 'hse.capa.manage');
  const body = c.get('body') as Record<string, unknown>;
  const v = zv(c, CreateCapaSchema, body.args);
  if (!v.ok) return v.response;

  const ownerUserId = v.data.ownerUserId ?? user.id;
  // Content-derived key over the FULL validated payload (audit F6): identical
  // retries dedupe; any differing field produces a distinct record.
  const contentKey  = `hse.capa.create:${user.id}:${createHash('sha256').update(JSON.stringify(v.data)).digest('hex').slice(0, 32)}`;
  const notifyInput = {
    eventType:        'hse.capa.assigned',
    sourceModule:     'hse',
    sourceEntityType: 'capa',
    sourceEntityId:   '',                          // filled per-path below
    actorUserId:      user.id,
    explicitRecipients: [{ userId: ownerUserId, reason: 'assignee' as const }],
    notification: {
      title: 'CAPA assigned to you',
      body:  `${v.data.title} — due ${v.data.dueAt ?? 'TBD'}`,
      actionRoute: 'hse/capa',
      type:  'hse.capa.assigned',
      actionRequired: true,
      dueAt: v.data.dueAt ?? null,
    },
  };

  try {
    // ATOMIC (finding #3, slice D1): with a closure-workflow binding, the CAPA
    // INSERT + workflow start + workflow_id link + business event + audit row
    // commit in ONE transaction (hse_capa_actions branch of
    // workflow_create_and_start_tx). Notification fan-out is post-commit,
    // notify-only (the RPC owns the app_event).
    // Audit F2: pass the real record context so scoped/conditional bindings can match.
    const binding = await selectWorkflowBinding(sb, {
      moduleKey: 'hse_capa', workflowType: 'capa_closure',
      triggerEvent: 'capa.created', sourceRecordId: '', requestedBy: user.id,
      recordData: { ownerUserId, sourceType: v.data.sourceType, sourceId: v.data.sourceId, priority: v.data.priority },
    });

    if (binding) {
      const { data, error } = await sb.rpc('workflow_create_and_start_tx', {
        p_source_table: 'hse_capa_actions', p_actor_id: user.id,
        p_binding_id: binding.id, p_request_key: contentKey,
        p_business: {
          sourceType:  v.data.sourceType,
          sourceId:    v.data.sourceId,
          title:       v.data.title,
          description: v.data.description,
          ownerUserId,
          priority:    v.data.priority,
          dueAt:       v.data.dueAt ?? null,
          metadata:    v.data.metadata ?? {},
        },
      });
      if (error) throw rpcHttpError(error as { code?: string | null; message: string });
      const rpc = (data ?? {}) as { recordId?: string; ref?: string; workflowId?: string; eventId?: string };

      void deliverEventNotifications(
        { ...notifyInput, sourceEntityId: rpc.recordId ?? '', dedupeKey: `${contentKey}:notify` },
        rpc.eventId ?? null,
      );

      return c.json({
        success:    true,
        capaId:     rpc.recordId,
        ref:        rpc.ref,
        workflowId: rpc.workflowId ?? null,
        data: {
          id:         rpc.recordId,
          ref:        rpc.ref,
          workflowId: rpc.workflowId ?? null,
          eventId:    rpc.eventId ?? null,
          handoffIds: [] as string[],
        },
      });
    }

    // No closure-workflow binding — approval is opt-in; create-only via the
    // module adapter (single write cannot strand; audit + event + notification
    // preserved, no workflow).
    const result = await runModuleMutation<{ id: string; ref: string }>({
      context: { actorUserId: user.id },
      options: {
        module:         'hse',
        operation:      'create',
        entityType:     'capa',
        idempotencyKey: contentKey,
        eventType:      'hse.capa.assigned',
        eventSeverity:  v.data.priority === 'critical' ? 'critical' as const : 'info' as const,
        eventPayload:   { ownerUserId, priority: v.data.priority },
        explicitRecipients: [{ userId: ownerUserId, reason: 'assignee' as const }],
        notification: {
          title: 'CAPA assigned to you',
          body:  `${v.data.title} — due ${v.data.dueAt ?? 'TBD'}`,
          actionRoute: 'hse/capa',
          type:  'hse.capa.assigned',
          actionRequired: true,
          dueAt: v.data.dueAt ?? null,
        },
        getEntityIdentity: (record) => ({ id: record.id, ref: record.ref }),
      },
      writeRecord: async () => {
        const ref = await nextRef('CAPA');
        const { data: capa, error } = await sb
          .from('hse_capa_actions')
          .insert({
            ref,
            source_type:   v.data.sourceType,
            source_id:     v.data.sourceId,
            title:         v.data.title,
            description:   v.data.description,
            owner_user_id: ownerUserId,
            priority:      v.data.priority,
            status:        'open',
            due_at:        v.data.dueAt ?? null,
            created_by:    user.id,
            metadata:      v.data.metadata ?? {},
          })
          .select('id, ref')
          .single<{ id: string; ref: string }>();

        if (error || !capa) throw error ?? new Error('CAPA insert failed');
        return capa;
      },
    });

    return c.json({
      success:    true,
      capaId:     result.entityId,
      ref:        result.entityRef,
      workflowId: null,
      data: {
        id:         result.entityId,
        ref:        result.entityRef,
        workflowId: null,
        eventId:    result.eventId     ?? null,
        handoffIds: result.handoffIds,
      },
    });
  } catch (err) {
    const status = (err as { status?: number }).status ?? 500;
    const msg = err instanceof Error ? err.message : 'Create failed';
    return c.json({ success: false, message: msg }, status as 200);
  }
});

// ── POST /api/hse/capa/update ─────────────────────────────────────────────────

const UpdateCapaSchema = z.object({
  capaId:              z.string().uuid(),
  status:              z.enum(['open','in_progress','implemented','verification','returned','closed','overdue','cancelled']).optional(),
  priority:            z.enum(['low','medium','high','critical']).optional(),
  dueAt:               z.string().nullable().optional(),
  ownerUserId:         z.string().nullable().optional(),
  verifiedBy:          z.string().nullable().optional(),
  effectivenessResult: z.enum(['effective','partially_effective','ineffective']).nullable().optional(),
  metadata:            z.record(z.string(), z.unknown()).optional(),
});

router.post('/capa/update', async c => {
  const user = await requirePermission(c, 'hse.capa.manage');
  const body = c.get('body') as Record<string, unknown>;
  const v = zv(c, UpdateCapaSchema, body.args);
  if (!v.ok) return v.response;

  const { capaId, ...fields } = v.data;
  const now = new Date().toISOString();
  const updates: Record<string, unknown> = { updated_at: now };

  if (fields.status !== undefined)              updates.status                 = fields.status;
  if (fields.priority !== undefined)            updates.priority               = fields.priority;
  if (fields.dueAt !== undefined)               updates.due_at                 = fields.dueAt;
  if (fields.ownerUserId !== undefined)         updates.owner_user_id          = fields.ownerUserId;
  if (fields.verifiedBy !== undefined)          updates.verified_by            = fields.verifiedBy;
  if (fields.effectivenessResult !== undefined) updates.effectiveness_result   = fields.effectivenessResult;
  if (fields.metadata !== undefined)            updates.metadata               = fields.metadata;

  if (fields.status === 'implemented') updates.completed_at = now;
  if (fields.status === 'closed')      updates.completed_at = updates.completed_at ?? now;
  if (fields.verifiedBy)               updates.verified_at  = now;

  const { error } = await sb.from('hse_capa_actions').update(updates).eq('id', capaId);
  if (error) return c.json({ success: false, message: error.message }, 500 as 200);

  if (fields.status === 'closed') {
    // Notify the CAPA owner (and originator) that their action was closed.
    const closed = await sb.from('hse_capa_actions')
      .select('ref, owner_user_id, created_by').eq('id', capaId)
      .maybeSingle<{ ref: string; owner_user_id: string | null; created_by: string | null }>();
    const recipientIds = [...new Set([closed.data?.owner_user_id, closed.data?.created_by]
      .filter((id): id is string => Boolean(id) && id !== user.id))];

    void emitAppEvent({
      eventType:        'hse.capa.closed',
      sourceModule:     'hse',
      sourceEntityType: 'capa',
      sourceEntityId:   closed.data?.ref ?? capaId,
      actorUserId:      user.id,
      severity:         'success',
      payload:          { effectivenessResult: fields.effectivenessResult },
      ...(recipientIds.length ? {
        explicitRecipients: recipientIds.map(id => ({ userId: id, reason: 'owner' as const })),
        notification: {
          title:       'CAPA closed',
          body:        `${closed.data?.ref ?? 'A corrective action'} was closed.`,
          actionRoute: 'hse/incidents',
        },
      } : {}),
    });
  }

  return c.json({ success: true });
});

export default router;
