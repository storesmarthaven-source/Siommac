/**
 * src/ui/widgets/BoardSkeleton.tsx
 *
 * The cold state for a widget board — driven by the SAVED LAYOUT, not by a count.
 *
 * A page used to declare `kpiCount={6} widgetCount={3}` and hope those numbers still
 * described the user's board. They never did for long: the board is user-arranged, so
 * every add, remove, resize or drag made the skeleton describe a different page from
 * the one that faded in. This component takes the same `BoardLayout` the board itself
 * renders (both read `useBoardLayout(pageKey)`, i.e. one TanStack cache entry — one
 * layout source, never a second copy) and emits exactly one `WidgetSkeleton` per saved
 * instance, at that instance's real `x/y/w/h`, in that widget's registered density.
 *
 * Geometry is an exact CSS-grid restatement of react-grid-layout's model, so the
 * placeholder occupies the same box the tile will: with `containerPadding: [0,0]`,
 * RGL puts a `w`-wide tile at `w * colWidth + (w-1) * marginX` where
 * `colWidth = (containerWidth - (cols-1) * marginX) / cols` — which is precisely a
 * `repeat(cols, 1fr)` grid with `column-gap: marginX`. Rows follow identically from
 * `grid-auto-rows: cellHeight` + `row-gap: marginY`. No fade or rise: the skeleton is
 * replaced in place by the loaded board (`revealOnMount={false}`), so there is no
 * entrance flash and nothing animates twice.
 */

import { type VNode } from 'preact';
import { WidgetSkeleton } from '../components/Skeleton';
import type { BoardLayout, LocalWidgetMap } from './types';
import { widgetSkeletonVariant } from './skeletonVariant';

export interface BoardSkeletonProps {
  /** The saved layout being loaded — the same value the board renders from. */
  layout: BoardLayout;
  /** Zone to mirror. Defaults to the single-zone board convention. */
  zoneId?: string;
  /** Grid geometry — must match the `WidgetBoard` props for this board. */
  columns: number;
  cellHeight: number;
  /** `[horizontal, vertical]` — the board's `gap` prop. */
  gap: readonly [number, number];
  /** Page-local widgets (no registry entry), so their density resolves too. */
  localWidgets?: LocalWidgetMap;
  class?: string;
}

export function BoardSkeleton({
  layout, zoneId = 'main', columns, cellHeight, gap, localWidgets, class: cls,
}: BoardSkeletonProps): VNode {
  const items = layout.zones[zoneId] ?? [];
  return (
    <div
      class={`wbi-skeleton-zone${cls ? ` ${cls}` : ''}`}
      data-zone-id={zoneId}
      data-skeleton-count={items.length}
      aria-hidden="true"
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
        gridAutoRows: `${cellHeight}px`,
        columnGap: `${gap[0]}px`,
        rowGap: `${gap[1]}px`,
      }}
    >
      {items.map(item => (
        <div
          key={item.instanceId}
          class="wbi-skeleton-item"
          data-widget-instance-id={item.instanceId}
          data-widget-id={item.widgetId}
          style={{
            gridColumn: `${item.x + 1} / span ${item.w}`,
            gridRow: `${item.y + 1} / span ${item.h}`,
            minWidth: 0,
            minHeight: 0,
          }}
        >
          <WidgetSkeleton variant={widgetSkeletonVariant(item.widgetId, localWidgets)} />
        </div>
      ))}
    </div>
  );
}
