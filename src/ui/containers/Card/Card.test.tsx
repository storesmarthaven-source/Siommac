/**
 * Card.test.tsx — the surface contract.
 *
 * The assertions concentrate on what makes this ONE card rather than nine:
 * variant/tone/density being class-level rhythm rather than different markup,
 * the header/footer slots being genuinely optional, and — the part with real
 * behaviour — an actionable card being a keyboard-operable control that does
 * NOT swallow the nested buttons real SIOMAC cards carry.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/preact';
import { Card, CardHeader, CardFooter } from './index';

describe('Card — surface', () => {
  it('renders children in a body with no header or footer by default', () => {
    const { container } = render(<Card>Body text</Card>);
    const root = container.querySelector('.ui-card')!;
    expect(root.tagName).toBe('DIV');
    expect(root.querySelector('.ui-card-head')).toBeNull();
    expect(root.querySelector('.ui-card-foot')).toBeNull();
    expect(root.querySelector('.ui-card-body')!.textContent).toBe('Body text');
  });

  it('renders the header and footer slots when given', () => {
    const { container } = render(
      <Card
        header={<CardHeader title="Overall compliance" description="Rolling 30 days" />}
        footer={<CardFooter>Updated 2 minutes ago</CardFooter>}
      >
        94%
      </Card>,
    );
    expect(screen.getByRole('heading', { name: 'Overall compliance', level: 3 })).toBeTruthy();
    expect(container.querySelector('.ui-card-desc')!.textContent).toBe('Rolling 30 days');
    expect(container.querySelector('.ui-card-foot')!.textContent).toBe('Updated 2 minutes ago');
  });

  it('takes the heading level from CardHeader, and drops the heading entirely at level null', () => {
    // A KPI tile in a strip is not a document section — forcing an <h3> there
    // pollutes the heading outline a screen-reader user navigates by.
    const { container, rerender } = render(<Card header={<CardHeader title="Open" level={2} />} />);
    expect(screen.getByRole('heading', { level: 2 })).toBeTruthy();

    rerender(<Card header={<CardHeader title="Open" level={null} />} />);
    expect(screen.queryByRole('heading')).toBeNull();
    expect(container.querySelector('.ui-card-title')!.tagName).toBe('DIV');
  });

  it('renders no body element at all when there is nothing to put in it', () => {
    // An action card is often entirely its header; an empty padded box under it
    // is visible dead space on every tile in the grid.
    const { container } = render(<Card header={<CardHeader title="New inspection" />} />);
    expect(container.querySelector('.ui-card-head')).toBeTruthy();
    expect(container.querySelector('.ui-card-body')).toBeNull();
  });

  it('carries variant, tone and density as classes on ONE root — not different markup', () => {
    const { container } = render(<Card variant="metric" tone="warning" density="compact">7</Card>);
    const root = container.querySelector('.ui-card')!;
    expect(root.classList.contains('ui-card--metric')).toBe(true);
    expect(root.classList.contains('ui-card--warning')).toBe(true);
    expect(root.classList.contains('ui-card--compact')).toBe(true);
    // Same DOM shape as the default card: a body wrapper, nothing variant-specific.
    expect(root.querySelector('.ui-card-body')!.textContent).toBe('7');
  });

  it('omits the class for every default so the base card has no dead modifiers', () => {
    const { container } = render(<Card>x</Card>);
    expect(container.querySelector('.ui-card')!.className.trim()).toBe('ui-card ui-card--surface');
  });

  it('turns a non-neutral tone into a visible accent without a second prop', () => {
    const { container } = render(<Card tone="danger">Overdue</Card>);
    expect(container.querySelector('.ui-card--accent-left')).toBeTruthy();
  });

  it('honours an explicit accent, including switching it off on a toned card', () => {
    const { container, rerender } = render(<Card tone="danger" accent="top">x</Card>);
    expect(container.querySelector('.ui-card--accent-top')).toBeTruthy();

    rerender(<Card tone="danger" accent="none">x</Card>);
    expect(container.querySelector('[class*="ui-card--accent-"]')).toBeNull();
    expect(container.querySelector('.ui-card--danger')).toBeTruthy();
  });

  it('forwards arbitrary DOM props to the root, so a card can be made draggable', () => {
    const onDragStart = vi.fn();
    const { container } = render(
      <Card draggable onDragStart={onDragStart} data-widget-id="w1">x</Card>,
    );
    const root = container.querySelector('.ui-card')!;
    expect(root.getAttribute('data-widget-id')).toBe('w1');
    fireEvent.dragStart(root);
    expect(onDragStart).toHaveBeenCalledTimes(1);
  });
});

describe('Card — loading', () => {
  it('shows a shimmer instead of the children and marks the surface busy', () => {
    const { container } = render(<Card loading>4,182</Card>);
    expect(container.querySelector('.ui-card')!.getAttribute('aria-busy')).toBe('true');
    expect(container.textContent).not.toContain('4,182');
    expect(container.querySelector('.ui-card-skeleton')).toBeTruthy();
  });

  it('shimmers a metric card as a caption + figure, not as a paragraph', () => {
    // Three text lines where a number will land is a guaranteed layout jump.
    const { container } = render(<Card variant="metric" loading>0</Card>);
    expect(container.querySelectorAll('.ui-card-skeleton > *')).toHaveLength(2);
  });

  it('still renders the header while the body is loading', () => {
    // The title is known before the data is; hiding it makes the strip flicker.
    render(<Card loading header={<CardHeader title="Active cases" />}>0</Card>);
    expect(screen.getByRole('heading', { name: 'Active cases' })).toBeTruthy();
  });
});

describe('Card — actionable', () => {
  it('exposes ONE named control for the whole surface and fires it on click', () => {
    const onClick = vi.fn();
    render(<Card onClick={onClick} actionLabel="View Sarah James">Sarah James</Card>);
    const hit = screen.getByRole('button', { name: 'View Sarah James' });
    fireEvent.click(hit);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('is a real <button>, so Enter and Space come from the browser', () => {
    // The pattern being replaced — <div role="button" tabIndex={0}> with a
    // hand-rolled onKeyDown — got this wrong app-wide: Space scrolled the page
    // because the handler never called preventDefault.
    render(<Card onClick={vi.fn()} actionLabel="Open">x</Card>);
    const hit = screen.getByRole('button', { name: 'Open' });
    expect(hit.tagName).toBe('BUTTON');
    expect(hit.getAttribute('type')).toBe('button');
  });

  it('renders a real <a> for a navigating card, and hardens an external target', () => {
    render(<Card href="/employees/42" actionLabel="Open employee 42">x</Card>);
    const link = screen.getByRole('link', { name: 'Open employee 42' });
    expect(link.getAttribute('href')).toBe('/employees/42');

    render(<Card href="https://example.test" target="_blank" actionLabel="Docs">y</Card>);
    expect(screen.getByRole('link', { name: 'Docs' }).getAttribute('rel'))
      .toBe('noreferrer noopener');
  });

  it('does NOT nest the content inside the control, so card actions stay operable', () => {
    // This is why the card is a <div> + overlay and not a <button> wrapper:
    // a <button> may not contain a button, and these overlays are real.
    const onCard = vi.fn();
    const onEdit = vi.fn();
    render(
      <Card
        onClick={onCard}
        actionLabel="View Sarah James"
        header={<CardHeader
          title="Sarah James"
          actions={<button type="button" onClick={e => { e.stopPropagation(); onEdit(); }}>Edit</button>}
        />}
      >
        Safety Officer
      </Card>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(onCard).not.toHaveBeenCalled();
  });

  it('marks itself interactive automatically, and can be marked so without an action', () => {
    const { container, rerender } = render(<Card onClick={vi.fn()} actionLabel="Open">x</Card>);
    expect(container.querySelector('.is-interactive')).toBeTruthy();

    rerender(<Card interactive>x</Card>);
    expect(container.querySelector('.is-interactive')).toBeTruthy();
    // …but no control is invented for a card that has no action.
    expect(container.querySelector('.ui-card-hit')).toBeNull();
  });

  it('adds no control at all to a static card', () => {
    const { container } = render(<Card>Read-only surface</Card>);
    expect(container.querySelector('.ui-card-hit')).toBeNull();
    expect(container.querySelector('.is-interactive')).toBeNull();
  });
});

describe('Card — selected & disabled', () => {
  it('announces selection as a toggle only when `selected` is actually passed', () => {
    const { rerender } = render(<Card onClick={vi.fn()} actionLabel="Pick">x</Card>);
    expect(screen.getByRole('button', { name: 'Pick' }).getAttribute('aria-pressed')).toBeNull();

    rerender(<Card onClick={vi.fn()} actionLabel="Pick" selected={false}>x</Card>);
    expect(screen.getByRole('button', { name: 'Pick' }).getAttribute('aria-pressed')).toBe('false');

    rerender(<Card onClick={vi.fn()} actionLabel="Pick" selected>x</Card>);
    expect(screen.getByRole('button', { name: 'Pick' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('styles selection on a static card without claiming it is a control', () => {
    const { container } = render(<Card selected>x</Card>);
    expect(container.querySelector('.is-selected')).toBeTruthy();
    expect(container.querySelector('.ui-card-hit')).toBeNull();
  });

  it('disables the control rather than only dimming the surface', () => {
    const onClick = vi.fn();
    const { container } = render(<Card onClick={onClick} actionLabel="Open" disabled>x</Card>);
    const hit = screen.getByRole<HTMLButtonElement>('button', { name: 'Open' });
    expect(hit.disabled).toBe(true);
    fireEvent.click(hit);
    expect(onClick).not.toHaveBeenCalled();
    expect(container.querySelector('.is-disabled')).toBeTruthy();
  });

  it('strips the href from a disabled link card so it cannot still navigate', () => {
    // `aria-disabled` alone leaves a live link — the classic accessible-looking
    // control that still fires.
    render(<Card href="/x" actionLabel="Open" disabled>x</Card>);
    const link = screen.getByLabelText('Open');
    expect(link.hasAttribute('href')).toBe(false);
    expect(link.getAttribute('aria-disabled')).toBe('true');
  });
});

describe('Card — slots and escape hatches', () => {
  it('drops body padding in flush mode for content that owns its own layout', () => {
    const { container } = render(<Card flush><table /></Card>);
    expect(container.querySelector('.ui-card--flush')).toBeTruthy();
  });

  it('lets the body slot take its own class and style', () => {
    const { container } = render(<Card bodyClass="two-col" bodyStyle={{ minHeight: '120px' }}>x</Card>);
    const body = container.querySelector<HTMLElement>('.ui-card-body')!;
    expect(body.classList.contains('two-col')).toBe(true);
    expect(body.style.minHeight).toBe('120px');
  });

  it('emits forceState as a real data attribute rather than a preview-only fork', () => {
    const { container } = render(<Card interactive forceState="hover">x</Card>);
    expect(container.querySelector('.ui-card')!.getAttribute('data-ui-state')).toBe('hover');
  });
});
