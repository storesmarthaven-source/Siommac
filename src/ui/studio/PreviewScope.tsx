/**
 * src/ui/studio/PreviewScope.tsx — the one way to open a themed preview surface.
 *
 * A preview surface needs TWO things, and they are easy to get half-right:
 *
 *   1. `data-ui-preview-scope` — the selector every token block also targets, so
 *      declarations resolve against the scope as a second root.
 *   2. `attachScope` — the draft store applies its values to the ONE element it
 *      is handed. An element with the attribute but no attachment matches the
 *      selector and receives none of the values.
 *
 * Phase 4 shipped exactly that bug: the Application Preview carried the
 * attribute, looked correct, and silently ignored the customer's theme. Pairing
 * them in a single component means a surface is either a preview or it is not —
 * there is no half-attached state to forget.
 */

import { type VNode, type ComponentChildren, type CSSProperties } from 'preact';

export function PreviewScope({ attach, children, class: extra, style }: {
  /** `draft.attachScope`. */
  attach: (el: HTMLElement | null) => void;
  children: ComponentChildren;
  class?: string;
  /** Preview-only variables; never written into the draft or published runtime. */
  style?: CSSProperties;
}): VNode {
  return (
    <div data-ui-preview-scope ref={attach} class={extra} style={style}>
      {children}
    </div>
  );
}
