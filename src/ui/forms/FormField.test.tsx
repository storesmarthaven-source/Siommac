/**
 * FormField.test.tsx + TextInput behaviour.
 *
 * The point of these is the WIRING — that a consumer who writes the obvious
 * thing gets a correctly associated, correctly announced field without doing
 * anything else. That is the entire reason the field shell exists, and it is
 * exactly what the previous `Field` failed at.
 */

import { describe, it, expect, vi } from 'vitest';
import { act, render, screen, fireEvent } from '@testing-library/preact';
import { FormField } from './FormField';
import { SearchInput, TextInput } from '../primitives/TextInput';
import { Field, SelectInput, TextareaInput } from '../components/Field';

describe('FormField', () => {
  it('associates the label with the control', () => {
    render(
      <FormField label="Employee name">
        <TextInput value="" onInput={vi.fn()} />
      </FormField>,
    );
    // getByLabelText only resolves if for/id actually match.
    expect(screen.getByLabelText(/Employee name/)).toBeTruthy();
  });

  it('marks the control required from the field', () => {
    render(
      <FormField label="Employee" required>
        <TextInput value="" onInput={vi.fn()} />
      </FormField>,
    );
    expect(screen.getByLabelText(/Employee/).hasAttribute('required')).toBe(true);
  });

  it('announces "required" rather than an asterisk glyph', () => {
    const { container } = render(
      <FormField label="Employee" required>
        <TextInput value="" onInput={vi.fn()} />
      </FormField>,
    );
    expect(container.querySelector('.ui-field2-required')?.getAttribute('aria-hidden')).toBe('true');
    expect(container.querySelector('.ui-sr-only')?.textContent).toContain('required');
  });

  // ── Validation ────────────────────────────────────────────────────────────

  it('sets aria-invalid on the control when there is an error', () => {
    render(
      <FormField label="Email" error="Not a valid address">
        <TextInput value="x" onInput={vi.fn()} />
      </FormField>,
    );
    expect(screen.getByLabelText(/Email/).getAttribute('aria-invalid')).toBe('true');
  });

  it('does not set aria-invalid for a warning', () => {
    render(
      <FormField label="Email" warning="Unusual domain">
        <TextInput value="x" onInput={vi.fn()} />
      </FormField>,
    );
    expect(screen.getByLabelText(/Email/).getAttribute('aria-invalid')).toBeNull();
  });

  it('points aria-describedby at the help text and the message', () => {
    render(
      <FormField label="Email" helpText="Work address" error="Required">
        <TextInput value="" onInput={vi.fn()} />
      </FormField>,
    );
    const described = screen.getByLabelText(/Email/).getAttribute('aria-describedby') ?? '';
    const ids = described.split(' ').filter(Boolean);
    expect(ids).toHaveLength(2);
    // Every referenced id must exist — a dangling reference silences the field.
    ids.forEach(id => expect(document.getElementById(id)).not.toBeNull());
  });

  it('omits aria-describedby entirely when there is nothing to describe', () => {
    render(
      <FormField label="Email">
        <TextInput value="" onInput={vi.fn()} />
      </FormField>,
    );
    expect(screen.getByLabelText(/Email/).getAttribute('aria-describedby')).toBeNull();
  });

  it('renders an error with role=alert so it interrupts', () => {
    render(
      <FormField label="Email" error="Required">
        <TextInput value="" onInput={vi.fn()} />
      </FormField>,
    );
    expect(screen.getByRole('alert').textContent).toContain('Required');
  });

  it('applies error > warning > success precedence and shows only one message', () => {
    const { container } = render(
      <FormField label="Email" error="E" warning="W" success="S">
        <TextInput value="" onInput={vi.fn()} />
      </FormField>,
    );
    const messages = container.querySelectorAll('.ui-field2-msg');
    expect(messages).toHaveLength(1);
    expect(messages[0]?.className).toContain('ui-field2-msg--error');
  });

  // ── Character count ───────────────────────────────────────────────────────

  it('renders a character count and flags over-run', () => {
    const { container } = render(
      <FormField label="Notes" charCount={{ value: 12, max: 10 }}>
        <TextInput value="" onInput={vi.fn()} />
      </FormField>,
    );
    const count = container.querySelector('.ui-field2-count');
    expect(count?.textContent).toBe('12/10');
    expect(count?.className).toContain('ui-field2-count--over');
  });

  // ── Disabled / read-only inheritance ──────────────────────────────────────

  it('propagates disabled to the control', () => {
    render(
      <FormField label="Locked" disabled>
        <TextInput value="v" onInput={vi.fn()} />
      </FormField>,
    );
    expect(screen.getByLabelText<HTMLInputElement>(/Locked/).disabled).toBe(true);
  });

  it('propagates read-only as read-only, not disabled', () => {
    // These are DIFFERENT states: read-only data must stay selectable and
    // copyable, and must not drop out of the tab order.
    render(
      <FormField label="Ref" readOnly>
        <TextInput value="v" onInput={vi.fn()} />
      </FormField>,
    );
    const input = screen.getByLabelText<HTMLInputElement>(/Ref/);
    expect(input.readOnly).toBe(true);
    expect(input.disabled).toBe(false);
  });

  it('lets a control override the field for its own disabled state', () => {
    render(
      <FormField label="Mixed">
        <TextInput value="v" onInput={vi.fn()} disabled />
      </FormField>,
    );
    expect(screen.getByLabelText<HTMLInputElement>(/Mixed/).disabled).toBe(true);
  });
});

describe('TextInput', () => {
  it('emits the new value on input', () => {
    const onInput = vi.fn();
    render(<TextInput value="" onInput={onInput} aria-label="Name" />);
    fireEvent.input(screen.getByLabelText('Name'), { target: { value: 'abc' } });
    expect(onInput).toHaveBeenCalledWith('abc');
  });

  it('works standalone, outside a FormField', () => {
    render(<TextInput value="x" onInput={vi.fn()} aria-label="Filter" />);
    expect(screen.getByLabelText('Filter')).toBeTruthy();
  });

  it('renders a textarea when multiline', () => {
    render(<TextInput multiline value="" onInput={vi.fn()} aria-label="Notes" />);
    expect(screen.getByLabelText('Notes').tagName).toBe('TEXTAREA');
  });

  // ── Trailing affordance priority ──────────────────────────────────────────

  it('shows the clear button only when there is a value', () => {
    const { container, rerender } = render(<TextInput clearable value="" onInput={vi.fn()} aria-label="S" />);
    expect(container.querySelector('.ui-ctrl-clear')).toBeNull();
    rerender(<TextInput clearable value="abc" onInput={vi.fn()} aria-label="S" />);
    expect(container.querySelector('.ui-ctrl-clear')).not.toBeNull();
  });

  it('clears the value and returns focus to the field', () => {
    const onInput = vi.fn();
    render(<TextInput clearable value="abc" onInput={onInput} aria-label="S" />);
    fireEvent.click(screen.getByLabelText('Clear'));
    expect(onInput).toHaveBeenCalledWith('');
    expect(document.activeElement).toBe(screen.getByLabelText('S'));
  });

  it('prefers the spinner over the clear button while loading', () => {
    // Fixed priority: spinner > clear > validation icon > iconRight. Only one
    // may render, so they can never overlap.
    const { container } = render(<TextInput clearable loading value="abc" onInput={vi.fn()} aria-label="S" />);
    expect(container.querySelector('.ui-ctrl-spinner')).not.toBeNull();
    expect(container.querySelector('.ui-ctrl-clear')).toBeNull();
  });

  it('prefers the clear button over the validation icon', () => {
    const { container } = render(
      <TextInput clearable validation="error" value="abc" onInput={vi.fn()} aria-label="S" />,
    );
    expect(container.querySelector('.ui-ctrl-clear')).not.toBeNull();
    expect(container.querySelector('[class*="ui-ctrl-validation-icon"]')).toBeNull();
  });

  it('hides the clear button when read-only', () => {
    const { container } = render(
      <TextInput clearable readOnly value="abc" onInput={vi.fn()} aria-label="S" />,
    );
    expect(container.querySelector('.ui-ctrl-clear')).toBeNull();
  });

  it('applies the validation recipe class to the control box', () => {
    const { container } = render(<TextInput validation="warning" value="" onInput={vi.fn()} aria-label="S" />);
    expect(container.querySelector('.ui-ctrl')?.className).toContain('ui-ctrl--warning');
  });

  it('marks read-only and disabled with different recipe classes', () => {
    const ro = render(<TextInput readOnly value="v" onInput={vi.fn()} aria-label="A" />);
    expect(ro.container.querySelector('.ui-ctrl')?.className).toContain('ui-ctrl--readonly');
    const dis = render(<TextInput disabled value="v" onInput={vi.fn()} aria-label="B" />);
    expect(dis.container.querySelector('.ui-ctrl')?.className).toContain('ui-ctrl--disabled');
  });

  it('places visible help below the control', () => {
    const { container } = render(
      <FormField label="Email" helpText="Work address">
        <TextInput value="" onInput={vi.fn()} />
      </FormField>,
    );
    const control = container.querySelector('.ui-ctrl');
    const help = container.querySelector('.ui-field2-help');
    expect(control?.nextElementSibling).toBe(help);
  });

  it('offers field guidance from a keyboard-accessible tooltip affordance', async () => {
    render(<TextInput helpTooltip="Use the employee's legal name." value="" onInput={vi.fn()} aria-label="Name" />);
    const help = screen.getByRole('button', { name: 'Field help' });
    await act(() => Promise.resolve().then(() => { help.focus(); }));
    expect(screen.getByRole('tooltip').textContent).toContain("Use the employee's legal name.");
  });

  it('keeps validation ahead of field help in the trailing affordance priority', () => {
    const { container } = render(
      <TextInput helpTooltip="Formatting guidance" validation="error" value="" onInput={vi.fn()} aria-label="Name" />,
    );
    expect(container.querySelector('.ui-ctrl-validation-icon--error')).not.toBeNull();
    expect(screen.queryByRole('button', { name: 'Field help' })).toBeNull();
  });

  it('lets a SearchInput replace or clear its recommended leading icon', () => {
    const custom = render(<SearchInput value="" onInput={vi.fn()} iconLeft={<span data-testid="custom-icon" />} aria-label="Search" />);
    expect(screen.getByTestId('custom-icon')).toBeTruthy();
    custom.rerender(<SearchInput value="" onInput={vi.fn()} iconLeft={null} aria-label="Search" />);
    expect(custom.container.querySelector('.ui-ctrl-lead')).toBeNull();
  });

  it('renders persistent prefix and suffix affixes alongside a validation affordance', () => {
    const { container } = render(
      <TextInput prefix="TTD" suffix="%" validation="error" value="25" onInput={vi.fn()} aria-label="Rate" />,
    );
    expect(container.querySelector('.ui-ctrl-prefix')?.textContent).toBe('TTD');
    expect(container.querySelector('.ui-ctrl-suffix')?.textContent).toBe('%');
    expect(container.querySelector('.ui-ctrl-validation-icon--error')).not.toBeNull();
  });

  it('supports an uncontrolled native-form field without accepting and dropping edits', () => {
    render(<TextInput defaultValue="6" suffix="%" aria-label="Rate" />);
    const input = screen.getByLabelText<HTMLInputElement>('Rate');
    fireEvent.input(input, { target: { value: '8.5' } });
    expect(input.value).toBe('8.5');
  });

  it('clears an uncontrolled field and restores focus', () => {
    const { container } = render(<TextInput defaultValue="6" clearable aria-label="Rate" />);
    fireEvent.click(screen.getByLabelText('Clear'));
    expect(screen.getByLabelText<HTMLInputElement>('Rate').value).toBe('');
    expect(document.activeElement).toBe(container.querySelector('input'));
  });
});

describe('legacy field names', () => {
  it('delegate to canonical FormField and Select with an associated label', () => {
    const { container } = render(
      <Field label="Priority">
        <SelectInput value="normal" onInput={vi.fn()} options={['low', 'normal', 'high']} />
      </Field>,
    );
    expect(screen.getByLabelText('Priority').getAttribute('role')).toBe('combobox');
    expect(container.querySelector('.ui-field2')).not.toBeNull();
    expect(container.querySelector('.ui-select')).toBeNull();
  });

  it('preserves an empty option as the canonical placeholder and list option', () => {
    render(
      <Field label="Owner">
        <SelectInput value="" onInput={vi.fn()} options={[{ value: '', label: 'None' }, { value: 'hr', label: 'HR' }]} />
      </Field>,
    );
    expect(screen.getByLabelText('Owner').textContent).toContain('None');
    fireEvent.click(screen.getByLabelText('Owner'));
    expect(screen.getByRole('option', { name: 'None' })).toBeTruthy();
  });

  it('delegates TextareaInput to the canonical textarea control', () => {
    const { container } = render(
      <Field label="Notes"><TextareaInput value="Context" onInput={vi.fn()} /></Field>,
    );
    expect(screen.getByLabelText('Notes').tagName).toBe('TEXTAREA');
    expect(container.querySelector('.ui-textarea')).toBeNull();
  });
});
