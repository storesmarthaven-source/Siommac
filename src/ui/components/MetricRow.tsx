/**
 * src/ui/components/MetricRow.tsx
 *
 * The standard four-card metric row at the top of a SUB-MODULE page. Same
 * rearrange behaviour as the dashboard hero (drag to reorder, persisted via the
 * ui_layout backbone) — pass a stable `pageKey` to enable it.
 *
 * Cards are supplied as `{ key, node }` so any card component (SparkCard, a
 * MetricCard, a bespoke tile) can sit in the row and still be reorderable.
 */

import { type VNode } from 'preact';
import { useCardReorder, ArrangeControls } from './reorder';

export interface MetricCardItem { key: string; node: VNode; }

export interface MetricRowProps {
  /** Enables rearrange + per-user/org persistence, keyed by this page id (e.g. 'hse.risk'). */
  pageKey?: string;
  cards: MetricCardItem[];
  /** Grid class for the row. Defaults to the 4-up spark grid. */
  rowClass?: string;
}

export function MetricRow({ pageKey, cards, rowClass = 'hse-spark-grid' }: MetricRowProps): VNode {
  const r = useCardReorder(pageKey, cards.map(c => c.key));
  const byKey = new Map(cards.map(c => [c.key, c]));
  const ordered = r.enabled ? r.order.map(k => byKey.get(k)).filter((c): c is MetricCardItem => !!c) : cards;

  return (
    <div>
      {r.enabled && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 'var(--space-2)' }}>
          <ArrangeControls reorder={r} variant="light" />
        </div>
      )}
      <div class={rowClass}>
        {ordered.map(c => (
          <div
            key={c.key}
            {...r.dragHandlers(c.key)}
            style={r.arranging
              ? { cursor: 'grab', outline: '1px dashed var(--border)', borderRadius: 'var(--radius-md)', opacity: r.dragKey === c.key ? 0.4 : 1 }
              : undefined}
          >
            {c.node}
          </div>
        ))}
      </div>
    </div>
  );
}
