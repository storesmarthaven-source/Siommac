import { describe, expect, it } from 'vitest';
import { readinessColor, readinessFillStyle } from './readinessScale';

describe('readiness colour scale', () => {
  it('anchors the red → amber → green ramp at the documented percentages', () => {
    expect(readinessColor(0)).toBe('#dc2626');
    expect(readinessColor(33)).toBe('#ea580c');
    expect(readinessColor(67)).toBe('#f59e0b');
    expect(readinessColor(85)).toBe('#a3c714');
    expect(readinessColor(100)).toBe('#16a34a');
  });

  it('blends between anchors and clamps out-of-range input', () => {
    const mid = readinessColor(50);
    expect(mid).not.toBe(readinessColor(33));
    expect(mid).not.toBe(readinessColor(67));
    expect(readinessColor(-20)).toBe(readinessColor(0));
    expect(readinessColor(140)).toBe(readinessColor(100));
    expect(readinessColor(Number.NaN)).toBe(readinessColor(0));
  });

  it('paints each bar in ONE percentage-derived colour, never the whole ramp', () => {
    const low = readinessFillStyle(10);
    expect(low).toContain('width:10%');
    // A low score carries no green: every stop is a tint or shade of its own hue.
    expect(low).not.toContain('#16a34a');
    expect(low).not.toContain('#a3c714');
    // Three stops — the subtle tonal gradient for depth, all derived from one base colour.
    expect(low.match(/#[0-9a-f]{6}/g)).toHaveLength(3);
    expect(readinessFillStyle(100)).toContain('width:100%');
  });
});
