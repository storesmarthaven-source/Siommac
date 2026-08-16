import { type VNode } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { CountryFlag, COUNTRY_FLAG_OPTIONS } from '../data/CountryFlag';
import { LucideIcon } from '../LucideIcon';

export interface CountryPickerProps {
  id: string;
  value: string;
  disabled?: boolean;
  onChange: (code: string) => void;
}

/** Searchable Studio control for the canonical country flag catalogue. */
export function CountryPicker({ id, value, disabled = false, onChange }: CountryPickerProps): VNode {
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [visibleCount, setVisibleCount] = useState(80);
  const selected = COUNTRY_FLAG_OPTIONS.find(option => option.code === value) ?? COUNTRY_FLAG_OPTIONS[0];
  const normalized = query.trim().toLocaleLowerCase();
  const matches = normalized
    ? COUNTRY_FLAG_OPTIONS.filter(option => option.name.toLocaleLowerCase().includes(normalized) || option.code.toLocaleLowerCase().includes(normalized))
    : COUNTRY_FLAG_OPTIONS;
  const visible = matches.slice(0, visibleCount);

  useEffect(() => {
    if (!open) return undefined;
    const closeOnOutsidePress = (event: PointerEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', closeOnOutsidePress);
    return () => document.removeEventListener('pointerdown', closeOnOutsidePress);
  }, [open]);

  const choose = (code: string): void => {
    onChange(code);
    setOpen(false);
    setQuery('');
  };

  return (
    <div ref={rootRef} class="sds-country-picker">
      <button id={id} type="button" class="sds-country-picker__trigger" disabled={disabled}
        aria-label={`Choose country, ${selected?.name ?? value}`}
        aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen(current => !current)}>
        <span class="sds-country-picker__flag"><CountryFlag code={selected?.code ?? value} shape="rectangle" size={20} /></span>
        <span class="sds-country-picker__value"><strong>{selected?.name ?? value}</strong><small>{selected?.code ?? value}</small></span>
        <span class="sds-country-picker__chevron"><LucideIcon name="ChevronDown" size={15} /></span>
      </button>

      {open && (
        <div class="sds-country-browser" role="group" aria-label="Country flag browser">
          <header><div><strong>Choose a country</strong><span>{COUNTRY_FLAG_OPTIONS.length} flags</span></div></header>
          <label class="sds-country-search">
            <LucideIcon name="Search" size={15} />
            <input autoFocus value={query} placeholder="Search countries or codes…" aria-label="Search countries"
              onInput={event => { setQuery((event.target as HTMLInputElement).value); setVisibleCount(80); }}
              onKeyDown={event => { if (event.key === 'Escape') setOpen(false); }} />
          </label>
          <div class="sds-country-list" role="listbox" aria-label="Countries">
            {visible.map(option => (
              <button type="button" role="option" aria-selected={option.code === value} key={option.code}
                class={option.code === value ? 'is-on' : ''} onClick={() => choose(option.code)}>
                <CountryFlag code={option.code} shape="rectangle" size={20} />
                <span><strong>{option.name}</strong><small>{option.code}</small></span>
                {option.code === value && <LucideIcon name="Check" size={15} />}
              </button>
            ))}
          </div>
          {visible.length < matches.length && (
            <button type="button" class="sds-country-more" onClick={() => setVisibleCount(count => count + 80)}>
              Show more countries
            </button>
          )}
          {matches.length === 0 && <p class="sds-country-empty">No countries match “{query}”.</p>}
        </div>
      )}
    </div>
  );
}
