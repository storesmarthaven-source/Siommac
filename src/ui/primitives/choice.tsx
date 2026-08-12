/**
 * src/ui/primitives/choice.tsx — Checkbox, Radio, Switch and their groups.
 *
 * The app has 84 raw `type="checkbox"`, 11 raw `type="radio"`, and exactly one
 * Switch — private to `NavCustomizer`. None of them share a look, a disabled
 * treatment, or an error state.
 *
 * Every control here wraps a REAL native input. That is not a detail: the native
 * element supplies keyboard operation, form participation, `:checked`, the
 * `indeterminate` property and correct screen-reader announcement. A div with a
 * click handler has to reimplement all five, and typically reimplements two.
 *
 * ── Checkbox vs Switch ──────────────────────────────────────────────────────
 * A Checkbox is a value you are editing and will submit. A Switch takes effect
 * IMMEDIATELY. Using a switch inside a form with a Save button tells the user
 * their change is already live when it is not — so they are separate components
 * rather than a `variant` prop, and choosing between them is a real decision.
 */

import { type VNode, type ComponentChildren } from 'preact';
import { useEffect, useId, useRef } from 'preact/hooks';
import { LucideIcon } from '../LucideIcon';
import { type UiState } from '../tokens';
import { useFieldContext, resolveFieldState } from '../forms/fieldContext';
import './choice.recipe.css';

const FORCEABLE: ReadonlySet<UiState> = new Set(['hover', 'focus', 'selected']);

function forcedAttr(forceState?: UiState): string | undefined {
  return forceState && FORCEABLE.has(forceState) ? forceState : undefined;
}

/* ── Checkbox ──────────────────────────────────────────────────────────────*/

export interface CheckboxProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: ComponentChildren;
  /** Second line under the label — what ticking this actually does. */
  description?: string;
  /**
   * "Some but not all" — for a select-all over a partial selection. Distinct
   * from `checked`; the two say different things and must not both render.
   */
  indeterminate?: boolean;
  disabled?: boolean;
  readOnly?: boolean;
  error?: boolean;
  name?: string;
  value?: string;
  id?: string;
  /** Accessible name when there is no visible label. */
  'aria-label'?: string;
  forceState?: UiState;
  class?: string;
}

export function Checkbox({
  checked, onChange, label, description, indeterminate = false,
  disabled: ownDisabled, readOnly: ownReadOnly, error, name, value, id: ownId,
  forceState, class: extra, ...aria
}: CheckboxProps): VNode {
  const ctx = useFieldContext();
  const { id, describedBy, validation, disabled, readOnly } =
    resolveFieldState(ctx, { disabled: ownDisabled, readOnly: ownReadOnly, id: ownId });
  const inputRef = useRef<HTMLInputElement | null>(null);
  const uid = useId();
  const descId = description ? `cb${uid}-desc` : undefined;

  // `indeterminate` is a DOM property with no HTML attribute, so it can only be
  // set imperatively. This is the single most-missed part of a checkbox.
  useEffect(() => {
    if (inputRef.current) inputRef.current.indeterminate = indeterminate && !checked;
  }, [indeterminate, checked]);

  const invalid = error ?? validation === 'error';
  const inert = disabled || readOnly;

  return (
    <label
      class={[
        'ui-choice',
        label != null ? 'ui-choice--block' : '',
        inert ? 'ui-choice--disabled' : '',
        invalid ? 'ui-choice--error' : '',
        extra ?? '',
      ].filter(Boolean).join(' ')}
      data-ui-state={forcedAttr(forceState)}
    >
      <input
        ref={inputRef}
        id={id}
        name={name}
        value={value}
        type="checkbox"
        class="ui-choice-input"
        checked={checked}
        disabled={disabled}
        aria-invalid={invalid || undefined}
        aria-describedby={[describedBy, descId].filter(Boolean).join(' ') || undefined}
        aria-label={aria['aria-label']}
        onChange={e => {
          // Read-only has no native equivalent on a checkbox — the attribute is
          // ignored by browsers — so it is enforced by refusing the change and
          // restoring the DOM to the controlled value.
          if (readOnly) { (e.target as HTMLInputElement).checked = checked; return; }
          onChange((e.target as HTMLInputElement).checked);
        }}
      />
      <span class="ui-choice-box" aria-hidden="true">
        <LucideIcon name="Check" class="ui-choice-mark" strokeWidth={3} />
        <span class="ui-choice-dash" />
      </span>
      {(label != null || description) && (
        <span class="ui-choice-copy">
          {label != null && <span class="ui-choice-label">{label}</span>}
          {description && <span class="ui-choice-desc" id={descId}>{description}</span>}
        </span>
      )}
    </label>
  );
}

/* ── Radio ─────────────────────────────────────────────────────────────────*/

export interface RadioProps extends Omit<CheckboxProps, 'indeterminate' | 'checked' | 'onChange'> {
  checked: boolean;
  onChange: () => void;
  /** Required: radios only work as a named group. */
  name: string;
  value: string;
}

/**
 * A single radio. Prefer `RadioGroup` — a lone radio cannot be deselected and is
 * almost always a Checkbox used by mistake.
 */
export function Radio({
  checked, onChange, label, description, name, value,
  disabled: ownDisabled, readOnly: ownReadOnly, error, id: ownId,
  forceState, class: extra, ...aria
}: RadioProps): VNode {
  const ctx = useFieldContext();
  const { id, describedBy, validation, disabled, readOnly } =
    resolveFieldState(ctx, { disabled: ownDisabled, readOnly: ownReadOnly, id: ownId });
  const uid = useId();
  const descId = description ? `rd${uid}-desc` : undefined;
  const invalid = error ?? validation === 'error';
  const inert = disabled || readOnly;

  return (
    <label
      class={[
        'ui-choice', 'ui-choice--block',
        inert ? 'ui-choice--disabled' : '',
        invalid ? 'ui-choice--error' : '',
        extra ?? '',
      ].filter(Boolean).join(' ')}
      data-ui-state={forcedAttr(forceState)}
    >
      <input
        id={id}
        name={name}
        value={value}
        type="radio"
        class="ui-choice-input"
        checked={checked}
        disabled={disabled}
        aria-invalid={invalid || undefined}
        aria-describedby={[describedBy, descId].filter(Boolean).join(' ') || undefined}
        aria-label={aria['aria-label']}
        onChange={() => { if (!readOnly) onChange(); }}
      />
      <span class="ui-choice-box ui-choice-box--radio" aria-hidden="true">
        <span class="ui-choice-dot" />
      </span>
      {(label != null || description) && (
        <span class="ui-choice-copy">
          {label != null && <span class="ui-choice-label">{label}</span>}
          {description && <span class="ui-choice-desc" id={descId}>{description}</span>}
        </span>
      )}
    </label>
  );
}

/* ── Switch ────────────────────────────────────────────────────────────────*/

export interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: ComponentChildren;
  description?: string;
  disabled?: boolean;
  /** Shows a spinner-free busy state while the change is being persisted. */
  pending?: boolean;
  name?: string;
  id?: string;
  'aria-label'?: string;
  forceState?: UiState;
  class?: string;
}

/**
 * An on/off setting that takes effect IMMEDIATELY.
 *
 * `role="switch"` rather than a plain checkbox, so it is announced as "on/off"
 * instead of "checked" — which is the difference between "this setting is on"
 * and "this box will be submitted ticked".
 */
export function Switch({
  checked, onChange, label, description, disabled = false, pending = false,
  name, id: ownId, forceState, class: extra, ...aria
}: SwitchProps): VNode {
  const ctx = useFieldContext();
  const { id, describedBy, disabled: ctxDisabled } =
    resolveFieldState(ctx, { disabled, id: ownId });
  const uid = useId();
  const descId = description ? `sw${uid}-desc` : undefined;
  const inert = ctxDisabled || pending;

  return (
    <label
      class={['ui-choice', label != null ? 'ui-choice--block' : '', inert ? 'ui-choice--disabled' : '', extra ?? '']
        .filter(Boolean).join(' ')}
      data-ui-state={forcedAttr(forceState)}
    >
      <input
        id={id}
        name={name}
        type="checkbox"
        role="switch"
        class="ui-choice-input"
        checked={checked}
        disabled={inert}
        aria-busy={pending || undefined}
        aria-describedby={[describedBy, descId].filter(Boolean).join(' ') || undefined}
        aria-label={aria['aria-label']}
        onChange={e => {
          // Guarded as well as `disabled`: a disabled input still fires change
          // in some environments, and a setting that applies immediately must
          // not fire twice while the first change is still in flight.
          if (inert) { (e.target as HTMLInputElement).checked = checked; return; }
          onChange((e.target as HTMLInputElement).checked);
        }}
      />
      <span class="ui-switch-track" aria-hidden="true"><span class="ui-switch-knob" /></span>
      {(label != null || description) && (
        <span class="ui-choice-copy">
          {label != null && <span class="ui-choice-label">{label}</span>}
          {description && <span class="ui-choice-desc" id={descId}>{description}</span>}
        </span>
      )}
    </label>
  );
}

/* ── Groups ────────────────────────────────────────────────────────────────*/

export interface ChoiceOption<T extends string> {
  value: T;
  label: string;
  description?: string;
  disabled?: boolean;
}

export interface CheckboxGroupProps<T extends string> {
  values: readonly T[];
  onChange: (values: T[]) => void;
  options: readonly ChoiceOption<T>[];
  /** Accessible name for the set. */
  label: string;
  /** Adds a tri-state select-all above the options. */
  selectAllLabel?: string;
  inline?: boolean;
  disabled?: boolean;
  readOnly?: boolean;
  error?: boolean;
  class?: string;
}

export function CheckboxGroup<T extends string>({
  values, onChange, options, label, selectAllLabel,
  inline = false, disabled = false, readOnly = false, error = false, class: extra,
}: CheckboxGroupProps<T>): VNode {
  const selectable = options.filter(o => !o.disabled);
  const allSelected = selectable.length > 0 && selectable.every(o => values.includes(o.value));
  const someSelected = selectable.some(o => values.includes(o.value));

  function toggle(value: T, next: boolean): void {
    onChange(next ? [...values, value] : values.filter(v => v !== value));
  }

  return (
    // `group`, not `radiogroup`: several independent booleans, not one value.
    <div class={extra} role="group" aria-label={label}>
      {selectAllLabel && (
        <div class="ui-choice-group-all">
          <Checkbox
            checked={allSelected}
            indeterminate={someSelected && !allSelected}
            disabled={disabled}
            readOnly={readOnly}
            label={selectAllLabel}
            onChange={next => onChange(next ? selectable.map(o => o.value) : [])}
          />
        </div>
      )}
      <div class={`ui-choice-group${inline ? ' ui-choice-group--inline' : ''}`}>
        {options.map(o => (
          <Checkbox
            key={o.value}
            checked={values.includes(o.value)}
            onChange={next => toggle(o.value, next)}
            label={o.label}
            description={o.description}
            disabled={disabled || o.disabled}
            readOnly={readOnly}
            error={error}
            value={o.value}
          />
        ))}
      </div>
    </div>
  );
}

export interface RadioGroupProps<T extends string> {
  value: T | '';
  onChange: (value: T) => void;
  options: readonly ChoiceOption<T>[];
  label: string;
  inline?: boolean;
  disabled?: boolean;
  readOnly?: boolean;
  error?: boolean;
  /** Shared `name`. Generated when omitted. */
  name?: string;
  class?: string;
}

export function RadioGroup<T extends string>({
  value, onChange, options, label, inline = false,
  disabled = false, readOnly = false, error = false, name, class: extra,
}: RadioGroupProps<T>): VNode {
  const uid = useId();
  const groupName = name ?? `rg${uid}`;

  return (
    // Native radios already provide roving focus and arrow-key movement within
    // a shared `name`, so this deliberately adds no key handling of its own.
    <div class={extra} role="radiogroup" aria-label={label} aria-invalid={error || undefined}>
      <div class={`ui-choice-group${inline ? ' ui-choice-group--inline' : ''}`}>
        {options.map(o => (
          <Radio
            key={o.value}
            name={groupName}
            value={o.value}
            checked={value === o.value}
            onChange={() => onChange(o.value)}
            label={o.label}
            description={o.description}
            disabled={disabled || o.disabled}
            readOnly={readOnly}
            error={error}
          />
        ))}
      </div>
    </div>
  );
}
