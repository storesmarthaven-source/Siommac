/**
 * src/ui/forms/MultiSelect.tsx — multiple choice with chips.
 *
 * Shares `useListboxKeyboard`, `OptionList` and `AnchoredPopup` with Select and
 * Combobox, so the keyboard model is identical. What differs is what Enter does
 * (toggles rather than commits) and what closing means (nothing — the list stays
 * open, because choosing several things one dropdown-open-at-a-time is a
 * miserable way to pick five departments).
 *
 * Selected values render as removable chips inside the control. Above
 * `maxChips` they collapse to "+N more": a field holding twelve chips pushes the
 * rest of the form off the screen, and the count is more useful than the twelfth
 * label anyway.
 */

/* eslint-disable react-hooks/refs -- `ref={hook.setSomething}` is a ref CALLBACK
   returned from a hook, not a ref object being read during render. The rule
   cannot tell the two apart; the callback form is the pattern it wants. */
import { type VNode } from 'preact';
import { useCallback, useId, useMemo, useState } from 'preact/hooks';
import { LucideIcon } from '../LucideIcon';
import { AnchoredPopup } from '../overlays/AnchoredPopup';
import { type ControlSize, type UiState, type ValidationState } from '../tokens';
import { useFieldContext, resolveFieldState } from './fieldContext';
import { type Option, type OptionsInput, flattenOptions, filterOptions } from './options';
import { useListboxKeyboard } from './useListboxKeyboard';
import { LucideIcon as Icon } from '../LucideIcon';
import '../primitives/control.recipe.css';
import './listbox.recipe.css';
import './multiSelect.recipe.css';

export interface MultiSelectProps<T extends string = string> {
  values: readonly T[];
  onChange: (values: T[]) => void;
  options: OptionsInput<T>;

  searchable?: boolean;
  placeholder?: string;
  emptyLabel?: string;
  size?: ControlSize;
  /** Chips shown before collapsing to "+N more". */
  maxChips?: number;
  /** Refuse further selection past this count. */
  maxSelected?: number;

  disabled?: boolean;
  readOnly?: boolean;
  validation?: ValidationState;

  id?: string;
  name?: string;
  'aria-label'?: string;
  forceState?: UiState;
  class?: string;
}

export function MultiSelect<T extends string = string>({
  values, onChange, options,
  searchable = true, placeholder = 'Select…', emptyLabel = 'No options',
  size = 'md', maxChips = 3, maxSelected,
  disabled: ownDisabled, readOnly: ownReadOnly, validation: ownValidation,
  id: ownId, name, forceState, class: extra, ...aria
}: MultiSelectProps<T>): VNode {
  const ctx = useFieldContext();
  const { id, describedBy, validation, disabled, readOnly, required } =
    resolveFieldState(ctx, { validation: ownValidation, disabled: ownDisabled, readOnly: ownReadOnly, id: ownId });

  const uid = useId();
  const [triggerEl, setTriggerEl] = useState<HTMLButtonElement | null>(null);
  const [query, setQuery] = useState('');

  const visible = useMemo(
    () => (searchable ? filterOptions(options, query) : options),
    [options, query, searchable],
  );
  const flat = useMemo(() => flattenOptions(visible), [visible]);
  const all = useMemo(() => flattenOptions(options), [options]);
  const selected = useMemo(() => all.filter(o => values.includes(o.value)), [all, values]);

  const atLimit = maxSelected !== undefined && values.length >= maxSelected;

  const toggle = useCallback((opt: Option<T>) => {
    const isOn = values.includes(opt.value);
    if (!isOn && atLimit) return;
    onChange(isOn ? values.filter(v => v !== opt.value) : [...values, opt.value]);
    // Deliberately NOT closing: multi-select means several picks per open.
  }, [values, onChange, atLimit]);

  const kb = useListboxKeyboard({
    options: flat,
    onCommit: toggle,
    typeahead: !searchable,
    disabled: disabled || readOnly,
    idPrefix: `ms${uid}`,
    onClose: () => setQuery(''),
  });

  const inert = disabled || readOnly;
  const listId = `ms${uid}-list`;
  const forced = forceState && (forceState === 'hover' || forceState === 'focus' || forceState === 'open')
    ? forceState : undefined;

  const shownChips = selected.slice(0, maxChips);
  const overflow = selected.length - shownChips.length;

  return (
    <>
      <button
        ref={setTriggerEl}
        id={id}
        name={name}
        type="button"
        class={[
          'ui-ctrl', 'ui-ctrl--multi',
          size !== 'md' ? `ui-ctrl--${size}` : '',
          validation !== 'none' ? `ui-ctrl--${validation}` : '',
          disabled ? 'ui-ctrl--disabled' : '',
          readOnly && !disabled ? 'ui-ctrl--readonly' : '',
          kb.open ? 'ui-ctrl--open' : '',
          extra ?? '',
        ].filter(Boolean).join(' ')}
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
        {selected.length === 0
          ? <span class="ui-ctrl-value ui-ctrl-value--placeholder">{placeholder}</span>
          : (
            <span class="ui-ms-chips">
              {shownChips.map(o => (
                <span key={o.value} class="ui-ms-chip">
                  <span class="ui-ms-chip-label">{o.label}</span>
                  {!inert && (
                    // A span, not a nested <button>: nesting interactive elements
                    // is invalid and browsers resolve the target unpredictably.
                    <span
                      class="ui-ms-chip-x"
                      role="button"
                      tabIndex={-1}
                      aria-label={`Remove ${o.label}`}
                      onClick={e => { e.stopPropagation(); onChange(values.filter(v => v !== o.value)); }}
                    >
                      <Icon name="X" />
                    </span>
                  )}
                </span>
              ))}
              {overflow > 0 && <span class="ui-ms-more">+{overflow} more</span>}
            </span>
          )}

        {!inert && selected.length > 0 && (
          <span class="ui-ctrl-trail">
            <span
              class="ui-ctrl-clear"
              role="button"
              tabIndex={0}
              aria-label="Clear all"
              onClick={e => { e.stopPropagation(); onChange([]); }}
              onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); onChange([]); } }}
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

        {atLimit && (
          <div class="ui-popup-state" role="status">
            {maxSelected} selected — the maximum.
          </div>
        )}

        <div ref={kb.setListEl}>
          {flat.length === 0
            ? <div class="ui-popup-state" role="status">{emptyLabel}</div>
            : flat.map((opt, i) => {
              const on = values.includes(opt.value);
              const blocked = !on && atLimit;
              return (
                <div
                  key={opt.value}
                  id={kb.optionId(i)}
                  data-index={i}
                  data-active={i === kb.activeIndex ? 'true' : 'false'}
                  class="ui-option"
                  role="option"
                  // aria-selected, not aria-checked: this is a multi-select
                  // listbox, and a screen reader announces the two differently.
                  aria-selected={on}
                  aria-disabled={opt.disabled || blocked ? 'true' : undefined}
                  onPointerDown={e => { e.preventDefault(); if (!opt.disabled && !blocked) toggle(opt); }}
                  onPointerEnter={() => { if (!opt.disabled) kb.setActiveIndex(i); }}
                >
                  <span class={`ui-ms-tick${on ? ' is-on' : ''}`} aria-hidden="true">
                    {on && <LucideIcon name="Check" strokeWidth={3} />}
                  </span>
                  <span class="ui-option-copy">
                    <span class="ui-option-label">{opt.label}</span>
                    {opt.subtitle && <span class="ui-option-subtitle">{opt.subtitle}</span>}
                  </span>
                </div>
              );
            })}
        </div>
      </AnchoredPopup>
    </>
  );
}
