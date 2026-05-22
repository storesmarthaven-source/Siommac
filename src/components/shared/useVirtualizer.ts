/**
 * src/components/shared/useVirtualizer.ts
 *
 * Thin Preact wrapper around @tanstack/virtual-core's Virtualizer.
 *
 * Usage:
 *   const { virtualItems, totalSize, scrollRef } = useVirtualizer({
 *     count:        items.length,
 *     estimateSize: () => 56,   // estimated row height in px
 *     overscan:     5,
 *   });
 *
 *   return (
 *     <div ref={scrollRef} style={{ height: 400, overflow: 'auto' }}>
 *       <div style={{ height: totalSize, position: 'relative' }}>
 *         {virtualItems.map(vi => (
 *           <div key={vi.key} style={{ position: 'absolute', top: vi.start, width: '100%', height: vi.size }}>
 *             {items[vi.index]}
 *           </div>
 *         ))}
 *       </div>
 *     </div>
 *   );
 *
 * Phase 2g — Performance pass.
 *
 * @see docs/PHASE_PLAN.md §Phase-2g
 * @see https://tanstack.com/virtual/latest
 */

import { useRef, useState, useEffect, useCallback } from 'preact/hooks';
import type { RefObject }     from 'preact';
import {
  Virtualizer,
  elementScroll,
  observeElementOffset,
  observeElementRect,
} from '@tanstack/virtual-core';
import type { VirtualItem }  from '@tanstack/virtual-core';

export type { VirtualItem };

export interface UseVirtualizerOptions {
  /** Total number of items to virtualise */
  count:        number;
  /** Estimated row/item height in px. Use actual known height for best performance. */
  estimateSize: (index: number) => number;
  /** Number of items to render outside the visible area (default: 5) */
  overscan?:    number;
  /** Horizontal virtualisation (default: false = vertical) */
  horizontal?:  boolean;
}

export interface UseVirtualizerReturn {
  /** The items currently in the render window */
  virtualItems: VirtualItem[];
  /** Total height (or width) of all items — use as the inner container size */
  totalSize:    number;
  /** Attach to the scrollable container element */
  scrollRef:    RefObject<HTMLDivElement>;
  /** Scroll to a specific item index */
  scrollToIndex: (index: number, opts?: { align?: 'start' | 'center' | 'end' | 'auto' }) => void;
}

export function useVirtualizer({
  count,
  estimateSize,
  overscan  = 5,
  horizontal = false,
}: UseVirtualizerOptions): UseVirtualizerReturn {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [, rerender] = useState(0);

  const virtualizer = useRef<Virtualizer<HTMLDivElement, Element>>();

  // Create virtualizer once (or recreate if horizontal changes)
  if (!virtualizer.current) {
    virtualizer.current = new Virtualizer<HTMLDivElement, Element>({
      count,
      estimateSize,
      overscan,
      horizontal,
      getScrollElement: () => scrollRef.current,
      observeElementOffset,
      observeElementRect,
      scrollToFn:       elementScroll,
      onChange:         () => rerender(n => n + 1),
    });
  }

  // Update options that can change between renders
  useEffect(() => {
    virtualizer.current!._didMount();
    // cleanup() is typed private but is the correct teardown — cast needed
    return () => (virtualizer.current as unknown as { cleanup: () => void }).cleanup();
  }, []);

  // Keep count and estimateSize in sync
  virtualizer.current.setOptions({
    count,
    estimateSize,
    overscan,
    horizontal,
    getScrollElement: () => scrollRef.current,
    observeElementOffset,
    observeElementRect,
    scrollToFn:       elementScroll,
    onChange:         () => rerender(n => n + 1),
  });

  const scrollToIndex = useCallback(
    (index: number, opts?: { align?: 'start' | 'center' | 'end' | 'auto' }) =>
      virtualizer.current?.scrollToIndex(index, opts),
    [],
  );

  const items = virtualizer.current.getVirtualItems();
  const total = virtualizer.current.getTotalSize();

  return {
    virtualItems: items,
    totalSize:    total,
    scrollRef,
    scrollToIndex,
  };
}
