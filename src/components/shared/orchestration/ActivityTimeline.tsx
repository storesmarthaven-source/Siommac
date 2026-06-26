/**
 * src/components/shared/orchestration/ActivityTimeline.tsx
 *
 * Reusable cross-module record timeline. Give it a record ({module, recordType,
 * recordId}) and it renders that record's unified feed (events + audit + handoffs
 * + workflows + messages + tickets), newest-first, from /api/orchestration/timeline.
 * Severity drives the dot colour; the icon encodes the item kind. Drops into any
 * record drawer/page (HR onboarding, employee master, HSE incident, …).
 */

import { type VNode } from 'preact';
import { useRecordTimeline, type TimelineItem } from '@api/orchestration';
import { relativeTime } from '@sections/NotificationCenter/notifMeta';

const ICON: Record<TimelineItem['item_type'], string> = {
  event:    'fa-bolt',
  audit:    'fa-clipboard-check',
  handoff:  'fa-right-left',
  workflow: 'fa-code-branch',
  message:  'fa-comment',
  ticket:   'fa-ticket',
};

export function ActivityTimeline(
  { module, recordType, recordId }: { module: string; recordType: string; recordId: string },
): VNode {
  const q = useRecordTimeline({ module, recordType, recordId, includeAudit: true });

  if (q.isLoading) return <div class="orch-tl-state">Loading activity…</div>;
  if (q.isError) {
    return (
      <div class="orch-tl-empty">
        <strong>Couldn't load activity</strong>
        <span>{q.error instanceof Error ? q.error.message : 'Please try again.'}</span>
      </div>
    );
  }

  const items = q.data ?? [];
  if (!items.length) {
    return (
      <div class="orch-tl-empty">
        <strong>No activity yet</strong>
        <span>Events, handoffs, approvals, messages and tickets for this record appear here.</span>
      </div>
    );
  }

  return (
    <div class="orch-tl">
      <div class="orch-tl-line" aria-hidden="true" />
      {items.map(it => (
        <div key={it.id} class={`orch-tl-item sev-${it.severity ?? 'info'}`}>
          <span class="orch-tl-badge"><i class={`fas ${ICON[it.item_type] ?? 'fa-circle'}`} aria-hidden="true" /></span>
          <div class="orch-tl-body">
            <div class="orch-tl-row">
              <span class="orch-tl-title">{it.title}</span>
              <time class="orch-tl-time">{relativeTime(it.created_at)}</time>
            </div>
            {it.description && <div class="orch-tl-desc">{it.description}</div>}
            <div class="orch-tl-meta">{it.item_type}{it.actor_name ? ` · ${it.actor_name}` : ''}</div>
          </div>
        </div>
      ))}
    </div>
  );
}
