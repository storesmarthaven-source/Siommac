import { Hono }            from 'hono';
import { sb }              from '../lib/db';
import { requireUser, requirePermission, userCan } from '../lib/auth';
import { requireStepUp }   from '../lib/stepUp';
import { getProfileSignedUrl } from '../lib/photos';
import { emitAppEvent, writePlatformAudit } from '../lib/appEvents';
import { createHandoff }   from '../lib/handoffBus';
import {
  resolveDispatchFromConfig,
} from '../lib/accountSupportDispatch';
import type { DispatchDestination } from '../lib/accountSupportDispatch';
import {
  zv,
  CreateTicketSchema,
  ReplyTicketSchema,
  GetTicketSchema,
  UpdateTicketSchema,
  CreateAccountSupportRequestSchema,
  UpdateAccountSupportRequestSchema,
  AccountAccessActionSchema,
  UpdateAccountSupportConfigSchema,
} from '../lib/validate';
import type { HonoVariables }  from '../../../types/api';

const router = new Hono<{ Variables: HonoVariables }>();

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────────────

async function _genTicketNumber(): Promise<string> {
  const { data: maxRow } = await sb.from('support_tickets')
    .select('ticket_number')
    .order('ticket_number', { ascending: false })
    .limit(1)
    .single<{ ticket_number: string }>();
  let next = 1;
  if (maxRow?.ticket_number) {
    const m = String(maxRow.ticket_number).match(/(\d+)$/);
    if (m) next = parseInt(m[1], 10) + 1;
  }
  return 'TKT-' + String(next).padStart(4, '0');
}

/**
 * Shared insert path for ALL account-support ticket writes.
 * Both createAccountSupportRequest and requestAccountAssistance call this.
 */
interface AccountSupportInsertInput {
  actor:                   { id: string; username: string; full_name?: string | null };
  subjectId:               string;
  serviceDomain:           string;
  requestedAction:         string;
  subject:                 string;
  body:                    string;
  priority?:               string;
  requestedCompletionDate?: string;
  requesterOrg?:           string;
}

async function _insertAccountSupportTicket(
  input: AccountSupportInsertInput,
): Promise<{ ok: true; id: string; ticketNumber: string } | { ok: false; message: string }> {
  let ticketNumber = await _genTicketNumber();
  let data: { id: string; ticket_number: string } | null = null;
  let insertError: { message: string } | null = null;

  for (let attempt = 0; attempt < 3; attempt++) {
    ({ data, error: insertError } = await sb.from('support_tickets').insert({
      from_user_id:              input.actor.id,
      from_username:             input.actor.username,
      from_name:                 input.actor.full_name ?? input.actor.username,
      ticket_number:             ticketNumber,
      category:                  'account_support',
      subject_type:              'app_user',
      subject_id:                input.subjectId,
      service_domain:            input.serviceDomain,
      requested_action:          input.requestedAction,
      requested_completion_date: input.requestedCompletionDate ?? null,
      requester_org:             input.requesterOrg ?? null,
      capability_target:         'account_support',
      subject:                   input.subject,
      body:                      input.body,
      status:                    'open',
      priority:                  input.priority ?? 'medium',
    }).select('id, ticket_number').single<{ id: string; ticket_number: string }>());
    if (!insertError) break;
    if (!insertError.message.includes('unique') && !insertError.message.includes('duplicate')) break;
    ticketNumber = 'TKT-' + String(Date.now()).slice(-6) + Math.floor(Math.random() * 100);
  }

  if (insertError || !data) {
    return { ok: false, message: insertError?.message ?? 'Failed to create account support request' };
  }
  return { ok: true, id: data.id, ticketNumber: data.ticket_number };
}

/**
 * Resolve the authorised receiver for account support requests from the org config.
 *
 * Fetches the current org config, verifies the dedicated_team assignee (if applicable),
 * then delegates the ownership-model → dispatch-destination mapping to the pure
 * resolveDispatchFromConfig() function (netlify/functions/lib/accountSupportDispatch.ts).
 *
 * Returns ok:false when no valid receiver is configured.
 * Callers MUST check ok:false and return an error BEFORE any DB write.
 */
async function _resolveAccountSupportAssignee(): Promise<
  | { ok: false; message: string }
  | { ok: true; destination: DispatchDestination }
> {
  const { data: config } = await sb.from('org_account_support_config')
    .select('ownership_model, assigned_user_id')
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle<{ ownership_model: string; assigned_user_id: string | null }>();

  if (!config) {
    return {
      ok: false,
      message:
        'No account support configuration found. An administrator must configure the ' +
        'account support ownership model before requests can be routed.',
    };
  }

  // For dedicated_team, verify the assignee exists and is active before delegating.
  let assigneeActive: boolean | null = null;
  if (config.ownership_model === 'dedicated_team' && config.assigned_user_id) {
    const { data: assignee } = await sb.from('app_users')
      .select('id, status')
      .eq('id', config.assigned_user_id)
      .maybeSingle<{ id: string; status: string }>();
    assigneeActive = !!(assignee && assignee.status === 'active');
  }

  // Delegate the pure mapping to the shared resolver module.
  return resolveDispatchFromConfig(config, assigneeActive);
}

// ─────────────────────────────────────────────────────────────────────────────
// Standard Ticket Center (support_tickets)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create a standard support ticket.
 * Gate: tickets.create_self — any authenticated user who holds this key.
 */
router.post('/createTicket', async c => {
  const actor = await requirePermission(c, 'tickets.create_self');

  const v = zv(c, CreateTicketSchema, c.get('body').args ?? {});
  if (!v.ok) return v.response;
  const { subject, body, priority } = v.data;
  const category = ((c.get('body').args ?? {}) as Record<string, string>).category?.trim() ?? 'general';

  let ticketNumber = await _genTicketNumber();
  let data: { id: string; ticket_number: string } | null = null;
  let error: { message: string } | null = null;

  for (let attempt = 0; attempt < 3; attempt++) {
    ({ data, error } = await sb.from('support_tickets').insert({
      from_user_id: actor.id, from_username: actor.username, from_name: actor.full_name ?? actor.username,
      ticket_number: ticketNumber, category, subject, body, status: 'open', priority: priority ?? 'medium',
    }).select('id, ticket_number').single<{ id: string; ticket_number: string }>());
    if (!error) break;
    if (!error.message.includes('unique') && !error.message.includes('duplicate')) break;
    ticketNumber = 'TKT-' + String(Date.now()).slice(-6) + Math.floor(Math.random() * 100);
  }
  if (error || !data) return c.json({ success: false, message: error?.message ?? 'Failed to create ticket' });

  // Explicit audit log — throws on failure
  await writePlatformAudit({
    action:    'ticket.created',
    tableName: 'support_ticket',
    recordId:  data.ticket_number,
    actorId:   actor.id,
    changes:   { ticketId: data.id, category, subject, priority: priority ?? 'medium', actorUsername: actor.username, outcome: 'created' },
  });

  await emitAppEvent({
    eventType: 'ticket.created',
    sourceModule: 'platform',
    sourceEntityType: 'support_ticket',
    sourceEntityId: data.ticket_number,
    actorUserId: actor.id,
    severity: 'info',
    payload: { ticketId: data.id, category, subject, priority: priority ?? 'medium', actorUsername: actor.username },
    dedupeKey: `ticket.created:${data.id}`,
    notification: {
      title: 'Support ticket submitted',
      body: `Your ticket ${data.ticket_number} has been submitted.`,
      actionRoute: `tickets/${data.id}`,
    },
    explicitRecipients: [{ userId: actor.id, reason: 'actor' }],
  });

  return c.json({ success: true, id: data.id, ticketNumber: data.ticket_number });
});

/**
 * List support tickets.
 * tickets.view_all → all open tickets (queue-wide).
 * Otherwise → own submissions only.
 */
router.post('/getTickets', async c => {
  const actor      = await requireUser(c);
  const canViewAll = await userCan(actor, 'tickets.view_all');
  const canReplyInternal = await userCan(actor, 'tickets.reply_internal');

  let query;
  if (canViewAll) {
    query = sb.from('support_tickets')
      .select('id, from_username, from_name, ticket_number, category, subject, body, status, created_at, updated_at, cleared_by_admin, cleared_by_employee')
      .eq('cleared_by_admin', false)
      .order('created_at', { ascending: false })
      .limit(50);
  } else {
    query = sb.from('support_tickets')
      .select('id, from_username, from_name, ticket_number, category, subject, body, status, created_at, updated_at, cleared_by_admin, cleared_by_employee')
      .eq('from_user_id', actor.id)
      .eq('cleared_by_employee', false)
      .order('created_at', { ascending: false })
      .limit(20);
  }

  let { data: tickets, error } = await query;
  if (error && (error.message.includes('cleared_by_admin') || error.message.includes('cleared_by_employee'))) {
    // Older schema without the cleared columns — fall back gracefully
    const fallbackQ = sb.from('support_tickets')
      .select('id, from_username, from_name, ticket_number, category, subject, body, status, created_at, updated_at')
      .order('created_at', { ascending: false })
      .limit(canViewAll ? 50 : 20);
    if (!canViewAll) (fallbackQ as any).eq('from_user_id', actor.id);
    ({ data: tickets, error } = await fallbackQ as any);
  }
  if (error) return c.json({ success: false, message: error.message });

  const ids = ((tickets ?? []) as any[]).map(t => t.id);
  const { data: replies } = ids.length
    ? await sb.from('ticket_replies')
        .select('id, ticket_id, from_username, from_name, body, is_internal, created_at')
        .in('ticket_id', ids)
        .order('created_at', { ascending: true })
    : { data: [] };

  // Internal notes are only visible to staff who hold tickets.reply_internal
  const visibleReplies = ((replies ?? []) as any[]).filter(r =>
    canReplyInternal || !r.is_internal,
  );

  const ticketUsernames = [...new Set([
    ...((tickets ?? []) as any[]).map(t => t.from_username),
    ...visibleReplies.map(r => r.from_username),
  ].filter(Boolean))];
  const ticketPhotoMap: Record<string, string> = {};
  if (ticketUsernames.length) {
    const { data: photoUsers } = await sb.from('app_users').select('id, username, profile_image').in('username', ticketUsernames);
    await Promise.all(((photoUsers ?? []) as any[]).map(async u => {
      ticketPhotoMap[u.username] = await getProfileSignedUrl(u.id, u.profile_image).catch(() => '');
    }));
  }

  const replyMap: Record<string, any[]> = {};
  for (const r of visibleReplies) {
    if (!replyMap[r.ticket_id]) replyMap[r.ticket_id] = [];
    replyMap[r.ticket_id].push({
      id: r.id, ticketId: r.ticket_id, fromUsername: r.from_username, fromName: r.from_name,
      fromPhoto: ticketPhotoMap[r.from_username] ?? '', body: r.body,
      isInternal: r.is_internal ?? false, createdAt: r.created_at,
    });
  }

  return c.json({
    success: true,
    openCount: ((tickets ?? []) as any[]).filter(t => t.status === 'open').length,
    data: ((tickets ?? []) as any[]).map(t => ({
      id: t.id, fromUsername: t.from_username, fromName: t.from_name,
      fromPhoto: ticketPhotoMap[t.from_username] ?? '',
      ticketNumber: t.ticket_number, category: t.category, subject: t.subject,
      body: t.body, status: t.status, createdAt: t.created_at, updatedAt: t.updated_at,
      replies: replyMap[t.id] ?? [],
    })),
  });
});

/**
 * Post a reply to a ticket.
 * Internal notes require tickets.reply_internal.
 * Submitter can reply to their own open ticket.
 */
router.post('/replyTicket', async c => {
  const actor = await requireUser(c);
  const v = zv(c, ReplyTicketSchema, c.get('body').args ?? {});
  if (!v.ok) return v.response;
  const { ticketId, body, isInternal } = v.data;

  // Internal notes gate: capability not role
  if (isInternal) {
    const canPostInternal = await userCan(actor, 'tickets.reply_internal');
    if (!canPostInternal) return c.json({ success: false, message: 'You do not have permission to post internal notes.' }, 403);
  }

  const { data: ticket } = await sb.from('support_tickets')
    .select('status, from_user_id')
    .eq('id', ticketId)
    .maybeSingle<{ status: string; from_user_id: string }>();
  if (!ticket) return c.json({ success: false, message: 'Ticket not found.' });
  if (ticket.status === 'closed' || ticket.status === 'resolved') {
    return c.json({ success: false, message: 'This ticket is closed and can no longer be replied to.' });
  }

  // Scope check: own ticket OR has queue-wide visibility
  const canViewAll = await userCan(actor, 'tickets.view_all');
  if (!canViewAll && ticket.from_user_id !== actor.id) {
    return c.json({ success: false, message: 'Ticket not found.' }, 404);
  }

  const { error } = await sb.from('ticket_replies').insert({
    ticket_id: ticketId, from_user_id: actor.id, from_username: actor.username,
    from_name: actor.full_name ?? actor.username, body, is_internal: isInternal ?? false,
  });
  if (error) return c.json({ success: false, message: error.message });

  // Advance to in_progress when a queue holder replies (not an internal note)
  if (canViewAll && !isInternal) {
    await sb.from('support_tickets')
      .update({ status: 'in_progress', updated_at: new Date().toISOString() })
      .eq('id', ticketId);
  }

  // Explicit audit log — throws on failure
  await writePlatformAudit({
    action:    isInternal ? 'ticket.internal_note_added' : 'ticket.reply_added',
    tableName: 'support_ticket',
    recordId:  ticketId,
    actorId:   actor.id,
    changes:   { ticketId, isInternal: isInternal ?? false, actorUsername: actor.username, outcome: 'reply_added' },
  });

  return c.json({ success: true });
});

/**
 * Update ticket status.
 * Gate: tickets.manage
 */
router.post('/updateTicketStatus', async c => {
  const actor = await requirePermission(c, 'tickets.manage');
  const v = zv(c, UpdateTicketSchema, c.get('body').args ?? {});
  if (!v.ok) return v.response;
  const { ticketId, status } = v.data;
  if (!status) return c.json({ success: false, message: 'Status is required.' }, 400);

  const { data: ticket } = await sb.from('support_tickets')
    .select('status, ticket_number, updated_at')
    .eq('id', ticketId)
    .maybeSingle<{ status: string; ticket_number: string; updated_at: string | null }>();
  if (!ticket) return c.json({ success: false, message: 'Ticket not found.' });

  const { error } = await sb.from('support_tickets')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('id', ticketId);
  if (error) return c.json({ success: false, message: error.message });

  const wasOpen = ticket.status !== 'closed' && ticket.status !== 'resolved';
  if (wasOpen && (status === 'closed' || status === 'resolved')) {
    const systemMsg = status === 'closed'
      ? `This ticket has been closed by ${actor.full_name ?? actor.username}. No further replies are possible.`
      : `This ticket has been marked as resolved by ${actor.full_name ?? actor.username}. If your issue persists, please open a new ticket.`;
    await sb.from('ticket_replies').insert({
      ticket_id: ticketId, from_user_id: actor.id, from_username: '__system__',
      from_name: 'System', body: systemMsg, is_internal: false,
    });
  }

  // Explicit audit log — throws on failure; compensate by restoring previous status
  try {
    await writePlatformAudit({
      action:    'ticket.status_changed',
      tableName: 'support_ticket',
      recordId:  ticket.ticket_number ?? ticketId,
      actorId:   actor.id,
      changes: {
        ticketId,
        fromStatus:    ticket.status,
        toStatus:      status,
        actorUsername: actor.username,
        outcome:       'status_updated',
      },
    });
  } catch (auditErr) {
    // Compensating rollback: restore previous status
    await sb.from('support_tickets')
      .update({ status: ticket.status, updated_at: ticket.updated_at ?? new Date().toISOString() })
      .eq('id', ticketId);
    throw auditErr;
  }

  await emitAppEvent({
    eventType: 'ticket.status_changed',
    sourceModule: 'platform',
    sourceEntityType: 'support_ticket',
    sourceEntityId: ticket.ticket_number ?? ticketId,
    actorUserId: actor.id,
    severity: 'info',
    payload: { ticketId, fromStatus: ticket.status, toStatus: status, actorUsername: actor.username },
    dedupeKey: null,
  });
  return c.json({ success: true });
});

/**
 * Delete own ticket (soft-delete via status = deleted).
 * Any authenticated ticket owner can delete their own open ticket.
 * Users with tickets.manage cannot delete tickets — they use status controls.
 */
router.post('/deleteTicket', async c => {
  const actor = await requireUser(c);
  const v = zv(c, GetTicketSchema, c.get('body').args ?? {});
  if (!v.ok) return v.response;
  const { ticketId } = v.data;

  const { data: ticket } = await sb.from('support_tickets')
    .select('id, from_user_id, status, subject')
    .eq('id', ticketId)
    .maybeSingle<{ id: string; from_user_id: string; status: string; subject: string }>();
  if (!ticket) return c.json({ success: false, message: 'Ticket not found.' });
  // Record-scope: only the submitter may delete their own ticket
  if (ticket.from_user_id !== actor.id) {
    return c.json({ success: false, message: 'You can only delete your own tickets.' }, 403);
  }
  if (ticket.status === 'closed' || ticket.status === 'resolved') {
    return c.json({ success: false, message: 'This ticket is already closed and cannot be deleted.' });
  }

  const { error } = await sb.from('support_tickets')
    .update({ status: 'deleted', updated_at: new Date().toISOString() })
    .eq('id', ticketId);
  if (error) return c.json({ success: false, message: error.message });

  if (ticket.status === 'open' || ticket.status === 'in_progress') {
    await sb.from('ticket_replies').insert({
      ticket_id: ticketId, from_user_id: actor.id, from_username: '__system__', from_name: 'System',
      body: `This ticket was deleted by the employee (${actor.full_name ?? actor.username}) before it was resolved.`,
      is_internal: false,
    });
  }

  // Explicit audit log — throws on failure
  await writePlatformAudit({
    action:    'ticket.deleted',
    tableName: 'support_ticket',
    recordId:  ticketId,
    actorId:   actor.id,
    changes:   { ticketId, subject: ticket.subject, fromStatus: ticket.status, actorUsername: actor.username, outcome: 'deleted' },
  });

  return c.json({ success: true });
});

/**
 * Clear (hide) closed/resolved/deleted tickets from the list.
 * tickets.manage holders clear all; others clear only their own.
 */
router.post('/clearClosedTickets', async c => {
  const actor      = await requireUser(c);
  const canManage  = await userCan(actor, 'tickets.manage');

  let query = sb.from('support_tickets').select('id').in('status', ['closed', 'resolved', 'deleted']);
  if (!canManage) query = query.eq('from_user_id', actor.id);

  const { data: toHide, error: fetchErr } = await query;
  if (fetchErr) return c.json({ success: false, message: fetchErr.message });
  if (!toHide || !toHide.length) return c.json({ success: true, count: 0 });

  const ids  = (toHide as any[]).map(t => t.id);
  const flag = canManage ? { cleared_by_admin: true } : { cleared_by_employee: true };
  const { error } = await sb.from('support_tickets').update(flag).in('id', ids);
  if (error) {
    // Fallback: hard delete if the cleared_by_* columns don't exist yet
    await sb.from('ticket_replies').delete().in('ticket_id', ids);
    const { error: delErr } = await sb.from('support_tickets').delete().in('id', ids);
    if (delErr) return c.json({ success: false, message: delErr.message });
  }

  // Explicit audit log — throws on failure
  await writePlatformAudit({
    action:    'ticket.bulk_cleared',
    tableName: 'support_ticket',
    recordId:  canManage ? 'bulk_admin_clear' : actor.id,
    actorId:   actor.id,
    changes:   { count: ids.length, canManage, actorUsername: actor.username, outcome: 'cleared' },
  });

  return c.json({ success: true, count: ids.length });
});

// ─────────────────────────────────────────────────────────────────────────────
// Account Support Service Requests
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create a capability-routed account support service request.
 *
 * Gate: employees.access.request (self-service for own subject).
 * Non-self subjects additionally require employees.access.view.
 *
 * Side-effects: app_events, audit_logs (via emitAppEvent), handoff_outbox (→ hr),
 * notifications to actor + receiver.
 */
router.post('/createAccountSupportRequest', async c => {
  const actor = await requirePermission(c, 'employees.access.request');

  const v = zv(c, CreateAccountSupportRequestSchema, c.get('body').args ?? {});
  if (!v.ok) return v.response;
  const {
    subjectId, serviceDomain, requestedAction, subject, body, priority,
    requestedCompletionDate, requesterOrg,
  } = v.data;

  // Non-self subjects require employees.access.view
  if (subjectId !== actor.id) {
    await requirePermission(c, 'employees.access.view');
  }

  // Verify subject employee exists
  const { data: subjectUser } = await sb.from('app_users')
    .select('id, full_name, username')
    .eq('id', subjectId)
    .maybeSingle<{ id: string; full_name: string | null; username: string }>();
  if (!subjectUser) return c.json({ success: false, message: 'Subject employee not found.' }, 404);

  // Resolve the authorised receiver — MUST fail before any DB write when ok:false
  const receiver = await _resolveAccountSupportAssignee();
  if (!receiver.ok) return c.json({ success: false, message: receiver.message }, 422);
  const { destination } = receiver;

  // Insert the ticket
  const insertResult = await _insertAccountSupportTicket({
    actor, subjectId, serviceDomain, requestedAction, subject, body,
    priority, requestedCompletionDate, requesterOrg,
  });
  if (!insertResult.ok) return c.json({ success: false, message: insertResult.message });

  const { id: ticketId, ticketNumber } = insertResult;

  // Dispatch handoff to the resolved module receiver — compensating rollback if it fails.
  // NOT a DB transaction: two separate PostgREST calls. The MUTATION_BACKBONE_PLAN.md
  // deferred the full transactional RPC; a compensating delete is the approved interim pattern.
  const handoff = await createHandoff({
    sourceModule:     'platform',
    targetModule:     destination.targetModule,
    sourceEntityType: 'support_ticket',
    sourceEntityId:   ticketNumber,
    targetEntityType: 'case',
    payload: {
      caseType:       'account_support',
      employeeUserId: subjectId,
      title:          `Account support: ${requestedAction}`,
      description:    body,
      ticketId,
      ticketNumber,
      serviceDomain,
      requestedAction,
      ownershipModel: destination.ownershipModel,
      assignedUserId: destination.assignedUserId ?? undefined,
      actorId:        actor.id,
      actorUsername:  actor.username,
    },
    createdBy: actor.id,
  });

  if (!handoff.ok) {
    // Compensating rollback: remove the ticket row so no orphaned record exists
    await sb.from('ticket_replies').delete().eq('ticket_id', ticketId);
    await sb.from('support_tickets').delete().eq('id', ticketId);
    return c.json({
      success: false,
      message: `Request could not be routed: ${handoff.message}. Please try again or contact an administrator.`,
    }, 500);
  }

  // Explicit audit log — mandatory §2 side-effect; throws on failure.
  // Written after handoff succeeds so rollback only needs to cover the ticket insert.
  // If audit write fails here, ticket+handoff are already committed; we return 500 with
  // the inconsistency logged (transactional RPC is deferred per MUTATION_BACKBONE_PLAN.md).
  await writePlatformAudit({
    action:    'ticket.account_support.created',
    tableName: 'support_ticket',
    recordId:  ticketNumber,
    actorId:   actor.id,
    changes: {
      ticketId,
      subjectId,
      subjectName:    subjectUser.full_name ?? subjectUser.username,
      serviceDomain,
      requestedAction,
      priority:       priority ?? 'medium',
      handoffId:      handoff.handoffId,
      targetModule:   destination.targetModule,
      ownershipModel: destination.ownershipModel,
      assignedTo:     destination.assignedUserId ?? null,
      actorUsername:  actor.username,
      outcome:        'created',
    },
  });

  // Update ticket with handoff ID for traceability
  await sb.from('support_tickets')
    .update({ resolution_notes: `handoff:${handoff.handoffId}` })
    .eq('id', ticketId);

  // Notify actor + subject (if different) + receiver (if explicit).
  // The actor is the ticket owner (their own request) — reason 'owner' ensures
  // resolveRecipients does NOT suppress their confirmation notification (the
  // actor-suppression rule in recipientResolver only drops reason === 'actor').
  const explicitRecipients: Array<{ userId: string; reason: 'owner' | 'participant' | 'assignee' }> = [
    { userId: actor.id, reason: 'owner' },
  ];
  if (subjectId !== actor.id) explicitRecipients.push({ userId: subjectId, reason: 'participant' });
  if (destination.assignedUserId && destination.assignedUserId !== actor.id) {
    explicitRecipients.push({ userId: destination.assignedUserId, reason: 'assignee' as 'participant' });
  }

  await emitAppEvent({
    eventType: 'ticket.account_support.created',
    sourceModule: 'platform',
    sourceEntityType: 'support_ticket',
    sourceEntityId: ticketNumber,
    actorUserId: actor.id,
    severity: 'info',
    payload: {
      ticketId,
      subjectId,
      subjectName:    subjectUser.full_name ?? subjectUser.username,
      serviceDomain,
      requestedAction,
      priority:       priority ?? 'medium',
      actorId:        actor.id,
      actorUsername:  actor.username,
      handoffId:      handoff.handoffId,
      assignedTo:     destination.assignedUserId ?? null,
      ownershipModel: destination.ownershipModel,
    },
    dedupeKey: `ticket.account_support.created:${ticketId}`,
    notification: {
      title: 'Account support request submitted',
      body: `Request ${ticketNumber} submitted for ${subjectUser.full_name ?? subjectUser.username}.`,
      actionRoute: `tickets/${ticketId}`,
    },
    explicitRecipients,
  });

  return c.json({
    success: true,
    id: ticketId,
    ticketNumber,
    assignedTo: destination.assignedUserId ?? null,
  });
});

/**
 * List account support service requests.
 * employees.access.view OR tickets.manage → all requests.
 * Otherwise → own submissions only.
 */
router.post('/getAccountSupportRequests', async c => {
  const actor      = await requirePermission(c, 'employees.access.request');
  const canViewAll =
    (await userCan(actor, 'employees.access.view')) ||
    (await userCan(actor, 'tickets.manage'));

  let query = sb.from('support_tickets')
    .select('id, from_username, from_name, ticket_number, category, subject_type, subject_id, service_domain, requested_action, requested_completion_date, requester_org, capability_target, assigned_user_id, subject, body, status, priority, resolution_notes, created_at, updated_at')
    .eq('category', 'account_support')
    .not('status', 'eq', 'deleted')
    .order('created_at', { ascending: false })
    .limit(50);

  if (!canViewAll) {
    query = query.eq('from_user_id', actor.id);
  }

  const { data: tickets, error } = await query;
  if (error) return c.json({ success: false, message: error.message });

  return c.json({
    success: true,
    data: ((tickets ?? []) as any[]).map(t => ({
      id:                     t.id,
      fromUsername:           t.from_username,
      fromName:               t.from_name,
      ticketNumber:           t.ticket_number,
      category:               t.category,
      subjectType:            t.subject_type,
      subjectId:              t.subject_id,
      serviceDomain:          t.service_domain,
      requestedAction:        t.requested_action,
      requestedCompletionDate: t.requested_completion_date,
      requesterOrg:           t.requester_org,
      capabilityTarget:       t.capability_target,
      assignedUserId:         t.assigned_user_id,
      subject:                t.subject,
      body:                   t.body,
      status:                 t.status,
      priority:               t.priority,
      resolutionNotes:        t.resolution_notes,
      createdAt:              t.created_at,
      updatedAt:              t.updated_at,
    })),
  });
});

/**
 * Update account support request status/assignment/resolution.
 * Gate: tickets.manage
 */
router.post('/updateAccountSupportRequest', async c => {
  const actor = await requirePermission(c, 'tickets.manage');

  const v = zv(c, UpdateAccountSupportRequestSchema, c.get('body').args ?? {});
  if (!v.ok) return v.response;
  const { ticketId, status, assignedUserId, resolutionNotes } = v.data;

  const { data: ticket } = await sb.from('support_tickets')
    .select('id, status, ticket_number, category')
    .eq('id', ticketId)
    .maybeSingle<{ id: string; status: string; ticket_number: string; category: string }>();
  if (!ticket) return c.json({ success: false, message: 'Ticket not found.' }, 404);
  if (ticket.category !== 'account_support') {
    return c.json({ success: false, message: 'This endpoint is only for account support requests.' }, 400);
  }

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (status)                       updates.status           = status;
  if (assignedUserId !== undefined)  updates.assigned_user_id = assignedUserId;
  if (resolutionNotes !== undefined) updates.resolution_notes = resolutionNotes;

  const { error } = await sb.from('support_tickets').update(updates).eq('id', ticketId);
  if (error) return c.json({ success: false, message: error.message });

  // Explicit audit log — throws on failure
  await writePlatformAudit({
    action:    'ticket.account_support.updated',
    tableName: 'support_ticket',
    recordId:  ticket.ticket_number,
    actorId:   actor.id,
    changes:   {
      ticketId,
      updates:       Object.keys(updates).filter(k => k !== 'updated_at'),
      actorUsername: actor.username,
      outcome:       'updated',
    },
  });

  await emitAppEvent({
    eventType: 'ticket.account_support.updated',
    sourceModule: 'platform',
    sourceEntityType: 'support_ticket',
    sourceEntityId: ticket.ticket_number,
    actorUserId: actor.id,
    severity: 'info',
    payload: {
      ticketId,
      updates:       Object.keys(updates).filter(k => k !== 'updated_at'),
      actorUsername: actor.username,
    },
    dedupeKey: null,
  });

  return c.json({ success: true });
});

// ─────────────────────────────────────────────────────────────────────────────
// Elevated access actions (step-up required)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Request account assistance (credential/access help) for a subject employee.
 *
 * Gate: employees.access.reset_password + step-up
 *
 * This route does NOT reset the password directly — SIOMAC's identity provider
 * integration is not yet wired. It creates a REAL account-support service request
 * ticket, routes it to the configured receiver via a handoff, and notifies both
 * the subject employee and the resolved assignee.
 *
 * Returns the created ticket ID/number and the resolved assignee so callers have
 * an honest, actionable response (never a claim about work that did not happen).
 *
 * Fails closed (before any DB write) when no authorised receiver is configured.
 */
router.post('/requestAccountAssistance', async c => {
  const actor = await requireStepUp(c);
  await requirePermission(c, 'employees.access.reset_password');

  const v = zv(c, AccountAccessActionSchema, c.get('body').args ?? {});
  if (!v.ok) return v.response;
  const { subjectId, reason } = v.data;

  // Verify subject exists
  const { data: subject } = await sb.from('app_users')
    .select('id, full_name, username')
    .eq('id', subjectId)
    .maybeSingle<{ id: string; full_name: string | null; username: string }>();
  if (!subject) return c.json({ success: false, message: 'Target user not found.' }, 404);

  // Resolve receiver — MUST fail before any DB write when ok:false
  const receiver = await _resolveAccountSupportAssignee();
  if (!receiver.ok) return c.json({ success: false, message: receiver.message }, 422);
  const { destination } = receiver;

  // Create the service-request ticket
  const insertResult = await _insertAccountSupportTicket({
    actor,
    subjectId,
    serviceDomain:   'password_reset',
    requestedAction: reason,
    subject:         `Account assistance request for ${subject.full_name ?? subject.username}`,
    body:            reason,
    priority:        'high',
  });
  if (!insertResult.ok) return c.json({ success: false, message: insertResult.message });

  const { id: ticketId, ticketNumber } = insertResult;

  // Dispatch handoff to resolved module receiver — compensating rollback on failure
  const handoff = await createHandoff({
    sourceModule:     'platform',
    targetModule:     destination.targetModule,
    sourceEntityType: 'support_ticket',
    sourceEntityId:   ticketNumber,
    targetEntityType: 'case',
    payload: {
      caseType:        'account_support',
      employeeUserId:  subjectId,
      title:           `Account assistance request: ${subject.full_name ?? subject.username}`,
      description:     reason,
      ticketId,
      ticketNumber,
      serviceDomain:   'password_reset',
      requestedAction: reason,
      ownershipModel:  destination.ownershipModel,
      assignedUserId:  destination.assignedUserId ?? undefined,
      actorId:         actor.id,
      actorUsername:   actor.username,
    },
    createdBy: actor.id,
  });

  if (!handoff.ok) {
    await sb.from('ticket_replies').delete().eq('ticket_id', ticketId);
    await sb.from('support_tickets').delete().eq('id', ticketId);
    return c.json({
      success: false,
      message: `Request could not be routed: ${handoff.message}. Please try again or contact an administrator.`,
    }, 500);
  }

  // Explicit audit log — mandatory §2 side-effect; throws on failure.
  await writePlatformAudit({
    action:    'account_access.assistance_requested',
    tableName: 'app_user',
    recordId:  subjectId,
    actorId:   actor.id,
    changes: {
      subjectId,
      subjectUsername: subject.username,
      reason,
      ticketId,
      ticketNumber,
      handoffId:      handoff.handoffId,
      targetModule:   destination.targetModule,
      ownershipModel: destination.ownershipModel,
      assignedTo:     destination.assignedUserId ?? null,
      actorUsername:  actor.username,
      outcome:        'assistance_request_created',
    },
  });

  // Notify: actor, subject employee, and explicit assignee (if any)
  const explicitRecipients: Array<{ userId: string; reason: 'actor' | 'participant' }> = [
    { userId: actor.id,   reason: 'actor' },
    { userId: subjectId,  reason: 'participant' },
  ];
  if (destination.assignedUserId && destination.assignedUserId !== actor.id) {
    explicitRecipients.push({ userId: destination.assignedUserId, reason: 'participant' });
  }

  await emitAppEvent({
    eventType: 'account_access.assistance_requested',
    sourceModule: 'platform',
    sourceEntityType: 'app_user',
    sourceEntityId: subjectId,
    actorUserId: actor.id,
    severity: 'high',
    payload: {
      subjectId,
      subjectUsername: subject.username,
      reason,
      ticketId,
      ticketNumber,
      handoffId:      handoff.handoffId,
      assignedTo:     destination.assignedUserId ?? null,
      ownershipModel: destination.ownershipModel,
      actorId:        actor.id,
      actorUsername:  actor.username,
    },
    dedupeKey: `account_access.assistance_requested:${ticketId}`,
    notification: {
      title: 'Account assistance request submitted',
      body:  `A request has been submitted for ${subject.full_name ?? subject.username}. Ticket: ${ticketNumber}.`,
      actionRoute: `tickets/${ticketId}`,
      type: 'system_announcement',
    },
    explicitRecipients,
  });

  return c.json({
    success: true,
    id: ticketId,
    ticketNumber,
    assignedTo: destination.assignedUserId ?? null,
  });
});

/**
 * Resend account activation email.
 * Gate: employees.access.resend_activation
 */
router.post('/resendActivation', async c => {
  const actor = await requirePermission(c, 'employees.access.resend_activation');

  const v = zv(c, AccountAccessActionSchema, c.get('body').args ?? {});
  if (!v.ok) return v.response;
  const { subjectId, reason } = v.data;

  const { data: subject } = await sb.from('app_users')
    .select('id, full_name, username, status')
    .eq('id', subjectId)
    .maybeSingle<{ id: string; full_name: string | null; username: string; status: string }>();
  if (!subject) return c.json({ success: false, message: 'Target user not found.' }, 404);

  // Explicit audit log — throws on failure
  await writePlatformAudit({
    action:    'account_access.activation_resent',
    tableName: 'app_user',
    recordId:  subjectId,
    actorId:   actor.id,
    changes:   { subjectId, subjectUsername: subject.username, reason, actorUsername: actor.username, outcome: 'activation_resend_logged' },
  });

  await emitAppEvent({
    eventType: 'account_access.activation_resent',
    sourceModule: 'platform',
    sourceEntityType: 'app_user',
    sourceEntityId: subjectId,
    actorUserId: actor.id,
    severity: 'info',
    payload: {
      subjectId,
      subjectUsername: subject.username,
      reason,
      actorId:         actor.id,
      actorUsername:   actor.username,
    },
    dedupeKey: null,
  });

  return c.json({ success: true, message: 'Activation resend logged.' });
});

/**
 * Suspend a user account.
 * Gate: employees.access.suspend + step-up
 * Compensating rollback on event emission failure.
 */
router.post('/suspendAccount', async c => {
  const actor = await requireStepUp(c);
  await requirePermission(c, 'employees.access.suspend');

  const v = zv(c, AccountAccessActionSchema, c.get('body').args ?? {});
  if (!v.ok) return v.response;
  const { subjectId, reason } = v.data;

  if (subjectId === actor.id) {
    return c.json({ success: false, message: 'You cannot suspend your own account.' }, 400);
  }

  const { data: subject } = await sb.from('app_users')
    .select('id, full_name, username, status')
    .eq('id', subjectId)
    .maybeSingle<{ id: string; full_name: string | null; username: string; status: string }>();
  if (!subject) return c.json({ success: false, message: 'Target user not found.' }, 404);
  if (subject.status === 'inactive') {
    return c.json({ success: false, message: 'Account is already suspended.' }, 400);
  }

  const { error } = await sb.from('app_users')
    .update({ status: 'inactive', updated_at: new Date().toISOString() })
    .eq('id', subjectId);
  if (error) return c.json({ success: false, message: error.message });

  // Explicit audit log — throws on failure; compensate by restoring account status
  try {
    await writePlatformAudit({
      action:    'account_access.account_suspended',
      tableName: 'app_user',
      recordId:  subjectId,
      actorId:   actor.id,
      changes:   { subjectId, subjectUsername: subject.username, reason, actorUsername: actor.username, outcome: 'suspended' },
    });
  } catch (auditErr) {
    await sb.from('app_users').update({ status: 'active', updated_at: new Date().toISOString() }).eq('id', subjectId);
    throw auditErr;
  }

  const evtResult = await emitAppEvent({
    eventType: 'account_access.account_suspended',
    sourceModule: 'platform',
    sourceEntityType: 'app_user',
    sourceEntityId: subjectId,
    actorUserId: actor.id,
    severity: 'critical',
    payload: {
      subjectId,
      subjectUsername: subject.username,
      reason,
      actorId:         actor.id,
      actorUsername:   actor.username,
      outcome:         'suspended',
    },
    dedupeKey: `account_access.account_suspended:${subjectId}:${Date.now()}`,
    notification: {
      title: 'Account suspended',
      body: `Your account has been suspended. Reason: ${reason}. Contact HR if you believe this is an error.`,
      type: 'system_announcement',
    },
    explicitRecipients: [{ userId: subjectId, reason: 'participant' }],
  });

  if (!evtResult.ok) {
    // Compensating rollback — restore account status. Note: the audit_logs row was already written
    // (transactional RPC is deferred per MUTATION_BACKBONE_PLAN.md; this inconsistency is logged).
    await sb.from('app_users')
      .update({ status: 'active', updated_at: new Date().toISOString() })
      .eq('id', subjectId);
    console.error('[tickets] suspendAccount: event emission failed after audit write; status restored to active.', { subjectId });
    return c.json({
      success: false,
      message: 'Account suspension aborted: event emission failed. Status has been restored.',
    }, 500);
  }

  return c.json({ success: true, message: `Account for ${subject.full_name ?? subject.username} has been suspended.` });
});

/**
 * Restore a suspended user account.
 * Gate: employees.access.restore + step-up
 * Compensating rollback on event emission failure.
 */
router.post('/restoreAccount', async c => {
  const actor = await requireStepUp(c);
  await requirePermission(c, 'employees.access.restore');

  const v = zv(c, AccountAccessActionSchema, c.get('body').args ?? {});
  if (!v.ok) return v.response;
  const { subjectId, reason } = v.data;

  const { data: subject } = await sb.from('app_users')
    .select('id, full_name, username, status')
    .eq('id', subjectId)
    .maybeSingle<{ id: string; full_name: string | null; username: string; status: string }>();
  if (!subject) return c.json({ success: false, message: 'Target user not found.' }, 404);
  if (subject.status === 'active') {
    return c.json({ success: false, message: 'Account is already active.' }, 400);
  }

  const { error } = await sb.from('app_users')
    .update({ status: 'active', updated_at: new Date().toISOString() })
    .eq('id', subjectId);
  if (error) return c.json({ success: false, message: error.message });

  // Explicit audit log — throws on failure; compensate by reverting account status
  try {
    await writePlatformAudit({
      action:    'account_access.account_restored',
      tableName: 'app_user',
      recordId:  subjectId,
      actorId:   actor.id,
      changes:   { subjectId, subjectUsername: subject.username, reason, actorUsername: actor.username, outcome: 'restored' },
    });
  } catch (auditErr) {
    await sb.from('app_users').update({ status: 'inactive', updated_at: new Date().toISOString() }).eq('id', subjectId);
    throw auditErr;
  }

  const evtResult = await emitAppEvent({
    eventType: 'account_access.account_restored',
    sourceModule: 'platform',
    sourceEntityType: 'app_user',
    sourceEntityId: subjectId,
    actorUserId: actor.id,
    severity: 'high',
    payload: {
      subjectId,
      subjectUsername: subject.username,
      reason,
      actorId:         actor.id,
      actorUsername:   actor.username,
      outcome:         'restored',
    },
    dedupeKey: `account_access.account_restored:${subjectId}:${Date.now()}`,
    notification: {
      title: 'Account restored',
      body: `Your account has been restored by ${actor.full_name ?? actor.username}.`,
      type: 'system_announcement',
    },
    explicitRecipients: [{ userId: subjectId, reason: 'participant' }],
  });

  if (!evtResult.ok) {
    // Compensating rollback. Note: audit_logs row already written (transactional RPC deferred).
    await sb.from('app_users')
      .update({ status: 'inactive', updated_at: new Date().toISOString() })
      .eq('id', subjectId);
    console.error('[tickets] restoreAccount: event emission failed after audit write; status reverted.', { subjectId });
    return c.json({
      success: false,
      message: 'Account restore aborted: event emission failed. Status has been reverted.',
    }, 500);
  }

  return c.json({ success: true, message: `Account for ${subject.full_name ?? subject.username} has been restored.` });
});

/**
 * Revoke all active sessions for a user.
 * Gate: employees.access.revoke_sessions + step-up
 */
router.post('/revokeUserSessions', async c => {
  const actor = await requireStepUp(c);
  await requirePermission(c, 'employees.access.revoke_sessions');

  const v = zv(c, AccountAccessActionSchema, c.get('body').args ?? {});
  if (!v.ok) return v.response;
  const { subjectId, reason } = v.data;

  const { data: subject } = await sb.from('app_users')
    .select('id, full_name, username')
    .eq('id', subjectId)
    .maybeSingle<{ id: string; full_name: string | null; username: string }>();
  if (!subject) return c.json({ success: false, message: 'Target user not found.' }, 404);

  const { error } = await sb.from('sessions')
    .update({ revoked_at: new Date().toISOString() })
    .eq('user_id', subjectId)
    .is('revoked_at', null);
  if (error) return c.json({ success: false, message: error.message });

  // Explicit audit log — throws on failure. Sessions are already revoked; a failure here returns
  // 500 with the inconsistency logged (compensating rollback is not feasible for session revocation;
  // transactional RPC is deferred per MUTATION_BACKBONE_PLAN.md).
  await writePlatformAudit({
    action:    'account_access.sessions_revoked',
    tableName: 'app_user',
    recordId:  subjectId,
    actorId:   actor.id,
    changes:   { subjectId, subjectUsername: subject.username, reason, actorUsername: actor.username, outcome: 'sessions_revoked' },
  });

  await emitAppEvent({
    eventType: 'account_access.sessions_revoked',
    sourceModule: 'platform',
    sourceEntityType: 'app_user',
    sourceEntityId: subjectId,
    actorUserId: actor.id,
    severity: 'high',
    payload: {
      subjectId,
      subjectUsername: subject.username,
      reason,
      actorId:         actor.id,
      actorUsername:   actor.username,
      outcome:         'sessions_revoked',
    },
    dedupeKey: null,
  });

  return c.json({ success: true, message: `All sessions for ${subject.full_name ?? subject.username} have been revoked.` });
});

/**
 * Revoke all trusted devices for a user.
 * Gate: employees.access.revoke_devices + step-up
 */
router.post('/revokeUserDevices', async c => {
  const actor = await requireStepUp(c);
  await requirePermission(c, 'employees.access.revoke_devices');

  const v = zv(c, AccountAccessActionSchema, c.get('body').args ?? {});
  if (!v.ok) return v.response;
  const { subjectId, reason } = v.data;

  const { data: subject } = await sb.from('app_users')
    .select('id, full_name, username')
    .eq('id', subjectId)
    .maybeSingle<{ id: string; full_name: string | null; username: string }>();
  if (!subject) return c.json({ success: false, message: 'Target user not found.' }, 404);

  const { error } = await sb.from('trusted_devices')
    .update({ revoked_at: new Date().toISOString() })
    .eq('user_id', subjectId)
    .is('revoked_at', null);
  if (error) return c.json({ success: false, message: error.message });

  // Explicit audit log — throws on failure (no compensating rollback for device revocation;
  // transactional RPC deferred per MUTATION_BACKBONE_PLAN.md).
  await writePlatformAudit({
    action:    'account_access.devices_revoked',
    tableName: 'app_user',
    recordId:  subjectId,
    actorId:   actor.id,
    changes:   { subjectId, subjectUsername: subject.username, reason, actorUsername: actor.username, outcome: 'devices_revoked' },
  });

  await emitAppEvent({
    eventType: 'account_access.devices_revoked',
    sourceModule: 'platform',
    sourceEntityType: 'app_user',
    sourceEntityId: subjectId,
    actorUserId: actor.id,
    severity: 'high',
    payload: {
      subjectId,
      subjectUsername: subject.username,
      reason,
      actorId:         actor.id,
      actorUsername:   actor.username,
      outcome:         'devices_revoked',
    },
    dedupeKey: null,
  });

  return c.json({ success: true, message: `All trusted devices for ${subject.full_name ?? subject.username} have been revoked.` });
});

/**
 * Force MFA enrollment for a user.
 * Gate: employees.access.require_mfa + step-up
 */
router.post('/requireMfa', async c => {
  const actor = await requireStepUp(c);
  await requirePermission(c, 'employees.access.require_mfa');

  const v = zv(c, AccountAccessActionSchema, c.get('body').args ?? {});
  if (!v.ok) return v.response;
  const { subjectId, reason } = v.data;

  const { data: subject } = await sb.from('app_users')
    .select('id, full_name, username, totp_enabled')
    .eq('id', subjectId)
    .maybeSingle<{ id: string; full_name: string | null; username: string; totp_enabled: boolean }>();
  if (!subject) return c.json({ success: false, message: 'Target user not found.' }, 404);
  if (subject.totp_enabled) {
    return c.json({ success: false, message: 'User already has MFA enabled.' }, 400);
  }

  // Explicit audit log — throws on failure
  await writePlatformAudit({
    action:    'account_access.mfa_required',
    tableName: 'app_user',
    recordId:  subjectId,
    actorId:   actor.id,
    changes:   { subjectId, subjectUsername: subject.username, reason, actorUsername: actor.username, outcome: 'mfa_enrollment_required' },
  });

  await emitAppEvent({
    eventType: 'account_access.mfa_required',
    sourceModule: 'platform',
    sourceEntityType: 'app_user',
    sourceEntityId: subjectId,
    actorUserId: actor.id,
    severity: 'high',
    payload: {
      subjectId,
      subjectUsername: subject.username,
      reason,
      actorId:         actor.id,
      actorUsername:   actor.username,
      outcome:         'mfa_enrollment_required',
    },
    dedupeKey: null,
    notification: {
      title: 'MFA enrollment required',
      body: 'You have been required to set up multi-factor authentication. Please do so on your next login.',
      type: 'system_announcement',
    },
    explicitRecipients: [{ userId: subjectId, reason: 'participant' }],
  });

  return c.json({ success: true, message: `MFA enrollment requirement logged for ${subject.full_name ?? subject.username}.` });
});

// ─────────────────────────────────────────────────────────────────────────────
// Org Account Support Config
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get the org-level account support ownership configuration.
 * Gate: employees.access.view
 */
router.post('/getAccountSupportConfig', async c => {
  await requirePermission(c, 'employees.access.view');

  const { data: config, error } = await sb.from('org_account_support_config')
    .select('id, ownership_model, capability_target, assigned_user_id, notes, updated_at')
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle<{
      id: string; ownership_model: string; capability_target: string | null;
      assigned_user_id: string | null; notes: string | null; updated_at: string;
    }>();
  if (error) return c.json({ success: false, message: error.message });

  return c.json({
    success: true,
    config: config ? {
      id:              config.id,
      ownershipModel:  config.ownership_model,
      capabilityTarget: config.capability_target,
      assignedUserId:  config.assigned_user_id,
      notes:           config.notes,
      updatedAt:       config.updated_at,
    } : null,
  });
});

/**
 * Update the org-level account support ownership configuration.
 * Gate: tickets.manage
 *
 * Validates that no config is saved that leaves the queue without a reachable
 * receiver (dedicated_team/external_admin without an active assignedUserId).
 */
router.post('/updateAccountSupportConfig', async c => {
  const actor = await requirePermission(c, 'tickets.manage');

  const v = zv(c, UpdateAccountSupportConfigSchema, c.get('body').args ?? {});
  if (!v.ok) return v.response;
  const { ownershipModel, capabilityTarget, assignedUserId, notes } = v.data;

  if ((ownershipModel === 'dedicated_team' || ownershipModel === 'external_admin') && !assignedUserId) {
    return c.json({ success: false, message: `The "${ownershipModel}" ownership model requires an assigned user.` }, 400);
  }

  if ((ownershipModel === 'dedicated_team' || ownershipModel === 'external_admin') && assignedUserId) {
    const { data: assignee } = await sb.from('app_users')
      .select('id, status')
      .eq('id', assignedUserId)
      .maybeSingle<{ id: string; status: string }>();
    if (!assignee) return c.json({ success: false, message: 'Assigned user not found.' }, 400);
    if (assignee.status !== 'active') {
      return c.json({ success: false, message: 'Assigned user must be active.' }, 400);
    }
  }

  const { data: existing } = await sb.from('org_account_support_config')
    .select('id').limit(1).maybeSingle<{ id: string }>();

  let upsertError: { message: string } | null = null;
  if (existing) {
    ({ error: upsertError } = await sb.from('org_account_support_config').update({
      ownership_model:   ownershipModel,
      capability_target: capabilityTarget ?? null,
      assigned_user_id:  assignedUserId ?? null,
      notes:             notes ?? null,
      updated_by:        actor.id,
      updated_at:        new Date().toISOString(),
    }).eq('id', existing.id));
  } else {
    ({ error: upsertError } = await sb.from('org_account_support_config').insert({
      ownership_model:   ownershipModel,
      capability_target: capabilityTarget ?? null,
      assigned_user_id:  assignedUserId ?? null,
      notes:             notes ?? null,
      updated_by:        actor.id,
    }));
  }

  if (upsertError) return c.json({ success: false, message: upsertError.message });

  // Explicit audit log — throws on failure
  await writePlatformAudit({
    action:    'account_support.config_updated',
    tableName: 'org_account_support_config',
    recordId:  existing?.id ?? 'new',
    actorId:   actor.id,
    changes:   { ownershipModel, capabilityTarget, assignedUserId, actorUsername: actor.username, outcome: 'config_updated' },
  });

  await emitAppEvent({
    eventType: 'account_support.config_updated',
    sourceModule: 'platform',
    sourceEntityType: 'org_config',
    sourceEntityId: 'account_support_config',
    actorUserId: actor.id,
    severity: 'info',
    payload: { ownershipModel, capabilityTarget, assignedUserId, actorUsername: actor.username },
    dedupeKey: null,
  });

  return c.json({ success: true });
});

export default router;
