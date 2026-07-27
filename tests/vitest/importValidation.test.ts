// Employee Import — field-format, within-file duplicate and default handling
// (audit 2026-07-26, findings P1-5 and P1-6).
//
// The validator checked required-ness, worker/employment type, department resolution and
// DATABASE duplicates. Malformed emails, impossible dates, bad NIS statuses, over-long
// values and rows colliding with EACH OTHER in the same file all survived validation and
// surfaced at commit as an opaque row failure — after the operator had approved the batch.

import { describe, it, expect } from 'vitest';
import {
  validateFieldFormats, isRealIsoDate, WithinFileDuplicates, FIELD_MAX_LENGTH,
} from '../../netlify/functions/lib/hr/importValidation';
import { applyBatchDefaults } from '../../netlify/functions/routes/hrEmployeeImport';

const TODAY = '2026-07-27';
const codes = (m: Record<string, string>) => validateFieldFormats(m, TODAY).map(e => e.code);

describe('isRealIsoDate', () => {
  it('accepts real calendar dates', () => {
    expect(isRealIsoDate('2026-01-15')).toBe(true);
    expect(isRealIsoDate('2024-02-29')).toBe(true);   // leap year
  });

  it('rejects impossible dates that Date() would silently roll over', () => {
    expect(isRealIsoDate('2026-02-31')).toBe(false);
    expect(isRealIsoDate('2026-13-01')).toBe(false);
    expect(isRealIsoDate('2025-02-29')).toBe(false);  // not a leap year
  });

  it('rejects non-ISO shapes', () => {
    for (const v of ['15/01/2026', '2026-1-5', '20260115', 'yesterday', '']) {
      expect(isRealIsoDate(v), v).toBe(false);
    }
  });
});

describe('validateFieldFormats — a clean row', () => {
  it('reports nothing for a well-formed row', () => {
    expect(codes({
      firstName: 'Ada', lastName: 'Lovelace', employeeNumber: 'EMP-0007',
      username: 'ada.lovelace', email: 'ada@siomac.test',
      nisStatus: 'registered', dateOfBirth: '1990-12-10', startDate: '2026-01-15',
    })).toEqual([]);
  });

  it('ignores blank optional fields', () => {
    expect(codes({ firstName: 'Ada', email: '', dateOfBirth: '   ', nisStatus: '' })).toEqual([]);
  });
});

describe('validateFieldFormats — formats', () => {
  it('rejects a malformed employee number', () => {
    expect(codes({ employeeNumber: '12345' })).toContain('invalid_employee_number');
    expect(codes({ employeeNumber: 'EMP-7' })).toContain('invalid_employee_number');
    expect(codes({ employeeNumber: 'emp-0007' })).toEqual([]);   // case-insensitive
  });

  it('rejects a malformed email', () => {
    for (const bad of ['notanemail', 'a@b', 'a b@c.com', '@nodomain.com']) {
      expect(codes({ email: bad }), bad).toContain('invalid_email');
    }
  });

  it('rejects a malformed username', () => {
    expect(codes({ username: 'ab' })).toContain('invalid_username');          // too short
    expect(codes({ username: '.leading' })).toContain('invalid_username');    // must start alnum
    expect(codes({ username: 'has space' })).toContain('invalid_username');
    expect(codes({ username: 'ada.lovelace-01' })).toEqual([]);
  });

  it('rejects an unknown NIS status', () => {
    expect(codes({ nisStatus: 'maybe' })).toContain('invalid_nis_status');
    expect(codes({ nisStatus: 'registered' })).toEqual([]);
  });

  it('rejects values longer than the column allows, rather than truncating', () => {
    expect(codes({ email: `${'a'.repeat(FIELD_MAX_LENGTH.email!)}@x.com` })).toContain('value_too_long');
    expect(codes({ firstName: 'a'.repeat(FIELD_MAX_LENGTH.firstName! + 1) })).toContain('value_too_long');
  });
});

describe('validateFieldFormats — date sanity and relationships', () => {
  it('rejects an unparseable or impossible date', () => {
    expect(codes({ startDate: '2026-02-31' })).toContain('invalid_date');
    expect(codes({ dateOfBirth: '10/12/1990' })).toContain('invalid_date');
  });

  it('rejects a date of birth that is not in the past', () => {
    expect(codes({ dateOfBirth: TODAY })).toContain('dob_not_past');
    expect(codes({ dateOfBirth: '2030-01-01' })).toContain('dob_not_past');
  });

  it('flags an implausible age in either direction', () => {
    expect(codes({ dateOfBirth: '1890-01-01' })).toContain('dob_implausible');
    expect(codes({ dateOfBirth: '2020-01-01' })).toContain('dob_underage');
  });

  it('rejects a start date at or before the date of birth', () => {
    expect(codes({ dateOfBirth: '1990-12-10', startDate: '1985-01-01' })).toContain('start_before_birth');
    expect(codes({ dateOfBirth: '1990-12-10', startDate: '1990-12-10' })).toContain('start_before_birth');
  });
});

describe('WithinFileDuplicates', () => {
  it('lets the first claimant through and blames later rows', () => {
    const d = new WithinFileDuplicates();
    expect(d.check(1, { employeeNumber: 'EMP-0007' })).toEqual([]);
    const second = d.check(4, { employeeNumber: 'EMP-0007' });
    expect(second).toHaveLength(1);
    expect(second[0]!.code).toBe('duplicate_within_file');
    expect(second[0]!.message).toMatch(/row 1/);
  });

  it('matches case- and whitespace-insensitively', () => {
    const d = new WithinFileDuplicates();
    d.check(1, { email: 'Ada@Siomac.test', username: 'Ada' });
    expect(d.check(2, { email: ' ada@siomac.test ' })).toHaveLength(1);
    expect(d.check(3, { username: 'ADA' })).toHaveLength(1);
  });

  it('tracks each field independently', () => {
    const d = new WithinFileDuplicates();
    d.check(1, { employeeNumber: 'EMP-0007', email: 'a@x.test' });
    // Same email, different number → one collision, not two.
    expect(d.check(2, { employeeNumber: 'EMP-0008', email: 'a@x.test' })).toHaveLength(1);
  });

  it('ignores blank values, so many rows may legitimately omit a field', () => {
    const d = new WithinFileDuplicates();
    d.check(1, { employeeNumber: '', email: '' });
    expect(d.check(2, { employeeNumber: '', email: '' })).toEqual([]);
  });
});

describe('applyBatchDefaults (P1-6)', () => {
  it('fills a blank department so the default is no longer inert', () => {
    // department is REQUIRED, so validation rejected the row before the default could
    // ever apply — the setting existed but could never take effect.
    const out = applyBatchDefaults({ firstName: 'Ada', department: '' }, { departmentId: 'dept-ops' });
    expect(out.department).toBe('dept-ops');
  });

  it('fills a blank site', () => {
    expect(applyBatchDefaults({ site: '   ' }, { siteId: 'site-1' }).site).toBe('site-1');
  });

  it('never overrides a value present in the file', () => {
    const out = applyBatchDefaults({ department: 'Finance', site: 'site-9' },
      { departmentId: 'dept-ops', siteId: 'site-1' });
    expect(out.department).toBe('Finance');
    expect(out.site).toBe('site-9');
  });

  it('is a copy — the caller’s row is not mutated', () => {
    const row = { department: '' };
    applyBatchDefaults(row, { departmentId: 'dept-ops' });
    expect(row.department).toBe('');
  });

  it('does nothing when no defaults are configured', () => {
    expect(applyBatchDefaults({ department: '' }, {})).toEqual({ department: '' });
  });
});
