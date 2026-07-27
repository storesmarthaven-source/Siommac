// Employee Import — security invariants (audit 2026-07-26, P0-1 / P0-2 / P1-1 / P1-2).
//
// These are source-level guards, deliberately. The defects they pin were not logic bugs
// inside a testable function — they were the mere PRESENCE of a field in a contract:
//   • a mappable `role` column that was written straight to app_users.role, letting anyone
//     who could commit a batch put `role=admin` in a spreadsheet;
//   • a generated random password fed to auth.admin.createUser with email_confirm:true,
//     producing a pre-confirmed account whose credential nobody ever received.
// A behavioural test cannot fail if the field simply comes back, so the guard asserts the
// surface stays absent.

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '..', '..');
const read = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), 'utf8');

/** Strip line and block comments so the explanatory notes don't trip the guards. */
function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

const IMPORT_ROUTE = 'netlify/functions/routes/hrEmployeeImport.ts';
const EMPLOYEE_CORE = 'netlify/functions/lib/hr/employeeCore.ts';
const IMPORT_UI = 'src/components/sections/HR/ImportWizard.tsx';
const IMPORT_API = 'src/api/hr/employeeImport.ts';

describe('Employee Import — no privilege escalation via mapping (P0-1)', () => {
  it('offers no mappable role field in the import UI', () => {
    expect(code(read(IMPORT_UI))).not.toMatch(/key:\s*'role'/);
  });

  it('never reads a role from a mapped row', () => {
    expect(code(read(IMPORT_ROUTE))).not.toMatch(/m\[['"]role['"]\]/);
  });

  it('passes no access role into the shared provisioner', () => {
    // `access: { role: ... }` is what wrote app_users.role directly.
    expect(code(read(IMPORT_ROUTE))).not.toMatch(/access:\s*\{[^}]*\brole\b/);
  });

  it('exposes only a server-resolved role on the provisioner contract', () => {
    const core = code(read(EMPLOYEE_CORE));
    // The governed field is `resolvedRole`, set from an approved access profile.
    expect(core).toMatch(/resolvedRole\?:\s*string/);
    // A bare `role?: string` on the access block is what made escalation reachable.
    expect(core).not.toMatch(/access\??:\s*\{\s*role\?:/);
  });
});

describe('Employee Import — no credential creation (P0-2)', () => {
  it('generates no password anywhere in the import path', () => {
    const src = code(read(IMPORT_ROUTE));
    expect(src).not.toMatch(/randomBytes/);
    expect(src).not.toMatch(/password/i);
  });

  it('creates no Supabase Auth user in the shared provisioner', () => {
    const core = code(read(EMPLOYEE_CORE));
    expect(core).not.toMatch(/auth\.admin\.createUser/);
    expect(core).not.toMatch(/email_confirm/);
  });

  it('accepts no password on the provisioner input contract', () => {
    expect(code(read(EMPLOYEE_CORE))).not.toMatch(/password\?:\s*string/);
  });

  it('offers no "create login accounts" control or contract field', () => {
    expect(code(read(IMPORT_UI))).not.toMatch(/createLogins/);
    expect(code(read(IMPORT_API))).not.toMatch(/createLogins/);
    expect(code(read(IMPORT_ROUTE))).not.toMatch(/createLogins/);
  });
});

describe('Employee Import — no accept-and-drop policy fields (P1-1)', () => {
  it.each(['batchOwner', 'reviewRequired', 'notifyOnComplete'])(
    'does not accept %s, which had no implemented effect',
    field => {
      expect(code(read(IMPORT_ROUTE))).not.toContain(field);
      expect(code(read(IMPORT_API))).not.toContain(field);
      expect(code(read(IMPORT_UI))).not.toContain(field);
    },
  );

  it('rejects unknown policy keys instead of storing them', () => {
    // A non-strict schema silently persisted whatever the client sent.
    expect(code(read(IMPORT_ROUTE))).toMatch(/PolicySchema[\s\S]{0,1200}\.strict\(\)/);
  });
});

describe('Employee Import — batch ownership scope (P1-3)', () => {
  /** Split the route file into its individual `router.post(...)` handler blocks. */
  function handlers(): { name: string; body: string }[] {
    const src = read(IMPORT_ROUTE);
    return src
      .split(/(?=^router\.post)/m)
      .filter(b => b.startsWith('router.post'))
      .map(b => ({ name: b.split("'")[1] ?? '?', body: b }));
  }

  it('scopes every endpoint that acts on an existing batch', () => {
    // `upload` CREATES the batch, so there is nothing to scope against — it is the only
    // handler allowed to mention batchId without an ownership check.
    const unguarded = handlers()
      .filter(h => h.body.includes('batchId') && !h.body.includes('loadScopedBatch(actor'))
      .map(h => h.name)
      .filter(name => !name.endsWith('/upload'));

    expect(unguarded, `Batch endpoints with no ownership check: ${unguarded.join(', ')}`).toEqual([]);
  });

  it('guards all six batch-consuming endpoints', () => {
    const guarded = handlers().filter(h => h.body.includes('loadScopedBatch(actor')).map(h => h.name);
    expect(guarded).toHaveLength(6);
    for (const suffix of ['map-fields', 'set-policy', 'validate', 'resolve-row', 'commit', 'report']) {
      expect(guarded.some(n => n.endsWith(suffix)), `${suffix} must be scoped`).toBe(true);
    }
  });

  it('passes the whole actor to userCan, not just an id', () => {
    // userCan resolves grants and the superadmin carve-out from `role`; an id-only
    // object silently resolves to no role, so every manage_all check would fail.
    const src = code(read(IMPORT_ROUTE));
    expect(src).toMatch(/userCan\(actor,\s*'hr\.employees\.import\.manage_all'\)/);
    expect(src).not.toMatch(/userCan\(\{\s*id:/);
  });

  it('does not report a database failure as a missing batch', () => {
    // loadBatch previously swallowed `error` and returned null, turning an outage into
    // a misleading 404.
    expect(code(read(IMPORT_ROUTE))).toMatch(/Could not read import batch/);
  });
});

describe('Employee Import — record status matches the live CHECK constraint (P1-2)', () => {
  it('offers no Draft status, which app_users.status cannot store', () => {
    // app_users_status_check permits only 'active' | 'inactive'; a Draft import
    // could never commit.
    expect(code(read(IMPORT_ROUTE))).not.toMatch(/'active',\s*'draft'/);
    expect(code(read(IMPORT_API))).not.toMatch(/'active'\s*\|\s*'draft'/);
    expect(code(read(IMPORT_UI))).not.toMatch(/value="draft"/);
  });
});
