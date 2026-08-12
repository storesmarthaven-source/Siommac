/**
 * src/ui/navigation/Wizard/Wizard.tsx — the ONE multi-step flow.
 *
 * Three overlapping models existed: `Wizard` (`.wz-*`, its own backdrop + modal
 * + header + close button), `WizardShell` (`.ui-wz-*`, its own backdrop + a navy
 * left rail with info panels) and `HrfinWizardModal` (`.hrfin-wiz-*`, its own
 * portal + a progress-bar step indicator). Each had re-implemented the dialog
 * around itself, which is why none of them could be used on a page and why a
 * wizard's chrome never matched the app's dialogs.
 *
 * ── What this component is, and is not ──────────────────────────────────────
 * It is the STEP MACHINE and its frame: the step list, the current step's body,
 * the validation gate, and the Back / Skip / Continue / Submit footer.
 *
 * It is NOT a modal. A modal wizard is composed:
 *
 *     <Dialog open={open} onClose={close} size="lg" variant="workspace" busy={saving}>
 *       <Dialog.Header title="New bill" />
 *       <Wizard … />
 *     </Dialog>
 *
 * There is deliberately no `WizardModal`. Owning the overlay is what forced
 * three implementations to exist, and it is also what made a wizard impossible
 * to put on a page — `ImportWizard` and the onboarding launcher both want the
 * same steps without a sheet around them.
 *
 * Business content is composed, never hardcoded: each step supplies `render()`,
 * which the wizard calls only for the step being shown.
 *
 * ── Why Wizard is not Tabs with extra props ─────────────────────────────────
 * The interaction model genuinely differs (RECIPES.md §7). A tab set is free
 * navigation between peers; a wizard is an ORDERED, GATED sequence — you cannot
 * reach step 4 until 1–3 validate, "completed" and "skipped" are real states a
 * tab has no equivalent for, and the terminal action is a submit rather than a
 * selection. Steps are therefore `aria-current="step"` in a `<nav>`, NOT
 * role="tab": announcing a gated step as a tab promises navigation the user
 * does not have.
 */

import { type VNode, type ComponentChildren } from 'preact';
import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { Button } from '../../primitives/Button';
import { LucideIcon } from '../../LucideIcon';
import './wizard.recipe.css';

export type WizardOrientation = 'horizontal' | 'vertical';

/**
 * Every state a step can be in. `invalid` is only ever the CURRENT step — a
 * step you have not reached yet has not been validated and must not be shown
 * as failing.
 */
export type WizardStepStatus =
  | 'current' | 'complete' | 'upcoming' | 'skipped' | 'invalid' | 'disabled';

/** `null`/`undefined`/`[]` mean valid. A string is one issue. */
export type WizardIssues = string | readonly string[] | null | undefined;

export interface WizardStep {
  id: string;
  label: string;
  /** One supporting line under the label. */
  description?: string;
  /** A NODE, not a FontAwesome class string. */
  icon?: ComponentChildren;

  /** Optional steps show a Skip control and never block Submit. */
  optional?: boolean;
  /** Not reachable at all — a permission or a data precondition. */
  disabled?: boolean;
  /** Why it is unreachable. Shown as the step's title. */
  disabledReason?: string;

  /**
   * What is stopping this step from being left. Evaluated for the CURRENT step
   * on every render, so the footer can reflect live edits.
   *
   * It must be a cheap, PURE predicate over state you already have — it is not
   * a place to fetch. For work that has to happen on the way out (a duplicate
   * check, a reservation), use `onBeforeNext`.
   */
  validate?: () => WizardIssues;

  /**
   * Runs when leaving this step FORWARDS, after `validate` passes. May be async
   * — the wizard shows its busy state while it runs, so a duplicate check does
   * not need the caller to manage a spinner flag.
   *
   * Returning (or resolving to) exactly `false` keeps the user on the step.
   * Anything else — including the `undefined` an `async () => {}` resolves to —
   * advances, which is why the return type is deliberately `unknown` rather
   * than a union that would force every caller to return something.
   */
  onBeforeNext?: () => unknown;

  /** Primary-button label while on this step. Use it for "Review". */
  nextLabel?: string;

  /** The step's body. Called only for the step being shown. */
  render: () => ComponentChildren;
}

export interface WizardProps {
  /** Base id — the step nav and the panel derive their ids from it. */
  id: string;
  /** Accessible name for the step navigation, e.g. "New bill steps". */
  label: string;
  steps: readonly WizardStep[];

  /** Current step id. Controlled, like Tabs. */
  value: string;
  onChange: (id: string) => void;

  /**
   * Which steps count as complete. When omitted, completion is POSITIONAL —
   * everything before the current step. Pass it when the flow validates every
   * step live and a later step can be complete while you are editing an
   * earlier one.
   */
  completed?: readonly string[];
  /** Optional steps the user chose to skip. */
  skipped?: readonly string[];
  /** Called when an optional step is skipped, before the wizard advances. */
  onSkip?: (id: string) => void;

  onSubmit: () => void | Promise<void>;
  submitLabel?: string;
  /** Blocks Submit for a reason validation cannot express (a server precondition). */
  submitDisabled?: boolean;

  /** A submit (or an async `onBeforeNext`) is in flight. */
  busy?: boolean;

  onCancel?: () => void;
  cancelLabel?: string;
  /** Renders a Save-draft control in the footer. */
  onSaveDraft?: () => void;
  saveDraftLabel?: string;

  backLabel?: string;
  continueLabel?: string;

  orientation?: WizardOrientation;
  /** Extra rail content under the step list — a live summary, a permissions note. */
  aside?: ComponentChildren;
  /** Left-aligned footer note. */
  footNote?: ComponentChildren;
  class?: string;
}

const toIssues = (v: WizardIssues): string[] => (
  v === null || v === undefined ? [] : typeof v === 'string' ? [v] : [...v]
);

export const wizardStepDomId = (id: string, stepId: string): string => `${id}-step-${stepId}`;
export const wizardPanelDomId = (id: string): string => `${id}-panel`;

export function Wizard({
  id, label, steps, value, onChange,
  completed, skipped, onSkip,
  onSubmit, submitLabel = 'Submit', submitDisabled = false, busy = false,
  onCancel, cancelLabel = 'Cancel', onSaveDraft, saveDraftLabel = 'Save draft',
  backLabel = 'Back', continueLabel = 'Continue',
  orientation = 'horizontal', aside, footNote, class: extra,
}: WizardProps): VNode {
  const index = Math.max(0, steps.findIndex(s => s.id === value));
  const current = steps[index];
  const isLast = index === steps.length - 1;

  /**
   * Issues are hidden until the user tries to leave the step.
   *
   * Showing them the moment a wizard opens marks every empty required field red
   * before the user has typed anything, which reads as "you have already made a
   * mistake". Revealing resets on every step change.
   */
  const [revealed, setRevealed] = useState(false);
  const [pending, setPending] = useState(false);

  /* Not memoised: `steps` is rebuilt by the caller on every render (the bodies
     are closures over their form state), so a memo keyed on it would never hit.
     `validate` is contractually a cheap pure predicate. */
  const issues = toIssues(current?.validate?.());
  const blocked = issues.length > 0;

  const panelRef = useRef<HTMLDivElement>(null);
  /** The step whose panel already holds focus — state, not a ref, so the
   *  first render is skipped without mutating anything after render. */
  const [focusedStep, setFocusedStep] = useState(value);

  /**
   * Move focus to the new step's panel.
   *
   * Without this, activating Continue leaves focus on a button that is now
   * labelled differently and sits below content the user has never seen — a
   * screen-reader user is given no signal that the whole body changed. The
   * first render is skipped: the wizard usually mounts inside a Dialog that has
   * just placed focus itself, and stealing it would undo that.
   */
  useEffect(() => {
    setRevealed(false);
    if (focusedStep === value) return;
    panelRef.current?.focus();
    setFocusedStep(value);
  }, [value, focusedStep]);

  const statusOf = useCallback((step: WizardStep, i: number): WizardStepStatus => {
    if (step.disabled) return 'disabled';
    if (step.id === value) return revealed && blocked ? 'invalid' : 'current';
    if (skipped?.includes(step.id)) return 'skipped';
    if (completed) return completed.includes(step.id) ? 'complete' : 'upcoming';
    return i < index ? 'complete' : 'upcoming';
  }, [value, revealed, blocked, skipped, completed, index]);

  /** The furthest step the user may jump to directly: back only, never forward. */
  const canJumpTo = useCallback((step: WizardStep, i: number): boolean => {
    if (step.disabled || busy || pending) return false;
    if (completed) return completed.includes(step.id) || i <= index;
    return i < index;
  }, [busy, pending, completed, index]);

  const goTo = (i: number): void => {
    const step = steps[i];
    if (step) onChange(step.id);
  };

  const back = (): void => { if (index > 0) goTo(index - 1); };

  const advance = async (): Promise<void> => {
    if (!current) return;
    if (blocked) { setRevealed(true); return; }

    if (current.onBeforeNext) {
      setPending(true);
      try {
        const ok = await current.onBeforeNext();
        if (ok === false) return;
      } finally {
        setPending(false);
      }
    }
    goTo(index + 1);
  };

  const skip = (): void => {
    if (!current) return;
    onSkip?.(current.id);
    goTo(index + 1);
  };

  const submit = async (): Promise<void> => {
    if (blocked) { setRevealed(true); return; }
    await onSubmit();
  };

  const working = busy || pending;
  const primaryLabel = isLast ? submitLabel : (current?.nextLabel ?? continueLabel);

  const cls = [
    'ui-wizard',
    `ui-wizard--${orientation}`,
    working ? 'is-busy' : '',
    extra ?? '',
  ].filter(Boolean).join(' ');

  return (
    <div class={cls} aria-busy={working ? 'true' : undefined}>
      <nav class="ui-wizard-nav" aria-label={label}>
        {/* An ordered list, because the ORDER is the meaning — a screen reader
            announces "3 of 5" from the list, which a row of buttons cannot. */}
        <ol class="ui-wizard-steps">
          {steps.map((step, i) => {
            const status = statusOf(step, i);
            const jumpable = canJumpTo(step, i);
            const name = [
              step.label,
              step.optional ? 'optional' : undefined,
              status === 'complete' ? 'completed' : status === 'skipped' ? 'skipped'
                : status === 'invalid' ? 'needs attention' : undefined,
            ].filter(Boolean).join(', ');
            return (
              <li key={step.id} class={`ui-wizard-step is-${status}`}>
                <button
                  id={wizardStepDomId(id, step.id)}
                  type="button"
                  class="ui-wizard-step-btn"
                  aria-current={step.id === value ? 'step' : undefined}
                  aria-label={name === step.label ? undefined : name}
                  aria-controls={wizardPanelDomId(id)}
                  disabled={!jumpable}
                  title={step.disabled ? step.disabledReason : jumpable ? undefined : 'Complete the earlier steps first'}
                  onClick={() => { if (jumpable) goTo(i); }}
                >
                  <span class="ui-wizard-marker" aria-hidden="true">
                    {status === 'complete' ? <LucideIcon name="Check" size={14} />
                      : status === 'skipped' ? <LucideIcon name="Minus" size={14} />
                        : status === 'invalid' ? <LucideIcon name="TriangleAlert" size={14} />
                          : step.icon ?? i + 1}
                  </span>
                  <span class="ui-wizard-step-text">
                    <strong class="ui-wizard-step-label">
                      {step.label}
                      {step.optional && <span class="ui-wizard-optional">Optional</span>}
                    </strong>
                    {step.description !== undefined && (
                      <span class="ui-wizard-step-desc">{step.description}</span>
                    )}
                  </span>
                </button>
              </li>
            );
          })}
        </ol>

        {/* Mobile: the step list collapses to a position + a progress bar. The
            full list at phone width is either five illegible columns or a
            300px-tall header above the field the user came to fill in. */}
        <div class="ui-wizard-progress" aria-hidden="true">
          <span class="ui-wizard-progress-text">
            Step {index + 1} of {steps.length} — {current?.label}
          </span>
          <span class="ui-wizard-progress-track">
            <span
              class="ui-wizard-progress-fill"
              style={{ width: `${((index + 1) / Math.max(steps.length, 1)) * 100}%` }}
            />
          </span>
        </div>

        {aside != null && <div class="ui-wizard-aside">{aside}</div>}
      </nav>

      <div class="ui-wizard-main">
        {revealed && blocked && (
          /* role="alert" so it is announced the moment Continue is refused —
             a silently disabled button gives a screen-reader user nothing. */
          <div class="ui-wizard-issues" role="alert">
            <LucideIcon name="TriangleAlert" size={15} />
            <div>
              <strong>{issues.length === 1 ? 'One thing needs attention' : `${issues.length} things need attention`}</strong>
              <ul>{issues.map(m => <li key={m}>{m}</li>)}</ul>
            </div>
          </div>
        )}

        <div
          ref={panelRef}
          id={wizardPanelDomId(id)}
          class="ui-wizard-panel"
          role="group"
          aria-labelledby={current ? wizardStepDomId(id, current.id) : undefined}
          tabIndex={-1}
        >
          {current?.render()}
        </div>
      </div>

      <div class="ui-wizard-foot">
        <div class="ui-wizard-foot-left">
          {onCancel && (
            <Button variant="ghost" onClick={onCancel} disabled={working}>{cancelLabel}</Button>
          )}
          {footNote != null && <span class="ui-wizard-foot-note">{footNote}</span>}
        </div>

        <div class="ui-wizard-foot-right">
          {onSaveDraft && (
            <Button variant="secondary" onClick={onSaveDraft} disabled={working}
              iconLeft={<LucideIcon name="Save" />}>{saveDraftLabel}</Button>
          )}
          {index > 0 && (
            <Button variant="secondary" onClick={back} disabled={working}
              iconLeft={<LucideIcon name="ArrowLeft" />}>{backLabel}</Button>
          )}
          {!isLast && current?.optional && (
            <Button variant="ghost" onClick={skip} disabled={working}>Skip</Button>
          )}
          {isLast ? (
            <Button
              variant="primary"
              onClick={() => { void submit(); }}
              loading={working}
              /* Validation does NOT disable this button. A disabled control
                 states no reason; refusing the click and announcing the issues
                 does. `submitDisabled` is for preconditions validation cannot
                 express. */
              disabled={submitDisabled}
            >
              {primaryLabel}
            </Button>
          ) : (
            <Button
              variant="primary"
              onClick={() => { void advance(); }}
              loading={working}
              iconRight={<LucideIcon name="ArrowRight" />}
            >
              {primaryLabel}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
