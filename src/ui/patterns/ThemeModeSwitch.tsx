import { type VNode } from 'preact';
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

/** The nine parts morph between a sun and crescent without swapping icons. */
export function ThemeModeSwitchArtwork(): VNode {
  return (
    <>
      <span class="ui-theme-mode-switch__knob" aria-hidden="true" />
      <span class="ui-theme-mode-switch__icon" aria-hidden="true">
        {Array.from({ length: 9 }, (_, index) => <i class="ui-theme-mode-switch__icon-part" key={index} />)}
      </span>
    </>
  );
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
      onClick={() => { if (!disabled && !pending) onChange(dark ? 'light' : 'dark'); }}
    >
      <ThemeModeSwitchArtwork />
    </button>
  );
}
