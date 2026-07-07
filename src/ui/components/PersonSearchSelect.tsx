/**
 * src/ui/components/PersonSearchSelect.tsx
 *
 * Searchable single-select combobox for picking a person (employee, user, contact…) —
 * filters by name/subtitle as you type and shows each match's photo (or initials) in the
 * results list, plus the resolved selection's photo once one is picked. Promoted out of
 * the HR Onboarding wizard's Search Worker field onto the UI kit so any page needing a
 * "search for a person" control can reuse it. Styled from tokens (`.ui-person-search*`
 * in assets/styles/uikit.css).
 */
import { type VNode } from 'preact';
import { useMemo, useState } from 'preact/hooks';

export interface PersonSearchOption {
  id: string;
  name: string;
  /** Rendered under the name in the results list (e.g. "EMP-0010 · Field Engineer"). */
  subtitle?: string | null;
  photoUrl?: string | null;
}

function initialsOf(name: string): string {
  const parts = name.split(/\s+/).filter(Boolean).slice(0, 2);
  return parts.map(w => (w[0] ?? '').toUpperCase()).join('') || '?';
}

export interface PersonSearchSelectProps {
  options: PersonSearchOption[];
  value: string;
  onChange: (id: string) => void;
  placeholder?: string;
  emptyLabel?: string;
}

export function PersonSearchSelect(
  { options, value, onChange, placeholder = 'Search by name…', emptyLabel = 'No results found' }: PersonSearchSelectProps,
): VNode {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const selected = options.find(o => o.id === value);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter(o => o.name.toLowerCase().includes(q) || (o.subtitle ?? '').toLowerCase().includes(q));
  }, [options, query]);

  function pick(id: string): void {
    onChange(id);
    setQuery('');
    setOpen(false);
  }

  return (
    <div class="ui-person-search">
      {open || !selected
        ? (
          <span class="ui-person-search-control">
            <input
              type="text"
              class="ui-input"
              placeholder={placeholder}
              value={query}
              onInput={e => setQuery((e.target as HTMLInputElement).value)}
              onFocus={() => setOpen(true)}
              onBlur={() => window.setTimeout(() => setOpen(false), 150)}
            />
            <svg class="ui-person-search-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m21 21-4.3-4.3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" /><circle cx="11" cy="11" r="8" fill="none" stroke="currentColor" stroke-width="2" /></svg>
          </span>
        )
        : (
          <button type="button" class="ui-person-search-selected" onClick={() => setOpen(true)}>
            <span class="ui-person-search-avatar">
              {selected.photoUrl ? <img src={selected.photoUrl} alt="" /> : <span>{initialsOf(selected.name)}</span>}
            </span>
            <span class="ui-person-search-name">{selected.name}</span>
            <svg class="ui-person-search-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m21 21-4.3-4.3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" /><circle cx="11" cy="11" r="8" fill="none" stroke="currentColor" stroke-width="2" /></svg>
          </button>
        )}
      {open && (
        <div class="ui-person-search-list" role="listbox">
          {filtered.length === 0
            ? <div class="ui-person-search-empty">{emptyLabel}</div>
            : filtered.map(o => (
              <button type="button" key={o.id} class={`ui-person-search-item${o.id === value ? ' is-selected' : ''}`} onMouseDown={ev => ev.preventDefault()} onClick={() => pick(o.id)}>
                <span class="ui-person-search-avatar">
                  {o.photoUrl ? <img src={o.photoUrl} alt="" /> : <span>{initialsOf(o.name)}</span>}
                </span>
                <span class="ui-person-search-copy">
                  <strong>{o.name}</strong>
                  {o.subtitle && <small>{o.subtitle}</small>}
                </span>
              </button>
            ))}
        </div>
      )}
    </div>
  );
}
