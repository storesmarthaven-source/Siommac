/**
 * src/lib/csv.test.ts — RFC-4180 escaping + assembly for the shared CSV utility.
 */

import { describe, it, expect } from 'vitest';
import { escapeCsvField, toCsv, arrayToCsv } from './csv';

describe('escapeCsvField', () => {
  it('passes plain values through unquoted', () => {
    expect(escapeCsvField('hello')).toBe('hello');
    expect(escapeCsvField(42)).toBe('42');
    expect(escapeCsvField(true)).toBe('true');
  });

  it('renders null/undefined as empty', () => {
    expect(escapeCsvField(null)).toBe('');
    expect(escapeCsvField(undefined)).toBe('');
  });

  it('quotes fields containing commas, quotes, or newlines', () => {
    expect(escapeCsvField('a,b')).toBe('"a,b"');
    expect(escapeCsvField('line1\nline2')).toBe('"line1\nline2"');
    expect(escapeCsvField('say "hi"')).toBe('"say ""hi"""');
  });
});

describe('toCsv', () => {
  it('builds a header row + escaped body rows', () => {
    const rows = [
      { name: 'Ann',  note: 'ok' },
      { name: 'B, Jr', note: 'has "quote"' },
    ];
    const csv = toCsv(rows, [
      { header: 'Name', value: r => r.name },
      { header: 'Note', value: r => r.note },
    ]);
    expect(csv).toBe(
      'Name,Note\r\n' +
      'Ann,ok\r\n' +
      '"B, Jr","has ""quote"""',
    );
  });

  it('handles an empty row set (header only)', () => {
    expect(toCsv([], [{ header: 'A', value: () => '' }])).toBe('A');
  });
});

describe('arrayToCsv', () => {
  it('serialises a 2-D array', () => {
    expect(arrayToCsv([['a', 'b'], [1, 'x,y']])).toBe('a,b\r\n1,"x,y"');
  });
});
