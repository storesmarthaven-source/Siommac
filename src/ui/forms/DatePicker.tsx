import { type VNode } from 'preact';
import { useEffect, useId, useMemo, useRef, useState } from 'preact/hooks';
import { LucideIcon } from '../LucideIcon';
import { Button } from '../primitives/Button';
import { type DateRange } from './dateInputs';
import './DatePicker.recipe.css';

export interface DatePickerPreset {
  id: string;
  label: string;
  range: DateRange;
}

interface DatePickerBaseProps {
  label?: string;
  min?: string;
  max?: string;
  disabled?: boolean;
  showPresets?: boolean;
  presets?: readonly DatePickerPreset[];
  months?: 1 | 2;
  showToday?: boolean;
  showFooter?: boolean;
  showOutsideDates?: boolean;
  timeSlots?: readonly string[];
  selectedTime?: string;
  onTimeChange?: (time: string) => void;
  onApply?: () => void;
  onCancel?: () => void;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  triggerTreatment?: 'siomac' | 'website-date-time';
  class?: string;
}

interface SingleDatePickerProps extends DatePickerBaseProps {
  mode?: 'single';
  value: string;
  onChange: (value: string) => void;
}

interface RangeDatePickerProps extends DatePickerBaseProps {
  mode: 'range';
  value: DateRange;
  onChange: (value: DateRange) => void;
}

export type DatePickerProps = SingleDatePickerProps | RangeDatePickerProps;

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function iso(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function fromIso(value: string | undefined): Date | undefined {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(year!, month! - 1, day);
  return Number.isNaN(date.valueOf()) || iso(date) !== value ? undefined : date;
}

function monthStart(date: Date): Date { return new Date(date.getFullYear(), date.getMonth(), 1); }
function addMonths(date: Date, amount: number): Date { return new Date(date.getFullYear(), date.getMonth() + amount, 1); }
function addDays(value: string, amount: number): string {
  const date = fromIso(value);
  if (!date) return value;
  date.setDate(date.getDate() + amount);
  return iso(date);
}

function calendarDays(month: Date): Date[] {
  const first = monthStart(month);
  const start = new Date(first.getFullYear(), first.getMonth(), 1 - first.getDay());
  return Array.from({ length: 42 }, (_, index) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + index));
}

function displayDate(value: string): string { return value || 'YYYY-MM-DD'; }

function defaultPresets(): DatePickerPreset[] {
  const today = new Date();
  const end = iso(today);
  const startOfMonth = iso(new Date(today.getFullYear(), today.getMonth(), 1));
  return [
    { id: '7-days', label: 'Last 7 days', range: { from: addDays(end, -6), to: end } },
    { id: '14-days', label: 'Last 14 days', range: { from: addDays(end, -13), to: end } },
    { id: '30-days', label: 'Last 30 days', range: { from: addDays(end, -29), to: end } },
    { id: 'this-month', label: 'This month', range: { from: startOfMonth, to: end } },
  ];
}

export function DatePicker(props: DatePickerProps): VNode {
  const mode = props.mode ?? 'single';
  const range = mode === 'range' ? props.value as DateRange : undefined;
  const single = mode === 'single' ? props.value as string : '';
  const initial = fromIso(range?.from ?? single) ?? new Date();
  const [visibleMonth, setVisibleMonth] = useState(() => monthStart(initial));
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelId = `calendar-panel-${useId().replace(/:/g, '')}`;
  const [uncontrolledOpen, setUncontrolledOpen] = useState(props.defaultOpen ?? false);
  const isOpen = props.open ?? uncontrolledOpen;
  const months = props.months ?? (mode === 'range' ? 2 : 1);
  const presets = props.presets ?? defaultPresets();

  const setOpen = (next: boolean): void => {
    if (props.open === undefined) setUncontrolledOpen(next);
    props.onOpenChange?.(next);
  };

  useEffect(() => {
    if (!isOpen) return;
    const onPointerDown = (event: PointerEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: globalThis.KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [isOpen]);

  const select = (value: string): void => {
    if (props.disabled) return;
    if (mode === 'single') {
      (props as SingleDatePickerProps).onChange(value);
      return;
    }
    const current = (props as RangeDatePickerProps).value;
    if (!current.from || current.to) (props as RangeDatePickerProps).onChange({ from: value, to: '' });
    else if (value < current.from) (props as RangeDatePickerProps).onChange({ from: value, to: current.from });
    else (props as RangeDatePickerProps).onChange({ from: current.from, to: value });
  };

  const selected = (value: string): boolean => mode === 'single'
    ? single === value
    : range?.from === value || range?.to === value;
  const insideRange = (value: string): boolean => Boolean(range?.from && range.to && value > range.from && value < range.to);
  const unavailable = (value: string): boolean => (props.min ? value < props.min : false) || (props.max ? value > props.max : false);
  const presetUnavailable = (preset: DatePickerPreset): boolean => unavailable(preset.range.from) || unavailable(preset.range.to);

  const focusDate = (value: string): void => {
    const next = rootRef.current?.querySelector<HTMLButtonElement>(`[data-calendar-date="${value}"]`);
    if (next) next.focus();
    else {
      const date = fromIso(value);
      if (date) setVisibleMonth(monthStart(date));
      requestAnimationFrame(() => rootRef.current?.querySelector<HTMLButtonElement>(`[data-calendar-date="${value}"]`)?.focus());
    }
  };

  const handleDateKey = (event: KeyboardEvent, value: string): void => {
    const offsets: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    const offset = offsets[event.key];
    if (offset === undefined) return;
    event.preventDefault();
    focusDate(addDays(value, offset));
  };

  const monthViews = useMemo(() => Array.from({ length: months }, (_, index) => addMonths(visibleMonth, index)), [months, visibleMonth]);
  const triggerTreatment = props.triggerTreatment ?? 'siomac';
  const formattedSingle = single
    ? new Date(`${single}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
    : 'Select date';

  return (
    <div ref={rootRef} class={`ui-date-picker ui-date-picker--${mode}${props.timeSlots ? ' ui-date-picker--with-time' : ''}${props.class ? ` ${props.class}` : ''}`} aria-label={props.label ?? (mode === 'range' ? 'Choose date range' : 'Choose date')}>
      <div class="ui-date-picker__fields">
        <label><span class="ui-date-picker__sr-label">{mode === 'range' ? 'Date range' : props.timeSlots ? 'Date and time' : 'Date'}</span><button class={triggerTreatment === 'website-date-time' ? 'is-website-date-time' : undefined} ref={triggerRef} type="button" aria-label={mode === 'range' ? 'Date range' : props.timeSlots ? 'Date and time' : 'Date'} aria-haspopup="dialog" aria-expanded={isOpen} aria-controls={panelId} disabled={props.disabled} onClick={() => setOpen(!isOpen)}><i aria-hidden="true"><LucideIcon name={props.timeSlots ? 'Calendar' : 'CalendarDays'} /></i>{mode === 'range' ? <b>{range?.from && range.to ? `${displayDate(range.from)} – ${displayDate(range.to)}` : 'Select dates'}</b> : triggerTreatment === 'website-date-time' ? <span class="ui-date-picker__date-time-value"><b>{formattedSingle}</b>{props.selectedTime && <small>{props.selectedTime}</small>}</span> : <b>{formattedSingle}</b>}</button></label>
      </div>

      {isOpen && <div class="ui-date-picker__popover" role="dialog" aria-modal="false" aria-label={mode === 'range' ? 'Date range picker' : 'Date picker'} id={panelId}>
      <div class="ui-date-picker__panel">
        {mode === 'range' && props.showPresets && <nav class="ui-date-picker__presets" aria-label="Quick date ranges">
          {presets.map(preset => <button type="button" key={preset.id} disabled={Boolean(props.disabled) || presetUnavailable(preset)} onClick={() => (props as RangeDatePickerProps).onChange(preset.range)}>{preset.label}</button>)}
        </nav>}

        <section class="ui-date-picker__months">
          <button type="button" class="ui-date-picker__nav is-prev" aria-label="Previous month" disabled={props.disabled} onClick={() => setVisibleMonth(month => addMonths(month, -1))}><LucideIcon name="ChevronLeft" /></button>
          <button type="button" class="ui-date-picker__nav is-next" aria-label="Next month" disabled={props.disabled} onClick={() => setVisibleMonth(month => addMonths(month, 1))}><LucideIcon name="ChevronRight" /></button>
          {monthViews.map(month => <div class="ui-date-picker__month" key={iso(month)}>
            <h3>{month.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</h3>
            {mode === 'single' && <div class="ui-date-picker__quick"><span><LucideIcon name="CalendarDays" /><b>{displayDate(single)}</b></span>{props.showToday !== false && <button type="button" onClick={() => select(iso(new Date()))}>Today</button>}</div>}
            <div class="ui-date-picker__weekdays" aria-hidden="true">{WEEKDAYS.map(day => <span key={day}>{day.slice(0, 2)}</span>)}</div>
            <div class="ui-date-picker__grid" role="grid" aria-label={month.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}>
              {calendarDays(month).map(day => {
                const value = iso(day);
                const outside = day.getMonth() !== month.getMonth();
                const isDisabled = Boolean(props.disabled) || unavailable(value);
                if (outside && props.showOutsideDates === false) return <span class="is-empty" aria-hidden="true" key={value} />;
                const isToday = value === iso(new Date());
                return <button type="button" role="gridcell" key={value} data-calendar-date={value} class={[outside ? 'is-outside' : '', selected(value) ? 'is-selected' : '', insideRange(value) ? 'is-range' : '', isToday ? 'is-today' : ''].filter(Boolean).join(' ')} aria-label={day.toLocaleDateString(undefined, { dateStyle: 'full' })} aria-selected={selected(value)} aria-current={isToday ? 'date' : undefined} disabled={isDisabled} onClick={() => select(value)} onKeyDown={event => handleDateKey(event, value)}>{day.getDate()}</button>;
              })}
            </div>
          </div>)}
        </section>

        {props.timeSlots && <aside class="ui-date-picker__times" aria-label="Available times">
          <strong>Available times</strong>
          <div>{props.timeSlots.map(time => <button type="button" class={props.selectedTime === time ? 'is-selected' : ''} aria-pressed={props.selectedTime === time} onClick={() => props.onTimeChange?.(time)}>{time}</button>)}</div>
        </aside>}

        {props.showFooter !== false && <footer>{mode === 'range' && <div class="ui-date-picker__range-values"><span><LucideIcon name="CalendarDays" />{displayDate(range?.from ?? '')}</span><em>–</em><span><LucideIcon name="CalendarDays" />{displayDate(range?.to ?? '')}</span></div>}<div class="ui-date-picker__footer-actions"><Button variant="outline" disabled={props.disabled} onClick={() => { props.onCancel?.(); setOpen(false); }}>Cancel</Button><Button variant="primary" disabled={Boolean(props.disabled) || (mode === 'range' ? !range?.from || !range.to : !single)} onClick={() => { props.onApply?.(); setOpen(false); }}>Apply</Button></div></footer>}
      </div>
      </div>}
    </div>
  );
}
