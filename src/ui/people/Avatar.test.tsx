import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/preact';
import { Avatar, avatarInitials } from './Avatar';
import { AvatarGroup } from './AvatarGroup';

describe('Avatar', () => {
  it('uses the real image and falls back after an image error', () => {
    render(<Avatar name="Sarah James" src="https://example.test/sarah.jpg" />);
    const image = screen.getByRole('img', { name: 'Sarah James' });
    expect(image.tagName).toBe('IMG');
    fireEvent.error(image);
    expect(screen.getByRole('img', { name: 'Sarah James' }).textContent).toBe('SJ');
  });

  it('derives human initials without titles or suffixes', () => {
    expect(avatarInitials('Dr. Camille Joseph')).toBe('CJ');
    expect(avatarInitials('Terrence Baptiste Jr.')).toBe('TB');
  });

  it('can be decorative when a visible name already exists', () => {
    render(<Avatar name="Sarah James" decorative />);
    expect(screen.queryByRole('img')).toBeNull();
    expect(document.querySelector('.ui-avatar')?.getAttribute('aria-hidden')).toBe('true');
  });
});

describe('AvatarGroup', () => {
  const people = [
    { id: '1', name: 'Sarah James' }, { id: '2', name: 'Amara Diallo' },
    { id: '3', name: 'Priya Ramkissoon' }, { id: '4', name: 'Jordan Alexander' },
  ];

  it('shows the requested maximum and names the overflow', () => {
    render(<AvatarGroup people={people} max={2} label="Case team" />);
    expect(screen.getByRole('list', { name: 'Case team' }).children).toHaveLength(3);
    expect(screen.getByLabelText('2 more: Priya Ramkissoon, Jordan Alexander')).toBeTruthy();
  });

  it('renders nothing for an empty group', () => {
    const { container } = render(<AvatarGroup people={[]} />);
    expect(container.firstChild).toBeNull();
  });
});
