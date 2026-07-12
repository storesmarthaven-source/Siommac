/**
 * src/ui/components/Tabs.tsx
 *
 * A generic horizontal tab bar. Data-driven: pass the tab keys + labels and the
 * active key; it renders the buttons and calls onChange. Wraps the existing
 * `.inv-tab-bar` / `.inv-tab` classes (the in-drawer tab style) by default;
 * pass `barClass`/`tabClass` to target another existing tab style.
 *
 * Optional per-tab count badges via `counts` (key → number).
 */

import { type VNode } from 'preact';

export interface TabDef<K extends string = string> {
  key: K;
  label: string;
}

interface TabsProps<K extends string> {
  tabs: readonly TabDef<K>[];
  active: K;
  onChange: (key: K) => void;
  counts?: Partial<Record<K, number>>;
  barClass?: string;
  tabClass?: string;
}

export function Tabs<K extends string>({
  tabs,
  active,
  onChange,
  counts,
  barClass = 'inv-tab-bar',
  tabClass = 'inv-tab-btn',
}: TabsProps<K>): VNode {
  return (
    <div class={barClass}>
      {tabs.map(t => {
        const n = counts?.[t.key];
        return (
          <button
            key={t.key}
            class={`${tabClass}${active === t.key ? ' active' : ''}`}
            onClick={() => onChange(t.key)}
          >
            {t.label}
            {typeof n === 'number' && n > 0 && <span class="hse-tab-count">{n}</span>}
          </button>
        );
      })}
    </div>
  );
}
