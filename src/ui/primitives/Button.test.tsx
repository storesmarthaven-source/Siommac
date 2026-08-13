/**
 * Button.test.tsx — behaviour, not appearance.
 *
 * These assert the things that actually break in production: double-submits,
 * icon-only buttons with no accessible name, and disabled controls that still
 * fire their handler. Screenshot tests would pass on all three.
 *
 * Plain DOM assertions, matching the rest of the repo — `@testing-library/jest-dom`
 * is not installed and is not worth a dependency for `toHaveAttribute`.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/preact';
import { type VNode } from 'preact';
import { Button } from './Button';

const Icon = (): VNode => <svg data-testid="icon" />;

describe('Button', () => {
  it('renders its label and fires onClick', () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Save</Button>);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('applies the variant and size recipe classes', () => {
    render(<Button variant="danger" size="lg">Delete</Button>);
    const btn = screen.getByRole('button');
    expect(btn.className).toContain('ui-btn--danger');
    expect(btn.className).toContain('ui-btn--lg');
  });

  it('omits the size class at the default size', () => {
    render(<Button>Go</Button>);
    expect(screen.getByRole('button').className).not.toContain('ui-btn--md');
  });

  // ── Disabled ──────────────────────────────────────────────────────────────

  it('does not fire onClick when disabled', () => {
    const onClick = vi.fn();
    render(<Button disabled onClick={onClick}>Save</Button>);
    fireEvent.click(screen.getByRole('button'));
    expect(onClick).not.toHaveBeenCalled();
  });

  it('marks a disabled button as disabled for assistive tech', () => {
    render(<Button disabled>Save</Button>);
    expect(screen.getByRole<HTMLButtonElement>('button').disabled).toBe(true);
  });

  // ── Loading ───────────────────────────────────────────────────────────────

  it('prevents a duplicate submit while loading', () => {
    const onClick = vi.fn();
    render(<Button loading onClick={onClick}>Save</Button>);
    const btn = screen.getByRole('button');
    fireEvent.click(btn);
    fireEvent.click(btn);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('announces loading with aria-busy', () => {
    render(<Button loading>Save</Button>);
    expect(screen.getByRole('button').getAttribute('aria-busy')).toBe('true');
  });

  it('keeps a loading button focusable so focus is not lost mid-submit', () => {
    // A `disabled` button is removed from the tab order; a user who tabbed to
    // Save and pressed Enter would have focus thrown to the top of the page.
    render(<Button loading>Save</Button>);
    expect(screen.getByRole<HTMLButtonElement>('button').disabled).toBe(false);
  });

  it('KEEPS the label while loading, so a migration invents no new copy', () => {
    /* The label used to be hidden behind a centred spinner, which meant every
       call site had to supply `loadingText` just to keep the words it already
       had. Across a migration that is hundreds of invented strings. */
    render(<Button loading>Save</Button>);
    expect(screen.getByRole('button').textContent).toContain('Save');
  });

  it('puts the spinner where the leading icon was, so width does not jump', () => {
    const icon = <svg data-testid="icon" />;
    const { container, rerender } = render(<Button iconLeft={icon}>Save</Button>);
    expect(container.querySelector('[data-testid="icon"]')).not.toBeNull();
    expect(container.querySelector('.ui-btn-spinner')).toBeNull();

    rerender(<Button iconLeft={icon} loading>Save</Button>);
    expect(container.querySelector('[data-testid="icon"]'), 'icon should yield to the spinner').toBeNull();
    expect(container.querySelector('.ui-btn-spinner')).not.toBeNull();
  });

  it('shows loadingText in place of the label when provided', () => {
    render(<Button loading loadingText="Saving…">Save</Button>);
    expect(screen.getByRole('button').textContent).toContain('Saving…');
    expect(screen.getByRole('button').textContent).not.toContain('Save app');
  });

  it('composes tone="danger" with a quiet variant for low-emphasis destruction', () => {
    // Intent and emphasis are separate axes: "Delete band" beside a primary
    // Save is destructive AND quiet. Forcing it to filled red shouts.
    const { container } = render(<Button variant="outline" tone="danger">Delete band</Button>);
    const btn = container.querySelector('button')!;
    expect(btn.className).toContain('ui-btn--outline');
    expect(btn.className).toContain('ui-btn--tone-danger');
    expect(btn.className).not.toContain('ui-btn--danger ');
  });

  it('ignores tone on the filled danger variant, which already carries intent', () => {
    const { container } = render(<Button variant="danger" tone="danger">Delete</Button>);
    expect(container.querySelector('button')!.className).not.toContain('ui-btn--tone-danger');
  });

  it('defaults to no tone', () => {
    const { container } = render(<Button variant="outline">Edit</Button>);
    expect(container.querySelector('button')!.className).not.toContain('tone-danger');
  });

  it('renders a spinner while loading', () => {
    const { container } = render(<Button loading>Save</Button>);
    expect(container.querySelector('.ui-btn-spinner')).not.toBeNull();
  });

  it('renders no spinner when idle', () => {
    const { container } = render(<Button>Save</Button>);
    expect(container.querySelector('.ui-btn-spinner')).toBeNull();
  });

  // ── Form semantics ────────────────────────────────────────────────────────

  it('is a real <button>, so Enter and Space activate it natively', () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Save</Button>);
    const btn = screen.getByRole('button');
    expect(btn.tagName).toBe('BUTTON');
    fireEvent.click(btn);
    expect(onClick).toHaveBeenCalled();
  });

  it('defaults to type=button so it cannot accidentally submit a form', () => {
    render(<Button>Cancel</Button>);
    expect(screen.getByRole('button').getAttribute('type')).toBe('button');
  });

  it('can opt into submit', () => {
    render(<Button type="submit">Save</Button>);
    expect(screen.getByRole('button').getAttribute('type')).toBe('submit');
  });

  // ── Icons & layout ────────────────────────────────────────────────────────

  it('renders leading and trailing icons', () => {
    render(<Button iconLeft={<Icon />} iconRight={<Icon />}>Both</Button>);
    expect(screen.getAllByTestId('icon')).toHaveLength(2);
  });

  it('applies the full-width class', () => {
    render(<Button fullWidth>Wide</Button>);
    expect(screen.getByRole('button').className).toContain('ui-btn--full');
  });

  // ── Forced state (Gallery preview only) ───────────────────────────────────

  it('emits data-ui-state for forceable preview states', () => {
    render(<Button forceState="hover">Hover</Button>);
    expect(screen.getByRole('button').getAttribute('data-ui-state')).toBe('hover');
  });

  it('ignores forceState for states that have real props', () => {
    // `disabled` must come from the prop, never from a forced attribute —
    // otherwise the preview would look disabled while still being clickable.
    render(<Button forceState="disabled">Nope</Button>);
    const btn = screen.getByRole<HTMLButtonElement>('button');
    expect(btn.getAttribute('data-ui-state')).toBeNull();
    expect(btn.disabled).toBe(false);
  });
});

describe('Button — icon-only', () => {
  it('takes its accessible name from the required aria-label', () => {
    // `iconOnly` makes aria-label mandatory at the TYPE level — that guarantee is
    // why the old IconButton wrapper existed, and why deleting it cost nothing.
    render(<Button iconOnly aria-label="Delete row" iconLeft={<Icon />} />);
    expect(screen.getByRole('button', { name: 'Delete row' })).toBeTruthy();
  });

  it('renders as a square icon-only control', () => {
    render(<Button iconOnly aria-label="Close" iconLeft={<Icon />} />);
    expect(screen.getByRole('button').className).toContain('ui-btn--icon');
  });
});

describe('Button — toggle', () => {
  it('emits aria-pressed, not aria-checked', () => {
    // aria-checked would tell the user they are in a single-choice group.
    render(<Button pressed>Only mine</Button>);
    const btn = screen.getByRole('button', { name: 'Only mine' });
    expect(btn.getAttribute('aria-pressed')).toBe('true');
    expect(btn.getAttribute('aria-checked')).toBeNull();
  });

  it('is not a toggle unless `pressed` is given', () => {
    render(<Button>Save</Button>);
    expect(screen.getByRole('button').getAttribute('aria-pressed')).toBeNull();
  });
});

describe('Button — link', () => {
  it('renders a real <a> when it navigates', () => {
    // A <button> styled as a link breaks middle-click and open-in-new-tab.
    render(<Button variant="link" href="/audit">Audit trail</Button>);
    const el = screen.getByRole('link', { name: 'Audit trail' });
    expect(el.tagName).toBe('A');
    expect(el.getAttribute('href')).toBe('/audit');
  });

  it('adds rel=noopener when targeting a new tab', () => {
    render(<Button href="https://x.test" target="_blank">External</Button>);
    expect(screen.getByRole('link').getAttribute('rel')).toContain('noopener');
  });

  it('falls back to a button when disabled, so it cannot be followed', () => {
    // A disabled link is not a thing in HTML.
    render(<Button href="/audit" disabled>Audit trail</Button>);
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByRole('button')).toBeTruthy();
  });
});

