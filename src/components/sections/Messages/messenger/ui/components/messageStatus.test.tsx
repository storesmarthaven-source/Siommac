/**
 * MessageStatus renders the sender's read receipt from readByCount (a real read
 * wins over the delivery state). This is the content that the sender-only
 * receipt row shows for every outgoing message, including attachment-only ones.
 */
import { render } from '@testing-library/preact';
import { describe, it, expect } from 'vitest';
import type { Message } from '../../domain/models';
import { MessageStatus } from './MessageThread';

// MessageStatus only reads delivery + readByCount; a minimal stub is enough.
const msg = (delivery: Message['delivery'], readByCount: number): Message =>
  ({ delivery, readByCount } as Message);

describe('MessageStatus — read receipt from readByCount', () => {
  it('shows "Read" (singular) when exactly one participant has read', () => {
    const { container } = render(<MessageStatus message={msg('sent', 1)} />);
    expect(container.querySelector('.sm-delivery.is-read')).toBeTruthy();
    expect(container.textContent).toBe('Read');
  });

  it('shows "Read by N" when more than one has read', () => {
    const { container } = render(<MessageStatus message={msg('sent', 3)} />);
    expect(container.textContent).toBe('Read by 3');
  });

  it('shows no read label before anyone has read (sent / delivered)', () => {
    expect(render(<MessageStatus message={msg('sent', 0)} />).container.querySelector('.is-read')).toBeNull();
    expect(render(<MessageStatus message={msg('delivered', 0)} />).container.textContent).toBe('');
  });

  it('a real read wins even if delivery still says sent', () => {
    const { container } = render(<MessageStatus message={msg('sent', 2)} />);
    expect(container.querySelector('.is-read')).toBeTruthy();
  });
});
