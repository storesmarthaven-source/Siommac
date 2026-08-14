import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/preact';
import { NextActionButton } from './NextActionButton';

describe('NextActionButton', () => {
  it('supports governed usage labels without changing the Next action pattern', () => {
    render(<NextActionButton label="Continue" />);
    expect(screen.getByRole('button', { name: 'Continue' })).toBeTruthy();
  });
  it('keeps the Next usage role on the canonical primary Button', () => {
    const { container } = render(<NextActionButton />);
    const button = screen.getByRole('button', { name: 'Next' });
    expect(button.classList.contains('ui-btn--primary')).toBe(true);
    expect(button.classList.contains('ui-next-action-button')).toBe(true);
    expect(container.querySelector('.ui-next-action-button__icon')).toBeTruthy();
  });

  it('preserves native disabled semantics', () => {
    render(<NextActionButton disabled />);
    expect(screen.getByRole('button', { name: 'Next' }).getAttribute('disabled')).not.toBeNull();
  });

  it('supports governed outline, circle and filled-circle icon treatments', () => {
    const { rerender, container } = render(<NextActionButton leadingIcon="Check" iconTreatment="circle" iconColor="#f8fafc" />);
    expect(container.querySelector('.ui-next-action-button__icon--circle')).toBeTruthy();
    expect(container.querySelector('.ui-next-action-button__leading--circle svg')).toBeTruthy();
    rerender(<NextActionButton leadingIcon="Check" iconTreatment="filled-circle" iconColor="#f8fafc" />);
    expect(container.querySelector('.ui-next-action-button__icon--filled-circle')).toBeTruthy();
    expect(container.querySelector('.ui-next-action-button__leading--filled-circle svg')).toBeTruthy();
  });
});
