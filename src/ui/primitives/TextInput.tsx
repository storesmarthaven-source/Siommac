/**
 * src/ui/primitives/TextInput.tsx — canonical single-line and multi-line text entry.
 *
 * Replaces `TextInput`/`TextareaInput` from `src/ui/components/Field.tsx`, which
 * accepted only value/onInput/placeholder/type — no error, no disabled, no
 * read-only, no id. 37 files used it and every one that needed validation had to
 * build its own.
 *
 * Inside a `<FormField>` this needs no wiring at all: id, `aria-describedby`,
 * `aria-invalid`, `required`, `disabled` and `readOnly` all arrive through
 * context. Its own props still win when passed, so a single locked control
 * inside an editable field is expressible.
 *
 * ── Trailing affordance priority ────────────────────────────────────────────
 * Exactly one trailing element renders, chosen in this fixed order:
 *
 *     loading spinner  →  clear button  →  validation icon  →  iconRight
 *
 * Enforced here in TS, never by CSS stacking — that is what guarantees they can
 * never overlap, which was the visible bug in the old person-search control.
 */

import { type VNode } from 'preact';
import { useRef } from 'preact/hooks';
import { LucideIcon } from '../LucideIcon';
import { type ControlSize, type UiState, type ValidationState } from '../tokens';
import { useFieldContext, resolveFieldState } from '../forms/fieldContext';
import './control.recipe.css';

/**
 * Every `type` the app actually uses today, plus the ones the kit intends to
 * grow typed wrappers for. Kept as a union rather than `string` so a typo
 * ("nubmer") is a compile error instead of a silently plain text box.
 */
export type TextInputType =
  | 'text' | 'email' | 'url' | 'tel' | 'password' | 'search' | 'number'
  | 'date' | 'time' | 'datetime-local' | 'month' | 'week' | 'color';

export interface TextInputProps {
  value: string;
  onInput: (value: string) => void;

  size?: ControlSize;
  type?: TextInputType;
  placeholder?: string;

  /** Renders a <textarea> instead of an <input>. */
  multiline?: boolean;
  rows?: number;

  iconLeft?: VNode;
  iconRight?: VNode;
  /** Show a clear button once there is a value. */
  clearable?: boolean;

  disabled?: boolean;
  readOnly?: boolean;
  loading?: boolean;
  /** Overrides the FormField's validation state for this control alone. */
  validation?: ValidationState;

  maxLength?: number;
  minLength?: number;
  min?: number;
  max?: number;
  step?: number;
  autoComplete?: string;
  name?: string;
  id?: string;
  inputMode?: 'text' | 'numeric' | 'decimal' | 'tel' | 'email' | 'url' | 'search';

  onBlur?: () => void;
  onFocus?: () => void;
  onKeyDown?: (e: KeyboardEvent) => void;

  /** Accessible name when used OUTSIDE a FormField (toolbars, table filters). */
  'aria-label'?: string;

  /** Gallery-only forced visual state. See src/ui/RECIPES.md §5. */
  forceState?: UiState;
  class?: string;
}

const FORCEABLE: ReadonlySet<UiState> = new Set(['hover', 'focus', 'open']);

const VALIDATION_ICON = {
  error:   'CircleAlert',
  warning: 'TriangleAlert',
  success: 'CircleCheck',
} as const;

export function TextInput({
  value, onInput,
  size = 'md', type = 'text', placeholder,
  multiline = false, rows = 3,
  iconLeft, iconRight, clearable = false,
  disabled: ownDisabled, readOnly: ownReadOnly, loading = false,
  validation: ownValidation,
  maxLength, minLength, min, max, step, autoComplete, name, id: ownId, inputMode,
  onBlur, onFocus, onKeyDown,
  forceState, class: extra,
  ...aria
}: TextInputProps): VNode {
  const ctx = useFieldContext();
  const { id, describedBy, validation, disabled, readOnly, required } =
    resolveFieldState(ctx, { validation: ownValidation, disabled: ownDisabled, readOnly: ownReadOnly, id: ownId });

  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);

  // Fixed trailing priority — at most one of these ever renders.
  const showSpinner   = loading;
  const showClear     = !showSpinner && clearable && value.length > 0 && !disabled && !readOnly;
  const showValidIcon = !showSpinner && !showClear && validation !== 'none';
  const showOwnIcon   = !showSpinner && !showClear && !showValidIcon && iconRight != null;

  const forced = forceState && FORCEABLE.has(forceState) ? forceState : undefined;

  const boxClass = [
    'ui-ctrl',
    size !== 'md' ? `ui-ctrl--${size}` : '',
    multiline ? 'ui-ctrl--multiline' : '',
    validation !== 'none' ? `ui-ctrl--${validation}` : '',
    disabled ? 'ui-ctrl--disabled' : '',
    readOnly && !disabled ? 'ui-ctrl--readonly' : '',
    extra ?? '',
  ].filter(Boolean).join(' ');

  function handleClear(): void {
    onInput('');
    // Return focus to the field: a clear button that steals focus forces the
    // user to click back in before they can type the replacement value.
    inputRef.current?.focus();
  }

  const shared = {
    id,
    name,
    class: 'ui-ctrl-input',
    value,
    placeholder,
    disabled,
    readOnly,
    required: required || undefined,
    maxLength,
    minLength,
    autoComplete,
    'aria-invalid': validation === 'error' ? true : undefined,
    'aria-describedby': describedBy,
    'aria-label': aria['aria-label'],
    onBlur,
    onFocus,
    onKeyDown,
  };

  return (
    <div class={boxClass} data-ui-state={forced}>
      {iconLeft && <span class="ui-ctrl-lead" aria-hidden="true">{iconLeft}</span>}

      {multiline
        ? (
          <textarea
            {...shared}
            ref={el => { inputRef.current = el; }}
            rows={rows}
            onInput={e => onInput((e.target as HTMLTextAreaElement).value)}
          />
        )
        : (
          <input
            {...shared}
            ref={el => { inputRef.current = el; }}
            type={type}
            inputMode={inputMode}
            min={min}
            max={max}
            step={step}
            onInput={e => onInput((e.target as HTMLInputElement).value)}
          />
        )}

      {showSpinner && <span class="ui-ctrl-trail"><span class="ui-ctrl-spinner" role="status" aria-label="Loading" /></span>}

      {showClear && (
        <span class="ui-ctrl-trail">
          <button type="button" class="ui-ctrl-clear" onClick={handleClear} aria-label="Clear">
            <LucideIcon name="X" />
          </button>
        </span>
      )}

      {showValidIcon && (
        <span class={`ui-ctrl-trail ui-ctrl-validation-icon--${validation}`} aria-hidden="true">
          <LucideIcon name={VALIDATION_ICON[validation]} />
        </span>
      )}

      {showOwnIcon && <span class="ui-ctrl-trail" aria-hidden="true">{iconRight}</span>}
    </div>
  );
}

/**
 * Search field — a TextInput preset, not a separate control.
 *
 * Kept as a named export because "search box" is the single most duplicated
 * pattern in the app (`SearchInput`, `TableSearch`, and dozens of raw inputs),
 * and giving it one obvious name is what stops the next one being written by hand.
 */
export function SearchInput(
  props: Omit<TextInputProps, 'type' | 'iconLeft' | 'clearable'> & { clearable?: boolean },
): VNode {
  return (
    <TextInput
      {...props}
      type="search"
      inputMode="search"
      clearable={props.clearable ?? true}
      iconLeft={<LucideIcon name="Search" />}
      placeholder={props.placeholder ?? 'Search…'}
    />
  );
}
