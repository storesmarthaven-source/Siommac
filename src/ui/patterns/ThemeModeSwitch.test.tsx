import { fireEvent, render, screen } from '@testing-library/preact';
import { describe, expect, it, vi } from 'vitest';
import { ThemeModeSwitch } from './ThemeModeSwitch';

describe('ThemeModeSwitch', () => {
  it('announces its state and requests the opposite theme', () => {
    const onChange = vi.fn();
    render(<ThemeModeSwitch theme="light" onChange={onChange} />);
    const control = screen.getByRole('switch', { name: 'Dark mode' });
    expect(control.getAttribute('aria-checked')).toBe('false');
    fireEvent.click(control);
    expect(onChange).toHaveBeenCalledWith('dark');
  });

  it('uses one nine-part icon that morphs between sun and moon', () => {
    const { container, rerender } = render(<ThemeModeSwitch theme="light" onChange={vi.fn()} />);
    expect(container.querySelectorAll('.ui-theme-mode-switch__icon-part')).toHaveLength(9);
    expect(container.querySelector('svg')).toBeNull();
    expect(container.querySelector('.ui-theme-mode-switch')?.getAttribute('data-theme-mode')).toBe('light');

    rerender(<ThemeModeSwitch theme="dark" onChange={vi.fn()} />);
    expect(container.querySelector('.ui-theme-mode-switch')?.getAttribute('data-theme-mode')).toBe('dark');
    expect(container.querySelectorAll('.ui-theme-mode-switch__icon-part')).toHaveLength(9);
  });

  it('blocks interaction while persistence is pending', () => {
    const onChange = vi.fn();
    render(<ThemeModeSwitch theme="dark" onChange={onChange} pending />);
    const control = screen.getByRole('switch', { name: 'Dark mode' });
    expect((control as HTMLButtonElement).disabled).toBe(true);
    expect(control.getAttribute('aria-busy')).toBe('true');
    fireEvent.click(control);
    expect(onChange).not.toHaveBeenCalled();
  });
});
