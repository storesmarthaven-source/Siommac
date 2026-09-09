import { render, waitFor } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OverflowTooltipText } from './OverflowTooltipText';

describe('OverflowTooltipText', () => {
  afterEach(() => vi.restoreAllMocks());

  it('adds tooltip semantics only when the rendered label is truncated', async () => {
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(80);
    vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockReturnValue(160);
    vi.stubGlobal('ResizeObserver', undefined);

    const { getByText } = render(<OverflowTooltipText as="h2" text="A very long operational title" />);

    await waitFor(() => expect(getByText('A very long operational title').getAttribute('aria-describedby')).toContain('ui-tooltip'));
  });

  it('does not add redundant tooltip semantics to a title that fits', () => {
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(160);
    vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockReturnValue(80);
    vi.stubGlobal('ResizeObserver', undefined);

    const { getByText } = render(<OverflowTooltipText as="h2" text="Short title" />);

    expect(getByText('Short title').hasAttribute('aria-describedby')).toBe(false);
  });
});
