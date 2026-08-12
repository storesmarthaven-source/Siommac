import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/preact';
import { Button } from '../../primitives/Button';
import { PageActionBar } from './PageActionBar';

describe('PageActionBar', () => {
  it('groups visible page actions under an accessible name', () => {
    render(
      <PageActionBar
        label="Employee actions"
        start={<span>24 employees</span>}
        secondary={<Button variant="secondary">Export</Button>}
        primary={<Button variant="primary">New employee</Button>}
      />,
    );

    expect(screen.getByRole('group', { name: 'Employee actions' })).toBeTruthy();
    expect(screen.getByText('24 employees')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Export' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'New employee' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'More page actions' })).toBeNull();
  });

  it('moves lower-frequency actions into the canonical menu', () => {
    const select = vi.fn();
    render(
      <PageActionBar
        label="Register actions"
        overflow={[{ id: 'archive', label: 'Archive register', danger: true, onSelect: select }]}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'More page actions' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Archive register' }));
    expect(select).toHaveBeenCalledOnce();
  });
});
