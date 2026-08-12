/**
 * src/ui/data/DataTable/DataTableToolbar.tsx — INTERNAL to DataTable.
 *
 * Search, filters, the column chooser and the bulk-action bar. Not exported and
 * not a Gallery card: these are parts of one table, and shipping them as
 * standalone components is how the app ended up with two half-toolbars
 * (`Toolbar` and `FilterBar`) neither of which does the whole job.
 *
 * Everything here composes canonical primitives — TextInput, MultiSelect,
 * Button, Badge, Checkbox, AnchoredPopup. No new behaviour is invented.
 */

import { type VNode } from 'preact';
import { useState } from 'preact/hooks';
import { LucideIcon } from '../../LucideIcon';
import { Button } from '../../primitives/Button';
import { Badge } from '../../primitives/Badge';
import { Checkbox } from '../../primitives/choice';
import { SearchInput } from '../../primitives/TextInput';
import { MultiSelect } from '../../forms/MultiSelect';
import { AnchoredPopup } from '../../overlays/AnchoredPopup';
import {
  type DataTableBulkAction, type DataTableColumn, type DataTableFilter, type DataTableSearch,
} from './types';

interface ToolbarProps<T> {
  search?: DataTableSearch;
  filters?: readonly DataTableFilter[];
  columns: readonly DataTableColumn<T>[];
  hiddenIds: readonly string[];
  onToggleColumn: (id: string) => void;
  columnChooser?: boolean;
  actions?: preact.ComponentChildren;
}

export function DataTableToolbar<T>({
  search, filters, columns, hiddenIds, onToggleColumn, columnChooser, actions,
}: ToolbarProps<T>): VNode | null {
  const [chooserAnchor, setChooserAnchor] = useState<HTMLElement | null>(null);
  const [chooserOpen, setChooserOpen] = useState(false);

  const hasFilters = (filters?.length ?? 0) > 0;
  if (!search && !hasFilters && !columnChooser && !actions) return null;

  const activeChips = (filters ?? []).flatMap(f =>
    f.values.map(v => ({
      filter: f,
      value: v,
      label: f.options.find(o => o.value === v)?.label ?? v,
    })),
  );

  return (
    <div class="ui-dt-toolbar">
      <div class="ui-dt-toolbar-row">
        {search && (
          <div class="ui-dt-search">
            <SearchInput
              size="sm"
              value={search.value}
              onInput={search.onChange}
              placeholder={search.placeholder ?? 'Search…'}
              aria-label={search.placeholder ?? 'Search'}
            />
          </div>
        )}

        {filters?.map(f => (
          <div key={f.id} class="ui-dt-filter">
            <MultiSelect
              size="sm"
              values={f.values}
              onChange={f.onChange}
              options={f.options}
              placeholder={f.label}
              maxChips={1}
              aria-label={f.label}
            />
          </div>
        ))}

        <div class="ui-dt-toolbar-end">
          {actions}
          {columnChooser && (
            <>
              <span ref={setChooserAnchor} style={{ display: 'inline-flex' }}>
                <Button
                  variant="outline"
                  size="sm"
                  iconLeft={<LucideIcon name="Columns3" />}
                  aria-haspopup="dialog"
                  aria-expanded={chooserOpen}
                  onClick={() => setChooserOpen(o => !o)}
                >
                  Columns
                </Button>
              </span>
              <AnchoredPopup
                open={chooserOpen}
                anchor={chooserAnchor}
                onDismiss={() => setChooserOpen(false)}
                matchAnchorWidth={false}
                role="dialog"
                aria-label="Choose columns"
                class="ui-dt-chooser"
              >
                <div class="ui-dt-chooser-title">Columns</div>
                {columns.map(c => (
                  <div key={c.id} class="ui-dt-chooser-row">
                    <Checkbox
                      checked={!hiddenIds.includes(c.id)}
                      // An identity column stays: hiding it leaves rows you
                      // cannot tell apart, and the user has no way back.
                      disabled={c.alwaysVisible}
                      onChange={() => onToggleColumn(c.id)}
                      label={c.header}
                    />
                  </div>
                ))}
              </AnchoredPopup>
            </>
          )}
        </div>
      </div>

      {activeChips.length > 0 && (
        <div class="ui-dt-chips">
          {activeChips.map(chip => (
            <Badge
              key={`${chip.filter.id}:${chip.value}`}
              tone="accent"
              size="sm"
              onRemove={() => chip.filter.onChange(chip.filter.values.filter(v => v !== chip.value))}
              removeLabel={`Remove filter ${chip.label}`}
            >
              {chip.filter.label}: {chip.label}
            </Badge>
          ))}
          <Button
            variant="link"
            size="sm"
            onClick={() => (filters ?? []).forEach(f => { if (f.values.length) f.onChange([]); })}
          >
            Clear all
          </Button>
        </div>
      )}
    </div>
  );
}

/* ── Bulk action bar ───────────────────────────────────────────────────────*/

export function DataTableBulkBar(
  { count, actions, onClear }:
  { count: number; actions: readonly DataTableBulkAction[]; onClear: () => void },
): VNode {
  return (
    // `role=status` so the count is announced when a selection changes — a
    // sighted user sees the bar appear; everyone else needs to be told.
    <div class="ui-dt-bulk" role="status">
      <span class="ui-dt-bulk-count">{count} selected</span>
      {actions.map(a => (
        <Button
          key={a.id}
          size="sm"
          variant={a.tone === 'danger' ? 'danger' : 'outline'}
          iconLeft={a.icon}
          disabled={a.disabled}
          onClick={() => a.onSelect([])}
        >
          {a.label}
        </Button>
      ))}
      <Button variant="ghost" size="sm" onClick={onClear} class="ui-dt-bulk-clear">
        Clear
      </Button>
    </div>
  );
}
