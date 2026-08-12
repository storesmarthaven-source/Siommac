/**
 * src/components/workflow/AuditFeed.tsx
 *
 * Workflow audit feed — recent workflow instances in reverse-chronological order.
 * Each row shows the workflow ref, status, source module and creation time.
 */

import { type VNode } from 'preact';
import { useWorkflowList } from '@api/workflows';
import { statusBadgeTone, statusLabel } from '@lib/workflow';
import type { WorkflowStatus } from '@lib/workflow/types';
import { Badge, EmptyState, Spinner } from '@ui';

export function AuditFeed({ limit }: { limit?: number }): VNode {
  const listQ   = useWorkflowList({ limit: limit ?? 50 });
  const workflows = listQ.data ?? [];
  const rows    = limit ? workflows.slice(0, limit) : workflows;

  if (listQ.isLoading) {
    return <div class="wf-audit"><Spinner label="Loading audit log…" center /></div>;
  }

  return (
    <div class="wf-audit">
      {rows.length === 0 ? (
        <EmptyState size="compact" icon="fa-shield-halved" title="No audit events yet" text="Every workflow decision is logged here." />
      ) : rows.map(w => (
        <article class="wf-audit-row" key={w.id}>
          <i class="fas fa-shield-halved" />
          <div class="wf-audit-text">
            <strong>{w.ref} · {w.template_id.replace(/_/g, ' ')}</strong>
            <span>{w.source_module.toUpperCase()} · {w.source_entity_id}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
            <Badge tone={statusBadgeTone(w.status as WorkflowStatus)}>{statusLabel(w.status as WorkflowStatus)}</Badge>
            <span class="wf-audit-meta">{new Date(w.created_at).toLocaleDateString('en-GB')}</span>
          </div>
        </article>
      ))}
    </div>
  );
}
