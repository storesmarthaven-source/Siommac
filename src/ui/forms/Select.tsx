/**
 * src/ui/forms/Select.tsx — canonical single-select.
 *
 * Replaces `SelectInput` from `src/ui/components/Field.tsx` (a bare native
 * <select> with no disabled/read-only/validation/loading, used in 34 files) and
 * the two module-local `Select` copies in Calendar and PayslipStudio.
 *
 * A custom listbox rather than a native <select> because the app needs option
 * subtitles, group headers, disabled options and a consistent dropdown surface —
 * none of which a native select can render. Everything a native select gives
 * for free is therefore reimplemented deliberately: focusable trigger,
 * Enter/Space to open, typeahead, Home/End, and `aria-activedescendant`.
 *
 * Keyboard behaviour lives in `useListboxKeyboard`, shared with Combobox and
 * PersonSearchSelect — so all three behave identically.
 */

/* eslint-disable react-hooks/refs -- `ref={hook.setSomething}` is a ref CALLBACK
   returned from a hook, not a ref object being read during render. The rule
   cannot tell the two apart; the callback form is the pattern it wants. */
import { type CSSProperties, type VNode } from 'preact';
import { useId, useMemo, useState, useCallback } from 'preact/hooks';
import { LucideIcon } from '../LucideIcon';
import { AnchoredPopup } from '../overlays/AnchoredPopup';
import { type ControlSize, type UiState, type ValidationState } from '../tokens';
import { useFieldContext, resolveFieldState } from './fieldContext';
import { type Option, type OptionsInput, flattenOptions, findOption, filterOptions } from './options';
import { useListboxKeyboard } from './useListboxKeyboard';
import { OptionList } from './OptionList';
import '../primitives/control.recipe.css';
import './listbox.recipe.css';

export interface SelectProps<T extends string = string> {
  value: T | '';
  onChange: (value: T | '') => void;
  options: OptionsInput<T>;

  /** Adds a filter box inside the dropdown. For long lists. */
  searchable?: boolean;
  /** Allows clearing back to ''. Omit for a field that must always have a value. */
  clearable?: boolean;

  placeholder?: string;
  emptyLabel?: string;
  size?: ControlSize;

  disabled?: boolean;
  readOnly?: boolean;
  loading?: boolean;
  error?: string | null;
  validation?: ValidationState;

  id?: string;
  name?: string;
  'aria-label'?: string;
  title?: string;
  /** Gallery-only forced visual state. See src/ui/RECIPES.md §5. */
  forceState?: UiState;
  class?: string;
  style?: CSSProperties;
}

export function Select<T extends string = string>({
  value, onChange, options,
  searchable = false, clearable = false,
  placeholder = 'Select…', emptyLabel = 'No options', size = 'md',
  disabled: ownDisabled, readOnly: ownReadOnly, loading = false, error = null,
  validation: ownValidation,
  id: ownId, name, forceState, class: extra, style, title,
  ...aria
}: SelectProps<T>): VNode {
  const ctx = useFieldContext();
  const { id, describedBy, validation, disabled, readOnly, required } =
    resolveFieldState(ctx, { validation: ownValidation, disabled: ownDisabled, readOnly: ownReadOnly, id: ownId });

  const uid = useId();
  // State, not a ref: AnchoredPopup needs the element DURING render to
  // position against, and a ref's `.current` is not a render-time value.
  const [triggerEl, setTriggerEl] = useState<HTMLButtonElement | null>(null);
  const [query, setQuery] = useState('');

  const visible = useMemo(
    () => (searchable ? filterOptions(options, query) : options),
    [options, query, searchable],
  );
  const flat = useMemo(() => flattenOptions(visible), [visible]);
  const selected = findOption(options, value);
  const emptyOption = value === '' ? flattenOptions(options).find(opt => opt.value === '') : undefined;

  const commit = useCallback((opt: Option<T>) => {
    onChange(opt.value);
    setQuery('');
    // Return focus to the trigger: the user's next Tab must continue from the
    // field, not from wherever in the document the portalled surface lived.
    triggerEl?.focus();
  }, [onChange, triggerEl]);

  const kb = useListboxKeyboard({
    options: flat,
    onCommit: commit,
    value,
    // Typeahead only when there is no filter box — otherwise letters would both
    // jump the cursor and type into the search field.
    typeahead: !searchable,
    disabled: disabled || readOnly,
    idPrefix: `sel${uid}`,
    onClose: () => setQuery(''),
  });

  // Read-only is genuinely different from disabled: the trigger stays focusable
  // so the value can be read and copied, it just never opens.
  const inert = disabled || readOnly;

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
  const listId = `sel${uid}-list`;

  function handleClear(e: MouseEvent): void {
    e.stopPropagation();
    onChange('');
    triggerEl?.focus();
  }

  return (
    <>
      <button
        ref={setTriggerEl}
        id={id}
        name={name}
        type="button"
        class={boxClass}
        style={style}
        title={title}
        data-ui-state={forced}
        disabled={disabled}
        role="combobox"
        aria-expanded={kb.open}
        aria-controls={kb.open ? listId : undefined}
        aria-activedescendant={kb.activeId}
        aria-haspopup="listbox"
        aria-invalid={validation === 'error' ? true : undefined}
        aria-describedby={describedBy}
        aria-required={required || undefined}
        aria-label={aria['aria-label']}
        onClick={() => { if (!inert) kb.setOpen(!kb.open); }}
        onKeyDown={kb.onKeyDown}
      >
        <span class={`ui-ctrl-value${selected ? '' : ' ui-ctrl-value--placeholder'}`}>
          {selected?.label ?? emptyOption?.label ?? placeholder}
        </span>

        {loading && <span class="ui-ctrl-trail"><span class="ui-ctrl-spinner" role="status" aria-label="Loading" /></span>}

        {!loading && clearable && value && !inert && (
          <span class="ui-ctrl-trail">
            {/* A <span role=button>, not a nested <button>: nesting interactive
                elements is invalid HTML and browsers resolve the click target
                unpredictably. */}
            <span
              class="ui-ctrl-clear"
              role="button"
              tabIndex={0}
              aria-label="Clear selection"
              onClick={handleClear}
              onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); onChange(''); } }}
            >
              <LucideIcon name="X" />
            </span>
          </span>
        )}

        {!inert && <span class="ui-ctrl-arrow" aria-hidden="true"><LucideIcon name="ChevronDown" /></span>}
      </button>

      <AnchoredPopup
        open={kb.open}
        anchor={triggerEl}
        onDismiss={() => kb.setOpen(false)}
        id={listId}
        role="listbox"
        aria-label={aria['aria-label'] ?? placeholder}
      >
        {searchable && (
          <div class="ui-popup-search">
            {/* Focus moves into this box, so IT must carry the active-option
                pointer — a screen reader reads `aria-activedescendant` from the
                focused element, and the trigger no longer has focus. */}
            <input
              class="ui-ctrl-input"
              type="text"
              autoFocus
              value={query}
              placeholder="Filter…"
              aria-label="Filter options"
              aria-controls={listId}
              aria-activedescendant={kb.activeId}
              onInput={e => setQuery((e.target as HTMLInputElement).value)}
              onKeyDown={kb.onKeyDown}
            />
          </div>
        )}
        <div ref={kb.setListEl}>
          <OptionList
            options={visible}
            value={value}
            activeIndex={kb.activeIndex}
            optionId={kb.optionId}
            onPick={commit}
            onHover={kb.setActiveIndex}
            error={error}
            emptyLabel={emptyLabel}
          />
        </div>
      </AnchoredPopup>
    </>
  );
}
