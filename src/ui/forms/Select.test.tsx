/**
 * Select / Combobox / PersonSearchSelect — behaviour.
 *
 * The keyboard model is the whole point of these components, so it is what is
 * tested: arrow navigation across group boundaries, disabled options being
 * skipped, Escape not leaking to a parent overlay, and the async race that makes
 * a slow early response overwrite a fast later one.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/preact';
import { Select } from './Select';
import { Combobox } from './Combobox';
import { PersonSearchSelect, type PersonOption } from './PersonSearchSelect';
import { type Option, type OptionGroup } from './options';

const OPTS: Option[] = [
  { value: 'a', label: 'Alpha' },
  { value: 'b', label: 'Bravo', disabled: true },
  { value: 'c', label: 'Charlie', subtitle: 'Third' },
];

const GROUPED: OptionGroup[] = [
  { group: 'Ops',     options: [{ value: 'a', label: 'Alpha' }] },
  { group: 'Finance', options: [{ value: 'z', label: 'Zulu' }] },
];

function openSelect(): HTMLElement {
  const trigger = screen.getByRole('combobox');
  fireEvent.click(trigger);
  return trigger;
}

describe('Select', () => {
  it('shows the placeholder until a value is chosen', () => {
    render(<Select value="" onChange={vi.fn()} options={OPTS} placeholder="Pick one" aria-label="S" />);
    expect(screen.getByRole('combobox').textContent).toContain('Pick one');
  });

  it('shows the selected option label', () => {
    render(<Select value="c" onChange={vi.fn()} options={OPTS} aria-label="S" />);
    expect(screen.getByRole('combobox').textContent).toContain('Charlie');
  });

  it('opens on click and exposes aria-expanded', () => {
    render(<Select value="" onChange={vi.fn()} options={OPTS} aria-label="S" />);
    const trigger = screen.getByRole('combobox');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('listbox')).toBeTruthy();
  });

  it('opens on ArrowDown from the closed state', () => {
    render(<Select value="" onChange={vi.fn()} options={OPTS} aria-label="S" />);
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'ArrowDown' });
    expect(screen.getByRole('listbox')).toBeTruthy();
  });

  it('selects an option on click', () => {
    const onChange = vi.fn();
    render(<Select value="" onChange={onChange} options={OPTS} aria-label="S" />);
    openSelect();
    fireEvent.pointerDown(screen.getByRole('option', { name: /Alpha/ }));
    expect(onChange).toHaveBeenCalledWith('a');
  });

  it('commits the active option on Enter', () => {
    const onChange = vi.fn();
    render(<Select value="" onChange={onChange} options={OPTS} aria-label="S" />);
    const trigger = openSelect();
    fireEvent.keyDown(trigger, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith('a');
  });

  // ── Keyboard navigation ───────────────────────────────────────────────────

  it('skips disabled options when arrowing', () => {
    const onChange = vi.fn();
    render(<Select value="" onChange={onChange} options={OPTS} aria-label="S" />);
    const trigger = openSelect();
    // Opens on Alpha; ArrowDown must jump over the disabled Bravo to Charlie.
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    fireEvent.keyDown(trigger, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith('c');
  });

  it('never activates a disabled option by click', () => {
    const onChange = vi.fn();
    render(<Select value="" onChange={onChange} options={OPTS} aria-label="S" />);
    openSelect();
    fireEvent.pointerDown(screen.getByRole('option', { name: /Bravo/ }));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('wraps from the last option back to the first', () => {
    const onChange = vi.fn();
    render(<Select value="c" onChange={onChange} options={OPTS} aria-label="S" />);
    const trigger = openSelect();       // opens on Charlie (last)
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    fireEvent.keyDown(trigger, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith('a');
  });

  it('jumps to the last option on End', () => {
    const onChange = vi.fn();
    render(<Select value="" onChange={onChange} options={OPTS} aria-label="S" />);
    const trigger = openSelect();
    fireEvent.keyDown(trigger, { key: 'End' });
    fireEvent.keyDown(trigger, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith('c');
  });

  it('navigates across group boundaries', () => {
    const onChange = vi.fn();
    render(<Select value="" onChange={onChange} options={GROUPED} aria-label="S" />);
    const trigger = openSelect();
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });   // Alpha (Ops) → Zulu (Finance)
    fireEvent.keyDown(trigger, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith('z');
  });

  it('renders group headers', () => {
    render(<Select value="" onChange={vi.fn()} options={GROUPED} aria-label="S" />);
    openSelect();
    expect(screen.getByRole('group', { name: 'Finance' })).toBeTruthy();
  });

  it('jumps to an option by typeahead', () => {
    const onChange = vi.fn();
    render(<Select value="" onChange={onChange} options={OPTS} aria-label="S" />);
    const trigger = openSelect();
    fireEvent.keyDown(trigger, { key: 'c' });
    fireEvent.keyDown(trigger, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith('c');
  });

  it('closes on Escape without changing the value', () => {
    const onChange = vi.fn();
    render(<Select value="" onChange={onChange} options={OPTS} aria-label="S" />);
    const trigger = openSelect();
    fireEvent.keyDown(trigger, { key: 'Escape' });
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('does not leak Escape to a surrounding overlay', () => {
    // A dropdown inside a dialog must swallow the first Escape — otherwise one
    // keypress closes both and the user loses the form.
    const outer = vi.fn();
    render(
      <div onKeyDown={outer}>
        <Select value="" onChange={vi.fn()} options={OPTS} aria-label="S" />
      </div>,
    );
    const trigger = openSelect();
    fireEvent.keyDown(trigger, { key: 'Escape' });
    expect(outer).not.toHaveBeenCalled();
  });

  // ── States ────────────────────────────────────────────────────────────────

  it('does not open when disabled', () => {
    render(<Select value="" onChange={vi.fn()} options={OPTS} disabled aria-label="S" />);
    fireEvent.click(screen.getByRole('combobox'));
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('does not open when read-only, but stays focusable', () => {
    render(<Select value="a" onChange={vi.fn()} options={OPTS} readOnly aria-label="S" />);
    const trigger = screen.getByRole<HTMLButtonElement>('combobox');
    fireEvent.click(trigger);
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(trigger.disabled).toBe(false);
  });

  it('clears the value from the clear affordance', () => {
    const onChange = vi.fn();
    render(<Select value="a" onChange={onChange} options={OPTS} clearable aria-label="S" />);
    fireEvent.click(screen.getByLabelText('Clear selection'));
    expect(onChange).toHaveBeenCalledWith('');
  });

  it('marks the selected option aria-selected', () => {
    render(<Select value="a" onChange={vi.fn()} options={OPTS} aria-label="S" />);
    openSelect();
    expect(screen.getByRole('option', { name: /Alpha/ }).getAttribute('aria-selected')).toBe('true');
  });

  it('shows an empty state when there are no options', () => {
    render(<Select value="" onChange={vi.fn()} options={[]} emptyLabel="Nothing here" aria-label="S" />);
    openSelect();
    expect(screen.getByText('Nothing here')).toBeTruthy();
  });
});

describe('Combobox', () => {
  it('filters static options as you type', async () => {
    render(<Combobox value="" onChange={vi.fn()} options={OPTS} aria-label="C" />);
    const input = screen.getByRole('combobox');
    fireEvent.click(input);
    fireEvent.input(input, { target: { value: 'char' } });
    await waitFor(() => {
      expect(screen.queryByRole('option', { name: /Alpha/ })).toBeNull();
      expect(screen.getByRole('option', { name: /Charlie/ })).toBeTruthy();
    });
  });

  it('runs an async search and renders its results', async () => {
    const search = vi.fn().mockResolvedValue([{ value: 'x', label: 'Xray' }]);
    render(<Combobox value="" onChange={vi.fn()} search={search} debounceMs={0} aria-label="C" />);
    const input = screen.getByRole('combobox');
    fireEvent.click(input);
    fireEvent.input(input, { target: { value: 'x' } });
    await waitFor(() => expect(screen.getByRole('option', { name: /Xray/ })).toBeTruthy());
  });

  it('surfaces a failed search as an error, not as "no results"', async () => {
    // A broken request that renders an empty list makes the user retype forever.
    const search = vi.fn().mockRejectedValue(new Error('Network down'));
    render(<Combobox value="" onChange={vi.fn()} search={search} debounceMs={0} aria-label="C" />);
    const input = screen.getByRole('combobox');
    fireEvent.click(input);
    fireEvent.input(input, { target: { value: 'q' } });
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Network down'));
  });

  it('ignores a stale async response that resolves after a newer one', async () => {
    // Deleting a character must not leave the list showing results for the
    // longer query just because that request was slower.
    const search = vi.fn()
      .mockImplementationOnce(() => new Promise(res => setTimeout(() => res([{ value: 'old', label: 'Stale' }]), 60)))
      .mockImplementationOnce(() => Promise.resolve([{ value: 'new', label: 'Fresh' }]));

    render(<Combobox value="" onChange={vi.fn()} search={search} debounceMs={0} aria-label="C" />);
    const input = screen.getByRole('combobox');
    fireEvent.click(input);
    fireEvent.input(input, { target: { value: 'ab' } });
    // Let the first request actually launch before typing again — otherwise the
    // debounce cancels it and there is no race left to test.
    await new Promise(r => setTimeout(r, 10));
    fireEvent.input(input, { target: { value: 'a' } });

    await waitFor(() => expect(screen.getByRole('option', { name: /Fresh/ })).toBeTruthy());
    await new Promise(r => setTimeout(r, 90));
    expect(screen.queryByRole('option', { name: /Stale/ })).toBeNull();
  });

  it('enforces minChars before searching', async () => {
    const search = vi.fn().mockResolvedValue([]);
    render(<Combobox value="" onChange={vi.fn()} search={search} minChars={3} debounceMs={0} aria-label="C" />);
    const input = screen.getByRole('combobox');
    fireEvent.click(input);
    fireEvent.input(input, { target: { value: 'ab' } });
    await new Promise(r => setTimeout(r, 20));
    expect(search).not.toHaveBeenCalled();
    expect(screen.getByText(/Type 3\+ characters/)).toBeTruthy();
  });
});

describe('PersonSearchSelect', () => {
  const PEOPLE: PersonOption[] = [
    { id: 'p1', name: 'Sarah James', employeeNo: 'EMP-00484', jobTitle: 'Safety Officer', department: 'HSE' },
    { id: 'p2', name: 'Amara Diallo', employeeNo: 'EMP-00010', department: 'Operations', badges: ['On leave'] },
  ];

  it('lists people with their name and meta line', () => {
    render(<PersonSearchSelect value={null} onChange={vi.fn()} people={PEOPLE} aria-label="Owner" />);
    fireEvent.click(screen.getByRole('combobox'));
    const opt = screen.getByRole('option', { name: /Sarah James/ });
    expect(opt.textContent).toContain('EMP-00484');
    expect(opt.textContent).toContain('HSE');
  });

  it('renders badges', () => {
    render(<PersonSearchSelect value={null} onChange={vi.fn()} people={PEOPLE} aria-label="Owner" />);
    fireEvent.click(screen.getByRole('combobox'));
    expect(screen.getByText('On leave')).toBeTruthy();
  });

  it('emits the person id on selection', () => {
    const onChange = vi.fn();
    render(<PersonSearchSelect value={null} onChange={onChange} people={PEOPLE} aria-label="Owner" />);
    fireEvent.click(screen.getByRole('combobox'));
    fireEvent.pointerDown(screen.getByRole('option', { name: /Amara/ }));
    expect(onChange).toHaveBeenCalledWith('p2');
  });

  it('emits null when cleared, never an empty string', () => {
    // The consumer stores this in a nullable FK column; '' would be a bad write.
    const onChange = vi.fn();
    render(<PersonSearchSelect value="p1" onChange={onChange} people={PEOPLE} aria-label="Owner" />);
    fireEvent.click(screen.getByLabelText('Clear selection'));
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it('drops empty meta segments instead of rendering "· ·"', () => {
    const sparse: PersonOption[] = [{ id: 'p3', name: 'No Meta' }];
    render(<PersonSearchSelect value={null} onChange={vi.fn()} people={sparse} aria-label="Owner" />);
    fireEvent.click(screen.getByRole('combobox'));
    expect(screen.getByRole('option', { name: /No Meta/ }).textContent).not.toContain('·');
  });
});
