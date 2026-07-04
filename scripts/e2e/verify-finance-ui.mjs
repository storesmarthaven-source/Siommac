/**
 * scripts/e2e/verify-finance-ui.mjs — one-off: verify the endpoints the new
 * Finance + HR Compensation/Overtime pages call actually respond over the live
 * dev server with a real admin token. Not part of the suite runner.
 */
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { createClient } from '@supabase/supabase-js';

const REQ = ['JWT_SECRET', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'];
const env = {};
for (const line of readFileSync(new URL('../../.env', import.meta.url), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && REQ.includes(m[1])) env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
}
const base = process.env.BASE_URL || 'http://localhost:8888';
const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const { data: admins } = await sb.from('app_users').select('id, username, role, department_id')
  .in('role', ['admin', 'superadmin']).limit(1);
const u = admins?.[0];
if (!u) { console.error('No admin user found'); process.exit(2); }
const token = jwt.sign(
  { sub: u.id, username: u.username, role: u.role, departmentId: u.department_id ?? '',
    jti: randomUUID(), amr: ['pwd'], mfaSatisfied: false, authStrength: 'password_only' },
  env.JWT_SECRET, { expiresIn: '15m' });

async function call(path, args = {}) {
  const res = await fetch(`${base}/api/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ args }),
  });
  let body; try { body = await res.json(); } catch { body = { nonJson: true }; }
  return { status: res.status, ok: body?.success === true, count: Array.isArray(body?.data) ? body.data.length : (body?.data ? 1 : 0), msg: body?.message };
}

const checks = [
  ['finance/statutory/versions/list', {}],
  ['finance/statutory/reports/list', {}],
  ['finance/payroll/components/list', { activeOnly: false }],
  ['finance/payroll/runs/list', { limit: 50 }],
  ['finance/payroll/nis/list', { status: 'pending_verification' }],
  ['hr/compensation/pay-items/list', {}],
  ['hr/overtime/list', { status: 'submitted' }],
  ['hr/employees/list', { limit: 5 }],
];

console.log(`\nAdmin: ${u.username} (${u.role})  base: ${base}\n`);
let pass = 0;
for (const [path, args] of checks) {
  const r = await call(path, args);
  const good = r.ok || (r.status === 200);
  if (good) pass++;
  console.log(`${good ? '✅' : '❌'} ${path.padEnd(38)} status=${r.status} success=${r.ok} rows=${r.count}${r.msg ? '  msg=' + r.msg : ''}`);
}
console.log(`\n${pass}/${checks.length} endpoints responded OK\n`);
process.exit(pass === checks.length ? 0 : 1);
