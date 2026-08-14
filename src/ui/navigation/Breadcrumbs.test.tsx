import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/preact';
import { Breadcrumbs } from './Breadcrumbs';

const ITEMS = [
  { label: 'Home', href: '/' },
  { label: 'People', href: '/people' },
  { label: 'Employees', href: '/people/employees' },
  { label: 'Sarah James', href: '/people/employees/42' },
  { label: 'Profile' },
];

describe('Breadcrumbs', () => {
  it('returns nothing for an empty trail', () => {
    const { container } = render(<Breadcrumbs items={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it('marks only the final item as the current page', () => {
    render(<Breadcrumbs items={ITEMS.slice(0, 3)} />);
    expect(screen.getByText('Employees').closest('[aria-current]')?.getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('link', { name: 'People' }).getAttribute('href')).toBe('/people');
  });

  it('collapses middle ancestors into an accessible popover', () => {
    render(<Breadcrumbs items={ITEMS} maxVisible={3} />);
    const overflow = screen.getByRole('button', { name: '3 hidden breadcrumbs' });
    fireEvent.click(overflow);
    expect(screen.getByRole('dialog', { name: 'Hidden breadcrumb ancestors' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'People' })).toBeTruthy();
  });

  it('supports action ancestors without pretending they are links', () => {
    const onSelect = vi.fn();
    render(<Breadcrumbs items={[{ label: 'Picker', onSelect }, { label: 'Current' }]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Picker' }));
    expect(onSelect).toHaveBeenCalledOnce();
  });

  it('supports an icon-only home item without losing its accessible name', () => {
    render(<Breadcrumbs items={[{ label: 'Home', href: '/', icon: <span aria-hidden="true">H</span>, iconOnly: true }, { label: 'Settings' }]} />);
    expect(screen.getByRole('link', { name: 'Home' })).toBeTruthy();
    expect(screen.getByText('Home').classList.contains('ui-breadcrumbs__sr-only')).toBe(true);
  });
});
