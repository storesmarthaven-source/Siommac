/**
 * src/ui/layouts/RegisterLayout.tsx
 *
 * The standard register-page shape, full-width:
 *
 *   ┌ topCards (optional 4-up MetricCard strip) ┐
 *   ├ card: SectionHead + Toolbar + table         ┤
 *   └ (row drawer / modals rendered by the page)  ┘
 *
 * This is the structure Incidents / Investigations / CAPA share. It does NOT
 * own the drawer or modals — those stay with the page (they're page-specific
 * and positioned fixed). Layout only arranges the visible register surface.
 */

import { type VNode, type ComponentChildren } from 'preact';

interface RegisterLayoutProps {
  /** Optional summary card strip above the table (use .capa-strip-four-cards or similar). */
  topCards?: ComponentChildren;
  /** The section header (title + actions). */
  head: ComponentChildren;
  /** The filter toolbar. */
  toolbar?: ComponentChildren;
  /** The table (RegisterTable + rows). */
  table: ComponentChildren;
  /** Anything rendered after the card (drawers, modals) — pass-through. */
  children?: ComponentChildren;
}

export function RegisterLayout({ topCards, head, toolbar, table, children }: RegisterLayoutProps): VNode {
  return (
    <div>
      {topCards}
      <div class="hse-table-card">
        <div class="hse-table-card-top">
          {head}
          {toolbar}
        </div>
        {table}
      </div>
      {children}
    </div>
  );
}
