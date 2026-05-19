'use strict';

const { haversine, dateOnly, cap, num, r2 } = require('../../netlify/functions/lib/helpers');

describe('haversine', () => {
  test('same point → 0 metres', () => {
    expect(haversine(10.6549, -61.5019, 10.6549, -61.5019)).toBe(0);
  });

  test('Port of Spain to Chaguanas ≈ 18.5 km', () => {
    // Port of Spain: 10.6549, -61.5019  /  Chaguanas: 10.5167, -61.4111
    const dist = haversine(10.6549, -61.5019, 10.5167, -61.4111);
    expect(dist).toBeGreaterThan(17000);
    expect(dist).toBeLessThan(20000);
  });

  test('returns whole metres (rounded)', () => {
    const dist = haversine(10.0, -61.0, 10.001, -61.001);
    expect(Number.isInteger(dist)).toBe(true);
  });
});

describe('dateOnly', () => {
  test('slices ISO timestamp to date part', () => {
    expect(dateOnly('2025-05-16T14:30:00Z')).toBe('2025-05-16');
  });
  test('passes through plain date string', () => {
    expect(dateOnly('2025-05-16')).toBe('2025-05-16');
  });
  test('returns empty string for falsy input', () => {
    expect(dateOnly(null)).toBe('');
    expect(dateOnly('')).toBe('');
    expect(dateOnly(undefined)).toBe('');
  });
});

describe('cap', () => {
  test('capitalises first letter', () => {
    expect(cap('hello')).toBe('Hello');
  });
  test('handles already-capitalised string', () => {
    expect(cap('Admin')).toBe('Admin');
  });
  test('returns empty string for falsy input', () => {
    expect(cap('')).toBe('');
    expect(cap(null)).toBe('');
  });
});

describe('num', () => {
  test('converts numeric string', () => {
    expect(num('42')).toBe(42);
  });
  test('returns null for non-numeric string', () => {
    expect(num('abc')).toBeNull();
  });
  test('returns null for null', () => {
    expect(num(null)).toBeNull();
  });
  test('passes through finite number', () => {
    expect(num(3.14)).toBe(3.14);
  });
});

describe('r2', () => {
  test('rounds to 2 decimal places', () => {
    expect(r2(1.005)).toBe(1.01);
    expect(r2(1.004)).toBe(1.00);
  });
  test('whole number stays whole', () => {
    expect(r2(5)).toBe(5);
  });
});
