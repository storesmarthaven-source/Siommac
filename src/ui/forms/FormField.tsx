/**
 * src/ui/forms/FormField.tsx — the ONE field shell.
 *
 * Owns everything that surrounds a control so no individual input has to
 * reinvent it: label, required marker, help text, validation icon + message,
 * character count, spacing, and the full aria relationship between them.
 *
 * Replaces `src/ui/components/Field.tsx`, which rendered a label with no `for`
 * attribute and had no concept of error, required, help, disabled or read-only.
 * That gap is why `EmployeeCreatePage`, `EmployeeProfileDialogs`, `EmployeeModal`
 * and `PayslipStudio` each grew a private `Field` with validation bolted on.
 *
 * ── Validation precedence ───────────────────────────────────────────────────
 * error > warning > success. Only ONE message renders. A field that is both
 * invalid and "looks good" is a contradiction, and showing both leaves the user
 * to guess which one blocks submission.
 */

import { type VNode, type ComponentChildren } from 'preact';
import { useId } from 'preact/hooks';
import { LucideIcon } from '../LucideIcon';
import { type ValidationState } from '../tokens';
import { FieldContext, type FieldContextValue } from './fieldContext';
import '../primitives/control.recipe.css';

export interface FormFieldProps {
  label: string;
  /** Marks the field required, both visually and for assistive tech. */
  required?: boolean;
  /** Guidance shown under the label. Always visible — not a tooltip. */
  helpText?: string;

  /** Highest precedence. Presence of a string sets the field invalid. */
  error?: string;
  warning?: string;
  success?: string;

  /** Live character count. `max` over-run is shown in the error colour. */
  charCount?: { value: number; max: number };

  disabled?: boolean;
  readOnly?: boolean;

  /** Span both columns of a `FormGrid`. */
  wide?: boolean;
  /** Override the generated control id (rarely needed). */
  htmlFor?: string;
  class?: string;

  children: ComponentChildren;
}

const VALIDATION_ICON = {
  error:   'CircleAlert',
  warning: 'TriangleAlert',
  success: 'CircleCheck',
} as const;

export function FormField({
  label, required = false, helpText,
  error, warning, success,
  charCount, disabled = false, readOnly = false,
  wide = false, htmlFor, class: extra, children,
}: FormFieldProps): VNode {
  const uid = useId();
  const controlId = htmlFor ?? `f${uid}`;
  const helpId = `${controlId}-help`;
  const msgId = `${controlId}-msg`;

  // error > warning > success — exactly one wins.
  const validation: ValidationState = error ? 'error' : warning ? 'warning' : success ? 'success' : 'none';
  const message = error ?? warning ?? success;

  // Only reference ids that are actually rendered. A dangling aria-describedby
  // makes a screen reader announce nothing at all for the field.
  const describedByIds = [helpText ? helpId : null, message ? msgId : null].filter((v): v is string => v !== null);
  const describedBy = describedByIds.length > 0 ? describedByIds.join(' ') : undefined;

  const ctx: FieldContextValue = {
    controlId, describedBy,
    validation, required, disabled, readOnly,
  };

  const overCount = charCount ? charCount.value > charCount.max : false;

  return (
    <div class={`ui-field2${wide ? ' ui-field2--wide' : ''}${disabled ? ' ui-field2--disabled' : ''}${extra ? ` ${extra}` : ''}`}>
      <label class="ui-field2-label" for={controlId}>
        {label}
        {required && (
          // `aria-hidden` on the glyph + a visually-hidden word, so the marker
          // is announced as "required" rather than read out as "asterisk".
          <>
            <span class="ui-field2-required" aria-hidden="true">*</span>
            <span class="ui-sr-only">(required)</span>
          </>
        )}
      </label>

      <FieldContext.Provider value={ctx}>{children}</FieldContext.Provider>

      {helpText && <div class="ui-field2-help" id={helpId}>{helpText}</div>}

      {(message !== undefined || charCount !== undefined) && (
        <div class="ui-field2-foot">
          {message
            ? (
              <div
                class={`ui-field2-msg ui-field2-msg--${validation}`}
                id={msgId}
                // Errors interrupt; warnings and confirmations wait for a pause.
                role={validation === 'error' ? 'alert' : 'status'}
              >
                <LucideIcon name={VALIDATION_ICON[validation as keyof typeof VALIDATION_ICON]} />
                <span>{message}</span>
              </div>
            )
            : <span />}
          {charCount && (
            <span class={`ui-field2-count${overCount ? ' ui-field2-count--over' : ''}`}>
              {charCount.value}/{charCount.max}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * The standard two-column form grid.
 *
 * Container-query driven, so a form inside a narrow drawer collapses to one
 * column even when the window is wide — which the old viewport media query on
 * `.ui-form-grid` could not do.
 */
export function FormGrid({ children, class: extra }: { children: ComponentChildren; class?: string }): VNode {
  return <div class={`ui-form-grid2${extra ? ` ${extra}` : ''}`}>{children}</div>;
}
