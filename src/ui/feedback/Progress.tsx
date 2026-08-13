import { type VNode } from 'preact';
import './feedback.recipe.css';

export type ProgressShape = 'bar' | 'ring' | 'meter';
export type ProgressTone = 'accent' | 'success' | 'warning' | 'danger';
export type ProgressSize = 'sm' | 'md' | 'lg';

export interface ProgressProps {
  value?: number;
  min?: number;
  max?: number;
  label: string;
  shape?: ProgressShape;
  tone?: ProgressTone;
  size?: ProgressSize;
  showValue?: boolean;
  formatValue?: (value: number, percent: number) => string;
  class?: string;
}

export function Progress({
  value, min = 0, max = 100, label, shape = 'bar', tone = 'accent', size = 'md',
  showValue = true, formatValue, class: extra,
}: ProgressProps): VNode {
  const safeMax = max > min ? max : min + 1;
  const determinate = value !== undefined && Number.isFinite(value);
  const safeValue = determinate ? Math.min(safeMax, Math.max(min, value)) : min;
  const percent = determinate ? ((safeValue - min) / (safeMax - min)) * 100 : 0;
  const display = formatValue ? formatValue(safeValue, percent) : `${Math.round(percent)}%`;

  return (
    <div
      class={`ui-progress ui-progress--${shape} ui-progress--${tone} ui-progress--${size}${determinate ? '' : ' ui-progress--indeterminate'}${extra ? ` ${extra}` : ''}`}
      role="progressbar"
      aria-label={label}
      aria-valuemin={determinate ? min : undefined}
      aria-valuemax={determinate ? safeMax : undefined}
      aria-valuenow={determinate ? safeValue : undefined}
      aria-valuetext={determinate ? display : undefined}
      style={`--ui-progress-value: ${percent}`}
    >
      {shape === 'ring' ? (
        <svg class="ui-progress__ring" viewBox="0 0 36 36" aria-hidden="true">
          <circle class="ui-progress__ring-track" cx="18" cy="18" r="15.5" />
          <circle class="ui-progress__ring-value" cx="18" cy="18" r="15.5" pathLength="100" />
        </svg>
      ) : (
        <div class="ui-progress__track" aria-hidden="true"><span class="ui-progress__value" /></div>
      )}
      <div class="ui-progress__copy">
        <span class="ui-progress__label">{label}</span>
        {showValue && <span class="ui-progress__text">{determinate ? display : 'In progress'}</span>}
      </div>
    </div>
  );
}
