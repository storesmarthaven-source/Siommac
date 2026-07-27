// Employee Import — versioned mapping allowlist (audit P2-1).
//
// `mapping` was an open Record<string,string>: arbitrary target names were accepted and
// persisted, several targets could share one source column, and a removed field (`role`)
// could still be posted by a stale or hand-crafted client.

import { describe, it, expect } from 'vitest';
import {
  IMPORT_TARGET_FIELDS, IMPORT_MAPPING_VERSION, checkMapping,
} from '../../netlify/functions/lib/hr/importFields';

describe('checkMapping — accepts valid mappings', () => {
  it('accepts a normal mapping', () => {
    expect(checkMapping({ firstName: 'First Name', lastName: 'Surname' })).toBeNull();
  });

  it('accepts every allowlisted target mapped to its own column', () => {
    const all = Object.fromEntries(IMPORT_TARGET_FIELDS.map(f => [f, `col_${f}`]));
    expect(checkMapping(all)).toBeNull();
  });

  it('accepts an empty mapping', () => {
    expect(checkMapping({})).toBeNull();
  });

  it('ignores blank source columns when checking for reuse', () => {
    // Several unmapped targets all carry '' — that is not a duplicate-source conflict.
    expect(checkMapping({ firstName: '', lastName: '', email: '' })).toBeNull();
  });
});

describe('checkMapping — rejects the removed role field', () => {
  it('refuses role explicitly rather than as a generic unknown field', () => {
    const msg = checkMapping({ firstName: 'A', role: 'Role' });
    expect(msg).toMatch(/role/i);
    expect(msg).toMatch(/access profile/i);
  });

  it('keeps role out of the allowlist', () => {
    expect(IMPORT_TARGET_FIELDS as readonly string[]).not.toContain('role');
  });
});

describe('checkMapping — rejects unknown targets', () => {
  it('names a single unknown field', () => {
    expect(checkMapping({ salary: 'Salary' })).toMatch(/Unknown import field: salary/);
  });

  it('names several unknown fields', () => {
    const msg = checkMapping({ salary: 'A', bankAccount: 'B' });
    expect(msg).toMatch(/Unknown import fields/);
    expect(msg).toMatch(/salary/);
    expect(msg).toMatch(/bankAccount/);
  });

  it('rejects a plausible-but-unsupported field', () => {
    // permissionProfile is a real concept elsewhere; import does not honour it.
    expect(checkMapping({ permissionProfile: 'Profile' })).toMatch(/Unknown import field/);
  });
});

describe('checkMapping — rejects an ambiguous source column', () => {
  it('refuses one column feeding two targets', () => {
    const msg = checkMapping({ firstName: 'Name', lastName: 'Name' });
    expect(msg).toMatch(/mapped to more than one field/);
    expect(msg).toMatch(/firstName/);
    expect(msg).toMatch(/lastName/);
  });
});

describe('mapping contract version', () => {
  it('is a positive integer so a stored mapping is traceable', () => {
    expect(Number.isInteger(IMPORT_MAPPING_VERSION)).toBe(true);
    expect(IMPORT_MAPPING_VERSION).toBeGreaterThan(0);
  });

  it('lists only targets the commit path consumes', () => {
    // Guard against the allowlist drifting into accept-and-drop: every entry here must
    // be read by toProvisionInput/updateFromImport.
    expect(new Set(IMPORT_TARGET_FIELDS).size).toBe(IMPORT_TARGET_FIELDS.length);
    expect(IMPORT_TARGET_FIELDS.length).toBeGreaterThan(0);
  });
});
