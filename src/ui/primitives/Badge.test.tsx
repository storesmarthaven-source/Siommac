/**
 * src/ui/primitives/Badge.test.tsx — the tone × contrast contract.
 *
 * `contrast` was added because three real consumers sit on dark panels
 * (Admin `chart-badge` on the navy chart header, and HSE Workflows' status +
 * priority treatments). The point of these tests is that it stayed a SURFACE
 * axis: no second tone vocabulary, no change to the default rendering.
 */

import { render } from '@testing-library/preact';
import { describe, it, expect } from 'vitest';
import { Badge, type BadgeTone } from './Badge';

const TONES: BadgeTone[] = ['success', 'warning', 'danger', 'info', 'neutral', 'accent'];

function classesOf(node: ParentNode): string[] {
  const el = node.querySelector('.ui-badge');
  if (!el) throw new Error('no .ui-badge rendered');
  return [...el.classList];
}

describe('Badge contrast', () => {
  it('leaves the default rendering untouched', () => {
    const { container } = render(<Badge tone="info">Current</Badge>);
    expect(classesOf(container)).toEqual(['ui-badge', 'ui-badge--info', 'ui-badge--soft']);
  });

  it('emits no contrast class when contrast is explicitly default', () => {
    const { container } = render(<Badge tone="info" contrast="default">Current</Badge>);
    expect(classesOf(container)).not.toContain('ui-badge--inverse');
  });

  it('is opt-in', () => {
    const { container } = render(<Badge tone="info" contrast="inverse">Current</Badge>);
    expect(classesOf(container)).toContain('ui-badge--inverse');
  });

  it('keeps the tone independent of the contrast', () => {
    const { container } = render(<Badge tone="warning" contrast="inverse">Due</Badge>);
    const cls = classesOf(container);
    expect(cls).toContain('ui-badge--warning');
    expect(cls).toContain('ui-badge--inverse');
  });

  it.each(TONES)('composes %s with inverse', tone => {
    const { container } = render(<Badge tone={tone} contrast="inverse">x</Badge>);
    const cls = classesOf(container);
    expect(cls).toContain(`ui-badge--${tone}`);
    expect(cls).toContain('ui-badge--inverse');
  });

  it('creates no second semantic vocabulary', () => {
    for (const tone of TONES) {
      const { container } = render(<Badge tone={tone} contrast="inverse">x</Badge>);
      const cls = classesOf(container);
      // exactly one tone class, and it is the one asked for
      expect(cls.filter(c => TONES.some(t => c === `ui-badge--${t}`))).toEqual([`ui-badge--${tone}`]);
      // no `inverse<Tone>` compound ever appears
      expect(cls.some(c => /ui-badge--inverse[A-Z]/.test(c))).toBe(false);
    }
  });

  it('composes with variant and size without disturbing either', () => {
    const { container } = render(
      <Badge tone="danger" variant="outline" size="sm" contrast="inverse">Blocked</Badge>,
    );
    const cls = classesOf(container);
    expect(cls).toContain('ui-badge--outline');
    expect(cls).toContain('ui-badge--sm');
    expect(cls).toContain('ui-badge--inverse');
  });

  it('leaves the removable-tag behaviour unchanged under inverse', () => {
    let removed = 0;
    const { container } = render(
      <Badge tone="neutral" contrast="inverse" onRemove={() => { removed += 1; }}>Tag</Badge>,
    );
    const btn = container.querySelector<HTMLButtonElement>('.ui-badge-remove');
    expect(btn).not.toBeNull();
    expect(btn?.getAttribute('aria-label')).toBe('Remove Tag');
    btn?.click();
    expect(removed).toBe(1);
  });

  it('still renders the dot under inverse', () => {
    const { container } = render(<Badge tone="success" dot contrast="inverse">Active</Badge>);
    expect(container.querySelector('.ui-badge-dot')).not.toBeNull();
  });
});
