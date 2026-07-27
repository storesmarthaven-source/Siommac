// @vitest-environment jsdom
//
// Behavioural cover for the shared filter toolbar: the Filters panel's wording and footer, the
// search clear affordance, and the outside-click contract that keeps a panel open while the
// user moves between its tabs and sections.

import { fireEvent, render, screen } from '@testing-library/preact';
import { useState } from 'preact/hooks';
import { describe, expect, it, vi } from 'vitest';
import { AdvancedFilter, FilterDropdown, TableSearch, useFilterDropdowns, type AdvTab } from './FilterBar';

function registerTabs(
  selected: { department: string[]; employmentType: string[]; training: string[] },
  onChange: (group: 'department' | 'employmentType' | 'training', value: string[]) => void,
): AdvTab[] {
  return [
    { name: 'Organization', blurb: 'Filter by department assignment.', sections: [
      { type: 'checklist', title: 'Department', options: ['ops', 'finance'], selected: selected.department,
        onChange: v => onChange('department', v) },
    ] },
    { name: 'Employment', blurb: 'Filter by employee / worker type.', sections: [
      { type: 'checklist', title: 'Employment Type', options: ['full_time', 'contract'], selected: selected.employmentType,
        onChange: v => onChange('employmentType', v) },
    ] },
    { name: 'Compliance', blurb: 'Filter by training readiness.', sections: [
      { type: 'checklist', title: 'Training Status', options: ['current', 'expired'], selected: selected.training,
        onChange: v => onChange('training', v) },
    ] },
  ];
}

/** A minimal stand-in for the register toolbar: the shared open-dropdown hook, the Status quick
 *  filter, the Filters panel, and an unrelated region of the page to click on. */
function Harness({ onReset = vi.fn() }: { onReset?: () => void }) {
  const { openId, setOpenId } = useFilterDropdowns();
  const [status, setStatus] = useState<string[]>([]);
  const [selected, setSelected] = useState({ department: [] as string[], employmentType: [] as string[], training: [] as string[] });
  return (
    <div>
      <div data-testid="page-body">elsewhere on the page</div>
      <FilterDropdown id="status-filter" label="Status" options={['active', 'on_leave']}
        selected={status} onChange={setStatus} openId={openId} setOpenId={setOpenId} />
      <AdvancedFilter id="advanced-filters" openId={openId} setOpenId={setOpenId}
        tabs={registerTabs(selected, (group, value) => setSelected(prev => ({ ...prev, [group]: value })))}
        onReset={() => { setSelected({ department: [], employmentType: [], training: [] }); onReset(); }}
        kicker={null} title="Filters" resetLabel="Reset Filters" doneLabel="Done" />
    </div>
  );
}

const openFilters = () => fireEvent.click(screen.getByRole('button', { name: /^Filters$|Filters Active/ }));
const filtersPanel = () => screen.queryByRole('menu', { name: 'Filters' });

describe('AdvancedFilter — Filters panel wording', () => {
  it('keeps the original tabbed panel and drops the duplicate "Advanced" wording', () => {
    render(<Harness />);
    expect(screen.queryByText('Advanced')).toBeNull();
    expect(screen.queryByText('Advanced Filters')).toBeNull();

    openFilters();
    // The tab rail and its three tabs are the original design, unchanged.
    expect(screen.getByRole('tablist')).toBeTruthy();
    for (const tab of ['Organization', 'Employment', 'Compliance']) {
      expect(screen.getByRole('tab', { name: tab })).toBeTruthy();
    }
    // Selections apply on click, so the footer confirm is an honest "Done".
    expect(screen.queryByRole('button', { name: /apply filters/i })).toBeNull();
    expect(screen.getByRole('button', { name: 'Reset Filters' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Done' })).toBeTruthy();
  });

  it('surfaces the active-filter count on the trigger', () => {
    render(<Harness />);
    openFilters();
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'ops' }));
    expect(screen.getByRole('button', { name: /1 Filters Active/ })).toBeTruthy();
  });
});

describe('AdvancedFilter — panel stays open while filtering', () => {
  it('survives moving between tabs and selecting in each section', () => {
    render(<Harness />);
    openFilters();

    // Regression: the page-level "click anywhere closes the open menu" handler fired for any
    // click that had not called stopPropagation(), so switching to another filter section
    // closed the whole panel mid-selection.
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'ops' }));
    expect(filtersPanel()).toBeTruthy();

    fireEvent.click(screen.getByRole('tab', { name: 'Employment' }));
    expect(filtersPanel()).toBeTruthy();
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'contract' }));
    expect(filtersPanel()).toBeTruthy();

    fireEvent.click(screen.getByRole('tab', { name: 'Compliance' }));
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'expired' }));
    expect(filtersPanel()).toBeTruthy();
    expect(screen.getByRole('button', { name: /3 Filters Active/ })).toBeTruthy();
  });

  it('survives clicking the panel head and the tab blurb', () => {
    render(<Harness />);
    openFilters();
    fireEvent.click(screen.getByText('Filter by department assignment.'));
    expect(filtersPanel()).toBeTruthy();
  });

  it('stays open on Reset Filters and closes on Done', () => {
    const onReset = vi.fn();
    render(<Harness onReset={onReset} />);
    openFilters();
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'ops' }));

    fireEvent.click(screen.getByRole('button', { name: 'Reset Filters' }));
    expect(onReset).toHaveBeenCalledOnce();
    expect(filtersPanel()).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(filtersPanel()).toBeNull();
  });

  it('closes on a genuine outside click and on Escape', () => {
    render(<Harness />);

    openFilters();
    fireEvent.click(screen.getByTestId('page-body'));
    expect(filtersPanel()).toBeNull();

    openFilters();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(filtersPanel()).toBeNull();
  });

  it('hands over cleanly when another toolbar dropdown is opened', () => {
    render(<Harness />);
    openFilters();

    fireEvent.click(screen.getByRole('button', { name: /Status/ }));
    expect(filtersPanel()).toBeNull();
    expect(screen.getByRole('menu', { name: 'Status' })).toBeTruthy();

    // Multi-select: picking a value must not collapse the quick filter.
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'active' }));
    expect(screen.getByRole('menu', { name: 'Status' })).toBeTruthy();
  });
});

describe('TableSearch', () => {
  function SearchHarness() {
    const [value, setValue] = useState('');
    return <TableSearch value={value} onChange={setValue} placeholder="Search name, email, employee no. or position" ariaLabel="Search employees" />;
  }

  it('exposes a clear button only while the box has text, and clears through onChange', () => {
    render(<SearchHarness />);
    expect(screen.queryByRole('button', { name: 'Clear search' })).toBeNull();

    const input = screen.getByRole<HTMLInputElement>('searchbox', { name: 'Search employees' });
    expect(input.placeholder).toBe('Search name, email, employee no. or position');

    fireEvent.input(input, { target: { value: 'ari' } });
    expect(screen.getByRole('button', { name: 'Clear search' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(screen.getByRole<HTMLInputElement>('searchbox', { name: 'Search employees' }).value).toBe('');
    expect(screen.queryByRole('button', { name: 'Clear search' })).toBeNull();
  });
});
