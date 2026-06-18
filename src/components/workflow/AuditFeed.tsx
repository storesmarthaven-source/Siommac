/**
 * src/components/workflow/AuditFeed.tsx
 *
 * Immutable audit event list. The engine only appends events; this renders them
 * newest-first. Reused anywhere a compliance trail is shown.
 */

import { type VNode } from 'preact';
import { useWorkflow } from '@lib/workflow';

export function AuditFeed({ limit }: { limit?: number }): VNode {
  const { state } = useWorkflow();
  const events = limit ? state.audit.slice(0, limit) : state.audit;

  return (
    <div class="wf-audit">
      {events.length === 0 ? (
        <div class="wf-empty"><i class="fas fa-shield-halved" /><div><strong>No audit events yet</strong><p>Every workflow decision is logged here.</p></div></div>
      ) : events.map(e => (
        <article class="wf-audit-row" key={e.id}>
          <i class="fas fa-shield-halved" />
          <div class="wf-audit-text">
            <strong>{e.event}</strong>
            <span>{e.module.toUpperCase()} · {e.impact}</span>
          </div>
          <span class="wf-audit-meta">{new Date(e.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · {e.actor}</span>
        </article>
      ))}
    </div>
  );
}
