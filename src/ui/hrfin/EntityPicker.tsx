/**
 * src/ui/hrfin/EntityPicker.tsx
 *
 * Searchable async combobox for Finance entity pickers:
 *   vendor / GL account / cost centre / tax code / payment terms / any labelled option.
 *
 * Usage:
 *   <EntityPicker
 *     label="Vendor"
 *     options={vendors}        // { value, label, sub? }[]
 *     value={selectedId}
 *     onChange={setSelectedId}
 *     loading={isLoading}
 *     onSearch={setSearch}     // debounced search to trigger refetch
 *     placeholder="Search vendors…"
 *     error="Required"
 *   />
 *
 * The caller owns data-fetching (via useVendorPicker / useGlAccounts etc.) and
 * passes the mapped options array. onSearch is called on every keystroke so the
 * caller can debounce + refetch.
 */

import { type VNode } from 'preact';
import { useState, useRef, useCallback, useEffect } from 'preact/hooks';
import { HrfinIcon } from './icon';

// Inline micro-icons not in the main HrfinIcon set (too small / picker-specific)
const IcoX = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" class="ep-ico">
    <path d="M18 6 6 18M6 6l12 12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
  </svg>
);
const IcoDown = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" class="ep-ico">
    <path d="m6 9 6 6 6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>
);
const IcoUp = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" class="ep-ico">
    <path d="m18 15-6-6-6 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>
);

// ── Types ─────────────────────────────────────────────────────────────────────

export interface EntityOption {
  value: string;
  label: string;
  /** Optional secondary line (e.g. code, category, rate). */
  sub?: string;
  /** When true the option is shown but not selectable. */
  disabled?: boolean;
}

export interface EntityPickerProps {
  /** Form field label shown above the input. */
  label: string;
  options: EntityOption[];
  value: string | null;
  onChange: (value: string | null) => void;
  /** Show skeleton / spinner inside the input while loading. */
  loading?: boolean;
  /** Called on every keystroke — caller debounces + refetches. */
  onSearch?: (q: string) => void;
  placeholder?: string;
  /** Inline validation error shown below the input. */
  error?: string | null;
  /** When true the control is read-only. */
  disabled?: boolean;
  required?: boolean;
  id?: string;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function EntityPicker({
  label,
  options,
  value,
  onChange,
  loading = false,
  onSearch,
  placeholder = 'Search…',
  error,
  disabled = false,
  required = false,
  id,
}: EntityPickerProps): VNode {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selected = options.find(o => o.value === value) ?? null;

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery('');
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const handleInputChange = useCallback((e: Event) => {
    const q = (e.target as HTMLInputElement).value;
    setQuery(q);
    onSearch?.(q);
    setOpen(true);
  }, [onSearch]);

  const handleSelect = useCallback((opt: EntityOption) => {
    if (opt.disabled) return;
    onChange(opt.value);
    setOpen(false);
    setQuery('');
    onSearch?.('');
  }, [onChange, onSearch]);

  const handleClear = useCallback((e: MouseEvent) => {
    e.stopPropagation();
    onChange(null);
    setQuery('');
    onSearch?.('');
    inputRef.current?.focus();
  }, [onChange, onSearch]);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') { setOpen(false); setQuery(''); }
    if (e.key === 'ArrowDown' && !open) setOpen(true);
  }, [open]);

  const inputId = id ?? `ep-${label.toLowerCase().replace(/\s+/g, '-')}`;

  // Display value in input: query while open, selected label when closed
  const displayValue = open ? query : (selected?.label ?? '');

  const hasError = !!error;

  return (
    <div class="ep-root" ref={rootRef}>
      <label class="ep-label" for={inputId}>
        {label}
        {required && <span class="ep-required" aria-hidden="true"> *</span>}
      </label>

      <div class={`ep-control${open ? ' ep-control--open' : ''}${hasError ? ' ep-control--error' : ''}${disabled ? ' ep-control--disabled' : ''}`}>
        <input
          ref={inputRef}
          id={inputId}
          type="text"
          class="ep-input"
          value={displayValue}
          placeholder={placeholder}
          disabled={disabled}
          aria-autocomplete="list"
          aria-expanded={open}
          aria-haspopup="listbox"
          aria-describedby={hasError ? `${inputId}-err` : undefined}
          aria-required={required}
          onInput={handleInputChange}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKeyDown}
          autoComplete="off"
        />

        <div class="ep-adornments">
          {loading && <span class="ep-spinner" aria-label="Loading" />}
          {!loading && value && !disabled && (
            <button type="button" class="ep-clear" aria-label="Clear" onClick={handleClear}>
              <IcoX />
            </button>
          )}
          <span class="ep-chevron" aria-hidden="true">
            {open ? <IcoUp /> : <IcoDown />}
          </span>
        </div>
      </div>

      {open && (
        <div class="ep-dropdown" role="listbox" aria-label={label}>
          {loading && options.length === 0 ? (
            <div class="ep-state ep-state--loading">Loading…</div>
          ) : options.length === 0 ? (
            <div class="ep-state ep-state--empty">No results</div>
          ) : (
            options.map(opt => (
              <div
                key={opt.value}
                role="option"
                aria-selected={opt.value === value}
                aria-disabled={opt.disabled}
                class={[
                  'ep-option',
                  opt.value === value ? 'ep-option--selected' : '',
                  opt.disabled ? 'ep-option--disabled' : '',
                ].filter(Boolean).join(' ')}
                onClick={() => handleSelect(opt)}
                onMouseDown={e => e.preventDefault()} // prevent blur before click
              >
                <span class="ep-option-label">{opt.label}</span>
                {opt.sub && <span class="ep-option-sub">{opt.sub}</span>}
                {opt.value === value && (
                  <span class="ep-option-check" aria-hidden="true">
                    <HrfinIcon name="check" />
                  </span>
                )}
              </div>
            ))
          )}
        </div>
      )}

      {hasError && (
        <p id={`${inputId}-err`} class="ep-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
