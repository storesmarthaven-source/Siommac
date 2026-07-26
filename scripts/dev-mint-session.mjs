/**
 * scripts/dev-mint-session.mjs  (dev QA helper — localhost only)
 *
 * Mints a superadmin dev JWT + builds the full PersistedSession and writes it to
 * scripts/__dev_session.json (gitignored) so the browser can fetch+inject it
 * over localhost via Vite's /@fs route.
 * The token is NEVER printed to stdout. Also reports current payroll-run state.
 * Delete the temp file (and this script) after the QA session.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import jwt from 'jsonwebtoken';
import { createClient } from '@supabase/supabase-js';

const REQ = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'JWT_SECRET'];
function loadEnv() {
  const txt = readFileSync(new URL('../.env', import.meta.url), 'utf8');
  const out = {};
  for (const line of txt.split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && REQ.includes(m[1])) out[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
  }
  for (const k of REQ) if (!out[k]) { console.error(`Missing ${k} in .env`); process.exit(2); }
  return out;
}
const env = loadEnv();
const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

// Default: superadmin. Pass SESSION_USER_ID=<id> to mint for a specific user
// (e.g. a finance_manager approver to exercise the maker-checker path).
const wantId = process.env.SESSION_USER_ID || null;
const q = sb.from('app_users').select('id, username, first_name, last_name, role, department_id, position');
const { data: admins, error: aerr } = wantId
  ? await q.eq('id', wantId).limit(1)
  : await q.eq('role', 'superadmin').order('id').limit(1);
if (aerr) { console.error('app_users query failed:', aerr.message); process.exit(1); }
const u = admins?.[0];
if (!u) { console.error(`No user found${wantId ? ` for id ${wantId}` : ' (superadmin)'}`); process.exit(1); }

// Load the role's real default permission set (mirrors backend loadRolePermissions):
// role_permissions rows for non-superadmin; superadmin is allow-all (can() short-circuits).
let rolePermissions = [];
if (u.role !== 'superadmin') {
  const { data: rp, error: rperr } = await sb.from('role_permissions').select('permission').eq('role_name', u.role);
  if (rperr) { console.error('role_permissions query failed:', rperr.message); process.exit(1); }
  rolePermissions = (rp ?? []).map(r => r.permission);
}

const nowMs = Date.now();
const token = jwt.sign(
  { sub: u.id, username: u.username, role: u.role, departmentId: u.department_id ?? '' },
  env.JWT_SECRET, { expiresIn: '150m' });

const session = {
  token,
  userId: u.id,
  username: u.username,
  fullName: [u.first_name, u.last_name].filter(Boolean).join(' ') || u.username,
  role: u.role,
  departmentId: u.department_id ?? '',
  position: u.position ?? '',
  colorScheme: 'light',
  layoutMode: 'comfortable',
  profileImage: '',
  companyLogoUrl: '',
  companyName: 'SIOMAC',
  expiresAt: nowMs + 150 * 60 * 1000,
  idleExpiresAt: nowMs + 150 * 60 * 1000,
  idleTimeoutMs: 150 * 60 * 1000,
  rememberMe: true,
  rolePermissions,
  permissionOverrides: [],
  isEmployee: false,
  roleScope: 'all',
};

writeFileSync(new URL('./__dev_session.json', import.meta.url), JSON.stringify(session));

const { data: runs } = await sb.from('finance_payroll_runs')
  .select('id, run_no, status, pay_group_id, period_start, period_end, pay_date, current_calculation_version_id, created_at')
  .order('created_at', { ascending: false }).limit(15);

console.log('=== SUPERADMIN ===', u.id, u.username, u.role, '(token written to scripts/__dev_session.json — NOT printed)');
console.log('=== RUNS (newest first) ===');
for (const r of runs ?? []) {
  console.log(`  ${r.run_no}  [${r.status}]  pg=${r.pay_group_id}  ${r.period_start}..${r.period_end} pay=${r.pay_date}  calcVer=${r.current_calculation_version_id ? 'Y' : '-'}  id=${r.id}`);
}
