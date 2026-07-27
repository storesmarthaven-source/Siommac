// CSV parser for Employee Import (audit 2026-07-26 test gap: "no unit tests for parseCsv").
//
// The parser is the boundary between an operator's spreadsheet and staged personal data.
// Everything downstream — mapping, validation, the commit command — trusts its output, so
// its quoting, delimiter and line-ending handling needs to be pinned rather than assumed.

import { describe, it, expect } from 'vitest';
import { parseCsv } from '../../netlify/functions/lib/hr/csvParse';

describe('parseCsv — basics', () => {
  it('reads a header row and one data row', () => {
    const r = parseCsv('firstName,lastName\nAda,Lovelace');
    expect(r.headers).toEqual(['firstName', 'lastName']);
    expect(r.rows).toEqual([{ firstName: 'Ada', lastName: 'Lovelace' }]);
  });

  it('reads multiple data rows', () => {
    expect(parseCsv('a,b\n1,2\n3,4').rows).toEqual([{ a: '1', b: '2' }, { a: '3', b: '4' }]);
  });

  it('returns no rows for a header-only file', () => {
    const r = parseCsv('firstName,lastName');
    expect(r.headers).toEqual(['firstName', 'lastName']);
    expect(r.rows).toEqual([]);
  });

  it('returns nothing for empty input', () => {
    expect(parseCsv('').rows).toEqual([]);
  });
});

describe('parseCsv — line endings and BOM', () => {
  it('handles CRLF', () => {
    expect(parseCsv('a,b\r\n1,2\r\n3,4').rows).toEqual([{ a: '1', b: '2' }, { a: '3', b: '4' }]);
  });

  it('strips a UTF-8 BOM so the first header is not corrupted', () => {
    // Excel writes a BOM; without stripping, the first column becomes "﻿firstName"
    // and every mapping against it silently misses.
    const r = parseCsv('﻿firstName,lastName\nAda,Lovelace');
    expect(r.headers[0]).toBe('firstName');
    expect(r.rows[0]!.firstName).toBe('Ada');
  });

  it('ignores a trailing newline rather than emitting a blank row', () => {
    expect(parseCsv('a,b\n1,2\n').rows).toHaveLength(1);
  });
});

describe('parseCsv — quoting', () => {
  it('keeps a comma inside a quoted field', () => {
    expect(parseCsv('name,title\n"Lovelace, Ada",Engineer').rows[0])
      .toEqual({ name: 'Lovelace, Ada', title: 'Engineer' });
  });

  it('unescapes a doubled quote', () => {
    expect(parseCsv('name\n"Ada ""The Countess"" Lovelace"').rows[0]!.name)
      .toBe('Ada "The Countess" Lovelace');
  });

  it('keeps a newline inside a quoted field', () => {
    const r = parseCsv('name,notes\nAda,"line one\nline two"');
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]!.notes).toBe('line one\nline two');
  });

  it('keeps a CRLF inside a quoted field as-is', () => {
    expect(parseCsv('a,b\r\n1,"x\r\ny"').rows[0]!.b).toContain('x');
  });

  it('treats an empty quoted field as empty, not missing', () => {
    expect(parseCsv('a,b\n"",2').rows[0]).toEqual({ a: '', b: '2' });
  });
});

describe('parseCsv — ragged rows', () => {
  it('fills absent trailing columns with an empty string, never shifting values', () => {
    // The row is short. `b` becomes '' rather than undefined — which matters downstream:
    // a required field then reports `required_missing` instead of leaking undefined into
    // mapped_data, and `a` never silently takes a value belonging to another column.
    const row = parseCsv('a,b\n1').rows[0]!;
    expect(row.a).toBe('1');
    expect(row.b).toBe('');
  });

  it('does not lose the values it did receive when a row is over-long', () => {
    const row = parseCsv('a,b\n1,2,3').rows[0]!;
    expect(row.a).toBe('1');
    expect(row.b).toBe('2');
  });
});

describe('parseCsv — whitespace', () => {
  it('preserves interior spacing (trimming is the mapper’s job)', () => {
    expect(parseCsv('name\n  Ada  ').rows[0]!.name).toMatch(/Ada/);
  });
});
