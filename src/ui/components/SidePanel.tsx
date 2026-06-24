/**
 * src/ui/components/SidePanel.tsx
 *
 * The standard right-side rail — the existing `ppe-signals-panel` body (signal
 * sections/rows) with the `owq-panel-header` header on top (title + icon +
 * count badge). Body is supplied as children (keep the ppe-signal markup).
 *
 *   <SidePanel title="Signals" icon="fa-bell" count={8}>
 *     <Section …><Signal … /></Section>
 *   </SidePanel>
 */

import { type VNode, type ComponentChildren } from 'preact';

export interface SidePanelProps {
  title: string;
  /** Font Awesome class for the header icon. */
  icon?: string;
  /** Header count badge. */
  count?: number;
  /** Extra class on the panel (e.g. a width override). */
  class?: string;
  children: ComponentChildren;
}

export function SidePanel({ title, icon, count, class: cls, children }: SidePanelProps): VNode {
  return (
    <aside class={`ppe-signals-panel${cls ? ' ' + cls : ''}`}>
      <div class="owq-panel-header">
        <div class="owq-panel-title">
          {icon && <i class={`fas ${icon}`} aria-hidden="true" />}
          <span>{title}</span>
          {count !== undefined && <span class="owq-panel-count">{count}</span>}
        </div>
      </div>
      {children}
    </aside>
  );
}
