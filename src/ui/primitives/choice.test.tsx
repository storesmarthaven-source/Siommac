import { fireEvent, render, screen } from '@testing-library/preact';
import { describe, expect, it, vi } from 'vitest';
import { Checkbox, RadioGroup, Switch } from './choice';

describe('choice controls', () => {
  it('uses the native indeterminate checkbox property and preserves read-only state', () => {
    const onChange = vi.fn();
    render(<Checkbox checked={false} indeterminate readOnly onChange={onChange} label="Select visible rows" />);
    const input = screen.getByRole<HTMLInputElement>('checkbox', { name: 'Select visible rows' });
    expect(input.indeterminate).toBe(true);
    fireEvent.click(input);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('renders the governed animated checkbox treatment without a decorative container', () => {
    const { container } = render(<Checkbox checked onChange={vi.fn()} aria-label="Selection" />);
    expect(container.querySelector('.ui-choice--checkbox')).toBeTruthy();
    expect(container.querySelector('.ui-choice-box .ui-choice-mark')).toBeTruthy();
    expect(container.querySelector('.ui-choice-mark path')?.getAttribute('d')).toBe('M4 12L10 18L20 6');
    expect(container.querySelector('.checkbox-container')).toBeNull();
  });

  it('keeps a radio set natively grouped and reports the selected value', () => {
    const onChange = vi.fn();
    render(
      <RadioGroup
        label="Pay frequency"
        value="weekly"
        onChange={onChange}
        options={[{ value: 'weekly', label: 'Weekly' }, { value: 'monthly', label: 'Monthly' }]}
      />,
    );
    const monthly = screen.getByRole<HTMLInputElement>('radio', { name: 'Monthly' });
    expect(monthly.name).toBeTruthy();
    fireEvent.click(monthly);
    expect(onChange).toHaveBeenCalledWith('monthly');
  });

  it('blocks an immediate switch while its persistence is pending', () => {
    const onChange = vi.fn();
    render(<Switch checked pending onChange={onChange} label="Show payroll" />);
    const input = screen.getByRole<HTMLInputElement>('switch', { name: 'Show payroll' });
    expect(input.disabled).toBe(true);
    expect(input.getAttribute('aria-busy')).toBe('true');
    fireEvent.click(input);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('renders the cross and check morph inside the canonical switch knob', () => {
    const { container, rerender } = render(<Switch checked={false} onChange={vi.fn()} aria-label="Setting" />);
    expect(container.querySelector('.ui-switch-cross')).toBeTruthy();
    expect(container.querySelector('.ui-switch-check')).toBeTruthy();
    expect(screen.getByRole<HTMLInputElement>('switch', { name: 'Setting' }).checked).toBe(false);

    rerender(<Switch checked onChange={vi.fn()} aria-label="Setting" />);
    expect(screen.getByRole<HTMLInputElement>('switch', { name: 'Setting' }).checked).toBe(true);
  });
});
