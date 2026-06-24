/**
 * src/ui/components/SidePanel.tsx
 *
 * The standard right-side rail — the existing `ppe-signals-panel` navy body with
 * the `owq-panel-header` header on top. The header has two rows:
 *   1. title row  — icon + title + total count badge
 *   2. tab strip  — "All" + one tab per section, each with its own count
 *
 * The tabs FILTER the body: "All" shows every section stacked (with dividers);
 * a specific tab shows only that section. Sections are passed as data so the
 * panel can render the headings and do the filtering itself.
 *
 *   <SidePanel title="Signals" icon="fa-bell" sections={[
 *     { id: 'awaiting', label: 'Awaiting', icon: 'fa-clipboard-check',
 *       title: 'Awaiting Approval', count: 3, empty: 'Queue is clear',
 *       children: rows.map(r => <Signal … />) },
 *     …
 *   ]} />
 */

import { type VNode, type ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';

export interface SidePanelSection {
  /** Stable id used as the tab key / active value. */
  id: string;
  /** Short label shown on the tab. */
  label: string;
  /** Font Awesome class for the section heading icon. */
  icon: string;
  /** Section heading text (can be more descriptive than `label`). */
  title: string;
  /** Row count — drives the tab badge and the empty state. */
  count: number;
  /** Message shown when `count` is 0. */
  empty: string;
  /** The signal rows for this section. */
  children: ComponentChildren;
}

export interface SidePanelProps {
  title: string;
  /** Font Awesome class for the header icon. */
  icon?: string;
  /** Extra class on the panel (e.g. a width override). */
  class?: string;
  sections: SidePanelSection[];
}

export function SidePanel({ title, icon, class: cls, sections }: SidePanelProps): VNode {
  const [active, setActive] = useState<string>(sections[0]?.id ?? '');
  const total = sections.reduce((n, s) => n + s.count, 0);
  const current = sections.find(s => s.id === active) ?? sections[0];

  return (
    <aside class={`ppe-signals-panel${cls ? ' ' + cls : ''}`}>
      <div class="owq-panel-header">
        <div class="owq-panel-title">
          {icon && <i class={`fas ${icon}`} aria-hidden="true" />}
          <span>{title}</span>
          <span class="owq-panel-count">{total}</span>
        </div>
        <div class="owq-panel-tabs" role="tablist">
          {sections.map(s => (
            <button key={s.id} type="button" role="tab" aria-selected={s.id === current?.id}
              class={`owq-tab${s.id === current?.id ? ' active' : ''}`} onClick={() => setActive(s.id)}>
              <i class={`fas ${s.icon}`} aria-hidden="true" />
              <span>{s.label}</span>
              <span class="owq-tab-count">{s.count}</span>
            </button>
          ))}
        </div>
      </div>

      {current && (
        <div class="ppe-signals-list">
          {current.count > 0 ? current.children : <div class="ppe-signal-empty">{current.empty}</div>}
        </div>
      )}
    </aside>
  );
}
