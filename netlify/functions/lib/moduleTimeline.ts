/**
 * netlify/functions/lib/moduleTimeline.ts
 *
 * Shared timeline query for any module entity.
 * Every drawer's Timeline tab calls this rather than re-implementing the query.
 * Sources: app_events (now); can be extended to merge workflow events, audit
 * logs, and handoff outbox in a later pass once the pattern is proven stable.
 */

import { sb } from './db';

export interface TimelineEntry {
  id:          string;
  source:      'app_event';
  type:        string;
  actorUserId: string | null;
  severity:    string;
  title:       string;
  body:        Record<string, unknown>;
  createdAt:   string;
}

export async function getModuleTimeline(input: {
  module:     string;
  entityType: string;
  entityId:   string;
  limit?:     number;
}): Promise<TimelineEntry[]> {
  const { data, error } = await sb
    .from('app_events')
    .select('id, event_type, actor_user_id, severity, payload, created_at')
    .eq('source_module', input.module)
    .eq('source_entity_type', input.entityType)
    .eq('source_entity_id', input.entityId)
    .order('created_at', { ascending: false })
    .limit(input.limit ?? 100) as { data: Array<{
      id: string;
      event_type: string;
      actor_user_id: string | null;
      severity: string;
      payload: Record<string, unknown>;
      created_at: string;
    }> | null; error: unknown };

  if (error) throw error;

  return (data ?? []).map(e => ({
    id:          e.id,
    source:      'app_event' as const,
    type:        e.event_type,
    actorUserId: e.actor_user_id,
    severity:    e.severity,
    title:       e.event_type,
    body:        e.payload ?? {},
    createdAt:   e.created_at,
  }));
}
