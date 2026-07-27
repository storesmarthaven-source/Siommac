// Employee Import — canonical update path (audit 2026-07-26, P0-5).
//
// The update path corrupted canonical employee history: it patched app_users directly
// (so an assignment change left no effective-dated hr_employee_assignments row), wrote
// the LEGACY hr_employee_statutory table while creates wrote the canonical profile, and
// issued each write as a separate call so a mid-row failure left a partly-updated
// employee while the row reported failed.

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  IMPORT_UPDATE_PATCH_FIELDS, buildImportUpdatePatch,
} from '../../netlify/functions/routes/hrEmployeeImport';

const ROOT = path.resolve(__dirname, '..', '..');
const read = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const stripComments = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const lookups = {
  deptByKey: new Map([['operations', 'dept-ops'], ['dept-ops', 'dept-ops']]),
  supervisorByKey: new Map([['asha singh', 'usr-asha'], ['asha', 'usr-asha']]),
  siteIds: new Set(['site-1']),
};

describe('buildImportUpdatePatch — allowlisted employee patch', () => {
  it('carries only the four allowlisted fields', () => {
    expect([...IMPORT_UPDATE_PATCH_FIELDS]).toEqual(['position', 'email', 'phone', 'employmentType']);
  });

  it('never carries a role, however the row is mapped', () => {
    const { patch } = buildImportUpdatePatch(
      { role: 'admin', position: 'Engineer' } as Record<string, string>, lookups,
    );
    expect(patch).not.toHaveProperty('role');
    expect(patch['position']).toBe('Engineer');
  });

  it('ignores unknown fields rather than passing them through', () => {
    const { patch } = buildImportUpdatePatch(
      { salary: '90000', status: 'terminated', position: 'Engineer' } as Record<string, string>, lookups,
    );
    expect(Object.keys(patch)).toEqual(['position']);
  });

  it('omits blank values so an empty cell never clears a stored value', () => {
    const { patch } = buildImportUpdatePatch({ position: '', email: '   ', phone: '555' }, lookups);
    expect(patch).toEqual({ phone: '555' });
  });

  it('trims values', () => {
    const { patch } = buildImportUpdatePatch({ position: '  Engineer  ' }, lookups);
    expect(patch['position']).toBe('Engineer');
  });
});

describe('buildImportUpdatePatch — assignment resolution', () => {
  it('resolves department and supervisor to ids, case-insensitively', () => {
    const { assignment } = buildImportUpdatePatch(
      { department: 'Operations', supervisor: 'Asha Singh' }, lookups,
    );
    expect(assignment['departmentId']).toBe('dept-ops');
    expect(assignment['supervisorId']).toBe('usr-asha');
  });

  it('yields null for unresolved lookups rather than passing raw text through', () => {
    const { assignment } = buildImportUpdatePatch(
      { department: 'Nowhere', supervisor: 'Nobody', site: 'site-missing' }, lookups,
    );
    expect(assignment).toEqual({ departmentId: null, siteId: null, supervisorId: null });
  });

  it('accepts a site only when it exists in the registry', () => {
    expect(buildImportUpdatePatch({ site: 'site-1' }, lookups).assignment['siteId']).toBe('site-1');
    expect(buildImportUpdatePatch({ site: 'site-9' }, lookups).assignment['siteId']).toBeNull();
  });

  it('is pure — repeated calls with different lookups do not leak state', () => {
    // A previous draft held site ids in a module-level variable, which would have made
    // concurrent requests contaminate each other.
    const other = { ...lookups, siteIds: new Set(['site-9']) };
    expect(buildImportUpdatePatch({ site: 'site-9' }, other).assignment['siteId']).toBe('site-9');
    expect(buildImportUpdatePatch({ site: 'site-9' }, lookups).assignment['siteId']).toBeNull();
  });
});

describe('Employee Import — update path is transactional and canonical', () => {
  const route = () => stripComments(read('netlify/functions/routes/hrEmployeeImport.ts'));

  it('routes updates through the transactional command', () => {
    expect(route()).toMatch(/rpc\('hr_employee_import_update_tx'/);
  });

  it('writes no legacy statutory rows from the import path', () => {
    expect(route()).not.toMatch(/from\('hr_employee_statutory'\)/);
  });

  it('uses the canonical statutory profile patch shape', () => {
    expect(route()).toMatch(/statutoryProfilePatch\(/);
  });
});

describe('hr_employee_import_update_tx — migration contract', () => {
  const sql = () => read('supabase/migrations/20260919000751_hr_employee_import_update_tx.sql');

  it('locks the employee row so concurrent commits cannot interleave history', () => {
    expect(sql()).toMatch(/for update/i);
  });

  it('closes the current assignment and opens a new effective-dated one', () => {
    const s = sql();
    expect(s).toMatch(/is_current\s*=\s*false/);
    expect(s).toMatch(/insert into public\.hr_employee_assignments/);
  });

  it('writes the canonical statutory profile, never the legacy table', () => {
    const s = sql();
    expect(s).toMatch(/hr_employee_statutory_profiles/);
    expect(s).not.toMatch(/insert into public\.hr_employee_statutory\b/);
  });

  it('records previous AND new state in the audit row', () => {
    const s = sql();
    expect(s).toMatch(/v_prev_state/);
    expect(s).toMatch(/v_new_state/);
    expect(s).toMatch(/insert into public\.hr_audit_log/);
  });

  it('cannot write app_users.role — the column is absent from the update statement', () => {
    const update = sql().slice(sql().indexOf('update public.app_users set'), sql().indexOf('select department_id'));
    expect(update).not.toMatch(/\brole\b/);
  });

  it('is not executable by anon or authenticated', () => {
    expect(sql()).toMatch(/revoke all on function public\.hr_employee_import_update_tx/);
  });
});
