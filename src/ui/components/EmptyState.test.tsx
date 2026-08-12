import { render, screen } from '@testing-library/preact';
import { describe, expect, it } from 'vitest';
import { EmptyState } from './EmptyState';

describe('EmptyState', () => {
  it('renders configurable heading guidance without announcing static content', () => {
    const { container } = render(
      <EmptyState icon="fa-folder-open" title="No documents" text="Upload the first document." headingLevel={2} />,
    );
    expect(screen.getByRole('heading', { level: 2, name: 'No documents' })).toBeTruthy();
    expect(screen.getByText('Upload the first document.')).toBeTruthy();
    expect(container.querySelector('.ui-empty')?.hasAttribute('role')).toBe(false);
  });

  it('supports compact async states and icon nodes', () => {
    const { container } = render(
      <EmptyState icon={<svg />} title="No results" size="compact" role="status" />,
    );
    expect(screen.getByRole('status')).toBeTruthy();
    expect(container.querySelector('.ui-empty--compact')).toBeTruthy();
    expect(container.querySelector('.ui-empty-icon')?.getAttribute('aria-hidden')).toBe('true');
  });
});
