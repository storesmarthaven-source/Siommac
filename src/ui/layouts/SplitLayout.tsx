/**
 * src/ui/layouts/SplitLayout.tsx
 *
 * The main + aside split used inside area tabs (a wide content column on the
 * left, a narrower sidebar of context cards on the right). Wraps the existing
 * `.hse-area-split` / `.hse-area-main` / `.hse-area-aside` classes.
 */

import { type VNode, type ComponentChildren } from 'preact';

export function SplitLayout({ main, aside }: { main: ComponentChildren; aside: ComponentChildren }): VNode {
  return (
    <div class="hse-area-split">
      <div class="hse-area-main">{main}</div>
      <aside class="hse-area-aside">{aside}</aside>
    </div>
  );
}
