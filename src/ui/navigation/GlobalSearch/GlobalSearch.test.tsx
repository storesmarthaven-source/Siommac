import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/preact';

vi.mock('../../data/FileTypeIcon', () => ({
  FileTypeIcon: ({ type }: { type: string }) => <svg data-file-type={type} aria-hidden="true" />,
}));

import { GlobalSearch, type GlobalSearchProps } from './GlobalSearch';

function props(overrides: Partial<GlobalSearchProps> = {}): GlobalSearchProps {
  return {
    open: true,
    onClose: vi.fn(),
    value: 'roster',
    onValueChange: vi.fn(),
    placeholder: 'Search SIOMAC…',
    scopes: [{ id: 'all', label: 'All', icon: 'Search' }, { id: 'pages', label: 'Pages', icon: 'PanelsTopLeft' }],
    activeScope: 'all',
    onScopeChange: vi.fn(),
    groups: [{ id: 'pages', label: 'Pages', results: [{ id: 'planner', title: 'Planner', subtitle: 'Rostering · Plan weekly shifts', icon: 'CalendarRange' }] }],
    onSelect: vi.fn(),
    ...overrides,
  };
}

describe('GlobalSearch', () => {
  it('renders through the canonical dialog with scopes and grouped results', () => {
    render(<GlobalSearch {...props()} />);
    expect(screen.getByRole('dialog').className).toContain('ui-global-search');
    expect(screen.getByRole('searchbox', { name: 'Search SIOMAC…' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Pages/ }).getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByRole('option').textContent).toContain('Planner');
    expect(screen.getByRole('option').getAttribute('aria-selected')).toBe('false');
  });

  it('changes scope and activates the selected result with the keyboard', () => {
    const onScopeChange = vi.fn();
    const onSelect = vi.fn();
    render(<GlobalSearch {...props({ onScopeChange, onSelect })} />);
    fireEvent.click(screen.getByRole('button', { name: /Pages/ }));
    expect(onScopeChange).toHaveBeenCalledWith('pages');
    fireEvent.keyDown(screen.getByRole('searchbox'), { key: 'Enter' });
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'planner' }));
  });

  it('does not activate a disabled preview row', () => {
    const onSelect = vi.fn();
    render(<GlobalSearch {...props({ groups: [{ id: 'preview', label: 'Preview', results: [{ id: 'person', title: 'Jordan Peters', disabled: true }] }], onSelect })} />);
    fireEvent.click(screen.getByRole('option'));
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('uses the canonical file-type artwork for file results', () => {
    render(<GlobalSearch {...props({ groups: [{ id: 'files', label: 'Files', results: [{ id: 'sheet', title: 'Roster.xlsx', fileType: 'xlsx' }] }] })} />);
    expect(document.querySelector('.ui-global-search__result-file')).toBeTruthy();
    expect(document.querySelector('[data-file-type="xlsx"]')).toBeTruthy();
  });

  it('uses the canonical avatar group for crew conversations', () => {
    render(<GlobalSearch {...props({ groups: [{ id: 'messages', label: 'Messages', results: [{ id: 'crew-thread', title: 'Deck Crew', avatarGroup: [{ id: 'jordan', name: 'Jordan Peters' }, { id: 'robert', name: 'Robert James' }] }] }] })} />);
    expect(document.querySelector('.ui-global-search__result-avatar-group')).toBeTruthy();
    expect(screen.getByRole('list', { name: 'Deck Crew Members' })).toBeTruthy();
  });

  it('keeps existing results stable while a refined query is loading', () => {
    render(<GlobalSearch {...props({ loading: true })} />);
    expect(screen.getByRole('option').textContent).toContain('Planner');
    expect(document.querySelector('.ui-global-search__loading')).toBeNull();
    expect(document.querySelector('.ui-global-search__refreshing')).toBeTruthy();
    expect(screen.getByRole('listbox').getAttribute('aria-busy')).toBe('true');
  });

  it('uses the UI Kit activity animation for the first request when no results exist yet', () => {
    render(<GlobalSearch {...props({ groups: [], loading: true })} />);
    expect(document.querySelector('.ui-global-search__loading')).toBeTruthy();
    expect(document.querySelectorAll('.ui-activity-dots__track > span')).toHaveLength(4);
    expect(document.querySelector('.ui-skeleton')).toBeNull();
    expect(screen.queryByRole('option')).toBeNull();
  });

  it('shows the designed empty state only for a submitted query', () => {
    render(<GlobalSearch {...props({ groups: [], value: 'missing' })} />);
    expect(screen.getByText('No Matches Found')).toBeTruthy();
  });

  it('supports a designed idle empty state for a category with no recent entries', () => {
    render(<GlobalSearch {...props({ groups: [], value: '', emptyWhenIdle: true, emptyTitle: 'No Recent People' })} />);
    expect(screen.getByText('No Recent People')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Clear Filters' })).toBeNull();
  });

  it('renders the files empty-state artwork and clears filters through the supplied action', () => {
    const onEmptyAction = vi.fn();
    render(<GlobalSearch {...props({ groups: [], value: 'missing', emptyVariant: 'files', emptyTitle: 'No Files Found', onEmptyAction })} />);
    expect(screen.getByText('No Files Found')).toBeTruthy();
    expect(document.querySelectorAll('.ui-global-search__empty-files [data-file-type]')).toHaveLength(5);
    expect(Array.from(document.querySelectorAll('.ui-global-search__empty-files [data-file-type]')).map(node => node.getAttribute('data-file-type'))).toEqual(['docx', 'png', 'pdf', 'xlsx', 'pptx']);
    fireEvent.click(screen.getByRole('button', { name: 'Clear Filters' }));
    expect(onEmptyAction).toHaveBeenCalledOnce();
  });

  it('renders the people empty-state artwork with the canonical avatar group', () => {
    render(<GlobalSearch {...props({ groups: [], value: 'missing', emptyVariant: 'people', emptyPeople: [{ id: 'jordan', name: 'Jordan Peters' }, { id: 'sofia', name: 'Sofia Reyes' }] })} />);
    expect(document.querySelector('.ui-global-search__empty-people .ui-avatar-group')).toBeTruthy();
  });

  it.each(['pages', 'operations', 'rosters', 'work', 'documents', 'messages'] as const)(
    'renders distinct %s empty-state artwork',
    variant => {
      const view = render(<GlobalSearch {...props({ groups: [], value: '', emptyWhenIdle: true, emptyVariant: variant, emptyPeople: [{ id: 'jordan', name: 'Jordan Peters' }] })} />);
      const composition = document.querySelector(`.ui-global-search__empty-${variant}`);
      expect(composition).toBeTruthy();
      expect(composition?.classList.contains('ui-global-search__empty-cluster')).toBe(true);
      expect(composition?.querySelectorAll(':scope > span')).toHaveLength(5);
      view.unmount();
    },
  );

  it('renders large quick actions in the default view and activates them', () => {
    const onQuickAction = vi.fn();
    render(<GlobalSearch {...props({ value: '', quickActions: [{ id: 'planner', label: 'Open Planner', description: 'Plan roster coverage', icon: 'CalendarRange' }], onQuickAction })} />);
    const action = screen.getByRole('button', { name: /Open Planner/ });
    expect(action.querySelector('.ui-global-search__quick-icon svg')).toBeTruthy();
    fireEvent.click(action);
    expect(onQuickAction).toHaveBeenCalledWith(expect.objectContaining({ id: 'planner' }));
  });

  it('does not show quick actions until the view contains at least one entry', () => {
    render(<GlobalSearch {...props({ groups: [], value: '', emptyWhenIdle: true, quickActions: [{ id: 'planner', label: 'Open Planner', icon: 'CalendarRange' }] })} />);
    expect(screen.queryByRole('button', { name: /Open Planner/ })).toBeNull();
  });

  it('keeps supplied contextual quick actions visible while a query is active', () => {
    render(<GlobalSearch {...props({ value: 'Jordan', quickActions: [{ id: 'employees', label: 'Open Employee Master', icon: 'UsersRound' }] })} />);
    expect(screen.getByRole('button', { name: /Open Employee Master/ })).toBeTruthy();
  });
});
