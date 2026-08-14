import { type VNode } from 'preact';
import { LucideIcon } from '../LucideIcon';
import './themeModeSwitch.recipe.css';

export type ThemeMode = 'light' | 'dark';

export interface ThemeModeSwitchProps {
  theme: ThemeMode;
  onChange: (theme: ThemeMode) => void;
  label?: string;
  disabled?: boolean;
  pending?: boolean;
  role?: 'switch' | 'menuitemcheckbox';
  class?: string;
  forceFocus?: boolean;
}

/** A purpose-built appearance preference control. Persistence stays with its consumer. */
export function ThemeModeSwitch({
  theme,
  onChange,
  label = 'Dark mode',
  disabled = false,
  pending = false,
  role = 'switch',
  class: className,
  forceFocus = false,
}: ThemeModeSwitchProps): VNode {
  const dark = theme === 'dark';
  const classes = ['ui-theme-mode-switch', forceFocus && 'is-force-focus', className].filter(Boolean).join(' ');

  return (
    <button
      type="button"
      class={classes}
      role={role}
      aria-label={label}
      aria-checked={dark}
      aria-busy={pending || undefined}
      disabled={disabled || pending}
      data-theme-mode={theme}
      onClick={() => onChange(dark ? 'light' : 'dark')}
    >
      <span class="ui-theme-mode-switch__moon" aria-hidden="true"><LucideIcon name="Moon" size={19} strokeWidth={2} /></span>
      <span class="ui-theme-mode-switch__sun" aria-hidden="true"><LucideIcon name="Sun" size={20} strokeWidth={2} /></span>
      <span class="ui-theme-mode-switch__knob" aria-hidden="true" />
    </button>
  );
}
