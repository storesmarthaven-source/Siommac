// Employee Import — transactional CREATE path (audit 2026-07-26, P0-3).
//
// Import created employees via provisionEmployee(): seven separate writes with unchecked
// compensation, so a row could be reported `failed` while a real employee, assignment and
// statutory profile survived. Replacing that with a bare hr_employee_create_tx call would
// NOT have closed it — the import row's `created` status was still a second round-trip,
// reproducing "row failed, employee exists" one layer out.
//
// The unit tests below pin the payload-hash contract and the source/SQL invariants. The
// behavioural cases the audit requires — rollback on invalid payload, forced row-update
// failure, deterministic retry, same-key/different-payload conflict, concurrency, and
// exactly-once assignment/audit/event — need a real transaction and live in
// scripts/e2e/suites/hrEmployeeImport.mjs.

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { importRowPayloadHash } from '../../netlify/functions/routes/hrEmployeeImport';

const ROOT = path.resolve(__dirname, '..', '..');
const read = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const stripComments = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const ROUTE = 'netlify/functions/routes/hrEmployeeImport.ts';
const SQL = 'supabase/migrations/20260926000008_hr_employee_import_create_tx.sql';

describe('importRowPayloadHash — deterministic payload half of the idempotency contract', () => {
  const row = { firstName: 'Ada', lastName: 'Lovelace', employeeNumber: 'EMP-0007' };

  it('is stable for identical content', () => {
    expect(importRowPayloadHash(row)).toBe(importRowPayloadHash({ ...row }));
  });

  it('ignores key order — an equivalent row is the same payload', () => {
    const reordered = { employeeNumber: 'EMP-0007', lastName: 'Lovelace', firstName: 'Ada' };
    expect(importRowPayloadHash(reordered)).toBe(importRowPayloadHash(row));
  });

  it('changes when any value changes, so an edited row is a different payload', () => {
    expect(importRowPayloadHash({ ...row, lastName: 'Byron' })).not.toBe(importRowPayloadHash(row));
  });

  it('distinguishes a removed field from a blank one', () => {
    const blank = { ...row, employeeNumber: '' };
    const { employeeNumber: _omitted, ...missing } = row;
    expect(importRowPayloadHash(blank)).not.toBe(importRowPayloadHash(missing));
  });

  it('produces a sha256 hex digest', () => {
    expect(importRowPayloadHash(row)).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('Import create route — one command, no compensation', () => {
  const route = () => stripComments(read(ROUTE));

  it('calls the transactional import-create command', () => {
    expect(route()).toMatch(/rpc\('hr_employee_import_create_tx'/);
  });

  it('no longer depends on provisionEmployee', () => {
    expect(route()).not.toMatch(/provisionEmployee\(/);
    expect(route()).not.toMatch(/provisionEmployee,/);
  });

  it('has no fire-and-forget event emission', () => {
    // `void emitAppEvent(...)` discarded a result that returns {ok:false} rather than
    // throwing, so a lost event looked like success.
    expect(route()).not.toMatch(/void emitAppEvent/);
  });

  it('performs no second status write after the create command', () => {
    // A post-RPC `.update({ status: 'created' })` is exactly the defect this closes.
    expect(route()).not.toMatch(/update\(\{\s*status:\s*'created'/);
  });

  it('passes the row id so the command can mark the row inside its transaction', () => {
    const src = route();
    expect(src).toMatch(/p_row_id:\s*r\.id/);
    expect(src).toMatch(/p_batch_id:/);
  });

  it('sends no access block, so an imported row cannot carry a role', () => {
    expect(route()).toMatch(/p_access:\s*\{\}/);
  });
});

describe('hr_employee_import_create_tx — migration contract', () => {
  const sql = () => read(SQL);

  it('locks both the batch and the import row', () => {
    const s = sql();
    expect(s).toMatch(/from public\.hr_employee_import_batches[\s\S]{0,120}for update/);
    expect(s).toMatch(/from public\.hr_employee_import_rows[\s\S]{0,140}for update/);
  });

  it('rejects a batch that is not committable', () => {
    expect(sql()).toMatch(/status not in \('validated', 'committing'\)/);
  });

  it('refuses to create in update mode, independently of the application layer', () => {
    expect(sql()).toMatch(/import_mode = 'update'[\s\S]{0,120}raise exception/);
  });

  it('rejects a row that belongs to another batch', () => {
    expect(sql()).toMatch(/does not belong to batch/);
  });

  it('reuses the canonical create command rather than re-implementing it', () => {
    expect(sql()).toMatch(/public\.hr_employee_create_tx\(/);
    // No duplicated employee INSERT in this function.
    expect(sql()).not.toMatch(/insert into public\.app_users/);
  });

  it('derives the idempotency key from batch id + row id', () => {
    expect(sql()).toMatch(/'hr\.import\.row:' \|\| p_batch_id::text \|\| ':' \|\| p_row_id::text/);
  });

  it('marks the import row created inside the same transaction and proves one row moved', () => {
    const s = sql();
    expect(s).toMatch(/update public\.hr_employee_import_rows[\s\S]{0,200}status = 'created'/);
    expect(s).toMatch(/get diagnostics v_rows_touched = row_count/);
    expect(s).toMatch(/v_rows_touched <> 1[\s\S]{0,120}raise exception/);
  });

  it('writes audit and event exactly once — suppressed on replay', () => {
    const s = sql();
    expect(s).toMatch(/if not v_replayed then/);
    expect(s).toMatch(/insert into public\.hr_audit_log/);
    expect(s).toMatch(/insert into public\.app_events/);
  });

  it('matches the partial unique index when deduping the event', () => {
    // app_events_dedupe_uidx is partial (where dedupe_key is not null); a bare
    // `on conflict (dedupe_key)` would not match it and would raise at runtime.
    expect(sql()).toMatch(/on conflict \(dedupe_key\) where dedupe_key is not null do nothing/);
  });

  it('returns the canonical result plus replay state', () => {
    const s = sql();
    expect(s).toMatch(/return v_result \|\| jsonb_build_object/);
    expect(s).toMatch(/'replayed', v_replayed/);
  });

  it('contains no compensating delete', () => {
    expect(sql()).not.toMatch(/delete from public\.app_users/);
  });

  it('is not executable by anon or authenticated', () => {
    expect(sql()).toMatch(/revoke all on function public\.hr_employee_import_create_tx/);
  });
});
