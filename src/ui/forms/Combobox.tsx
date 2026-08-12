/**
 * src/ui/forms/Combobox.tsx — text entry that filters an option list.
 *
 * The difference from `Select` is where the typing goes. In a Select the field
 * shows the chosen label and letters jump the cursor (typeahead); in a Combobox
 * the field IS a text input and what you type filters the list. That is the only
 * real distinction, so they share `useListboxKeyboard`, `OptionList` and
 * `AnchoredPopup`, and differ only in the trigger.
 *
 * Supports both option sources:
 *   • static  — pass `options`, filtering happens locally
 *   • async   — pass `search`, which is debounced and its result rendered,
 *               with real loading and error states
 *
 * The async path is what the old `PersonSearchSelect` could not do: it required
 * the caller to pre-fetch every possible option, which is why person pickers
 * across the app were capped at whatever the page had already loaded.
 */

/* eslint-disable react-hooks/refs -- `ref={hook.setSomething}` is a ref CALLBACK
   returned from a hook, not a ref object being read during render. The rule
   cannot tell the two apart; the callback form is the pattern it wants. */
import { type VNode } from 'preact';
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'preact/hooks';
import { LucideIcon } from '../LucideIcon';
import { AnchoredPopup } from '../overlays/AnchoredPopup';
import { type ControlSize, type UiState, type ValidationState } from '../tokens';
import { useFieldContext, resolveFieldState } from './fieldContext';
import { type Option, type OptionsInput, flattenOptions, findOption, filterOptions } from './options';
import { useListboxKeyboard } from './useListboxKeyboard';
import { OptionList } from './OptionList';
import '../primitives/control.recipe.css';
import './listbox.recipe.css';

export interface ComboboxProps<T extends string = string> {
  value: T | '';
  onChange: (value: T | '') => void;

  /** Static options — filtered locally as the user types. */
  options?: OptionsInput<T>;
  /**
   * Async source. Called with the trimmed query after `debounceMs`. Rejecting
   * surfaces as an error row rather than an empty list, so a broken request is
   * never mistaken for "no matches".
   */
  search?: (query: string) => Promise<OptionsInput<T>>;
  debounceMs?: number;
  /** Minimum characters before `search` runs. 0 searches on open. */
  minChars?: number;

  placeholder?: string;
  emptyLabel?: string;
  size?: ControlSize;
  clearable?: boolean;

  disabled?: boolean;
  readOnly?: boolean;
  validation?: ValidationState;

  /** Custom row renderer. PersonSearchSelect supplies an avatar row. */
  renderOption?: (option: Option<T>, selected: boolean) => VNode;
  /** Custom rendering of the resolved selection inside the control box. */
  renderSelected?: (option: Option<T>) => VNode;

  id?: string;
  name?: string;
  'aria-label'?: string;
  forceState?: UiState;
  class?: string;
}

export function Combobox<T extends string = string>({
  value, onChange, options: staticOptions, search, debounceMs = 220, minChars = 0,
  placeholder = 'Search…', emptyLabel = 'No results', size = 'md', clearable = true,
  disabled: ownDisabled, readOnly: ownReadOnly, validation: ownValidation,
  renderOption, renderSelected,
  id: ownId, name, forceState, class: extra,
  ...aria
}: ComboboxProps<T>): VNode {
  const ctx = useFieldContext();
  const { id, describedBy, validation, disabled, readOnly, required } =
    resolveFieldState(ctx, { validation: ownValidation, disabled: ownDisabled, readOnly: ownReadOnly, id: ownId });

  const uid = useId();
  // State, not a ref: AnchoredPopup needs the element DURING render.
  const [boxEl, setBoxEl] = useState<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const [query, setQuery] = useState('');
  const [remote, setRemote] = useState<OptionsInput<T>>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Every async result carries the request number that produced it, so a slow
  // early response cannot overwrite a fast later one. Without this, deleting a
  // character can leave the list showing results for the longer query.
  const requestSeq = useRef(0);

  const isAsync = typeof search === 'function';

  const visible = useMemo<OptionsInput<T>>(() => {
    if (isAsync) return remote;
    return filterOptions(staticOptions ?? [], query);
  }, [isAsync, remote, staticOptions, query]);

  const flat = useMemo(() => flattenOptions(visible), [visible]);

  // The selected option must be resolvable even when it is not in the current
  // (filtered or freshly-searched) list — otherwise the field blanks itself the
  // moment the user types.
  const [resolved, setResolved] = useState<Option<T> | undefined>(undefined);
  const selected = findOption(staticOptions ?? [], value) ?? findOption(visible, value) ?? resolved;
  useEffect(() => {
    const found = findOption(visible, value);
    if (found) setResolved(found);
    if (!value) setResolved(undefined);
  }, [value, visible]);

  const commit = useCallback((opt: Option<T>) => {
    setResolved(opt);
    onChange(opt.value);
    setQuery('');
    inputRef.current?.focus();
  }, [onChange]);

  const kb = useListboxKeyboard({
    options: flat,
    onCommit: commit,
    value,
    typeahead: false,          // typing filters; it must not also move the cursor
    disabled: disabled || readOnly,
    idPrefix: `cb${uid}`,
    onClose: () => setQuery(''),
  });

  // Debounced async search.
  useEffect(() => {
    if (!isAsync || !kb.open) return;
    const q = query.trim();
    if (q.length < minChars) { setRemote([]); setError(null); setLoading(false); return; }

    // eslint-disable-next-line react-hooks/immutability -- a monotonic request counter must NOT trigger a render; that is precisely why it is a ref
    const seq = ++requestSeq.current;
    setLoading(true);
    setError(null);
    const timer = window.setTimeout(() => {
      void search(q)
        .then(res => { if (seq === requestSeq.current) { setRemote(res); setLoading(false); } })
        .catch((e: unknown) => {
          if (seq !== requestSeq.current) return;
          setLoading(false);
          setRemote([]);
          setError(e instanceof Error ? e.message : 'Search failed');
        });
    }, debounceMs);

    return () => window.clearTimeout(timer);
  }, [query, kb.open, isAsync, minChars, debounceMs]);

  const inert = disabled || readOnly;
  // While closed, the field displays the selection; while open it shows what is
  // being typed. Mixing the two makes the caret land in the middle of a label
  // the user did not type.
  const showSelected = !kb.open && selected != null;

  const boxClass = [
    'ui-ctrl',
    size !== 'md' ? `ui-ctrl--${size}` : '',
    validation !== 'none' ? `ui-ctrl--${validation}` : '',
    disabled ? 'ui-ctrl--disabled' : '',
    readOnly && !disabled ? 'ui-ctrl--readonly' : '',
    kb.open ? 'ui-ctrl--open' : '',
    extra ?? '',
  ].filter(Boolean).join(' ');

  const forced = forceState && (forceState === 'hover' || forceState === 'focus' || forceState === 'open')
    ? forceState : undefined;
  const listId = `cb${uid}-list`;

  // Fixed trailing priority — exactly one renders. spinner > clear > chevron.
  const showSpinner = loading;
  const showClear = !showSpinner && clearable && !!value && !inert;

  return (
    <>
      <div ref={setBoxEl} class={boxClass} data-ui-state={forced} onClick={() => { if (!inert) inputRef.current?.focus(); }}>
        {showSelected && renderSelected
          ? renderSelected(selected)
          : (
            <input
              ref={inputRef}
              id={id}
              name={name}
              class="ui-ctrl-input"
              type="text"
              autoComplete="off"
              role="combobox"
              aria-expanded={kb.open}
              aria-controls={kb.open ? listId : undefined}
              aria-activedescendant={kb.activeId}
              aria-autocomplete="list"
              aria-invalid={validation === 'error' ? true : undefined}
              aria-describedby={describedBy}
              aria-required={required || undefined}
              aria-label={aria['aria-label']}
              disabled={disabled}
              readOnly={readOnly}
              placeholder={selected ? selected.label : placeholder}
              value={kb.open ? query : (selected?.label ?? '')}
              onInput={e => { setQuery((e.target as HTMLInputElement).value); if (!kb.open) kb.setOpen(true); }}
              onFocus={() => { if (!inert) kb.setOpen(true); }}
              onKeyDown={kb.onKeyDown}
            />
          )}

        {showSpinner && <span class="ui-ctrl-trail"><span class="ui-ctrl-spinner" role="status" aria-label="Searching" /></span>}

        {showClear && (
          <span class="ui-ctrl-trail">
            <button
              type="button"
              class="ui-ctrl-clear"
              aria-label="Clear selection"
              onClick={e => { e.stopPropagation(); onChange(''); setQuery(''); setResolved(undefined); inputRef.current?.focus(); }}
            >
              <LucideIcon name="X" />
            </button>
          </span>
        )}

        {!showSpinner && !showClear && !inert && (
          <span class="ui-ctrl-trail" aria-hidden="true"><LucideIcon name="Search" /></span>
        )}
      </div>

      <AnchoredPopup
        open={kb.open}
        anchor={boxEl}
        onDismiss={() => kb.setOpen(false)}
        id={listId}
        role="listbox"
        aria-label={aria['aria-label'] ?? placeholder}
      >
        <div ref={kb.setListEl}>
          <OptionList
            options={visible}
            value={value}
            activeIndex={kb.activeIndex}
            optionId={kb.optionId}
            onPick={commit}
            onHover={kb.setActiveIndex}
            loading={loading}
            error={error}
            emptyLabel={query.trim().length < minChars ? `Type ${minChars}+ characters to search` : emptyLabel}
            renderOption={renderOption}
          />
        </div>
      </AnchoredPopup>
    </>
  );
}
