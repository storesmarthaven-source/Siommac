import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/preact';
import { PageHeader } from './PageHeader';

describe('PageHeader', () => {
  it('renders one semantic page heading and the parent breadcrumb trail', () => {
    const { container } = render(
      <PageHeader icon="fa-users" module="HR" crumbs={['People']} title="Employees" sub="Employee master register" />,
    );

    expect(screen.getByRole('heading', { level: 1, name: 'Employees' })).toBeTruthy();
    expect(container.querySelector('.ui-page-crumb')?.textContent).toContain('HR');
    expect(container.querySelector('.ui-page-crumb')?.textContent).toContain('People');
    expect(container.querySelector('.ui-page-head-actions')).toBeNull();
  });
});
