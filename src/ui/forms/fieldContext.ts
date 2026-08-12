/**
 * src/ui/forms/fieldContext.ts — how a FormField talks to its control.
 *
 * The old `Field` component rendered a label and stopped there: the label was
 * not associated with the input, and error/required/disabled state had to be
 * threaded through by hand at every call site. Nobody did, which is why four
 * modules grew their own `Field` with validation bolted on.
 *
 * A context solves it structurally. `FormField` publishes the wiring; every kit
 * control consumes it automatically. The call site stays clean —
 *
 *   <FormField label="Employee" required error={errors.employee}>
 *     <PersonSearchSelect value={v} onChange={setV} />
 *   </FormField>
 *
 * — and there is no per-field aria plumbing anyone can forget, because there is
 * no per-field aria plumbing at all.
 *
 * Controls used OUTSIDE a FormField get an empty context and fall back to their
 * own props, so a bare <TextInput> in a toolbar still works.
 */

import { createContext } from 'preact';
import { useContext } from 'preact/hooks';
import { type ValidationState } from '../tokens';

export interface FieldContextValue {
  /** id for the control; the label's `for` points at it. */
  controlId: string;
  /** Space-separated ids of the help text and message elements. */
  describedBy: string | undefined;
  validation: ValidationState;
  required: boolean;
  disabled: boolean;
  readOnly: boolean;
}

/**
 * `null` means "not inside a FormField" — distinct from a FormField that
 * happens to have no validation. Controls need to tell those apart so they know
 * whether to trust the context or their own props.
 */
export const FieldContext = createContext<FieldContextValue | null>(null);

export function useFieldContext(): FieldContextValue | null {
  return useContext(FieldContext);
}

/**
 * Resolve the effective control state from context and the control's own props.
 *
 * An explicit prop always wins. A control can legitimately be disabled inside an
 * otherwise-enabled field (a locked row in an editable table), and forcing it to
 * inherit would make that impossible to express.
 */
export function resolveFieldState(
  ctx: FieldContextValue | null,
  own: { validation?: ValidationState; disabled?: boolean; readOnly?: boolean; id?: string },
): { id: string | undefined; describedBy: string | undefined; validation: ValidationState; disabled: boolean; readOnly: boolean; required: boolean } {
  return {
    id:          own.id ?? ctx?.controlId,
    describedBy: ctx?.describedBy,
    validation:  own.validation ?? ctx?.validation ?? 'none',
    disabled:    own.disabled   ?? ctx?.disabled   ?? false,
    readOnly:    own.readOnly   ?? ctx?.readOnly   ?? false,
    required:    ctx?.required ?? false,
  };
}
