/**
 * src/components/common/actions/actionModalTypes.ts
 *
 * Types for the ActionModal — the enriched replacement for bare dialog.confirm /
 * dialog.prompt on lifecycle actions (reject / cancel / archive / verify / lock /
 * reopen / retire). Unlike a cpop popup, it shows the RECORD it acts on, a warning,
 * an optional reason, and what happens next. See docs/DIALOGS_AND_FORMS_DESIGN_SPEC.md §2.4.
 */

export type ActionTone = 'default' | 'danger' | 'warning' | 'info' | 'success';

export interface ActionRecordField {
  label: string;
  value: string | number | boolean | null | undefined;
  tone?: ActionTone;
}

export interface ActionRecordBadge {
  label: string;
  tone?: ActionTone;
}

/** The record the action affects — always shown, so the user sees what they're deciding on. */
export interface ActionRecord {
  title: string;
  subtitle?: string;
  icon?: string;
  badges?: ActionRecordBadge[];
  fields?: ActionRecordField[];
}

export interface ActionReasonConfig {
  required?: boolean;
  label?: string;
  placeholder?: string;
  type?: 'text' | 'textarea';
}

export interface ActionModalConfig {
  title: string;
  subtitle?: string;
  icon?: string;
  /** Colours the header icon + primary button (danger = red). */
  tone?: ActionTone;
  record?: ActionRecord;
  /** A prominent warning callout (e.g. "Rejecting returns this item to draft."). */
  warning?: string;
  /** Ask for a reason; when required, the confirm button stays disabled until filled. */
  reason?: ActionReasonConfig;
  /** Plain-language side-effects shown under the record. */
  whatNext?: string[];
  confirmLabel?: string;
  cancelLabel?: string;
}

export interface ActionModalResult {
  confirmed: boolean;
  reason?: string;
}
