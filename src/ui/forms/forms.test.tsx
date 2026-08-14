/**
 * forms.test.tsx — behaviour for the Forms wave.
 *
 * Concentrates on the things that make each of these a component rather than a
 * styled input: the indeterminate third state, read-only on a control that has
 * no native read-only, money that never becomes a float, a date range that
 * cannot be inverted silently, file validation that happens before the caller
 * sees anything, and paste-a-whole-code.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/preact';
import { Checkbox, Switch, CheckboxGroup, RadioGroup } from '../primitives/choice';
import { PasswordInput, NumberInput, CurrencyInput, PercentageInput, PhoneInput } from './inputs';
import { DateInput, TimeInput, DateRangeInput } from './dateInputs';
import { FileInput, OtpInput, type FileRejection } from './FileInput';
import { ColorPicker, hexToHsv, hsvToHex } from './ColorPicker';
import { MultiSelect } from './MultiSelect';
import { FormField } from './FormField';

describe('ColorPicker', () => {
  it('supports controlled saved colors, hue and opacity controls', () => {
    const onChange = vi.fn();
    render(<ColorPicker value="#7f56d9" onChange={onChange} alpha savedColors={['#dc2626']} aria-label="Accent color" />);

    fireEvent.click(screen.getByRole('button', { name: 'Set color to #dc2626' }));
    expect(onChange).toHaveBeenLastCalledWith('#dc2626');

    fireEvent.input(screen.getByRole('slider', { name: 'Hue' }), { target: { value: '180' } });
    expect(onChange).toHaveBeenCalled();
    fireEvent.input(screen.getByRole('slider', { name: 'Opacity' }), { target: { value: '65' } });
    expect(screen.getByLabelText<HTMLInputElement>('Opacity percentage').value).toBe('65');
  });

  it('supports keyboard changes on the two-dimensional color area', () => {
    const onChange = vi.fn();
    render(<ColorPicker value="#7f56d9" onChange={onChange} />);
    fireEvent.keyDown(screen.getByRole('slider', { name: 'Saturation and brightness' }), { key: 'ArrowLeft' });
    expect(onChange).toHaveBeenCalledWith(expect.stringMatching(/^#[\da-f]{6}$/));
  });

  it('accepts valid hex text but does not publish an incomplete value', () => {
    const onChange = vi.fn();
    render(<ColorPicker defaultValue="#2563eb" onChange={onChange} />);
    const field = screen.getByLabelText('Hex color');

    fireEvent.input(field, { target: { value: '#12' } });
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.input(field, { target: { value: '#123456' } });
    expect(onChange).toHaveBeenLastCalledWith('#123456');
  });

  it('round-trips canonical six-digit colors', () => {
    expect(hsvToHex(hexToHsv('#7f56d9'))).toBe('#7f56d9');
    expect(hsvToHex(hexToHsv('#ffffff'))).toBe('#ffffff');
  });

  it('delegates saved-color persistence to the owning configuration store', () => {
    const onSaveColor = vi.fn();
    const onRemoveSavedColor = vi.fn();
    render(<ColorPicker value="#123456" savedColors={['#abcdef']} onSaveColor={onSaveColor} onRemoveSavedColor={onRemoveSavedColor} />);
    fireEvent.click(screen.getByRole('button', { name: 'Save #123456 to custom colors' }));
    expect(onSaveColor).toHaveBeenCalledWith('#123456');
    fireEvent.click(screen.getByRole('button', { name: 'Remove saved color #abcdef' }));
    expect(onRemoveSavedColor).toHaveBeenCalledWith('#abcdef');
  });
});

/* ── Choice controls ───────────────────────────────────────────────────────*/

describe('Checkbox', () => {
  it('renders a real native checkbox', () => {
    // Not a div with a click handler: the native element is what supplies
    // keyboard, form participation and correct announcement.
    render(<Checkbox checked={false} onChange={vi.fn()} label="Include archived" />);
    const box = screen.getByRole('checkbox', { name: /Include archived/ });
    expect(box.tagName).toBe('INPUT');
  });

  it('emits the toggled value', () => {
    const onChange = vi.fn();
    render(<Checkbox checked={false} onChange={onChange} label="A" />);
    fireEvent.click(screen.getByRole('checkbox'));
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('sets the indeterminate DOM property, which has no HTML attribute', () => {
    render(<Checkbox checked={false} indeterminate onChange={vi.fn()} label="All" />);
    expect(screen.getByRole<HTMLInputElement>('checkbox').indeterminate).toBe(true);
  });

  it('never shows indeterminate and checked at once', () => {
    // They say different things — "some" vs "all" — so both rendering would be
    // a contradiction the user has to resolve.
    render(<Checkbox checked indeterminate onChange={vi.fn()} label="All" />);
    const box = screen.getByRole<HTMLInputElement>('checkbox');
    expect(box.checked).toBe(true);
    expect(box.indeterminate).toBe(false);
  });

  it('refuses changes when read-only and restores the DOM value', () => {
    // A checkbox ignores the native readOnly attribute entirely.
    const onChange = vi.fn();
    render(<Checkbox checked onChange={onChange} readOnly label="Locked" />);
    const box = screen.getByRole<HTMLInputElement>('checkbox');
    fireEvent.click(box);
    expect(onChange).not.toHaveBeenCalled();
    expect(box.checked).toBe(true);
  });

  it('marks itself invalid on error', () => {
    render(<Checkbox checked={false} onChange={vi.fn()} error label="Accept" />);
    expect(screen.getByRole('checkbox').getAttribute('aria-invalid')).toBe('true');
  });

  it('wires its description with aria-describedby', () => {
    render(<Checkbox checked={false} onChange={vi.fn()} label="A" description="What this does." />);
    const id = screen.getByRole('checkbox').getAttribute('aria-describedby');
    expect(id).toBeTruthy();
    expect(document.getElementById(id!)?.textContent).toBe('What this does.');
  });

  it('inherits disabled from its FormField', () => {
    render(
      <FormField label="Locked field" disabled>
        <Checkbox checked={false} onChange={vi.fn()} label="Opt in" />
      </FormField>,
    );
    expect(screen.getByRole<HTMLInputElement>('checkbox').disabled).toBe(true);
  });
});

describe('CheckboxGroup', () => {
  const OPTS = [
    { value: 'hr', label: 'HR' },
    { value: 'hse', label: 'HSE' },
    { value: 'fin', label: 'Finance', disabled: true },
  ] as const;

  it('is a group, not a radiogroup', () => {
    render(<CheckboxGroup label="Modules" values={[]} onChange={vi.fn()} options={OPTS} />);
    expect(screen.getByRole('group', { name: 'Modules' })).toBeTruthy();
  });

  it('adds a value on tick and removes it on untick', () => {
    const onChange = vi.fn();
    const { rerender } = render(<CheckboxGroup label="M" values={[]} onChange={onChange} options={OPTS} />);
    fireEvent.click(screen.getByRole('checkbox', { name: 'HSE' }));
    expect(onChange).toHaveBeenCalledWith(['hse']);
    rerender(<CheckboxGroup label="M" values={['hse']} onChange={onChange} options={OPTS} />);
    fireEvent.click(screen.getByRole('checkbox', { name: 'HSE' }));
    expect(onChange).toHaveBeenLastCalledWith([]);
  });

  it('shows select-all as indeterminate for a partial selection', () => {
    render(<CheckboxGroup label="M" selectAllLabel="All" values={['hr']} onChange={vi.fn()} options={OPTS} />);
    expect(screen.getByRole<HTMLInputElement>('checkbox', { name: 'All' }).indeterminate).toBe(true);
  });

  it('select-all skips disabled options', () => {
    const onChange = vi.fn();
    render(<CheckboxGroup label="M" selectAllLabel="All" values={[]} onChange={onChange} options={OPTS} />);
    fireEvent.click(screen.getByRole('checkbox', { name: 'All' }));
    expect(onChange).toHaveBeenCalledWith(['hr', 'hse']);
  });
});

describe('RadioGroup', () => {
  const OPTS = [
    { value: 'weekly', label: 'Weekly' },
    { value: 'monthly', label: 'Monthly' },
  ] as const;

  it('renders a radiogroup of native radios sharing one name', () => {
    const { container } = render(<RadioGroup label="Frequency" value="weekly" onChange={vi.fn()} options={OPTS} />);
    expect(screen.getByRole('radiogroup', { name: 'Frequency' })).toBeTruthy();
    const radios = container.querySelectorAll<HTMLInputElement>('input[type="radio"]');
    expect(radios).toHaveLength(2);
    // A shared `name` is what gives native arrow-key movement.
    expect(radios[0]!.name).toBe(radios[1]!.name);
  });

  it('emits the chosen value', () => {
    const onChange = vi.fn();
    render(<RadioGroup label="F" value="weekly" onChange={onChange} options={OPTS} />);
    fireEvent.click(screen.getByRole('radio', { name: 'Monthly' }));
    expect(onChange).toHaveBeenCalledWith('monthly');
  });
});

describe('Switch', () => {
  it('uses role=switch, so it is announced on/off rather than checked', () => {
    render(<Switch checked onChange={vi.fn()} label="Require MFA" />);
    expect(screen.getByRole('switch', { name: /Require MFA/ })).toBeTruthy();
  });

  it('blocks re-toggling while pending', () => {
    const onChange = vi.fn();
    render(<Switch checked={false} onChange={onChange} pending label="S" />);
    const sw = screen.getByRole('switch');
    expect(sw.getAttribute('aria-busy')).toBe('true');
    fireEvent.click(sw);
    expect(onChange).not.toHaveBeenCalled();
  });
});

/* ── Typed inputs ──────────────────────────────────────────────────────────*/

describe('PasswordInput', () => {
  it('masks by default and reveals on demand', () => {
    render(<PasswordInput value="hunter2" onInput={vi.fn()} aria-label="Password" />);
    const input = screen.getByLabelText('Password');
    expect(input.getAttribute('type')).toBe('password');
    fireEvent.click(screen.getByLabelText('Show password'));
    expect(screen.getByLabelText('Password').getAttribute('type')).toBe('text');
    expect(document.querySelector('.ui-ctrl-lead svg')).not.toBeNull();
  });

  it('omits the reveal when it must not be shown', () => {
    render(<PasswordInput value="x" onInput={vi.fn()} revealable={false} aria-label="P" />);
    expect(screen.queryByLabelText('Show password')).toBeNull();
  });
});

describe('NumberInput', () => {
  it('emits a number', () => {
    const onChange = vi.fn();
    render(<NumberInput value={null} onChange={onChange} aria-label="N" />);
    fireEvent.input(screen.getByLabelText('N'), { target: { value: '42' } });
    expect(onChange).toHaveBeenCalledWith(42);
  });

  it('emits null for an empty field rather than 0', () => {
    // 0 and "not answered" are different facts; conflating them writes a real 0.
    const onChange = vi.fn();
    render(<NumberInput value={5} onChange={onChange} aria-label="N" />);
    fireEvent.input(screen.getByLabelText('N'), { target: { value: '' } });
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it('keeps a lone minus sign while it is being typed', () => {
    const onChange = vi.fn();
    render(<NumberInput value={null} onChange={onChange} aria-label="N" />);
    const input = screen.getByLabelText<HTMLInputElement>('N');
    fireEvent.input(input, { target: { value: '-' } });
    expect(input.value).toBe('-');
  });

  it('offers accessible step controls', () => {
    const onChange = vi.fn();
    render(<NumberInput value={100} onChange={onChange} step={5} aria-label="N" />);
    fireEvent.click(screen.getByRole('button', { name: 'Increase value' }));
    expect(onChange).toHaveBeenCalledWith(105);
    fireEvent.click(screen.getByRole('button', { name: 'Decrease value' }));
    expect(onChange).toHaveBeenCalledWith(95);
  });
});

describe('CurrencyInput', () => {
  it('stores minor units, not a float', () => {
    const onChange = vi.fn();
    render(<CurrencyInput valueMinor={null} onChange={onChange} aria-label="Amount" />);
    fireEvent.input(screen.getByLabelText('Amount'), { target: { value: '84.50' } });
    expect(onChange).toHaveBeenCalledWith(8450);
  });

  it('renders minor units as a major amount', () => {
    render(<CurrencyInput valueMinor={845000} onChange={vi.fn()} aria-label="Amount" />);
    expect(screen.getByLabelText<HTMLInputElement>('Amount').value).toBe('8450.00');
  });

  it('strips characters that cannot be part of an amount', () => {
    const onChange = vi.fn();
    render(<CurrencyInput valueMinor={null} onChange={onChange} aria-label="Amount" />);
    const input = screen.getByLabelText<HTMLInputElement>('Amount');
    fireEvent.input(input, { target: { value: '1a2' } });
    expect(input.value).toBe('12');
  });

  it('renders a currency symbol and supports a governed currency selector', () => {
    const onCurrencyChange = vi.fn();
    const { container } = render(<CurrencyInput valueMinor={100000} onChange={vi.fn()} currency="USD"
      currencies={['USD', 'TTD']} onCurrencyChange={onCurrencyChange} aria-label="Amount" />);
    expect(container.querySelector('.ui-ctrl-prefix')?.textContent).toBe('$');
    fireEvent.input(screen.getByLabelText('Currency'), { target: { value: 'TTD' } });
    expect(onCurrencyChange).toHaveBeenCalledWith('TTD');
  });
});

describe('PercentageInput', () => {
  it('stores a ratio and displays a percentage', () => {
    const onChange = vi.fn();
    render(<PercentageInput value={null} onChange={onChange} aria-label="Rate" />);
    fireEvent.input(screen.getByLabelText('Rate'), { target: { value: '12.5' } });
    expect(onChange).toHaveBeenCalledWith(0.125);
  });

  it('renders a ratio as its percentage', () => {
    render(<PercentageInput value={0.0825} onChange={vi.fn()} aria-label="Rate" />);
    expect(screen.getByLabelText<HTMLInputElement>('Rate').value).toBe('8.25');
  });

  it('uses the same accessible stepper treatment as NumberInput', () => {
    const onChange = vi.fn();
    render(<PercentageInput value={0.08} onChange={onChange} step={0.5} aria-label="Rate" />);
    fireEvent.click(screen.getByRole('button', { name: 'Increase value' }));
    expect(onChange).toHaveBeenCalledWith(0.085);
    fireEvent.click(screen.getByRole('button', { name: 'Decrease value' }));
    expect(onChange).toHaveBeenCalledWith(0.075);
  });
});

describe('PhoneInput', () => {
  it('uses the tel input mode', () => {
    render(<PhoneInput value="" onInput={vi.fn()} aria-label="Mobile" />);
    expect(screen.getByLabelText('Mobile').getAttribute('inputmode')).toBe('tel');
  });

  it('supports a country selector and dial prefix', () => {
    const onCountryChange = vi.fn();
    const { container } = render(<PhoneInput value="" onInput={vi.fn()} aria-label="Mobile"
      country="US" dialCode="+1" countries={[{ code: 'US', dialCode: '+1' }, { code: 'TT', dialCode: '+1 868' }]}
      onCountryChange={onCountryChange} />);
    expect(container.querySelector('.ui-ctrl-prefix')?.textContent).toBe('+1');
    fireEvent.input(screen.getByLabelText('Country calling code'), { target: { value: 'TT' } });
    expect(onCountryChange).toHaveBeenCalledWith('TT');
  });
});

/* ── Date & time ───────────────────────────────────────────────────────────*/

describe('DateInput', () => {
  it('renders a native date input', () => {
    render(<DateInput value="2026-09-01" onChange={vi.fn()} aria-label="Start" />);
    expect(screen.getByLabelText('Start').getAttribute('type')).toBe('date');
  });

  it('emits the ISO value', () => {
    const onChange = vi.fn();
    render(<DateInput value="" onChange={onChange} aria-label="Start" />);
    fireEvent.input(screen.getByLabelText('Start'), { target: { value: '2026-09-01' } });
    expect(onChange).toHaveBeenCalledWith('2026-09-01');
  });

  it('offers optional field guidance', () => {
    render(<DateInput value="" onChange={vi.fn()} helpTooltip="Choose a date" aria-label="Start" />);
    expect(screen.getByLabelText('Field help')).toBeTruthy();
  });

  it('clears from the clear affordance', () => {
    const onChange = vi.fn();
    render(<DateInput value="2026-09-01" onChange={onChange} clearable aria-label="Start" />);
    fireEvent.click(screen.getByLabelText('Clear'));
    expect(onChange).toHaveBeenCalledWith('');
  });

  it('stays focusable when read-only', () => {
    render(<DateInput value="2026-09-01" onChange={vi.fn()} readOnly aria-label="Start" />);
    const el = screen.getByLabelText<HTMLInputElement>('Start');
    expect(el.readOnly).toBe(true);
    expect(el.disabled).toBe(false);
  });
});

describe('TimeInput', () => {
  it('passes step through for quarter-hour granularity', () => {
    render(<TimeInput value="08:30" onChange={vi.fn()} step={900} aria-label="Start" />);
    expect(screen.getByLabelText('Start').getAttribute('step')).toBe('900');
  });
});

describe('DateRangeInput', () => {
  it('reports an inverted range', () => {
    render(<DateRangeInput value={{ from: '2026-08-28', to: '2026-08-01' }} onChange={vi.fn()} />);
    expect(screen.getByRole('alert').textContent).toContain('before the start date');
  });

  it('constrains each picker with the other value, not only the message', () => {
    // Reporting the error after the fact is not enough — the range should be
    // hard to enter in the first place.
    const { container } = render(<DateRangeInput value={{ from: '2026-08-01', to: '2026-08-28' }} onChange={vi.fn()} />);
    const [from, to] = Array.from(container.querySelectorAll<HTMLInputElement>('input[type="date"]'));
    expect(from!.getAttribute('max')).toBe('2026-08-28');
    expect(to!.getAttribute('min')).toBe('2026-08-01');
  });

  it('rejects a range longer than maxSpanDays', () => {
    render(<DateRangeInput value={{ from: '2026-01-01', to: '2026-12-31' }} onChange={vi.fn()} maxSpanDays={30} />);
    expect(screen.getByRole('alert').textContent).toContain('maximum is 30');
  });

  it('is silent until both ends are set', () => {
    render(<DateRangeInput value={{ from: '2026-08-28', to: '' }} onChange={vi.fn()} />);
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

/* ── File & OTP ────────────────────────────────────────────────────────────*/

function file(name: string, type: string, sizeBytes: number): File {
  const f = new File(['x'], name, { type });
  Object.defineProperty(f, 'size', { value: sizeBytes });
  return f;
}

/**
 * `input.files` is read-only in jsdom, so `fireEvent.change(input, {target:{files}})`
 * silently does nothing. Defining the property first is the only way to drive a
 * file input in tests.
 */
function pickFiles(input: HTMLInputElement, files: File[]): void {
  Object.defineProperty(input, 'files', { value: files, configurable: true });
  // `input`, matching what the component binds. `change` alone does nothing
  // once `preact/compat` is loaded, because compat remaps form-control handlers
  // onto the `input` event.
  fireEvent.input(input);
}

describe('FileInput', () => {
  it('accepts a matching file', () => {
    const onChange = vi.fn();
    const { container } = render(<FileInput files={[]} onChange={onChange} accept=".pdf" aria-label="Evidence" />);
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
    pickFiles(input, [file('a.pdf', 'application/pdf', 100)]);
    expect(onChange).toHaveBeenCalled();
    expect(onChange.mock.calls[0]?.[0] as File[]).toHaveLength(1);
  });

  it('rejects the wrong type before the caller sees it', () => {
    const onChange = vi.fn();
    const onReject = vi.fn();
    const { container } = render(<FileInput files={[]} onChange={onChange} accept=".pdf" onReject={onReject} aria-label="E" />);
    pickFiles(container.querySelector<HTMLInputElement>('input[type="file"]')!, [file('a.exe', 'application/x-msdownload', 10)]);
    expect(onReject).toHaveBeenCalled();
    expect((onReject.mock.calls[0]?.[0] as FileRejection[])[0]?.reason).toBe('type');
    expect(onChange.mock.calls[0]?.[0] as File[]).toHaveLength(0);
  });

  it('rejects an oversized file and names the limit', () => {
    const onReject = vi.fn();
    const { container } = render(<FileInput files={[]} onChange={vi.fn()} maxSizeMb={1} onReject={onReject} aria-label="E" />);
    pickFiles(container.querySelector<HTMLInputElement>('input[type="file"]')!, [file('big.pdf', 'application/pdf', 5 * 1024 * 1024)]);
    const rej = onReject.mock.calls[0]?.[0] as FileRejection[];
    expect(rej[0]?.reason).toBe('size');
    expect(rej[0]?.message).toContain('1 MB');
  });

  it('enforces maxFiles and reports the overflow', () => {
    const onChange = vi.fn();
    const onReject = vi.fn();
    const { container } = render(<FileInput files={[]} onChange={onChange} multiple maxFiles={1} onReject={onReject} aria-label="E" />);
    pickFiles(container.querySelector<HTMLInputElement>('input[type="file"]')!, [
      file('a.pdf', 'application/pdf', 10), file('b.pdf', 'application/pdf', 10),
    ]);
    expect(onChange.mock.calls[0]?.[0] as File[]).toHaveLength(1);
    expect((onReject.mock.calls[0]?.[0] as FileRejection[])[0]?.reason).toBe('count');
  });

  /* ── Trigger treatment ───────────────────────────────────────────────────
     The compact trigger exists because a file picker is NOT a Button: a
     `<label>` natively activates the input it wraps, and Button renders
     `<button>`/`<a>`. These assert the semantics that justify the separation,
     not the pixels. */
  it('renders the trigger as a LABEL wrapping the real file input, never a button', () => {
    const { container } = render(
      <FileInput files={[]} onChange={vi.fn()} triggerLabel="Attach" aria-label="Attach evidence" />,
    );
    const label = container.querySelector('label.ui-file-trigger');
    expect(label).toBeTruthy();
    // The input must be INSIDE the label — that containment is what makes a
    // click on the label open the OS picker with no JS at all.
    expect(label?.querySelector('input[type="file"]')).toBeTruthy();
    // No <button>: if this ever becomes one, the native activation is gone and
    // the only thing left holding it together would be a click handler.
    expect(container.querySelector('button')).toBeNull();
  });

  it('keeps the trigger input focusable rather than `hidden`', () => {
    // `hidden` would remove it from the tab order and strand keyboard users,
    // which is exactly what the legacy `style="display:none"` markup did.
    const { container } = render(<FileInput files={[]} onChange={vi.fn()} triggerLabel="Attach" aria-label="A" />);
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
    expect(input.hidden).toBe(false);
    expect(input.getAttribute('style')).toBeNull();
  });

  it('validates a trigger pick exactly like the dropzone', () => {
    const onChange = vi.fn();
    const onReject = vi.fn();
    const { container } = render(
      <FileInput files={[]} onChange={onChange} onReject={onReject} accept=".pdf" triggerLabel="Attach" aria-label="A" />,
    );
    pickFiles(container.querySelector<HTMLInputElement>('input[type="file"]')!, [file('a.exe', 'application/x-msdownload', 10)]);
    expect((onReject.mock.calls[0]?.[0] as FileRejection[])[0]?.reason).toBe('type');
    expect(onChange.mock.calls[0]?.[0] as File[]).toHaveLength(0);
  });

  it('shows the caller-supplied label and disables the input', () => {
    const { container } = render(
      <FileInput files={[]} onChange={vi.fn()} triggerLabel="Uploading…" disabled aria-label="A" />,
    );
    expect(screen.getByText('Uploading…')).toBeTruthy();
    expect(container.querySelector<HTMLInputElement>('input[type="file"]')?.disabled).toBe(true);
    expect(container.querySelector('.ui-file-trigger--disabled')).toBeTruthy();
  });

  it('carries the size modifier so it matches Button geometry', () => {
    const { container } = render(
      <FileInput files={[]} onChange={vi.fn()} triggerLabel="Attach" size="sm" aria-label="A" />,
    );
    expect(container.querySelector('.ui-file-trigger--sm')).toBeTruthy();
  });

  it('renders the dropzone, not a trigger, when no triggerLabel is given', () => {
    const { container } = render(<FileInput files={[]} onChange={vi.fn()} aria-label="A" />);
    expect(container.querySelector('.ui-file-trigger')).toBeNull();
    expect(container.querySelector('.ui-file')).toBeTruthy();
  });

  it('lists selected files with a remove control', () => {
    const onChange = vi.fn();
    render(<FileInput files={[file('report.pdf', 'application/pdf', 2048)]} onChange={onChange} aria-label="E" />);
    expect(screen.getByText('report.pdf')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Remove report.pdf'));
    expect(onChange).toHaveBeenCalledWith([]);
  });
});

describe('OtpInput', () => {
  it('renders one box per digit', () => {
    render(<OtpInput value="" onChange={vi.fn()} length={6} />);
    expect(screen.getAllByRole('textbox')).toHaveLength(6);
  });

  it('marks populated fields for the animated active treatment', () => {
    render(<OtpInput value="12" onChange={vi.fn()} length={4} />);
    const boxes = screen.getAllByRole('textbox');
    expect(boxes[0]!.classList.contains('is-filled')).toBe(true);
    expect(boxes[1]!.classList.contains('is-filled')).toBe(true);
    expect(boxes[2]!.classList.contains('is-filled')).toBe(false);
  });

  it('fills every box from a single paste', () => {
    // People paste codes. Landing all six digits in box one is the classic bug.
    const onChange = vi.fn();
    const onComplete = vi.fn();
    render(<OtpInput value="" onChange={onChange} length={6} onComplete={onComplete} />);
    fireEvent.paste(screen.getAllByRole('textbox')[0]!, {
      clipboardData: { getData: () => '123456' },
    });
    expect(onChange).toHaveBeenCalledWith('123456');
    expect(onComplete).toHaveBeenCalledWith('123456');
  });

  it('ignores non-digits', () => {
    const onChange = vi.fn();
    render(<OtpInput value="" onChange={onChange} length={4} />);
    fireEvent.paste(screen.getAllByRole('textbox')[0]!, { clipboardData: { getData: () => 'a1b2' } });
    expect(onChange).toHaveBeenCalledWith('12');
  });

  it('offers the OS one-time-code hint on the first box only', () => {
    render(<OtpInput value="" onChange={vi.fn()} length={4} />);
    const boxes = screen.getAllByRole('textbox');
    expect(boxes[0]!.getAttribute('autocomplete')).toBe('one-time-code');
    expect(boxes[1]!.getAttribute('autocomplete')).toBe('off');
  });
});

/* ── MultiSelect ───────────────────────────────────────────────────────────*/

describe('MultiSelect', () => {
  const OPTS = [
    { value: 'ops', label: 'Operations' },
    { value: 'hse', label: 'HSE' },
    { value: 'fin', label: 'Finance' },
  ];

  it('shows the placeholder when nothing is selected', () => {
    render(<MultiSelect values={[]} onChange={vi.fn()} options={OPTS} placeholder="Pick departments" aria-label="D" />);
    expect(screen.getByRole('combobox').textContent).toContain('Pick departments');
  });

  it('renders a chip per selection', () => {
    render(<MultiSelect values={['ops', 'hse']} onChange={vi.fn()} options={OPTS} aria-label="D" />);
    const trigger = screen.getByRole('combobox');
    expect(trigger.textContent).toContain('Operations');
    expect(trigger.textContent).toContain('HSE');
  });

  it('collapses beyond maxChips instead of growing without bound', () => {
    render(<MultiSelect values={['ops', 'hse', 'fin']} onChange={vi.fn()} options={OPTS} maxChips={1} aria-label="D" />);
    expect(screen.getByRole('combobox').textContent).toContain('+2 more');
  });

  it('removes a single value from its chip', () => {
    const onChange = vi.fn();
    render(<MultiSelect values={['ops', 'hse']} onChange={onChange} options={OPTS} aria-label="D" />);
    fireEvent.click(screen.getByLabelText('Remove Operations'));
    expect(onChange).toHaveBeenCalledWith(['hse']);
  });

  it('toggles an option and keeps the list open', () => {
    // Several picks per open is the entire point of a multi-select.
    const onChange = vi.fn();
    render(<MultiSelect values={[]} onChange={onChange} options={OPTS} searchable={false} aria-label="D" />);
    fireEvent.click(screen.getByRole('combobox'));
    fireEvent.pointerDown(screen.getByRole('option', { name: /HSE/ }));
    expect(onChange).toHaveBeenCalledWith(['hse']);
    expect(screen.getByRole('listbox')).toBeTruthy();
  });

  it('marks selected options aria-selected, not aria-checked', () => {
    render(<MultiSelect values={['hse']} onChange={vi.fn()} options={OPTS} searchable={false} aria-label="D" />);
    fireEvent.click(screen.getByRole('combobox'));
    expect(screen.getByRole('option', { name: /HSE/ }).getAttribute('aria-selected')).toBe('true');
  });

  it('refuses further selection at maxSelected', () => {
    const onChange = vi.fn();
    render(<MultiSelect values={['ops']} onChange={onChange} options={OPTS} maxSelected={1} searchable={false} aria-label="D" />);
    fireEvent.click(screen.getByRole('combobox'));
    fireEvent.pointerDown(screen.getByRole('option', { name: /HSE/ }));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('still allows DESELECTING at the limit', () => {
    // Otherwise the field locks: you cannot change your mind without a Clear all.
    const onChange = vi.fn();
    render(<MultiSelect values={['ops']} onChange={onChange} options={OPTS} maxSelected={1} searchable={false} aria-label="D" />);
    fireEvent.click(screen.getByRole('combobox'));
    fireEvent.pointerDown(screen.getByRole('option', { name: /Operations/ }));
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it('clears everything from the clear affordance', () => {
    const onChange = vi.fn();
    render(<MultiSelect values={['ops', 'hse']} onChange={onChange} options={OPTS} aria-label="D" />);
    fireEvent.click(screen.getByLabelText('Clear all'));
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it('does not open when read-only', () => {
    render(<MultiSelect values={['ops']} onChange={vi.fn()} options={OPTS} readOnly aria-label="D" />);
    fireEvent.click(screen.getByRole('combobox'));
    expect(screen.queryByRole('listbox')).toBeNull();
  });
});
