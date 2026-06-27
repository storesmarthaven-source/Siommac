/**
 * src/ui/components/WidgetPicker.tsx
 *
 * "Add widget" dialog for the widget board. Lists the registry grouped by category;
 * each entry adds itself to the board. A widget whose `dataGate()` returns a reason
 * is LOCKED (shown, not addable) — so unbuilt panels read as "coming soon", never
 * fake data. Already-placed widgets show "Added".
 *
 * @see docs/WIDGET_BOARD_SPEC.md
 */

// ─────────────────────────────────────────────────────────────────────────────
// TODO(widget-wizard): Redesign this picker as the rich two-pane "Customize
// Dashboard Widgets" modal — design ref: Downloads/widget_manager_customize_
// dashboard_exact.html. Required upgrades over this flat list:
//   • Top filter bar: search + Category + Data source + status, plus a
//     "Preview mode" toggle (show/hide the per-card mini charts).
//   • Left pane: sections by category (Recommended / Core KPIs / Operational /
//     Compliance / Locked); each card shows a mini-icon, title, description, a
//     "+" add button, and a TINY preview chart (sparkline/bars/donut).
//   • Right pane: detail panel for the focused widget — live preview, available
//     sizes (4×2 / 4×3 / 6×3, derived from min/max/default W·H), data source,
//     refresh frequency, dependencies, and Add / Learn-more actions.
//   • Picking a size sets w/h on add.
// Needs WidgetDef metadata: description, dataSource, refresh, recommended?,
// and a preview VNode (or reuse render() at small scale). Keep it REAL — every
// filter must actually filter (no decorative dropdowns), locked widgets stay
// locked (no fake data). Deferred while building the HR Onboarding module.
// ─────────────────────────────────────────────────────────────────────────────

import { type VNode } from 'preact';
import { Modal } from './Modal';
import type { WidgetDef, WidgetRegistry } from '../widgets/registry';

export interface WidgetPickerProps {
  registry: WidgetRegistry;
  placed: Set<string>;
  onAdd: (id: string) => void;
  onClose: () => void;
}

export function WidgetPicker({ registry, placed, onAdd, onClose }: WidgetPickerProps): VNode {
  const byCat = new Map<string, WidgetDef[]>();
  for (const def of Object.values(registry)) {
    const list = byCat.get(def.category) ?? [];
    list.push(def);
    byCat.set(def.category, list);
  }

  return (
    <Modal open title="Add widget" sub="Pick panels to add to this page." icon="fa-table-cells-large" size="lg" onClose={onClose}>
      <div class="wb-picker">
        {[...byCat.entries()].map(([cat, defs]) => (
          <div class="wb-picker-cat" key={cat}>
            <div class="wb-picker-cat-label">{cat}</div>
            <div class="wb-picker-grid">
              {defs.map(def => {
                const lock = def.dataGate?.() ?? null;
                const added = placed.has(def.id);
                const disabled = !!lock || added;
                return (
                  <button key={def.id} type="button"
                    class={`wb-picker-item${disabled ? ' is-disabled' : ''}`}
                    disabled={disabled}
                    title={lock ?? (added ? 'Already on the page' : 'Add to page')}
                    onClick={() => { if (!disabled) onAdd(def.id); }}>
                    <span class="wb-picker-ico"><i class={`fas ${def.icon}`} aria-hidden="true" /></span>
                    <span class="wb-picker-copy">
                      <strong>{def.title}</strong>
                      <span>{lock ?? (added ? 'Added' : `${def.defaultW}×${def.defaultH}`)}</span>
                    </span>
                    <span class="wb-picker-state">
                      {added ? <i class="fas fa-check" aria-hidden="true" /> : lock ? <i class="fas fa-lock" aria-hidden="true" /> : <i class="fas fa-plus" aria-hidden="true" />}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </Modal>
  );
}
