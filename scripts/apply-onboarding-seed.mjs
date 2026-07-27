/**
 * scripts/apply-onboarding-seed.mjs
 *
 * Applies supabase/apply-hr-onboarding-seed.sql via the service-role Supabase client
 * (no direct psql/DATABASE_URL available in this environment). Mirrors the SQL file's
 * logic exactly: employees + HR owners are picked dynamically from the REAL active
 * roster (never hardcoded, never fabricated) via the same ranking the SQL uses
 * (employees ordered by full_name, HR owners ordered by created_at). Idempotent —
 * fixed ids, ignoreDuplicates:true upserts — safe to re-run.
 *
 * Usage: node scripts/apply-onboarding-seed.mjs
 */

import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const REQUIRED_ENV = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'];
function loadEnv() {
  const txt = readFileSync(new URL('../.env', import.meta.url), 'utf8');
  const out = {};
  for (const line of txt.split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && REQUIRED_ENV.includes(m[1])) out[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
  }
  for (const k of REQUIRED_ENV) if (!out[k]) { console.error(`Missing ${k} in .env`); process.exit(2); }
  return out;
}

const env = loadEnv();
const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const daysFromNow = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const hoursFromNow = (n) => new Date(Date.now() + n * 3600000).toISOString();
const daysFromNowIso = (n) => new Date(Date.now() + n * 86400000).toISOString();

async function upsert(table, rows, label) {
  if (!rows.length) return;
  const { error, data } = await sb.from(table).upsert(rows, { onConflict: 'id', ignoreDuplicates: true }).select('id');
  if (error) { console.error(`  ! ${label}: ${error.message}`); return; }
  console.log(`  ${label}: ${data?.length ?? 0}/${rows.length} inserted (rest already existed)`);
}

console.log('Applying HR Onboarding demo seed (real employees only)...\n');

const { data: employees, error: empErr } = await sb.from('app_users')
  .select('id').eq('status', 'active').neq('role', 'superadmin').order('full_name');
if (empErr) { console.error(empErr.message); process.exit(1); }
if (employees.length < 6) { console.error(`Need >=6 active non-superadmin app_users, found ${employees.length}.`); process.exit(1); }

const { data: hrOwners, error: ownerErr } = await sb.from('app_users')
  .select('id').eq('status', 'active').in('role', ['hr_manager', 'hr_staff', 'admin', 'manager', 'superadmin']).order('created_at');
if (ownerErr) { console.error(ownerErr.message); process.exit(1); }
if (hrOwners.length < 1) { console.error('Need >=1 active HR-tier user.'); process.exit(1); }

const emp = (rn) => employees[rn - 1].id;
const owner = (rn) => hrOwners[Math.min(rn, hrOwners.length) - 1].id;
const startedBy = owner(1);

console.log(`Using ${employees.length} real employees + ${hrOwners.length} real HR-tier owner(s).\n`);

// ── cases ─────────────────────────────────────────────────────────────────────
const CASES = [
  { id: 'e0000000-0000-4000-8000-000000009101', case_no: 'ONB-2026-DEMO01', rn: 1, worker_type: 'employee',          package_key: 'standard_employee',          status: 'in_progress',          owner_rn: 1, due_at: daysFromNow(3),  started_offset: -6 },
  { id: 'e0000000-0000-4000-8000-000000009102', case_no: 'ONB-2026-DEMO02', rn: 2, worker_type: 'employee',          package_key: 'office_admin',               status: 'in_progress',          owner_rn: 1, due_at: daysFromNow(8),  started_offset: -2 },
  { id: 'e0000000-0000-4000-8000-000000009103', case_no: 'ONB-2026-DEMO03', rn: 3, worker_type: 'employee',          package_key: 'safety_critical_employee',   status: 'blocked',              owner_rn: 2, due_at: daysFromNow(-1), started_offset: -11 },
  { id: 'e0000000-0000-4000-8000-000000009104', case_no: 'ONB-2026-DEMO04', rn: 4, worker_type: 'contractor_worker', package_key: 'contractor_worker',          status: 'blocked',              owner_rn: 2, due_at: daysFromNow(1),  started_offset: -9 },
  { id: 'e0000000-0000-4000-8000-000000009105', case_no: 'ONB-2026-DEMO05', rn: 5, worker_type: 'employee',          package_key: 'supervisor_manager',         status: 'ready_for_activation', owner_rn: 1, due_at: daysFromNow(2),  started_offset: -13 },
  { id: 'e0000000-0000-4000-8000-000000009106', case_no: 'ONB-2026-DEMO06', rn: 6, worker_type: 'employee',          package_key: 'standard_employee',          status: 'completed',            owner_rn: 1, due_at: daysFromNow(-5), started_offset: -20 },
];
await upsert('hr_onboarding_cases', CASES.map(c => ({
  id: c.id, case_no: c.case_no, employee_id: emp(c.rn), worker_type: c.worker_type, package_key: c.package_key,
  status: c.status, owner_id: owner(c.owner_rn), due_at: c.due_at, started_by: startedBy, started_at: daysFromNowIso(c.started_offset),
})), 'cases');

// ── tasks ─────────────────────────────────────────────────────────────────────
const C = (n) => `e0000000-0000-4000-8000-00000000910${n}`;
const T = (seq) => `e1000000-0000-4000-8000-${String(100000 + seq).padStart(12, '0')}`;
const TASKS = [
  [1,  C(1), 'profile_confirmation', 'Confirm employee profile',     'hr', 'hr', 'completed', false, false, 'normal', null, -4],
  [2,  C(1), 'document_collection',  'Collect contract & documents', 'hr', 'hr', 'open',      false, true,  'normal', 0,    null],
  [3,  C(1), 'account_invite',       'Send account invite',          'it', 'it', 'open',      false, false, 'normal', 2,    null],
  [4,  C(1), 'equipment_request',    'Equipment request',            'it', 'it', 'open',      false, false, 'low',    5,    null],
  [5,  C(2), 'profile_confirmation', 'Confirm employee profile',     'hr', 'hr', 'completed', false, false, 'normal', null, -2],
  [6,  C(2), 'document_collection',  'Collect contract & documents', 'hr', 'hr', 'open',      false, true,  'high',   -2,   null],
  [7,  C(2), 'welcome',              'Welcome the new hire',         'supervisor', 'supervisor', 'open', false, false, 'normal', 1, null],
  [8,  C(3), 'profile_confirmation', 'Confirm employee profile',     'hr', 'hr', 'completed', false, false, 'normal', null, -10],
  [9,  C(3), 'site_induction',       'Site induction',                'hse', 'hse', 'blocked', true, true,  'critical', -1, null],
  [10, C(3), 'ppe_requirements',     'PPE requirements',              'hse', 'hse', 'open',    false, true, 'high', 0, null],
  [11, C(4), 'document_collection',  'Collect contract & documents', 'hr', 'hr', 'completed', false, true, 'normal', null, -6],
  [12, C(4), 'application_access',   'Grant application access',     'it', 'it', 'blocked', true, false, 'high', 0, null],
  [13, C(4), 'mfa_setup',            'MFA / passkey setup',          'it', 'it', 'open', false, false, 'normal', 3, null],
  [14, C(5), 'profile_confirmation', 'Confirm employee profile',     'hr', 'hr', 'completed', false, false, 'normal', null, -12],
  [15, C(5), 'document_collection',  'Collect contract & documents', 'hr', 'hr', 'completed', false, true, 'normal', null, -10],
  [16, C(5), 'account_invite',       'Send account invite',          'it', 'it', 'completed', false, false, 'normal', null, -3],
  [17, C(6), 'profile_confirmation', 'Confirm employee profile',     'hr', 'hr', 'completed', false, false, 'normal', null, -19],
  [18, C(6), 'document_collection',  'Collect contract & documents', 'hr', 'hr', 'completed', false, true, 'normal', null, -17],
  [19, C(6), 'welcome',              'Welcome the new hire',         'supervisor', 'supervisor', 'completed', false, false, 'normal', null, -5],
  [20, C(1), 'tax-profile-review',   'Review employee tax profile',  'payroll', 'payroll', 'open', false, false, 'low',      1, null],
  [21, C(2), 'identity-check',       'Verify identity documents',    'hr', 'hr', 'open', false, true, 'normal', 2, null],
  [22, C(3), 'safety-briefing',      'Complete safety briefing',     'hse', 'hse', 'blocked', true, true, 'critical', 3, null],
  [23, C(4), 'workstation-setup',    'Confirm workstation setup',    'it', 'it', 'open', false, false, 'high',     4, null],
  [24, C(5), 'manager-introduction', 'Schedule manager introduction','supervisor', 'supervisor', 'open', false, false, 'normal', 6, null],
  [25, C(1), 'benefits-enrolment',   'Complete benefits enrolment',  'hr', 'hr', 'open', false, true, 'high',      8, null],
];
await upsert('hr_onboarding_tasks', TASKS.map(([seq, case_id, task_key, task_title, owner_role, module_key, status, is_blocking, requires_evidence, priority, due_offset, completed_offset]) => ({
  id: T(seq), case_id, task_key, task_title, owner_role, module_key, status, is_blocking, requires_evidence, priority,
  due_at: due_offset !== null ? daysFromNowIso(due_offset) : null,
  completed_at: completed_offset !== null ? daysFromNowIso(completed_offset) : null,
})), 'tasks');

// ── blockers ──────────────────────────────────────────────────────────────────
await upsert('hr_onboarding_blockers', [
  { id: 'e3000000-0000-4000-8000-000000009301', case_id: C(3), task_id: T(9),  blocker_key: 'induction_pending',  blocker_title: 'Site induction not yet completed',      blocking_module: 'hse', severity: 'critical', status: 'active',            owner_id: owner(1), due_at: hoursFromNow(-24) },
  { id: 'e3000000-0000-4000-8000-000000009302', case_id: C(3), task_id: null,  blocker_key: 'medical_clearance',  blocker_title: 'Medical clearance outstanding',          blocking_module: 'hse', severity: 'high',     status: 'waiting_on_owner',  owner_id: owner(1), due_at: hoursFromNow(0) },
  { id: 'e3000000-0000-4000-8000-000000009303', case_id: C(4), task_id: T(12), blocker_key: 'access_not_granted', blocker_title: 'Application access not yet granted',    blocking_module: 'it',  severity: 'high',     status: 'active',            owner_id: owner(2), due_at: hoursFromNow(0) },
  { id: 'e3000000-0000-4000-8000-000000009304', case_id: C(4), task_id: null,  blocker_key: 'background_check',   blocker_title: 'Contractor background check pending',    blocking_module: 'hr',  severity: 'medium',   status: 'acknowledged',      owner_id: owner(1), due_at: hoursFromNow(48) },
], 'blockers');

// ── handoffs ──────────────────────────────────────────────────────────────────
const H = (seq) => `e2000000-0000-4000-8000-${String(200000 + seq).padStart(12, '0')}`;
await upsert('hr_onboarding_handoffs', [
  { id: H(1), case_id: C(1), handoff_key: 'it_account_provisioning', target_module: 'it',  handoff_type: 'account_provisioning', status: 'delivered', failure_reason: null },
  { id: H(2), case_id: C(2), handoff_key: 'it_account_provisioning', target_module: 'it',  handoff_type: 'account_provisioning', status: 'pending',   failure_reason: null },
  { id: H(3), case_id: C(3), handoff_key: 'hse_induction_booking',   target_module: 'hse', handoff_type: 'induction_booking',    status: 'failed',    failure_reason: 'No available induction slot before start date' },
  { id: H(4), case_id: C(4), handoff_key: 'it_account_provisioning', target_module: 'it',  handoff_type: 'account_provisioning', status: 'pending',   failure_reason: null },
  { id: H(5), case_id: C(5), handoff_key: 'it_account_provisioning', target_module: 'it',  handoff_type: 'account_provisioning', status: 'delivered', failure_reason: null },
  { id: H(6), case_id: C(6), handoff_key: 'it_account_provisioning', target_module: 'it',  handoff_type: 'account_provisioning', status: 'delivered', failure_reason: null },
], 'handoffs');

// ── recent activity (hr_audit_log) ───────────────────────────────────────────
await upsert('hr_audit_log', [
  { id: 'e4000000-0000-4000-8000-000000009401', submodule_key: 'onboarding', record_id: C(1), actor_id: owner(1), action: 'hr.onboarding.task_added',            created_at: hoursFromNow(-1) },
  { id: 'e4000000-0000-4000-8000-000000009402', submodule_key: 'onboarding', record_id: C(5), actor_id: owner(1), action: 'hr.onboarding.ready_for_activation',   created_at: hoursFromNow(-3) },
  { id: 'e4000000-0000-4000-8000-000000009403', submodule_key: 'onboarding', record_id: C(3), actor_id: owner(2), action: 'hr.onboarding.task_blocked',           created_at: hoursFromNow(-5) },
  { id: 'e4000000-0000-4000-8000-000000009404', submodule_key: 'onboarding', record_id: C(6), actor_id: owner(1), action: 'hr.onboarding.completed',              created_at: hoursFromNow(-30) },
  { id: 'e4000000-0000-4000-8000-000000009405', submodule_key: 'onboarding', record_id: C(4), actor_id: owner(2), action: 'hr.onboarding.blocker_owner_notified', created_at: hoursFromNow(-26) },
  { id: 'e4000000-0000-4000-8000-000000009406', submodule_key: 'onboarding', record_id: C(2), actor_id: owner(1), action: 'hr.onboarding.task_added',             created_at: hoursFromNow(-48) },
  { id: 'e4000000-0000-4000-8000-000000009407', submodule_key: 'onboarding', record_id: C(1), actor_id: owner(1), action: 'hr.onboarding.task_added',             created_at: hoursFromNow(-50) },
], 'recent activity');

console.log('\nDone.');
