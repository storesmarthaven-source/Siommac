/**
 * statusBridge.test.tsx — the domain-tone → Badge-tone bridge, and StatusPill.
 *
 * These lock the one decision that would be expensive to get wrong: which
 * domain tones become RED. `negative` means "off / inactive / expired" and
 * renders slate today; collapsing it into `danger` would turn every ordinary
 * inactive state red across the whole ERP. Only `critical` is danger.
 */

import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/preact';
import { badgeTone, badgeToneFromText, type Tone } from './statusTokens';
import { StatusPill } from '../components/StatusPill';

describe('badgeTone — domain Tone → canonical Badge tone', () => {
  it('maps the six domain tones exactly as agreed', () => {
    const expected: Record<Tone, string> = {
      positive: 'success',
      caution:  'warning',
      negative: 'neutral',
      critical: 'danger',
      info:     'info',
      neutral:  'neutral',
    };
    for (const [tone, badge] of Object.entries(expected)) {
      expect(badgeTone(tone as Tone)).toBe(badge);
    }
  });

  it('never turns `negative` red', () => {
    // The whole point of keeping two vocabularies. `negative` is "off", not
    // "bad" — an inactive row must not shout like a failure.
    expect(badgeTone('negative')).not.toBe('danger');
  });

  it('reserves danger for `critical` alone', () => {
    const danger = (['positive', 'caution', 'negative', 'critical', 'info', 'neutral'] as Tone[])
      .filter(t => badgeTone(t) === 'danger');
    expect(danger).toEqual(['critical']);
  });

  it('derives a Badge tone from free text in one step', () => {
    expect(badgeToneFromText('Ready')).toBe('success');
    expect(badgeToneFromText('Pending review')).toBe('warning');
    expect(badgeToneFromText(null)).toBe('info');
  });
});

describe('StatusPill', () => {
  it('renders the CANONICAL badge, not a legacy .vt-pill', () => {
    // It is a domain adapter over Badge — it owns no classes of its own, so the
    // 17 existing call sites move to canonical rendering with no edits.
    const { container } = render(<StatusPill status="Ready" />);
    expect(container.querySelector('.ui-badge')).toBeTruthy();
    expect(container.querySelector('.vt-pill')).toBeNull();
  });

  it('translates the domain tone rather than passing it through', () => {
    const { container } = render(<StatusPill tone="critical">Blocked</StatusPill>);
    expect(container.querySelector('.ui-badge--danger')).toBeTruthy();
  });

  it('keeps an inactive state neutral', () => {
    const { container } = render(<StatusPill tone="negative">Inactive</StatusPill>);
    expect(container.querySelector('.ui-badge--neutral')).toBeTruthy();
    expect(container.querySelector('.ui-badge--danger')).toBeNull();
  });

  it('falls back to the status string as the label', () => {
    const { getByText } = render(<StatusPill status="In Review" />);
    expect(getByText('In Review')).toBeTruthy();
  });
});
