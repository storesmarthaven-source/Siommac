// ============================================================================
// Orchestration — unified record timeline (Cross-Module Orchestration §21).
//
// Aggregates the EXISTING platform tables for one business record into a single
// chronological feed: app_events, audit_logs, handoff_outbox, workflow_instances,
// message_threads, tickets. No new storage — this is a read-only projection over
// systems that already exist (see docs/ORCHESTRATION_EXISTING_PLATFORM.md).
//
// Access: gated by the SOURCE RECORD's own view permission (you can only see a
// record's timeline if you could open the record). No timeline for an unmapped
// module — fail closed, never leak.
// ============================================================================

import { sb } from '../db';
import { userCan } from '../auth';

export type TimelineItemType = 'event' | 'audit' | 'handoff' | 'workflow' | 'message' | 'ticket';

export interface TimelineItem {
  id: string;
  item_type: TimelineItemType;
  title: string;
  description?: string;
  actor_id?: string | null;
  actor_name?: string;
  severity?: string;
  created_at: string;
  source_url?: string;
  metadata?: Record<string, unknown>;
}

export interface TimelineActor { id: string; role?: string | null }

export interface TimelineArgs {
  module: string;
  recordType: string;
  recordId: string;
  includeAudit?: boolean;
  includeWorkflows?: boolean;
  includeHandoffs?: boolean;
  includeMessages?: boolean;
  includeTickets?: boolean;
}

/**
 * Map a record's module/type → the permission required to VIEW it. null = no
 * mapping → deny (never surface a timeline for a record the caller can't open).
 * Mirrors the record-inheritance mapping used by communications.
 */
export function recordViewPermission(module: string, recordType: string): string | null {
  const s = `${module} ${recordType}`.toLowerCase();
  if (s.includes('ptw') || s.includes('permit'))                                       return 'hse.ptw.view';
  if (s.includes('incident') || s.includes('capa') || s.includes('investigation'))     return 'hse.incidents.view';
  if (s.includes('risk') || s.includes('jsa') || s.includes('hazard'))                 return 'hse.risk.view';
  if (s.includes('inspection'))                                                        return 'hse.inspections.view';
  if (s.includes('training') || s.includes('competenc') || s.includes('certificate'))  return 'hse.training.view';
  if (s.includes('onboarding'))                                                        return 'hr.onboarding.view';
  if (s.includes('hr') || s.includes('employee'))                                      return 'hr.view';
  return null;
}

const byNewestFirst = (a: TimelineItem, b: TimelineItem): number =>
  new Date(b.created_at).getTime() - new Date(a.created_at).getTime();

/**
 * Turn a dot-notation event key into a readable title.
 * Drops the module prefix, replaces dots/underscores with spaces, title-cases.
 * e.g. "hr.employee.contact_updated" → "Employee contact updated"
 *      "hse.incident.reported"       → "Incident reported"
 */
function humanizeEventType(key: string): string {
  const parts = key.split('.');
  // drop the first segment (module name) if there are at least 2
  const rest = parts.length >= 2 ? parts.slice(1) : parts;
  return rest.join(' ').replace(/_/g, ' ').replace(/^\w/, c => c.toUpperCase());
}

export async function getRecordTimeline(actor: TimelineActor, args: TimelineArgs): Promise<TimelineItem[]> {
  const perm = recordViewPermission(args.module, args.recordType);
  if (!perm || !(await userCan(actor, perm))) {
    throw Object.assign(new Error('You do not have permission to view this record.'), { status: 403 });
  }

  const { recordType, recordId } = args;
  const includeWorkflows = args.includeWorkflows !== false;
  const includeHandoffs  = args.includeHandoffs  !== false;
  const includeMessages  = args.includeMessages  !== false;
  const includeTickets   = args.includeTickets   !== false;

  const items: TimelineItem[] = [];

  // app_events — always included.
  const { data: events } = await sb.from('app_events')
    .select('id, event_type, actor_user_id, severity, payload, created_at')
    .eq('source_entity_type', recordType).eq('source_entity_id', recordId)
    .order('created_at', { ascending: false }).limit(200);
  for (const e of (events ?? []) as Array<{ id: string; event_type: string; actor_user_id: string | null; severity: string; payload: Record<string, unknown>; created_at: string }>) {
    items.push({ id: e.id, item_type: 'event', title: humanizeEventType(e.event_type), actor_id: e.actor_user_id, severity: e.severity, created_at: e.created_at, metadata: { ...e.payload, _event_type: e.event_type } });
  }

  // audit_logs — opt-in (sensitive); keyed on table_name = record type.
  if (args.includeAudit) {
    const { data: audit } = await sb.from('audit_logs')
      .select('id, action, user_id, changes, created_at')
      .eq('table_name', recordType).eq('record_id', recordId)
      .order('created_at', { ascending: false }).limit(200);
    for (const a of (audit ?? []) as Array<{ id: string; action: string; user_id: string | null; changes: Record<string, unknown>; created_at: string }>) {
      items.push({ id: a.id, item_type: 'audit', title: humanizeEventType(a.action), actor_id: a.user_id, created_at: a.created_at, metadata: a.changes });
    }
  }

  if (includeHandoffs) {
    const { data: handoffs } = await sb.from('handoff_outbox')
      .select('id, target_module, status, error, payload, created_by, created_at')
      .eq('source_entity_type', recordType).eq('source_entity_id', recordId)
      .order('created_at', { ascending: false }).limit(100);
    for (const h of (handoffs ?? []) as Array<{ id: string; target_module: string; status: string; error: string | null; payload: Record<string, unknown>; created_by: string | null; created_at: string }>) {
      items.push({ id: h.id, item_type: 'handoff', title: `Handoff → ${h.target_module}`, description: h.error ?? h.status, actor_id: h.created_by, severity: h.status === 'failed' ? 'critical' : 'info', created_at: h.created_at, metadata: h.payload });
    }
  }

  if (includeWorkflows) {
    const { data: wfs } = await sb.from('workflow_instances')
      .select('id, workflow_no, workflow_type, status, requested_by, created_at')
      .eq('source_record_id', recordId)
      .order('created_at', { ascending: false }).limit(100);
    for (const w of (wfs ?? []) as Array<{ id: string; workflow_no: string | null; workflow_type: string; status: string; requested_by: string | null; created_at: string }>) {
      items.push({ id: w.id, item_type: 'workflow', title: w.workflow_type, description: w.status, actor_id: w.requested_by, severity: w.status === 'rejected' ? 'warning' : 'info', created_at: w.created_at, metadata: { workflow_no: w.workflow_no, status: w.status } });
    }
  }

  if (includeMessages) {
    const { data: threads } = await sb.from('message_threads')
      .select('id, subject, created_by, created_at')
      .eq('source_entity_type', recordType).eq('source_entity_id', recordId)
      .order('created_at', { ascending: false }).limit(100);
    for (const t of (threads ?? []) as Array<{ id: string; subject: string; created_by: string | null; created_at: string }>) {
      items.push({ id: t.id, item_type: 'message', title: t.subject, actor_id: t.created_by, created_at: t.created_at });
    }
  }

  if (includeTickets) {
    const { data: tickets } = await sb.from('tickets')
      .select('id, ticket_number, subject, status, requester_user_id, created_at')
      .eq('source_entity_type', recordType).eq('source_entity_id', recordId)
      .order('created_at', { ascending: false }).limit(100);
    for (const t of (tickets ?? []) as Array<{ id: string; ticket_number: string; subject: string; status: string; requester_user_id: string | null; created_at: string }>) {
      items.push({ id: t.id, item_type: 'ticket', title: t.subject, description: t.status, actor_id: t.requester_user_id, created_at: t.created_at, metadata: { ticket_number: t.ticket_number } });
    }
  }

  // Enrich actor_id → display name (one lookup) so the UI shows people, not ids.
  const actorIds = [...new Set(items.map(i => i.actor_id).filter((x): x is string => !!x))];
  if (actorIds.length) {
    const { data: users } = await sb.from('app_users')
      .select('id, full_name, username').in('id', actorIds);
    const nameById = new Map((users ?? []).map((u: { id: string; full_name: string | null; username: string | null }) => [u.id, u.full_name || u.username || u.id]));
    for (const it of items) if (it.actor_id) it.actor_name = nameById.get(it.actor_id) ?? undefined;
  }

  return items.sort(byNewestFirst);
}
