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

import { type VNode, type ComponentChildren, toChildArray } from 'preact';
import { useRef, useLayoutEffect } from 'preact/hooks';
import { useCardReorder, type CardReorder, ArrangeControls } from './reorder';

export interface MetricCardItem { key: string; node: VNode; }

export interface MetricRowProps {
  /** Enables rearrange + per-user/org persistence, keyed by this page id (e.g. 'hse.risk'). */
  pageKey?: string;
  cards: MetricCardItem[];
  /** Grid class for the row. Defaults to the 4-up spark grid. */
  rowClass?: string;
}

/**
 * FLIP animation: animate cards smoothly from their previous to their new slot
 * whenever the order changes, so neighbours visibly glide out of the way. The
 * card being dragged is skipped (the pointer already drives it).
 */
function useFlip(dragKey: string | null) {
  const rects = useRef<Map<string, DOMRect>>(new Map());
  const nodes = useRef<Map<string, HTMLElement>>(new Map());
  const setNode = (key: string) => (el: HTMLElement | null) => {
    if (el) nodes.current.set(key, el); else nodes.current.delete(key);
  };
  useLayoutEffect(() => {
    nodes.current.forEach((el, key) => {
      const last = el.getBoundingClientRect();
      const first = rects.current.get(key);
      if (first && key !== dragKey) {
        const dx = first.left - last.left;
        const dy = first.top - last.top;
        if (dx || dy) {
          el.style.transition = 'none';
          el.style.transform = `translate(${dx}px, ${dy}px)`;
          requestAnimationFrame(() => {
            el.style.transition = 'transform .24s cubic-bezier(.2,.8,.2,1)';
            el.style.transform = '';
          });
        }
      }
      rects.current.set(key, last);
    });
  });
  return setNode;
}

export function MetricRow({ pageKey, cards, rowClass = 'hse-spark-grid' }: MetricRowProps): VNode {
  const r: CardReorder = useCardReorder(pageKey, cards.map(c => c.key));
  const byKey = new Map(cards.map(c => [c.key, c]));
  const ordered = r.enabled ? r.order.map(k => byKey.get(k)).filter((c): c is MetricCardItem => !!c) : cards;
  const setNode = useFlip(r.dragKey);

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
            ref={r.arranging ? setNode(c.key) : undefined}
            class={r.arranging ? r.dragClass(c.key) : undefined}
            {...(r.arranging ? r.dragHandlers(c.key) : {})}
          >
            {c.node}
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Drop-in reorderable row — makes ANY existing card row (e.g. a `hse-spark-row`)
 * rearrangeable without restructuring its cards into `{ key, node }`. Just wrap
 * the cards and pass a stable `pageKey`:
 *
 *   <ReorderableRow pageKey="hse.permits.ptw">
 *     <div class="hse-spark">…</div>   // 4 cards as-is
 *   </ReorderableRow>
 *
 * Card identity is positional (the card set is fixed per row), so order persists
 * correctly per-user/org via the same backbone as MetricRow / PageHero.
 */
export function ReorderableRow({ pageKey, rowClass = 'hse-spark-row', children }: {
  pageKey?: string;
  rowClass?: string;
  children: ComponentChildren;
}): VNode {
  const items = toChildArray(children);
  const keys  = items.map((_, i) => `c${i}`);
  const r: CardReorder = useCardReorder(pageKey, keys);
  const setNode = useFlip(r.dragKey);
  const byKey = new Map(items.map((node, i) => [`c${i}`, node]));
  const renderKeys = r.enabled ? r.order : keys;

  return (
    <div>
      {r.enabled && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 'var(--space-2)' }}>
          <ArrangeControls reorder={r} variant="light" />
        </div>
      )}
      <div class={rowClass}>
        {renderKeys.map(key => {
          const node = byKey.get(key);
          if (node == null) return null;
          return (
            <div
              key={key}
              ref={r.arranging ? setNode(key) : undefined}
              class={r.arranging ? r.dragClass(key) : undefined}
              {...(r.arranging ? r.dragHandlers(key) : {})}
            >
              {node}
            </div>
          );
        })}
      </div>
    </div>
  );
}
