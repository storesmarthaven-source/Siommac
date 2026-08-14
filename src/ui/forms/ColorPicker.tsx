import { type VNode } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { LucideIcon } from '../LucideIcon';
import './colorPicker.recipe.css';

export interface HsvColor {
  h: number;
  s: number;
  v: number;
}

export interface ColorPickerProps {
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  alpha?: boolean;
  savedColors?: readonly string[];
  savedColorsLabel?: string;
  onSaveColor?: (color: string) => void;
  onRemoveSavedColor?: (color: string) => void;
  disabled?: boolean;
  'aria-label'?: string;
  class?: string;
}

const clamp = (value: number, min = 0, max = 1): number => Math.min(max, Math.max(min, value));

export function hexToHsv(value: string): HsvColor {
  const raw = /^#[\da-f]{6}$/i.test(value) ? value.slice(1) : '000000';
  const r = Number.parseInt(raw.slice(0, 2), 16) / 255;
  const g = Number.parseInt(raw.slice(2, 4), 16) / 255;
  const b = Number.parseInt(raw.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  let h = 0;
  if (delta > 0) {
    if (max === r) h = 60 * (((g - b) / delta) % 6);
    else if (max === g) h = 60 * (((b - r) / delta) + 2);
    else h = 60 * (((r - g) / delta) + 4);
  }
  return { h: (h + 360) % 360, s: max === 0 ? 0 : delta / max, v: max };
}

export function hsvToHex({ h, s, v }: HsvColor): string {
  const chroma = v * s;
  const x = chroma * (1 - Math.abs(((h / 60) % 2) - 1));
  const offset = v - chroma;
  let rgb: [number, number, number];
  if (h < 60) rgb = [chroma, x, 0];
  else if (h < 120) rgb = [x, chroma, 0];
  else if (h < 180) rgb = [0, chroma, x];
  else if (h < 240) rgb = [0, x, chroma];
  else if (h < 300) rgb = [x, 0, chroma];
  else rgb = [chroma, 0, x];
  return `#${rgb.map(channel => Math.round((channel + offset) * 255).toString(16).padStart(2, '0')).join('')}`;
}

function normalizedHex(value: string): string | undefined {
  const next = value.trim();
  if (/^#[\da-f]{6}$/i.test(next)) return next.toLowerCase();
  if (/^[\da-f]{6}$/i.test(next)) return `#${next.toLowerCase()}`;
  return undefined;
}

export function ColorPicker({
  value,
  defaultValue = '#7f56d9',
  onChange,
  alpha = false,
  savedColors = [],
  savedColorsLabel = 'Saved colors',
  onSaveColor,
  onRemoveSavedColor,
  disabled = false,
  'aria-label': ariaLabel = 'Color picker',
  class: className,
}: ColorPickerProps): VNode {
  const controlled = value !== undefined;
  const [internalValue, setInternalValue] = useState(normalizedHex(defaultValue) ?? '#7f56d9');
  const [opacity, setOpacity] = useState(100);
  const [draft, setDraft] = useState(controlled ? value : internalValue);
  const draggingRef = useRef(false);
  const color = normalizedHex(controlled ? value : internalValue) ?? '#000000';
  const hsv = useMemo(() => hexToHsv(color), [color]);

  useEffect(() => setDraft(color), [color]);

  const commit = (next: string): void => {
    const valid = normalizedHex(next);
    setDraft(next);
    if (!valid) return;
    if (!controlled) setInternalValue(valid);
    onChange?.(valid);
  };

  const updateArea = (event: PointerEvent): void => {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    commit(hsvToHex({ ...hsv,
      s: clamp((event.clientX - rect.left) / rect.width),
      v: 1 - clamp((event.clientY - rect.top) / rect.height),
    }));
  };

  const pickFromScreen = async (): Promise<void> => {
    const EyeDropper = (globalThis as { EyeDropper?: new () => { open: () => Promise<{ sRGBHex: string }> } }).EyeDropper;
    if (!EyeDropper) return;
    try {
      const result = await new EyeDropper().open();
      commit(result.sRGBHex);
    } catch {
      // Cancelling the system picker is not an error state.
    }
  };

  return (
    <div class={`ui-color-picker${className ? ` ${className}` : ''}`} role="group" aria-label={ariaLabel} aria-disabled={disabled || undefined}>
      <div class="ui-color-picker__area" role="slider" tabIndex={disabled ? -1 : 0}
        aria-label="Saturation and brightness" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(hsv.s * 100)}
        aria-valuetext={`${Math.round(hsv.s * 100)}% saturation, ${Math.round(hsv.v * 100)}% brightness`}
        style={{ backgroundColor: `hsl(${hsv.h} 100% 50%)` }}
        onKeyDown={event => {
          if (disabled || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
          event.preventDefault();
          const step = event.shiftKey ? .1 : .01;
          if (event.key === 'ArrowLeft') commit(hsvToHex({ ...hsv, s: clamp(hsv.s - step) }));
          if (event.key === 'ArrowRight') commit(hsvToHex({ ...hsv, s: clamp(hsv.s + step) }));
          if (event.key === 'ArrowUp') commit(hsvToHex({ ...hsv, v: clamp(hsv.v + step) }));
          if (event.key === 'ArrowDown') commit(hsvToHex({ ...hsv, v: clamp(hsv.v - step) }));
        }}
        onPointerDown={event => {
          if (disabled) return;
          draggingRef.current = true;
          event.currentTarget.setPointerCapture(event.pointerId);
          updateArea(event);
        }}
        onPointerMove={event => { if (draggingRef.current && !disabled) updateArea(event); }}
        onPointerUp={event => {
          draggingRef.current = false;
          event.currentTarget.releasePointerCapture(event.pointerId);
        }}>
        <span class="ui-color-picker__area-white" />
        <span class="ui-color-picker__area-black" />
        <i class="ui-color-picker__cursor" style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%`, backgroundColor: color }} />
      </div>

      <div class="ui-color-picker__controls">
        <span class="ui-color-picker__sample" aria-hidden="true" style={{ backgroundColor: color, opacity: opacity / 100 }} />
        <div class="ui-color-picker__tracks">
          <label><span class="ui-sr-only">Hue</span><input class="ui-color-picker__hue" type="range" min="0" max="360" value={Math.round(hsv.h)} disabled={disabled}
            onInput={event => commit(hsvToHex({ ...hsv, h: Number(event.currentTarget.value) }))} /></label>
          {alpha && <label><span class="ui-sr-only">Opacity</span><input class="ui-color-picker__alpha" type="range" min="0" max="100" value={opacity} disabled={disabled}
            style={{ '--ui-picker-alpha-color': color }} onInput={event => setOpacity(Number(event.currentTarget.value))} /></label>}
        </div>
      </div>

      <div class="ui-color-picker__value-row">
        <label><span>Hex</span><input value={draft} disabled={disabled} spellcheck={false}
          aria-label="Hex color" onFocus={() => setDraft(color)}
          onInput={event => { setDraft(event.currentTarget.value); commit(event.currentTarget.value); }}
          onBlur={() => setDraft(color)} /></label>
        {alpha && <label class="ui-color-picker__opacity"><span>Opacity</span><input type="number" min="0" max="100" value={opacity} disabled={disabled}
          aria-label="Opacity percentage" onInput={event => setOpacity(clamp(Number(event.currentTarget.value), 0, 100))} /></label>}
        {'EyeDropper' in globalThis && <button type="button" class="ui-color-picker__eyedropper" aria-label="Pick color from screen" disabled={disabled}
          onClick={() => void pickFromScreen()}><LucideIcon name="Pipette" size={17} /></button>}
      </div>

      {savedColors.length > 0 && <div class="ui-color-picker__saved">
        <span>{savedColorsLabel}</span>
        <div>
          {savedColors.map(saved => <span class="ui-color-picker__saved-item" key={saved}>
            <button type="button" aria-label={`Set color to ${saved}`} aria-pressed={saved.toLowerCase() === color}
              disabled={disabled} style={{ backgroundColor: saved }} onClick={() => commit(saved)} />
            {onRemoveSavedColor && <button type="button" class="ui-color-picker__remove" aria-label={`Remove saved color ${saved}`}
              disabled={disabled} onClick={() => onRemoveSavedColor(saved)}><LucideIcon name="X" size={9} /></button>}
          </span>)}
          {onSaveColor && !savedColors.some(saved => saved.toLowerCase() === color) && savedColors.length < 32 &&
            <button type="button" class="ui-color-picker__add" aria-label={`Save ${color} to custom colors`} disabled={disabled}
              onClick={() => onSaveColor(color)}>+</button>}
        </div>
      </div>}
      {savedColors.length === 0 && onSaveColor && <div class="ui-color-picker__saved ui-color-picker__saved--empty">
        <span>{savedColorsLabel}</span>
        <button type="button" class="ui-color-picker__save-first" disabled={disabled} onClick={() => onSaveColor(color)}>Save current color</button>
      </div>}
    </div>
  );
}
