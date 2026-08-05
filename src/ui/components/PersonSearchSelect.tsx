/** Shared accessible person typeahead. Supports local options and debounced server search. */
import { type VNode } from 'preact';
import { useEffect, useMemo, useState } from 'preact/hooks';

export interface PersonSearchOption {
  id: string;
  name: string;
  subtitle?: string | null;
  photoUrl?: string | null;
}

function initialsOf(name: string): string {
  const parts = name.split(/\s+/).filter(Boolean).slice(0, 2);
  return parts.map(w => (w[0] ?? '').toUpperCase()).join('') || '?';
}

/**
 * Person avatar. Falls back to initials both when there is no URL AND when the image fails
 * to load — a stale/expired signed storage URL or an empty string would otherwise render as
 * a broken-image glyph in the results list.
 */
function PersonAvatar({ name, photoUrl }: { name: string; photoUrl?: string | null }): VNode {
  const [failed, setFailed] = useState(false);
  const src = photoUrl?.trim() ? photoUrl : null;
  return (
    <span class="ui-person-search-avatar">
      {src && !failed
        ? <img src={src} alt="" onError={() => setFailed(true)} />
        : <span>{initialsOf(name)}</span>}
    </span>
  );
}

export interface PersonSearchSelectProps {
  options: PersonSearchOption[];
  value: string;
  onChange: (id: string) => void;
  placeholder?: string;
  emptyLabel?: string;
  /** When supplied, local filtering is disabled and this callback is debounced by 250 ms. */
  onSearch?: (query: string) => void;
  loading?: boolean;
  error?: string | null;
  minimumQueryLength?: number;
  /** Renders a "N matching …" count above the results. OPT-IN: the Start Onboarding wizard's
   *  approved mockup specifies it; every other surface using this component is unchanged. */
  showResultCount?: boolean;
  /** Noun for the count line, singularised automatically (e.g. "employee" → "1 matching employee"). */
  resultCountNoun?: string;
}

export function PersonSearchSelect({
  options, value, onChange, placeholder = 'Search by name…', emptyLabel = 'No results found',
  onSearch, loading = false, error = null, minimumQueryLength = 0,
  showResultCount = false, resultCountNoun = 'result',
}: PersonSearchSelectProps): VNode {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  // Lazy initialiser, not `useRef(expr)`: the argument to useRef is evaluated on EVERY
  // render, so the Math.random() call was an impure render-phase side effect (and lint
  // error). useState's lazy form runs it exactly once per mount.
  const [listId] = useState(() => `person-search-${Math.random().toString(36).slice(2)}`);
  const selected = options.find(o => o.id === value);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (onSearch || !q) return options;
    return options.filter(o => o.name.toLowerCase().includes(q) || (o.subtitle ?? '').toLowerCase().includes(q));
  }, [options, query, onSearch]);

  useEffect(() => {
    if (!onSearch) return;
    const handle = window.setTimeout(() => onSearch(query.trim()), 250);
    return () => window.clearTimeout(handle);
  }, [onSearch, query]);
  useEffect(() => { setActiveIndex(0); }, [query, options]);

  function pick(id: string): void {
    onChange(id);
    setQuery('');
    setOpen(false);
  }

  const canShowResults = query.trim().length >= minimumQueryLength;
  const activeOption = canShowResults ? filtered[activeIndex] : undefined;

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
              role="combobox"
              aria-expanded={open}
              aria-controls={listId}
              aria-autocomplete="list"
              aria-activedescendant={open && activeOption ? `${listId}-${activeOption.id}` : undefined}
              onKeyDown={e => {
                if (e.key === 'ArrowDown') {
                  e.preventDefault(); setOpen(true);
                  setActiveIndex(i => Math.min(i + 1, Math.max(0, filtered.length - 1)));
                } else if (e.key === 'ArrowUp') {
                  e.preventDefault(); setActiveIndex(i => Math.max(0, i - 1));
                } else if (e.key === 'Enter' && open && activeOption) {
                  e.preventDefault(); pick(activeOption.id);
                } else if (e.key === 'Escape') setOpen(false);
              }}
            />
            <svg class="ui-person-search-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m21 21-4.3-4.3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" /><circle cx="11" cy="11" r="8" fill="none" stroke="currentColor" stroke-width="2" /></svg>
          </span>
        )
        : (
          <button type="button" class="ui-person-search-selected" onClick={() => setOpen(true)}>
            <PersonAvatar name={selected.name} photoUrl={selected.photoUrl} />
            <span class="ui-person-search-name">{selected.name}</span>
            <svg class="ui-person-search-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m21 21-4.3-4.3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" /><circle cx="11" cy="11" r="8" fill="none" stroke="currentColor" stroke-width="2" /></svg>
          </button>
        )}
      {/* The dropdown is reserved for the RESULT LIST. A "type at least N characters" prompt
          is guidance about the field, not a result, so it renders as help text under the
          control instead of opening an empty panel. */}
      {open && canShowResults && (
        <div class="ui-person-search-list" role="listbox" id={listId}>
            {loading
              ? <div class="ui-person-search-empty" aria-live="polite">Searching employees…</div>
              : error
                ? <div class="ui-person-search-empty" role="alert">{error}</div>
                : filtered.length === 0
                  ? <div class="ui-person-search-empty">{emptyLabel}</div>
                  : [
                    showResultCount
                      ? <div class="ui-person-search-result-count" key="__count" aria-live="polite">
                          {filtered.length} matching {resultCountNoun}{filtered.length === 1 ? '' : 's'}
                        </div>
                      : null,
                    ...filtered.map((o, index) => (
                    <button
                      type="button" key={o.id} id={`${listId}-${o.id}`} role="option" aria-selected={o.id === value}
                      class={`ui-person-search-item${o.id === value ? ' is-selected' : ''}`}
                      onMouseEnter={() => setActiveIndex(index)} onMouseDown={ev => ev.preventDefault()} onClick={() => pick(o.id)}
                    >
                      <PersonAvatar name={o.name} photoUrl={o.photoUrl} />
                      <span class="ui-person-search-copy"><strong>{o.name}</strong>{o.subtitle && <small>{o.subtitle}</small>}</span>
                      {/* Selected-option tick, per the approved mockup's result row. */}
                      {o.id === value && (
                        <span class="ui-person-search-check" aria-label="Selected">
                          <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m20 6-11 11-5-5" /></svg>
                        </span>
                      )}
                    </button>
                  )),
                  ]}
        </div>
      )}
      {open && !canShowResults && (
        <div class="employee-search-help">
          <span>Type at least {minimumQueryLength} characters to search.</span>
        </div>
      )}
    </div>
  );
}
