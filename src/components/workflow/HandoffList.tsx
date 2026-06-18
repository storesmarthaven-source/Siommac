/**
 * src/components/workflow/HandoffList.tsx
 *
 * Cross-module handoff list — the seam to HR / Payroll / Finance. Handoffs are
 * emitted by approved workflows (or directly) and shown here as the source
 * module's outbound work. Targets receive mock tasks until those modules exist.
 */

import { type VNode } from 'preact';
import { useWorkflow } from '@lib/workflow';
import { statusPill, statusLabel } from '@lib/workflow';

const TARGET_ICON: Record<string, string> = {
  finance: 'fa-file-invoice-dollar', hr: 'fa-users', payroll: 'fa-money-check-dollar',
  documents: 'fa-folder-open', hse: 'fa-helmet-safety', core: 'fa-database', admin: 'fa-sliders',
};

export function HandoffList({ limit }: { limit?: number }): VNode {
  const { state } = useWorkflow();
  const rows = limit ? state.handoffs.slice(0, limit) : state.handoffs;

  return (
    <div class="wf-handoffs">
      {rows.length === 0 ? (
        <div class="wf-empty"><i class="fas fa-right-left" /><div><strong>No handoffs yet</strong><p>Approved workflows hand off cost and impact to other modules.</p></div></div>
      ) : rows.map(h => (
        <article class="wf-handoff" key={h.id}>
          <i class={`fas ${TARGET_ICON[h.target] ?? 'fa-right-left'}`} />
          <div class="wf-handoff-text">
            <strong>{h.source.toUpperCase()} → {h.target.toUpperCase()} · {h.recordRef}</strong>
            <span>{h.summary} · Owner {h.owner} · Due {h.due}</span>
          </div>
          <span class={statusPill(h.status)}>{statusLabel(h.status)}</span>
        </article>
      ))}
    </div>
  );
}
