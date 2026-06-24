/**
 * src/ui/components/DetailGrid.tsx
 *
 * The standard "Overview" field grid for detail drawers — one shared instance so
 * every drawer's Overview reads identically. Modelled on the Incidents drawer
 * (`.hse-idrawer-grid` of `.hse-idrawer-cell`: icon · label · value).
 *
 * Pass an array of fields; falsy `value` items can be filtered by the caller, or
 * pass `hideEmpty` to drop items whose value is null/undefined/''.
 *
 * Usage:
 *   <DetailGrid items={[
 *     { icon: 'fa-circle-dot', label: 'Status', value: <StatusPill … /> },
 *     { icon: 'fa-calendar-day', label: 'Created', value: '12 Jun 2026' },
 *   ]} />
 */

import { type VNode, type ComponentChildren } from 'preact';

export interface DetailItem {
  /** Font Awesome class, e.g. 'fa-circle-dot'. Optional. */
  icon?:  string;
  label:  string;
  value:  ComponentChildren;
}

export interface DetailGridProps {
  items: DetailItem[];
  /** Drop items whose value is null / undefined / '' (default false). */
  hideEmpty?: boolean;
  /** Extra class on the grid wrapper (e.g. a per-page meta grid tweak). */
  class?: string;
}

export function DetailGrid({ items, hideEmpty = false, class: className }: DetailGridProps): VNode {
  const shown = hideEmpty
    ? items.filter(it => it.value !== null && it.value !== undefined && it.value !== '')
    : items;
  return (
    <div class={`hse-idrawer-grid${className ? ' ' + className : ''}`}>
      {shown.map(it => (
        <div class="hse-idrawer-cell" key={it.label}>
          {it.icon && <i class={`fas ${it.icon}`} aria-hidden="true" />}
          <span>{it.label}</span>
          <strong>{it.value}</strong>
        </div>
      ))}
    </div>
  );
}
