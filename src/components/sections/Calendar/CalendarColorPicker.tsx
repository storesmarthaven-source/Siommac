import { type VNode } from 'preact';
import { useState } from 'preact/hooks';
import type { CalendarColorKey } from '@api/calendar';
import { ColorPicker, Popover } from '@ui';

export const CALENDAR_COLOR_OPTIONS: readonly { value: CalendarColorKey; label: string }[] = [
  { value: 'blue', label: 'Ocean' },
  { value: 'indigo', label: 'Indigo' },
  { value: 'purple', label: 'Violet' },
  { value: 'coral', label: 'Coral' },
  { value: 'amber', label: 'Amber' },
  { value: 'lime', label: 'Lime' },
  { value: 'mint', label: 'Mint' },
  { value: 'teal', label: 'Teal' },
  { value: 'slate', label: 'Slate' },
];

export const CALENDAR_COLOR_VALUES: Record<CalendarColorKey, string> = {
  blue: '#75aee0',
  indigo: '#7f91df',
  purple: '#a68be1',
  rose: '#db82a7',
  coral: '#e59a92',
  amber: '#e7bf67',
  lime: '#acd46c',
  mint: '#72c69d',
  teal: '#55b9b0',
  slate: '#a9b2bd',
};

export function CalendarColorPicker({ value, customColor = null, onChange, onCustomColorChange, disabled = false, allowAutomatic = false, allowCustom = false, label = 'Calendar colour' }: {
  value: CalendarColorKey | null;
  customColor?: string | null;
  onChange: (value: CalendarColorKey | null) => void;
  onCustomColorChange?: (value: string | null) => void;
  disabled?: boolean;
  allowAutomatic?: boolean;
  allowCustom?: boolean;
  label?: string;
}): VNode {
  const [customAnchor, setCustomAnchor] = useState<HTMLElement | null>(null);
  const pickerValue = customColor ?? (value ? CALENDAR_COLOR_VALUES[value] : CALENDAR_COLOR_VALUES.blue);
  const optionCount = CALENDAR_COLOR_OPTIONS.length + (allowAutomatic ? 1 : 0) + (allowCustom && onCustomColorChange ? 1 : 0);

  return (
    <>
      <div class="cal-color-picker" role="radiogroup" aria-label={label} style={`--cal-color-option-count:${optionCount}`}>
        {allowAutomatic ? <button
          type="button"
          class={`cal-color-swatch tone-auto${value === null && !customColor ? ' is-selected' : ''}`}
          role="radio"
          aria-checked={value === null && !customColor}
          aria-label="Automatic"
          title="Automatic"
          disabled={disabled}
          onClick={() => { setCustomAnchor(null); onCustomColorChange?.(null); onChange(null); }}
        ><span aria-hidden="true" /></button> : null}
        {CALENDAR_COLOR_OPTIONS.map(option => (
          <button
            type="button"
            key={option.value}
            class={`cal-color-swatch tone-${option.value}${value === option.value ? ' is-selected' : ''}`}
            role="radio"
            aria-checked={value === option.value}
            aria-label={option.label}
            title={option.label}
            disabled={disabled}
            onClick={() => { setCustomAnchor(null); onCustomColorChange?.(null); onChange(option.value); }}
          ><span aria-hidden="true" /></button>
        ))}
        {allowCustom && onCustomColorChange ? <button type="button" class={`cal-color-custom${customColor ? ' is-selected' : ''}`}
          role="radio" aria-checked={Boolean(customColor)} aria-label="Custom colour" title="Custom colour"
          aria-haspopup="dialog" aria-expanded={Boolean(customAnchor)} disabled={disabled}
          onClick={event => setCustomAnchor(current => current ? null : event.currentTarget)}>
          <span aria-hidden="true"><i class="fas fa-plus" /></span>
        </button> : null}
      </div>
      {allowCustom && onCustomColorChange ? <Popover open={Boolean(customAnchor)} anchor={customAnchor} onClose={() => setCustomAnchor(null)}
        label="Choose custom calendar colour" align="end" maxHeight={470} class="cal-color-picker-popover">
        <ColorPicker value={pickerValue} onChange={next => { onChange(null); onCustomColorChange(next); }}
          savedColors={Object.values(CALENDAR_COLOR_VALUES)} savedColorsLabel="Calendar presets"
          aria-label="Calendar item colour" class="cal-card-edit-colour-picker" />
      </Popover> : null}
    </>
  );
}
