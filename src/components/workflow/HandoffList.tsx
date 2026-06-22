/**
 * src/components/workflow/HandoffList.tsx
 *
 * Cross-module handoff list — shows the handoff outbox records from the backend.
 * Handoffs are emitted by approved workflows and delivered to target modules
 * (HR, Finance, Payroll, etc.).
 */

import { type VNode } from 'preact';
import { useHandoffList } from '@api/workflows';

const TARGET_ICON: Record<string, string> = {
  finance:   'fa-file-invoice-dollar',
  hr:        'fa-users',
  payroll:   'fa-money-check-dollar',
  documents: 'fa-folder-open',
  hse:       'fa-helmet-safety',
  core:      'fa-database',
  admin:     'fa-sliders',
};

const STATUS_TONE: Record<string, { bg: string; color: string; label: string }> = {
  pending:   { bg: 'rgba(245,158,11,.15)',  color: '#fcd34d', label: 'Pending'   },
  delivered: { bg: 'rgba(34,197,94,.15)',   color: '#4ade80', label: 'Delivered' },
  failed:    { bg: 'rgba(239,68,68,.15)',   color: '#fca5a5', label: 'Failed'    },
  retrying:  { bg: 'rgba(96,165,250,.15)',  color: '#93c5fd', label: 'Retrying'  },
};

export function HandoffList({ limit }: { limit?: number }): VNode {
  const handoffsQ = useHandoffList();
  const all       = handoffsQ.data ?? [];
  const rows      = limit ? all.slice(0, limit) : all;

  if (handoffsQ.isLoading) {
    return <div class="wf-handoffs"><div class="wf-empty"><i class="fas fa-spinner fa-spin" /><div><strong>Loading handoffs…</strong></div></div></div>;
  }

  return (
    <div class="wf-handoffs">
      {rows.length === 0 ? (
        <div class="wf-empty"><i class="fas fa-right-left" /><div><strong>No handoffs yet</strong><p>Approved workflows hand off cost and impact to other modules.</p></div></div>
      ) : rows.map(h => {
        const tone = STATUS_TONE[h.status] ?? STATUS_TONE['pending']!;
        return (
          <article class="wf-handoff" key={h.id}>
            <i class={`fas ${TARGET_ICON[h.target_module] ?? 'fa-right-left'}`} />
            <div class="wf-handoff-text">
              <strong>{h.source_module.toUpperCase()} → {h.target_module.toUpperCase()} · {h.source_entity_id}</strong>
              <span>{h.source_entity_type} · {h.attempts} attempt{h.attempts !== 1 ? 's' : ''}</span>
            </div>
            <span style={{ background: tone.bg, color: tone.color, borderRadius: '999px', padding: '2px 10px', fontSize: '0.7rem', fontWeight: 600, flexShrink: 0 }}>{tone.label}</span>
          </article>
        );
      })}
    </div>
  );
}
