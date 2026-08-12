/**
 * Wizard.test.tsx — the step-machine contract.
 *
 * The assertions concentrate on the behaviour that makes Wizard its own
 * component rather than a Tabs variant: the gate. Advancing is refused while
 * the current step is invalid, the refusal is ANNOUNCED rather than silently
 * disabling a button, and an async on-the-way-out check (a duplicate check, a
 * reservation) blocks the flow while it runs.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/preact';
import { Wizard, type WizardStep } from './index';

const step = (id: string, over: Partial<WizardStep> = {}): WizardStep => ({
  id,
  label: id[0]!.toUpperCase() + id.slice(1),
  render: () => <p>{id} body</p>,
  ...over,
});

const STEPS: WizardStep[] = [step('vendor'), step('lines'), step('review')];

function wiz(props: Partial<Parameters<typeof Wizard>[0]> = {}) {
  const onChange = vi.fn();
  const onSubmit = vi.fn();
  const result = render(
    <Wizard id="w" label="New bill steps" steps={STEPS} value="vendor"
      onChange={onChange} onSubmit={onSubmit} {...props} />,
  );
  return { ...result, onChange, onSubmit };
}

const primary = (name: string | RegExp): HTMLElement => screen.getByRole('button', { name });

describe('Wizard — structure', () => {
  it('renders the steps as an ordered list, not as tabs', () => {
    // A gated sequence announced as a tablist promises navigation the user
    // does not have. The <ol> is what gives a screen reader "3 of 5".
    const { container } = wiz();
    expect(screen.getByRole('navigation', { name: 'New bill steps' })).toBeTruthy();
    expect(container.querySelector('ol.ui-wizard-steps')).toBeTruthy();
    expect(screen.queryAllByRole('tab')).toHaveLength(0);
  });

  it('marks the current step with aria-current="step"', () => {
    wiz({ value: 'lines' });
    const marked = screen.getAllByRole('button').filter(b => b.getAttribute('aria-current') === 'step');
    expect(marked).toHaveLength(1);
    expect(marked[0]!.textContent).toContain('Lines');
  });

  it('renders only the current step\'s body, and only calls that step\'s render', () => {
    const renderLines = vi.fn(() => <p>lines body</p>);
    wiz({ value: 'vendor', steps: [step('vendor'), step('lines', { render: renderLines })] });
    expect(screen.getByText('vendor body')).toBeTruthy();
    expect(renderLines).not.toHaveBeenCalled();
  });

  it('carries orientation as configuration on one root', () => {
    const { container } = wiz({ orientation: 'vertical' });
    expect(container.querySelector('.ui-wizard--vertical')).toBeTruthy();
  });

  it('owns no overlay — no dialog, no backdrop', () => {
    // The three implementations it replaces each built their own. A modal
    // wizard is <Dialog><Wizard /></Dialog>.
    const { container } = wiz();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(container.querySelector('[class*="backdrop"]')).toBeNull();
  });
});

describe('Wizard — step status', () => {
  it('treats earlier steps as complete and later ones as upcoming by default', () => {
    const { container } = wiz({ value: 'lines' });
    expect(container.querySelector('.ui-wizard-step.is-complete')!.textContent).toContain('Vendor');
    expect(container.querySelector('.ui-wizard-step.is-current')!.textContent).toContain('Lines');
    expect(container.querySelector('.ui-wizard-step.is-upcoming')!.textContent).toContain('Review');
  });

  it('lets an explicit `completed` list override position', () => {
    // For flows that validate every step live, a later step can be complete
    // while you are back editing an earlier one.
    const { container } = wiz({ value: 'vendor', completed: ['lines'] });
    expect(container.querySelector('.ui-wizard-step.is-complete')!.textContent).toContain('Lines');
  });

  it('shows a skipped step as skipped, not complete', () => {
    const { container } = wiz({ value: 'review', skipped: ['lines'] });
    expect(container.querySelector('.ui-wizard-step.is-skipped')!.textContent).toContain('Lines');
  });

  it('marks a disabled step and keeps it unreachable', () => {
    const { container } = wiz({
      value: 'vendor',
      steps: [step('vendor'), step('lines', { disabled: true, disabledReason: 'No line permission' })],
    });
    expect(container.querySelector('.ui-wizard-step.is-disabled')).toBeTruthy();
    const btn = screen.getByRole<HTMLButtonElement>('button', { name: /Lines/ });
    expect(btn.disabled).toBe(true);
    expect(btn.getAttribute('title')).toBe('No line permission');
  });

  it('allows jumping BACK to a visited step but never forward', () => {
    const { onChange } = wiz({ value: 'lines' });
    fireEvent.click(screen.getByRole('button', { name: /Vendor/ }));
    expect(onChange).toHaveBeenCalledWith('vendor');

    onChange.mockClear();
    const forward = screen.getByRole<HTMLButtonElement>('button', { name: /Review/ });
    expect(forward.disabled).toBe(true);
    expect(forward.getAttribute('title')).toBe('Complete the earlier steps first');
  });
});

describe('Wizard — validation gate', () => {
  const invalid: WizardStep[] = [
    step('vendor', { validate: () => ['Pick a vendor', 'Enter a bill date'] }),
    step('lines'),
  ];

  it('refuses to advance and announces the issues instead of silently disabling', () => {
    const { onChange } = wiz({ steps: invalid });
    // The button is deliberately NOT disabled: a disabled control states no reason.
    const cont = primary(/Continue/) as HTMLButtonElement;
    expect(cont.disabled).toBe(false);

    fireEvent.click(cont);
    expect(onChange).not.toHaveBeenCalled();

    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('2 things need attention');
    expect(alert.textContent).toContain('Pick a vendor');
    expect(alert.textContent).toContain('Enter a bill date');
  });

  it('marks the current step invalid only after the refusal', () => {
    // Flagging every untouched required field the moment a wizard opens reads
    // as "you have already made a mistake".
    const { container } = wiz({ steps: invalid });
    expect(container.querySelector('.ui-wizard-step.is-invalid')).toBeNull();
    fireEvent.click(primary(/Continue/));
    expect(container.querySelector('.ui-wizard-step.is-invalid')!.textContent).toContain('Vendor');
  });

  it('advances once the step validates', () => {
    const { onChange } = wiz({ steps: [step('vendor', { validate: () => null }), step('lines')] });
    fireEvent.click(primary(/Continue/));
    expect(onChange).toHaveBeenCalledWith('lines');
  });

  it('accepts a single string as one issue', () => {
    wiz({ steps: [step('vendor', { validate: () => 'Pick a vendor' }), step('lines')] });
    fireEvent.click(primary(/Continue/));
    expect(screen.getByRole('alert').textContent).toContain('One thing needs attention');
  });

  it('blocks Submit on the last step too', () => {
    const { onSubmit } = wiz({
      value: 'review',
      steps: [step('vendor'), step('review', { validate: () => 'Confirm the total' })],
    });
    fireEvent.click(primary(/Submit/));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toBeTruthy();
  });
});

describe('Wizard — async leave hook', () => {
  it('awaits onBeforeNext and advances when it resolves', async () => {
    const check = vi.fn(async () => { /* duplicate check */ });
    const { onChange } = wiz({ steps: [step('vendor', { onBeforeNext: check }), step('lines')] });
    fireEvent.click(primary(/Continue/));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith('lines'));
    expect(check).toHaveBeenCalledTimes(1);
  });

  it('stays on the step when onBeforeNext returns false', async () => {
    const { onChange } = wiz({
      steps: [step('vendor', { onBeforeNext: () => false }), step('lines')],
    });
    fireEvent.click(primary(/Continue/));
    await waitFor(() => expect(onChange).not.toHaveBeenCalled());
  });

  it('does NOT run onBeforeNext when the step is invalid', async () => {
    // Otherwise a duplicate check fires against a half-filled form.
    const check = vi.fn();
    wiz({ steps: [step('vendor', { validate: () => 'Pick a vendor', onBeforeNext: check }), step('lines')] });
    fireEvent.click(primary(/Continue/));
    await waitFor(() => expect(check).not.toHaveBeenCalled());
  });
});

describe('Wizard — footer', () => {
  it('hides Back on the first step and shows Submit on the last', () => {
    const { rerender } = wiz({ value: 'vendor' });
    expect(screen.queryByRole('button', { name: /Back/ })).toBeNull();
    expect(primary(/Continue/)).toBeTruthy();

    rerender(<Wizard id="w" label="s" steps={STEPS} value="review" onChange={vi.fn()} onSubmit={vi.fn()} />);
    expect(screen.getByRole('button', { name: /Back/ })).toBeTruthy();
    expect(primary(/Submit/)).toBeTruthy();
  });

  it('takes a per-step primary label, so "Review" is not a special case', () => {
    const { container } = wiz({
      value: 'lines',
      steps: [step('vendor'), step('lines', { nextLabel: 'Review' }), step('summary')],
    });
    expect(container.querySelector('.ui-wizard-foot-right .ui-btn--primary')!.textContent)
      .toContain('Review');
  });

  it('renders Save draft only when a handler is given', () => {
    const onSaveDraft = vi.fn();
    const { rerender } = wiz();
    expect(screen.queryByRole('button', { name: /Save draft/ })).toBeNull();

    rerender(<Wizard id="w" label="s" steps={STEPS} value="vendor" onChange={vi.fn()} onSubmit={vi.fn()} onSaveDraft={onSaveDraft} />);
    fireEvent.click(screen.getByRole('button', { name: /Save draft/ }));
    expect(onSaveDraft).toHaveBeenCalledTimes(1);
  });

  it('offers Skip on an optional step only, and reports it before advancing', () => {
    const onSkip = vi.fn();
    const { onChange } = wiz({
      value: 'lines',
      steps: [step('vendor'), step('lines', { optional: true }), step('review')],
      onSkip,
    });
    fireEvent.click(screen.getByRole('button', { name: 'Skip' }));
    expect(onSkip).toHaveBeenCalledWith('lines');
    expect(onChange).toHaveBeenCalledWith('review');
  });

  it('has no Skip on a required step', () => {
    wiz({ value: 'lines' });
    expect(screen.queryByRole('button', { name: 'Skip' })).toBeNull();
  });

  it('marks an optional step in its accessible name', () => {
    wiz({ steps: [step('vendor'), step('lines', { optional: true })] });
    expect(screen.getByRole('button', { name: 'Lines, optional' })).toBeTruthy();
  });
});

describe('Wizard — busy', () => {
  it('disables navigation and marks the flow busy while submitting', () => {
    const { container } = wiz({ value: 'review', busy: true });
    expect(container.querySelector('.ui-wizard')!.getAttribute('aria-busy')).toBe('true');
    expect(screen.getByRole<HTMLButtonElement>('button', { name: /Back/ }).disabled).toBe(true);
  });

  it('locks step jumping while busy so a queued click cannot land mid-submit', () => {
    wiz({ value: 'lines', busy: true });
    expect(screen.getByRole<HTMLButtonElement>('button', { name: /Vendor/ }).disabled).toBe(true);
  });

  it('keeps Cancel disabled during a submit but still rendered', () => {
    const onCancel = vi.fn();
    wiz({ busy: true, onCancel });
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Cancel' }).disabled).toBe(true);
  });
});

describe('Wizard — focus', () => {
  it('moves focus to the step body when the step changes, but not on mount', async () => {
    // On mount the wizard is usually inside a Dialog that has just placed focus;
    // stealing it would undo that.
    const { container, rerender } = wiz({ value: 'vendor' });
    const panel = container.querySelector('.ui-wizard-panel')!;
    expect(document.activeElement).not.toBe(panel);

    rerender(<Wizard id="w" label="s" steps={STEPS} value="lines" onChange={vi.fn()} onSubmit={vi.fn()} />);
    await waitFor(() => expect(document.activeElement).toBe(container.querySelector('.ui-wizard-panel')));
  });

  it('labels the body with the current step so focus lands somewhere named', () => {
    const { container } = wiz({ value: 'lines' });
    const panel = container.querySelector('.ui-wizard-panel')!;
    expect(panel.getAttribute('aria-labelledby')).toBe('w-step-lines');
    expect(document.getElementById('w-step-lines')).toBeTruthy();
  });

  it('clears a revealed error when the step changes', () => {
    const { rerender } = wiz({ steps: [step('vendor', { validate: () => 'Pick a vendor' }), step('lines')] });
    fireEvent.click(primary(/Continue/));
    expect(screen.getByRole('alert')).toBeTruthy();

    rerender(
      <Wizard id="w" label="s" value="lines" onChange={vi.fn()} onSubmit={vi.fn()}
        steps={[step('vendor', { validate: () => 'Pick a vendor' }), step('lines')]} />,
    );
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
