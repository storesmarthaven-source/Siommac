import { fireEvent, render, screen } from '@testing-library/preact';
import { describe, expect, it, vi } from 'vitest';
import { Button } from '../primitives/Button';
import { IconTile } from './IconTile';
import { NotificationIcon } from './NotificationIcon';
import { NotificationListItem } from './NotificationListItem';
import { NotificationPopover } from './NotificationPopover';

describe('IconTile', () => {
  it('applies the requested tone, size and shape without exposing decorative icons', () => {
    const { container } = render(<IconTile icon="Workflow" tone="teal" size="lg" shape="circle" />);
    const tile = container.querySelector('.ui-icon-tile');
    expect(tile?.classList.contains('ui-icon-tile--teal')).toBe(true);
    expect(tile?.classList.contains('ui-icon-tile--lg')).toBe(true);
    expect(tile?.classList.contains('ui-icon-tile--circle')).toBe(true);
    expect(tile?.getAttribute('aria-hidden')).toBe('true');
  });

  it('becomes a named image when its icon conveys unique information', () => {
    render(<IconTile icon="TriangleAlert" tone="danger" label="Critical incident" />);
    expect(screen.getByRole('img', { name: 'Critical incident' })).toBeTruthy();
  });

  it('provides the governed solid group-container tone', () => {
    const { container } = render(<IconTile icon="FolderTree" tone="group" />);
    expect(container.querySelector('.ui-icon-tile--group')).toBeTruthy();
  });
});

describe('NotificationIcon', () => {
  it('owns the icon and palette pairing for each semantic notification type', () => {
    const { container, rerender } = render(<NotificationIcon variant="approval" />);
    expect(container.querySelector('.ui-icon-tile--indigo')).toBeTruthy();

    rerender(<NotificationIcon variant="reminder" />);
    expect(container.querySelector('.ui-icon-tile--cyan')).toBeTruthy();

    rerender(<NotificationIcon variant="finance" />);
    expect(container.querySelector('.ui-icon-tile--orange')).toBeTruthy();
  });
});

describe('NotificationListItem', () => {
  it('keeps the primary row and the optional action as separate controls', () => {
    const open = vi.fn();
    const review = vi.fn();
    const archive = vi.fn();
    render(<NotificationListItem
      title="Workflow approved"
      description="The request is ready for review."
      metadata={['Workflow', 'WF-2026-3405']}
      timestamp="14m ago"
      icon="Workflow"
      iconTone="teal"
      unread
      indicatorTone="success"
      details={<span>Safety-report.pdf</span>}
      controls={<Button iconOnly aria-label="Archive Notification" iconLeft={<span />} onClick={archive} />}
      action={<Button size="sm" onClick={review}>Review</Button>}
      onOpen={open}
    />);

    fireEvent.click(screen.getByRole('button', { name: /Workflow approved/ }));
    expect(open).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Review' }));
    expect(review).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Archive Notification' }));
    expect(archive).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Safety-report.pdf')).toBeTruthy();
    expect(screen.getByLabelText('Unread')).toBeTruthy();
  });

  it('exposes unread as a governed row state and accepts semantic icons', () => {
    const { container } = render(<NotificationListItem
      title="Approval required"
      timestamp="now"
      iconVariant="approval"
      unread
      onOpen={vi.fn()}
    />);

    expect(container.querySelector('.ui-notification-item.is-unread')).toBeTruthy();
    expect(container.querySelector('.ui-icon-tile--indigo')).toBeTruthy();
  });
});

describe('NotificationPopover', () => {
  it('provides the canonical header, scrolling body and footer regions', () => {
    const { rerender, container } = render(<NotificationPopover
      headerActions={<Button size="sm">Settings</Button>}
      navigation={<div>Views</div>}
      footer={<Button size="sm">View All</Button>}
      resetScrollKey="all"
    >
      <div>Notification results</div>
    </NotificationPopover>);

    expect(screen.getByRole('dialog', { name: 'Notifications' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Notifications' })).toBeTruthy();
    expect(screen.getByText('Views')).toBeTruthy();
    expect(screen.getByText('Notification results')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'View All' })).toBeTruthy();

    const body = container.querySelector('.ui-notification-popover__body')!;
    body.scrollTop = 120;
    rerender(<NotificationPopover resetScrollKey="unread"><div>Unread results</div></NotificationPopover>);
    expect(body.scrollTop).toBe(0);
  });
});
