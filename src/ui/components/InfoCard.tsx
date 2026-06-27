/**
 * src/ui/components/InfoCard.tsx
 *
 * Content primitives for the rich detail panel (SidePanel/Drawer) and dialogs —
 * the building blocks every entity drawer composes from, styled ONCE from Siomac
 * tokens (`.ui-info-card` / `.ui-field-*` / `.ui-mini-table` / `.ui-pill` in
 * assets/styles/uikit-overlay.css):
 *
 *   InfoCard   — a titled card, optional head action (e.g. an "Edit" button)
 *   FieldList  — vertical list of label/value rows
 *   FieldRow   — one label/value row
 *   MiniTable  — compact table; renders an empty state when there are no rows
 *   Pill       — tonal status chip (the panel/dialog counterpart of StatusPill)
 *   PanelEmpty — the standard empty / loading / gated message
 */

import { type VNode, type ComponentChildren } from 'preact';
import { TableSkeleton, SkeletonFields } from './Skeleton';

/** The six tonal families used by panel/dialog pills. */
export type PillTone = 'green' | 'amber' | 'red' | 'purple' | 'blue' | 'gray';

export function InfoCard(
  { title, action, children }:
  { title: string; action?: ComponentChildren; children: ComponentChildren },
): VNode {
  return (
    <section class="ui-info-card">
      <div class="ui-info-card-head"><h4>{title}</h4>{action}</div>
      {children}
    </section>
  );
}

export function FieldList({ children, loading = false, skeletonRows = 4 }: { children: ComponentChildren; loading?: boolean; skeletonRows?: number }): VNode {
  return <div class="ui-field-list" aria-busy={loading ? 'true' : undefined}>{loading ? <SkeletonFields rows={skeletonRows} /> : children}</div>;
}

export function FieldRow({ icon, label, value }: { icon?: string; label: string; value: ComponentChildren }): VNode {
  return (
    <div class="ui-field-row">
      <div class="ui-field-row-label">
        {icon && <i class={`fas ${icon} ui-field-row-ico`} aria-hidden="true" />}
        {label}
      </div>
      <div class="ui-field-row-value">{value}</div>
    </div>
  );
}

export function MiniTable(
  { cols, empty, children, loading }:
  { cols: string[]; empty: ComponentChildren; children: VNode[]; loading?: boolean },
): VNode {
  if (loading) {
    return (
      <table class="ui-mini-table">
        <thead><tr>{cols.map(c => <th key={c}>{c}</th>)}</tr></thead>
        <tbody><TableSkeleton rows={4} cols={cols.length} /></tbody>
      </table>
    );
  }
  return children.length
    ? (
      <table class="ui-mini-table">
        <thead><tr>{cols.map(c => <th key={c}>{c}</th>)}</tr></thead>
        <tbody>{children}</tbody>
      </table>
    )
    : typeof empty === 'string' ? <div class="ui-panel-empty">{empty}</div> : <>{empty}</>;
}

export function Pill({ tone, children }: { tone: PillTone; children: ComponentChildren }): VNode {
  return <span class={`ui-pill ${tone}`}>{children}</span>;
}

export function PanelEmpty({ children }: { children: ComponentChildren }): VNode {
  return <div class="ui-panel-empty">{children}</div>;
}

export interface ActivityEntry { icon: ComponentChildren; title: string; desc?: string; time: string; }

/** A recent-activity feed: glyph + title/desc + right-aligned time per row. */
export function ActivityList({ items }: { items: ActivityEntry[] }): VNode {
  return (
    <div class="ui-activity-list">
      {items.map((a, i) => (
        <div class="ui-activity-item" key={i}>
          <div class="ui-activity-icon">{a.icon}</div>
          <div>
            <div class="ui-activity-title">{a.title}</div>
            {a.desc && <div class="ui-activity-desc">{a.desc}</div>}
          </div>
          <div class="ui-activity-time">{a.time}</div>
        </div>
      ))}
    </div>
  );
}

/**
 * Callout — a marked banner (icon/glyph + title + status + supporting text).
 * `alert` swaps the success palette for the danger palette. Used for risk /
 * readiness summaries inside a panel.
 */
export function Callout(
  { mark, title, status, children, alert }:
  { mark: ComponentChildren; title: string; status: string; children?: ComponentChildren; alert?: boolean },
): VNode {
  return (
    <div class={`ui-callout${alert ? ' is-alert' : ''}`}>
      <div class="ui-callout-mark">{mark}</div>
      <div class="ui-callout-body">
        <strong>{title}</strong>
        <span>{status}</span>
        {children && <p>{children}</p>}
      </div>
    </div>
  );
}
