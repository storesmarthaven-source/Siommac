/**
 * src/ui/components/Toolbar.tsx
 *
 * The filter row under a section header: a search box plus any number of
 * filter <select>s and trailing actions. Wraps the existing `.vt-toolbar` /
 * `.vt-search` classes used on every register page.
 *
 * `SearchInput` and `FilterSelect` are exported as the standard controls so
 * pages stop re-typing the same markup. Compose freely as children.
 */

import { type VNode, type ComponentChildren } from 'preact';

interface ToolbarProps {
  class?: string;
  children?: ComponentChildren;
}

export function Toolbar({ class: extra, children }: ToolbarProps): VNode {
  return (
    <div class={`vt-toolbar${extra ? ' ' + extra : ''}`} style={{ marginBottom: 0, marginTop: 'var(--space-3)' }}>
      {children}
    </div>
  );
}

interface SearchInputProps {
  value: string;
  onInput: (v: string) => void;
  placeholder?: string;
  /** Flex basis for the search field within the toolbar. */
  grow?: string;
}

export function SearchInput({ value, onInput, placeholder = 'Search…', grow = '1 1 180px' }: SearchInputProps): VNode {
  return (
    <div class="vt-search" style={{ flex: grow }}>
      <i class="fas fa-search" />
      <input
        type="search"
        placeholder={placeholder}
        value={value}
        onInput={e => onInput((e.target as HTMLInputElement).value)}
      />
    </div>
  );
}

interface FilterSelectProps {
  value: string;
  onChange: (v: string) => void;
  /** First option is treated as the "all" default; rest are choices. */
  options: readonly string[];
  /** Optional explicit default label rendered as the first option. */
  allLabel?: string;
}

export function FilterSelect({ value, onChange, options, allLabel }: FilterSelectProps): VNode {
  return (
    <select class="emp-filter-select" value={value} onChange={e => onChange((e.target as HTMLSelectElement).value)}>
      {allLabel && <option>{allLabel}</option>}
      {options.map(o => <option key={o}>{o}</option>)}
    </select>
  );
}
